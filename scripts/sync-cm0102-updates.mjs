// The CM 01/02 Update Team's databases the earlier seasons' country maps read (docs/design/domestic-campaigns.md,
// "Earlier seasons"; shipped by the user's choice of 2026-11-17, docs/design/football-year-permissions.md): the eleven
// Data tables the CM 01/02 builder reads, fetched into the gitignored data-src/cm0102/<release id>/Data/.
//
//   node scripts/sync-cm0102-updates.mjs                        every release of scripts/data/cm0102-updates.json not yet present
//   node scripts/sync-cm0102-updates.mjs --only=cm0102-2025-12  these releases
//   node scripts/sync-cm0102-updates.mjs --zip=<file>           a release the user downloaded (a .zip), named by its tables' sizes
//   node scripts/sync-cm0102-updates.mjs --pin                  record the SHA-256 of tables the manifest has none for yet
//   node scripts/sync-cm0102-updates.mjs --data=<dir>           another data-src
//
// A release on archive.org is read by HTTP range requests on its .zip, at least a second apart: the end record and the
// central directory, then each table's local header and compressed bytes, inflated and checked against the central
// directory's size and CRC-32 and the manifest's size and SHA-256 before it is written. No executable and no whole zip is
// downloaded, and nothing is run. archive.org's robots.txt (read 2026-11-17) disallows only /control/ and /report/; the
// requests go through scripts/lib/polite-fetch.mjs. A release the forum's login keeps from scripts (most of them) is read
// from the .zip the user downloaded, the same way, and named by its club.dat and staff.dat sizes
// (src/data/cm0102Releases.js). A table already present with its pinned digest is not fetched again.
import { existsSync } from 'node:fs';
import { mkdir, open, readFile, rename, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { crc32, inflateRawSync } from 'node:zlib';
import path from 'node:path';
import { CM0102_RELEASES } from '../src/data/cm0102Releases.js';
import { politeFetch } from './lib/polite-fetch.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const manifestFile = path.join(root, 'scripts/data/cm0102-updates.json');
const GAP_MS = 1000;
/** The tables the CM 01/02 builder reads (src/data/footballSetBuild.js). */
export const TABLES = Object.freeze(['club.dat', 'club_comp.dat', 'common_names.dat', 'continent.dat', 'first_names.dat', 'index.dat',
  'nat_club.dat', 'nation.dat', 'nation_comp.dat', 'second_names.dat', 'staff.dat']);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function parseArgs(argv) {
  const args = {};
  for (const arg of argv) {
    const [, key, value] = /^--([a-z]+)(?:=(.*))?$/s.exec(arg) || [];
    if (key === 'only' && value) args.only = value.split(',');
    else if (key === 'zip' && value) args.zip = value;
    else if (key === 'data' && value) args.data = value;
    else if (key === 'pin' && value === undefined) args.pin = true;
    else throw new Error(`Unknown option ${arg}`);
  }
  return args;
}

/** A .zip read by ranges: on archive.org (`url`, `bytes` its pinned size), at least GAP_MS apart, or a local file. */
function zipSource({ url, bytes, file }) {
  let last = 0, requests = 0, received = 0;
  if (file) {
    const handle = open(file, 'r');
    return {
      where: file,
      readRange: async (start, end) => {
        const buffer = Buffer.alloc(end - start);
        await (await handle).read(buffer, 0, end - start, start);
        return buffer;
      },
      size: async () => (await (await handle).stat()).size,
      done: async () => { await (await handle).close(); return 'read locally'; },
    };
  }
  return {
    where: url,
    readRange: async (start, end) => {
      const wait = last + GAP_MS - Date.now();
      if (wait > 0) await sleep(wait);
      last = Date.now();
      const response = await politeFetch(url, { headers: { Range: `bytes=${start}-${end - 1}` }, redirect: 'follow' });
      if (response.status !== 206) {
        await response.body?.cancel();
        throw new Error(`HTTP ${response.status} for bytes ${start}-${end - 1} of ${url}`);
      }
      const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range') || '');
      if (!range || Number(range[1]) !== start || Number(range[2]) !== end - 1 || Number(range[3]) !== bytes) {
        throw new Error(`Content-Range ${response.headers.get('content-range')} is not bytes ${start}-${end - 1}/${bytes}: not the pinned zip`);
      }
      const body = Buffer.from(await response.arrayBuffer());
      requests++;
      received += body.length;
      return body;
    },
    size: async () => bytes,
    done: async () => `${requests} range requests, ${(received / 1048576).toFixed(2)} MB`,
  };
}

/** The zip's entries from its end record and central directory: `{ name, method, crc, compressed, size, local }`. */
async function zipEntries(source) {
  const total = await source.size();
  const tailStart = Math.max(0, total - 65557);
  const tail = await source.readRange(tailStart, total);
  const end = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0) throw new Error(`${source.where} has no zip end record`);
  const cdSize = tail.readUInt32LE(end + 12), cdOffset = tail.readUInt32LE(end + 16);
  if (cdOffset === 0xffffffff) throw new Error(`${source.where} is a Zip64 archive, which this reader does not read`);
  const cd = cdOffset >= tailStart ? tail.subarray(cdOffset - tailStart, cdOffset - tailStart + cdSize) : await source.readRange(cdOffset, cdOffset + cdSize);
  const entries = [];
  for (let at = 0; at + 46 <= cd.length && cd.readUInt32LE(at) === 0x02014b50;) {
    const n = cd.readUInt16LE(at + 28), e = cd.readUInt16LE(at + 30), c = cd.readUInt16LE(at + 32);
    entries.push({ name: cd.subarray(at + 46, at + 46 + n).toString('utf8'), method: cd.readUInt16LE(at + 10), crc: cd.readUInt32LE(at + 16),
      compressed: cd.readUInt32LE(at + 20), size: cd.readUInt32LE(at + 24), local: cd.readUInt32LE(at + 42) });
    at += 46 + n + e + c;
  }
  return entries;
}

/** One entry's bytes: its local header, then its data, inflated and checked against the central directory. */
async function readZipEntry(source, entry) {
  const header = await source.readRange(entry.local, entry.local + 30);
  if (header.readUInt32LE(0) !== 0x04034b50) throw new Error(`${entry.name} has no local header at ${entry.local}`);
  const start = entry.local + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
  const raw = await source.readRange(start, start + entry.compressed);
  const bytes = entry.method === 0 ? raw : entry.method === 8 ? inflateRawSync(raw) : null;
  if (!bytes) throw new Error(`${entry.name} uses zip method ${entry.method}, which this reader does not read`);
  if (bytes.length !== entry.size || crc32(bytes) !== entry.crc) throw new Error(`${entry.name} does not inflate to its recorded size and CRC-32`);
  return bytes;
}

/** The release a database is, by its club.dat and staff.dat sizes (src/data/cm0102Releases.js), or null. */
export function releaseOf(clubBytes, staffBytes) {
  return CM0102_RELEASES.find(release => release.signatures.some(sig => sig.club === clubBytes && sig.staff === staffBytes)) ?? null;
}

/** The Data folder's tables in a zip: each of TABLES under one folder, by name whatever its case. */
function tablesIn(entries, where) {
  const byFolder = new Map();
  for (const entry of entries) {
    const m = /^(.*\/)?([^/]+)$/.exec(entry.name);
    if (!m) continue; // a folder's own entry ("Data/")
    const name = m[2].toLowerCase();
    if (!TABLES.includes(name)) continue;
    const folder = m[1] ?? '';
    (byFolder.get(folder) || byFolder.set(folder, new Map()).get(folder)).set(name, entry);
  }
  const complete = [...byFolder].filter(([, tables]) => TABLES.every(name => tables.has(name)));
  if (complete.length !== 1) throw new Error(`${where} has ${complete.length} folders with all eleven tables, not one`);
  return { folder: complete[0][0], tables: complete[0][1] };
}

async function present(dataDir, id, file) {
  const at = path.join(dataDir, 'cm0102', id, 'Data', file.name);
  if (!existsSync(at)) return false;
  const bytes = await readFile(at);
  return bytes.length === file.bytes && (!file.sha256 || sha256(bytes) === file.sha256);
}

async function store(dataDir, id, name, bytes) {
  const dir = path.join(dataDir, 'cm0102', id, 'Data');
  await mkdir(dir, { recursive: true });
  const at = path.join(dir, name);
  await writeFile(`${at}.part`, bytes);
  await rename(`${at}.part`, at);
}

/**
 * Fetch one release's tables that are not yet present: from its archive.org zip, or from `zipFile`. With `pin`, a table
 * the manifest gives no SHA-256 yet is taken by its zip's CRC-32 and its digest recorded; otherwise it must match.
 * Returns the release's manifest entry, updated.
 */
async function syncRelease(entry, { dataDir, zipFile, pin, log }) {
  const source = zipSource(zipFile ? { file: zipFile } : entry.zip);
  try {
    const entries = await zipEntries(source);
    const { folder, tables } = tablesIn(entries, source.where);
    const release = releaseOf(tables.get('club.dat').size, tables.get('staff.dat').size);
    if (!release) throw new Error(`${source.where}: club.dat ${tables.get('club.dat').size} and staff.dat ${tables.get('staff.dat').size} bytes match no release of src/data/cm0102Releases.js`);
    if (entry && release.id !== entry.id) throw new Error(`${source.where} holds ${release.id}, not ${entry.id}`);
    const files = TABLES.map(name => entry?.files?.find(file => file.name === name) ?? { name, bytes: tables.get(name).size });
    log(`${release.id} (${release.season}, ${release.label}) from ${source.where}${folder ? `, ${folder}` : ''}`);
    for (const file of files) {
      if (await present(dataDir, release.id, file)) continue;
      const zipped = tables.get(file.name);
      if (zipped.size !== file.bytes) throw new Error(`${file.name} is ${zipped.size} bytes in the zip, not the pinned ${file.bytes}`);
      const bytes = await readZipEntry(source, zipped);
      const digest = sha256(bytes);
      if (file.sha256 && digest !== file.sha256) throw new Error(`${file.name} has SHA-256 ${digest}, not the pinned ${file.sha256}`);
      if (!file.sha256 && !pin) throw new Error(`${release.id}'s ${file.name} has no pinned SHA-256: run with --pin to record it`);
      file.sha256 = digest;
      await store(dataDir, release.id, file.name, bytes);
      log(`  ${file.name}: ${zipped.compressed} bytes zipped, ${bytes.length} inflated, SHA-256 ${digest.slice(0, 16)}…`);
    }
    return { id: release.id, season: release.season, ...(entry?.zip ? { zip: entry.zip } : { zip: { local: path.basename(zipFile) } }), files };
  } finally {
    log(`  ${await source.done()}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
  const dataDir = path.resolve(args.data ?? path.join(root, 'data-src'));
  const log = line => console.log(line);
  if (args.zip) {
    const synced = await syncRelease(null, { dataDir, zipFile: path.resolve(args.zip), pin: args.pin, log });
    const known = manifest.releases.find(entry => entry.id === synced.id);
    if (known) {
      for (const file of synced.files) {
        const pinned = known.files.find(f => f.name === file.name);
        if (pinned?.sha256 && pinned.sha256 !== file.sha256) throw new Error(`${file.name} differs from the pinned ${synced.id}`);
      }
    } else if (args.pin) manifest.releases.push(synced);
  } else {
    for (const entry of manifest.releases.filter(release => release.zip?.url && (!args.only || args.only.includes(release.id)))) {
      Object.assign(entry, await syncRelease(entry, { dataDir, pin: args.pin, log }));
    }
  }
  if (args.pin) {
    manifest.releases.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    await writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
    log(`Pinned ${path.relative(root, manifestFile)}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(`sync-cm0102-updates: ${error.message}`);
    process.exitCode = 1;
  });
}
