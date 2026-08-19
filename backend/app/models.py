"""SQLAlchemy models — one table family per feature, user_id on every row.

Shapes mirror the frontend's versioned localStorage stores 1:1, so the
frontend's JSON export imports losslessly (see routers/sync.py). Flexible
sub-structures (note blocks, board card extras) are JSONB — the same
freedom localStorage gave us, now with indexes and constraints around it.

MONEY IS INTEGER CENTS everywhere (`*_cents`). Floats accumulate rounding
error under SUM, which is exactly what /finance/summary does; the suffix
keeps the unit unmistakable at every call site. Only the raw localStorage
dump in /sync/import speaks dollars, and it converts on the way in.
`Card.hours` stays a float — it is a duration, not money.
"""

from datetime import date, datetime

from pgvector.sqlalchemy import Vector
from sqlalchemy import JSON, Boolean, Date, DateTime, Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .config import settings
from .db import Base


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class User(Base, TimestampMixin):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)  # Clerk user id later
    name: Mapped[str | None] = mapped_column(String(120))
    email: Mapped[str | None] = mapped_column(String(255))
    prefs: Mapped[dict] = mapped_column(JSON, default=dict)        # theme, keymap, onboarding…


class Item(Base, TimestampMixin):
    """Notes, YouTube videos, Library books/PDFs, Documents — one table,
    discriminated by `type`, exactly like the frontend store."""

    __tablename__ = "items"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(String(64), ForeignKey("users.id"), index=True)
    client_id: Mapped[str | None] = mapped_column(String(64), index=True)  # id from the frontend export
    type: Mapped[str] = mapped_column(String(10), index=True)              # note|video|book|doc
    title: Mapped[str] = mapped_column(Text, default="")
    meta: Mapped[str] = mapped_column(Text, default="")
    url: Mapped[str | None] = mapped_column(Text)
    cloud: Mapped[str | None] = mapped_column(String(20))                  # gdoc|gsheet|onedrive|…
    status: Mapped[str] = mapped_column(String(20), default="Inbox")
    tags: Mapped[list] = mapped_column(JSON, default=list)
    folder: Mapped[str | None] = mapped_column(String(120))
    alias: Mapped[str | None] = mapped_column(String(160))
    pinned: Mapped[bool] = mapped_column(Boolean, default=False)
    progress: Mapped[int | None] = mapped_column(Integer)                  # library reading %
    blocks: Mapped[list | None] = mapped_column(JSON)                      # note/doc block editor
    links: Mapped[list | None] = mapped_column(JSON)                       # library linked resources
    file_meta: Mapped[dict | None] = mapped_column(JSON)                   # {name,type,size,s3_key} — bytes → S3 phase 2
    added_on: Mapped[date] = mapped_column(Date, index=True)               # the user's visible date stamp
    deleted_on: Mapped[date | None] = mapped_column(Date, index=True)      # 30-day trash

    embeddings = relationship("Embedding", cascade="all, delete-orphan", back_populates="item")


class Embedding(Base):
    """pgvector chunks for Ask-your-Vault RAG (one row per item chunk)."""

    __tablename__ = "embeddings"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(String(64), index=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("items.id", ondelete="CASCADE"), index=True)
    chunk: Mapped[str] = mapped_column(Text)
    model: Mapped[str] = mapped_column(String(80))
    vector: Mapped[list] = mapped_column(Vector(settings.embedding_dim))

    item = relationship("Item", back_populates="embeddings")


class Task(Base, TimestampMixin):
    __tablename__ = "tasks"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)   # frontend uid
    user_id: Mapped[str] = mapped_column(String(64), ForeignKey("users.id"), index=True)
    text: Mapped[str] = mapped_column(Text)
    done: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    done_at: Mapped[date | None] = mapped_column(Date)
    due: Mapped[date | None] = mapped_column(Date, index=True)
    high: Mapped[bool] = mapped_column(Boolean, default=False)
    label: Mapped[str | None] = mapped_column(String(60))
    created_on: Mapped[date] = mapped_column(Date)


class Board(Base, TimestampMixin):
    __tablename__ = "boards"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(64), ForeignKey("users.id"), index=True)
    name: Mapped[str] = mapped_column(String(160))
    seq: Mapped[int] = mapped_column(Integer, default=0)            # Jira-key counter (FVB-7)
    current_sprint: Mapped[str | None] = mapped_column(String(64))

    sprints = relationship("Sprint", cascade="all, delete-orphan", order_by="Sprint.position")
    columns = relationship("BoardColumn", cascade="all, delete-orphan", order_by="BoardColumn.position")


class Sprint(Base):
    __tablename__ = "sprints"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    board_id: Mapped[str] = mapped_column(ForeignKey("boards.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    ended_on: Mapped[date | None] = mapped_column(Date)
    position: Mapped[int] = mapped_column(Integer, default=0)


class BoardColumn(Base):
    __tablename__ = "board_columns"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    board_id: Mapped[str] = mapped_column(ForeignKey("boards.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(120))
    position: Mapped[int] = mapped_column(Integer, default=0)

    cards = relationship("Card", cascade="all, delete-orphan", order_by="Card.position")


class Card(Base, TimestampMixin):
    __tablename__ = "cards"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    column_id: Mapped[str] = mapped_column(ForeignKey("board_columns.id", ondelete="CASCADE"), index=True)
    sprint_id: Mapped[str | None] = mapped_column(String(64), index=True)
    num: Mapped[int] = mapped_column(Integer)                       # stable Jira-style number
    text: Mapped[str] = mapped_column(Text, default="")
    desc: Mapped[str | None] = mapped_column(Text)
    hours: Mapped[float | None] = mapped_column(Float)
    labels: Mapped[list] = mapped_column(JSON, default=list)
    position: Mapped[int] = mapped_column(Integer, default=0)


class PayMethod(Base):
    __tablename__ = "pay_methods"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(64), ForeignKey("users.id"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    kind: Mapped[str] = mapped_column(String(20), default="credit")  # credit|debit|cash|wallet|bank


class Expense(Base, TimestampMixin):
    __tablename__ = "expenses"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(64), ForeignKey("users.id"), index=True)
    desc: Mapped[str] = mapped_column(Text)
    amount_cents: Mapped[int] = mapped_column(Integer)
    cat: Mapped[str] = mapped_column(String(40), index=True)
    pay_method_id: Mapped[str | None] = mapped_column(String(64))
    spent_on: Mapped[date] = mapped_column(Date, index=True)


class Bill(Base, TimestampMixin):
    __tablename__ = "bills"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(64), ForeignKey("users.id"), index=True)
    title: Mapped[str] = mapped_column(Text)
    amount_cents: Mapped[int] = mapped_column(Integer)
    due: Mapped[date] = mapped_column(Date, index=True)
    paid: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    paid_on: Mapped[date | None] = mapped_column(Date)
    recur: Mapped[str | None] = mapped_column(String(10))            # weekly|monthly|yearly


class Income(Base, TimestampMixin):
    __tablename__ = "incomes"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(64), ForeignKey("users.id"), index=True)
    source: Mapped[str] = mapped_column(Text)
    amount_cents: Mapped[int] = mapped_column(Integer)
    received_on: Mapped[date] = mapped_column(Date, index=True)


class Budget(Base):
    __tablename__ = "budgets"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(String(64), ForeignKey("users.id"), index=True)
    scope: Mapped[str] = mapped_column(String(40), default="overall")  # overall | category name
    cap_cents: Mapped[int] = mapped_column(Integer)


class Goal(Base, TimestampMixin):
    __tablename__ = "goals"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(64), ForeignKey("users.id"), index=True)
    name: Mapped[str] = mapped_column(Text)
    target_cents: Mapped[int] = mapped_column(Integer)
    saved_cents: Mapped[int] = mapped_column(Integer, default=0)


class CustomTag(Base):
    __tablename__ = "custom_tags"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(String(64), ForeignKey("users.id"), index=True)
    tag: Mapped[str] = mapped_column(String(60), index=True)


class Event(Base):
    """Outbox for the Redis worker — every state change that might notify
    someone lands here first (task.due, bill.overdue, sprint.completed…)."""

    __tablename__ = "events"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(String(64), index=True)
    kind: Mapped[str] = mapped_column(String(40), index=True)
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
