const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");
const {
  deployFixture, scoreAndDeposit, scoreOnly, nextNonce, farExpiry,
  MODEL_VERSION, THRESHOLD, TIME_LOCK, HOLDING, State, Outcome,
} = require("./helpers");

describe("EscrowContract", function () {
  /* ==================================================== FR-01 / FR-02 === */

  describe("depositFunds — the risk gate", function () {
    it("accepts a deposit when the score is within the gate", async function () {
      const ctx = await loadFixture(deployFixture);
      const { escrowId, value, tx } = await scoreAndDeposit(ctx, { score: 12 });

      await expect(tx)
        .to.emit(ctx.escrow, "FundsDeposited")
        .withArgs(
          escrowId, ctx.buyer.address, ctx.seller.address, ctx.arbitrator.address,
          value, 12, THRESHOLD, anyValue(),
        );

      const escrow = await ctx.escrow.getEscrow(escrowId);
      expect(escrow.state).to.equal(State.INITIATED);
      expect(escrow.amount).to.equal(value);
      expect(escrow.riskScoreAtDeposit).to.equal(12);
    });

    it("accepts a score exactly at the gate", async function () {
      const ctx = await loadFixture(deployFixture);
      const { escrowId } = await scoreAndDeposit(ctx, { score: THRESHOLD });
      const escrow = await ctx.escrow.getEscrow(escrowId);
      expect(escrow.riskScoreAtDeposit).to.equal(THRESHOLD);
    });

    it("refuses a score one above the gate", async function () {
      const ctx = await loadFixture(deployFixture);
      const nonce = nextNonce();
      await scoreOnly(ctx, { score: THRESHOLD + 1, nonce });

      await expect(
        ctx.escrow.connect(ctx.buyer).depositFunds(
          ctx.seller.address, ctx.arbitrator.address, nonce,
          { value: ethers.parseEther("1.0") },
        ),
      )
        .to.be.revertedWithCustomError(ctx.escrow, "RiskAssessmentRejected")
        .withArgs(THRESHOLD + 1, THRESHOLD);
    });

    it("holds no funds after a refused deposit", async function () {
      const ctx = await loadFixture(deployFixture);
      const nonce = nextNonce();
      await scoreOnly(ctx, { score: 99, nonce });

      await expect(
        ctx.escrow.connect(ctx.buyer).depositFunds(
          ctx.seller.address, ctx.arbitrator.address, nonce,
          { value: ethers.parseEther("1.0") },
        ),
      ).to.be.reverted;

      expect(await ethers.provider.getBalance(await ctx.escrow.getAddress())).to.equal(0);
    });

    it("fails closed when no assessment exists", async function () {
      const ctx = await loadFixture(deployFixture);
      await expect(
        ctx.escrow.connect(ctx.buyer).depositFunds(
          ctx.seller.address, ctx.arbitrator.address, nextNonce(),
          { value: ethers.parseEther("1.0") },
        ),
      ).to.be.revertedWithCustomError(ctx.escrow, "NoRiskAssessment");
    });

    it("cannot be bypassed by scoring a different amount", async function () {
      // The id binds the amount, so a score obtained for 0.1 ETH does not admit
      // a 10 ETH deposit — the derived id simply has no assessment.
      const ctx = await loadFixture(deployFixture);
      const nonce = nextNonce();
      await scoreOnly(ctx, { score: 5, amount: "0.1", nonce });

      await expect(
        ctx.escrow.connect(ctx.buyer).depositFunds(
          ctx.seller.address, ctx.arbitrator.address, nonce,
          { value: ethers.parseEther("10.0") },
        ),
      ).to.be.revertedWithCustomError(ctx.escrow, "NoRiskAssessment");
    });

    it("rejects a zero-value deposit", async function () {
      const ctx = await loadFixture(deployFixture);
      await expect(
        ctx.escrow.connect(ctx.buyer).depositFunds(
          ctx.seller.address, ctx.arbitrator.address, nextNonce(), { value: 0 },
        ),
      ).to.be.revertedWithCustomError(ctx.escrow, "ZeroAmount");
    });

    it("rejects a buyer who is also the seller", async function () {
      const ctx = await loadFixture(deployFixture);
      await expect(
        ctx.escrow.connect(ctx.buyer).depositFunds(
          ctx.buyer.address, ctx.arbitrator.address, nextNonce(),
          { value: ethers.parseEther("1.0") },
        ),
      ).to.be.revertedWithCustomError(ctx.escrow, "SameParty");
    });

    it("rejects an arbitrator who is also a party", async function () {
      const ctx = await loadFixture(deployFixture);
      await expect(
        ctx.escrow.connect(ctx.buyer).depositFunds(
          ctx.seller.address, ctx.seller.address, nextNonce(),
          { value: ethers.parseEther("1.0") },
        ),
      ).to.be.revertedWithCustomError(ctx.escrow, "SameParty");
    });

    it("rejects a duplicate escrow id", async function () {
      const ctx = await loadFixture(deployFixture);
      const nonce = nextNonce();
      await scoreAndDeposit(ctx, { score: 10, nonce });

      await expect(
        ctx.escrow.connect(ctx.buyer).depositFunds(
          ctx.seller.address, ctx.arbitrator.address, nonce,
          { value: ethers.parseEther("1.0") },
        ),
      ).to.be.revertedWithCustomError(ctx.escrow, "EscrowAlreadyExists");
    });

    it("retains the threshold in force at deposit", async function () {
      const ctx = await loadFixture(deployFixture);
      const { escrowId } = await scoreAndDeposit(ctx, { score: 20 });

      await ctx.escrow.connect(ctx.owner).setRiskThreshold(10);

      const escrow = await ctx.escrow.getEscrow(escrowId);
      expect(escrow.thresholdAtDeposit).to.equal(THRESHOLD);
      expect(await ctx.escrow.riskThreshold()).to.equal(10);
    });
  });

  /* ================================================================ FR-03 */

  describe("confirmDelivery", function () {
    it("moves INITIATED to DELIVERED and starts the time lock", async function () {
      const ctx = await loadFixture(deployFixture);
      const { escrowId } = await scoreAndDeposit(ctx);

      await expect(ctx.escrow.connect(ctx.buyer).confirmDelivery(escrowId))
        .to.emit(ctx.escrow, "DeliveryConfirmed")
        .and.to.emit(ctx.escrow, "StateChanged")
        .withArgs(escrowId, State.INITIATED, State.DELIVERED, ctx.buyer.address, anyValue());

      const escrow = await ctx.escrow.getEscrow(escrowId);
      expect(escrow.state).to.equal(State.DELIVERED);
      expect(escrow.deliveryConfirmedAt).to.be.greaterThan(0);
    });

    it("refuses the seller", async function () {
      const ctx = await loadFixture(deployFixture);
      const { escrowId } = await scoreAndDeposit(ctx);
      await expect(ctx.escrow.connect(ctx.seller).confirmDelivery(escrowId))
        .to.be.revertedWithCustomError(ctx.escrow, "NotBuyer")
        .withArgs(ctx.seller.address);
    });

    it("refuses an unrelated address", async function () {
      const ctx = await loadFixture(deployFixture);
      const { escrowId } = await scoreAndDeposit(ctx);
      await expect(ctx.escrow.connect(ctx.outsider).confirmDelivery(escrowId))
        .to.be.revertedWithCustomError(ctx.escrow, "NotBuyer");
    });

    it("refuses a second confirmation", async function () {
      const ctx = await loadFixture(deployFixture);
      const { escrowId } = await scoreAndDeposit(ctx);
      await ctx.escrow.connect(ctx.buyer).confirmDelivery(escrowId);
      await expect(ctx.escrow.connect(ctx.buyer).confirmDelivery(escrowId))
        .to.be.revertedWithCustomError(ctx.escrow, "WrongState");
    });

    it("refuses an unknown escrow", async function () {
      const ctx = await loadFixture(deployFixture);
      await expect(
        ctx.escrow.connect(ctx.buyer).confirmDelivery(ethers.encodeBytes32String("nope")),
      ).to.be.revertedWithCustomError(ctx.escrow, "EscrowNotFound");
    });
  });

  describe("releaseFunds", function () {
    it("pays the seller once the time lock elapses", async function () {
      const ctx = await loadFixture(deployFixture);
      const { escrowId, value } = await scoreAndDeposit(ctx, { amount: "2.5" });
      await ctx.escrow.connect(ctx.buyer).confirmDelivery(escrowId);
      await time.increase(TIME_LOCK + 1);

      await expect(ctx.escrow.connect(ctx.seller).releaseFunds(escrowId))
        .to.changeEtherBalances([ctx.seller, ctx.escrow], [value, -value]);

      const escrow = await ctx.escrow.getEscrow(escrowId);
      expect(escrow.state).to.equal(State.COMPLETED);
      expect(escrow.outcome).to.equal(Outcome.RELEASED_TO_SELLER);
      expect(escrow.amount).to.equal(0);
    });

    it("refuses while the time lock is running", async function () {
      const ctx = await loadFixture(deployFixture);
      const { escrowId } = await scoreAndDeposit(ctx);
      await ctx.escrow.connect(ctx.buyer).confirmDelivery(escrowId);
      await time.increase(TIME_LOCK - 600);

      await expect(ctx.escrow.connect(ctx.seller).releaseFunds(escrowId))
        .to.be.revertedWithCustomError(ctx.escrow, "TimeLockActive");
    });

    it("refuses an address that is not a party", async function () {
      const ctx = await loadFixture(deployFixture);
      const { escrowId } = await scoreAndDeposit(ctx);
      await ctx.escrow.connect(ctx.buyer).confirmDelivery(escrowId);
      await time.increase(TIME_LOCK + 1);

      await expect(ctx.escrow.connect(ctx.outsider).releaseFunds(escrowId))
        .to.be.revertedWithCustomError(ctx.escrow, "NotParty");
    });

    it("sends to the recorded seller regardless of who calls it", async function () {
      const ctx = await loadFixture(deployFixture);
      const { escrowId, value } = await scoreAndDeposit(ctx);
      await ctx.escrow.connect(ctx.buyer).confirmDelivery(escrowId);
      await time.increase(TIME_LOCK + 1);

      await expect(ctx.escrow.connect(ctx.buyer).releaseFunds(escrowId))
        .to.changeEtherBalance(ctx.seller, value);
    });

    it("refuses from INITIATED", async function () {
      const ctx = await loadFixture(deployFixture);
      const { escrowId } = await scoreAndDeposit(ctx);
      await expect(ctx.escrow.connect(ctx.seller).releaseFunds(escrowId))
        .to.be.revertedWithCustomError(ctx.escrow, "WrongState");
    });
  });

  /* ================================================================ FR-04 */

  describe("initiateDispute", function () {
    it("lets the buyer dispute from DELIVERED", async function () {
      const ctx = await loadFixture(deployFixture);
      const { escrowId } = await scoreAndDeposit(ctx);
      await ctx.escrow.connect(ctx.buyer).confirmDelivery(escrowId);

      await expect(ctx.escrow.connect(ctx.buyer).initiateDispute(escrowId))
        .to.emit(ctx.escrow, "DisputeInitiated")
        .withArgs(escrowId, ctx.buyer.address, ctx.arbitrator.address, anyValue());

      expect((await ctx.escrow.getEscrow(escrowId)).state).to.equal(State.DISPUTED);
    });

    it("lets the seller dispute from INITIATED", async function () {
      const ctx = await loadFixture(deployFixture);
      const { escrowId } = await scoreAndDeposit(ctx);

      await expect(ctx.escrow.connect(ctx.seller).initiateDispute(escrowId))
        .to.emit(ctx.escrow, "DisputeInitiated");

      expect((await ctx.escrow.getEscrow(escrowId)).state).to.equal(State.DISPUTED);
    });

    it("refuses the arbitrator", async function () {
      // An arbitrator that could open the case it then decides is not neutral.
      const ctx = await loadFixture(deployFixture);
      const { escrowId } = await scoreAndDeposit(ctx);
      await expect(ctx.escrow.connect(ctx.arbitrator).initiateDispute(escrowId))
        .to.be.revertedWithCustomError(ctx.escrow, "NotParty");
    });

    it("refuses an unrelated address", async function () {
      const ctx = await loadFixture(deployFixture);
      const { escrowId } = await scoreAndDeposit(ctx);
      await expect(ctx.escrow.connect(ctx.outsider).initiateDispute(escrowId))
        .to.be.revertedWithCustomError(ctx.escrow, "NotParty");
    });

    it("freezes release once disputed", async function () {
      const ctx = await loadFixture(deployFixture);
      const { escrowId } = await scoreAndDeposit(ctx);
      await ctx.escrow.connect(ctx.buyer).confirmDelivery(escrowId);
      await ctx.escrow.connect(ctx.buyer).initiateDispute(escrowId);
      await time.increase(TIME_LOCK + 1);

      await expect(ctx.escrow.connect(ctx.seller).releaseFunds(escrowId))
        .to.be.revertedWithCustomError(ctx.escrow, "WrongState");
    });

    it("refuses a second dispute", async function () {
      const ctx = await loadFixture(deployFixture);
      const { escrowId } = await scoreAndDeposit(ctx);
      await ctx.escrow.connect(ctx.buyer).initiateDispute(escrowId);
      await expect(ctx.escrow.connect(ctx.seller).initiateDispute(escrowId))
        .to.be.revertedWithCustomError(ctx.escrow, "WrongState");
    });
  });

  /* ================================================================ FR-05 */

  describe("resolveDispute", function () {
    async function disputed() {
      const ctx = await loadFixture(deployFixture);
      const { escrowId, value } = await scoreAndDeposit(ctx, { amount: "3.0" });
      await ctx.escrow.connect(ctx.buyer).confirmDelivery(escrowId);
      await ctx.escrow.connect(ctx.buyer).initiateDispute(escrowId);
      return { ctx, escrowId, value };
    }

    it("releases to the seller on true", async function () {
      const { ctx, escrowId, value } = await disputed();

      await expect(ctx.escrow.connect(ctx.arbitrator).resolveDispute(escrowId, true))
        .to.changeEtherBalances([ctx.seller, ctx.escrow], [value, -value]);

      const escrow = await ctx.escrow.getEscrow(escrowId);
      expect(escrow.outcome).to.equal(Outcome.RESOLVED_FOR_SELLER);
      expect(escrow.state).to.equal(State.COMPLETED);
    });

    it("refunds the buyer on false", async function () {
      const { ctx, escrowId, value } = await disputed();

      await expect(ctx.escrow.connect(ctx.arbitrator).resolveDispute(escrowId, false))
        .to.changeEtherBalances([ctx.buyer, ctx.escrow], [value, -value]);

      expect((await ctx.escrow.getEscrow(escrowId)).outcome).to.equal(Outcome.RESOLVED_FOR_BUYER);
    });

    it("refuses the buyer", async function () {
      const { ctx, escrowId } = await disputed();
      await expect(ctx.escrow.connect(ctx.buyer).resolveDispute(escrowId, false))
        .to.be.revertedWithCustomError(ctx.escrow, "NotArbitrator")
        .withArgs(ctx.buyer.address);
    });

    it("refuses the seller", async function () {
      const { ctx, escrowId } = await disputed();
      await expect(ctx.escrow.connect(ctx.seller).resolveDispute(escrowId, true))
        .to.be.revertedWithCustomError(ctx.escrow, "NotArbitrator");
    });

    it("refuses the contract owner", async function () {
      // Administrative ownership must not extend to moving anyone's funds.
      const { ctx, escrowId } = await disputed();
      await expect(ctx.escrow.connect(ctx.owner).resolveDispute(escrowId, true))
        .to.be.revertedWithCustomError(ctx.escrow, "NotArbitrator");
    });

    it("refuses when the escrow is not disputed", async function () {
      const ctx = await loadFixture(deployFixture);
      const { escrowId } = await scoreAndDeposit(ctx);
      await expect(ctx.escrow.connect(ctx.arbitrator).resolveDispute(escrowId, true))
        .to.be.revertedWithCustomError(ctx.escrow, "WrongState");
    });

    it("refuses a second resolution", async function () {
      const { ctx, escrowId } = await disputed();
      await ctx.escrow.connect(ctx.arbitrator).resolveDispute(escrowId, true);
      await expect(ctx.escrow.connect(ctx.arbitrator).resolveDispute(escrowId, false))
        .to.be.revertedWithCustomError(ctx.escrow, "WrongState");
    });
  });

  /* ================================================================ FR-06 */

  describe("claimRefund", function () {
    it("refunds the buyer after the holding period", async function () {
      const ctx = await loadFixture(deployFixture);
      const { escrowId, value } = await scoreAndDeposit(ctx, { amount: "1.75" });
      await time.increase(HOLDING + 1);

      await expect(ctx.escrow.connect(ctx.buyer).claimRefund(escrowId))
        .to.changeEtherBalances([ctx.buyer, ctx.escrow], [value, -value]);

      const escrow = await ctx.escrow.getEscrow(escrowId);
      expect(escrow.outcome).to.equal(Outcome.TIMEOUT_REFUND);
      expect(escrow.state).to.equal(State.COMPLETED);
    });

    it("refuses before the holding period elapses", async function () {
      const ctx = await loadFixture(deployFixture);
      const { escrowId } = await scoreAndDeposit(ctx);
      await time.increase(HOLDING - 600);

      await expect(ctx.escrow.connect(ctx.buyer).claimRefund(escrowId))
        .to.be.revertedWithCustomError(ctx.escrow, "HoldingPeriodActive");
    });

    it("refuses the seller", async function () {
      const ctx = await loadFixture(deployFixture);
      const { escrowId } = await scoreAndDeposit(ctx);
      await time.increase(HOLDING + 1);
      await expect(ctx.escrow.connect(ctx.seller).claimRefund(escrowId))
        .to.be.revertedWithCustomError(ctx.escrow, "NotBuyer");
    });

    it("refuses once delivery has been confirmed", async function () {
      const ctx = await loadFixture(deployFixture);
      const { escrowId } = await scoreAndDeposit(ctx);
      await ctx.escrow.connect(ctx.buyer).confirmDelivery(escrowId);
      await time.increase(HOLDING + 1);

      await expect(ctx.escrow.connect(ctx.buyer).claimRefund(escrowId))
        .to.be.revertedWithCustomError(ctx.escrow, "WrongState");
    });
  });

  /* ============================================================ security */

  describe("security", function () {
    it("resists a reentrant seller", async function () {
      const ctx = await loadFixture(deployFixture);
      const Attacker = await ethers.getContractFactory("ReentrantSeller");
      const attacker = await Attacker.deploy(await ctx.escrow.getAddress());
      await attacker.waitForDeployment();

      const value = ethers.parseEther("1.0");
      const nonce = nextNonce();
      const attackerAddress = await attacker.getAddress();
      const escrowId = await ctx.escrow.computeEscrowId(ctx.buyer.address, attackerAddress, value, nonce);

      await ctx.oracle
        .connect(ctx.oracleOperator)
        .updateRiskScore(escrowId, 10, MODEL_VERSION, nonce, await farExpiry());

      await ctx.escrow
        .connect(ctx.buyer)
        .depositFunds(attackerAddress, ctx.arbitrator.address, nonce, { value });

      await attacker.setEscrowId(escrowId);
      await ctx.escrow.connect(ctx.buyer).confirmDelivery(escrowId);
      await time.increase(TIME_LOCK + 1);

      // The attacker re-enters on receive. The escrow is already COMPLETED with
      // a zero balance, so the nested call reverts and takes the transfer with
      // it — the contract keeps the funds rather than paying twice.
      await expect(ctx.escrow.connect(ctx.buyer).releaseFunds(escrowId)).to.be.reverted;
      expect(await ethers.provider.getBalance(await ctx.escrow.getAddress())).to.equal(value);
    });

    it("keeps escrows independent", async function () {
      const ctx = await loadFixture(deployFixture);
      const a = await scoreAndDeposit(ctx, { amount: "1.0" });
      const b = await scoreAndDeposit(ctx, { amount: "2.0" });

      await time.increase(HOLDING + 1);
      await ctx.escrow.connect(ctx.buyer).claimRefund(a.escrowId);

      const other = await ctx.escrow.getEscrow(b.escrowId);
      expect(other.state).to.equal(State.INITIATED);
      expect(other.amount).to.equal(b.value);
    });
  });

  /* ====================================================== administration */

  describe("administration", function () {
    it("lets the owner move the gate", async function () {
      const ctx = await loadFixture(deployFixture);
      await expect(ctx.escrow.connect(ctx.owner).setRiskThreshold(40))
        .to.emit(ctx.escrow, "RiskThresholdChanged")
        .withArgs(THRESHOLD, 40);
      expect(await ctx.escrow.riskThreshold()).to.equal(40);
    });

    it("applies a new gate to the next deposit", async function () {
      const ctx = await loadFixture(deployFixture);
      await ctx.escrow.connect(ctx.owner).setRiskThreshold(20);

      const nonce = nextNonce();
      await scoreOnly(ctx, { score: 30, nonce });
      await expect(
        ctx.escrow.connect(ctx.buyer).depositFunds(
          ctx.seller.address, ctx.arbitrator.address, nonce,
          { value: ethers.parseEther("1.0") },
        ),
      )
        .to.be.revertedWithCustomError(ctx.escrow, "RiskAssessmentRejected")
        .withArgs(30, 20);
    });

    it("refuses a gate above 100", async function () {
      const ctx = await loadFixture(deployFixture);
      await expect(ctx.escrow.connect(ctx.owner).setRiskThreshold(101))
        .to.be.revertedWithCustomError(ctx.escrow, "ThresholdOutOfRange");
    });

    it("refuses a gate change from anyone but the owner", async function () {
      const ctx = await loadFixture(deployFixture);
      await expect(ctx.escrow.connect(ctx.outsider).setRiskThreshold(10))
        .to.be.revertedWithCustomError(ctx.escrow, "OwnableUnauthorizedAccount");
    });

    it("refuses an oracle change from anyone but the owner", async function () {
      const ctx = await loadFixture(deployFixture);
      await expect(ctx.escrow.connect(ctx.outsider).setRiskOracle(ctx.outsider.address))
        .to.be.revertedWithCustomError(ctx.escrow, "OwnableUnauthorizedAccount");
    });
  });
});

function anyValue() {
  return require("@nomicfoundation/hardhat-chai-matchers/withArgs").anyValue;
}
