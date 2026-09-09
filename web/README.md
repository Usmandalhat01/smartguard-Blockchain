# SmartGuard — presentation layer

Blockchain-Enhanced AI-Powered Transaction System for Fraud Detection and Risk
Analysis.

This repository holds the **presentation layer** (layer 1 of the four-layer
architecture in Section 3.7 of the project report) plus the access-control model
that governs it. The application/intelligence, oracle/integration and blockchain
layers are not yet connected; until they are, the interface runs against a
deterministic local stand-in and labels every figure it shows accordingly.

## Running it

```bash
npm install
cp .env.example .env.local        # then fill in SESSION_SECRET
npm run dev                       # http://localhost:3000
```

`SESSION_SECRET` is optional in development (a fixed development key is used and
the fallback is documented in `lib/auth/session.ts`). In production it is
**required** — the application refuses to sign sessions with a key that is
published in the source tree.

Generate one with `openssl rand -base64 48`.

### Evaluation accounts

Each role is a separate sign-in. The credentials are printed on the login screen
and defined in `lib/auth/accounts.ts`.

| Role          | Email                       | Password               |
| ------------- | --------------------------- | ---------------------- |
| Buyer         | `amina.yusuf@example.ng`    | `buyer-demo-2026`      |
| Seller        | `tunde.okafor@example.ng`   | `seller-demo-2026`     |
| Arbitrator    | `n.eze@arbitration.ng`      | `arbitrator-demo-2026` |
| Administrator | `operator@smartguard.ng`    | `admin-demo-2026`      |

## Access control

Authorisation is defined once, in `lib/auth/policy.ts`, and enforced at three
depths:

1. **Route admission** — `proxy.ts` verifies the session cookie's signature and
   compares the role against the route table. This is an optimistic pre-filter,
   not the boundary.
2. **Server components** — every protected page calls `requirePermission()`
   from `lib/auth/server.ts` before rendering. This is where authorisation is
   actually decided today.
3. **Object level** — `canConfirmDelivery`, `canResolveDispute` and the rest
   mirror the modifiers on `EscrowContract` one for one, so the interface never
   offers an action the chain would revert.

Sessions are compact HS256 JWS tokens in an `HttpOnly; Secure; SameSite=Lax`
cookie. The browser can neither read the token nor forge a role.

| Role          | Permissions |
| ------------- | ----------- |
| Buyer         | `escrow:create`, `escrow:read:own`, `escrow:confirm-delivery`, `escrow:claim-refund`, `dispute:raise`, `dispute:read:own` |
| Seller        | `escrow:read:own`, `escrow:withdraw`, `dispute:raise`, `dispute:read:own` |
| Arbitrator    | `escrow:read:any`, `dispute:read:any`, `dispute:resolve` |
| Administrator | `escrow:read:any`, `dispute:read:any`, `admin:settings:read`, `admin:settings:write`, `admin:model:read`, `admin:audit:read`, `admin:users:read` |

Grants are additive and no role inherits from another. The administrator
deliberately holds **no** permission to move funds, because on chain it has no
such capability either.

## Layout

```
app/
  page.tsx                  landing page — what the system is and is not
  login/                    authentication
  forbidden/                403, showing the permission required vs. held
  api/auth/                 session issue and revocation
  (app)/                    everything behind a session
    escrows/                list, initiation, per-escrow detail
    disputes/               arbitrator queue
    admin/                  system overview, model card, risk config, audit log
components/                 shared UI and the domain visualisations
lib/
  auth/                     policy, session tokens, account directory
  types.ts                  domain model — mirrors the PostgreSQL schema (3.9.2)
  features.ts               the eighteen-feature vector (Table 3.4)
  engine.ts                 deterministic stand-in for the scoring service
  seed.ts                   seeded demonstration dataset
  store-core.ts             observable data layer
  api.ts                    the seam to the FastAPI service
proxy.ts                    route admission
```

## Where the report is encoded in the code

The interface is built to be defensible at viva, so the requirements it
implements are named in the code rather than implied.

| Requirement | Where |
| ----------- | ----- |
| FR-01 escrow initiation | `app/(app)/escrows/new/form.tsx` |
| FR-02 risk assessment gate | same file — the gate runs before any on-chain call |
| FR-03 delivery confirmation, 48h time lock | `lib/store-core.ts`, `lib/auth/policy.ts` |
| FR-04 dispute initiation | `components/dispute-dialog.tsx` |
| FR-05 dispute resolution | `components/resolve-dialog.tsx` |
| FR-06 automatic refund | `canClaimRefund` in `lib/auth/policy.ts` |
| FR-07 transaction history | `app/(app)/escrows/[id]/detail.tsx` |
| FR-08 risk score display | `RiskDial`, `ContributionBars` in `components/domain.tsx` |
| FR-09 audit logging | `app/(app)/admin/audit/log.tsx` |
| NFR-01 2s scoring budget | shown against every inference time |
| Four-layer architecture (3.7) | `LayerTrace` in `components/domain.tsx` |
| Four-state machine (3.11.1) | `StateMachine` in `components/domain.tsx` |
| Eighteen features (Table 3.4) | `lib/features.ts` |
| 70:15:15 partition (Table 3.5) | `app/(app)/admin/model/card.tsx` |

## Evidential discipline

Chapter Four of the report could not reproduce its own classification results.
The interface is written so that it cannot repeat that mistake:

- **No unverified metrics are displayed.** The model page deliberately omits
  accuracy, precision, recall, F1 and ROC-AUC, and says why.
- **Every unbacked figure is labelled.** While `NEXT_PUBLIC_API_URL` is unset, a
  persistent banner states that scores, hashes, gas figures and addresses are
  placeholders rather than measurements.
- **Simulated proxy features are marked as such** wherever they appear, with the
  caveat from Section 3.12.5 attached.
- **Scores are deterministic.** `lib/engine.ts` is seeded, so the same input
  always yields the same score and a screenshot taken twice shows the same
  number.
- **Seed data cannot contradict itself.** `lib/seed.ts` asserts that every
  seeded escrow scored at or below the gate in force; an escrow above it would
  contradict its own audit trail, and the module throws rather than shipping it.
- **The threshold in force is stored with each prediction**, so changing the gate
  later does not rewrite the meaning of a past decision.

## Connecting the backend

Set `NEXT_PUBLIC_API_URL` and the interface routes scoring through the FastAPI
service instead of the local stand-in, flips the score source badge from
"Local stand-in" to "Trained model", and drops the demonstration banner.

`lib/api.ts` declares the endpoint contract the backend must satisfy.

## Checks

```bash
npm run build     # type-checks and compiles
npm run lint      # ESLint, including the React compiler rules
```
