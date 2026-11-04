"""A public deployment (AUTH_MODE=jwt) must never answer with a server AI key."""

from types import SimpleNamespace

from app.routers import ai


def _cfg(mode):
    return SimpleNamespace(auth_mode=mode, chat_url="https://provider.example/v1", chat_model="m")


def test_server_key_is_off_in_jwt_mode(monkeypatch):
    monkeypatch.setattr(ai, "settings", _cfg("jwt"))
    assert ai._server_ai_on() is False


def test_server_key_works_in_dev_mode(monkeypatch):
    monkeypatch.setattr(ai, "settings", _cfg("dev"))
    assert ai._server_ai_on() is True
