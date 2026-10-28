/**
 * Prints the raw receipt fields for the deployment transactions.
 *
 * Diagnostic: the Sepolia receipt reported far more gas for the escrow
 * deployment than the deterministic local measurement, so the figure recorded
 * as `gasUsed` needs checking against `cumulativeGasUsed` and against the
 * block's own total before it is cited.
 */
const hre = require("hardhat");

// `hardhat run` owns argv, so the hashes come from the deployment record.
const fs = require("node:fs");
const path = require("node:path");

function hashes() {
  const file = path.resolve(__dirname, "../../docs/evidence/deployment.sepolia.json");
  const record = JSON.parse(fs.readFileSync(file, "utf8"));
  return Object.values(record.contracts).map((c) => c.deploymentTx);
}

const HASHES = process.env.TX_HASHES
  ? process.env.TX_HASHES.split(",").map((s) => s.trim())
  : hashes();

async function main() {
  for (const hash of HASHES) {
    const receipt = await hre.ethers.provider.getTransactionReceipt(hash);
    if (!receipt) { console.log(`${hash}  not found`); continue; }

    const block = await hre.ethers.provider.getBlock(receipt.blockNumber);
    const raw = await hre.ethers.provider.send("eth_getTransactionReceipt", [hash]);

    console.log(`tx                   ${hash}`);
    console.log(`  block              ${receipt.blockNumber}  (${block.transactions.length} txs)`);
    console.log(`  index in block     ${receipt.index}`);
    console.log(`  gasUsed (raw)      ${BigInt(raw.gasUsed)}`);
    console.log(`  cumulativeGasUsed  ${BigInt(raw.cumulativeGasUsed)}`);
    console.log(`  block gasUsed      ${block.gasUsed}`);
    console.log(`  ethers .gasUsed    ${receipt.gasUsed}`);
    console.log();
  }
}

main().catch((e) => { console.error(e.message ?? e); process.exitCode = 1; });
