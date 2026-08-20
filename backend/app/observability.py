"""Structured logging, request correlation, and safe error reporting.

The backend had no logging at all: in production a 500 would leave nothing
behind to debug, and the old catch-all handler sent the exception's own text
to the browser — leaking SQL fragments, file paths and column names to
anyone who could trigger an error.

The contract here:
  · every request gets an id (honouring an inbound X-Request-Id from a load
    balancer, otherwise minted) and echoes it back on the response;
  · one JSON access line per request, so CloudWatch/Datadog can parse it;
  · unhandled errors are logged in full server-side and answered with a
    generic message plus that request id — enough for a user to quote in a
    support ticket, nothing an attacker can mine.
"""

import json
import logging
import sys
import time
import uuid
from contextvars import ContextVar

from fastapi import Request
from fastapi.responses import JSONResponse

from .errors import capture, note_request

request_id_ctx: ContextVar[str] = ContextVar("request_id", default="-")


class JsonFormatter(logging.Formatter):
    """One JSON object per line — the format every log aggregator expects."""

    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "ts": self.formatTime(record, "%Y-%m-%dT%H:%M:%S%z"),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
            "request_id": request_id_ctx.get(),
        }
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        for k, v in getattr(record, "extra_fields", {}).items():
            payload[k] = v
        return json.dumps(payload, default=str)


def configure_logging(level: str = "INFO") -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(level)
    # uvicorn's own access log duplicates ours and is not JSON — silence it.
    logging.getLogger("uvicorn.access").handlers = []
    logging.getLogger("uvicorn.access").propagate = False


log = logging.getLogger("vault")


async def request_context(request: Request, call_next):
    """Correlate every log line for one request, and time it."""
    rid = request.headers.get("x-request-id") or uuid.uuid4().hex[:16]
    # Also stashed on request.state, because the unhandled-error handler runs
    # in Starlette's ServerErrorMiddleware — OUTSIDE this middleware — where
    # the context var has already been reset. request.state is the only
    # carrier that survives that boundary, and without it a 500 comes back
    # with no id at all: nothing for a user to quote, nothing to grep.
    request.state.request_id = rid
    token = request_id_ctx.set(rid)
    # Tag the Sentry scope with the same id, so an issue there and a line here
    # are the same incident rather than two things you have to correlate by
    # timestamp. No-ops entirely when no DSN is configured.
    note_request(rid, request.headers.get("x-user-id"))
    started = time.perf_counter()
    try:
        response = await call_next(request)
        took_ms = round((time.perf_counter() - started) * 1000, 1)
        response.headers["X-Request-Id"] = rid
        # Logged inside the try: resetting the context first would strip the
        # id from this very line, leaving access logs that cannot be joined
        # to the errors they accompany.
        log.info(
            f"{request.method} {request.url.path} {response.status_code} {took_ms}ms",
            extra={"extra_fields": {
                "method": request.method, "path": request.url.path,
                "status": response.status_code, "duration_ms": took_ms,
                # the caller's claimed identity is the single most useful
                # field when reconstructing what someone actually did
                "user": request.headers.get("x-user-id", "-"),
            }},
        )
        return response
    finally:
        request_id_ctx.reset(token)


async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Log everything, tell the client almost nothing.

    This must return a real response rather than re-raising: Starlette's bare
    500 fallback skips CORSMiddleware, so a browser sees an unreadable reply
    and reports 'Failed to fetch' instead of the actual status.
    """
    rid = getattr(request.state, "request_id", None) or request_id_ctx.get()
    # Report before logging: an alert nobody has to go looking for is the
    # whole reason this exists.
    capture(exc)
    # Re-enter the context so this log line carries the id too. Without it the
    # traceback lands in the logs stamped "-", and the id handed to the user
    # matches nothing you can search for.
    token = request_id_ctx.set(rid)
    try:
        log.exception(
            f"Unhandled {type(exc).__name__} on {request.method} {request.url.path}",
            extra={"extra_fields": {"method": request.method, "path": request.url.path}},
        )
    finally:
        request_id_ctx.reset(token)
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error", "request_id": rid},
        # The success path sets this in the middleware; that code never runs
        # when the request raised, so set it here too.
        headers={"X-Request-Id": rid},
    )
