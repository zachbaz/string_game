import random
import string
import time
from dataclasses import dataclass, field
from typing import Optional

from starlette.websockets import WebSocket

from .words import WORDS

ROUND_SECONDS = 90
CANVAS_W = 800
CANVAS_H = 600
STRING_COLORS = [
    "#e6194b", "#3cb44b", "#4363d8", "#f58231", "#911eb4",
    "#46f0f0", "#f032e6", "#bcf60c", "#fabebe", "#008080",
]


@dataclass
class Player:
    id: str
    name: str
    score: int = 0
    connected: bool = True
    ws: Optional[WebSocket] = None


@dataclass
class StringPiece:
    owner_id: str
    color: str
    x1: float = CANVAS_W / 2 - 60
    y1: float = CANVAS_H / 2
    x2: float = CANVAS_W / 2 + 60
    y2: float = CANVAS_H / 2
    bend_x: float = CANVAS_W / 2
    bend_y: float = CANVAS_H / 2
    thickness: float = 6

    def to_dict(self):
        return {
            "owner_id": self.owner_id,
            "color": self.color,
            "x1": self.x1, "y1": self.y1,
            "x2": self.x2, "y2": self.y2,
            "bend_x": self.bend_x, "bend_y": self.bend_y,
            "thickness": self.thickness,
        }

    def update(self, field_name: str, value: float):
        if field_name not in {"x1", "y1", "x2", "y2", "bend_x", "bend_y", "thickness"}:
            return
        if field_name == "thickness":
            value = max(1, min(40, value))
        setattr(self, field_name, value)


class Room:
    def __init__(self, code: str):
        self.code = code
        self.players: dict[str, Player] = {}
        self.turn_order: list[str] = []
        self.state = "lobby"  # lobby | round_active | round_end
        self.guesser_id: Optional[str] = None
        self.word: Optional[str] = None
        self.strings: dict[str, StringPiece] = {}
        self.round_deadline: Optional[float] = None
        self.used_words: set[str] = set()
        self.guess_log: list[dict] = []

    # -- players --
    def add_player(self, player_id: str, name: str, ws: WebSocket) -> Player:
        if player_id in self.players:
            p = self.players[player_id]
            p.connected = True
            p.ws = ws
            return p
        player = Player(id=player_id, name=name, ws=ws)
        self.players[player_id] = player
        self.turn_order.append(player_id)
        return player

    def remove_player(self, player_id: str):
        if player_id in self.players:
            self.players[player_id].connected = False
            self.players[player_id].ws = None

    def connected_players(self) -> list[Player]:
        return [p for p in self.players.values() if p.connected]

    # -- rounds --
    def pick_word(self) -> str:
        available = [w for w in WORDS if w not in self.used_words]
        if not available:
            self.used_words.clear()
            available = WORDS
        word = random.choice(available)
        self.used_words.add(word)
        return word

    def next_guesser(self) -> Optional[str]:
        candidates = [pid for pid in self.turn_order if self.players.get(pid) and self.players[pid].connected]
        if len(candidates) < 2:
            return None
        if self.guesser_id in candidates:
            idx = candidates.index(self.guesser_id)
            return candidates[(idx + 1) % len(candidates)]
        return candidates[0]

    def start_round(self) -> bool:
        guesser = self.next_guesser()
        if guesser is None:
            return False
        self.guesser_id = guesser
        self.word = self.pick_word()
        self.state = "round_active"
        self.round_deadline = time.time() + ROUND_SECONDS
        self.guess_log = []

        others = [pid for pid in self.connected_ids() if pid != guesser]
        random.shuffle(others)
        self.strings = {}
        for i, pid in enumerate(others):
            color = STRING_COLORS[i % len(STRING_COLORS)]
            self.strings[pid] = StringPiece(owner_id=pid, color=color)
        return True

    def connected_ids(self) -> list[str]:
        return [p.id for p in self.connected_players()]

    def check_guess(self, guesser_id: str, text: str) -> bool:
        if self.state != "round_active" or guesser_id != self.guesser_id:
            return False
        if not self.word:
            return False
        correct = text.strip().lower() == self.word.lower()
        self.guess_log.append({"text": text, "correct": correct, "player_id": guesser_id})
        if correct:
            self.players[guesser_id].score += 10
            for pid in self.strings:
                if pid in self.players:
                    self.players[pid].score += 5
            self.state = "round_end"
        return correct

    def round_state_for(self, viewer_id: str) -> dict:
        is_guesser = viewer_id == self.guesser_id
        if self.state == "round_active":
            word = None if is_guesser else self.word
        elif self.state == "round_end":
            word = self.word
        else:
            word = None
        return {
            "type": "state",
            "room_state": self.state,
            "guesser_id": self.guesser_id,
            "word": word,
            "players": [
                {"id": p.id, "name": p.name, "score": p.score, "connected": p.connected}
                for p in self.players.values()
            ],
            "strings": {pid: s.to_dict() for pid, s in self.strings.items()},
            "you_are_guesser": viewer_id == self.guesser_id,
            "round_deadline": self.round_deadline,
        }


def generate_room_code() -> str:
    return "".join(random.choices(string.ascii_uppercase, k=4))


ROOMS: dict[str, Room] = {}


def get_or_create_room(code: str) -> Room:
    if code not in ROOMS:
        ROOMS[code] = Room(code)
    return ROOMS[code]
