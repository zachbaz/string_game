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

let currentLaneSignature = [];
let raceAnimationId = null;
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

  if (!animating && laneDataChanged(state.players)) {
    drawLanes(state.players);
  }

  if (state.last_winner_id && state.last_winner_id !== lastKnownWinnerId) {
    lastKnownWinnerId = state.last_winner_id;
    animateRace(state);
  }
}

// Compares id AND chosen animal, not just id order -- a player picking a new
// animal doesn't change the roster, but the lane still needs to be redrawn
// with their new icon so choices actually sync to everyone's screen.
function laneDataChanged(players) {
  const sig = players.map((p) => `${p.id}:${p.animal}`);
  return sig.length !== currentLaneSignature.length || sig.some((s, i) => s !== currentLaneSignature[i]);
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
  currentLaneSignature = players.map((p) => `${p.id}:${p.animal}`);
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

const FINISH_X = 92; // left% that counts as "crossing the line"

// Deterministic PRNG (mulberry32) seeded from state.race_seed, which the
// server broadcasts identically to every client for a given race. Each
// client animates the race independently client-side, so without a shared
// seed every screen would roll its own "false favorite" and waypoints and
// show a visibly different race for the same draw, even though they'd all
// agree on the winner.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Each profile is a list of {t, x} waypoints (t: 0..1 fraction of race
// duration, x: left% position), always starting at {0,0}. Position between
// waypoints is eased, so a big x jump over a small t gap reads as a burst of
// speed, and a small x change over a big t gap reads as a stall/slowdown.
function winnerProfile(rng, target) {
  return [
    { t: 0, x: 0 },
    { t: 0.3, x: rand(rng, 12, 26) },
    { t: 0.55, x: rand(rng, 24, 38) }, // hangs back mid-race
    { t: 0.8, x: rand(rng, 45, 60) },
    { t: 1, x: target }, // big closing kick to the line
  ];
}

// The "false favorite": jumps out ahead early, looking like the winner, then
// stalls hard in the final stretch and gets caught -- so it never crosses
// the line, on purpose.
function falseFavoriteProfile(rng, target) {
  return [
    { t: 0, x: 0 },
    { t: 0.25, x: rand(rng, 30, 42) },
    { t: 0.5, x: rand(rng, 58, 72) },
    { t: 0.78, x: Math.min(target * 0.94, target - 2) }, // almost there...
    { t: 1, x: target }, // ...and barely creeps the rest of the way
  ];
}

function fillerProfile(rng, target) {
  if (rng() < 0.5) {
    // small mid-race burst
    return [
      { t: 0, x: 0 },
      { t: 0.4, x: rand(rng, 0.15, 0.3) * target },
      { t: 0.55, x: rand(rng, 0.55, 0.7) * target },
      { t: 1, x: target },
    ];
  }
  // slow starter
  return [
    { t: 0, x: 0 },
    { t: 0.3, x: rand(rng, 0.05, 0.15) * target },
    { t: 0.65, x: rand(rng, 0.35, 0.5) * target },
    { t: 1, x: target },
  ];
}

function rand(rng, min, max) {
  return min + rng() * (max - min);
}

function easeInOutQuad(t) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

function positionAt(waypoints, frac) {
  for (let i = 0; i < waypoints.length - 1; i++) {
    const a = waypoints[i];
    const b = waypoints[i + 1];
    if (frac <= b.t) {
      const local = b.t === a.t ? 1 : (frac - a.t) / (b.t - a.t);
      return a.x + (b.x - a.x) * easeInOutQuad(local);
    }
  }
  return waypoints[waypoints.length - 1].x;
}

function buildRaceProfiles(players, winnerId, seed) {
  const rng = mulberry32(seed);
  const nonWinners = players.filter((p) => p.id !== winnerId);
  const falseFavoriteId = nonWinners.length
    ? nonWinners[Math.floor(rng() * nonWinners.length)].id
    : null;

  const profiles = {};
  players.forEach((p) => {
    if (p.id === winnerId) {
      profiles[p.id] = winnerProfile(rng, FINISH_X);
    } else if (p.id === falseFavoriteId) {
      profiles[p.id] = falseFavoriteProfile(rng, rand(rng, 70, 88));
    } else {
      profiles[p.id] = fillerProfile(rng, rand(rng, 35, 78));
    }
  });
  return profiles;
}

function animateRace(state) {
  const durationMs = (state.race_seconds || 30) * 1000;
  document.getElementById("winner-banner").textContent = "";

  if (raceAnimationId !== null) cancelAnimationFrame(raceAnimationId);
  animating = true;
  document.getElementById("race-btn").disabled = true;

  const profiles = buildRaceProfiles(state.players, state.last_winner_id, state.race_seed || 0);
  const racerEls = {};
  state.players.forEach((p) => {
    const el = document.querySelector(`.lane[data-player-id="${p.id}"] .racer`);
    if (!el) return;
    el.style.left = "0%";
    racerEls[p.id] = el;
  });

  const startTime = performance.now();
  const tick = (now) => {
    const frac = Math.min((now - startTime) / durationMs, 1);
    state.players.forEach((p) => {
      const el = racerEls[p.id];
      if (!el) return;
      el.style.left = positionAt(profiles[p.id], frac) + "%";
    });
    if (frac < 1) {
      raceAnimationId = requestAnimationFrame(tick);
    } else {
      raceAnimationId = null;
      animating = false;
      document.getElementById("race-btn").disabled = false;
      showWinnerBanner(state);
      if (latestState && laneDataChanged(latestState.players)) {
        drawLanes(latestState.players);
      }
    }
  };
  raceAnimationId = requestAnimationFrame(tick);
}
