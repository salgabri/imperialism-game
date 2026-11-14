// Build the computed women's seasons before EA rated women (docs/design/womens-football.md, "Computed seasons"):
//
//   npm run build:womens-tournament-seasons              writes public/womens-football/wwc-<year>.json and wol-<year>.json
//                                                        for each season of scripts/data/womens-tournament-seasons.json,
//                                                        their credits (public/womens-football/ATTRIBUTION-computed.txt),
//                                                        src/data/womensFootballSeasons.js and
//                                                        docs/design/womens-tournament-seasons-audit.json
//   npm run build:womens-tournament-seasons -- --check   builds and compares every output byte for byte, writes nothing
//
// Each season is built from its committed facts (scripts/data/womens-tournament-seasons/<id>.json, written by npm run
// sync:womens-tournament-seasons from the pinned sources) and the manifest's constants alone
// (scripts/lib/womens-tournament-seasons.mjs), so it rebuilds byte for byte offline. The listing also names EA's women's
// seasons (npm run build:womens-seasons), read from their committed files.
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { attributionText, buildWomensTournamentSeason } from './lib/womens-tournament-seasons.mjs';
import { committedSeasons } from './lib/football-seasons-listing.mjs';
import { eaWomensSeasonIds, womensSeasonsModule } from './lib/womens-seasons-listing.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function parseArgs(argv) {
  const args = {};
  for (const arg of argv) {
    if (arg === '--check') args.check = true;
    else throw new Error(`Unknown option ${arg}`);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const read = async file => JSON.parse(await readFile(path.join(root, file), 'utf8'));
  const manifest = await read('scripts/data/womens-tournament-seasons.json');
  const ea = await read('scripts/data/ea-women-seasons.json');
  const results = [];
  for (const season of manifest.seasons) {
    const facts = await read(`scripts/data/womens-tournament-seasons/${season.id}.json`);
    const result = buildWomensTournamentSeason(facts, manifest);
    results.push(result);
    const { doc, audit } = result;
    const top = audit.nations.slice(0, 3).map(nation => `${nation.name} ${nation.T}`).join(', ');
    console.log(`${doc.id} ${doc.season} ${doc.label}: ${doc.coverage.nations} nations (${doc.coverage.completeXIs} natural XIs), `
      + `team share ${audit.teamShare}; ${top}; ${Math.round(Buffer.byteLength(result.text) / 1024)} KB`);
  }
  const listed = [...await committedSeasons(path.join(root, 'public/womens-football'), eaWomensSeasonIds(ea)), ...results.map(result => result.doc)];
  const crossCheck = await read('scripts/data/womens-tournament-seasons/elo-crosscheck.json');
  const audit = {
    generatedBy: 'scripts/build-womens-tournament-seasons.mjs', retrieved: manifest.retrieved, decided: manifest.decided,
    elo: manifest.elo, strength: manifest.strength, xi: manifest.xi, profile: manifest.profile, awards: manifest.awards,
    crossCheck: { mean: crossCheck.mean, seasons: crossCheck.seasons }, seasons: results.map(result => result.audit),
  };
  const outputs = new Map([
    ...results.map(({ doc, text }) => [path.join(root, 'public/womens-football', `${doc.id}.json`), text]),
    [path.join(root, 'public/womens-football/ATTRIBUTION-computed.txt'), attributionText(manifest, results.map(result => result.doc))],
    [path.join(root, 'src/data/womensFootballSeasons.js'), womensSeasonsModule(listed, { ea, computed: manifest })],
    [path.join(root, 'docs/design/womens-tournament-seasons-audit.json'), `${JSON.stringify(audit, null, 2)}\n`],
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
  await mkdir(path.join(root, 'public/womens-football'), { recursive: true });
  for (const [file, text] of outputs) await writeFile(file, text);
  console.log(`Wrote ${results.length} seasons to public/womens-football/, src/data/womensFootballSeasons.js and docs/design/womens-tournament-seasons-audit.json`);
}

main().catch(error => {
  console.error(`build-womens-tournament-seasons: ${error.message}`);
  process.exitCode = 1;
});
