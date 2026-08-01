import base64
import hashlib
import hmac
import os
import secrets
from urllib.parse import quote

from starlette.responses import RedirectResponse
from starlette.types import ASGIApp, Receive, Scope, Send

SITE_PASSWORD = os.environ.get("SITE_PASSWORD")

PBKDF2_ITERATIONS = 600_000


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, PBKDF2_ITERATIONS)
    salt_b64 = base64.b64encode(salt).decode()
    digest_b64 = base64.b64encode(digest).decode()
    return f"pbkdf2_sha256${PBKDF2_ITERATIONS}${salt_b64}${digest_b64}"


def verify_password(password: str, stored_hash: str) -> bool:
    try:
        algorithm, iterations_str, salt_b64, digest_b64 = stored_hash.split("$")
    except ValueError:
        return False
    if algorithm != "pbkdf2_sha256":
        return False
    salt = base64.b64decode(salt_b64)
    expected = base64.b64decode(digest_b64)
    actual = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, int(iterations_str))
    return hmac.compare_digest(actual, expected)


GATE_ALLOWED_PATHS = {"/gate"}
GATE_ALLOWED_STATIC_PATHS = {"/static/common.css"}


class GateMiddleware:
    """Blocks every request/websocket until the shared site password has been entered."""

    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] not in ("http", "websocket"):
            await self.app(scope, receive, send)
            return

        path = scope["path"]
        if path in GATE_ALLOWED_PATHS or path in GATE_ALLOWED_STATIC_PATHS:
            await self.app(scope, receive, send)
            return

        session = scope.get("session", {})
        if session.get("unlocked"):
            await self.app(scope, receive, send)
            return

        if scope["type"] == "websocket":
            # Closing before accept() surfaces to the browser as an opaque HTTP
            # 403 at the handshake (code 1006, no way to distinguish it
            # client-side) -- accept first so a real close frame with our
            # custom code actually reaches the client's onclose handler.
            await send({"type": "websocket.accept"})
            await send({"type": "websocket.close", "code": 4401})
            return

        response = RedirectResponse(url=f"/gate?next={quote(path, safe='')}")
        await response(scope, receive, send)


def check_site_password(entered: str) -> bool:
    if not SITE_PASSWORD:
        return False
    return secrets.compare_digest(entered, SITE_PASSWORD)
