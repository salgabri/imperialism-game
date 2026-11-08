// Reading the pinned sources of the built-in earlier football seasons, shared by scripts/build-ea-seasons.mjs and
// scripts/sync-early-nationalities.mjs. Every file is checked against its SHA-256 in scripts/data/ea-seasons.json.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { EA_COLUMNS } from './ea-seasons.mjs';
import { laterFromExport, laterFromScrape } from './ea-early-seasons.mjs';
import { readClubRows, readRatingsRows } from './ea-legacy-seasons.mjs';
import { parseCsv } from './football-data.mjs';

export const sha256Of = bytes => createHash('sha256').update(bytes).digest('hex');

/** The export's rows as objects holding only the columns the build reads. */
export function readExportRows(text) {
  const [header, ...rows] = parseCsv(text);
  const at = EA_COLUMNS.map(name => {
    const index = header.indexOf(name);
    if (index < 0) throw new Error(`The export has no "${name}" column`);
    return index;
  });
  return rows.map((row, i) => {
    if (row.length !== header.length) throw new Error(`Row ${i + 2} has ${row.length} fields; expected ${header.length}`);
    return Object.fromEntries(EA_COLUMNS.map((name, k) => [name, row[at[k]]]));
  });
}

/** A source file's text, after checking it is the pinned one. */
export async function pinned(file, sha256, what) {
  const bytes = await readFile(file);
  const actual = sha256Of(bytes);
  if (actual !== sha256) throw new Error(`${file} is not the pinned ${what} (SHA-256 ${actual}); see scripts/data/ea-seasons.json`);
  return bytes.toString('utf8');
}

/** The FIFA 15 – EA FC 24 export's rows, after checking the file and its row count. */
export async function readExport(dataset, csv) {
  const rows = readExportRows(await pinned(csv, dataset.sha256, `export; download ${dataset.download} and unzip it`));
  if (rows.length !== dataset.rows) throw new Error(`The export has ${rows.length} rows, not ${dataset.rows}`);
  return rows;
}

/** One FIFA 07–14 edition's two files: `{ ratings, clubs, clubDuplicates }`. */
export async function readLegacyFiles(legacy, edition, dataDir) {
  const ratings = readRatingsRows(await pinned(path.join(dataDir, legacy.ratings.folder, edition.ratings.file), edition.ratings.sha256, `${edition.edition} ratings file`));
  const { rows: clubs, duplicates: clubDuplicates } = readClubRows(await pinned(path.join(dataDir, legacy.clubs.folder, edition.clubs.file), edition.clubs.sha256, `${edition.edition} clubs file`));
  return { ratings, clubs, clubDuplicates };
}

/**
 * Every edition after FIFA 06 that has a nationality, oldest first (the later editions of scripts/lib/ea-early-seasons.mjs):
 * FIFA 07–14 from `legacy`'s files, FIFA 15 – EA FC 24 from the export's rows.
 */
export async function readLaterEditions(manifest, dataDir, rows) {
  const scraped = [];
  for (const edition of manifest.legacy.editions) {
    const { ratings, clubs } = await readLegacyFiles(manifest.legacy, edition, dataDir);
    scraped.push({ fifaVersion: edition.fifaVersion, ...laterFromScrape(edition.edition, clubs, ratings) });
  }
  const exported = laterFromExport(rows, manifest.editions).map((later, i) => ({ fifaVersion: manifest.editions[i].fifaVersion, ...later }));
  return [...scraped, ...exported].sort((a, b) => a.fifaVersion - b.fifaVersion).map(({ edition, players }) => ({ edition, players }));
}
