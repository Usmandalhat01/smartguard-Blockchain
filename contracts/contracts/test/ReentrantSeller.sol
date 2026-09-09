// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

/// @dev Test-only. A seller that calls back into releaseFunds on receipt, to
///      demonstrate that checks-effects-interactions plus ReentrancyGuard hold.
///      Never deployed outside the test suite.
interface IEscrowRelease {
    function releaseFunds(bytes32 escrowId) external;
}

contract ReentrantSeller {
    IEscrowRelease public immutable escrow;
    bytes32 public escrowId;

    constructor(address escrowAddress) {
        escrow = IEscrowRelease(escrowAddress);
    }

    function setEscrowId(bytes32 id) external {
        escrowId = id;
    }

    receive() external payable {
        escrow.releaseFunds(escrowId);
    }
}
