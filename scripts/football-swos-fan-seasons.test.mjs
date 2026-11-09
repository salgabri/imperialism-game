// The built-in football seasons of 1995/96 and 1994/95 from Sensible World of Soccer's own team files, with their clubs,
// and the two fan-made Championship Manager databases the user chose to ship, 1993/94 (Cam F) and 1989/90 (Simon
// Treanor, nations only) (docs/design/football-years.md, "SWOS 94/95 and 95/96" and "The fan-made databases"): the
// committed files against their manifest, listing, maps and federations; the team file reader and the club builder on
// invented records; the East German clubs rebuilt from their sources when they are in data-src/; and the running App
// launching and resuming a 1995/96 clubs campaign and a 1989/90 nations campaign as the Soviet Union.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { SAVE_KEY } from '../src/config.js';
import { NATIONS } from '../src/data/teams.js';
import { BUILT_IN_SEASONS } from '../src/data/footballSeasons.js';
import { EUROPE_MAPS } from '../src/data/europeMaps.js';
import { ELITE_CLUBS, TOP_CLUBS, strongestClubs } from '../src/data/scopes.js';
import { europeMapsOf } from '../src/data/domesticScope.js';
import { SWOS_PRICES, SWOS_SCALE, SWOS_CONVERSION, swosGameRating } from '../src/data/swosPlayers.js';
import { CM_CONVERSION } from '../src/data/cmPlayers.js';
import { CM0102_RELEASES } from '../src/data/cm0102Releases.js';
import { FOOTBALL_FEDERATIONS } from '../src/data/footballFederations.js';
import { contentHash, identitiesFor, territoryFor } from '../src/data/footballSetBuild.js';
import { readCm0102 } from '../src/data/cm0102.js';
import { decodeFootballSet, fieldedNations, seasonSport, setHasClubs, setKindOf } from '../src/engine/footballSets.js';
import { parseCampaign } from '../src/engine/storage.js';
import { SWOS_CLUBS, SWOS_LEAGUES, buildSwosSeason, properCase } from './lib/swos.mjs';
import { SWOS_NATIONALITIES, readTeamFile, swosFileId, swosRows } from './lib/swos-files.mjs';
import { EAST_GERMAN_BY_HAND, eastGermanClubs, germanPlaces } from './lib/east-german-clubs.mjs';
import { bundleComponents, syncAppFixture } from './lib/app-harness.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = file => readFileSync(path.join(root, file), 'utf8');
const MANIFEST = JSON.parse(read('scripts/data/retro-seasons.json'));
const committed = id => JSON.parse(read(`public/football/${id}.json`));
const IDS = ['swos-9596', 'swos-9495', 'cm0102-2020-11-cm93', 'cm0102-2017-04-cm89'];
const SWOS = ['swos-9596', 'swos-9495'];
const FAN = { 'cm0102-2020-11-cm93': 'Cam F', 'cm0102-2017-04-cm89': 'Simon Treanor' };
const entry = id => MANIFEST.seasons.find(season => season.id === id);
const slug = name => name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// ---------- the committed seasons ----------

test('the four seasons are built in, newest first, each its committed file, credited to its makers and pinned', () => {
  assert.deepEqual(MANIFEST.seasons.map(season => season.id).filter(id => IDS.includes(id)), IDS);
  const listed = IDS.map(id => BUILT_IN_SEASONS.find(set => set.id === id));
  assert.deepEqual(listed.map(set => [set.id, set.year, set.season, set.label]), [
    ['swos-9596', 1996, '1995/96', 'SWOS 95/96'], ['swos-9495', 1995, '1994/95', 'SWOS 94/95'],
    ['cm0102-2020-11-cm93', 1994, '1993/94', 'CM 01/02 · 93/94 by Cam F, fan-made'],
    ['cm0102-2017-04-cm89', 1990, '1989/90', 'CM 01/02 · 89/90 by Simon Treanor, fan-made']]);
  for (const [i, id] of IDS.entries()) {
    const doc = committed(id), season = entry(id);
    assert.deepEqual([doc.id, doc.version, doc.year, doc.season, doc.label], [listed[i].id, listed[i].version, listed[i].year, listed[i].season, listed[i].label]);
    assert.equal(doc.version, `${doc.id}-${contentHash(doc)}`, `${id} is the file its version names`);
    assert.equal(setKindOf(id), season.kind);
    assert.equal(doc.local, false);
    assert.equal(doc.source.provider, season.maker);
    assert.equal(doc.source.compiler, season.compiler);
    assert.equal(doc.source.retrieved, MANIFEST.retrieved);
    assert.ok(season.rights.trim() && season.provenance.trim(), id);
    for (const file of season.files || [season.file]) {
      assert.match(file.sha256, /^[0-9a-f]{64}$/);
      assert.ok(Number.isInteger(file.bytes) && file.bytes > 0);
    }
  }
  // SWOS's files come from the SWOS United server, each pinned by its SHA-256 (the server has no commits).
  for (const id of SWOS) {
    const season = entry(id);
    assert.equal(season.reader, 'swos-files');
    assert.deepEqual(season.files.map(file => file.name), ['008', '013', '014', '020', '025', '029', '035', '080', '081', '082', '083', '084', '085'].map(n => `TEAM.${n}`));
    const edition = id === 'swos-9495' ? 'v1.0' : '9596';
    assert.ok(season.files.every(file => file.download === `https://cern.swos.eu/data/amiga/${edition}/${file.name}` && file.folder === id));
  }
  // The fan databases are the Starter Kit's zips at its pinned commit, their makers and fans' ratings named.
  for (const [id, maker] of Object.entries(FAN)) {
    const season = entry(id), doc = committed(id);
    assert.match(season.file.download, /^https:\/\/raw\.githubusercontent\.com\/nckstwrt\/CM0102-Starter-Kit\/e658af1696751535f678e19342c6e345efdbe8ec\/data\/cm(93|89)_data\.zip$/);
    assert.match(doc.label, /fan-made/);
    assert.match(doc.source.provenance, /^Fan-made: its players' abilities are/);
    assert.match(season.rights, new RegExp(`credited to ${maker}`));
    const release = CM0102_RELEASES.find(r => r.id === id);
    assert.deepEqual([doc.source.provider, doc.source.version, doc.source.url, doc.source.dobShift, doc.source.conversion],
      [maker, release.label, release.url, 0, CM_CONVERSION]);
  }
});

const COVERAGE = {
  'swos-9596': { players: 2926, nations: 132, completeXIs: 132, clubs: 134, leagues: 7 },
  'swos-9495': { players: 2915, nations: 131, completeXIs: 131, clubs: 134, leagues: 7 },
  'cm0102-2020-11-cm93': { players: 2266, nations: 124, completeXIs: 77, clubs: 130, leagues: 7 },
  'cm0102-2017-04-cm89': { players: 1205, nations: 137, completeXIs: 88, clubs: 0, leagues: 0 },
};

test('each season decodes, with the nations and clubs its source rates; 1989/90 has nations only', () => {
  for (const id of IDS) {
    const doc = committed(id);
    const set = decodeFootballSet(doc);
    assert.deepEqual(doc.coverage, COVERAGE[id], id);
    assert.equal(Object.keys(set.rosters).length, Object.keys(NATIONS).length, id);
    assert.ok(set.clubs.every(club => club.squad.length === 11), `${id}: every club fields eleven`);
  }
  assert.deepEqual(IDS.filter(id => !setHasClubs(id)), ['cm0102-2017-04-cm89']);
  assert.deepEqual(committed('cm0102-2017-04-cm89').clubs, []);
  // SWOS's top divisions, league by league: 1994/95 had 22 clubs in England, 1995/96 22 in Spain.
  const perLeague = id => Object.fromEntries(Object.values(SWOS_LEAGUES).map(([league]) => [league, committed(id).clubs.filter(club => club.league === league).length]));
  assert.deepEqual(perLeague('swos-9495'), { 'Premier League': 22, 'La Liga': 20, 'Serie A': 18, Bundesliga: 18, 'Ligue 1': 20, Eredivisie: 18, 'Liga Portugal': 18 });
  assert.deepEqual(perLeague('swos-9596'), { 'Premier League': 20, 'La Liga': 22, 'Serie A': 18, Bundesliga: 18, 'Ligue 1': 20, Eredivisie: 18, 'Liga Portugal': 18 });
});

test('SWOS\'s ratings are its price steps, converted as 96/97\'s; its clubs keep their ids from season to season', () => {
  for (const id of SWOS) {
    const doc = committed(id);
    const set = decodeFootballSet(doc);
    for (const [, , rating, info] of [...Object.values(set.rosters).flatMap(([, , squad]) => squad), ...set.clubs.flatMap(club => club.squad)]) {
      assert.deepEqual([info.source, info.rawScale, info.conversion, rating], ['swos', SWOS_SCALE, SWOS_CONVERSION, swosGameRating(info.rawRating)]);
      assert.ok(info.rawRating >= 1 && info.rawRating <= 48, 'steps 0 and 49 read as the 96/97 database stores them');
    }
    // Every club takes a name of SWOS_CLUBS, whose slug is its id.
    const names = new Set(Object.values(SWOS_CLUBS));
    assert.ok(doc.clubs.every(club => names.has(club.name) && club.id === `f-${slug(club.name)}`), id);
  }
  // A club SWOS names in both seasons keeps one id, and every club that plays on a map has a ground row.
  const places = JSON.parse(read('scripts/data/europe-clubs.json')).clubs;
  for (const name of Object.values(SWOS_CLUBS)) {
    const id = `f-${slug(name)}`;
    const onMap = SWOS.some(season => strongestClubs(committed(season).clubs, TOP_CLUBS).some(club => club.id === id));
    if (onMap) assert.ok(places[id], `${id} has a ground row`);
  }
  assert.equal(new Set(Object.values(SWOS_CLUBS)).size, Object.keys(SWOS_CLUBS).length, 'one name a club');
  // Known squads of the day: Klinsmann at Tottenham in 1994/95, then at Bayern; Romário and Baggio at SWOS's top step.
  const at = (id, who) => committed(id).clubs.filter(club => club.squad.some(tuple => tuple[1] === who)).map(club => club.name);
  assert.deepEqual(at('swos-9495', 'Jurgen Klinsmann'), ['Tottenham Hotspur']);
  assert.deepEqual(at('swos-9596', 'Jurgen Klinsmann'), ['FC Bayern München']);
  assert.deepEqual(at('swos-9495', 'Eric Cantona'), ['Manchester United']);
  const romario = committed('swos-9495').clubs.find(club => club.name === 'FC Barcelona').squad.find(tuple => tuple[1] === 'Romario');
  assert.deepEqual(romario.slice(3, 6), [48, 'a', 'BRA'], 'his step 49 read as 48; a club player keeps his SWOS code');
  assert.equal(committed('swos-9495').nations['380'][2].find(tuple => tuple[1] === 'Roberto Baggio')[3], 48);
  // Players SWOS files at two top-division clubs (mostly namesakes): each club keeps its own sixteen.
  const audits = JSON.parse(read('docs/design/football-retro-seasons-audit.json')).seasons;
  const collisions = id => audits.find(season => season.id === id).audit.collisions;
  assert.deepEqual([collisions('swos-9495').length, collisions('swos-9596').length], [18, 20]);
  assert.ok(collisions('swos-9495').includes('MARTIN KREE (Bayer 04 Leverkusen, Borussia Dortmund)'));
});

test('each season with clubs plays on its own two Europe maps', () => {
  const places = JSON.parse(read('scripts/data/europe-clubs.json')).clubs;
  for (const id of ['swos-9596', 'swos-9495', 'cm0102-2020-11-cm93']) {
    const doc = committed(id);
    const maps = europeMapsOf(id);
    assert.deepEqual(maps.map(map => [map.id, map.clubs, map.theatre, map.seasons]),
      [[`eu124s${doc.year}`, TOP_CLUBS, 'all', [id]], [`eu32s${doc.year}`, ELITE_CLUBS, 'elite', [id]]], id);
    for (const [count, map] of [[TOP_CLUBS, maps[0]], [ELITE_CLUBS, maps[1]]]) {
      const file = JSON.parse(read(`public/domestic/${map.id}.json`));
      assert.equal(file.version, map.version);
      assert.deepEqual(file.clubs.map(club => club.id), strongestClubs(doc.clubs, count).map(club => club.id), map.id);
      assert.ok(file.clubs.every(club => places[club.id] && club.shape === doc.clubs.find(c => c.id === club.id).country), map.id);
    }
  }
  assert.deepEqual(europeMapsOf('cm0102-2017-04-cm89'), []);
  assert.ok(!EUROPE_MAPS.some(map => map.seasons?.includes('cm0102-2017-04-cm89')));
});

// ---------- federations ----------

test('the federations of each season\'s day, as far as its source fields them', () => {
  const territory = id => committed(id).territory;
  const inactive = (id, shape) => territory(id).inactive.includes(shape);
  // 1994/95: SWOS has no Yugoslavia squad, so FR Yugoslavia's Montenegro and Kosovo are neutral with Serbia.
  assert.deepEqual(committed('swos-9495').nations['688'], [40, 0, []]);
  const squad95 = shape => committed('swos-9495').nations[shape]?.[2].length > 0;
  assert.deepEqual(territory('swos-9495'), territoryFor(FOOTBALL_FEDERATIONS, 1995, { fields: squad95 }));
  assert.ok(inactive('swos-9495', '499') && inactive('swos-9495', 'KOS') && !('identities' in committed('swos-9495')));
  // 1995/96: FR Yugoslavia plays under its own name and flag, holding Montenegro and Kosovo.
  assert.deepEqual(committed('swos-9596').identities, { 688: { name: 'FR Yugoslavia', code: 'YUG', flagId: 'FRY' } });
  assert.deepEqual([territory('swos-9596').merged['499'], territory('swos-9596').merged.KOS], ['688', '688']);
  // Bosnia joined FIFA on 3 July 1996: neutral in both.
  assert.ok(SWOS.every(id => inactive(id, '070')));
  // 1993/94: Zaire alone has an identity; FR Yugoslavia is barred, the Czech Republic and Slovakia play apart, North
  // Macedonia (16 June 1994) and the seven FIFA joiners of 1994 play.
  const cm93 = committed('cm0102-2020-11-cm93');
  assert.deepEqual(cm93.identities, { 180: { name: 'Zaire', code: 'ZAI', flagId: 'ZAI' } });
  assert.ok(['688', '499', 'KOS'].every(shape => cm93.territory.inactive.includes(shape)));
  const sport93 = seasonSport(decodeFootballSet(cm93));
  for (const shape of ['203', '703', '807', '031', '398', '417', '498', '762', '795', '860']) {
    assert.ok(!cm93.territory.inactive.includes(shape) && !Object.hasOwn(cm93.territory.merged, shape), shape);
  }
  assert.ok(fieldedNations(sport93).includes('203') && fieldedNations(sport93).includes('703'));
  // 1989/90: the Soviet Union, Yugoslavia, Czechoslovakia and West Germany, and Zaire, which the database rates.
  const cm89 = committed('cm0102-2017-04-cm89');
  assert.deepEqual(cm89.territory, territoryFor(FOOTBALL_FEDERATIONS, 1990));
  assert.deepEqual(cm89.identities, identitiesFor(FOOTBALL_FEDERATIONS, 1990, { fields: shape => cm89.nations[shape]?.[2].length > 0 }));
  assert.deepEqual(Object.keys(cm89.identities).sort(), ['180', '203', '276', '643', '688']);
  const sport89 = seasonSport(decodeFootballSet(cm89));
  assert.deepEqual(sport89.playsAs['643'], { name: 'Soviet Union', code: 'URS', flagId: 'URS' });
  assert.ok(!fieldedNations(sport89).includes('804') && cm89.nations['804'][2].length === 0, 'Ukraine plays for the Soviet Union');
});

test('1989/90: a German at an East German club plays for no nation, so West Germany is West German', () => {
  const doc = committed('cm0102-2017-04-cm89');
  const { noNationAt } = entry('cm0102-2017-04-cm89');
  assert.equal(noNationAt.nationality, 'Germany');
  assert.equal(noNationAt.clubs.length, 67);
  assert.deepEqual(noNationAt.clubs, [...noNationAt.clubs].sort());
  for (const club of ['1.FC Dynamo Dresden', 'FC Dynamo Berlin', '1.FC Union Berlin', 'FC Hansa Rostock', 'FC Carl Zeiss Jena', '1.FC Magdeburg', 'Hallescher FC']) {
    assert.ok(noNationAt.clubs.includes(club), club);
  }
  for (const club of ['Hertha BSC Berlin', 'Blau-Weiß 90 Berlin', 'Eintracht Frankfurt', 'SC Freiburg']) assert.ok(!noNationAt.clubs.includes(club), club);
  const westGermany = doc.nations['276'][2];
  assert.equal(westGermany.length, 11);
  assert.ok(westGermany.every(tuple => tuple[5] === 'Germany' && !noNationAt.clubs.includes(tuple[6])));
  assert.ok(!westGermany.some(tuple => ['Matthias Sammer', 'Andreas Thom', 'Ulf Kirsten'].includes(tuple[1])));
  assert.ok(westGermany.some(tuple => tuple[1] === 'Lothar Matthäus' && tuple[6] === 'Internazionale'));
  const audit = JSON.parse(read('docs/design/football-retro-seasons-audit.json')).seasons.find(season => season.id === 'cm0102-2017-04-cm89').audit;
  assert.equal(audit.noTeam['Germany at East German clubs'], 1431);
  assert.deepEqual(audit.federations.pooled['643']['804'] > 0 && audit.federations.pooled['688']['191'] > 0 && audit.federations.pooled['203']['703'] > 0, true);
  assert.equal(audit.birthShift.oracle.conclusive && audit.birthShift.oracle.agreeing, 10, 'ten players of 1989/90 date the births');
});

test('the East German clubs rebuild from the database and GeoNames (when they are in data-src/)', t => {
  const zip = path.join(root, 'data-src/cm0102-starter-kit/cm89_data.zip'), gazetteer = path.join(root, 'data-src/geonames-cities1000/cities1000.txt');
  if (!existsSync(zip) || !existsSync(gazetteer)) {
    t.skip('cm89_data.zip or cities1000.txt not in data-src/');
    return;
  }
  const { noNationAt } = entry('cm0102-2017-04-cm89');
  const files = unzipSync(new Uint8Array(readFileSync(zip)), { filter: file => /^[^/]+\.dat$/i.test(file.name) });
  const db = readCm0102(files);
  const germany = db.nations.findIndex(nation => nation.name === 'Germany');
  const withGermans = new Set(db.players.filter(p => p.nation === germany && p.club != null && p.ca >= 1 && p.ca <= 200).map(p => p.club));
  const clubs = db.clubs.filter(club => club.nation === germany && withGermans.has(club.row));
  const { east, placed } = eastGermanClubs({ files, clubs, places: germanPlaces(readFileSync(gazetteer, 'utf8')) });
  assert.deepEqual(east, noNationAt.clubs);
  assert.equal(placed.filter(club => club.by === 'hand').length, Object.keys(EAST_GERMAN_BY_HAND).length);
  assert.equal(placed.find(club => club.name === '1.FC Dynamo Dresden').city, 'Dresden');
});

// ---------- the team file reader ----------

/** A TEAM file of invented teams: `[name, division, players]`, each player `{ name, nat, pos, skills, value }`. */
function teamFile(number, teams) {
  const bytes = new Uint8Array(2 + teams.length * 684);
  bytes[1] = teams.length;
  teams.forEach(([name, division, players], index) => {
    const at = 2 + index * 684;
    bytes[at] = Number(number);
    bytes[at + 1] = index;
    bytes.set(Buffer.from(name, 'latin1'), at + 5);
    bytes[at + 25] = division;
    players.forEach((player, slot) => {
      const p = at + 76 + slot * 38;
      bytes[p] = player.nat;
      bytes[p + 2] = slot + 1;
      bytes.set(Buffer.from(player.name, 'latin1'), p + 3);
      bytes[p + 26] = ['G', 'RB', 'LB', 'D', 'RW', 'LW', 'M', 'A'].indexOf(player.pos) << 5;
      const [PA, VE, HE, TA, CO, SP, FI] = player.skills;
      bytes[p + 28] = PA;
      bytes[p + 29] = (VE << 4) | HE;
      bytes[p + 30] = (TA << 4) | CO;
      bytes[p + 31] = (SP << 4) | FI;
      bytes[p + 32] = player.value;
    });
  });
  return bytes;
}
const POSITIONS = ['G', 'G', 'RB', 'LB', 'D', 'D', 'D', 'RW', 'LW', 'M', 'M', 'M', 'A', 'A', 'A', 'A'];
/** Sixteen invented players of nationality byte `nat`, skills summing to their steps; `steps` overrides some. */
const sixteen = (prefix, nat, steps = {}) => POSITIONS.map((pos, i) => {
  const skills = pos === 'G' ? [0, 0, 0, 0, 0, 0, 0] : [3, 3, 3, 3, 3, 3, i % 4];
  const value = steps[i] ?? (pos === 'G' ? 20 + i : skills.reduce((s, x) => s + x, 0));
  return { name: `${prefix} PLAYER ${i + 1}`, nat, pos, skills, value };
});

test('the team file reader: SWOS\'s layout, its ids, and steps read as the 96/97 database stores them', () => {
  const file = readTeamFile(teamFile('080', [['ENGLAND', 0, sixteen('ENGLAND', 8, { 0: 0, 15: 49 })]]), '080');
  assert.deepEqual([file.number, file.teams.length, file.teams[0].name, file.teams[0].division], ['080', 1, 'ENGLAND', 0]);
  const keeper = file.teams[0].players[0];
  assert.deepEqual([keeper.name, keeper.pos, keeper.value, keeper.nat, keeper.shirt], ['ENGLAND PLAYER 1', 'G', 0, 8, 1]);
  assert.deepEqual(['PA', 'VE', 'HE', 'TA', 'CO', 'SP', 'FI'].map(skill => file.teams[0].players[2][skill]), [3, 3, 3, 3, 3, 3, 2]);
  const clamped = [];
  const rows = swosRows(file, 'NATIONAL', clamped);
  assert.deepEqual(clamped, ['ENGLAND ENGLAND PLAYER 1 0 -> 1', 'ENGLAND ENGLAND PLAYER 16 49 -> 48']);
  assert.deepEqual([rows[0].id, rows[0].value, rows[0].GK, rows[0].nat, rows[15].value], [swosFileId('080', 0, 0), SWOS_PRICES[1], 1, 'ENG', SWOS_PRICES[48]]);
  assert.equal(swosFileId('085', 3, 15), 850064);
  // It stops on anything the layout does not explain.
  assert.throws(() => readTeamFile(new Uint8Array(100), '080'), /not 2 plus whole teams/);
  const bad = teamFile('080', [['ENGLAND', 0, sixteen('ENGLAND', 8)]]);
  bad[1] = 2;
  assert.throws(() => readTeamFile(bad, '080'), /header names 2 teams/);
  assert.throws(() => readTeamFile(teamFile('081', [['ENGLAND', 0, sixteen('ENGLAND', 8)]]), '080'), /gives file 81/);
  assert.throws(() => readTeamFile(teamFile('080', [['ENGLAND', 0, sixteen('ENGLAND', 8, { 3: 50 })]]), '080'), /price step 50/);
  assert.throws(() => swosRows(readTeamFile(teamFile('080', [['X', 0, sixteen('X', 152)]]), '080'), 'NATIONAL'), /nationality byte 152/);
  assert.equal(SWOS_NATIONALITIES[23], 'HOL');
});

test('a SWOS season\'s clubs: the top divisions\' own sixteen each, named by SWOS_CLUBS, and the federations it fields', () => {
  const clubFiles = { '008': 'ARSENAL', '035': 'BARCELONA', '020': 'JUVENTUS', '014': 'BAYERN MUNICH', '013': 'MONACO', '025': 'AJAX', '029': 'BENFICA' };
  const leagueRows = (extra = {}) => Object.entries(clubFiles).flatMap(([number, name]) => swosRows(readTeamFile(teamFile(number, [[name, 0, sixteen(name, 8)]]), number), 'CLUB'))
    .map(row => ({ ...row, ...extra[row.team] }));
  const nationalRows = names => swosRows(readTeamFile(teamFile('080', names.map((name, i) => [name, 0, sixteen(name, 8 + i)])), '080'), 'NATIONAL');
  const source = { provider: 'Sensible Software', edition: 'SWOS test', version: 'test', snapshotDate: '1995', url: 'https://example.test/swos',
    rawScale: SWOS_SCALE, conversion: SWOS_CONVERSION };
  const build = (year, nations, clubRows = leagueRows()) => buildSwosSeason(nationalRows(nations), { source, year, prices: SWOS_PRICES, id: 'swos-test', clubRows });
  const { doc, audit } = build(1996, ['ENGLAND', 'YUGOSLAVIA']);
  assert.deepEqual([doc.id, doc.kind, doc.coverage.clubs, doc.coverage.leagues], ['swos-test', 'swos', 7, 7]);
  assert.deepEqual(doc.clubs.map(club => [club.id, club.league, club.country]).sort(), [
    ['f-ajax', 'Eredivisie', '528'], ['f-arsenal', 'Premier League', '826'], ['f-as-monaco', 'Ligue 1', '250'], ['f-fc-barcelona', 'La Liga', '724'],
    ['f-fc-bayern-munchen', 'Bundesliga', '276'], ['f-juventus', 'Serie A', '380'], ['f-sl-benfica', 'Liga Portugal', '620']]);
  assert.ok(doc.clubs.every(club => club.squad.length === 11 && club.squad.every(tuple => tuple[5] === 'ENG' && tuple[6] === '')));
  assert.deepEqual(audit.collisions, [], 'no player at two clubs here');
  // FR Yugoslavia with a squad plays under its own name in 1995/96; without one in 1994/95 its land is neutral.
  assert.deepEqual(doc.identities, { 688: { name: 'FR Yugoslavia', code: 'YUG', flagId: 'FRY' } });
  const without = build(1995, ['ENGLAND']).doc;
  assert.ok(!('identities' in without) && ['499', 'KOS'].every(shape => without.territory.inactive.includes(shape)));
  // It stops on a club SWOS_CLUBS does not name, a lower division's row, or a league with no club.
  assert.throws(() => build(1996, ['ENGLAND'], leagueRows({ ARSENAL: { team: 'ATLANTIS FC' } })), /SWOS club ATLANTIS FC \(Premier League\) has no name/);
  assert.throws(() => build(1996, ['ENGLAND'], leagueRows({ ARSENAL: { division: 1 } })), /is not in a top division/);
  assert.throws(() => build(1996, ['ENGLAND'], leagueRows().filter(row => row.team !== 'AJAX')), /No Eredivisie clubs in TEAM\.025/);
});

test('SWOS names keep the apostrophes of their countries', () => {
  assert.deepEqual(["JAPHET N'DORAM", "CARLO L'AMI", "OLIVIER DALL'OGLIO", "MICHEL PREUD'HOMME", "JACQUES SONGO'O", "JOHN VAN 'T SCHIP"]
    .map((name, i) => properCase(name, i === 5 ? 'HOL' : null)), ["Japhet N'Doram", "Carlo L'Ami", "Olivier Dall'Oglio", "Michel Preud'homme", "Jacques Songo'o", "John van 't Schip"]);
});

// ---------- the running App ----------

const B = await bundleComponents({
  App: 'src/App.jsx',
  clearDomesticCache: ['src/engine/domestic.js', 'clearDomesticCache'],
  clearFootballSetCache: ['src/engine/footballSets.js', 'clearFootballSetCache'],
  clearFootballSetIndex: ['src/engine/footballSets.js', 'clearFootballSetIndex'],
}, { jsx: 'automatic' });
const settle = () => new Promise(resolve => setImmediate(resolve));

/** The real App's setup with public/football/ and public/domestic/ served as the page's fetch, `gone` failing. */
async function withApp(fn, settings = {}) {
  const calls = [], gone = new Set();
  const fetch = async url => {
    const at = String(url);
    calls.push(at);
    if (gone.has(at)) throw new Error('the file is gone');
    if (/^\/(football|domestic)\/[a-z0-9-]+\.json$/.test(at) && !at.endsWith('/index.json')) {
      return { ok: true, status: 200, json: async () => JSON.parse(read(`public${at}`)) };
    }
    return { ok: false, status: 404, json: async () => { throw new Error('Not found'); } };
  };
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
  Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true, value: fetch });
  B.clearDomesticCache();
  B.clearFootballSetCache();
  B.clearFootballSetIndex();
  const f = syncAppFixture({ App: B.App, phase: 'setup', ids: ['826', '250', '724', '643', '804'],
    settings: { sport: 'football', layer: 'nations', scope: 'UEFA', clubScope: 'all', role: 'spectator', seed: '11', ...settings } });
  f.app.opening = B.App.prototype.opening;
  try { return await fn({ ...f, calls, gone }); } finally {
    f.close();
    if (prior) Object.defineProperty(globalThis, 'fetch', prior); else delete globalThis.fetch;
  }
}

/** Save, forget the season, and resume from the saved text alone: no fetch, the same teams. */
function resumes({ app, items, calls, gone }, url, pack) {
  const { state } = app;
  const text = items.get(SAVE_KEY);
  assert.deepEqual(JSON.parse(text).playerPack, pack);
  B.clearFootballSetCache();
  gone.add(url);
  const before = calls.length;
  const saved = parseCampaign(text);
  assert.equal(JSON.stringify(saved.teams), JSON.stringify(state.teams), 'squads rebuild exactly');
  app.continueSaved(saved);
  assert.equal(app.state.phase, 'playing', 'resumed at once');
  assert.equal(JSON.stringify(app.state.teams), JSON.stringify(state.teams));
  assert.equal(calls.length, before, 'resuming fetched nothing');
}

test('the running App launches a 1995/96 clubs campaign on its own map of Europe, and resumes it without the file', async () => {
  const doc = committed('swos-9596');
  await withApp(async fixture => {
    const { app, time } = fixture;
    app.pickSetup('layer', 'clubs');
    app.pickSetup('clubScope', 'domestic:eu32');
    app.pickSetup('dataSet', 'swos-9596');
    assert.deepEqual([app.state.setup.layer, app.state.setup.clubScope], ['clubs', 'domestic:eu32s1996'], 'the theatre follows the season');
    time.advance(200);
    await app.loadSet('swos-9596');
    await app.loadCountry('eu32s1996');
    await settle();
    app.startCampaign();
    const st = app.state;
    assert.equal(st.phase, 'playing');
    assert.deepEqual([st.settings.dataSet, st.settings.dataSeason, st.settings.domesticVersion],
      ['swos-9596', '1995/96', EUROPE_MAPS.find(map => map.id === 'eu32s1996').version]);
    const elite = strongestClubs(doc.clubs, ELITE_CLUBS);
    assert.deepEqual(Object.keys(st.teams).sort(), elite.map(club => club.id).sort(), 'the season\'s elite');
    const top = elite[0];
    assert.deepEqual(st.teams[top.id].squad.map(player => player.name), top.squad.map(tuple => tuple[1]), 'with its SWOS players');
    assert.ok(st.teams[top.id].squad.every(player => player.sourceInfo.source === 'swos' && player.sourceInfo.edition === 'SWOS 95/96'));
    resumes(fixture, '/football/swos-9596.json', { kind: 'swos', source: { provider: 'Sensible Software', edition: 'SWOS 95/96',
      version: 'Amiga team files, 95/96', snapshotDate: '1995', url: 'https://cern.swos.eu/data/amiga/9596/' } });
  }, { layer: 'nations' });
});

test('the running App launches a 1989/90 nations campaign as the Soviet Union, and resumes it without the file', async () => {
  const id = 'cm0102-2017-04-cm89';
  await withApp(async fixture => {
    const { app, time } = fixture;
    app.pickSetup('layer', 'clubs');
    app.pickSetup('dataSet', id);
    assert.equal(app.state.setup.layer, 'nations', 'a season with nations only takes the nations');
    time.advance(200);
    await app.loadSet(id);
    await settle();
    app.startCampaign();
    const st = app.state;
    assert.equal(st.phase, 'playing');
    assert.deepEqual([st.teams['643'].name, st.teams['643'].code, st.teams['643'].flagId], ['Soviet Union', 'URS', 'URS']);
    assert.deepEqual([st.teams['276'].name, st.teams['276'].code], ['West Germany', 'FRG']);
    assert.equal(st.own['804'], '643', 'Ukraine starts in the Soviet Union');
    assert.ok(st.teams['643'].squad.every(player => player.sourceInfo.source === 'cm0102' && player.sourceInfo.provider === 'Simon Treanor'));
    resumes(fixture, `/football/${id}.json`, { kind: 'cm0102', source: { provider: 'Simon Treanor', edition: 'CM 01/02',
      version: '89/90 by Simon Treanor, fan-made', snapshotDate: '2017-04', url: 'https://cm8990.wordpress.com/' } });
  }, { role: 'manager', managedTeamId: '643' });
});
