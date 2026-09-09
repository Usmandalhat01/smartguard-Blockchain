"""The two policy copies must not drift.

`smartguard_api/policy.py` and `web/lib/auth/policy.ts` express the same
permission model. Only the Python copy is a security boundary; the TypeScript
copy decides which controls to render. Both are necessary, and duplication that
drifts is worse than no duplication at all — a control the interface offers that
the API refuses is a bug the user experiences as a broken product.

This test parses the TypeScript and asserts the grant tables are identical. If
someone adds a permission on one side only, it fails here.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from smartguard_api.models import Role
from smartguard_api.policy import ROLE_PERMISSIONS

WEB_POLICY = Path(__file__).resolve().parents[2] / "web" / "lib" / "auth" / "policy.ts"


def parse_typescript_grants() -> dict[str, set[str]]:
    """Extracts ROLE_PERMISSIONS from the TypeScript source.

    A regex rather than a TypeScript parser: the block is a plain object
    literal, and the alternative is a Node dependency in a Python test suite.
    The shape is asserted below, so a change that breaks the assumption fails
    loudly rather than silently matching nothing.
    """
    source = WEB_POLICY.read_text()

    block = re.search(
        r"export const ROLE_PERMISSIONS[^=]*=\s*\{(.*?)\n\};",
        source,
        re.DOTALL,
    )
    assert block, f"Could not locate ROLE_PERMISSIONS in {WEB_POLICY}"

    grants: dict[str, set[str]] = {}
    for role, body in re.findall(r"(\w+):\s*\[(.*?)\]", block.group(1), re.DOTALL):
        grants[role] = set(re.findall(r"'([^']+)'", body))

    assert grants, "Parsed no roles; the TypeScript shape has changed"
    return grants


def test_same_roles_on_both_sides():
    typescript = parse_typescript_grants()
    python = {role.value for role in ROLE_PERMISSIONS}
    assert set(typescript) == python


@pytest.mark.parametrize("role", list(Role))
def test_same_permissions_per_role(role: Role):
    typescript = parse_typescript_grants()
    expected = set(ROLE_PERMISSIONS[role])
    actual = typescript[role.value]

    assert actual == expected, (
        f"{role.value} grants differ between the layers.\n"
        f"  only in web/lib/auth/policy.ts: {sorted(actual - expected)}\n"
        f"  only in smartguard_api/policy.py: {sorted(expected - actual)}"
    )


def test_administrator_cannot_move_funds():
    """A property worth asserting rather than merely intending.

    On chain the owner has no authority over an escrow's funds — there is no
    modifier that would let it. Modelling an administrator who could would
    misrepresent the contract in the interface.
    """
    admin_grants = set(ROLE_PERMISSIONS[Role.ADMIN])
    fund_moving = {
        "escrow:create",
        "escrow:confirm-delivery",
        "escrow:claim-refund",
        "escrow:withdraw",
        "dispute:resolve",
    }
    assert not (admin_grants & fund_moving)


def test_no_role_inherits_from_another():
    """Grants are additive and flat. If one role's set became a superset of
    another's it would be indistinguishable from inheritance, and a reader would
    reasonably expect changes to propagate — which they would not."""
    sets = {role: set(perms) for role, perms in ROLE_PERMISSIONS.items()}
    for role_a, grants_a in sets.items():
        for role_b, grants_b in sets.items():
            if role_a is role_b:
                continue
            assert not grants_a.issuperset(grants_b), (
                f"{role_a.value} is a superset of {role_b.value}, which reads as "
                "inheritance but is not"
            )
