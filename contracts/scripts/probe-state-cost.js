/**
 * Isolates why Sepolia and the local Hardhat network disagree on gas.
 *
 * The live measurement showed two populations. Operations that only read state
 * or overwrite slots that already hold a value agree with the local figures to
 * within 4 per cent (confirmDelivery 1.03x, initiateDispute 1.04x). The two
 * that allocate storage slots which were previously zero diverge by a factor
 * of nearly four (updateRiskScore 3.65x, depositFunds 3.84x), and the implied
 * surcharge is about 63,000 gas per newly written slot.
 *
 * setRiskThreshold is the control. It writes a single uint8 into a slot that
 * already holds a value, so it allocates nothing. If the surcharge is confined
 * to new state, this call must agree with its local measurement; if the whole
 * cost schedule differs, it must not.
 *
 * The threshold is restored to its configured value before the script exits,
 * because Section 3.11.3 fixes it at 75 and the deployment record states it.
 *
 *   npx hardhat run scripts/probe-state-cost.js --network sepolia
 */

const fs = require("node:fs");
const path = require("node:path");
const hre = require("hardhat");

const { THRESHOLD } = require("../test/helpers");

// The local median for setRiskThreshold, from docs/evidence/gas-measurements.json.
const LOCAL_MEDIAN = 30104;

// A valid alternative, so the write changes the stored value rather than
// rewriting the same one — an unchanged write is charged differently.
const PROBE_VALUE = 76;

async function main() {
  const file = path.resolve(__dirname, "../../docs/evidence/deployment.sepolia.json");
  const deployment = JSON.parse(fs.readFileSync(file, "utf8"));

  const escrow = await hre.ethers.getContractAt(
    "EscrowContract", deployment.contracts.EscrowContract.address,
  );
  const [owner] = await hre.ethers.getSigners();

  const before = Number(await escrow.riskThreshold());
  console.log(`escrow            ${await escrow.getAddress()}`);
  console.log(`owner             ${owner.address}`);
  console.log(`threshold now     ${before}\n`);

  if (before !== THRESHOLD) {
    console.warn(
      `The threshold is ${before}, not the configured ${THRESHOLD}. A previous run `
      + "may have exited before restoring it.\n",
    );
  }

  const measure = async (label, value) => {
    const tx = await escrow.connect(owner).setRiskThreshold(value);
    const receipt = await tx.wait();
    const gasUsed = Number(receipt.gasUsed);
    console.log(
      `  ${label.padEnd(26)} -> ${String(value).padEnd(4)} ${String(gasUsed).padStart(8)} gas  ${tx.hash}`,
    );
    return { value, gasUsed, hash: tx.hash, blockNumber: receipt.blockNumber };
  };

  const changed = await measure("existing slot, new value", PROBE_VALUE);
  const restored = await measure("restored", THRESHOLD);

  const finalValue = Number(await escrow.riskThreshold());
  console.log(`\nthreshold restored to ${finalValue}`);

  if (finalValue !== THRESHOLD) {
    throw new Error(
      `The threshold is ${finalValue} but must be ${THRESHOLD}. Restore it before `
      + "citing the deployment record.",
    );
  }

  const ratio = changed.gasUsed / LOCAL_MEDIAN;
  console.log(`\nsetRiskThreshold  local ${LOCAL_MEDIAN.toLocaleString()} · `
    + `sepolia ${changed.gasUsed.toLocaleString()} · ratio ${ratio.toFixed(2)}x`);

  const confined = ratio < 1.15;
  console.log(
    confined
      ? "\nThe surcharge is confined to newly allocated storage. Operations that\n"
        + "overwrite existing slots cost the same on both networks, so the local\n"
        + "figures remain valid for those and only the state-allocating operations\n"
        + "must be cited from the live measurement."
      : "\nThe divergence is not confined to new state: this overwrite also differs.\n"
        + "The whole cost schedule differs, so no local figure may be cited as a\n"
        + "Sepolia cost.",
  );

  const outPath = path.resolve(__dirname, "../../docs/evidence/state-cost-probe.json");
  fs.writeFileSync(outPath, `${JSON.stringify({
    recordedAt: new Date().toISOString(),
    network: "sepolia",
    chainId: deployment.chainId,
    escrow: await escrow.getAddress(),
    question:
      "Is the Sepolia gas surcharge confined to storage slots that were previously zero?",
    control: "setRiskThreshold overwrites an existing slot and allocates nothing.",
    localMedian: LOCAL_MEDIAN,
    sepolia: changed,
    restore: restored,
    ratio: Math.round(ratio * 1000) / 1000,
    surchargeConfinedToNewState: confined,
    thresholdAfter: finalValue,
  }, null, 2)}\n`);
  console.log(`\nrecorded to  ${path.relative(process.cwd(), outPath)}`);
}

main().catch((error) => {
  console.error(`\n${error.message ?? error}`);
  process.exitCode = 1;
});
