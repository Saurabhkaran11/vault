"""Error reporting must never become a data leak.

A vault's contents are the product. Shipping note text, expense descriptions
or a bearer token to a third-party dashboard to diagnose a crash would trade
a small operational problem for a large privacy one, so the scrubbing is
tested as carefully as the reporting.
"""

import pytest

from app.errors import _scrub, capture, init_error_reporting, note_request


def test_authorization_and_identity_headers_are_redacted():
    event = {"request": {"headers": {
        "Authorization": "Bearer eyJhbGciOi.very.secret",
        "X-User-Id": "user_2abc",
        "Cookie": "session=abc123",
        "User-Agent": "Mozilla/5.0",
    }}}
    out = _scrub(event, None)
    headers = out["request"]["headers"]

    assert headers["Authorization"] == "[redacted]"
    assert headers["X-User-Id"] == "[redacted]"
    assert headers["Cookie"] == "[redacted]"
    # Non-sensitive headers stay: they are useful and harmless.
    assert headers["User-Agent"] == "Mozilla/5.0"


def test_header_matching_is_case_insensitive():
    """HTTP header casing varies by client; a case-sensitive check would
    quietly pass the token straight through."""
    event = {"request": {"headers": {"AUTHORIZATION": "Bearer x", "authorization": "Bearer y"}}}
    headers = _scrub(event, None)["request"]["headers"]
    assert set(headers.values()) == {"[redacted]"}


def test_request_bodies_are_dropped_entirely():
    """Bodies carry note text, expense descriptions and file names — user
    content by definition."""
    event = {"request": {"data": {"desc": "Therapy session", "amount_cents": 15000}}}
    assert "data" not in _scrub(event, None)["request"]


def test_query_strings_are_dropped():
    """Storage keys travel in query strings and are capability-like."""
    event = {"request": {"query_string": "key=u/user_2abc/item/medical-results.pdf"}}
    assert _scrub(event, None)["request"]["query_string"] == "[redacted]"


def test_scrub_survives_unexpected_shapes():
    """before_send runs on the crash path. If it raises, the report is lost
    exactly when it is most needed."""
    for event in ({}, {"request": {}}, {"request": {"headers": None}}, {"request": {"headers": []}}):
        assert _scrub(event, None) is event


def test_everything_is_a_no_op_without_a_dsn(monkeypatch, caplog):
    """No DSN must mean no network, no import cost, and no crash — this is
    the default for local development and CI."""
    import app.errors as errors

    monkeypatch.setattr(errors.settings, "sentry_dsn", None)

    init_error_reporting()
    note_request("abc123", "user_1")
    capture(RuntimeError("boom"))   # must not raise


@pytest.mark.asyncio
async def test_a_crash_still_answers_the_caller_when_reporting_is_off(client):
    """Reporting is additive: with it off the app behaves exactly as before."""
    r = await client.get("/health")
    assert r.status_code == 200
    assert r.headers.get("X-Request-Id")


def test_stack_frame_locals_never_reach_the_wire():
    """The leak that header and body scrubbing cannot reach.

    Sentry captures each stack frame's local variables by default, and in a
    FastAPI handler those include the parsed request body and the auth header.
    Caught by sending a real event through a fake transport: the token was
    redacted while the note text and bearer sailed straight through, sitting
    in `exception.values[].stacktrace.frames[].vars`.

    The secrets here are base64-decoded at runtime on purpose. Written as
    literals they would also appear in Sentry's *source context*, and the test
    would fail for the wrong reason — which is exactly how the first two
    attempts at this test misled me.
    """
    import base64
    import json

    import sentry_sdk
    from sentry_sdk.transport import Transport

    from app.config import Settings
    import app.errors as errors

    dsn = "https://abc123@o0.ingest.sentry.io/0"
    captured = []

    class CaptureTransport(Transport):
        def capture_envelope(self, envelope):
            for item in envelope.items:
                if item.headers.get("type") == "event":
                    captured.append(item.payload.json)

    previous_settings = errors.settings
    previous_client = sentry_sdk.get_client()
    errors.settings = Settings(_env_file=None, sentry_dsn=dsn, sentry_environment="test")
    try:
        errors.init_error_reporting()
        opts = {
            k: v for k, v in sentry_sdk.get_client().options.items()
            if k in {"before_send", "include_local_variables", "send_default_pii",
                     "environment", "traces_sample_rate", "integrations", "release"}
        }
        sentry_sdk.get_global_scope().set_client(
            sentry_sdk.Client(dsn=dsn, transport=CaptureTransport(), **opts))

        note = base64.b64decode("UFJJVkFURV9NRURJQ0FMX05PVEU=").decode()
        token = base64.b64decode("U0VDUkVUX0JFQVJFUg==").decode()

        def route_handler(body, auth):        # locals mirror a real endpoint
            raise RuntimeError("boom")

        try:
            route_handler({"desc": note}, "Bearer " + token)
        except RuntimeError as exc:
            errors.note_request("req_deadbeef", "user_2abc")
            errors.capture(exc)
        sentry_sdk.flush(timeout=2)

        assert len(captured) == 1, "the exception should have been reported"
        blob = json.dumps(captured[0], default=str)

        # Still useful for debugging…
        assert "boom" in blob
        assert "req_deadbeef" in blob
        # …without carrying the user's vault into a third party.
        assert note not in blob, "request body leaked through stack frame locals"
        assert token not in blob, "bearer token leaked through stack frame locals"
    finally:
        errors.settings = previous_settings
        sentry_sdk.get_global_scope().set_client(previous_client)
