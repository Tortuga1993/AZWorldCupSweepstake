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
 let existing = { ownGo
