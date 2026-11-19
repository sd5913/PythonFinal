"""Legacy regression suites isolate V2 rules; V3 tests exercise full setup."""
import pytest
from app import events, combat


@pytest.fixture
def legacy_world(monkeypatch):
    monkeypatch.setattr(events, "initialize", lambda state: None)

    def spawn(state, purpose):
        if purpose == "fragments":
            combat.begin_turn(state)

    monkeypatch.setattr(events, "start_spawn", spawn)
