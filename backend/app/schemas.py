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
class ExpenseIn(BaseModel):
    id: str
    desc: str
    amount: float
    cat: str = "Other"
    pay_method_id: str | None = None
    spent_on: date


class ExpenseOut(ExpenseIn, ORM):
    pass


class BillIn(BaseModel):
    id: str
    title: str
    amount: float
    due: date
    paid: bool = False
    paid_on: date | None = None
    recur: str | None = None


class BillOut(BillIn, ORM):
    pass


class IncomeIn(BaseModel):
    id: str
    source: str
    amount: float
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
    target: float
    saved: float = 0


class GoalOut(GoalIn, ORM):
    pass


class BudgetIn(BaseModel):
    scope: str = "overall"
    cap: float


# ---------- AI ----------
class AskIn(BaseModel):
    question: str
    k: int = 6


class AskSource(BaseModel):
    item_id: int
    title: str
    type: str
    score: float
    chunk: str


class AskOut(BaseModel):
    sources: list[AskSource]
    prompt: str        # v0: the assembled RAG prompt (frontend keeps calling its model);
                       # phase 3 adds server-side completion via the key vault.
