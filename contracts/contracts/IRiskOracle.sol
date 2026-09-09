// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

/// @title Interface the escrow uses to read AI risk assessments.
/// @notice Kept minimal so EscrowContract depends on the read path only and
///         cannot be compiled with write access to the oracle's storage.
interface IRiskOracle {
    /// @notice Risk score for an escrow, expressed as an integer percentage.
    /// @param escrowId Deterministic identifier agreed before the score is written.
    /// @return score P(fraud) x 100, in the range 0-100.
    /// @dev Reverts when no score has been recorded, so the escrow cannot
    ///      accept funds on the strength of a default zero.
    function getRiskScore(bytes32 escrowId) external view returns (uint8 score);

    /// @notice Whether a score exists for this escrow.
    function hasScore(bytes32 escrowId) external view returns (bool);
}
