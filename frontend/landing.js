async function loadAccountBar() {
  const res = await fetch("/api/me");
  const me = await res.json();
  const bar = document.getElementById("account-bar");
  bar.innerHTML = "";

  if (me.logged_in) {
    const span = document.createElement("span");
    span.textContent = "Logged in as " + me.username + " — ";
    const logoutBtn = document.createElement("button");
    logoutBtn.textContent = "Log out";
    logoutBtn.onclick = async () => {
      await fetch("/logout", { method: "POST" });
      location.reload();
    };
    bar.appendChild(span);
    bar.appendChild(logoutBtn);
  } else {
    const loginLink = document.createElement("a");
    loginLink.href = "/login";
    loginLink.textContent = "Log in";
    const signupLink = document.createElement("a");
    signupLink.href = "/signup";
    signupLink.textContent = "Sign up";
    bar.appendChild(loginLink);
    bar.append(" or ");
    bar.appendChild(signupLink);
  }
}

async function loadLeaderboard() {
  const res = await fetch("/api/leaderboard");
  const rows = await res.json();
  const list = document.getElementById("leaderboard-list");
  list.innerHTML = "";
  if (rows.length === 0) {
    const li = document.createElement("li");
    li.textContent = "No scores yet — be the first!";
    list.appendChild(li);
    return;
  }
  rows.forEach((row) => {
    const li = document.createElement("li");
    li.textContent = `${row.username} — ${row.total_score} pts`;
    list.appendChild(li);
  });
}

loadAccountBar();
loadLeaderboard();
