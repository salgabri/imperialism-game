// Valorant's ratings from vlr.gg's results (docs/design/valorant.md): the cached pages (scripts/lib/vlr.mjs) read into the
// series an Elo of players plays (scripts/lib/esports-elo.mjs), map by map, and the nations the players play for.
import { readdir, readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { nationOfFlag } from './rocket-league.mjs';
import { countsEvent, readEventList, readEventMatches, readMatch } from './vlr.mjs';
import { favouriteBins, homeEdge, mostOf, oddsBin, runElo } from './esports-elo.mjs';
import { HALF, ROUNDS_TO_WIN } from '../../src/sports/valorant.js';

export const SPORT = 'valorant';
/** A nation's squad: the five who play and two in reserve. */
export const TEAM_SIZE = 7;
/** The five who play a map. */
export const LINEUP = 5;
/** The fewest maps a player needs behind him to be rated at all. */
export const MIN_GAMES = 20;
/** How long since his last map a player still plays for his nation: a year. */
export const ACTIVE_DAYS = 365;
/** The K scale (scripts/sync-valorant.mjs --tune: 240 the best of 80…400, with the circuits' levels or without): K = K_SCALE / (maps + 5)^0.4. */
export const K_SCALE = 240;
/**
 * Whether a newcomer starts at his home circuit's level (circuitLevels in scripts/lib/esports-elo.mjs) rather than 1500: yes,
 * since 2026-11-21. With every newcomer at 1500 each circuit's players stayed around 1500 whatever its strength: held out,
 * the VCT's sides beat the Challengers' 49 ± 14 Elo more often than Elo expected, and India's lost 241 ± 89 Elo's worth
 * (docs/design/valorant.md, "Circuits on one scale"). With the levels, LEVEL_SPREAD and HOMES_BY_COUNTRY, the held-out log
 * loss of the maps between circuits went from 0.6525 to 0.6441 and of all maps from 0.6452 to 0.6446 (--tune --rolling).
 */
export const CIRCUIT_LEVELS = true;
/**
 * The circuits' levels' own prior (circuitLevels `levelSpread`): a normal spread of 100 Elo around the players' mean, so a
 * circuit whose links say little stays near it. Chosen on the held-out maps (all of them 0.6451 → 0.6446 against no prior).
 */
export const LEVEL_SPREAD = 100;
/**
 * A player who has played in no circuit's events (the off-season's invitationals and the world stage only: 3,955 of
 * vlr.gg's 18,179, in a tenth of all maps) calls home the circuit most of his country's players call home (homesOf
 * `byCountry`), so he starts at its level and not at 1500 (held out, the maps between circuits 0.6470 → 0.6441).
 */
export const HOMES_BY_COUNTRY = true;
/** A rating point is 25 Elo points, as in Rocket League and tennis: rating = (Elo − ELO_BASE) / 25, rounded. */
export const ELO_PER_POINT = 25;
export const ELO_BASE = 50;
export const gameRating = elo => Math.round((elo - ELO_BASE) / ELO_PER_POINT);
export const SOURCE_ID = 'vlr';
export const EDITION = 'vlr.gg Elo';
export const SITE_URL = 'https://www.vlr.gg';

// ---------- events ----------

// The VCT's four regions, and the second tier's subregions as their own circuits (a Challengers league plays apart from
// the franchised league above it, and from the other subregions but at Ascension and the EMEA-wide stages).
const SUBREGIONS = [
  ['Japan', /japan/i], ['Korea', /korea/i], ['Vietnam', /vietnam/i], ['Thailand', /thailand/i], ['Indonesia', /indonesia/i],
  ['Philippines', /philippines/i], ['Malaysia/Singapore', /malaysia|singapore/i], ['Taiwan/Hong Kong', /taiwan|hong kong/i],
  ['South Asia', /south asia/i], ['Southeast Asia', /southeast asia|\bsea\b/i], ['Oceania', /oceania|fortress/i],
  ['North America', /north america/i], ['Brazil', /brazil|gamers club|elevate play/i], ['LATAM', /latam|latin america/i],
  ['MENA', /mena|arabian|middle east|north africa/i], ['Türkiye', /t[üu]rkiye|turkey|turkish/i], ['DACH', /dach|pokal/i],
  ['France', /france|project blender/i], ['Spain', /spain/i], ['Italy', /italy/i], ['Portugal', /portugal/i],
  ['North//East', /north\/\/east|northern europe|polaris|\beast\b|surge|\bnorth\b/i], ['China', /china/i],
];
const REGION_OF_SUBREGION = {
  Japan: 'Pacific', Korea: 'Pacific', Vietnam: 'Pacific', Thailand: 'Pacific', Indonesia: 'Pacific', Philippines: 'Pacific',
  'Malaysia/Singapore': 'Pacific', 'Taiwan/Hong Kong': 'Pacific', 'South Asia': 'Pacific', 'Southeast Asia': 'Pacific',
  Oceania: 'Pacific', 'North America': 'Americas', Brazil: 'Americas', LATAM: 'Americas', MENA: 'EMEA', Türkiye: 'EMEA',
  DACH: 'EMEA', France: 'EMEA', Spain: 'EMEA', Italy: 'EMEA', Portugal: 'EMEA', 'North//East': 'EMEA', China: 'China',
};

/** Whether an event is the international stage: Masters, Champions, LOCK//IN, or an off-season event. */
const isInternational = event => event.tier === 67 || /masters|valorant champions|champions 20\d\d|lock\/\/in/i.test(event.title);
/** Whether an event's teams are nations: the Esports Nations Cup's. */
export const isNationsEvent = event => /nations cup/i.test(event?.title ?? '');

/**
 * An event's circuit: the VCT region of a franchised league's event ("VCT Pacific": its Kickoff, Stages, Ascension),
 * China's Evolution Series as China's second tier, a Challengers league's subregion ("Challengers Japan"), or an EMEA- or
 * Pacific-wide Challengers stage as that region's ("Challengers EMEA"); null for the international stage.
 */
export function circuitOf(event) {
  if (!event || isInternational(event)) return null;
  const title = event.title;
  // A Kickoff's qualifier is open to the second tier's teams: its subregion's circuit, as a Challengers league's.
  const kickoffQualifier = event.tier === 60 && /kickoff.*qualifier/i.test(title);
  if (event.tier === 60 && !kickoffQualifier) {
    if (/evolution series|national tournament/i.test(title)) return 'Challengers China';
    if (/ascension/i.test(title)) return null;
    const region = /\b(Americas?|EMEA|Pacific|China)\b/i.exec(title)?.[1]?.toLowerCase();
    const names = { america: 'Americas', americas: 'Americas', emea: 'EMEA', pacific: 'Pacific', china: 'China' };
    return region ? `VCT ${names[region]}` : null;
  }
  // The second tier (61): a subregion's league, or a region-wide stage of its Challengers.
  if (/ascension/i.test(title)) return null;
  if (/challengers 20\d\d: emea (stage|last chance)/i.test(title)) return 'Challengers EMEA';
  if (/pacific last chance/i.test(title)) return 'Challengers Pacific';
  if (/vcl 26: (americas|latin america)/i.test(title)) return 'Challengers LATAM';
  for (const [name, pattern] of SUBREGIONS) if (pattern.test(title)) return `Challengers ${name}`;
  return null;
}

/** The VCT region a circuit belongs to ("VCT EMEA" and "Challengers France" are both EMEA's), or null. */
export function regionOfCircuit(circuit) {
  if (!circuit) return null;
  const [, name] = /^(?:VCT|Challengers) (.+)$/.exec(circuit) ?? [];
  return REGION_OF_SUBREGION[name] ?? (['Americas', 'EMEA', 'Pacific', 'China'].includes(name) ? name : null);
}

// ---------- the cache, read ----------

const gunzip = async file => gunzipSync(await readFile(file)).toString('utf8');

/**
 * Every cached match of the events the ratings count (vlr.mjs countsEvent), read: [{ id, event, …readMatch }], the
 * event `{ id, title, tier, flag, status }`.
 */
export async function readCache(cache) {
  const events = new Map();
  for (const name of (await readdir(path.join(cache, 'events')).catch(() => [])).sort()) {
    const tier = Number(/tier-(\d+)/.exec(name)?.[1]);
    for (const event of readEventList(await gunzip(path.join(cache, 'events', name))).events) {
      if (!events.has(event.id)) events.set(event.id, { ...event, tier });
    }
  }
  const matches = [];
  const missing = [];
  for (const name of (await readdir(path.join(cache, 'event-matches')).catch(() => [])).sort()) {
    const event = events.get(Number(name.split('.')[0]));
    if (!event) continue;
    const completed = readEventMatches(await gunzip(path.join(cache, 'event-matches', name))).filter(match => match.completed);
    if (!countsEvent(event, completed.length)) continue;
    for (const match of completed) {
      const html = await gunzip(path.join(cache, 'matches', `${match.id}.html.gz`)).catch(() => null);
      if (html == null) { missing.push(match.id); continue; }
      if (!html) continue;
      // A copy: the strings read off a page are slices of it, and would keep every page whole in memory (some 20,000).
      const page = structuredClone(readMatch(html));
      matches.push({ id: match.id, ...page, header: page.event, event });
    }
  }
  return { events, matches, missing };
}

/** A player's key: his vlr.gg page. */
export const playerKey = player => `vlr:${player.id}`;

/**
 * The matches as the Elo plays them, in date order: each a series of its maps, a map one game between the ten who played
 * it (a side of fewer than four players on the page is left out, with its map). A forfeit has no maps.
 */
export function seriesOf(matches) {
  const series = [];
  for (const match of matches) {
    if (!match.date) continue;
    const games = [];
    for (const map of match.maps) {
      if (map.score[0] === map.score[1]) continue;
      if (map.players.some(side => side.length < 4)) continue;
      games.push({
        sides: map.players.map((side, s) => side.map(player => ({ key: playerKey(player), name: player.name,
          flag: player.flag && player.flag !== 'un' ? player.flag : null, team: match.teams[s]?.name ?? null }))),
        winner: map.score[0] > map.score[1] ? 1 : 2, map,
      });
    }
    if (!games.length) continue;
    series.push({ id: match.id, date: match.date.slice(0, 10), time: match.date, circuit: circuitOf(match.event),
      event: match.event, bestOf: match.bestOf, teams: match.teams.map(team => team.name), score: match.score, games });
  }
  return series.sort((a, b) => a.time.localeCompare(b.time) || a.id - b.id);
}

/**
 * The players who have played for a national team (the Esports Nations Cup): key → { nation, team, date } of the last
 * such map he played, the team's name read as a country's.
 */
export function nationalTeams(series) {
  const national = new Map();
  for (const one of series) {
    if (!isNationsEvent(one.event)) continue;
    one.teams.forEach((team, s) => {
      const nation = nationOfFlag(team);
      if (!nation) return;
      for (const game of one.games) {
        for (const entry of game.sides[s]) national.set(entry.key, { nation, team, date: one.date });
      }
    });
  }
  return national;
}

/** A player's flag: the country his maps file him under most often (vlr.gg's "un", no country, left out). */
export const flagOf = player => mostOf(player.flags);

/** The nation a player plays for: his national team's, else his flag's, else none. */
export const nationOfPlayer = (player, national) => national.get(player.key)?.nation ?? nationOfFlag(flagOf(player));

/** The snapshot's row: `[key, name, flag, nation, national team, elo, maps, wins, last, team, circuit]`. */
export const rowOf = p => [p.key, p.name, p.flag, p.nation, p.side, p.elo, p.games, p.wins, p.last, p.team, p.circuit];

/** A snapshot row as a player of the game: his rating and nation, and the source a squad keeps. */
export function playerOf([key, name, flag, nation, side, elo, games, wins, last, team, circuit], snapshotDate, eloRank) {
  const id = key.replace(/^vlr:/, '');
  return { key, name, flag, nation, side, elo, games, wins, last, team, circuit, rating: gameRating(elo),
    source: { id: key, source: SOURCE_ID, edition: EDITION, snapshotDate, rawRating: elo, rawScale: 'Elo', eloRank, games,
      lastPlayed: last, ...(team ? { team } : {}), ...(side ? { nationalTeam: side } : {}), url: `${SITE_URL}/player/${id}` } };
}

/** A squad player as the game's files hold it: `[name, 'PLR', rating, source]`. */
export const tupleOf = player => [player.name, 'PLR', player.rating, player.source];

// ---------- how the real maps went ----------

/** Whether an event is played on a LAN in its host country: a VCT event (Kickoff, Stages, Masters, Champions), no qualifier. */
const isLan = event => event?.tier === 60 && !/qualifier/i.test(event?.title ?? '') && !!event?.flag;

/**
 * How the real maps went, for the match model (src/sports/valorant.js) and its checks (scripts/simulation-realism.mjs):
 * the maps from `from` (and before `until`, when given) whose ten players had each played MIN_GAMES maps before, as every
 * rated player has, each at its own pre-map Elo odds. Their rounds, overtimes and scores (`losers`: the loser's rounds in a map won 13–x; `otFinals`), the
 * economy of their rounds (`roundStats`: how often the pistol's winner took the next round, the bonus round and the
 * broken buy went as they do, and a later round went to the previous one's winner), the series' scores (`series`), the
 * favourite's record by its odds (`favourites`), the maps by their odds (`odds`: [bin, maps, overtimes, favourite won,
 * rounds]), and the host nation's edge at the VCT's LANs (`home`, a side of three of its players or more).
 */
export function playOf(series, { scale, starts, homes, from, until = null, nationOf }) {
  const play = { from, minGames: MIN_GAMES, maps: 0, rounds: 0, ot: 0, losers: {}, otFinals: {},
    roundStats: { rounds: 0, defence: 0, afterPistol: [0, 0], bonus: [0, 0], broken: [0, 0], lean: [0, 0] }, series: {} };
  const byOdds = new Map();
  const seriesRows = [];
  const lan = [];
  let current = null;
  runElo(series, { scale, starts, homes, onGame: (one, game, e, sides) => {
    const won = game.winner === 1 ? 1 : 0;
    if (isLan(one.event)) {
      const host = nationOfFlag(one.event.flag);
      if (host) lan.push({ host, keys: sides.map(side => side.map(player => player.key)), surprise: won - e });
    }
    if (one.date < from || (until && one.date >= until)) return;
    const seasoned = sides.flat().every(player => player.games >= MIN_GAMES);
    if (current?.one !== one) {
      current = { one, odds: e, seasoned, won: [0, 0] };
      if (one.bestOf === 3 || one.bestOf === 5) seriesRows.push(current);
    }
    current.won[game.winner - 1]++;
    if (!seasoned) { current.seasoned = false; return; }
    const map = game.map;
    const rounds = map.score[0] + map.score[1];
    const loser = Math.min(...map.score), winner = Math.max(...map.score);
    const ot = winner > ROUNDS_TO_WIN || (winner === ROUNDS_TO_WIN && loser === ROUNDS_TO_WIN - 1);
    play.maps++;
    play.rounds += rounds;
    if (ot) {
      play.ot++;
      play.otFinals[`${winner}-${loser}`] = (play.otFinals[`${winner}-${loser}`] ?? 0) + 1;
    } else play.losers[loser] = (play.losers[loser] ?? 0) + 1;
    const bin = oddsBin(e);
    const row = byOdds.get(bin) ?? [bin, 0, 0, 0, 0];
    row[1]++;
    if (ot) row[2]++;
    if ((e >= 0.5) === (won === 1)) row[3]++;
    row[4] += rounds;
    byOdds.set(bin, row);
    const r = map.rounds;
    if (r.length !== rounds || !r.every(round => round.side)) return;
    const stats = play.roundStats;
    const same = (into, yes) => { into[0]++; if (yes) into[1]++; };
    r.forEach((round, i) => {
      stats.rounds++;
      if (round.side === 'ct') stats.defence++;
      const inHalf = (i % HALF) + 1;
      if (i >= 2 * HALF) return;
      if (inHalf === 2) same(stats.afterPistol, round.winner === r[i - 1].winner);
      else if (inHalf === 3) {
        if (r[i - 1].winner === r[i - 2].winner) same(stats.bonus, round.winner === r[i - 1].winner);
        else same(stats.broken, round.winner === r[i - 1].winner);
      } else if (inHalf > 3) same(stats.lean, round.winner === r[i - 1].winner);
    });
  } });
  for (const row of seriesRows) {
    if (!row.seasoned) continue;
    const toWin = (row.one.bestOf + 1) / 2;
    if (Math.max(...row.won) !== toWin) continue;
    const key = `bo${row.one.bestOf}`;
    const score = `${toWin}-${Math.min(...row.won)}`;
    play.series[key] ??= {};
    play.series[key][score] = (play.series[key][score] ?? 0) + 1;
  }
  play.favourites = favouriteBins(seriesRows.filter(row => row.seasoned).map(row => ({ bestOf: row.one.bestOf, odds: row.odds, won: row.won })));
  play.odds = [...byOdds.values()].sort((a, b) => a[0] - b[0]);
  return { play, home: homeEdge(lan, nationOf, 3) };
}
