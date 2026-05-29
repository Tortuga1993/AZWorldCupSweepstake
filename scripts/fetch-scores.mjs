#!/usr/bin/env node
// Fetches 2026 World Cup matches from football-data.org and writes data/matches.json.
// Runs in GitHub Actions (see .github/workflows/update-scores.yml). Needs FOOTBALL_DATA_TOKEN.
import { writeFileSync, readFileSync } from "node:fs";

const TOKEN = process.env.FOOTBALL_DATA_TOKEN;
const COMP = process.env.WC_COMPETITION || "WC"; // football-data competition code for the World Cup
const OUT = "data/matches.json";

if (!TOKEN) {
  console.error("Missing FOOTBALL_DATA_TOKEN environment variable.");
  process.exit(1);
}

const res = await fetch(`https://api.football-data.org/v4/competitions/${COMP}/matches`, {
  headers: { "X-Auth-Token": TOKEN },
});

if (!res.ok) {
  const body = await res.text().catch(() => "");
  console.error(`football-data.org returned ${res.status}: ${body.slice(0, 300)}`);
  // Don't blow away existing data on a transient API error.
  process.exit(1);
}

const data = await res.json();
const matches = (data.matches || []).map((m) => ({
  id: m.id,
  stage: m.stage,                                   // GROUP_STAGE, LAST_16, QUARTER_FINALS, ...
  group: m.group ? m.group.replace(/^GROUP_?/, "") : null,
  utcDate: m.utcDate,
  status: m.status,                                 // SCHEDULED, IN_PLAY, PAUSED, FINISHED
  matchday: m.matchday ?? null,
  home: m.homeTeam?.name ?? null,
  away: m.awayTeam?.name ?? null,
  homeScore: m.score?.fullTime?.home ?? null,
  awayScore: m.score?.fullTime?.away ?? null,
  winner: m.score?.winner ?? null,                  // HOME_TEAM, AWAY_TEAM, DRAW, null
}));

// Sort chronologically for stable diffs.
matches.sort((a, b) => (a.utcDate || "").localeCompare(b.utcDate || ""));

const out = {
  updated: new Date().toISOString(),
  competition: COMP,
  count: matches.length,
  matches,
};

let prev = "";
try { prev = readFileSync(OUT, "utf8"); } catch { /* first run */ }
const next = JSON.stringify(out, null, 2) + "\n";

// Avoid noisy commits when only the timestamp would change.
const stripTs = (s) => s.replace(/"updated":\s*"[^"]*",/, "");
if (prev && stripTs(prev) === stripTs(next)) {
  console.log(`No match changes (${matches.length} matches). Leaving ${OUT} untouched.`);
  process.exit(0);
}

writeFileSync(OUT, next);
console.log(`Wrote ${matches.length} matches to ${OUT}.`);
