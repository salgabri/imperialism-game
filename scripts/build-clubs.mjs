// Generates the club layer for both sports:
//   src/data/clubs.football.js    from the EA Sports FC player export
//   src/data/clubs.basketball.js  from the built-in season's NBA 2K ratings, as 2K Archive compiles them
//
//   npm run build-clubs
//
// Clubs are combatants in their own right, so each needs the same shape a nation
// has: an id, a short code, a colour, a strength and a lineup. They also carry a
// home country, which is what seeds them onto the map.

import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { NATIONS } from '../src/data/teams.js';
import { TOP_CLUBS } from '../src/data/scopes.js';
import { loadEaPlayers, pickFootballSquad, playerTuple } from './lib/football-data.mjs';
import { clubsModule } from './lib/data-module.mjs';
import { nbaSeasonClubs, readArchive } from './lib/nba-seasons.mjs';
import { CLUBS as CURRENT_NBA_CLUBS } from '../src/data/clubs.basketball.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// Europe's first divisions (UEFA's, as the nations' Europe theatre counts them) in the EA snapshot, by EA competition
// id, with each league's name in the game and the map shape its clubs hold land in. By id because names collide
// internationally: Austria also has a Bundesliga, Ukraine a Premier League, Greece and Switzerland a Super League.
const FOOTBALL_LEAGUES = {
  13: { league: 'Premier League', country: '826' },
  53: { league: 'La Liga', country: '724' },
  31: { league: 'Serie A', country: '380' },
  19: { league: 'Bundesliga', country: '276' },
  16: { league: 'Ligue 1', country: '250' },
  10: { league: 'Eredivisie', country: '528' },
  308: { league: 'Liga Portugal', country: '620' },
  68: { league: 'Süper Lig', country: '792' },
  4: { league: 'Belgian Pro League', country: '056' },
  63: { league: 'Greek Super League', country: '300' },
  319: { league: 'Czech First League', country: '203' },
  50: { league: 'Scottish Premiership', country: 'SCO' },
  1: { league: 'Danish Superliga', country: '208' },
  41: { league: 'Eliteserien', country: '578' },
  332: { league: 'Ukrainian Premier League', country: '804' },
  317: { league: 'Croatian HNL', country: '191' },
  66: { league: 'Ekstraklasa', country: '616' },
  189: { league: 'Swiss Super League', country: '756' },
  80: { league: 'Austrian Bundesliga', country: '040' },
  313: { league: 'Azerbaijan Premier League', country: '031' },
  64: { league: 'Hungarian NB I', country: '348' },
  330: { league: 'Romanian Liga I', country: '642' },
  318: { league: 'Cypriot First Division', country: '196' },
  56: { league: 'Allsvenskan', country: '752' },
  322: { league: 'Veikkausliiga', country: '246' },
  65: { league: 'League of Ireland', country: '372' },
};
// European first-division clubs EA lists under no competition.
const LEAGUELESS_CLUBS = { 'PFC Ludogorets': { league: 'Bulgarian First League', country: '100' } };

const FOOTBALL_FORMATION = { GK: 1, DF: 4, MF: 4, FW: 2 };
const FOOTBALL_SIZE = 11;

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

const mean = xs => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

/** clubs.basketball.js: each club's five as `[name, 'PG/SG', rating]`, one club a line. */
function emit(clubs, file, header) {
  const body = clubs
    .map(c => {
      const players = c.squad.map(([name, positions, rating]) => `[${JSON.stringify(name)},'${positions}',${rating}]`).join(',');
      return `  { id: '${c.id}', name: ${JSON.stringify(c.name)}, code: '${c.code}', league: ${JSON.stringify(c.league)}, country: '${c.country}', col: '${c.col}', str: ${c.str}, squad: [${players}] },`;
    })
    .join('\n');
  return writeFile(path.join(root, 'src', 'data', file), `${header}\nexport const CLUBS = [\n${body}\n];\n`);
}

// ---------------- football ----------------

const eaSource = process.argv[2] || path.join(root, 'scripts/data/ea-fc27.csv');
const { players: eaPlayers } = await loadEaPlayers(eaSource);
const byClub = new Map();
for (const player of eaPlayers) {
  const home = LEAGUELESS_CLUBS[player.club] ?? (player.leagueLevel === 1 ? FOOTBALL_LEAGUES[player.leagueId] : null);
  if (!home) continue;
  const key = player.club;
  if (!key) throw new Error(`Missing club for ${player.sourceInfo.id}`);
  if (!byClub.has(key)) byClub.set(key, { ...home, players: [] });
  byClub.get(key).players.push(player);
}

// The strongest TOP_CLUBS of them by the exact mean of the lineup: `str` rounds it, and a club theatre takes clubs from
// the top of this list among equals.
const footballCodes = new Set();
const fielded = [...byClub.entries()]
  .map(([name, info]) => {
    const squad = pickFootballSquad(info.players);
    return { id: `f-${slug(name)}`, name, league: info.league, country: info.country, exact: mean(squad.map(p => p.rating)), squad };
  })
  .filter(c => c.squad.length >= FOOTBALL_SIZE)
  .sort((a, b) => b.exact - a.exact || a.name.localeCompare(b.name));
const footballClubs = fielded.slice(0, TOP_CLUBS).map(({ exact, ...c }) => ({ ...c, str: Math.round(exact) }));
for (const c of footballClubs) {
  c.code = makeCode(c.name, footballCodes);
  c.col = colourFor(c.id);
}

// The football clubs carry full source metadata, so they are stored compactly (scripts/lib/data-module.mjs).
await writeFile(path.join(root, 'src', 'data', 'clubs.football.js'), clubsModule(
  footballClubs.map(c => ({ ...c, squad: c.squad.map(p => p.sourceInfo ? playerTuple(p) : [p.name, p.pos, p.rating]) })),
  `// GENERATED by scripts/build-clubs.mjs from the committed ${eaPlayers[0].sourceInfo.edition} snapshot (${eaPlayers[0].sourceInfo.snapshotDate}).
// Player tuples retain database identity, all natural roles, original overall and source URL.
//
// Europe's ${TOP_CLUBS} strongest first-division clubs, strongest first, each with its best
// XI in a 4-4-2 and a strength equal to that lineup's mean rating. \`country\` is the map
// shape the club holds its land in.
// Stored compactly: each line is JSON, and source metadata is a row under a
// shared shape (src/data/sourceTable.js).
`,
));

// ---------------- basketball ----------------

// The built-in season's NBA 2K, as 2K Archive lists each player's team, positions and overall: the pinned page the
// earlier seasons come from (scripts/data/nba-seasons.json, `builtIn`). Each franchise fields the strongest five its
// players' positions allow and keeps the code and colour it has.
const archive = await readArchive(root);
const nbaBuiltIn = archive.manifest.builtIn;
const nba = nbaSeasonClubs(archive.years, nbaBuiltIn.year, archive.manifest, { arenas: archive.arenas, builtIn: CURRENT_NBA_CLUBS });
const basketballClubs = nba.clubs;

await emit(
  basketballClubs,
  'clubs.basketball.js',
  `// GENERATED by scripts/build-clubs.mjs from ${nbaBuiltIn.edition}'s ratings (${nbaBuiltIn.season}), as ${archive.manifest.source.name} compiles them
// (scripts/data/nba-seasons.json).
//
// NBA franchises with their best starting five. Each player lists the positions 2K gives him, primary first
// ('PG/SG'; a second position that is not the first's neighbour is dropped), and each five is the strongest lineup
// the franchise's positions allow.
`,
);

console.log(`football: ${footballClubs.length} of ${fielded.length} clubs, across ${new Set(footballClubs.map(c => c.league)).size} leagues`);
for (const { league, country } of [...Object.values(FOOTBALL_LEAGUES), ...Object.values(LEAGUELESS_CLUBS)]) {
  const n = footballClubs.filter(c => c.league === league).length;
  if (n) console.log(`  ${String(n).padStart(2)} ${league} (${NATIONS[country][0]})`);
}
console.log(`  last in: ${fielded[TOP_CLUBS - 1].name} (${fielded[TOP_CLUBS - 1].exact.toFixed(2)}); first out: ${fielded[TOP_CLUBS]?.name} (${fielded[TOP_CLUBS]?.exact.toFixed(2)})`);
console.log(`  strongest: ${footballClubs.slice(0, 6).map(c => `${c.name} ${c.str}`).join(', ')}`);
console.log(`basketball: ${basketballClubs.length} franchises`);
console.log(`  strongest: ${basketballClubs.slice(0, 6).map(c => `${c.name} ${c.str}`).join(', ')}`);
const starters = basketballClubs.flatMap(c => c.squad);
console.log(`  ${starters.filter(([, positions]) => positions.includes('/')).length} of ${starters.length} starters cover two positions`);
for (const warning of nba.warnings) console.log(`  warning: ${warning}`);
