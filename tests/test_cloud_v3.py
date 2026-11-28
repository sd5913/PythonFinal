"""Cloud saves must resume V3 deadlines and continuations after every reload."""
import copy
import time
from unittest.mock import patch
import pytest
from app import game, combat, events
from app.online_room import OnlineRoom, Seat
from tests.test_events import match, setup, ship, empty_world, enter


def online(state):
    room = OnlineRoom("V3", "invite", time.time()+21600)
    room.game = copy.deepcopy(state)
    room.players = {owner: Seat(owner, owner, owner, time.time()+120, connection=owner, online=True)
                    for owner in state["order"]}
    return room


def reload_and_advance(room):
    room = OnlineRoom.load(room.dump())
    with patch("time.time",return_value=room.game["due_at"]+.01):
        assert room.advance()
    return room


@pytest.mark.parametrize("card_index,column",[(0,8),(4,7)])
def test_reload_during_draw_resumes_remaining_movement(match,card_index,column):
    state=match.game;empty_world(state)
    ship(match).update(column=5,ring="A")
    state["world"]["nebulae"]=[{"column":6,"ring":"A"}]
    room=online(state)
    room.action(room.players["a"],{"type":"set_gear","ship":1,"gear":3})
    with patch("app.events.secrets.randbelow",return_value=card_index):
        for _ in range(30):
            if not room.game["due_at"]:break
            assert room.deadline()<=room.game["due_at"]
            room=reload_and_advance(room)
    assert room.game["crews"]["a"]["ships"][0]["column"]==column
    assert not room.game["pending"] and not room.game["movement"]


def test_reload_during_fragment_and_droplet(match):
    state=match.game;empty_world(state)
    ship(match).update(column=6,ring="A",gear=3)
    state["world"]["fragments"]=[{"column":6,"ring":"A"}]
    enter(state,"a",1)
    room=online(state)
    with patch("app.events.secrets.randbelow",return_value=23):
        while room.game["due_at"]:room=reload_and_advance(room)
    assert room.game["crews"]["a"]["ships"][0]["phased"]
    room.game["world"]["droplet"].update(column=1,ring="C")
    events.start_droplet_turn(room.game)
    with patch("app.events.secrets.randbelow",return_value=20):
        for _ in range(100):
            if not room.game["due_at"]:break
            room=reload_and_advance(room)
    assert room.game["world"]["droplet"]["column"]==13
    assert room.game["world"]["black_domains"]==[{"column":1,"ring":"C"}]


def test_exit_resets_online_v3_and_log_ids_survive_limit(match):
    room=online(match.game)
    for _ in range(210):game.log(room.game,"a","entry","event")
    room.trim_logs()
    last=room.game["logs"][-1]["id"]
    game.log(room.game,"a","next","event")
    assert room.game["logs"][-1]["id"]==last+1
    room.action(room.players["a"],{"type":"exit_game"})
    assert room.game is None and all(not p.ready for p in room.players.values())
