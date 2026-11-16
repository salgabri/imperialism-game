// The EA seasons with clubs, FIFA 07 – EA FC 26, built from their pinned sources (scripts/data/ea-seasons.json):
// shared by scripts/build-ea-seasons.mjs, which writes the season files, and scripts/build-season-countries.mjs, which
// takes every club of every division from the same players (`assemble`, called with each edition's player records in
// place of assembleEaSeason). Newest first: EA FC 26 (the committed snapshot), EA FC 25 (the website export joined to a
// later scrape), FIFA 15 – EA FC 24 (one export), FIFA 07 – FIFA 14 (two scrapes joined).
import path from 'node:path';
import { assembleEaSeason, buildEaSeason, buildSnapshotEaSeason } from './ea-seasons.mjs';
import { buildLegacyEaSeason, rosterDates, legacyExclusions } from './ea-legacy-seasons.mjs';
import { buildSiteEaSeason, readLaterRows, readSiteRows } from './ea-site-seasons.mjs';
import { pinned, readLegacyFiles } from './ea-season-files.mjs';
import { loadEaPlayers } from './football-data.mjs';

/** EA FC 25: EA's ratings website joined to a later SoFIFA scrape by EA id (scripts/lib/ea-site-seasons.mjs). */
export async function buildSiteSeasons(site, dataDir, { assemble = assembleEaSeason } = {}) {
  const results = [];
  for (const edition of site.editions) {
    const { ratings: ratingsFile, later: laterFile } = edition;
    const ratings = readSiteRows(await pinned(path.join(dataDir, ratingsFile.folder, ratingsFile.file), ratingsFile.sha256,
      `${edition.edition} ratings file; download ${ratingsFile.download}`));
    if (ratings.length !== ratingsFile.rows) throw new Error(`${ratingsFile.file} has ${ratings.length} rows, not ${ratingsFile.rows}`);
    const later = readLaterRows(await pinned(path.join(dataDir, laterFile.folder, laterFile.file), laterFile.sha256,
      `${edition.edition} later file; download ${laterFile.download}`));
    results.push(buildSiteEaSeason({ ratings, later }, edition, { ratingsUrl: ratingsFile.url, assemble }));
  }
  return results;
}

/** FIFA 07 – FIFA 14: each edition's two files joined by EA id (scripts/lib/ea-legacy-seasons.mjs). */
export async function buildLegacySeasons(legacy, dataDir, { assemble = assembleEaSeason } = {}) {
  const dates = rosterDates(JSON.parse(await pinned(path.join(dataDir, legacy.dates.file), legacy.dates.sha256, 'roster dates')));
  const exclusions = legacyExclusions(legacy.exclusions);
  const editions = new Set(legacy.editions.map(edition => edition.edition));
  const stray = exclusions.filter(exclusion => !editions.has(exclusion.edition));
  if (stray.length) throw new Error(`Exclusions name editions that are not built: ${[...new Set(stray.map(x => x.edition))].join(', ')}`);
  const results = [];
  for (const edition of legacy.editions) {
    const files = await readLegacyFiles(legacy, edition, dataDir);
    results.push(buildLegacyEaSeason(files, edition, { ratingsUrl: legacy.ratings.url, clubsUrl: legacy.clubs.url, dates, exclusions, assemble }));
  }
  return results;
}

/** EA FC 26 from the committed snapshot (`root` is the repository). */
export async function buildSnapshotSeasons(manifest, root, { assemble = assembleEaSeason } = {}) {
  const results = [];
  for (const snapshot of manifest.snapshots) {
    const file = path.join(root, snapshot.file);
    await pinned(file, snapshot.sha256, `${snapshot.edition} snapshot`);
    const { players, rows: count } = await loadEaPlayers(file);
    if (count !== snapshot.rows) throw new Error(`${snapshot.file} has ${count} rows, not ${snapshot.rows}`);
    results.push(buildSnapshotEaSeason(players, snapshot, { dataset: snapshot.url, assemble }));
  }
  return results;
}

/**
 * Every EA season with clubs, newest first: the snapshot's, the website's, the export's (`rows`, readExport's) and the
 * legacy scrapes'. FIFA 05 and FIFA 06, nations only, are not among them.
 */
export async function buildClubSeasons(manifest, { root, dataDir, rows, assemble = assembleEaSeason }) {
  return [...await buildSnapshotSeasons(manifest, root, { assemble }), ...await buildSiteSeasons(manifest.site, dataDir, { assemble }),
    ...manifest.editions.map(edition => buildEaSeason(rows, edition, { dataset: manifest.dataset.url, assemble })),
    ...await buildLegacySeasons(manifest.legacy, dataDir, { assemble })];
}
