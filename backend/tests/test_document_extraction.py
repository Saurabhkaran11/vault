"""Reading uploaded documents so their CONTENTS are searchable.

Before this, a PDF contributed only its filename to the index — asking "what
languages are on my resume?" returned unrelated notes, because the resume had
never been read. These cover the extraction itself and the retrieval scoping
that makes "ask about *these* documents" possible.
"""

import pytest

from app.extract import Unsupported, chunk_text, extract_text

pytestmark = pytest.mark.asyncio


# ---------------------------------------------------------------- chunking

def test_short_text_is_a_single_chunk():
    assert chunk_text("A short note.") == ["A short note."]


def test_empty_text_produces_no_chunks():
    assert chunk_text("   \n  ") == []


def test_chunks_overlap_so_facts_on_a_boundary_stay_findable():
    """The classic RAG failure: a sentence split across two chunks is
    retrievable from neither, and the system looks like it "doesn't know"
    something plainly in the document."""
    text = " ".join(f"sentence number {i}." for i in range(400))
    chunks = chunk_text(text, size=600, overlap=150)

    assert len(chunks) > 1
    tail = chunks[0][-80:]
    assert tail in chunks[1], "consecutive chunks must share a window"


def test_chunking_covers_the_whole_document():
    """Overlap must not come at the cost of dropping content."""
    text = " ".join(f"token{i}" for i in range(2000))
    joined = " ".join(chunk_text(text, size=500, overlap=100))
    for probe in ("token0", "token999", "token1999"):
        assert probe in joined, f"{probe} was lost during chunking"


def test_chunking_terminates_on_pathological_input():
    """A guard against the infinite loop this shape of code invites: if the
    step ever computes as zero, the worker spins forever holding the queue."""
    assert len(chunk_text("x" * 5000, size=100, overlap=99)) < 500


# ------------------------------------------------------------- extraction

def test_plain_text_is_read():
    assert "hello world" in extract_text(b"hello world", filename="a.txt")


def test_markdown_and_csv_are_read():
    assert "col" in extract_text(b"col,other\n1,2", filename="data.csv")
    assert "Heading" in extract_text(b"# Heading", filename="notes.md")


def test_hyphenated_line_breaks_are_rejoined():
    """PDF text layers break words across lines; leaving them split gives the
    embedder tokens that do not exist."""
    assert "international" in extract_text(b"inter-\nnational", filename="a.txt")


def test_unknown_types_say_so_rather_than_indexing_junk():
    with pytest.raises(Unsupported):
        extract_text(b"\x00\x01\x02binary", filename="thing.bin")


def test_legacy_doc_explains_the_fix():
    with pytest.raises(Unsupported, match="docx"):
        extract_text(b"\xd0\xcf\x11\xe0legacy", filename="old.doc")


def test_a_file_with_no_text_layer_is_reported_not_silently_empty():
    """A scan and a failed read must not look identical — one is fixable with
    OCR, the other is a bug."""
    with pytest.raises(Unsupported, match="scan|text layer"):
        extract_text(b"   \n  \n ", filename="scanned.txt")


def test_oversized_files_are_refused_before_parsing():
    """Extraction is CPU-bound and runs in the worker; one pathological file
    must not stall the queue."""
    from app.extract import MAX_EXTRACT_BYTES

    with pytest.raises(Unsupported, match="larger than"):
        extract_text(b"x" * (MAX_EXTRACT_BYTES + 1), filename="huge.txt")


def test_a_real_pdf_round_trips():
    """Generated in-memory rather than committed as a fixture, so the test
    stays honest about what pypdf actually reads back."""
    pypdf = pytest.importorskip("pypdf")
    import io

    writer = pypdf.PdfWriter()
    writer.add_blank_page(width=200, height=200)
    buf = io.BytesIO()
    writer.write(buf)

    # A blank page has no text layer — which is exactly the scan case.
    with pytest.raises(Unsupported):
        extract_text(buf.getvalue(), filename="blank.pdf")


# -------------------------------------------------------- indexed content

async def test_extracted_text_becomes_searchable_chunks(client):
    """The whole point: a document's body, not just its name, is indexed."""
    from app.db import SessionLocal
    from app.models import Item
    from app.routers.ai import index_item, item_chunks
    from sqlalchemy import select

    uid = client.headers["X-User-Id"]
    await client.post("/items/upsert", json={
        "client_id": "d1", "type": "doc", "title": "Contract",
        "meta": "Saved via quick drop", "status": "Inbox", "tags": [],
        "added_on": "2026-08-20", "deleted_on": None})

    async with SessionLocal() as s:
        item = (await s.execute(select(Item).where(Item.user_id == uid))).scalars().one()

        before = item_chunks(item)
        assert not any("notice period" in c for c in before), "nothing indexed yet"

        item.extracted_text = "Either party may terminate with a notice period of thirty days."
        after = item_chunks(item)

    assert any("notice period" in c for c in after)
    assert len(after) > len(before)


async def test_asking_can_be_scoped_to_specific_documents(client):
    """"Ask about these two contracts" — scoping must happen inside the
    ranked query, not by filtering results afterwards, or a narrow question
    routinely comes back empty."""
    from app.db import SessionLocal
    from app.models import Item
    from app.routers.ai import index_item
    from sqlalchemy import select

    uid = client.headers["X-User-Id"]
    for cid, title, kind in (("a", "Alpha doc", "doc"), ("b", "Beta note", "note")):
        await client.post("/items/upsert", json={
            "client_id": cid, "type": kind, "title": title, "meta": "",
            "status": "Inbox", "tags": [], "added_on": "2026-08-20", "deleted_on": None})

    # Index inline: /ai/reindex hands the work to the worker, and no worker
    # runs during tests. What is under test here is retrieval scoping.
    async with SessionLocal() as s:
        for item in (await s.execute(select(Item).where(Item.user_id == uid))).scalars():
            await index_item(s, item)
        await s.commit()

    everything = (await client.post("/ai/ask", json={"question": "alpha beta"})).json()["sources"]
    just_notes = (await client.post("/ai/ask", json={"question": "alpha beta", "types": ["note"]})).json()["sources"]

    assert len(everything) >= 2
    assert just_notes and all(s["type"] == "note" for s in just_notes)


async def test_scoping_cannot_reach_another_accounts_document(client, other_client):
    """Scoping narrows within your own vault; it must never widen access."""
    await other_client.post("/items/upsert", json={
        "client_id": "theirs", "type": "doc", "title": "Their private contract",
        "meta": "", "status": "Inbox", "tags": [], "added_on": "2026-08-20", "deleted_on": None})
    from app.db import SessionLocal
    from app.models import Item
    from app.routers.ai import index_item
    from sqlalchemy import select

    async with SessionLocal() as s:
        for item in (await s.execute(
            select(Item).where(Item.user_id == other_client.vault_user_id)
        )).scalars():
            await index_item(s, item)
        await s.commit()

    theirs = (await other_client.get("/items")).json()[0]["id"]
    scoped = (await client.post("/ai/ask", json={
        "question": "private contract", "item_ids": [theirs]})).json()["sources"]

    assert scoped == [], "asking about someone else's document id must return nothing"
