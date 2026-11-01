// Baseball's teams from an MLB The Show snapshot (scripts/data/mlb-the-show-<nn>.json, npm run sync:mlb-the-show):
// one edition's MLB clubs and its national teams by birthplace, as the built-in season (scripts/build-mlb.mjs) and the
// earlier seasons (scripts/build-mlb-seasons.mjs) both build them. No I/O here.
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
import { NATIONS, selectLineup } from '../../src/data/teams.js';
import { BASELINE } from '../../src/sports/baseball.js';

export const FREE_AGENTS = 'FA';
const SPORT = 'baseball';
const POSITION_OF = { C: 'C', '1B': '1B', '2B': '2B', '3B': '3B', SS: 'SS', LF: 'LF', CF: 'CF', RF: 'RF', DH: 'DH', SP: 'SP', RP: 'RP', CP: 'RP' };
// A position player The Show also lists as a pitcher ("P") pitches only in a blowout: his overall rates his fielding
// and hitting, so the game does not count it.
const IGNORED_SECONDARY = new Set(['P']);
const ORDER = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH', 'SP', 'RP'];
const PITCHING = new Set(['SP', 'RP']);
// Kept beyond the lineup: a second catcher, three more hitters, four more starters and five more relievers (26).
const DEPTH = { C: 1, hitters: 3, SP: 4, RP: 5 };
export const ROSTER_SIZE = 26;
const US_STATES = ['Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut', 'Delaware', 'Florida', 'Georgia',
  'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa', 'Kansas', 'Kentucky', 'Louisiana', 'Maine', 'Maryland', 'Massachusetts', 'Michigan',
  'Minnesota', 'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'Nevada', 'New Hampshire', 'New Jersey', 'New Mexico', 'New York',
  'North Carolina', 'North Dakota', 'Ohio', 'Oklahoma', 'Oregon', 'Pennsylvania', 'Rhode Island', 'South Carolina', 'South Dakota',
  'Tennessee', 'Texas', 'Utah', 'Vermont', 'Virginia', 'Washington', 'West Virginia', 'Wisconsin', 'Wyoming'];
/** Birthplace → the game's nation id. */
const NATION_OF = {
  ...Object.fromEntries(US_STATES.map(state => [state, '840'])),
  'Washington DC': '840', 'Washington, DC': '840', Guam: '840', 'Virgin Islands': '840',
  'Dominican Republic': '214', Venezuela: '862', Cuba: '192', 'Puerto Rico': '630', Canada: '124', Mexico: '484', Japan: '392',
  Colombia: '170', 'South Korea': '410', Panama: '591', Australia: '036', Taiwan: '158', Nicaragua: '558', Curacao: '528',
  Aruba: '528', Netherlands: '528', Bahamas: '044', Italy: '380', Germany: '276', 'South Africa': '710', 'Great Britain': '826',
  Honduras: '340', 'Russian Federation': '643', Slovakia: '703', Brazil: '076', China: '156', 'Czech Republic': '203',
};

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
/** Distinct, readable colours spread around the hue wheel (as build-clubs gives the other sports' clubs). */
export const colourFor = id => `oklch(0.72 0.16 ${hashStr(id) % 360})`;
const byRating = (a, b) => b.rating - a.rating || a.name.localeCompare(b.name);
const pitches = player => PITCHING.has(player.pos);

/** The nation a birthplace belongs to, or null for one that is no place the game knows ("At Sea"). */
export const nationOfBirthplace = born => NATION_OF[born] ?? null;

/**
 * A Live card as a squad player: The Show's primary position first, then the others it can field. A birthplace that is
 * no place throws, unless `bornElsewhere(name)` gives the player's birthplace from another source (another edition);
 * failing that too, the player has no nation and plays for his club only.
 */
export function playerOf([, name, team, listed, secondary, overall, born], bornElsewhere = null) {
  const pos = POSITION_OF[listed];
  if (!pos) throw new Error(`Unknown MLB The Show position ${listed} (${name})`);
  const others = secondary ? secondary.split(',').filter(code => !IGNORED_SECONDARY.has(code)).map(code => {
    if (!POSITION_OF[code]) throw new Error(`Unknown MLB The Show position ${code} (${name})`);
    return POSITION_OF[code];
  }) : [];
  let nation = NATION_OF[born] ?? null;
  if (!nation && !bornElsewhere) throw new Error(`No nation for the birthplace ${JSON.stringify(born)} (${name})`);
  if (!nation) nation = nationOfBirthplace(bornElsewhere(name));
  return { name, team, pos, positions: [...new Set([pos, ...others])], rating: overall, nation };
}

/**
 * The lineup the game picks from `pool`, then its depth (DEPTH) → { squad, lineup }. `pool` is sorted strongest first,
 * so equal ratings keep a stable order.
 */
export function rosterOf(pool) {
  const lineup = selectLineup({ sport: SPORT, squad: pool });
  const starters = new Set(lineup.starters.map(player => player.originalIndex));
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
  fill(DEPTH.C, player => player.pos === 'C', player => !pitches(player));
  fill(DEPTH.hitters, player => !pitches(player), () => false);
  fill(DEPTH.SP, player => player.pos === 'SP', pitches);
  fill(DEPTH.RP, player => player.pos === 'RP', pitches);
  const squad = [...lineup.starters.map(player => pool[player.originalIndex]), ...backups]
    .sort((a, b) => ORDER.indexOf(a.pos) - ORDER.indexOf(b.pos) || byRating(a, b));
  return { squad, lineup: selectLineup({ sport: SPORT, squad }) };
}

/** A squad player as the game's files hold it: `[name, 'SS/2B', rating]`. */
export const tupleOf = p => [p.name, p.positions.join('/'), p.rating];

/**
 * The clubs of one edition, strongest first: each team `{ show, id, name, code, col }` fields its lineup and active
 * roster from the cards The Show files under its code. Throws when a team cannot field every position naturally.
 */
export function clubsOf(players, teams) {
  return teams.map(team => {
    const pool = players.filter(player => player.team === team.show).sort(byRating);
    const { squad, lineup } = rosterOf(pool);
    if (lineup.slots.some(slot => slot.outOfPosition || !slot.player)) {
      throw new Error(`${team.name} cannot field every position: ${lineup.slots.filter(slot => slot.outOfPosition || !slot.player).map(slot => slot.position).join(', ')}`);
    }
    if (squad.length !== ROSTER_SIZE) throw new Error(`${team.name} keeps ${squad.length} players, not an active roster of ${ROSTER_SIZE}`);
    return { id: team.id, name: team.name, code: team.code, col: team.col, str: lineup.rating, squad };
  }).sort((a, b) => b.str - a.str || a.name.localeCompare(b.name));
}

/**
 * The nations of one edition, strongest first, each `{ id, name, str, squad, open }`: every card under its birthplace's
 * nation, `open` the lineup slots its own players cannot fill (counted at the baseline in `str`).
 */
export function nationsOf(players) {
  const pools = new Map();
  for (const player of players) {
    if (player.nation == null) continue;
    if (!NATIONS[player.nation]) throw new Error(`${player.name}: the game has no nation ${player.nation}`);
    if (!pools.has(player.nation)) pools.set(player.nation, []);
    pools.get(player.nation).push(player);
  }
  return [...pools.entries()].map(([id, pool]) => {
    const { squad, lineup } = rosterOf(pool.slice().sort(byRating));
    // A slot the nation's own players cannot fill naturally is the game's to fill, at the sport's baseline.
    const covered = lineup.slots.map(slot => (slot.player && !slot.outOfPosition ? slot.effectiveRating : BASELINE));
    const str = Math.round(covered.reduce((s, v) => s + v, 0) / covered.length);
    return { id, name: NATIONS[id][0], str, squad, open: lineup.slots.filter(slot => !slot.player || slot.outOfPosition).map(slot => slot.position) };
  }).sort((a, b) => b.str - a.str || a.name.localeCompare(b.name));
}

/** The edition named for the season of `year`, as its API host and files name it: 2025 → '25'. */
export const editionOf = year => String(year % 100).padStart(2, '0');
/** The data set id of the season of `year`: 'mlb-the-show-25'. */
export const seasonIdOf = year => `mlb-the-show-${editionOf(year)}`;

/** The era map the season of `year` plays on (scripts/data/mlb-seasons.json `maps`). */
export function mapOf(manifest, year) {
  const map = manifest.maps.find(entry => entry.seasons.includes(year));
  if (!map) throw new Error(`No map for the ${year} season`);
  return map.id;
}

/**
 * The teams of season `year` (`{ show, id, name, code, city, ballpark, home }` by The Show's code): today's franchises
 * (scripts/data/mlb-teams.json) unless the manifest (scripts/data/mlb-seasons.json) names an era in which a franchise
 * played under another name or in another ballpark; such an era keeps today's city and home unless it names its own.
 */
export function teamsOf(franchises, manifest, year) {
  return Object.entries(franchises).map(([id, team]) => {
    const era = (manifest?.teams?.[team.show] || []).find(e => (e.from ?? -Infinity) <= year && year <= (e.to ?? Infinity));
    const here = { ...team, id, ...(era || {}) };
    return { show: team.show, id: here.id, name: here.name, code: here.code, city: here.city, ballpark: here.ballpark, home: here.home };
  });
}

/** Every edition's teams must be the snapshot's: each code The Show files (free agents aside) and no other. */
export function checkTeams(snapshot, teams) {
  const codes = Object.keys(snapshot.teams).filter(code => code !== FREE_AGENTS);
  const unknown = codes.filter(code => !teams.some(team => team.show === code));
  const absent = teams.filter(team => !codes.includes(team.show)).map(team => team.show);
  if (unknown.length || absent.length) {
    throw new Error(`${snapshot.source.edition}: teams ${unknown.join(', ') || 'none'} are not the game's; missing ${absent.join(', ') || 'none'}`);
  }
  for (const team of teams) {
    const label = snapshot.teams[team.show];
    if (!team.name.endsWith(label)) throw new Error(`${snapshot.source.edition}: ${team.show} is the ${label}, not the ${team.name}`);
  }
}
