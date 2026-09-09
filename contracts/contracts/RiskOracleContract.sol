// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IRiskOracle} from "./IRiskOracle.sol";

/**
 * @title RiskOracleContract
 * @notice Receives machine-learning risk assessments from the off-chain oracle
 *         bridge and makes them readable by EscrowContract.
 *
 * @dev This is the on-chain half of the "off-chain computation with on-chain
 *      result verification" pattern (Section 3.14). The oracle operator is a
 *      single trusted relay, which concentrates trust by design and is recorded
 *      as such in Section 3.19; a decentralised oracle network is future work.
 *
 *      Because the relay is trusted, the controls that matter are the ones that
 *      stop a *captured* message being reused. Section 3.15.2 lists them as
 *      production requirements; they are implemented here:
 *
 *        - only the designated operator may write            (onlyOracle)
 *        - each escrow accepts exactly one score             (score immutability)
 *        - every write carries a strictly increasing nonce   (replay rejection)
 *        - every write carries an expiry                     (stale-message rejection)
 *        - the operator key can be rotated by the owner      (revocation)
 *
 *      Writing the score on chain *before* it can influence the escrow is what
 *      makes the AI decision auditable after the fact: the value that governed
 *      the contract is in the ledger, not only in an application log.
 */
contract RiskOracleContract is Ownable, IRiskOracle {
    /// @notice Maximum score value. Scores are P(fraud) x 100.
    uint8 public constant MAX_SCORE = 100;

    struct Assessment {
        uint8 score;
        bool recorded;
        /// @dev Model version that produced the score, so a historical
        ///      assessment stays interpretable after a retrain (Section 3.9.2).
        bytes32 modelVersion;
        uint64 recordedAt;
    }

    /// @notice Address permitted to submit assessments.
    address public oracleOperator;

    /// @notice Highest nonce accepted so far. Writes must strictly exceed it.
    uint256 public lastNonce;

    mapping(bytes32 => Assessment) private _assessments;

    event RiskScoreRecorded(
        bytes32 indexed escrowId,
        uint8 score,
        bytes32 modelVersion,
        uint256 nonce,
        address indexed operator,
        uint256 timestamp
    );

    event OracleOperatorChanged(address indexed previous, address indexed next);

    error NotOracleOperator(address caller);
    error ScoreOutOfRange(uint8 score);
    error ScoreAlreadyRecorded(bytes32 escrowId);
    error NonceNotIncreasing(uint256 supplied, uint256 last);
    error AssessmentExpired(uint64 expiry, uint256 blockTime);
    error NoScoreRecorded(bytes32 escrowId);
    error ZeroAddress();

    modifier onlyOracle() {
        if (msg.sender != oracleOperator) revert NotOracleOperator(msg.sender);
        _;
    }

    constructor(address operator) Ownable(msg.sender) {
        if (operator == address(0)) revert ZeroAddress();
        oracleOperator = operator;
        emit OracleOperatorChanged(address(0), operator);
    }

    /**
     * @notice Records the risk score for an escrow.
     * @param escrowId     Deterministic escrow identifier, agreed off chain.
     * @param score        P(fraud) x 100, 0-100 inclusive.
     * @param modelVersion Identifier of the model that produced the score.
     * @param nonce        Strictly increasing per operator.
     * @param expiry       Unix timestamp after which this write is refused.
     *
     * @dev A score is written once and never amended. Allowing an update would
     *      let a compromised relay lower a score after an escrow had been
     *      refused, which is the attack the immutability guards against.
     */
    function updateRiskScore(
        bytes32 escrowId,
        uint8 score,
        bytes32 modelVersion,
        uint256 nonce,
        uint64 expiry
    ) external onlyOracle {
        if (score > MAX_SCORE) revert ScoreOutOfRange(score);
        if (_assessments[escrowId].recorded) revert ScoreAlreadyRecorded(escrowId);
        if (nonce <= lastNonce) revert NonceNotIncreasing(nonce, lastNonce);
        if (block.timestamp > expiry) revert AssessmentExpired(expiry, block.timestamp);

        lastNonce = nonce;
        _assessments[escrowId] = Assessment({
            score: score,
            recorded: true,
            modelVersion: modelVersion,
            recordedAt: uint64(block.timestamp)
        });

        emit RiskScoreRecorded(escrowId, score, modelVersion, nonce, msg.sender, block.timestamp);
    }

    /// @inheritdoc IRiskOracle
    function getRiskScore(bytes32 escrowId) external view returns (uint8) {
        Assessment storage assessment = _assessments[escrowId];
        if (!assessment.recorded) revert NoScoreRecorded(escrowId);
        return assessment.score;
    }

    /// @inheritdoc IRiskOracle
    function hasScore(bytes32 escrowId) external view returns (bool) {
        return _assessments[escrowId].recorded;
    }

    /// @notice Full assessment record, for the event listener and audit views.
    function getAssessment(bytes32 escrowId)
        external
        view
        returns (uint8 score, bytes32 modelVersion, uint64 recordedAt)
    {
        Assessment storage assessment = _assessments[escrowId];
        if (!assessment.recorded) revert NoScoreRecorded(escrowId);
        return (assessment.score, assessment.modelVersion, assessment.recordedAt);
    }

    /**
     * @notice Rotates the operator key.
     * @dev Section 3.15.2 requires immediate rotation and revocation. Setting a
     *      new operator revokes the previous one in the same transaction.
     */
    function setOracleOperator(address next) external onlyOwner {
        if (next == address(0)) revert ZeroAddress();
        address previous = oracleOperator;
        oracleOperator = next;
        emit OracleOperatorChanged(previous, next);
    }
}
