import uuid

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .game import ROOMS, Room, generate_room_code, get_or_create_room

app = FastAPI()

FRONTEND_DIR = "frontend"
app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")


@app.get("/")
def index():
    return FileResponse(f"{FRONTEND_DIR}/index.html")


@app.get("/room/{code}")
def room_page(code: str):
    return FileResponse(f"{FRONTEND_DIR}/index.html")


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

    player_id = None
    try:
        join_msg = await websocket.receive_json()
        if join_msg.get("type") != "join":
            await websocket.close()
            return
        player_id = join_msg.get("player_id") or str(uuid.uuid4())
        name = (join_msg.get("name") or "Player")[:20]
        room.add_player(player_id, name, websocket)
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
                room.check_guess(player_id, text)
                await broadcast_state(room)

    except WebSocketDisconnect:
        if player_id:
            room.remove_player(player_id)
            await broadcast_state(room)
