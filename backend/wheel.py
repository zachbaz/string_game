import random
import string
import time
from dataclasses import dataclass
from typing import Optional

from starlette.websockets import WebSocket

ANIMATION_SECONDS = 4.0


@dataclass
class WheelPlayer:
    id: str
    name: str
    user_id: Optional[int] = None
    wins: int = 0
    connected: bool = True
    ws: Optional[WebSocket] = None


class WheelRoom:
    def __init__(self, code: str):
        self.code = code
        self.players: dict[str, WheelPlayer] = {}
        # Explicit join order, not reliance on dict insertion order: reconnects
        # update an existing player in place rather than re-inserting, and
        # wedge angles must stay stable across a reconnect.
        self.join_order: list[str] = []
        self.state = "lobby"  # lobby | result -- the draw resolves instantly;
        # the suspense is pure client-side animation, so there's no "spinning" state.
        self.last_winner_id: Optional[str] = None
        self.spin_locked_until: float = 0.0

    # -- players --
    def add_player(self, player_id: str, name: str, user_id: Optional[int], ws: WebSocket) -> WheelPlayer:
        if player_id in self.players:
            p = self.players[player_id]
            p.connected = True
            p.ws = ws
            p.user_id = user_id
            p.name = name
            return p
        player = WheelPlayer(id=player_id, name=name, user_id=user_id, ws=ws)
        self.players[player_id] = player
        self.join_order.append(player_id)
        return player

    def remove_player(self, player_id: str):
        if player_id in self.players:
            self.players[player_id].connected = False
            self.players[player_id].ws = None

    def connected_ids(self) -> list[str]:
        return [pid for pid in self.join_order if self.players[pid].connected]

    # -- spinning --
    def spin(self) -> Optional[str]:
        # Everything here is synchronous and must stay that way: this whole
        # method runs to completion (read connected_ids, pick a winner, mutate
        # state) with no `await` in between, which is what makes the draw
        # atomic with respect to other incoming messages. Don't add an await
        # anywhere in here.
        if time.time() < self.spin_locked_until:
            return None
        candidates = self.connected_ids()
        if len(candidates) < 2:
            return None
        winner_id = random.choice(candidates)
        self.players[winner_id].wins += 1
        self.last_winner_id = winner_id
        self.state = "result"
        self.spin_locked_until = time.time() + ANIMATION_SECONDS
        return winner_id

    def state_dict(self) -> dict:
        # No per-viewer redaction here (everyone sees the same thing), so
        # unlike Room.round_state_for(viewer_id) this takes no viewer_id.
        return {
            "type": "state",
            "room_state": self.state,
            "last_winner_id": self.last_winner_id,
            "animation_seconds": ANIMATION_SECONDS,
            "players": [
                {
                    "id": pid,
                    "name": self.players[pid].name,
                    "wins": self.players[pid].wins,
                    "connected": self.players[pid].connected,
                }
                for pid in self.join_order
            ],
        }


def generate_wheel_code() -> str:
    return "".join(random.choices(string.ascii_uppercase, k=4))


WHEEL_ROOMS: dict[str, WheelRoom] = {}


def get_or_create_wheel_room(code: str) -> WheelRoom:
    if code not in WHEEL_ROOMS:
        WHEEL_ROOMS[code] = WheelRoom(code)
    return WHEEL_ROOMS[code]
