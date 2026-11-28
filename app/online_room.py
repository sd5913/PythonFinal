"""Serializable online seats and lobby state. Game commands use the LAN rules."""
import json
import secrets
from dataclasses import dataclass

from . import game, combat

ROOM_SECONDS = 6 * 60 * 60
PENDING_SECONDS = 30
RECONNECT_SECONDS = 120
LOG_LIMIT = 200
CAPACITY = 4


@dataclass
class Seat:
    id: str
    account: str
    name: str
    deadline: int
    ready: bool = False
    connection: str = None
    online: bool = False

    @property
    def socket(self):
        # game.apply checks the same socket presence contract as the LAN room.
        return self.connection if self.online else None


class OnlineRoom:
    def __init__(self, code, invite, expires_at):
        self.code = code
        self.invite = invite
        self.expires_at = expires_at
        self.revision = 0
        self.players = {}
        self.game = None
        self.progress_task = None

    @property
    def host(self):
        return next(iter(self.players.values()), None)

    def member(self, account):
        return next((seat for seat in self.players.values() if seat.account == account), None)

    def join(self, account, name, now):
        existing = self.member(account)
        if existing:
            return existing
        game.require(self.game is None, "对局已开始。")
        game.require(len(self.players) < CAPACITY, "房间已满，最多四人。")
        seat = Seat(secrets.token_hex(8), account, name, now + PENDING_SECONDS)
        self.players[seat.id] = seat
        return seat

    def connect(self, seat, connection, now):
        seat.connection = connection
        seat.online = True
        self.renew(seat, now)

    def renew(self, seat, now):
        seat.deadline = now + RECONNECT_SECONDS

    def disconnect(self, seat, connection, now):
        if seat.connection != connection:
            return False
        seat.connection = None
        seat.online = False
        self.renew(seat, now)
        return True

    def leave(self, seat):
        del self.players[seat.id]
        game.reset_game(self)

    def deadline(self):
        deadlines = [self.expires_at] + [seat.deadline for seat in self.players.values()]
        if self.game and self.game.get("due_at"):
            deadlines.append(self.game["due_at"])
        return min(deadlines)

    def advance(self):
        if not self.game or not self.game.get("due_at"):
            return False
        import time
        if self.game["due_at"] > time.time():
            return False
        combat.advance(self.game)
        self.trim_logs()
        return True

    def trim_logs(self):
        if self.game and len(self.game["logs"]) > LOG_LIMIT:
            del self.game["logs"][:-LOG_LIMIT]

    def expire(self, now):
        expired = [seat for seat in self.players.values()
                   if now >= min(self.expires_at, seat.deadline)]
        for seat in expired:
            self.leave(seat)
        return expired

    def set_connections(self, connections):
        for seat in self.players.values():
            seat.online = seat.connection in connections

    def action(self, seat, message):
        action = message.get("type")
        if action == "set_ready" and isinstance(message.get("ready"), bool):
            game.require(self.game is None, "对局中不能修改准备状态。")
            seat.ready = message["ready"]
        elif action == "test_signal":
            return seat.name + " 发送了联机测试信号 ✓"
        elif isinstance(action, str) and action in game.GAME_ACTIONS:
            event = game.apply(self, seat.id, message)
            self.trim_logs()
            return event
        else:
            raise game.RuleError("不支持的操作。")

    def snapshot(self, viewer, connections, event=None):
        state = {
            "type": "room_state", "room_code": self.code,
            "revision": self.revision, "capacity": CAPACITY,
            "game": game.public_state(self, viewer),
            "players": [
                {"id": seat.id, "name": seat.name, "ready": seat.ready,
                 "connected": seat.connection in connections, "host": seat is self.host}
                for seat in self.players.values()
            ],
        }
        if event:
            state["event"] = event
        return state

    def dump(self):
        return json.dumps({
            "version": 1, "code": self.code, "invite": self.invite,
            "expires_at": self.expires_at, "revision": self.revision, "game": self.game,
            "players": [{"id": seat.id, "account": seat.account, "name": seat.name,
                         "deadline": seat.deadline, "ready": seat.ready,
                         "connection": seat.connection} for seat in self.players.values()],
        }, ensure_ascii=False)

    @classmethod
    def load(cls, saved):
        data = json.loads(saved)
        if data["version"] != 1:
            raise ValueError("Unsupported room storage version.")
        room = cls(data["code"], data["invite"], data["expires_at"])
        room.revision = data["revision"]
        room.game = data["game"]
        for value in data["players"]:
            seat = Seat(**value)
            room.players[seat.id] = seat
        return room
