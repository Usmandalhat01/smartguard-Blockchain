require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config({ path: "../.env" });

const { SEPOLIA_RPC_URL, DEPLOYER_PRIVATE_KEY, ORACLE_PRIVATE_KEY, ETHERSCAN_API_KEY } = process.env;

/**
 * Solidity is pinned to 0.8.20.
 *
 * Table 3.3 names 0.8.19, but OpenZeppelin Contracts 5.0 — which the same table
 * requires — declares `pragma solidity ^0.8.20` and will not compile below it.
 * The two pins are mutually exclusive as written.
 *
 * 0.8.20 is the minimal resolution: Section 3.15.1's argument is that the 0.8.x
 * line provides native overflow and underflow protection in place of SafeMath,
 * and that holds unchanged at 0.8.20. See docs/DECISIONS.md, D-001.
 *
 * Do not float this pin further — the report cites the version.
 *
 * The optimizer is on at 200 runs, the conventional setting for contracts
 * called many times relative to deployment, which is the escrow's profile.
 */
module.exports = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      // Needed for the custom-error revert data the tests assert on.
      viaIR: false,
    },
  },

  networks: {
    hardhat: {
      chainId: 31337,
    },
    sepolia: {
      url: SEPOLIA_RPC_URL || "",
      accounts: [DEPLOYER_PRIVATE_KEY, ORACLE_PRIVATE_KEY].filter(Boolean),
      chainId: 11155111,
    },
  },

  etherscan: {
    apiKey: ETHERSCAN_API_KEY || "",
  },

  /**
   * Gas measurement for Table 4.2. The review found the original figures had no
   * execution receipts and no variability statistics, so the reporter is
   * configured to write a machine-readable record on every test run rather than
   * printing to the console and vanishing.
   */
  gasReporter: {
    enabled: process.env.REPORT_GAS !== "false",
    currency: "USD",
    outputFile: "../docs/evidence/gas-report.txt",
    noColors: true,
    excludeContracts: [],
  },

  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },

  mocha: {
    timeout: 60000,
  },
};
