# Application and intelligence layer

FastAPI service holding the off-chain records, the risk-scoring model and the
authoritative access control.

## Running it

```bash
python3.11 -m venv .venv
.venv/bin/pip install -r requirements.txt

# Schema and the four development accounts
.venv/bin/python -m smartguard_api.seed

.venv/bin/uvicorn smartguard_api.main:app --reload --port 8000
```

Interactive documentation at <http://localhost:8000/docs>.

Point the presentation layer at it by setting `NEXT_PUBLIC_API_URL=http://localhost:8000`
in the repository `.env`. The interface then drops its demonstration banner and
its score-source badge changes from "Local stand-in" to "Trained model".

## Where authorisation is decided

`smartguard_api/policy.py` is the authoritative copy of the permission model.
`web/lib/auth/policy.ts` holds the same model so the interface knows which
controls to render — but only this one is a security boundary. The browser copy
is a rendering hint, and a request that reaches this service is checked here
regardless of what the client believed.

Duplication that drifts is worse than no duplication, so `tests/test_policy_parity.py`
parses the TypeScript and asserts the two grant tables are identical. A
permission added on one side only fails that test.

Three depths of check:

1. **Role permission** — `Depends(require("dispute:resolve"))` on the route.
2. **Object level** — `policy.can_resolve_dispute(user, tx, dispute)` inside the
   handler, mirroring the contract's modifiers one for one.
3. **The contract** — the only one that cannot be bypassed.

Read routes are scoped in the query, not filtered after loading, so a request
for another party's escrow returns nothing rather than being fetched and then
discarded. `GET /escrows/{ref}` answers 404 rather than 403 for an escrow the
caller may not see: a 403 would confirm that an escrow with that reference
exists.

## Failing closed

Section 3.15.2 requires that no automated fund release follow a failed or
malformed inference. Three behaviours implement it:

- The model is loaded once at startup. If it is absent or fails to load, the
  service still starts and `/health` reports `degraded` — but no escrow can be
  admitted.
- A score outside [0, 1], or a `NaN`, raises `InferenceUnavailable`. It is never
  clamped into range and used. A default of zero would read as "safest
  possible", which is the opposite of what an unavailable model means.
- When scoring fails, `failClosedOnInferenceError` decides between refusing the
  escrow outright and routing it to manual review. Neither path releases funds
  and neither invents a score.

## Endpoints

| Method | Path | Permission |
| ------ | ---- | ---------- |
| POST | `/api/v1/auth/login` | — |
| GET | `/api/v1/health` | — |
| POST | `/api/v1/risk/score` | `escrow:create` |
| POST | `/api/v1/escrows` | `escrow:create` |
| GET | `/api/v1/escrows` | scoped to what the principal may read |
| GET | `/api/v1/escrows/{ref}` | object-level |
| POST | `/api/v1/escrows/{ref}/confirm-delivery` | buyer, from INITIATED |
| POST | `/api/v1/escrows/{ref}/withdraw` | seller, after the time lock |
| POST | `/api/v1/escrows/{ref}/dispute` | either party |
| POST | `/api/v1/escrows/{ref}/resolve` | that escrow's arbitrator |
| POST | `/api/v1/escrows/{ref}/refund` | buyer, after the holding period |
| GET/PUT | `/api/v1/admin/settings` | `admin:settings:read` / `:write` |
| GET | `/api/v1/admin/audit` | `admin:audit:read` |
| GET | `/api/v1/admin/model` | `admin:model:read` |

Every response carries `X-Response-Time-Ms`. Correction 17 found the latency
evidence unusable because the measurement conditions were not retained; a header
on every response means a load test measures rather than reconstructs.

## Tests

```bash
.venv/bin/pytest
```

The suite runs against SQLite in a temporary file. The models use portable types
so this works with no service to start; nothing Postgres-specific is relied on.

## Not yet built

The oracle bridge and the event listener (Sprint 4). Until they exist,
`Transaction.escrow_id` holds a `pending:` placeholder rather than the
`keccak256` identifier the contract computes, and no state written here reaches
the chain. The chain is the authority for escrow state; this service will be a
projection of it, updated by the event listener rather than by request handlers.
