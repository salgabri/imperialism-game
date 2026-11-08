// Snapshot rugby league's earlier seasons (docs/design/rugby-league.md, "Earlier seasons") from their pinned inputs: the
// 2008 NRL season from Rugby League 2: World Cup Edition's own database (RLDatabase.xml, in the zip posted on
// rugbyleaguemods.net), each player checked against the Rugby League Project's (rugbyleagueproject.org) 2008 records, and
// the overall, which the game does not give, computed from the database's attributes (scripts/lib/rugby-league-seasons.mjs).
// The inputs stay in the ignored data-src/rugby-league-seasons/, each pinned by SHA-256 in
// scripts/data/rugby-league-seasons-sources.json; only the snapshots are committed.
//
// Usage: node scripts/sync-rugby-league-seasons.mjs [--fetch] [--pin] [--check]
//   --fetch   download the inputs missing from data-src/rugby-league-seasons/ (one request every three seconds; RLP's
//             robots.txt allows the season, competition and player pages read here)
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
  ATTRIBUTE_ORDER, DEFAULTS, REASONS, TEAM_RATING_PARTS, WEIGHTS, areaUnderCurve, bornAlike, clubShiftOf, findListed, fold, gridPart,
  overallOf, playerPart, positionScore, readOff, readRl2Database, referenceOf, resultsPart, rlpGrid, rlpPlayer, rlpResults, rlpSquads,
  rlpTestPlayers, seasonFigures, spearman, squadsPart, teamRatingOf, teamsOf, testsPart,
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
  const response = await fetch(url, { headers: { 'user-agent': 'imperialism-game data sync (low rate; github.com/salgabri/imperialism-game)' },
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
    await writeFile(sourcesFile, `${JSON.stringify({
      note: 'Every input of scripts/sync-rugby-league-seasons.mjs, under the ignored data-src/rugby-league-seasons/, pinned by SHA-256: '
        + 'the whole file, or for a Rugby League Project page (`pin`) only the part read (its player grid, squads, players or results '
        + 'table, or a player\'s name and date of birth), as the rest of the page changes from one request to the next.',
      sources }, null, 2)}\n`);
  }
  console.log(`Wrote ${outputs.map(([file]) => path.relative(root, file)).join(', ')}${pin ? ' and pinned every input' : ''}`);
}
