// Build the computed national-team seasons, 1962/63 to 1992/93 between the computed World Cups (docs/design/football-years.md,
// "Computed national-team seasons"):
//
//   npm run build:national-team-seasons              writes public/football/nt-<year>.json for each season of
//                                                    scripts/data/national-team-seasons.json, their credits
//                                                    (public/football/ATTRIBUTION-national-teams.txt), src/data/footballSeasons.js
//                                                    and docs/design/football-national-team-seasons-audit.json
//   npm run build:national-team-seasons -- --check   builds and compares every output byte for byte, writes nothing
//
// Each season is built from the committed facts (scripts/data/national-team-seasons/, written by npm run
// sync:national-team-seasons from the pinned sources) and the manifest's constants alone
// (scripts/lib/national-team-seasons.mjs), so it rebuilds byte for byte offline. The listing also names the seasons the
// other builders write (npm run build:ea-seasons, build:retro-seasons and build:world-cup-seasons), read from their
// committed files.
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildNationalTeamSeason, nationalTeamsAttribution } from './lib/national-team-seasons.mjs';
import { committedSeasons, eaSeasonIds, footballSeasonsModule, retroSeasonIds, worldCupSeasonIds } from './lib/football-seasons-listing.mjs';

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
  const manifest = await read('scripts/data/national-team-seasons.json');
  const ea = await read('scripts/data/ea-seasons.json');
  const retro = await read('scripts/data/retro-seasons.json');
  const worldCup = await read('scripts/data/world-cup-seasons.json');
  const wikidata = await read('scripts/data/national-team-seasons/wikidata.json');
  const { seasons: elo } = await read('scripts/data/national-team-seasons/elo.json');
  const { years: votes } = await read('scripts/data/national-team-seasons/ballon-dor.json');
  const results = [];
  for (const season of manifest.seasons) {
    if (!elo[season.id]) throw new Error(`${season.id} has no Elo facts: run npm run sync:national-team-seasons`);
    const result = buildNationalTeamSeason({ wikidata, elo: elo[season.id], votes }, manifest, season);
    results.push(result);
    const { doc, audit } = result;
    const top = audit.nations.slice(0, 3).map(nation => `${nation.name} ${nation.T}`).join(', ');
    console.log(`${doc.id} ${doc.season}: ${doc.coverage.nations} nations (${doc.coverage.completeXIs} natural XIs), `
      + `${Object.keys(doc.identities || {}).length} identities, team share ${audit.teamShare}; ${top}; ${Math.round(Buffer.byteLength(result.text) / 1024)} KB`);
  }
  const publicDir = path.join(root, 'public/football');
  const listed = [...await committedSeasons(publicDir, eaSeasonIds(ea)), ...await committedSeasons(publicDir, retroSeasonIds(retro)),
    ...await committedSeasons(publicDir, worldCupSeasonIds(worldCup)), ...results.map(result => result.doc)];
  const audit = {
    generatedBy: 'scripts/build-national-team-seasons.mjs', retrieved: manifest.retrieved, decided: manifest.decided,
    elo: manifest.elo, strength: manifest.strength, xi: manifest.xi, profile: manifest.profile, selection: manifest.selection,
    wikidata: wikidata.audit, seasons: results.map(result => result.audit),
  };
  const outputs = new Map([
    ...results.map(({ doc, text }) => [path.join(publicDir, `${doc.id}.json`), text]),
    [path.join(publicDir, 'ATTRIBUTION-national-teams.txt'), nationalTeamsAttribution(manifest, results.map(result => result.doc))],
    [path.join(root, 'src/data/footballSeasons.js'), footballSeasonsModule(listed, { ea, retro, worldCup, nationalTeams: manifest })],
    [path.join(root, 'docs/design/football-national-team-seasons-audit.json'), `${JSON.stringify(audit, null, 2)}\n`],
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
  console.log(`Wrote ${results.length} seasons to public/football/, src/data/footballSeasons.js and docs/design/football-national-team-seasons-audit.json`);
}

main().catch(error => {
  console.error(`build-national-team-seasons: ${error.message}`);
  process.exitCode = 1;
});
