#!/bin/bash
cd "$(dirname "$(readlink -f "$0")")"
REPO="$(cd ../../.. && pwd)"
export DATABASE_URL=sqlite:///$PWD/e2e.sqlite SESSION_SECRET=e2e-secret-e2e-secret-e2e-secret ENVIRONMENT=development
export SEPOLIA_RPC_URL=http://127.0.0.1:8545 CHAIN_CONFIRMATIONS=0 CHAIN_POLL_SECONDS=2
export ORACLE_PRIVATE_KEY=0x1111111111111111111111111111111111111111111111111111111111111111
export ESCROW_CONTRACT_ADDRESS=$(python3 -c "import json;print(json.load(open('deployed.json'))['escrow'])")
export RISK_ORACLE_CONTRACT_ADDRESS=$(python3 -c "import json;print(json.load(open('deployed.json'))['oracle'])")
export PYTHONPATH=$REPO/api
rm -f e2e.sqlite
exec python dev_server.py
