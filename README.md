# StringGame

A real-time multiplayer party game: one player guesses a secret word while everyone else
each controls a single bendable string on a shared canvas — and that's the *only* way they're
allowed to communicate.

## How to play

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

## Running it locally

Requires Python 3.10+.

```
pip install -r requirements.txt
python -m uvicorn backend.main:app --reload --port 8000
```

Then open `http://localhost:8000` in a browser. Open it in multiple tabs/devices to simulate
multiple players.

## Tech stack

- **Backend:** FastAPI, served over a WebSocket per room (`/ws/{code}`) plus a single REST
  endpoint (`POST /api/rooms`) for room creation. All game state is held in memory — there's
  no database, and restarting the server clears all rooms.
- **Frontend:** Plain HTML/CSS/JS with no build step or framework. The game canvas is drawn
  with the 2D Canvas API.

## Project structure

```
backend/
  main.py    FastAPI app, HTTP + WebSocket routes
  game.py    Room/Player/StringPiece state and round logic
  words.py   Word list used for rounds
frontend/
  index.html Page layout
  app.js     WebSocket client, canvas rendering, drag handling
  style.css  Styling
```

See `CLAUDE.md` for a deeper architectural walkthrough of the state-sync model.

## License

MIT — see [LICENSE](LICENSE).
