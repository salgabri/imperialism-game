// Generates the club layer for both sports:
//   src/data/clubs.football.js    from the EA Sports FC player export
//   src/data/clubs.basketball.js  from the NBA 2K export
//
//   npm run build-clubs
//
// Clubs are combatants in their own right, so each needs the same shape a nation
// has: an id, a short code, a colour, a strength and a lineup. They also carry a
// home country, which is what seeds them onto the map.

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { NATIONS } from '../src/data/teams.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const MAX_RATING = 99;

// The main domestic leagues, mapped to the country whose map shape seeds them.
const FOOTBALL_LEAGUES = {
  'Premier League': '826',
  'La Liga': '724',
  'Serie A': '380',
  Bundesliga: '276',
  'Ligue 1': '250',
  Eredivisie: '528',
  'Liga Portugal': '620',
};

const FOOTBALL_FORMATION = { GK: 1, DF: 4, MF: 4, FW: 2 };
const FOOTBALL_SIZE = 11;
const BASKETBALL_FORMATION = { PG: 1, SG: 1, SF: 1, PF: 1, C: 1 };
const BASKETBALL_SIZE = 5;

const ROLE_OF_POSITION = {
  GK: 'GK',
  CB: 'DF', LB: 'DF', RB: 'DF', LWB: 'DF', RWB: 'DF',
  CDM: 'MF', CM: 'MF', CAM: 'MF', LM: 'MF', RM: 'MF',
  LW: 'FW', RW: 'FW', ST: 'FW', CF: 'FW',
};

// NBA 2K carries no position, but it carries the attributes a position is made
// of. Each role scores the skills that define it; a player takes his best fit.
const POSITION_FIT = {
  PG: p => p.passVision + p.passIQ + p.ballHandle + p.speedWithBall + p.agility,
  SG: p => p.threePointShot + p.midRangeShot + p.shotIQ + p.agility + p.speed,
  SF: p => p.threePointShot + p.drivingDunk + p.perimeterDefense + p.layup + p.strength,
  PF: p => p.offensiveRebound + p.defensiveRebound + p.strength + p.interiorDefense + p.standingDunk,
  C: p => p.interiorDefense + p.block + p.defensiveRebound + p.standingDunk + p.postControl,
};

function parseCsv(text) {
  const rows = [];
  let field = '';
  let row = [];
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const slug = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Short code for the scoreboard: initials for multi-word names, else a prefix. */
function makeCode(name, taken) {
  const words = name.replace(/[^A-Za-zÀ-ÿ ]/g, ' ').split(/\s+/).filter(w => w.length > 1 && !/^(de|do|da|of|the|fc|cf|ac|sc|as|ss|us|club|calcio|deportivo)$/i.test(w));
  const candidates = [];
  if (words.length >= 3) candidates.push(words.slice(0, 3).map(w => w[0]).join(''));
  if (words.length >= 2) candidates.push(words[0][0] + words[1].slice(0, 2));
  if (words.length >= 2) candidates.push(words[0].slice(0, 2) + words[1][0]);
  if (words.length) candidates.push(words[0].slice(0, 3));
  candidates.push(name.replace(/[^A-Za-z]/g, '').slice(0, 3));
  for (const c of candidates) {
    const code = c.toUpperCase().padEnd(3, 'X').slice(0, 3);
    if (code.length === 3 && !taken.has(code)) { taken.add(code); return code; }
  }
  for (let i = 0; i < 999; i++) {
    const code = (name.replace(/[^A-Za-z]/g, '').slice(0, 2).toUpperCase() + i).slice(0, 3);
    if (!taken.has(code)) { taken.add(code); return code; }
  }
  return 'CLB';
}

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** Distinct, readable colours spread around the hue wheel. */
const colourFor = id => `oklch(0.72 0.16 ${hashStr(id) % 360})`;

/** Fill the formation by rating, then top up with the best remaining players. */
function pickLineup(pool, formation, size) {
  const byRating = pool.slice().sort((a, b) => b.rating - a.rating || a.name.localeCompare(b.name));
  const taken = new Set();
  const lineup = [];
  for (const [pos, count] of Object.entries(formation)) {
    for (const p of byRating) {
      if (lineup.filter(x => x.pos === pos).length >= count) break;
      if (taken.has(p) || p.pos !== pos) continue;
      taken.add(p);
      lineup.push(p);
    }
  }
  for (const p of byRating) {
    if (lineup.length >= size) break;
    if (taken.has(p)) continue;
    taken.add(p);
    lineup.push(p);
  }
  return lineup.sort((a, b) => b.rating - a.rating);
}

const mean = xs => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

function emit(clubs, file, header) {
  const body = clubs
    .map(c => {
      const players = c.squad.map(p => `[${JSON.stringify(p.name)},'${p.pos}',${p.rating}]`).join(',');
      return `  { id: '${c.id}', name: ${JSON.stringify(c.name)}, code: '${c.code}', league: ${JSON.stringify(c.league)}, country: '${c.country}', col: '${c.col}', str: ${c.str}, squad: [${players}] },`;
    })
    .join('\n');
  return writeFile(path.join(root, 'src', 'data', file), `${header}\nexport const CLUBS = [\n${body}\n];\n`);
}

// ---------------- football ----------------

const rows = parseCsv(await readFile(path.join(root, 'data-src', 'players.csv'), 'utf8'));
const header = rows[0];
const col = name => header.indexOf(name);
const [cName, cPos, cOverall, cClub, cLeague, cLevel] =
  ['short_name', 'player_positions', 'overall', 'club_name', 'league_name', 'league_level'].map(col);

const byClub = new Map();
for (const row of rows.slice(1)) {
  if (row.length < header.length - 2) continue;
  if (parseFloat(row[cLevel]) !== 1) continue;
  const country = FOOTBALL_LEAGUES[row[cLeague]];
  if (!country) continue;
  const role = ROLE_OF_POSITION[row[cPos].split(',')[0].trim()];
  if (!role) continue;
  const key = row[cClub];
  if (!byClub.has(key)) byClub.set(key, { league: row[cLeague], country, players: [] });
  byClub.get(key).players.push({ name: row[cName], pos: role, rating: Math.min(MAX_RATING, Number(row[cOverall])) });
}

const footballCodes = new Set();
const footballClubs = [...byClub.entries()]
  .map(([name, info]) => {
    const squad = pickLineup(info.players, FOOTBALL_FORMATION, FOOTBALL_SIZE);
    return {
      id: `f-${slug(name)}`,
      name,
      league: info.league,
      country: info.country,
      str: Math.round(mean(squad.map(p => p.rating))),
      squad,
    };
  })
  .filter(c => c.squad.length >= FOOTBALL_SIZE)
  .sort((a, b) => b.str - a.str);
for (const c of footballClubs) {
  c.code = makeCode(c.name, footballCodes);
  c.col = colourFor(c.id);
}

await emit(
  footballClubs,
  'clubs.football.js',
  `// GENERATED by scripts/build-clubs.mjs from an EA Sports FC player export.
//
// Top-division clubs from the main European leagues, each with its best XI in a
// 4-4-2 and a strength equal to that lineup's mean rating. \`country\` is the map
// shape the club is seeded from when a club campaign starts.
`,
);

// ---------------- basketball ----------------

const nba = JSON.parse(await readFile(path.join(root, 'data-src', 'nba2k.json'), 'utf8'));
const byTeam = new Map();
for (const p of nba) {
  if (!p.team) continue;
  const pos = Object.keys(POSITION_FIT).reduce((best, k) => (POSITION_FIT[k](p) > POSITION_FIT[best](p) ? k : best), 'PG');
  if (!byTeam.has(p.team)) byTeam.set(p.team, []);
  byTeam.get(p.team).push({ name: p.name, pos, rating: Math.min(MAX_RATING, p.overallAttribute) });
}

const basketCodes = new Set();
const basketballClubs = [...byTeam.entries()]
  .map(([name, players]) => {
    const squad = pickLineup(players, BASKETBALL_FORMATION, BASKETBALL_SIZE);
    return {
      id: `b-${slug(name)}`,
      name,
      league: 'NBA',
      country: '840',
      str: Math.round(mean(squad.map(p => p.rating))),
      squad,
    };
  })
  .filter(c => c.squad.length >= BASKETBALL_SIZE)
  .sort((a, b) => b.str - a.str);
for (const c of basketballClubs) {
  c.code = makeCode(c.name, basketCodes);
  c.col = colourFor(c.id);
}

await emit(
  basketballClubs,
  'clubs.basketball.js',
  `// GENERATED by scripts/build-clubs.mjs from an NBA 2K export.
//
// NBA franchises with their best starting five. The export carries no position,
// so each player's role is inferred from the attributes that define it — a
// centre by interior defence, rebounding and post play, a point guard by vision,
// handle and speed with the ball.
`,
);

const missing = Object.keys(FOOTBALL_LEAGUES).filter(l => ![...byClub.values()].some(c => c.league === l));
console.log(`football: ${footballClubs.length} clubs across ${new Set(footballClubs.map(c => c.league)).size} leagues`);
for (const [league] of Object.entries(FOOTBALL_LEAGUES)) {
  const n = footballClubs.filter(c => c.league === league).length;
  if (n) console.log(`  ${String(n).padStart(2)} ${league} (${NATIONS[FOOTBALL_LEAGUES[league]][0]})`);
}
if (missing.length) console.log(`  leagues not found in the export: ${missing.join(', ')}`);
console.log(`  strongest: ${footballClubs.slice(0, 6).map(c => `${c.name} ${c.str}`).join(', ')}`);
console.log(`basketball: ${basketballClubs.length} franchises`);
console.log(`  strongest: ${basketballClubs.slice(0, 6).map(c => `${c.name} ${c.str}`).join(', ')}`);
