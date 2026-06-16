"use strict";

// 12 visually distinct colours, one per player slot.
const PALETTE = [
  "#ef4444", "#f97316", "#eab308", "#22c55e",
  "#14b8a6", "#06b6d4", "#3b82f6", "#6366f1",
  "#a855f7", "#ec4899", "#f43f5e", "#84cc16",
];

const ALIASES = {
  "korea republic": "south korea",
  "korea, republic of": "south korea",
  "usa": "united states",
  "united states of america": "united states",
  "czechia": "czech republic",
  "côte d'ivoire": "ivory coast",
  "cote d'ivoire": "ivory coast",
  "türkiye": "turkey",
  "turkiye": "turkey",
  "cabo verde": "cape verde",
  "cape verde islands": "cape verde",
  "congo dr": "dr congo",
  "ir iran": "iran",
  "bosnia & herzegovina": "bosnia and herzegovina",
  "dr congo": "dr congo",
  "bosnia-herzegovina": "bosnia and herzegovina",
};

const STAGE_ORDER = ["LAST_32", "ROUND_OF_32", "LAST_16", "ROUND_OF_16", "QUARTER_FINALS", "SEMI_FINALS", "THIRD_PLACE", "FINAL"];

const ESPN_SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=20260611-20260719";

const state = {
  groups: {},
  assignments: {},
  matches: [],
  odds: {},
  scorers: [],
  facts: {},
  updated: null,
  ownerOf: {},
  colorOf: {},
  rosterByCanon: {},
  activePlayer: null,
};

(function initThemeSwitch() {
  const sw = document.getElementById("theme-switch");
  if (!sw) return;
  const current = document.documentElement.dataset.theme || "slate";
  const mark = (t) => sw.querySelectorAll("button").forEach((b) => b.classList.toggle("is-active", b.dataset.theme === t));
  mark(current);
  sw.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-theme]");
    if (!btn) return;
    const t = btn.dataset.theme;
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem("wc-theme", t); } catch (_) {}
    mark(t);
  });
})();

async function loadJSON(path) {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

const canon = (name) => {
  if (!name) return "";
  const k = name.toLowerCase().trim();
  return ALIASES[k] || k;
};
const resolveRoster = (name) => state.rosterByCanon[canon(name)] || null;
const isGroupStage = (m) => (m.stage ? /GROUP/.test(m.stage) : !!m.group);

function buildIndexes() {
  const players = Object.keys(state.assignments).filter((k) => !k.startsWith("_"));
  players.forEach((p, i) => {
    state.colorOf[p] = PALETTE[i % PALETTE.length];
    for (const team of state.assignments[p]) state.ownerOf[team] = p;
  });
  for (const [g, teams] of Object.entries(state.groups)) {
    for (const t of teams) state.rosterByCanon[canon(t.name)] = { name: t.name, flag: t.flag, group: g };
  }
  return players;
}

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

function toFraction(dec) {
  if (!(dec > 1)) return "—";
  const x = dec - 1;
  let bestN = 1, bestD = 1, bestErr = Infinity;
  for (let d = 1; d <= 20; d++) {
    const n = Math.round(x * d);
    if (n <= 0) continue;
    const err = Math.abs(x - n / d);
    if (err < bestErr - 1e-9) { bestErr = err; bestN = n; bestD = d; }
  }
  const gcd = (a, b) => { while (b) { [a, b] = [b, a % b]; } return a || 1; };
  const g = gcd(bestN, bestD);
  return `${bestN / g}/${bestD / g}`;
}

function ownerChip(team) {
  const owner = state.ownerOf[team];
  if (!owner) return `<span class="owner muted">—</span>`;
  const c = state.colorOf[owner];
  return `<span class="owner" data-player="${owner}" style="background:${hexA(c, 0.18)};color:${c}">
    <span class="dot" style="background:${c}"></span>${owner}</span>`;
}

function computeStandings() {
  const tables = {};
  for (const [g, teams] of Object.entries(state.groups)) {
    tables[g] = {};
    for (const t of teams) tables[g][t.name] = { name: t.name, flag: t.flag, P: 0, W: 0, D: 0, L: 0, GF: 0, GA: 0, Pts: 0 };
  }
  for (const m of state.matches) {
    if (!isGroupStage(m) || m.homeScore == null || m.awayScore == null) continue;
    const h = resolveRoster(m.home), a = resolveRoster(m.away);
    if (!h || !a || h.group !== a.group) continue;
    const t = tables[h.group];
    if (!t || !t[h.name] || !t[a.name]) continue;
    const H = t[h.name], A = t[a.name];
    H.P++; A.P++;
    H.GF += m.homeScore; H.GA += m.awayScore;
    A.GF += m.awayScore; A.GA += m.homeScore;
    if (m.homeScore > m.awayScore) { H.W++; A.L++; H.Pts += 3; }
    else if (m.homeScore < m.awayScore) { A.W++; H.L++; A.Pts += 3; }
    else { H.D++; A.D++; H.Pts++; A.Pts++; }
  }
  const sorted = {};
  for (const [g, st] of Object.entries(tables)) {
    sorted[g] = Object.values(st).sort((x, y) =>
      y.Pts - x.Pts || (y.GF - y.GA) - (x.GF - x.GA) || y.GF - x.GF || x.name.localeCompare(y.name));
  }
  return sorted;
}

function aliveSet(standings) {
  const alive = new Set();
  for (const arr of Object.values(standings)) for (const t of arr) alive.add(t.name);
  const ko = state.matches.filter((m) => !isGroupStage(m));
  const koTeams = new Set();
  for (const m of ko) {
    const h = resolveRoster(m.home), a = resolveRoster(m.away);
    if (h) koTeams.add(h.name);
    if (a) koTeams.add(a.name);
  }
  const koExists = ko.length > 0;
  for (const arr of Object.values(standings)) {
    if (!arr.every((t) => t.P >= 3)) continue;
    arr.forEach((t, i) => {
      const pos = i + 1;
      if (pos === 4) alive.delete(t.name);
      else if (pos === 3 && koExists && !koTeams.has(t.name)) alive.delete(t.name);
    });
  }
  for (const m of ko) {
    if (m.status !== "FINISHED") continue;
    const h = resolveRoster(m.home), a = resolveRoster(m.away);
    if (!h || !a) continue;
    let loser = null;
    if (m.winner === "HOME_TEAM") loser = a;
    else if (m.winner === "AWAY_TEAM") loser = h;
    else if (m.homeScore > m.awayScore) loser = a;
    else if (m.awayScore > m.homeScore) loser = h;
    if (loser) alive.delete(loser.name);
  }
  return alive;
}

function fmtDate(iso) {
  if (!iso) return "TBD";
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function matchContext(m) {
  if (isGroupStage(m)) {
    const g = m.group || resolveRoster(m.home)?.group || resolveRoster(m.away)?.group;
    return g ? `Group ${g}` : "Group stage";
  }
  return prettyStage(m.stage);
}

function matchCard(m) {
  const h = resolveRoster(m.home), a = resolveRoster(m.away);
  const hn = h ? h.name : (m.home || "TBD"), an = a ? a.name : (m.away || "TBD");
  const live = m.status === "IN_PLAY" || m.status === "PAUSED";
  const played = m.homeScore != null && m.awayScore != null;
  const time = m.utcDate
    ? new Date(m.utcDate).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
    : "TBD";
  const right = live ? `<span class="nm-live">● ${m.liveClock || "Live"}</span>` : (played ? "FT" : time);
  const middle = played
    ? `<span class="nm-score ${live ? "live" : ""}">${m.homeScore}–${m.awayScore}</span>`
    : `<span class="nm-vs">v</span>`;
  const o = m.odds;
  const oddsHtml = o && typeof o.home === "number"
    ? `<div class="nm-odds"><span class="odd"><b>1</b> ${toFraction(o.home)}</span><span class="odd"><b>X</b> ${toFraction(o.draw)}</span><span class="odd"><b>2</b> ${toFraction(o.away)}</span></div>`
    : "";
  const goal = (g) => `<span class="ng">⚽ ${g.name} ${g.minute}${g.pen ? " (P)" : ""}${g.og ? " (OG)" : ""}</span>`;
  const goals = m.goals || [];
  const goalsHtml = goals.length ? `<div class="nm-goals"><div class="ng-side ng-home">${goals.filter((g) => g.side === "home").map(goal).join("")}</div><div class="ng-side ng-away">${goals.filter((g) => g.side === "away").map(goal).join("")}</div></div>` : "";
  return `
    <div class="nmx" data-team="${hn}" data-team2="${an}" data-player="${state.ownerOf[hn] || ""}">
      <div class="nm-head"><span class="nm-ctx">${matchContext(m)}</span><span>${right}</span></div>
      <div class="nm-teams">
        <div class="nm-team"><span class="nm-flag">${h ? h.flag : "🏳️"}</span><span class="nm-name">${hn}</span>${ownerChip(hn)}</div>
        ${middle}
        <div class="nm-team away"><span class="nm-flag">${a ? a.flag : "🏳️"}</span><span class="nm-name">${an}</span>${ownerChip(an)}</div>
      </div>
      ${goalsHtml}${oddsHtml}
    </div>`;
}

function fixtureRow(m) {
  const h = resolveRoster(m.home), a = resolveRoster(m.away);
  const hf = h ? h.flag : "🏳️", af = a ? a.flag : "🏳️";
  const hn = h ? h.name : (m.home || "TBD"), an = a ? a.name : (m.away || "TBD");
  const played = m.homeScore != null && m.awayScore != null;
  const live = m.status === "IN_PLAY" || m.status === "PAUSED";
  const score = played
    ? `<span class="score ${live ? "live" : ""}">${m.homeScore}–${m.awayScore}</span>`
    : `<span class="kickoff">${fmtDate(m.utcDate)}</span>`;
  return `
    <div class="fixture" data-team="${hn}" data-team2="${an}" data-player="${state.ownerOf[hn] || ""}">
      ${live ? '<span class="livedot" title="Live"></span>' : ""}
      <span class="side home"><span class="fx-flag">${hf}</span>${hn}</span>
      ${score}
      <span class="side away">${an}<span class="fx-flag">${af}</span></span>
    </div>`;
}

function renderGroups(standings) {
  const el = document.getElementById("view-groups");
  el.innerHTML = `<p class="view-caption">Group tables — as it stands</p><div class="grid">${
    Object.entries(standings).map(([g, table]) => {
      const fixtures = state.matches
        .filter((m) => isGroupStage(m) && (resolveRoster(m.home)?.group === g || resolveRoster(m.away)?.group === g))
        .sort((a, b) => (a.utcDate || "").localeCompare(b.utcDate || ""));
      return `
      <div class="card">
        <div class="card-head"><h2>Group ${g}</h2><span class="sub">P · GD · Pts</span></div>
        <table class="standings"><tbody>
        ${table.map((t, i) => `
          <tr class="srow pos-${i + 1}" data-team="${t.name}" data-player="${state.ownerOf[t.name] || ""}">
            <td class="pos">${i + 1}</td>
            <td class="teamcell"><span class="flag">${t.flag}</span><span class="team">${t.name}</span>${ownerChip(t.name)}</td>
            <td class="num">${t.P}</td>
            <td class="num">${(t.GF - t.GA) > 0 ? "+" : ""}${t.GF - t.GA}</td>
            <td class="num pts">${t.Pts}</td>
          </tr>`).join("")}
        </tbody></table>
        ${fixtures.length ? `<div class="fixtures">${fixtures.map(fixtureRow).join("")}</div>` : ""}
      </div>`;
    }).join("")
  }</div>`;
}

function prettyStage(s) {
  return (s || "").replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

function renderFixtures() {
  const el = document.getElementById("view-fixtures");
  if (!state.matches.length) { el.innerHTML = `<p class="empty">Fixtures will appear here once the schedule is published.</p>`; return; }
  const sorted = [...state.matches].sort((a, b) => (a.utcDate || "").localeCompare(b.utcDate || ""));
  const days = new Map();
  for (const m of sorted) {
    const key = m.utcDate ? new Date(m.utcDate).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) : "Date TBD";
    (days.get(key) || days.set(key, []).get(key)).push(m);
  }
  el.innerHTML = [...days].map(([day, ms]) => `<div class="fx-day"><h3 class="fx-date">${day}</h3><div class="nmx-list">${ms.map(matchCard).join("")}</div></div>`).join("");
}

function computeConceded() {
  const ga = {}, played = {};
  for (const teams of Object.values(state.groups)) for (const t of teams) { ga[t.name] = 0; played[t.name] = 0; }
  for (const m of state.matches) {
    if (m.homeScore == null || m.awayScore == null) continue;
    const h = resolveRoster(m.home), a = resolveRoster(m.away);
    if (h) { ga[h.name] += m.awayScore; played[h.name]++; }
    if (a) { ga[a.name] += m.homeScore; played[a.name]++; }
  }
  return { ga, played };
}

function renderShittest() {
  const el = document.getElementById("view-shittest");
  const flagOf = {};
  for (const teams of Object.values(state.groups)) for (const t of teams) flagOf[t.name] = t.flag;
  const { ga, played } = computeConceded();
  const rows = Object.keys(ga).map((name) => ({ name, ga: ga[name], played: played[name] }))
    .sort((x, y) => y.ga - x.ga || y.played - x.played || x.name.localeCompare(y.name));
  el.innerHTML = `
    <p class="shittest-note">Every team ranked by goals conceded — the leakiest defence sits top.</p>
    <div class="table-scroll"><table class="scorers">
      <thead><tr><th class="pos">#</th><th>Team</th><th class="c">Conceded</th><th class="c">Pld</th><th>Owner</th></tr></thead>
      <tbody>${rows.map((r, i) => {
        const owner = state.ownerOf[r.name];
        return `<tr class="scorer-row" data-team="${r.name}" data-player="${owner || ""}">
          <td class="pos">${i + 1}</td>
          <td class="ct"><span class="flag">${flagOf[r.name] || "🏳️"}</span><span class="ctn">${r.name}</span></td>
          <td class="c g">${r.ga}</td><td class="c">${r.played}</td>
          <td>${owner ? ownerChip(r.name) : '<span class="owner muted">—</span>'}</td>
        </tr>`;
      }).join("")}</tbody>
    </table></div>`;
}

function renderKnockout() {
  const el = document.getElementById("view-knockout");
  const ko = state.matches.filter((m) => !isGroupStage(m));
  if (!ko.length) { el.innerHTML = `<p class="empty">The knockout stage hasn't started yet.</p>`; return; }
  const byStage = {};
  for (const m of ko) (byStage[m.stage] ||= []).push(m);
  const stages = Object.keys(byStage).sort((a, b) => {
    const ia = STAGE_ORDER.indexOf(a), ib = STAGE_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  el.innerHTML = `<div class="bracket">${stages.map((s) => `
    <div class="stage"><h2>${prettyStage(s)}</h2>
    <div class="stage-matches">${byStage[s].sort((a, b) => (a.utcDate || "").localeCompare(b.utcDate || "")).map(fixtureRow).join("")}</div>
    </div>`).join("")}</div>`;
}

function computeWinProb() {
  const raw = {}; let total = 0;
  for (const [t, o] of Object.entries(state.odds)) {
    if (t.startsWith("_") || !(o > 0)) continue;
    const r = resolveRoster(t);
    if (!r) continue;
    raw[r.name] = 1 / o; total += raw[r.name];
  }
  const prob = {};
  if (total) for (const t in raw) prob[t] = raw[t] / total;
  return { prob, hasOdds: total > 0 };
}

function renderPlayers(standings) {
  const el = document.getElementById("view-players");
  const alive = aliveSet(standings);
  const players = Object.keys(state.assignments).filter((k) => !k.startsWith("_"));
  const teamStat = {};
  for (const arr of Object.values(standings)) for (const t of arr) teamStat[t.name] = t;
  const groupOf = {}, flagOf = {};
  for (const [g, teams] of Object.entries(state.groups)) for (const t of teams) { groupOf[t.name] = g; flagOf[t.name] = t.flag; }
  const { prob, hasOdds } = computeWinProb();
  const rows = players.map((p) => {
    const teams = state.assignments[p];
    const pts = teams.reduce((s, t) => s + (teamStat[t]?.Pts || 0), 0);
    const gf = teams.reduce((s, t) => s + (teamStat[t]?.GF || 0), 0);
    const ga = teams.reduce((s, t) => s + (teamStat[t]?.GA || 0), 0);
    const aliveCount = teams.filter((t) => alive.has(t)).length;
    const win = teams.reduce((s, t) => s + (prob[t] || 0), 0);
    return { p, teams, pts, gf, ga, aliveCount, win };
  }).sort((x, y) => hasOdds ? (y.win - x.win) || (y.pts - x.pts) : (y.pts - x.pts) || (y.gf - y.ga) - (x.gf - x.ga) || (y.aliveCount - x.aliveCount));
  const maxWin = Math.max(...rows.map((r) => r.win), 0.0001);
  el.innerHTML = `<div class="grid players">${rows.map((r, i) => {
    const c = state.colorOf[r.p];
    const sub = hasOdds ? `<b>${(r.win * 100).toFixed(1)}%</b> to win · ${r.pts} pts · ${r.aliveCount}/1 alive` : `${r.pts} pts · ${r.aliveCount}/1 alive`;
    return `<div class="card" data-player="${r.p}">
      <div class="card-head" style="border-left:4px solid ${c}">
        <h2><span class="rank">${i + 1}</span> ${r.p}</h2><span class="sub">${sub}</span>
      </div>
      ${hasOdds ? `<div class="obar pcard-bar"><span style="width:${(r.win / maxWin * 100).toFixed(1)}%;background:${c}"></span></div>` : ""}
      <div class="player-teams">${r.teams.map((name) => {
        const out = !alive.has(name);
        const tw = hasOdds ? `<span class="twin">${((prob[name] || 0) * 100).toFixed(1)}%</span>` : "";
        return `<div class="row ${out ? "out" : ""}" data-team="${name}" data-player="${r.p}">
          <span class="flag">${flagOf[name] || "🏳️"}</span><span class="team">${name}</span>
          <span class="grp">${groupOf[name] || "?"}</span>${tw}<span class="tpts">${teamStat[name]?.Pts ?? 0}p</span>
        </div>`;
      }).join("")}</div>
    </div>`;
  }).join("")}</div>`;
}

function renderScorers() {
  const el = document.getElementById("view-scorers");
  const list = state.scorers || [];
  if (!list.length) { el.innerHTML = `<p class="empty">Top scorers will appear here once goals start going in.</p>`; return; }
  el.innerHTML = `<div class="table-scroll"><table class="scorers">
    <thead><tr><th class="pos">#</th><th>Player</th><th>Country</th><th class="c">Goals</th><th>Owner</th></tr></thead>
    <tbody>${list.map((s, i) => {
      const r = resolveRoster(s.team);
      const country = r ? r.name : (s.team || "—");
      const flag = r ? r.flag : "🏳️";
      const owner = r ? state.ownerOf[r.name] : null;
      return `<tr class="scorer-row" data-team="${country}" data-player="${owner || ""}">
        <td class="pos">${i + 1}</td><td class="pl">${s.player}</td>
        <td class="ct"><span class="flag">${flag}</span><span class="ctn">${country}</span></td>
        <td class="c g">${s.goals}</td>
        <td>${owner ? ownerChip(r.name) : '<span class="owner muted">—</span>'}</td>
      </tr>`;
    }).join("")}</tbody>
  </table></div>`;
}

// Legend hidden — players list removed from main view
function renderLegend(players) {
  const el = document.getElementById("legend");
  if (el) el.innerHTML = "";
}

function renderStatus() {
  const el = document.getElementById("status");
  const played = state.matches.some((m) => m.homeScore != null);
  if (!played) {
    el.textContent = "No results yet — group standings will fill in as matches are played.";
  } else {
    el.textContent = state.updated ? `Scores last updated ${new Date(state.updated).toLocaleString()}.` : "Showing latest committed results.";
  }
}

function applyHighlight() {
  const player = state.activePlayer;
  document.querySelectorAll(".legend .chip").forEach((chip) => {
    chip.classList.toggle("is-dim", !!player && chip.dataset.player !== player);
    chip.classList.toggle("is-on", !!player && chip.dataset.player === player);
  });
  const rowMatches = (el) => !player || el.dataset.player === player || (el.dataset.team2 && state.ownerOf[el.dataset.team2] === player);
  document.querySelectorAll(".srow, .row, .fixture, .scorer-row, .nmx").forEach((el) => {
    el.classList.toggle("is-dim", !rowMatches(el));
  });
  document.querySelectorAll("#view-fixtures .nmx").forEach((c) => {
    c.classList.toggle("is-hidden", !!player && c.classList.contains("is-dim"));
  });
  document.querySelectorAll("#view-groups .card, #view-knockout .stage, #view-players .card").forEach((c) => {
    if (!player) { c.classList.remove("is-hidden"); return; }
    const rows = c.querySelectorAll(".srow, .row, .fixture");
    const anyShown = [...rows].some((r) => !r.classList.contains("is-dim"));
    c.classList.toggle("is-hidden", rows.length > 0 && !anyShown);
  });
  document.querySelectorAll("#view-fixtures .fx-day").forEach((c) => {
    if (!player) { c.classList.remove("is-hidden"); return; }
    const cards = c.querySelectorAll(".nmx");
    const anyShown = [...cards].some((x) => !x.classList.contains("is-dim"));
    c.classList.toggle("is-hidden", cards.length > 0 && !anyShown);
  });
  const note = document.getElementById("filter-note");
  if (note) {
    note.innerHTML = player ? `Showing <b>${player}</b>'s teams <button class="filter-clear" type="button">clear ✕</button>` : "";
  }
}

const ALL_VIEWS = ["groups", "knockout", "fixtures", "scorers", "players", "shittest", "owngoal", "redcard", "conceded", "yellowcard"];
const SIDEBET_VIEWS = ["owngoal", "redcard", "conceded", "yellowcard"];

function wireEvents() {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((t) => t.classList.remove("is-active"));
      tab.classList.add("is-active");
      const view = tab.dataset.view;
      for (const v of ALL_VIEWS) {
        const el = document.getElementById(`view-${v}`);
        if (el) el.hidden = v !== view;
      }
      // If it's a side bet tab, render it
      if (SIDEBET_VIEWS.includes(view)) {
        renderSideBet(view, document.getElementById(`view-${view}`));
      }
    });
  });

  document.body.addEventListener("click", (e) => {
    if (e.target.closest(".filter-clear")) {
      state.activePlayer = null;
      applyHighlight();
      return;
    }
    const target = e.target.closest("[data-player]");
    if (!target || !target.dataset.player) return;
    if (target.classList.contains("team") || target.classList.contains("grp")) return;
    const p = target.dataset.player;
    state.activePlayer = state.activePlayer === p ? null : p;
    applyHighlight();
  });
}

function renderAll() {
  const standings = computeStandings();
  renderFixtures();
  renderGroups(standings);
  renderKnockout();
  renderPlayers(standings);
  renderScorers();
  renderShittest();
  renderStatus();
  applyHighlight();
}

function mergeEspnScores(events) {
  const idx = new Map();
  for (const m of state.matches) {
    const h = resolveRoster(m.home), a = resolveRoster(m.away);
    if (h && a) idx.set([h.name, a.name].sort().join("|"), m);
  }
  let touched = 0;
  for (const e of events) {
    const c = e.competitions?.[0];
    const st = e.status?.type?.state;
    if (!c || st === "pre") continue;
    const eh = c.competitors?.find((x) => x.homeAway === "home");
    const ea = c.competitors?.find((x) => x.homeAway === "away");
    const rh = resolveRoster(eh?.team?.displayName || eh?.team?.name);
    const ra = resolveRoster(ea?.team?.displayName || ea?.team?.name);
    if (!rh || !ra) continue;
    const m = idx.get([rh.name, ra.name].sort().join("|"));
    if (!m) continue;
    const hs = parseInt(eh.score, 10), as = parseInt(ea.score, 10);
    if (Number.isNaN(hs) || Number.isNaN(as)) continue;
    const sameOrient = resolveRoster(m.home)?.name === rh.name;
    m.homeScore = sameOrient ? hs : as;
    m.awayScore = sameOrient ? as : hs;
    m.status = st === "in" ? "IN_PLAY" : (st === "post" ? "FINISHED" : m.status);
    m.liveClock = st === "in" ? (e.status?.displayClock || "") : null;
    if (st === "post") {
      m.winner = m.homeScore > m.awayScore ? "HOME_TEAM" : (m.awayScore > m.homeScore ? "AWAY_TEAM" : "DRAW");
    }
    const mHome = resolveRoster(m.home)?.name;
    const teamNameById = {};
    for (const x of c.competitors) teamNameById[x.team?.id] = resolveRoster(x.team?.displayName || x.team?.name)?.name;
    m.goals = (c.details || []).filter((d) => d.scoringPlay).map((d) => ({
      name: d.athletesInvolved?.[0]?.displayName || "Goal",
      minute: d.clock?.displayValue || "",
      side: teamNameById[d.team?.id] === mHome ? "home" : "away",
      pen: /penalt/i.test(d.type?.text || ""),
      og: /own goal/i.test(d.type?.text || ""),
    }));
    touched++;
  }
  return touched;
}

async function fetchLiveScores() {
  try {
    const res = await fetch(ESPN_SCOREBOARD, { cache: "no-store" });
    if (!res.ok) return;
    const data = await res.json();
    if (mergeEspnScores(data.events || [])) state.updated = new Date().toISOString();
  } catch {}
}

async function refreshLiveData() {
  try {
    const [matchData, scorerData] = await Promise.all([
      loadJSON("data/matches.json").catch(() => null),
      loadJSON("data/scorers.json").catch(() => null),
    ]);
    if (matchData) { state.matches = matchData.matches || []; state.updated = matchData.updated || null; }
    if (scorerData) state.scorers = scorerData.scorers || [];
    await fetchLiveScores();
    renderAll();
  } catch {}
}

// Side bet rendering (inline so it has access to state)
async function renderSideBet(view, el) {
  if (!el) return;
  el.innerHTML = '<p class="status">Loading…</p>';
  let data;
  try {
    const res = await fetch('data/sidebets.json?_=' + Date.now());
    data = await res.json();
  } catch (e) {
    el.innerHTML = '<p class="status">Could not load side bet data.</p>';
    return;
  }
  switch (view) {
    case 'owngoal':    renderOwnGoal(el, data.ownGoals); break;
    case 'redcard':    renderRedCard(el, data.redCards); break;
    case 'conceded':   renderMostConceded(el, data.mostConceded); break;
    case 'yellowcard': renderYellowCard(el, data.yellowCards); break;
  }
}

function sbCard(icon, title, body) {
  return `<div class="sidebet-card"><div class="sidebet-header">${icon} <span>${title}</span></div><div class="sidebet-body">${body}</div></div>`;
}
function sbNoData(label) {
  return `<p class="sidebet-pending">⏳ No ${label} recorded yet — check back soon!</p>`;
}
function sbRow(label, value) {
  return `<div class="sidebet-row"><span class="sidebet-label">${label}</span><span class="sidebet-value">${value}</span></div>`;
}

function renderOwnGoal(el, goals) {
  const valid = (goals || []).filter(g => g.minute !== null);
  if (!valid.length) { el.innerHTML = sbCard('⚽', 'Fastest Own Goal', sbNoData('own goals')); return; }
  valid.sort((a, b) => a.minute - b.minute);
  const f = valid[0];
  let html = `<p class="sidebet-intro">Fastest own goal of the tournament wins!</p><h3 class="sidebet-current-title">⚡ Current Fastest</h3>`;
  html += sbCard('⚽', `${f.player} (${f.team})`, sbRow('Minute', f.minute + "'") + sbRow('Match', f.match) + sbRow('Date', f.date));
  if (valid.length > 1) {
    html += '<h3 class="sidebet-list-title">All Own Goals</h3><div class="sidebet-list">';
    valid.forEach((g, i) => { html += `<div class="sidebet-list-item">#${i+1} — ${g.minute}' · <strong>${g.player}</strong> (${g.team}) · ${g.match}</div>`; });
    html += '</div>';
  }
  el.innerHTML = html;
}

function renderRedCard(el, cards) {
  const valid = (cards || []).filter(c => c.minute !== null);
  if (!valid.length) { el.innerHTML = sbCard('🟥', 'Fastest Red Card', sbNoData('red cards')); return; }
  valid.sort((a, b) => a.minute - b.minute);
  const f = valid[0];
  let html = `<p class="sidebet-intro">Earliest red card of the tournament wins!</p><h3 class="sidebet-current-title">⚡ Current Fastest</h3>`;
  html += sbCard('🟥', `${f.player} (${f.team})`, sbRow('Minute', f.minute + "'") + sbRow('Match', f.match) + sbRow('Date', f.date));
  if (valid.length > 1) {
    html += '<h3 class="sidebet-list-title">All Red Cards</h3><div class="sidebet-list">';
    valid.forEach((c, i) => { html += `<div class="sidebet-list-item">#${i+1} — ${c.minute}' · <strong>${c.player}</strong> (${c.team}) · ${c.match}</div>`; });
    html += '</div>';
  }
  el.innerHTML = html;
}

function renderMostConceded(el, matches) {
  const valid = (matches || []).filter(m => m.goals !== null);
  if (!valid.length) { el.innerHTML = sbCard('😬', 'Most Goals Conceded', sbNoData('high-conceding matches')); return; }
  valid.sort((a, b) => b.goals - a.goals);
  const w = valid[0];
  let html = `<p class="sidebet-intro">Which team concedes the most in a single match?</p><h3 class="sidebet-current-title">😬 Current Record</h3>`;
  html += sbCard('🥅', w.team, sbRow('Goals conceded', w.goals) + sbRow('Match', w.match) + sbRow('Date', w.date));
  if (valid.length > 1) {
    html += '<h3 class="sidebet-list-title">Leaderboard</h3><div class="sidebet-list">';
    valid.forEach((m, i) => { html += `<div class="sidebet-list-item">#${i+1} — <strong>${m.goals} conceded</strong> · ${m.team} · ${m.match}</div>`; });
    html += '</div>';
  }
  el.innerHTML = html;
}

function renderYellowCard(el, data) {
  const current = (data && data.current) || 0;
  const target = (data && data.target) || 100;
  const pct = Math.min(100, Math.round((current / target) * 100));
  const done = current >= target;
  let html = `
    <p class="sidebet-intro">Who gets booked for the tournament's 100th yellow card?</p>
    <div class="sidebet-progress-wrap">
      <div class="sidebet-progress-bar"><div class="sidebet-progress-fill ${done ? 'done' : ''}" style="width:${pct}%"></div></div>
      <div class="sidebet-progress-label">${current} / ${target} yellow cards</div>
    </div>`;
  if (done && data.leader) {
    html += `<p class="sidebet-winner">🎉 The 100th yellow card has been shown!</p>`;
    html += sbCard('🟨', `${data.leader} (${data.leaderTeam})`, sbRow('Match', data.leaderMatch || '—'));
  } else {
    html += `<p class="sidebet-intro">We're ${target - current} away — who will it be?</p>`;
  }
  el.innerHTML = html;
}

async function init() {
  try {
    const [groups, assignments, matchData, oddsData, scorerData, factData] = await Promise.all([
      loadJSON("data/groups.json"),
      loadJSON("data/assignments.json"),
      loadJSON("data/matches.json").catch(() => ({ matches: [], updated: null })),
      loadJSON("data/odds.json").catch(() => ({})),
      loadJSON("data/scorers.json").catch(() => ({ scorers: [] })),
      loadJSON("data/facts.json").catch(() => ({})),
    ]);
    state.groups = groups;
    state.assignments = assignments;
    state.matches = matchData.matches || [];
    state.updated = matchData.updated || null;
    state.odds = oddsData || {};
    state.scorers = scorerData.scorers || [];
    state.facts = factData || {};
    const players = buildIndexes();
    renderLegend(players);
    wireEvents();
    renderAll();
    fetchLiveScores().then(renderAll);
    setInterval(() => { if (!document.hidden) refreshLiveData(); }, 30000);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) refreshLiveData(); });
  } catch (err) {
    document.querySelector("main").innerHTML =
      `<p class="error">Couldn't load data (${err.message}).<br>
       If you opened this file directly, serve it instead: <code>python3 -m http.server</code> then open http://localhost:8000</p>`;
  }
}

init();
