const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");
const { deployFixture, MODEL_VERSION, farExpiry, DAY } = require("./helpers");

/**
 * Section 3.14.2 and the production controls listed in Section 3.15.2.
 *
 * Every control is tested by its rejection, not by its happy path. A control
 * that has only been observed permitting the correct call has not been shown to
 * refuse the incorrect one.
 */
describe("RiskOracleContract", function () {
  const ID = ethers.encodeBytes32String("escrow-1");

  describe("deployment", function () {
    it("records the operator and emits the change", async function () {
      const { oracle, oracleOperator } = await loadFixture(deployFixture);
      expect(await oracle.oracleOperator()).to.equal(oracleOperator.address);
    });

    it("refuses a zero-address operator", async function () {
      const Oracle = await ethers.getContractFactory("RiskOracleContract");
      await expect(Oracle.deploy(ethers.ZeroAddress)).to.be.revertedWithCustomError(
        Oracle, "ZeroAddress",
      );
    });
  });

  describe("updateRiskScore", function () {
    it("records a score and emits it with the model version", async function () {
      const { oracle, oracleOperator } = await loadFixture(deployFixture);
      const expiry = await farExpiry();

      await expect(oracle.connect(oracleOperator).updateRiskScore(ID, 42, MODEL_VERSION, 1, expiry))
        .to.emit(oracle, "RiskScoreRecorded")
        .withArgs(ID, 42, MODEL_VERSION, 1, oracleOperator.address, anyUint());

      expect(await oracle.getRiskScore(ID)).to.equal(42);
      expect(await oracle.hasScore(ID)).to.equal(true);
    });

    it("accepts the boundary values 0 and 100", async function () {
      const { oracle, oracleOperator } = await loadFixture(deployFixture);
      const expiry = await farExpiry();
      const idLow = ethers.encodeBytes32String("low");
      const idHigh = ethers.encodeBytes32String("high");

      await oracle.connect(oracleOperator).updateRiskScore(idLow, 0, MODEL_VERSION, 1, expiry);
      await oracle.connect(oracleOperator).updateRiskScore(idHigh, 100, MODEL_VERSION, 2, expiry);

      expect(await oracle.getRiskScore(idLow)).to.equal(0);
      expect(await oracle.getRiskScore(idHigh)).to.equal(100);
    });

    it("rejects a caller that is not the operator", async function () {
      const { oracle, outsider } = await loadFixture(deployFixture);
      await expect(
        oracle.connect(outsider).updateRiskScore(ID, 10, MODEL_VERSION, 1, await farExpiry()),
      )
        .to.be.revertedWithCustomError(oracle, "NotOracleOperator")
        .withArgs(outsider.address);
    });

    it("rejects a score above 100", async function () {
      const { oracle, oracleOperator } = await loadFixture(deployFixture);
      await expect(
        oracle.connect(oracleOperator).updateRiskScore(ID, 101, MODEL_VERSION, 1, await farExpiry()),
      )
        .to.be.revertedWithCustomError(oracle, "ScoreOutOfRange")
        .withArgs(101);
    });

    it("rejects a second write for the same escrow", async function () {
      const { oracle, oracleOperator } = await loadFixture(deployFixture);
      const expiry = await farExpiry();
      await oracle.connect(oracleOperator).updateRiskScore(ID, 30, MODEL_VERSION, 1, expiry);

      await expect(
        oracle.connect(oracleOperator).updateRiskScore(ID, 5, MODEL_VERSION, 2, expiry),
      )
        .to.be.revertedWithCustomError(oracle, "ScoreAlreadyRecorded")
        .withArgs(ID);
    });

    it("rejects a replayed nonce", async function () {
      const { oracle, oracleOperator } = await loadFixture(deployFixture);
      const expiry = await farExpiry();
      await oracle.connect(oracleOperator).updateRiskScore(ID, 30, MODEL_VERSION, 5, expiry);

      const other = ethers.encodeBytes32String("escrow-2");
      await expect(
        oracle.connect(oracleOperator).updateRiskScore(other, 30, MODEL_VERSION, 5, expiry),
      )
        .to.be.revertedWithCustomError(oracle, "NonceNotIncreasing")
        .withArgs(5, 5);
    });

    it("rejects a nonce that goes backwards", async function () {
      const { oracle, oracleOperator } = await loadFixture(deployFixture);
      const expiry = await farExpiry();
      await oracle.connect(oracleOperator).updateRiskScore(ID, 30, MODEL_VERSION, 9, expiry);

      const other = ethers.encodeBytes32String("escrow-2");
      await expect(
        oracle.connect(oracleOperator).updateRiskScore(other, 30, MODEL_VERSION, 4, expiry),
      ).to.be.revertedWithCustomError(oracle, "NonceNotIncreasing");
    });

    it("rejects an expired assessment", async function () {
      const { oracle, oracleOperator } = await loadFixture(deployFixture);
      const past = (await time.latest()) - 60;

      await expect(
        oracle.connect(oracleOperator).updateRiskScore(ID, 30, MODEL_VERSION, 1, past),
      ).to.be.revertedWithCustomError(oracle, "AssessmentExpired");
    });

    it("accepts an assessment right up to its expiry", async function () {
      const { oracle, oracleOperator } = await loadFixture(deployFixture);
      const expiry = (await time.latest()) + 100;
      await time.setNextBlockTimestamp(expiry);

      await expect(
        oracle.connect(oracleOperator).updateRiskScore(ID, 30, MODEL_VERSION, 1, expiry),
      ).to.emit(oracle, "RiskScoreRecorded");
    });
  });

  describe("reads", function () {
    it("reverts rather than returning a default for an unscored escrow", async function () {
      const { oracle } = await loadFixture(deployFixture);
      await expect(oracle.getRiskScore(ID))
        .to.be.revertedWithCustomError(oracle, "NoScoreRecorded")
        .withArgs(ID);
      expect(await oracle.hasScore(ID)).to.equal(false);
    });

    it("returns the full assessment record", async function () {
      const { oracle, oracleOperator } = await loadFixture(deployFixture);
      await oracle.connect(oracleOperator).updateRiskScore(ID, 61, MODEL_VERSION, 1, await farExpiry());

      const [score, version, recordedAt] = await oracle.getAssessment(ID);
      expect(score).to.equal(61);
      expect(version).to.equal(MODEL_VERSION);
      expect(recordedAt).to.be.greaterThan(0);
    });
  });

  describe("key rotation", function () {
    it("lets the owner rotate the operator", async function () {
      const { oracle, owner, oracleOperator, outsider } = await loadFixture(deployFixture);

      await expect(oracle.connect(owner).setOracleOperator(outsider.address))
        .to.emit(oracle, "OracleOperatorChanged")
        .withArgs(oracleOperator.address, outsider.address);

      expect(await oracle.oracleOperator()).to.equal(outsider.address);
    });

    it("revokes the previous operator in the same transaction", async function () {
      const { oracle, owner, oracleOperator, outsider } = await loadFixture(deployFixture);
      await oracle.connect(owner).setOracleOperator(outsider.address);

      await expect(
        oracle.connect(oracleOperator).updateRiskScore(ID, 10, MODEL_VERSION, 1, await farExpiry()),
      ).to.be.revertedWithCustomError(oracle, "NotOracleOperator");

      await expect(
        oracle.connect(outsider).updateRiskScore(ID, 10, MODEL_VERSION, 1, await farExpiry()),
      ).to.emit(oracle, "RiskScoreRecorded");
    });

    it("refuses rotation by anyone but the owner", async function () {
      const { oracle, outsider } = await loadFixture(deployFixture);
      await expect(
        oracle.connect(outsider).setOracleOperator(outsider.address),
      ).to.be.revertedWithCustomError(oracle, "OwnableUnauthorizedAccount");
    });

    it("refuses rotation to the zero address", async function () {
      const { oracle, owner } = await loadFixture(deployFixture);
      await expect(
        oracle.connect(owner).setOracleOperator(ethers.ZeroAddress),
      ).to.be.revertedWithCustomError(oracle, "ZeroAddress");
    });
  });
});

/** Matcher for a block timestamp we do not want to pin exactly. */
function anyUint() {
  return require("@nomicfoundation/hardhat-chai-matchers/withArgs").anyValue;
}
