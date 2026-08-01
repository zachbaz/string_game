# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Game Night is a small hub of real-time multiplayer party games, reached through a landing page
at `/` where players pick a game to play. There are two games so far:

- **String Theory**: one player (the "guesser") must guess a secret word while the other
  connected players each control one bendable string (a quadratic curve on a shared canvas) and
  can only communicate by shaping their string.
- **The Great Wheel of Deciding**: everyone who joins a room becomes an equal-size wedge on a
  spinning wheel; spinning picks a uniformly random connected player, who scores 10 points.
  Repeatably spinnable in the same room.

There is no build step and no test suite — it's a single FastAPI backend serving a static
vanilla-JS/HTML/CSS frontend. Game state (rooms, in-progress rounds) lives entirely in memory and
is lost on restart; only accounts and lifetime leaderboard scores are persisted, in a SQLite file
on a Fly Volume.

## Running it

```
pip install -r requirements.txt
python -m uvicorn backend.main:app --reload --port 8000
```

Then open `http://localhost:8000`. The VS Code launch config at `.claude/launch.json` runs the
same command. There are no lint or test commands configured in this repo.

## Deployment

Live at https://string-theory-game.fly.dev/. Deployed to Fly.io as a single always-on machine
(see `Dockerfile`, `fly.toml`, and `.github/workflows/deploy.yml`, and the "Deployment" section
of `README.md` for setup steps). Because `ROOMS` and all `Room` state live in one process's
memory, this **must** stay a single instance — do not introduce multi-replica autoscaling,
`min_machines_running` > 1, or a serverless/scale-to-zero deployment target without first moving
room state out of process memory (e.g. into Redis) and adding sticky WebSocket routing.

`flyctl launch`/`flyctl deploy` create a second machine by default for zero-downtime
high-availability, even with `min_machines_running = 1` in `fly.toml` — this silently breaks the
single-instance requirement above. After any fresh `flyctl launch`, check `flyctl machines list`
and destroy the extra machine (`flyctl machines destroy <id>`) if more than one is running.

The SQLite database (accounts + scores) lives on a Fly Volume (`stringgame_data`, mounted at
`/data`, see `[mounts]` in `fly.toml`) — a volume is pinned to one physical host and does **not**
follow the app automatically. If the machine is ever destroyed and recreated, you must pass the
existing volume ID (`--volume <vol_id>:/data`) or you'll silently get a fresh empty volume and
lose every account and score.

## Access control

The whole app sits behind a single shared-password gate (`GateMiddleware` in `backend/auth.py`),
required before any page, `POST /api/rooms`, or the `/ws/{code}` websocket will respond. It's
enforced at the ASGI middleware level, not per-route, so any new route is gated by default —
allowlist a path explicitly in `backend/auth.py` (not via a `/static` prefix, since `StaticFiles`
mounts the entire `frontend/` tree) if it truly needs to be reachable pre-gate. The gate's
"unlocked" flag lives in a Starlette `SessionMiddleware` session-only cookie (`max_age=None`,
cleared when the browser closes) — `SessionMiddleware` must be added *after* `GateMiddleware` via
`app.add_middleware`, since Starlette wraps middleware in the reverse of call order (last added =
outermost = runs first), and the gate needs the session already parsed by the time it checks it.
Requires `SITE_PASSWORD` and `SESSION_SECRET_KEY` env vars (set as Fly secrets in prod; export
both locally before running uvicorn — there's no committed default).

Separately, playing String Theory (joining a room over `/ws/{code}`) requires a per-user account
login (`session["user_id"]`/`session["username"]`, set by `/login` or `/signup` in `main.py`) —
the landing page's leaderboard is viewable gate-only, but `ws_endpoint` rejects a `join` without
a logged-in `user_id`. Both the gate's "unlocked" flag and the login both live in the same
session-only cookie (one shared lifetime, not two independently-configurable ones) — logging in
lasts only as long as the gate does, i.e. until the browser closes.

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
- **`backend/wheel.py`** — a second, fully independent instance of the same `game.py` pattern for
  The Great Wheel of Deciding: `WheelRoom`/`WheelPlayer`, its own `WHEEL_ROOMS` registry, its own
  4-letter room code generator. No shared state or code with `Room`/`ROOMS` — see "Adding a new
  game" below. `WheelRoom.spin()` picks the winner synchronously (no `await` inside it) so the
  draw is atomic with respect to other incoming messages; `main.py`'s `/ws/wheel/{code}` handler
  calls `broadcast_wheel_state` and then `users.add_score` only after `spin()` has already fully
  resolved, mirroring the ordering `ws_endpoint`'s `guess` handler uses for String Theory.
- **`backend/db.py`** / **`backend/users.py`** — the only persistence in the app. `db.py` opens a
  fresh SQLite connection per call (no shared long-lived connection) against `DB_PATH`; `users.py`
  is plain functions over it (`create_user`, `verify_user`, `add_score`, `get_leaderboard`),
  framework-free like `game.py`. Password hashing (stdlib PBKDF2, not bcrypt/passlib) lives in
  `backend/auth.py` alongside the site-password gate, since both are "prove identity" concerns.
  Called from an `async def` context (the websocket handler), these are blocking calls and must
  go through `asyncio.to_thread(...)` — plain HTTP routes get this for free since FastAPI
  threadpools sync `def` handlers automatically.
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
`frontend/landing.html`. `backend/wheel.py` + `frontend/great-wheel-of-deciding/` is a complete
worked example of this pattern: its own state module, its own `/ws/wheel/{code}` path and
`/api/wheel/rooms` endpoint, its own `sessionStorage` key (`wheel_player_id`) — while still
reusing the shared, app-wide account/session layer (`backend/users.py`, the login check via
`websocket.session`, `GateMiddleware`) rather than duplicating that.

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
guesser's browser only ever receives what `round_state_for` returns for that guesser. This is
specific to games with asymmetric information — The Great Wheel of Deciding has none, so
`WheelRoom.state_dict()` takes no `viewer_id` and every connected socket gets the identical
payload; don't add an unused `viewer_id` parameter to a new game's state method just for surface
consistency if it has nothing to redact.

### Player identity vs. connection

`player_id` is a UUID persisted in `sessionStorage` on the client (`string_theory_player_id`), not
tied to the WebSocket connection. Reconnecting with the same `player_id` (e.g. after a page
reload) rejoins the same `Player` and restores their `connected` flag rather than creating a new
player — see `Room.add_player`. `Room.remove_player` on disconnect keeps the `Player` record
(for score/turn-order continuity) and only flips `connected = False`. `Player.user_id` is a
separate thing: it's the logged-in account backing that player, used only so `main.py` can credit
`users.add_score` on a correct guess — `game.py`'s own scoring (`Room.check_guess`) stays pure
in-memory and framework-free; it does not know the database exists.
