"""V3 world events. Randomness, deadlines and continuations are server owned."""
import copy
import secrets
import time

from . import combat, game as rules

NEBULAE = [(1, "C"), (3, "B"), (6, "A"), (9, "C"), (11, "B"),
           (14, "A"), (17, "C"), (19, "B"), (22, "A")]
CARDS = {
    "nebula": [("gear-up", 4), ("gear-down", 4), ("get-missile", 3),
               ("get-probe", 3), ("nebula-energy", 6), ("meteor", 4)],
    "droplet": [("restore", 6), ("energy1", 6), ("energy2", 2)],
}
NAMES = {"gear-up": "前进档位 +1", "gear-down": "前进档位 -1", "get-missile": "获得导弹",
         "get-probe": "获得探测器", "nebula-energy": "能量 +2", "meteor": "受到一次攻击",
         "restore": "恢复攻击能力", "energy1": "能量 +1", "energy2": "能量 +2"}


def start_spawn(game, purpose):
    pending(game, "world_coordinate", 4, purpose=purpose, stage="roll")


def initialize(game):
    game["world"] = {"nebulae": [dict(column=c, ring=r) for c, r in NEBULAE],
                     "fragments": [], "trails": [], "black_domains": [], "droplet": None}


def cell_in(cells, ship):
    return any(c["column"] == ship["column"] and c["ring"] == ship["ring"] for c in cells)


def coordinate():
    column, die = secrets.randbelow(24) + 1, secrets.randbelow(6) + 1
    return {"column": column, "ring": "ABC"[(die - 1) // 2], "die6": die}


def opposite(cell):
    return {"column": (cell["column"] + 11) % 24 + 1, "ring": {"A": "C", "B": "B", "C": "A"}[cell["ring"]]}


def pending(game, kind, seconds, **fields):
    now = time.time()
    game["pending"] = {"id": secrets.token_hex(8), "type": kind, "started_at": now,
                       "until": now + seconds, **fields}
    game["due_at"] = game["busy_until"] = now + seconds


def stop(game, owner, ship, reduction=None):
    if game["movement"]:
        for lane in game["movement"]["lanes"]:
            if lane["owner"] == owner and lane["number"] == ship["number"]:
                lane["remaining"] = 0 if reduction is None else max(0, lane["remaining"] - reduction)


def start_fragment(game, contact):
    if "world" not in game or contact.get("fragment_done"):
        return False
    owner = contact["owner"]
    for number in contact["numbers"]:
        ship = game["crews"][owner]["ships"][number - 1]
        checked = contact.setdefault("fragment_checked", [])
        if number in checked or ship["destroyed"]:
            continue
        checked.append(number)
        if cell_in(game["world"]["fragments"], ship):
            pending(game, "fragment_check", 4, owner=owner, number=number, stage="roll", contact=contact)
            return True
    contact["fragment_done"] = True
    return False


def tiles(game, contact):
    if "world" not in game:
        return False
    owner, world = contact["owner"], game["world"]
    # Each contact has its own cursor so a suspended card never repeats earlier events.
    for stage, category in enumerate(("black_domains", "nebulae", "trails")):
        if category != "trails" and not contact.get("entered"):
            continue
        for number in contact["numbers"]:
            key = f"{stage}:{number}"
            if key in contact.setdefault("tiles_done", []):
                continue
            contact["tiles_done"].append(key)
            ship = game["crews"][owner]["ships"][number - 1]
            if ship["destroyed"] or ship.get("phased") or number in contact.get("fragment_checked", []) and cell_in(world["fragments"], ship):
                continue
            if (ship["column"], ship["ring"]) != (contact["column"], contact["ring"]) or not cell_in(world[category], ship):
                continue
            if category == "black_domains":
                ship["gear"] = 0
                stop(game, owner, ship)
                world[category][:] = [c for c in world[category] if not cell_in([c], ship)]
                rules.log(game, owner, f'{number}号：进入黑域，降至0档并停止行程')
                continue
            deck = "nebula" if category == "nebulae" else "droplet"
            cards = [card for card, weight in CARDS[deck] for _ in range(weight)]
            card = cards[secrets.randbelow(len(cards))]
            pending(game, "event_card", 3.2, owner=owner, number=number, deck=deck, card=card,
                    label=NAMES[card], contact=contact)
            return True
    return False


def settle_card(game, p):
    owner, number, card = p["owner"], p["number"], p["card"]
    ship, crew = game["crews"][owner]["ships"][number - 1], game["crews"][owner]
    if not ship["destroyed"]:
        if card == "gear-up":
            ship["gear"] = min(3, ship["gear"] + 1)
        elif card == "gear-down":
            before = ship["gear"]
            ship["gear"] = max(0, before - 1)
            stop(game, owner, ship, before - ship["gear"])
        elif card in ("get-missile", "get-probe"):
            item = "missile" if card == "get-missile" else "probe"
            ship[item] = True
            combat.effect(game, "pickup", owner, ship, items={item: 1})
        elif card == "meteor":
            combat.damage(game, [(owner, number)], 1)
        elif card == "restore":
            if ship["role"] in ("attack", "mothership"):
                ship["ammo"] = 1
        else:
            amount = 1 if card == "energy1" else 2
            crew["energy"] += amount
            combat.effect(game, "pickup", owner, ship, items={"energy": amount})
        rules.log(game, owner, f'{number}号：抽取{"星云" if p["deck"] == "nebula" else "水滴"}事件 · {NAMES[card]}')
    if p["deck"] == "droplet":
        c = p["contact"]
        game["world"]["trails"][:] = [t for t in game["world"]["trails"] if (t["column"], t["ring"]) != (c["column"], c["ring"])]


def resume_contact(game, p):
    if game["phase"] == "battle":
        game["contacts"].insert(0, p["contact"])


def start_droplet_turn(game):
    pending(game, "droplet_roll", 4, stage="roll")


def droplet_hit(game):
    droplet = game["world"]["droplet"]
    victims = [(o, s["number"]) for o, s in combat.at_cell(game, droplet["column"], droplet["ring"])]
    if victims:
        combat.damage(game, victims, 2)


def droplet_move(game, old):
    d = game["world"]["droplet"]
    game["effect_id"] += 1
    game["effects"].append({"id": game["effect_id"], "kind": "droplet_move", "at": time.time(),
                            **d, "from_column": old["column"], "from_ring": old["ring"]})
    game["effects"] = game["effects"][-128:]
    game["due_at"] = game["busy_until"] = time.time() + .55
    game["droplet_action"]["arriving"] = True


def add_marker(game, black=False):
    world, d = game["world"], game["world"]["droplet"]
    cell = {"column": d["column"], "ring": d["ring"]}
    if black:
        world["trails"][:] = [t for t in world["trails"] if t != cell]
    target = world["black_domains" if black else "trails"]
    if cell not in target and (black or cell not in world["black_domains"]):
        target.append(cell)


def advance(game):
    """Consume world pending deadlines before the V2 scheduler runs."""
    p = game["pending"]
    if p and p["type"] in ("world_coordinate", "fragment_check", "event_card", "droplet_roll"):
        if time.time() < p["until"]:
            game["due_at"] = p["until"]
            return True
        kind = p["type"]
        if kind == "event_card":
            game["pending"] = None
            settle_card(game, p)
            resume_contact(game, p)
        elif kind == "fragment_check":
            if p["stage"] == "roll":
                roll = secrets.randbelow(24) + 1
                p.update(stage="result", roll=roll, success=roll >= 12, until=time.time() + 2)
            else:
                ship = game["crews"][p["owner"]]["ships"][p["number"] - 1]
                stop(game, p["owner"], ship)
                if p["success"]:
                    ship["phased"] = True
                    rules.log(game, p["owner"], f'{p["number"]}号：四维留存判定成功（{p["roll"]}），留存在原格')
                    game["pending"] = None
                    resume_contact(game, p)
                else:
                    rules.log(game, p["owner"], f'{p["number"]}号：四维留存判定失败（{p["roll"]}），准备传送')
                    pending(game, "world_coordinate", 4, purpose="teleport", stage="roll",
                            owner=p["owner"], number=p["number"], contact=p["contact"])
        elif kind == "world_coordinate":
            if p["stage"] == "roll":
                p.update(stage="results", coordinate=coordinate(), until=time.time() + 2)
            elif p["stage"] == "results":
                p.update(stage="coordinate", until=time.time() + 2)
            elif p["purpose"] == "fragments" and p["stage"] == "coordinate":
                p.update(stage="opposite", opposite=opposite(p["coordinate"]), until=time.time() + 2)
            else:
                game["pending"] = None
                cell = {k: p["coordinate"][k] for k in ("column", "ring")}
                if p["purpose"] == "droplet":
                    game["world"]["droplet"] = {**cell, "direction": 1}
                    # During initial setup there are no ships yet.
                elif p["purpose"] == "fragments":
                    game["world"]["fragments"] = [cell, opposite(cell)]
                    game["battle_starts_at"] = time.time() + 2
                    combat.begin_turn(game)
                else:
                    ship = game["crews"][p["owner"]]["ships"][p["number"] - 1]
                    ship.update(**cell, phased=False)
                    rules.log(game, p["owner"], f'{p["number"]}号：传送至 {cell["column"]}{cell["ring"]}')
                    resume_contact(game, p)
                    game["contacts"].insert(0, {**cell, "owner": p["owner"], "number": p["number"],
                                               "entered": True, "ready_at": 0})
        else:
            if p["stage"] == "roll":
                p.update(stage="result", roll=secrets.randbelow(24) + 1, until=time.time() + 2)
            else:
                roll, d = p["roll"], game["world"]["droplet"]
                game["pending"] = None
                old = copy.copy(d)
                if 6 <= roll <= 15:
                    index = "ABC".index(d["ring"]) + (-1 if roll <= 10 else 1)
                    d["ring"] = "ABC"[max(0, min(2, index))]
                elif 16 <= roll <= 20:
                    d["direction"] *= -1
                game["droplet_action"] = {"remaining": 12 if roll >= 21 else 6, "black": roll >= 21, "marked": False}
                if old["ring"] != d["ring"]:
                    droplet_move(game, old)
                    return True
        if game["pending"]:
            game["due_at"] = game["busy_until"] = game["pending"]["until"]
            return True
        if game["phase"] == "placement":
            game["due_at"] = game["busy_until"] = 0
            return True
        # Re-enter normal scheduling once the card/result has disappeared.
        if not game.get("droplet_action"):
            return False
    if game.get("droplet_action") and game["phase"] == "battle":
        action, d = game["droplet_action"], game["world"]["droplet"]
        if action.pop("arriving", False):
            droplet_hit(game)
            if game["phase"] != "battle":
                return True
        if not action["marked"]:
            add_marker(game, action["black"])
            action["marked"] = True
        if action["remaining"]:
            old = copy.copy(d)
            d["column"] = (d["column"] - 1 + d["direction"]) % 24 + 1
            action["remaining"] -= 1
            droplet_move(game, old)
        else:
            game["droplet_action"] = None
            game["round"] += 1
            combat.begin_turn(game)
        return True
    return False


def public_pending(game):
    p = copy.deepcopy(game["pending"])
    if p:
        p.pop("contact", None)
    return p
