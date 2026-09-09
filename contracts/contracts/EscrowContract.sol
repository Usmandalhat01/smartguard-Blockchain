// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {IRiskOracle} from "./IRiskOracle.sol";

/**
 * @title EscrowContract
 * @notice Holds funds for a bilateral escrow and releases them only under the
 *         conditions encoded here, with a machine-learning risk score as a
 *         precondition of accepting the deposit at all.
 *
 * @dev Implements the four-state machine of Section 3.11.1 and the five entry
 *      points of Section 3.11.3.
 *
 *          INITIATED --confirmDelivery--> DELIVERED --release--> COMPLETED
 *              |                              |
 *              |                        initiateDispute
 *              |                              v
 *              +------initiateDispute---> DISPUTED --resolve--> COMPLETED
 *              |
 *              +------claimRefund---------------------------> COMPLETED
 *
 *      The risk gate is enforced in depositFunds rather than in the interface.
 *      A caller who submits directly to this contract, bypassing the front end
 *      entirely, still reads the same score from the same oracle and is still
 *      refused. That is the property the whole architecture exists to provide:
 *      the AI assessment is a contractual precondition, not a suggestion.
 *
 *      Escrow identifiers are derived deterministically off chain from the
 *      parties, the amount and a nonce, so the oracle can write a score against
 *      an id before any funds move (Figure 3.7).
 */
contract EscrowContract is Ownable, ReentrancyGuard {
    using Address for address payable;

    /// @dev Ordinal order is load-bearing: the event listener decodes the raw
    ///      uint8 and indexes into the same sequence off chain.
    enum State {
        INITIATED,
        DELIVERED,
        DISPUTED,
        COMPLETED
    }

    enum Outcome {
        NONE,
        RELEASED_TO_SELLER,
        RESOLVED_FOR_SELLER,
        RESOLVED_FOR_BUYER,
        TIMEOUT_REFUND
    }

    struct Escrow {
        address payable buyer;
        address payable seller;
        address arbitrator;
        uint256 amount;
        State state;
        Outcome outcome;
        /// @dev Score at deposit, retained so the decision stays interpretable
        ///      after an administrator changes the threshold (Section 3.9.2).
        uint8 riskScoreAtDeposit;
        uint8 thresholdAtDeposit;
        uint64 createdAt;
        uint64 deliveryConfirmedAt;
        uint64 holdingPeriodEndsAt;
        bool exists;
    }

    /// @notice Risk gate. A score strictly above this refuses the deposit.
    /// @dev 75 corresponds to P(fraud) = 0.75. Section 4.3.6 records this as a
    ///      prototype configuration value rather than a validated optimum.
    uint8 public riskThreshold;

    /// @notice Dispute window after delivery confirmation. 48h per Section 3.11.1.
    uint64 public timeLockSeconds;

    /// @notice How long an escrow may sit in INITIATED before the buyer may
    ///         reclaim the funds (FR-06).
    uint64 public holdingPeriodSeconds;

    IRiskOracle public riskOracle;

    mapping(bytes32 => Escrow) private _escrows;

    event FundsDeposited(
        bytes32 indexed escrowId,
        address indexed buyer,
        address indexed seller,
        address arbitrator,
        uint256 amount,
        uint8 riskScore,
        uint8 threshold,
        uint256 timestamp
    );

    event DeliveryConfirmed(
        bytes32 indexed escrowId,
        address indexed buyer,
        uint64 timeLockEndsAt,
        uint256 timestamp
    );

    event DisputeInitiated(
        bytes32 indexed escrowId,
        address indexed raisedBy,
        address indexed arbitrator,
        uint256 timestamp
    );

    event DisputeResolved(
        bytes32 indexed escrowId,
        address indexed arbitrator,
        bool releasedToSeller,
        uint256 amount,
        uint256 timestamp
    );

    event FundsReleased(
        bytes32 indexed escrowId,
        address indexed recipient,
        uint256 amount,
        Outcome outcome,
        uint256 timestamp
    );

    event StateChanged(
        bytes32 indexed escrowId,
        State previous,
        State next,
        address indexed actor,
        uint256 timestamp
    );

    event RiskThresholdChanged(uint8 previous, uint8 next);
    event RiskOracleChanged(address indexed previous, address indexed next);
    event TimingChanged(uint64 timeLockSeconds, uint64 holdingPeriodSeconds);

    error RiskAssessmentRejected(uint8 score, uint8 threshold);
    error NoRiskAssessment(bytes32 escrowId);
    error EscrowAlreadyExists(bytes32 escrowId);
    error EscrowNotFound(bytes32 escrowId);
    error WrongState(State actual, State required);
    error NotBuyer(address caller);
    error NotArbitrator(address caller);
    error NotParty(address caller);
    error ZeroAmount();
    error ZeroAddress();
    error SameParty();
    error TimeLockActive(uint64 endsAt, uint256 blockTime);
    error HoldingPeriodActive(uint64 endsAt, uint256 blockTime);
    error ThresholdOutOfRange(uint8 threshold);

    constructor(
        address oracle,
        uint8 threshold,
        uint64 timeLock,
        uint64 holdingPeriod
    ) Ownable(msg.sender) {
        if (oracle == address(0)) revert ZeroAddress();
        if (threshold > 100) revert ThresholdOutOfRange(threshold);

        riskOracle = IRiskOracle(oracle);
        riskThreshold = threshold;
        timeLockSeconds = timeLock;
        holdingPeriodSeconds = holdingPeriod;

        emit RiskOracleChanged(address(0), oracle);
        emit RiskThresholdChanged(0, threshold);
        emit TimingChanged(timeLock, holdingPeriod);
    }

    /* ---------------------------------------------------------- helpers -- */

    /// @notice Derives the escrow identifier the oracle scores against.
    /// @dev Pure, so the bridge and the interface can compute it independently
    ///      and arrive at the same value without a round trip.
    function computeEscrowId(
        address buyer,
        address seller,
        uint256 amount,
        uint256 nonce
    ) public pure returns (bytes32) {
        return keccak256(abi.encode(buyer, seller, amount, nonce));
    }

    function getEscrow(bytes32 escrowId) external view returns (Escrow memory) {
        Escrow storage escrow = _escrows[escrowId];
        if (!escrow.exists) revert EscrowNotFound(escrowId);
        return escrow;
    }

    function _requireState(Escrow storage escrow, State required) private view {
        if (escrow.state != required) revert WrongState(escrow.state, required);
    }

    function _transition(bytes32 escrowId, Escrow storage escrow, State next) private {
        State previous = escrow.state;
        escrow.state = next;
        emit StateChanged(escrowId, previous, next, msg.sender, block.timestamp);
    }

    /* ------------------------------------------------------------ FR-01 -- */

    /**
     * @notice Locks the buyer's funds, subject to the AI risk gate.
     * @dev FR-01 and FR-02. The oracle is read before any state is written, so
     *      a refused escrow costs the buyer nothing but the failed call.
     */
    function depositFunds(
        address payable seller,
        address arbitrator,
        uint256 nonce
    ) external payable nonReentrant returns (bytes32 escrowId) {
        if (msg.value == 0) revert ZeroAmount();
        if (seller == address(0) || arbitrator == address(0)) revert ZeroAddress();
        if (seller == msg.sender || arbitrator == msg.sender || arbitrator == seller) {
            revert SameParty();
        }

        escrowId = computeEscrowId(msg.sender, seller, msg.value, nonce);
        if (_escrows[escrowId].exists) revert EscrowAlreadyExists(escrowId);

        // The gate. A missing score is a refusal, not a pass — the system fails
        // closed when the intelligence layer has not spoken (Section 3.15.2).
        if (!riskOracle.hasScore(escrowId)) revert NoRiskAssessment(escrowId);
        uint8 score = riskOracle.getRiskScore(escrowId);
        if (score > riskThreshold) revert RiskAssessmentRejected(score, riskThreshold);

        uint64 nowTs = uint64(block.timestamp);

        _escrows[escrowId] = Escrow({
            buyer: payable(msg.sender),
            seller: seller,
            arbitrator: arbitrator,
            amount: msg.value,
            state: State.INITIATED,
            outcome: Outcome.NONE,
            riskScoreAtDeposit: score,
            thresholdAtDeposit: riskThreshold,
            createdAt: nowTs,
            deliveryConfirmedAt: 0,
            holdingPeriodEndsAt: nowTs + holdingPeriodSeconds,
            exists: true
        });

        emit FundsDeposited(
            escrowId, msg.sender, seller, arbitrator, msg.value, score, riskThreshold, block.timestamp
        );
        emit StateChanged(escrowId, State.INITIATED, State.INITIATED, msg.sender, block.timestamp);
    }

    /* ------------------------------------------------------------ FR-03 -- */

    /**
     * @notice Buyer confirms receipt, starting the dispute window.
     * @dev Callable only by the buyer recorded in the escrow, and only from
     *      INITIATED. Funds are not released here: the time lock must elapse.
     */
    function confirmDelivery(bytes32 escrowId) external {
        Escrow storage escrow = _escrows[escrowId];
        if (!escrow.exists) revert EscrowNotFound(escrowId);
        if (msg.sender != escrow.buyer) revert NotBuyer(msg.sender);
        _requireState(escrow, State.INITIATED);

        escrow.deliveryConfirmedAt = uint64(block.timestamp);
        _transition(escrowId, escrow, State.DELIVERED);

        emit DeliveryConfirmed(
            escrowId, msg.sender, escrow.deliveryConfirmedAt + timeLockSeconds, block.timestamp
        );
    }

    /**
     * @notice Releases the funds to the seller once the time lock has elapsed
     *         without a dispute.
     * @dev Either party may trigger it; the destination is fixed by the escrow
     *      record, so who calls it cannot change where the money goes.
     */
    function releaseFunds(bytes32 escrowId) external nonReentrant {
        Escrow storage escrow = _escrows[escrowId];
        if (!escrow.exists) revert EscrowNotFound(escrowId);
        if (msg.sender != escrow.buyer && msg.sender != escrow.seller) revert NotParty(msg.sender);
        _requireState(escrow, State.DELIVERED);

        uint64 unlocksAt = escrow.deliveryConfirmedAt + timeLockSeconds;
        if (block.timestamp < unlocksAt) revert TimeLockActive(unlocksAt, block.timestamp);

        _settle(escrowId, escrow, escrow.seller, Outcome.RELEASED_TO_SELLER);
    }

    /* ------------------------------------------------------------ FR-04 -- */

    /**
     * @notice Either party moves the escrow into arbitration.
     * @dev Permitted from INITIATED (seller has not delivered) and from
     *      DELIVERED (something was wrong with what arrived).
     */
    function initiateDispute(bytes32 escrowId) external {
        Escrow storage escrow = _escrows[escrowId];
        if (!escrow.exists) revert EscrowNotFound(escrowId);
        if (msg.sender != escrow.buyer && msg.sender != escrow.seller) revert NotParty(msg.sender);
        if (escrow.state != State.INITIATED && escrow.state != State.DELIVERED) {
            revert WrongState(escrow.state, State.DELIVERED);
        }

        _transition(escrowId, escrow, State.DISPUTED);
        emit DisputeInitiated(escrowId, msg.sender, escrow.arbitrator, block.timestamp);
    }

    /* ------------------------------------------------------------ FR-05 -- */

    /**
     * @notice Arbitrator directs the funds.
     * @param releaseToSeller true releases to the seller, false refunds the buyer.
     * @dev Restricted to the arbitrator address recorded in this escrow — not to
     *      an arbitrator role in general. Section 3.11.3 specifies the boolean
     *      parameter and it is kept exactly.
     */
    function resolveDispute(bytes32 escrowId, bool releaseToSeller) external nonReentrant {
        Escrow storage escrow = _escrows[escrowId];
        if (!escrow.exists) revert EscrowNotFound(escrowId);
        if (msg.sender != escrow.arbitrator) revert NotArbitrator(msg.sender);
        _requireState(escrow, State.DISPUTED);

        address payable recipient = releaseToSeller ? escrow.seller : escrow.buyer;
        Outcome outcome = releaseToSeller ? Outcome.RESOLVED_FOR_SELLER : Outcome.RESOLVED_FOR_BUYER;

        emit DisputeResolved(escrowId, msg.sender, releaseToSeller, escrow.amount, block.timestamp);
        _settle(escrowId, escrow, recipient, outcome);
    }

    /* ------------------------------------------------------------ FR-06 -- */

    /**
     * @notice Buyer reclaims funds after the holding period with no delivery
     *         confirmation and no dispute.
     * @dev Protects the buyer from funds locked indefinitely by seller inaction.
     */
    function claimRefund(bytes32 escrowId) external nonReentrant {
        Escrow storage escrow = _escrows[escrowId];
        if (!escrow.exists) revert EscrowNotFound(escrowId);
        if (msg.sender != escrow.buyer) revert NotBuyer(msg.sender);
        _requireState(escrow, State.INITIATED);

        if (block.timestamp < escrow.holdingPeriodEndsAt) {
            revert HoldingPeriodActive(escrow.holdingPeriodEndsAt, block.timestamp);
        }

        _settle(escrowId, escrow, escrow.buyer, Outcome.TIMEOUT_REFUND);
    }

    /* ----------------------------------------------------------- payout -- */

    /**
     * @dev Checks-effects-interactions. State reaches its terminal value and the
     *      balance is zeroed before the transfer, so a recipient that re-enters
     *      finds an escrow that is already COMPLETED with nothing left to send.
     *      ReentrancyGuard on every public payout path is the second layer
     *      (Section 3.15.1).
     */
    function _settle(
        bytes32 escrowId,
        Escrow storage escrow,
        address payable recipient,
        Outcome outcome
    ) private {
        uint256 amount = escrow.amount;

        escrow.amount = 0;
        escrow.outcome = outcome;
        _transition(escrowId, escrow, State.COMPLETED);

        emit FundsReleased(escrowId, recipient, amount, outcome, block.timestamp);

        recipient.sendValue(amount);
    }

    /* -------------------------------------------------- administration --- */

    /**
     * @notice Adjusts the risk gate.
     * @dev Section 3.18: the threshold is the human governance point over the
     *      automated decision, adjustable without redeploying the model or the
     *      contract. Escrows already in custody are unaffected — the gate is a
     *      precondition of depositFunds, not a continuous check.
     */
    function setRiskThreshold(uint8 next) external onlyOwner {
        if (next > 100) revert ThresholdOutOfRange(next);
        uint8 previous = riskThreshold;
        riskThreshold = next;
        emit RiskThresholdChanged(previous, next);
    }

    function setRiskOracle(address next) external onlyOwner {
        if (next == address(0)) revert ZeroAddress();
        address previous = address(riskOracle);
        riskOracle = IRiskOracle(next);
        emit RiskOracleChanged(previous, next);
    }

    function setTimings(uint64 timeLock, uint64 holdingPeriod) external onlyOwner {
        timeLockSeconds = timeLock;
        holdingPeriodSeconds = holdingPeriod;
        emit TimingChanged(timeLock, holdingPeriod);
    }
}
