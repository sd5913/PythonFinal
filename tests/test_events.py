"""V3 integration regressions with a deterministic server clock and dice."""
from unittest.mock import patch

import pytest

from app import combat, events, game
from app.main import Player, Room


def step(state):
    with patch("time.time", return_value=state["due_at"] + .01):
        combat.advance(state)


def finish(state):
    for _ in range(300):
        if not state["due_at"]:
            return
        step(state)
    raise AssertionError("event queue did not settle")


def command(room, owner, kind, **fields):
    game.apply(room, owner, {"type": kind, **fields})


@pytest.fixture
def setup():
    room = Room("V3TEST")
    for owner in "ab":
        room.players[owner] = Player(owner, owner, owner, True, object())
    command(room, "a", "start_game")
    for owner, fleet in zip("ab", ("blue", "red")):
        command(room, owner, "choose_fleet", fleet=fleet)
    command(room, "a", "begin_deployment")
    for owner in "ab":
        command(room, owner, "set_roles", roles=["attack", "scout", "mothership", "attack", "scout"])
    return room


@pytest.fixture
def match(setup):
    room, state = setup, setup.game
    with patch("app.events.secrets.randbelow", side_effect=[23, 5]):
        finish(state)  # droplet at 24C, before placement
    for number in range(1, 6):
        for i, owner in enumerate("ab"):
            command(room, owner, "place_ship", ship=number, column=number + i * 12, ring="B", direction=1)
    with patch("app.events.secrets.randbelow", side_effect=[9, 5]):
        finish(state)  # fragments at 10C / 22A, then battle intro
    state["battle_starts_at"] = state["busy_until"] = 0
    return room


def ship(room, owner="a", number=1):
    return room.game["crews"][owner]["ships"][number - 1]


def empty_world(state):
    for key in ("nebulae", "fragments", "trails", "black_domains"):
        state["world"][key] = []


def enter(state, owner, number):
    s = state["crews"][owner]["ships"][number - 1]
    state["contacts"] = [{"owner": owner, "number": number, "column": s["column"], "ring": s["ring"], "entered": True}]
    combat.pump(state)


def test_setup_precedes_deployment_and_is_server_locked(setup):
    state = setup.game
    assert state["pending"]["purpose"] == "droplet"
    assert len(state["world"]["nebulae"]) == 9
    with pytest.raises(game.RuleError):
        command(setup, "a", "place_ship", ship=1, column=1, ring="A", direction=1)
    with patch("app.events.secrets.randbelow", side_effect=[23, 5]):
        finish(state)
    assert state["phase"] == "placement" and state["world"]["droplet"]["column"] == 24
    with pytest.raises(game.RuleError, match="水滴"):
        command(setup, "a", "place_ship", ship=1, column=24, ring="C", direction=1)


def test_setup_fragments_and_opposite_coordinates(match):
    assert match.game["world"]["fragments"] == [{"column": 10, "ring": "C"}, {"column": 22, "ring": "A"}]
    assert events.opposite({"column": 14, "ring": "A"}) == {"column": 2, "ring": "C"}
    assert events.opposite({"column": 5, "ring": "B"}) == {"column": 17, "ring": "B"}
    assert not match.game["resolving"] if "resolving" in match.game else not match.game["due_at"]


@pytest.mark.parametrize("roll,card", [(0,"gear-up"),(4,"gear-down"),(8,"get-missile"),(11,"get-probe"),(14,"nebula-energy"),(20,"meteor")])
def test_nebula_weights_and_public_card(match, roll, card):
    state = match.game
    empty_world(state)
    ship(match).update(column=6, ring="A", gear=2)
    state["world"]["nebulae"] = [{"column": 6, "ring": "A"}]
    with patch("app.events.secrets.randbelow", return_value=roll):
        enter(state, "a", 1)
    assert state["pending"]["card"] == card
    a, b = game.public_state(match,"a"), game.public_state(match,"b")
    assert a["pending"] == b["pending"] and "contact" not in a["pending"]
    with pytest.raises(game.RuleError):
        command(match, "a", "end_turn")
    finish(state)
    assert not state["pending"] and not state["due_at"]


@pytest.mark.parametrize("roll,end,gear", [(0,8,3),(4,7,2)])
def test_speed_event_resumes_only_remaining_path(match, roll, end, gear):
    state = match.game
    empty_world(state)
    ship(match).update(column=5, ring="A")
    state["world"]["nebulae"] = [{"column":6,"ring":"A"}]
    command(match,"a","set_gear",ship=1,gear=3)
    with patch("app.events.secrets.randbelow",return_value=roll):
        finish(state)
    assert (ship(match)["column"],ship(match)["gear"]) == (end,gear)


def test_black_stops_but_still_draws_nebula_then_picks_up(match):
    state = match.game
    empty_world(state)
    ship(match).update(column=5,ring="A")
    cell = {"column":6,"ring":"A"}
    state["world"]["black_domains"]=[cell.copy()]
    state["world"]["nebulae"]=[cell.copy()]
    combat.ground(state,6,"A")["energy"]=3
    command(match,"a","set_gear",ship=1,gear=3)
    with patch("app.events.secrets.randbelow",return_value=14):
        step(state);step(state)
    assert ship(match)["gear"]==0 and state["pending"]["card"]=="nebula-energy"
    assert state["crews"]["a"]["energy"]==9
    finish(state)
    assert ship(match)["column"]==6 and state["crews"]["a"]["energy"]==14
    assert not state["world"]["black_domains"]


@pytest.mark.parametrize("role,expected",[("attack",1),("mothership",1),("scout",0)])
def test_trail_restore_native_only_and_remove_after_settlement(match,role,expected):
    state=match.game
    empty_world(state)
    ship(match).update(column=6,ring="A",role=role,ammo=0)
    state["world"]["trails"]=[{"column":6,"ring":"A"}]
    with patch("app.events.secrets.randbelow",return_value=0):
        enter(state,"a",1)
    assert state["world"]["trails"] and ship(match)["ammo"]==0
    finish(state)
    assert ship(match)["ammo"]==expected and not ship(match)["missile"]
    assert not state["world"]["trails"]


def test_four_dimensional_success_immunity_and_recheck(match):
    state=match.game
    empty_world(state)
    s=ship(match)
    s.update(column=6,ring="A",gear=3)
    state["world"]["fragments"]=[{"column":6,"ring":"A"}]
    state["world"]["nebulae"]=[{"column":6,"ring":"A"}]
    with patch("app.events.secrets.randbelow",return_value=11):
        enter(state,"a",1);finish(state)
    assert s["phased"] and s["column"]==6
    combat.damage(state,[("a",1)],2)
    assert s["damage"]==0
    with pytest.raises(game.RuleError):
        command(match,"a","set_gear",ship=1,gear=2)
    combat.begin_turn(state)
    assert state["pending"]["type"]=="fragment_check"
    with patch("app.events.secrets.randbelow",return_value=23):finish(state)
    assert s["column"]==6 and s["phased"] and not state["pending"]


def test_four_dimensional_failure_teleports_into_collision(match):
    state=match.game
    empty_world(state)
    ship(match).update(column=6,ring="A",gear=3,phased=True)
    state["world"]["fragments"]=[{"column":6,"ring":"A"}]
    ship(match,"b").update(column=8,ring="B")
    # Failure roll, teleport column, teleport ring.
    with patch("app.events.secrets.randbelow",side_effect=[0,7,2]):
        enter(state,"a",1);finish(state)
    assert (ship(match)["column"],ship(match)["ring"])==(8,"B")
    assert not ship(match)["phased"] and state["pending"]["type"]=="collision_choice"
    command(match,"a","collision_choice",event_id=state["pending"]["id"],collide=False)
    finish(state)
    assert not state["pending"]


@pytest.mark.parametrize("roll,ring,column,direction,black",[(1,"B",7,1,False),(6,"A",7,1,False),(11,"C",7,1,False),(16,"B",19,-1,False),(21,"B",13,1,True)])
def test_droplet_round_actions_and_single_start_marker(match,roll,ring,column,direction,black):
    state=match.game
    empty_world(state)
    for owner,s in combat.living(state):s.update(column=20,ring="C")
    d=state["world"]["droplet"]
    d.update(column=1,ring="B",direction=1)
    state["world"]["trails"]=[{"column":1,"ring":"B"}] if black else []
    state["turn_index"]=1
    combat.next_turn(state)
    assert state["pending"]["type"]=="droplet_roll" and state["round"]==1
    with patch("app.events.secrets.randbelow",return_value=roll-1):finish(state)
    assert (d["ring"],d["column"],d["direction"])==(ring,column,direction)
    markers=state["world"]["black_domains" if black else "trails"]
    assert markers==[{"column":1,"ring":ring}]
    assert state["round"]==2 and not state.get("droplet_action")
    if black:assert not state["world"]["trails"]


def test_droplet_radial_collision_and_phased_immunity(match):
    state=match.game
    empty_world(state)
    state["world"]["droplet"].update(column=8,ring="B",direction=1)
    ship(match).update(column=8,ring="A")
    ship(match,"b").update(column=9,ring="A",phased=True)
    events.start_droplet_turn(state)
    with patch("app.events.secrets.randbelow",return_value=5):finish(state)
    assert ship(match)["destroyed"] and ship(match,"b")["damage"]==0


def test_stationary_trail_triggers_but_stationary_nebula_does_not(match):
    state=match.game
    empty_world(state)
    cell={"column":1,"ring":"B"}
    state["world"]["trails"]=[cell.copy()]
    state["world"]["nebulae"]=[cell.copy()]
    with patch("app.events.secrets.randbelow",return_value=6):
        combat.begin_turn(state)
        assert state["pending"]["deck"]=="droplet"
        finish(state)
    assert state["crews"]["a"]["energy"]==13 and not state["world"]["trails"]


def test_entering_droplet_cell_causes_damage_without_triggering_droplet_events(match):
    state=match.game
    empty_world(state)
    state["world"]["droplet"].update(column=6,ring="A")
    ship(match).update(column=5,ring="A")
    command(match,"a","set_gear",ship=1,gear=3)
    finish(state)
    assert ship(match)["destroyed"] and not state["pending"]
