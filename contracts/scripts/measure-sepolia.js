/**
 * Live-network gas and latency measurement against the deployed contracts.
 *
 * Two things make this necessary rather than redundant with measure-gas.js.
 *
 * First, measure-gas.js asserted that "gas is fixed by the EVM cost schedule
 * and the contract bytecode, not by which network executes it". The deployment
 * receipts disprove that for this pair of environments: EscrowContract cost
 * 1,530,188 gas on the local Hardhat network and 10,476,800 on Sepolia for
 * bytecode Etherscan verified as identical. Whatever the cause, the local
 * figures cannot be presented as the units Sepolia charges without a live
 * measurement to compare them against. This script provides it.
 *
 * Second, Appendix A asks for transaction hashes and for latency measured
 * against a named provider. Both are properties of a public network and cannot
 * be obtained from an in-process chain at all.
 *
 * Not every operation is reachable here. releaseFunds sits behind a 48-hour
 * time lock and refundAfterHolding behind a seven-day one; a public chain's
 * clock cannot be advanced, so those two are measurable only locally. That is
 * the division of labour between the two scripts, not a gap in either.
 *
 *   npx hardhat run scripts/measure-sepolia.js --network sepolia
 *
 * Override the repetition count with SEPOLIA_REPETITIONS. Each repetition
 * spends real testnet ether, so the default is deliberately small.
 */

const fs = require("node:fs");
const path = require("node:path");
const hre = require("hardhat");

const { THRESHOLD, MODEL_VERSION } = require("../test/helpers");

const REPETITIONS = Number(process.env.SEPOLIA_REPETITIONS || 3);

// Small enough that a stuck escrow costs nothing that matters, large enough to
// be non-zero (depositFunds rejects a zero value).
const AMOUNT_ETH = process.env.SEPOLIA_AMOUNT_ETH || "0.0002";

const RISK_SCORE = 12;           // below THRESHOLD, so the gate admits it
const EXPIRY_HORIZON = 365 * 24 * 60 * 60;

/**
 * The seller address.
 *
 * depositFunds requires buyer, seller and arbitrator to be three distinct
 * addresses, and only two keys exist: the deployer acts as buyer, the oracle
 * operator as arbitrator. The seller never signs in the path measured here —
 * resolveDispute(false) refunds the buyer — so a third address is needed but a
 * third funded account is not.
 *
 * Derived from a fixed constant so the address is reproducible from this file
 * alone. It is a throwaway testnet identity that never holds value.
 */
function sellerAddress() {
  const key = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("smartguard-sepolia-seller-v1"));
  return new hre.ethers.Wallet(key).address;
}

function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const mean = sorted.reduce((a, b) => a + b, 0) / n;
  const variance = sorted.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  const median = n % 2
    ? sorted[(n - 1) / 2]
    : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  return {
    calls: n,
    min: sorted[0],
    max: sorted[n - 1],
    mean: Math.round(mean * 100) / 100,
    median,
    std_dev: Math.round(Math.sqrt(variance) * 100) / 100,
    range: sorted[n - 1] - sorted[0],
  };
}

function loadDeployment() {
  const file = path.resolve(__dirname, "../../docs/evidence/deployment.sepolia.json");
  if (!fs.existsSync(file)) {
    throw new Error(
      "No deployment record. Run scripts/deploy.js --network sepolia first.",
    );
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

async function main() {
  const deployment = loadDeployment();
  const { chainId } = await hre.ethers.provider.getNetwork();

  if (Number(chainId) !== deployment.chainId) {
    throw new Error(
      `Connected to chain ${chainId} but the record is for ${deployment.chainId}.`,
    );
  }

  const signers = await hre.ethers.getSigners();
  if (signers.length < 2) {
    throw new Error("Two signers required; ORACLE_PRIVATE_KEY did not load.");
  }

  const [buyer, arbitrator] = signers;
  const seller = sellerAddress();

  const oracle = await hre.ethers.getContractAt(
    "RiskOracleContract", deployment.contracts.RiskOracleContract.address,
  );
  const escrow = await hre.ethers.getContractAt(
    "EscrowContract", deployment.contracts.EscrowContract.address,
  );

  console.log(`network      sepolia (chainId ${chainId})`);
  console.log(`oracle       ${await oracle.getAddress()}`);
  console.log(`escrow       ${await escrow.getAddress()}`);
  console.log(`buyer        ${buyer.address}`);
  console.log(`arbitrator   ${arbitrator.address}  (also the oracle operator)`);
  console.log(`seller       ${seller}  (never signs; dispute refunds the buyer)`);
  console.log(`amount       ${AMOUNT_ETH} ETH · repetitions ${REPETITIONS}\n`);

  // The oracle rejects any nonce not strictly above the highest it has
  // accepted, and that counter survives across runs, so it is read rather
  // than assumed.
  let nonce = Number(await oracle.lastNonce());
  console.log(`oracle lastNonce on chain: ${nonce}\n`);

  const gas = {};
  const latency = {};
  const transactions = [];

  /** Sends one call, waits for inclusion, and records gas, latency and hash. */
  const send = async (name, promise) => {
    const submittedAt = Date.now();
    const tx = await promise;
    const sentAt = Date.now();
    const receipt = await tx.wait();
    const minedAt = Date.now();

    const gasUsed = Number(receipt.gasUsed);
    (gas[name] ||= []).push(gasUsed);
    (latency[name] ||= []).push(minedAt - submittedAt);

    transactions.push({
      operation: name,
      hash: tx.hash,
      blockNumber: receipt.blockNumber,
      gasUsed,
      effectiveGasPrice: receipt.gasPrice ? receipt.gasPrice.toString() : null,
      status: receipt.status,
      submitToSendMs: sentAt - submittedAt,
      submitToMineMs: minedAt - submittedAt,
      explorer: `https://sepolia.etherscan.io/tx/${tx.hash}`,
    });

    console.log(
      `    ${name.padEnd(34)} ${String(gasUsed).padStart(9)} gas  `
      + `${String(minedAt - submittedAt).padStart(6)} ms  ${tx.hash}`,
    );
    return receipt;
  };

  const value = hre.ethers.parseEther(AMOUNT_ETH);

  for (let i = 0; i < REPETITIONS; i += 1) {
    console.log(`  repetition ${i + 1} of ${REPETITIONS}`);

    nonce += 1;
    const escrowId = await escrow.computeEscrowId(
      buyer.address, seller, value, nonce,
    );

    const block = await hre.ethers.provider.getBlock("latest");
    const expiry = block.timestamp + EXPIRY_HORIZON;

    await send("RiskOracleContract.updateRiskScore", oracle
      .connect(arbitrator)
      .updateRiskScore(escrowId, RISK_SCORE, MODEL_VERSION, nonce, expiry));

    await send("EscrowContract.depositFunds", escrow
      .connect(buyer)
      .depositFunds(seller, arbitrator.address, nonce, { value }));

    await send("EscrowContract.confirmDelivery", escrow
      .connect(buyer).confirmDelivery(escrowId));

    await send("EscrowContract.initiateDispute", escrow
      .connect(buyer).initiateDispute(escrowId));

    // false refunds the buyer, so the ether cycles back rather than being
    // spent into an address whose key is a throwaway.
    await send("EscrowContract.resolveDispute", escrow
      .connect(arbitrator).resolveDispute(escrowId, false));

    console.log();
  }

  const feeData = await hre.ethers.provider.getFeeData();

  const record = {
    recordedAt: new Date().toISOString(),
    network: "sepolia",
    chainId: Number(chainId),
    provider: "Alchemy",
    repetitions: REPETITIONS,
    amountEth: AMOUNT_ETH,
    riskScore: RISK_SCORE,
    riskThreshold: THRESHOLD,
    contracts: {
      RiskOracleContract: await oracle.getAddress(),
      EscrowContract: await escrow.getAddress(),
    },
    accounts: {
      buyer: buyer.address,
      arbitrator: arbitrator.address,
      seller,
    },
    feeData: {
      gasPriceWei: feeData.gasPrice ? feeData.gasPrice.toString() : null,
      gasPriceGwei: feeData.gasPrice
        ? hre.ethers.formatUnits(feeData.gasPrice, "gwei") : null,
    },
    notMeasuredHere: {
      "EscrowContract.releaseFunds":
        "Behind the 48-hour time lock; a public chain's clock cannot be advanced.",
      "EscrowContract.refundAfterHolding":
        "Behind the seven-day holding period; same reason.",
    },
    gas: Object.fromEntries(
      Object.entries(gas).map(([k, v]) => [k, stats(v)]),
    ),
    latencyMs: Object.fromEntries(
      Object.entries(latency).map(([k, v]) => [k, stats(v)]),
    ),
    transactions,
  };

  const outPath = path.resolve(
    __dirname, "../../docs/evidence/sepolia-measurements.json",
  );
  fs.writeFileSync(outPath, `${JSON.stringify(record, null, 2)}\n`);

  console.log("gas, Sepolia:");
  for (const [name, s] of Object.entries(record.gas)) {
    console.log(
      `  ${name.padEnd(36)} median ${String(s.median).padStart(9)}  `
      + `min ${String(s.min).padStart(9)}  max ${String(s.max).padStart(9)}  n=${s.calls}`,
    );
  }

  console.log("\nlatency, submission to inclusion (ms):");
  for (const [name, s] of Object.entries(record.latencyMs)) {
    console.log(
      `  ${name.padEnd(36)} median ${String(s.median).padStart(7)}  `
      + `min ${String(s.min).padStart(7)}  max ${String(s.max).padStart(7)}`,
    );
  }

  console.log(`\nrecorded to  ${path.relative(process.cwd(), outPath)}`);
  console.log(`${transactions.length} transaction hashes retained`);
}

main().catch((error) => {
  console.error(`\n${error.message ?? error}`);
  process.exitCode = 1;
});
