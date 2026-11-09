// Snapshot a tour's earlier seasons from the inputs its manifest pins: the men's (docs/design/tennis.md, "Earlier
// seasons"; scripts/data/tennis-seasons.json) or, with --tour=wta, the women's (docs/design/womens-tennis.md, "Earlier
// seasons"; scripts/data/womens-tennis-seasons.json). The inputs are Jeff Sackmann's match results (1968-2025) and the
// Wayback Machine's captures of Tennis Abstract's Elo and rankings reports. Each input is read from the ignored cache
// (data-src/tennis-seasons/, data-src/womens-tennis-seasons/), or downloaded from its pinned address when missing, and
// must match its SHA-256.
//
//   npm run sync:tennis-seasons              writes scripts/data/tennis-seasons/<year>.json and validation.json
//   npm run sync:womens-tennis-seasons       the same with --tour=wta: scripts/data/womens-tennis-seasons/
//   --check                                  rebuilds them and compares byte for byte, writes nothing
//   --refresh                                downloads every input again (still checked against its pin)
//
// A computed season is the year-end Elo of every player with ten counted matches in it, by Tennis Abstract's published
// method (scripts/lib/tennis-elo.mjs, the manifest's `method`), each with the nation the player played for that
// season (scripts/lib/tennis-seasons.mjs). A published season is Tennis Abstract's own year-end report, with each
// player's country from its rankings report of the nearest date. validation.json holds the checks of the method
// against every number Tennis Abstract has published by it.
//
// The men's seasons before 1973 (`seasons.early`, docs/design/tennis.md, "Before 1973") come from a second run,
// `method.early`: the amateur file (the majors and the Davis Cup, 1877-1967) read before the open era's files, with
// its duplicate ids merged. It is kept apart from the first, so the seasons from 1973 are as they were.
// validation.json's `early` holds its fit and its seam with the first run, and `checks` the agreement of the seasons
// before 1973 with the published top tens and Tennis Abstract's statements (the manifest's `checks`).
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { agreement, applyAliases, atpLevelOf, davisCupNations, earlyLevelOf, orderMatches, parseMatchFile, rateMatches, wtaLevelOf } from './lib/tennis-elo.mjs';
import { codeOfDay, nationOfDay } from './lib/tennis-seasons.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
// Each tour's manifest, cache, snapshots and match files, its rankings' rank column and its rule of counted matches.
const TOURS = {
  atp: { manifest: 'scripts/data/tennis-seasons.json', cache: 'data-src/tennis-seasons', out: 'scripts/data/tennis-seasons',
    main: season => `atp_matches_${season}.csv`, other: season => `atp_matches_qual_chall_${season}.csv`, players: 'atp_players.csv',
    rank: 'ATP Rank', levelOf: atpLevelOf, noun: 'tennis', cup: 'Davis Cup', unresolved: 'davisCupRubbersUnresolved' },
  wta: { manifest: 'scripts/data/womens-tennis-seasons.json', cache: 'data-src/womens-tennis-seasons', out: 'scripts/data/womens-tennis-seasons',
    main: season => `wta_matches_${season}.csv`, other: season => `wta_matches_qual_itf_${season}.csv`, players: 'wta_players.csv',
    rank: 'WTA Rank', levelOf: wtaLevelOf, noun: "women's tennis", cup: 'Fed Cup', unresolved: 'fedCupRubbersUnresolved' },
};
const args = process.argv.slice(2);
const unknown = args.filter(arg => !['--check', '--refresh'].includes(arg) && !/^--tour=/.test(arg));
if (unknown.length) throw new Error(`Unknown option ${unknown[0]}`);
const check = args.includes('--check'), refresh = args.includes('--refresh');
const tourId = args.find(arg => arg.startsWith('--tour='))?.slice('--tour='.length) ?? 'atp';
const tour = TOURS[tourId];
if (!tour) throw new Error(`Unknown tour ${tourId}: atp or wta`);
const cacheDir = path.join(root, tour.cache);
const outDir = path.join(root, tour.out);
const manifest = JSON.parse(await readFile(path.join(root, tour.manifest), 'utf8'));
const PAUSE_MS = 1500;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const sha256 = data => createHash('sha256').update(data).digest('hex');

/** A pinned input's text: from the cache unless `refresh`, else downloaded; either way it must match its SHA-256. */
async function pinned(folder, file, url, expected) {
  const at = path.join(cacheDir, folder, file);
  if (!refresh && existsSync(at)) {
    const data = await readFile(at);
    if (sha256(data) !== expected) throw new Error(`${path.relative(root, at)} does not match its pin; delete it to download it again`);
    return data.toString('utf8');
  }
  for (let attempt = 0; ; attempt++) {
    try {
      // fetch decodes a capture stored gzipped, so the pin is the page's own bytes.
      const response = await fetch(url, { headers: { 'user-agent': 'imperialism-game data sync' }, signal: AbortSignal.timeout(60000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = Buffer.from(await response.arrayBuffer());
      if (sha256(data) !== expected) throw new Error(`does not match its pin (${sha256(data)})`);
      await mkdir(path.dirname(at), { recursive: true });
      await writeFile(at, data);
      await sleep(PAUSE_MS);
      return data.toString('utf8');
    } catch (error) {
      if (attempt === 2) throw new Error(`${url}: ${error.message}`);
      await sleep(PAUSE_MS * 4);
    }
  }
}
const archiveFile = file => pinned('sackmann', file, `${manifest.archive.raw}${file}`, manifest.archive.files[file]);
const captureUrl = (capture, original) => manifest.wayback.replace('{capture}', capture).replace('{original}', original);

// ---------- inputs ----------

const [firstComputed, lastComputed] = manifest.seasons.computed;
const [firstPublished, lastPublished] = manifest.seasons.published;
const FIRST_FILE = 1968;
let matches = [];
for (let season = FIRST_FILE; season <= lastPublished; season++) {
  matches.push(...parseMatchFile(await archiveFile(tour.main(season)), { season, file: 0 }));
  const qc = tour.other(season);
  if (manifest.archive.files[qc]) matches.push(...parseMatchFile(await archiveFile(qc), { season, file: 1 }));
}
matches = orderMatches(matches);

/** The player file: id → { name, ioc, born } (a quoted name may hold a comma or doubled quotes). */
function playerFile(text) {
  const split = line => {
    const cells = [];
    let cell = '', quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (quoted && ch === '"' && line[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') quoted = !quoted;
      else if (ch === ',' && !quoted) { cells.push(cell); cell = ''; } else cell += ch;
    }
    cells.push(cell);
    return cells;
  };
  const lines = text.replace(/\r/g, '').split('\n').filter(Boolean);
  const head = split(lines[0]);
  const at = name => head.indexOf(name);
  const players = new Map();
  for (const line of lines.slice(1)) {
    const c = split(line);
    const dob = c[at('dob')];
    players.set(c[at('player_id')], { name: `${c[at('name_first')]} ${c[at('name_last')]}`.trim(), ioc: c[at('ioc')] || null,
      born: /^\d{8}$/.test(dob) ? `${dob.slice(0, 4)}-${dob.slice(4, 6)}-${dob.slice(6)}` : null });
  }
  return players;
}
const people = playerFile(await archiveFile(tour.players));

const text = cell => cell.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
/** A Tennis Abstract report's table (`id="reportable"`): its header and rows `{ key, cells }`. */
function reportTable(html) {
  const table = html.slice(html.indexOf('id="reportable"'));
  const rows = [...table.matchAll(/<tr[^>]*>(.*?)<\/tr>/gs)].map(match => match[1]);
  const head = [...rows[0].matchAll(/<th[^>]*>(.*?)<\/th>/gs)].map(match => text(match[1]));
  const body = rows.slice(1).map(row => ({ key: row.match(/player\.cgi\?p=([^"<>&]+)"/)?.[1] ?? null,
    cells: [...row.matchAll(/<td[^>]*>(.*?)<\/td>/gs)].map(match => text(match[1])) }));
  if (body.some(row => !row.key)) throw new Error('A report row without a player link');
  return { head, body };
}
const updatedOf = html => html.match(/Last update:\s*(\d{4}-\d{2}-\d{2})/)?.[1] ?? null;
const canonical = key => manifest.keyAliases[key] ?? key;
const number = (value, what) => {
  const n = Number(value);
  if (value === '' || !Number.isFinite(n)) throw new Error(`Not a number for ${what}: ${JSON.stringify(value)}`);
  return n;
};

// Tennis Abstract's rankings report: each capture's country and birth date by player key.
const rankings = [];
for (const entry of manifest.rankings) {
  const html = await pinned('wayback', `rank_${entry.capture}.html`, captureUrl(entry.capture, entry.original), entry.sha256);
  if (updatedOf(html) !== entry.updated) throw new Error(`The rankings capture ${entry.capture} is of ${updatedOf(html)}, not ${entry.updated}`);
  const { head, body } = reportTable(html);
  if (JSON.stringify(head) !== JSON.stringify(['Rank', 'Player', 'Country', 'Birthdate'])) throw new Error(`The rankings capture ${entry.capture}'s columns changed`);
  const byKey = new Map();
  for (const { key, cells: [, , country, born] } of body) {
    // A few players stand under no flag (2024's ATP list has four): the next capture, or the player file, says where from.
    if (country === '') continue;
    // A cell the report itself garbled (the manifest names each one: 2016's WTA list gives Megan Mccray "rc=") says nothing.
    if (entry.garbled?.[key] === country) continue;
    if (!/^[A-Z]{3}$/.test(country)) throw new Error(`${key}: a country ${JSON.stringify(country)} in the rankings capture ${entry.capture}`);
    byKey.set(canonical(key), { country, born: /^\d{4}-\d{2}-\d{2}$/.test(born) ? born : null });
  }
  rankings.push({ ...entry, byKey });
}

// ---------- the Elo of every season ----------

const nationRules = manifest.nations;
const { nations: davisCup, unresolved } = davisCupNations(matches, (ioc, season) => (ioc ? codeOfDay(ioc, season, ioc, nationRules) : null));
const allSeasons = [];
for (let season = firstComputed; season <= lastPublished; season++) allSeasons.push(season);
const asOf = Object.fromEntries(manifest.reports.map(report => [report.season, Number(report.updated.replaceAll('-', ''))]));
const levelOf = tour.levelOf;
const main = rateMatches(matches, manifest.method, { seasons: allSeasons, yElo: true, levelOf });
// The same method dated as Tennis Abstract's reports, for the check against them.
const dated = rateMatches(matches, manifest.method, { seasons: manifest.reports.map(report => report.season), asOf, levelOf });
const v1 = rateMatches(matches, manifest.method.v1, { seasons: manifest.reports.filter(report => report.method === 'pre-2018').map(report => report.season), asOf, levelOf });

const isoDate = yyyymmdd => `${String(yyyymmdd).slice(0, 4)}-${String(yyyymmdd).slice(4, 6)}-${String(yyyymmdd).slice(6)}`;
const row = cells => JSON.stringify(cells);
const documentText = (head, rows) => `{\n${Object.entries(head).map(([key, value]) => `${JSON.stringify(key)}: ${JSON.stringify(value)}`).join(',\n')},\n"players": [\n${rows.map(row).join(',\n')}\n]\n}\n`;

/** A computed season's rows, strongest first: every player of `players` with `activity` counted matches in it. */
function computedRows(players, season, activity, cup) {
  return players.filter(player => player.season >= activity).map(player => {
    const person = people.get(player.id);
    if (!person) throw new Error(`${season}: ${player.name} (${player.id}) is not in the player file`);
    const { code, how } = nationOfDay({ id: player.id, ioc: person.ioc, davisCup: cup.get(player.id) }, season, nationRules);
    return [player.id, person.name, code, how, person.born, player.elo, player.season];
  });
}
const COLUMNS = ['id', 'name', 'nation of the day', 'how', 'born', 'elo', 'matches'];

const outputs = [];
// Each computed season's rows and its run's whole list (everyone with a counted match), for the checks.
const seasonLists = {};
for (let season = firstComputed; season <= lastComputed; season++) {
  const { last, date, players } = main.snapshots[season];
  const rows = computedRows(players, season, manifest.method.activity, davisCup);
  const head = { season, kind: 'computed', lastEvent: isoDate(last), date: isoDate(date), rated: rows.length, columns: COLUMNS };
  outputs.push([path.join(outDir, `${season}.json`), documentText(head, rows)]);
  seasonLists[season] = { rows, players, run: main };
}

// ---------- the men's seasons before 1973 ----------

/**
 * The second run (`method.early`): the amateur file before the open era's files, every match with the amateur file's
 * duplicate ids merged (each pair checked: both in the player file, no chain, a country in common, never in one
 * event), its newcomers at `start.amateur`, its layoffs charged only from `layoff.amateurWeeks`. Its seasons list
 * `activity.amateur` counted matches before 1968 and `activity.open` after, and take their nations from its own Davis
 * Cup rows, aliases applied.
 */
async function earlyRun() {
  const E = manifest.method.early;
  const amateur = parseMatchFile(await archiveFile(E.file), { file: 2, pad: true });
  const all = [...amateur, ...matches];
  const aliasOf = new Map();
  for (const [from, to, name] of E.aliases.items) {
    if (aliasOf.has(from) || !people.has(from) || !people.has(to)) throw new Error(`The alias of ${name} (${from} → ${to}) is repeated or not in the player file`);
    aliasOf.set(from, to);
  }
  const paired = new Set([...aliasOf.keys(), ...aliasOf.values()]);
  const countries = new Map(), events = new Map();
  for (const m of all) {
    for (const [id, ioc] of [[m.winner, m.winnerIoc], [m.loser, m.loserIoc]]) {
      if (!paired.has(id)) continue;
      if (!countries.has(id)) { countries.set(id, new Set([people.get(id).ioc])); events.set(id, new Set()); }
      countries.get(id).add(ioc);
      events.get(id).add(`${m.file === 2 ? 'amateur' : m.season}:${m.event}`);
    }
  }
  for (const [from, to, name] of E.aliases.items) {
    if (!countries.has(from) || !countries.has(to)) throw new Error(`The alias of ${name} (${from} → ${to}) names an id with no match`);
    if (aliasOf.has(to)) throw new Error(`The alias of ${name} joins ${to}, itself merged`);
    if (![...countries.get(from)].some(code => countries.get(to).has(code))) throw new Error(`The alias of ${name} (${from} → ${to}) shares no country`);
    if ([...events.get(from)].some(event => events.get(to).has(event))) throw new Error(`The alias of ${name} (${from} → ${to}) joins two men of one event`);
  }
  const merged = applyAliases(all, aliasOf);
  const moved = merged.filter((m, i) => m !== all[i]).length;
  const earlyMatches = orderMatches(merged);
  const method = { ...manifest.method, start: { ...manifest.method.start, amateur: E.start.amateur },
    layoff: { ...manifest.method.layoff, from: E.layoff.from, amateurWeeks: E.layoff.amateurWeeks } };
  const [from, to] = manifest.seasons.early;
  const [, lastAmateur] = manifest.seasons.amateur;
  const seam = { from: firstComputed, to: 1980 };
  const seasons = [];
  for (let season = from; season <= seam.to; season++) seasons.push(season);
  const run = rateMatches(earlyMatches, method, { seasons, yElo: true, levelOf: earlyLevelOf });
  const { nations: cup, unresolved: cupUnresolved } = davisCupNations(earlyMatches, (ioc, season) => (ioc ? codeOfDay(ioc, season, ioc, nationRules) : null));
  for (let season = from; season <= to; season++) {
    const activity = season <= lastAmateur ? E.activity.amateur : E.activity.open;
    const { last, date, players } = run.snapshots[season];
    const rows = computedRows(players, season, activity, cup);
    const head = { season, kind: 'computed', run: 'early', activity, lastEvent: isoDate(last), date: isoDate(date), rated: rows.length, columns: COLUMNS };
    outputs.push([path.join(outDir, `${season}.json`), documentText(head, rows)]);
    seasonLists[season] = { rows, players, run };
  }
  return { run, cupUnresolved, aliases: E.aliases.items, moved, seam };
}
const early = manifest.seasons.early ? await earlyRun() : null;

// ---------- the published seasons ----------

/** Players of the match files' season by name: letters only, lower case → ids. */
const plain = name => name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');
const peopleByName = new Map();
for (const [id, person] of people) {
  const key = plain(person.name);
  if (!peopleByName.has(key)) peopleByName.set(key, []);
  peopleByName.get(key).push(id);
}
const seasonCounts = season => new Map(main.snapshots[season].players.map(player => [player.id, player.season]));
const daysApart = (a, b) => Math.abs(Date.parse(a) - Date.parse(b)) / 864e5;

const publishedChecks = {};
for (const report of manifest.reports) {
  const { season } = report;
  const html = await pinned('wayback', `elo_${report.capture}.html`, captureUrl(report.capture, report.original), report.sha256);
  if (updatedOf(html) !== report.updated) throw new Error(`The Elo capture ${report.capture} is of ${updatedOf(html)}, not ${report.updated}`);
  const { head, body } = reportTable(html);
  const col = name => head.indexOf(name);
  const eloRankAt = col('Rank') >= 0 ? col('Rank') : col('Elo Rank');
  const surfaces = ['hElo', 'cElo', 'gElo'].every(name => col(name) >= 0) ? ['hElo', 'cElo', 'gElo']
    : ['Hard', 'Clay', 'Grass'].every(name => col(name) >= 0) ? ['Hard', 'Clay', 'Grass'] : [];
  if (col('Player') !== 1 || col('Elo') !== 3 || eloRankAt !== 0) throw new Error(`The Elo capture ${report.capture}'s columns changed: ${JSON.stringify(head)}`);
  const counts = seasonCounts(season);
  const byRank = rankings.slice().sort((a, b) => daysApart(a.updated, report.updated) - daysApart(b.updated, report.updated) || (a.updated < b.updated ? -1 : 1));
  const rows = [], left = [], linked = [];
  for (const { key, cells } of body) {
    const name = cells[1], elo = number(cells[3], name), eloRank = number(cells[0], name);
    const tourRank = col(tour.rank) >= 0 && cells[col(tour.rank)] !== '' ? number(cells[col(tour.rank)], name) : null;
    // The player's record in the match files: by the key's letters (Tennis Abstract's keys are names), else by name.
    const candidates = [...new Set([...(peopleByName.get(plain(canonical(key))) || []), ...(peopleByName.get(plain(name)) || [])])];
    const playing = candidates.filter(id => counts.has(id));
    const pool = playing.length ? playing : candidates;
    const id = pool.slice().sort((a, b) => (counts.get(b) || 0) - (counts.get(a) || 0) || (a < b ? -1 : 1))[0] ?? null;
    const matchesPlayed = id ? counts.get(id) || 0 : 0;
    linked.push({ key, name, elo, id });
    if (!id) { left.push([key, name, 'not in the match files']); continue; }
    if (matchesPlayed < manifest.method.activity) { left.push([key, name, `${matchesPlayed} counted matches`]); continue; }
    const listed = byRank.find(capture => capture.byKey.has(canonical(key)));
    const person = people.get(id);
    const code = listed ? listed.byKey.get(canonical(key)).country : person.ioc;
    const how = listed ? `rankings ${listed.updated}` : 'player-file';
    const born = (listed ? listed.byKey.get(canonical(key)).born : null) ?? person.born;
    if (!code) throw new Error(`${season}: no country for ${name}`);
    // A surface he has not played on reads "-".
    const surface = name => (cells[col(name)] === '-' ? null : number(cells[col(name)], `${cells[1]} ${name}`));
    rows.push([key, name, codeOfDay(code, season, person.ioc, nationRules), how, born, elo, surfaces.map(surface),
      eloRank, tourRank, id, matchesPlayed]);
  }
  const headRow = { season, kind: 'published', updated: report.updated, capture: report.capture, listed: body.length, rated: rows.length,
    surfaces, columns: ['key', 'name', 'nation of the day', 'how', 'born', 'elo', 'surface elos', 'elo rank', tour.rank.toLowerCase(), 'match-file id', 'matches'], left };
  outputs.push([path.join(outDir, `${season}.json`), documentText(headRow, rows)]);
  publishedChecks[season] = linked;
}

// ---------- validation ----------

const round = (x, digits = 1) => Math.round(x * 10 ** digits) / 10 ** digits;
const summary = stats => stats && { n: stats.n, meanDiff: round(stats.meanDiff), meanAbsDiff: round(stats.meanAbsDiff), r: round(stats.r, 4), slope: round(stats.slope, 3) };
/** Our list against a published one: the agreement of the published top 100 (matched by match-file id), the top 10's overlap, and who is listed. */
function against(ours, published) {
  const byId = new Map(ours.map((player, i) => [player.id, { ...player, rank: i + 1 }]));
  const top = published.slice(0, 100).filter(player => player.id && byId.has(player.id));
  const all = published.filter(player => player.id && byId.has(player.id));
  const topTen = new Set(published.slice(0, 10).map(player => player.id));
  const listedIds = new Set(published.map(player => player.id).filter(Boolean));
  const ourListed = ours.filter(player => player.season >= manifest.method.activity);
  const ourTen = ourListed.slice(0, 10).map(player => player.id);
  return {
    top100: summary(agreement(top.map(player => player.elo), top.map(player => byId.get(player.id).elo))),
    all: summary(agreement(all.map(player => player.elo), all.map(player => byId.get(player.id).elo))),
    topTenShared: ourTen.filter(id => topTen.has(id)).length,
    listed: { published: published.length, ours: ourListed.length, both: ourListed.filter(player => listedIds.has(player.id)).length },
  };
}
const published = {};
for (const report of manifest.reports) {
  const list = publishedChecks[report.season];
  published[report.season] = {
    updated: report.updated, method: report.method ?? 'current',
    current: against(dated.snapshots[report.season].players, list),
    ...(v1.snapshots[report.season] ? { v1: against(v1.snapshots[report.season].players, list) } : {}),
  };
}
const targets = manifest.method.targets;
const [fitFrom, fitTo] = targets.fitYears;
const mean = xs => round(xs.reduce((s, x) => s + x, 0) / xs.length);
const rms = xs => round(Math.sqrt(xs.reduce((s, x) => s + x * x, 0) / xs.length));
/** A run against Tennis Abstract's targets: each career peak and yElo season, and the fit over `fitYears`. */
function fitOf(run) {
  const peakOf = new Map(run.peaks.map(peak => [peak.id, peak]));
  const peaks = targets.peaks.items.map(([id, name, elo, year]) => {
    const peak = peakOf.get(id);
    return { name, year, published: elo, computed: peak.peak, date: isoDate(peak.date), diff: round(peak.peak - elo) };
  });
  const yElo = (targets.yElo?.items ?? []).map(([season, id, name, record, value]) => {
    const ours = run.yElo[season].find(entry => entry.id === id);
    return { season, name, record, ours: `${ours.won}-${ours.lost}`, published: value, computed: ours.yElo, diff: round(ours.yElo - value) };
  });
  const fitDiffs = [...peaks.filter(t => t.year >= fitFrom && t.year <= fitTo), ...yElo.filter(t => t.season >= fitFrom && t.season <= fitTo)].map(t => t.diff);
  const later = [...peaks.filter(t => t.year > fitTo), ...yElo.filter(t => t.season > fitTo)].map(t => t.diff);
  const byDecade = Object.fromEntries([1970, 1980, 1990].map(decade => [`${decade}s`, mean([...peaks.filter(t => Math.floor(Math.min(t.year, 2000) / 10) * 10 === decade && t.year <= fitTo),
    ...yElo.filter(t => Math.floor(Math.min(t.season, 2000) / 10) * 10 === decade && t.season <= fitTo)].map(t => t.diff))]));
  return { peaks, yElo, fit: { years: targets.fitYears, n: fitDiffs.length, meanDiff: mean(fitDiffs), rms: rms(fitDiffs), byDecade, after: { n: later.length, meanDiff: mean(later) } } };
}
const { peaks, yElo, fit } = fitOf(main);
const validation = {
  generatedBy: `scripts/sync-tennis-seasons.mjs${tourId === 'atp' ? '' : ` --tour=${tourId}`}`,
  matches: main.counts, [tour.unresolved]: unresolved,
  fit, peaks, yElo, published,
};

// The second run against the targets, and its seam with the first: over the first run's top 50 of each season from 1973
// (ten counted matches), the second run's Elo of the same men less the first's.
if (early) {
  const seam = {};
  for (let season = early.seam.from; season <= early.seam.to; season++) {
    const ours = new Map(early.run.snapshots[season].players.map(player => [player.id, player.elo]));
    const top = main.snapshots[season].players.filter(player => player.season >= manifest.method.activity).slice(0, 50).filter(player => ours.has(player.id));
    const diffs = top.map(player => ours.get(player.id) - player.elo);
    seam[season] = { n: diffs.length, meanDiff: mean(diffs), meanAbsDiff: mean(diffs.map(Math.abs)), maxAbsDiff: round(Math.max(...diffs.map(Math.abs))) };
  }
  const kinds = {};
  for (const [, , , rule, kind] of early.aliases) kinds[kind] = (kinds[kind] || 0) + 1;
  validation.early = {
    seasons: manifest.seasons.early, matches: early.run.counts, [tour.unresolved]: early.cupUnresolved,
    aliases: { pairs: early.aliases.length, kinds, matchesMoved: early.moved },
    fit: fitOf(early.run).fit, seam,
  };
}

/** Spearman's rank correlation of two lists of distinct values, each ranked 1..n among themselves; null under three. */
function spearman(xs, ys) {
  const n = xs.length;
  if (n < 3) return null;
  const ranks = values => {
    const r = [];
    values.map((value, i) => [value, i]).sort((a, b) => a[0] - b[0]).forEach(([, i], k) => { r[i] = k + 1; });
    return r;
  };
  const rx = ranks(xs), ry = ranks(ys);
  return 1 - 6 * rx.reduce((s, r, i) => s + (r - ry[i]) ** 2, 0) / (n * (n * n - 1));
}
// The seasons before 1973 against the published top tens (each season's listed players, strongest first: how many of
// the ten are in our ten, how many we list at all, and the rank correlation of the ten we list) and Tennis Abstract's
// statements (where we rank its men at the end of a season; our Elo against its peak).
if (manifest.checks) {
  const { topTens, statements } = manifest.checks;
  const nameOf = id => people.get(id)?.name ?? id;
  const why = (season, id) => {
    const entry = seasonLists[season].players.find(player => player.id === id);
    return `${nameOf(id)}: ${entry ? `${entry.season} counted matches` : 'no counted match'}`;
  };
  const seasonsOfTen = {};
  for (const [season, ten] of Object.entries(topTens.years)) {
    const { rows } = seasonLists[season];
    const rankOf = new Map(rows.map((row, i) => [row[0], i + 1]));
    const ours = new Set(rows.slice(0, 10).map(row => row[0]));
    const found = ten.map(([, id], i) => [i + 1, rankOf.get(id)]).filter(([, rank]) => rank != null);
    const rho = spearman(found.map(([position]) => position), found.map(([, rank]) => rank));
    seasonsOfTen[season] = { shared: ten.filter(([, id]) => ours.has(id)).length, listed: found.length, rho: rho == null ? null : round(rho, 2),
      ranks: ten.map(([, id]) => rankOf.get(id) ?? null), notListed: ten.filter(([, id]) => !rankOf.has(id)).map(([, id]) => why(season, id)) };
  }
  const period = (from, to) => {
    const rows = Object.entries(seasonsOfTen).filter(([season]) => season >= from && season <= to).map(([, row]) => row);
    return rows.length ? { seasons: rows.length, shared: round(rows.reduce((s, row) => s + row.shared, 0) / rows.length), rho: round(rows.reduce((s, row) => s + row.rho, 0) / rows.length, 2) } : null;
  };
  const tenYears = Object.keys(topTens.years).map(Number);
  const periods = manifest.seasons.amateur
    ? { amateur: period(manifest.seasons.amateur[0], manifest.seasons.amateur[1]), open: period(manifest.seasons.amateur[1] + 1, Math.max(...tenYears)) }
    : { all: period(Math.min(...tenYears), Math.max(...tenYears)) };
  validation.checks = {
    topTens: { authority: topTens.authority, periods, seasons: seasonsOfTen },
    statements: {
      yearEnd: statements.yearEnd.map(([season, ids, text]) => ({ season, text,
        ours: ids.map(id => `${nameOf(id)} ${seasonLists[season].rows.findIndex(row => row[0] === id) + 1 || 'unlisted'}`) })),
      peaks: statements.peaks.map(([id, name, elo, year]) => {
        const { run } = seasonLists[year];
        const peak = run.peaks.find(entry => entry.id === id);
        const atEnd = run.snapshots[year].players.find(player => player.id === id);
        return { name, year, published: elo, computed: peak.peak, date: isoDate(peak.date), endOfYear: atEnd?.elo ?? null };
      }),
    },
  };
}
outputs.push([path.join(outDir, 'validation.json'), `${JSON.stringify(validation, null, 1)}\n`]);

// ---------- write or check ----------

if (check) {
  const differs = [];
  for (const [file, content] of outputs) {
    const current = existsSync(file) ? (await readFile(file, 'utf8')).replace(/\r\n/g, '\n') : null;
    if (current !== content) differs.push(path.relative(root, file));
  }
  if (differs.length) {
    console.error(`differs: ${differs.join(', ')}`);
    process.exit(1);
  }
  console.log(`Verified the ${outputs.length - 1} ${tour.noun} season snapshots and their validation byte for byte.`);
} else {
  await mkdir(outDir, { recursive: true });
  for (const [file, content] of outputs) await writeFile(file, content);
  console.log(`Wrote ${outputs.length - 1} season snapshots and validation.json to ${path.relative(root, outDir)}`);
  console.log(`  matches: ${JSON.stringify(main.counts)}; ${tour.cup} rubbers whose sides the names could not place: ${unresolved}`);
  console.log(`  fit ${targets.fitYears.join('-')}: ${fit.n} targets, mean ${fit.meanDiff}, rms ${fit.rms}, by decade ${JSON.stringify(fit.byDecade)}; later targets mean ${fit.after.meanDiff}`);
  for (const [season, check] of Object.entries(published)) {
    console.log(`  ${season} (${check.method}): current method top 100 ${JSON.stringify(check.current.top100)}, top ten shared ${check.current.topTenShared}, listed ${JSON.stringify(check.current.listed)}`
      + (check.v1 ? `; pre-2018 method ${JSON.stringify(check.v1.top100)}, top ten ${check.v1.topTenShared}` : ''));
  }
  if (validation.early) {
    const { early: e } = validation;
    console.log(`  before 1973: ${JSON.stringify(e.matches)}; aliases ${JSON.stringify(e.aliases)}; fit mean ${e.fit.meanDiff}, rms ${e.fit.rms}; seam ${Object.entries(e.seam).map(([season, s]) => `${season} ${s.meanDiff}/${s.meanAbsDiff}`).join(', ')}`);
  }
  if (validation.checks) {
    const { topTens, statements } = validation.checks;
    console.log(`  top tens: ${JSON.stringify(topTens.periods)}; ${Object.entries(topTens.seasons).map(([season, s]) => `${season} ${s.shared}/10 ρ ${s.rho}`).join(', ')}`);
    for (const statement of statements.yearEnd) console.log(`  ${statement.season}: ${statement.text}; ours ${statement.ours.join(', ')}`);
    for (const peak of statements.peaks) console.log(`  ${peak.name}: published peak ${peak.published} (${peak.year}); ours ${peak.computed} on ${peak.date}, ${peak.endOfYear} at the end of ${peak.year}`);
  }
}
