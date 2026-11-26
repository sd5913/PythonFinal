"""OAuth and opaque session primitives shared by the Worker and its tests."""
import base64
import hashlib
import re
import secrets
from urllib.parse import urlsplit

CALLBACK = "/api/auth/github/callback"
OAUTH_COOKIE = "pf_oauth"
SESSION_COOKIE = "pf_session"
OAUTH_SECONDS = 600
SESSION_SECONDS = 12 * 60 * 60
TOKEN_RE = re.compile(r"[A-Za-z0-9_-]{43}", re.ASCII)
LOGIN_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9-]{0,38}", re.ASCII)


def app_origin(value):
    url = urlsplit(value)
    local_http = url.scheme == "http" and url.hostname in {"localhost", "127.0.0.1", "::1"}
    origin = f"{url.scheme}://{url.netloc}"
    if (not url.hostname or url.username is not None or url.password is not None
            or (url.scheme != "https" and not local_http)
            or value not in (origin, origin + "/")):
        raise ValueError("APP_URL must be an HTTPS origin or loopback HTTP origin.")
    return origin


def token():
    return secrets.token_urlsafe(32)


def valid_token(value):
    return isinstance(value, str) and TOKEN_RE.fullmatch(value) is not None


def digest(value):
    return hashlib.sha256(value.encode("ascii")).hexdigest()


def pkce_challenge(verifier):
    raw = hashlib.sha256(verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def cookie(name, value, age, origin):
    secure = "; Secure" if origin.startswith("https:") else ""
    return f"{name}={value}; Path=/; HttpOnly; SameSite=Lax; Max-Age={age}{secure}"


def read_cookie(header, name):
    matches = [part.strip().partition("=")[2] for part in (header or "").split(";")
               if part.strip().partition("=")[0] == name]
    return matches[0] if len(matches) == 1 and valid_token(matches[0]) else None
