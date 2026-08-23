"""Account data lifecycle: export everything, then erase everything.

The two rights a stored-personal-data product owes its users. Export must be
complete and scoped to the caller; delete must leave nothing behind and must
never reach into another account.
"""

import pytest

pytestmark = pytest.mark.asyncio


async def _seed(client, pfx):
    """Put one row in every user-owned family, so export/delete are exercised
    against the whole schema rather than a single table."""
    snapshot = {
        "items": [{"id": f"{pfx}-i1", "type": "note", "title": "note one", "date": "2026-08-19"}],
        "todos": {"tasks": [{"id": f"{pfx}-t1", "text": "do a thing", "created": "2026-08-19"}]},
        "boards": {"boards": [{
            "id": f"{pfx}-b1", "name": "Board", "seq": 1, "current": f"{pfx}-s1",
            "sprints": [{"id": f"{pfx}-s1", "name": "Sprint 1", "ended": None}],
            "cols": [{"id": f"{pfx}-c1", "title": "To do",
                      "cards": [{"id": f"{pfx}-k1", "num": 1, "text": "card one"}]}],
        }]},
    }
    assert (await client.post("/sync/import", json=snapshot)).status_code == 200
    assert (await client.post("/finance/expenses", json={
        "id": f"{pfx}-e1", "desc": "coffee", "amount_cents": 450,
        "cat": "Food", "spent_on": "2026-08-19"})).status_code == 201
    assert (await client.post("/tags", params={"tag": "project-x"})).status_code == 201


async def test_export_returns_the_whole_account(client, pfx):
    await _seed(client, pfx)
    r = await client.get("/account/export")
    assert r.status_code == 200
    assert "attachment" in r.headers.get("content-disposition", "")
    data = r.json()

    assert data["format"] == "vault-account-export"
    assert data["counts"]["items"] == 1
    assert data["counts"]["tasks"] == 1
    assert data["counts"]["boards"] == 1
    assert data["counts"]["sprints"] == 1
    assert data["counts"]["columns"] == 1
    assert data["counts"]["cards"] == 1
    assert data["counts"]["expenses"] == 1
    assert data["counts"]["tags"] == 1
    # The card lives two tables deep — prove nested data is actually reached.
    assert data["cards"][0]["text"] == "card one"
    # Money stays exact integer cents in the export.
    assert data["expenses"][0]["amount_cents"] == 450


async def test_export_is_scoped_to_the_caller(client, pfx, other_client):
    await _seed(client, pfx)
    other = other_client.vault_user_id
    await other_client.post("/items/upsert", json={
        "client_id": f"{other}-x", "type": "note", "title": "not yours",
        "meta": "", "status": "Inbox", "tags": [], "added_on": "2026-08-19", "deleted_on": None})

    data = (await client.get("/account/export")).json()
    titles = [i["title"] for i in data["items"]]
    assert "note one" in titles
    assert "not yours" not in titles


async def test_delete_erases_everything(client, pfx):
    await _seed(client, pfx)
    r = await client.delete("/account")
    assert r.status_code == 200
    body = r.json()
    assert body["deleted"] is True
    assert body["rows"]["items"] == 1
    assert body["rows"]["tasks"] == 1
    assert body["rows"]["cards"] == 1
    assert body["rows"]["expenses"] == 1

    # Nothing survives.
    assert (await client.get("/items")).json() == []
    assert (await client.get("/todos")).json() == []
    assert (await client.get("/boards")).json() == []
    # A still-authenticated request re-materialises an EMPTY user shell (the app
    # provisions the user on any authed request; in the real flow the client
    # signs out right after delete). What erasure guarantees is that no DATA
    # comes back with it.
    after = (await client.get("/account/export")).json()
    assert all(v == 0 for v in after["counts"].values())
    prof = after["profile"]
    assert prof is None or (not prof.get("name") and not prof.get("email") and not prof.get("prefs"))


async def test_delete_does_not_touch_another_account(client, pfx, other_client):
    await _seed(client, pfx)
    other = other_client.vault_user_id
    await other_client.post("/items/upsert", json={
        "client_id": f"{other}-x", "type": "note", "title": "survivor",
        "meta": "", "status": "Inbox", "tags": [], "added_on": "2026-08-19", "deleted_on": None})

    assert (await client.delete("/account")).status_code == 200

    # The other account is untouched.
    survivors = (await other_client.get("/items")).json()
    assert [i["title"] for i in survivors] == ["survivor"]
