"""Behavioral checks for secrecy, staging and turn/energy rules."""
from contextlib import ExitStack

import pytest
from fastapi.testclient import TestClient

from app import game
from app.main import Player, Room, app, rooms

ROLES = ["attack", "scout", "mothership", "attack", "scout"]


@pytest.fixture
def room():
    room = Room("TEST01")
    for key in ["a", "b"]:
        room.players[key] = Player(key, "token-" + key, key.upper(), True, object())
    return room


def apply(room, player, action, **fields):
    return game.apply(room, player, {"type": action, **fields})


def prepare(room):
    apply(room, "a", "start_game")
    apply(room, "a", "choose_fleet", fleet="blue")
    apply(room, "b", "choose_fleet", fleet="red")
    apply(room, "a", "begin_deployment")
    apply(room, "a", "set_roles", roles=ROLES)
    apply(room, "b", "set_roles", roles=ROLES[::-1])


def battle(room):
    prepare(room)
    for number in range(1, 6):
        for actor in ["a", "b"]:
            column = (number + 22) % 24 + 1 if actor == "a" else number + 11
            apply(room, actor, "place_ship", ship=number, column=column, ring="B", direction=1)
    room.game["battle_starts_at"] = room.game["busy_until"] = 0


def end_turn(room, actor):
    apply(room, actor, "end_turn")
    room.game["busy_until"] = 0


def test_host_and_readiness_required(room):
    with pytest.raises(game.RuleError):
        apply(room, "b", "start_game")
    room.players["b"].ready = False
    with pytest.raises(game.RuleError):
        apply(room, "a", "start_game")
    assert room.game is None


def test_duplicate_fleets_can_be_selected_but_cannot_proceed(room):
    apply(room, "a", "start_game")
    for actor in ["a", "b"]:
        apply(room, actor, "choose_fleet", fleet="blue")
    assert not game.public_state(room, "a")["fleet_valid"]
    with pytest.raises(game.RuleError, match="一名指挥官"):
        apply(room, "a", "begin_deployment")
    apply(room, "b", "choose_fleet", fleet="yellow")
    apply(room, "a", "begin_deployment")
    assert room.game["phase"] == "roles"


def test_roles_are_validated_and_hidden_from_every_other_view(room):
    prepare(room)
    for viewer in ["a", "b", None]:
        state = game.public_state(room, viewer)
        for crew in state["crews"]:
            assert len(crew["ships"]) == 5
            assert all(("role" in s) == (crew["id"] == viewer) for s in crew["ships"])


def test_invalid_roles_do_not_lock_player(room):
    apply(room, "a", "start_game")
    apply(room, "a", "choose_fleet", fleet="blue")
    apply(room, "b", "choose_fleet", fleet="red")
    apply(room, "a", "begin_deployment")
    with pytest.raises(game.RuleError):
        apply(room, "a", "set_roles", roles=["attack"] * 5)
    assert not room.game["crews"]["a"]["roles_ready"]
    apply(room, "a", "set_roles", roles=ROLES)
    assert room.game["phase"] == "roles"
    apply(room, "b", "set_roles", roles=ROLES)
    assert room.game["phase"] == "placement"


def test_placement_is_alternating_and_no_early_battle(room):
    prepare(room)
    with pytest.raises(game.RuleError):
        apply(room, "b", "place_ship", ship=1, column=1, ring="A", direction=-1)
    apply(room, "a", "place_ship", ship=1, column=1, ring="A", direction=-1)
    with pytest.raises(game.RuleError):
        apply(room, "a", "place_ship", ship=2, column=1, ring="A", direction=-1)
    assert room.game["phase"] == "placement" and room.game["logs"] == []


def test_occupied_deployment_rejected_without_consuming_turn(room):
    prepare(room)
    apply(room, "a", "place_ship", ship=1, column=1, ring="A", direction=1)
    with pytest.raises(game.RuleError, match="该格已有舰船"):
        apply(room, "b", "place_ship", ship=1, column=1, ring="A", direction=1)
    assert game.public_state(room, "b")["current_player"] == "b"
    assert room.game["crews"]["b"]["ships"][0]["ring"] is None
    apply(room, "b", "place_ship", ship=1, column=1, ring="B", direction=1)
    with pytest.raises(game.RuleError, match="该格已有舰船"):
        apply(room, "a", "place_ship", ship=2, column=1, ring="A", direction=1)


def test_acceleration_wrap_passive_deceleration_and_rounds(room):
    battle(room)
    crew = room.game["crews"]["a"]
    apply(room, "a", "set_gear", ship=1, gear=3)
    assert crew["energy"] == 9 and crew["ships"][0]["column"] == 3
    with pytest.raises(game.RuleError):
        apply(room, "a", "set_gear", ship=1, gear=1)
    with pytest.raises(game.RuleError):
        apply(room, "b", "end_turn")
    end_turn(room, "a")
    end_turn(room, "b")
    assert room.game["round"] == 2 and crew["ships"][0]["column"] == 6
    apply(room, "a", "set_gear", ship=1, gear=1)
    assert crew["energy"] == 7 and crew["ships"][0]["column"] == 6
    assert any(entry["kind"] == "passive" for entry in room.game["logs"])


@pytest.mark.parametrize("shift_first", [True, False])
def test_shift_and_gear_in_either_order_but_same_ship(room, shift_first):
    battle(room)
    actions = [("shift", {"ring": "A"}), ("set_gear", {"gear": 2})]
    if not shift_first:
        actions.reverse()
    for action, fields in actions:
        apply(room, "a", action, ship=1, **fields)
    assert room.game["crews"]["a"]["energy"] == 9
    assert room.game["crews"]["a"]["ships"][0]["ring"] == "A"
    with pytest.raises(game.RuleError):
        apply(room, "a", "shift", ship=2, ring="A")
    with pytest.raises(game.RuleError):
        apply(room, "a", "shift", ship=1, ring="B")


def test_no_illegal_jump_no_negative_energy_and_zero_gear_turn(room):
    battle(room)
    crew = room.game["crews"]["a"]
    crew["ships"][0]["ring"] = "A"
    with pytest.raises(game.RuleError):
        apply(room, "a", "shift", ship=1, ring="C")
    apply(room, "a", "turn_ship", ship=1)
    assert crew["ships"][0]["direction"] == -1
    crew["energy"] = 1
    with pytest.raises(game.RuleError):
        apply(room, "a", "set_gear", ship=1, gear=3)
    assert crew["energy"] == 1
    apply(room, "a", "set_gear", ship=1, gear=1)
    with pytest.raises(game.RuleError):
        apply(room, "a", "turn_ship", ship=1)


def test_intro_and_passive_phase_reject_actions(room):
    battle(room)
    room.game["busy_until"] = game.time.time() + 100
    with pytest.raises(game.RuleError):
        apply(room, "a", "end_turn")
    with pytest.raises(game.RuleError):
        apply(room, "a", "set_gear", ship=1, gear=1)


def test_any_player_can_exit_to_shared_lobby(room):
    battle(room)
    apply(room, "b", "exit_game")
    assert room.game is None and len(room.players) == 2
    assert not any(p.ready for p in room.players.values())


def test_four_player_deployment_and_private_views(room):
    for key in ["c", "d"]:
        room.players[key] = Player(key, "token-" + key, key.upper(), True, object())
    apply(room, "a", "start_game")
    for actor, fleet in zip("abcd", game.FLEETS):
        apply(room, actor, "choose_fleet", fleet=fleet)
    apply(room, "a", "begin_deployment")
    for actor in "abcd":
        apply(room, actor, "set_roles", roles=ROLES)
    for number in range(1, 6):
        for actor in "abcd":
            assert room.game["order"][room.game["turn_index"]] == actor
            apply(room, actor, "place_ship", ship=number, column=(number - 1) * 4 + "abcd".index(actor) + 1,
                  ring="B", direction=-1)
    assert room.game["phase"] == "battle"
    for viewer in "abcd":
        state = game.public_state(room, viewer)
        assert len(state["crews"]) == 4
        assert sum("role" in ship for crew in state["crews"] for ship in crew["ships"]) == 5
        assert all(crew["energy"] == 12 for crew in state["crews"])


def test_real_room_messages_are_personalized_and_disconnect_resets_match():
    rooms.clear()
    with TestClient(app) as client, ExitStack() as stack:
        a = client.post("/api/rooms", json={"name": "A"}).json()
        b = client.post("/api/rooms/" + a["room_code"] + "/join", json={"name": "B"}).json()
        sockets = []
        for identity in [a, b]:
            ws = stack.enter_context(client.websocket_connect("/ws/" + a["room_code"]))
            ws.send_json(identity); sockets.append(ws)
            for peer in sockets:
                peer.receive_json()
        def broadcast_command(index, action, **fields):
            sockets[index].send_json({"type": action, **fields})
            return [peer.receive_json() for peer in sockets]
        broadcast_command(0, "set_ready", ready=True)
        broadcast_command(1, "set_ready", ready=True)
        broadcast_command(0, "start_game")
        assert client.post("/api/rooms/" + a["room_code"] + "/join", json={"name": "C"}).status_code == 409
        broadcast_command(0, "choose_fleet", fleet="blue")
        broadcast_command(1, "choose_fleet", fleet="red")
        broadcast_command(0, "begin_deployment")
        broadcast_command(0, "set_roles", roles=ROLES)
        states = broadcast_command(1, "set_roles", roles=ROLES)
        for index, state in enumerate(states):
            mine = [a, b][index]["player_id"]
            for crew in state["game"]["crews"]:
                assert all(("role" in s) == (crew["id"] == mine) for s in crew["ships"])
        sockets[1].send_json({"type": "leave"})
        state = sockets[0].receive_json()
        assert state["game"] is None and len(state["players"]) == 1
        assert not state["players"][0]["ready"]
    rooms.clear()
