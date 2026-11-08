// Ice hockey's teams from the NHL snapshot (scripts/data/nhl-27.json, npm run sync:nhl): the NHL's clubs and its
// national teams, each with the lineup the game itself picks and a club's depth. No I/O here.
//
// EA publishes only NHL 27's top 300 players, 84 and up, and a club's lineup needs nineteen. Everyone else on an NHL
// roster gets an estimate, always shown as one (`sourceInfo.source` 'estimate'): the players EA leaves out are put in
// order by what they do on the ice, within their group, and that order is spread evenly from 83, just under EA's
// cut-off, down to the bottom of the league (ESTIMATE_RANGE). Forwards and defenders rank by minutes a game and points
// a game, goalies by save percentage. A few games prove little, so each line starts from a replacement player's
// numbers (PRIOR). EA's own ratings are never changed.
//
// A nation fields every player of its own: by EA's nationality for a player EA rates, else by the country the NHL says
// he was born in. A place a nation cannot fill is the game's to fill with a generated player at the nation's strength,
// as in baseball; that strength counts those places at the sport's baseline.
import { NATIONS, selectLineup } from '../../src/data/teams.js';
import { BASELINE } from '../../src/sports/hockey.js';

const SPORT = 'hockey';
export const ROSTER_SIZE = 23;
const ORDER = ['C', 'LW', 'RW', 'D', 'G'];
const FORWARDS = new Set(['C', 'LW', 'RW']);

/** The estimates' ranges, in rating points: the best player EA leaves out, and the last of his group. */
export const ESTIMATE_RANGE = Object.freeze({ top: 83, skater: 72, goalie: 70 });
// A replacement player's line, added to each player's own: ten games at nine minutes and a point every ten games; 300
// shots faced at .880.
const PRIOR = Object.freeze({ games: 10, minutes: 9, points: 0.1, shots: 300, savePct: 0.88 });
// What a point a game is worth against minutes on the ice: forwards are there to score, defenders much less.
const POINT_WEIGHT = { forward: 8, defender: 5 };

/** Where a player EA rates comes from, by EA's nationality; every nation that holds one is here. */
const NATION_OF_EA = {
  Australia: '036', Austria: '040', Belarus: '112', Canada: '124', Czechia: '203', 'Czech Republic': '203', Denmark: '208', Finland: '246',
  France: '250', Germany: '276', 'Great Britain': '826', Italy: '380', Kazakhstan: '398', Latvia: '428', Netherlands: '528', Norway: '578',
  Russia: '643', 'Russian Federation': '643', Slovakia: '703', Slovenia: '705', Sweden: '752', Switzerland: '756', Ukraine: '804', USA: '840',
  'United States': '840',
};
/** Where a player was born, by the NHL's country code. */
const NATION_OF_BIRTH = {
  AUS: '036', AUT: '040', BLR: '112', BRA: '076', CAN: '124', CHE: '756', CHN: '156', CZE: '203', DEU: '276', DNK: '208', EST: '233', FIN: '246',
  FRA: '250', GBR: '826', HRV: '191', HUN: '348', ITA: '380', JPN: '392', KAZ: '398', KOR: '410', LTU: '440', LVA: '428', NGA: '566', NLD: '528',
  NOR: '578', POL: '616', ROU: '642', RUS: '643', SRB: '688', SVK: '703', SVN: '705', SWE: '752', UKR: '804', USA: '840', UZB: '860',
};

const byRating = (a, b) => b.rating - a.rating || a.name.localeCompare(b.name);

/** The snapshot's row as a player, without a rating yet. */
export function playerOf([id, name, team, pos, born, eaNation, overall, games, seconds, points, shots, saves]) {
  if (!ORDER.includes(pos)) throw new Error(`Unknown position ${pos} (${name})`);
  const nation = eaNation ? NATION_OF_EA[eaNation] : born ? NATION_OF_BIRTH[born] : null;
  if (eaNation && !nation) throw new Error(`No nation for EA's nationality ${JSON.stringify(eaNation)} (${name})`);
  if (!eaNation && born && !nation) throw new Error(`No nation for the birth country ${JSON.stringify(born)} (${name})`);
  return { id, name, team, pos, nation, overall, games, seconds, points, shots, saves };
}

/** How a player EA leaves out ranks in his group: minutes and points a game for a skater, save percentage for a goalie. */
export function estimateScore({ pos, games, seconds, points, shots, saves }) {
  if (pos === 'G') return (saves + PRIOR.shots * PRIOR.savePct) / (shots + PRIOR.shots);
  const played = games + PRIOR.games;
  const minutes = (seconds / 60 + PRIOR.games * PRIOR.minutes) / played;
  const perGame = (points + PRIOR.games * PRIOR.points) / played;
  return minutes + (FORWARDS.has(pos) ? POINT_WEIGHT.forward : POINT_WEIGHT.defender) * perGame;
}

/** Each player with a `rating`: EA's overall, unchanged, or an estimate marked `estimated`. */
export function ratePlayers(players) {
  const groups = { forward: [], defender: [], goalie: [] };
  for (const player of players) {
    if (player.overall !== null) continue;
    groups[player.pos === 'G' ? 'goalie' : player.pos === 'D' ? 'defender' : 'forward'].push(player);
  }
  const rating = new Map();
  for (const [group, list] of Object.entries(groups)) {
    const low = group === 'goalie' ? ESTIMATE_RANGE.goalie : ESTIMATE_RANGE.skater;
    const ranked = list.map(player => [player, estimateScore(player)]).sort((a, b) => b[1] - a[1] || a[0].name.localeCompare(b[0].name));
    ranked.forEach(([player], i) => rating.set(player, Math.round(ESTIMATE_RANGE.top - (ESTIMATE_RANGE.top - low) * i / Math.max(1, ranked.length - 1))));
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
 * fill (counted at the baseline in `str`).
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
    const open = lineup.slots.filter(slot => !slot.player || slot.penalty > 4);
    const covered = lineup.slots.map(slot => (slot.player && slot.penalty <= 4 ? slot.effectiveRating : BASELINE));
    return { id, name: NATIONS[id][0], str: Math.round(covered.reduce((s, v) => s + v, 0) / covered.length), squad, open: open.map(slot => slot.position) };
  }).sort((a, b) => b.str - a.str || a.name.localeCompare(b.name));
}
