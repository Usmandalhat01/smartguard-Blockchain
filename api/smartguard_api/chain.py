"""The oracle bridge and read access to the two contracts (Section 3.7, Sprint 4).

Two things happen here and only two.

1. **The oracle write.** After the application layer's gate accepts a request,
   this module signs and submits `RiskOracleContract.updateRiskScore` with the
   operator key. The contract then holds the score the buyer's later
   `depositFunds` call is checked against. The operator key is the only secret
   this service holds; it can write scores and nothing else. It cannot move
   funds, and no function of `EscrowContract` accepts it as a caller.

2. **Reading events back.** `fetch_events` returns decoded logs from both
   contracts so `chain_sync` can mirror them into the database.

Deposits, deliveries, releases, disputes and refunds are *not* signed here. The
contract checks `msg.sender` against the buyer, seller or arbitrator, so only
that person's wallet can send them. A service that signed on their behalf would
need their keys, which is the custody this design exists to avoid.

Everything fails closed. If the write cannot be confirmed the caller is told so
and no escrow is recorded as scored: a missing score makes `depositFunds`
revert with `NoRiskAssessment`, which is the safe state.
"""

from __future__ import annotations

import json
import math
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from eth_abi import encode as abi_encode
from eth_account import Account
from web3 import Web3
from web3.types import LogReceipt

ABI_DIR = Path(__file__).parent / "abi"

EVENTS = {
    "EscrowContract": (
        "FundsDeposited", "DeliveryConfirmed", "DisputeInitiated",
        "DisputeResolved", "FundsReleased",
    ),
    "RiskOracleContract": ("RiskScoreRecorded",),
}


class ChainError(RuntimeError):
    """A chain interaction failed. The message is safe to log."""


@dataclass(frozen=True)
class ScoreWrite:
    tx_hash: str
    block_number: int
    gas_used: int
    nonce: int
    score: int


def _abi(name: str) -> list[dict[str, Any]]:
    return json.loads((ABI_DIR / f"{name}.json").read_text())


def score_to_contract(probability: float) -> int:
    """P(fraud) in [0, 1] to the contract's 0-100 integer.

    Rounded *up*. The API gate refuses a probability above the threshold, so
    every probability it accepts, at or below it, maps to an integer at or
    below the contract's threshold. Rounding to nearest could turn an accepted
    0.449 into 45 against a threshold of 44, and the deposit would then revert
    for a reason the application layer had already ruled out.
    """
    return max(0, min(100, math.ceil(round(probability * 100, 6))))


def eth_to_wei(amount_eth: float) -> int:
    """Exact wei for a decimal ETH amount.

    Goes through the decimal string, not float arithmetic: 0.1 * 10**18 is not
    an integer in binary floating point. The browser must derive the same value
    (`parseEther` on the same string) or the escrow identifier will differ and
    the deposit will revert with `NoRiskAssessment`.
    """
    from decimal import Decimal

    return int(Decimal(repr(amount_eth)) * Decimal(10**18))


def compute_escrow_id(buyer: str, seller: str, amount_wei: int, nonce: int) -> str:
    """`keccak256(abi.encode(buyer, seller, amount, nonce))`, as the contract does."""
    encoded = abi_encode(
        ["address", "address", "uint256", "uint256"],
        [Web3.to_checksum_address(buyer), Web3.to_checksum_address(seller), amount_wei, nonce],
    )
    return "0x" + Web3.keccak(encoded).hex().removeprefix("0x")


def model_version_bytes32(version: str) -> bytes:
    return version.encode()[:32].ljust(32, b"\0")


class ChainClient:
    def __init__(
        self,
        w3: Web3,
        escrow_address: str,
        oracle_address: str,
        operator_key: str,
        *,
        score_ttl_seconds: int = 600,
        receipt_timeout: int = 180,
    ) -> None:
        self.w3 = w3
        self.escrow_address = Web3.to_checksum_address(escrow_address)
        self.oracle_address = Web3.to_checksum_address(oracle_address)
        self.escrow = w3.eth.contract(address=self.escrow_address, abi=_abi("EscrowContract"))
        self.oracle = w3.eth.contract(address=self.oracle_address, abi=_abi("RiskOracleContract"))
        self.operator = Account.from_key(operator_key)
        self.score_ttl_seconds = score_ttl_seconds
        self.receipt_timeout = receipt_timeout
        # One operator account means one nonce sequence. Concurrent writes would
        # race on both the transaction nonce and the contract's own nonce.
        self._lock = threading.Lock()

    @classmethod
    def from_settings(cls, settings) -> "ChainClient":
        w3 = Web3(Web3.HTTPProvider(settings.sepolia_rpc_url, request_kwargs={"timeout": 30}))
        return cls(
            w3, settings.escrow_contract_address, settings.risk_oracle_contract_address,
            settings.oracle_private_key, score_ttl_seconds=settings.oracle_score_ttl_seconds,
        )

    # ------------------------------------------------------------ status --

    def status(self) -> dict[str, Any]:
        """What an operator needs to see to know the bridge can work."""
        try:
            on_chain_operator = self.oracle.functions.oracleOperator().call()
            return {
                "connected": True,
                "chainId": self.w3.eth.chain_id,
                "latestBlock": self.w3.eth.block_number,
                "operator": self.operator.address,
                "operatorAuthorised": on_chain_operator == self.operator.address,
                "operatorBalanceWei": self.w3.eth.get_balance(self.operator.address),
                "riskThreshold": self.escrow.functions.riskThreshold().call(),
                "escrowContract": self.escrow_address,
                "riskOracleContract": self.oracle_address,
            }
        except Exception as error:  # noqa: BLE001 - reported, not hidden
            return {"connected": False, "error": str(error)}

    # ------------------------------------------------------- oracle write --

    def write_score(self, escrow_id: str, probability: float, model_version: str) -> ScoreWrite:
        """Signs and submits the score, then waits for it to be mined.

        Returns only after the receipt shows success. The caller must not tell
        the buyer to deposit before this returns, because a deposit sent first
        would revert.
        """
        score = score_to_contract(probability)
        with self._lock:
            try:
                nonce = self.oracle.functions.lastNonce().call() + 1
                expiry = self.w3.eth.get_block("latest")["timestamp"] + self.score_ttl_seconds
                call = self.oracle.functions.updateRiskScore(
                    Web3.to_bytes(hexstr=escrow_id), score,
                    model_version_bytes32(model_version), nonce, expiry,
                )
                tx = call.build_transaction({
                    "from": self.operator.address,
                    "nonce": self.w3.eth.get_transaction_count(self.operator.address, "pending"),
                    "chainId": self.w3.eth.chain_id,
                })
                signed = self.operator.sign_transaction(tx)
                tx_hash = self.w3.eth.send_raw_transaction(signed.rawTransaction)
                receipt = self.w3.eth.wait_for_transaction_receipt(
                    tx_hash, timeout=self.receipt_timeout,
                )
            except Exception as error:  # noqa: BLE001
                raise ChainError(f"oracle write failed: {error}") from error

        if receipt["status"] != 1:
            raise ChainError(f"oracle write reverted in {tx_hash.hex()}")
        return ScoreWrite(
            tx_hash=tx_hash.hex() if tx_hash.hex().startswith("0x") else "0x" + tx_hash.hex(),
            block_number=receipt["blockNumber"], gas_used=receipt["gasUsed"],
            nonce=nonce, score=score,
        )

    def has_score(self, escrow_id: str) -> bool:
        return self.oracle.functions.hasScore(Web3.to_bytes(hexstr=escrow_id)).call()

    # ------------------------------------------------------------ reading --

    def latest_block(self) -> int:
        return self.w3.eth.block_number

    def fetch_events(self, from_block: int, to_block: int) -> list[dict[str, Any]]:
        """Decoded logs from both contracts in [from_block, to_block], in order."""
        found: list[dict[str, Any]] = []
        for contract_name, contract in (("EscrowContract", self.escrow), ("RiskOracleContract", self.oracle)):
            for event_name in EVENTS[contract_name]:
                logs: list[LogReceipt] = getattr(contract.events, event_name).get_logs(
                    fromBlock=from_block, toBlock=to_block,
                )
                for log in logs:
                    found.append({
                        "event": event_name,
                        "args": dict(log["args"]),
                        "txHash": log["transactionHash"].hex() if log["transactionHash"].hex().startswith("0x") else "0x" + log["transactionHash"].hex(),
                        "blockNumber": log["blockNumber"],
                        "logIndex": log["logIndex"],
                    })
        found.sort(key=lambda e: (e["blockNumber"], e["logIndex"]))
        return found
