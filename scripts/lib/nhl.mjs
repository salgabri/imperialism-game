// Ice hockey's teams from the NHL snapshot (scripts/data/nhl-27.json, npm run sync:nhl): the NHL's clubs and its
// national teams, each with the lineup the game itself picks and a club's depth. No I/O here.
//
// EA publishes only NHL 27's top 300 players, 84 and up, and a club's lineup needs nineteen. Everyone else on an NHL
// roster gets an estimate, always shown as one (`sourceInfo.source` 'estimate'), by the computed seasons' value
// (docs/design/computed-ratings.md, step 3; `estimateValues`): how much his club played him (his share of its ice time,
// a goalie's of its minutes) blended with what he produced (points a game, a goalie's saves above the league's), each
// rate shrunk toward replacement by a prior measured from the league's own players, with the weights tuned on EA's
// editions (scripts/lib/nhl-computed.mjs BLEND). The players EA leaves out are ranked by it within their group, and that
// order is spread evenly from 83, just under EA's cut-off, down to the bottom of the league (ESTIMATE_RANGE). EA's own
// ratings are never changed.
//
// A nation fields every player of its own: by EA's nationality for a player EA rates, else by the country the NHL says
// he was born in. A place a nation cannot fill is the game's to fill with a generated player at the nation's strength,
// as in baseball; that strength counts those places at the sport's baseline.
import { NATIONS, nationIdentity, selectLineup } from '../../src/data/teams.js';
import { BASELINE, hockey } from '../../src/sports/hockey.js';
import { namesOfTheDay } from '../../src/data/namesOfTheDay.js';
import { NOISE, mean, priorFromNoise, replacementRate, shrunkRate, variance } from './computed-ratings.mjs';
import { BLEND, groupOf } from './nhl-computed.mjs';

const SPORT = 'hockey';
export const ROSTER_SIZE = 23;
const ORDER = ['C', 'LW', 'RW', 'D', 'G'];

/** The estimates' ranges, in rating points: the best player EA leaves out, and the last of his group. */
export const ESTIMATE_RANGE = Object.freeze({ top: 83, skater: 72, goalie: 70 });

/** Where a player EA rates comes from, by EA's nationality; every nation that holds one is here. */
const NATION_OF_EA = {
  Australia: '036', Austria: '040', Belarus: '112', Canada: '124', Czechia: '203', 'Czech Republic': '203', Denmark: '208', Finland: '246',
  France: '250', Germany: '276', 'Great Britain': '826', Italy: '380', Kazakhstan: '398', Latvia: '428', Netherlands: '528', Norway: '578',
  Russia: '643', 'Russian Federation': '643', Slovakia: '703', Slovenia: '705', Sweden: '752', Switzerland: '756', Ukraine: '804', USA: '840',
  'United States': '840',
};
/** Where a player was born, by the NHL's country code (ISO 3166 alpha-3; the earlier seasons' sources add a few more). */
const NATION_OF_BIRTH = {
  AUS: '036', AUT: '040', BEL: '056', BGR: '100', BHS: '044', BLR: '112', BRA: '076', BRN: '096', CAN: '124', CHE: '756', CHN: '156', CZE: '203',
  DEU: '276', DNK: '208', EST: '233', FIN: '246', FRA: '250', GBR: '826', HRV: '191', HTI: '332', HUN: '348', IDN: '360', IRL: '372', ITA: '380',
  JAM: '388', JPN: '392', KAZ: '398', KOR: '410', LBN: '422', LTU: '440', LVA: '428', NGA: '566', NLD: '528', NOR: '578', POL: '616', PRY: '600',
  ROU: '642', RUS: '643', SRB: '688', SVK: '703', SVN: '705', SWE: '752', TWN: '158', TZA: '834', UKR: '804', USA: '840', UZB: '860', VEN: '862',
  ZAF: '710',
};
/** The game's nation for the NHL's birth-country code (ISO 3166 alpha-3), or null for one it does not know. */
export const nationOfBirth = code => NATION_OF_BIRTH[code] ?? null;

const byRating = (a, b) => b.rating - a.rating || a.name.localeCompare(b.name);

/** The snapshot's row as a player, without a rating yet. */
export function playerOf([id, name, team, pos, born, eaNation, overall, games, seconds, points, shots, saves]) {
  if (!ORDER.includes(pos)) throw new Error(`Unknown position ${pos} (${name})`);
  const nation = eaNation ? NATION_OF_EA[eaNation] : born ? NATION_OF_BIRTH[born] : null;
  if (eaNation && !nation) throw new Error(`No nation for EA's nationality ${JSON.stringify(eaNation)} (${name})`);
  if (!eaNation && born && !nation) throw new Error(`No nation for the birth country ${JSON.stringify(born)} (${name})`);
  return { id, name, team, pos, nation, overall, games, seconds, points, shots, saves };
}

/**
 * Every player's value, the computed seasons' (docs/design/computed-ratings.md, step 3), from the snapshot's line: his
 * games, seconds on the ice and points, a goalie's shots faced and saves, over 2025/26 and the season under way. Within
 * each group (forwards, defenders, goalies), over the league's whole roster, EA's players included:
 * - selection: his share of the club's ice time a game (a goalie's, of its minutes), the club's games being the most
 *   any skater played;
 * - production: points a game, or a goalie's saves above the league's save percentage a shot, shrunk toward replacement
 *   (the rate of the quarter of the group with the least exposure) by the prior the league's regulars give (noise per
 *   unit of exposure over talent variance, by the method of moments among the players with a quarter of the games);
 * - value: (1 − p)·z(selection) + p·z(production), each z-score by the regulars, p the computed seasons' weight where the
 *   source keeps ice time (BLEND.production: forwards 0.8, defenders 0.65, goalies by saves 0.5).
 * → Map player → value.
 */
export function estimateValues(players) {
  const skaters = players.filter(p => p.pos !== 'G'), goalies = players.filter(p => p.pos === 'G');
  const games = Math.max(...skaters.map(p => p.games));
  const shots = goalies.reduce((sum, p) => sum + p.shots, 0), saves = goalies.reduce((sum, p) => sum + p.saves, 0);
  if (!(games > 0 && shots > 0)) throw new Error('No games or no shots to measure the league by');
  const league = saves / shots;
  const values = new Map();
  for (const group of ['F', 'D', 'G']) {
    const goalie = group === 'G';
    const rows = players.filter(p => groupOf(p.pos) === group).map(p => ({
      player: p, n: goalie ? p.shots : p.games, x: goalie ? p.saves - p.shots * league : p.points,
      selection: goalie ? p.seconds / 3600 / games : p.seconds / 60 / games, regular: p.games >= games / 4,
    }));
    const regulars = rows.filter(r => r.regular && r.n > 0);
    const { k } = priorFromNoise(regulars, { least: 0, unitNoise: goalie ? () => league * (1 - league) : NOISE.poisson });
    const replacement = replacementRate(rows);
    for (const r of rows) r.production = shrunkRate(r, k, replacement);
    const scale = key => {
      const list = regulars.map(r => r[key]), m = mean(list), sd = Math.sqrt(variance(list));
      return value => (value - m) / sd;
    };
    const zSelection = scale('selection'), zProduction = scale('production');
    const p = BLEND.production[group][goalie ? 'saves' : 'ice'];
    for (const r of rows) values.set(r.player, (1 - p) * zSelection(r.selection) + p * zProduction(r.production));
  }
  return values;
}

/**
 * Each player with a `rating`: EA's overall, unchanged, or an estimate marked `estimated`: the players EA leaves out,
 * ranked within their group by their value (estimateValues; a tie by name), spread evenly from ESTIMATE_RANGE.top down
 * to the group's floor (72 for skaters, 70 for goalies). The user chose this straight line on 2026-11-18 over NHL 22's
 * shape below its top 300, which packs the depth players into 77 to 83 and brings the clubs closer together than the
 * NHL's are (docs/design/hockey.md, "Data").
 */
export function ratePlayers(players) {
  const values = estimateValues(players);
  const rating = new Map();
  for (const group of ['F', 'D', 'G']) {
    const low = group === 'G' ? ESTIMATE_RANGE.goalie : ESTIMATE_RANGE.skater;
    const ranked = players.filter(p => p.overall === null && groupOf(p.pos) === group)
      .sort((x, y) => values.get(y) - values.get(x) || x.name.localeCompare(y.name));
    ranked.forEach((player, i) => rating.set(player, Math.round(ESTIMATE_RANGE.top - (ESTIMATE_RANGE.top - low) * i / Math.max(1, ranked.length - 1))));
  }
  return players.map(player => (player.overall !== null ? { ...player, rating: player.overall, estimated: false }
    : { ...player, rating: rating.get(player), estimated: true }));
}

/** The lineup the game picks from `pool`, then a backup goalie and the best skaters left, up to a roster of 23. */
export function rosterOf(pool) {
  const lineup = selectLineup({ sport: SPORT, squad: pool });
  const starters = new Set(lineup.starters.map(player => player.originalIndex));
  const rest = pool.filter((player, i) => !starters.has(i));
  const backup = rest.find(player => player.pos === 'G');
  const skaters = rest.filter(player => player.pos !== 'G');
  const depth = [...(backup ? [backup] : []), ...skaters].slice(0, ROSTER_SIZE - lineup.starters.length);
  const squad = [...lineup.starters.map(player => pool[player.originalIndex]), ...depth]
    .sort((a, b) => ORDER.indexOf(a.pos) - ORDER.indexOf(b.pos) || byRating(a, b));
  return { squad, lineup: selectLineup({ sport: SPORT, squad }) };
}

/** A squad player as the game's files hold it: `[name, 'C', rating, source]`, the source naming EA's edition or an estimate. */
export const tupleOf = p => [p.name, p.pos, p.rating, p.estimated ? { source: 'estimate', edition: 'Estimated' } : { source: 'ea-nhl', edition: 'NHL 27' }];

/**
 * The clubs, strongest first: each `{ id, name, code, str, squad }` from the players filed under its code. Throws when a
 * club cannot ice a goalie and six defenders of its own.
 */
export function clubsOf(players, teams) {
  return Object.entries(teams).map(([id, team]) => {
    const pool = players.filter(player => player.team === team.code).sort(byRating);
    const { squad, lineup } = rosterOf(pool);
    const crossing = lineup.slots.filter(slot => !slot.player || slot.penalty > 4);
    if (crossing.length) throw new Error(`${team.name} cannot fill: ${crossing.map(slot => slot.position).join(', ')}`);
    return { id, name: team.name, code: team.code, str: lineup.rating, squad };
  }).sort((a, b) => b.str - a.str || a.name.localeCompare(b.name));
}

/**
 * The nations, strongest first, each `{ id, name, str, squad, open }`: `open` the lineup places its own players cannot
 * fill (counted at the baseline in `str`). `year`: an earlier season's end year, whose nations go by their names of the
 * day (src/data/namesOfTheDay.js: Czechoslovakia to 1991/92); today's names without one.
 */
export function nationsOf(players, year = null) {
  const day = namesOfTheDay(SPORT, year);
  const pools = new Map();
  for (const player of players) {
    if (player.nation == null) continue;
    if (!NATIONS[player.nation]) throw new Error(`${player.name}: the game has no nation ${player.nation}`);
    if (!pools.has(player.nation)) pools.set(player.nation, []);
    pools.get(player.nation).push(player);
  }
  return [...pools.entries()].map(([id, pool]) => {
    const { squad } = rosterOf(pool.slice().sort(byRating));
    return { id, name: day[id]?.name ?? nationIdentity(id, hockey).name, ...nationStrength(squad), squad };
  }).sort((a, b) => b.str - a.str || a.name.localeCompare(b.name));
}

/**
 * A nation's strength from its squad: the mean of its lineup's places at their effective ratings, a place its own
 * players cannot fill at the baseline → `{ str, open }` (`open` those places).
 */
export function nationStrength(squad) {
  const lineup = selectLineup({ sport: SPORT, squad });
  const covered = lineup.slots.map(slot => (slot.player && slot.penalty <= 4 ? slot.effectiveRating : BASELINE));
  return { str: Math.round(covered.reduce((s, v) => s + v, 0) / covered.length),
    open: lineup.slots.filter(slot => !slot.player || slot.penalty > 4).map(slot => slot.position) };
}
