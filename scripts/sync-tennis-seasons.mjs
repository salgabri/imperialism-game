// Snapshot tennis's earlier seasons (docs/design/tennis.md, "Earlier seasons") from the inputs scripts/data/tennis-seasons.json
// pins: Jeff Sackmann's ATP match results (1968-2025) and the Wayback Machine's captures of Tennis Abstract's Elo and
// rankings reports. Each input is read from the ignored data-src/tennis-seasons/ cache, or downloaded from its pinned
// address when missing, and must match its SHA-256.
//
//   npm run sync:tennis-seasons              writes scripts/data/tennis-seasons/<year>.json and validation.json
//   npm run sync:tennis-seasons -- --check   rebuilds them and compares byte for byte, writes nothing
//   --refresh                                downloads every input again (still checked against its pin)
//
// A computed season (1973-2015) is the year-end Elo of every man with ten counted matches in it, by Tennis Abstract's
// published method (scripts/lib/tennis-elo.mjs, the manifest's `method`), each with the nation he played for that
// season (scripts/lib/tennis-seasons.mjs). A published season (2016-2025) is Tennis Abstract's own year-end report,
// with each man's country from its rankings report of the nearest date. validation.json holds the checks of the method
// against every number Tennis Abstract has published by it.
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { agreement, davisCupNations, orderMatches, parseMatchFile, rateMatches } from './lib/tennis-elo.mjs';
import { codeOfDay, nationOfDay } from './lib/tennis-seasons.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cacheDir = path.join(root, 'data-src/tennis-seasons');
const outDir = path.join(root, 'scripts/data/tennis-seasons');
const manifest = JSON.parse(await readFile(path.join(root, 'scripts/data/tennis-seasons.json'), 'utf8'));
const args = process.argv.slice(2);
const unknown = args.filter(arg => !['--check', '--refresh'].includes(arg));
if (unknown.length) throw new Error(`Unknown option ${unknown[0]}`);
const check = args.includes('--check'), refresh = args.includes('--refresh');
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
  matches.push(...parseMatchFile(await archiveFile(`atp_matches_${season}.csv`), { season, file: 0 }));
  const qc = `atp_matches_qual_chall_${season}.csv`;
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
const people = playerFile(await archiveFile('atp_players.csv'));

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
    // A few men stand under no flag (2024's list has four): the next capture, or the player file, says where they are from.
    if (country === '') continue;
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
const main = rateMatches(matches, manifest.method, { seasons: allSeasons, yElo: true });
// The same method dated as Tennis Abstract's reports, for the check against them.
const dated = rateMatches(matches, manifest.method, { seasons: manifest.reports.map(report => report.season), asOf });
const v1 = rateMatches(matches, manifest.method.v1, { seasons: manifest.reports.filter(report => report.method === 'pre-2018').map(report => report.season), asOf });

const isoDate = yyyymmdd => `${String(yyyymmdd).slice(0, 4)}-${String(yyyymmdd).slice(4, 6)}-${String(yyyymmdd).slice(6)}`;
const row = cells => JSON.stringify(cells);
const documentText = (head, rows) => `{\n${Object.entries(head).map(([key, value]) => `${JSON.stringify(key)}: ${JSON.stringify(value)}`).join(',\n')},\n"players": [\n${rows.map(row).join(',\n')}\n]\n}\n`;

const outputs = [];
for (let season = firstComputed; season <= lastComputed; season++) {
  const { last, date, players } = main.snapshots[season];
  const rated = players.filter(player => player.season >= manifest.method.activity);
  const rows = rated.map(player => {
    const person = people.get(player.id);
    if (!person) throw new Error(`${season}: ${player.name} (${player.id}) is not in the player file`);
    const { code, how } = nationOfDay({ id: player.id, ioc: person.ioc, davisCup: davisCup.get(player.id) }, season, nationRules);
    return [player.id, person.name, code, how, person.born, player.elo, player.season];
  });
  const head = { season, kind: 'computed', lastEvent: isoDate(last), date: isoDate(date), rated: rows.length,
    columns: ['id', 'name', 'nation of the day', 'how', 'born', 'elo', 'matches'] };
  outputs.push([path.join(outDir, `${season}.json`), documentText(head, rows)]);
}

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
    const atpRank = col('ATP Rank') >= 0 && cells[col('ATP Rank')] !== '' ? number(cells[col('ATP Rank')], name) : null;
    // His record in the match files: by his key's letters (Tennis Abstract's keys are names), else by his name.
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
      eloRank, atpRank, id, matchesPlayed]);
  }
  const headRow = { season, kind: 'published', updated: report.updated, capture: report.capture, listed: body.length, rated: rows.length,
    surfaces, columns: ['key', 'name', 'nation of the day', 'how', 'born', 'elo', 'surface elos', 'elo rank', 'atp rank', 'match-file id', 'matches'], left };
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
const peakOf = new Map(main.peaks.map(peak => [peak.id, peak]));
const targets = manifest.method.targets;
const peaks = targets.peaks.items.map(([id, name, elo, year]) => {
  const peak = peakOf.get(id);
  return { name, year, published: elo, computed: peak.peak, date: isoDate(peak.date), diff: round(peak.peak - elo) };
});
const yElo = targets.yElo.items.map(([season, id, name, record, value]) => {
  const ours = main.yElo[season].find(entry => entry.id === id);
  return { season, name, record, ours: `${ours.won}-${ours.lost}`, published: value, computed: ours.yElo, diff: round(ours.yElo - value) };
});
const [fitFrom, fitTo] = targets.fitYears;
const fitDiffs = [...peaks.filter(t => t.year >= fitFrom && t.year <= fitTo), ...yElo.filter(t => t.season >= fitFrom && t.season <= fitTo)].map(t => t.diff);
const later = [...peaks.filter(t => t.year > fitTo), ...yElo.filter(t => t.season > fitTo)].map(t => t.diff);
const mean = xs => round(xs.reduce((s, x) => s + x, 0) / xs.length);
const rms = xs => round(Math.sqrt(xs.reduce((s, x) => s + x * x, 0) / xs.length));
const byDecade = Object.fromEntries([1970, 1980, 1990].map(decade => [`${decade}s`, mean([...peaks.filter(t => Math.floor(Math.min(t.year, 2000) / 10) * 10 === decade && t.year <= fitTo),
  ...yElo.filter(t => Math.floor(Math.min(t.season, 2000) / 10) * 10 === decade && t.season <= fitTo)].map(t => t.diff))]));
const validation = {
  generatedBy: 'scripts/sync-tennis-seasons.mjs',
  matches: main.counts, davisCupRubbersUnresolved: unresolved,
  fit: { years: targets.fitYears, n: fitDiffs.length, meanDiff: mean(fitDiffs), rms: rms(fitDiffs), byDecade, after: { n: later.length, meanDiff: mean(later) } },
  peaks, yElo, published,
};
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
  console.log(`Verified the ${outputs.length - 1} tennis season snapshots and their validation byte for byte.`);
} else {
  await mkdir(outDir, { recursive: true });
  for (const [file, content] of outputs) await writeFile(file, content);
  console.log(`Wrote ${outputs.length - 1} season snapshots and validation.json to ${path.relative(root, outDir)}`);
  console.log(`  matches: ${JSON.stringify(main.counts)}; Davis Cup rubbers whose sides the names could not place: ${unresolved}`);
  console.log(`  fit ${targets.fitYears.join('-')}: ${fitDiffs.length} targets, mean ${validation.fit.meanDiff}, rms ${validation.fit.rms}, by decade ${JSON.stringify(byDecade)}; later targets mean ${validation.fit.after.meanDiff}`);
  for (const [season, check] of Object.entries(published)) {
    console.log(`  ${season} (${check.method}): current method top 100 ${JSON.stringify(check.current.top100)}, top ten shared ${check.current.topTenShared}, listed ${JSON.stringify(check.current.listed)}`
      + (check.v1 ? `; pre-2018 method ${JSON.stringify(check.v1.top100)}, top ten ${check.v1.topTenShared}` : ''));
  }
}
