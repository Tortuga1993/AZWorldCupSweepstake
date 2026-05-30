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
  "cape verde islands": "cape verde",
  "congo dr": "dr congo",
  "dr congo": "dr congo",
  "bosnia-herzegovina": "bosnia and herzegovina",
};

const STAGE_ORDER = ["LAST_32", "ROUND_OF_32", "LAST_16", "ROUND_OF_16", "QUARTER_FINALS", "SEMI_FINALS", "THIRD_PLACE", "FINAL"];

const state = {
  groups: {},          // { A: [{name, flag}], ... }
  assignments: {},     // { "Person 1": [team, ...], ... }
  matches: [],         // normalised match objects
  odds: {},            // { team: decimalOdds }
  scorers: [],         // [{ player, team, goals, assists }]
  facts: {},           // { country: [fact, ...] }
  updated: null,
  ownerOf: {},         // team name -> player name
  colorOf: {},         // player name -> colour
  rosterByCanon: {},   // canonical name -> { name, flag, group }
  activePlayer: null,
};

// Theme switcher — applies immediately, independent of the data load.
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
    try { localStorage.setItem("wc-theme", t); } catch (_) { /* ignore */ }
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

// hex -> rgba string with given alpha
function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

// Decimal odds -> tidy fractional odds, e.g. 1.5 -> "1/2", 7 -> "6/1", 2.75 -> "7/4".
// Uses a best rational approximation with a small denominator (bookmaker style).
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

// Set of teams not yet eliminated. Teams stay alive until they are *genuinely*
// out — we never project eliminations from an unfinished (e.g. all-0-0) table.
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

  // Group eliminations only once every team in the group has played all 3 games.
  for (const arr of Object.values(standings)) {
    if (!arr.every((t) => t.P >= 3)) continue;
    arr.forEach((t, i) => {
      const pos = i + 1;
      if (pos === 4) alive.delete(t.name);                                   // 4th can never advance
      else if (pos === 3 && koExists && !koTeams.has(t.name)) alive.delete(t.name); // 3rd that missed the cut
    });
  }

  // Knockout losers are out.
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

function fmtDateFull(iso) {
  if (!iso) return "Date TBD";
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function matchContext(m) {
  if (isGroupStage(m)) {
    const g = m.group || resolveRoster(m.home)?.group || resolveRoster(m.away)?.group;
    return g ? `Group ${g}` : "Group stage";
  }
  return prettyStage(m.stage);
}

// A random obscure fact for a country (from data/facts.json), or null.
function randFact(name) {
  const arr = state.facts[name];
  return Array.isArray(arr) && arr.length ? arr[Math.floor(Math.random() * arr.length)] : null;
}

// One card per upcoming game on the next fixture day.
function nextMatchCard(m) {
  const h = resolveRoster(m.home), a = resolveRoster(m.away);
  const hn = h ? h.name : (m.home || "TBD"), an = a ? a.name : (m.away || "TBD");
  const live = m.status === "IN_PLAY" || m.status === "PAUSED";
  const time = m.utcDate
    ? new Date(m.utcDate).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
    : "TBD";
  const right = live ? `<span class="nm-live">● Live</span>` : time;
  const middle = live && m.homeScore != null
    ? `<span class="nm-score">${m.homeScore}–${m.awayScore}</span>`
    : `<span class="nm-vs">v</span>`;

  const o = m.odds;
  const oddsHtml = o && typeof o.home === "number"
    ? `<div class="nm-odds" title="Match odds (home / draw / away)">
         <span class="odd"><b>1</b> ${toFraction(o.home)}</span>
         <span class="odd"><b>X</b> ${toFraction(o.draw)}</span>
         <span class="odd"><b>2</b> ${toFraction(o.away)}</span>
       </div>`
    : "";

  const fh = randFact(hn), fa = randFact(an);
  const factsHtml = (fh || fa) ? `<div class="nm-facts">
    ${fh ? `<p title="${hn}: ${fh}"><span class="ff">${h ? h.flag : "🏳️"}</span><b>${hn}</b> ${fh}</p>` : ""}
    ${fa ? `<p title="${an}: ${fa}"><span class="ff">${a ? a.flag : "🏳️"}</span><b>${an}</b> ${fa}</p>` : ""}
  </div>` : "";

  return `
    <div class="nmx" data-team="${hn}" data-team2="${an}" data-player="${state.ownerOf[hn] || ""}">
      <div class="nm-head"><span class="nm-ctx">${matchContext(m)}</span><span>${right}</span></div>
      <div class="nm-teams">
        <div class="nm-team">
          <span class="nm-flag">${h ? h.flag : "🏳️"}</span><span class="nm-name">${hn}</span>${ownerChip(hn)}
        </div>
        ${middle}
        <div class="nm-team away">
          <span class="nm-flag">${a ? a.flag : "🏳️"}</span><span class="nm-name">${an}</span>${ownerChip(an)}
        </div>
      </div>
      ${oddsHtml}
      ${factsHtml}
    </div>`;
}

// "Next matches" tab — every game on the next day that has fixtures.
function renderNextMatches() {
  const el = document.getElementById("view-next");
  const upcoming = state.matches
    .filter((m) => m.status !== "FINISHED" && m.utcDate)
    .sort((a, b) => a.utcDate.localeCompare(b.utcDate));
  if (!upcoming.length) {
    el.innerHTML = `<p class="empty">No upcoming fixtures scheduled.</p>`;
    return;
  }
  const dayKey = new Date(upcoming[0].utcDate).toLocaleDateString();
  const dayLabel = new Date(upcoming[0].utcDate).toLocaleDateString(undefined, {
    weekday: "long", month: "short", day: "numeric",
  });
  const games = upcoming
    .filter((m) => new Date(m.utcDate).toLocaleDateString() === dayKey)
    .sort((a, b) => a.utcDate.localeCompare(b.utcDate));
  el.innerHTML = `<h3 class="nmx-day">${dayLabel} · ${games.length} ${games.length === 1 ? "game" : "games"}</h3>
    <div class="nmx-list">${games.map(nextMatchCard).join("")}</div>`;
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

// Compact one-line fixture for the Fixtures tab (mobile-first).
function fixtureRowCompact(m) {
  const h = resolveRoster(m.home), a = resolveRoster(m.away);
  const hn = h ? h.name : (m.home || "TBD"), an = a ? a.name : (m.away || "TBD");
  const played = m.homeScore != null && m.awayScore != null;
  const live = m.status === "IN_PLAY" || m.status === "PAUSED";
  const time = m.utcDate ? new Date(m.utcDate).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) : "—";
  const tag = isGroupStage(m)
    ? (m.group || resolveRoster(m.home)?.group || resolveRoster(m.away)?.group || "")
    : prettyStage(m.stage);
  const mid = played
    ? `<span class="fx-sc ${live ? "live" : ""}">${m.homeScore}–${m.awayScore}</span>`
    : `<span class="fx-time">${time}</span>`;
  return `
    <div class="fixture compact" data-team="${hn}" data-team2="${an}" data-player="${state.ownerOf[hn] || ""}">
      <span class="side home"><span class="fx-tn">${hn}</span><span class="fx-flag">${h ? h.flag : "🏳️"}</span></span>
      <span class="fx-mid">${live ? '<span class="livedot"></span>' : ""}<span class="fx-tag">${tag}</span>${mid}</span>
      <span class="side away"><span class="fx-flag">${a ? a.flag : "🏳️"}</span><span class="fx-tn">${an}</span></span>
    </div>`;
}

function renderFixtures() {
  const el = document.getElementById("view-fixtures");
  if (!state.matches.length) {
    el.innerHTML = `<p class="empty">Fixtures will appear here once the schedule is published.</p>`;
    return;
  }
  const sorted = [...state.matches].sort((a, b) => (a.utcDate || "").localeCompare(b.utcDate || ""));
  const days = new Map();
  for (const m of sorted) {
    const key = m.utcDate
      ? new Date(m.utcDate).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })
      : "Date TBD";
    (days.get(key) || days.set(key, []).get(key)).push(m);
  }
  el.innerHTML = [...days].map(([day, ms]) => `
    <div class="fx-day">
      <h3 class="fx-date">${day}</h3>
      <div class="fx-list">${ms.map(fixtureRowCompact).join("")}</div>
    </div>`).join("");
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

// Implied win probability per team from outright odds (1/odds, normalised).
function computeWinProb() {
  const raw = {}; let total = 0;
  for (const [t, o] of Object.entries(state.odds)) {
    if (t.startsWith("_") || !(o > 0)) continue;
    raw[t] = 1 / o; total += raw[t];
  }
  const prob = {};
  if (total) for (const t in raw) prob[t] = raw[t] / total;
  return { prob, hasOdds: total > 0 };
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

  // pooled win % per player (same system as the old Odds tab)
  const { prob, hasOdds } = computeWinProb();

  const rows = players.map((p) => {
    const teams = state.assignments[p];
    const pts = teams.reduce((s, t) => s + (teamStat[t]?.Pts || 0), 0);
    const gf = teams.reduce((s, t) => s + (teamStat[t]?.GF || 0), 0);
    const ga = teams.reduce((s, t) => s + (teamStat[t]?.GA || 0), 0);
    const aliveCount = teams.filter((t) => alive.has(t)).length;
    const win = teams.reduce((s, t) => s + (prob[t] || 0), 0);
    return { p, teams, pts, gf, ga, aliveCount, win };
  }).sort((x, y) => hasOdds
    ? (y.win - x.win) || (y.pts - x.pts)
    : (y.pts - x.pts) || (y.gf - y.ga) - (x.gf - x.ga) || (y.aliveCount - x.aliveCount));

  const maxWin = Math.max(...rows.map((r) => r.win), 0.0001);

  el.innerHTML = `<div class="grid players">${
    rows.map((r, i) => {
      const c = state.colorOf[r.p];
      const sub = hasOdds
        ? `<b>${(r.win * 100).toFixed(1)}%</b> to win · ${r.pts} pts · ${r.aliveCount}/4 alive`
        : `${r.pts} pts · ${r.aliveCount}/4 alive`;
      return `
      <div class="card" data-player="${r.p}">
        <div class="card-head" style="border-left:4px solid ${c}">
          <h2><span class="rank">${i + 1}</span> ${r.p}</h2>
          <span class="sub">${sub}</span>
        </div>
        ${hasOdds ? `<div class="obar pcard-bar"><span style="width:${(r.win / maxWin * 100).toFixed(1)}%;background:${c}"></span></div>` : ""}
        <div class="player-teams">${
          r.teams.map((name) => {
            const out = !alive.has(name);
            const tw = hasOdds ? `<span class="twin">${((prob[name] || 0) * 100).toFixed(1)}%</span>` : "";
            return `
            <div class="row ${out ? "out" : ""}" data-team="${name}" data-player="${r.p}">
              <span class="flag">${flagOf[name] || "🏳️"}</span>
              <span class="team">${name}</span>
              <span class="grp">${groupOf[name] || "?"}</span>
              ${tw}
              <span class="tpts">${teamStat[name]?.Pts ?? 0}p</span>
            </div>`;
          }).join("")
        }</div>
      </div>`;
    }).join("")
  }</div>`;
}

// Tournament top scorers: player, the country they play for, goals, and team owner.
function renderScorers() {
  const el = document.getElementById("view-scorers");
  const list = state.scorers || [];
  if (!list.length) {
    el.innerHTML = `<p class="empty">Top scorers will appear here once goals start going in.</p>`;
    return;
  }
  el.innerHTML = `
    <div class="table-scroll">
      <table class="scorers">
        <thead><tr><th class="pos">#</th><th>Player</th><th>Country</th><th class="c">Goals</th><th>Owner</th></tr></thead>
        <tbody>${
          list.map((s, i) => {
            const r = resolveRoster(s.team);
            const country = r ? r.name : (s.team || "—");
            const flag = r ? r.flag : "🏳️";
            const owner = r ? state.ownerOf[r.name] : null;
            return `
            <tr class="scorer-row" data-team="${country}" data-player="${owner || ""}">
              <td class="pos">${i + 1}</td>
              <td class="pl">${s.player}</td>
              <td class="ct"><span class="flag">${flag}</span><span class="ctn">${country}</span></td>
              <td class="c g">${s.goals}</td>
              <td>${owner ? ownerChip(r.name) : '<span class="owner muted">—</span>'}</td>
            </tr>`;
          }).join("")
        }</tbody>
      </table>
    </div>`;
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

  document.querySelectorAll(".legend .chip").forEach((chip) => {
    chip.classList.toggle("is-dim", !!player && chip.dataset.player !== player);
    chip.classList.toggle("is-on", !!player && chip.dataset.player === player);
  });

  // A row matches if the active player owns either of its teams.
  const rowMatches = (el) =>
    !player ||
    el.dataset.player === player ||
    (el.dataset.team2 && state.ownerOf[el.dataset.team2] === player);

  document.querySelectorAll(".srow, .row, .fixture, .scorer-row, .nmx").forEach((el) => {
    el.classList.toggle("is-dim", !rowMatches(el));
  });

  // When a player is selected, hide whole cards/groups/days containing nothing of theirs
  // (cleaner browsing, especially on mobile).
  document.querySelectorAll("#view-groups .card, #view-fixtures .fx-day, #view-knockout .stage, #view-players .card").forEach((c) => {
    if (!player) { c.classList.remove("is-hidden"); return; }
    const rows = c.querySelectorAll(".srow, .row, .fixture");
    const anyShown = [...rows].some((r) => !r.classList.contains("is-dim"));
    c.classList.toggle("is-hidden", rows.length > 0 && !anyShown);
  });

  // Next-match cards: hide the ones that aren't the selected player's.
  document.querySelectorAll("#view-next .nmx").forEach((c) => {
    c.classList.toggle("is-hidden", !!player && c.classList.contains("is-dim"));
  });

  // Active-filter banner with a one-tap clear.
  const note = document.getElementById("filter-note");
  if (note) {
    note.innerHTML = player
      ? `Showing <b>${player}</b>'s teams <button class="filter-clear" type="button">clear ✕</button>`
      : "";
  }
}

function wireEvents() {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((t) => t.classList.remove("is-active"));
      tab.classList.add("is-active");
      const view = tab.dataset.view;
      for (const v of ["next", "groups", "fixtures", "knockout", "players", "scorers"]) {
        document.getElementById(`view-${v}`).hidden = v !== view;
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
    const standings = computeStandings();
    renderNextMatches();
    renderFixtures();
    renderGroups(standings);
    renderKnockout();
    renderPlayers(standings);
    renderScorers();
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
