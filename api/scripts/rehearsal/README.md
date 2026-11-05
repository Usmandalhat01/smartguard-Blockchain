# Local rehearsal of the full stack

Runs the real contracts on a local JSON-RPC chain, the API with the oracle bridge
and event sync switched on, the Next.js app in live mode, and a browser test that
drives deposit, delivery, release, dispute and refund through the interface.

**What it is not.** It is not the trained model and not Sepolia.
`dev_server.py` replaces the Random Forest with a three-rule stub because
`ml/artifacts/` is not in the repository, so every score here is a stand-in. The
wallet is a stub that forwards to the local chain. Use it to check the wiring.
Do not quote its scores or timings as results.

## Run

```bash
npm i ganache playwright                                   # once, anywhere
npx ganache --chain.chainId 11155111 --wallet.deterministic -p 8545 &
python deploy.py 30 60          # contracts with a 30 s time lock, 60 s holding period
./start_api.sh &                # API on :8000, bridge on, sync every 2 s
cd ../../../web && NEXT_PUBLIC_API_URL=http://127.0.0.1:8000 API_URL=http://127.0.0.1:8000 \
  SESSION_SECRET=e2e-secret-e2e-secret-e2e-secret npx next dev -p 3000 &
cd ../api/scripts/rehearsal && node e2e.js
```

Local chains only advance their clock when a block is mined. If `e2e_sepolia.py`
reverts a time-locked call with a plain `revert` on ganache, mine one block
(`evm_mine`) and retry: gas estimation runs at the last block's timestamp. Public
networks do not have this problem.

Passing output is seven `PASS` lines. The test checks the database, not page text:
each case waits for the row to reach the expected state and outcome.
