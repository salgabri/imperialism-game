// Snapshot ice hockey's earlier seasons (docs/design/hockey.md, "Earlier seasons") from their pinned sources: each
// edition's ratings joined to the NHL's own rosters of that season (api-web.nhle.com/v1/roster/{team}/{season}), which
// give every player his position and his birth country. The downloads stay in the ignored data-src/nhl-seasons/, each
// pinned by SHA-256 in scripts/data/nhl-seasons-sources.json; only the snapshots are committed.
//
// Usage: node scripts/sync-nhl-seasons.mjs [--season=nhl-1994] [--fetch] [--pin] [--check]
//   --fetch   download the sources missing from data-src/nhl-seasons/ (about one request a second)
//   --pin     record the SHA-256 of every source read (after a deliberate new download)
//   --check   rebuild the snapshots and compare them byte for byte; writes nothing
// Output: scripts/data/nhl-seasons/nhl-<season end year>.json, read by scripts/build-nhl-seasons.mjs.
//
// A snapshot row is [name, NHL club code, position (C/LW/RW/D/G), overall, birth country (ISO 3166 alpha-3) or null,
// NHL id or null]; `left` lists the source's players the season leaves out, and why.
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  COUNTRY_CODE, findPlayer, nhl94Overall, nhlpa93Overall, nhlRosterPlayers, norm, parseIgnCountries, parseIgnPage, parseKinGraph,
  parseNhl95Sheet, parseNhlpa93, parseSegathon, segathonTable, teamsOf,
} from './lib/nhl-seasons.mjs';
import { assembleNhlRatings } from './lib/nhlratings-net.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cacheDir = path.join(root, 'data-src/nhl-seasons');
const manifestFile = path.join(root, 'scripts/data/nhl-seasons.json');
const sourcesFile = path.join(root, 'scripts/data/nhl-seasons-sources.json');
const snapshotDir = path.join(root, 'scripts/data/nhl-seasons');
const PAUSE_MS = 1100;

const args = process.argv.slice(2);
const unknown = args.filter(arg => !/^--(fetch|pin|check|season=nhl-\d{4})$/.test(arg));
if (unknown.length) throw new Error(`Unknown option ${unknown[0]}`);
const fetchMissing = args.includes('--fetch'), pin = args.includes('--pin'), check = args.includes('--check');
const only = args.find(arg => arg.startsWith('--season='))?.slice('--season='.length);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const sha256 = data => createHash('sha256').update(data).digest('hex');

const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
const sourceList = JSON.parse(await readFile(sourcesFile, 'utf8'));
const pinned = new Map();

/** What a source's pin covers: the whole file, or (`pin: 'table'`) only its ratings table, for a page whose markup around it changes between requests. */
const pinnedPart = (entry, buffer) => (entry.pin === 'table' ? Buffer.from(segathonTable(buffer.toString('utf8'))) : buffer);

/** A pinned source's bytes from the cache (downloaded first with --fetch), checked against its pin. */
async function source(file) {
  const entry = sourceList.sources[file];
  if (!entry) throw new Error(`${file} is not a source in scripts/data/nhl-seasons-sources.json`);
  const at = path.join(cacheDir, file);
  if (!existsSync(at)) {
    if (!fetchMissing) throw new Error(`Missing data-src/nhl-seasons/${file}: run node scripts/sync-nhl-seasons.mjs --fetch`);
    await download(entry, at);
  }
  const buffer = await readFile(at);
  const hash = sha256(pinnedPart(entry, buffer));
  if (pin) pinned.set(file, hash);
  else if (entry.sha256 !== hash) throw new Error(`data-src/nhl-seasons/${file} is not the pinned source (SHA-256 ${hash}, pinned ${entry.sha256}): its source has changed`);
  return buffer;
}

let lastFetch = 0;
/**
 * A source's bytes from its URL, or, for a page only CommonCrawl kept (`warc`), from its record in CommonCrawl's
 * archive: the record's byte range, one gzip member, whose body follows the WARC and HTTP headers.
 */
async function download({ url, warc }, at) {
  await sleep(Math.max(0, lastFetch + PAUSE_MS - Date.now()));
  lastFetch = Date.now();
  const from = warc ? `https://data.commoncrawl.org/${warc.file}` : url;
  const headers = { 'user-agent': 'imperialism-game data sync', ...(warc ? { range: `bytes=${warc.offset}-${warc.offset + warc.length - 1}` } : {}) };
  const response = await fetch(from, { headers, signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`${from}: HTTP ${response.status}`);
  let body = Buffer.from(await response.arrayBuffer());
  if (warc) {
    const record = gunzipSync(body);
    const warcEnd = record.indexOf('\r\n\r\n'), httpEnd = record.indexOf('\r\n\r\n', warcEnd + 4);
    if (warcEnd < 0 || httpEnd < 0) throw new Error(`${from}: not a WARC response record`);
    body = record.subarray(httpEnd + 4);
  }
  await mkdir(path.dirname(at), { recursive: true });
  await writeFile(at, body);
  console.log(`  fetched ${url}${warc ? ` (CommonCrawl ${warc.file})` : ''}`);
}

// IGN's pages of 2006 are ISO-8859-1; everything else is UTF-8.
const text = async (file, encoding = 'utf8') => (await source(file)).toString(encoding);
const json = async file => JSON.parse(await text(file));

/** The clubs whose rosters of `season` (20062007) are sources. */
const rosterCodes = season => Object.keys(sourceList.sources)
  .map(file => file.match(/^nhl-api\/roster-([A-Z]{3})-(\d{8})\.json$/)).filter(m => m && m[2] === season).map(m => m[1]);

/** The NHL's players of `season` (20062007), every club of `codes` (their rosters must be sources). */
async function league(season, codes) {
  const players = [];
  for (const code of codes) players.push(...nhlRosterPlayers(await json(`nhl-api/roster-${code}-${season}.json`), code));
  return players;
}

/** The NHL's players of a season's neighbours, for a player who did not play that season: [label, players]. */
async function around(season) {
  const others = [];
  for (const api of season.apiAround || []) others.push([`the NHL's ${api.slice(0, 4)}/${api.slice(6)} rosters`, await league(api, rosterCodes(api))]);
  return others;
}

/**
 * Joins a source's rows `{ name, team (the NHL's code), group?, ... }` to the NHL's players of the season (`league`),
 * else to the seasons before and after (`others`, for a player who did not play that season: he keeps the source's
 * club). Returns `{ joined: [{ row, player, how }], left: [[name, team, reason]] }`.
 */
function join(rows, league, others, aliases) {
  const found = new Map(), taken = new Set();
  // Everyone his own club's roster names first, then the rest by name anywhere in the league, so that a namesake on
  // another club (the two Petr Sykoras of 2006/07) is never taken twice.
  for (const onTeamOnly of [true, false]) {
    for (const row of rows) {
      if (found.has(row)) continue;
      const hit = findPlayer(league, row, aliases, { taken, onTeamOnly });
      if (hit) { found.set(row, hit); taken.add(hit.player.id); }
    }
  }
  const joined = [], left = [];
  for (const row of rows) {
    let hit = found.get(row);
    if (!hit) {
      for (const [label, list] of others) {
        // A player traded that season is on two clubs' rosters: one player all the same.
        const named = list.filter(p => !taken.has(p.id) && norm(p.name) === norm(aliases[row.name] ?? row.name)
          && (!row.group || (row.group === 'G') === (p.pos === 'G')));
        if (new Set(named.map(p => p.id)).size === 1) { hit = { player: { ...named[0], team: row.team }, how: `name, ${label}` }; taken.add(named[0].id); break; }
      }
    }
    if (!hit) { left.push([row.name, row.team, 'on no NHL roster of the season or the seasons beside it']); continue; }
    joined.push({ row, player: hit.player, how: hit.how });
  }
  const ids = joined.map(j => j.player.id);
  if (new Set(ids).size !== ids.length) throw new Error('Two of the source\'s players are one of the NHL\'s');
  return { joined, left };
}

const loose = joined => joined.filter(j => j.how !== 'name').map(j => `${j.row.name} (${j.row.team}) = ${j.player.name}${j.player.team !== j.row.team ? ` (${j.player.team})` : ''}: ${j.how}`);
const groupOf = pos => (pos === 'G' ? 'G' : pos === 'D' ? 'D' : 'F');

// ---------- each edition ----------

/** NHL '94: KinGraph's sheet of the cartridge's attributes, the overall by the game's own rule, the positions the NHL's. */
async function nhl94(season) {
  const { codes: CODES, aliases = {} } = season.source;
  const rows = parseKinGraph(await text(season.files.ratings)).map(row => ({ ...row, team: CODES[row.team] ?? row.team }));
  const nhl = await league(season.api, teamsOf(manifest, season.year).map(team => team.code));
  const { joined, left } = join(rows, nhl, await around(season), aliases);
  const players = [];
  const notes = { loose: loose(joined), positionGroup: [] };
  for (const { row, player } of joined) {
    // The cartridge decides forward, defender or goalie; the NHL which forward.
    let pos = player.pos;
    if (groupOf(pos) !== row.group) {
      notes.positionGroup.push(`${row.name} (${row.team}): the game's ${row.group}, the NHL's ${player.pos}`);
      if (row.group !== 'F') pos = row.group;
      else { left.push([row.name, row.team, `a forward in the game whom the NHL lists as ${player.pos}: no forward position to give him`]); continue; }
    }
    players.push([player.name, row.team, pos, nhl94Overall(row.attributes, row.group === 'G'), player.born, player.id]);
  }
  return { players, left, notes };
}

/** NHLPA '93: the cartridge's attributes, the overall by NHL '94's weights, positions (goalies included) the NHL's. */
async function nhlpa93(season) {
  const { codes: CODES, aliases = {} } = season.source;
  const rows = parseNhlpa93(await text(season.files.ratings)).map(row => ({ ...row, team: CODES[row.team] ?? row.team }));
  const nhl = await league(season.api, teamsOf(manifest, season.year).map(team => team.code));
  const { joined, left } = join(rows, nhl, await around(season), aliases);
  const players = joined.map(({ row, player }) => [player.name, row.team, player.pos,
    nhlpa93Overall(player.pos === 'G' ? row.goalie : row.skater, player.pos === 'G'), player.born, player.id]);
  return { players, left, notes: { loose: loose(joined) } };
}

/** NHL 95: nhl-95.com's Genesis overall and positions, the Rangers' skaters from Segathon's list. */
async function nhl95(season) {
  const { codes: CODES, aliases = {}, fromSegathon, leaveOut = {} } = season.source;
  const segathon = parseSegathon(await text(season.files.segathon)).map(row => ({ ...row, team: CODES[row.team] ?? row.team }));
  const segathonOf = new Map(segathon.map(row => [`${norm(row.name)}|${row.team}`, row]));
  const left = [], notes = { fromSegathon: [], positionFromNhl: [] };
  const POSITION = { C: 'C', LW: 'LW', RW: 'RW', D: 'D', LD: 'D', RD: 'D', G: 'G', '': null };
  const rows = [];
  for (const row of parseNhl95Sheet(await text(season.files.ratings))) {
    const team = CODES[row.team] ?? row.team;
    const pos = POSITION[row.pos];
    if (pos === undefined) throw new Error(`nhl-95.com: unknown position ${row.pos} (${row.name})`);
    if (leaveOut[row.name]) { left.push([row.name, team, leaveOut[row.name]]); continue; }
    let overall = row.overall;
    if (fromSegathon.includes(team) && pos !== 'G') {
      const other = segathonOf.get(`${norm(aliases[row.name] ?? row.name)}|${team}`) ?? segathonOf.get(`${norm(row.name)}|${team}`);
      if (!other || other.overall === null) { left.push([row.name, team, "a Rangers skater Segathon's list does not rate"]); continue; }
      if (other.overall !== overall) notes.fromSegathon.push(`${row.name}: nhl-95.com ${overall}, Segathon ${other.overall}`);
      overall = other.overall;
    }
    if (!Number.isInteger(overall)) throw new Error(`nhl-95.com: ${row.name} (${team}) has the overall ${overall}`);
    rows.push({ name: row.name, team, group: pos ? groupOf(pos) : undefined, pos, overall });
  }
  const nhl = await league(season.api, teamsOf(manifest, season.year).map(team => team.code));
  const joined = join(rows, nhl, await around(season), aliases);
  left.push(...joined.left);
  const players = joined.joined.map(({ row, player }) => {
    // The sheet leaves a few positions blank: those players take the NHL's.
    if (!row.pos) notes.positionFromNhl.push(`${row.name} (${row.team}): ${player.pos}`);
    return [player.name, row.team, row.pos ?? player.pos, row.overall, player.born, player.id];
  });
  return { players, left, notes: { ...notes, loose: loose(joined.joined) } };
}

/** NHL 07: IGN's pages of EA's ratings (a team page each, the goalies on one page), goalies' decimals rounded. */
async function nhl07(season) {
  const { codes: CODES, aliases = {} } = season.source;
  const rows = [];
  for (const [code, file] of Object.entries(season.files.teams)) {
    for (const row of parseIgnPage(await text(file, 'latin1'))) rows.push({ ...row, team: code, group: groupOf(row.pos) });
  }
  const left = [];
  let rounded = 0;
  for (const row of parseIgnPage(await text(season.files.goalies, 'latin1'))) {
    const team = CODES[row.team];
    if (team === undefined) throw new Error(`IGN's goalies page: unknown team ${row.team}`);
    if (team === null) { left.push([row.name, row.team, 'a free agent in the game']); continue; }
    if (!Number.isInteger(row.overall)) rounded++;
    rows.push({ ...row, team, group: 'G', overall: Math.round(row.overall) });
  }
  const nhl = await league(season.api, teamsOf(manifest, season.year).map(team => team.code));
  const joined = join(rows, nhl, await around(season), aliases);
  left.push(...joined.left);
  // A player's nation: EA's Country one year on (IGN's NHL 08 pages), where exactly one country goes with his name; else
  // the NHL's birth country.
  const countries = new Map();
  for (const file of season.files.countries) {
    for (const { name, country } of parseIgnCountries(await text(file, 'latin1'))) {
      const key = norm(name);
      countries.set(key, countries.has(key) && countries.get(key) !== country ? null : country);
    }
  }
  const nation = { ea: 0, birth: 0, differs: [] };
  const players = joined.joined.map(({ row, player }) => {
    const country = countries.get(norm(player.name)) ?? countries.get(norm(row.name)) ?? null;
    const code = country ? COUNTRY_CODE[country] : null;
    if (country && !code) throw new Error(`IGN's NHL 08 pages: no code for the country ${country} (${player.name})`);
    if (code) {
      nation.ea++;
      if (code !== player.born) nation.differs.push(`${player.name}: EA ${country}, born ${player.born}`);
    } else nation.birth++;
    return [player.name, row.team, row.pos, row.overall, code ?? player.born, player.id];
  });
  return { players, left, notes: { loose: loose(joined.joined), goalieOverallsRounded: rounded, nation } };
}

const EDITIONS = { nhlpa93, nhl94, nhl95, nhl07, nhlratings: season => assembleNhlRatings(season, { text, json, manifest, sourceList }) };

// ---------- the snapshots ----------

function snapshotText(season, { players, left, notes }) {
  const order = teamsOf(manifest, season.year).map(team => team.code);
  const unknownTeams = [...new Set(players.map(p => p[1]))].filter(code => !order.includes(code));
  if (unknownTeams.length) throw new Error(`${season.id}: players of clubs the season does not have: ${unknownTeams.join(', ')}`);
  const sorted = players.slice().sort((a, b) => order.indexOf(a[1]) - order.indexOf(b[1]) || b[3] - a[3] || a[0].localeCompare(b[0]) || (a[5] ?? 0) - (b[5] ?? 0));
  const leftSorted = left.slice().sort((a, b) => a[1].localeCompare(b[1]) || a[0].localeCompare(b[0]));
  const source = { id: season.id, edition: season.edition, label: season.label, retrieved: season.retrieved };
  return `{\n"source": ${JSON.stringify(source)},\n"notes": ${JSON.stringify(notes)},\n"left": [\n${leftSorted.map(row => JSON.stringify(row)).join(',\n')}\n],\n`
    + `"players": [\n${sorted.map(row => JSON.stringify(row)).join(',\n')}\n]\n}\n`;
}

const differs = [];
for (const season of manifest.seasons) {
  if (only && season.id !== only) continue;
  const edition = EDITIONS[season.source.kind];
  if (!edition) throw new Error(`${season.id}: no assembler for ${season.source.kind}`);
  const result = await edition(season);
  const out = path.join(snapshotDir, `${season.id}.json`);
  const snapshot = snapshotText(season, result);
  const clubs = new Set(result.players.map(p => p[1])).size;
  console.log(`${season.id} ${season.edition}: ${result.players.length} players of ${clubs} clubs, ${result.left.length} left out`);
  if (check) {
    const current = existsSync(out) ? (await readFile(out, 'utf8')).replace(/\r\n/g, '\n') : null;
    if (current !== snapshot) differs.push(path.relative(root, out));
    continue;
  }
  await mkdir(snapshotDir, { recursive: true });
  await writeFile(out, snapshot);
}
if (pin) {
  for (const [file, hash] of pinned) sourceList.sources[file] = { ...sourceList.sources[file], sha256: hash };
  const body = Object.entries(sourceList.sources).map(([file, entry]) => `    ${JSON.stringify(file)}: ${JSON.stringify(entry)}`).join(',\n');
  await writeFile(sourcesFile, `{\n  "note": ${JSON.stringify(sourceList.note)},\n  "sources": {\n${body}\n  }\n}\n`);
  console.log(`Pinned ${pinned.size} sources in scripts/data/nhl-seasons-sources.json`);
}
if (differs.length) {
  console.error(`differs: ${differs.join(', ')}`);
  process.exit(1);
}
if (check) console.log('Verified the hockey season snapshots byte for byte.');
