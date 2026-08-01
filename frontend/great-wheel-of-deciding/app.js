const lobbyScreen = document.getElementById("lobby-screen");
const gameScreen = document.getElementById("game-screen");
const wheelCanvas = document.getElementById("wheel-canvas");
const ctx = wheelCanvas.getContext("2d");

const WHEEL_COLORS = [
  "#e6194b", "#3cb44b", "#4363d8", "#f58231", "#911eb4",
  "#46f0f0", "#f032e6", "#bcf60c", "#fabebe", "#008080",
];
const FULL_TURNS = 5;

let ws = null;
let playerId = sessionStorage.getItem("wheel_player_id") || null;
let roomCode = null;
let latestState = null;

let currentWedgeOrder = [];
let currentRotationDeg = 0;
let animating = false;
let hasReceivedFirstState = false;
let lastKnownWinnerId = null;

function api(path, opts) {
  return fetch(path, opts).then((r) => r.json());
}

(async () => {
  const me = await api("/api/me");
  if (!me.logged_in) {
    location.href = "/login?next=" + encodeURIComponent(location.pathname);
  }
})();

document.getElementById("create-room-btn").onclick = async () => {
  const { code } = await api("/api/wheel/rooms", { method: "POST" });
  joinRoom(code);
};

document.getElementById("join-room-btn").onclick = () => {
  const code = document.getElementById("join-code-input").value.trim().toUpperCase();
  if (code.length !== 4) { alert("Enter a 4-letter room code"); return; }
  joinRoom(code);
};

document.getElementById("spin-btn").onclick = () => {
  if (!animating) ws.send(JSON.stringify({ type: "spin" }));
};

function joinRoom(code) {
  roomCode = code;
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}/ws/wheel/${code}`);
  ws.onopen = () => {
    ws.send(JSON.stringify({ type: "join", player_id: playerId }));
  };
  ws.onmessage = (evt) => {
    const msg = JSON.parse(evt.data);
    if (msg.type === "joined") {
      playerId = msg.player_id;
      sessionStorage.setItem("wheel_player_id", playerId);
      lobbyScreen.classList.add("hidden");
      gameScreen.classList.remove("hidden");
      document.getElementById("room-code-label").textContent = "Room: " + roomCode;
    } else if (msg.type === "state") {
      handleState(msg);
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

function handleState(state) {
  latestState = state;
  renderPlayerList(state.players);
  document.getElementById("status-label").textContent =
    state.room_state === "lobby" ? "Ready to spin" : "";

  if (!hasReceivedFirstState) {
    hasReceivedFirstState = true;
    lastKnownWinnerId = state.last_winner_id;
    drawWheel(state.players);
    if (state.last_winner_id) showWinnerBanner(state);
    return;
  }

  if (!animating && rosterChanged(state.players)) {
    drawWheel(state.players);
  }

  if (state.last_winner_id && state.last_winner_id !== lastKnownWinnerId) {
    lastKnownWinnerId = state.last_winner_id;
    animateSpin(state);
  }
}

function rosterChanged(players) {
  const ids = players.map((p) => p.id);
  return ids.length !== currentWedgeOrder.length || ids.some((id, i) => id !== currentWedgeOrder[i]);
}

function renderPlayerList(players) {
  const list = document.getElementById("player-list");
  list.innerHTML = "";
  players.forEach((p) => {
    const li = document.createElement("li");
    let label = `${p.name} — ${p.wins} win${p.wins === 1 ? "" : "s"}`;
    if (p.id === playerId) label += " (you)";
    if (!p.connected) label += " [offline]";
    li.textContent = label;
    list.appendChild(li);
  });
}

function showWinnerBanner(state) {
  const winner = state.players.find((p) => p.id === state.last_winner_id);
  const banner = document.getElementById("winner-banner");
  banner.textContent = winner ? `🎉 ${winner.name} wins!` : "";
}

function drawWheel(players) {
  currentWedgeOrder = players.map((p) => p.id);
  const n = players.length;
  const w = wheelCanvas.width;
  const h = wheelCanvas.height;
  const cx = w / 2;
  const cy = h / 2;
  const radius = Math.min(w, h) / 2 - 4;

  ctx.clearRect(0, 0, w, h);
  if (n === 0) return;

  const anglePer = (2 * Math.PI) / n;
  players.forEach((p, i) => {
    const start = -Math.PI / 2 + i * anglePer;
    const end = start + anglePer;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, start, end);
    ctx.closePath();
    ctx.fillStyle = p.connected ? WHEEL_COLORS[i % WHEEL_COLORS.length] : "#555";
    ctx.fill();
    ctx.strokeStyle = "#1b1d23";
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(start + anglePer / 2);
    ctx.textAlign = "right";
    ctx.fillStyle = "#fff";
    ctx.font = "16px system-ui, sans-serif";
    ctx.fillText(p.name, radius - 10, 5);
    ctx.restore();
  });
}

// Angle of wedge i's center, measured from "up" going clockwise -- matches
// how drawWheel() draws wedges (canvas start angle -PI/2 + i*anglePer).
function wedgeCenterAngleDeg(i, n) {
  const anglePerDeg = 360 / n;
  const jitter = (Math.random() - 0.5) * anglePerDeg * 0.6;
  return i * anglePerDeg + anglePerDeg / 2 + jitter;
}

function animateSpin(state) {
  const idx = currentWedgeOrder.indexOf(state.last_winner_id);
  if (idx === -1) {
    // Roster changed since the last draw in a way we didn't expect --
    // just redraw and show the result without an animation this time.
    drawWheel(state.players);
    showWinnerBanner(state);
    return;
  }

  const n = currentWedgeOrder.length;
  const wedgeAngle = wedgeCenterAngleDeg(idx, n);
  // The pointer is fixed at the top (screen angle 0). Rotating the canvas
  // clockwise by R moves a wedge originally at `wedgeAngle` (from up,
  // clockwise) to (wedgeAngle + R) in screen space -- for that wedge to land
  // under the pointer, R must be -wedgeAngle mod 360, NOT wedgeAngle itself.
  const targetAngleDeg = ((360 - wedgeAngle) % 360 + 360) % 360;
  const currentMod = ((currentRotationDeg % 360) + 360) % 360;
  const delta = ((targetAngleDeg - currentMod) % 360 + 360) % 360;
  const newRotation = currentRotationDeg + FULL_TURNS * 360 + delta;

  animating = true;
  document.getElementById("spin-btn").disabled = true;
  const durationSec = state.animation_seconds || 4;
  wheelCanvas.style.transitionDuration = durationSec + "s";
  wheelCanvas.style.transform = `rotate(${newRotation}deg)`;
  currentRotationDeg = newRotation;

  const onEnd = () => {
    wheelCanvas.removeEventListener("transitionend", onEnd);
    animating = false;
    document.getElementById("spin-btn").disabled = false;
    showWinnerBanner(state);
    if (latestState && rosterChanged(latestState.players)) {
      drawWheel(latestState.players);
    }
  };
  wheelCanvas.addEventListener("transitionend", onEnd);
}
