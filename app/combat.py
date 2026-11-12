"""Server-owned combat and interruptible, step-by-step movement."""
import copy
import secrets
import time

from . import game as rules

STEP_SECONDS = 0.36
ITEMS = ("energy", "missile", "probe", "repair")


def living(game):
    return [(owner, ship) for owner in game["order"]
            for ship in game["crews"][owner]["ships"] if not ship["destroyed"]]


def at_cell(game, column, ring):
    return [(owner, ship) for owner, ship in living(game)
            if ship["column"] == column and ship["ring"] == ring]


def effect(game, kind, owner, ship, **fields):
    game["effect_id"] += 1
    event = {"id": game["effect_id"], "kind": kind, "owner": owner,
             "fleet": game["crews"][owner]["fleet"], "number": ship["number"],
             "column": ship["column"], "ring": ship["ring"],
             "direction": ship["direction"], "at": time.time(), **fields}
    game["effects"].append(event)
    game["effects"] = game["effects"][-128:]


def ground(game, column, ring):
    for pile in game["ground"]:
        if pile["column"] == column and pile["ring"] == ring:
            return pile
    pile = {"column": column, "ring": ring, **dict.fromkeys(ITEMS, 0)}
    game["ground"].append(pile)
    return pile


def pickup(game, column, ring, priority):
    pile = next((p for p in game["ground"]
                 if p["column"] == column and p["ring"] == ring), None)
    candidates = at_cell(game, column, ring)
    if pile is None or not candidates:
        return
    candidates.sort(key=lambda pair: (pair[0] != priority,
                                     game["order"].index(pair[0]), pair[1]["number"]))
    owner, ship = candidates[0]
    crew = game["crews"][owner]
    found = {key: pile[key] for key in ITEMS if pile[key]}
    crew["energy"] += pile["energy"]
    ship["damage"] = max(0, ship["damage"] - pile["repair"])
    for item in ("missile", "probe"):
        if pile[item]:
            ship[item] = True
    game["ground"].remove(pile)
    effect(game, "pickup", owner, ship, items=found)
    names = {"energy": "能量", "missile": "导弹", "probe": "探测器", "repair": "修复组件"}
    rules.log(game, owner, "%s号：拾取 %s" % (
        ship["number"], "、".join("%s×%s" % (names[k], v) for k, v in found.items())))


def damage(game, participants, amount):
    # Apply the entire batch before checking victory so simultaneous defeats draw.
    for owner, number in participants:
        ship = game["crews"][owner]["ships"][number - 1]
        if not ship["destroyed"]:
            ship["damage"] += amount
            effect(game, "hit", owner, ship)
            rules.log(game, owner, "%s号：受击 %s 点" % (number, amount))
    dead = [(owner, ship) for owner, ship in living(game)
            if ship["damage"] >= (3 if ship["role"] == "mothership" else 2)]
    eliminated = {owner for owner, ship in dead if ship["role"] == "mothership"}
    for owner in eliminated:
        game["crews"][owner]["eliminated"] = True
    # Mothership first, then its remaining fleet in number order.
    for owner in game["order"]:
        crew = game["crews"][owner]
        ships = [s for o, s in dead if o == owner]
        if owner in eliminated:
            mother = next(s for s in crew["ships"] if s["role"] == "mothership")
            ships = [mother] + [s for s in crew["ships"] if s is not mother and not s["destroyed"]]
        for ship in ships:
            ship["destroyed"] = True
            pile = ground(game, ship["column"], ship["ring"])
            pile["energy"] += 1
            pile["repair"] += 1
            pile["missile"] += int(ship["role"] in ("attack", "mothership")) + int(ship["missile"])
            pile["probe"] += int(ship["role"] in ("scout", "mothership")) + int(ship["probe"])
            ship["missile"] = ship["probe"] = False
            effect(game, "destroy", owner, ship)
            rules.log(game, owner, "%s号：被摧毁，在 %s%s 留下资源" % (
                ship["number"], ship["column"], ship["ring"]))
    survivors = [owner for owner in game["order"] if not game["crews"][owner]["eliminated"]]
    if len(survivors) <= 1:
        game["phase"] = "finished"
        game["winner"] = survivors[0] if survivors else None
        game["movement"] = None
        game["contacts"] = []
        game["pending"] = None
        game["due_at"] = 0
        rules.log(game, survivors[0] if survivors else None,
                  "最后的幸存者：" + game["crews"][survivors[0]]["name"] if survivors else "双方母舰同时摧毁，平局。", "result")


def begin_turn(game):
    game["move_ship"] = None
    game["gear_used"] = game["shift_used"] = game["tactic_used"] = False
    actor = game["order"][game["turn_index"]]
    name = game["crews"][actor]["name"]
    rules.log(game, actor, (name if name.endswith("舰长") else name + "舰长") + "的回合", "turn")
    ships = [s for s in game["crews"][actor]["ships"] if not s["destroyed"]]
    game["contacts"] = [{"owner": actor, "column": col, "ring": ring, "ready_at": 0}
                        for col, ring in dict.fromkeys((s["column"], s["ring"]) for s in ships)]
    game["movement"] = {"passive": True, "step_at": max(time.time(), game["battle_starts_at"]) + STEP_SECONDS, "lanes": [
        {"owner": actor, "number": s["number"], "remaining": s["gear"], "waiting": False} for s in ships if s["gear"]]}
    game["due_at"] = max(time.time(), game["battle_starts_at"])
    game["busy_until"] = game["due_at"]
    # Initial intro must finish before overlap or pickup resolution.
    if time.time() >= game["battle_starts_at"]:
        pump(game)


def next_turn(game):
    for _ in game["order"]:
        game["turn_index"] = (game["turn_index"] + 1) % len(game["order"])
        if game["turn_index"] == 0:
            game["round"] += 1
        actor = game["order"][game["turn_index"]]
        if not game["crews"][actor]["eliminated"]:
            begin_turn(game)
            return


def release_cell(game, column, ring):
    if game["movement"]:
        for lane in game["movement"]["lanes"]:
            ship = game["crews"][lane["owner"]]["ships"][lane["number"] - 1]
            if ship["column"] == column and ship["ring"] == ring:
                lane["waiting"] = False


def schedule(game):
    if game["phase"] != "battle":
        return
    now = time.time()
    times = [c["ready_at"] for c in game["contacts"] if c.get("ready_at", 0) > now]
    pending = game["pending"]
    if pending and pending.get("until"):
        times.append(pending["until"])
    movement = game["movement"]
    if movement:
        movement["lanes"] = [lane for lane in movement["lanes"]
                             if not game["crews"][lane["owner"]]["ships"][lane["number"] - 1]["destroyed"]
                             and (lane["remaining"] or lane.get("waiting"))]
        ready = [lane for lane in movement["lanes"] if lane["remaining"] and not lane.get("waiting")]
        if ready:
            movement["step_at"] = max(movement["step_at"], now + .001)
            times.append(movement["step_at"])
        if not movement["lanes"]:
            game["movement"] = None
    game["due_at"] = min(times) if times else 0
    game["busy_until"] = game["due_at"]
    actor = game["order"][game["turn_index"]]
    if not pending and not game["contacts"] and not game["movement"] and not game["due_at"] and game["crews"][actor]["eliminated"]:
        next_turn(game)


def pump(game):
    if game["phase"] != "battle":
        return
    waiting = []
    for contact in game["contacts"]:
        owner, column, ring = contact["owner"], contact["column"], contact["ring"]
        if contact.get("ready_at", 0) > time.time():
            waiting.append(contact)
            continue
        occupants = at_cell(game, column, ring)
        if not any(o == owner for o, _ in occupants):
            release_cell(game, column, ring)
            continue
        players = [o for o in game["order"] if any(p == o for p, _ in occupants)]
        if len(players) > 1:
            pending = game["pending"]
            if pending is None:
                game["pending"] = {
                    "id": secrets.token_hex(8), "type": "collision_choice", "owner": owner,
                    "column": column, "ring": ring, "players": players,
                    "participants": [[o, s["number"]] for o, s in occupants],
                }
            elif pending.get("column") == column and pending.get("ring") == ring:
                # Additional current-player ships can arrive while a choice waits.
                pending["participants"] = [[o, s["number"]] for o, s in occupants]
            else:
                waiting.append(contact)
            continue
        pickup(game, column, ring, owner)
        release_cell(game, column, ring)
    game["contacts"] = waiting
    schedule(game)


def advance(game):
    if game["phase"] != "battle" or not game["due_at"] or time.time() < game["due_at"]:
        return
    game["due_at"] = 0
    pending = game["pending"]
    if pending and pending.get("until", float("inf")) <= time.time():
        if pending["type"] == "collision_roll":
            rolls = {owner: secrets.randbelow(6) + 1 for owner in pending["players"]}
            success = rolls[pending["owner"]] >= sum(v for owner, v in rolls.items() if owner != pending["owner"])
            pending.update(type="collision_result", rolls=rolls, success=success, until=time.time() + 2)
        elif pending["type"] == "scan_effect":
            pending.update(type="scan_result", until=time.time() + 3)
            rules.log(game, pending["owner"], pending["text"], "event")
        else:
            if pending["type"] == "collision_result":
                if pending["success"]:
                    damage(game, pending["participants"], 2)
                rules.log(game, pending["owner"], "碰撞成功" if pending["success"] else "碰撞失败", "event")
                pickup(game, pending["column"], pending["ring"], pending["owner"])
                release_cell(game, pending["column"], pending["ring"])
            game["pending"] = None
    if game["phase"] != "battle":
        return
    if time.time() < game["battle_starts_at"]:
        game["due_at"] = game["battle_starts_at"]
        return
    # Resolve arrivals before moving further. A blocked ship does not freeze its fleet.
    pump(game)
    movement = game["movement"]
    if movement and movement["step_at"] <= time.time() + .001:
        for lane in movement["lanes"]:
            ship = game["crews"][lane["owner"]]["ships"][lane["number"] - 1]
            if ship["destroyed"] or not lane["remaining"] or lane.get("waiting"):
                continue
            old = ship["column"]
            ship["column"] = (old - 1 + ship["direction"]) % 24 + 1
            lane["remaining"] -= 1
            lane["waiting"] = True
            effect(game, "move", lane["owner"], ship, from_column=old, from_ring=ship["ring"])
            rules.log(game, lane["owner"], "%s号：%s移动 %s%s → %s%s" % (
                ship["number"], "被动" if movement["passive"] else "主动",
                old, ship["ring"], ship["column"], ship["ring"]), "passive" if movement["passive"] else "action")
            contact = {"owner": lane["owner"], "column": ship["column"], "ring": ship["ring"], "ready_at": time.time() + STEP_SECONDS}
            if contact not in game["contacts"]:
                game["contacts"].append(contact)
        movement["step_at"] = time.time() + STEP_SECONDS
    schedule(game)

def collision_choice(game, owner, message):
    pending = game["pending"]
    rules.require(pending is not None and pending["type"] == "collision_choice"
                  and pending["owner"] == owner and message.get("event_id") == pending["id"],
                  "当前没有等待你处理的碰撞选择。")
    collide = message.get("collide")
    rules.require(type(collide) is bool, "请选择是否碰撞。")
    if not collide:
        pickup(game, pending["column"], pending["ring"], owner)
        game["pending"] = None
        release_cell(game, pending["column"], pending["ring"])
        rules.log(game, owner, "选择不碰撞。", "event")
        pump(game)
        return
    pending.update(type="collision_roll", started_at=time.time())
    game["due_at"] = time.time() + 4
    pending["until"] = game["due_at"]
    schedule(game)


def move(game, owner, ship, steps):
    game["movement"] = {"passive": False, "step_at": time.time() + STEP_SECONDS, "lanes": [
        {"owner": owner, "number": ship["number"], "remaining": steps, "waiting": False}]}
    game["due_at"] = time.time() + STEP_SECONDS
    game["busy_until"] = game["due_at"]


def tactic(game, owner, ship, message):
    rules.require(not game["tactic_used"], "本回合已经使用过战术行动。")
    kind = message["type"]
    item = "missile" if kind == "attack" else "probe"
    native = ship["role"] in (("attack", "mothership") if kind == "attack" else ("scout", "mothership"))
    rules.require(ship[item] or (native and (ship["ammo"] > 0 if kind == "attack" else game["crews"][owner]["energy"] >= 2)),
                  "该舰船当前无法进行此战术行动。")
    target_owner = message.get("target_owner")
    rules.require(isinstance(target_owner, str) and target_owner in game["crews"] and target_owner != owner, "请选择敌方舰船。")
    target = rules.ship_for(game["crews"][target_owner], message.get("target_ship"))
    distance = abs(target["column"] - ship["column"])
    rules.require(min(distance, 24 - distance) <= 2, "目标不在前后两列的作用范围内。")
    question = message.get("question")
    if kind == "scan":
        rules.require(question in ("attack", "scout"), "请选择探测攻击能力或探测能力。")
    if ship[item]:
        ship[item] = False
    elif kind == "attack":
        ship["ammo"] -= 1
    else:
        game["crews"][owner]["energy"] -= 2
    game["tactic_used"] = True
    if kind == "attack":
        rules.log(game, owner, "%s号：攻击%s%s号" % (ship["number"], rules.FLEETS[game["crews"][target_owner]["fleet"]]["name"], target["number"]))
        damage(game, [(target_owner, target["number"])], 1)
        if game["phase"] == "battle":
            game["due_at"] = game["busy_until"] = time.time() + 1.3
    else:
        ability = target["role"] in (("attack", "mothership") if question == "attack" else ("scout", "mothership"))
        result = "%s%s号舰船%s%s" % (
            rules.FLEETS[game["crews"][target_owner]["fleet"]]["name"], target["number"],
            "可" if ability else "不可", "攻击" if question == "attack" else "探测")
        game["pending"] = {"id": secrets.token_hex(8), "type": "scan_effect", "owner": owner, "text": result,
                           "until": time.time() + 1.5}
        effect(game, "scan", target_owner, target)
        rules.log(game, owner, "%s号：发动探测" % ship["number"])
        game["due_at"] = time.time() + 1.5


def public_pending(game):
    pending = copy.deepcopy(game["pending"])
    if pending and pending["type"] == "scan_effect":
        pending.pop("text", None)
    return pending
