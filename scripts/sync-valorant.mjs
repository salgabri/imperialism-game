// Valorant's player Elo from vlr.gg's results (docs/design/valorant.md): the events of VCT, Challengers and the off-season
// (scripts/lib/vlr.mjs TIERS), each event's matches and each match's page, kept gzipped in data-src/vlr/ (git-ignored).
//
// Then rates every player by an Elo of the maps (scripts/lib/esports-elo.mjs) and writes scripts/data/valorant-elo.json,
// which npm run build-valorant turns into the national teams.
//
// Usage: node scripts/sync-valorant.mjs [--fetch] [--refresh-lists] [--tune] [--max-matches=N] [--pause=MS]
//   npm run sync:valorant
//   --fetch          fetch the pages the cache lacks (one at a time, PAUSE_MS apart); without it nothing is fetched
//   --refresh-lists  fetch the events listings and the matches of events not yet over again
//   --tune           also score K and the circuits' starts on the last HOLDOUT_DAYS of maps, before each is played
import { readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { FIRST_EVENT, SITE, TIERS, cached, countsEvent, readEventList, readEventMatches, vlrPage } from './lib/vlr.mjs';
import { calibrationOf, circuitLevels, homesOf, leftOut, nationsOf, ratedPlayers, runElo, scoreOf, snapshotText } from './lib/esports-elo.mjs';
import { ACTIVE_DAYS, CIRCUIT_LEVELS, EDITION, K_SCALE, LINEUP, MIN_GAMES, TEAM_SIZE, nationalTeams, nationOfPlayer, playerOf, playOf, readCache, rowOf,
  seriesOf } from './lib/valorant.mjs';
import { GREAT_BRITAIN } from '../src/data/teams.js';

// Great Britain plays as one, as in Rocket League and tennis.
const valorant = { playsAs: { '826': GREAT_BRITAIN } };

const args = process.argv.slice(2);
const option = name => args.find(arg => arg.startsWith(`--${name}=`))?.split('=')[1];
const known = ['--fetch', '--refresh-lists', '--tune'];
const unknown = args.filter(arg => !known.includes(arg) && !/^--(max-matches|pause)=/.test(arg));
if (unknown.length) throw new Error(`Unknown option ${unknown[0]}`);
const fetching = args.includes('--fetch');
const refreshLists = args.includes('--refresh-lists');
const maxMatches = Number(option('max-matches') ?? Infinity);
const pause = Number(option('pause') ?? 1000);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cache = path.join(root, 'data-src', 'vlr');
const snapshotFile = path.join(root, 'scripts', 'data', 'valorant-elo.json');
// The days before the last map whose maps score K: each predicted before it is played.
const HOLDOUT_DAYS = 180;
// The real maps the match model is held against: the last two years'.
const PLAY_YEARS = 2;

/** A page from the cache, or fetched when --fetch allows it; null when neither. */
async function page(url, file, { refresh = false } = {}) {
  if (!fetching && !(await cached(file))) return null;
  return vlrPage(url, file, { refresh: fetching && refresh, pause });
}

// 1. The events of each tier, every page of its listing.
const events = new Map();
for (const tier of TIERS) {
  let last = 1;
  for (let p = 1; p <= last; p++) {
    const html = await page(`${SITE}/events/?tier=${tier}&page=${p}`, path.join(cache, 'events', `tier-${tier}-page-${p}.html.gz`), { refresh: refreshLists });
    if (html == null) break;
    const { events: found, lastPage } = readEventList(html);
    last = Math.max(last, lastPage);
    for (const event of found) if (!events.has(event.id)) events.set(event.id, { ...event, tier });
  }
}
const byStatus = status => [...events.values()].filter(event => event.status === status).length;
console.log(`${events.size} events of tiers ${TIERS.join(', ')}: ${byStatus('completed')} completed, ${byStatus('ongoing')} ongoing,`
  + ` ${byStatus('upcoming')} upcoming`);

// 2. Each event's matches, the newest events first; an upcoming event has none yet, and an event before FIRST_EVENT or an
// open qualifier is left out (countsEvent).
const played = [...events.values()].filter(event => event.status !== 'upcoming' && event.id >= FIRST_EVENT).sort((a, b) => b.id - a.id);
const matches = [];
const openQualifiers = [];
let eventPages = 0;
for (const event of played) {
  const html = await page(`${SITE}/event/matches/${event.id}/${event.slug}/?series_id=all`,
    path.join(cache, 'event-matches', `${event.id}.html.gz`), { refresh: refreshLists && event.status === 'ongoing' });
  if (html == null) continue;
  eventPages++;
  const completed = readEventMatches(html).filter(match => match.completed);
  if (!countsEvent(event, completed.length)) { openQualifiers.push(`${event.title} (${completed.length})`); continue; }
  for (const match of completed) matches.push({ ...match, event: event.id });
  if (fetching && eventPages % 50 === 0) console.log(`  ${eventPages} of ${played.length} events' matches read: ${matches.length} completed matches so far`);
}
console.log(`${eventPages} of ${played.length} events' match lists read: ${matches.length} completed matches;`
  + ` ${openQualifiers.length} open qualifiers left out: ${openQualifiers.join('; ')}`);

// 3. Each completed match's page, the newest events' first.
let fetched = 0, have = 0;
const started = Date.now();
for (const match of matches) {
  const file = path.join(cache, 'matches', `${match.id}.html.gz`);
  if (await cached(file)) { have++; continue; }
  if (!fetching || fetched >= maxMatches) continue;
  await vlrPage(`${SITE}/${match.id}/${match.slug}`, file, { pause });
  fetched++;
  if (fetched % 100 === 0) {
    const rate = fetched / ((Date.now() - started) / 1000);
    const left = matches.length - have - fetched;
    console.log(`  ${fetched} match pages fetched (${have} cached before), ${left} to go, ~${Math.round(left / rate / 60)} min left`);
  }
}
const files = (await readdir(path.join(cache, 'matches')).catch(() => [])).length;
console.log(`${have + fetched} of ${matches.length} match pages cached (${fetched} fetched now; ${files} files in data-src/vlr/matches)`);
if (fetching && have + fetched < matches.length) process.exit(0);

// 4. The ratings: every cached match of the counted events, map by map.
const { matches: read } = await readCache(cache);
const series = seriesOf(read);
const national = nationalTeams(series);
const games = series.reduce((sum, one) => sum + one.games.length, 0);
if (!series.length) { console.error('No matches cached: run with --fetch first.'); process.exit(1); }
const last = series.at(-1).date;
const holdout = new Date(Date.parse(last) - HOLDOUT_DAYS * 86400000).toISOString().slice(0, 10);
console.log(`\n${series.length} matches with maps, ${games} maps, ${series[0].date} to ${last};`
  + ` ${national.size} players have played for a national team (the Esports Nations Cup)`);

if (args.includes('--tune')) {
  console.log(`\nScored on the ${HOLDOUT_DAYS} days from ${holdout}, each map before it is played:`);
  // The circuits' levels do not hang on K: fitted once, on the games before the held-out ones.
  const levels = circuitLevels(series, { until: holdout });
  const homes = homesOf(series, { until: holdout });
  for (const scale of [80, 120, 160, 200, 240, 320, 400]) {
    for (const circuits of [false, true]) {
      const starts = circuits ? levels : {};
      const { scored } = runElo(series, { scale, starts, homes, holdout });
      const all = scoreOf(scored.all);
      console.log(`  K ${String(scale).padStart(3)}${circuits ? ' circuits' : '         '}  log loss ${all.logLoss.toFixed(4)}`
        + `  Brier ${all.brier.toFixed(4)}  (${all.n} maps)`);
    }
  }
}

const starts = CIRCUIT_LEVELS ? circuitLevels(series) : {};
const homes = CIRCUIT_LEVELS ? homesOf(series) : null;
const { players, scored } = runElo(series, { scale: K_SCALE, starts, homes, holdout });
const rated = ratedPlayers(players, last, { minGames: MIN_GAMES, activeDays: ACTIVE_DAYS,
  nationOf: player => nationOfPlayer(player, national), sideOf: player => national.get(player.key)?.team ?? null });
const calibration = calibrationOf(scored);
// How the real maps of the last PLAY_YEARS went between seasoned players, and the host nation's edge at the LANs, each
// side's nation as the ratings give it.
const playFrom = new Date(Date.parse(last) - PLAY_YEARS * 365 * 86400000).toISOString().slice(0, 10);
const nationByKey = new Map([...players.values()].map(player => [player.key, nationOfPlayer(player, national)]));
const { play, home } = playOf(series, { scale: K_SCALE, starts, homes, from: playFrom, nationOf: key => nationByKey.get(key) ?? null });
const snapshot = {
  source: { name: 'vlr.gg', site: SITE, edition: EDITION, fetched: new Date().toISOString().slice(0, 10), from: series[0].date, to: last,
    events: new Set(series.map(one => one.event.id)).size, matches: series.length, maps: games, players: players.size, rated: rated.length,
    activeDays: ACTIVE_DAYS, minGames: MIN_GAMES, kScale: K_SCALE, starts,
    holdout: { from: holdout, ...scoreOf(scored.all), calibration }, home },
  play,
  players: rated.map(rowOf),
};
const { players: rows, ...head } = snapshot;
await writeFile(snapshotFile, snapshotText(head, rows));

const asPlayers = snapshot.players.map((row, i) => playerOf(row, snapshot.source.fetched, i + 1));
const nations = nationsOf(asPlayers, { teamSize: TEAM_SIZE, lineup: LINEUP, sport: valorant });
const { noNation, short } = leftOut(asPlayers, { lineup: LINEUP });
console.log(`\nWrote ${rated.length} rated players (of ${players.size}) to ${path.relative(root, snapshotFile)}; circuit starts ${JSON.stringify(starts)}`);
console.log(`  held out from ${holdout}: log loss ${scoreOf(scored.all).logLoss?.toFixed(4)} over ${scored.all.n} maps;`
  + ` calibration ${calibration.map(([e, w, n]) => `${e}→${w} (${n})`).join(', ')}`);
console.log(`  home sides at the LANs: ${home ? `${home.games} maps, ${home.elo} ± ${home.se} Elo against Elo's expectation` : 'none'}`);
const pctOf = ([n, yes]) => `${(100 * yes / Math.max(1, n)).toFixed(1)}%`;
console.log(`  real maps from ${playFrom} between seasoned players: ${play.maps}, ${(play.rounds / Math.max(1, play.maps)).toFixed(2)} rounds,`
  + ` ${(100 * play.ot / Math.max(1, play.maps)).toFixed(1)}% to overtime; after a pistol ${pctOf(play.roundStats.afterPistol)},`
  + ` bonus round ${pctOf(play.roundStats.bonus)}, broken buy ${pctOf(play.roundStats.broken)}, lean ${pctOf(play.roundStats.lean)};`
  + ` series ${JSON.stringify(play.series)}`);
console.log(`  top: ${asPlayers.slice(0, 15).map(p => `${p.name} ${p.rating}`).join(', ')}`);
console.log(`  ${nations.length} nations field a team: ${nations.map(n => `${n.name} ${n.str}`).join(', ')}`);
console.log(`  left out: ${noNation.length} with no country on the map (${noNation.slice(0, 15).map(p => `${p.name} ${p.flag ?? '—'}`).join(', ')}${noNation.length > 15 ? ' …' : ''}),`
  + ` ${short.length} from a nation of fewer than ${LINEUP}`);
