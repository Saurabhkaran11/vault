"""The sync contract the frontend depends on.

Every mirror call must be safe to replay: the retry queue re-sends jobs in
order after an outage, so a POST that duplicates or a DELETE that 404s would
either corrupt the vault or wedge the queue permanently.
"""

import pytest

pytestmark = pytest.mark.asyncio


async def test_item_upsert_is_idempotent(client, pfx):
    body = {
        "client_id": f"{pfx}-1", "type": "note", "title": "First",
        "meta": "m", "status": "Inbox", "tags": ["a"], "added_on": "2026-08-19",
        "deleted_on": None,
    }
    assert (await client.post("/items/upsert", json=body)).status_code in (200, 201)
    body["title"] = "Second"
    assert (await client.post("/items/upsert", json=body)).status_code in (200, 201)

    items = (await client.get("/items")).json()
    assert len(items) == 1, "replaying a mirror must update, never duplicate"
    assert items[0]["title"] == "Second"


async def test_delete_is_idempotent(client, pfx):
    await client.post("/todos", json={"id": f"{pfx}-t1", "text": "x", "created_on": "2026-08-19"})
    assert (await client.delete(f"/todos/{pfx}-t1")).status_code == 200
    # A replayed DELETE for an already-deleted row must still succeed, or the
    # queue stops on it forever.
    assert (await client.delete(f"/todos/{pfx}-t1")).status_code == 200


async def test_import_is_idempotent_and_updates_in_place(client, pfx):
    snapshot = {
        "items": [{"id": f"{pfx}-i1", "type": "note", "title": "v1", "date": "2026-08-19"}],
        "todos": {"tasks": [{"id": f"{pfx}-t1", "text": "v1", "created": "2026-08-19"}]},
        "boards": {"boards": [{
            "id": f"{pfx}-b1", "name": "Board", "seq": 1, "current": "s1",
            "sprints": [{"id": f"{pfx}-s1", "name": "Sprint 1", "ended": None}],
            "cols": [{"id": f"{pfx}-c1", "title": "To do", "cards": [{"id": f"{pfx}-k1", "num": 1, "text": "card"}]}],
        }]},
    }
    assert (await client.post("/sync/import", json=snapshot)).status_code == 200

    snapshot["items"][0]["title"] = "v2"
    snapshot["todos"]["tasks"][0]["text"] = "v2"
    assert (await client.post("/sync/import", json=snapshot)).status_code == 200

    assert [i["title"] for i in (await client.get("/items")).json()] == ["v2"]
    assert [t["text"] for t in (await client.get("/todos")).json()] == ["v2"]
    boards = (await client.get("/boards")).json()
    assert len(boards) == 1
    assert len(boards[0]["sprints"]) == 1, "re-import must not duplicate sprints"
    assert len(boards[0]["columns"][0]["cards"]) == 1


async def test_board_snapshot_replaces_children_without_orphans(client, pfx):
    def snap(cards):
        return {
            "id": f"{pfx}-b1", "name": "Board", "seq": len(cards), "current": "s1",
            "sprints": [{"id": f"{pfx}-s1", "name": "S1", "ended": None}],
            "cols": [{"id": f"{pfx}-c1", "title": "To do",
                      "cards": [{"id": f"{pfx}-{k}", "num": n + 1, "text": k} for n, k in enumerate(cards)]}],
        }

    await client.put(f"/boards/{pfx}-b1/snapshot", json=snap(["k1", "k2"]))
    await client.put(f"/boards/{pfx}-b1/snapshot", json=snap(["k2"]))   # k1 removed

    cards = (await client.get("/boards")).json()[0]["columns"][0]["cards"]
    assert [c["id"] for c in cards] == [f"{pfx}-k2"]


async def test_expense_logged_event_fires_once_per_real_insert(client, pfx):
    """A replayed mirror must not re-notify the user."""
    from app.db import SessionLocal
    from app.models import Event
    from sqlalchemy import select

    body = {"id": f"{pfx}-e1", "desc": "Coffee", "amount_cents": 450, "cat": "Food", "spent_on": "2026-08-19"}
    await client.post("/finance/expenses", json=body)
    await client.post("/finance/expenses", json=body)

    uid = client.headers["X-User-Id"]
    async with SessionLocal() as s:
        events = (await s.execute(
            select(Event).where(Event.user_id == uid, Event.kind == "expense.logged")
        )).scalars().all()
    assert len(events) == 1
