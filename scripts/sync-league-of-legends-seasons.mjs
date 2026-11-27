// League of Legends' earlier seasons, 2016 to 2025, from gol.gg's results (docs/design/league-of-legends.md, "Earlier
// seasons"): two pages a tournament, its match list and its players list, kept gzipped in data-src/golgg/ (git-ignored), from
// which each side's line-up is worked out (scripts/lib/golgg-lineups.mjs). Then rates every player at each year's end by the
// built-in season's Elo (scripts/lib/esports-elo.mjs) and writes scripts/data/league-of-legends-seasons/<year>.json, which
// npm run build:league-of-legends-seasons turns into the seasons. From July 2025 the series pages npm run
// sync:league-of-legends fetched stand instead.
//
// Usage: node scripts/sync-league-of-legends-seasons.mjs [--fetch] [--pause=MS] [--from=YEAR] [--sample] [--lineups] [--tune] [--offsets]
//   npm run sync:league-of-legends-seasons
//   --fetch    fetch the pages the cache lacks, one at a time and PAUSE_MS apart (gol.gg dropped the connections of a faster
//              fetch after 5,000 pages), stopping at the first it refuses; without it nothing is fetched
//   --from     the first season read and built (the year before it has no window of its own then)
//   --sample   with --fetch: also SAMPLE_SERIES series pages a season, drawn by seed, to check the line-ups against
//   --lineups  check the line-ups: against the tournaments whose series pages are read, and the seasons' sample
//   --tune     score the window, K and the levels' prior on each season's second half, each game before it is played
//   --offsets  each region's and circuit's offset in the games between them, over the seasons
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { PAUSE_MS, SITE, cached, golPage, matchListUrl, playersListUrl, readGamePage, readMatchList, readPlayersTable, readSummaryPage, seasonCode, seasonTournaments,
  seasonPlayersUrl, teamsListUrl } from './lib/golgg.mjs';
import { rolesWithin, solveSeason, trainRoles } from './lib/golgg-lineups.mjs';
import { circuitLevels, groupOffsets, homesOf, isOffensiveName, leftOut, mostOf, ratedPlayers, runElo, scoredGames, scoreRows, snapshotText } from './lib/esports-elo.mjs';
import { ACTIVE_DAYS, EDITION, ELO_BASE, K_SCALE, LEVEL_SPREAD, LINEUP, MIN_GAMES, ROLES, nationOfPlayer, nationsOf, playerOf, readCache, rolesOf, rowOf, seriesOf } from './lib/league-of-legends.mjs';
import { ANCHOR_PLAYERS, FIRST_SEASON, LAST_SEASON, WINDOW_YEARS, baseOf, careerRoles, inOrder, lineupsOf, listedSeries, readSeasonLists, readSeasonTeams, rolesIn, usualOfTeams,
  windowOf, yearOfGames } from './lib/league-of-legends-seasons.mjs';
import { GREAT_BRITAIN } from '../src/data/teams.js';

// Great Britain plays as one, as in the built-in season.
const leagueOfLegends = { playsAs: { '826': GREAT_BRITAIN } };

const args = process.argv.slice(2);
const option = name => args.find(arg => arg.startsWith(`--${name}=`))?.split('=')[1];
const known = ['--fetch', '--sample', '--lineups', '--tune', '--offsets'];
const unknown = args.filter(arg => !known.includes(arg) && !/^--(pause|from)=/.test(arg));
if (unknown.length) throw new Error(`Unknown option ${unknown[0]}`);
const fetching = args.includes('--fetch');
const pause = Number(option('pause') ?? PAUSE_MS);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cache = path.join(root, 'data-src', 'golgg');
const outDir = path.join(root, 'scripts', 'data', 'league-of-legends-seasons');
const builtInFile = path.join(root, 'scripts', 'data', 'league-of-legends-elo.json');
const countriesFile = path.join(root, 'scripts', 'data', 'league-of-legends-countries.json');
const today = new Date().toISOString().slice(0, 10);
const SAMPLE_SERIES = 6;
const from = Number(option('from') ?? FIRST_SEASON);
const years = Array.from({ length: LAST_SEASON - from + 1 }, (_, i) => from + i);
const gunzip = async file => gunzipSync(await readFile(file)).toString('utf8');
const inCache = (...parts) => path.join(cache, ...parts);
const fileOf = name => `${encodeURIComponent(name)}.html.gz`;

// ---------- 1. the pages ----------

/**
 * The series drawn to check a season's line-ups against: linked series of SAMPLE_SERIES tournaments whose line-ups are
 * worked out (those with a players list: a tournament whose every series page the cache holds has none), by a fixed draw.
 */
function sampleOf(tournaments, year) {
  const drawn = [];
  let seed = year;
  const draw = n => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return (seed >>> 8) % n; };
  const open = tournaments.filter(t => t.players && t.list?.some(one => one.id != null && one.page));
  while (drawn.length < SAMPLE_SERIES && open.length) {
    const [t] = open.splice(draw(open.length), 1);
    const linked = t.list.filter(one => one.id != null);
    drawn.push({ t, one: linked[draw(linked.length)] });
  }
  return drawn;
}

if (fetching) {
  const jobs = [];
  for (const year of years.slice().reverse()) {
    const tournaments = await seasonTournaments(year, cache, { fetching: true, pause });
    const names = [...new Set(tournaments.slice().sort((a, b) => b.lastgame.localeCompare(a.lastgame) || a.trname.localeCompare(b.trname)).map(t => t.trname))];
    for (const name of names) {
      const list = inCache('matchlists', `${year}`, fileOf(name));
      // A tournament all of whose series pages are read needs no line-ups worked out.
      const series = await cached(list) ? readMatchList(await gunzip(list)) : [];
      if (series.length && (await Promise.all(series.map(one => cached(inCache('series', `${one.id}.html.gz`))))).every(Boolean)) continue;
      jobs.push([matchListUrl(name), list], [playersListUrl(name), inCache('players', `${year}`, fileOf(name))]);
    }
    jobs.push([teamsListUrl(year), inCache('season-teams', `${seasonCode(year)}.html.gz`)]);
    jobs.push([seasonPlayersUrl(year), inCache('season-players', `${seasonCode(year)}.html.gz`)]);
  }
  for (const year of [LAST_SEASON + 1]) {
    jobs.push([teamsListUrl(year), inCache('season-teams', `${seasonCode(year)}.html.gz`)]);
    jobs.push([seasonPlayersUrl(year), inCache('season-players', `${seasonCode(year)}.html.gz`)]);
  }
  let fetched = 0;
  const get = async (url, file) => {
    if (await cached(file)) return;
    await golPage(url, file, { pause });
    if (++fetched % 50 === 0) console.log(`  ${fetched} pages fetched`);
  };
  console.log(`${jobs.length} pages wanted, one every ${pause / 1000} seconds`);
  for (const [url, file] of jobs) await get(url, file);
  if (args.includes('--sample')) {
    for (const year of years) for (const { one } of sampleOf(await readSeasonLists(cache, year), year)) {
      await get(`${SITE}/game/stats/${one.id}/page-${one.page}/`, inCache('sample', `${one.id}.html.gz`));
    }
  }
  console.log(`${fetched} pages fetched`);
}

// ---------- 2. the series whose pages are read, and the roles they give ----------

const builtIn = JSON.parse(await readFile(builtInFile, 'utf8'));
const { series: readSeries, people } = await readCache(cache);
const exactSeries = seriesOf(readSeries, people);
const exact = new Map(exactSeries.map(one => [one.id, one]));
const knownRoles = rolesOf(exactSeries);
// The role model learns from the players of the two years whose series pages give them one role, nine games in ten or more.
const ROLE_GAMES = 10, ROLE_SHARE = 0.9;
const examples = [];
for (const year of [LAST_SEASON, LAST_SEASON + 1]) {
  const players = await gunzip(inCache('season-players', `${seasonCode(year)}.html.gz`)).then(readPlayersTable, () => []);
  for (const player of players) {
    const roles = knownRoles.get(`gg:${player.id}`);
    if (!roles || player.games < ROLE_GAMES) continue;
    const role = mostOf(roles);
    const all = [...roles.values()].reduce((a, b) => a + b, 0);
    if (all >= ROLE_GAMES && roles.get(role) / all >= ROLE_SHARE) examples.push({ player, role });
  }
}
if (!examples.length) { console.error('No series pages cached: run npm run sync:league-of-legends -- --fetch first.'); process.exit(1); }
const model = trainRoles(examples);
console.log(`${exactSeries.length} series read from their pages, from ${exactSeries[0].date}; a role model of ${examples.length} player-seasons`);

// Each player's country: gol.gg's, else the one found for him elsewhere (npm run sync:league-of-legends-countries).
const found = JSON.parse(await readFile(countriesFile, 'utf8').catch(() => '{"players":{}}')).players;
const countryOf = p => (people.get(p.id)?.country ?? p.country ?? found[p.id]?.country ?? null)?.toLowerCase() ?? null;

// ---------- 3. each season's line-ups, and the series they make ----------

const seasons = [];
const series = [];
for (const year of years) {
  const tournaments = await readSeasonLists(cache, year, { model });
  const teams = await readSeasonTeams(cache, year);
  const solved = solveSeason(tournaments.filter(t => t.list && t.players), { usual: usualOfTeams(teams) });
  let short = 0, made = 0;
  for (const t of tournaments) {
    if (!t.list) continue;
    t.lineups = solved.has(t) ? lineupsOf(t, solved.get(t)) : new Map();
    const own = listedSeries(t, t.lineups, { exact, flagOf: countryOf });
    series.push(...own.series);
    short += own.short;
    made += own.series.length;
  }
  const lacking = tournaments.filter(t => !t.list || (!t.players && t.list.some(one => !exact.has(one.id))));
  seasons.push({ year, tournaments, teams, solved, made, short });
  console.log(`${year}: ${tournaments.length} tournaments (${lacking.length} lack a list), ${made} series${short ? `, ${short} left out for want of line-ups` : ''}`);
}
// gol.gg files a December's tournaments under the next season (the KeSPA Cup, the Demacia Cup): the last season's December is
// the built-in season's start, whose series pages the cache holds.
const lastDay = `${LAST_SEASON}-12-31`;
let december = 0;
for (const t of await readSeasonLists(cache, LAST_SEASON + 1)) {
  if (!t.list || t.from > lastDay) continue;
  const own = listedSeries(t, new Map(), { exact }).series.filter(one => one.date <= lastDay);
  series.push(...own);
  december += own.length;
}
console.log(`${LAST_SEASON + 1}'s tournaments before ${lastDay}: ${december} series`);
inOrder(series);
// Each player's roles over every season's series and the built-in season's pages: his career's word on his role (rolesIn).
const career = careerRoles([...series, ...exactSeries.filter(one => one.date > lastDay)]);

/**
 * The sampled series' players, against the line-ups worked out: how many stand in the side they played for, and of those
 * how many at the role they played (a page lists a side of five top, jungle, mid, bot, support; one of six, with a
 * substitute, in no such order, as seriesOf reads it).
 */
async function checkSample() {
  const all = { series: 0, players: 0, right: 0, placed: 0, roles: 0 };
  for (const { year, tournaments } of seasons) {
    const own = { series: 0, players: 0, right: 0, placed: 0, roles: 0, wrong: [], misplaced: [] };
    for (const { t, one } of sampleOf(tournaments, year)) {
      const html = await gunzip(inCache('sample', `${one.id}.html.gz`)).catch(() => null);
      const page = html && (one.page === 'summary' ? readSummaryPage(html) : readGamePage(html));
      if (!page) continue;
      own.series++;
      page.teams.forEach((team, s) => {
        const side = new Map((t.lineups.get(team.name) ?? []).map(p => [p.id, p]));
        page.players[s].forEach((player, k) => {
          own.players++;
          const found = side.get(player.id);
          if (!found) { own.wrong.push(`${player.name} of ${team.name} (${t.name})`); return; }
          own.right++;
          if (page.players[s].length !== ROLES.length) return;
          own.placed++;
          if (found.role === ROLES[k]) own.roles++;
          else own.misplaced.push(`${player.name} ${found.role}, not ${ROLES[k]}`);
        });
      });
    }
    for (const key of ['series', 'players', 'right', 'placed', 'roles']) all[key] += own[key];
    if (own.series) {
      console.log(`  ${year}: ${own.right} of the ${own.players} players of ${own.series} sampled series in the side they played for${own.wrong.length ? ` (not ${own.wrong.join(', ')})` : ''};`
        + ` ${own.roles} of the ${own.placed} of a side of five at their role${own.misplaced.length ? ` (${own.misplaced.join(', ')})` : ''}`);
    }
  }
  if (all.series) {
    console.log(`  all: ${all.right} of ${all.players} players in ${all.series} series (${(100 * all.right / all.players).toFixed(1)}%), ${all.roles} of ${all.placed} at their role`
      + ` (${(100 * all.roles / Math.max(1, all.placed)).toFixed(1)}%)`);
  }
}

if (args.includes('--lineups')) {
  console.log('\nThe line-ups, checked:');
  // The built-in season's tournaments whose pages are all read, where their players lists are cached too.
  const tournaments = (await readSeasonLists(cache, LAST_SEASON + 1, { model })).filter(t => t.list && t.players);
  const solved = solveSeason(tournaments, { usual: usualOfTeams(await readSeasonTeams(cache, LAST_SEASON + 1)) });
  const pages = new Map(readSeries.map(one => [one.id, one]));
  const sums = { games: 0, grouped: 0, named: 0, roleGames: 0, roles: 0, tournaments: 0 };
  for (const t of tournaments) {
    const linked = t.list.filter(one => one.id != null);
    const read = linked.map(one => pages.get(one.id)).filter(Boolean);
    if (read.length < linked.length * 0.95) continue;
    const truth = new Map();
    for (const page of read) page.teams.forEach((team, s) => page.players[s].forEach(player => {
      if (!truth.has(player.id)) truth.set(player.id, new Map());
      truth.get(player.id).set(team.name, (truth.get(player.id).get(team.name) ?? 0) + page.games.length);
    }));
    sums.tournaments++;
    const one = solved.get(t);
    const groups = new Map();
    for (const p of t.players) { const team = one.teamOf.get(p.id) ?? null; if (!groups.has(team)) groups.set(team, []); groups.get(team).push(p); }
    for (const [team, members] of groups) {
      const votes = new Map();
      for (const p of members) { const real = mostOf(truth.get(p.id)); if (real) votes.set(real, (votes.get(real) ?? 0) + p.games); }
      const roles = team == null ? new Map() : rolesWithin(members);
      for (const p of members) {
        const real = mostOf(truth.get(p.id));
        if (!real) continue;
        sums.games += p.games;
        if (team != null && real === mostOf(votes)) sums.grouped += p.games;
        if (real === team) sums.named += p.games;
        const role = mostOf(knownRoles.get(`gg:${p.id}`));
        if (team != null && role) { sums.roleGames += p.games; if (roles.get(p.id) === role) sums.roles += p.games; }
      }
    }
  }
  const share = (a, b) => `${(100 * a / Math.max(1, b)).toFixed(1)}%`;
  console.log(`  ${sums.tournaments} tournaments of ${LAST_SEASON + 1} known from their series pages: ${share(sums.grouped, sums.games)} of the players' games beside the right team-mates,`
    + ` ${share(sums.named, sums.games)} under the right team's name, ${share(sums.roles, sums.roleGames)} in the right role`);
  await checkSample();
}

// ---------- 4. the window, K and the levels' prior ----------

const between = row => row.circuits[0] && row.circuits[1] && row.circuits[0] !== row.circuits[1];
// The regions the circuits make, for --offsets.
const REGION = { KR: 'Korea', 'KR-2': 'Korea', CN: 'China', TW: 'Pacific', PCS: 'Pacific', VN: 'Pacific', JP: 'Pacific', 'JP-2': 'Pacific', SEA: 'Pacific', OCE: 'Pacific',
  NA: 'North America', 'NA-2': 'North America', BR: 'Latin America', 'BR-2': 'Latin America', LAN: 'Latin America', LAS: 'Latin America', LAT: 'Latin America',
  'LAT-2': 'Latin America', 'LTA South': 'Latin America', CIS: 'CIS' };
const regionOf = circuit => REGION[circuit] ?? 'Europe';
/** Season `year`'s games from July, each scored before it is played: the levels and homes fitted on the window's games before. */
function heldOut(year, { window = WINDOW_YEARS, scale = K_SCALE, levelSpread = LEVEL_SPREAD, levels = true } = {}) {
  const cut = `${year}-07-01`;
  const from = `${year - window + 1}-01-01`;
  const own = series.filter(one => one.date >= from && one.date <= `${year}-12-31`);
  const fitted = levels ? { starts: circuitLevels(own, { until: cut, levelSpread }), homes: homesOf(own, { until: cut }) } : {};
  return scoredGames(own, { scale, ...fitted }, { from: cut, minGames: MIN_GAMES });
}
const lossLine = rows => {
  const part = (name, kept) => { const s = scoreRows(kept); return `${name} ${s.logLoss?.toFixed(4) ?? '—'} (${s.n})`; };
  return [part('all', rows), part('between circuits', rows.filter(between)), part('within', rows.filter(row => !between(row))),
    part('between, seasoned', rows.filter(row => between(row) && row.seasoned)), part('within, seasoned', rows.filter(row => !between(row) && row.seasoned))].join('  ');
};
if (args.includes('--tune')) {
  console.log('\nEach season\'s games from 1 July, scored before each is played:');
  const each = options => years.flatMap(year => heldOut(year, options));
  console.log(`  every newcomer at 1500: ${lossLine(each({ levels: false }))}`);
  for (const window of [1, 2, 3]) console.log(`  window ${window}: ${lossLine(each({ window }))}`);
  for (const scale of [80, 120, 160, 200, 240, 320]) console.log(`  K ${String(scale).padStart(3)}: ${lossLine(each({ scale }))}`);
  for (const levelSpread of [100, 200, 300, 500, 800]) console.log(`  levels' prior ${String(levelSpread).padStart(3)}: ${lossLine(each({ levelSpread }))}`);
  for (const year of years) console.log(`  ${year}, as shipped: ${lossLine(heldOut(year))}`);
}

// ---------- 5. each season ----------

const show = ([group, o]) => `${group} ${o.elo > 0 ? '+' : ''}${o.elo} ± ${o.se} (${o.won} of ${o.expected} in ${o.n})`;
await mkdir(outDir, { recursive: true });
const todays = builtIn.players.map(row => row[5]);
const shipped = [];
console.log('\nEarlier seasons, each as rated on 31 December:');
for (const { year, tournaments, teams, made, short } of seasons) {
  const date = `${year}-12-31`;
  const own = windowOf(series, year);
  const starts = circuitLevels(own, { levelSpread: LEVEL_SPREAD });
  const homes = homesOf(own);
  const { players } = runElo(own, { scale: K_SCALE, starts, homes });
  const roles = rolesIn(own, year, career);
  const rated = ratedPlayers(players, date, { minGames: MIN_GAMES, activeDays: ACTIVE_DAYS, nationOf: nationOfPlayer })
    .map(player => ({ ...player, role: roles.get(player.key) ?? null }));
  const base = baseOf(rated.map(player => player.elo), todays, ELO_BASE);
  const ofYear = own.filter(one => one.date >= `${year}-01-01`);
  const snapshot = { season: year, date, fetched: today, from: own[0].date, to: own.at(-1).date, tournaments: new Set(own.map(one => one.tournament)).size,
    series: own.length, games: own.reduce((sum, one) => sum + one.games.length, 0), ofYear: { series: ofYear.length, games: ofYear.reduce((sum, one) => sum + one.games.length, 0) },
    rated: rated.length, activeDays: ACTIVE_DAYS, minGames: MIN_GAMES, kScale: K_SCALE, starts, base, anchor: { players: ANCHOR_PLAYERS },
    noCountry: rated.filter(player => !player.flag && !isOffensiveName(player.name)).length, lineups: { series: made, short }, play: yearOfGames(tournaments, teams) };
  await writeFile(path.join(outDir, `${year}.json`), snapshotText(snapshot, rated.map(rowOf)));
  const asPlayers = rated.map((player, i) => playerOf(rowOf(player), date, i + 1, base));
  const nations = nationsOf(asPlayers, leagueOfLegends);
  const { noNation, short: fewer } = leftOut(asPlayers, { lineup: LINEUP });
  shipped.push({ year, own, starts, homes });
  console.log(`  ${year}: ${snapshot.series} series, ${rated.length} rated, ${nations.length} nations (${nations.slice(0, 6).map(n => `${n.name} ${n.str}`).join(', ')}…);`
    + ` base ${base}; ${noNation.length} play for no nation (${snapshot.noCountry} with no country), ${fewer.length} from one of fewer than ${LINEUP};`
    + ` ${snapshot.play.minutes} minutes, kills ${snapshot.play.kills.winner}–${snapshot.play.kills.loser}`);
  console.log(`      ${asPlayers.slice(0, 12).map(p => `${p.name} ${p.role} ${p.rating}`).join(', ')}`);
}

// The built-in season's year by the same measure: what each season's games are scaled against.
const builtInYear = LAST_SEASON + 1;
const builtInGames = { season: builtInYear, fetched: today, ...yearOfGames(await readSeasonLists(cache, builtInYear), await readSeasonTeams(cache, builtInYear)) };
await writeFile(path.join(outDir, 'built-in-games.json'), `${JSON.stringify(builtInGames, null, 1)}\n`);
console.log(`  ${builtInYear}, for scale: ${builtInGames.minutes} minutes, kills ${builtInGames.kills.winner}–${builtInGames.kills.loser}, Barons ${builtInGames.nashors.winner}–${builtInGames.nashors.loser}`);

// ---------- 6. the circuits on one scale ----------

if (args.includes('--offsets')) {
  console.log('\nThe games between circuits, as the shipped seasons rate them (each year\'s own games, all ten of a game\'s players seasoned):');
  const rows = shipped.flatMap(({ year, own, starts, homes }) => scoredGames(own, { scale: K_SCALE, starts, homes }, { from: `${year}-01-01`, minGames: MIN_GAMES })
    .filter(row => row.seasoned).map(row => ({ ...row, year })));
  console.log(`  regions: ${Object.entries(groupOffsets(rows, regionOf)).map(show).join('; ')}`);
  for (const year of years) console.log(`  ${year}: ${Object.entries(groupOffsets(rows.filter(row => row.year === year), regionOf)).map(show).join('; ')}`);
  const circuits = Object.entries(groupOffsets(rows)).filter(([, o]) => o.n >= 30);
  console.log(`  circuits beyond two errors, of ${circuits.length} with 30 games or more: ${circuits.filter(([, o]) => Math.abs(o.elo) > 2 * o.se).map(show).join('; ') || 'none'}`);
  console.log('  held out (each season\'s games from 1 July, the levels fitted on those before):');
  const held = years.flatMap(year => heldOut(year).filter(row => row.seasoned));
  console.log(`  regions: ${Object.entries(groupOffsets(held, regionOf)).map(show).join('; ')}`);
}
console.log(`\nWrote ${seasons.length} seasons to ${path.relative(root, outDir)} (${EDITION})`);
