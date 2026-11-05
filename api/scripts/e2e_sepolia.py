"""Drives one escrow through the running application on Sepolia, with real keys.

Run against a server started with the bridge enabled (SEPOLIA_RPC_URL,
ORACLE_PRIVATE_KEY and both contract addresses set). It plays the buyer's
browser wallet: it logs in as the buyer, asks the service to open the escrow
(which scores it and writes the score on chain), sends the deposit from the
buyer's key, and then waits for the service to record it.

    BUYER_PRIVATE_KEY=0x... python scripts/e2e_sepolia.py deposit
    BUYER_PRIVATE_KEY=0x... python scripts/e2e_sepolia.py confirm  ESC-1042
    SELLER_PRIVATE_KEY=0x... python scripts/e2e_sepolia.py release ESC-1042   # after the time lock
    BUYER_PRIVATE_KEY=0x... python scripts/e2e_sepolia.py refund   ESC-1042   # after the holding period

Both accounts must have been linked to their wallets first (PUT /auth/wallet, or
the "Link my wallet" button), because the contract checks msg.sender against the
addresses the escrow was created with. The script refuses to start otherwise.
It prints transaction hashes so each step can be checked on Etherscan; the
measured values belong in docs/evidence/, not in this script's output alone.
"""

from __future__ import annotations

import os
import sys
import time

import httpx
from eth_account import Account
from web3 import Web3

API = os.environ.get("API_URL", "http://127.0.0.1:8000") + "/api/v1"
ACCOUNTS = {
    "buyer": ("BUYER_EMAIL", "BUYER_PASSWORD", "BUYER_PRIVATE_KEY"),
    "seller": ("SELLER_EMAIL", "SELLER_PASSWORD", "SELLER_PRIVATE_KEY"),
}
ABI = [
    {"type": "function", "name": n, "stateMutability": "nonpayable", "inputs": [{"name": "escrowId", "type": "bytes32"}], "outputs": []}
    for n in ("confirmDelivery", "releaseFunds", "claimRefund", "initiateDispute")
] + [{
    "type": "function", "name": "depositFunds", "stateMutability": "payable",
    "inputs": [{"name": "seller", "type": "address"}, {"name": "arbitrator", "type": "address"}, {"name": "nonce", "type": "uint256"}],
    "outputs": [{"type": "bytes32"}],
}]


def login(client: httpx.Client, role: str) -> tuple[dict, Account]:
    email_var, password_var, key_var = ACCOUNTS[role]
    body = {"email": os.environ[email_var], "password": os.environ[password_var]}
    token = client.post(f"{API}/auth/login", json=body).raise_for_status().json()["accessToken"]
    account = Account.from_key(os.environ[key_var])
    return {"Authorization": f"Bearer {token}"}, account


def send(w3: Web3, account, tx_call, value: int = 0) -> str:
    tx = tx_call.build_transaction({
        "from": account.address, "value": value,
        "nonce": w3.eth.get_transaction_count(account.address, "pending"),
    })
    signed = account.sign_transaction(tx)
    h = w3.eth.send_raw_transaction(signed.rawTransaction)
    receipt = w3.eth.wait_for_transaction_receipt(h, timeout=240)
    if receipt["status"] != 1:
        sys.exit(f"reverted: {h.hex()}")
    print(f"  tx {h.hex()}  gas {receipt['gasUsed']}  block {receipt['blockNumber']}")
    return h.hex()


def wait_for(client, headers, ref, predicate, what: str, seconds: int = 180):
    end = time.time() + seconds
    while time.time() < end:
        body = client.get(f"{API}/escrows/{ref}", headers=headers).json()
        if predicate(body):
            return body
        time.sleep(5)
    sys.exit(f"timed out waiting for the service to record: {what}")


def main() -> None:
    if len(sys.argv) < 2 or sys.argv[1] not in {"deposit", "confirm", "release", "refund"}:
        sys.exit(__doc__)
    step = sys.argv[1]
    client = httpx.Client(timeout=120)
    role = "seller" if step == "release" else "buyer"
    headers, account = login(client, role)

    info = client.get(f"{API}/chain/info", headers=headers).json()
    if not info.get("enabled"):
        sys.exit("The service reports the bridge is not enabled.")
    w3 = Web3(Web3.HTTPProvider(os.environ["SEPOLIA_RPC_URL"]))
    escrow = w3.eth.contract(address=Web3.to_checksum_address(info["escrowContract"]), abi=ABI)

    if step == "deposit":
        sellers = client.get(f"{API}/escrows/counterparties", headers=headers).json()
        seller = sellers[0]
        body = {
            "sellerId": seller["id"], "amountEth": float(os.environ.get("AMOUNT_ETH", "0.001")),
            "itemDescription": "Sepolia end-to-end run",
            "scoring": {
                "amountEth": float(os.environ.get("AMOUNT_ETH", "0.001")), "sellerId": seller["id"],
                "accountAgeDays": 400, "velocity24h": 1, "counterpartyReputation": 0.95,
                "sellerDisputeRate": 0.02, "buyerDisputeRate": 0.0, "deviceConsistent": True,
                "highRiskGeo": False, "offHours": False, "meanAmount30d": 0.002,
                "accountBalanceEth": w3.eth.get_balance(account.address) / 1e18, "channel": "web",
            },
        }
        created = client.post(f"{API}/escrows", json=body, headers=headers)
        if created.status_code != 201:
            sys.exit(f"service refused: {created.status_code} {created.text}")
        ref = created.json()["reference"]
        p = client.get(f"{API}/escrows/{ref}/onchain", headers=headers).json()
        print(f"{ref} created; score on chain. Depositing {p['amountWei']} wei…")
        send(w3, account, escrow.functions.depositFunds(
            Web3.to_checksum_address(p["seller"]), Web3.to_checksum_address(p["arbitrator"]), int(p["nonce"]),
        ), int(p["amountWei"]))
        wait_for(client, headers, ref, lambda b: b["state"] == "INITIATED" and client.get(
            f"{API}/escrows/{ref}/onchain", headers=headers).json()["depositConfirmed"], "deposit")
        print(f"service recorded the deposit for {ref}")
        return

    ref = sys.argv[2]
    p = client.get(f"{API}/escrows/{ref}/onchain", headers=headers).json()
    eid = Web3.to_bytes(hexstr=p["escrowId"])
    fn = {"confirm": "confirmDelivery", "release": "releaseFunds", "refund": "claimRefund"}[step]
    print(f"{step} {ref}…")
    send(w3, account, getattr(escrow.functions, fn)(eid))
    target = {"confirm": lambda b: b["state"] == "DELIVERED"}.get(step, lambda b: b["state"] == "COMPLETED")
    body = wait_for(client, headers, ref, target, f"{step} event")
    print(f"service recorded: state={body['state']} outcome={body.get('outcome')}")


if __name__ == "__main__":
    main()
