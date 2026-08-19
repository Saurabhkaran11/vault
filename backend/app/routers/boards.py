import re
import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
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
