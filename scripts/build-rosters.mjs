// Generates src/data/rosters.js — a real national squad for every nation on the
// map — from an EA Sports FC player export.
//
//   npm run build-rosters [path/to/players.csv]
//
// The source CSV is the sofifa-derived schema: one row per player with
// short_name, player_positions, overall and nationality_name. It is not
// committed (11 MB); only the ~2000-player output is.
//
// Selection: for each nation, take the best available player by overall rating
// for each slot of a 1-4-4-2, then top the squad up to eleven with the best
// remaining players whatever their position. Nations too thin to fill eleven
// field what they have; nations with nobody in the dataset fall back to
// generated players at build time (see buildTeam in teams.js).

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { CONF_META, NATIONS } from '../src/data/teams.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const source = process.argv[2] || path.join(root, 'data-src', 'players.csv');

/** Ratings are EA overalls, which already live on the 1-99 scale this game uses. */
const MAX_RATING = 99;
/** A 4-4-2. Filled in this order, best-rated first. */
const FORMATION = { GK: 1, DF: 4, MF: 4, FW: 2 };
const SQUAD_SIZE = 11;

// The dataset names countries its own way, and separates the UK home nations —
// which is correct here, since the campaign fields England, not Great Britain.
const NATION_ALIASES = {
  'Bosnia and Herzegovina': 'Bosnia & Herz.',
  'Central African Republic': 'Central African Rep.',
  'China PR': 'China',
  'Congo DR': 'DR Congo',
  'Dominican Republic': 'Dominican Rep.',
  'Equatorial Guinea': 'Eq. Guinea',
  'Korea Republic': 'South Korea',
  'North Macedonia': 'N. Macedonia',
  'Republic of Ireland': 'Ireland',
  'Trinidad and Tobago': 'Trinidad & Tobago',
  Türkiye: 'Turkey',
};

const ROLE_OF_POSITION = {
  GK: 'GK',
  CB: 'DF', LB: 'DF', RB: 'DF', LWB: 'DF', RWB: 'DF',
  CDM: 'MF', CM: 'MF', CAM: 'MF', LM: 'MF', RM: 'MF',
  LW: 'FW', RW: 'FW', ST: 'FW', CF: 'FW',
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

/** Best XI: fill the formation by rating, then top up with whoever is left. */
function pickSquad(pool) {
  const byRating = pool.slice().sort((a, b) => b.rating - a.rating || a.name.localeCompare(b.name));
  const taken = new Set();
  const squad = [];
  for (const [role, count] of Object.entries(FORMATION)) {
    for (const p of byRating) {
      if (squad.filter(x => x.pos === role).length >= count) break;
      if (taken.has(p) || p.pos !== role) continue;
      taken.add(p);
      squad.push(p);
    }
  }
  // A nation with no keeper in the dataset must still field one, so hold that
  // shirt back for buildTeam to generate rather than handing it to an outfielder.
  const reserved = squad.some(p => p.pos === 'GK') ? 0 : 1;

  // A thin nation may have four midfielders and no left-back; rather than invent
  // one, give the shirt to the next best player it actually has.
  for (const p of byRating) {
    if (squad.length >= SQUAD_SIZE - reserved) break;
    if (taken.has(p)) continue;
    taken.add(p);
    squad.push(p);
  }
  return squad.sort((a, b) => b.rating - a.rating);
}

const mean = xs => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

const rows = parseCsv(await readFile(source, 'utf8'));
const header = rows[0];
const col = name => {
  const i = header.indexOf(name);
  if (i < 0) throw new Error(`CSV is missing the "${name}" column`);
  return i;
};
const [cName, cPositions, cOverall, cNationality] = ['short_name', 'player_positions', 'overall', 'nationality_name'].map(col);

const nameToId = {};
for (const [id, rec] of Object.entries(NATIONS)) nameToId[rec[0]] = id;

const pools = {};
let offMap = 0;
for (const row of rows.slice(1)) {
  if (row.length < header.length) continue;
  const id = nameToId[NATION_ALIASES[row[cNationality]] || row[cNationality]];
  if (!id) { offMap++; continue; }
  const primary = row[cPositions].split(',')[0].trim();
  const role = ROLE_OF_POSITION[primary];
  if (!role) continue;
  (pools[id] = pools[id] || []).push({
    name: row[cName],
    pos: role,
    rating: Math.min(MAX_RATING, Number(row[cOverall])),
  });
}

const rosters = {};
const report = { full: 0, thin: 0, empty: [] };
for (const id of Object.keys(NATIONS)) {
  const pool = pools[id];
  if (!pool || !pool.length) { report.empty.push(id); continue; }
  const squad = pickSquad(pool);
  // Team strength is squad depth across a full XI, so teamEff can blend it with
  // the top five and stop a nation with one superstar outranking a uniformly
  // strong side. Slots the dataset cannot fill count at the confederation's
  // baseline — the same assumption buildTeam makes when it generates the
  // remainder — otherwise a country with a single 62-rated player would rate as
  // highly as a deep squad averaging 62.
  const baseline = CONF_META[NATIONS[id][2]].baseStr;
  const ratings = squad.map(p => p.rating);
  const filled = ratings.concat(Array(Math.max(0, SQUAD_SIZE - ratings.length)).fill(baseline));
  const str = Math.round(mean(filled));
  rosters[id] = { str, pool: pool.length, squad };
  if (squad.length >= SQUAD_SIZE) report.full++; else report.thin++;
}

const body = Object.entries(rosters)
  .map(([id, r]) => {
    const players = r.squad.map(p => `[${JSON.stringify(p.name)},'${p.pos}',${p.rating}]`).join(',');
    return `  '${id}': [${r.str},${r.pool},[${players}]], // ${NATIONS[id][0]}`;
  })
  .join('\n');

const out = `// GENERATED by scripts/build-rosters.mjs from an EA Sports FC player export.
// Do not edit by hand — re-run \`npm run build-rosters\` instead.
//
// Real players, real ratings. Each entry is [strength, poolSize, squad], where
// squad is [name, role, rating] picked as the best available 4-4-2 for that
// nationality, strength is the squad's mean rating, and poolSize is how many
// players the dataset had for that nation (a depth signal, not used in play).
//
// Ratings are EA overalls, already on a 1-${MAX_RATING} scale.

export const ROSTERS = {
${body}
};
`;

await writeFile(path.join(root, 'src', 'data', 'rosters.js'), out);

const total = Object.keys(NATIONS).length;
console.log(`source: ${path.relative(root, source)} — ${rows.length - 1} players, ${offMap} not on our map`);
console.log(`wrote src/data/rosters.js`);
console.log(`  ${report.full}/${total} nations field a full XI of real players`);
console.log(`  ${report.thin}/${total} field a short real squad (dataset too thin)`);
console.log(`  ${report.empty.length}/${total} have no players in the dataset and stay generated:`);
console.log(`    ${report.empty.map(id => NATIONS[id][0]).join(', ')}`);
