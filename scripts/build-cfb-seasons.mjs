// Build the built-in earlier college football seasons (docs/design/college-football.md, "Earlier seasons"): the FBS
// seasons 2009 to 2025, which no game rated, computed from sportsdataverse's facts (npm run sync:cfb-seasons).
//
//   npm run build:cfb-seasons             writes public/college-football/cfb-<season>.json, the listing
//                                         src/data/collegeFootballSeasons.js and docs/design/college-football-seasons-audit.json
//   npm run build:cfb-seasons -- --check  builds every file and compares it byte for byte, writes nothing
//
// Each season is its committed snapshot (scripts/data/cfb-seasons/<season>.json): its schools, each with its squad as the
// sync rated and moved it (the lineup the game picks and its best backups, scripts/lib/nfl.mjs), its conference of that
// season and its record. The schools are named, coded and coloured as the built-in season has them
// (scripts/data/cfb-teams.json), and a school the built-in season lacks (Idaho) as scripts/data/cfb-seasons.json's
// `schools` has it. Each season names the era map its schools play on (scripts/data/cfb-seasons.json `maps`, built by
// npm run build:cfb-map). Every rating is the snapshot's, unchanged.
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { contentHash, serializeFootballSet } from '../src/data/footballSetBuild.js';
import { selectLineup } from '../src/data/teams.js';
import { colourFor, FORMATION, squadOf, strongestFirst } from './lib/nfl.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outDir = path.join(root, 'public/college-football');
const snapshotDir = path.join(root, 'scripts/data/cfb-seasons');
const listingFile = path.join(root, 'src/data/collegeFootballSeasons.js');
const auditFile = path.join(root, 'docs/design/college-football-seasons-audit.json');
const SPORT = 'college-football';
/** The Season list's label of a computed FBS season. */
export const LABEL = 'FBS (computed)';
export const seasonIdOf = year => `cfb-${year}`;

/** The era map season `year` plays on (scripts/data/cfb-seasons.json `maps`). */
export function mapOf(manifest, year) {
  const map = (manifest.maps ?? []).find(entry => entry.seasons.includes(year));
  if (!map) throw new Error(`No FBS map for the ${year} season`);
  return map.id;
}

/** A school's name and code as the game shows them: the built-in season's, else the manifest's (`schools`). */
export function schoolOf(id, teams, manifest) {
  const school = teams[id] ?? manifest.schools?.[id];
  if (!school) throw new Error(`No school ${id} in scripts/data/cfb-teams.json or scripts/data/cfb-seasons.json`);
  return { id, name: school.name, code: school.code };
}

/** A lineup's places the game fills out of position: `['TE: Kyle Keys (WR 70)']`. */
const outOfPosition = squad => selectLineup({ sport: SPORT, squad: squad.map(([name, pos, rating]) => ({ name, pos, rating })) })
  .slots.filter(slot => slot.outOfPosition).map(slot => `${slot.position}: ${slot.player.name} (${slot.player.pos} ${slot.player.rating})`);

/**
 * Season `year`: its data set document, the document as the file holds it, and its audit row, from its snapshot. No game
 * rated the season: each rating is the sync's (the snapshot's `conversion`, which the source block carries with method
 * 'computed'). Every school fields its squad by the built-in season's rules; a place the snapshot documents as short
 * (`lineup.gaps`) is left to the game.
 */
export function buildCfbSeason(snapshot, year, manifest, teams) {
  if (snapshot.source?.season !== year || snapshot.source.league !== 'FBS') throw new Error(`The ${year} snapshot is the ${snapshot.source?.league} ${snapshot.source?.season}`);
  if (JSON.stringify(snapshot.lineup?.needs) !== JSON.stringify(FORMATION)) throw new Error(`${year}: the snapshot's lineup is not the game's`);
  const clubs = Object.entries(snapshot.squads).map(([id, rows]) => {
    const school = schoolOf(id, teams, manifest);
    const pool = rows.map(([name, pos, , , , , , rating]) => {
      if (!FORMATION[pos]) throw new Error(`${year}: ${name} plays ${pos}, no position of the game's`);
      if (!Number.isInteger(rating) || rating < 1 || rating > 99) throw new Error(`${year}: ${name} has a rating outside 1-99`);
      return { name, pos, rating };
    });
    const { squad, str } = squadOf(pool, `${year} ${school.name}`, { gaps: snapshot.lineup.gaps[id] ?? {}, sport: SPORT });
    if (squad.length !== pool.length) throw new Error(`${year} ${school.name}: the snapshot's squad is not the one the game fields`);
    const conference = snapshot.schools[id]?.conference;
    if (!conference) throw new Error(`${year} ${school.name}: no conference`);
    return { id, name: school.name, code: school.code, league: conference, country: '840', col: colourFor(id), str,
      squad: squad.map(p => [p.name, p.pos, p.rating]) };
  }).sort(strongestFirst);
  const codes = clubs.map(c => c.code);
  const twice = codes.filter((code, i) => codes.indexOf(code) !== i);
  if (twice.length) throw new Error(`${year}: codes used twice: ${twice.join(', ')}`);
  const repo = snapshot.source.repos['cfbfastR-cfb-data'];
  const doc = {
    format: 1, kind: 'cfb', id: seasonIdOf(year), version: '', year, season: String(year), label: LABEL, local: false,
    source: { provider: 'sportsdataverse', edition: `The ${year} FBS season, computed`, compiler: 'sportsdataverse (cfbfastR-data, cfbfastR-cfb-data)',
      url: repo, retrieved: snapshot.source.retrieved, method: 'computed', rawScale: 'value', conversion: snapshot.conversion.overall },
    map: mapOf(manifest, year),
    clubs,
    coverage: { players: clubs.reduce((t, c) => t + c.squad.length, 0), clubs: clubs.length },
  };
  doc.version = `${doc.id}-${contentHash(doc)}`;
  const strengths = clubs.map(c => c.str);
  const signed = x => (x > 0 ? `+${x}` : x < 0 ? `−${-x}` : '0');
  const audit = {
    id: doc.id, version: doc.version, season: doc.season, label: doc.label, regime: snapshot.source.regime, retrieved: snapshot.source.retrieved,
    players: doc.coverage.players, map: doc.map, spread: [Math.min(...strengths), Math.max(...strengths)],
    // Each school with its conference, record and points against FBS schools, its SRS and its move toward it.
    clubs: clubs.map(c => {
      const f = snapshot.schools[c.id], m = snapshot.moves[c.id];
      return `${c.name} ${c.str} (${c.league}, ${f.record}, ${f.for}–${f.against}; SRS ${signed(m.srs)}, moved ${signed(m.shift)}${m.plus ? ` and its best ${m.plus} one more` : ''})`;
    }),
    move: { reliability: snapshot.conversion.move.srs.reliability, perPoint: snapshot.conversion.move.perPoint, mean: snapshot.conversion.move.mean },
    outOfPosition: Object.fromEntries(clubs.map(c => [c.name, outOfPosition(c.squad)]).filter(([, places]) => places.length)),
    gaps: Object.fromEntries(Object.entries(snapshot.lineup.gaps).map(([id, gaps]) => [schoolOf(id, teams, manifest).name, gaps])),
    ...(snapshot.left?.schools?.length ? { leftOut: snapshot.left.schools.map(s => `${schoolOf(s.school, teams, manifest).name} (${s.players} rated players, short of ${Object.entries(s.short).map(([pos, n]) => `${n} ${pos}`).join(', ')})`) } : {}),
  };
  return { doc, text: serializeFootballSet(doc), audit };
}

function listingModule(docs) {
  const rows = docs.map(doc => `  Object.freeze({ id: '${doc.id}', version: '${doc.version}', year: ${doc.year}, season: '${doc.season}', label: '${doc.label}', map: '${doc.map}' }),`);
  return `// GENERATED by npm run build:cfb-seasons; do not edit.
// The built-in earlier college football seasons, newest first: the FBS's schools of each season, computed from
// sportsdataverse's facts (docs/design/college-football.md, "Earlier seasons"). Each is public/college-football/<id>.json,
// loaded when a setup chooses it (src/engine/footballSets.js), and plays on its era's map (\`map\`, public/domestic/<map>.json).
export const BUILT_IN_COLLEGE_FOOTBALL_SEASONS = Object.freeze([
${rows.join('\n')}
]);
`;
}

async function main() {
  const check = process.argv.includes('--check');
  const unknown = process.argv.slice(2).filter(arg => arg !== '--check');
  if (unknown.length) throw new Error(`Unknown option ${unknown[0]}`);
  const manifest = JSON.parse(await readFile(path.join(root, 'scripts/data/cfb-seasons.json'), 'utf8'));
  const teams = JSON.parse(await readFile(path.join(root, 'scripts/data/cfb-teams.json'), 'utf8')).teams;
  const results = [];
  for (const year of manifest.seasons) {
    const file = path.join(snapshotDir, `${year}.json`);
    if (!existsSync(file)) throw new Error(`No snapshot for ${year}: run npm run sync:cfb-seasons -- --season=${year}`);
    results.push(buildCfbSeason(JSON.parse(await readFile(file, 'utf8')), year, manifest, teams));
  }
  results.sort((a, b) => b.doc.year - a.doc.year);
  for (const { doc, text, audit } of results) {
    console.log(`${doc.id} on ${doc.map}: ${doc.clubs.length} schools, ${Math.round(Buffer.byteLength(text) / 1024)} KB; strongest ${audit.clubs.slice(0, 3).map(c => c.split(' (')[0]).join(', ')}`);
  }
  const outputs = [
    ...results.map(({ doc, text }) => [path.join(outDir, `${doc.id}.json`), text]),
    [listingFile, listingModule(results.map(result => result.doc))],
    [auditFile, `${JSON.stringify({ generatedBy: 'scripts/build-cfb-seasons.mjs', seasons: results.map(r => r.audit) }, null, 2)}\n`],
  ];
  if (check) {
    const differs = [];
    for (const [file, text] of outputs) {
      const current = existsSync(file) ? (await readFile(file, 'utf8')).replace(/\r\n/g, '\n') : null;
      if (current !== text) differs.push(path.relative(root, file));
    }
    if (differs.length) throw new Error(`differs: ${differs.join(', ')}`);
    console.log(`Verified the ${results.length} college football seasons, their listing and audit byte for byte.`);
    return;
  }
  await mkdir(outDir, { recursive: true });
  for (const [file, text] of outputs) await writeFile(file, text);
  console.log(`Wrote ${results.length} seasons to public/college-football/, src/data/collegeFootballSeasons.js and docs/design/college-football-seasons-audit.json`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(`build-cfb-seasons: ${error.message}`);
    process.exitCode = 1;
  });
}
