// Tennis's earlier seasons (docs/design/tennis.md, "Earlier seasons"; the women's, docs/design/womens-tennis.md): the
// nation a player played for in a season, the game's nation and territory of that season, and its cup teams. No I/O:
// scripts/sync-tennis-seasons.mjs and scripts/build-tennis-seasons.mjs pass in a manifest's `nations` and the snapshots.
//
// A season is a list of rated men, each with the code of the nation he played for that season: a federation of its
// day (Czechoslovakia, the Soviet Union, Yugoslavia, West Germany) where there was one. On the game's map a federation
// is the shape of the nation that holds its land: Czechia holds Slovakia's, Russia the other Soviet republics', Serbia
// the other Yugoslav republics'. A nation fields its five best by Elo, and needs two to play, as in the 2026 season;
// a nation barred from the Davis Cup that season fields no team.
import { HOME_NATIONS, NATIONS, nationIdentity, selectLineup } from '../../src/data/teams.js';
import { tennis } from '../../src/sports/tennis.js';
import { gameRating, MIN_PLAYERS, TEAM_SIZE } from './tennis.mjs';

const NATION_OF_FIFA = new Map(Object.entries(NATIONS).map(([id, record]) => [record[1], id]));
const active = (federation, season) => (federation.from ?? -Infinity) <= season && season <= federation.through;

const federationNamed = (code, rules) => rules.federations.find(f => f.code === code || f.aliases?.includes(code)) ?? null;

/**
 * A code as the state of `season` knew it (`rules`: the manifest's `nations`). A federation after its years passes
 * to its successor: the player's own country by the player file (`ioc`) where that is one of its members ('YUG' in
 * 1993 is 'CRO' for Goran Ivanisevic), else the federation of that day that counts it as a member ('YUG' in 1995 is
 * FR Yugoslavia), else the player's country if that is no federation (an emigrant: Ivan Lendl after
 * Czechoslovakia), else its named successor. A member of a federation in its years is the federation ('SVK' in 1985 is
 * 'TCH').
 */
export function codeOfDay(code, season, ioc, rules) {
  let current = code;
  const own = federationNamed(current, rules);
  if (own && !active(own, season)) {
    const next = rules.federations.find(f => active(f, season) && f.members.includes(current));
    if (ioc && own.members.includes(ioc)) current = ioc;
    else if (next) return next.code;
    else if (ioc && !federationNamed(ioc, rules)) current = ioc;
    else current = own.successor;
  }
  const federation = rules.federations.find(f => active(f, season) && (f.code === current || f.aliases?.includes(current) || f.members.includes(current)));
  return federation ? federation.code : current;
}

/**
 * The nation a computed season's player played for: a hand fix of the manifest (`fixes`), else the player's cup nation
 * (the Davis Cup's for the men, the Fed Cup's for the women) in the nearest season of a cup tie (the same season first,
 * then earlier, then later, within the manifest's `davisCupWindow` or `cupWindow` seasons), else the country by the
 * player file; as `codeOfDay` normalises it → `{ code, how }`, `how` 'fix', 'davis-cup' (`cupHow`: 'fed-cup') or
 * 'player-file'.
 */
export function nationOfDay({ id, ioc, davisCup }, season, rules) {
  const fix = rules.fixes.find(f => f.id === id && (f.from ?? -Infinity) <= season && season <= (f.through ?? Infinity));
  if (fix) return { code: codeOfDay(fix.code, season, ioc, rules), how: 'fix' };
  const window = rules.cupWindow ?? rules.davisCupWindow;
  let best = null;
  for (const [year, codes] of davisCup || []) {
    const distance = Math.abs(year - season) + (year > season ? 0.5 : 0);
    if (Math.abs(year - season) > window) continue;
    // A team of several countries (the Caribbean's) says nothing of which one is his: the player file does.
    const own = [...codes].filter(([code]) => !rules.combinedTeams.includes(code));
    if (!own.length) continue;
    if (!best || distance < best.distance) {
      const [code] = own.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
      best = { distance, code };
    }
  }
  if (best) return { code: codeOfDay(best.code, season, ioc, rules), how: rules.cupHow ?? 'davis-cup' };
  return { code: ioc ? codeOfDay(ioc, season, ioc, rules) : null, how: 'player-file' };
}

/**
 * The game's nation for a code of `season`: a federation's holder (null for one that fielded no Davis Cup team, East
 * Germany), null for a country off the map; throws on a code it does not know.
 */
export function nationIdOf(code, season, rules) {
  if (code == null || rules.offMap.includes(code)) return null;
  const federation = federationNamed(code, rules);
  if (federation) return federation.holder;
  const id = rules.iocNations[code] ?? NATION_OF_FIFA.get(code);
  if (!id) throw new Error(`No nation for the code ${code} (${season})`);
  return id;
}

/** Whether a nation is barred from the Davis Cup in `season` (`rules.barred`). */
export const isBarred = (nation, season, rules) => rules.barred.some(bar => bar.nation === nation && bar.from <= season && season <= bar.through);

/**
 * A season's territory: the home nations in the United Kingdom's empire (Great Britain plays the Davis Cup as one), the
 * other shapes of a federation of the day (`rules.territory`) in its holder's where the holder fields a team that
 * season, and every other nation the season does not list inactive.
 */
export function territoryOf(season, fielded, rules) {
  const merged = Object.fromEntries(HOME_NATIONS.map(id => [id, '826']));
  for (const land of rules.territory) {
    if (!active(land, season) || !fielded.has(land.holder)) continue;
    for (const shape of land.shapes) if (!fielded.has(shape)) merged[shape] = land.holder;
  }
  const inactive = Object.keys(NATIONS).filter(id => !Object.hasOwn(merged, id) && !fielded.has(id));
  return { merged, inactive };
}

/** The federation a nation played as in `season` (its name, for the audit), or null. */
export const federationOf = (nation, season, rules) => rules.federations.find(f => active(f, season) && f.holder === nation) ?? null;

const byElo = (a, b) => b.elo - a.elo || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

/**
 * A season's teams from its rated players (`{ name, elo, nation, source }`, `nation` the game's id or null): each
 * nation's five best by Elo with ratings `gameRating(elo) − shift`, where `shift` brings the season's best player in
 * the game down to 99 (match odds depend only on rating gaps, so a shift of the whole season keeps every match's odds).
 * → `{ nations: [{ id, name, str, squad, players }], shift, left }`, strongest first; `left` the players of a nation
 * of one or of a barred nation, and of no nation. `sport`: the men's game (the default) or the women's.
 */
export function teamsOf(players, season, rules, sport = tennis) {
  const pools = new Map(), left = { offMap: [], barred: [], alone: [] };
  for (const player of players) {
    if (player.nation == null) { left.offMap.push(player); continue; }
    if (isBarred(player.nation, season, rules)) { left.barred.push(player); continue; }
    if (!pools.has(player.nation)) pools.set(player.nation, []);
    pools.get(player.nation).push(player);
  }
  const teams = [];
  for (const [id, pool] of pools) {
    if (pool.length < MIN_PLAYERS) { left.alone.push(...pool); continue; }
    teams.push({ id, pool: pool.slice().sort(byElo) });
  }
  const best = Math.max(...teams.flatMap(team => team.pool.slice(0, TEAM_SIZE).map(player => gameRating(player.elo))));
  const shift = Math.max(0, best - 99);
  const nations = teams.map(({ id, pool }) => {
    const squad = pool.slice(0, TEAM_SIZE).map(player => ({ ...player, rating: gameRating(player.elo) - shift }));
    if (squad.some(player => player.rating < 1)) throw new Error(`${season}: a rating under 1 in ${id}`);
    const lineup = selectLineup({ sport: sport.id, squad: squad.map(player => ({ name: player.name, pos: 'SGL', rating: player.rating })) });
    return { id, name: nationIdentity(id, sport).name, str: lineup.rating, squad, players: pool.length };
  }).sort((a, b) => b.str - a.str || (a.name < b.name ? -1 : 1));
  return { nations, shift, left };
}

/** A squad player as the season file holds it: `[name, 'SGL', rating, source]`. */
export const tupleOf = player => [player.name, 'SGL', player.rating, player.source];
