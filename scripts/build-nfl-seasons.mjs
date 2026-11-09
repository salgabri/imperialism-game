// Build the built-in earlier American football seasons (docs/design/american-football.md, "Earlier seasons" and "Tecmo
// seasons"): Madden NFL's launch rosters of 2001 to 2025, and the Tecmo Super Bowl games' 1990 and 1992 to 1995.
//
//   npm run build:nfl-seasons             writes public/american-football/madden-<season>.json and tecmo-<season>.json,
//                                         src/data/americanFootballSeasons.js and docs/design/american-football-seasons-audit.json
//   npm run build:nfl-seasons -- --check  builds every file and compares it byte for byte, writes nothing
//
// A Madden season is one edition's committed snapshot (scripts/data/madden-seasons/<season>.json, npm run
// sync:madden-seasons), its launch roster; a Tecmo season the snapshot npm run sync:tecmo makes
// (scripts/data/tecmo/<season>.json), whose overall is ours. Either way the NFL's clubs of that season each field the
// lineup the game picks and its best backups, by the built-in season's rules (scripts/lib/nfl.mjs). The clubs are today's
// franchises (scripts/data/nfl-teams.json) but for the eras scripts/data/nfl-seasons.json names: the Phoenix Cardinals,
// the Los Angeles and Oakland Raiders, the Los Angeles Rams in Anaheim and the St. Louis Rams, the Houston Oilers, the San
// Diego Chargers, Washington before the Commanders, and the expansion clubs before their first season. Each season names
// the era map its clubs play on, which npm run build:nfl-map builds from the same manifest. Every rating is its
// snapshot's, unchanged.
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { contentHash, serializeFootballSet } from '../src/data/footballSetBuild.js';
import { selectLineup } from '../src/data/teams.js';
import { colourFor, FORMATION, mapOf, playerOf, seasonIdOf, setIdOf, squadOf, strongestFirst, teamsOf } from './lib/nfl.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outDir = path.join(root, 'public/american-football');
const snapshotDir = path.join(root, 'scripts/data/madden-seasons');
const listingFile = path.join(root, 'src/data/americanFootballSeasons.js');
const auditFile = path.join(root, 'docs/design/american-football-seasons-audit.json');

/**
 * Season `year`: its data set document, the document as the file holds it, and its audit row. `snapshot` is the
 * season's committed snapshot; its teams must be the season's franchises (the manifest's eras), each fielding every
 * position from its own players.
 */
export function buildNflSeason(snapshot, year, manifest, franchises) {
  const source = manifest.sources?.[year];
  if (!source) throw new Error(`The manifest has no source for ${year}`);
  if (snapshot.source?.season !== String(year) || snapshot.source.edition !== source.edition) {
    throw new Error(`The ${year} snapshot is ${snapshot.source?.edition} of ${snapshot.source?.season}`);
  }
  const id = setIdOf(manifest, year);
  if (id !== seasonIdOf(year)) throw new Error(`${id} is no Madden season`);
  const teams = teamsOf(franchises, manifest, year);
  const listed = Object.entries(snapshot.teams);
  const stray = listed.filter(([ea, name]) => !teams.some(team => String(team.ea) === ea && team.name === name));
  if (stray.length || listed.length !== teams.length) {
    throw new Error(`${year}: the snapshot's teams ${stray.map(([ea, name]) => `${ea} ${name}`).join(', ') || '(missing some)'} are not the season's ${teams.length}`);
  }
  const pools = new Map(teams.map(team => [team.ea, []]));
  for (const [name, ea, listedPosition, overall] of snapshot.players) {
    if (!pools.has(ea)) throw new Error(`${year}: ${name} plays for EA team ${ea}, no team of the season`);
    if (!Number.isInteger(overall) || overall < 1 || overall > 99) throw new Error(`${year}: ${name} has a rating outside 1-99`);
    const player = playerOf(name, listedPosition, overall);
    if (player) pools.get(ea).push(player);
  }
  const clubs = teams.map(team => {
    const { squad, str } = squadOf(pools.get(team.ea), `${year} ${team.name}`);
    return { id: team.id, name: team.name, code: team.code, league: 'NFL', country: '840', col: colourFor(team.id), str,
      squad: squad.map(p => [p.name, p.pos, p.rating]) };
  }).sort(strongestFirst);
  const doc = {
    format: 1, kind: 'madden', id, version: '', year, season: String(year), label: source.edition, local: false,
    source: { provider: manifest.source.provider, edition: source.edition, compiler: source.compiler, url: source.url,
      iteration: source.iteration, retrieved: source.retrieved, rawScale: 99 },
    map: mapOf(manifest, year),
    clubs,
    coverage: { players: snapshot.players.length, clubs: clubs.length },
  };
  doc.version = `${doc.id}-${contentHash(doc)}`;
  const audit = {
    id: doc.id, version: doc.version, season: doc.season, edition: source.edition, compiler: source.compiler, url: source.url,
    iteration: source.iteration, retrieved: source.retrieved, players: snapshot.players.length, map: doc.map,
    clubs: clubs.map(c => `${c.name} ${c.str}`),
    checks: snapshot.checks, notes: snapshot.notes, ...(source.remarks ? { remarks: source.remarks } : {}),
  };
  return { doc, text: serializeFootballSet(doc), audit };
}

/** A lineup's places the game fills out of position: `['DL: Neil Smith (LB 80)']`. */
const outOfPosition = squad => selectLineup({ sport: 'american-football', squad: squad.map(([name, pos, rating]) => ({ name, pos, rating })) })
  .slots.filter(slot => slot.outOfPosition).map(slot => `${slot.position}: ${slot.player.name} (${slot.player.pos} ${slot.player.rating})`);

/**
 * Tecmo season `year`: its data set document, the document as the file holds it, and its audit row, from its committed
 * snapshot (scripts/data/tecmo/<season>.json, npm run sync:tecmo). Tecmo rates no overall: the snapshot's is ours (its
 * `conversion`), and stays as the snapshot has it. Its clubs must be the season's franchises as the manifest's eras name
 * them. Each fields its squad by the Madden seasons' rules, except that a place the snapshot documents as short
 * (`lineup.gaps`: the 3-4 of NES Tecmo Super Bowl, the three linemen of SNES Tecmo Super Bowl, the run-and-shoot clubs
 * without a tight end, an unlicensed lineman nobody can name) is left to the game to fill out of position: no player is
 * added, and a shortfall the snapshot does not document stops the build.
 */
export function buildTecmoSeason(snapshot, year, manifest, franchises) {
  const source = manifest.sources?.[year];
  if (source?.kind !== 'tecmo') throw new Error(`${year} is no Tecmo season of the manifest`);
  if (snapshot.source?.season !== year) throw new Error(`The ${year} Tecmo snapshot rates ${snapshot.source?.season}`);
  const id = setIdOf(manifest, year);
  if (id !== `tecmo-${year}`) throw new Error(`${id} is no Tecmo season`);
  if (JSON.stringify(snapshot.lineup?.needs) !== JSON.stringify(FORMATION)) throw new Error(`${year}: the snapshot's lineup is not the game's`);
  const teams = teamsOf(franchises, manifest, year);
  const listed = Object.entries(snapshot.teams);
  const stray = listed.filter(([franchise, club]) => !teams.some(team => team.franchise === franchise && team.id === club.era
    && team.name === club.name && team.code === club.code));
  if (stray.length || listed.length !== teams.length) {
    throw new Error(`${year}: the snapshot's clubs ${stray.map(([, club]) => club.name).join(', ') || '(missing some)'} are not the season's ${teams.length}`);
  }
  const pools = new Map(teams.map(team => [team.franchise, []]));
  for (const [name, franchise, slot, pos, overall] of snapshot.players) {
    if (!pools.has(franchise)) throw new Error(`${year}: ${name} plays for ${franchise}, no club of the season`);
    if (!FORMATION[pos]) throw new Error(`${year}: ${name} (${slot}) plays ${pos}, no position of the game's`);
    if (!Number.isInteger(overall) || overall < 1 || overall > 99) throw new Error(`${year}: ${name} has a rating outside 1-99`);
    pools.get(franchise).push({ name, pos, rating: overall });
  }
  const clubs = teams.map(team => {
    const { squad, str } = squadOf(pools.get(team.franchise), `${year} ${team.name}`, { gaps: snapshot.lineup.gaps[team.franchise] || {} });
    return { id: team.id, name: team.name, code: team.code, league: 'NFL', country: '840', col: colourFor(team.id), str,
      squad: squad.map(p => [p.name, p.pos, p.rating]) };
  }).sort(strongestFirst);
  const { game, platform, cartridgeSeason, dump } = snapshot.source;
  const edition = `${game} (${platform})${cartridgeSeason ? `, cartridge season ${cartridgeSeason}` : ''}`;
  const doc = {
    format: 1, kind: 'tecmo', id, version: '', year, season: String(year), label: source.label, local: false,
    source: { provider: 'Tecmo', edition, compiler: source.compiler, url: dump.repo, retrieved: source.retrieved,
      conversion: snapshot.conversion.overall },
    map: mapOf(manifest, year),
    clubs,
    coverage: { players: snapshot.players.length, clubs: clubs.length },
  };
  doc.version = `${doc.id}-${contentHash(doc)}`;
  const placeholders = snapshot.placeholders || [];
  const audit = {
    id: doc.id, version: doc.version, season: doc.season, label: doc.label, edition, compiler: source.compiler,
    url: dump.repo, dump: `${dump.path} (blob ${dump.blob})`, retrieved: source.retrieved, formula: snapshot.conversion.formula.id,
    players: snapshot.players.length, map: doc.map,
    clubs: clubs.map(c => `${c.name} ${c.str}`),
    // The places each club's lineup fills out of position: its documented gaps, and a kicker the game passes over.
    outOfPosition: Object.fromEntries(clubs.map(c => [c.name, outOfPosition(c.squad)]).filter(([, places]) => places.length)),
    gaps: Object.fromEntries(Object.entries(snapshot.lineup.gaps).map(([franchise, gaps]) => [teams.find(t => t.franchise === franchise).name, gaps])),
    checks: (snapshot.source.checks || []).map(({ name, compared, identical }) => ({ name, compared, identical })),
    unlicensed: { named: placeholders.filter(p => p.named).length, leftOut: placeholders.filter(p => !p.named).length },
  };
  return { doc, text: serializeFootballSet(doc), audit };
}

/**
 * Madden NFL 99, 2000 or 2001 season `year`: its data set document, the document as the file holds it, and its audit
 * row, from its committed snapshot (scripts/data/madden-early/<season>.json, npm run sync:madden-early: NFL Draft Buzz's
 * copy of EA's data). Madden NFL 2001 kept EA's overall, used unchanged; Madden NFL 99 and 2000 kept attributes only, so
 * their overall is ours (the snapshot's `conversion`, which the source block carries: overall 'converted'). Its clubs must
 * be the season's franchises as the manifest's eras name them, each fielding its squad by the Madden seasons' rules; a
 * place the snapshot documents as short (`lineup.gaps`: a player the site's copy lacks) is left to the game.
 */
export function buildEarlyMaddenSeason(snapshot, year, manifest, franchises) {
  const source = manifest.sources?.[year];
  if (source?.kind !== 'ndb') throw new Error(`${year} is no NFL Draft Buzz season of the manifest`);
  if (snapshot.source?.season !== year || snapshot.source.edition !== source.edition) throw new Error(`The ${year} snapshot is ${snapshot.source?.edition} of ${snapshot.source?.season}`);
  const id = setIdOf(manifest, year);
  if (id !== seasonIdOf(year)) throw new Error(`${id} is no Madden season`);
  if (JSON.stringify(snapshot.lineup?.needs) !== JSON.stringify(FORMATION)) throw new Error(`${year}: the snapshot's lineup is not the game's`);
  const converted = !!snapshot.conversion;
  const teams = teamsOf(franchises, manifest, year);
  const listed = Object.entries(snapshot.teams);
  const stray = listed.filter(([franchise, club]) => !teams.some(team => team.franchise === franchise && team.id === club.era
    && team.name === club.name && team.code === club.code));
  if (stray.length || listed.length !== teams.length) {
    throw new Error(`${year}: the snapshot's clubs ${stray.map(([, club]) => club.name).join(', ') || '(missing some)'} are not the season's ${teams.length}`);
  }
  const pools = new Map(teams.map(team => [team.franchise, []]));
  for (const [name, franchise, label, pos, overall] of snapshot.players) {
    if (!pools.has(franchise)) throw new Error(`${year}: ${name} plays for ${franchise}, no club of the season`);
    if (!FORMATION[pos]) throw new Error(`${year}: ${name} (${label}) plays ${pos}, no position of the game's`);
    if (!Number.isInteger(overall) || overall < 1 || overall > 99) throw new Error(`${year}: ${name} has a rating outside 1-99`);
    pools.get(franchise).push({ name, pos, rating: overall });
  }
  const clubs = teams.map(team => {
    const { squad, str } = squadOf(pools.get(team.franchise), `${year} ${team.name}`, { gaps: snapshot.lineup.gaps[team.franchise] || {} });
    return { id: team.id, name: team.name, code: team.code, league: 'NFL', country: '840', col: colourFor(team.id), str,
      squad: squad.map(p => [p.name, p.pos, p.rating]) };
  }).sort(strongestFirst);
  const doc = {
    format: 1, kind: 'madden', id, version: '', year, season: String(year), label: source.label, local: false,
    source: { provider: manifest.source.provider, edition: source.edition, compiler: source.compiler, url: source.url, retrieved: source.retrieved,
      ...(converted ? { overall: 'converted', rawScale: 99, conversion: snapshot.conversion.overall } : { rawScale: 99 }) },
    map: mapOf(manifest, year),
    clubs,
    coverage: { players: snapshot.players.length, clubs: clubs.length },
  };
  doc.version = `${doc.id}-${contentHash(doc)}`;
  const audit = {
    id: doc.id, version: doc.version, season: doc.season, label: doc.label, edition: source.edition, compiler: source.compiler, url: source.url,
    retrieved: source.retrieved, overall: converted ? 'converted' : 'EA', players: snapshot.players.length, map: doc.map,
    clubs: clubs.map(c => `${c.name} ${c.str}`),
    outOfPosition: Object.fromEntries(clubs.map(c => [c.name, outOfPosition(c.squad)]).filter(([, places]) => places.length)),
    gaps: Object.fromEntries(Object.entries(snapshot.lineup.gaps).map(([franchise, gaps]) => [teams.find(t => t.franchise === franchise).name, gaps])),
    checks: snapshot.checks.map(({ name, spearman, clubs: count, players, sameClub, compared, identical }) => ({ name,
      ...(spearman !== undefined ? { clubs: count, spearman } : sameClub !== undefined ? { players, sameClub } : compared !== undefined ? { compared, identical } : { players }) })),
    ...(converted ? { fit: snapshot.conversion.fit.groups } : {}),
    left: snapshot.source.left,
  };
  return { doc, text: serializeFootballSet(doc), audit };
}

function listingModule(docs) {
  const rows = docs.map(doc => `  Object.freeze({ id: '${doc.id}', version: '${doc.version}', year: ${doc.year}, season: '${doc.season}', label: '${doc.label}', map: '${doc.map}' }),`);
  return `// GENERATED by npm run build:nfl-seasons; do not edit.
// The built-in earlier American football seasons, newest first: NFL clubs only. Each is public/american-football/<id>.json,
// loaded when a setup chooses it (src/engine/footballSets.js), and plays on its era's map (\`map\`, public/domestic/<map>.json).
export const BUILT_IN_AMERICAN_FOOTBALL_SEASONS = Object.freeze([
${rows.join('\n')}
]);
`;
}

async function main() {
  const check = process.argv.includes('--check');
  const unknown = process.argv.slice(2).filter(arg => arg !== '--check');
  if (unknown.length) throw new Error(`Unknown option ${unknown[0]}`);
  const manifest = JSON.parse(await readFile(path.join(root, 'scripts/data/nfl-seasons.json'), 'utf8'));
  const franchises = JSON.parse(await readFile(path.join(root, 'scripts/data/nfl-teams.json'), 'utf8')).teams;
  const results = [];
  // Each kind of season, its builder and the sync that makes its snapshot.
  const KIND = { tecmo: [buildTecmoSeason, 'sync:tecmo'], ndb: [buildEarlyMaddenSeason, 'sync:madden-early'] };
  for (const year of manifest.seasons) {
    const [builder, sync] = KIND[manifest.sources[year]?.kind] ?? [buildNflSeason, 'sync:madden-seasons'];
    const file = manifest.sources[year]?.snapshot ? path.join(root, manifest.sources[year].snapshot) : path.join(snapshotDir, `${year}.json`);
    if (!existsSync(file)) throw new Error(`No snapshot for ${year}: run npm run ${sync} -- --season=${year}`);
    const snapshot = JSON.parse(await readFile(file, 'utf8'));
    results.push(builder(snapshot, year, manifest, franchises));
  }
  results.sort((a, b) => b.doc.year - a.doc.year);
  for (const { doc, text, audit } of results) {
    console.log(`${doc.id} ${doc.label} on ${doc.map}: ${doc.clubs.length} clubs from ${audit.players} players, `
      + `${Math.round(Buffer.byteLength(text) / 1024)} KB; strongest ${audit.clubs.slice(0, 3).join(', ')}`);
  }
  const outputs = [
    ...results.map(({ doc, text }) => [path.join(outDir, `${doc.id}.json`), text]),
    [listingFile, listingModule(results.map(result => result.doc))],
    [auditFile, `${JSON.stringify({ generatedBy: 'scripts/build-nfl-seasons.mjs', source: manifest.source, seasons: results.map(r => r.audit) }, null, 2)}\n`],
  ];
  if (check) {
    const differs = [];
    for (const [file, text] of outputs) {
      const current = existsSync(file) ? (await readFile(file, 'utf8')).replace(/\r\n/g, '\n') : null;
      if (current !== text) differs.push(path.relative(root, file));
    }
    if (differs.length) throw new Error(`differs: ${differs.join(', ')}`);
    console.log(`Verified the ${results.length} American football seasons, their listing and audit byte for byte.`);
    return;
  }
  await mkdir(outDir, { recursive: true });
  for (const [file, text] of outputs) await writeFile(file, text);
  console.log(`Wrote ${results.length} seasons to public/american-football/, src/data/americanFootballSeasons.js and docs/design/american-football-seasons-audit.json`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(`build-nfl-seasons: ${error.message}`);
    process.exitCode = 1;
  });
}
