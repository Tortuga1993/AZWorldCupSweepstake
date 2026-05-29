#!/usr/bin/env node
// Fetches 2026 World Cup matches and top scorers from football-data.org and
// writes data/matches.json and data/scorers.json.
// Runs in GitHub Actions (see .github/workflows/update-scores.yml). Needs FOOTBALL_DATA_TOKEN.
import { writeFileSync, readFileSync } from "node:fs";

const TOKEN = process.env.FOOTBALL_DATA_TOKEN;
const COMP = process.env.WC_COMPETITION || "WC"; // football-data competition code for the World Cup

if (!TOKEN) {
  console.error("Missing FOOTBALL_DATA_TOKEN environment variable.");
  process.exit(1);
}

async function api(path) {
  const res = await fetch(`https://api.football-data.org/v4/competitions/${COMP}/${path}`, {
    headers: { "X-Auth-Token": TOKEN },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${path} -> ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

// Write only when the meaningful content changed (ignore the `updated` timestamp),
// so unchanged data doesn't produce noisy commits. A failed fetch never writes,
// so a transient API error simply leaves the previous data in place.
function writeIfChanged(file, obj) {
  let prev = "";
  try { prev = readFileSync(file, "utf8"); } catch { /* first run */ }
  const next = JSON.stringify(obj, null, 2) + "\n";
  const strip = (s) => s.replace(/"updated":\s*("[^"]*"|null),/, "");
  if (prev && strip(prev) === strip(next)) {
    console.log(`No change: ${file}`);
    return;
  }
  writeFileSync(file, next);
  console.log(`Wrote ${file}`);
}

// ---- Matches ----
try {
  const data = await api("matches");
  const matches = (data.matches || []).map((m) => ({
    id: m.id,
    stage: m.stage,
    group: m.group ? m.group.replace(/^GROUP_?/, "") : null,
    utcDate: m.utcDate,
    status: m.status,
    matchday: m.matchday ?? null,
    home: m.homeTeam?.name ?? null,
    away: m.awayTeam?.name ?? null,
    homeScore: m.score?.fullTime?.home ?? null,
    awayScore: m.score?.fullTime?.away ?? null,
    winner: m.score?.winner ?? null,
    // 1X2 match odds — only present if the football-data Odds Package is active;
    // otherwise m.odds is just a message and this stays null.
    odds: typeof m.odds?.homeWin === "number"
      ? { home: m.odds.homeWin, draw: m.odds.draw, away: m.odds.awayWin }
      : null,
  }));
  matches.sort((a, b) => (a.utcDate || "").localeCompare(b.utcDate || ""));
  writeIfChanged("data/matches.json", { updated: new Date().toISOString(), competition: COMP, count: matches.length, matches });
} catch (e) {
  console.error("matches: " + e.message);
}

// ---- Top scorers ----
try {
  const data = await api("scorers?limit=30");
  const scorers = (data.scorers || []).map((s) => ({
    player: s.player?.name ?? "Unknown",
    team: s.team?.name ?? null, // the player's national team = the country
    goals: s.goals ?? 0,
    assists: s.assists ?? null,
  }));
  writeIfChanged("data/scorers.json", { updated: new Date().toISOString(), competition: COMP, count: scorers.length, scorers });
} catch (e) {
  console.error("scorers: " + e.message);
}
