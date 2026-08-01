# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Game Night is a small hub of real-time multiplayer party games, reached through a landing page
at `/` where players pick a game to play. The only game so far is **String Theory**: one player
(the "guesser") must guess a secret word while the other connected players each control one
bendable string (a quadratic curve on a shared canvas) and can only communicate by shaping their
string. There is no build step, no database, and no test suite — it's a single FastAPI backend
serving a static vanilla-JS/HTML/CSS frontend, with all game state held in memory.

## Running it

```
pip install -r requirements.txt
python -m uvicorn backend.main:app --reload --port 8000
```

Then open `http://localhost:8000`. The VS Code launch config at `.claude/launch.json` runs the
same command. There are no lint or test commands configured in this repo.

## Workflow

Every task gets its own feature branch and pull request — do not commit directly to `main`.
Branch off `main`, make the change, push the branch, and open a PR (e.g. via `gh pr create`)
rather than pushing straight to `main`.

## Architecture

- **`backend/game.py`** — all game/state logic, with zero framework dependencies. `Room` is the
  single source of truth for a game session (players, turn order, current word, string
  positions, score). `ROOMS: dict[str, Room]` is a process-global, in-memory room registry keyed
  by 4-letter room code — restarting the server drops all rooms. There is no persistence layer.
- **`backend/main.py`** — the FastAPI app. Serves the landing page at `/` and the String Theory
  page at `/games/string-theory`. One `POST /api/rooms` HTTP endpoint creates a String Theory
  room; everything else for that game (joining, starting rounds, moving strings, guessing)
  happens over a single WebSocket at `/ws/{code}` using a `{"type": ...}` JSON message protocol.
  Every mutating message triggers `broadcast_state`, which pushes a full
  `Room.round_state_for(viewer_id)` snapshot to every connected socket in the room — state is not
  diffed or delta-encoded.
- **`backend/words.py`** — the static word list (`WORDS`) drawn from for each String Theory round.
- **`frontend/landing.html` / `landing.css`** — the game-selection landing page. Each game is one
  card linking to its own route; there's no client-side routing framework involved.
- **`frontend/common.css`** — shared page chrome (body theme, buttons, inputs, `.card`) used by
  both the landing page and every game.
- **`frontend/string-theory/app.js`** — single-file vanilla JS client for String Theory. Holds
  `latestState` (the last state broadcast from the server) and a `dragging` field for the
  currently-grabbed string handle; `render()` is the one function that syncs the DOM/canvas to
  `latestState`. There's no framework and no build step — `index.html` loads `app.js` and
  `style.css` directly from `/static/string-theory/`.

### Adding a new game

Each game gets its own directory under `frontend/<game-slug>/` for its markup, styles, and
client JS (pulling in `frontend/common.css` for shared chrome), plus its own route(s) in
`backend/main.py` and, if it needs live state, its own WebSocket path — don't reuse String
Theory's `/ws/{code}` or its `Room`/`ROOMS` model for unrelated games. Add a card for it to
`frontend/landing.html`.

### Server-authoritative state model

The frontend never computes game state locally beyond input handling — every UI update flows
from a `{"type": "state", ...}` message rebroadcast by the server. Client actions (`start_round`,
`update_string`, `guess`) are optimistic-free: the client sends an intent and waits for the next
broadcast to reflect it. When adding a new player action, follow this pattern: add a `mtype` case
in `ws_endpoint` in `main.py`, mutate the `Room` in `game.py`, then call `broadcast_state(room)`.

### Per-viewer state redaction

`Room.round_state_for(viewer_id)` computes a *different* payload depending on who's asking: the
guesser never sees `word` while a round is active, and only the viewer's own `StringPiece` drag
handles are meaningful to draw client-side. Any new field that should be hidden from the guesser
(or from non-owners) needs to be redacted inside this method, not filtered client-side — the
guesser's browser only ever receives what `round_state_for` returns for that guesser.

### Player identity vs. connection

`player_id` is a UUID persisted in `sessionStorage` on the client (`string_theory_player_id`), not
tied to the WebSocket connection. Reconnecting with the same `player_id` (e.g. after a page
reload) rejoins the same `Player` and restores their `connected` flag rather than creating a new
player — see `Room.add_player`. `Room.remove_player` on disconnect keeps the `Player` record
(for score/turn-order continuity) and only flips `connected = False`.
