# Game Night

A small hub of real-time multiplayer party games. Pick a game from the landing page and play
with friends over the browser — no accounts, no installs.

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

More games will be added to the landing page over time.

## Running it locally

Requires Python 3.10+.

```
pip install -r requirements.txt
python -m uvicorn backend.main:app --reload --port 8000
```

Then open `http://localhost:8000` in a browser to reach the landing page. Open it in multiple
tabs/devices to simulate multiple players.

## Tech stack

- **Backend:** FastAPI. Each game gets its own routes and, where needed, its own WebSocket
  (String Theory uses `/ws/{code}` plus a `POST /api/rooms` REST endpoint for room creation).
  All game state is held in memory — there's no database, and restarting the server clears
  all rooms.
- **Frontend:** Plain HTML/CSS/JS with no build step or framework. `common.css` holds shared
  page chrome; each game has its own directory under `frontend/` for its markup, styling, and
  client logic.

## Project structure

```
backend/
  main.py             FastAPI app, HTTP + WebSocket routes
  game.py              Room/Player/StringPiece state and round logic (String Theory)
  words.py             Word list used for String Theory rounds
frontend/
  landing.html         Game-selection landing page
  landing.css          Landing page styling
  common.css           Shared page chrome (buttons, inputs, cards)
  string-theory/
    index.html         Page layout
    app.js              WebSocket client, canvas rendering, drag handling
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

CI/CD (`.github/workflows/deploy.yml`): every PR runs a quick sanity import check; every push
to `main` (i.e. every merged PR) redeploys automatically via `flyctl deploy`.

## License

MIT — see [LICENSE](LICENSE).
