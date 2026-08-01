import random
import string
import time
from dataclasses import dataclass
from typing import Optional

from starlette.websockets import WebSocket

RACE_SECONDS = 30.0

# Kept in sync with the animal roster drawn client-side in
# frontend/animal-race/app.js -- an id here with no matching silhouette
# there would just render as a blank racer.
ANIMAL_IDS = ["rabbit", "turtle", "cat", "dog", "fox", "horse"]


@dataclass
class RacePlayer:
    id: str
    name: str
    user_id: Optional[int] = None
    animal: str = ""
    wins: int = 0
    connected: bool = True
    ws: Optional[WebSocket] = None


class AnimalRaceRoom:
    def __init__(self, code: str):
        self.code = code
        self.players: dict[str, RacePlayer] = {}
        # Explicit join order, not reliance on dict insertion order: reconnects
        # update an existing player in place rather than re-inserting, and
        # lane order must stay stable across a reconnect.
        self.join_order: list[str] = []
        self.state = "lobby"  # lobby | result -- the winner is drawn instantly;
        # the suspense is pure client-side animation, so there's no "racing" state.
        self.last_winner_id: Optional[str] = None
        self.race_locked_until: float = 0.0
        # Broadcast so every client can derive the same pseudo-random pacing
        # (waypoints, "false favorite" pick) for a given race -- each client
        # animates independently, so without a shared seed every screen would
        # show a different-looking race for the same draw.
        self.race_seed: int = 0

    # -- players --
    def add_player(self, player_id: str, name: str, user_id: Optional[int], ws: WebSocket) -> RacePlayer:
        if player_id in self.players:
            p = self.players[player_id]
            p.connected = True
            p.ws = ws
            p.user_id = user_id
            p.name = name
            return p
        player = RacePlayer(
            id=player_id,
            name=name,
            user_id=user_id,
            animal=random.choice(ANIMAL_IDS),
            ws=ws,
        )
        self.players[player_id] = player
        self.join_order.append(player_id)
        return player

    def remove_player(self, player_id: str):
        if player_id in self.players:
            self.players[player_id].connected = False
            self.players[player_id].ws = None

    def connected_ids(self) -> list[str]:
        return [pid for pid in self.join_order if self.players[pid].connected]

    def choose_animal(self, player_id: str, animal: str) -> bool:
        if animal not in ANIMAL_IDS or player_id not in self.players:
            return False
        self.players[player_id].animal = animal
        return True

    # -- racing --
    def start_race(self) -> Optional[str]:
        # Everything here is synchronous and must stay that way: this whole
        # method runs to completion (read connected_ids, pick a winner, mutate
        # state) with no `await` in between, which is what makes the draw
        # atomic with respect to other incoming messages. Don't add an await
        # anywhere in here.
        if time.time() < self.race_locked_until:
            return None
        candidates = self.connected_ids()
        if len(candidates) < 2:
            return None
        winner_id = random.choice(candidates)
        self.players[winner_id].wins += 1
        self.last_winner_id = winner_id
        self.state = "result"
        self.race_locked_until = time.time() + RACE_SECONDS
        self.race_seed = random.randint(0, 2**31 - 1)
        return winner_id

    def state_dict(self) -> dict:
        # No per-viewer redaction here (everyone sees the same thing), so
        # unlike Room.round_state_for(viewer_id) this takes no viewer_id.
        return {
            "type": "state",
            "room_state": self.state,
            "last_winner_id": self.last_winner_id,
            "race_seconds": RACE_SECONDS,
            "race_seed": self.race_seed,
            "players": [
                {
                    "id": pid,
                    "name": self.players[pid].name,
                    "animal": self.players[pid].animal,
                    "wins": self.players[pid].wins,
                    "connected": self.players[pid].connected,
                }
                for pid in self.join_order
            ],
        }


def generate_race_code() -> str:
    return "".join(random.choices(string.ascii_uppercase, k=4))


RACE_ROOMS: dict[str, AnimalRaceRoom] = {}


def get_or_create_race_room(code: str) -> AnimalRaceRoom:
    if code not in RACE_ROOMS:
        RACE_ROOMS[code] = AnimalRaceRoom(code)
    return RACE_ROOMS[code]
