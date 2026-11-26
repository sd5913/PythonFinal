import json

import pytest

from app import game
from app.online_auth import app_origin, cookie, digest, pkce_challenge, token, valid_token
from app.online_room import OnlineRoom


def test_oauth_primitives():
    assert app_origin("https://play.example") == "https://play.example"
    assert app_origin("http://127.0.0.1:8787") == "http://127.0.0.1:8787"
    for url in ("http://play.example", "https://play.example/path",
                "https://user@play.example", "https://play.example?x"):
        with pytest.raises(ValueError):
            app_origin(url)
    for _ in range(2):
        value = token()
        assert valid_token(value)
        assert valid_token(pkce_challenge(value))
        assert len(digest(value)) == 64
    assert pkce_challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk") == (
        "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
    )
    settings = cookie("session", "test", 30, "https://play.example")
    assert "; HttpOnly; SameSite=Lax; Max-Age=30; Secure" in settings
    assert "; Secure" not in cookie("session", "test", 30, "http://127.0.0.1:8787")


def test_online_room_privacy_and_resume():
    first = OnlineRoom("ABCD", "invite-secret", 500)
    a = first.join("100", "alpha", 10)
    b = first.join("200", "beta", 10)
    assert first.join("100", "renamed", 11) is a
    assert first.member("999") is None
    assert first.deadline() == 40

    first.connect(a, "conn-a", 12)
    first.connect(b, "conn-b", 12)
    first.action(a, {"type": "set_ready", "ready": True})
    first.action(b, {"type": "set_ready", "ready": True})
    with pytest.raises(game.RuleError):
        first.action(b, {"type": "start_game"})
    first.action(a, {"type": "start_game"})
    first.action(a, {"type": "choose_fleet", "fleet": "blue"})
    first.action(b, {"type": "choose_fleet", "fleet": "red"})
    first.action(a, {"type": "begin_deployment"})
    first.action(a, {"type": "set_roles",
                     "roles": ["attack", "attack", "scout", "scout", "mothership"]})

    other = OnlineRoom("EFGH", "different-invite", 500)
    other.join("100", "alpha", 10)
    assert other.snapshot(None, set())["game"] is None
    first = OnlineRoom.load(first.dump())
    a = first.member("100")
    b = first.member("200")
    assert a.id != other.member("100").id
    own = first.snapshot(a.id, {"conn-a"})["game"]["crews"][0]
    public = first.snapshot(b.id, {"conn-a"})["game"]["crews"][0]
    assert own["ships"][0]["role"] == "attack"
    assert "role" not in public["ships"][0]
    assert all(value not in json.dumps(first.snapshot(b.id, {"conn-a"}))
               for value in ("invite-secret", "conn-a", "github_id"))

    first.connect(a, "conn-a2", 40)
    assert first.disconnect(a, "conn-a", 41) is False
    assert first.member("100").connection == "conn-a2"
    assert first.disconnect(b, "conn-b", 42)
    assert first.game is not None
    assert first.expire(131) == []
    assert first.expire(162) == [a, b]
    assert first.game is None


def test_room_capacity_host_transfer_and_expiry():
    room = OnlineRoom("ROOM", "secret", 100)
    owner = room.join("1", "one", 10)
    successor = room.join("2", "two", 10)
    room.join("3", "three", 10)
    room.join("4", "four", 10)
    with pytest.raises(game.RuleError):
        room.join("5", "five", 10)
    room.leave(owner)
    assert room.host is successor
    remaining = list(room.players.values())
    assert room.expire(40) == remaining
    assert not room.players
    assert room.deadline() == 100
