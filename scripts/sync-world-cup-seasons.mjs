// Read the computed World Cup seasons' sources into their committed facts (docs/design/football-years.md, "Computed World
// Cup seasons"):
//
//   npm run sync:world-cup-seasons                  writes scripts/data/world-cup-seasons/<id>.json for each season of
//                                                   scripts/data/world-cup-seasons.json, and elo-crosscheck.json
//   npm run sync:world-cup-seasons -- --check       builds and compares every output byte for byte, writes nothing
//   npm run sync:world-cup-seasons -- --data=<dir>  the downloaded sources elsewhere (default data-src/)
//
// Every source is a file in data-src/, pinned by SHA-256 in the manifest, and the sync stops on any other: the Fjelstul
// World Cup Database's CSV tables and martj42's results at the commits the manifest names, and the Wikipedia article
// pages (Ballon d'Or votes; the 1962 and 1966 line-ups) at the revisions it names. Nothing is downloaded here: a missing
// file is reported with where to get it. npm run build:world-cup-seasons reads only the facts this writes.
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { dayAfter, eloOn, resultRows } from './lib/football-elo.mjs';
import { ballonDorVotes, csvRows, eloCrossCheck, factsText, pageRevision, worldCupFacts, worldCupLineups } from './lib/world-cup-facts.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function parseArgs(argv) {
  const args = {};
  for (const arg of argv) {
    const [, key, value] = /^--([a-z]+)(?:=(.*))?$/s.exec(arg) || [];
    if (key === 'check' && value === undefined) args.check = true;
    else if (key === 'data' && value) args.data = value;
    else throw new Error(`Unknown option ${arg}`);
  }
  return args;
}

/** A pinned file's text, after checking it is the pinned one. */
async function pinned(dataDir, source, file, where) {
  const at = path.join(dataDir, source.folder, file.name ?? file.file);
  if (!existsSync(at)) throw new Error(`${at} is missing: download ${where} into data-src/${source.folder}/`);
  const bytes = await readFile(at);
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (digest !== file.sha256 || bytes.length !== file.bytes) {
    throw new Error(`${at} is not the pinned file (SHA-256 ${digest}, ${bytes.length} bytes); see scripts/data/world-cup-seasons.json`);
  }
  return bytes.toString('utf8');
}

/** A Wikipedia page's text, after checking its bytes and the revision it shows. */
async function pinnedPage(dataDir, source, page) {
  const html = await pinned(dataDir, source, page, `https://en.wikipedia.org/wiki/${page.title.replace(/ /g, '_')} (revision ${page.revision})`);
  const { revision, page: name } = pageRevision(html);
  if (revision !== page.revision || name !== page.title) throw new Error(`${page.file} shows ${name} revision ${revision}, not ${page.title} revision ${page.revision}`);
  return html;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifest = JSON.parse(await readFile(path.join(root, 'scripts/data/world-cup-seasons.json'), 'utf8'));
  const dataDir = path.resolve(args.data ?? path.join(root, 'data-src'));
  const { worldCup, results, ballonDor, lineups, crossCheck } = manifest.sources;

  const wc = {};
  for (const file of worldCup.files) wc[file.name.replace(/\.csv$/, '')] = csvRows(await pinned(dataDir, worldCup, file, `${worldCup.download}${file.name}`));
  const matches = resultRows(csvRows(await pinned(dataDir, results, results.files[0], `${results.download}${results.files[0].name}`)));
  const votes = {};
  for (const page of ballonDor.pages) {
    const year = Number(/^(\d{4}) Ballon d'Or$/.exec(page.title)?.[1]);
    if (!year) throw new Error(`${page.title} is not a Ballon d'Or year's page`);
    votes[year] = ballonDorVotes(await pinnedPage(dataDir, ballonDor, page));
  }
  const lineupBoxes = {};
  for (const page of lineups.pages) lineupBoxes[page.title] = worldCupLineups(await pinnedPage(dataDir, lineups, page));

  // One pass of the Elo through the results: each season's day after the final, and each World Cup year's end.
  const finalOf = season => wc.tournaments.find(t => t.tournament_id === season.tournament)?.end_date;
  const days = manifest.seasons.map(season => dayAfter(finalOf(season)));
  const yearEnds = manifest.seasons.map(season => `${season.year + 1}-01-01`);
  const elo = eloOn(matches, [...days, ...yearEnds], manifest.elo);

  const outputs = new Map(), spellings = [], pinnedUsed = new Set();
  const summary = [];
  for (const [i, season] of manifest.seasons.entries()) {
    const boxes = season.minutes === 'lineups' ? season.lineupPages.flatMap(title => {
      if (!lineupBoxes[title]) throw new Error(`${season.id}: the manifest pins no page ${title}`);
      return lineupBoxes[title];
    }) : null;
    const { facts, audit } = worldCupFacts({ wc, lineups: boxes, votes, season, elo: manifest.elo, snapshot: elo[days[i]], names: manifest.names });
    spellings.push(...audit.spellings);
    for (const name of audit.pinned) pinnedUsed.add(name);
    outputs.set(path.join(root, 'scripts/data/world-cup-seasons', `${season.id}.json`), factsText(facts));
    summary.push(`${season.id}: ${facts.nations.length} squads, ${facts.nations.reduce((n, nation) => n + nation.squad.length, 0)} players; Elo of ${facts.elo.date}, `
      + `best ${facts.elo.best.team} ${facts.elo.best.elo}; ${facts.unmatchedVotes.length} Ballon d'Or votes for players in no squad`);
  }

  // Every name the line-up pages spell otherwise is one the manifest has reviewed, and every reviewed one still occurs.
  const key = s => `${s.year}|${s.team}|${s.shirt}|${s.wikipedia}|${s.database}`;
  const reviewed = new Set(manifest.names.lineupSpellings.map(key)), seen = new Set(spellings.map(key));
  const unreviewed = spellings.filter(s => !reviewed.has(key(s)));
  if (unreviewed.length) throw new Error(`Line-up names the database spells otherwise, not reviewed in the manifest: ${unreviewed.map(s => JSON.stringify(s)).join(', ')}`);
  const stale = manifest.names.lineupSpellings.filter(s => !seen.has(key(s)));
  if (stale.length) throw new Error(`Reviewed line-up spellings that no longer occur: ${stale.map(s => JSON.stringify(s)).join(', ')}`);
  const unusedPins = manifest.names.ballonDorPlayers.filter(pin => !pinnedUsed.has(pin.name));
  if (unusedPins.length) throw new Error(`Pinned Ballon d'Or names no vote needs: ${unusedPins.map(pin => pin.name).join(', ')}`);

  // The cross-check: year-end Elo against eloratings.net's tables (summary figures only).
  const codes = Object.fromEntries((await pinned(dataDir, crossCheck, crossCheck.files.find(f => f.name === 'en.teams.tsv'), crossCheck.url))
    .split('\n').filter(Boolean).map(line => line.split('\t').map(cell => cell.trim())));
  const years = [];
  for (const season of manifest.seasons) {
    const file = crossCheck.files.find(f => f.name === `${season.year}.tsv`);
    const table = (await pinned(dataDir, crossCheck, file, crossCheck.url)).split('\n').filter(Boolean).map(line => line.split('\t'));
    years.push(eloCrossCheck({ year: season.year, table, codes, ratings: elo[`${season.year + 1}-01-01`].ratings, aliases: crossCheck.aliases }));
  }
  const average = key2 => Math.round(years.reduce((s, y) => s + y[key2], 0) / years.length * 1000) / 1000;
  const check = { about: 'Computed year-end Elo against eloratings.net\'s published year-end tables: a cross-check only, never an input; '
    + 'no published rating is kept here (scripts/sync-world-cup-seasons.mjs).', years,
  mean: { pearson: average('pearson'), spearmanTop48: average('spearmanTop48'), slope: average('slope') } };
  outputs.set(path.join(root, 'scripts/data/world-cup-seasons/elo-crosscheck.json'), `${JSON.stringify(check, null, 2)}\n`);

  for (const line of summary) console.log(line);
  console.log(`Cross-check: Pearson ${check.mean.pearson}, top-48 Spearman ${check.mean.spearmanTop48} on average over ${years.length} years`);
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
  for (const [file, text] of outputs) await writeFile(file, text);
  console.log(`Wrote ${outputs.size} files to scripts/data/world-cup-seasons/`);
}

main().catch(error => {
  console.error(`sync-world-cup-seasons: ${error.message}`);
  process.exitCode = 1;
});
