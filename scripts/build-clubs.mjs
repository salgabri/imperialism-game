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
import { NATIONS, selectLineup } from '../src/data/teams.js';
import { loadEaPlayers, pickFootballSquad, playerTuple } from './lib/football-data.mjs';

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
// Names collide internationally: Austria also has a Bundesliga, Ukraine a
// Premier League and Ecuador a Serie A. Use the database's competition IDs.
const FOOTBALL_LEAGUE_IDS = { 'Premier League': 13, 'La Liga': 53, 'Serie A': 31,
  Bundesliga: 19, 'Ligue 1': 16, Eredivisie: 10, 'Liga Portugal': 308 };

const FOOTBALL_FORMATION = { GK: 1, DF: 4, MF: 4, FW: 2 };
const FOOTBALL_SIZE = 11;
const BASKETBALL_SIZE = 5;

const ROLE_OF_POSITION = {
  GK: 'GK',
  CB: 'DF', LB: 'DF', RB: 'DF', LWB: 'DF', RWB: 'DF',
  CDM: 'MF', CM: 'MF', CAM: 'MF', LM: 'MF', RM: 'MF',
  LW: 'FW', RW: 'FW', ST: 'FW', CF: 'FW',
};

// NBA 2K carries no position, but it carries the attributes a position is made
// of. Each role scores the skills that define it. Keys run PG to C, the order of
// the floor, so neighbouring keys are neighbouring positions.
const POSITION_FIT = {
  PG: p => p.passVision + p.passIQ + p.ballHandle + p.speedWithBall + p.agility,
  SG: p => p.threePointShot + p.midRangeShot + p.shotIQ + p.agility + p.speed,
  SF: p => p.threePointShot + p.drivingDunk + p.perimeterDefense + p.layup + p.strength,
  PF: p => p.offensiveRebound + p.defensiveRebound + p.strength + p.interiorDefense + p.standingDunk,
  C: p => p.interiorDefense + p.block + p.defensiveRebound + p.standingDunk + p.postControl,
};
const BASKETBALL_POSITIONS = Object.keys(POSITION_FIT);
// Most players cover two neighbouring positions: a combo guard both guard spots,
// a stretch big power forward and centre. 0.15 gives about three in four players
// in the export a second position.
const SECOND_POSITION_GAP = 0.15;

/**
 * Each player's natural positions, primary first. Raw fits sit on different
 * scales (rebounding spreads far more than shooting), so each is ranked against
 * the whole export as a league percentile. A player's best percentile is his
 * primary position; he also covers the better neighbouring position when it ranks
 * within SECOND_POSITION_GAP of it.
 */
function naturalPositions(pool) {
  const league = Object.fromEntries(BASKETBALL_POSITIONS.map(pos => [pos, pool.map(POSITION_FIT[pos]).sort((a, b) => a - b)]));
  // Mid-rank percentile: a run of equal fits shares the middle of its ranks.
  const percentile = (pos, fit) => {
    const sorted = league[pos];
    return (sorted.findIndex(x => x >= fit) + sorted.findLastIndex(x => x <= fit) + 1) / 2 / sorted.length;
  };
  return player => {
    const rank = Object.fromEntries(BASKETBALL_POSITIONS.map(pos => [pos, percentile(pos, POSITION_FIT[pos](player))]));
    const primary = BASKETBALL_POSITIONS.reduce((best, pos) => (rank[pos] > rank[best] ? pos : best));
    const at = BASKETBALL_POSITIONS.indexOf(primary);
    const neighbour = [BASKETBALL_POSITIONS[at - 1], BASKETBALL_POSITIONS[at + 1]].filter(Boolean)
      .reduce((best, pos) => (rank[pos] > rank[best] ? pos : best));
    return rank[primary] - rank[neighbour] <= SECOND_POSITION_GAP ? [primary, neighbour] : [primary];
  };
}

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

/**
 * The five the game itself would field from a whole roster: the strongest
 * assignment to the five positions, honouring both of a player's natural
 * positions, then listed by rating.
 */
function startingFive(pool) {
  const byRating = pool.slice().sort((a, b) => b.rating - a.rating || a.name.localeCompare(b.name));
  return selectLineup({ sport: 'basketball', squad: byRating }).starters
    .map(starter => byRating[starter.originalIndex])
    .sort((a, b) => b.rating - a.rating);
}

const mean = xs => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

function emit(clubs, file, header) {
  const body = clubs
    .map(c => {
      const players = c.squad.map(p => p.sourceInfo ? JSON.stringify(playerTuple(p)) : `[${JSON.stringify(p.name)},'${p.positions.join('/')}',${p.rating}]`).join(',');
      return `  { id: '${c.id}', name: ${JSON.stringify(c.name)}, code: '${c.code}', league: ${JSON.stringify(c.league)}, country: '${c.country}', col: '${c.col}', str: ${c.str}, squad: [${players}] },`;
    })
    .join('\n');
  return writeFile(path.join(root, 'src', 'data', file), `${header}\nexport const CLUBS = [\n${body}\n];\n`);
}

// ---------------- football ----------------

const eaSource = process.argv[2] || path.join(root, 'scripts/data/ea-fc26.csv');
const { players: eaPlayers } = await loadEaPlayers(eaSource);
const byClub = new Map();
for (const player of eaPlayers) {
  if (player.leagueLevel !== 1) continue;
  const league = player.league === 'Primeira Liga' ? 'Liga Portugal' : player.league;
  const country = FOOTBALL_LEAGUES[league];
  if (!country) continue;
  if (player.leagueId !== FOOTBALL_LEAGUE_IDS[league]) continue;
  const key = player.club;
  if (!key) throw new Error(`Missing club for ${player.sourceInfo.id}`);
  if (!byClub.has(key)) byClub.set(key, { league, country, players: [] });
  byClub.get(key).players.push(player);
}

const footballCodes = new Set();
const footballClubs = [...byClub.entries()]
  .map(([name, info]) => {
    const squad = pickFootballSquad(info.players);
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
  `// GENERATED by scripts/build-clubs.mjs from the committed EA FC 26 snapshot (2025-09-19).
// Player tuples retain database identity, all natural roles, original overall and source URL.
//
// Top-division clubs from the main European leagues, each with its best XI in a
// 4-4-2 and a strength equal to that lineup's mean rating. \`country\` is the map
// shape the club is seeded from when a club campaign starts.
`,
);

// ---------------- basketball ----------------

const nba = JSON.parse(await readFile(path.join(root, 'data-src', 'nba2k.json'), 'utf8'));
const positionsOf = naturalPositions(nba);
const byTeam = new Map();
for (const p of nba) {
  if (!p.team) continue;
  const positions = positionsOf(p);
  if (!byTeam.has(p.team)) byTeam.set(p.team, []);
  byTeam.get(p.team).push({ name: p.name, pos: positions[0], positions, rating: Math.min(MAX_RATING, p.overallAttribute) });
}

const basketCodes = new Set();
const basketballClubs = [...byTeam.entries()]
  .map(([name, players]) => {
    const squad = startingFive(players);
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
// so each player's positions are inferred from the attributes that define them —
// a centre by interior defence, rebounding and post play, a point guard by vision,
// handle and speed with the ball. Most players also cover a neighbouring position,
// listed primary first ('PG/SG'), and each five is the strongest lineup the
// franchise's positions allow.
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
const starters = basketballClubs.flatMap(c => c.squad);
console.log(`  ${starters.filter(p => p.positions.length > 1).length} of ${starters.length} starters cover two positions`);
