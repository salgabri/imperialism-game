// Build the built-in earlier football seasons from EA's FIFA 05 – EA FC 26 rosters (docs/design/football-years.md).
//
//   npm run build:ea-seasons                  writes public/football/ea-*.json, src/data/footballSeasons.js and
//                                             docs/design/football-seasons-audit.json
//   npm run build:ea-seasons -- --check       builds and compares every output byte for byte, writes nothing
//   npm run build:ea-seasons -- --data=<dir>  the downloaded sources elsewhere (default data-src/)
//   npm run build:ea-seasons -- --csv=<file>  the FIFA 15 – EA FC 24 export elsewhere (default <data>/ea-leone/male_players.csv)
//   npm run build:ea-seasons -- --cm-data=<dir>  the CM 01/02 Update Team databases elsewhere (default <data>; their
//                                             tables in <dir>/cm0102/<release>/Data/, scripts/sync-cm0102-updates.mjs)
//   npm run build:ea-seasons -- --candidates=<file>  also write every season's candidate clubs, by source, to <file>
//                                             (for scripts/data/club-strength-names.json)
//
// Each season's clubs are Europe's strongest TOP_CLUBS by results (scripts/data/club-strength.json,
// scripts/lib/europe-field.mjs): EA's where EA rates them, else the Update Team's database of the same season,
// its ratings put on EA's scale (scripts/lib/update-team-fill.mjs).
//
// EA FC 26 comes from the committed snapshot the built-in 2025/26 was built from (scripts/data/ea-fc26.csv), EA FC 25
// from an export of EA's ratings website joined to a later SoFIFA scrape (scripts/lib/ea-site-seasons.mjs), FIFA 15 –
// EA FC 24 from one Kaggle export, FIFA 07 – FIFA 14 from a FIFA Index mirror joined to a SoFIFA scrape
// (scripts/lib/ea-legacy-seasons.mjs), and FIFA 05 and FIFA 06 from that mirror with nationalities from the later
// editions and Wikidata (scripts/lib/ea-early-seasons.mjs). scripts/data/ea-seasons.json names every file with its
// SHA-256, and the build stops on any other file, so every season rebuilds byte for byte. The listing also names the
// seasons before FIFA 05 (npm run build:retro-seasons) and the computed World Cup seasons (npm run
// build:world-cup-seasons), read from their committed files.
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { committedSeasons, footballSeasonsModule, nationalTeamSeasonIds, retroSeasonIds, worldCupSeasonIds } from './lib/football-seasons-listing.mjs';
import { EARLY_EXTRA_FIELDS, buildEarlyEaSeason, nationalityEntries } from './lib/ea-early-seasons.mjs';
import { LEGACY_POSITIONS, readRatingsRows } from './lib/ea-legacy-seasons.mjs';
import { pinned, readExport, readLaterEditions } from './lib/ea-season-files.mjs';
import { buildClubSeasons } from './lib/ea-season-builds.mjs';
import { assembleEaSeason } from './lib/ea-seasons.mjs';
import { seasonField } from './lib/europe-field.mjs';
import { readUpdateTeam, updateTeamFill, updateTeamRelease } from './lib/update-team-fill.mjs';
import { seasonMapIds } from './lib/season-map-ids.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function parseArgs(argv) {
  const args = {};
  for (const arg of argv) {
    const [, key, value] = /^--([a-z]+)(?:=(.*))?$/s.exec(arg) || [];
    if (key === 'check' && value === undefined) args.check = true;
    else if ((key === 'csv' || key === 'data') && value) args[key] = value;
    else if (arg.startsWith('--cm-data=') && arg.length > '--cm-data='.length) args.cmData = arg.slice('--cm-data='.length);
    else if (key === 'candidates' && value) args.candidates = value;
    else throw new Error(`Unknown option ${arg}`);
  }
  return args;
}

/**
 * assembleEaSeason with each season's computed fills (scripts/lib/football-fills.mjs): the facts of
 * scripts/data/football-fills/ and its manifest, read once; and, for a season with clubs, its field by results
 * (`fields`, by season id).
 */
async function fillingAssemble(fields = new Map()) {
  const fills = JSON.parse(await readFile(path.join(root, 'scripts/data/football-fills.json'), 'utf8'));
  const wikidata = JSON.parse(await readFile(path.join(root, 'scripts/data/football-fills/wikidata.json'), 'utf8'));
  const { seasons: elo } = JSON.parse(await readFile(path.join(root, 'scripts/data/football-fills/elo.json'), 'utf8'));
  return (records, season) => {
    if (!elo[season.id]) throw new Error(`${season.id}: no Elo in scripts/data/football-fills/elo.json; add the season to scripts/data/football-fills.json and sync`);
    const field = season.noClubs ? null : fields.get(season.id) ?? null;
    if (!season.noClubs && !field) throw new Error(`${season.id}: no field by results`);
    return assembleEaSeason(records, { ...season, fill: { elo: elo[season.id], wikidata, manifest: fills }, field });
  };
}

/** The year each EA season with clubs ends in (FIFA 10 → 2010), by id. */
const seasonYears = manifest => new Map([...manifest.snapshots, ...manifest.site.editions, ...manifest.editions, ...manifest.legacy.editions]
  .map(edition => [edition.id, 2000 + edition.fifaVersion]));

/**
 * Every EA season's field by results (scripts/lib/europe-field.mjs seasonField), by id: the committed strengths and
 * names, and the Update Team's database of the season where it made one (2007/08 on) for the clubs EA lacks.
 */
async function seasonFields(manifest, cmDir, candidates = null) {
  const strengths = JSON.parse(await readFile(path.join(root, 'scripts/data/club-strength.json'), 'utf8'));
  const { names } = JSON.parse(await readFile(path.join(root, 'scripts/data/club-strength-names.json'), 'utf8'));
  const updates = JSON.parse(await readFile(path.join(root, 'scripts/data/cm0102-updates.json'), 'utf8'));
  const fields = new Map();
  for (const [id, year] of seasonYears(manifest)) {
    const release = updateTeamRelease(updates, `${year - 1}/${String(year % 100).padStart(2, '0')}`);
    const fill = release ? { ...updateTeamFill(await readUpdateTeam(updates, release, cmDir), year), ids: await seasonMapIds(root, year, { kind: 'cm0102' }) } : null;
    const field = seasonField({ strengths, names, year, fill, ids: await seasonMapIds(root, year, { kind: 'ea' }),
      reserved: new Set((await seasonMapIds(root, year)).values()) });
    // --candidates: every name each source gives, for scripts/data/club-strength-names.json.
    fields.set(id, !candidates ? field : built => {
      candidates[id] = { year, own: built.map(club => [club.country, club.name]), fill: (fill?.candidates ?? []).map(club => [club.country, club.name]) };
      return field(built);
    });
  }
  return fields;
}

/** FIFA 05 and FIFA 06: each edition's ratings, with nationalities from the later editions and Wikidata (scripts/lib/ea-early-seasons.mjs). */
async function buildEarlySeasons(manifest, dataDir, rows, assemble) {
  const { early, legacy } = manifest;
  const later = await readLaterEditions(manifest, dataDir, rows);
  const entries = nationalityEntries(JSON.parse(await pinned(path.join(root, early.nationalities.file), early.nationalities.sha256, 'early nationalities')));
  const results = [];
  for (const edition of early.editions) {
    const file = path.join(dataDir, legacy.ratings.folder, edition.ratings.file);
    const ratings = readRatingsRows(await pinned(file, edition.ratings.sha256, `${edition.edition} ratings file`), { extraFields: EARLY_EXTRA_FIELDS });
    results.push(buildEarlyEaSeason({ ratings, later, entries }, edition, { ratingsUrl: legacy.ratings.url,
      nationalities: `The same EA id in the nearest later edition, else ${early.nationalities.name.split(',')[0]}`, assemble }));
  }
  return results;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifest = JSON.parse(await readFile(path.join(root, 'scripts/data/ea-seasons.json'), 'utf8'));
  const dataDir = path.resolve(args.data ?? path.join(root, 'data-src'));
  const csv = path.resolve(args.csv ?? path.join(dataDir, 'ea-leone', manifest.dataset.file));
  const rows = await readExport(manifest.dataset, csv);

  const candidates = args.candidates ? {} : null;
  const assemble = await fillingAssemble(await seasonFields(manifest, path.resolve(args.cmData ?? dataDir), candidates));
  const results = [...await buildClubSeasons(manifest, { root, dataDir, rows, assemble }), ...await buildEarlySeasons(manifest, dataDir, rows, assemble)];
  if (candidates) {
    await writeFile(path.resolve(args.candidates), `${JSON.stringify(candidates)}\n`);
    console.log(`Wrote every season's candidate clubs to ${args.candidates}`);
  }
  for (const { doc, text, audit } of results) {
    const { coverage } = doc;
    console.log(`${doc.id} ${doc.season} ${doc.label} (${audit.snapshotDate}, ${audit.rows} players): `
      + `${coverage.completeXIs}/${Object.keys(doc.nations).length} full XIs, ${coverage.nations} nations with players, ${coverage.clubs} clubs, ${Math.round(Buffer.byteLength(text) / 1024)} KB`);
    for (const warning of audit.warnings) console.log(`  warning: ${warning}`);
  }
  const retro = JSON.parse(await readFile(path.join(root, 'scripts/data/retro-seasons.json'), 'utf8'));
  const worldCup = JSON.parse(await readFile(path.join(root, 'scripts/data/world-cup-seasons.json'), 'utf8'));
  const nationalTeams = JSON.parse(await readFile(path.join(root, 'scripts/data/national-team-seasons.json'), 'utf8'));
  const listed = [...results.map(result => result.doc), ...await committedSeasons(path.join(root, 'public/football'), retroSeasonIds(retro)),
    ...await committedSeasons(path.join(root, 'public/football'), worldCupSeasonIds(worldCup)),
    ...await committedSeasons(path.join(root, 'public/football'), nationalTeamSeasonIds(nationalTeams))];
  const { editions, exclusions, ...legacySources } = manifest.legacy;
  const audit = { generatedBy: 'scripts/build-ea-seasons.mjs', snapshots: manifest.snapshots, site: manifest.site, dataset: manifest.dataset,
    legacy: { ...legacySources, positions: LEGACY_POSITIONS, exclusions }, early: manifest.early, seasons: results.map(result => result.audit) };
  const outputs = new Map([
    ...results.map(({ doc, text }) => [path.join(root, 'public/football', `${doc.id}.json`), text]),
    [path.join(root, 'src/data/footballSeasons.js'), footballSeasonsModule(listed, { ea: manifest, retro, worldCup, nationalTeams })],
    [path.join(root, 'docs/design/football-seasons-audit.json'), `${JSON.stringify(audit, null, 2)}\n`],
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
  console.log(`Wrote ${results.length} seasons to public/football/, src/data/footballSeasons.js and docs/design/football-seasons-audit.json`);
}

main().catch(error => {
  console.error(`build-ea-seasons: ${error.message}`);
  process.exitCode = 1;
});
