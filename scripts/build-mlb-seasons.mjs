// Build the built-in earlier baseball seasons: MLB The Show's Live series (docs/design/baseball.md, "Earlier seasons")
// and, before it, the seasons computed from WAR (docs/design/baseball.md, "Seasons before 2018: computed from WAR").
//
//   npm run build:mlb-seasons             writes public/baseball/mlb-the-show-<nn>.json, mlb-war-<year>.json and
//                                         ATTRIBUTION.txt, src/data/baseballSeasons.js,
//                                         docs/design/baseball-seasons-audit.json and baseball-war-seasons-audit.json
//   npm run build:mlb-seasons -- --check  builds every file and compares it byte for byte, writes nothing
//
// Each MLB The Show season is one edition's committed snapshot (scripts/data/mlb-the-show-<nn>.json: npm run
// sync:mlb-the-show -- --edition=<nn> from Sony's API, or npm run import:mlb-showzone for the editions only ShowZone
// keeps), the edition's last roster update: its MLB clubs and its nations by birthplace, built by the same rules as the
// built-in season (scripts/lib/mlb.mjs). The teams are today's (scripts/data/mlb-teams.json) but for the eras
// scripts/data/mlb-seasons.json names; each season names the era map its clubs play on, which npm run build:mlb-map
// builds from the same manifest. Every rating is The Show's, unchanged.
//
// Each season from 1960 to 2017 is its committed snapshot (scripts/data/mlb-war-seasons/<year>.json, npm run
// import:mlb-war): every player's score, mapped rank for rank within his role onto MLB The Show 18 to 24's overalls
// (scripts/data/mlb-war-reference.json, scripts/lib/mlb-war.mjs), then teamed by the same rules, its clubs those of the
// franchise eras of scripts/data/mlb-war-seasons.json and its nations by the Baseball Databank's birth country.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { HOME_NATIONS } from '../src/data/teams.js';
import { CLUBS } from '../src/data/clubs.baseball.js';
import { contentHash, serializeFootballSet } from '../src/data/footballSetBuild.js';
import { fieldedNations } from '../src/engine/footballSets.js';
import { baseball } from '../src/sports/baseball.js';
import {
  checkTeams, clubsOf, colourFor, editionOf, mapOf, nationOfBirthplace, nationsOf, nearestBirthplace, playerOf, seasonIdOf, teamsOf,
  trustsBirthplace, tupleOf,
} from './lib/mlb.mjs';
import { nationOfBirthCountry, rateByRank, teamsOfWar, warLabelOf, warMapOf, warScoreOf, warSeasonIdOf } from './lib/mlb-war.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outDir = path.join(root, 'public/baseball');
const listingFile = path.join(root, 'src/data/baseballSeasons.js');
const auditFile = path.join(root, 'docs/design/baseball-seasons-audit.json');
const warAuditFile = path.join(root, 'docs/design/baseball-war-seasons-audit.json');
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

// A computed season's players: rating first, then score, then id, so a name never decides who makes a squad. (Within a
// squad, rosterOf orders equal ratings by name, so the lineup may start one of two equally rated players by name: the
// same strength either way.)
const byRatingThenScore = (a, b) => b.rating - a.rating || b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const pearson = (xs, ys) => {
  const mean = list => list.reduce((s, v) => s + v, 0) / list.length;
  const mx = mean(xs), my = mean(ys);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < xs.length; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
  return sxy / Math.sqrt(sxx * syy);
};

/**
 * The computed season of `year` from its snapshot (scripts/data/mlb-war-seasons/<year>.json): its data set document and
 * audit row. `manifest` is scripts/data/mlb-war-seasons.json, `reference` scripts/data/mlb-war-reference.json.
 */
function buildWarSeason(snapshot, year, manifest, franchises, reference) {
  if (snapshot.season !== year) throw new Error(`scripts/data/mlb-war-seasons/${year}.json is the ${snapshot.season} season`);
  const colours = new Map(CLUBS.map(club => [club.id, club.col]));
  const teams = teamsOfWar(franchises, manifest, year).map(team => ({ ...team, show: team.war, col: colours.get(team.id) ?? colourFor(team.id) }));
  // The eras are the season's clubs: the Databank's codes and names, each at the ballpark the Databank has it play most at
  // home.
  const codes = Object.keys(snapshot.teams);
  const missing = codes.filter(code => !teams.some(team => team.war === code)), extra = teams.filter(team => !snapshot.teams[team.war]);
  if (missing.length || extra.length || codes.length !== snapshot.clubs) {
    throw new Error(`${year}: the eras' clubs are not the season's (missing ${missing.join(', ') || 'none'}; extra ${extra.map(t => t.war).join(', ') || 'none'})`);
  }
  for (const team of teams) {
    const databank = snapshot.teams[team.war];
    if ((team.databankName ?? team.name) !== databank.name) throw new Error(`${year}: ${team.war} is the Databank's ${databank.name}, not the ${team.name}`);
    if (team.park !== databank.park) throw new Error(`${year}: the ${team.name} played most at home at ${databank.park}, not ${team.park}`);
  }
  const rows = snapshot.players.map(([id, name, alias, club, role, positions, score, war, use, li, born]) => ({ id, name, alias, club, role, positions: positions.split('/'), score, war, use, li, born }));
  for (const row of rows) {
    if (warScoreOf(row, manifest.method) !== row.score) throw new Error(`${year}: ${row.name}'s score ${row.score} is not his inputs' (${warScoreOf(row, manifest.method)})`);
  }
  const ratings = rateByRank(rows, reference.reference, teams.length, reference.teamSeasons);
  const players = rows.map(row => ({ id: row.id, name: row.name, alias: row.alias, team: row.club, pos: row.positions[0], positions: row.positions,
    rating: ratings.get(row.id), score: row.score, nation: nationOfBirthCountry(row.born, manifest.nations), born: row.born }));
  // A club of the 1960s to 1980s that used fewer than thirteen pitchers all season keeps every one it used.
  const teamUp = () => ({ clubs: clubsOf(players, teams, { order: byRatingThenScore, fewerPitchers: true }), nations: nationsOf(players, byRatingThenScore) });
  let { clubs, nations } = teamUp();
  // Namesakes who share a squad are told apart: the best of them keeps the name, the others take the names that tell
  // them apart (a middle initial, else a birth year: Pedro Martinez of 1968 in the Dominican Republic's squad of 1993).
  const repeatedIn = teams => {
    const repeated = new Set();
    for (const squad of teams.map(team => team.squad)) {
      const seen = new Set();
      for (const p of squad) { if (seen.has(p.name)) repeated.add(p.name); seen.add(p.name); }
    }
    return repeated;
  };
  const repeated = repeatedIn([...clubs, ...nations]);
  const renamed = [];
  if (repeated.size) {
    for (const name of [...repeated].sort()) {
      const [, ...others] = players.filter(player => player.name === name).sort(byRatingThenScore);
      for (const p of others) {
        if (!p.alias) throw new Error(`${year}: nothing tells ${p.name} (${p.id}) apart from his namesake`);
        renamed.push(`${p.name} (${p.id}) → ${p.alias}`);
        p.name = p.alias;
      }
    }
    ({ clubs, nations } = teamUp());
    const still = repeatedIn([...clubs, ...nations]);
    if (still.size) throw new Error(`${year}: squads still repeat ${[...still].join(', ')}`);
  }
  const source = {
    provider: 'Neil Paine (JEFFBAGWELL WAR) and the Chadwick Baseball Bureau (Baseball Databank)',
    edition: 'Computed from WAR',
    name: 'JEFFBAGWELL WAR (Neil Paine) and the Baseball Databank (Chadwick Baseball Bureau)',
    computed: true,
    method: manifest.seasonSource.method,
    conversion: manifest.seasonSource.conversion,
    licence: manifest.seasonSource.licence,
    url: manifest.sources.war.url,
    retrieved: manifest.seasonSource.retrieved,
    rawScale: 'WAR',
  };
  const doc = {
    format: 1, kind: 'show', id: warSeasonIdOf(year), version: '', year, season: String(year), label: warLabelOf(year), local: false,
    source,
    map: warMapOf(manifest, year),
    nations: Object.fromEntries(nations.map(n => [n.id, [n.str, n.squad.length, n.squad.map(tupleOf)]])),
    clubs: clubs.map(c => ({ id: c.id, name: c.name, code: c.code, league: 'MLB', country: '840', col: c.col, str: c.str, squad: c.squad.map(tupleOf) })),
    // As in every baseball season, the home nations play as the United Kingdom.
    territory: { merged: Object.fromEntries(HOME_NATIONS.map(id => [id, '826'])), inactive: [] },
    coverage: { players: rows.length, clubs: clubs.length, nations: nations.length },
  };
  doc.version = `${doc.id}-${contentHash(doc)}`;
  // Which nations field a team, by the game's own rule (fieldedNations): those whose own players hold half the lineup.
  const fielded = fieldedNations({ ...baseball, rosters: doc.nations, clubs: doc.clubs, territory: doc.territory });
  const databankOf = id => snapshot.teams[teams.find(t => t.id === id).war];
  const record = code => snapshot.teams[code].w / (snapshot.teams[code].w + snapshot.teams[code].l);
  const strength = new Map(clubs.map(c => [c.id, c.str]));
  const best = rows.filter(row => row.role === 'H').sort((a, b) => ratings.get(b.id) - ratings.get(a.id) || b.score - a.score).slice(0, 5)
    .concat(rows.filter(row => row.role !== 'H').sort((a, b) => ratings.get(b.id) - ratings.get(a.id) || b.score - a.score).slice(0, 3));
  const audit = {
    id: doc.id, version: doc.version, map: doc.map, players: rows.length,
    clubs: clubs.map(c => `${c.name} ${c.str} (${databankOf(c.id).w}-${databankOf(c.id).l})`),
    strengthVsRecord: Math.round(pearson(teams.map(t => strength.get(t.id)), teams.map(t => record(t.war))) * 1000) / 1000,
    best: best.map(row => `${players.find(p => p.id === row.id).name} ${row.positions[0]} ${ratings.get(row.id)}`),
    nations: nations.map(n => `${n.name} ${n.str} (${n.squad.length}${n.open.length ? `; the game fills ${n.open.join(' ')}` : ''})`),
    fielded: nations.filter(n => fielded.includes(n.id)).map(n => n.name),
    noNation: players.filter(p => p.nation == null).map(p => `${p.name} (${p.id}): ${p.born ? `born in ${p.born}, no nation of the game` : 'no birthplace'}`),
    renamed,
  };
  return { doc, text: serializeFootballSet(doc), audit };
}

/**
 * public/baseball/ATTRIBUTION.txt: the computed seasons' sources, their licences, and the notices they require (the WAR
 * file's MIT licence, the Baseball Databank's CC BY-SA 3.0 statement and Retrosheet's notice, in their own words).
 */
function attributionText(manifest, docs) {
  const { war, databank, wikipedia } = manifest.sources;
  const indent = text => text.split('\n').map(line => (line ? `  ${line}` : '')).join('\n');
  const corrected = Object.values(manifest.birthCountries || {});
  const correctedNames = corrected.map(fix => fix.name).join(', ');
  const correctedPlaces = corrected.map(fix => `${fix.name}'s, ${fix.birthplace}, ${fix.country}`).join('; ');
  const years = docs.map(doc => doc.year);
  return `Baseball seasons ${Math.min(...years)}-${Math.max(...years)} (mlb-war-<year>.json): attribution and licence
${'='.repeat(78)}
Generated by scripts/build-mlb-seasons.mjs from scripts/data/mlb-war-seasons.json; do not edit.

The ratings in these files are computed by this project from the players' WAR (docs/design/baseball.md, "Seasons
before 2018: computed from WAR"): each player's WAR per playing time over three seasons, put rank for rank on
MLB The Show 18 to 24's scale. No game rated these seasons, and these are not any game's ratings.

WAR: ${war.name} by ${war.author} (${war.repository}),
  file ${war.file} at commit ${war.commit}.
  JEFFBAGWELL averages Baseball-Reference.com's WAR (Sports Reference LLC) and FanGraphs' WAR: the WAR is
  theirs. Neither site was read for these seasons.
  Licence: ${war.licence}.

${indent(war.licenceText)}

Names, given names and birth countries of the players, and the clubs' codes, names, records and ballparks:
  the ${databank.name} by the ${databank.publisher} (${databank.repository}),
  at its last commit ${databank.commit}, read from ${databank.copy}
  (the Bureau's own repository is no longer on GitHub). Changes: only each player's name, given names, birth
  year and birth country and each club's name, record and main ballpark are taken, joined to the WAR as
  described above; ${corrected.length === 1 ? 'one birth country is' : `${corrected.length} birth countries are`} corrected (${correctedNames}, below). The Databank is historically based in
  part on the Lahman Baseball Database, version 2015-01-24, Copyright (C) 1996-2015 by Sean Lahman (CC BY-SA 3.0).
  Licence: ${databank.licence}.
  These season files, derived from it, are shared under the same licence, CC BY-SA 3.0, as are the
  snapshots they are built from (scripts/data/mlb-war-seasons/). In the Databank's words:

${indent(databank.licenceText)}

${indent(databank.retrosheetText)}

Ballpark names of the day, the locations of the ballparks of the 1960s and 1970s on the maps of those
  seasons (public/domestic/mlb<year>.json), and the birthplace of each player whose birth country the Databank
  gets wrong (${correctedPlaces}):
  ${wikipedia.name} (CC BY-SA 4.0), only facts taken from each article's infobox; each article's revision is
  pinned in scripts/data/mlb-war-seasons.json.
`;
}

function listingModule(docs) {
  const rows = docs.map(doc => `  Object.freeze({ id: '${doc.id}', version: '${doc.version}', year: ${doc.year}, season: '${doc.season}', label: '${doc.label}', map: '${doc.map}' }),`);
  return `// GENERATED by npm run build:mlb-seasons from MLB The Show's Live series (scripts/data/mlb-seasons.json) and, before
// 2018, the seasons computed from WAR (scripts/data/mlb-war-seasons.json).
// The built-in earlier baseball seasons, newest first: each edition's nations and MLB clubs at its last roster update,
// then each computed season's. Each is public/baseball/<id>.json, loaded when a setup chooses it
// (src/engine/footballSets.js); its clubs play on their era's map (\`map\`, public/domestic/<map>.json).
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
  // The seasons computed from WAR, newest first.
  const warManifest = JSON.parse(await readFile(path.join(root, 'scripts/data/mlb-war-seasons.json'), 'utf8'));
  const reference = JSON.parse(await readFile(path.join(root, 'scripts/data/mlb-war-reference.json'), 'utf8'));
  const warResults = [];
  for (let year = warManifest.seasons.to; year >= warManifest.seasons.from; year--) {
    const file = path.join(root, `scripts/data/mlb-war-seasons/${year}.json`);
    if (!existsSync(file)) throw new Error(`No snapshot for ${year}: run npm run import:mlb-war`);
    warResults.push(buildWarSeason(JSON.parse(await readFile(file, 'utf8')), year, warManifest, franchises, reference));
  }
  for (const { doc, text, audit } of warResults) {
    console.log(`${doc.id} on ${doc.map}: ${doc.clubs.length} clubs (record r ${audit.strengthVsRecord}), ${audit.fielded.length} of ${audit.nations.length} nations field a team, `
      + `${Math.round(Buffer.byteLength(text) / 1024)} KB; strongest ${audit.clubs.slice(0, 3).join(', ')}; best ${audit.best.slice(0, 3).join(', ')}`);
  }
  const all = [...results, ...warResults];
  const outputs = [
    ...all.map(({ doc, text }) => [path.join(outDir, `${doc.id}.json`), text]),
    [path.join(outDir, 'ATTRIBUTION.txt'), attributionText(warManifest, warResults.map(result => result.doc))],
    [listingFile, listingModule(all.map(result => result.doc))],
    [auditFile, `${JSON.stringify({ generatedBy: 'scripts/build-mlb-seasons.mjs', source: manifest.source, seasons: results.map(r => r.audit) }, null, 2)}\n`],
    [warAuditFile, `${JSON.stringify({ generatedBy: 'scripts/build-mlb-seasons.mjs', source: warResults[0].doc.source,
      reference: { years: reference.years, cards: reference.cards, byRole: reference.byRole, leaveOneOut: { players: reference.leaveOneOut.players,
        roles: reference.leaveOneOut.roles, clubs: reference.leaveOneOut.clubs } },
      seasons: warResults.map(r => r.audit) }, null, 2)}\n`],
  ];
  if (check) {
    const differs = [];
    for (const [file, text] of outputs) {
      const current = existsSync(file) ? (await readFile(file, 'utf8')).replace(/\r\n/g, '\n') : null;
      if (current !== text) differs.push(path.relative(root, file));
    }
    if (differs.length) throw new Error(`differs: ${differs.join(', ')}`);
    console.log(`Verified the ${all.length} baseball seasons (${results.length} from MLB The Show, ${warResults.length} computed from WAR), their listing and audits byte for byte.`);
    return;
  }
  await mkdir(outDir, { recursive: true });
  for (const [file, text] of outputs) await writeFile(file, text);
  console.log(`Wrote ${all.length} seasons to public/baseball/, src/data/baseballSeasons.js, docs/design/baseball-seasons-audit.json and docs/design/baseball-war-seasons-audit.json`);
}

main().catch(error => {
  console.error(`build-mlb-seasons: ${error.message}`);
  process.exitCode = 1;
});
