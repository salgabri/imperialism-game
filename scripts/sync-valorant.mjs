// Valorant's player Elo from vlr.gg's results (docs/design/valorant.md): the events of VCT, Challengers and the off-season
// (scripts/lib/vlr.mjs TIERS), each event's matches and each match's page, kept gzipped in data-src/vlr/ (git-ignored).
//
// Then rates every player by an Elo of the maps (scripts/lib/esports-elo.mjs) and writes scripts/data/valorant-elo.json,
// which npm run build-valorant turns into the national teams, and scripts/data/valorant-seasons/<year>.json, each earlier
// year's players as rated on its last day, which npm run build:valorant-seasons turns into the earlier seasons.
//
// Usage: node scripts/sync-valorant.mjs [--fetch] [--refresh-lists] [--tune] [--rolling] [--max-matches=N] [--pause=MS]
//   npm run sync:valorant
//   --fetch          fetch the pages the cache lacks (one at a time, PAUSE_MS apart); without it nothing is fetched
//   --refresh-lists  fetch the events listings and the matches of events not yet over again
//   --tune           also score K and the circuits' starts on the last HOLDOUT_DAYS of maps, before each is played, all of
//                    them and those between circuits apart
//   --rolling        with --tune: also each half-year from ROLLING_FROM, the levels fitted on the maps before it, and each
//                    circuit's offset in the maps between circuits (docs/design/valorant.md, "Circuits")
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { FIRST_EVENT, SITE, TIERS, cached, countsEvent, readEventList, readEventMatches, vlrPage } from './lib/vlr.mjs';
import { calibrationOf, circuitLevels, expected, groupOffsets, homesOf, leftOut, nationsOf, ratedPlayers, runElo, scoredGames, scoreOf, scoreRows,
  snapshotText } from './lib/esports-elo.mjs';
import { ACTIVE_DAYS, CIRCUIT_LEVELS, EDITION, HOMES_BY_COUNTRY, K_SCALE, LEVEL_SPREAD, LINEUP, MIN_GAMES, TEAM_SIZE, flagOf, nationalTeams, nationOfPlayer,
  playerOf, playOf, readCache, regionOfCircuit, rowOf, seriesOf } from './lib/valorant.mjs';
import { GREAT_BRITAIN } from '../src/data/teams.js';
import { MAP_POOL } from '../src/sports/valorant.js';

// Great Britain plays as one, as in Rocket League and tennis.
const valorant = { playsAs: { '826': GREAT_BRITAIN } };

const args = process.argv.slice(2);
const option = name => args.find(arg => arg.startsWith(`--${name}=`))?.split('=')[1];
const known = ['--fetch', '--refresh-lists', '--tune', '--rolling'];
const unknown = args.filter(arg => !known.includes(arg) && !/^--(max-matches|pause)=/.test(arg));
if (unknown.length) throw new Error(`Unknown option ${unknown[0]}`);
const fetching = args.includes('--fetch');
const refreshLists = args.includes('--refresh-lists');
const maxMatches = Number(option('max-matches') ?? Infinity);
const pause = Number(option('pause') ?? 1000);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cache = path.join(root, 'data-src', 'vlr');
const snapshotFile = path.join(root, 'scripts', 'data', 'valorant-elo.json');
const seasonsDir = path.join(root, 'scripts', 'data', 'valorant-seasons');
// The days before the last map whose maps score K: each predicted before it is played.
const HOLDOUT_DAYS = 180;
// --rolling's first cut-off: each half-year from it is scored with the levels fitted on the maps before it, the last from
// the K holdout's start to the last map.
const ROLLING_FROM = '2024-07-01';
// The real maps the match model is held against: the last two years'.
const PLAY_YEARS = 2;
// An earlier season's map pool: the MAP_POOL.length maps played most in its year's last POOL_MAPS maps, the pool in play
// when its ratings are taken (every year's last thousand hold exactly seven, the competitive pool of its December).
const POOL_MAPS = 1000;

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

// Each player's home and each circuit's level, the start of a newcomer who calls it home, over the maps before `until`
// (all of them when null): docs/design/valorant.md, "Circuits".
const levelsAndHomes = (games, until = null) => {
  const homes = homesOf(games, { until, byCountry: HOMES_BY_COUNTRY });
  return { starts: circuitLevels(games, { until, levelSpread: LEVEL_SPREAD, homes }), homes };
};
// --rolling's third setting, tested on 2026-11-21 and not adopted (docs/design/valorant.md, "Circuits on one scale"): after
// the Elo, each player's Elo gets his home circuit's offset (his home, else his first map's circuit), every circuit's offset
// fitted at once by maximum likelihood on the maps between circuits before the cut-off (`rows`: scoredGames with the
// players' keys), a normal prior of OFFSET_SPREAD Elo on each (Newton's method). No snapshot carries them.
const OFFSET_SPREAD = 50;
function offsetsOf(rows, circuitOf) {
  const slope = Math.LN10 / 400;
  const fit = [];
  for (const row of rows) {
    if (!between(row)) continue;
    const share = new Map();
    row.keys.forEach((side, s) => {
      for (const key of side) {
        const circuit = circuitOf(key);
        if (circuit) share.set(circuit, (share.get(circuit) ?? 0) + (s === 0 ? 1 : -1) / side.length);
      }
    });
    for (const [circuit, x] of share) if (Math.abs(x) < 1e-12) share.delete(circuit);
    if (share.size) fit.push({ share, gap: -400 * Math.log10(1 / row.e - 1), won: row.won });
  }
  const names = [...new Set(fit.flatMap(game => [...game.share.keys()]))].sort();
  const index = new Map(names.map((name, i) => [name, i]));
  const n = names.length;
  const x = new Float64Array(n);
  for (let step = 0; step < 50 && n; step++) {
    const hess = Array.from({ length: n }, () => new Float64Array(n + 1));
    for (const game of fit) {
      let shift = 0;
      for (const [circuit, v] of game.share) shift += x[index.get(circuit)] * v;
      const p = expected(game.gap + shift), w = p * (1 - p) * slope * slope;
      for (const [circuit, v] of game.share) {
        const i = index.get(circuit);
        hess[i][n] += (game.won - p) * slope * v;
        for (const [other, u] of game.share) hess[i][index.get(other)] += w * v * u;
      }
    }
    for (let i = 0; i < n; i++) { hess[i][i] += 1 / OFFSET_SPREAD ** 2; hess[i][n] -= x[i] / OFFSET_SPREAD ** 2; }
    for (let i = 0; i < n; i++) {
      let pivot = i;
      for (let k = i + 1; k < n; k++) if (Math.abs(hess[k][i]) > Math.abs(hess[pivot][i])) pivot = k;
      [hess[i], hess[pivot]] = [hess[pivot], hess[i]];
      for (let k = i + 1; k < n; k++) { const f = hess[k][i] / hess[i][i]; for (let j = i; j <= n; j++) hess[k][j] -= f * hess[i][j]; }
    }
    const move = new Float64Array(n);
    for (let i = n - 1; i >= 0; i--) { let sum = hess[i][n]; for (let j = i + 1; j < n; j++) sum -= hess[i][j] * move[j]; move[i] = sum / hess[i][i]; }
    let largest = 0;
    for (let i = 0; i < n; i++) { x[i] += move[i]; largest = Math.max(largest, Math.abs(move[i])); }
    if (largest < 0.001) break;
  }
  return Object.fromEntries(names.map((name, i) => [name, x[i]]));
}
// A map between circuits: its two sides' circuits (each the home of three of its five, esports-elo.mjs scoredGames) differ.
const between = row => row.circuits[0] && row.circuits[1] && row.circuits[0] !== row.circuits[1];
const lossLine = rows => {
  const part = (name, kept) => { const s = scoreRows(kept); return `${name} ${s.logLoss?.toFixed(4) ?? '—'} (${s.n})`; };
  return [part('all', rows), part('between circuits', rows.filter(between)), part('within', rows.filter(row => !between(row))),
    part('between, seasoned', rows.filter(row => between(row) && row.seasoned)), part('within, seasoned', rows.filter(row => !between(row) && row.seasoned))]
    .join('  ');
};
if (args.includes('--tune')) {
  console.log(`\nScored on the ${HOLDOUT_DAYS} days from ${holdout}, each map before it is played:`);
  // The circuits' levels do not hang on K: fitted once, on the games before the held-out ones.
  const { starts: levels, homes } = levelsAndHomes(series, holdout);
  for (const scale of [80, 120, 160, 200, 240, 320, 400]) {
    for (const circuits of [false, true]) {
      const starts = circuits ? levels : {};
      const rows = scoredGames(series, { scale, starts, homes }, { from: holdout, minGames: MIN_GAMES });
      console.log(`  K ${String(scale).padStart(3)}${circuits ? ' circuits' : '         '}  ${lossLine(rows)}`);
    }
  }
  if (args.includes('--rolling')) {
    // Each half-year from ROLLING_FROM, the last from the holdout's start: the levels and homes fitted on the maps before
    // it, every map of it scored before it is played; then each circuit's and tier's offset in the maps between circuits
    // between seasoned sides, all half-years together.
    const halfYearAfter = date => (date.slice(5) === '07-01' ? `${Number(date.slice(0, 4)) + 1}-01-01` : `${date.slice(0, 4)}-07-01`);
    const cuts = [];
    for (let date = ROLLING_FROM; date < holdout; date = halfYearAfter(date)) cuts.push(date);
    cuts.push(holdout);
    console.log(`\nEach half-year from ${ROLLING_FROM} (cut-offs ${cuts.join(', ')}), K ${K_SCALE}, scored before each map is played:`);
    const tierOf = circuit => circuit.split(' ')[0];
    // Three settings on the same half-years: every newcomer at 1500; the circuits' levels; and the circuits' offsets too,
    // fitted on the maps between circuits before each cut-off and held through the half-year.
    const firstCircuit = new Map();
    for (const one of series) for (const game of one.games) for (const side of game.sides) for (const entry of side) {
      if (!firstCircuit.has(entry.key)) firstCircuit.set(entry.key, one.circuit ?? null);
    }
    const variants = { 'every newcomer at 1500': [], 'with the circuits\' levels': [], 'and the circuits\' offsets (not adopted)': [] };
    cuts.forEach((from, i) => {
      const to = cuts[i + 1] ?? null;
      variants['every newcomer at 1500'].push(...scoredGames(series, { scale: K_SCALE }, { from, to, minGames: MIN_GAMES }));
      const options = levelsAndHomes(series, from);
      const rows = scoredGames(series, { scale: K_SCALE, ...options }, { from: '', minGames: MIN_GAMES, keys: true });
      const circuitOf = key => options.homes.get(key) ?? firstCircuit.get(key) ?? null;
      const offsets = offsetsOf(rows.filter(row => row.date < from), circuitOf);
      const sideShift = keys => keys.reduce((sum, key) => sum + (offsets[circuitOf(key)] ?? 0), 0) / keys.length;
      for (const row of rows) {
        if (row.date < from || (to && row.date >= to)) continue;
        variants['with the circuits\' levels'].push(row);
        const gap = -400 * Math.log10(1 / row.e - 1) + sideShift(row.keys[0]) - sideShift(row.keys[1]);
        variants['and the circuits\' offsets (not adopted)'].push({ ...row, e: expected(gap), before: row.e });
      }
    });
    for (const [name, rows] of Object.entries(variants)) {
      console.log(`  ${name}: ${lossLine(rows)}`);
      const seasoned = rows.filter(row => row.seasoned);
      const show = ([group, o]) => `${group} ${o.elo > 0 ? '+' : ''}${o.elo} ± ${o.se} (${o.won} won of ${o.expected} expected in ${o.n})`;
      console.log(`    the tiers in the maps between them: ${Object.entries(groupOffsets(seasoned, tierOf)).map(show).join('; ')}`);
      console.log(`    the tiers by region: ${Object.entries(groupOffsets(seasoned, circuit => `${tierOf(circuit)} ${regionOfCircuit(circuit)}`)).map(show).join('; ')}`);
      const offsets = Object.entries(groupOffsets(seasoned));
      const chi = offsets.filter(([, o]) => o.n >= 30).reduce((sum, [, o]) => sum + (o.elo / o.se) ** 2, 0);
      console.log(`    circuits beyond two errors (of ${offsets.filter(([, o]) => o.n >= 30).length} with 30 maps or more, Σ(offset / error)² ${chi.toFixed(1)}):`
        + ` ${offsets.filter(([, o]) => o.n >= 30 && Math.abs(o.elo) > 2 * o.se).map(show).join('; ') || 'none'}`);
    }
    // The rule fixed before the offsets' test, read as the other esports' audits read it: the maps between circuits better
    // predicted, all and seasoned; the maps within a circuit between seasoned players worse by no more than the paired
    // change's bootstrap error (a thousand resamples of the series); no region's tier beyond two errors the other way. The
    // offsets failed the second (docs/design/valorant.md, "Circuits on one scale").
    const loss = (e, won) => -Math.log(won ? Math.max(1e-12, e) : Math.max(1e-12, 1 - e));
    const bootstrap = (rows, valueOf) => {
      const bySeries = new Map();
      for (const row of rows) {
        const sum = bySeries.get(row.id) ?? [0, 0];
        sum[0] += valueOf(row); sum[1]++;
        bySeries.set(row.id, sum);
      }
      const sums = [...bySeries.values()];
      let seed = 1;
      const draw = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
      const means = Array.from({ length: 1000 }, () => {
        let total = 0, n = 0;
        for (let k = 0; k < sums.length; k++) { const [x, m] = sums[Math.floor(draw() * sums.length)]; total += x; n += m; }
        return total / n;
      });
      const mean = means.reduce((sum, x) => sum + x, 0) / means.length;
      return Math.sqrt(means.reduce((sum, x) => sum + (x - mean) ** 2, 0) / (means.length - 1));
    };
    const corrected = variants['and the circuits\' offsets (not adopted)'];
    const change = rows => rows.reduce((sum, row) => sum + loss(row.e, row.won) - loss(row.before, row.won), 0) / rows.length;
    const paired = rows => `${change(rows).toFixed(4)} ± ${bootstrap(rows, row => loss(row.e, row.won) - loss(row.before, row.won)).toFixed(4)}`;
    console.log(`  the offsets' change, each ± its paired error by series: between circuits ${paired(corrected.filter(between))},`
      + ` between, seasoned ${paired(corrected.filter(row => between(row) && row.seasoned))},`
      + ` within, seasoned ${paired(corrected.filter(row => !between(row) && row.seasoned))}`);
  }
}

const { starts, homes } = CIRCUIT_LEVELS ? levelsAndHomes(series) : { starts: {}, homes: null };
const { players, scored } = runElo(series, { scale: K_SCALE, starts, homes, holdout });
const rated = ratedPlayers(players, last, { minGames: MIN_GAMES, activeDays: ACTIVE_DAYS,
  nationOf: player => nationOfPlayer(player, national), sideOf: player => national.get(player.key)?.team ?? null });
const calibration = calibrationOf(scored);
// How the real maps of the last PLAY_YEARS went between seasoned players, and the host nation's edge at the LANs, each
// side's nation as the ratings give it.
const playFrom = new Date(Date.parse(last) - PLAY_YEARS * 365 * 86400000).toISOString().slice(0, 10);
const nationByKey = new Map([...players.values()].map(player => [player.key, nationOfPlayer(player, national)]));
const { play, home } = playOf(series, { scale: K_SCALE, starts, homes, from: playFrom, nationOf: key => nationByKey.get(key) ?? null });
// The day the cache was fetched: today with --fetch, else the snapshot's own (a run on the cache alone fetches nothing).
const previousFetch = await readFile(snapshotFile, 'utf8').then(text => JSON.parse(text).source?.fetched, () => null);
const fetchedOn = fetching || !previousFetch ? new Date().toISOString().slice(0, 10) : previousFetch;
const snapshot = {
  source: { name: 'vlr.gg', site: SITE, edition: EDITION, fetched: fetchedOn, from: series[0].date, to: last,
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

// The earlier seasons (docs/design/valorant.md, "Earlier seasons"): every calendar year from the first whole one (the cache
// begins in September 2022, with 2023's first Challengers qualifiers) to the one before the cache's last, its players as
// rated on 31 December by the Elo of the maps up to that day, each with the flag and nation the whole record gives him (a
// country is a person's, whichever year it is) and the team he played for that December; its real maps between seasoned
// players; and its map pool, the seven maps most played in its last thousand.
await mkdir(seasonsDir, { recursive: true });
console.log(`\nEarlier seasons, each as rated on 31 December, to ${path.relative(root, seasonsDir)}:`);
const playedMaps = series.flatMap(one => one.games.map(game => ({ date: one.date, name: game.map.name })))
  .filter(map => map.name && map.name !== 'TBD');
for (let year = Number(series[0].date.slice(0, 4)) + 1; year < Number(last.slice(0, 4)); year++) {
  const date = `${year}-12-31`;
  const upTo = series.filter(one => one.date <= date);
  const { starts: startsThen, homes: homesThen } = CIRCUIT_LEVELS ? levelsAndHomes(upTo) : { starts: {}, homes: null };
  const { players: then } = runElo(upTo, { scale: K_SCALE, starts: startsThen, homes: homesThen });
  const ratedThen = ratedPlayers(then, date, { minGames: MIN_GAMES, activeDays: ACTIVE_DAYS,
    flagOf: player => flagOf(players.get(player.key)), nationOf: player => nationByKey.get(player.key) ?? null,
    sideOf: player => national.get(player.key)?.team ?? null });
  const { play: thatYear } = playOf(series, { scale: K_SCALE, starts: startsThen, homes: homesThen, from: `${year}-01-01`,
    until: `${year + 1}-01-01`, nationOf: () => null });
  const lastMaps = playedMaps.filter(map => map.date <= date).slice(-POOL_MAPS);
  const counts = new Map();
  for (const map of lastMaps) counts.set(map.name, (counts.get(map.name) ?? 0) + 1);
  const ranked = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const season = { season: year, date, fetched: snapshot.source.fetched, from: series[0].date, to: upTo.at(-1).date,
    matches: upTo.length, maps: upTo.reduce((sum, one) => sum + one.games.length, 0), rated: ratedThen.length,
    activeDays: ACTIVE_DAYS, minGames: MIN_GAMES, kScale: K_SCALE,
    mapPool: { from: lastMaps[0].date, maps: lastMaps.length, pool: ranked.slice(0, MAP_POOL.length).map(([name]) => name),
      played: Object.fromEntries(ranked) },
    play: { maps: thatYear.maps, rounds: thatYear.rounds, ot: thatYear.ot, roundStats: thatYear.roundStats, series: thatYear.series } };
  await writeFile(path.join(seasonsDir, `${year}.json`), snapshotText(season, ratedThen.map(rowOf)));
  const fielded = nationsOf(ratedThen.map((player, i) => playerOf(rowOf(player), date, i + 1)), { teamSize: TEAM_SIZE, lineup: LINEUP, sport: valorant });
  console.log(`  ${year}: ${ratedThen.length} rated, ${fielded.length} nations (${fielded.slice(0, 4).map(n => `${n.name} ${n.str}`).join(', ')}…);`
    + ` ${thatYear.maps} maps between seasoned players, ${(thatYear.rounds / Math.max(1, thatYear.maps)).toFixed(2)} rounds,`
    + ` ${(100 * thatYear.ot / Math.max(1, thatYear.maps)).toFixed(1)}% to overtime; pool ${season.mapPool.pool.join(', ')}`
    + ` (${ranked.slice(MAP_POOL.length).map(([name, n]) => `${name} ${n}`).join(', ') || 'no other map'} beside it)`);
}
