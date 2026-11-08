// Build the built-in earlier baseball seasons from MLB The Show's Live series (docs/design/baseball.md, "Earlier seasons").
//
//   npm run build:mlb-seasons             writes public/baseball/mlb-the-show-<nn>.json, src/data/baseballSeasons.js and
//                                         docs/design/baseball-seasons-audit.json
//   npm run build:mlb-seasons -- --check  builds every file and compares it byte for byte, writes nothing
//
// Each season is one edition's committed snapshot (scripts/data/mlb-the-show-<nn>.json: npm run sync:mlb-the-show --
// --edition=<nn> from Sony's API, or npm run import:mlb-showzone for the editions only ShowZone keeps), the edition's
// last roster update: its MLB clubs and its nations by birthplace, built by the same rules as the built-in season
// (scripts/lib/mlb.mjs). The teams are today's (scripts/data/mlb-teams.json) but for the eras
// scripts/data/mlb-seasons.json names; each season names the era map its clubs play on, which npm run build:mlb-map
// builds from the same manifest. Every rating is The Show's, unchanged.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { HOME_NATIONS } from '../src/data/teams.js';
import { CLUBS } from '../src/data/clubs.baseball.js';
import { contentHash, serializeFootballSet } from '../src/data/footballSetBuild.js';
import {
  checkTeams, clubsOf, colourFor, editionOf, mapOf, nationOfBirthplace, nationsOf, nearestBirthplace, playerOf, seasonIdOf, teamsOf,
  trustsBirthplace, tupleOf,
} from './lib/mlb.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outDir = path.join(root, 'public/baseball');
const listingFile = path.join(root, 'src/data/baseballSeasons.js');
const auditFile = path.join(root, 'docs/design/baseball-seasons-audit.json');
const birthplacesFile = 'scripts/data/mlb-birthplaces.json';

/**
 * Season `year`: its data set document and its audit row. `birthplaces` holds MLB's own answers for the cards of the
 * seasons scripts/data/mlb-seasons.json `statsApi.for` names (scripts/data/mlb-birthplaces.json).
 */
function buildSeason(snapshot, year, manifest, franchises, snapshots, birthplaces) {
  const { source } = snapshot;
  if (Number(source.season) !== year) throw new Error(`scripts/data/mlb-the-show-${editionOf(year)}.json is the ${source.season} season`);
  // A club that kept its id keeps its colour; one of another era takes its own.
  const colours = new Map(CLUBS.map(club => [club.id, club.col]));
  const teams = teamsOf(franchises, manifest, year).map(team => ({ ...team, col: colours.get(team.id) ?? colourFor(team.id) }));
  checkTeams(snapshot, teams);
  // A card names no place the game knows, or (in an edition whose foreign birthplaces are wrong) a place outside the
  // United States: the player takes his birthplace from the nearest sound edition, else (in a season MLB's own records
  // were asked for) from those, else plays for no nation.
  const unreliable = manifest.unreliableBirthplaces || {};
  const asked = manifest.statsApi?.for.includes(year) ? birthplaces.seasons[year] ?? {} : null;
  const filled = [], fromMlb = [], unplaced = [];
  let answered = 0;
  const players = snapshot.players.map(row => {
    const [uuid, name, , , , , born] = row;
    if (trustsBirthplace(born, year, unreliable)) return playerOf(row);
    const near = nearestBirthplace(snapshots, year, row, unreliable);
    if (near) {
      filled.push(`${name}: ${JSON.stringify(born)} → ${near.born} (MLB The Show ${editionOf(near.from)})`);
      return playerOf([...row.slice(0, 6), near.born]);
    }
    const answer = asked?.[uuid];
    if (asked && !answer) throw new Error(`${source.edition}: ${birthplacesFile} has no answer for ${name} (${uuid}): run npm run sync:mlb-birthplaces`);
    if (answer) answered++;
    const [, place, id, reason] = answer ?? [];
    if (place && nationOfBirthplace(place)) {
      fromMlb.push(`${name}: ${JSON.stringify(born)} → ${place} (MLB player ${id}, ${reason})`);
      return playerOf([...row.slice(0, 6), place]);
    }
    unplaced.push(`${name}: ${JSON.stringify(born)}${answer ? ` (MLB's records: ${place ?? reason})` : ''}`);
    return playerOf([...row.slice(0, 6), ''], () => null);
  });
  if (asked && answered !== Object.keys(asked).length) {
    throw new Error(`${source.edition}: ${birthplacesFile} answers for cards the build places otherwise: run npm run sync:mlb-birthplaces`);
  }
  const clubs = clubsOf(players, teams);
  const nations = nationsOf(players);
  const update = `Roster update ${source.rosterUpdate.id} (${source.rosterUpdate.name})`;
  const doc = {
    format: 1, kind: 'show', id: seasonIdOf(year), version: '', year, season: String(year), label: source.edition, local: false,
    source: { provider: manifest.source.provider, edition: source.edition, update, retrieved: source.retrieved, url: source.url, rawScale: 99,
      // An edition whose own API is gone names the site that keeps its cards.
      ...(source.compiler ? { compiler: source.compiler } : {}) },
    map: mapOf(manifest, year),
    nations: Object.fromEntries(nations.map(n => [n.id, [n.str, n.squad.length, n.squad.map(tupleOf)]])),
    clubs: clubs.map(c => ({ id: c.id, name: c.name, code: c.code, league: 'MLB', country: '840', col: c.col, str: c.str, squad: c.squad.map(tupleOf) })),
    // The World Baseball Classic fields Great Britain: the home nations play as the United Kingdom.
    territory: { merged: Object.fromEntries(HOME_NATIONS.map(id => [id, '826'])), inactive: [] },
    coverage: { cards: snapshot.players.length, clubs: clubs.length, nations: nations.length },
  };
  doc.version = `${doc.id}-${contentHash(doc)}`;
  const audit = {
    id: doc.id, version: doc.version, edition: source.edition, update, retrieved: source.retrieved, cards: snapshot.players.length, map: doc.map,
    clubs: clubs.map(c => `${c.name} ${c.str}`),
    nations: nations.map(n => `${n.name} ${n.str} (${n.squad.length}${n.open.length ? `; the game fills ${n.open.join(' ')}` : ''})`),
    birthplacesFromOtherEditions: filled, ...(asked ? { birthplacesFromMlb: fromMlb } : {}), noNation: unplaced,
  };
  return { doc, text: serializeFootballSet(doc), audit };
}

function listingModule(docs) {
  const rows = docs.map(doc => `  Object.freeze({ id: '${doc.id}', version: '${doc.version}', year: ${doc.year}, season: '${doc.season}', label: '${doc.label}', map: '${doc.map}' }),`);
  return `// GENERATED by npm run build:mlb-seasons from MLB The Show's Live series (scripts/data/mlb-seasons.json).
// The built-in earlier baseball seasons, newest first: each edition's nations and MLB clubs at its last roster update.
// Each is public/baseball/<id>.json, loaded when a setup chooses it (src/engine/footballSets.js); its clubs play on
// their era's map (\`map\`, public/domestic/<map>.json).
export const BUILT_IN_BASEBALL_SEASONS = Object.freeze([
${rows.join('\n')}
]);
`;
}

async function main() {
  const check = process.argv.includes('--check');
  const unknown = process.argv.slice(2).filter(arg => arg !== '--check');
  if (unknown.length) throw new Error(`Unknown option ${unknown[0]}`);
  const manifest = JSON.parse(await readFile(path.join(root, 'scripts/data/mlb-seasons.json'), 'utf8'));
  const franchises = JSON.parse(await readFile(path.join(root, 'scripts/data/mlb-teams.json'), 'utf8')).teams;
  // Every snapshot, the built-in season's included, so a card that names no birthplace can take another edition's.
  const snapshots = new Map();
  for (const year of [...manifest.seasons, manifest.builtIn.year]) {
    const file = path.join(root, `scripts/data/mlb-the-show-${editionOf(year)}.json`);
    if (!existsSync(file)) throw new Error(`No snapshot for ${year}: run npm run sync:mlb-the-show -- --edition=${editionOf(year)}`);
    snapshots.set(year, JSON.parse(await readFile(file, 'utf8')));
  }
  const birthplaces = JSON.parse(await readFile(path.join(root, birthplacesFile), 'utf8'));
  const results = manifest.seasons.map(year => buildSeason(snapshots.get(year), year, manifest, franchises, snapshots, birthplaces));
  results.sort((a, b) => b.doc.year - a.doc.year);
  for (const { doc, text, audit } of results) {
    console.log(`${doc.id} ${doc.season} on ${doc.map}: ${doc.clubs.length} clubs, ${audit.nations.length} nations from ${audit.cards} cards, `
      + `${Math.round(Buffer.byteLength(text) / 1024)} KB; strongest ${audit.clubs.slice(0, 3).join(', ')}; ${audit.nations.slice(0, 3).join(', ')}`);
  }
  const outputs = [
    ...results.map(({ doc, text }) => [path.join(outDir, `${doc.id}.json`), text]),
    [listingFile, listingModule(results.map(result => result.doc))],
    [auditFile, `${JSON.stringify({ generatedBy: 'scripts/build-mlb-seasons.mjs', source: manifest.source, seasons: results.map(r => r.audit) }, null, 2)}\n`],
  ];
  if (check) {
    const differs = [];
    for (const [file, text] of outputs) {
      const current = existsSync(file) ? (await readFile(file, 'utf8')).replace(/\r\n/g, '\n') : null;
      if (current !== text) differs.push(path.relative(root, file));
    }
    if (differs.length) throw new Error(`differs: ${differs.join(', ')}`);
    console.log(`Verified the ${results.length} baseball seasons, their listing and audit byte for byte.`);
    return;
  }
  await mkdir(outDir, { recursive: true });
  for (const [file, text] of outputs) await writeFile(file, text);
  console.log(`Wrote ${results.length} seasons to public/baseball/, src/data/baseballSeasons.js and docs/design/baseball-seasons-audit.json`);
}

main().catch(error => {
  console.error(`build-mlb-seasons: ${error.message}`);
  process.exitCode = 1;
});
