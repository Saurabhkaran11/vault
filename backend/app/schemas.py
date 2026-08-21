"""Pydantic schemas — the API contract. Field names mirror the frontend
stores so `useStore.js` swaps to fetch() with zero reshaping."""

from datetime import date
from pydantic import BaseModel, ConfigDict, Field


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ---------- items (notes / videos / library / documents) ----------
class ItemIn(BaseModel):
    client_id: str | None = None
    type: str = Field(pattern="^(note|video|book|doc)$")
    title: str = ""
    meta: str = ""
    url: str | None = None
    cloud: str | None = None
    status: str = "Inbox"
    tags: list[str] = []
    folder: str | None = None
    alias: str | None = None
    pinned: bool = False
    progress: int | None = None
    blocks: list | None = None
    links: list | None = None
    file_meta: dict | None = None
    added_on: date


class ItemOut(ItemIn, ORM):
    id: int
    deleted_on: date | None = None


# ---------- to-dos ----------
class TaskIn(BaseModel):
    id: str
    text: str
    done: bool = False
    done_at: date | None = None
    due: date | None = None
    high: bool = False
    label: str | None = None
    created_on: date


class TaskOut(TaskIn, ORM):
    pass


# ---------- boards ----------
class CardIn(BaseModel):
    id: str
    text: str = ""
    desc: str | None = None
    hours: float | None = None
    labels: list[str] = []
    sprint_id: str | None = None
    position: int = 0


class CardOut(CardIn, ORM):
    num: int
    column_id: str


class ColumnOut(ORM):
    id: str
    title: str
    position: int
    cards: list[CardOut] = []


class SprintOut(ORM):
    id: str
    name: str
    ended_on: date | None = None
    position: int


class BoardOut(ORM):
    id: str
    name: str
    seq: int
    current_sprint: str | None
    sprints: list[SprintOut] = []
    columns: list[ColumnOut] = []


class BoardCreate(BaseModel):
    name: str


# ---------- finance ----------
# Money crosses this API as INTEGER CENTS (`*_cents`) — see models.py.
# The frontend converts at its mapper boundary; nothing here takes dollars.
class ExpenseIn(BaseModel):
    id: str
    desc: str
    amount_cents: int
    cat: str = "Other"
    pay_method_id: str | None = None
    spent_on: date


class ExpenseOut(ExpenseIn, ORM):
    pass


class BillIn(BaseModel):
    id: str
    title: str
    amount_cents: int
    due: date
    paid: bool = False
    paid_on: date | None = None
    recur: str | None = None


class BillOut(BillIn, ORM):
    pass


class IncomeIn(BaseModel):
    id: str
    source: str
    amount_cents: int
    received_on: date


class IncomeOut(IncomeIn, ORM):
    pass


class PayMethodIn(BaseModel):
    id: str
    name: str
    kind: str = "credit"


class PayMethodOut(PayMethodIn, ORM):
    pass


class GoalIn(BaseModel):
    id: str
    name: str
    target_cents: int
    saved_cents: int = 0


class GoalOut(GoalIn, ORM):
    pass


class BudgetIn(BaseModel):
    scope: str = "overall"
    cap_cents: int


# ---------- AI ----------
class AskIn(BaseModel):
    question: str = Field(min_length=1, max_length=2000)
    # Bounded: k flows straight into SQL LIMIT, where a negative value is a
    # database error (500) and an enormous one would pull the whole index
    # into a prompt. 50 is already far more context than any answer needs.
    k: int = Field(6, ge=1, le=50)
    # Narrow the search. `item_ids` asks about specific documents ("what do
    # these two contracts say about notice periods"); `types` asks a whole
    # section ("search only my documents"). Both empty searches everything,
    # which is the existing behaviour. Bounded for the same reason as k —
    # these reach SQL, and an unbounded IN list is a denial-of-service.
    item_ids: list[int] = Field(default_factory=list, max_length=100)
    types: list[str] = Field(default_factory=list, max_length=10)


class AskSource(BaseModel):
    item_id: int
    # The frontend's own id for this item. Without it a cited source cannot be
    # matched back to anything in the browser, so the "jump to source" chip
    # has nowhere to jump to.
    client_id: str | None = None
    title: str
    type: str
    score: float
    chunk: str


class AskOut(BaseModel):
    sources: list[AskSource]
    prompt: str        # v0: the assembled RAG prompt (frontend keeps calling its model);
                       # phase 3 adds server-side completion via the key vault.


class ChatMessage(BaseModel):
    role: str = Field(pattern="^(system|user|assistant)$")
    content: str = Field(min_length=1, max_length=200_000)


class CompleteIn(BaseModel):
    # Bounded so one request cannot hand a provider an unbounded bill or
    # stall a worker: the prompt is assembled from retrieved sources, which
    # are already capped, so a long conversation here is a bug or an abuse.
    messages: list[ChatMessage] = Field(min_length=1, max_length=20)
    max_tokens: int | None = Field(None, ge=1, le=32_000)


class CompleteOut(BaseModel):
    text: str
    model: str
