// Build the built-in football seasons before FIFA 05 (docs/design/football-years.md, "Seasons before FIFA 05"):
//
//   npm run build:retro-seasons                  writes public/football/<id>.json for each season of
//                                                scripts/data/retro-seasons.json, src/data/footballSeasons.js and
//                                                docs/design/football-retro-seasons-audit.json
//   npm run build:retro-seasons -- --check       builds and compares every output byte for byte, writes nothing
//   npm run build:retro-seasons -- --data=<dir>  the downloaded sources elsewhere (default data-src/)
//
// 2002/03 and 2001/02 are SI's own Championship Manager 01/02 databases (3.9.68 and 3.9.60) and 1998/99 SI's
// Championship Manager 3 data in the CM 01/02 format, all three read by the CM 01/02 builder
// (src/data/footballSetBuild.js) from the CM0102 Starter Kit's zips; 2000/01 and 1999/00 are SI's own CM 00/01 and CM
// 99/00 databases, whose files are the same tables, read by it from the files npm run sync:retro-cds takes from their
// retail CDs (reader 'tables'); 1997/98 is SI's Championship Manager 97/98 database as extracted to JSON
// (scripts/lib/cm9798.mjs); 1996/97, 1995/96 and 1994/95 are Sensible World of Soccer's own team files, nations and
// clubs (scripts/lib/swos-files.mjs, scripts/lib/swos.mjs); 1993/94 and 1989/90 are the Starter Kit's two fan-made
// databases (Cam F's; Simon Treanor's, nations only). Every source is pinned by SHA-256 in the manifest and the build
// stops on any other file, so every season rebuilds byte for byte. Their Europe maps come from npm run
// build:europe-maps, as the EA seasons' do.
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildRetroSeason } from './lib/retro-season-builds.mjs';
import { committedSeasons, eaSeasonIds, footballSeasonsModule, nationalTeamSeasonIds, worldCupSeasonIds } from './lib/football-seasons-listing.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function parseArgs(argv) {
  const args = {};
  for (const arg of argv) {
    const [, key, value] = /^--([a-z]+)(?:=(.*))?$/s.exec(arg) || [];
    if (key === 'check' && value === undefined) args.check = true;
    else if (key === 'data' && value) args.data = value;
    else throw new Error(`Unknown option ${arg}`);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifest = JSON.parse(await readFile(path.join(root, 'scripts/data/retro-seasons.json'), 'utf8'));
  const ea = JSON.parse(await readFile(path.join(root, 'scripts/data/ea-seasons.json'), 'utf8'));
  const dataDir = path.resolve(args.data ?? path.join(root, 'data-src'));
  const results = [];
  for (const season of manifest.seasons) {
    // A season's reader, where its kind is read from more than one kind of source (CM: a zip, or a CD's tables) or
    // from one of its own (SWOS: the game's team files).
    // A season read later than the others names its own day.
    const result = await buildRetroSeason(season, dataDir, season.retrieved ?? manifest.retrieved);
    const { doc } = result;
    if (doc.id !== season.id || doc.season !== season.season || doc.local !== false) {
      throw new Error(`${season.id} built as ${doc.id} ${doc.season}${doc.local === false ? '' : ', local'}: the manifest and the source disagree`);
    }
    results.push(result);
    const { coverage } = doc;
    console.log(`${doc.id} ${doc.season} ${doc.label}: ${coverage.completeXIs}/${Object.keys(doc.nations).length} full XIs, `
      + `${coverage.nations} nations with players, ${coverage.clubs} clubs, ${coverage.players} players, ${Math.round(Buffer.byteLength(result.text) / 1024)} KB`);
    for (const warning of result.warnings) console.log(`  warning: ${warning}`);
  }
  const worldCup = JSON.parse(await readFile(path.join(root, 'scripts/data/world-cup-seasons.json'), 'utf8'));
  const nationalTeams = JSON.parse(await readFile(path.join(root, 'scripts/data/national-team-seasons.json'), 'utf8'));
  const listed = [...await committedSeasons(path.join(root, 'public/football'), eaSeasonIds(ea)), ...results.map(result => result.doc),
    ...await committedSeasons(path.join(root, 'public/football'), worldCupSeasonIds(worldCup)),
    ...await committedSeasons(path.join(root, 'public/football'), nationalTeamSeasonIds(nationalTeams))];
  const audit = {
    generatedBy: 'scripts/build-retro-seasons.mjs', retrieved: manifest.retrieved,
    seasons: results.map(({ doc, audit: own }, i) => ({ ...manifest.seasons[i], version: doc.version, coverage: doc.coverage, audit: own })),
  };
  const outputs = new Map([
    ...results.map(({ doc, text }) => [path.join(root, 'public/football', `${doc.id}.json`), text]),
    [path.join(root, 'src/data/footballSeasons.js'), footballSeasonsModule(listed, { ea, retro: manifest, worldCup, nationalTeams })],
    [path.join(root, 'docs/design/football-retro-seasons-audit.json'), `${JSON.stringify(audit, null, 2)}\n`],
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
  console.log(`Wrote ${results.length} seasons to public/football/, src/data/footballSeasons.js and docs/design/football-retro-seasons-audit.json`);
}

main().catch(error => {
  console.error(`build-retro-seasons: ${error.message}`);
  process.exitCode = 1;
});
