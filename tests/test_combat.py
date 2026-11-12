"""V2 rule regressions, including interrupted paths and simultaneous defeat."""
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app import combat, game
from app.main import Player, Room, app


@pytest.fixture
def match():
    room = Room("V2TEST")
    for owner, fleet in zip("abc", ("blue", "red", "gray")):
        room.players[owner] = Player(owner, owner, owner, True, object())
    game.apply(room, "a", {"type": "start_game"})
    for owner, fleet in zip("abc", ("blue", "red", "gray")):
        game.apply(room, owner, {"type": "choose_fleet", "fleet": fleet})
    game.apply(room, "a", {"type": "begin_deployment"})
    for owner in "abc":
        game.apply(room, owner, {"type": "set_roles", "roles": ["attack", "scout", "mothership", "attack", "scout"]})
    for number in range(1, 6):
        for offset, owner in enumerate("abc"):
            game.apply(room, owner, {"type": "place_ship", "ship": number,
                                    "column": (number - 1) * 3 + offset + 1, "ring": "B", "direction": 1})
    room.game["battle_starts_at"] = 0
    finish(room.game)
    return room


def step(state):
    with patch("app.combat.time.time", return_value=state["due_at"] + .01):
        combat.advance(state)


def finish(state):
    for _ in range(100):
        if not state["due_at"]:
            return
        step(state)
    raise AssertionError("Resolution failed to settle")


def action(room, owner, kind, **fields):
    game.apply(room, owner, {"type": kind, **fields})


def ship(room, owner, number=1):
    return room.game["crews"][owner]["ships"][number - 1]


def collide(room, participants):
    for owner, number in participants:
        ship(room, owner, number).update(column=22, ring="A")
    room.game["contacts"] = [{"owner": "a", "column": 22, "ring": "A"}]
    combat.pump(room.game)


def choose(room, collide=True):
    action(room, "a", "collision_choice", event_id=room.game["pending"]["id"], collide=collide)


def test_attack_component_first_and_no_nonfatal_energy(match):
    own, enemy = ship(match, "a"), ship(match, "b")
    own["missile"] = True
    action(match, "a", "attack", ship=1, target_owner="b", target_ship=1)
    assert own["ammo"] == 1 and own["missile"] is False
    assert enemy["damage"] == 1
    assert match.game["ground"] == [] and match.game["tactic_used"]
    finish(match.game)
    with pytest.raises(game.RuleError):
        action(match, "a", "attack", ship=1, target_owner="b", target_ship=1)


def test_tactic_and_movement_can_use_different_ships_and_wrap_range(match):
    ship(match, "a").update(column=24, ring="A")
    ship(match, "b").update(column=2, ring="C")
    action(match, "a", "attack", ship=1, target_owner="b", target_ship=1)
    finish(match.game)
    action(match, "a", "set_gear", ship=2, gear=1)
    finish(match.game)
    assert match.game["move_ship"] == 2 and match.game["tactic_used"]


@pytest.mark.parametrize("question,expected", [("attack", "可攻击"), ("scout", "不可探测")])
def test_probe_cost_and_native_answers_ignore_ammo_and_components(match, question, expected):
    own, enemy = ship(match, "a", 2), ship(match, "b")
    own["probe"] = True
    enemy["ammo"] = 0
    enemy["probe"] = True
    action(match, "a", "scan", ship=2, target_owner="b", target_ship=1, question=question)
    assert match.game["crews"]["a"]["energy"] == 12 and own["probe"] is False
    assert "text" not in game.public_state(match, "b")["pending"]
    step(match.game)
    assert expected in game.public_state(match, "b")["pending"]["text"]
    finish(match.game)


def test_native_scan_costs_two_and_rejects_illegal_without_mutation(match):
    own = ship(match, "a", 2)
    with pytest.raises(game.RuleError):
        action(match, "a", "scan", ship=2, target_owner="b", target_ship=1, question="role")
    assert not match.game["tactic_used"] and match.game["crews"]["a"]["energy"] == 12
    action(match, "a", "scan", ship=2, target_owner="b", target_ship=1, question="attack")
    assert match.game["crews"]["a"]["energy"] == 10


def test_private_views_do_not_expose_native_ammo_or_roles(match):
    for crew in game.public_state(match, "a")["crews"]:
        for item in crew["ships"]:
            assert ("role" in item) == (crew["id"] == "a")
            assert ("ammo" in item) == (crew["id"] == "a")


def test_group_collision_rolls_once_per_player_and_tie_succeeds(match):
    collide(match, [("a", 1), ("a", 4), ("b", 1), ("c", 1)])
    assert match.game["pending"]["players"] == list("abc")
    choose(match)
    with patch("app.combat.secrets.randbelow", side_effect=[5, 2, 2]) as rolls:
        step(match.game)
    assert rolls.call_count == 3
    assert match.game["pending"]["success"]  # 6 >= 3 + 3
    finish(match.game)
    assert all(ship(match, o, n)["destroyed"] for o, n in [("a", 1), ("a", 4), ("b", 1), ("c", 1)])


def test_failed_collision_picks_up_and_cannot_replay_choice(match):
    collide(match, [("a", 1), ("b", 1)])
    combat.ground(match.game, 22, "A").update(energy=5, missile=1, repair=1)
    event_id = match.game["pending"]["id"]
    choose(match)
    with pytest.raises(game.RuleError):
        action(match, "a", "collision_choice", event_id=event_id, collide=True)
    with patch("app.combat.secrets.randbelow", side_effect=[0, 5]):
        step(match.game)
    finish(match.game)
    assert ship(match, "a")["damage"] == 0
    assert match.game["crews"]["a"]["energy"] == 17
    assert ship(match, "a")["missile"]
    assert not match.game["ground"]


def test_surviving_motherships_trigger_owner_gets_drops_first(match):
    collide(match, [("a", 3), ("b", 3), ("c", 1)])
    choose(match)
    with patch("app.combat.secrets.randbelow", side_effect=[5, 0, 0]):
        step(match.game)
    finish(match.game)
    assert ship(match, "a", 3)["damage"] == 1  # two damage, then immediate repair
    assert ship(match, "b", 3)["damage"] == 2
    assert ship(match, "c")["destroyed"]
    assert match.game["crews"]["a"]["energy"] == 13
    assert ship(match, "a", 3)["missile"]


def test_friendly_overlap_no_collision_and_lowest_number_gets_items(match):
    ship(match, "a").update(column=22, ring="A", missile=True, damage=1)
    ship(match, "a", 2).update(column=22, ring="A")
    combat.ground(match.game, 22, "A").update(missile=2, probe=1, repair=3)
    match.game["contacts"] = [{"owner": "a", "column": 22, "ring": "A"}]
    combat.pump(match.game)
    assert match.game["pending"] is None
    assert ship(match, "a")["probe"] and not ship(match, "a", 2)["probe"]
    assert ship(match, "a")["damage"] == 0 and not match.game["ground"]


def test_stepwise_acceleration_interrupt_resume_and_turn_locked(match):
    ship(match, "a").update(column=20, ring="A")
    ship(match, "b").update(column=21, ring="A")
    combat.ground(match.game, 21, "A")["energy"] = 3
    action(match, "a", "set_gear", ship=1, gear=3)
    step(match.game)  # arrival at 21
    step(match.game)  # collision choice before pickup
    assert match.game["pending"]["type"] == "collision_choice"
    assert ship(match, "a")["column"] == 21 and match.game["crews"]["a"]["energy"] == 9
    with pytest.raises(game.RuleError):
        action(match, "a", "end_turn")
    choose(match, False)
    finish(match.game)
    assert ship(match, "a")["column"] == 23
    assert match.game["crews"]["a"]["energy"] == 12


def test_passive_collision_wait_does_not_freeze_other_ships(match):
    ship(match, "a").update(column=20, ring="A", gear=3)
    ship(match, "a", 2).update(column=10, ring="C", gear=3)
    ship(match, "b").update(column=21, ring="A")
    combat.begin_turn(match.game)
    finish(match.game)
    assert match.game["pending"]["type"] == "collision_choice"
    assert ship(match, "a")["column"] == 21
    assert ship(match, "a", 2)["column"] == 13
    choose(match, False)
    finish(match.game)
    assert ship(match, "a")["column"] == 23


def test_destroyed_ship_drops_standard_plus_attached_components(match):
    victim = ship(match, "b")
    victim.update(missile=True, probe=True)
    combat.damage(match.game, [("b", 1)], 2)
    pile = match.game["ground"][0]
    assert {k: pile[k] for k in combat.ITEMS} == {"energy": 1, "repair": 1, "missile": 2, "probe": 1}


def test_mothership_chain_and_skip_eliminated_player(match):
    combat.damage(match.game, [("b", 3)], 3)
    assert all(s["destroyed"] for s in match.game["crews"]["b"]["ships"])
    assert len(match.game["ground"]) == 5
    action(match, "a", "end_turn")
    finish(match.game)
    assert game.public_state(match, "a")["current_player"] == "c"
    combat.damage(match.game, [("c", 3)], 3)
    assert match.game["phase"] == "finished" and match.game["winner"] == "a"


def test_simultaneous_last_mothership_destruction_is_draw(match):
    combat.damage(match.game, [("c", 3)], 3)
    ship(match, "a", 3)["damage"] = ship(match, "b", 3)["damage"] = 1
    collide(match, [("a", 3), ("b", 3)])
    choose(match)
    with patch("app.combat.secrets.randbelow", side_effect=[5, 0]):
        step(match.game)
    finish(match.game)
    assert match.game["phase"] == "finished" and match.game["winner"] is None


def test_all_new_media_assets_are_served():
    with TestClient(app) as client:
        for url in ["/static/assets/missile.png", "/static/assets/probe.png", "/static/assets/repair.png",
                    "/static/assets/warning.png", "/visual-effects/effects.js", "/static/media.js",
                    "/static/audio/爆炸.mp3", "/static/audio/获得能量%20.mp3"]:
            assert client.get(url).status_code == 200
