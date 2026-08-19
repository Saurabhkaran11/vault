"""One account must never see or touch another's data.

This is the property that matters most once the app is public, so it is
tested per feature rather than spot-checked — a missing `user_id` filter in
any single query is a data breach, not a bug.
"""

import pytest

pytestmark = pytest.mark.asyncio


async def _seed(c, marker):
    await c.post("/items/upsert", json={
        "client_id": f"{marker}-item", "type": "note", "title": f"{marker} note",
        "status": "Inbox", "tags": [], "added_on": "2026-08-19", "deleted_on": None})
    await c.post("/todos", json={"id": f"{marker}-task", "text": f"{marker} task", "created_on": "2026-08-19"})
    await c.post("/finance/expenses", json={
        "id": f"{marker}-exp", "desc": f"{marker} spend", "amount_cents": 100,
        "cat": "Food", "spent_on": "2026-08-19"})
    await c.post("/tags", params={"tag": f"{marker}tag"})


async def test_lists_never_leak_across_accounts(client, other_client):
    await _seed(client, "mine")
    await _seed(other_client, "theirs")

    assert [i["title"] for i in (await client.get("/items")).json()] == ["mine note"]
    assert [t["text"] for t in (await client.get("/todos")).json()] == ["mine task"]
    assert [e["desc"] for e in (await client.get("/finance/expenses")).json()] == ["mine spend"]
    assert "theirstag" not in (await client.get("/tags")).json()


async def test_summary_totals_are_per_account(client, other_client):
    await client.post("/finance/expenses", json={
        "id": "a1", "desc": "mine", "amount_cents": 500, "cat": "Food", "spent_on": "2026-08-19"})
    await other_client.post("/finance/expenses", json={
        "id": "b1", "desc": "theirs", "amount_cents": 9999, "cat": "Food", "spent_on": "2026-08-19"})

    assert (await client.get("/finance/summary?month=2026-08")).json()["spent_cents"] == 500


async def test_cannot_read_another_accounts_row_by_id(client, other_client):
    await other_client.post("/todos", json={"id": "secret", "text": "theirs", "created_on": "2026-08-19"})
    # Guessing the id must not grant access.
    assert (await client.put("/todos/secret", json={
        "id": "secret", "text": "hijacked", "created_on": "2026-08-19"})).status_code == 404
    assert [t["text"] for t in (await other_client.get("/todos")).json()] == ["theirs"]


async def test_cannot_overwrite_another_accounts_row_via_upsert(client, other_client):
    await other_client.post("/finance/expenses", json={
        "id": "shared-id", "desc": "theirs", "amount_cents": 100, "cat": "Food", "spent_on": "2026-08-19"})

    r = await client.post("/finance/expenses", json={
        "id": "shared-id", "desc": "hijacked", "amount_cents": 1, "cat": "Fun", "spent_on": "2026-08-19"})
    assert r.status_code == 409, "a colliding id must be refused, never silently reassigned"
    assert (await other_client.get("/finance/expenses")).json()[0]["desc"] == "theirs"


async def test_import_refuses_colliding_ids_without_writing_anything(client, other_client):
    await other_client.post("/todos", json={"id": "dup", "text": "theirs", "created_on": "2026-08-19"})

    r = await client.post("/sync/import", json={
        "items": [{"id": 99, "type": "note", "title": "should not land", "date": "2026-08-19"}],
        "todos": {"tasks": [{"id": "dup", "text": "mine", "created": "2026-08-19"}]},
    })
    assert r.status_code == 409
    assert "dup" in str(r.json()["detail"]["colliding"])
    # The whole import must roll back — the un-colliding item must not survive.
    assert (await client.get("/items")).json() == []


async def test_rag_only_retrieves_your_own_items(client, other_client):
    await other_client.post("/items/upsert", json={
        "client_id": "secret-doc", "type": "note", "title": "Their private salary figures",
        "meta": "confidential", "status": "Inbox", "tags": [], "added_on": "2026-08-19", "deleted_on": None})
    await other_client.post("/ai/reindex")

    sources = (await client.post("/ai/ask", json={"question": "salary figures"})).json()["sources"]
    assert sources == [], "search must never surface another account's items"
