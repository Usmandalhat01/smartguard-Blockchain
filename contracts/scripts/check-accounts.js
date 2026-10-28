/**
 * Pre-deployment credential check. Deploys nothing and sends no transaction.
 *
 * Run this before scripts/deploy.js. It answers the three questions that
 * otherwise fail halfway through a deployment:
 *
 *   1. Did both keys in .env load? Two signers are required, because the
 *      oracle operator must be a different account from the owner
 *      (Section 3.15.2) — one signer means ORACLE_PRIVATE_KEY did not load.
 *   2. Is the RPC endpoint reachable?
 *   3. Does the deployer hold enough Sepolia ETH to pay for both deployments?
 *
 *   npx hardhat run scripts/check-accounts.js --network sepolia
 */

const hre = require("hardhat");

// Measured deployment cost of the two contracts plus headroom for the
// lifecycle transactions the evidence run needs. See docs/evidence/gas-report.txt.
const SUGGESTED_MINIMUM_ETH = 0.05;

async function main() {
  const { chainId } = await hre.ethers.provider.getNetwork();
  console.log(`network         ${hre.network.name} (chainId ${chainId})`);

  const blockNumber = await hre.ethers.provider.getBlockNumber();
  console.log(`latest block    ${blockNumber}`);

  const fee = await hre.ethers.provider.getFeeData();
  if (fee.gasPrice) {
    console.log(`gas price       ${hre.ethers.formatUnits(fee.gasPrice, "gwei")} gwei`);
  }

  const signers = await hre.ethers.getSigners();
  console.log(`\nsigners loaded  ${signers.length}`);

  if (signers.length === 0) {
    throw new Error(
      "No signer loaded. Check DEPLOYER_PRIVATE_KEY in ../.env — a private key is "
      + "32 bytes (66 characters with the 0x prefix), not the 42-character address.",
    );
  }

  const labels = ["deployer", "oracle operator"];
  let deployerBalance = 0n;

  for (const [i, signer] of signers.entries()) {
    const balance = await hre.ethers.provider.getBalance(signer.address);
    if (i === 0) deployerBalance = balance;
    console.log(
      `  ${(labels[i] ?? `signer ${i}`).padEnd(15)} ${signer.address}  `
      + `${hre.ethers.formatEther(balance)} ETH`,
    );
  }

  console.log();

  if (signers.length < 2) {
    console.warn(
      "ORACLE_PRIVATE_KEY did not load, so the deployment would fall back to using\n"
      + "the deployer as the oracle operator. That collapses the separation of duties\n"
      + "Section 3.15.2 claims. Correct it before deploying.",
    );
  } else if (signers[0].address === signers[1].address) {
    console.warn(
      "Both keys derive the same address. The owner and the oracle operator must be\n"
      + "distinct accounts (Section 3.15.2).",
    );
  }

  const minimum = hre.ethers.parseEther(String(SUGGESTED_MINIMUM_ETH));
  if (deployerBalance === 0n) {
    console.warn(
      `The deployer holds no ETH. Fund ${signers[0].address} from a Sepolia faucet\n`
      + "(https://sepoliafaucet.com or https://www.alchemy.com/faucets/ethereum-sepolia)\n"
      + "before deploying.",
    );
  } else if (deployerBalance < minimum) {
    console.warn(
      `The deployer holds less than the suggested ${SUGGESTED_MINIMUM_ETH} ETH. The two `
      + "deployments\nplus the lifecycle transactions may run out of funds partway through.",
    );
  } else {
    console.log("Ready to deploy:  npx hardhat run scripts/deploy.js --network sepolia");
  }
}

main().catch((error) => {
  console.error(`\n${error.message ?? error}`);
  process.exitCode = 1;
});
