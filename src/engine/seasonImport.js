// "Add a season…" (docs/design/football-years.md): build a football season in the browser from the player's own
// Championship Manager 01/02 Data folder, with the builder the command line uses (src/data/footballSetBuild.js), and
// keep it in this browser (src/engine/localSets.js). Nothing is uploaded. Only the known releases can be added here:
// any other database needs the command-line builder, which is told its season and birth-date shift.
//
// The App loads this module only when a folder is chosen, so the reader and builder stay out of the main bundle.

import { CM_DATA_FILES, fileSignature } from '../data/cm0102.js';
import { CM0102_RELEASES } from '../data/cm0102Releases.js';
import { buildFootballSet, identifyDatabase } from '../data/footballSetBuild.js';
import { NATIONS } from '../data/teams.js';
import { decodeFootballSet } from './footballSets.js';
import { listLocalSets, localSetsPersist, putLocalSet } from './localSets.js';

const HOW_TO = 'Choose the Data folder of a Championship Manager 01/02 database: it holds index.dat, staff.dat, club.dat '
  + 'and the other .dat files.';
const ARCHIVE = /\.(zip|rar|7z)$/i;

const listOf = items => (items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items.at(-1)}` : items[0]);
const megabytes = bytes => `${Math.max(1, Math.round(bytes / 1048576))} MB`;

/**
 * The Data folder among what was chosen (a folder picker's FileList, or the .dat files themselves): the one folder
 * holding every file the reader needs, by base name in any case. `{ folder, files: Map<name, File> }`; `folder` is
 * its path inside the choice ('' for loose files). Throws with what to choose instead.
 */
export function dataFolderOf(chosen) {
  const all = Array.from(chosen || []);
  const folders = new Map();
  for (const file of all) {
    const path = String(file?.webkitRelativePath || file?.name || '');
    const cut = path.lastIndexOf('/');
    const name = path.slice(cut + 1).toLowerCase();
    if (!CM_DATA_FILES.includes(name)) continue;
    const folder = cut < 0 ? '' : path.slice(0, cut);
    if (!folders.has(folder)) folders.set(folder, new Map());
    if (!folders.get(folder).has(name)) folders.get(folder).set(name, file);
  }
  const indexed = [...folders].filter(([, files]) => files.has('index.dat'));
  if (!indexed.length) {
    const archive = all.find(file => ARCHIVE.test(String(file?.name || '')));
    throw new Error(archive ? `${archive.name} is still packed: extract it first, then choose its Data folder.`
      : `There is no index.dat in what you chose. ${HOW_TO}`);
  }
  const complete = indexed.filter(([, files]) => files.size === CM_DATA_FILES.length);
  if (complete.length > 1) {
    const paths = complete.map(([folder]) => folder).sort();
    throw new Error(`That folder holds ${complete.length} Data folders (${paths.slice(0, 3).join(', ')}${paths.length > 3 ? ', …' : ''}): `
      + 'choose just one of them.');
  }
  if (!complete.length) {
    const [folder, files] = indexed.sort(([, a], [, b]) => b.size - a.size)[0];
    const missing = CM_DATA_FILES.filter(name => !files.has(name));
    throw new Error(`${folder ? `${folder} has` : 'The chosen files have'} index.dat but not ${listOf(missing)}. ${HOW_TO}`);
  }
  const [folder, files] = complete[0];
  return { folder, files };
}

/**
 * Resolves after the next paint, so a status set just before shows while the build holds the page. A page that is
 * not being drawn (another tab, a hidden pane) gets no frames, so a timer stands in.
 */
function nextPaint() {
  return new Promise(resolve => {
    let started = false;
    const later = () => {
      if (started) return;
      started = true;
      setTimeout(resolve, 0);
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(later);
    setTimeout(later, 100);
  });
}

/**
 * Build the season in `chosen` and keep it in this browser. `onProgress({ state, message })` reports 'reading' and
 * then 'building'; the build waits for `afterPaint` first, as it holds the page for a few seconds. `releases` (default
 * CM0102_RELEASES) are the databases that may be added: tests name their fixture's. Resolves to `{ doc, entry,
 * previous, audit, warnings, folder, persistent }`, where `previous` is the entry it replaced, if any.
 */
export async function importSeason(chosen, { onProgress = () => {}, releases = CM0102_RELEASES, afterPaint = nextPaint } = {}) {
  const { folder, files } = dataFolderOf(chosen);
  const size = [...files.values()].reduce((sum, file) => sum + (Number(file.size) || 0), 0);
  // A path says where in a bigger folder the data was found; the Data folder itself, or loose files, need no name.
  const where = folder.includes('/') ? folder : 'the Data folder';
  onProgress({ state: 'reading', message: `Reading ${where} (${megabytes(size)})…` });
  const bytes = {};
  for (const [name, file] of files) bytes[name] = new Uint8Array(await file.arrayBuffer());

  const signature = fileSignature(bytes);
  const known = identifyDatabase(signature, releases);
  if (!known) {
    throw new Error(`This database is not one of the ${releases.length} known CM 01/02 releases (club.dat `
      + `${signature.clubSize.toLocaleString('en')} bytes, staff.dat ${signature.staffSize.toLocaleString('en')} bytes), so its season `
      + 'is unknown. npm run build:football-set can add it if you name the season yourself (see "Football seasons" in the README).');
  }
  const { database } = known;
  onProgress({ state: 'building', message: `Building ${database.season} from CM 01/02 · ${database.label}…` });
  await afterPaint();
  // The browser has no flags to give, so a nation the game does not have loses its players (the audit counts them).
  const built = buildFootballSet(bytes, { databases: releases, allowUnmapped: true });
  // Stored only if the loader takes it.
  decodeFootballSet(built.doc);
  const previous = (await listLocalSets()).find(entry => entry.id === built.doc.id) || null;
  let entry;
  try {
    entry = await putLocalSet(built.doc);
  } catch (e) {
    throw new Error(`This browser would not store the season: ${(e && e.message) || e}`);
  }
  return { doc: built.doc, entry, previous, audit: built.audit, warnings: built.warnings, folder, persistent: await localSetsPersist() };
}

/** The status line after an import: what was added, what was left out, and how long it stays. */
export function importedMessage({ doc, previous, audit, persistent }) {
  const name = `${doc.season} · ${doc.label}`;
  const verb = !previous ? 'Added' : previous.version === doc.version ? 'Already added:' : 'Updated';
  const { completeXIs, clubs, leagues } = doc.coverage;
  const parts = [`${verb} ${name}. ${completeXIs} of ${Object.keys(NATIONS).length} nations field a full XI; `
    + `${clubs} club${clubs === 1 ? '' : 's'} from ${leagues} league${leagues === 1 ? '' : 's'}.`];
  const left = Object.values(audit?.unmapped || {}).reduce((sum, n) => sum + n, 0);
  if (left) parts.push(`${left} player${left === 1 ? '' : 's'} from nations the game does not have ${left === 1 ? 'was' : 'were'} left out.`);
  if (Object.values(audit?.database?.digests || {}).includes('mismatch')) {
    parts.push(`Its files differ from the published ${audit.database.label}, so it may have been edited.`);
  }
  if (!persistent) parts.push('This browser cannot keep it, so it lasts until the page closes.');
  return parts.join(' ');
}
