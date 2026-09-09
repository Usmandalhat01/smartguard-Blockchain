/**
 * Deploys both contracts and writes the identifiers Appendix A records as
 * missing: addresses, deployment transaction hashes, block numbers, compiler
 * version, chain id and the repository commit.
 *
 * The output file is the deployment evidence. It is committed to the repository
 * so a claim of public verification can be checked against it, rather than
 * being transcribed by hand into the report and possibly mistyped.
 *
 *   npx hardhat run scripts/deploy.js --network sepolia
 */

const { execSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const hre = require("hardhat");

/** Configuration the report specifies. Section 3.11.3 and Section 3.11.1. */
const RISK_THRESHOLD = 75;
const TIME_LOCK_SECONDS = 48 * 60 * 60;
const HOLDING_PERIOD_SECONDS = 7 * 24 * 60 * 60;

function gitCommit() {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

function gitDirty() {
  try {
    return execSync("git status --porcelain", { encoding: "utf8" }).trim().length > 0;
  } catch {
    return null;
  }
}

async function main() {
  const network = hre.network.name;
  const { chainId } = await hre.ethers.provider.getNetwork();
  const signers = await hre.ethers.getSigners();

  if (signers.length === 0) {
    throw new Error(
      "No signer available. Set DEPLOYER_PRIVATE_KEY and SEPOLIA_RPC_URL in ../.env",
    );
  }

  const deployer = signers[0];
  // A separate operator key keeps the relay's compromise from being the
  // owner's compromise (Section 3.15.2). Falls back to the deployer locally.
  const oracleOperator = signers[1] ?? deployer;

  const balance = await hre.ethers.provider.getBalance(deployer.address);

  console.log(`network        ${network} (chainId ${chainId})`);
  console.log(`deployer       ${deployer.address}`);
  console.log(`oracle op      ${oracleOperator.address}`);
  console.log(`balance        ${hre.ethers.formatEther(balance)} ETH`);

  if (balance === 0n) {
    throw new Error("Deployer has no ETH. Fund it from a Sepolia faucet first.");
  }

  console.log("\ndeploying RiskOracleContract…");
  const Oracle = await hre.ethers.getContractFactory("RiskOracleContract");
  const oracle = await Oracle.deploy(oracleOperator.address);
  await oracle.waitForDeployment();
  const oracleTx = oracle.deploymentTransaction();
  const oracleReceipt = await oracleTx.wait();
  const oracleAddress = await oracle.getAddress();
  console.log(`  address      ${oracleAddress}`);
  console.log(`  tx           ${oracleTx.hash}`);

  console.log("\ndeploying EscrowContract…");
  const Escrow = await hre.ethers.getContractFactory("EscrowContract");
  const escrow = await Escrow.deploy(
    oracleAddress, RISK_THRESHOLD, TIME_LOCK_SECONDS, HOLDING_PERIOD_SECONDS,
  );
  await escrow.waitForDeployment();
  const escrowTx = escrow.deploymentTransaction();
  const escrowReceipt = await escrowTx.wait();
  const escrowAddress = await escrow.getAddress();
  console.log(`  address      ${escrowAddress}`);
  console.log(`  tx           ${escrowTx.hash}`);

  const record = {
    recordedAt: new Date().toISOString(),
    network,
    chainId: Number(chainId),
    compiler: {
      solc: hre.config.solidity.compilers[0].version,
      optimizer: hre.config.solidity.compilers[0].settings.optimizer,
      evmVersion: hre.config.solidity.compilers[0].settings.evmVersion ?? "default",
    },
    repository: {
      commit: gitCommit(),
      // A dirty tree means the deployed bytecode may not match any commit,
      // which would make the record unverifiable. Recorded, not hidden.
      dirtyWorkingTree: gitDirty(),
    },
    accounts: {
      deployer: deployer.address,
      oracleOperator: oracleOperator.address,
    },
    configuration: {
      riskThreshold: RISK_THRESHOLD,
      timeLockSeconds: TIME_LOCK_SECONDS,
      holdingPeriodSeconds: HOLDING_PERIOD_SECONDS,
    },
    contracts: {
      RiskOracleContract: {
        address: oracleAddress,
        deploymentTx: oracleTx.hash,
        blockNumber: oracleReceipt.blockNumber,
        gasUsed: oracleReceipt.gasUsed.toString(),
      },
      EscrowContract: {
        address: escrowAddress,
        deploymentTx: escrowTx.hash,
        blockNumber: escrowReceipt.blockNumber,
        gasUsed: escrowReceipt.gasUsed.toString(),
      },
    },
    explorer:
      Number(chainId) === 11155111
        ? {
            RiskOracleContract: `https://sepolia.etherscan.io/address/${oracleAddress}`,
            EscrowContract: `https://sepolia.etherscan.io/address/${escrowAddress}`,
          }
        : null,
  };

  const outDir = path.resolve(__dirname, "../../docs/evidence");
  fs.mkdirSync(outDir, { recursive: true });

  const outPath = path.join(outDir, `deployment.${network}.json`);
  fs.writeFileSync(outPath, `${JSON.stringify(record, null, 2)}\n`);
  console.log(`\nrecorded to    ${path.relative(process.cwd(), outPath)}`);

  if (record.repository.dirtyWorkingTree) {
    console.warn(
      "\nWARNING: the working tree was dirty at deployment. The deployed bytecode\n" +
      "         may not correspond to commit " + record.repository.commit + ".\n" +
      "         Commit first, then redeploy, before citing this record.",
    );
  }

  if (Number(chainId) === 11155111) {
    console.log("\nVerify on Etherscan with:");
    console.log(`  npx hardhat verify --network sepolia ${oracleAddress} ${oracleOperator.address}`);
    console.log(
      `  npx hardhat verify --network sepolia ${escrowAddress} ` +
      `${oracleAddress} ${RISK_THRESHOLD} ${TIME_LOCK_SECONDS} ${HOLDING_PERIOD_SECONDS}`,
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
