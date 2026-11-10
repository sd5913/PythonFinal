"""Authoritative first playable: fleet selection, secret roles and movement turns."""
import time

FLEETS = {
    "blue": {"name": "蓝色空间舰队", "color": "#64b5ff"},
    "gray": {"name": "自然选择舰队", "color": "#c4ced8"},
    "red": {"name": "企业舰队", "color": "#ff797f"},
    "yellow": {"name": "终极规律舰队", "color": "#f4cf75"},
}
ROLES = {"attack": "攻击舰", "scout": "探测舰", "mothership": "母舰"}
GAME_ACTIONS = {"start_game", "choose_fleet", "begin_deployment", "set_roles",
                "place_ship", "set_gear", "shift", "turn_ship", "end_turn", "exit_game"}


class RuleError(Exception):
    pass


def require(condition, message):
    if not condition:
        raise RuleError(message)


def integer(value, lower, upper):
    return type(value) is int and lower <= value <= upper


def reset_game(room):
    room.game = None
    for player in room.players.values():
        player.ready = False


def fleet_valid(game):
    values = [crew["fleet"] for crew in game["crews"].values()]
    return all(values) and len(set(values)) == len(values)


def ship_for(crew, number):
    require(integer(number, 1, 5), "请选择己方舰船。")
    require(len(crew["ships"]) == 5, "请先完成舰种部署。")
    return crew["ships"][number - 1]


def log(game, player_id, text, kind="action"):
    if kind in ("action", "passive"):
        text = FLEETS[game["crews"][player_id]["fleet"]]["name"] + text
    game["logs"].append({"id": len(game["logs"]) + 1, "round": game["round"],
                         "player_id": player_id, "text": text, "kind": kind})


def begin_turn(game):
    game["move_ship"] = None
    game["gear_used"] = False
    game["shift_used"] = False
    actor = game["order"][game["turn_index"]]
    name = game["crews"][actor]["name"]
    log(game, actor, (name if name.endswith("舰长") else name + "舰长") + "的回合", "turn")
    moved = False
    for ship in game["crews"][actor]["ships"]:
        if ship["gear"]:
            old = ship["column"]
            ship["column"] = (old - 1 + ship["direction"] * ship["gear"]) % 24 + 1
            log(game, actor, "%s号：被动移动 %s%s → %s%s" % (
                ship["number"], old, ship["ring"], ship["column"], ship["ring"]), "passive")
            moved = True
    game["busy_until"] = time.time() + (0.8 if moved else 0)


def public_state(room, viewer):
    game = room.game
    if game is None:
        return None
    crews = []
    for player_id in game["order"]:
        crew = game["crews"][player_id]
        ships = []
        for ship in crew["ships"]:
            data = {key: ship[key] for key in ("number", "ring", "column", "direction", "gear")}
            data["owner"] = player_id
            if player_id == viewer:
                data["role"] = ship["role"]
            ships.append(data)
        crews.append({"id": player_id, "name": crew["name"], "fleet": crew["fleet"],
                      "roles_ready": crew["roles_ready"], "energy": crew["energy"], "ships": ships})
    return {"phase": game["phase"], "crews": crews, "fleets": FLEETS,
            "fleet_valid": fleet_valid(game), "current_player": game["order"][game["turn_index"]],
            "round": game["round"], "move_ship": game["move_ship"],
            "gear_used": game["gear_used"], "shift_used": game["shift_used"],
            "busy_until": game["busy_until"], "battle_starts_at": game["battle_starts_at"],
            "logs": game["logs"]}


def apply(room, player_id, message):
    action = message["type"]
    host = next(iter(room.players))
    if action == "start_game":
        require(room.game is None, "对局已经开始。")
        require(player_id == host, "只有房主可以开始游戏。")
        require(2 <= len(room.players) <= 4, "至少需要两名玩家。")
        require(all(p.ready and p.socket is not None for p in room.players.values()), "请等待所有玩家连接并准备。")
        room.game = {"phase": "fleet", "order": list(room.players), "turn_index": 0,
                     "round": 0, "move_ship": None, "gear_used": False, "shift_used": False,
                     "busy_until": 0, "battle_starts_at": 0, "logs": [],
                     "crews": {p.id: {"name": p.name, "fleet": None, "roles_ready": False,
                                      "energy": 0, "ships": []} for p in room.players.values()}}
        return "舰队选择已开始"
    game = room.game
    require(game is not None and player_id in game["crews"], "当前没有进行中的对局。")
    crew = game["crews"][player_id]
    if action == "exit_game":
        reset_game(room)
        return "一名舰长退出对局，所有玩家返回备战大厅"
    if action == "choose_fleet":
        require(game["phase"] == "fleet", "当前不能更换舰队。")
        fleet = message.get("fleet")
        require(isinstance(fleet, str) and fleet in FLEETS, "请选择有效舰队。")
        crew["fleet"] = fleet
        return None
    if action == "begin_deployment":
        require(player_id == host, "只有房主可以进入对局。")
        require(game["phase"] == "fleet", "当前不在舰队选择阶段。")
        require(fleet_valid(game), "舰队只能有一名指挥官，请确保每人都已选择不同舰队。")
        game["phase"] = "roles"
        return "请秘密部署舰船种类"
    if action == "set_roles":
        require(game["phase"] == "roles" and not crew["roles_ready"], "当前不能修改舰船种类。")
        roles = message.get("roles")
        require(isinstance(roles, list) and len(roles) == 5 and
                roles.count("attack") == 2 and roles.count("scout") == 2 and roles.count("mothership") == 1,
                "请选择攻击舰*2；探测舰*2；母舰*1")
        crew["ships"] = [{"number": i + 1, "role": role, "gear": 0, "ring": None,
                           "column": None, "direction": 1} for i, role in enumerate(roles)]
        crew["roles_ready"] = True
        if all(c["roles_ready"] for c in game["crews"].values()):
            game["phase"] = "placement"
        return None
    if action == "place_ship":
        require(game["phase"] == "placement", "当前不在棋盘部署阶段。")
        require(player_id == game["order"][game["turn_index"]], "请等待其他舰长部署。")
        ship = ship_for(crew, message.get("ship"))
        require(ship["ring"] is None, "该舰船已经部署。")
        ring, column, direction = message.get("ring"), message.get("column"), message.get("direction")
        require(ring in ("A", "B", "C") and integer(column, 1, 24) and type(direction) is int and direction in (-1, 1), "无效的部署位置或朝向。")
        require(not any(s["ring"] == ring and s["column"] == column
                        for fleet in game["crews"].values() for s in fleet["ships"]),
                "该格已有舰船，请选择空格。")
        ship.update(ring=ring, column=column, direction=direction)
        if all(s["ring"] is not None for c in game["crews"].values() for s in c["ships"]):
            game["phase"] = "battle"
            game["round"] = 1
            game["turn_index"] = 0
            game["battle_starts_at"] = time.time() + 2
            for c in game["crews"].values():
                c["energy"] = 12
            begin_turn(game)
        else:
            for offset in range(1, len(game["order"]) + 1):
                index = (game["turn_index"] + offset) % len(game["order"])
                if any(s["ring"] is None for s in game["crews"][game["order"][index]]["ships"]):
                    game["turn_index"] = index
                    break
        return None
    require(game["phase"] == "battle", "请先完成舰船部署。")
    require(player_id == game["order"][game["turn_index"]], "现在不是你的回合。")
    require(time.time() >= max(game["battle_starts_at"], game["busy_until"]), "请等待被动移动或开局提示完成。")
    if action == "end_turn":
        game["turn_index"] = (game["turn_index"] + 1) % len(game["order"])
        if game["turn_index"] == 0:
            game["round"] += 1
        begin_turn(game)
        return None
    ship = ship_for(crew, message.get("ship"))
    require(game["move_ship"] in (None, ship["number"]), "本回合移动部署必须作用于同一艘舰船。")
    if action == "set_gear":
        require(not game["gear_used"], "本回合已经调过档位。")
        target = message.get("gear")
        require(integer(target, 0, 3) and target != ship["gear"], "请选择不同的有效档位。")
        before = ship["gear"]
        cost = abs(target - before)
        require(crew["energy"] >= cost, "公共能量不足。")
        crew["energy"] -= cost
        ship["gear"] = target
        if target > before:
            ship["column"] = (ship["column"] - 1 + ship["direction"] * cost) % 24 + 1
        game["gear_used"] = True
        log(game, player_id, "%s号：从 %s 档%s至 %s 档；消耗 %s 能量" % (ship["number"], before, "加速" if target > before else "减速", target, cost))
    elif action == "shift":
        require(not game["shift_used"], "本回合已经横移。")
        target = message.get("ring")
        require(target in ("A", "B", "C") and abs("ABC".index(target) - "ABC".index(ship["ring"])) == 1, "只能横移到相邻圈层。")
        require(crew["energy"] >= 1, "公共能量不足。")
        before = ship["ring"]
        ship["ring"] = target
        crew["energy"] -= 1
        game["shift_used"] = True
        log(game, player_id, "%s号：从轨道 %s 横移至轨道 %s；消耗 1 能量" % (ship["number"], before, target))
    elif action == "turn_ship":
        require(ship["gear"] == 0, "只有 0 档舰船可以转向。")
        ship["direction"] *= -1
        log(game, player_id, "%s号：0 档转向，朝向%s" % (ship["number"], "顺时针" if ship["direction"] == 1 else "逆时针"))
    else:
        raise RuleError("不支持的游戏操作。")
    game["move_ship"] = ship["number"]
    return None
