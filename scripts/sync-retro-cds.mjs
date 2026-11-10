// The data files of the built-in football seasons read from CD images (docs/design/football-years.md, "SI's CM 99/00 and
// CM 00/01, read from their CDs"): every season of scripts/data/retro-seasons.json with a `cd` block, its tables fetched
// into the gitignored data-src/<folder>/ for npm run build:retro-seasons.
//
//   npm run sync:retro-cds                                    every CD season's files not yet present
//   npm run sync:retro-cds -- --only=cm-9900,cm-0001          these seasons
//   npm run sync:retro-cds -- --only=cm-9900 --image=<file>   from a local image of the same CD (.bin MODE1/2352 or .iso)
//   npm run sync:retro-cds -- --data=<dir>                    another data-src
//
// Only the bytes the tables need are read, by HTTP range requests on the archive.org item's image, at least a second
// apart: the volume descriptors, the directories on the way, then either the InstallShield header (`cd.cabinet.header`)
// whole and each table's compressed bytes in the cabinet (scripts/lib/installshield5.mjs), or each table's extent in
// `cd.folder`. The image must have the pinned size and volume (name and creation time), the header its pinned SHA-256,
// each expanded table the header's MD5, and every file its pinned size and SHA-256 before it is written. No executable
// and no whole image is downloaded, and nothing is run. archive.org's robots.txt (read 2026-11-09) disallows only
// /control/ and /report/; the requests go through scripts/lib/polite-fetch.mjs (one generic User-Agent), which reads it
// and that of the iaNNNNNN.us.archive.org host each download redirects to (none: HTTP 404, 2026-11-10) before following.
// A file already present with its pinned digest is not fetched again.
import { existsSync } from 'node:fs';
import { mkdir, open, readFile, rename, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { LAYOUTS, checkLayout, findEntry, readDirectory, readEntry, readUserBytes, readVolume } from './lib/cd-image.mjs';
import { expandIs5File, is5File, readIs5Header } from './lib/installshield5.mjs';
import { politeFetch } from './lib/polite-fetch.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const GAP_MS = 1000;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function parseArgs(argv) {
  const args = {};
  for (const arg of argv) {
    const [, key, value] = /^--([a-z]+)(?:=(.*))?$/s.exec(arg) || [];
    if (key === 'only' && value) args.only = value.split(',');
    else if (key === 'image' && value) args.image = value;
    else if (key === 'data' && value) args.data = value;
    else throw new Error(`Unknown option ${arg}`);
  }
  if (args.image && args.only?.length !== 1) throw new Error('--image reads one CD: name its season with --only=<id>');
  return args;
}

/** The item's image on archive.org, read by range requests at least GAP_MS apart; each answer must be exactly the bytes asked for. */
function archiveImage(cd, log) {
  const url = `https://archive.org/download/${cd.item}/${encodeURIComponent(cd.image)}`;
  let last = 0, requests = 0, received = 0;
  const readRange = async (start, end) => {
    if (end > cd.imageBytes) throw new Error(`${cd.image}: bytes ${start}-${end - 1} are past its ${cd.imageBytes}`);
    for (let attempt = 0; ; attempt++) {
      const wait = last + GAP_MS - Date.now();
      if (wait > 0) await sleep(wait);
      last = Date.now();
      requests++;
      try {
        const response = await politeFetch(url, { headers: { Range: `bytes=${start}-${end - 1}` }, redirect: 'follow',
          signal: AbortSignal.timeout(300000) });
        if (response.status !== 206) {
          // A server that ignores Range would send the whole image: stop it before the body is read.
          await response.body?.cancel();
          throw new Error(`HTTP ${response.status}, not 206 Partial Content`);
        }
        const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range') || '');
        if (!range || Number(range[1]) !== start || Number(range[2]) !== end - 1 || Number(range[3]) !== cd.imageBytes) {
          await response.body?.cancel();
          throw new Error(`Content-Range ${response.headers.get('content-range')} is not bytes ${start}-${end - 1}/${cd.imageBytes}: not the pinned image`);
        }
        const body = new Uint8Array(await response.arrayBuffer());
        if (body.length !== end - start) throw new Error(`${body.length} bytes received, ${end - start} asked for`);
        received += body.length;
        return body;
      } catch (error) {
        if (attempt >= 3 || /not the pinned image/.test(error.message)) throw new Error(`${url} bytes ${start}-${end - 1}: ${error.message}`);
        log(`  retrying bytes ${start}-${end - 1} (${error.message})`);
        await sleep(3000 * (attempt + 1));
      }
    }
  };
  return { readRange, where: url, done: async () => `${requests} range requests, ${(received / 1048576).toFixed(2)} MB` };
}

/** A local image file, read in place. */
async function localImage(file) {
  const handle = await open(file, 'r');
  const readRange = async (start, end) => {
    const out = new Uint8Array(end - start);
    const { bytesRead } = await handle.read(out, 0, out.length, start);
    if (bytesRead !== out.length) throw new Error(`${file}: bytes ${start}-${end - 1} are past its end`);
    return out;
  };
  return { readRange, where: file, done: async () => { await handle.close(); return 'read locally'; } };
}

/** The layout of an image: the manifest's for the pinned image, else whichever of LAYOUTS finds a volume descriptor at sector 16. */
async function layoutOf(readRange, cd, local) {
  if (!local) return checkLayout(cd);
  for (const layout of [LAYOUTS.mode1, LAYOUTS.iso]) {
    try {
      const sector = await readUserBytes(readRange, layout, 16, 0, 8);
      if (String.fromCharCode(...sector.subarray(1, 6)) === 'CD001') return layout;
    } catch {
      // Not this layout (no MODE1 sync pattern, or too short).
    }
  }
  throw new Error('No ISO 9660 volume descriptor at sector 16 in 2048-byte or raw MODE1 sectors: not a CD image');
}

/** Whether a file is in data-src with its pinned size and SHA-256. */
async function present(dataDir, file) {
  const at = path.join(dataDir, file.folder, file.name);
  if (!existsSync(at)) return false;
  const bytes = await readFile(at);
  return bytes.length === file.bytes && sha256(bytes) === file.sha256;
}

/** Write a file once it has its pinned size and SHA-256 (through a temporary name, so a failed run leaves no half file). */
async function store(dataDir, file, bytes) {
  const digest = sha256(bytes);
  if (bytes.length !== file.bytes || digest !== file.sha256) {
    throw new Error(`${file.name} read as ${bytes.length} bytes, SHA-256 ${digest}: not the pinned ${file.bytes} bytes, ${file.sha256}`);
  }
  const dir = path.join(dataDir, file.folder);
  await mkdir(dir, { recursive: true });
  const at = path.join(dir, file.name);
  await writeFile(`${at}.part`, bytes);
  await rename(`${at}.part`, at);
}

/**
 * Fetch a season's files that are not yet in `dataDir` with their pinned digests, from the archive.org image or, with
 * `image`, a local file of the same CD; `log` gets a line per step.
 */
export async function syncSeason(season, dataDir, image, log) {
  const { cd } = season;
  const wanted = [];
  for (const file of season.files) if (!(await present(dataDir, file))) wanted.push(file);
  if (!wanted.length) {
    log(`${season.id}: all ${season.files.length} files present in data-src/${season.files[0].folder}/`);
    return;
  }
  const source = image ? await localImage(image) : archiveImage(cd, log);
  try {
    log(`${season.id}: ${wanted.length} of ${season.files.length} files from ${source.where}`);
    const layout = await layoutOf(source.readRange, cd, !!image);
    const { primary, joliet } = await readVolume(source.readRange, layout);
    if (primary.volumeId !== cd.volume || primary.created !== cd.created) {
      throw new Error(`The image is volume ${primary.volumeId} of ${primary.created}, not the pinned ${cd.volume} of ${cd.created}`);
    }
    if (cd.cabinet) {
      const { header: headerName, headerLba, headerSha256, cabinet: cabinetName, cabinetLba } = cd.cabinet;
      const [headerEntry, cabinetEntry] = [await findEntry(source.readRange, layout, primary, headerName), await findEntry(source.readRange, layout, primary, cabinetName)];
      if (!headerEntry || !cabinetEntry) throw new Error(`The CD has no ${headerEntry ? cabinetName : headerName}`);
      if (headerEntry.lba !== headerLba || cabinetEntry.lba !== cabinetLba) {
        throw new Error(`${headerName} and ${cabinetName} start at sectors ${headerEntry.lba} and ${cabinetEntry.lba}, not the pinned ${headerLba} and ${cabinetLba}`);
      }
      const headerBytes = await readEntry(source.readRange, layout, headerEntry);
      if (sha256(headerBytes) !== headerSha256) throw new Error(`${headerName} has SHA-256 ${sha256(headerBytes)}, not the pinned ${headerSha256}`);
      const header = readIs5Header(headerBytes);
      // Every wanted table as the header records it, before any of their data is read.
      const entries = wanted.map(file => {
        const entry = is5File(header, file.name);
        if (entry.md5 !== file.md5 || entry.expanded !== file.bytes) {
          throw new Error(`${headerName} gives ${file.name} ${entry.expanded} bytes, MD5 ${entry.md5}; the manifest pins ${file.bytes}, ${file.md5}`);
        }
        if (entry.dataOffset + entry.compressed > cabinetEntry.size) throw new Error(`${file.name}'s data runs past ${cabinetName}`);
        return entry;
      });
      for (const [i, file] of wanted.entries()) {
        const entry = entries[i];
        const raw = await readEntry(source.readRange, layout, cabinetEntry, entry.dataOffset, entry.compressed);
        await store(dataDir, file, expandIs5File(entry, raw));
        log(`  ${file.name}: ${entry.compressed} bytes compressed, ${file.bytes} expanded, MD5 and SHA-256 as pinned`);
      }
    } else if (cd.folder) {
      const volume = cd.joliet ? joliet : primary;
      if (!volume) throw new Error('The image has no Joliet volume descriptor, whose long names the folder needs');
      const folder = await findEntry(source.readRange, layout, volume, cd.folder, { joliet: !!cd.joliet });
      if (!folder?.directory) throw new Error(`The CD has no folder ${cd.folder}`);
      const entries = await readDirectory(source.readRange, layout, folder, { joliet: !!cd.joliet });
      for (const file of wanted) {
        const entry = entries.find(e => !e.directory && e.name.toLowerCase() === file.name.toLowerCase());
        if (!entry) throw new Error(`${cd.folder} has no ${file.name}`);
        await store(dataDir, file, await readEntry(source.readRange, layout, entry));
        log(`  ${file.name}: ${file.bytes} bytes, SHA-256 as pinned`);
      }
    } else {
      throw new Error(`${season.id}'s cd block names neither a cabinet nor a folder`);
    }
  } finally {
    log(`  ${await source.done()}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifest = JSON.parse(await readFile(path.join(root, 'scripts/data/retro-seasons.json'), 'utf8'));
  const dataDir = path.resolve(args.data ?? path.join(root, 'data-src'));
  const seasons = manifest.seasons.filter(season => season.cd && (!args.only || args.only.includes(season.id)));
  const unknown = args.only?.filter(id => !seasons.some(season => season.id === id));
  if (unknown?.length) throw new Error(`No season with a cd block: ${unknown.join(', ')}`);
  for (const season of seasons) await syncSeason(season, dataDir, args.image ? path.resolve(args.image) : null, console.log);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(`sync-retro-cds: ${error.message}`);
    process.exitCode = 1;
  });
}
