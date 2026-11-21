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
//   --fit-regions                            fits the newcomers' region and nation levels of the seasons before 1973
//                                            (the manifest's method.early.start.regions) on the cached inputs and prints
//                                            them, judged on held-out seasons, with the seam of each base start near the
//                                            manifest's; writes nothing (docs/design/tennis.md, "Regions")
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
// before 1973 with the published top tens and Tennis Abstract's statements (the manifest's `checks`). The women's
// second run (docs/design/womens-tennis.md, "1963-1967") reads the majors' and the Federation Cup's results of
// 1960-1967 from English Wikipedia's pages instead (the manifest's `wikipedia`, scripts/lib/tennis-wikipedia.mjs).
// The second run's newcomers of the amateur sources start at their region's and nation's level (method.early.start
// .regions, scripts/lib/tennis-regions.mjs); validation.json's `regions` and `early.regions` hold each region's offset
// against the others in each era's cross-region matches of the listed players, the second run's with and without
// those levels.
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { agreement, applyAliases, atpLevelOf, davisCupNations, earlyLevelOf, orderMatches, parseMatchFile, rateMatches, ROUND_ORDER, wtaLevelOf } from './lib/tennis-elo.mjs';
import { codeOfDay, nationOfDay } from './lib/tennis-seasons.mjs';
import { fitLevels, regionOfCode, regionOffsets } from './lib/tennis-regions.mjs';
import { articlesQuery, pinnedPages, wikiFile, wikipediaMatches } from './lib/tennis-wikipedia.mjs';
import { politeFetch } from './lib/polite-fetch.mjs';
import { askWikidata } from './lib/wikidata-sparql.mjs';

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
const unknown = args.filter(arg => !['--check', '--refresh', '--fit-regions'].includes(arg) && !/^--tour=/.test(arg));
if (unknown.length) throw new Error(`Unknown option ${unknown[0]}`);
const check = args.includes('--check'), refresh = args.includes('--refresh'), fitRegions = args.includes('--fit-regions');
if (fitRegions && refresh) throw new Error('--fit-regions reads the cached inputs only');
const tourId = args.find(arg => arg.startsWith('--tour='))?.slice('--tour='.length) ?? 'atp';
const tour = TOURS[tourId];
if (!tour) throw new Error(`Unknown tour ${tourId}: atp or wta`);
const cacheDir = path.join(root, tour.cache);
const outDir = path.join(root, tour.out);
const manifest = JSON.parse(await readFile(path.join(root, tour.manifest), 'utf8'));
const PAUSE_MS = 1500;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const sha256 = data => createHash('sha256').update(data).digest('hex');
const sha1 = data => createHash('sha1').update(data).digest('hex');

/** A pinned input's text: from the cache unless `refresh`, else downloaded; either way it must match its SHA-256. */
async function pinned(folder, file, url, expected) {
  const at = path.join(cacheDir, folder, file);
  if (!refresh && existsSync(at)) {
    const data = await readFile(at);
    if (sha256(data) !== expected) throw new Error(`${path.relative(root, at)} does not match its pin; delete it to download it again`);
    return data.toString('utf8');
  }
  if (fitRegions) throw new Error(`${path.relative(root, at)} is not cached: run the sync without --fit-regions first`);
  for (let attempt = 0; ; attempt++) {
    try {
      // fetch decodes a capture stored gzipped, so the pin is the page's own bytes.
      const response = await politeFetch(url, { signal: AbortSignal.timeout(60000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = Buffer.from(await response.arrayBuffer());
      if (sha256(data) !== expected) throw new Error(`does not match its pin (${sha256(data)})`);
      await mkdir(path.dirname(at), { recursive: true });
      await writeFile(at, data);
      await sleep(PAUSE_MS);
      return data.toString('utf8');
    } catch (error) {
      if (attempt === 2 || error.fatal) throw new Error(`${url}: ${error.message}`);
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
      born: /^\d{8}$/.test(dob) ? `${dob.slice(0, 4)}-${dob.slice(4, 6)}-${dob.slice(6)}` : null,
      wikidata: /^Q\d+$/.test(c[at('wikidata_id')] ?? '') ? c[at('wikidata_id')] : null });
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

// ---------- regions (scripts/lib/tennis-regions.mjs) ----------

/**
 * A run's matches for the measure of its regions: each counted match of seasons `from`-`to` between two regions, or
 * at a home for one side (a major's host, a cup tie's first side), with both players' Elo before it and their nations of
 * the day (`codeOf(id, season)`). `before` is the run's hook.
 */
function regionRecorder(codeOf, [from, to]) {
  const rows = [], codes = new Map();
  const code = (id, season) => {
    const key = `${id} ${season}`;
    if (!codes.has(key)) codes.set(key, codeOf(id, season));
    return codes.get(key);
  };
  const before = (m, w, l) => {
    if (m.season < from || m.season > to) return;
    const wc = code(m.winner, m.season), lc = code(m.loser, m.season);
    const wr = regionOfCode(wc), lr = regionOfCode(lc);
    if (!wr || !lr || (wr === lr && !(m.level === 'G' || m.level === 'D'))) return;
    rows.push({ season: m.season, level: m.level, eventName: m.eventName, winner: m.winner, loser: m.loser, we: w.elo, le: l.elo, wc, lc });
  };
  return { rows, before };
}
/**
 * Each era's offsets of the regions (regionOffsets) in the matches between two listed players (`listed(id, season)`: the
 * season's rule, its counted matches or its cup's singles), keyed "1973-1979".
 */
const eraOffsets = (rows, eras, listed) => Object.fromEntries(eras.map(([from, to]) => [`${from}-${to}`,
  regionOffsets(rows.filter(r => r.season >= from && r.season <= to && listed(r.winner, r.season) && listed(r.loser, r.season)))]));
/** The eras of seasons `from`-`to`: the 1970s, the 1980s… cut at each decade. */
function decades(from, to) {
  const eras = [];
  for (let start = from; start <= to; start = Math.floor(start / 10) * 10 + 10) eras.push([start, Math.min(to, Math.floor(start / 10) * 10 + 9)]);
  return eras;
}
/**
 * Whether a player is listed in a season of `run` (snapshotted): `activity(season)` counted matches in it, or one of
 * `extra(season)` (a set of ids: the cup's singles players of the women's amateur seasons).
 */
function listedIn(run, activity, extra = () => null) {
  const counts = new Map();
  return (id, season) => {
    if (!counts.has(season)) counts.set(season, new Map((run.snapshots[season]?.players ?? []).map(player => [player.id, player.season])));
    return (counts.get(season).get(id) ?? 0) >= activity(season) || !!extra(season)?.has(id);
  };
}

/**
 * The second run with its newcomers' levels (method.early.start.regions), each newcomer's origin his region and nation
 * of the day (`codeOf(id, season)`), and the measure of its regions in each of `eras` with the levels and without them
 * (the same run without them). → { run, offsets, originOf }
 */
function earlyRegions({ earlyMatches, method, levelOf: early, codeOf, seasons, listedOf, eras }) {
  const originOf = (id, m) => {
    const code = codeOf(id, m.season);
    return { region: regionOfCode(code), nation: code };
  };
  const recorder = regionRecorder(codeOf, [eras[0][0], eras.at(-1)[1]]);
  const run = rateMatches(earlyMatches, method, { seasons, yElo: true, levelOf: early, originOf, before: recorder.before });
  const listed = listedOf(run);
  if (!method.start.regions) return { run, offsets: eraOffsets(recorder.rows, eras, listed), originOf };
  const { regions, ...base } = method.start;
  const without = regionRecorder(codeOf, [eras[0][0], eras.at(-1)[1]]);
  rateMatches(earlyMatches, { ...method, start: base }, { levelOf: early, before: without.before });
  const offsets = Object.fromEntries(eras.map(([from, to]) => {
    const key = `${from}-${to}`;
    return [key, { without: eraOffsets(without.rows, [[from, to]], listed)[key], with: eraOffsets(recorder.rows, [[from, to]], listed)[key] }];
  }));
  return { run, offsets, originOf };
}

const mainCode = (id, season) => nationOfDay({ id, ioc: people.get(id)?.ioc ?? null, davisCup: davisCup.get(id) }, season, nationRules).code;
const mainRecorder = regionRecorder(mainCode, [firstComputed, lastComputed]);
const main = rateMatches(matches, manifest.method, { seasons: allSeasons, yElo: true, levelOf, before: mainRecorder.before });
// The same method dated as Tennis Abstract's reports, for the check against them.
const dated = rateMatches(matches, manifest.method, { seasons: manifest.reports.map(report => report.season), asOf, levelOf });
const v1 = rateMatches(matches, manifest.method.v1, { seasons: manifest.reports.filter(report => report.method === 'pre-2018').map(report => report.season), asOf, levelOf });

const isoDate = yyyymmdd => `${String(yyyymmdd).slice(0, 4)}-${String(yyyymmdd).slice(4, 6)}-${String(yyyymmdd).slice(6)}`;
const row = cells => JSON.stringify(cells);
const documentText = (head, rows) => `{\n${Object.entries(head).map(([key, value]) => `${JSON.stringify(key)}: ${JSON.stringify(value)}`).join(',\n')},\n"players": [\n${rows.map(row).join(',\n')}\n]\n}\n`;

/**
 * A computed season's rows, strongest first: every player of `players` with `activity` counted matches in it (or whom
 * `listed` lists), each with the nation of the day (`nation`, by default nationOfDay's rule) and the record `personOf`
 * finds for her or his id (by default the player file's).
 */
function computedRows(players, season, activity, cup, { personOf = id => people.get(id), listed = player => player.season >= activity, nation = null } = {}) {
  return players.filter(listed).map(player => {
    const person = personOf(player.id);
    if (!person) throw new Error(`${season}: ${player.name} (${player.id}) is not in the player file`);
    const { code, how } = nation ? nation(player.id, person, season) : nationOfDay({ id: player.id, ioc: person.ioc, davisCup: cup.get(player.id) }, season, nationRules);
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
  const method = { ...manifest.method, start: { ...manifest.method.start, amateur: E.start.amateur, ...(E.start.regions ? { regions: E.start.regions } : {}) },
    layoff: { ...manifest.method.layoff, from: E.layoff.from, amateurWeeks: E.layoff.amateurWeeks } };
  const [from, to] = manifest.seasons.early;
  const [, lastAmateur] = manifest.seasons.amateur;
  const seam = { from: firstComputed, to: 1980 };
  const seasons = [];
  for (let season = from; season <= seam.to; season++) seasons.push(season);
  const { nations: cup, unresolved: cupUnresolved } = davisCupNations(earlyMatches, (ioc, season) => (ioc ? codeOfDay(ioc, season, ioc, nationRules) : null));
  // A man's nation of the day, by the second run's own Davis Cup rows (as his season's row has it): his newcomer's level.
  const codeOf = (id, season) => nationOfDay({ id, ioc: people.get(id)?.ioc ?? null, davisCup: cup.get(id) }, season, nationRules).code;
  const activityOf = season => (season <= lastAmateur ? E.activity.amateur : E.activity.open);
  const eras = [[from, lastAmateur], [lastAmateur + 1, to]];
  const listedOf = run => listedIn(run, activityOf);
  const { run, offsets, originOf } = earlyRegions({ earlyMatches, method, levelOf: earlyLevelOf, codeOf, seasons, listedOf, eras });
  for (let season = from; season <= to; season++) {
    const activity = activityOf(season);
    const { last, date, players } = run.snapshots[season];
    const rows = computedRows(players, season, activity, cup);
    const head = { season, kind: 'computed', run: 'early', activity, lastEvent: isoDate(last), date: isoDate(date), rated: rows.length, columns: COLUMNS };
    outputs.push([path.join(outDir, `${season}.json`), documentText(head, rows)]);
    seasonLists[season] = { rows, players, run };
  }
  return { run, cupUnresolved, aliases: E.aliases.items, moved, seam, offsets,
    fitting: { earlyMatches, method, levelOf: earlyLevelOf, codeOf, originOf, listedOf, eras } };
}

// ---------- the women's seasons before 1973 ----------

/**
 * The women's second run (`method.early`): the majors' and the Federation Cup's results of 1960-1967 on English
 * Wikipedia's pinned pages (the manifest's `wikipedia`) before the open era's files, every woman of the pages under the
 * player file's id where she is its player (by her article's Wikidata item or a reviewed join), its newcomers at
 * `start.amateur`, its layoffs before 1968 charged only from `layoff.amateurWeeks`. Its seasons list `activity.amateur`
 * counted matches before 1968, or a singles rubber of that year's cup (`activity.cup`), and `activity.open` after; a
 * woman of 1963-1967 with no cup row near takes the flag her draws give her (`how` 'flag') before the player file's.
 */
async function wikipediaEarlyRun() {
  const E = manifest.method.early, W = manifest.wikipedia;
  // Each page from the cache, or fetched under /wiki/ when missing (then the current revision: it must match its pin).
  const { draws, cups, redirects } = await pinnedPages(W, (title, sha) => pinned('wikipedia', wikiFile(title, sha1),
    W.page.replace('{title}', encodeURIComponent(title.replace(/ /g, '_')).replace(/%2F/g, '/')), sha));
  // The articles' Wikidata items: QLever's pinned answer, asked again only when the cache lacks it.
  const at = path.join(cacheDir, 'wikidata', W.wikidata.file);
  let answer;
  if (!refresh && existsSync(at)) answer = await readFile(at);
  else {
    answer = Buffer.from(JSON.stringify(await askWikidata(articlesQuery(W.wikidata.articles))));
    await mkdir(path.dirname(at), { recursive: true });
    await writeFile(at, answer);
  }
  if (sha256(answer) !== W.wikidata.sha256 || answer.length !== W.wikidata.bytes) throw new Error(`${path.relative(root, at)} does not match its pin; delete it to ask again`);
  const qids = new Map(JSON.parse(answer.toString('utf8')).results.bindings.map(row => [row.title.value, row.item.value.replace(/^.*\//, '')]));
  const wiki = wikipediaMatches({ draws, cups, redirects, qids, people, roundOrder: ROUND_ORDER,
    rules: { flags: W.flags, teams: W.teams, sameCodes: W.sameCodes, aliases: E.aliases.items, joins: E.joins.items } });
  // The answer covers exactly the pages' articles.
  if (JSON.stringify([...wiki.articles].sort()) !== JSON.stringify(W.wikidata.articles)) throw new Error('The pages\' articles are not wikipedia.wikidata.articles: ask Wikidata again');
  const personOf = id => people.get(id) ?? wiki.women.get(id);
  const earlyMatches = orderMatches([...wiki.matches, ...matches]);
  const method = { ...manifest.method, start: { ...manifest.method.start, amateur: E.start.amateur, ...(E.start.regions ? { regions: E.start.regions } : {}) },
    layoff: { ...manifest.method.layoff, from: E.layoff.from, amateurWeeks: E.layoff.amateurWeeks } };
  const levelOf = (m, how) => (m.file === 2 ? 'amateur' : wtaLevelOf(m, how));
  const [from, to] = manifest.seasons.early;
  const [, lastAmateur] = manifest.seasons.amateur;
  const seam = { from: firstComputed, to: 1980 };
  const seasons = [];
  for (let season = from; season <= seam.to; season++) seasons.push(season);
  const { nations: cup, unresolved: cupUnresolved } = davisCupNations(earlyMatches, (ioc, season) => (ioc ? codeOfDay(ioc, season, ioc, nationRules) : null));
  const flagRules = { ...nationRules, fixes: [], cupHow: 'flag' };
  // A woman's nation of the day: before 1968 her draws' flag stands before the player file's.
  const nation = (id, person, year) => {
    const day = nationOfDay({ id, ioc: person?.ioc ?? null, davisCup: cup.get(id) }, year, nationRules);
    if (year > lastAmateur || day.how !== 'player-file') return day;
    const flagged = nationOfDay({ id, ioc: person?.ioc ?? null, davisCup: wiki.flags.get(id) }, year, flagRules);
    return flagged.how === 'flag' ? flagged : day;
  };
  const codeOf = (id, season) => nation(id, personOf(id), season).code;
  const amateurOf = season => season <= lastAmateur;
  const activityOf = season => (amateurOf(season) ? E.activity.amateur : E.activity.open);
  const cupSinglesOf = season => (amateurOf(season) && E.activity.cup ? wiki.cupSingles.get(season) ?? new Set() : new Set());
  const eras = [[from, lastAmateur], [lastAmateur + 1, to]];
  const listedOf = run => listedIn(run, activityOf, cupSinglesOf);
  const { run, offsets, originOf } = earlyRegions({ earlyMatches, method, levelOf, codeOf, seasons, listedOf, eras });
  for (let season = from; season <= to; season++) {
    const activity = activityOf(season);
    const cupSingles = cupSinglesOf(season);
    const { last, date, players } = run.snapshots[season];
    const rows = computedRows(players, season, activity, cup, { personOf, nation, listed: player => player.season >= activity || cupSingles.has(player.id) });
    const head = { season, kind: 'computed', run: 'early', activity, ...(cupSingles.size ? { cup: true } : {}), lastEvent: isoDate(last), date: isoDate(date),
      rated: rows.length, columns: COLUMNS };
    outputs.push([path.join(outDir, `${season}.json`), documentText(head, rows)]);
    seasonLists[season] = { rows, players, run };
  }
  const women = [...wiki.women.keys()];
  const counted = wiki.matches.filter(m => !m.why);
  return { run, cupUnresolved, seam, personOf, offsets, fitting: { earlyMatches, method, levelOf, codeOf, originOf, listedOf, eras },
    wikipedia: { pages: W.draws.length + W.cups.length, matches: wiki.matches.length, counted: counted.length, unplayed: wiki.unplayed,
      women: women.length, playerFile: women.filter(id => !id.startsWith('wp:')).length, byWikidata: women.filter(id => !id.startsWith('wp:')).length - E.joins.items.length,
      byReview: E.joins.items.length, aliases: E.aliases.items.length } };
}
const early = !manifest.seasons.early ? null : manifest.wikipedia ? await wikipediaEarlyRun() : await earlyRun();

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
// Each published season's rated players, their nation of the day and Tennis Abstract's Elo, for the regions' check.
const publishedRegions = [];
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
  publishedRegions.push(...rows.map(([, , code, , , elo, , , , id]) => ({ season, code, elo, id })));
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
/**
 * The computed Elo against Tennis Abstract's own of the same players in its year-end lists (the run dated as its
 * reports), by region: each region's mean difference less every player's, with its standard error.
 */
function publishedByRegion() {
  const diffs = publishedRegions.map(({ season, code, elo, id }) => {
    const ours = dated.snapshots[season].players.find(player => player.id === id);
    return ours ? { region: regionOfCode(code), diff: ours.elo - elo } : null;
  }).filter(Boolean);
  const overall = diffs.reduce((s, d) => s + d.diff, 0) / diffs.length;
  const regions = {};
  for (const region of [...new Set(diffs.map(d => d.region).filter(Boolean))].sort()) {
    const xs = diffs.filter(d => d.region === region).map(d => d.diff - overall);
    const m = xs.reduce((s, x) => s + x, 0) / xs.length;
    const sd = Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, xs.length - 1));
    regions[region] = { n: xs.length, diff: round(m), se: round(sd / Math.sqrt(xs.length)) };
  }
  return { seasons: [firstPublished, lastPublished], n: diffs.length, meanDiff: round(overall), regions };
}
const validation = {
  generatedBy: `scripts/sync-tennis-seasons.mjs${tourId === 'atp' ? '' : ` --tour=${tourId}`}`,
  matches: main.counts, [tour.unresolved]: unresolved,
  fit, peaks, yElo, published,
  // Each region's players against the others' (scripts/lib/tennis-regions.mjs): in each era of the computed seasons, the
  // offsets that fit the listed players' matches between regions, each by the two players' Elo before it; and the
  // computed Elo against Tennis Abstract's lists by region.
  regions: { eras: eraOffsets(mainRecorder.rows, decades(firstComputed, lastComputed), listedIn(main, () => manifest.method.activity)),
    published: publishedByRegion() },
};

// The second run against the targets, and its seam with the first: over the first run's top 50 of each season from 1973
// (ten counted matches), the second run's Elo of the same men less the first's.
function seamOf(run) {
  const seam = {};
  for (let season = early.seam.from; season <= early.seam.to; season++) {
    const ours = new Map(run.snapshots[season].players.map(player => [player.id, player.elo]));
    const top = main.snapshots[season].players.filter(player => player.season >= manifest.method.activity).slice(0, 50).filter(player => ours.has(player.id));
    const diffs = top.map(player => ours.get(player.id) - player.elo);
    seam[season] = { n: diffs.length, meanDiff: mean(diffs), meanAbsDiff: mean(diffs.map(Math.abs)), maxAbsDiff: round(Math.max(...diffs.map(Math.abs))) };
  }
  return seam;
}

/**
 * --fit-regions: the newcomers' levels of the second run (method.early.start.regions: its `fit` says which seasons'
 * matches, from which season's newcomers, under which priors), fitted on every counted match of those seasons, each by
 * the ratings before it (fitLevels); then the same fit on the even seasons judged on the odd ones and the other way
 * round, over the amateur seasons the game lists (log loss of every match, of those between regions and within one, and
 * the regions' offsets among the listed players, without and with the levels); then the seam and the fit to Tennis
 * Abstract's targets of the base start and its neighbours, with the fitted levels rounded to five points. Prints only.
 */
function fitRegionsReport() {
  const R = manifest.method.early.start.regions;
  if (!R) throw new Error('--fit-regions: the manifest has no method.early.start.regions');
  const { earlyMatches, method, levelOf: earlyLevel, originOf, listedOf, eras, codeOf } = early.fitting;
  const [fitFrom, fitTo] = R.fit.seasons, [evalFrom, evalTo] = eras[0];
  const upTo = earlyMatches.filter(m => m.season <= Math.max(fitTo, evalTo));
  const atLevels = (region, nation, amateur = method.start.amateur) => ({ ...method, start: { ...method.start, amateur, regions: { ...R, region, nation } } });
  const nations = new Set();
  rateMatches(upTo, atLevels({}, {}), { levelOf: earlyLevel, originOf: (id, m) => {
    const origin = originOf(id, m);
    if (origin.region) nations.add(origin.nation);
    return origin;
  } });
  const options = { levelOf: earlyLevel, originOf, nations: [...nations].sort(), sigma: R.fit.sigma, tau: R.fit.tau };
  const inFit = m => m.season >= fitFrom && m.season <= fitTo;
  const five = x => Math.round(x / 5) * 5;
  const levels = fitted => ({ region: Object.fromEntries(Object.entries(fitted.region).map(([k, v]) => [k, five(v)])),
    nation: Object.fromEntries(Object.entries(fitted.nation).map(([k, v]) => [k, five(v)]).filter(([, v]) => v)) });
  const all = fitLevels(upTo, atLevels({}, {}), { ...options, score: inFit });
  console.log(`${tour.noun}: newcomers' levels fitted on the ${all.n} counted matches of ${fitFrom}-${fitTo} (prior spreads: region ${R.fit.sigma}, nation ${R.fit.tau}), rounded to five points:`);
  console.log(`  regions: ${Object.entries(all.region).map(([k, v]) => `${k} ${five(v)} ±${Math.round(all.se[k])} (${all.newcomers[k]} newcomers)`).join(', ')}`);
  console.log(`  nations: ${JSON.stringify(levels(all).nation)}`);
  // Held out: one fold's seasons fit, the other's judge, over the amateur seasons the game lists.
  const judged = (theta, judge) => {
    const loss = { all: [0, 0], between: [0, 0], within: [0, 0] };
    const recorder = regionRecorder(codeOf, [evalFrom, evalTo]);
    rateMatches(upTo, theta ? atLevels(theta.region, theta.nation) : atLevels({}, {}), { levelOf: earlyLevel, originOf,
      before: (m, w, l) => {
        if (m.season < evalFrom || m.season > evalTo || !judge(m)) return;
        recorder.before(m, w, l);
        const e = 1 / (1 + Math.pow(10, (l.elo - w.elo) / 400));
        const [a, b] = [m.winner, m.loser].map(id => regionOfCode(codeOf(id, m.season)));
        for (const key of ['all', a && b ? (a === b ? 'within' : 'between') : null]) if (key) { loss[key][0] -= Math.log(e); loss[key][1]++; }
      } });
    return { loss: Object.fromEntries(Object.entries(loss).map(([k, [sum, n]]) => [k, `${(sum / n).toFixed(4)} (${n})`])), rows: recorder.rows };
  };
  const withSeasons = rateMatches(upTo, atLevels({}, {}), { seasons: Array.from({ length: evalTo - evalFrom + 1 }, (_, i) => evalFrom + i), levelOf: earlyLevel, originOf });
  const listed = listedOf(withSeasons);
  const offsets = rows => Object.entries(eraOffsets(rows, [[evalFrom, evalTo]], listed)[`${evalFrom}-${evalTo}`].regions)
    .map(([k, o]) => `${k} ${Math.round(o.elo)}±${Math.round(o.se)}`).join(', ');
  for (const [name, fold] of [['even', m => m.season % 2 === 0], ['odd', m => m.season % 2 === 1]]) {
    const theta = fitLevels(upTo, atLevels({}, {}), { ...options, score: m => inFit(m) && fold(m) });
    const judge = m => !fold(m);
    const before = judged(null, judge), after = judged(theta, judge);
    console.log(`  fitted on the ${name} seasons, judged on the others of ${evalFrom}-${evalTo}: regions ${Object.entries(theta.region).map(([k, v]) => `${k} ${Math.round(v)}`).join(', ')}`);
    console.log(`    log loss without → with: ${Object.keys(before.loss).map(k => `${k} ${before.loss[k]} → ${after.loss[k]}`).join('; ')}`);
    console.log(`    listed offsets without: ${offsets(before.rows)}`);
    console.log(`    listed offsets with:    ${offsets(after.rows)}`);
  }
  // The base start that keeps the run carrying on as the first: the seam and the targets of the base and its neighbours.
  const theta = levels(all);
  for (const amateur of [-15, -10, -5, 0, 5].map(d => method.start.amateur + d)) {
    const run = rateMatches(earlyMatches, atLevels(theta.region, theta.nation, amateur), { seasons: Array.from({ length: early.seam.to - early.seam.from + 1 }, (_, i) => early.seam.from + i), yElo: true, levelOf: earlyLevel, originOf });
    const seam = seamOf(run);
    const target = fitOf(run).fit;
    console.log(`  base ${amateur}: seam ${Object.entries(seam).map(([season, s]) => `${season} ${s.meanDiff}/${s.meanAbsDiff}`).join(', ')}; targets ${target.meanDiff}, rms ${target.rms}`);
  }
}

if (early) {
  const seam = seamOf(early.run);
  const kinds = {};
  for (const [, , , rule, kind] of early.aliases ?? []) kinds[kind] = (kinds[kind] || 0) + 1;
  validation.early = {
    seasons: manifest.seasons.early, matches: early.run.counts, [tour.unresolved]: early.cupUnresolved,
    ...(early.wikipedia ? { wikipedia: early.wikipedia } : { aliases: { pairs: early.aliases.length, kinds, matchesMoved: early.moved } }),
    fit: fitOf(early.run).fit, seam,
    // Each era's offsets of the regions, with the newcomers' levels (method.early.start.regions) and without them.
    regions: early.offsets,
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
  const nameOf = id => (early?.personOf ?? (key => people.get(key)))(id)?.name ?? id;
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

if (fitRegions) {
  fitRegionsReport();
  process.exit(0);
}

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
    console.log(`  before 1973: ${JSON.stringify(e.matches)}; ${e.wikipedia ? `Wikipedia ${JSON.stringify(e.wikipedia)}` : `aliases ${JSON.stringify(e.aliases)}`}; fit mean ${e.fit.meanDiff}, rms ${e.fit.rms}; seam ${Object.entries(e.seam).map(([season, s]) => `${season} ${s.meanDiff}/${s.meanAbsDiff}`).join(', ')}`);
  }
  if (validation.checks) {
    const { topTens, statements } = validation.checks;
    console.log(`  top tens: ${JSON.stringify(topTens.periods)}; ${Object.entries(topTens.seasons).map(([season, s]) => `${season} ${s.shared}/10 ρ ${s.rho}`).join(', ')}`);
    for (const statement of statements.yearEnd) console.log(`  ${statement.season}: ${statement.text}; ours ${statement.ours.join(', ')}`);
    for (const peak of statements.peaks) console.log(`  ${peak.name}: published peak ${peak.published} (${peak.year}); ours ${peak.computed} on ${peak.date}, ${peak.endOfYear} at the end of ${peak.year}`);
  }
}
