# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A static, no-build single-page site that tracks a 12-person FIFA World Cup 2026 sweepstake (48 teams, 12 groups, each player owns 4 teams). It's hosted on GitHub Pages and "self-updates" during the tournament via a scheduled GitHub Action that commits fresh data into `data/`.

There is **no build step, no framework, no dependencies, no tests**. It's plain `index.html` + `styles.css` + `app.js` reading JSON from `data/`.

## Running locally

Must be served over HTTP — `app.js` uses `fetch()` for the JSON, which fails on `file://`.

```bash
python3 -m http.server 8123   # then open http://localhost:8123/
```

To verify changes, drive the served page with a headless browser (Playwright browsers are cached under `~/Library/Caches/ms-playwright`; `playwright-core` resolves from a temp dir). Check `view.id`/`.is-active` tab state and look for console/page errors — that's the only "test" available.

## Architecture

**Data-driven rendering.** `app.js` `init()` loads six JSON files in parallel, stuffs them into a single `state` object, then calls one `render*()` per tab via `renderAll()`. An open page **auto-refreshes** the feed-written files (`matches.json`, `scorers.json`) every 60s (`refreshLiveData` → `renderAll`, also on tab re-focus), so live scores, standings and the Shittest table update without a reload. Standings/conceded count any match with a score regardless of status, so in-play scores show "as it stands". Each render function writes `innerHTML` into its `#view-*` section. Tabs are plain buttons (`data-view`) toggled in `wireEvents()` by setting the `hidden` attribute on sections. Adding a tab = add a `<button data-view="x">` + `<section id="view-x">` in `index.html`, a `renderX()`, an `init()` call, and `"x"` in the `wireEvents` view list.

**The data files (`data/`)** — all hand-editable JSON:
- `groups.json` — the 12 groups, teams, flag emoji. The source of truth for team names; everything else must match these names.
- `assignments.json` — the sweepstake: player name → their 4 team names. Hand-edited (e.g. during the live draw). Keys starting with `_` (like `_comment`) are ignored everywhere via `k.startsWith("_")`.
- `matches.json` / `scorers.json` — **written by the GitHub Action**, not by hand. Treat as machine-owned.
- `odds.json` — manual decimal outright odds per team; powers the "% to win" on the Teams tab.
- `facts.json` — country → array of trivia strings (random one shown on Fixtures cards).

**Team-name normalisation is critical.** The football-data.org feed uses different names than `groups.json` (e.g. "Czechia", "Korea Republic", "Cape Verde Islands", "Congo DR"). `ALIASES` + `canon()` + `resolveRoster()` map any incoming name to the roster team. **When the live feed introduces a new name variant that doesn't resolve, add it to `ALIASES`** — otherwise that team silently loses its flag/owner/standings.

**Derived state, never stored.** Standings (`computeStandings`), who's still alive (`aliveSet`), win probabilities (`computeWinProb`), and goals-conceded (`computeConceded`) are all computed from `matches.json` + `odds.json` on every load. `aliveSet` deliberately only eliminates teams once genuinely out (group fully played, or lost a knockout) — do not reintroduce projecting eliminations from an unplayed 0-0 table.

**Knockout vs group** is decided by `isGroupStage(m)` (stage matches `/GROUP/`). Knockout matches are ordered by `STAGE_ORDER`. Match status from the feed is `TIMED`/`IN_PLAY`/`PAUSED`/`FINISHED` (note: scheduled is `TIMED`, not `SCHEDULED`).

**One-tap filter.** Clicking a legend chip sets `state.activePlayer`; `applyHighlight()` dims/hides rows and whole cards/days that don't involve that player across every tab. Filterable elements carry `data-team` / `data-team2` / `data-player`.

**Theming.** Six themes are CSS-variable overrides under `html[data-theme="..."]` in `styles.css`; an inline script in `index.html` applies the saved theme before first paint to avoid a flash; the footer switcher persists choice to `localStorage`.

## The self-updating pipeline

`.github/workflows/update-scores.yml` runs `scripts/fetch-scores.mjs` on a cron, which calls football-data.org (`FOOTBALL_DATA_TOKEN` repo secret, competition code `WC`) and writes `data/matches.json` + `data/scorers.json`, committing only when content (ignoring the `updated` timestamp) changed. GitHub Pages then redeploys.

- The schedule is **live** (cron every 10 min). It overwrites `matches.json`/`scorers.json` every run — hand-edited demo data in those two files will be wiped within minutes, so the two are mutually exclusive. To pause, comment out the `cron:` line.
- The free football-data.org tier returns **no odds** (the `match.odds` 1X2 field is paywalled) and has **no outright "win the tournament" market at all** — that's why `odds.json` is manual.

## Conventions

- Match `groups.json` spelling exactly in `assignments.json`/`odds.json`/`facts.json` keys.
- Mobile-first: most users are on phones; keep tabs/cards compact and test at ~360–390px width.
- Commit messages in this repo end with the `Co-Authored-By: Claude` trailer; the scores bot uses `chore: update scores (...)`.
