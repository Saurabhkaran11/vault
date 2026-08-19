"""Money must be exact.

These lock in the reason the schema uses integer cents: the float version of
the same arithmetic is off by a fraction of a cent, which is enough to trip
a budget comparison and print a wrong total.
"""

import pytest

pytestmark = pytest.mark.asyncio


async def test_expense_sum_is_exact_where_float_would_drift(client):
    """100 mixed expenses that must total exactly $928.50.

    As floats this sums to 928.4999999999999 — see the assertion at the end.
    """
    amounts = [1999, 435, 10, 1270] * 25
    for i, cents in enumerate(amounts):
        r = await client.post("/finance/expenses", json={
            "id": f"m{i}", "desc": f"row {i}", "amount_cents": cents,
            "cat": "Food", "spent_on": "2026-08-19",
        })
        assert r.status_code == 201

    summary = (await client.get("/finance/summary?month=2026-08")).json()
    assert summary["spent_cents"] == 92850
    assert summary["by_category_cents"]["Food"] == 92850

    # The bug this schema exists to prevent:
    assert sum([19.99, 4.35, 0.1, 12.70] * 25) != 928.50


async def test_import_converts_dollars_to_cents_once(client):
    """/sync/import is the only endpoint taking dollars — it must round once,
    not accumulate error across rows."""
    r = await client.post("/sync/import", json={
        "finance": {
            "expenses": [{"id": "d1", "desc": "Odd cents", "amount": 0.1 + 0.2, "cat": "Food", "date": "2026-08-19"}],
            "goals": [{"id": "g1", "name": "Trip", "target": 2000, "saved": 250.5}],
            "budgets": {"overall": 500, "byCat": {"Food": 150}},
        }
    })
    assert r.status_code == 200

    # 0.1 + 0.2 is 0.30000000000000004 in binary floating point; it must land
    # as exactly 30 cents, not 30.000000000000004 or a truncated 29.
    assert (await client.get("/finance/expenses")).json()[0]["amount_cents"] == 30
    goal = (await client.get("/finance/goals")).json()[0]
    assert (goal["target_cents"], goal["saved_cents"]) == (200000, 25050)
    assert (await client.get("/finance/summary")).json()["budgets_cents"] == {"overall": 50000, "Food": 15000}


async def test_paying_recurring_bill_carries_exact_amount(client):
    await client.post("/finance/bills", json={
        "id": "b1", "title": "Rent", "amount_cents": 123456,
        "due": "2026-08-01", "recur": "monthly",
    })
    paid = (await client.post("/finance/bills/b1/pay")).json()
    assert len(paid) == 2, "a recurring bill should schedule its next occurrence"
    assert paid[1]["amount_cents"] == 123456
    assert paid[1]["due"] == "2026-09-01"
    assert paid[1]["paid"] is False
