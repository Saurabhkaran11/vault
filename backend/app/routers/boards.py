import re
import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..db import get_session
from ..deps import current_user_id
from ..events import emit
from ..models import Board, BoardColumn, Card, Sprint
from ..schemas import BoardCreate, BoardOut, CardIn, CardOut

router = APIRouter(prefix="/boards", tags=["boards"])
DONE_RE = re.compile(r"done|complete|shipped|finished", re.I)
uid = lambda: uuid.uuid4().hex[:12]  # noqa: E731

_LOAD = (selectinload(Board.sprints), selectinload(Board.columns).selectinload(BoardColumn.cards))


async def _board(board_id: str, session: AsyncSession, user: str) -> Board:
    b = (await session.execute(
        select(Board).options(*_LOAD).where(Board.id == board_id, Board.user_id == user)
    )).scalar_one_or_none()
    if not b:
        raise HTTPException(404, "Board not found")
    return b


@router.get("", response_model=list[BoardOut])
async def list_boards(session: AsyncSession = Depends(get_session), user: str = Depends(current_user_id)):
    return (await session.execute(
        select(Board).options(*_LOAD).where(Board.user_id == user)
    )).scalars().unique().all()


@router.post("", response_model=BoardOut, status_code=201)
async def create_board(body: BoardCreate, session: AsyncSession = Depends(get_session), user: str = Depends(current_user_id)):
    sprint = Sprint(id=uid(), name="Sprint 1", position=0)
    board = Board(
        id=uid(), user_id=user, name=body.name, seq=0,
        sprints=[sprint],
        columns=[BoardColumn(id=uid(), title=t, position=i) for i, t in enumerate(["To do", "Doing", "Done"])],
    )
    board.current_sprint = sprint.id
    session.add(board)
    await session.commit()
    return await _board(board.id, session, user)


# ---------- snapshot sync (see .claude/skills/boards-sync) ----------
# Boards are deeply nested and mutate in many small ways, so the frontend
# mirrors the ENTIRE board after any change. The body is the exact frontend
# store shape; children are replaced wholesale, which keeps the endpoint
# idempotent — debounced and retried mirrors are always safe.


class SnapshotCard(BaseModel):
    id: str
    num: int | None = None             # Jira-style number; backfilled if absent
    sprint: str | None = None          # -> Card.sprint_id
    text: str = ""
    desc: str | None = None
    hours: float | None = None
    labels: list[str] = []


class SnapshotColumn(BaseModel):
    id: str
    title: str = ""
    cards: list[SnapshotCard] = []


class SnapshotSprint(BaseModel):
    id: str
    name: str = ""
    ended: date | None = None          # -> Sprint.ended_on


class BoardSnapshot(BaseModel):
    id: str | None = None              # ignored — the path param is authoritative
    name: str = ""
    seq: int = 0
    current: str | None = None         # -> Board.current_sprint
    sprints: list[SnapshotSprint] = []
    cols: list[SnapshotColumn] = []


@router.put("/{board_id}/snapshot", response_model=BoardOut)
async def put_snapshot(board_id: str, body: BoardSnapshot,
                       session: AsyncSession = Depends(get_session), user: str = Depends(current_user_id)):
    board = await session.get(Board, board_id)
    if board and board.user_id != user:
        raise HTTPException(404, "Board not found")
    if not board:
        board = Board(id=board_id, user_id=user)
        session.add(board)
    board.name = body.name
    board.seq = body.seq
    board.current_sprint = body.current

    # replace children — leaf-first deletes so no FK ever dangles
    col_ids = select(BoardColumn.id).where(BoardColumn.board_id == board_id).scalar_subquery()
    await session.execute(delete(Card).where(Card.column_id.in_(col_ids)))
    await session.execute(delete(BoardColumn).where(BoardColumn.board_id == board_id))
    await session.execute(delete(Sprint).where(Sprint.board_id == board_id))

    # …and parent-first inserts: sprints, columns, then cards
    session.add_all([Sprint(id=s.id, board_id=board_id, name=s.name, ended_on=s.ended, position=i)
                     for i, s in enumerate(body.sprints)])
    session.add_all([BoardColumn(id=c.id, board_id=board_id, title=c.title, position=i)
                     for i, c in enumerate(body.cols)])
    await session.flush()
    session.add_all([Card(id=k.id, column_id=c.id, sprint_id=k.sprint,
                          num=k.num if k.num is not None else j + 1,
                          text=k.text, desc=k.desc, hours=k.hours, labels=k.labels, position=j)
                     for c in body.cols for j, k in enumerate(c.cards)])
    await session.commit()
    return await _board(board_id, session, user)


@router.delete("/{board_id}")
async def delete_board(board_id: str, session: AsyncSession = Depends(get_session), user: str = Depends(current_user_id)):
    """Idempotent on purpose: a mirror retried after success (or a board that
    lived and died entirely offline) must get an ok, not a 404 — a permanent
    404 would wedge the frontend's ordered retry queue forever."""
    owned = (await session.execute(
        select(Board.id).where(Board.id == board_id, Board.user_id == user)
    )).scalar_one_or_none()
    if not owned:
        return {"ok": True, "deleted": False}
    col_ids = select(BoardColumn.id).where(BoardColumn.board_id == board_id).scalar_subquery()
    await session.execute(delete(Card).where(Card.column_id.in_(col_ids)))
    await session.execute(delete(BoardColumn).where(BoardColumn.board_id == board_id))
    await session.execute(delete(Sprint).where(Sprint.board_id == board_id))
    await session.execute(delete(Board).where(Board.id == board_id))
    await session.commit()
    return {"ok": True, "deleted": True}


@router.post("/{board_id}/cards", response_model=CardOut, status_code=201)
async def add_card(board_id: str, column_id: str, body: CardIn,
                   session: AsyncSession = Depends(get_session), user: str = Depends(current_user_id)):
    board = await _board(board_id, session, user)
    col = next((c for c in board.columns if c.id == column_id), None)
    if not col:
        raise HTTPException(404, "Column not found")
    board.seq += 1
    card = Card(**body.model_dump(exclude={"sprint_id"}), num=board.seq,
                sprint_id=body.sprint_id or board.current_sprint, column_id=col.id)
    session.add(card)
    await session.commit()
    return card


@router.put("/{board_id}/cards/{card_id}", response_model=CardOut)
async def update_card(board_id: str, card_id: str, body: CardIn, column_id: str | None = None,
                      session: AsyncSession = Depends(get_session), user: str = Depends(current_user_id)):
    board = await _board(board_id, session, user)
    card = next((k for c in board.columns for k in c.cards if k.id == card_id), None)
    if not card:
        raise HTTPException(404, "Card not found")
    sprint_changed = body.sprint_id and body.sprint_id != card.sprint_id
    for k, v in body.model_dump(exclude={"id"}).items():
        setattr(card, k, v)
    if column_id:
        card.column_id = column_id
    if sprint_changed:
        # product rule: a task entering another sprint restarts in the backlog
        backlog = next((c for c in board.columns if re.search(r"backlog|to.?do", c.title, re.I)), board.columns[0])
        card.column_id = backlog.id
    await session.commit()
    return card


@router.post("/{board_id}/sprints/complete", response_model=BoardOut)
async def complete_sprint(board_id: str, session: AsyncSession = Depends(get_session), user: str = Depends(current_user_id)):
    """Jira semantics, same as the frontend: done cards stay in the closed
    sprint; unfinished cards roll to the next sprint AND back to Backlog."""
    board = await _board(board_id, session, user)
    cur = board.current_sprint
    sprint = next((s for s in board.sprints if s.id == cur), None)
    if not sprint:
        raise HTTPException(400, "No active sprint")
    sprint.ended_on = date.today()

    nxt = next((s for s in board.sprints if s.position == sprint.position + 1), None)
    if not nxt:
        nxt = Sprint(id=uid(), name=f"Sprint {len(board.sprints) + 1}", position=sprint.position + 1)
        board.sprints.append(nxt)   # keeps the loaded relationship fresh for the response

    backlog = next((c for c in board.columns if re.search(r"backlog|to.?do", c.title, re.I)), board.columns[0])
    rolled = 0
    for col in board.columns:
        if DONE_RE.search(col.title):
            continue
        for card in list(col.cards):
            if card.sprint_id == cur:
                card.sprint_id = nxt.id
                card.column_id = backlog.id
                rolled += 1
    board.current_sprint = nxt.id
    await emit(session, user, "sprint.completed", {"board": board.name, "sprint": sprint.name, "rolled": rolled})
    await session.commit()
    return await _board(board.id, session, user)


@router.get("/{board_id}/sprints/{sprint_id}/export.csv")
async def export_sprint_csv(board_id: str, sprint_id: str,
                            session: AsyncSession = Depends(get_session), user: str = Depends(current_user_id)):
    from fastapi.responses import PlainTextResponse

    board = await _board(board_id, session, user)
    sprint = next((s for s in board.sprints if s.id == sprint_id), None)
    if not sprint:
        raise HTTPException(404, "Sprint not found")
    prefix = "".join(w[0] for w in board.name.split()[:3]).upper() or "BRD"
    esc = lambda v: '"' + str(v if v is not None else "").replace('"', '""') + '"'  # noqa: E731
    rows = [["Key", "Title", "Status", "Sprint", "Labels", "Hours", "Description"]]
    for col in board.columns:
        for card in col.cards:
            if card.sprint_id == sprint_id:
                rows.append([f"{prefix}-{card.num}", card.text, col.title, sprint.name,
                             "; ".join(card.labels or []), card.hours or "", card.desc or ""])
    csv = "\n".join(",".join(esc(c) for c in r) for r in rows)
    return PlainTextResponse(csv, media_type="text/csv")
