// Rugby league's teams from the NRL snapshot (scripts/data/rugby-league-26.json, npm run sync:nrl): the NRL's clubs and
// the national teams, each with the matchday 17 the game itself picks and a club's depth. No I/O here.
//
// Every rating is Rugby League 26's overall, unchanged; nothing is estimated. A player's positions are Zero Tackle's, and
// any other he started at least twice in the 2025 NRL season.
//
// A player plays for the nation he played a Test for in 2025 (the Ashes and the Pacific Championships). Tonga, Samoa and
// the Cook Islands have no land on the game's world map, so their players play for no nation. A player without a 2025
// Test plays for the country he was born in, or, born off the map or where Zero Tackle does not say, for the first
// nation on the map he is eligible for. A place a nation cannot fill is the game's to fill with a generated player at
// the nation's strength, as in hockey; that strength counts those places at the sport's baseline.
import { NATIONS, RUGBY_NEAR_PENALTY, selectLineup } from '../../src/data/teams.js';
import { BASELINE } from '../../src/sports/rugbyLeague.js';

const SPORT = 'rugby-league';
export const ROSTER_SIZE = 24;
const ORDER = ['FB', 'WG', 'CE', 'FE', 'HB', 'HK', 'PR', 'SR', 'LK'];

/** The 2025 Test sides, as the snapshot names them → the game's nation, or null for a side with no land on the map. */
export const NATION_OF_TEST = {
  Australia: '036', 'New Zealand': '554', England: '826', 'Papua New Guinea': '598', Fiji: '242', 'South Africa': '710',
  Tonga: null, Samoa: null, 'Cook Islands': null,
};
// Where a birthplace is: the last part of Zero Tackle's place ("Newcastle, NSW"), or that part's last word ("Auckland
// NZ"). Null for a country with no land on the map, and for a place Zero Tackle leaves blank ("-") or names only as the
// United Kingdom (one player, an England international).
const AUSTRALIA = ['NSW', 'QLD', 'Qld', 'VIC', 'ACT', 'SA', 'WA', 'TAS', 'NT', 'New South Wales', 'Queensland', 'Victoria',
  'Australian Capital Territory', 'South Australia', 'Western Australia', 'Tasmania', 'Northern Territory', 'Australia'];
const COUNTRY_OF_PLACE = {
  ...Object.fromEntries(AUSTRALIA.map(place => [place, '036'])),
  'New Zealand': '554', NZ: '554', 'Papua New Guinea': '598', PNG: '598', Fiji: '242', FIJ: '242', England: '826', ENG: '826',
  Scotland: 'SCO', Wales: 'WAL', Ireland: '372', 'Northern Ireland': '372', France: '250', Lebanon: '422', Italy: '380',
  'South Africa': '710', 'United States': '840', USA: '840', Japan: '392',
  Tonga: null, Samoa: null, SAM: null, 'American Samoa': null, 'Cook Islands': null, Niue: null, 'Hong Kong': null, UK: null, '-': null,
};
// The nations Zero Tackle lists a player eligible for (its states, New South Wales and Queensland, are not nations).
const NATION_OF_ELIGIBILITY = {
  Australia: '036', 'New Zealand': '554', England: '826', Fiji: '242', 'Papua New Guinea': '598', Lebanon: '422',
  Scotland: 'SCO', Wales: 'WAL', Ireland: '372', Italy: '380', Greece: '300', France: '250', Samoa: null, Tonga: null,
  'Cook Islands': null, 'New South Wales': null, Queensland: null,
};

const byRating = (a, b) => b.rating - a.rating || a.name.localeCompare(b.name);

/** The country of Zero Tackle's place of birth: a nation id, null (none on the map, or no place), or undefined (unknown). */
export function birthCountry(place) {
  if (!place) return null;
  const last = place.split(',').map(part => part.trim()).filter(Boolean).at(-1) || '';
  for (const key of [last, last.split(/\s+/).at(-1)]) if (Object.hasOwn(COUNTRY_OF_PLACE, key)) return COUNTRY_OF_PLACE[key];
  return undefined;
}

/** The first nation on the map a player is eligible for, or null. */
export function eligibleNation(eligibility) {
  for (const name of eligibility) {
    if (!Object.hasOwn(NATION_OF_ELIGIBILITY, name)) throw new Error(`Unknown eligibility ${JSON.stringify(name)}`);
    if (NATION_OF_ELIGIBILITY[name]) return NATION_OF_ELIGIBILITY[name];
  }
  return null;
}

/**
 * The snapshot's row as a player: `nation` the game's nation he plays for, or null. His 2025 Test side decides, even
 * one with no land on the map; without a Test, the country he was born in; without a birthplace on the map, the first
 * nation on it he is eligible for.
 */
export function playerOf([slug, name, club, rating, pos, positions, birthplace, eligibility, test, nrlId, goals, fieldGoals]) {
  if (!ORDER.includes(pos)) throw new Error(`Unknown position ${pos} (${name})`);
  if (test && !Object.hasOwn(NATION_OF_TEST, test)) throw new Error(`No nation for the Test side ${JSON.stringify(test)} (${name})`);
  const born = birthCountry(birthplace);
  if (born === undefined) throw new Error(`No country for the birthplace ${JSON.stringify(birthplace)} (${name})`);
  const nation = test ? NATION_OF_TEST[test] : born ?? eligibleNation(eligibility);
  return { slug, name, club, rating, pos, others: positions.filter(code => ORDER.includes(code) && code !== pos), birthplace, eligibility, test,
    nrlId, goals, fieldGoals, nation };
}

/** The lineup the game picks from `pool`, then the best players left, up to a squad of 24. */
export function rosterOf(pool) {
  const lineup = selectLineup({ sport: SPORT, squad: pool });
  const starters = new Set(lineup.starters.map(player => player.originalIndex));
  const depth = pool.filter((player, i) => !starters.has(i)).slice(0, ROSTER_SIZE - lineup.starters.length);
  const squad = [...lineup.starters.map(player => pool[player.originalIndex]), ...depth]
    .sort((a, b) => ORDER.indexOf(a.pos) - ORDER.indexOf(b.pos) || byRating(a, b));
  return { squad, lineup: selectLineup({ sport: SPORT, squad }) };
}

/**
 * A squad player as the game's files hold it: `[name, 'CE/SR', rating, source]`, every position he plays, the source
 * naming the game and the goals and field goals he kicked in the 2025 NRL season (the match model's kicker).
 */
export const tupleOf = p => [p.name, [p.pos, ...p.others].join('/'), p.rating,
  { source: 'rl26', edition: 'Rugby League 26', ...(p.goals ? { goals: p.goals } : {}), ...(p.fieldGoals ? { fieldGoals: p.fieldGoals } : {}) }];

/** Shape the game reads a player in, for selectLineup: positions as rosterPlayer makes them. */
const fielded = p => ({ ...p, positions: p.others.length ? [p.pos, ...p.others] : undefined });

/**
 * The clubs, strongest first: each `{ id, name, code, str, squad }` from the players listed at its heading. Throws when a
 * club cannot field its matchday 17 without crossing units.
 */
export function clubsOf(players, teams) {
  return Object.entries(teams).map(([id, team]) => {
    const pool = players.filter(player => player.club === team.list).map(fielded).sort(byRating);
    if (!pool.length) throw new Error(`No players listed for ${team.list}`);
    const { squad, lineup } = rosterOf(pool);
    const crossing = lineup.slots.filter(slot => !slot.player || slot.penalty > RUGBY_NEAR_PENALTY);
    if (crossing.length) throw new Error(`${team.name} cannot fill: ${crossing.map(slot => slot.position).join(', ')}`);
    return { id, name: team.name, code: team.code, str: lineup.rating, squad };
  }).sort((a, b) => b.str - a.str || a.name.localeCompare(b.name));
}

/**
 * The nations, strongest first, each `{ id, name, str, squad, open }`: `open` the lineup places its own players cannot
 * fill (counted at the baseline in `str`).
 */
export function nationsOf(players) {
  const pools = new Map();
  for (const player of players) {
    if (player.nation == null) continue;
    if (!NATIONS[player.nation]) throw new Error(`${player.name}: the game has no nation ${player.nation}`);
    if (!pools.has(player.nation)) pools.set(player.nation, []);
    pools.get(player.nation).push(fielded(player));
  }
  return [...pools.entries()].map(([id, pool]) => {
    const { squad, lineup } = rosterOf(pool.slice().sort(byRating));
    const open = lineup.slots.filter(slot => !slot.player || slot.penalty > RUGBY_NEAR_PENALTY);
    const covered = lineup.slots.map(slot => (slot.player && slot.penalty <= RUGBY_NEAR_PENALTY ? slot.effectiveRating : BASELINE));
    return { id, name: NATIONS[id][0], str: Math.round(covered.reduce((s, v) => s + v, 0) / covered.length), squad, open: open.map(slot => slot.position) };
  }).sort((a, b) => b.str - a.str || a.name.localeCompare(b.name));
}
