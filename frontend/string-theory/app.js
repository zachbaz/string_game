const lobbyScreen = document.getElementById("lobby-screen");
const gameScreen = document.getElementById("game-screen");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

let ws = null;
let playerId = sessionStorage.getItem("string_theory_player_id") || null;
let roomCode = null;
let latestState = null;
let dragging = null; // {field: 'x1'|'y1'|... paired, handle: 'a'|'b'|'bend'}

function api(path, opts) {
  return fetch(path, opts).then(r => r.json());
}

(async () => {
  const me = await api("/api/me");
  if (!me.logged_in) {
    location.href = "/login?next=" + encodeURIComponent(location.pathname);
  }
})();

document.getElementById("create-room-btn").onclick = async () => {
  const { code } = await api("/api/rooms", { method: "POST" });
  joinRoom(code);
};

document.getElementById("join-room-btn").onclick = () => {
  const code = document.getElementById("join-code-input").value.trim().toUpperCase();
  if (code.length !== 4) { alert("Enter a 4-letter room code"); return; }
  joinRoom(code);
};

function joinRoom(code) {
  roomCode = code;
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}/ws/${code}`);
  ws.onopen = () => {
    ws.send(JSON.stringify({ type: "join", player_id: playerId }));
  };
  ws.onmessage = (evt) => {
    const msg = JSON.parse(evt.data);
    if (msg.type === "joined") {
      playerId = msg.player_id;
      sessionStorage.setItem("string_theory_player_id", playerId);
      lobbyScreen.classList.add("hidden");
      gameScreen.classList.remove("hidden");
      document.getElementById("room-code-label").textContent = "Room: " + roomCode;
    } else if (msg.type === "state") {
      latestState = msg;
      render();
    } else if (msg.type === "error") {
      alert(msg.message);
    }
  };
  ws.onclose = (evt) => {
    if (evt.code === 4401) {
      location.href = "/gate?next=" + encodeURIComponent(location.pathname);
      return;
    }
    document.getElementById("status-label").textContent = "Disconnected";
  };
}

document.getElementById("start-round-btn").onclick = () => {
  ws.send(JSON.stringify({ type: "start_round" }));
};

document.getElementById("guess-btn").onclick = submitGuess;
document.getElementById("guess-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") submitGuess();
});
function submitGuess() {
  const input = document.getElementById("guess-input");
  if (!input.value.trim()) return;
  ws.send(JSON.stringify({ type: "guess", text: input.value.trim() }));
  input.value = "";
}

document.getElementById("thickness-slider").oninput = (e) => {
  ws.send(JSON.stringify({ type: "update_string", field: "thickness", value: Number(e.target.value) }));
};

function render() {
  if (!latestState) return;
  const s = latestState;

  document.getElementById("status-label").textContent =
    s.room_state === "lobby" ? "Waiting to start" :
    s.room_state === "round_active" ? "Round in progress" : "Round over!";

  const deadlineEl = document.getElementById("timer-label");
  if (s.room_state === "round_active" && s.round_deadline) {
    const secs = Math.max(0, Math.round(s.round_deadline - Date.now() / 1000));
    deadlineEl.textContent = secs + "s";
  } else {
    deadlineEl.textContent = "";
  }

  const startBtn = document.getElementById("start-round-btn");
  startBtn.classList.toggle("hidden", s.room_state === "round_active");

  const wordBanner = document.getElementById("word-banner");
  if (s.room_state === "round_active" && !s.you_are_guesser) {
    wordBanner.textContent = "Word: " + s.word;
  } else if (s.room_state === "round_end") {
    wordBanner.textContent = "The word was: " + s.word;
  } else if (s.you_are_guesser && s.room_state === "round_active") {
    wordBanner.textContent = "You're guessing!";
  } else {
    wordBanner.textContent = "";
  }

  const controls = document.getElementById("controls");
  const guessArea = document.getElementById("guess-area");
  const isContributor = s.room_state === "round_active" && !s.you_are_guesser && s.strings[playerId];
  controls.classList.toggle("hidden", !isContributor);
  guessArea.classList.toggle("hidden", !(s.room_state === "round_active" && s.you_are_guesser));

  if (isContributor) {
    document.getElementById("thickness-slider").value = s.strings[playerId].thickness;
  }

  const list = document.getElementById("player-list");
  list.innerHTML = "";
  s.players.forEach(p => {
    const li = document.createElement("li");
    let label = `${p.name} — ${p.score} pts`;
    if (p.id === s.guesser_id) label = "🎯 " + label;
    if (p.id === playerId) label += " (you)";
    if (!p.connected) label += " [offline]";
    li.textContent = label;
    list.appendChild(li);
  });

  drawCanvas(s);
}

function drawCanvas(s) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  Object.values(s.strings || {}).forEach(str => {
    ctx.beginPath();
    ctx.moveTo(str.x1, str.y1);
    ctx.quadraticCurveTo(str.bend_x, str.bend_y, str.x2, str.y2);
    ctx.strokeStyle = str.color;
    ctx.lineWidth = str.thickness;
    ctx.lineCap = "round";
    ctx.stroke();
  });

  // draw drag handles for the local player's own string
  const mine = s.strings && s.strings[playerId];
  if (mine && s.room_state === "round_active" && !s.you_are_guesser) {
    drawHandle(mine.x1, mine.y1);
    drawHandle(mine.x2, mine.y2);
    drawHandle(mine.bend_x, mine.bend_y, "#333");
  }
}

function drawHandle(x, y, color = "#000") {
  ctx.beginPath();
  ctx.arc(x, y, 7, 0, Math.PI * 2);
  ctx.fillStyle = "white";
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = color;
  ctx.stroke();
}

function canvasPos(evt) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (evt.clientX - rect.left) * (canvas.width / rect.width),
    y: (evt.clientY - rect.top) * (canvas.height / rect.height),
  };
}

function hitTest(pos, mine) {
  const handles = [
    { name: "a", x: mine.x1, y: mine.y1 },
    { name: "b", x: mine.x2, y: mine.y2 },
    { name: "bend", x: mine.bend_x, y: mine.bend_y },
  ];
  for (const h of handles) {
    const d = Math.hypot(h.x - pos.x, h.y - pos.y);
    if (d <= 14) return h.name;
  }
  return null;
}

canvas.addEventListener("mousedown", (evt) => {
  if (!latestState || latestState.room_state !== "round_active" || latestState.you_are_guesser) return;
  const mine = latestState.strings[playerId];
  if (!mine) return;
  const pos = canvasPos(evt);
  const handle = hitTest(pos, mine);
  if (handle) dragging = handle;
});

canvas.addEventListener("mousemove", (evt) => {
  if (!dragging || !latestState) return;
  const pos = canvasPos(evt);
  const clampedX = Math.max(0, Math.min(canvas.width, pos.x));
  const clampedY = Math.max(0, Math.min(canvas.height, pos.y));

  const fields = dragging === "a" ? ["x1", "y1"] : dragging === "b" ? ["x2", "y2"] : ["bend_x", "bend_y"];
  ws.send(JSON.stringify({ type: "update_string", field: fields[0], value: clampedX }));
  ws.send(JSON.stringify({ type: "update_string", field: fields[1], value: clampedY }));
});

window.addEventListener("mouseup", () => { dragging = null; });

setInterval(() => { if (latestState) render(); }, 1000);
