const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const HOUR = 3600;
const DAY = 24 * HOUR;

const THRESHOLD = 75;          // Section 3.11.3
const TIME_LOCK = 48 * HOUR;   // Section 3.11.1
const HOLDING = 7 * DAY;       // FR-06

const MODEL_VERSION = ethers.encodeBytes32String("rf-paysim-v1.0.0");

/** Far-future expiry, so a test is never flaky because it ran slowly. */
async function farExpiry() {
  return (await time.latest()) + 365 * DAY;
}

/**
 * Deploys both contracts and returns the fixture every test builds on.
 * Nonces are per-test counters so an escrow id is never accidentally reused.
 */
async function deployFixture() {
  const [owner, oracleOperator, buyer, seller, arbitrator, outsider] = await ethers.getSigners();

  const Oracle = await ethers.getContractFactory("RiskOracleContract");
  const oracle = await Oracle.deploy(oracleOperator.address);
  await oracle.waitForDeployment();

  const Escrow = await ethers.getContractFactory("EscrowContract");
  const escrow = await Escrow.deploy(await oracle.getAddress(), THRESHOLD, TIME_LOCK, HOLDING);
  await escrow.waitForDeployment();

  return { oracle, escrow, owner, oracleOperator, buyer, seller, arbitrator, outsider };
}

let nonceCounter = 0;
const nextNonce = () => ++nonceCounter;

/**
 * Walks an escrow through scoring and deposit, the way the oracle bridge will:
 * compute the id, write the score, then fund.
 */
async function scoreAndDeposit(ctx, { score = 12, amount = "1.0", nonce = nextNonce() } = {}) {
  const { oracle, escrow, oracleOperator, buyer, seller, arbitrator } = ctx;
  const value = ethers.parseEther(amount);
  const escrowId = await escrow.computeEscrowId(buyer.address, seller.address, value, nonce);

  await oracle
    .connect(oracleOperator)
    .updateRiskScore(escrowId, score, MODEL_VERSION, nonce, await farExpiry());

  const tx = await escrow
    .connect(buyer)
    .depositFunds(seller.address, arbitrator.address, nonce, { value });

  return { escrowId, value, nonce, tx };
}

/** Scores an escrow without funding it, for gate-rejection tests. */
async function scoreOnly(ctx, { score, amount = "1.0", nonce = nextNonce() } = {}) {
  const { oracle, escrow, oracleOperator, buyer, seller } = ctx;
  const value = ethers.parseEther(amount);
  const escrowId = await escrow.computeEscrowId(buyer.address, seller.address, value, nonce);
  await oracle
    .connect(oracleOperator)
    .updateRiskScore(escrowId, score, MODEL_VERSION, nonce, await farExpiry());
  return { escrowId, value, nonce };
}

const State = { INITIATED: 0n, DELIVERED: 1n, DISPUTED: 2n, COMPLETED: 3n };
const Outcome = {
  NONE: 0n,
  RELEASED_TO_SELLER: 1n,
  RESOLVED_FOR_SELLER: 2n,
  RESOLVED_FOR_BUYER: 3n,
  TIMEOUT_REFUND: 4n,
};

module.exports = {
  HOUR, DAY, THRESHOLD, TIME_LOCK, HOLDING, MODEL_VERSION,
  deployFixture, scoreAndDeposit, scoreOnly, nextNonce, farExpiry,
  State, Outcome,
};
