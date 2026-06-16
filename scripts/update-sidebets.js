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

async function main() {
  let existing = { ownGoals: [], redCards: [], mostConceded: [], yellowCards: { target: 100, current: 0, leader: null, leaderTeam: null, leaderMatch: null } };
  try { existing = JSON.parse(fs.readFileSync('data/sidebets.json', 'utf8')); } catch(e) {}

  const today = new Date().toISOString().split('T')[0];
  const matchesRes = await get(`/matches?leagueId=${LEAGUE_ID}&date=${today}`);
  const matches = (matchesRes?.data || []).filter(m =>
    ['Finished','Finished after extra time','Finished after penalties'].includes(m.state?.description)
  );

  let allOwnGoals = [...(existing.ownGoals || [])];
  let allRedCards = [...(existing.redCards || [])];
  let allConceded = [...(existing.mostConceded || [])];
  let totalYellows = existing.yellowCards?.current || 0;
  let lastYellowPlayer = existing.yellowCards?.leader || null;
  let lastYellowTeam = existing.yellowCards?.leaderTeam || null;
  let lastYellowMatch = existing.yellowCards?.leaderMatch || null;

  for (const match of matches) {
    if (!match.id) continue;
    let detail;
    try { const r = await get(`/matches/${match.id}`); detail = Array.isArray(r) ? r[0] : r; } catch(e) { continue; }

    const events = detail?.events || [];
    const homeTeam = detail?.homeTeam?.name || '';
    const awayTeam = detail?.awayTeam?.name || '';
    const matchLabel = `${homeTeam} vs ${awayTeam}`;
    const matchKey = matchLabel + today;
    const alreadyDone = allOwnGoals.some(g => (g.match + g.date) === matchKey);

    let homeConceded = 0, awayConceded = 0;

    for (const ev of events) {
      const type = ev.type || '';
      const minute = ev.time ? parseInt(ev.time) : null;
      const player = ev.player || null;
      const team = ev.team?.name || null;

      if (type === 'Own Goal' && !alreadyDone) {
        allOwnGoals.push({ minute, player, team, match: matchLabel, date: today });
      }
      if (type === 'Red Card' && !alreadyDone) {
        allRedCards.push({ minute, player, team, match: matchLabel, date: today });
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
      if (type === 'Own Goal') {
        if (team === homeTeam) homeConceded++;
        else awayConceded++;
      }
    }

    if (!alreadyDone) {
      if (homeConceded > 0) allConceded.push({ goals: homeConceded, team: homeTeam, match: matchLabel, date: today });
      if (awayConceded > 0) allConceded.push({ goals: awayConceded, team: awayTeam, match: matchLabel, date: today });
    }
  }

  allOwnGoals.sort((a,b) => (a.minute||999)-(b.minute||999));
  allRedCards.sort((a,b) => (a.minute||999)-(b.minute||999));
  allConceded.sort((a,b) => b.goals-a.goals);

  const sidebets = {
    lastUpdated: new Date().toISOString(),
    ownGoals: allOwnGoals,
    redCards: allRedCards,
    mostConceded: allConceded.slice(0,10),
    yellowCards: {
      target: 100,
      current: totalYellows,
      leader: totalYellows >= 100 ? lastYellowPlayer : existing.yellowCards?.leader,
      leaderTeam: totalYellows >= 100 ? lastYellowTeam : existing.yellowCards?.leaderTeam,
      leaderMatch: totalYellows >= 100 ? lastYellowMatch : existing.yellowCards?.leaderMatch
    }
  };

  fs.writeFileSync('data/sidebets.json', JSON.stringify(sidebets, null, 2));
  console.log(`Done: ${allOwnGoals.length} own goals, ${allRedCards.length} red cards, ${totalYellows} yellows`);
}

main().catch(e => { console.error(e); process.exit(1); });
