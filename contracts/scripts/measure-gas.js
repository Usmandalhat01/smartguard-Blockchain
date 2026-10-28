/**
 * Per-execution gas measurement for Table 4.2.
 *
 * Appendix A records what the submitted Table 4.2 lacked: "the per-execution
 * receipts, testing date, gas price, ETH/USD conversion rate, median, minimum,
 * maximum, and standard deviation are unavailable in the submitted material."
 *
 * hardhat-gas-reporter gives min, max and mean across whatever calls the test
 * suite happens to make — a by-product of the tests rather than a designed
 * measurement. This script executes each function a fixed number of times
 * through complete escrow lifecycles and retains every receipt, so the
 * dispersion statistics are computed from the population.
 *
 * It runs against the local Hardhat network. Gas is fixed by the EVM cost
 * schedule and the contract bytecode, not by which network executes it, so
 * these units are the units Sepolia charges. What the network decides is the
 * gas *price*, which is recorded separately and applied at the end.
 *
 *   npx hardhat run scripts/measure-gas.js
 *
 * The lifecycle helpers are imported from the test suite rather than
 * reimplemented, so a change to a constructor signature breaks both together.
 */

const fs = require("fs");
const path = require("path");
const hre = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const {
  THRESHOLD, TIME_LOCK, HOLDING, MODEL_VERSION, farExpiry,
} = require("../test/helpers");

const REPETITIONS = Number(process.env.GAS_REPETITIONS || 20);

// Recorded rather than assumed. Table 4.2 states 15 Gwei and USD 2,650.00/ETH
// without saying when that rate held, which is the gap Appendix A identifies.
const GAS_PRICE_GWEI = Number(process.env.GAS_PRICE_GWEI || 15);
const ETH_USD = Number(process.env.ETH_USD || 2650);

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
    // Zero spread is the expected result for a function whose storage writes
    // do not vary with input. Reporting it beats omitting it.
    range: sorted[n - 1] - sorted[0],
  };
}

async function main() {
  const signers = await hre.ethers.getSigners();
  const [owner, oracleOperator, buyer, seller, arbitrator] = signers;

  const receipts = {};
  const record = (name, receipt) => {
    (receipts[name] ||= []).push(Number(receipt.gasUsed));
  };

  // The oracle rejects any nonce that does not strictly exceed the last one it
  // accepted, so the counter is global to the run rather than per lifecycle.
  let nonce = 0;
  const nextNonce = () => ++nonce;

  const Oracle = await hre.ethers.getContractFactory("RiskOracleContract");
  const Escrow = await hre.ethers.getContractFactory("EscrowContract");

  const amount = hre.ethers.parseEther("1");

  for (let i = 0; i < REPETITIONS; i += 1) {
    // Fresh contracts per repetition, so deployment cost is measured too and
    // no lifecycle inherits another's storage.
    const oracle = await Oracle.deploy(oracleOperator.address);
    await oracle.waitForDeployment();
    record("RiskOracleContract.deployment",
      await hre.ethers.provider.getTransactionReceipt(
        oracle.deploymentTransaction().hash));

    const escrow = await Escrow.deploy(
      await oracle.getAddress(), THRESHOLD, TIME_LOCK, HOLDING,
    );
    await escrow.waitForDeployment();
    record("EscrowContract.deployment",
      await hre.ethers.provider.getTransactionReceipt(
        escrow.deploymentTransaction().hash));

    const deposit = async (n) => {
      record("EscrowContract.depositFunds", await (
        await escrow.connect(buyer).depositFunds(
          seller.address, arbitrator.address, n, { value: amount },
        )
      ).wait());
    };

    // --- lifecycle A: delivered, time lock elapses, released to seller ----
    {
      const n = nextNonce();
      const id = await escrow.computeEscrowId(
        buyer.address, seller.address, amount, n,
      );
      record("RiskOracleContract.updateRiskScore", await (
        await oracle.connect(oracleOperator).updateRiskScore(
          id, 12, MODEL_VERSION, n, await farExpiry(),
        )
      ).wait());
      await deposit(n);

      record("EscrowContract.confirmDelivery", await (
        await escrow.connect(buyer).confirmDelivery(id)
      ).wait());

      // releaseFunds sits behind the 48-hour time lock. Advancing the local
      // chain's clock changes the block timestamp only, not the gas the call
      // consumes.
      await time.increase(TIME_LOCK + 1);

      record("EscrowContract.releaseFunds", await (
        await escrow.connect(seller).releaseFunds(id)
      ).wait());
    }

    // --- lifecycle B: disputed, arbitrator refunds the buyer --------------
    {
      const n = nextNonce();
      const id = await escrow.computeEscrowId(
        buyer.address, seller.address, amount, n,
      );
      record("RiskOracleContract.updateRiskScore", await (
        await oracle.connect(oracleOperator).updateRiskScore(
          id, 12, MODEL_VERSION, n, await farExpiry(),
        )
      ).wait());
      await deposit(n);

      record("EscrowContract.initiateDispute", await (
        await escrow.connect(buyer).initiateDispute(id)
      ).wait());

      // Restricted to the arbitrator recorded in this escrow, not to a role.
      record("EscrowContract.resolveDispute", await (
        await escrow.connect(arbitrator).resolveDispute(id, false)
      ).wait());
    }

    // --- lifecycle C: seller inaction, buyer reclaims after the hold ------
    {
      const n = nextNonce();
      const id = await escrow.computeEscrowId(
        buyer.address, seller.address, amount, n,
      );
      record("RiskOracleContract.updateRiskScore", await (
        await oracle.connect(oracleOperator).updateRiskScore(
          id, 12, MODEL_VERSION, n, await farExpiry(),
        )
      ).wait());
      await deposit(n);

      await time.increase(HOLDING + 1);

      record("EscrowContract.claimRefund", await (
        await escrow.connect(buyer).claimRefund(id)
      ).wait());
    }

    // --- owner-only configuration, Section 3.15.2 key rotation -----------
    record("EscrowContract.setRiskThreshold", await (
      await escrow.connect(owner).setRiskThreshold(70 + (i % 6))
    ).wait());
    record("RiskOracleContract.setOracleOperator", await (
      await oracle.connect(owner).setOracleOperator(oracleOperator.address)
    ).wait());
  }

  const weiPerGas = BigInt(Math.round(GAS_PRICE_GWEI * 1e9));

  const rows = Object.entries(receipts)
    .map(([method, values]) => {
      const s = stats(values);
      const costEth = Number(hre.ethers.formatEther(
        BigInt(Math.round(s.mean)) * weiPerGas,
      ));
      return {
        method,
        ...s,
        mean_cost_eth: Number(costEth.toFixed(8)),
        mean_cost_usd: Number((costEth * ETH_USD).toFixed(4)),
      };
    })
    .sort((a, b) => b.mean - a.mean);

  const compilers = hre.config.solidity.compilers ?? [];
  const output = {
    generated: new Date().toISOString(),
    network: hre.network.name,
    chain_id: Number((await hre.ethers.provider.getNetwork()).chainId),
    solc: compilers[0]?.version ?? hre.config.solidity.version,
    optimizer: compilers[0]?.settings?.optimizer
      ?? hre.config.solidity.settings?.optimizer,
    repetitions: REPETITIONS,
    escrow_parameters: {
      risk_threshold: THRESHOLD,
      time_lock_seconds: TIME_LOCK,
      holding_period_seconds: HOLDING,
    },
    pricing: {
      gas_price_gwei: GAS_PRICE_GWEI,
      eth_usd: ETH_USD,
      note: "Gas units are set by the EVM cost schedule and are "
        + "network-independent. The gas price and ETH/USD rate are assumptions "
        + "recorded at the generation timestamp above, not measurements.",
    },
    methods: rows,
    raw_receipts: receipts,
  };

  const dest = path.join(__dirname, "..", "..", "docs", "evidence");
  fs.mkdirSync(dest, { recursive: true });
  fs.writeFileSync(
    path.join(dest, "gas-measurements.json"),
    `${JSON.stringify(output, null, 2)}\n`,
  );

  const width = Math.max(...rows.map((r) => r.method.length));
  const head = `${"method".padEnd(width)}  ${"calls".padStart(5)}  `
    + `${"min".padStart(9)}  ${"median".padStart(9)}  ${"mean".padStart(10)}  `
    + `${"max".padStart(9)}  ${"std dev".padStart(8)}  ${"USD".padStart(7)}`;

  console.log(`\nTable 4.2 — gas measured over ${REPETITIONS} lifecycles`);
  console.log(`network ${output.network} (chain ${output.chain_id}) · solc ${output.solc}`);
  console.log(`priced at ${GAS_PRICE_GWEI} Gwei and USD ${ETH_USD.toLocaleString()}/ETH\n`);
  console.log(head);
  console.log("-".repeat(head.length));
  for (const r of rows) {
    console.log(
      `${r.method.padEnd(width)}  ${String(r.calls).padStart(5)}  `
      + `${r.min.toLocaleString().padStart(9)}  ${r.median.toLocaleString().padStart(9)}  `
      + `${r.mean.toLocaleString().padStart(10)}  ${r.max.toLocaleString().padStart(9)}  `
      + `${r.std_dev.toLocaleString().padStart(8)}  ${r.mean_cost_usd.toFixed(2).padStart(7)}`,
    );
  }
  console.log(`\nwrote docs/evidence/gas-measurements.json `
    + `(${Object.values(receipts).flat().length} receipts retained)`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
