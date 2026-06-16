const https = require('https');
const fs = require('fs');
const API_KEY = process.env.HIGHLIGHTLY_KEY;
const BASE = 'soccer.highlightly.net';
const LEAGUE_ID = 1635;

function get(path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: BASE,
      path,
      method: 'GET',
      headers: { 'x-rapidapi-key': API_KEY }
    };
    https.get(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { reject(e); } });
    }).on('error', reject);
  });
}

function getDates() {
  const dates = [];
  const start = new Date('2026-06-12');
  const today = new Date();
  for (let d = new Date(start); d <= today; d.setDate(d.getDate() + 1)) {
    dates.push(d.toISOString().split('T')[0]);
  }
  return dates;
}

async function main() {
  const allOwnGoals = [];
  const allRedCards = [];
  const allConceded = [];
  let totalYellows = 0;
  let lastYellowPlayer = null;
  let lastYellowTeam = null;
  let lastYellowMatch = null;

  const dates = getDates();
  console.log(`Fetching ${dates.length} days of matches...`);

  for (const date of dates) {
    let matchesRes;
    try {
      matchesRes = await get(`/matches?leagueId=${LEAGUE_ID}&date=${date}&season=2026`);
    } catch(e) {
      console.log(`Error fetching ${date}:`, e.message);
      continue;
    }
    const matches = (matchesRes?.data || []).filter(m =>
      ['Finished','Finished after extra time','Finished after penalties'].includes(m.state?.description)
    );
    console.log(`${date}: ${matches.length} finished matches`);

    for (const match of matches) {
      if (!match.id) continue;
      let detail;
      try {
        const r = await get(`/matches/${match.id}`);
        detail = Array.isArray(r) ? r[0] : r;
      } catch(e) {
        continue;
      }

      const events = detail?.events || [];
      const homeTeam = detail?.homeTeam?.name || '';
      const awayTeam = detail?.awayTeam?.name || '';
      const matchLabel = `${homeTeam} vs ${awayTeam}`;
      let homeConceded = 0;
      let awayConceded = 0;

      for (const ev of events) {
        const type = ev.type || '';
        console.log(`Event type: "${type}"`);
        const minute = ev.time ? parseInt(ev.time) : null;
        const player = ev.player || null;
        const team = ev.team?.name || null;

        if (type === 'Own Goal') {
          allOwnGoals.push({ minute, player, team, match: matchLabel, date });
          if (team === homeTeam) homeConceded++;
          else awayConceded++;
        }
        if (type === 'Red Card') {
          allRedCards.push({ minute, player, team, match: matchLabel, date });
        }
        if (type === 'Yellow Card') {
          totalYellows++;
          lastYellowPlayer = player;
          lastYellowTeam = team;
          lastYellowMatch = matchLabel;
        }
        if (type === 'Goal' || type === 'Penalty') {
          if (team === homeTeam) awayConceded++;
          else homeConceded++;
        }
      }

      if (homeConceded > 0) allConceded.push({ goals: homeConceded, team: homeTeam, match: matchLabel, date });
      if (awayConceded > 0) allConceded.push({ goals: awayConceded, team: awayTeam, match: matchLabel, date });
    }
  }

  allOwnGoals.sort((a, b) => (a.minute || 999) - (b.minute || 999));
  allRedCards.sort((a, b) => (a.minute || 999) - (b.minute || 999));
  allConceded.sort((a, b) => b.goals - a.goals);

  const sidebets = {
    lastUpdated: new Date().toISOString(),
    ownGoals: allOwnGoals,
    redCards: allRedCards,
    mostConceded: allConceded.slice(0, 10),
    yellowCards: {
      target: 100,
      current: totalYellows,
      leader: totalYellows >= 100 ? lastYellowPlayer : null,
      leaderTeam: totalYellows >= 100 ? lastYellowTeam : null,
      leaderMatch: totalYellows >= 100 ? lastYellowMatch : null
    }
  };

  fs.writeFileSync('data/sidebets.json', JSON.stringify(sidebets, null, 2));
  console.log(`Done: ${allOwnGoals.length} own goals, ${allRedCards.length} red cards, ${totalYellows} yellows, ${allConceded.length} conceded records`);
}

main().catch(e => { console.error(e); process.exit(1); });
