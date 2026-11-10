// Reduce the Reep identity register to scripts/data/reep-bridge.json, the person keys of the built-in football squads
// (scripts/lib/reep-bridge.mjs; docs/design/football-squad-identity.md).
//
//   npm run sync:reep-bridge                         reads data-src/reep/bridges-filtered.csv, writes the bridge
//   npm run sync:reep-bridge -- --check              rebuilds in memory and exits 1 if the committed file differs
//   npm run sync:reep-bridge -- --input=<file>       Reep's full bridges.csv or bridges.csv.gz reduces the same
//   npm run sync:reep-bridge -- --release=<tag>      the release tag, when data-src/reep/manifest.json is absent
//
// Nothing is downloaded here. The input is Reep v1's bridges.csv (https://reep.football/data, CC0) of the release the
// committed bridge names, saved in the ignored data-src/reep/ with that release's manifest.json; the 2026-10-18.1 copy
// is cut to the eafc, fm, transfermarkt, fifa, sofifa and national_football_teams providers, and the bridge records its
// SHA-256. --check stops on any other file.
import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { loadSourceRecords, readReepBridges, reduceBridges, serializeBridge } from './lib/reep-bridge.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const BRIDGE_FILE = 'scripts/data/reep-bridge.json';
const DEFAULT_INPUT = 'data-src/reep/bridges-filtered.csv';
const DEFAULT_MANIFEST = 'data-src/reep/manifest.json';
const CUT = 'eafc, fm, transfermarkt, fifa, sofifa and national_football_teams providers of bridges.csv';

function parseArgs(argv) {
  const args = {};
  for (const arg of argv) {
    const [, key, value] = /^--([a-z]+)(?:=(.*))?$/s.exec(arg) || [];
    if (key === 'check' && value === undefined) args.check = true;
    else if ((key === 'input' || key === 'release') && value) args[key] = value;
    else throw new Error(`Unknown option ${arg} (use --check, --input=<file>, --release=<tag>)`);
  }
  return args;
}

const fileDigest = file => new Promise((resolve, reject) => {
  const hash = createHash('sha256');
  let bytes = 0;
  createReadStream(file).on('data', chunk => { hash.update(chunk); bytes += chunk.length; })
    .on('error', reject).on('end', () => resolve({ sha256: hash.digest('hex'), bytes }));
});

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const inputName = args.input ?? DEFAULT_INPUT, input = path.resolve(root, inputName);
  if (!existsSync(input)) throw new Error(`${inputName} is missing: save Reep's bridges.csv(.gz) of the release ${BRIDGE_FILE} names there (https://reep.football/data)`);
  let { release } = args;
  if (!release) {
    const manifest = path.join(root, DEFAULT_MANIFEST);
    if (!existsSync(manifest)) throw new Error(`No Reep release tag: pass --release=TAG or keep the release manifest at ${DEFAULT_MANIFEST}`);
    release = JSON.parse(await readFile(manifest, 'utf8')).release_tag;
  }
  if (!/^\d{4}-\d{2}-\d{2}\.\d+$/.test(release || '')) throw new Error(`Invalid Reep release tag ${release}`);
  const output = path.join(root, BRIDGE_FILE);
  const digest = await fileDigest(input);
  if (args.check && existsSync(output)) {
    const pinned = JSON.parse(await readFile(output, 'utf8')).source?.input;
    if (pinned && (pinned.sha256 !== digest.sha256 || pinned.bytes !== digest.bytes)) {
      throw new Error(`${inputName} is not the file ${BRIDGE_FILE} was reduced from (SHA-256 ${digest.sha256}, ${digest.bytes} bytes; pinned ${pinned.sha256}, ${pinned.bytes})`);
    }
  }
  const [reep, sources] = await Promise.all([readReepBridges(input), loadSourceRecords(root)]);
  const bridge = reduceBridges(reep, sources, { release, input: { file: path.basename(input), cut: CUT, ...digest } });
  const text = serializeBridge(bridge);
  console.log(`Reep ${release}: ${bridge.counts.persons} persons (${bridge.counts.eaIds} EA, ${bridge.counts.fmIds} FM ids; ${bridge.counts.pairs} EA–FM pairs) from ${bridge.counts.playerBridges} eafc/fm player bridges in ${bridge.counts.bridgeRows} rows.`);
  for (const [file, row] of Object.entries(bridge.coverage)) {
    if (typeof row === 'object') console.log(`  ${file}: ${row.linked}/${row.records} records (${row.percent}%)`);
  }
  console.log(`  Built-in season (EA FC 27 + FM 26): ${bridge.coverage.builtInPairs} persons with both records.`);
  for (const link of bridge.rejected) console.log(`  Rejected ${link.reep} EA ${link.ea.join(',') || '-'} FM ${link.fm.join(',') || '-'}: ${link.reason}`);
  if (args.check) {
    const current = existsSync(output) ? await readFile(output, 'utf8') : null;
    if (current !== text) { console.error(`${BRIDGE_FILE} is stale; run npm run sync:reep-bridge`); process.exitCode = 1; }
    else console.log(`${BRIDGE_FILE} is current.`);
  } else {
    await writeFile(output, text);
    console.log(`Wrote ${BRIDGE_FILE} (${(Buffer.byteLength(text) / 1024).toFixed(0)} kB).`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) await main();
