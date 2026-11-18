// The players who set the EuroLeague's level (docs/design/euroleague.md, "The ratings"): those on the built-in season's
// rosters with a EuroLeague game in the window whom NBA 2K24–2K27 also rated, each at his latest edition's rating, from
// 2K Archive's copy pinned in scripts/data/nba-seasons.json (data-src/bball-2karchive/, which npm run build:nba-seasons
// reads too). Written to scripts/data/euroleague-anchors.json, which scripts/build-euroleague.mjs reads, so the EuroLeague
// builds without the cache; scripts/lib/euroleague-ratings.mjs `anchorsOf` is the rule.
//
// Usage: node scripts/build-euroleague-anchors.mjs [--check]
//   --check  derive the list again and compare it with the committed file byte for byte; write nothing
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { builtInPlayers } from './lib/euroleague.mjs';
import { ANCHOR_EDITIONS, NAMESAKES, anchorsOf } from './lib/euroleague-ratings.mjs';
import { playerRecords, readSnapshots } from './lib/euroleague-seasons.mjs';
import { readArchive } from './lib/nba-seasons.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const output = path.join(root, 'scripts/data/euroleague-anchors.json');
const check = process.argv.includes('--check');
const unknown = process.argv.slice(2).filter(arg => arg !== '--check');
if (unknown.length) throw new Error(`Unknown option ${unknown[0]}`);

/** The anchors file's text: the rule's sources, then one anchor a line, [EuroLeague code, name, NBA 2K year, rating]. */
function anchorsText(anchors, manifest) {
  const source = { name: manifest.source.name, url: manifest.source.url, sha256: manifest.source.sha256, editions: ANCHOR_EDITIONS };
  const note = 'The EuroLeague players NBA 2K also rates, who set the EuroLeague\'s level (scripts/lib/euroleague-ratings.mjs LEVEL): every player on '
    + 'the built-in season\'s rosters with a EuroLeague game in the window whose name NBA 2K24–2K27 rates, at the latest of those editions\' '
    + 'ratings (2K Archive\'s copy, pinned by SHA-256), a namesake left out. Written by scripts/build-euroleague-anchors.mjs.';
  return `{\n"note": ${JSON.stringify(note)},\n"source": ${JSON.stringify(source)},\n"namesakes": ${JSON.stringify(NAMESAKES)},\n"anchors": [\n${
    anchors.map(a => JSON.stringify([a.code, a.name, a.edition, a.nba2k])).join(',\n')}\n]\n}\n`;
}

const snapshot = JSON.parse(await readFile(path.join(root, 'scripts/data/euroleague-2026-27.json'), 'utf8'));
const identity = JSON.parse(await readFile(path.join(root, 'scripts/data/euroleague-teams.json'), 'utf8'));
const { manifest, years } = await readArchive(root);
const players = builtInPlayers(snapshot, identity.names, playerRecords(readSnapshots(root)))
  .map(player => ({ code: player.code, name: player.name, played: player.games > 0 }));
const anchors = anchorsOf(players, years);
const text = anchorsText(anchors, manifest);
const mean = anchors.reduce((sum, a) => sum + a.nba2k, 0) / anchors.length;
if (check) {
  const current = existsSync(output) ? (await readFile(output, 'utf8')).replace(/\r\n/g, '\n') : null;
  if (current !== text) {
    console.error(`differs: ${path.relative(root, output)}`);
    process.exit(1);
  }
  console.log(`Verified the ${anchors.length} EuroLeague anchors (NBA 2K ${mean.toFixed(2)} on average) byte for byte.`);
} else {
  await writeFile(output, text);
  console.log(`wrote ${path.relative(root, output)}: ${anchors.length} anchors, NBA 2K ${mean.toFixed(2)} on average`);
}
