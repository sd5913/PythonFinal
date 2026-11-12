"""Single-process room server. Game rules deliberately live outside this prototype."""
import asyncio
import secrets
import string
import time
import anyio
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, Optional

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from . import game

STATIC = Path(__file__).parent / "static"
app = FastAPI(title="PythonFinal LAN Lobby")
app.mount("/static", StaticFiles(directory=STATIC), name="static")
app.mount("/visual-effects", StaticFiles(directory=STATIC.parent.parent / "visual-effects"), name="visual-effects")


class NameInput(BaseModel):
    name: str = Field(min_length=1, max_length=20)


class LeaveInput(BaseModel):
    player_id: str
    token: str


@dataclass
class Player:
    id: str
    token: str
    name: str
    ready: bool = False
    socket: Optional[WebSocket] = None


@dataclass
class Room:
    code: str
    players: Dict[str, Player] = field(default_factory=dict)
    revision: int = 0
    touched: float = field(default_factory=time.monotonic)
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    game: Optional[dict] = None
    progress_task: Optional[asyncio.Task] = None

    def snapshot(self, viewer=None):
        # Never serialize Player directly: the reconnect token is private.
        return {
            "type": "room_state", "room_code": self.code,
            "revision": self.revision, "capacity": 4,
            "game": game.public_state(self, viewer),
            "players": [
                {"id": p.id, "name": p.name, "ready": p.ready,
                 "connected": p.socket is not None, "host": i == 0}
                for i, p in enumerate(self.players.values())
            ],
        }


rooms: Dict[str, Room] = {}
PENDING_JOIN_TIMEOUT = 20
pending_joins = set()


async def expire_pending_join(room, player):
    await asyncio.sleep(PENDING_JOIN_TIMEOUT)
    async with room.lock:
        if player.socket is None:
            await remove_player(room, player)


def get_room(code):
    room = rooms.get(code.upper())
    if room is None:
        raise HTTPException(404, "房间不存在或已过期，请检查房间号。")
    return room


def add_player(room, name):
    name = name.strip()
    if not name:
        raise HTTPException(422, "请输入昵称。")
    player = Player(secrets.token_hex(8), secrets.token_urlsafe(32), name)
    room.players[player.id] = player
    room.touched = time.monotonic()
    task = asyncio.create_task(expire_pending_join(room, player))
    pending_joins.add(task)
    task.add_done_callback(pending_joins.discard)
    return {"room_code": room.code, "player_id": player.id, "token": player.token}


def schedule_progress(room):
    if room.game is None or not room.game["due_at"]:
        return
    if room.progress_task is None or room.progress_task.done():
        room.progress_task = asyncio.create_task(progress(room, room.game))


async def progress(room, match):
    await asyncio.sleep(max(0, match["due_at"] - time.time()))
    async with room.lock:
        room.progress_task = None
        if room.game is match and rooms.get(room.code) is room:
            game.combat.advance(match)
            await broadcast(room)


async def broadcast(room, event=None):
    # Caller holds room.lock; one slow/disconnected peer must not block the lobby.
    while room.players:
        room.revision += 1
        room.touched = time.monotonic()
        async def send(player):
            if player.socket is None:
                return None  # The HTTP join is still waiting for its first socket.
            try:
                payload = room.snapshot(player.id)
                if event:
                    payload["event"] = event
                await asyncio.wait_for(player.socket.send_json(payload), timeout=2)
                return None
            except Exception:
                return player

        failed = await asyncio.gather(*(send(p) for p in room.players.values()))
        removed = [p for p in failed if p is not None]
        if not removed:
            schedule_progress(room)
            return
        for player in removed:
            room.players.pop(player.id, None)
            player.socket = None
        game.reset_game(room)
        event = "、".join(p.name for p in removed) + " 已退出房间"
    rooms.pop(room.code, None)


async def remove_player(room, player):
    # Idempotent across pagehide beacon, socket close and explicit leave.
    if room.players.get(player.id) is not player:
        return
    del room.players[player.id]
    player.socket = None
    game.reset_game(room)
    if not room.players:
        rooms.pop(room.code, None)
    else:
        await broadcast(room, player.name + " 已退出房间")


@app.get("/")
async def index():
    return FileResponse(STATIC / "index.html", headers={"Cache-Control": "no-cache"})


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/api/rooms", status_code=201)
async def create_room(body: NameInput):
    # Reclaim only disconnected rooms after six hours. No background task needed.
    for code, room in list(rooms.items()):
        if time.monotonic() - room.touched > 21600 and not any(
            p.socket is not None for p in room.players.values()
        ):
            del rooms[code]
    if len(rooms) >= 128:
        raise HTTPException(503, "房间数量已达上限，请稍后再试。")
    while True:
        code = "".join(secrets.choice(string.ascii_uppercase + string.digits) for _ in range(6))
        if code not in rooms:
            break
    room = Room(code)
    result = add_player(room, body.name)
    rooms[code] = room
    return result


@app.post("/api/rooms/{code}/join", status_code=201)
async def join_room(code: str, body: NameInput):
    room = get_room(code)
    async with room.lock:
        if rooms.get(room.code) is not room:
            raise HTTPException(404, "房间已关闭，请重新创建或加入。")
        if room.game is not None:
            raise HTTPException(409, "游戏已经开始，请等待房间返回备战大厅。")
        if len(room.players) >= 4:
            raise HTTPException(409, "房间已满，最多四人。")
        result = add_player(room, body.name)
        await broadcast(room)
        return result


@app.post("/api/rooms/{code}/leave", status_code=204)
async def leave_room(code: str, body: LeaveInput):
    room = rooms.get(code.upper())
    if room is not None:
        async with room.lock:
            player = room.players.get(body.player_id)
            if player is not None:
                if not secrets.compare_digest(player.token, body.token):
                    raise HTTPException(403, "身份校验失败。")
                connection = player.socket
                await remove_player(room, player)
                if connection is not None:
                    try:
                        await asyncio.wait_for(connection.close(code=1000), timeout=2)
                    except (RuntimeError, asyncio.TimeoutError):
                        pass
    return Response(status_code=204)


@app.websocket("/ws/{code}")
async def connect(websocket: WebSocket, code: str):
    # Browser connections must come from this server's own origin.
    origin = websocket.headers.get("origin")
    if origin and origin not in (
        "http://" + websocket.headers.get("host", ""),
        "https://" + websocket.headers.get("host", ""),
    ):
        await websocket.close(code=1008)
        return
    await websocket.accept()
    room = rooms.get(code.upper())
    player = None
    try:
        auth = await asyncio.wait_for(websocket.receive_json(), timeout=10)
        if room is None or not isinstance(auth, dict):
            await websocket.close(code=4401, reason="房间或身份已失效")
            return
        player_id = auth.get("player_id")
        candidate = room.players.get(player_id) if isinstance(player_id, str) else None
        if candidate is None or not secrets.compare_digest(candidate.token, str(auth.get("token", ""))):
            await websocket.close(code=4401, reason="房间或身份已失效")
            return
        async with room.lock:
            # A leave request may have removed the seat while this connection waited.
            if room.players.get(candidate.id) is not candidate:
                await websocket.close(code=4401)
                return
            player = candidate
            old_socket = player.socket
            player.socket = websocket
            if old_socket is not None:
                await old_socket.close(code=4001, reason="此座位已在另一个连接打开")
            await broadcast(room, player.name + " 已连接")
        while True:
            message = await asyncio.wait_for(websocket.receive_json(), timeout=45)
            async with room.lock:
                if player.socket is not websocket:
                    break
                if not isinstance(message, dict):
                    await websocket.send_json({"type": "error", "message": "消息格式错误。"})
                    continue
                action = message.get("type")
                if action == "ping":
                    await websocket.send_json({"type": "pong"})
                elif action == "set_ready" and isinstance(message.get("ready"), bool):
                    if room.game is not None:
                        await websocket.send_json({"type": "error", "message": "对局中不能修改准备状态。"})
                        continue
                    player.ready = message["ready"]
                    await broadcast(room)
                elif action == "test_signal":
                    await broadcast(room, player.name + " 发送了联机测试信号 ✓")
                elif isinstance(action, str) and action in game.GAME_ACTIONS:
                    try:
                        event = game.apply(room, player.id, message)
                    except game.RuleError as error:
                        await websocket.send_json({"type": "error", "message": str(error)})
                    else:
                        await broadcast(room, event)
                elif action == "leave":
                    await remove_player(room, player)
                    await websocket.close(code=1000, reason="已离开房间")
                    break
                else:
                    await websocket.send_json({"type": "error", "message": "不支持的操作。"})
    except (WebSocketDisconnect, asyncio.TimeoutError, ValueError, RuntimeError):
        pass
    finally:
        # Complete removal even when the ASGI connection task is cancelled.
        with anyio.CancelScope(shield=True):
            if room is not None and player is not None:
                async with room.lock:
                    # Closing an older socket must not disconnect its replacement.
                    if player.socket is websocket:
                        await remove_player(room, player)
            try:
                await asyncio.wait_for(websocket.close(), timeout=2)
            except (RuntimeError, asyncio.TimeoutError):
                pass


# Run with one Uvicorn worker; room state is process-local and intentionally temporary.
