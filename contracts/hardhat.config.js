require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config({ path: "../.env" });

const { SEPOLIA_RPC_URL, DEPLOYER_PRIVATE_KEY, ORACLE_PRIVATE_KEY, ETHERSCAN_API_KEY } = process.env;

/**
 * Keeps a malformed key out of the network config.
 *
 * Hardhat validates `networks.sepolia.accounts` when the config loads, for
 * every command — so one bad key makes `hardhat test` and `hardhat compile`
 * fail too, with an error about Sepolia that has nothing to do with what was
 * asked. Local work must not depend on deployment credentials being present
 * and correct.
 *
 * The usual mistake is pasting the account *address* rather than its private
 * key: MetaMask shows the address at the top of the account view, while the
 * key is behind Account details -> Show private key. An address is 20 bytes
 * (42 characters with the 0x prefix); a private key is 32 (66 characters).
 */
function usableKey(value, label) {
  if (!value) return null;

  const trimmed = value.trim();
  const hex = trimmed.startsWith("0x") ? trimmed.slice(2) : trimmed;

  if (/^[0-9a-fA-F]{64}$/.test(hex)) {
    return `0x${hex}`;
  }

  if (/^[0-9a-fA-F]{40}$/.test(hex)) {
    console.warn(
      `\n  ${label} looks like an account ADDRESS (20 bytes), not a private `
      + `key (32 bytes).\n  In MetaMask: Account details -> Show private key. `
      + `See docs/SETUP-KEYS.md.\n  Sepolia is unavailable until this is `
      + `corrected; local networks still work.\n`,
    );
    return null;
  }

  console.warn(
    `\n  ${label} is not a 32-byte hex private key (got ${hex.length} hex `
    + `characters, expected 64).\n  Sepolia is unavailable until this is `
    + `corrected; local networks still work.\n`,
  );
  return null;
}

const sepoliaAccounts = [
  usableKey(DEPLOYER_PRIVATE_KEY, "DEPLOYER_PRIVATE_KEY"),
  usableKey(ORACLE_PRIVATE_KEY, "ORACLE_PRIVATE_KEY"),
].filter(Boolean);

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
      accounts: sepoliaAccounts,
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
