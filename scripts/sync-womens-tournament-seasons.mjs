// Read the computed women's seasons' sources into their committed facts (docs/design/womens-football.md, "Computed
// seasons"):
//
//   npm run sync:womens-tournament-seasons                  writes scripts/data/womens-tournament-seasons/<id>.json for each
//                                                           season of scripts/data/womens-tournament-seasons.json, and
//                                                           elo-crosscheck.json
//   npm run sync:womens-tournament-seasons -- --check       builds and compares every output byte for byte, writes nothing
//   npm run sync:womens-tournament-seasons -- --fetch       first downloads the sources missing from data-src/
//   npm run sync:womens-tournament-seasons -- --pin         records the SHA-256 and size (and a page's revision) of every
//                                                           source file but the World Cup database's, after a deliberate
//                                                           new download
//   npm run sync:womens-tournament-seasons -- --data=<dir>  the downloaded sources elsewhere (default data-src/)
//
// Every source is a file in data-src/, pinned by SHA-256 in the manifest, and the sync stops on any other: the Fjelstul
// World Cup Database's tables (the men's World Cup seasons' pins, which hold the women's World Cups too), martj42's
// women's results and the cross-check's FIFA ranking at the commits the manifest names, the Wikipedia article pages of
// the Olympic tournaments' squads and line-ups at the revisions it names, and the RSSSF pages of the Olympic line-ups.
// Downloads go through scripts/lib/polite-fetch.mjs: GitHub's files from raw.githubusercontent.com, Wikipedia's
// article paths (/wiki/, which its robots.txt allows) and RSSSF's pages (it has no robots.txt) 2 s apart.
// npm run build:womens-tournament-seasons reads only the facts this writes.
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { dayAfter, eloOn, resultRows } from './lib/football-elo.mjs';
import { csvRows, factsText, pageRevision, worldCupFacts } from './lib/world-cup-facts.mjs';
import { FACTS_LICENCE, fifaCrossCheck, olympicFacts, olympicLineups, olympicSquads, tournamentGoals } from './lib/womens-tournament-facts.mjs';
import { fetchFile, politeFetch } from './lib/polite-fetch.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const MANIFEST = path.join(root, 'scripts/data/womens-tournament-seasons.json');
const OUT = path.join(root, 'scripts/data/womens-tournament-seasons');
const GAP = 2_000;

function parseArgs(argv) {
  const args = {};
  for (const arg of argv) {
    const [, key, value] = /^--([a-z]+)(?:=(.*))?$/s.exec(arg) || [];
    if (['check', 'fetch', 'pin'].includes(key) && value === undefined) args[key] = true;
    else if (key === 'data' && value) args.data = value;
    else throw new Error(`Unknown option ${arg}`);
  }
  if (args.check && (args.fetch || args.pin)) throw new Error('--check writes nothing: run it without --fetch or --pin');
  return args;
}

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const pageUrl = title => `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_')).replace(/%2F/g, '/')}`;

/** Every source's files as `{ folder, file, url, page? }`: the tables, then the pages. */
function sourceFiles(manifest) {
  const { worldCup, results, crossCheck, wikipedia, rsssf } = manifest.sources;
  return [
    ...[worldCup, results, crossCheck].flatMap(source => source.files.map(file => ({ source, folder: source.folder, file, url: `${source.download}${file.name}` }))),
    ...(wikipedia?.pages ?? []).map(page => ({ source: wikipedia, folder: wikipedia.folder, file: page, url: pageUrl(page.title), page: true })),
    ...(rsssf?.pages ?? []).map(page => ({ source: rsssf, folder: rsssf.folder, file: page, url: page.url })),
  ];
}

/** Download every source file the data folder lacks, one at a time, 2 s apart. Nothing is retried. */
async function fetchMissing(dataDir, manifest) {
  let fetched = false;
  for (const { folder, file, url, page } of sourceFiles(manifest)) {
    const at = path.join(dataDir, folder, file.name ?? file.file);
    if (existsSync(at)) continue;
    if (fetched) await wait(GAP);
    fetched = true;
    console.log(`Saving ${url}`);
    let bytes;
    if (page || /rsssf\.org/.test(url)) {
      const response = await politeFetch(url);
      bytes = Buffer.from(await response.arrayBuffer());
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
      if (page) {
        const shown = pageRevision(bytes.toString('utf8'));
        if (shown.page !== file.title) throw new Error(`${url} shows ${shown.page}`);
      }
    } else {
      bytes = await fetchFile(url);
    }
    await mkdir(path.dirname(at), { recursive: true });
    await writeFile(at, bytes);
  }
}

/** Record each source file's SHA-256 and size (and a page's revision) in the manifest; the World Cup database's are the men's seasons' pins. */
async function pinAll(dataDir, manifest) {
  for (const { source, folder, file, page } of sourceFiles(manifest)) {
    if (source === manifest.sources.worldCup) continue;
    const bytes = await readFile(path.join(dataDir, folder, file.name ?? file.file));
    if (page) {
      const { revision, page: title } = pageRevision(bytes.toString('utf8'));
      if (title !== file.title) throw new Error(`${file.file} shows ${title}, not ${file.title}`);
      file.revision = revision;
    }
    Object.assign(file, { sha256: sha256(bytes), bytes: bytes.length });
  }
  await writeFile(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log('Pinned every source file in scripts/data/womens-tournament-seasons.json');
}

/** A pinned file's bytes, after checking they are the pinned ones. */
async function pinnedBytes(dataDir, folder, file, where) {
  const at = path.join(dataDir, folder, file.name ?? file.file);
  if (!existsSync(at)) throw new Error(`${at} is missing: run with --fetch, or download ${where} into data-src/${folder}/`);
  const bytes = await readFile(at);
  const digest = sha256(bytes);
  if (digest !== file.sha256 || bytes.length !== file.bytes) {
    throw new Error(`${at} is not the pinned file (SHA-256 ${digest}, ${bytes.length} bytes); see scripts/data/womens-tournament-seasons.json`);
  }
  return bytes;
}

/** A pinned file's text, after checking it is the pinned one (and, for a Wikipedia page, the revision it shows). */
async function pinned(dataDir, folder, file, where) {
  const text = (await pinnedBytes(dataDir, folder, file, where)).toString('utf8');
  if (file.revision != null) {
    const shown = pageRevision(text);
    if (shown.revision !== file.revision || shown.page !== file.title) throw new Error(`${file.file} shows ${shown.page} revision ${shown.revision}, not ${file.title} revision ${file.revision}`);
  }
  return text;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifest = JSON.parse(await readFile(MANIFEST, 'utf8'));
  const dataDir = path.resolve(args.data ?? path.join(root, 'data-src'));
  if (args.fetch) await fetchMissing(dataDir, manifest);
  if (args.pin) await pinAll(dataDir, manifest);
  const { worldCup, results, crossCheck, wikipedia, rsssf } = manifest.sources;

  const wc = {};
  for (const file of worldCup.files) wc[file.name.replace(/\.csv$/, '')] = csvRows(await pinned(dataDir, worldCup.folder, file, `${worldCup.download}${file.name}`));
  const matches = resultRows(csvRows(await pinned(dataDir, results.folder, results.files[0], `${results.download}${results.files[0].name}`)));
  const ranking = csvRows(await pinned(dataDir, crossCheck.folder, crossCheck.files[0], `${crossCheck.download}${crossCheck.files[0].name}`));
  const pages = {};
  for (const page of wikipedia?.pages ?? []) pages[page.title] = await pinned(dataDir, wikipedia.folder, page, pageUrl(page.title));
  // RSSSF serves windows-1252: its pages stay bytes until the line-ups' reader decodes them.
  for (const page of rsssf?.pages ?? []) pages[page.url] = await pinnedBytes(dataDir, rsssf.folder, page, page.url);

  // One pass of the Elo through the results: each season's day after its final, and each of FIFA's releases to the
  // cross-check's end.
  const finalOf = season => (season.tournament ? wc.tournaments.find(t => t.tournament_id === season.tournament)?.end_date : season.final);
  const days = manifest.seasons.map(season => dayAfter(finalOf(season)));
  const releases = [...new Set(ranking.map(row => row.ranking_date))].filter(date => date <= crossCheck.through).sort();
  const elo = eloOn(matches, [...days, ...releases], manifest.elo);

  const outputs = new Map(), summary = [], reviewed = { spellings: new Set(), errors: new Set() }, unmatched = [], loose = {};
  for (const [i, season] of manifest.seasons.entries()) {
    let facts;
    if (season.tournament) {
      ({ facts } = worldCupFacts({ wc, season, elo: manifest.elo, snapshot: elo[days[i]], names: manifest.names, licence: FACTS_LICENCE }));
    } else {
      const squads = olympicSquads(pages[season.squads]);
      const boxes = olympicLineups(season.lineups.map(source => ({ ...source, html: pages[source.page], bytes: pages[source.page] })), season);
      const goals = season.goals.flatMap(title => tournamentGoals(pages[title]));
      const made = olympicFacts({ squads, boxes, goals, season, matches, snapshot: elo[days[i]], elo: manifest.elo, names: manifest.names });
      for (const key of made.audit.spellings) reviewed.spellings.add(key);
      for (const key of made.audit.errors) reviewed.errors.add(key);
      loose[season.id] = [...made.audit.loose].sort();
      if (!made.facts) {
        unmatched.push(...[...new Set(made.unmatched)].map(key => `${key} (squad: ${squads.find(s => s.team === key.split('|')[1])?.players
          .map(p => `${p.shirt} ${p.name}${p.alternate ? '*' : ''}`).join(', ')})`));
        continue;
      }
      facts = made.facts;
    }
    outputs.set(path.join(OUT, `${season.id}.json`), factsText(facts));
    summary.push(`${season.id}: ${facts.nations.length} squads, ${facts.nations.reduce((n, nation) => n + nation.squad.length, 0)} players; Elo of ${facts.elo.date}, `
      + `best ${facts.elo.best.team} ${facts.elo.best.elo}`);
  }
  // Every line-up name no rule matches, and every slip of a page, is one the manifest has reviewed, and every reviewed
  // one still occurs.
  if (unmatched.length) throw new Error(`Line-up names no rule matches, to review in the manifest's names.lineupSpellings:\n  ${unmatched.join('\n  ')}`);
  for (const [key, list] of [['spellings', manifest.names.lineupSpellings ?? []], ['errors', manifest.names.lineupErrors ?? []]]) {
    const stale = list.map(entry => entry.key).filter(k => !reviewed[key].has(k));
    if (stale.length) throw new Error(`Reviewed line-up ${key} that no longer occur: ${stale.join('; ')}`);
  }

  // The line-up names matched by a looser rule than her article or the same words, for review.
  outputs.set(path.join(OUT, 'lineup-names.json'), `${JSON.stringify({
    about: 'Each Olympic line-up name (year|team|number|name as the page writes it) that is not its player\'s article nor her name\'s words, and '
      + 'the squad player it was matched to and by which rule: her surname, her number (the name sharing a word), her name where the number '
      + 'is another\'s, or a reviewed spelling (the manifest\'s names.lineupSpellings). Written by scripts/sync-womens-tournament-seasons.mjs.',
    seasons: loose,
  }, null, 2)}\n`);

  // The cross-check: the Elo against each of FIFA's releases (summary figures only).
  const check = fifaCrossCheck({ ranking, releases, snapshots: elo, aliases: crossCheck.aliases,
    seasons: manifest.seasons.map((season, i) => ({ id: season.id, day: days[i] })) });
  outputs.set(path.join(OUT, 'elo-crosscheck.json'), `${JSON.stringify(check, null, 2)}\n`);

  for (const line of summary) console.log(line);
  console.log(`Cross-check against ${check.releases.length} FIFA releases: Pearson ${check.mean.pearson}, top-48 Spearman ${check.mean.spearmanTop48}, `
    + `top-20 Spearman ${check.mean.spearmanTop20} on average`);
  if (args.check) {
    const differs = [];
    for (const [file, text] of outputs) {
      const current = existsSync(file) ? (await readFile(file, 'utf8')).replace(/\r\n/g, '\n') : null;
      if (current !== text) differs.push(path.relative(root, file));
    }
    if (differs.length) throw new Error(`Check failed, these differ from what the sync writes: ${differs.join(', ')}`);
    console.log(`Check only, nothing written: ${outputs.size} files rebuild byte for byte`);
    return;
  }
  await mkdir(OUT, { recursive: true });
  for (const [file, text] of outputs) await writeFile(file, text);
  console.log(`Wrote ${outputs.size} files to scripts/data/womens-tournament-seasons/`);
}

main().catch(error => {
  console.error(`sync-womens-tournament-seasons: ${error.message}`);
  process.exitCode = 1;
});
