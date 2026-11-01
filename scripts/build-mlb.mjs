// Build baseball's teams from the committed MLB The Show snapshot (scripts/data/mlb-the-show-26.json, npm run
// sync:mlb-the-show): the 30 MLB clubs (src/data/clubs.baseball.js, named from scripts/data/mlb-teams.json) and the
// national teams (src/data/rosters.baseball.js), every Live card filed under the nation of its birthplace.
//
// The Show lists a primary position and the others a player can field; the closer (CP) is a reliever (RP), and any
// hitter can be the designated hitter. A lineup is the batting order's nine (C, 1B, 2B, 3B, SS, LF, CF, RF, DH), the
// day's starter and three relievers: the lineup the game itself picks from the whole roster. A club keeps its active
// roster of 26 beside it (DEPTH): a second catcher, three more hitters, the rest of a five-man rotation and of an
// eight-man bullpen. Ratings are The Show's overalls, unchanged.
//
// Clubs come from their 40-man rosters. Nations take every Live card, free agents included (The Show files players
// off a 40-man roster, the injured among them, as free agents), by birthplace: a US state, Washington DC, Guam and the
// Virgin Islands are the United States'; Curaçao and Aruba play for the Kingdom of the Netherlands, as in the World
// Baseball Classic. A nation that cannot field a lineup slot from its own players leaves it to the game, which fields
// a generated player there at the nation's strength; that strength counts those slots at the sport's baseline.
//
// Usage: node scripts/build-mlb.mjs [--check]
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { NATIONS, selectLineup } from '../src/data/teams.js';
import { BASELINE } from '../src/sports/baseball.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const snapshotFile = path.join(root, 'scripts/data/mlb-the-show-26.json');
const teamsFile = path.join(root, 'scripts/data/mlb-teams.json');
const clubsFile = path.join(root, 'src/data/clubs.baseball.js');
const rostersFile = path.join(root, 'src/data/rosters.baseball.js');

const SPORT = 'baseball';
const FREE_AGENTS = 'FA';
const POSITION_OF = { C: 'C', '1B': '1B', '2B': '2B', '3B': '3B', SS: 'SS', LF: 'LF', CF: 'CF', RF: 'RF', DH: 'DH', SP: 'SP', RP: 'RP', CP: 'RP' };
const ORDER = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH', 'SP', 'RP'];
const PITCHING = new Set(['SP', 'RP']);
// Kept beyond the lineup: a second catcher, three more hitters, four more starters and five more relievers (26).
const DEPTH = { C: 1, hitters: 3, SP: 4, RP: 5 };
const US_STATES = ['Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut', 'Delaware', 'Florida', 'Georgia',
  'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa', 'Kansas', 'Kentucky', 'Louisiana', 'Maine', 'Maryland', 'Massachusetts', 'Michigan',
  'Minnesota', 'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'Nevada', 'New Hampshire', 'New Jersey', 'New Mexico', 'New York',
  'North Carolina', 'North Dakota', 'Ohio', 'Oklahoma', 'Oregon', 'Pennsylvania', 'Rhode Island', 'South Carolina', 'South Dakota',
  'Tennessee', 'Texas', 'Utah', 'Vermont', 'Virginia', 'Washington', 'West Virginia', 'Wisconsin', 'Wyoming'];
/** Birthplace → the game's nation id. */
const NATION_OF = {
  ...Object.fromEntries(US_STATES.map(state => [state, '840'])),
  'Washington DC': '840', Guam: '840', 'Virgin Islands': '840',
  'Dominican Republic': '214', Venezuela: '862', Cuba: '192', 'Puerto Rico': '630', Canada: '124', Mexico: '484', Japan: '392',
  Colombia: '170', 'South Korea': '410', Panama: '591', Australia: '036', Taiwan: '158', Nicaragua: '558', Curacao: '528',
  Aruba: '528', Netherlands: '528', Bahamas: '044', Italy: '380', Germany: '276', 'South Africa': '710', 'Great Britain': '826',
  Honduras: '340', 'Russian Federation': '643', Slovakia: '703',
};

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
/** Distinct, readable colours spread around the hue wheel (as build-clubs gives the other sports' clubs). */
const colourFor = id => `oklch(0.72 0.16 ${hashStr(id) % 360})`;
const byRating = (a, b) => b.rating - a.rating || a.name.localeCompare(b.name);
const pitches = player => PITCHING.has(player.pos);

const snapshot = JSON.parse(await readFile(snapshotFile, 'utf8'));
const franchises = JSON.parse(await readFile(teamsFile, 'utf8')).teams;
const byShow = new Map(Object.entries(franchises).map(([id, team]) => [team.show, { id, ...team }]));
for (const [code, label] of Object.entries(snapshot.teams)) {
  if (code === FREE_AGENTS) continue;
  const team = byShow.get(code);
  if (!team || !team.name.endsWith(label)) throw new Error(`The Show's team ${code} (${label}) is not in mlb-teams.json`);
}
if (byShow.size !== Object.keys(snapshot.teams).filter(code => code !== FREE_AGENTS).length) {
  throw new Error('mlb-teams.json lists a team the snapshot does not have');
}

/** A Live card as a squad player: The Show's primary position first, then the others it can field. */
function playerOf([, name, , listed, secondary, overall, born]) {
  const pos = POSITION_OF[listed];
  if (!pos) throw new Error(`Unknown MLB The Show position ${listed} (${name})`);
  const others = secondary ? secondary.split(',').map(code => {
    if (!POSITION_OF[code]) throw new Error(`Unknown MLB The Show position ${code} (${name})`);
    return POSITION_OF[code];
  }) : [];
  if (!NATION_OF[born]) throw new Error(`No nation for the birthplace ${JSON.stringify(born)} (${name})`);
  return { name, pos, positions: [...new Set([pos, ...others])], rating: overall, nation: NATION_OF[born] };
}

/**
 * The lineup the game picks from `pool`, then its depth (DEPTH) → { squad, lineup }. `pool` is sorted strongest first,
 * so equal ratings keep a stable order.
 */
function rosterOf(pool) {
  const lineup = selectLineup({ sport: SPORT, squad: pool });
  const starters = new Set(lineup.starters.map(player => player.originalIndex));
  const left = { ...DEPTH };
  const rest = pool.filter((player, i) => !starters.has(i));
  const take = test => {
    const at = rest.findIndex(test);
    return at < 0 ? null : rest.splice(at, 1)[0];
  };
  // Short of a second catcher, another hitter takes the place; short of starters or relievers, the other pitchers.
  const backups = [];
  const fill = (count, test, instead) => {
    for (let k = 0; k < count; k++) { const p = take(test) || take(instead); if (p) backups.push(p); }
  };
  fill(left.C, player => player.pos === 'C', player => !pitches(player));
  fill(left.hitters, player => !pitches(player), () => false);
  fill(left.SP, player => player.pos === 'SP', pitches);
  fill(left.RP, player => player.pos === 'RP', pitches);
  const squad = [...lineup.starters.map(player => pool[player.originalIndex]), ...backups]
    .sort((a, b) => ORDER.indexOf(a.pos) - ORDER.indexOf(b.pos) || byRating(a, b));
  return { squad, lineup: selectLineup({ sport: SPORT, squad }) };
}

const tuple = p => `[${JSON.stringify(p.name)},'${p.positions.join('/')}',${p.rating}]`;
const players = snapshot.players.map(row => ({ ...playerOf(row), team: row[2] }));

// ---------- the clubs ----------

const clubs = [...byShow.values()].map(team => {
  const pool = players.filter(player => player.team === team.show).sort(byRating);
  const { squad, lineup } = rosterOf(pool);
  if (lineup.slots.some(slot => slot.outOfPosition || !slot.player)) {
    throw new Error(`${team.name} cannot field every position: ${lineup.slots.filter(slot => slot.outOfPosition || !slot.player).map(slot => slot.position).join(', ')}`);
  }
  if (squad.length !== 26) throw new Error(`${team.name} keeps ${squad.length} players, not an active roster of 26`);
  return { id: team.id, name: team.name, code: team.code, col: colourFor(team.id), str: lineup.rating, squad };
}).sort((a, b) => b.str - a.str || a.name.localeCompare(b.name));

// ---------- the nations ----------

const nations = new Map();
for (const player of players) {
  if (!NATIONS[player.nation]) throw new Error(`${player.name}: the game has no nation ${player.nation}`);
  if (!nations.has(player.nation)) nations.set(player.nation, []);
  nations.get(player.nation).push(player);
}
const rosters = [...nations.entries()].map(([id, pool]) => {
  const { squad, lineup } = rosterOf(pool.slice().sort(byRating));
  // A slot the nation's own players cannot fill naturally is the game's to fill, at the sport's baseline.
  const covered = lineup.slots.map(slot => (slot.player && !slot.outOfPosition ? slot.effectiveRating : BASELINE));
  const str = Math.round(covered.reduce((s, v) => s + v, 0) / covered.length);
  return { id, name: NATIONS[id][0], str, squad, open: lineup.slots.filter(slot => !slot.player || slot.outOfPosition).map(slot => slot.position) };
}).sort((a, b) => b.str - a.str || a.name.localeCompare(b.name));

// ---------- output ----------

const { source } = snapshot;
const SOURCE = { edition: source.edition, season: source.season, update: `Roster update ${source.rosterUpdate.id} (${source.rosterUpdate.name})`,
  retrieved: source.retrieved, url: source.docs };
const clubsText = `// GENERATED by scripts/build-mlb.mjs from scripts/data/mlb-the-show-26.json; do not edit.
//
// The 30 MLB clubs of ${source.edition} (${SOURCE.update}, retrieved ${source.retrieved} from the game's public API),
// each from its 40-man roster. Each fields the lineup the game picks from its whole roster — C, 1B, 2B, 3B, SS, LF, CF,
// RF and a designated hitter; the day's starter and three relievers — then the rest of its active roster of 26.
// Positions list The Show's primary position first, then the others the player can field; ratings are The Show's
// overalls, unchanged.

export const SOURCE = ${JSON.stringify(SOURCE)};

export const CLUBS = [
${clubs.map(c => `  { id: '${c.id}', name: ${JSON.stringify(c.name)}, code: '${c.code}', league: 'MLB', country: '840', col: '${c.col}', str: ${c.str}, squad: [${c.squad.map(tuple).join(',')}] },`).join('\n')}
];
`;
const rostersText = `// GENERATED by scripts/build-mlb.mjs from scripts/data/mlb-the-show-26.json; do not edit.
//
// National teams by birthplace: every Live card of ${source.edition} (${SOURCE.update}), free agents included, filed
// under the nation it was born in (Curaçao and Aruba under the Kingdom of the Netherlands, as in the World Baseball
// Classic). Each entry is [strength, realCount, squad], where squad is [name, positions, rating]: the lineup the game
// picks from the nation's players, then up to a club's depth. Strength counts a lineup slot no player of the nation can
// fill naturally at the sport's baseline; the game fields a generated player there.

export const ROSTERS = {
${rosters.map(r => `  '${r.id}': [${r.str},${r.squad.length},[${r.squad.map(tuple).join(',')}]], // ${r.name}`).join('\n')}
};
`;

if (process.argv.includes('--check')) {
  let differs = false;
  for (const [file, text] of [[clubsFile, clubsText], [rostersFile, rostersText]]) {
    const current = (await readFile(file, 'utf8')).replace(/\r\n/g, '\n');
    if (current !== text) { console.error(`differs: ${path.relative(root, file)}`); differs = true; }
  }
  if (differs) process.exit(1);
  console.log('Verified the MLB clubs and the baseball nations byte for byte.');
} else {
  await writeFile(clubsFile, clubsText);
  await writeFile(rostersFile, rostersText);
  console.log(`Wrote ${clubs.length} MLB clubs to ${path.relative(root, clubsFile)}`);
  console.log(`  strongest: ${clubs.slice(0, 6).map(c => `${c.name} ${c.str}`).join(', ')}`);
  console.log(`  weakest: ${clubs.slice(-4).map(c => `${c.name} ${c.str}`).join(', ')}`);
  console.log(`Wrote ${rosters.length} nations to ${path.relative(root, rostersFile)}`);
  for (const r of rosters) console.log(`  ${r.name} ${r.str}: ${r.squad.length} players${r.open.length ? `, the game fills ${r.open.join(' ')}` : ''}`);
}
