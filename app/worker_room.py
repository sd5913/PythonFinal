"""One authoritative Durable Object per online room."""
import asyncio
import json
import secrets
import time
from urllib.parse import urlsplit

from js import WebSocketPair
from pyodide.ffi import to_js
from workers import DurableObject, Response

from . import game
from .online_room import OnlineRoom
from .worker_http import error, read_json, reply, session_user


class RoomObject(DurableObject):
    def __init__(self, state, env):
        super().__init__(state, env)
        self.state = state
        self.db = env.DB
        # Serialize game mutations across awaited D1 and object storage operations.
        self.lock = asyncio.Lock()

    def connections(self):
        return [(ws, json.loads(ws.deserializeAttachment()))
                for ws in self.state.getWebSockets() if ws.readyState == 1]

    async def alive_room(self, now):
        saved = await self.state.storage.get("room")
        if not saved:
            return None
        room = OnlineRoom.load(saved)
        if room.expire(now):
            await self.publish(room)
        return room if room.host else None

    async def persist(self, room):
        await self.state.storage.setAlarm(room.deadline() * 1000)
        await self.state.storage.put("room", room.dump())

    def send(self, ws, payload):
        try:
            ws.send(json.dumps(payload, ensure_ascii=False))
        except Exception:
            self.close(ws, 1011)

    def close(self, ws, code):
        try:
            ws.close(code)
        except Exception:
            pass

    async def authorized_connections(self, room):
        authorized = []
        for ws, data in self.connections():
            seat = room.players.get(data["seat"])
            if not seat or seat.connection != data["connection"]:
                self.close(ws, 4001 if seat else 4404)
                continue
            identity = await session_user(self.db, data["session"])
            if not identity or identity.github_id != seat.account:
                self.close(ws, 4401)
                continue
            authorized.append((ws, seat))
        return authorized

    async def publish(self, room, event=None):
        if not room.host:
            await self.state.storage.deleteAll()
            await self.state.storage.deleteAlarm()
            for ws, _ in self.connections():
                self.close(ws, 4404)
            await self.db.prepare("DELETE FROM online_rooms WHERE code=?").bind(room.code).run()
            return

        room.revision += 1
        await self.persist(room)
        authorized = await self.authorized_connections(room)
        active = {seat.connection for _, seat in authorized}
        for ws, seat in authorized:
            self.send(ws, room.snapshot(seat.id, active, event))

    def seat_info(self, room, seat):
        return {"room_code": room.code, "player_id": seat.id}

    async def fetch(self, request):
        operation = urlsplit(request.url).path
        account = request.headers.get("X-Account")
        async with self.lock:
            now = int(time.time())
            room = await self.alive_room(now)
            if operation == "/initialize":
                data = await read_json(request)
                if room is None:
                    room = OnlineRoom(data["code"], data["invite"], data["expires_at"])
                    seat = room.join(account, data["name"], now)
                    await self.persist(room)
                elif room.host.account != account or room.invite != data["invite"] or room.expires_at != data["expires_at"]:
                    return error("房间已存在。", 409)
                return reply(self.seat_info(room, room.host), 201)
            if room is None:
                return error("房间不存在或已过期。", 404)

            seat = room.member(account)
            if operation == "/join":
                if not seat:
                    data = await read_json(request)
                    try:
                        seat = room.join(account, data["name"], now)
                    except game.RuleError as exc:
                        return error(str(exc), 409)
                    await self.publish(room)
                return reply(self.seat_info(room, seat), 201)
            if not seat:
                return error("你尚未加入房间。", 403)
            if operation == "/member":
                return reply(self.seat_info(room, seat))
            if operation == "/invite":
                if seat is not room.host:
                    return error("只有房主可以分享邀请。", 403)
                return reply({"invite": room.invite, "expires_at": room.expires_at})
            if operation == "/leave":
                room.leave(seat)
                await self.publish(room, seat.name + " 已退出房间")
                return reply(status=204)
            if operation != "/ws" or request.headers.get("Upgrade") != "websocket":
                return error("需要 WebSocket 连接。", 426)

            client, server = WebSocketPair.new().object_values()
            connection = secrets.token_hex(16)
            room.connect(seat, connection, now)
            # Record attachment before publishing. Only this generation can act as the seat.
            self.state.acceptWebSocket(server, to_js([seat.id]))
            server.serializeAttachment(json.dumps({
                "seat": seat.id, "connection": connection, "session": request.headers.get("X-Session"),
            }))
            try:
                await self.publish(room, seat.name + " 已连接")
            except Exception:
                self.close(server, 1011)
                raise
            return Response(None, status=101, web_socket=client)

    async def webSocketMessage(self, ws, message):
        async with self.lock:
            now = int(time.time())
            room = await self.alive_room(now)
            if room is None:
                self.close(ws, 4404)
                return
            data = json.loads(ws.deserializeAttachment())
            seat = room.players.get(data["seat"])
            if not seat or seat.connection != data["connection"]:
                self.close(ws, 4001 if seat else 4404)
                return
            identity = await session_user(self.db, data["session"])
            if not identity or identity.github_id != seat.account:
                self.close(ws, 4401)
                return
            try:
                if not isinstance(message, str) or len(message) > 4096 or len(message.encode("utf-8")) > 4096:
                    raise ValueError
                command = json.loads(message)
                if not isinstance(command, dict):
                    raise ValueError
            except ValueError:
                self.send(ws, {"type": "error", "message": "消息格式错误。"})
                return
            if command.get("type") == "ping":
                room.renew(seat, now)
                await self.persist(room)
                self.send(ws, {"type": "pong"})
                return
            if command.get("type") == "start_game":
                peers = await self.authorized_connections(room)
                room.set_connections({peer.connection for _, peer in peers})
            try:
                event = room.action(seat, command)
            except game.RuleError as exc:
                self.send(ws, {"type": "error", "message": str(exc)})
                return
            room.renew(seat, now)
            await self.publish(room, event)

    async def webSocketClose(self, ws, code, reason, was_clean):
        if 1000 <= code < 5000 and code not in (1004, 1005, 1006, 1015):
            self.close(ws, code)
        await self.disconnected(ws)

    async def webSocketError(self, ws, error):
        self.close(ws, 1011)
        await self.disconnected(ws)

    async def disconnected(self, ws):
        async with self.lock:
            now = int(time.time())
            room = await self.alive_room(now)
            if room:
                data = json.loads(ws.deserializeAttachment())
                seat = room.players.get(data["seat"])
                if seat and room.disconnect(seat, data["connection"], now):
                    await self.publish(room)

    async def alarm(self):
        async with self.lock:
            room = await self.alive_room(int(time.time()))
            if room:
                await self.state.storage.setAlarm(room.deadline() * 1000)
