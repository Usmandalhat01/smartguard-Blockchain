# Decision log

Every deviation from the specification in Chapters One and Three, with the
reason and the report edit it requires.

The verification review's central finding was that the report and the artefact
had drifted apart. This file exists so that cannot happen silently again: a
decision is recorded here at the moment it is made, and the "Report edit"
column is the checklist for the next revision of the document.

---

## D-001 · Solidity 0.8.19 → 0.8.20

**Status** Applied
**Affects** Table 3.3, Section 3.8, Section 3.15.1

Table 3.3 specifies Solidity 0.8.19 *and* OpenZeppelin Contracts 5.0. These are
mutually exclusive: OpenZeppelin 5.0 declares `pragma solidity ^0.8.20` across
`Ownable`, `ReentrancyGuard` and `Address`, and the compiler refuses the import
at 0.8.19.

0.8.20 is the smallest change that satisfies both. Section 3.15.1's security
argument is that the 0.8.x compiler line provides native integer overflow and
underflow protection, replacing SafeMath — that argument is unaffected by the
patch version.

The alternative was to drop to OpenZeppelin 4.9, but Table 3.3 names 5.0, 4.9 is
superseded, and 5.0's `Ownable(initialOwner)` constructor is the pattern used
throughout the contracts.

**Report edit** In Table 3.3 and Section 3.8, change the Solidity version to
0.8.20 and add a footnote: *"0.8.20 is the minimum version compatible with
OpenZeppelin Contracts 5.0."*

---

## D-002 · React 18.2 → React 19 via Next.js 16 App Router

**Status** Applied
**Affects** Table 3.3, Section 3.7, new Section 3.15.3

Table 3.3 specifies React 18.2. The presentation layer is built on React 19
through the Next.js App Router.

The reason is access control. Section 3.5.1 gives four stakeholder categories
with materially different authority, and FR-03 and FR-05 both make exclusivity
claims ("only the designated buyer", "only the designated arbitrator"). Enforcing
those requires session verification and route admission on the server, before a
page renders. A client-only React bundle can hide a control but cannot refuse a
request, and access control that exists only in the browser is not access
control.

**Report edit** In Table 3.3, record "React 19 via Next.js 16 (App Router)" with
the justification "server-side session verification and route admission required
for role-based access control". Add Section 3.15.3 documenting the role and
permission model.

---

## D-003 · Escrow identifiers are deterministic and client-derived

**Status** Applied
**Affects** Section 3.11.3, Figure 3.7

Section 3.14.2 has the oracle write a risk score against a transaction
identifier, and Section 3.11.3 has `depositFunds` read that score back. The
identifier must therefore exist before either call, but neither section says how
it is allocated.

`EscrowContract.computeEscrowId(buyer, seller, amount, nonce)` derives it as a
`keccak256` hash. It is a `pure` function, so the oracle bridge, the interface
and the contract all compute the same value independently with no round trip and
no allocating transaction.

This matches the sequence Figure 3.7 already draws — score written first, then
`depositFunds` — which the two-phase alternative would have required redrawing.

**Report edit** In Section 3.11.3, state how the escrow identifier is derived.
Figure 3.7 needs no change.

---

## D-004 · A missing risk score is a refusal, not a pass

**Status** Applied
**Affects** Section 3.11.3, Section 3.15.2

`depositFunds` reverts with `NoRiskAssessment` when the oracle holds no score for
the escrow, rather than reading a default of zero and treating it as low risk.

Section 3.15.2 requires the system to fail closed when the model is unavailable
or returns a malformed value. Solidity's default-zero semantics would have made
an absent assessment indistinguishable from the safest possible one, which
inverts that requirement precisely.

**Report edit** In Section 3.11.3, add that `depositFunds` reverts when no
assessment exists, and note it as the on-chain half of the fail-closed
requirement in Section 3.15.2.

---

## D-005 · Risk scores are written once and never amended

**Status** Applied
**Affects** Section 3.14.2

`RiskOracleContract.updateRiskScore` reverts on a second write for the same
escrow.

A mutable score would let a compromised or coerced relay lower an assessment
after an escrow had been refused, and re-submit. Immutability closes that path,
and it is also what makes the on-chain record an audit trail rather than a cache:
the value that governed the contract's behaviour is the value that stays in the
ledger.

**Report edit** In Section 3.14.2, record that assessments are single-write.

---

## D-006 · Slither timestamp findings accepted, with justification

**Status** Accepted, not remediated
**Affects** Section 3.15.1, Appendix A

Slither 0.11.4 reports three findings against the contracts, all from the
`timestamp` detector and all low severity. There are no high or medium severity
findings.

| Location | Comparison |
| -------- | ---------- |
| `EscrowContract.releaseFunds` | `block.timestamp < unlocksAt` |
| `EscrowContract.claimRefund` | `block.timestamp < holdingPeriodEndsAt` |
| `RiskOracleContract.updateRiskScore` | `block.timestamp > expiry` |

The detector flags any dependence on `block.timestamp`, because a validator can
nudge it by a small margin. The relevant question is whether that margin is
material to the comparison, and here it is not: the time lock is 48 hours, the
holding period is seven days, and the oracle expiry window is minutes. A
manipulation of a few seconds cannot change the outcome of any of them.

Rewriting these to block heights would be worse, not better. Block intervals
vary, so a height-based lock would express "roughly 48 hours" less precisely than
a timestamp does, and it would make the interface unable to show a party when
their window actually closes.

**Report edit** Section 3.15.1 currently states that "all high-severity findings
were resolved before deployment". Replace with the specific result: no high or
medium severity findings; three low-severity timestamp-dependence findings
accepted on the grounds above. Attach `docs/evidence/slither-report.txt` to
Appendix A rather than describing it.
