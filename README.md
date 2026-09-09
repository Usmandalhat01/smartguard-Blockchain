# SmartGuard

**Blockchain-Enhanced AI-Powered Transaction System for Fraud Detection and Risk
Analysis**

A prototype escrow platform in which a machine-learning risk score is a
precondition of blockchain-enforced fund custody, connected through an oracle.

Miva Open University Abuja · Department of Software Engineering

---

## Repository layout

```
contracts/   Solidity contracts, Hardhat tests, deployment scripts   [built]
web/         Next.js presentation layer and access control           [built]
ml/          Experiment pipeline: data, training, evaluation         [built]
api/         FastAPI service and oracle bridge                       [service built, bridge pending]
docs/        Decision log and the evidence the report cites
```

## The four layers

| Layer | Implementation | Status |
| ----- | -------------- | ------ |
| Presentation | React 19 · Next.js App Router | Built |
| Application & intelligence | FastAPI · scikit-learn · PostgreSQL | Built |
| Oracle / integration | Web3.py bridge · event listener | Sprint 4 — next |
| Blockchain | Solidity 0.8.20 · Ethereum Sepolia | Built |

## Quick start

```bash
cp .env.example .env          # fill in before deploying or running production

# Contracts
cd contracts && npm install
npx hardhat test              # 62 tests
npx hardhat run scripts/deploy.js --network sepolia

# Presentation layer
cd web && npm install
npm run dev                   # http://localhost:3000

# Application and intelligence layer
cd api && python3.11 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python -m smartguard_api.seed
.venv/bin/uvicorn smartguard_api.main:app --reload --port 8000

# Experiment pipeline
cd ml && make setup
python scripts/make_sample_paysim.py    # stand-in, until PaySim is downloaded
make all
```

Credentials for Sepolia and the PaySim download are covered step by step in
[docs/SETUP-KEYS.md](docs/SETUP-KEYS.md).

## Evidence

`docs/evidence/` holds the artefacts the report cites, produced by tooling
rather than transcribed:

| File | Produced by | Closes |
| ---- | ----------- | ------ |
| `gas-report.txt` | `REPORT_GAS=true npx hardhat test` | Correction 17 — per-call receipts with min, max and call counts |
| `slither-report.txt` | `slither .` | Appendix A — the full static-analysis output, not a description of it |
| `deployment.sepolia.json` | `scripts/deploy.js` | Appendix A — addresses, transaction hashes, block numbers, compiler settings, commit |

`docs/DECISIONS.md` records every deviation from Chapters One and Three, with
the reason and the report edit it requires. The verification review's central
finding was that the report and the artefact had drifted apart; that file exists
so it cannot happen silently again.

## Measured against reported

The gas figures in Table 4.2 were reported without execution receipts. The
measured values differ, and the measured ones are now the record:

| Function | Table 4.2 | Measured (avg) |
| -------- | --------: | -------------: |
| `depositFunds` | 187,432 | 154,875 |
| `updateRiskScore` | 47,215 | 116,277 |
| `resolveDispute` | 91,203 | 51,940 |
| `claimRefund` | 63,870 | 44,792 |
| `initiateDispute` | 74,556 | 36,920 |
| `confirmDelivery` | 68,210 | 36,860 |

`updateRiskScore` costs more than reported because this implementation stores
the model version, a nonce and a timestamp in order to satisfy the replay and
expiry controls of Section 3.15.2. That is a design cost, and it is explainable;
the remaining figures were estimates that measurement has now replaced.
