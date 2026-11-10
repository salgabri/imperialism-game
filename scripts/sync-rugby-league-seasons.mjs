// Snapshot rugby league's earlier seasons (docs/design/rugby-league.md, "Earlier seasons") from their pinned inputs: the
// 2008 NRL season from Rugby League 2: World Cup Edition's own database (RLDatabase.xml, in the zip posted on
// rugbyleaguemods.net), each player checked against the Rugby League Project's (rugbyleagueproject.org) 2008 records, and
// the overall, which the game does not give, computed from the database's attributes (scripts/lib/rugby-league-seasons.mjs).
// Then the seasons 2009 to 2024, which no game rated, computed from NRL.com's match centre (its draw and every game's
// team lists and player stats, the season itself and the two either side), with the Rugby League Project's career
// positions for the few players NRL.com never shows starting.
// The inputs stay in the ignored data-src/rugby-league-seasons/ (NRL.com's replies in nrlcom/), each pinned by SHA-256 in
// scripts/data/rugby-league-seasons-sources.json; only the snapshots are committed.
//
// Usage: node scripts/sync-rugby-league-seasons.mjs [--fetch] [--pin] [--check]
//   --fetch   download the inputs missing from data-src/rugby-league-seasons/ (RLP: one request every three seconds; its
//             robots.txt allows the season, competition and player pages read here. NRL.com: one every 1.2 seconds; its
//             robots.txt disallows nothing)
//   --pin     record the SHA-256 of every input read (after a deliberate new download)
//   --check   rebuild the snapshots and compare them byte for byte; writes nothing
// Output: scripts/data/rugby-league-seasons/<id>.json, read by scripts/build-rugby-league-seasons.mjs.
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { unzipSync } from 'fflate';
import { CLUBS as BUILT_IN_CLUBS } from '../src/data/clubs.rugby-league.js';
import { playerOf } from './lib/nrl.mjs';
import {
  ATTRIBUTE_ORDER, CORE, CORE_REASONS, DEFAULTS, KEPT, PREVIOUS_WEIGHT, REASONS, TEAM_RATING_PARTS, WEIGHTS, areaUnderCurve, bornAlike, clubGamesOf,
  clubOf, clubShiftOf, corePoints, drawGames, drawRounds, findListed, fold, gridPart, matchRecord, mostStarted, overallOf, playerPart,
  positionScore, readOff, readRl2Database, referenceOf, resultsPart, rlpGrid, rlpPlayer, rlpPositions, rlpResults, rlpSquads, rlpTestPlayers,
  seasonFigures, seasonPlayers, seasonValue, spearman, squadsPart, srsOf, teamRatingOf, teamsOf, testsPart,
} from './lib/rugby-league-seasons.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cacheDir = path.join(root, 'data-src/rugby-league-seasons');
const manifestFile = path.join(root, 'scripts/data/rugby-league-seasons.json');
const sourcesFile = path.join(root, 'scripts/data/rugby-league-seasons-sources.json');
const snapshotDir = path.join(root, 'scripts/data/rugby-league-seasons');
const builtInFile = path.join(root, 'scripts/data/rugby-league-26.json');
const RLP = 'https://www.rugbyleagueproject.org/';
const PAUSE_MS = 3000;

const args = process.argv.slice(2);
const unknown = args.filter(arg => !/^--(fetch|pin|check)$/.test(arg));
if (unknown.length) throw new Error(`Unknown option ${unknown[0]}`);
const fetchMissing = args.includes('--fetch'), pin = args.includes('--pin'), check = args.includes('--check');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const sha256 = data => createHash('sha256').update(data).digest('hex');

const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
const sourceList = existsSync(sourcesFile) ? JSON.parse(await readFile(sourcesFile, 'utf8')) : { sources: {} };
const pinned = new Map();

// What an input's pin covers: the whole file, or for an RLP page the part read (its markup around that part carries
// build and render times, and a player's current age, which change from one request to the next).
const PARTS = { grid: gridPart, squads: squadsPart, tests: testsPart, results: resultsPart, player: playerPart };
const partOf = file => (!file.startsWith('rlp/') ? 'file' : file.startsWith('rlp/players/') ? 'player'
  : /\/squads\.html$/.test(file) ? 'squads' : file.startsWith('rlp/competitions/') ? 'tests' : /\/results\.html$/.test(file) ? 'results' : 'grid');
const urlOf = file => (file.startsWith('rlp/') ? `${RLP}${file.slice('rlp/'.length).replace(/^players\/(\d+)\.html$/, 'players/$1')}` : null);

let lastFetch = 0;
async function download(file, url) {
  await sleep(Math.max(0, lastFetch + PAUSE_MS - Date.now()));
  lastFetch = Date.now();
  // A generic agent: no address, account or other personal data goes out with a request.
  const response = await fetch(url, { headers: { 'user-agent': 'imperialism-game-data/1.0' },
    signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  const at = path.join(cacheDir, file);
  await mkdir(path.dirname(at), { recursive: true });
  await writeFile(at, Buffer.from(await response.arrayBuffer()));
}

/** A pinned input's bytes from the cache (downloaded first with --fetch), checked against its pin. */
async function input(file, url = urlOf(file)) {
  const at = path.join(cacheDir, file);
  if (!existsSync(at)) {
    if (!fetchMissing) throw new Error(`Missing data-src/rugby-league-seasons/${file}: run node scripts/sync-rugby-league-seasons.mjs --fetch`);
    await download(file, url);
  }
  const buffer = await readFile(at);
  const kind = partOf(file);
  const hash = sha256(kind === 'file' ? buffer : Buffer.from(PARTS[kind](buffer.toString('utf8'))));
  const entry = sourceList.sources[file];
  if (pin) pinned.set(file, { url, pin: kind === 'file' ? undefined : kind, sha256: hash });
  else if (!entry) throw new Error(`${file} is not pinned in scripts/data/rugby-league-seasons-sources.json: run with --pin after a deliberate download`);
  else if (entry.sha256 !== hash) throw new Error(`data-src/rugby-league-seasons/${file} is not the pinned input (SHA-256 ${hash}, pinned ${entry.sha256})`);
  return buffer;
}
const page = async file => (await input(`rlp/${file}`)).toString('utf8');

/** The database from the posted zip: its one file, checked against the season's pin. */
async function database(season) {
  const zip = await input(season.database.zip, season.url);
  const files = unzipSync(new Uint8Array(zip));
  const names = Object.keys(files);
  if (names.length !== 1 || names[0] !== season.database.file) throw new Error(`The zip holds ${names.join(', ')}, not ${season.database.file} alone`);
  const xml = Buffer.from(files[season.database.file]);
  if (sha256(xml) !== season.database.sha256) throw new Error(`${season.database.file} in the zip is not the pinned database`);
  return readRl2Database(xml.toString('utf8'));
}

/** The player's RLP page, for the date of birth an alias must share. */
const rlpBorn = async id => rlpPlayer(await page(`players/${id}.html`));
// A player named by a name RLP spells otherwise plays under RLP's (his player page's), as the Tecmo seasons take
// nflverse's: Daryl Millard, not the database's Darryl. By database index.
const realNames = new Map();

/**
 * Names `players` (database indexes) of one team against `pool` (RLP's lists of the season): `{ kept, left }`, kept as
 * `[index, rlpId, how]`. A name RLP spells otherwise names him only when RLP gives a date of birth like the database's
 * (bornAlike); one RLP player is never named twice: a second entry of his name is a duplicate, and a loose match to a
 * player another entry already is names nobody.
 */
async function nameTeam(players, pool, byIndex, taken = new Map()) {
  const kept = [], left = [];
  // Whole names first, so a namesake's loose match never takes another's place.
  const found = players.map(index => ({ index, hit: findListed(pool, byIndex.get(index)) }));
  for (const { index, hit } of [...found.filter(f => f.hit?.how === 'name'), ...found.filter(f => f.hit && f.hit.how !== 'name')]) {
    const player = byIndex.get(index);
    if (taken.has(hit.entry.id)) {
      left.push([index, hit.how === 'name' ? `a second entry for ${player.name}, whom RLP lists once (${hit.entry.id})` : null]);
      continue;
    }
    if (hit.how !== 'name') {
      const listed = await rlpBorn(hit.entry.id);
      if (!bornAlike(listed.born, player.born)) {
        left.push([index, `RLP's ${listed.name} (${hit.entry.id}) was born ${listed.born ?? 'on a date it does not give'}, the database's ${player.name} ${player.born}`]);
        continue;
      }
      if (!realNames.has(index)) realNames.set(index, listed.name);
    }
    taken.set(hit.entry.id, index);
    kept.push([index, hit.entry.id, hit.how]);
  }
  for (const { index, hit } of found) if (!hit && !left.some(([other]) => other === index)) left.push([index, null]);
  kept.sort((a, b) => a[0] - b[0]);
  return { kept, left };
}

async function snapshotOf(season) {
  const { players, teams: dbTeams } = await database(season);
  const byIndex = new Map(players.map(p => [p.index, p]));
  realNames.clear();
  const dbTeam = name => {
    const found = dbTeams.filter(team => team.name === name);
    if (found.length !== 1) throw new Error(`The database has ${found.length} teams named ${name}`);
    return found[0];
  };
  const clubs = teamsOf(manifest, season.year);
  const nrlTeams = dbTeams.filter(team => team.type === 0 && team.comp === 0);
  if (nrlTeams.length !== clubs.length || nrlTeams.some(team => !clubs.some(club => club.list === team.name))) {
    throw new Error(`The database's NRL clubs are ${nrlTeams.map(team => team.name).join(', ')}`);
  }

  // RLP's lists of the season, club by club: first grade (the World Club Challenge, the premiership and its finals) and
  // the under-20s' National Youth Competition; the season before only to say why a player is left out.
  const grids = {};
  for (const club of clubs) {
    grids[club.id] = {
      nrl: rlpGrid(await page(`seasons/${season.rlp.season}/${club.rlp}/players.html`)),
      nyc: rlpGrid(await page(`seasons/${season.rlp.youth}/${club.nyc}/players.html`)),
      before: rlpGrid(await page(`seasons/${season.rlp.before}/${club.rlp}/players.html`)),
    };
  }
  const squads = rlpSquads(await page(season.rlp.squads));
  const tests = rlpTestPlayers(await page(season.rlp.tests));

  // The clubs: a player is kept when RLP lists him at the club in 2008.
  const taken = new Map(), clubRows = [], left = [];
  for (const club of clubs) {
    const team = dbTeam(club.list);
    const dupes = team.players.filter((index, i) => team.players.indexOf(index) !== i);
    if (dupes.length) throw new Error(`${club.list} lists ${dupes.join(', ')} twice`);
    const pool = [...grids[club.id].nrl, ...grids[club.id].nyc.filter(entry => !grids[club.id].nrl.some(other => other.id === entry.id))];
    const { kept, left: out } = await nameTeam(team.players, pool, byIndex, taken);
    clubRows.push({ id: club.id, list: club.list, players: kept });
    for (const [index, reason] of out) left.push([club.list, index, reason ?? whyNot(byIndex.get(index), club, clubs, grids)]);
  }

  // The nations: the season's World Cup squads, each player kept when RLP has him in that nation's World Cup squad or in
  // one of its 2008 Tests. The older editions' squads the database carries field no team.
  const nationRows = [];
  for (const nation of manifest.nations[String(season.year)]) {
    const team = dbTeam(nation.list);
    if (team.type !== 2) throw new Error(`${nation.list} is not a national team in the database`);
    const squad = squads[nation.squad];
    if (!squad) throw new Error(`RLP has no World Cup squad ${nation.squad}`);
    const pool = [...squad, ...tests.filter(entry => entry.teams.includes(nation.test) && !squad.some(other => other.id === entry.id))];
    const { kept, left: out } = await nameTeam(team.players, pool, byIndex);
    nationRows.push({ id: nation.id, list: nation.list, players: kept });
    for (const [index, reason] of out) {
      left.push([nation.list, index, reason ?? `not in ${nation.squad}'s 2008 World Cup squad and no 2008 Test for ${nation.squad} (RLP)`]);
    }
  }
  const carriedOver = manifest.carriedOver[String(season.year)].map(name => {
    const team = dbTeam(name);
    return [name, team.players.length];
  });

  // The overall: each kept player's position score, read off the built-in season's overalls at his position by its
  // mid-rank percentile among the 2008 clubs' players there.
  const keptIndexes = [...new Set([...clubRows, ...nationRows].flatMap(row => row.players.map(([index]) => index)))].sort((a, b) => a - b);
  const clubIndexes = new Set(clubRows.flatMap(row => row.players.map(([index]) => index)));
  const scoreOf = new Map(keptIndexes.map(index => [index, positionScore(byIndex.get(index).pos, byIndex.get(index).attributes)]));
  const builtIn = JSON.parse(await readFile(builtInFile, 'utf8')).players.map(playerOf)
    .map(p => ({ name: p.name, club: p.club, pos: p.pos, rating: p.rating }));
  const positions = Object.keys(WEIGHTS);
  const scores = {}, quota = {}, reference = {};
  for (const pos of positions) {
    const at = [...clubIndexes].filter(index => byIndex.get(index).pos === pos);
    scores[pos] = at.map(index => scoreOf.get(index)).sort((a, b) => a - b);
    quota[pos] = Math.round(at.length / clubs.length * 1e4) / 1e4;
    reference[pos] = referenceOf(builtIn, pos, quota[pos]);
  }
  const overall = new Map(keptIndexes.map(index => {
    const pos = byIndex.get(index).pos;
    return [index, overallOf(scoreOf.get(index), scores[pos], reference[pos])];
  }));

  // The star value, a cross-check only: how it ranks with the score at each position, and how well each picks out the
  // clubs' players who played a Test in 2008, and the elite: State of Origin's and Australia's and New Zealand's.
  const tested = new Set(tests.map(entry => entry.id));
  const elite = new Set([...Object.values(rlpSquads(await page(season.rlp.origin))).flat().map(entry => entry.id),
    ...tests.filter(entry => entry.teams.some(code => code === 'AUS' || code === 'NZL')).map(entry => entry.id)]);
  const clubPlayers = clubRows.flatMap(row => row.players.map(([index, id]) => ({ index, id, pos: byIndex.get(index).pos })));
  const star = {
    spearmanByPosition: Object.fromEntries(positions.map(pos => {
      const list = clubPlayers.filter(p => p.pos === pos);
      return [pos, Math.round(spearman(list.map(p => scoreOf.get(p.index)), list.map(p => byIndex.get(p.index).star)) * 1000) / 1000];
    })),
    spearman: Math.round(spearman(clubPlayers.map(p => overall.get(p.index)), clubPlayers.map(p => byIndex.get(p.index).star)) * 1000) / 1000,
    testPlayers: clubPlayers.filter(p => tested.has(p.id)).length,
    testAuc: {
      overall: Math.round(areaUnderCurve(clubPlayers, p => overall.get(p.index), p => tested.has(p.id)) * 1000) / 1000,
      star: Math.round(areaUnderCurve(clubPlayers, p => byIndex.get(p.index).star, p => tested.has(p.id)) * 1000) / 1000,
    },
    elitePlayers: clubPlayers.filter(p => elite.has(p.id)).length,
    eliteAuc: {
      overall: Math.round(areaUnderCurve(clubPlayers, p => overall.get(p.index), p => elite.has(p.id)) * 1000) / 1000,
      star: Math.round(areaUnderCurve(clubPlayers, p => byIndex.get(p.index).star, p => elite.has(p.id)) * 1000) / 1000,
    },
  };

  // The real season, from RLP's results: its regular season by the season's club ids.
  const clubOfSlug = new Map(clubs.map(club => [club.rlp, club.id]));
  const games = rlpResults(await page(season.rlp.results));
  const regular = games.filter(game => /^Round \d+$/.test(game.round)).map(game => {
    const home = clubOfSlug.get(game.home), away = clubOfSlug.get(game.away);
    if (!home || !away) throw new Error(`RLP's result ${game.home} v ${game.away} names a club the season does not have`);
    return { round: Number(game.round.slice(6)), home, away, homeScore: game.homeScore, awayScore: game.awayScore };
  });
  const { records, ...figures } = seasonFigures(regular);
  const ladder = Object.entries(records).map(([id, r]) => [id, r.won, r.drawn, r.lost, r.for, r.against])
    .sort((a, b) => (2 * b[1] + b[2]) - (2 * a[1] + a[2]) || (b[4] - b[5]) - (a[4] - a[5]));

  // How the database rates Super League's players beside the NRL's: every player its Super League clubs list, against the
  // 2008 NRL clubs' kept players, position by position. Its national squads mix the two.
  const superLeague = [...new Set(dbTeams.filter(team => team.type === 0 && team.comp === 1 && team.available).flatMap(team => team.players))]
    .map(index => byIndex.get(index));
  const nrlPlayers = [...clubIndexes].map(index => byIndex.get(index));
  const meanOf = (list, value) => Math.round(list.reduce((s, p) => s + value(p), 0) / list.length * 100) / 100;
  const scales = {
    note: 'Mean position score (`score`) and attribute (`attributes`) of the 2008 NRL clubs\' kept players and of every player the '
      + 'database\'s Super League XIII clubs list, by competition; `starMean` the mean star value.',
    nrl: { players: nrlPlayers.length, starMean: meanOf(nrlPlayers, p => p.star) },
    superLeague: { players: superLeague.length, starMean: meanOf(superLeague, p => p.star) },
    score: Object.fromEntries(positions.map(pos => [pos, [meanOf(nrlPlayers.filter(p => p.pos === pos), p => positionScore(pos, p.attributes)),
      meanOf(superLeague.filter(p => p.pos === pos), p => positionScore(pos, p.attributes))]])),
    attributes: Object.fromEntries(ATTRIBUTE_ORDER.map(key => [key, [meanOf(nrlPlayers, p => p.attributes[key]), meanOf(superLeague, p => p.attributes[key])]])),
  };

  // A name the database spells with a character no name has (an encoding slip) takes the manifest's spelling; a player
  // named by a near name plays under RLP's (realNames).
  const fixes = manifest.nameFixes || {};
  const nameOf = p => {
    const name = fixes[p.name] ?? p.name;
    if (/[^\p{Script=Latin}\s'.-]/u.test(name)) throw new Error(`${JSON.stringify(p.name)} has a character no name has: add it to the manifest's nameFixes`);
    return name;
  };
  const shownAs = p => realNames.get(p.index) ?? nameOf(p);

  // The club shift. A club's team rating, the equal-weight mean of the database's five parts for it (TEAM_RATING_PARTS),
  // is ranked among the season's clubs (mid-rank percentiles, ties sharing one) and read off the built-in clubs' strengths,
  // the 2025 NRL clubs the match model was tuned on: that is its target. Every player of the club then moves by the one
  // whole number that brings its lineup's strength closest to the target, so its players keep their order. No result of
  // the season enters it.
  const clubStrengths = BUILT_IN_CLUBS.map(club => club.str).sort((a, b) => a - b);
  const teamRatings = new Map(clubRows.map(club => [club.id, teamRatingOf(dbTeam(club.list).ratings)]));
  const shiftOf = new Map();
  for (const club of clubRows) {
    const { ratings } = dbTeam(club.list);
    const rating = teamRatings.get(club.id);
    const target = Math.round(readOff(rating, [...teamRatings.values()], clubStrengths) * 100) / 100;
    const pool = club.players.map(([index]) => ({ name: shownAs(byIndex.get(index)), pos: byIndex.get(index).pos, rating: overall.get(index) }));
    const { shift, before, after } = clubShiftOf(pool, target);
    club.team = { parts: Object.keys(TEAM_RATING_PARTS).map(key => ratings[key]), rating: Math.round(rating * 1000) / 1000, target,
      strength: before, shift, shifted: after };
    for (const [index] of club.players) shiftOf.set(index, shift);
  }

  const row = index => {
    const p = byIndex.get(index);
    return [index, shownAs(p), p.pos, p.born, p.star, ATTRIBUTE_ORDER.map(key => p.attributes[key]), scoreOf.get(index), overall.get(index),
      shiftOf.get(index) ?? null];
  };
  // The database's own spelling of every player whose name is shown otherwise.
  const spelled = Object.fromEntries(keptIndexes.filter(index => shownAs(byIndex.get(index)) !== byIndex.get(index).name)
    .map(index => [index, byIndex.get(index).name]));
  return {
    source: { id: season.id, edition: season.edition, label: season.label, retrieved: season.retrieved, url: season.url,
      database: season.database,
      check: 'A player is kept at his club when the Rugby League Project lists him there in 2008 (first grade, finals and World Club '
        + 'Challenge, or the National Youth Competition), and in a nation when it has him in that nation\'s 2008 World Cup squad or in '
        + 'one of its 2008 Tests; a name it spells otherwise only with a date of birth on his RLP page like the database\'s (the '
        + 'same, or one field off in the same year).' },
    conversion: {
      formula: 'Each player\'s score at his primary position is the weighted mean of the attributes `weights` gives it (1–10), any '
        + 'attribute at its database default (`defaults`) or omitted (0) left out; then the position\'s scores among the 2008 clubs\' kept '
        + 'players are ranked (mid-rank percentiles, ties sharing one) and read off `reference`, Rugby League 26\'s overalls at '
        + 'that position (scripts/data/rugby-league-26.json), as many of each 2025 club\'s best as the 2008 clubs carry per club '
        + '(`quota`), by linear interpolation; rounded and held to 1–99: his attribute overall. A national squad\'s player from '
        + 'outside the NRL is placed by his score among the clubs\' players at his position. Then each club is shifted: its team '
        + 'rating, the equal-weight mean of the database\'s five team parts (willingness to attack, attack, defence, flair, support; '
        + '1–10), is ranked among the 2008 clubs (mid-rank percentiles, ties sharing one) and read off `clubShift.reference`, the '
        + 'built-in 2025 NRL clubs\' strengths, by linear interpolation: its target. Every player of the club moves by the one whole '
        + 'number (`shift`) that brings its lineup\'s strength closest to the target (of two as close, the smaller move), held to '
        + '1–99, so its players keep their order. No result of the season enters either step.',
      attributes: ATTRIBUTE_ORDER, defaults: DEFAULTS, weights: WEIGHTS, reasons: REASONS, quota, reference, scores, star, scales,
      clubShift: { parts: Object.values(TEAM_RATING_PARTS), reference: clubStrengths,
        note: 'Each club\'s `team`: its five parts in this order, their mean (`rating`), its target, its lineup\'s strength unshifted '
          + '(`strength`) and shifted (`shifted`), and the shift; every player\'s row ends with his attribute overall and his club\'s shift '
          + '(null outside the clubs).' },
    },
    clubs: clubRows,
    nations: nationRows,
    carriedOver,
    players: keptIndexes.map(row),
    spelled,
    left: left.map(([team, index, reason]) => [team, index, nameOf(byIndex.get(index)), reason]),
    real: { source: `${RLP}${season.rlp.results}`, figures, ladder,
      games: regular.map(game => [game.round, game.home, game.away, game.homeScore, game.awayScore]) },
  };
}

/** Why a club's database player is not kept: where RLP has him in 2008 or 2007, if anywhere. */
function whyNot(player, club, clubs, grids) {
  const named = list => list.some(entry => fold(entry.first + entry.last) === fold(player.first + player.last));
  const elsewhere = clubs.filter(other => other !== club && (named(grids[other.id].nrl) || named(grids[other.id].nyc)));
  if (elsewhere.length) return `played for ${elsewhere.map(other => other.name).join(' and ')} in 2008, not ${club.name} (RLP)`;
  if (named(grids[club.id].before)) return `played for ${club.name} in 2007, no 2008 game for the club (RLP)`;
  const before = clubs.filter(other => named(grids[other.id].before));
  if (before.length) return `played for ${before.map(other => other.name).join(' and ')} in 2007, no 2008 game for any NRL club (RLP)`;
  return 'no first-grade or youth game for any NRL club in 2007 or 2008 (RLP): not shown to be a real player of the club';
}

// ---------- the computed seasons: NRL.com's match centre ----------

const NRLCOM = 'https://www.nrl.com';
const NRLCOM_PAUSE_MS = 1200;
const NRLCOM_AGENT = 'Mozilla/5.0 (compatible; imperialism-game data sync; one request every 1.2 s)';
let lastNrlcom = 0;

/** An NRL.com reply from the cache (downloaded first with --fetch), parsed. Its round's pin covers what is read of it. */
async function nrlcomReply(file, url) {
  const at = path.join(cacheDir, 'nrlcom', file);
  if (!existsSync(at)) {
    if (!fetchMissing) throw new Error(`Missing data-src/rugby-league-seasons/nrlcom/${file}: run node scripts/sync-rugby-league-seasons.mjs --fetch`);
    await sleep(Math.max(0, lastNrlcom + NRLCOM_PAUSE_MS - Date.now()));
    lastNrlcom = Date.now();
    const response = await fetch(url, { headers: { 'user-agent': NRLCOM_AGENT }, signal: AbortSignal.timeout(45000) });
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    const text = await response.text();
    JSON.parse(text);
    await mkdir(path.dirname(at), { recursive: true });
    await writeFile(at, text);
  }
  return JSON.parse(await readFile(at, 'utf8'));
}

/**
 * Checks what a snapshot reads of NRL.com (`content`) against its pin, or records it with --pin. A reply also carries
 * stamps and image links that change from one request to the next, so a pin covers only the part read: a season's
 * rounds, or a round's finished games in its draw and their team lists.
 */
function nrlcomPin(key, url, kind, content, extra = {}) {
  const hash = sha256(JSON.stringify(content));
  const entry = sourceList.sources[key];
  if (pin) pinned.set(key, { url, pin: kind, ...extra, sha256: hash });
  else if (!entry) throw new Error(`${key} is not pinned in scripts/data/rugby-league-seasons-sources.json: run with --pin after a deliberate download`);
  else if (entry.sha256 !== hash) throw new Error(`NRL.com's ${key} is not the pinned input (SHA-256 ${hash}, pinned ${entry.sha256})`);
}

const nrlcomSeasons = new Map();
/**
 * An NRL premiership season from NRL.com's draw and match centre: its finished games in kick-off order, `{ order, round,
 * title, regular, url, venue, home: { team, club, score, players }, away }`, `club` today's id of NRL.com's team, `score` the
 * draw's, `players` the team list (matchRecord's rows), null where the match centre has none.
 */
async function nrlcomSeason(year) {
  if (nrlcomSeasons.has(year)) return nrlcomSeasons.get(year);
  const { competition, teams } = manifest.nrlcom;
  const seasonUrl = `${NRLCOM}/draw/data?competition=${competition}&season=${year}`;
  const rounds = drawRounds(await nrlcomReply(`draw/${competition}-${year}.json`, seasonUrl));
  nrlcomPin(`nrlcom/${year}`, seasonUrl, 'rounds', rounds);
  const listed = [];
  for (const [round] of rounds) {
    const url = `${seasonUrl}&round=${round}`;
    const fixtures = drawGames(await nrlcomReply(`draw/${competition}-${year}-${round}.json`, url));
    const records = [];
    for (const fixture of fixtures) {
      const file = `match/${fixture.url.replace(/^\/draw\//, '').replace(/\/$/, '').replace(/\//g, '_')}.json`;
      records.push(matchRecord(await nrlcomReply(file, `${NRLCOM}${fixture.url}data`)));
    }
    nrlcomPin(`nrlcom/${year}/${round}`, url, 'round', { fixtures, games: records }, { games: fixtures.length });
    fixtures.forEach((fixture, i) => listed.push({ round, fixture, record: records[i] }));
  }
  const clubOfTeam = id => {
    if (!Object.hasOwn(teams, String(id))) throw new Error(`NRL.com's team ${id} (${year}) is no club the manifest's nrlcom names`);
    return teams[String(id)];
  };
  // A player NRL.com lists under a second id plays under his first (the manifest's nrlcom.aliases).
  const aliases = manifest.nrlcom.aliases || {};
  const playerId = row => (Object.hasOwn(aliases, String(row[0])) ? [aliases[String(row[0])], ...row.slice(1)] : row);
  listed.sort((a, b) => String(a.fixture.kickOff).localeCompare(String(b.fixture.kickOff)) || a.round - b.round || a.fixture.url.localeCompare(b.fixture.url));
  const games = listed.map(({ round, fixture, record }, i) => {
    const side = (drawn, kept) => {
      if (kept && kept.team !== drawn[0]) throw new Error(`${fixture.url}: the match centre's team ${kept.team} is not the draw's ${drawn[0]}`);
      return { team: drawn[0], club: clubOfTeam(drawn[0]), score: drawn[2], players: kept ? kept.players.map(playerId) : null };
    };
    return { order: year * 1000 + i, round, title: fixture.title, regular: /^Round \d+$/.test(fixture.title), url: fixture.url, venue: fixture.venue,
      home: side(fixture.home, record?.home), away: side(fixture.away, record?.away) };
  });
  if (!games.length) throw new Error(`NRL.com has no finished game of ${year}`);
  nrlcomSeasons.set(year, games);
  return games;
}

const ORDER = ['FB', 'WG', 'CE', 'FE', 'HB', 'HK', 'PR', 'SR', 'LK'];
/** Each club's game count in `games` (regular season and finals), by `key` of its side (`club`, today's id, unless named). */
function gameCounts(games, key = side => side.club) {
  const counts = {};
  for (const game of games) for (const side of [game.home, game.away]) counts[key(side)] = (counts[key(side)] || 0) + 1;
  return counts;
}

/** The formula as the season's source.conversion states it. */
function computedFormula(year) {
  return `No game rated the ${year} season: each overall is computed from NRL.com's match centre, the season's premiership `
    + 'games, regular season and finals. Players: everyone NRL.com lists taking the field (a player named off the field '
    + 'only with minutes or a counted stat); his club is the one he played most games for (of two as many, the last). '
    + 'Position: the one he started at most in the season by its team lists, whatever his jersey; else most in the seasons '
    + 'either side, then two either side; else the first of his positions on the Rugby League Project; else he is left out. '
    + 'Value: his core points a club game, NRL Fantasy\'s points for eleven stats (`core`: 8 a try, 5 a try assist, 4 a line '
    + 'break, 2 a line-break assist, 1 a tackle, -2 a missed tackle, 2 a tackle break, 4 an offload, -2 an error (where '
    + 'NRL.com records no errors for a game, as for every game of 2013-2015, a handling error), 1 every 10 metres run and 1 '
    + 'every 30 kicked; goals and field goals not counted), the season\'s in full and the season before\'s '
    + `at half weight when he played in it, over his club's games in each. Overall: the value's mid-rank percentile among the `
    + 'season\'s players at his position (ties sharing one), read off `reference`, Rugby League 26\'s overalls at that '
    + 'position (scripts/data/rugby-league-26.json), as many of each 2025 club\'s best as the season\'s clubs carry per club '
    + '(`quota`), by linear interpolation; rounded and held to 1-99. Club shift: the season\'s results set each club\'s '
    + 'level, while its players keep their order. Each club\'s Simple Rating System, its regular season\'s margins adjusted '
    + 'for its opponents and a home edge by least squares, is ranked among the season\'s clubs (mid-rank percentiles) and '
    + 'read off `clubShift.reference`, the built-in 2025 NRL clubs\' strengths: its target. Every player of the club moves '
    + 'by the one whole number (`shift`) that brings its matchday 17\'s strength closest to the target (of two as close, the '
    + 'smaller move), held to 1-99.';
}

/**
 * The snapshot of computed season `season` (scripts/data/rugby-league-seasons.json): every player of the season placed at
 * a position with his stats, value, overall and club shift, each club's games, Simple Rating System, target and shift,
 * the players left out and why, and the real season.
 */
async function computedSnapshotOf(season) {
  const year = season.year;
  const clubs = teamsOf(manifest, year);
  const clubOfFranchise = new Map(clubs.map(club => [club.franchise, club]));
  const games = await nrlcomSeason(year);
  const seasonClub = side => {
    const club = clubOfFranchise.get(side.club);
    if (!club) throw new Error(`${year}: NRL.com's ${side.club} is not a club of the season`);
    return club.id;
  };
  const clubGames = gameCounts(games, seasonClub);
  if (Object.keys(clubGames).length !== clubs.length) throw new Error(`${year}: NRL.com has ${Object.keys(clubGames).length} clubs, the manifest ${clubs.length}`);
  const previousGames = await nrlcomSeason(year - 1);
  const previousClubGames = gameCounts(previousGames);
  const records = new Map();
  for (const at of [year - 2, year - 1, year, year + 1, year + 2]) records.set(at, seasonPlayers(await nrlcomSeason(at)));
  const record = (at, id) => records.get(at).get(id) ?? null;

  // Positions: the season itself, then a season either side, then two either side, then RLP's career positions.
  const placed = [], left = [], rlpIds = {};
  const pending = [];
  for (const player of records.get(year).values()) {
    const club = clubOfFranchise.get(clubOf(player)).id;
    const rings = [['S', [player]], ['S±1', [record(year - 1, player.id), record(year + 1, player.id)]],
      ['S±2', [record(year - 2, player.id), record(year + 2, player.id)]]];
    const found = rings.map(([how, list]) => [how, mostStarted(list)]).find(([, pos]) => pos);
    if (found) placed.push({ player, club, pos: found[1], how: found[0] });
    else pending.push({ player, club });
  }
  pending.sort((a, b) => a.club.localeCompare(b.club) || a.player.name.localeCompare(b.player.name));
  for (const { player, club } of pending) {
    const team = clubs.find(c => c.id === club);
    const grid = rlpGrid(await page(`seasons/nrl-${year}/${team.rlp}/players.html`));
    const [first, ...rest] = player.name.split(' ');
    const hit = findListed(grid, { first, last: rest.join(' ') });
    const nowhere = `started at no position on NRL.com from ${year - 2} to ${year + 2}`;
    if (!hit || hit.how === 'near spelling') {
      left.push([player.id, player.name, club, player.games, `${nowhere}, and the Rugby League Project lists nobody of his name at ${team.name} in ${year}`]);
      continue;
    }
    const positions = rlpPositions(await page(`players/${hit.entry.id}.html`));
    if (!positions.length) {
      left.push([player.id, player.name, club, player.games, `${nowhere}, and the Rugby League Project gives no position for him (${hit.entry.id})`]);
      continue;
    }
    rlpIds[player.id] = hit.entry.id;
    placed.push({ player, club, pos: positions[0], how: 'RLP' });
  }

  // One player, one id: two of one name at one club are NRL.com's duplicate, to be named in nrlcom.aliases. So is one
  // name at one club in the season either side under another id, when neither id plays in the other's season (Pat
  // O'Hanlon's 2012 id, Matt King's 2013 one): his season before and the seasons around him would be lost.
  const named = new Map();
  const namesAt = new Map([year - 1, year + 1].map(at => {
    const byName = new Map();
    for (const p of records.get(at).values()) byName.set(fold(p.name), [...(byName.get(fold(p.name)) || []), p]);
    return [at, byName];
  }));
  for (const entry of placed) {
    const key = `${entry.club}|${entry.player.name}`;
    if (named.has(key)) throw new Error(`${year}: NRL.com lists ${entry.player.name} at ${entry.club} under ${named.get(key)} and ${entry.player.id}: if one player, add the second to nrlcom.aliases`);
    named.set(key, entry.player.id);
    const franchise = clubOf(entry.player);
    for (const at of [year - 1, year + 1]) {
      const other = (namesAt.get(at).get(fold(entry.player.name)) || []).find(p => p.id !== entry.player.id && Object.hasOwn(p.clubs, franchise)
        && !records.get(at).has(entry.player.id) && !records.get(year).has(p.id));
      if (other) throw new Error(`NRL.com lists ${entry.player.name} at ${franchise} under ${entry.player.id} in ${year} and ${other.id} in ${at}: if one player, add the later id to nrlcom.aliases`);
    }
  }

  // Values: core points a club game, the season before at half weight.
  for (const entry of placed) {
    const { player } = entry;
    entry.clubs = Object.keys(player.clubs).map(franchise => [clubOfFranchise.get(franchise).id, player.clubs[franchise]])
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const before = record(year - 1, player.id);
    entry.previous = before ? [before.games, Object.keys(before.clubs).sort().map(franchise => [franchise, before.clubs[franchise]]),
      before.sums.slice(0, Object.keys(CORE).length)] : null;
    entry.value = seasonValue({ points: corePoints(player.sums), clubGames: clubGamesOf(entry.clubs, clubGames) },
      before ? { points: corePoints(entry.previous[2]), clubGames: clubGamesOf(entry.previous[1], previousClubGames) } : null);
  }

  // The overall: the value's mid-rank percentile at the position, read off Rugby League 26's overalls there.
  const builtIn = JSON.parse(await readFile(builtInFile, 'utf8')).players.map(playerOf)
    .map(p => ({ name: p.name, club: p.club, pos: p.pos, rating: p.rating }));
  const values = {}, quota = {}, reference = {};
  for (const pos of ORDER) {
    const at = placed.filter(entry => entry.pos === pos);
    if (!at.length) throw new Error(`${year}: nobody at ${pos}`);
    values[pos] = at.map(entry => entry.value).sort((a, b) => a - b);
    quota[pos] = Math.round(at.length / clubs.length * 1e4) / 1e4;
    reference[pos] = referenceOf(builtIn, pos, quota[pos]);
  }
  for (const entry of placed) entry.overall = overallOf(entry.value, values[entry.pos], reference[entry.pos]);

  // The club shift: the regular season's Simple Rating System, read off the built-in clubs' strengths.
  const regular = games.filter(game => game.regular).map(game => ({ round: game.round, home: seasonClub(game.home), away: seasonClub(game.away),
    homeScore: game.home.score, awayScore: game.away.score }));
  const { ratings, homeEdge } = srsOf(regular);
  const clubStrengths = BUILT_IN_CLUBS.map(club => club.str).sort((a, b) => a - b);
  const clubRows = clubs.map(club => {
    const pool = placed.filter(entry => entry.club === club.id).map(entry => ({ name: entry.player.name, pos: entry.pos, rating: entry.overall }));
    const target = Math.round(readOff(ratings[club.id], Object.values(ratings), clubStrengths) * 100) / 100;
    const { shift, before, after } = clubShiftOf(pool, target);
    for (const entry of placed) if (entry.club === club.id) entry.shift = shift;
    return { id: club.id, list: club.list, games: clubGames[club.id], team: { srs: ratings[club.id], target, strength: before, shift, shifted: after } };
  });

  const { records: results, ...figures } = seasonFigures(regular);
  const ladder = Object.entries(results).map(([id, r]) => [id, r.won, r.drawn, r.lost, r.for, r.against])
    .sort((a, b) => (2 * b[1] + b[2]) - (2 * a[1] + a[2]) || (b[4] - b[5]) - (a[4] - a[5]) || a[0].localeCompare(b[0]));
  const clubOrder = new Map(clubs.map((club, i) => [club.id, i]));
  placed.sort((a, b) => clubOrder.get(a.club) - clubOrder.get(b.club) || ORDER.indexOf(a.pos) - ORDER.indexOf(b.pos) || b.value - a.value
    || a.player.id - b.player.id);
  return {
    source: { id: season.id, method: 'computed', edition: season.edition, label: season.label, retrieved: season.retrieved, url: season.url,
      window: [year - 2, year + 2], games: games.length, regular: regular.length,
      teamLists: games.filter(game => game.home.players && game.away.players).length },
    conversion: {
      formula: computedFormula(year),
      metric: 'core points a club game: NRL Fantasy\'s points for eleven NRL.com stats, the season before at half weight',
      core: { weights: CORE, reasons: CORE_REASONS }, previous: PREVIOUS_WEIGHT, kept: KEPT, quota, reference, values,
      clubShift: { reference: clubStrengths, homeEdge,
        note: 'Each club\'s `team`: its regular season\'s Simple Rating System (`srs`, points a game, home edge `homeEdge`), its '
          + 'target, its lineup\'s strength unshifted (`strength`) and shifted (`shifted`), and the shift.' },
      columns: ['nrlId', 'name', 'club', 'position', 'placedBy', 'games', 'clubs', 'stats (`kept`)', 'previous season [games, clubs, stats (`core`)]',
        'value', 'overall', 'shift'],
    },
    clubs: clubRows,
    previousClubGames: Object.fromEntries(Object.entries(previousClubGames).sort((a, b) => a[0].localeCompare(b[0]))),
    players: placed.map(entry => [entry.player.id, entry.player.name, entry.club, entry.pos, entry.how, entry.player.games, entry.clubs,
      entry.player.sums, entry.previous, entry.value, entry.overall, entry.shift]),
    rlp: rlpIds,
    left: left.sort((a, b) => a[2].localeCompare(b[2]) || a[1].localeCompare(b[1])),
    real: { source: `${NRLCOM}/draw/?competition=${manifest.nrlcom.competition}&season=${year}`, figures, ladder,
      games: regular.map(game => [game.round, game.home, game.away, game.homeScore, game.awayScore]) },
  };
}

/** A computed season's snapshot as text: one row per club, player, left-out player or game. */
function serializeComputed(snapshot) {
  const rows = (list, indent = '    ') => (list.length ? `[\n${list.map(item => `${indent}${JSON.stringify(item)}`).join(',\n')}\n  ]` : '[]');
  const { real } = snapshot;
  return `{
  "source": ${JSON.stringify(snapshot.source)},
  "conversion": ${compactJson(snapshot.conversion, '  ')},
  "clubs": ${rows(snapshot.clubs)},
  "previousClubGames": ${JSON.stringify(snapshot.previousClubGames)},
  "players": ${rows(snapshot.players)},
  "rlp": ${JSON.stringify(snapshot.rlp)},
  "left": ${rows(snapshot.left)},
  "real": {
    "source": ${JSON.stringify(real.source)},
    "figures": ${JSON.stringify(real.figures)},
    "ladder": ${JSON.stringify(real.ladder)},
    "games": ${rows(real.games, '      ').replace(/\n {2}\]$/, '\n    ]')}
  }
}
`;
}

/** JSON with two-space indents and each list of numbers or strings on one line, indented by `pad`. */
const compactJson = (value, pad) => JSON.stringify(value, null, 2)
  .replace(/\[\n\s+((?:[^[\]{}\n]+,\n\s+)*[^[\]{}\n]+)\n\s+\]/g, (_, body) => `[${body.split(/,\n\s+/).join(', ')}]`)
  .replace(/\n/g, `\n${pad}`);

/** The snapshot as text: one row per player, game or left-out player. */
function serialize(snapshot) {
  const rows = (list, indent = '    ') => `[\n${list.map(item => `${indent}${JSON.stringify(item)}`).join(',\n')}\n  ]`;
  const teams = list => `[\n${list.map(team => `    { "id": ${JSON.stringify(team.id)}, "list": ${JSON.stringify(team.list)}, `
    + `${team.team ? `"team": ${JSON.stringify(team.team)}, ` : ''}"players": [\n${team.players
    .map(p => `      ${JSON.stringify(p)}`).join(',\n')}\n    ] }`).join(',\n')}\n  ]`;
  const { real } = snapshot;
  return `{
  "source": ${JSON.stringify(snapshot.source)},
  "conversion": ${compactJson(snapshot.conversion, '  ')},
  "clubs": ${teams(snapshot.clubs)},
  "nations": ${teams(snapshot.nations)},
  "carriedOver": ${JSON.stringify(snapshot.carriedOver)},
  "players": ${rows(snapshot.players)},
  "spelled": ${JSON.stringify(snapshot.spelled)},
  "left": ${rows(snapshot.left)},
  "real": {
    "source": ${JSON.stringify(real.source)},
    "figures": ${JSON.stringify(real.figures)},
    "ladder": ${JSON.stringify(real.ladder)},
    "games": ${rows(real.games, '      ').replace(/\n {2}\]$/, '\n    ]')}
  }
}
`;
}

const outputs = [];
for (const season of manifest.seasons) {
  if (season.method === 'computed') {
    const snapshot = await computedSnapshotOf(season);
    outputs.push([path.join(snapshotDir, `${season.id}.json`), serializeComputed(snapshot)]);
    const by = how => snapshot.players.filter(row => row[4] === how).length;
    const shifts = snapshot.clubs.map(club => club.team.shift);
    console.log(`${season.id}: ${snapshot.source.games} games (${snapshot.source.teamLists} with team lists), ${snapshot.players.length} players placed `
      + `(${by('S')} by the season, ${by('S±1')} a season either side, ${by('S±2')} two either side, ${by('RLP')} by RLP), ${snapshot.left.length} left out; `
      + `shifts ${Math.min(...shifts)} to ${Math.max(...shifts)}, home edge ${snapshot.conversion.clubShift.homeEdge}`);
    continue;
  }
  const snapshot = await snapshotOf(season);
  outputs.push([path.join(snapshotDir, `${season.id}.json`), serialize(snapshot)]);
  const kept = snapshot.clubs.reduce((n, club) => n + club.players.length, 0);
  console.log(`${season.id}: ${kept} club players kept of ${kept + snapshot.left.filter(([team]) => snapshot.clubs.some(c => c.list === team)).length}, `
    + `${snapshot.nations.map(n => `${n.list} ${n.players.length}`).join(', ')}; ${snapshot.left.length} left out`);
  const { star } = snapshot.conversion;
  console.log(`  star cross-check: Spearman ${star.spearman}; AUC for a 2008 Test, overall ${star.testAuc.overall}, star ${star.testAuc.star}; for Origin or an Australia or New Zealand Test, overall ${star.eliteAuc.overall}, star ${star.eliteAuc.star}`);
}

if (check) {
  const differs = [];
  for (const [file, text] of outputs) {
    const current = existsSync(file) ? (await readFile(file, 'utf8')).replace(/\r\n/g, '\n') : null;
    if (current !== text) differs.push(path.relative(root, file));
  }
  if (differs.length) throw new Error(`differs: ${differs.join(', ')}`);
  console.log(`Verified the rugby league season snapshots byte for byte.`);
} else {
  await mkdir(snapshotDir, { recursive: true });
  for (const [file, text] of outputs) await writeFile(file, text);
  if (pin) {
    const sources = Object.fromEntries([...pinned].sort((a, b) => a[0].localeCompare(b[0]))
      .map(([file, entry]) => [file, Object.fromEntries(Object.entries(entry).filter(([, value]) => value !== undefined))]));
    // One input a line, so a new pin's diff reads input by input.
    const lines = Object.entries(sources).map(([file, entry]) => `    ${JSON.stringify(file)}: ${JSON.stringify(entry).replace(/":/g, '": ').replace(/,"/g, ', "')
      .replace(/^\{/, '{ ').replace(/\}$/, ' }')}`);
    const note = 'Every input of scripts/sync-rugby-league-seasons.mjs, under the ignored data-src/rugby-league-seasons/, pinned by SHA-256: '
      + 'the whole file, or for a Rugby League Project page (`pin`) only the part read (its player grid, squads, players or results '
      + 'table, or a player\'s name, date of birth and positions), as the rest of the page changes from one request to the next. '
      + 'NRL.com\'s replies (nrlcom/) are pinned the same way, by what is read of them as JSON: `nrlcom/<season>` a season\'s '
      + 'rounds (`rounds`), `nrlcom/<season>/<round>` a round\'s finished games in its draw and their team lists and player stats '
      + '(`round`, `games` of them).';
    await writeFile(sourcesFile, `{\n  "note": ${JSON.stringify(note)},\n  "sources": {\n${lines.join(',\n')}\n  }\n}\n`);
  }
  console.log(`Wrote ${outputs.map(([file]) => path.relative(root, file)).join(', ')}${pin ? ' and pinned every input' : ''}`);
}
