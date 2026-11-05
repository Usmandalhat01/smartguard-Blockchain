"""The oracle bridge and event sync, run against the real compiled contracts.

The contracts are deployed to an in-process EVM (eth-tester). That is not
Sepolia, but it executes the same bytecode, so it proves the parts that can go
wrong without a network: the escrow identifier matches the contract's, the
score the API writes is the one the gate reads, the contract's own refusals
(missing score, high score) hold, and the event mirror reaches the right states
and does so idempotently.

What it cannot prove is behaviour on a public chain: latency, gas prices, RPC
rate limits, reorgs. `scripts/e2e_sepolia.py` covers those with real keys.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from eth_account import Account
from eth_account.messages import encode_defunct
from web3 import EthereumTesterProvider, Web3

from smartguard_api.chain import (
    ChainClient, ChainError, compute_escrow_id, eth_to_wei, score_to_contract,
)
from smartguard_api.chain_sync import sync_once
from smartguard_api.db import SessionLocal
from smartguard_api.main import app
from smartguard_api.models import AuditLog, EscrowState, Outcome, Transaction, User

ABI_DIR = Path(__file__).parent.parent / "smartguard_api" / "abi"
BYTECODE = json.loads((Path(__file__).parent / "fixtures" / "contract_bytecode.json").read_text())

TIME_LOCK = 3600
HOLDING = 7200
THRESHOLD = 45


def _deploy(w3, name, deployer, *args):
    abi = json.loads((ABI_DIR / f"{name}.json").read_text())
    factory = w3.eth.contract(abi=abi, bytecode=BYTECODE[name]["bytecode"])
    receipt = w3.eth.wait_for_transaction_receipt(factory.constructor(*args).transact({"from": deployer}))
    return w3.eth.contract(address=receipt["contractAddress"], abi=abi)


@pytest.fixture
def world(client, scorer):
    """A fresh chain, deployed contracts, and the three seeded parties mapped
    onto three chain accounts. The oracle operator is a separate funded key."""
    w3 = Web3(EthereumTesterProvider())
    accounts = w3.eth.accounts
    deployer, buyer, seller, arbitrator = accounts[0], accounts[1], accounts[2], accounts[3]

    operator = Account.create()
    w3.eth.wait_for_transaction_receipt(
        w3.eth.send_transaction({"from": deployer, "to": operator.address, "value": 10**18}),
    )
    oracle = _deploy(w3, "RiskOracleContract", deployer, operator.address)
    escrow = _deploy(w3, "EscrowContract", deployer, oracle.address, THRESHOLD, TIME_LOCK, HOLDING)

    chain = ChainClient(w3, escrow.address, oracle.address, operator.key.hex())
    app.state.chain = chain

    with SessionLocal() as db:
        for role, address in (("buyer", buyer), ("seller", seller), ("arbitrator", arbitrator)):
            db.query(User).filter(User.role == role).one().wallet_address = address
        db.commit()

    yield type("World", (), dict(
        w3=w3, chain=chain, escrow=escrow, oracle=oracle,
        buyer=buyer, seller=seller, arbitrator=arbitrator, operator=operator,
    ))
    app.state.chain = None


@pytest.fixture
def seller_user_id(client, tokens, auth):
    with SessionLocal() as db:
        return db.query(User).filter(User.role == "seller").one().id


def _make(client, tokens, auth, seller_user_id, scorer, probability=0.20):
    from tests.test_escrows import create
    scorer.forced_score = probability
    return create(client, auth, tokens["buyer"], seller_user_id)


def _deposit(world, params):
    return world.escrow.functions.depositFunds(
        params["seller"], params["arbitrator"], int(params["nonce"]),
    ).transact({"from": world.buyer, "value": int(params["amountWei"])})


def _sync(world):
    with SessionLocal() as db:
        return sync_once(db, world.chain, start_block=0, confirmations=0)


def _row(reference):
    with SessionLocal() as db:
        tx = db.query(Transaction).filter(Transaction.reference == reference).one()
        db.expunge(tx)
        return tx


# ------------------------------------------------------------- pure helpers --

def test_escrow_id_matches_the_contract(world):
    local = compute_escrow_id(world.buyer, world.seller, eth_to_wei(0.1), 12345)
    on_chain = world.escrow.functions.computeEscrowId(world.buyer, world.seller, eth_to_wei(0.1), 12345).call()
    assert local == "0x" + on_chain.hex()


def test_eth_to_wei_is_exact_for_decimal_amounts():
    assert eth_to_wei(0.1) == 10**17
    assert eth_to_wei(1.2345) == 1234500000000000000


@pytest.mark.parametrize("probability,expected", [(0.0, 0), (0.449, 45), (0.45, 45), (0.451, 46), (1.0, 100)])
def test_score_rounds_up_so_the_api_gate_implies_the_contract_gate(probability, expected):
    assert score_to_contract(probability) == expected


# ------------------------------------------------------------- full lifecycle --

def test_deposit_then_release_is_mirrored_into_the_database(client, tokens, auth, seller_user_id, scorer, world):
    created = _make(client, tokens, auth, seller_user_id, scorer)
    assert created.status_code == 201, created.text
    ref = created.json()["reference"]
    assert created.json()["escrowId"].startswith("0x")
    assert world.oracle.functions.hasScore(Web3.to_bytes(hexstr=created.json()["escrowId"])).call()

    params = client.get(f"/api/v1/escrows/{ref}/onchain", headers=auth(tokens["buyer"])).json()
    assert params["scoreRecorded"] and not params["depositConfirmed"]

    world.w3.eth.wait_for_transaction_receipt(_deposit(world, params))
    result = _sync(world)
    assert not result.errors
    assert client.get(f"/api/v1/escrows/{ref}/onchain", headers=auth(tokens["buyer"])).json()["depositConfirmed"]

    eid = Web3.to_bytes(hexstr=params["escrowId"])
    world.escrow.functions.confirmDelivery(eid).transact({"from": world.buyer})
    world.w3.provider.ethereum_tester.time_travel(world.w3.eth.get_block("latest")["timestamp"] + TIME_LOCK + 5)
    world.w3.provider.ethereum_tester.mine_block()
    world.escrow.functions.releaseFunds(eid).transact({"from": world.seller})
    _sync(world)

    tx = _row(ref)
    assert tx.state == EscrowState.COMPLETED
    assert tx.outcome == Outcome.RELEASED_TO_SELLER
    assert tx.delivery_confirmed_at is not None and tx.completed_at is not None


def test_refund_after_holding_period(client, tokens, auth, seller_user_id, scorer, world):
    ref = _make(client, tokens, auth, seller_user_id, scorer).json()["reference"]
    params = client.get(f"/api/v1/escrows/{ref}/onchain", headers=auth(tokens["buyer"])).json()
    _deposit(world, params)
    world.w3.provider.ethereum_tester.time_travel(world.w3.eth.get_block("latest")["timestamp"] + HOLDING + 5)
    world.w3.provider.ethereum_tester.mine_block()
    world.escrow.functions.claimRefund(Web3.to_bytes(hexstr=params["escrowId"])).transact({"from": world.buyer})
    _sync(world)
    tx = _row(ref)
    assert (tx.state, tx.outcome) == (EscrowState.COMPLETED, Outcome.TIMEOUT_REFUND)


def test_dispute_resolved_for_buyer(client, tokens, auth, seller_user_id, scorer, world):
    ref = _make(client, tokens, auth, seller_user_id, scorer).json()["reference"]
    params = client.get(f"/api/v1/escrows/{ref}/onchain", headers=auth(tokens["buyer"])).json()
    _deposit(world, params)
    eid = Web3.to_bytes(hexstr=params["escrowId"])
    world.escrow.functions.initiateDispute(eid).transact({"from": world.seller})
    _sync(world)
    assert _row(ref).state == EscrowState.DISPUTED
    world.escrow.functions.resolveDispute(eid, False).transact({"from": world.arbitrator})
    _sync(world)
    tx = _row(ref)
    assert (tx.state, tx.outcome) == (EscrowState.COMPLETED, Outcome.RESOLVED_FOR_BUYER)
    with SessionLocal() as db:
        dispute = db.query(Transaction).filter(Transaction.reference == ref).one().dispute
        assert dispute.resolution_for_seller is False and dispute.raised_by_role.value == "seller"


# ---------------------------------------------------------------- safety ------

def test_sync_is_idempotent(client, tokens, auth, seller_user_id, scorer, world):
    ref = _make(client, tokens, auth, seller_user_id, scorer).json()["reference"]
    _deposit(world, client.get(f"/api/v1/escrows/{ref}/onchain", headers=auth(tokens["buyer"])).json())
    _sync(world)
    with SessionLocal() as db:
        before = db.query(AuditLog).count()
        db.query(AuditLog).filter(AuditLog.event_type.like("chain.%")).count()
    from smartguard_api.chain_sync import CURSOR_KEY
    from smartguard_api.models import SystemSetting
    with SessionLocal() as db:
        db.get(SystemSetting, CURSOR_KEY).value = "0"   # force a full replay
        db.commit()
    again = _sync(world)
    with SessionLocal() as db:
        assert db.query(AuditLog).count() == before
    assert again.skipped_duplicates >= 2 and again.applied == 0


def test_gate_rejection_writes_nothing_on_chain(client, tokens, auth, seller_user_id, scorer, world):
    response = _make(client, tokens, auth, seller_user_id, scorer, probability=0.80)
    assert response.status_code == 422
    assert world.oracle.functions.lastNonce().call() == 0


def _revert_selector(world, sender, params_or_args, value):
    """The 4-byte custom-error selector the contract reverts with.

    web3's own decoder cannot read custom errors under eth-tester, so the raw
    call is made on the tester and the revert data read from the exception.
    """
    import ast
    from eth_tester.exceptions import TransactionFailed

    data = world.escrow.encodeABI("depositFunds", args=params_or_args)
    try:
        world.w3.provider.ethereum_tester.call(
            {"from": sender, "to": world.escrow.address, "data": data, "value": value, "gas": 500000},
        )
    except TransactionFailed as failure:
        return "0x" + ast.literal_eval(failure.args[0])[:4].hex()
    raise AssertionError("the call did not revert")


def _selector(signature):
    return Web3.keccak(text=signature)[:4].hex()


def test_deposit_without_a_score_reverts_with_no_risk_assessment(world):
    got = _revert_selector(world, world.buyer, [world.seller, world.arbitrator, 1], 10**16)
    assert got == _selector("NoRiskAssessment(bytes32)")


def test_wrong_amount_changes_the_escrow_id_and_reverts(client, tokens, auth, seller_user_id, scorer, world):
    ref = _make(client, tokens, auth, seller_user_id, scorer).json()["reference"]
    params = client.get(f"/api/v1/escrows/{ref}/onchain", headers=auth(tokens["buyer"])).json()
    args = [params["seller"], params["arbitrator"], int(params["nonce"])]
    assert _revert_selector(world, world.buyer, args, int(params["amountWei"]) + 1) == _selector("NoRiskAssessment(bytes32)")
    # The exact amount is accepted.
    world.w3.eth.wait_for_transaction_receipt(_deposit(world, params))


def test_contract_refuses_a_high_score_even_if_the_api_did_not(world):
    """Defence in depth: a score above the gate is refused by the contract itself."""
    eid = compute_escrow_id(world.buyer, world.seller, 10**16, 7)
    world.chain.write_score(eid, 0.60, "test")
    got = _revert_selector(world, world.buyer, [world.seller, world.arbitrator, 7], 10**16)
    assert got == _selector("RiskAssessmentRejected(uint8,uint8)")


def test_failed_oracle_write_admits_nothing(client, tokens, auth, seller_user_id, scorer, world, monkeypatch):
    monkeypatch.setattr(world.chain, "write_score", lambda *a, **k: (_ for _ in ()).throw(ChainError("rpc down")))
    response = _make(client, tokens, auth, seller_user_id, scorer)
    assert response.status_code == 503
    with SessionLocal() as db:
        assert db.query(Transaction).count() == 0


def test_wallet_actions_are_refused_by_the_api_in_chain_mode(client, tokens, auth, seller_user_id, scorer, world):
    ref = _make(client, tokens, auth, seller_user_id, scorer).json()["reference"]
    for path, token in (("confirm-delivery", "buyer"), ("refund", "buyer"), ("withdraw", "buyer")):
        response = client.post(f"/api/v1/escrows/{ref}/{path}", headers=auth(tokens[token]))
        assert response.status_code == 409


def test_chain_status_reports_operator_authorised(client, tokens, auth, world):
    status = client.get("/api/v1/chain/status", headers=auth(tokens["admin"])).json()
    assert status["enabled"] and status["operatorAuthorised"] and status["riskThreshold"] == THRESHOLD


# ---------------------------------------------------------------- wallets -----

def test_wallet_link_requires_a_valid_signature(client, tokens, auth):
    from smartguard_api.routers.auth import wallet_link_message
    account = Account.create()
    with SessionLocal() as db:
        user = db.query(User).filter(User.role == "buyer").one()
        message = wallet_link_message(user)
    good = account.sign_message(encode_defunct(text=message)).signature.hex()
    good = good if good.startswith("0x") else "0x" + good
    other = Account.create().sign_message(encode_defunct(text=message)).signature.hex()
    other = other if other.startswith("0x") else "0x" + other

    bad = client.put("/api/v1/auth/wallet", json={"address": account.address, "signature": other}, headers=auth(tokens["buyer"]))
    assert bad.status_code == 400
    ok = client.put("/api/v1/auth/wallet", json={"address": account.address, "signature": good}, headers=auth(tokens["buyer"]))
    assert ok.status_code == 200 and ok.json()["walletAddress"] == account.address


def test_counterparties_lists_sellers_only(client, tokens, auth):
    rows = client.get("/api/v1/escrows/counterparties", headers=auth(tokens["buyer"])).json()
    assert rows and all(set(r) == {"id", "displayName", "walletAddress"} for r in rows)
    assert client.get("/api/v1/escrows/counterparties", headers=auth(tokens["seller"])).status_code == 403


def test_chain_info_for_any_signed_in_user(client, tokens, auth, world):
    info = client.get("/api/v1/chain/info", headers=auth(tokens["buyer"])).json()
    assert info["enabled"] and info["escrowContract"] == world.escrow.address


def test_escrow_carries_its_dispute_and_audit_trail(client, tokens, auth, seller_user_id, scorer, world):
    ref = _make(client, tokens, auth, seller_user_id, scorer).json()["reference"]
    _deposit(world, client.get(f"/api/v1/escrows/{ref}/onchain", headers=auth(tokens["buyer"])).json())
    params = client.get(f"/api/v1/escrows/{ref}/onchain", headers=auth(tokens["buyer"])).json()
    world.escrow.functions.initiateDispute(Web3.to_bytes(hexstr=params["escrowId"])).transact({"from": world.buyer})
    _sync(world)
    body = client.get(f"/api/v1/escrows/{ref}", headers=auth(tokens["buyer"])).json()
    assert body["dispute"]["raisedByRole"] == "buyer"
    trail = client.get(f"/api/v1/escrows/{ref}/audit", headers=auth(tokens["buyer"])).json()
    assert {"oracle.write", "chain.FundsDeposited", "chain.DisputeInitiated"} <= {e["eventType"] for e in trail}
    assert client.get(f"/api/v1/escrows/{ref}/audit", headers=auth(tokens["seller"])).status_code == 200


def test_status_flags_a_threshold_mismatch_between_database_and_contract(client, tokens, auth, world):
    status = client.get("/api/v1/chain/status", headers=auth(tokens["admin"])).json()
    # Database default is 0.75; the test contract was deployed with 45.
    assert status["configuredThreshold"] == 75 and status["riskThreshold"] == 45
    assert status["thresholdInSync"] is False
