"use strict";

// 12 visually distinct colours, one per player slot.
const PALETTE = [
  "#ef4444", "#f97316", "#eab308", "#22c55e",
  "#14b8a6", "#06b6d4", "#3b82f6", "#6366f1",
  "#a855f7", "#ec4899", "#f43f5e", "#84cc16",
];

// football-data.org and roster names don't always match — map variants to roster names.
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
  "congo dr": "dr congo",
  "dr congo": "dr congo",
  "bosnia-herzegovina": "bosnia and herzegovina",
};

const STAGE_ORDER = ["LAST_32", "ROUND_OF_32", "LAST_16", "ROUND_OF_16", "QUARTER_FINALS", "SEMI_FINALS", "THIRD_PLACE", "FINAL"];

const state = {
  groups: {},          // { A: [{name, flag}], ... }
  assignments: {},     // { "Person 1": [team, ...], ... }
  matches: [],         // normalised match objects
  updated: null,
  ownerOf: {},         // team name -> player name
  colorOf: {},         // player name -> colour
  rosterByCanon: {},   // canonical name -> { name, flag, group }
  activePlayer: null,
};

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

// hex -> rgba string with given alpha
function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

function ownerChip(team) {
  const owner = state.ownerOf[team];
  if (!owner) return `<span class="owner muted">—</span>`;
  const c = state.colorOf[owner];
  return `<span class="owner" data-player="${owner}" style="background:${hexA(c, 0.18)};color:${c}">
    <span class="dot" style="background:${c}"></span>${owner}</span>`;
}

// ---- Standings ----------------------------------------------------------
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

// Set of teams not yet eliminated (top-2 projection + knockout survival).
function aliveSet(standings) {
  const alive = new Set();
  for (const arr of Object.values(standings)) arr.slice(0, 2).forEach((t) => alive.add(t.name));
  const ko = state.matches.filter((m) => !isGroupStage(m));
  for (const m of ko) {
    const h = resolveRoster(m.home), a = resolveRoster(m.away);
    if (h) alive.add(h.name);
    if (a) alive.add(a.name);
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

// ---- Match formatting ---------------------------------------------------
function fmtDate(iso) {
  if (!iso) return "TBD";
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function fixtureRow(m) {
  const h = resolveRoster(m.home), a = resolveRoster(m.away);
  const hf = h ? h.flag : "🏳️", af = a ? a.flag : "🏳️";
  const hn = m.home || "TBD", an = m.away || "TBD";
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

// ---- Views --------------------------------------------------------------
function renderGroups(standings) {
  const el = document.getElementById("view-groups");
  el.innerHTML = `<div class="grid">${
    Object.entries(standings).map(([g, table]) => {
      const fixtures = state.matches
        .filter((m) => isGroupStage(m) && (resolveRoster(m.home)?.group === g || resolveRoster(m.away)?.group === g))
        .sort((a, b) => (a.utcDate || "").localeCompare(b.utcDate || ""));
      return `
      <div class="card">
        <div class="card-head"><h2>Group ${g}</h2><span class="sub">P · GD · Pts</span></div>
        <table class="standings">
          <tbody>
          ${table.map((t, i) => `
            <tr class="srow pos-${i + 1}" data-team="${t.name}" data-player="${state.ownerOf[t.name] || ""}">
              <td class="pos">${i + 1}</td>
              <td class="teamcell">
                <span class="flag">${t.flag}</span>
                <span class="team">${t.name}</span>
                ${ownerChip(t.name)}
              </td>
              <td class="num">${t.P}</td>
              <td class="num">${(t.GF - t.GA) > 0 ? "+" : ""}${t.GF - t.GA}</td>
              <td class="num pts">${t.Pts}</td>
            </tr>`).join("")}
          </tbody>
        </table>
        ${fixtures.length ? `<div class="fixtures">${fixtures.map(fixtureRow).join("")}</div>` : ""}
      </div>`;
    }).join("")
  }</div>`;
}

function prettyStage(s) {
  return (s || "").replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

function renderKnockout() {
  const el = document.getElementById("view-knockout");
  const ko = state.matches.filter((m) => !isGroupStage(m));
  if (!ko.length) {
    el.innerHTML = `<p class="empty">The knockout stage hasn't started yet. Fixtures appear here once the groups are decided.</p>`;
    return;
  }
  const byStage = {};
  for (const m of ko) (byStage[m.stage] ||= []).push(m);
  const stages = Object.keys(byStage).sort((a, b) => {
    const ia = STAGE_ORDER.indexOf(a), ib = STAGE_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  el.innerHTML = `<div class="bracket">${
    stages.map((s) => `
      <div class="stage">
        <h2>${prettyStage(s)}</h2>
        <div class="stage-matches">${
          byStage[s].sort((a, b) => (a.utcDate || "").localeCompare(b.utcDate || "")).map(fixtureRow).join("")
        }</div>
      </div>`).join("")
  }</div>`;
}

function renderPlayers(standings) {
  const el = document.getElementById("view-players");
  const alive = aliveSet(standings);
  const players = Object.keys(state.assignments).filter((k) => !k.startsWith("_"));

  // points / goals per team from the group tables
  const teamStat = {};
  for (const arr of Object.values(standings)) for (const t of arr) teamStat[t.name] = t;
  const groupOf = {}, flagOf = {};
  for (const [g, teams] of Object.entries(state.groups)) for (const t of teams) { groupOf[t.name] = g; flagOf[t.name] = t.flag; }

  const rows = players.map((p) => {
    const teams = state.assignments[p];
    const pts = teams.reduce((s, t) => s + (teamStat[t]?.Pts || 0), 0);
    const gf = teams.reduce((s, t) => s + (teamStat[t]?.GF || 0), 0);
    const ga = teams.reduce((s, t) => s + (teamStat[t]?.GA || 0), 0);
    const aliveCount = teams.filter((t) => alive.has(t)).length;
    return { p, teams, pts, gf, ga, aliveCount };
  }).sort((x, y) => y.pts - x.pts || (y.gf - y.ga) - (x.gf - x.ga) || y.aliveCount - x.aliveCount);

  el.innerHTML = `<div class="grid players">${
    rows.map((r, i) => {
      const c = state.colorOf[r.p];
      return `
      <div class="card" data-player="${r.p}">
        <div class="card-head" style="border-left:4px solid ${c}">
          <h2><span class="rank">${i + 1}</span> ${r.p}</h2>
          <span class="sub">${r.pts} pts · ${r.aliveCount}/4 alive</span>
        </div>
        <div class="player-teams">${
          r.teams.map((name) => {
            const out = !alive.has(name);
            return `
            <div class="row ${out ? "out" : ""}" data-team="${name}" data-player="${r.p}">
              <span class="flag">${flagOf[name] || "🏳️"}</span>
              <span class="team">${name}</span>
              <span class="grp">${groupOf[name] || "?"}</span>
              <span class="tpts">${teamStat[name]?.Pts ?? 0}p</span>
            </div>`;
          }).join("")
        }</div>
      </div>`;
    }).join("")
  }</div>`;
}

function renderLegend(players) {
  document.getElementById("legend").innerHTML = players.map((p) => {
    const c = state.colorOf[p];
    return `<button class="chip" data-player="${p}"><span class="dot" style="background:${c}"></span>${p}</button>`;
  }).join("");
}

function renderStatus() {
  const el = document.getElementById("status");
  const played = state.matches.some((m) => m.homeScore != null);
  if (!played) {
    el.textContent = "No results yet — group standings will fill in as matches are played.";
  } else {
    el.textContent = state.updated
      ? `Scores last updated ${new Date(state.updated).toLocaleString()}.`
      : "Showing latest committed results.";
  }
}

// ---- Interaction --------------------------------------------------------
function applyHighlight() {
  const player = state.activePlayer;
  const term = document.getElementById("search").value.trim().toLowerCase();

  document.querySelectorAll(".legend .chip").forEach((chip) => {
    chip.classList.toggle("is-dim", !!player && chip.dataset.player !== player);
  });

  const matchRow = (el) => {
    const t1 = (el.dataset.team || "").toLowerCase();
    const t2 = (el.dataset.team2 || "").toLowerCase();
    const owner = (el.dataset.player || "").toLowerCase();
    const matchesPlayer = !player || el.dataset.player === player ||
      (el.dataset.team2 && state.ownerOf[el.dataset.team2] === player);
    const matchesTerm = !term || t1.includes(term) || t2.includes(term) || owner.includes(term);
    return { show: matchesPlayer && matchesTerm, hit: !!term && (t1.includes(term) || t2.includes(term) || owner.includes(term)) };
  };

  document.querySelectorAll(".srow, .row, .fixture").forEach((el) => {
    const { show, hit } = matchRow(el);
    el.classList.toggle("is-dim", !show);
    el.classList.toggle("is-hit", hit && show);
  });
}

function wireEvents() {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((t) => t.classList.remove("is-active"));
      tab.classList.add("is-active");
      const view = tab.dataset.view;
      for (const v of ["groups", "knockout", "players"]) {
        document.getElementById(`view-${v}`).hidden = v !== view;
      }
    });
  });

  document.getElementById("search").addEventListener("input", applyHighlight);

  document.body.addEventListener("click", (e) => {
    const target = e.target.closest("[data-player]");
    if (!target || !target.dataset.player) return;
    if (target.classList.contains("team") || target.classList.contains("grp")) return;
    const p = target.dataset.player;
    state.activePlayer = state.activePlayer === p ? null : p;
    applyHighlight();
  });
}

async function init() {
  try {
    const [groups, assignments, matchData] = await Promise.all([
      loadJSON("data/groups.json"),
      loadJSON("data/assignments.json"),
      loadJSON("data/matches.json").catch(() => ({ matches: [], updated: null })),
    ]);
    state.groups = groups;
    state.assignments = assignments;
    state.matches = matchData.matches || [];
    state.updated = matchData.updated || null;

    const players = buildIndexes();
    const standings = computeStandings();
    renderGroups(standings);
    renderKnockout();
    renderPlayers(standings);
    renderLegend(players);
    renderStatus();
    wireEvents();
  } catch (err) {
    document.querySelector("main").innerHTML =
      `<p class="error">Couldn't load data (${err.message}).<br>
       If you opened this file directly, serve it instead: <code>python3 -m http.server</code> then open http://localhost:8000</p>`;
  }
}

init();
