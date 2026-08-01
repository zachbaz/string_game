# Game Night

A small hub of real-time multiplayer party games. Sign up, pick a game from the landing page,
and play with friends over the browser — no installs. The landing page also shows a leaderboard
of lifetime scores across everyone with an account.

## Games

### String Theory

One player guesses a secret word while everyone else each controls a single bendable string
on a shared canvas — and that's the *only* way they're allowed to communicate.

1. One player creates a room and shares the 4-letter room code with friends.
2. Everyone joins the room from their own device/browser.
3. When at least 2 players are connected, hit **Start Round**. One player is chosen as the
   **guesser** and a secret word is picked for everyone else.
4. Every other player gets one string, rendered as a curve with two endpoints and a bend
   handle. Drag the handles to move, stretch, and bend your string, and use the slider to
   change its thickness.
5. Together, the non-guessers shape their strings on the canvas to hint at the word — no
   talking, typing, or gesturing outside the canvas allowed.
6. The guesser watches the strings update live and types guesses. A correct guess ends the
   round: the guesser scores 10 points, everyone who contributed a string scores 5.
7. Start another round — the guesser role rotates to the next connected player each time.

### The Great Wheel of Deciding

Everyone who joins a room becomes an equal-size wedge on a spinning wheel.

1. One player creates a room and shares the 4-letter room code with friends.
2. Everyone joins from their own device/browser — each new player adds a wedge.
3. When at least 2 players are connected, hit **Spin**. The wheel picks a uniformly random
   connected player, who scores 10 points.
4. Spin again whenever — the same room stays open and the same player can win (and score) more
   than once.

More games will be added to the landing page over time.

## Running it locally

Requires Python 3.10+. The whole app sits behind a shared-password gate, so two env vars are
required before it'll start:

```
pip install -r requirements.txt
export SITE_PASSWORD="whatever you want friends to type in"
export SESSION_SECRET_KEY="any random string"
python -m uvicorn backend.main:app --reload --port 8000
```

Then open `http://localhost:8000` in a browser — you'll be redirected to enter `SITE_PASSWORD`
first, then to sign up/log in before you can join a game. Open it in multiple tabs/devices (or
sign up multiple accounts) to simulate multiple players.

Accounts and scores are stored in a SQLite file (`DB_PATH`, defaults to `./data/stringgame.db`
locally — gitignored, created automatically). Unlike room/round state, this persists across
restarts.

## Tech stack

- **Backend:** FastAPI. Each game gets its own routes and its own WebSocket (String Theory uses
  `/ws/{code}` + `POST /api/rooms`; The Great Wheel of Deciding uses `/ws/wheel/{code}` +
  `POST /api/wheel/rooms`). All room/round state is held in memory and clears on restart.
  Accounts and lifetime scores are the one thing that's persisted, in a small SQLite database.
- **Frontend:** Plain HTML/CSS/JS with no build step or framework. `common.css` holds shared
  page chrome; each game has its own directory under `frontend/` for its markup, styling, and
  client logic.

## Project structure

```
backend/
  main.py             FastAPI app, HTTP + WebSocket routes
  auth.py              Site-password gate middleware + password hashing
  db.py                SQLite connection helper
  users.py             Account/leaderboard persistence
  game.py              Room/Player/StringPiece state and round logic (String Theory)
  words.py             Word list used for String Theory rounds
  wheel.py             WheelRoom/WheelPlayer state and spin logic (The Great Wheel of Deciding)
frontend/
  landing.html         Game-selection landing page + leaderboard
  landing.css          Landing page styling
  landing.js           Leaderboard + account-bar fetch/render
  common.css           Shared page chrome (buttons, inputs, cards)
  gate.html            Shared-password entry page
  auth/
    login.html          Log in page
    signup.html         Sign up page
  string-theory/
    index.html         Page layout
    app.js              WebSocket client, canvas rendering, drag handling
    style.css           Game-specific styling
  great-wheel-of-deciding/
    index.html         Page layout
    app.js              WebSocket client, wheel drawing + CSS-transform spin animation
    style.css           Game-specific styling
```

See `CLAUDE.md` for a deeper architectural walkthrough of the state-sync model.

## Deployment

Hosted on [Fly.io](https://fly.io) as a single always-on machine, built from the `Dockerfile` in
this repo. This is required, not just convenient: all game state lives in an in-memory `ROOMS`
dict in one Python process, so the app cannot be split across multiple instances/replicas or
scaled to zero — rooms would randomly become invisible to players routed to a different
instance.

One-time setup:

```
flyctl auth login
flyctl launch --no-deploy   # reuses fly.toml; pick a different `app` name if the one in fly.toml is taken
flyctl deploy
```

Then add a `FLY_API_TOKEN` secret to the GitHub repo (Settings → Secrets and variables →
Actions) with the output of `flyctl tokens create deploy`, so CI can deploy on your behalf.
Also set `SITE_PASSWORD` and `SESSION_SECRET_KEY` (see "Access control" in `CLAUDE.md`), and
create the volume the SQLite database lives on:

```
flyctl volumes create stringgame_data --region iad --size 1
```

(`fly.toml` already points `/data` at this volume — see the note in `CLAUDE.md` about volumes
being pinned to a single host if the machine is ever destroyed/recreated.)

CI/CD (`.github/workflows/deploy.yml`): every PR runs a quick sanity import check; every push
to `main` (i.e. every merged PR) redeploys automatically via `flyctl deploy`.

## License

MIT — see [LICENSE](LICENSE).
