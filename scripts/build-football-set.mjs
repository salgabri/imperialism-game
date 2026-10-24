// Build one football data set from a Championship Manager 01/02 Data folder the user has
// downloaded (docs/design/football-years.md). Nothing it reads or writes is committed:
// data-src/ and public/football/ stay local until the database authors allow
// redistribution (docs/design/football-year-permissions.md).
//
// Usage:
//   npm run build:football-set -- --cm0102=data-src/cm0102/<folder> [--out=public/football] [--check] [--allow-unmapped]
//     --cm0102          the Data folder (index.dat, staff.dat, ...) or the folder holding it
//     --out             where data sets are written (default public/football)
//     --check           identify, read and build, and report, but write nothing
//     --allow-unmapped  leave out the players of nations scripts/data/cm0102-nations.json does not know,
//                       instead of stopping
//   A database that is not in scripts/data/cm0102-databases.json must be named:
//     --label=<May 2026> --released=<yyyy-mm> --url=<forum topic> --dob-shift=<years>   (required)
//     --id=<cm0102-yyyy-mm[-variant]> --season=<yyyy/yy> --provider=<name>             (optional)
//
// Outputs: <out>/<id>.json (format 1), <out>/<id>.audit.json (coverage, unmapped nations, drops,
// warnings, the birth-shift check) and <out>/index.json (every data set present, newest first).
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildFootballIndex, buildFootballSet, SET_ID } from './lib/football-set.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SWITCHES = ['check', 'allow-unmapped'];
const VALUES = ['cm0102', 'out', 'id', 'label', 'provider', 'season', 'released', 'url', 'dob-shift'];

function parseArgs(argv) {
  const args = {};
  for (const arg of argv) {
    const [, key, value] = /^--([a-z0-9-]+)(?:=(.*))?$/s.exec(arg) || [];
    if (SWITCHES.includes(key) && value === undefined) args[key] = true;
    else if (VALUES.includes(key) && value !== undefined) args[key] = value;
    else throw new Error(`Unknown option ${arg}${VALUES.includes(key) ? ` (use --${key}=...)` : ''}`);
  }
  if (!args.cm0102) throw new Error('Name the database folder: --cm0102=data-src/cm0102/<folder>');
  return args;
}

const entryNamed = async (dir, name) => (await readdir(dir, { withFileTypes: true })).find(e => e.name.toLowerCase() === name);

/** The folder holding index.dat: the one given, or a Data folder inside it (names in any case). */
async function dataFolder(dir) {
  if (!existsSync(dir)) throw new Error(`${dir} does not exist`);
  if ((await entryNamed(dir, 'index.dat'))?.isFile()) return dir;
  const data = await entryNamed(dir, 'data');
  if (data?.isDirectory() && (await entryNamed(path.join(dir, data.name), 'index.dat'))?.isFile()) return path.join(dir, data.name);
  throw new Error(`No index.dat in ${dir} or in a Data folder inside it: --cm0102 must point at a CM 01/02 Data folder`);
}

/** Every .dat file of the folder as { lowercase name: bytes } (a Buffer is a Uint8Array). */
async function readDataFolder(dir) {
  const files = {};
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.toLowerCase().endsWith('.dat')) files[entry.name.toLowerCase()] = await readFile(path.join(dir, entry.name));
  }
  return files;
}

/** The data sets already in `dir`, except `id`, parsed and checked file by file so a bad one is named. */
async function otherSets(dir, id) {
  if (!existsSync(dir)) return [];
  const docs = [];
  for (const name of (await readdir(dir)).sort()) {
    const setId = name.endsWith('.json') && !name.endsWith('.audit.json') ? name.slice(0, -5) : null;
    if (!setId || !SET_ID.test(setId) || setId === id) continue;
    const file = path.join(dir, name);
    try {
      const doc = JSON.parse(await readFile(file, 'utf8'));
      if (doc?.id !== setId) throw new Error(`it holds ${JSON.stringify(doc?.id)}`);
      buildFootballIndex([doc]);
      docs.push(doc);
    } catch (e) {
      throw new Error(`${file} is not a data set this builder wrote (${e.message}); rebuild or remove it, then run again`);
    }
  }
  return docs;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const folder = await dataFolder(path.resolve(args.cm0102));
  const manifest = async file => JSON.parse(await readFile(path.join(root, 'scripts/data', file), 'utf8'));
  const result = buildFootballSet(await readDataFolder(folder), {
    databases: (await manifest('cm0102-databases.json')).databases,
    nationMap: await manifest('cm0102-nations.json'),
    federations: await manifest('football-federations.json'),
    identity: { id: args.id, label: args.label, provider: args.provider, season: args.season, released: args.released, url: args.url, dobShift: args['dob-shift'] },
    allowUnmapped: !!args['allow-unmapped'],
  });
  console.log(`Read ${folder}`);
  for (const line of result.summary) console.log(line);
  for (const warning of result.warnings) console.log(`warning: ${warning}`);

  const outDir = path.resolve(args.out ?? path.join(root, 'public/football'));
  const { id } = result.doc;
  const setFile = path.join(outDir, `${id}.json`);
  const shown = file => (path.relative(process.cwd(), file).startsWith('..') ? file : path.relative(process.cwd(), file));
  if (args.check) {
    const previous = existsSync(setFile) ? await readFile(setFile, 'utf8') : null;
    console.log(`Check only, nothing written: ${shown(setFile)} ${previous == null ? 'would be new' : previous === result.text ? 'is up to date' : 'would change'}`);
    return;
  }
  // The index is built, and every other set in the folder checked, before anything is written.
  const index = buildFootballIndex([...await otherSets(outDir, id), result.doc]);
  await mkdir(outDir, { recursive: true });
  await writeFile(setFile, result.text);
  await writeFile(path.join(outDir, `${id}.audit.json`), `${JSON.stringify(result.audit, null, 2)}\n`);
  await writeFile(path.join(outDir, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
  console.log(`Wrote ${shown(setFile)} (${Math.round(Buffer.byteLength(result.text) / 1024)} KB, ${result.doc.version}), its audit and index.json (${index.sets.length} data set${index.sets.length === 1 ? '' : 's'})`);
}

main().catch(error => {
  console.error(`build-football-set: ${error.message}`);
  process.exitCode = 1;
});
