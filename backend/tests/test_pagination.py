"""Pagination, and the property that makes it safe.

A capped list endpoint is a data-loss risk for the restore path: if a read
silently returns the first N rows, restoring writes that partial set over a
complete local vault. Every list response therefore states the true total,
and these tests hold that line.
"""

import pytest

pytestmark = pytest.mark.asyncio


async def _seed_tasks(client, pfx, n):
    for i in range(n):
        r = await client.post("/todos", json={
            "id": f"{pfx}-t{i:03d}", "text": f"task {i:03d}", "created_on": "2026-08-19"})
        assert r.status_code in (200, 201)


async def test_total_count_is_reported_even_when_a_page_truncates(client, pfx):
    await _seed_tasks(client, pfx, 25)

    r = await client.get("/todos?limit=10&offset=0")
    assert r.status_code == 200
    assert len(r.json()) == 10, "the page must respect the limit"
    assert r.headers["X-Total-Count"] == "25", "the caller must be able to tell it got a slice"


async def test_paging_walks_every_row_exactly_once(client, pfx):
    await _seed_tasks(client, pfx, 25)

    seen, offset = [], 0
    while True:
        rows = (await client.get(f"/todos?limit=10&offset={offset}")).json()
        if not rows:
            break
        seen.extend(t["id"] for t in rows)
        offset += len(rows)

    assert len(seen) == 25
    assert len(set(seen)) == 25, "a stable sort must not repeat or drop rows across pages"


async def test_offset_past_the_end_is_empty_not_an_error(client, pfx):
    await _seed_tasks(client, pfx, 3)
    r = await client.get("/todos?limit=10&offset=999")
    assert r.status_code == 200
    assert r.json() == []
    assert r.headers["X-Total-Count"] == "3"


async def test_limit_is_capped_rather_than_unbounded(client, pfx):
    """A caller must not be able to ask for the whole table in one request."""
    r = await client.get("/todos?limit=99999")
    assert r.status_code == 422


async def test_expense_month_filter_counts_the_month_not_the_history(client, pfx):
    """The filter is pushed into SQL, so X-Total-Count describes the filtered
    set. If it described the unfiltered one, a paging client would loop
    forever waiting for rows that never come."""
    for i in range(4):
        await client.post("/finance/expenses", json={
            "id": f"{pfx}-aug{i}", "desc": f"aug {i}", "amount_cents": 100,
            "cat": "Food", "spent_on": "2026-08-19"})
    for i in range(3):
        await client.post("/finance/expenses", json={
            "id": f"{pfx}-jul{i}", "desc": f"jul {i}", "amount_cents": 100,
            "cat": "Food", "spent_on": "2026-07-15"})

    r = await client.get("/finance/expenses?month=2026-08")
    assert r.headers["X-Total-Count"] == "4"
    assert len(r.json()) == 4
    assert all(e["spent_on"].startswith("2026-08") for e in r.json())


async def test_items_search_paging_is_consistent(client, pfx):
    """`q` is refined in Python; the total must still describe the filtered
    set so a client can page a search without over- or under-reading."""
    for i in range(6):
        await client.post("/items/upsert", json={
            "client_id": f"{pfx}-i{i}", "type": "note",
            "title": "findme" if i < 4 else "other",
            "status": "Inbox", "tags": [], "added_on": "2026-08-19", "deleted_on": None})

    r = await client.get("/items?q=findme&limit=2&offset=0")
    assert r.headers["X-Total-Count"] == "4"
    assert len(r.json()) == 2
    rest = (await client.get("/items?q=findme&limit=2&offset=2")).json()
    assert len(rest) == 2
    ids = {i["client_id"] for i in r.json()} | {i["client_id"] for i in rest}
    assert len(ids) == 4, "pages of a search must not overlap"


async def test_deleted_items_are_excluded_from_the_count(client, pfx):
    """include_deleted moved into SQL; the total has to move with it."""
    for i in range(3):
        await client.post("/items/upsert", json={
            "client_id": f"{pfx}-d{i}", "type": "note", "title": f"n{i}",
            "status": "Inbox", "tags": [], "added_on": "2026-08-19",
            "deleted_on": "2026-08-18" if i == 0 else None})

    live = await client.get("/items")
    assert live.headers["X-Total-Count"] == "2"
    with_trash = await client.get("/items?include_deleted=true")
    assert with_trash.headers["X-Total-Count"] == "3"
