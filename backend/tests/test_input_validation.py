"""Bad input must be a 4xx, never a 500.

Each of these was a real crash found by probing the running API. A 500 is
worse than a rejection twice over: the caller gets no idea what to fix, and
the operator gets a spurious alert from what is really a typo.
"""

import pytest

pytestmark = pytest.mark.asyncio


@pytest.mark.parametrize("month", ["2026", "bad", "2026-13", "2026-00", "2026-99", "0000-01-01"])
async def test_malformed_month_is_rejected_not_crashed(client, month):
    """`month` is sliced and int()-ed into date(), so anything that is not
    exactly YYYY-MM used to raise ValueError and surface as a 500."""
    assert (await client.get(f"/finance/expenses?month={month}")).status_code == 422
    assert (await client.get(f"/finance/summary?month={month}")).status_code == 422


async def test_valid_month_still_works(client):
    assert (await client.get("/finance/expenses?month=2026-08")).status_code == 200
    assert (await client.get("/finance/summary?month=2026-08")).status_code == 200


@pytest.mark.parametrize("k", [-9, 0, 100000])
async def test_ask_k_is_bounded(client, k):
    """k goes straight into SQL LIMIT: negative is a database error, and huge
    would stuff the whole index into a prompt."""
    r = await client.post("/ai/ask", json={"question": "x", "k": k})
    assert r.status_code == 422


async def test_ask_requires_a_question(client):
    assert (await client.post("/ai/ask", json={"question": ""})).status_code == 422


async def test_money_above_the_old_integer_ceiling_is_accepted(client, pfx):
    """Money columns are BIGINT. INTEGER capped a single row at 21,474,836
    major units — fine for dollars, but the app also offers INR and JPY,
    where that is an ordinary large purchase, and it crashed with a 500."""
    over = 2_147_483_648          # one cent past the old ceiling
    r = await client.post("/finance/expenses", json={
        "id": f"{pfx}-big", "desc": "property", "amount_cents": over,
        "cat": "Other", "spent_on": "2026-08-19"})
    assert r.status_code == 201
    assert (await client.get("/finance/expenses")).json()[0]["amount_cents"] == over


async def test_large_amounts_sum_exactly(client, pfx):
    """The point of integer money is exact aggregation; widening the column
    must not have quietly reintroduced a float anywhere."""
    amounts = [900_000_000_000, 99_999_999_999, 1]
    for i, cents in enumerate(amounts):
        await client.post("/finance/expenses", json={
            "id": f"{pfx}-b{i}", "desc": f"big {i}", "amount_cents": cents,
            "cat": "Other", "spent_on": "2026-08-19"})
    summary = (await client.get("/finance/summary?month=2026-08")).json()
    assert summary["spent_cents"] == sum(amounts)
