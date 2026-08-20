"""Error reporting.

The logs already record every unhandled exception with a request id, which
is enough to *investigate* a failure someone reports. It is not enough to
*notice* one: nothing reads the logs until a person complains. Five distinct
crashes turned up in an hour of probing this API, and every one of them would
have reached a user silently.

Sentry closes that gap, and stays entirely optional — with no DSN set every
function here is a no-op, so local development and CI are unaffected and no
data leaves the machine.

What is deliberately NOT sent:
  · request bodies and headers (`send_default_pii=False`) — a vault's
    contents are the whole point of the product, and an error report is not
    a place to spill them;
  · the `Authorization` header and `X-User-Id`, scrubbed explicitly below,
    because a leaked bearer token in a third-party dashboard is a breach;
  · anything at all when SENTRY_DSN is unset.

What IS sent: the exception, the stack, the route, and the request id — so a
report can be tied back to the exact line in your own logs.
"""

import logging

from .config import settings

log = logging.getLogger("vault.errors")

_SCRUB_HEADERS = {"authorization", "cookie", "x-user-id", "x-api-key"}


def _scrub(event, _hint):
    """Last line of defence before anything leaves the process."""
    request = event.get("request") or {}

    headers = request.get("headers")
    if isinstance(headers, dict):
        for name in list(headers):
            if name.lower() in _SCRUB_HEADERS:
                headers[name] = "[redacted]"

    # Bodies can carry note text, expense descriptions, file names — user
    # content by definition. Never ship it, whatever else is configured.
    request.pop("data", None)
    # Query strings can carry storage keys, which are capability-ish.
    if request.get("query_string"):
        request["query_string"] = "[redacted]"

    _strip_frame_locals(event)
    return event


def _strip_frame_locals(event) -> None:
    """Remove local variables from every stack frame.

    `include_local_variables=False` already prevents these being collected,
    so this is belt-and-braces — but it is the leak that matters most and the
    kind of setting that gets flipped back on while debugging. Verified the
    hard way: a handler that takes `body` puts the entire parsed request —
    note text, amounts, bearer tokens — into frame locals, where no amount of
    header or body scrubbing touches it.
    """
    for entry in (event.get("exception") or {}).get("values") or []:
        for frame in (entry.get("stacktrace") or {}).get("frames") or []:
            frame.pop("vars", None)
    for thread in (event.get("threads") or {}).get("values") or []:
        for frame in (thread.get("stacktrace") or {}).get("frames") or []:
            frame.pop("vars", None)


def init_error_reporting() -> None:
    if not settings.sentry_dsn:
        log.info("SENTRY_DSN not set — error reporting is off (logs only).")
        return

    import sentry_sdk
    from sentry_sdk.integrations.fastapi import FastApiIntegration
    from sentry_sdk.integrations.starlette import StarletteIntegration

    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        environment=settings.sentry_environment,
        release=settings.release,
        # Performance data is sampled, errors never are: a 1% miss rate on
        # crashes would defeat the point of installing this.
        traces_sample_rate=settings.sentry_traces_sample_rate,
        send_default_pii=False,
        # The single most important line here. Sentry captures each stack
        # frame's local variables by default, and in a FastAPI handler those
        # include the parsed request body — so a crash while saving an expense
        # would ship its description, and a crash during auth would ship the
        # bearer token. Header scrubbing does not reach into frames.
        include_local_variables=False,
        before_send=_scrub,
        integrations=[
            StarletteIntegration(transaction_style="endpoint"),
            FastApiIntegration(transaction_style="endpoint"),
        ],
    )
    log.info(f"Error reporting on (environment={settings.sentry_environment}).")


def note_request(request_id: str, user_id: str | None = None) -> None:
    """Tag the active scope so a Sentry issue and a log line can be joined.

    The user id is an opaque identifier, not personal data — it is what makes
    "this one account keeps hitting this" answerable.
    """
    if not settings.sentry_dsn:
        return
    import sentry_sdk

    scope = sentry_sdk.get_current_scope()
    scope.set_tag("request_id", request_id)
    if user_id:
        scope.set_user({"id": user_id})


def capture(exc: BaseException) -> None:
    if not settings.sentry_dsn:
        return
    import sentry_sdk

    sentry_sdk.capture_exception(exc)
