"""Cloudflare entry point. The FastAPI LAN server remains independently runnable."""
import json
import re
import secrets
import time
from urllib.parse import urlsplit

from workers import WorkerEntrypoint

from app.online_auth import CALLBACK, app_origin, digest, token, valid_token
from app.online_room import ROOM_SECONDS
from app.worker_http import (error, finish_login, logout, raw_request, read_json, reply,
                             session_hash, session_user, start_login)
from app.worker_room import RoomObject

ROOM_PATH = re.compile(r"/api/rooms/([A-F0-9]{24})(?:/(leave|invite))?")
SOCKET_PATH = re.compile(r"/ws/([A-F0-9]{24})")


class Default(WorkerEntrypoint):
    async def fetch(self, request):
        url = urlsplit(request.url)
        path = url.path
        if path in ("/", "/index.html") or path.startswith(("/static/", "/visual-effects/")):
            return await self.assets(request, path)
        if path == "/health":
            return reply({"status": "ok"})

        try:
            origin = app_origin(self.env.APP_URL)
            if f"{url.scheme}://{url.netloc}" != origin:
                return error("请从应用的正式地址打开。", 403)
            if request.method == "POST" or path.startswith("/ws/"):
                if request.headers.get("Origin") != origin:
                    return error("跨站请求被拒绝。", 403)
            return await self.route(request, path, origin)
        except Exception:
            # Fail closed with a generic message. Errors can contain OAuth or invite data.
            return error("服务暂时无法处理请求，请稍后再试。", 503)

    async def assets(self, request, path):
        if request.method not in ("GET", "HEAD"):
            return error("不支持此请求方法。", 405)
        if ".." in path or path == "/static/index.html":
            return error("页面不存在。", 404)
        # Prepared assets preserve the LAN URL layout, including visual-effects.
        return await self.env.ASSETS.fetch(request)

    async def route(self, request, path, origin):
        method = request.method
        if method == "GET" and path == "/api/auth/github":
            return await start_login(self.env, origin)
        if method == "GET" and path == CALLBACK:
            return await finish_login(request, self.env, origin)
        if method == "POST" and path == "/api/auth/logout":
            return await logout(request, self.env, origin)

        hashed = session_hash(request)
        identity = await session_user(self.env.DB, hashed)
        if method == "GET" and path == "/api/online":
            return reply({"mode": "online", "user": {"login": identity.login} if identity else None})
        if identity is None:
            return error("请先使用 GitHub 登录。", 401)

        if method == "POST" and path == "/api/rooms":
            return await self.create(identity)
        if method == "POST" and path == "/api/invitations/join":
            return await self.join(request, identity)
        room = ROOM_PATH.fullmatch(path)
        if room:
            if method == "GET" and room[2] is None:
                return await self.forward(room[1], "member", identity.github_id)
            if method == "POST" and room[2] is not None:
                return await self.forward(room[1], room[2], identity.github_id)
        socket = SOCKET_PATH.fullmatch(path)
        if socket and method == "GET":
            if (request.headers.get("Upgrade") or "").lower() != "websocket":
                return error("需要 WebSocket 连接。", 426)
            return await self.forward(socket[1], "ws", identity.github_id, session=hashed)
        return error("页面不存在。", 404)

    async def create(self, identity):
        code = secrets.token_hex(12).upper()
        invite = token()
        expires_at = int(time.time()) + ROOM_SECONDS
        response = await self.forward(code, "initialize", identity.github_id, data={
            "code": code, "invite": invite, "name": identity.login, "expires_at": expires_at,
        })
        if response.ok:
            # Make the invite discoverable only after durable initialization succeeds.
            await self.env.DB.prepare(
                "INSERT INTO online_rooms (code,creator_id,invite_hash,expires_at) VALUES (?,?,?,?)"
            ).bind(code, identity.github_id, digest(invite), expires_at).run()
        return response

    async def join(self, request, identity):
        media_type = (request.headers.get("Content-Type") or "").split(";", 1)[0].strip().lower()
        if media_type != "application/json":
            return error("需要 JSON 邀请。", 415)
        try:
            data = await read_json(request)
        except ValueError:
            return error("邀请格式无效。", 400)
        invite = data.get("invite") if isinstance(data, dict) else None
        if not valid_token(invite):
            return error("邀请格式无效。", 400)
        code = await self.env.DB.prepare(
            "SELECT code FROM online_rooms WHERE invite_hash=? AND expires_at>?"
        ).bind(digest(invite), int(time.time())).first("code")
        if not code:
            return error("邀请无效或已过期。", 404)
        return await self.forward(code, "join", identity.github_id, data={"name": identity.login})

    async def forward(self, code, operation, account, *, data=None, session=None):
        if operation != "initialize" and operation != "join":
            found = await self.env.DB.prepare(
                "SELECT 1 AS active FROM online_rooms WHERE code=? AND expires_at>?"
            ).bind(code, int(time.time())).first("active")
            if not found:
                return error("房间不存在或已过期。", 404)
        headers = {"X-Account": account}
        if session:
            headers.update({"Upgrade": "websocket", "X-Session": session})
        options = {"headers": headers}
        if data is not None:
            options.update({"method": "POST", "body": json.dumps(data)})
        stub = self.env.ROOMS.get(self.env.ROOMS.idFromName(code))
        return await stub.fetch(raw_request("https://room.internal/" + operation, **options))

    async def scheduled(self, event):
        now = int(time.time())
        for table in ("oauth_attempts", "sessions", "online_rooms"):
            await self.env.DB.prepare("DELETE FROM " + table + " WHERE expires_at<=?").bind(now).run()
