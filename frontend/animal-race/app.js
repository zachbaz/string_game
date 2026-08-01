const lobbyScreen = document.getElementById("lobby-screen");
const gameScreen = document.getElementById("game-screen");

// Basic single-color silhouettes, all on a shared 0 0 100 60 viewBox so they
// drop into a lane at a consistent size. Kept in sync with ANIMAL_IDS in
// backend/animal_race.py -- an id on one side with no entry on the other
// either fails validation server-side or renders blank client-side.
const ANIMALS = [
  {
    id: "rabbit",
    name: "Rabbit",
    svg: `<ellipse cx="42" cy="40" rx="24" ry="13"/><circle cx="70" cy="27" r="10"/>
      <ellipse cx="65" cy="8" rx="3.5" ry="14" transform="rotate(-12 65 8)"/>
      <ellipse cx="76" cy="8" rx="3.5" ry="14" transform="rotate(10 76 8)"/>
      <circle cx="16" cy="44" r="6"/>
      <rect x="30" y="50" width="6" height="9"/><rect x="54" y="50" width="6" height="9"/>`,
  },
  {
    id: "turtle",
    name: "Turtle",
    svg: `<ellipse cx="42" cy="36" rx="28" ry="17"/><circle cx="74" cy="34" r="7"/>
      <ellipse cx="28" cy="52" rx="6" ry="4"/><ellipse cx="56" cy="52" rx="6" ry="4"/>
      <polygon points="14,38 6,34 14,44"/>`,
  },
  {
    id: "cat",
    name: "Cat",
    svg: `<ellipse cx="42" cy="40" rx="24" ry="13"/><circle cx="70" cy="27" r="10"/>
      <polygon points="63,18 67,5 72,19"/><polygon points="75,18 79,4 84,19"/>
      <path d="M18,40 C2,34 2,54 20,48 C14,46 14,42 18,40 Z"/>
      <rect x="30" y="50" width="6" height="9"/><rect x="54" y="50" width="6" height="9"/>`,
  },
  {
    id: "dog",
    name: "Dog",
    svg: `<ellipse cx="42" cy="40" rx="24" ry="13"/><circle cx="70" cy="27" r="10"/>
      <ellipse cx="76" cy="24" rx="5" ry="11" transform="rotate(15 76 24)"/>
      <path d="M18,36 C10,28 8,20 16,18 C18,26 18,32 22,38 Z"/>
      <rect x="30" y="50" width="6" height="9"/><rect x="54" y="50" width="6" height="9"/>`,
  },
  {
    id: "fox",
    name: "Fox",
    svg: `<ellipse cx="42" cy="40" rx="24" ry="13"/><circle cx="70" cy="27" r="10"/>
      <polygon points="62,17 66,2 73,19"/><polygon points="76,19 83,2 87,17"/>
      <path d="M18,42 C-2,32 -2,54 20,50 C12,48 12,44 18,42 Z"/>
      <rect x="30" y="50" width="6" height="9"/><rect x="54" y="50" width="6" height="9"/>`,
  },
  {
    id: "horse",
    name: "Horse",
    svg: `<ellipse cx="40" cy="38" rx="26" ry="13"/>
      <polygon points="58,30 76,8 86,15 66,40"/><circle cx="82" cy="12" r="8"/>
      <path d="M18,38 C4,30 2,48 16,46 Z"/>
      <rect x="28" y="48" width="6" height="11"/><rect x="52" y="48" width="6" height="11"/>`,
  },
];
const ANIMAL_BY_ID = Object.fromEntries(ANIMALS.map((a) => [a.id, a]));
const LANE_COLORS = [
  "#e6194b", "#3cb44b", "#4363d8", "#f58231", "#911eb4",
  "#46f0f0", "#f032e6", "#bcf60c", "#fabebe", "#008080",
];

let ws = null;
let playerId = sessionStorage.getItem("race_player_id") || null;
let roomCode = null;
let latestState = null;

let currentLaneOrder = [];
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
  const { code } = await api("/api/animal-race/rooms", { method: "POST" });
  joinRoom(code);
};

document.getElementById("join-room-btn").onclick = () => {
  const code = document.getElementById("join-code-input").value.trim().toUpperCase();
  if (code.length !== 4) { alert("Enter a 4-letter room code"); return; }
  joinRoom(code);
};

document.getElementById("race-btn").onclick = () => {
  if (!animating) ws.send(JSON.stringify({ type: "start_race" }));
};

function joinRoom(code) {
  roomCode = code;
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}/ws/animal-race/${code}`);
  ws.onopen = () => {
    ws.send(JSON.stringify({ type: "join", player_id: playerId }));
  };
  ws.onmessage = (evt) => {
    const msg = JSON.parse(evt.data);
    if (msg.type === "joined") {
      playerId = msg.player_id;
      sessionStorage.setItem("race_player_id", playerId);
      lobbyScreen.classList.add("hidden");
      gameScreen.classList.remove("hidden");
      document.getElementById("room-code-label").textContent = "Room: " + roomCode;
      renderAnimalPicker();
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

function renderAnimalPicker() {
  const picker = document.getElementById("animal-picker");
  picker.innerHTML = "";
  ANIMALS.forEach((a) => {
    const btn = document.createElement("button");
    btn.className = "animal-btn";
    btn.title = a.name;
    btn.innerHTML = `<svg viewBox="0 0 100 60" fill="currentColor">${a.svg}</svg>`;
    btn.onclick = () => ws.send(JSON.stringify({ type: "choose_animal", animal: a.id }));
    picker.appendChild(btn);
  });
}

function handleState(state) {
  latestState = state;
  renderPlayerList(state.players);
  updatePickerSelection(state.players);
  document.getElementById("status-label").textContent =
    state.room_state === "lobby" ? "Ready to race" : "";

  if (!hasReceivedFirstState) {
    hasReceivedFirstState = true;
    lastKnownWinnerId = state.last_winner_id;
    drawLanes(state.players);
    if (state.last_winner_id) showWinnerBanner(state);
    return;
  }

  if (!animating && rosterChanged(state.players)) {
    drawLanes(state.players);
  }

  if (state.last_winner_id && state.last_winner_id !== lastKnownWinnerId) {
    lastKnownWinnerId = state.last_winner_id;
    animateRace(state);
  }
}

function rosterChanged(players) {
  const ids = players.map((p) => p.id);
  return ids.length !== currentLaneOrder.length || ids.some((id, i) => id !== currentLaneOrder[i]);
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

function updatePickerSelection(players) {
  const me = players.find((p) => p.id === playerId);
  if (!me) return;
  document.querySelectorAll(".animal-btn").forEach((btn, i) => {
    btn.classList.toggle("selected", ANIMALS[i].id === me.animal);
  });
}

function showWinnerBanner(state) {
  const winner = state.players.find((p) => p.id === state.last_winner_id);
  const banner = document.getElementById("winner-banner");
  if (!winner) { banner.textContent = ""; return; }
  const animalName = ANIMAL_BY_ID[winner.animal] ? ANIMAL_BY_ID[winner.animal].name : "";
  banner.textContent = `🏁 ${winner.name}'s ${animalName} wins!`;
}

function drawLanes(players) {
  currentLaneOrder = players.map((p) => p.id);
  const lanes = document.getElementById("lanes");
  lanes.innerHTML = "";
  players.forEach((p, i) => {
    const lane = document.createElement("div");
    lane.className = "lane";
    lane.dataset.playerId = p.id;

    const name = document.createElement("span");
    name.className = "lane-name";
    name.textContent = p.name + (p.id === playerId ? " (you)" : "");
    lane.appendChild(name);

    const strip = document.createElement("div");
    strip.className = "lane-strip";

    const racer = document.createElement("div");
    racer.className = "racer" + (p.connected ? "" : " disconnected");
    racer.style.color = LANE_COLORS[i % LANE_COLORS.length];
    const animal = ANIMAL_BY_ID[p.animal] || ANIMALS[0];
    racer.innerHTML = `<svg viewBox="0 0 100 60" fill="currentColor">${animal.svg}</svg>`;
    strip.appendChild(racer);

    lane.appendChild(strip);
    lanes.appendChild(lane);
  });
}

function animateRace(state) {
  const durationSec = state.race_seconds || 30;
  document.getElementById("winner-banner").textContent = "";

  animating = true;
  document.getElementById("race-btn").disabled = true;

  state.players.forEach((p) => {
    const laneEl = document.querySelector(`.lane[data-player-id="${p.id}"] .racer`);
    if (!laneEl) return;
    const isWinner = p.id === state.last_winner_id;
    const target = isWinner ? 92 : 40 + Math.random() * 45; // losers never reach the finish line
    const duration = isWinner ? durationSec : durationSec * (0.6 + Math.random() * 0.35);

    laneEl.style.transitionDuration = "0s";
    laneEl.style.left = "0%";
    // Force reflow so the reset above is applied before the transitioned move starts.
    laneEl.offsetHeight;
    laneEl.style.transitionDuration = duration + "s";
    laneEl.style.left = target + "%";
  });

  setTimeout(() => {
    animating = false;
    document.getElementById("race-btn").disabled = false;
    showWinnerBanner(state);
    if (latestState && rosterChanged(latestState.players)) {
      drawLanes(latestState.players);
    }
  }, durationSec * 1000);
}
