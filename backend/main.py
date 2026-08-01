import asyncio
import html
import os
import uuid
from urllib.parse import quote

from fastapi import FastAPI, Form, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.sessions import SessionMiddleware

from . import users
from .auth import GateMiddleware, check_site_password
from .db import init_db
from .game import ROOMS, Room, generate_room_code, get_or_create_room
from .users import UsernameTakenError

app = FastAPI()

FRONTEND_DIR = "frontend"
app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")

init_db()

# Order matters: Starlette wraps middleware in the reverse of add_middleware()
# call order, so the last one added ends up outermost (runs first). Session
# must run before Gate so scope["session"] is populated by the time the gate
# checks it -- add GateMiddleware first, SessionMiddleware second.
app.add_middleware(GateMiddleware)
app.add_middleware(
    SessionMiddleware,
    secret_key=os.environ["SESSION_SECRET_KEY"],
    max_age=None,  # session cookie: cleared when the browser closes
)


def safe_next_path(path: str) -> str:
    if path.startswith("/") and not path.startswith("//"):
        return path
    return "/"


def render_page(template_path: str, next_path: str, error: str = "") -> str:
    template = open(template_path, encoding="utf-8").read()
    return (
        template.replace("{next}", html.escape(next_path, quote=True))
        .replace("{next_urlenc}", quote(next_path, safe=""))
        .replace("{error}", html.escape(error))
    )


def render_gate_page(next_path: str, error: str = "") -> str:
    return render_page(f"{FRONTEND_DIR}/gate.html", next_path, error)


@app.get("/gate")
def gate_page(next: str = "/"):
    return HTMLResponse(render_gate_page(safe_next_path(next)))


@app.post("/gate")
def gate_submit(request: Request, password: str = Form(...), next: str = Form("/")):
    next_path = safe_next_path(next)
    if check_site_password(password):
        request.session["unlocked"] = True
        return RedirectResponse(url=next_path, status_code=303)
    return HTMLResponse(
        render_gate_page(next_path, error="Incorrect password."), status_code=401
    )


@app.get("/login")
def login_page(next: str = "/"):
    return HTMLResponse(
        render_page(f"{FRONTEND_DIR}/auth/login.html", safe_next_path(next))
    )


@app.post("/login")
def login_submit(
    request: Request,
    username: str = Form(...),
    password: str = Form(...),
    next: str = Form("/"),
):
    next_path = safe_next_path(next)
    user_id = users.verify_user(username, password)
    if user_id is None:
        return HTMLResponse(
            render_page(
                f"{FRONTEND_DIR}/auth/login.html",
                next_path,
                error="Incorrect username or password.",
            ),
            status_code=401,
        )
    request.session["user_id"] = user_id
    request.session["username"] = username
    return RedirectResponse(url=next_path, status_code=303)


@app.get("/signup")
def signup_page(next: str = "/"):
    return HTMLResponse(
        render_page(f"{FRONTEND_DIR}/auth/signup.html", safe_next_path(next))
    )


@app.post("/signup")
def signup_submit(
    request: Request,
    username: str = Form(...),
    password: str = Form(...),
    next: str = Form("/"),
):
    next_path = safe_next_path(next)
    username = username.strip()[:20]
    if not username or not password:
        return HTMLResponse(
            render_page(
                f"{FRONTEND_DIR}/auth/signup.html",
                next_path,
                error="Username and password are required.",
            ),
            status_code=400,
        )
    try:
        user_id = users.create_user(username, password)
    except UsernameTakenError:
        return HTMLResponse(
            render_page(
                f"{FRONTEND_DIR}/auth/signup.html",
                next_path,
                error="That username is taken.",
            ),
            status_code=409,
        )
    request.session["user_id"] = user_id
    request.session["username"] = username
    return RedirectResponse(url=next_path, status_code=303)


@app.post("/logout")
def logout(request: Request):
    request.session.pop("user_id", None)
    request.session.pop("username", None)
    return RedirectResponse(url="/", status_code=303)


@app.get("/api/me")
def api_me(request: Request):
    username = request.session.get("username")
    return JSONResponse({"logged_in": username is not None, "username": username})


@app.get("/api/leaderboard")
def api_leaderboard():
    return JSONResponse(users.get_leaderboard())


@app.get("/")
def index():
    return FileResponse(f"{FRONTEND_DIR}/landing.html")


@app.get("/games/string-theory")
def string_theory_page():
    return FileResponse(f"{FRONTEND_DIR}/string-theory/index.html")


@app.get("/games/string-theory/room/{code}")
def string_theory_room_page(code: str):
    return FileResponse(f"{FRONTEND_DIR}/string-theory/index.html")


@app.post("/api/rooms")
def create_room():
    code = generate_room_code()
    while code in ROOMS:
        code = generate_room_code()
    get_or_create_room(code)
    return JSONResponse({"code": code})


async def broadcast_state(room: Room):
    for player in list(room.players.values()):
        if player.connected and player.ws is not None:
            try:
                await player.ws.send_json(room.round_state_for(player.id))
            except Exception:
                pass


@app.websocket("/ws/{code}")
async def ws_endpoint(websocket: WebSocket, code: str):
    await websocket.accept()
    room = get_or_create_room(code.upper())

    user_id = websocket.session.get("user_id")
    username = websocket.session.get("username")
    if not user_id:
        await websocket.send_json({"type": "error", "message": "Please log in to play."})
        await websocket.close()
        return

    player_id = None
    try:
        join_msg = await websocket.receive_json()
        if join_msg.get("type") != "join":
            await websocket.close()
            return
        player_id = join_msg.get("player_id") or str(uuid.uuid4())
        room.add_player(player_id, username, user_id, websocket)
        await websocket.send_json({"type": "joined", "player_id": player_id})
        await broadcast_state(room)

        while True:
            msg = await websocket.receive_json()
            mtype = msg.get("type")

            if mtype == "start_round":
                if room.state in ("lobby", "round_end"):
                    started = room.start_round()
                    if started:
                        await broadcast_state(room)
                    else:
                        await websocket.send_json({
                            "type": "error",
                            "message": "Need at least 2 connected players to start a round.",
                        })

            elif mtype == "update_string":
                if room.state == "round_active" and player_id in room.strings:
                    field_name = msg.get("field")
                    value = msg.get("value")
                    if isinstance(value, (int, float)) and isinstance(field_name, str):
                        room.strings[player_id].update(field_name, float(value))
                        await broadcast_state(room)

            elif mtype == "guess":
                text = str(msg.get("text", ""))
                correct = room.check_guess(player_id, text)
                await broadcast_state(room)
                if correct:
                    for pid in [room.guesser_id, *room.strings.keys()]:
                        scorer = room.players.get(pid)
                        if scorer and scorer.user_id:
                            amount = 10 if pid == room.guesser_id else 5
                            await asyncio.to_thread(users.add_score, scorer.user_id, amount)

    except WebSocketDisconnect:
        if player_id:
            room.remove_player(player_id)
            await broadcast_state(room)
