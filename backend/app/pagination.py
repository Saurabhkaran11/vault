"""Cursor-free pagination for the list endpoints.

Offset/limit rather than keyset: these lists are per-user and ordered by a
stable column, the page counts are small, and offset keeps the client
trivial (the restore path just walks until it has everything). Keyset
becomes worth it only if a single account ever holds enough rows for deep
offsets to hurt, which a personal vault will not.

The important property is that **nothing truncates silently**. Every list
response carries `X-Total-Count`, so a caller can always tell whether it
has the whole set — `pullAll()` in the frontend relies on exactly that to
avoid restoring a partial vault over a complete one.
"""

from dataclasses import dataclass

from fastapi import Query, Response
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

MAX_LIMIT = 1000
DEFAULT_LIMIT = 500


@dataclass
class Page:
    limit: int
    offset: int


def page_params(
    limit: int = Query(DEFAULT_LIMIT, ge=1, le=MAX_LIMIT,
                       description="Rows per page (max 1000)."),
    offset: int = Query(0, ge=0, description="Rows to skip."),
) -> Page:
    return Page(limit=limit, offset=offset)


async def paginate(session: AsyncSession, stmt, page: Page, response: Response):
    """Run `stmt` for one page and publish the full count on the response.

    Counting is a second query rather than a window function so the result
    stays correct regardless of joins or eager loads in `stmt`.
    """
    total = (await session.execute(
        select(func.count()).select_from(stmt.order_by(None).subquery())
    )).scalar_one()
    response.headers["X-Total-Count"] = str(total)
    response.headers["X-Page-Limit"] = str(page.limit)
    response.headers["X-Page-Offset"] = str(page.offset)
    rows = (await session.execute(stmt.limit(page.limit).offset(page.offset))).scalars().all()
    return rows
