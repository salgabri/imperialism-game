// Build the computed World Cup seasons, 1961/62 to 1993/94 (docs/design/football-years.md, "Computed World Cup seasons"):
//
//   npm run build:world-cup-seasons              writes public/football/wc-<year>.json for each season of
//                                                scripts/data/world-cup-seasons.json, their credits
//                                                (public/football/ATTRIBUTION-world-cup.txt), src/data/footballSeasons.js
//                                                and docs/design/football-world-cup-seasons-audit.json
//   npm run build:world-cup-seasons -- --check   builds and compares every output byte for byte, writes nothing
//
// Each season is built from its committed facts (scripts/data/world-cup-seasons/<id>.json, written by npm run
// sync:world-cup-seasons from the pinned sources) and the manifest's constants alone (scripts/lib/world-cup-seasons.mjs),
// so it rebuilds byte for byte offline. The listing also names the seasons the other two builders write (npm run
// build:ea-seasons and build:retro-seasons), read from their committed files.
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { attributionText, buildWorldCupSeason } from './lib/world-cup-seasons.mjs';
import { committedSeasons, eaSeasonIds, footballSeasonsModule, retroSeasonIds } from './lib/football-seasons-listing.mjs';

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
  const manifest = await read('scripts/data/world-cup-seasons.json');
  const ea = await read('scripts/data/ea-seasons.json');
  const retro = await read('scripts/data/retro-seasons.json');
  const results = [];
  for (const season of manifest.seasons) {
    const facts = await read(`scripts/data/world-cup-seasons/${season.id}.json`);
    const result = buildWorldCupSeason(facts, manifest);
    results.push(result);
    const { doc, audit } = result;
    const top = audit.nations.slice(0, 3).map(nation => `${nation.name} ${nation.T}`).join(', ');
    console.log(`${doc.id} ${doc.season} ${doc.label}: ${doc.coverage.nations} nations (${doc.coverage.completeXIs} natural XIs), `
      + `${Object.keys(doc.identities || {}).length} identities, team share ${audit.teamShare}; ${top}; ${Math.round(Buffer.byteLength(result.text) / 1024)} KB`
      + `${audit.dropped.length ? `; no team: ${audit.dropped.map(entry => entry.team).join(', ')}` : ''}`);
  }
  const listed = [...await committedSeasons(path.join(root, 'public/football'), eaSeasonIds(ea)),
    ...await committedSeasons(path.join(root, 'public/football'), retroSeasonIds(retro)), ...results.map(result => result.doc)];
  const crossCheck = await read('scripts/data/world-cup-seasons/elo-crosscheck.json');
  const audit = {
    generatedBy: 'scripts/build-world-cup-seasons.mjs', retrieved: manifest.retrieved, decided: manifest.decided,
    elo: manifest.elo, strength: manifest.strength, xi: manifest.xi, profile: manifest.profile, awards: manifest.awards,
    crossCheck: crossCheck.mean, seasons: results.map(result => result.audit),
  };
  const outputs = new Map([
    ...results.map(({ doc, text }) => [path.join(root, 'public/football', `${doc.id}.json`), text]),
    [path.join(root, 'public/football/ATTRIBUTION-world-cup.txt'), attributionText(manifest, results.map(result => result.doc))],
    [path.join(root, 'src/data/footballSeasons.js'), footballSeasonsModule(listed, { ea, retro, worldCup: manifest })],
    [path.join(root, 'docs/design/football-world-cup-seasons-audit.json'), `${JSON.stringify(audit, null, 2)}\n`],
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
  console.log(`Wrote ${results.length} seasons to public/football/, src/data/footballSeasons.js and docs/design/football-world-cup-seasons-audit.json`);
}

main().catch(error => {
  console.error(`build-world-cup-seasons: ${error.message}`);
  process.exitCode = 1;
});
