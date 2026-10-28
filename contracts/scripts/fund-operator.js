/**
 * Transfers a little Sepolia ETH from the deployer to the oracle operator.
 *
 * The operator needs gas of its own: RiskOracleContract.updateRiskScore is
 * guarded by `msg.sender != oracleOperator`, so the operator submits those
 * transactions itself rather than having them relayed. Faucets generally allow
 * one claim per period, so funding the second account by transfer is usually
 * easier than claiming twice.
 *
 *   npx hardhat run scripts/fund-operator.js --network sepolia
 *
 * Override the amount with FUND_AMOUNT_ETH. Sends nothing if the operator is
 * already funded, so the script is safe to re-run.
 */

const hre = require("hardhat");

const DEFAULT_AMOUNT_ETH = "0.01";

async function main() {
  const signers = await hre.ethers.getSigners();

  if (signers.length < 2) {
    throw new Error(
      "Two signers are required. ORACLE_PRIVATE_KEY did not load from ../.env — "
      + "see docs/SETUP-KEYS.md.",
    );
  }

  const [deployer, operator] = signers;

  if (deployer.address === operator.address) {
    throw new Error(
      "Both keys derive the same address; there is nothing to fund. The owner and "
      + "the oracle operator must be distinct accounts (Section 3.15.2).",
    );
  }

  const amount = hre.ethers.parseEther(process.env.FUND_AMOUNT_ETH ?? DEFAULT_AMOUNT_ETH);
  const operatorBalance = await hre.ethers.provider.getBalance(operator.address);

  console.log(`deployer   ${deployer.address}`);
  console.log(`operator   ${operator.address}  ${hre.ethers.formatEther(operatorBalance)} ETH`);

  if (operatorBalance >= amount) {
    console.log(
      `\nOperator already holds at least ${hre.ethers.formatEther(amount)} ETH. `
      + "Nothing sent.",
    );
    return;
  }

  const topUp = amount - operatorBalance;
  const deployerBalance = await hre.ethers.provider.getBalance(deployer.address);

  if (deployerBalance <= topUp) {
    throw new Error(
      `The deployer holds ${hre.ethers.formatEther(deployerBalance)} ETH, which does `
      + `not cover a ${hre.ethers.formatEther(topUp)} ETH transfer plus its own gas. `
      + "Claim from a faucet first.",
    );
  }

  console.log(`\nsending    ${hre.ethers.formatEther(topUp)} ETH`);
  const tx = await deployer.sendTransaction({ to: operator.address, value: topUp });
  console.log(`tx         ${tx.hash}`);

  const receipt = await tx.wait();
  console.log(`confirmed  block ${receipt.blockNumber}, gas ${receipt.gasUsed}`);

  const after = await hre.ethers.provider.getBalance(operator.address);
  console.log(`operator   ${hre.ethers.formatEther(after)} ETH`);
}

main().catch((error) => {
  console.error(`\n${error.message ?? error}`);
  process.exitCode = 1;
});
