# World Cup 2026 Sweepstake 🏆

A self-updating page to track a sweepstake between **12 players** across the **48 teams** and **12 groups** of the 2026 FIFA World Cup (Canada / Mexico / USA).

As the tournament runs, a scheduled GitHub Action pulls live scores into the repo, and the page recomputes **group standings**, **knockout fixtures**, and a **player leaderboard** automatically.

## What it shows

- **Group stage** — live standings table for each group (P · GD · Pts) with the owning player, qualification colours (top 2 green, 3rd amber, 4th grey), and every fixture/result underneath. Live matches pulse red.
- **Knockout** — fixtures and results by round, populated automatically once the groups are decided.
- **Players** — a leaderboard ranking the 12 players by their teams' total points, with how many of each player's four teams are still alive (eliminated teams are struck through).
- **Filter & highlight** — search by team or player, or click a player to highlight all their teams everywhere.

## The data files

Everything is driven by plain JSON in [`data/`](data/). No build step.

| File | What it holds | Updated by |
|------|---------------|-----------|
| [`data/groups.json`](data/groups.json) | The 12 groups, teams, and flags (official 2026 final draw). | You (one-off) |
| [`data/assignments.json`](data/assignments.json) | **The sweepstake mapping** — each player → their 4 teams. | You |
| [`data/matches.json`](data/matches.json) | Fixtures, scores, and statuses. | The GitHub Action |

### After the sweepstake draw

Player names haven't been drawn yet, so `assignments.json` uses `Person 1` … `Person 12` placeholders with teams pre-distributed (4 each). To update: open [`data/assignments.json`](data/assignments.json), replace the names and/or reshuffle the teams, commit. Team names must match `groups.json` exactly. The page updates itself.

## Making it self-update (one-time setup)

The site lives on **GitHub Pages**; scores are refreshed by the **GitHub Action** in
[`.github/workflows/update-scores.yml`](.github/workflows/update-scores.yml), which runs
[`scripts/fetch-scores.mjs`](scripts/fetch-scores.mjs) on a ~10-minute cron and commits any changes to `data/matches.json`.

1. **Push this repo to GitHub** (default branch `main`).
2. **Enable Pages:** *Settings → Pages → Deploy from a branch → `main` / root*. The site goes live at `https://<user>.github.io/<repo>/`.
3. **Get a free API key** from [football-data.org](https://www.football-data.org/) and add it as a repository secret named `FOOTBALL_DATA_TOKEN` (*Settings → Secrets and variables → Actions → New repository secret*).
4. **Allow Actions to push:** *Settings → Actions → General → Workflow permissions → Read and write permissions*.
5. (Optional) Trigger a first run manually: *Actions → Update scores → Run workflow*.

Notes:
- The competition code defaults to `WC`. If your football-data.org plan exposes the World Cup under a different code, set the `WC_COMPETITION` env var in the workflow. Confirm the World Cup is included in your plan's free tier.
- API team names occasionally differ from the roster (e.g. "Korea Republic", "Czechia", "Türkiye"). These are normalised in [`app.js`](app.js) via an `ALIASES` map — add to it if a team fails to match.
- Scheduled runs only fire on the default branch and may be delayed by GitHub under load — this is near-live, not real-time.

## Running it locally

It's a static site:

```bash
python3 -m http.server
# then open http://localhost:8000
```

Opening `index.html` directly via `file://` won't work — the browser blocks `fetch` of local JSON, so use the server above.
