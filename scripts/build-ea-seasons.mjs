// Build the built-in earlier football seasons from EA's FIFA 05 – EA FC 26 rosters (docs/design/football-years.md).
//
//   npm run build:ea-seasons                  writes public/football/ea-*.json, src/data/footballSeasons.js and
//                                             docs/design/football-seasons-audit.json
//   npm run build:ea-seasons -- --check       builds and compares every output byte for byte, writes nothing
//   npm run build:ea-seasons -- --data=<dir>  the downloaded sources elsewhere (default data-src/)
//   npm run build:ea-seasons -- --csv=<file>  the FIFA 15 – EA FC 24 export elsewhere (default <data>/ea-leone/male_players.csv)
//
// EA FC 26 comes from the committed snapshot the built-in 2025/26 was built from (scripts/data/ea-fc26.csv), EA FC 25
// from an export of EA's ratings website joined to a later SoFIFA scrape (scripts/lib/ea-site-seasons.mjs), FIFA 15 –
// EA FC 24 from one Kaggle export, FIFA 07 – FIFA 14 from a FIFA Index mirror joined to a SoFIFA scrape
// (scripts/lib/ea-legacy-seasons.mjs), and FIFA 05 and FIFA 06 from that mirror with nationalities from the later
// editions and Wikidata (scripts/lib/ea-early-seasons.mjs). scripts/data/ea-seasons.json names every file with its
// SHA-256, and the build stops on any other file, so every season rebuilds byte for byte. The listing also names the
// seasons before FIFA 05 (npm run build:retro-seasons) and the computed World Cup seasons (npm run
// build:world-cup-seasons), read from their committed files.
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { committedSeasons, footballSeasonsModule, retroSeasonIds, worldCupSeasonIds } from './lib/football-seasons-listing.mjs';
import { buildEaSeason, buildSnapshotEaSeason } from './lib/ea-seasons.mjs';
import { EARLY_EXTRA_FIELDS, buildEarlyEaSeason, nationalityEntries } from './lib/ea-early-seasons.mjs';
import { LEGACY_POSITIONS, buildLegacyEaSeason, legacyExclusions, readRatingsRows, rosterDates } from './lib/ea-legacy-seasons.mjs';
import { buildSiteEaSeason, readLaterRows, readSiteRows } from './lib/ea-site-seasons.mjs';
import { pinned, readExport, readLaterEditions, readLegacyFiles } from './lib/ea-season-files.mjs';
import { loadEaPlayers } from './lib/football-data.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function parseArgs(argv) {
  const args = {};
  for (const arg of argv) {
    const [, key, value] = /^--([a-z]+)(?:=(.*))?$/s.exec(arg) || [];
    if (key === 'check' && value === undefined) args.check = true;
    else if ((key === 'csv' || key === 'data') && value) args[key] = value;
    else throw new Error(`Unknown option ${arg}`);
  }
  return args;
}

/** EA FC 25: EA's ratings website joined to a later SoFIFA scrape by EA id (scripts/lib/ea-site-seasons.mjs). */
async function buildSiteSeasons(site, dataDir) {
  const results = [];
  for (const edition of site.editions) {
    const { ratings: ratingsFile, later: laterFile } = edition;
    const ratings = readSiteRows(await pinned(path.join(dataDir, ratingsFile.folder, ratingsFile.file), ratingsFile.sha256,
      `${edition.edition} ratings file; download ${ratingsFile.download}`));
    if (ratings.length !== ratingsFile.rows) throw new Error(`${ratingsFile.file} has ${ratings.length} rows, not ${ratingsFile.rows}`);
    const later = readLaterRows(await pinned(path.join(dataDir, laterFile.folder, laterFile.file), laterFile.sha256,
      `${edition.edition} later file; download ${laterFile.download}`));
    results.push(buildSiteEaSeason({ ratings, later }, edition, { ratingsUrl: ratingsFile.url }));
  }
  return results;
}

/** FIFA 07 – FIFA 14: each edition's two files joined by EA id (scripts/lib/ea-legacy-seasons.mjs). */
async function buildLegacySeasons(legacy, dataDir) {
  const dates = rosterDates(JSON.parse(await pinned(path.join(dataDir, legacy.dates.file), legacy.dates.sha256, 'roster dates')));
  const exclusions = legacyExclusions(legacy.exclusions);
  const editions = new Set(legacy.editions.map(edition => edition.edition));
  const stray = exclusions.filter(exclusion => !editions.has(exclusion.edition));
  if (stray.length) throw new Error(`Exclusions name editions that are not built: ${[...new Set(stray.map(x => x.edition))].join(', ')}`);
  const results = [];
  for (const edition of legacy.editions) {
    const files = await readLegacyFiles(legacy, edition, dataDir);
    results.push(buildLegacyEaSeason(files, edition, { ratingsUrl: legacy.ratings.url, clubsUrl: legacy.clubs.url, dates, exclusions }));
  }
  return results;
}

/** FIFA 05 and FIFA 06: each edition's ratings, with nationalities from the later editions and Wikidata (scripts/lib/ea-early-seasons.mjs). */
async function buildEarlySeasons(manifest, dataDir, rows) {
  const { early, legacy } = manifest;
  const later = await readLaterEditions(manifest, dataDir, rows);
  const entries = nationalityEntries(JSON.parse(await pinned(path.join(root, early.nationalities.file), early.nationalities.sha256, 'early nationalities')));
  const results = [];
  for (const edition of early.editions) {
    const file = path.join(dataDir, legacy.ratings.folder, edition.ratings.file);
    const ratings = readRatingsRows(await pinned(file, edition.ratings.sha256, `${edition.edition} ratings file`), { extraFields: EARLY_EXTRA_FIELDS });
    results.push(buildEarlyEaSeason({ ratings, later, entries }, edition, { ratingsUrl: legacy.ratings.url,
      nationalities: `The same EA id in the nearest later edition, else ${early.nationalities.name.split(',')[0]}` }));
  }
  return results;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifest = JSON.parse(await readFile(path.join(root, 'scripts/data/ea-seasons.json'), 'utf8'));
  const dataDir = path.resolve(args.data ?? path.join(root, 'data-src'));
  const csv = path.resolve(args.csv ?? path.join(dataDir, 'ea-leone', manifest.dataset.file));
  const rows = await readExport(manifest.dataset, csv);

  const snapshots = [];
  for (const snapshot of manifest.snapshots) {
    const file = path.join(root, snapshot.file);
    await pinned(file, snapshot.sha256, `${snapshot.edition} snapshot`);
    const { players, rows: count } = await loadEaPlayers(file);
    if (count !== snapshot.rows) throw new Error(`${snapshot.file} has ${count} rows, not ${snapshot.rows}`);
    snapshots.push(buildSnapshotEaSeason(players, snapshot, { dataset: snapshot.url }));
  }
  const results = [...snapshots, ...await buildSiteSeasons(manifest.site, dataDir),
    ...manifest.editions.map(edition => buildEaSeason(rows, edition, { dataset: manifest.dataset.url })),
    ...await buildLegacySeasons(manifest.legacy, dataDir), ...await buildEarlySeasons(manifest, dataDir, rows)];
  for (const { doc, text, audit } of results) {
    const { coverage } = doc;
    console.log(`${doc.id} ${doc.season} ${doc.label} (${audit.snapshotDate}, ${audit.rows} players): `
      + `${coverage.completeXIs}/${Object.keys(doc.nations).length} full XIs, ${coverage.nations} nations with players, ${coverage.clubs} clubs, ${Math.round(Buffer.byteLength(text) / 1024)} KB`);
    for (const warning of audit.warnings) console.log(`  warning: ${warning}`);
  }
  const retro = JSON.parse(await readFile(path.join(root, 'scripts/data/retro-seasons.json'), 'utf8'));
  const worldCup = JSON.parse(await readFile(path.join(root, 'scripts/data/world-cup-seasons.json'), 'utf8'));
  const listed = [...results.map(result => result.doc), ...await committedSeasons(path.join(root, 'public/football'), retroSeasonIds(retro)),
    ...await committedSeasons(path.join(root, 'public/football'), worldCupSeasonIds(worldCup))];
  const { editions, exclusions, ...legacySources } = manifest.legacy;
  const audit = { generatedBy: 'scripts/build-ea-seasons.mjs', snapshots: manifest.snapshots, site: manifest.site, dataset: manifest.dataset,
    legacy: { ...legacySources, positions: LEGACY_POSITIONS, exclusions }, early: manifest.early, seasons: results.map(result => result.audit) };
  const outputs = new Map([
    ...results.map(({ doc, text }) => [path.join(root, 'public/football', `${doc.id}.json`), text]),
    [path.join(root, 'src/data/footballSeasons.js'), footballSeasonsModule(listed, { ea: manifest, retro, worldCup })],
    [path.join(root, 'docs/design/football-seasons-audit.json'), `${JSON.stringify(audit, null, 2)}\n`],
  ]);
  if (args.check) {
    const differs = [];
    for (const [file, text] of outputs) {
      const current = existsSync(file) ? (await readFile(file, 'utf8')).replace(/\r\n/g, '\n') : null;
      if (current !== text) differs.push(path.relative(root, file));
    }
    if (differs.length) throw new Error(`Check failed, these differ from what the build writes: ${differs.join(', ')}`);
    console.log(`Check only, nothing written: ${outputs.size} files rebuild byte for byte`);
    return;
  }
  for (const [file, text] of outputs) await writeFile(file, text);
  console.log(`Wrote ${results.length} seasons to public/football/, src/data/footballSeasons.js and docs/design/football-seasons-audit.json`);
}

main().catch(error => {
  console.error(`build-ea-seasons: ${error.message}`);
  process.exitCode = 1;
});
