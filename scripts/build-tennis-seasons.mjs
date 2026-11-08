// Build a tour's earlier seasons from its committed snapshots and manifest: the men's (docs/design/tennis.md, "Earlier
// seasons"; scripts/data/tennis-seasons/, npm run sync:tennis-seasons) or, with --tour=wta, the women's
// (docs/design/womens-tennis.md, "Earlier seasons"; scripts/data/womens-tennis-seasons/).
//
//   npm run build:tennis-seasons             writes public/tennis/tennis-<year>.json, public/tennis/ATTRIBUTION.txt,
//                                            src/data/tennisSeasons.js and docs/design/tennis-seasons-audit.json
//   npm run build:womens-tennis-seasons      the same with --tour=wta: public/womens-tennis/wta-<year>.json, its
//                                            ATTRIBUTION.txt, src/data/womensTennisSeasons.js and
//                                            docs/design/womens-tennis-seasons-audit.json
//   --check                                  builds every file and compares it byte for byte, writes nothing
//
// A season fields the cup nations of its day (the Davis Cup's, the Fed Cup's): each nation's five best by Elo, a rating
// being the Elo on the game's scale (Elo / 25 + 4, rounded, as the 2026 season), shifted down for the whole season when
// its best player would be over 99 (scripts/lib/tennis-seasons.mjs). Every Elo is the source's: Tennis Abstract's own
// for 2016-2025, computed from Jeff Sackmann's match results by Tennis Abstract's method for 1973-2015.
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { contentHash, serializeFootballSet } from '../src/data/footballSetBuild.js';
import { NATIONS, nationIdentity } from '../src/data/teams.js';
import { tennis } from '../src/sports/tennis.js';
import { womensTennis } from '../src/sports/womensTennis.js';
import { gameRating } from './lib/tennis.mjs';
import { federationOf, nationIdOf, teamsOf, territoryOf, tupleOf } from './lib/tennis-seasons.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
// Each tour's files, ids and words: the men's as they were before the women's tour joined, so they rebuild byte for byte.
const TOURS = {
  atp: { manifest: 'scripts/data/tennis-seasons.json', snapshots: 'scripts/data/tennis-seasons', out: 'public/tennis', listing: 'src/data/tennisSeasons.js',
    listingName: 'BUILT_IN_TENNIS_SEASONS', audit: 'docs/design/tennis-seasons-audit.json', page: 'player.cgi', prefix: 'tennis', kind: 'elo', sport: tennis,
    idOf: id => `atp:${id}`, rankKey: 'atpRank', results: 'Jeff Sackmann\'s ATP match results (Tennis Abstract)', sync: 'npm run sync:tennis-seasons',
    command: 'npm run build:tennis-seasons', noun: 'tennis' },
  wta: { manifest: 'scripts/data/womens-tennis-seasons.json', snapshots: 'scripts/data/womens-tennis-seasons', out: 'public/womens-tennis',
    listing: 'src/data/womensTennisSeasons.js', listingName: 'BUILT_IN_WOMENS_TENNIS_SEASONS', audit: 'docs/design/womens-tennis-seasons-audit.json',
    page: 'wplayer.cgi', prefix: 'wta', kind: 'wta', sport: womensTennis, idOf: id => `wta:${id}`, rankKey: 'wtaRank',
    results: 'Jeff Sackmann\'s WTA match results (Tennis Abstract)', sync: 'npm run sync:womens-tennis-seasons',
    command: 'npm run build:womens-tennis-seasons', noun: 'women\'s tennis' },
};
const args = process.argv.slice(2);
const unknown = args.filter(arg => arg !== '--check' && !/^--tour=/.test(arg));
if (unknown.length) throw new Error(`Unknown option ${unknown[0]}`);
const tourId = args.find(arg => arg.startsWith('--tour='))?.slice('--tour='.length) ?? 'atp';
const tour = TOURS[tourId];
if (!tour) throw new Error(`Unknown tour ${tourId}: atp or wta`);
const outDir = path.join(root, tour.out);
const listingFile = path.join(root, tour.listing);
const auditFile = path.join(root, tour.audit);
const attributionFile = path.join(outDir, 'ATTRIBUTION.txt');
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const PLAYER_PAGE = key => `https://www.tennisabstract.com/cgi-bin/${tour.page}?p=${encodeURIComponent(key).replace(/%27/g, "'")}`;
const seasonId = year => `${tour.prefix}-${year}`;

/** A season's players as teamsOf reads them, with each one's source as the season file holds it. */
function playersOf(snapshot, manifest, report) {
  const rules = manifest.nations;
  if (snapshot.kind === 'published') {
    // A key Tennis Abstract has since renamed ("StanislasWawrinka") is known, and linked, by its current one.
    const current = key => manifest.keyAliases[key] ?? key;
    return snapshot.players.map(([key, name, code, , , elo, , eloRank, tourRank]) => ({ name, elo, code, nation: nationIdOf(code, snapshot.season, rules),
      source: { id: `ta:${current(key)}`, source: 'tennis-abstract', edition: 'Tennis Abstract Elo', snapshotDate: report.updated, rawRating: elo,
        rawScale: 'Elo', eloRank, ...(tourRank != null ? { [tour.rankKey]: tourRank } : {}), url: PLAYER_PAGE(current(key)) } }));
  }
  return snapshot.players.map(([id, name, code, , , elo], i) => ({ name, elo, code, nation: nationIdOf(code, snapshot.season, rules),
    source: { id: tour.idOf(id), source: 'sackmann-elo', edition: 'Elo from match results', snapshotDate: snapshot.date, rawRating: elo, rawScale: 'Elo', eloRank: i + 1 } }));
}

/** Season `year`: its data set document and its audit row. */
function buildSeason(snapshot, manifest) {
  const year = snapshot.season;
  const rules = manifest.nations;
  const report = manifest.reports.find(entry => entry.season === year) ?? null;
  const rough = year >= manifest.seasons.rough[0] && year <= manifest.seasons.rough[1];
  const players = playersOf(snapshot, manifest, report);
  const names = new Set();
  for (const player of players) {
    // Two players of one name in one nation would be one player to the game: the files must never hold that.
    const key = `${player.nation} ${player.name}`;
    if (player.nation && names.has(key)) throw new Error(`${year}: two players named ${player.name} in ${player.nation}`);
    names.add(key);
  }
  const { nations, shift, left } = teamsOf(players, year, rules, tour.sport);
  const fielded = new Set(nations.map(nation => nation.id));
  const territory = territoryOf(year, fielded, rules);
  const label = report ? report.label ?? `Tennis Abstract Elo, ${MONTHS[Number(report.updated.slice(5, 7)) - 1]} ${report.updated.slice(0, 4)}`
    : `Elo from match results, end of ${year}${rough ? ' (rough)' : ''}`;
  const licence = manifest.licence.name;
  const source = report
    ? { edition: 'Tennis Abstract Elo', name: 'Tennis Abstract (Jeff Sackmann)', snapshotDate: report.updated, retrieved: manifest.archive.retrieved,
      url: `https://web.archive.org/web/${report.capture}/${report.original}`, rawScale: 'Elo', method: report.method ?? 'current', licence,
      listed: snapshot.listed, rated: snapshot.rated, ...(shift ? { shift } : {}) }
    : { edition: 'Elo from match results', name: tour.results, snapshotDate: snapshot.date,
      retrieved: manifest.archive.retrieved, url: `${manifest.archive.repository}/tree/${manifest.archive.commit}`, rawScale: 'Elo', computed: true,
      method: `Tennis Abstract's published Elo method (docs/design/${tourId === 'wta' ? 'womens-tennis' : 'tennis'}.md, "Earlier seasons")`, licence, rated: snapshot.rated,
      ...(shift ? { shift } : {}), ...(rough ? { rough: true } : {}) };
  const doc = {
    format: 1, kind: tour.kind, id: seasonId(year), version: '', year, season: String(year), label, local: false, source,
    nations: Object.fromEntries(nations.map(nation => [nation.id, [nation.str, nation.players, nation.squad.map(tupleOf)]])),
    clubs: [],
    territory,
    coverage: { rated: snapshot.rated, nations: nations.length, players: nations.reduce((n, nation) => n + nation.squad.length, 0) },
  };
  doc.version = `${doc.id}-${contentHash(doc)}`;
  const named = id => {
    const federation = federationOf(id, year, rules);
    const own = nationIdentity(id, tour.sport).name;
    return federation ? `${federation.name} (${own})` : own;
  };
  const howCounts = {};
  for (const row of snapshot.players) {
    const how = row[3].replace(/ \d{4}-\d{2}-\d{2}$/, '');
    howCounts[how] = (howCounts[how] || 0) + 1;
  }
  const top = players.slice(0, 5).map(player => `${player.name} ${player.code} ${player.elo} → ${gameRating(player.elo) - shift}`);
  const audit = {
    id: doc.id, version: doc.version, label, kind: snapshot.kind, date: source.snapshotDate, rated: snapshot.rated,
    ...(snapshot.kind === 'published' ? { listed: snapshot.listed, leftOffTheList: snapshot.left.map(([key, name, why]) => `${name}: ${why}`) } : {}),
    shift, over99: players.filter(player => gameRating(player.elo) > 99).map(player => `${player.name} ${player.elo} (${gameRating(player.elo)})`),
    top,
    nations: nations.map(nation => `${named(nation.id)} ${nation.str} (${nation.squad.map(player => `${player.name} ${player.rating}`).join(', ')}${nation.players > nation.squad.length ? `; +${nation.players - nation.squad.length}` : ''})`),
    merged: Object.entries(territory.merged).filter(([shape]) => !['SCO', 'WAL', 'NIR'].includes(shape)).map(([shape, holder]) => `${NATIONS[shape][0]} → ${named(holder)}`),
    nationFrom: howCounts,
    leftOut: {
      barred: left.barred.map(player => `${player.name} (${player.code})`),
      aloneInTheirNation: left.alone.map(player => `${player.name} (${player.code})`),
      noNationOnTheMap: left.offMap.map(player => `${player.name} (${player.code})`),
    },
  };
  return { doc, text: serializeFootballSet(doc), audit };
}

function listingModule(docs) {
  // The listing quotes each label in single quotes.
  for (const doc of docs) if (/['\\]/.test(doc.label)) throw new Error(`${doc.id}: a label may not hold a quote or a backslash`);
  const rows = docs.map(doc => `  Object.freeze({ id: '${doc.id}', version: '${doc.version}', year: ${doc.year}, season: '${doc.season}', label: '${doc.label}' }),`);
  const about = tourId === 'wta'
    ? `// The built-in earlier women's tennis seasons, newest first: the WTA's women by Elo at the end of each year, the Fed Cup's
// nations only. Each is public/womens-tennis/<id>.json, loaded when a setup chooses it (src/engine/footballSets.js).`
    : `// The built-in earlier tennis seasons, newest first: the ATP's men by Elo at the end of each year, the Davis Cup's nations
// only. Each is public/tennis/<id>.json, loaded when a setup chooses it (src/engine/footballSets.js).`;
  return `// GENERATED by ${tour.command}; do not edit.
${about}
export const ${tour.listingName} = Object.freeze([
${rows.join('\n')}
]);
`;
}

function attributionText(manifest) {
  const { archive, licence } = manifest;
  return tourId === 'wta' ? `Women's tennis seasons 1973-2025 (wta-<year>.json): attribution and licence
===========================================================================

The ratings in these files are Jeff Sackmann's (Tennis Abstract), or are derived from his data.

- 2016-2025: Tennis Abstract's own year-end WTA Elo reports (https://tennisabstract.com/reports/wta_elo_ratings.html),
  read from the Internet Archive's Wayback Machine captures named in each file's source; each woman's country from
  Tennis Abstract's WTA rankings report of the nearest date.
- 1973-2015: Elo computed by this project from Jeff Sackmann's WTA match results
  (${archive.upstream}, as archived at ${archive.repository}, commit ${archive.commit})
  by the method Tennis Abstract has published; see docs/design/womens-tennis.md, "Earlier seasons". These are not
  Tennis Abstract's own numbers.

Credit: ${licence.credit}.
Licence: ${licence.name} (${licence.url}). ${licence.terms}
Non-commercial: these files may not be used for commercial purposes.
` : `Tennis seasons 1973-2025 (tennis-<year>.json): attribution and licence
=====================================================================

The ratings in these files are Jeff Sackmann's (Tennis Abstract), or are derived from his data.

- 2016-2025: Tennis Abstract's own year-end ATP Elo reports (https://tennisabstract.com/reports/atp_elo_ratings.html),
  read from the Internet Archive's Wayback Machine captures named in each file's source; each man's country from
  Tennis Abstract's ATP rankings report of the nearest date.
- 1973-2015: Elo computed by this project from Jeff Sackmann's ATP match results
  (${archive.upstream}, as mirrored at ${archive.repository}, commit ${archive.commit})
  by the method Tennis Abstract has published; see docs/design/tennis.md, "Earlier seasons". These are not Tennis
  Abstract's own numbers.

Credit: ${licence.credit}.
Licence: ${licence.name} (${licence.url}). ${licence.terms}
Non-commercial: these files may not be used for commercial purposes.
`;
}

async function main() {
  const check = args.includes('--check');
  const manifest = JSON.parse(await readFile(path.join(root, tour.manifest), 'utf8'));
  const validation = JSON.parse(await readFile(path.join(root, tour.snapshots, 'validation.json'), 'utf8'));
  const years = [];
  for (let year = manifest.seasons.computed[0]; year <= manifest.seasons.published[1]; year++) years.push(year);
  const results = [];
  for (const year of years) {
    const file = path.join(root, tour.snapshots, `${year}.json`);
    if (!existsSync(file)) throw new Error(`No snapshot for ${year}: run ${tour.sync}`);
    const snapshot = JSON.parse(await readFile(file, 'utf8'));
    if (snapshot.season !== year) throw new Error(`${tour.snapshots}/${year}.json is the ${snapshot.season} season`);
    results.push(buildSeason(snapshot, manifest));
  }
  results.sort((a, b) => b.doc.year - a.doc.year);
  for (const { doc, text, audit } of results) {
    console.log(`${doc.id} ${doc.label}: ${Object.keys(doc.nations).length} nations, ${doc.coverage.players} players of ${doc.coverage.rated} rated`
      + `${audit.shift ? `, shifted ${audit.shift}` : ''}, ${Math.round(Buffer.byteLength(text) / 1024)} KB; ${audit.nations.slice(0, 3).map(n => n.replace(/ \(.*$/, '')).join(', ')}`);
  }
  const audit = {
    generatedBy: `scripts/build-tennis-seasons.mjs${tourId === 'atp' ? '' : ` --tour=${tourId}`}`, licence: manifest.licence,
    method: { ...manifest.method, targets: undefined }, validation,
    shifted: results.filter(result => result.audit.shift).map(result => `${result.doc.season}: ${result.audit.shift} (${result.audit.over99.join(', ')})`),
    seasons: results.map(result => result.audit),
  };
  const outputs = [
    ...results.map(({ doc, text }) => [path.join(outDir, `${doc.id}.json`), text]),
    [attributionFile, attributionText(manifest)],
    [listingFile, listingModule(results.map(result => result.doc))],
    [auditFile, `${JSON.stringify(audit, null, 2)}\n`],
  ];
  if (check) {
    const differs = [];
    for (const [file, text] of outputs) {
      const current = existsSync(file) ? (await readFile(file, 'utf8')).replace(/\r\n/g, '\n') : null;
      if (current !== text) differs.push(path.relative(root, file));
    }
    if (differs.length) throw new Error(`differs: ${differs.join(', ')}`);
    console.log(`Verified the ${results.length} ${tour.noun} seasons, their listing, attribution and audit byte for byte.`);
    return;
  }
  await mkdir(outDir, { recursive: true });
  for (const [file, text] of outputs) await writeFile(file, text);
  console.log(`Wrote ${results.length} seasons to ${tour.out}/, ${tour.listing} and ${tour.audit}`);
}

main().catch(error => {
  console.error(`build-tennis-seasons: ${error.message}`);
  process.exitCode = 1;
});
