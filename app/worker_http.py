"""HTTP and OAuth adapter for the Python Workers runtime."""
import json
import time
from urllib.parse import parse_qs, urlencode, urlsplit

from js import AbortSignal, Headers, Object, Request, Response, fetch
from pyodide.ffi import to_js

from .online_auth import (CALLBACK, LOGIN_RE, OAUTH_COOKIE, OAUTH_SECONDS, SESSION_COOKIE,
                          SESSION_SECONDS, cookie, digest, pkce_challenge, read_cookie,
                          token, valid_token)

PRIVATE_HEADERS = {"Cache-Control": "no-store", "Referrer-Policy": "no-referrer",
                   "X-Content-Type-Options": "nosniff"}
AUTH_URL = "https://github.com/login/oauth/authorize"
TOKEN_URL = "https://github.com/login/oauth/access_token"
USER_URL = "https://api.github.com/user"


def js_object(data):
    return to_js(data, dict_converter=Object.fromEntries)


def raw_request(url, **options):
    return Request.new(url, js_object(options))


def reply(data=None, status=200):
    headers = dict(PRIVATE_HEADERS)
    if data is not None:
        headers["Content-Type"] = "application/json; charset=utf-8"
    return Response.new(None if data is None else json.dumps(data, ensure_ascii=False),
                        js_object({"status": status, "headers": headers}))


def error(message, status):
    return reply({"detail": message}, status)


def redirect(location, cookies, status=303):
    headers = Headers.new(js_object({**PRIVATE_HEADERS, "Location": location}))
    for value in cookies:
        headers.append("Set-Cookie", value)
    return Response.new(None, js_object({"status": status, "headers": headers}))


async def read_json(message, limit=8192):
    if message.headers.get("Content-Length") and int(message.headers.get("Content-Length")) > limit:
        raise ValueError("Body too large")
    stream = message.body
    if not stream:
        raise ValueError("Body missing")
    reader = stream.getReader()
    chunks = bytearray()
    try:
        while True:
            result = await reader.read()
            if result.done:
                return json.loads(chunks)
            if len(chunks) + result.value.byteLength > limit:
                await reader.cancel()
                raise ValueError("Body too large")
            chunks.extend(result.value.to_py())
    finally:
        reader.releaseLock()


def session_hash(request):
    value = read_cookie(request.headers.get("Cookie"), SESSION_COOKIE)
    return digest(value) if value else None


async def session_user(db, hashed):
    if not hashed:
        return None
    result = await db.prepare(
        "SELECT u.github_id, u.login FROM sessions AS s JOIN github_users AS u "
        "ON s.github_id=u.github_id WHERE s.token_hash=? AND s.expires_at>?"
    ).bind(hashed, int(time.time())).first()
    return result or None


async def logout(request, env, origin):
    hashed = session_hash(request)
    if hashed:
        await env.DB.prepare("DELETE FROM sessions WHERE token_hash=?").bind(hashed).run()
    return redirect("/", [cookie(SESSION_COOKIE, "", 0, origin),
                          cookie(OAUTH_COOKIE, "", 0, origin)])


async def start_login(env, origin):
    if not getattr(env, "GITHUB_CLIENT_ID", None) or not getattr(env, "GITHUB_CLIENT_SECRET", None):
        return error("GitHub 登录尚未配置。", 503)
    state, browser, verifier = token(), token(), token()
    await env.DB.prepare(
        "INSERT INTO oauth_attempts (state_hash,browser_hash,verifier,expires_at) VALUES (?,?,?,?)"
    ).bind(digest(state), digest(browser), verifier, int(time.time()) + OAUTH_SECONDS).run()
    params = {"client_id": env.GITHUB_CLIENT_ID, "redirect_uri": origin + CALLBACK,
              "state": state, "code_challenge": pkce_challenge(verifier),
              "code_challenge_method": "S256", "scope": ""}
    return redirect(AUTH_URL + "?" + urlencode(params),
                    [cookie(OAUTH_COOKIE, browser, OAUTH_SECONDS, origin)], status=302)


async def provider_json(env, url, **options):
    # The fixture is a service binding added by the local integration harness only.
    fixture = getattr(env, "GITHUB_TEST", None)
    request = raw_request(url, redirect="manual", signal=AbortSignal.timeout(10000), **options)
    response = await fixture.fetch(request) if fixture is not None else await fetch(request)
    if not response.ok:
        raise ValueError("Provider response failed")
    data = await read_json(response, limit=16384)
    if not isinstance(data, dict):
        raise ValueError("Invalid provider response")
    return data


async def finish_login(request, env, origin):
    # The fixed callback strips GitHub query parameters on both success and failure.
    clear = cookie(OAUTH_COOKIE, "", 0, origin)
    failure = redirect("/?login=failed", [clear])
    try:
        query = parse_qs(urlsplit(request.url).query, keep_blank_values=True, max_num_fields=12)
    except ValueError:
        return failure
    states, codes = query.get("state", []), query.get("code", [])
    browser = read_cookie(request.headers.get("Cookie"), OAUTH_COOKIE)
    if not browser or len(states) != 1 or not valid_token(states[0]):
        return failure
    saved = await env.DB.prepare(
        "DELETE FROM oauth_attempts WHERE state_hash=? AND browser_hash=? AND expires_at>? "
        "RETURNING verifier"
    ).bind(digest(states[0]), digest(browser), int(time.time())).first("verifier")
    if not saved or len(codes) != 1 or not 0 < len(codes[0]) <= 512 or "error" in query:
        return failure
    try:
        result = await provider_json(
            env, TOKEN_URL, method="POST",
            headers={"Accept": "application/json", "Content-Type": "application/x-www-form-urlencoded"},
            body=urlencode({"client_id": env.GITHUB_CLIENT_ID, "client_secret": env.GITHUB_CLIENT_SECRET,
                            "code": codes[0], "redirect_uri": origin + CALLBACK, "code_verifier": saved}),
        )
        access = result.get("access_token")
        if ("error" in result or not isinstance(access, str) or not 0 < len(access) <= 2048
                or not access.isascii() or any(char.isspace() for char in access)):
            return failure
        profile = await provider_json(env, USER_URL, headers={
            "Accept": "application/vnd.github+json", "Authorization": f"Bearer {access}",
            "User-Agent": "sd5913-pythonfinal", "X-GitHub-Api-Version": "2022-11-28",
        })
    except Exception:
        # Provider text, callback codes and access tokens never enter app logs or responses.
        return failure
    github_id, login = profile.get("id"), profile.get("login")
    if (type(github_id) is not int or not 0 < github_id < 2**53
            or not isinstance(login, str) or not LOGIN_RE.fullmatch(login)):
        return failure

    raw_session = token()
    statements = [
        env.DB.prepare("INSERT INTO github_users (github_id,login) VALUES (?,?) "
                       "ON CONFLICT(github_id) DO UPDATE SET login=excluded.login").bind(str(github_id), login),
        env.DB.prepare("INSERT INTO sessions (token_hash,github_id,expires_at) VALUES (?,?,?)")
        .bind(digest(raw_session), str(github_id), int(time.time()) + SESSION_SECONDS),
    ]
    old = session_hash(request)
    if old:
        statements.append(env.DB.prepare("DELETE FROM sessions WHERE token_hash=?").bind(old))
    await env.DB.batch(to_js(statements))
    return redirect("/", [clear, cookie(SESSION_COOKIE, raw_session, SESSION_SECONDS, origin)])
