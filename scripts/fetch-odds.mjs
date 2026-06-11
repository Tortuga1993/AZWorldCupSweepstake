#!/usr/bin/env node
// Fetches outright "win the World Cup" odds from The Odds API and writes
// data/odds.json (decimal, median across bookmakers).
//
// No-op (exit 0) if THE_ODDS_API_KEY is unset or the existing odds are still
// fresh — outright prices barely move, so we only call the API every few hours
// to stay well under the free-tier monthly request limit. Runs from the same
// workflow as the scores; the staleness guard makes it resilient to GitHub's
// erratic cron timing.
import { writeFileSync, readFileSync } from "node:fs";

const KEY = process.env.THE_ODDS_API_KEY;
const REGION = process.env.ODDS_REGION || "uk";
const MIN_HOURS = Number(process.env.ODDS_MIN_HOURS || 6);
const OUT = "data/odds.json";

async function main() {
  if (!KEY) { console.log("No THE_ODDS_API_KEY set — skipping odds update."); return; }

  let existing = {};
  try { existing = JSON.parse(readFileSync(OUT, "utf8")); } catch { /* first run */ }
  if (existing._updated) {
    const ageH = (Date.now() - new Date(existing._updated).getTime()) / 3.6e6;
    if (ageH < MIN_HOURS) { console.log(`Odds ${ageH.toFixed(1)}h old (< ${MIN_HOURS}h) — skipping.`); return; }
  }

  const api = async (path) => {
    const res = await fetch(`https://api.the-odds-api.com/v4/${path}`);
    if (!res.ok) throw new Error(`${path} -> ${res.status}: ${(await res.text().catch(() => "")).slice(0, 160)}`);
    return res.json();
  };

  // The World Cup winner sport key (auto-discovered unless overridden). /sports is free.
  let sportKey = process.env.ODDS_SPORT_KEY;
  if (!sportKey) {
    const sports = await api(`sports/?apiKey=${KEY}&all=true`);
    const hit = sports.find((s) => /world_cup/i.test(s.key) && /winner/i.test(s.key))
      || sports.find((s) => /world cup/i.test(s.title) && /winner/i.test(s.title));
    if (!hit) throw new Error("No World Cup winner market in /sports — set ODDS_SPORT_KEY.");
    sportKey = hit.key;
  }

  const data = await api(`sports/${sportKey}/odds/?apiKey=${KEY}&regions=${REGION}&markets=outrights&oddsFormat=decimal`);
  const events = Array.isArray(data) ? data : [data];

  const prices = {}; // team -> [decimal prices across bookmakers]
  for (const ev of events) {
    for (const bk of ev.bookmakers || []) {
      const market = (bk.markets || []).find((m) => m.key === "outrights");
      for (const oc of market?.outcomes || []) {
        if (typeof oc.price === "number" && oc.price > 1) (prices[oc.name] ||= []).push(oc.price);
      }
    }
  }
  const teams = Object.keys(prices);
  if (!teams.length) throw new Error("No outright outcomes returned.");

  const median = (a) => { const s = [...a].sort((x, y) => x - y); const n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
  const out = {
    _comment: "Outright 'win the World Cup' decimal odds, auto-updated from The Odds API (median across bookmakers). Team names are matched to groups.json in the front-end via ALIASES.",
    _updated: new Date().toISOString(),
    _source: `the-odds-api:${sportKey}:${REGION}`,
  };
  for (const t of teams) out[t] = Math.round(median(prices[t]) * 100) / 100;

  writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
  console.log(`Wrote ${teams.length} teams' odds from ${sportKey} (${REGION}).`);
}

main().catch((e) => { console.error("odds: " + e.message); /* leave odds.json untouched, don't fail the job */ });
