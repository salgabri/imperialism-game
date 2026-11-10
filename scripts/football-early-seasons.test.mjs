// The built-in football seasons before FIFA 05 (docs/design/football-years.md, "Seasons before FIFA 05"): SI's CM 01/02
// 3.9.68 (2002/03) and 3.9.60 (2001/02), SI's CM 00/01 (2000/01) and CM 99/00 (1999/00) from their CDs, SI's CM3 data
// ported to CM 01/02 (1998/99), SI's CM 97/98 as extracted to
// JSON (1997/98) and Sensible World of Soccer 96/97's national squads (1996/97, nations only). The committed files
// against their listing, manifest, Europe maps and the federations of their years; the conversions of ratings; the
// builders (scripts/lib/cm9798.mjs, scripts/lib/swos.mjs) on invented records; a rebuild from the pinned sources when
// they are in data-src/; and the running App launching and resuming a 1996/97 nations and a 2001/02 clubs campaign.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SAVE_KEY } from '../src/config.js';
import { NATIONS } from '../src/data/teams.js';
import { BUILT_IN_SEASONS } from '../src/data/footballSeasons.js';
import { EUROPE_MAPS } from '../src/data/europeMaps.js';
import { ELITE_CLUBS, TOP_CLUBS, strongestClubs } from '../src/data/scopes.js';
import { europeMapsOf } from '../src/data/domesticScope.js';
import { CM_CONVERSION, CM_SCALE, cmGameRating } from '../src/data/cmPlayers.js';
import { SWOS_CONVERSION, SWOS_PRICES, SWOS_SCALE, SWOS_SKILLS, expandSwosTuple, swosGameRating, swosTupleOf } from '../src/data/swosPlayers.js';
import { CM0102_RELEASES } from '../src/data/cm0102Releases.js';
import { FOOTBALL_FEDERATIONS } from '../src/data/footballFederations.js';
import { FIRST_YEAR, buildFootballSet, contentHash, identitiesFor, territoryFor } from '../src/data/footballSetBuild.js';
import {
  BUILT_IN_SETS, decodeFootballSet, fieldedNations, heldShapes, isFootballSetId, seasonSport, setHasClubs, setKindOf, setSportOf,
} from '../src/engine/footballSets.js';
import { parseCampaign } from '../src/engine/storage.js';
import { sourceLabel } from '../src/viewModels/squad.js';
import { buildSetupModel } from '../src/screens/setup/setupModel.js';
import { CM9798_CLUB_ALIASES, buildCm9798Season, cm9798Ratings } from './lib/cm9798.mjs';
import { SWOS_SQUAD, buildSwosSeason, properCase } from './lib/swos.mjs';
import { sampleDatabase, writeCm0102Files } from './lib/cm0102-fixture.mjs';
import { bundleComponents, syncAppFixture } from './lib/app-harness.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = file => readFileSync(path.join(root, file), 'utf8');
const MANIFEST = JSON.parse(read('scripts/data/retro-seasons.json'));
const committed = id => JSON.parse(read(`public/football/${id}.json`));
const tuplesOf = doc => [...Object.values(doc.nations).flatMap(([, , squad]) => squad), ...doc.clubs.flatMap(club => club.squad)];
const IDS = ['cm0102-2002-11', 'cm0102-2001-09', 'cm-0001', 'cm-9900', 'cm0102-2020-11-cm3', 'cm-9798', 'swos-9697'];

// ---------- the committed seasons ----------

test('the seasons before FIFA 05 are built in, after EA\'s, each its committed file and credited to its makers', () => {
  // The manifest lists these seven in this order, among the others (scripts/football-swos-fan-seasons.test.mjs has
  // SWOS 94/95 and 95/96 and the two fan-made databases).
  assert.deepEqual(MANIFEST.seasons.map(season => season.id).filter(id => IDS.includes(id)), IDS);
  const listed = IDS.map(id => BUILT_IN_SEASONS.find(set => set.id === id));
  assert.deepEqual(listed.map(set => [set.id, set.year, set.season]), [['cm0102-2002-11', 2003, '2002/03'], ['cm0102-2001-09', 2002, '2001/02'],
    ['cm-0001', 2001, '2000/01'], ['cm-9900', 2000, '1999/00'], ['cm0102-2020-11-cm3', 1999, '1998/99'], ['cm-9798', 1998, '1997/98'],
    ['swos-9697', 1997, '1996/97']]);
  // A season may have two sets (a game's database and a fan's or a computed one).
  assert.ok(BUILT_IN_SEASONS.every((set, i) => !i || set.year <= BUILT_IN_SEASONS[i - 1].year), 'one listing, newest first');
  for (const [i, season] of IDS.map(id => MANIFEST.seasons.find(entry => entry.id === id)).entries()) {
    const doc = committed(season.id);
    assert.deepEqual([doc.id, doc.version, doc.year, doc.season, doc.label], [listed[i].id, listed[i].version, listed[i].year, listed[i].season, listed[i].label]);
    assert.equal(doc.version, `${doc.id}-${contentHash(doc)}`, `${doc.id} is the file its version names`);
    assert.ok(isFootballSetId(doc.id) && setSportOf(doc.id) === 'football' && BUILT_IN_SETS.some(set => set.id === doc.id), doc.id);
    assert.equal(setKindOf(doc.id), season.kind);
    assert.equal(doc.kind ?? 'cm0102', season.kind, 'the file names its kind');
    assert.equal(doc.local, false, 'built in, not a local build');
    // Who made the data, who compiled or ported it, from where and when it was read.
    assert.equal(doc.source.provider, season.maker);
    assert.ok(['Sports Interactive', 'Sensible Software'].includes(doc.source.provider));
    assert.equal(doc.source.compiler, season.compiler);
    assert.equal(doc.source.retrieved, season.retrieved ?? MANIFEST.retrieved);
    assert.match(doc.source.url, /^https:\/\//);
    assert.ok(season.rights?.trim(), `${doc.id} records its rights as published`);
    for (const file of season.files || [season.file]) {
      assert.match(file.sha256, /^[0-9a-f]{64}$/);
      assert.ok(Number.isInteger(file.bytes) && file.bytes > 0);
      // A download pinned to a commit, or a table read from a pinned CD image (npm run sync:retro-cds).
      if (season.cd) assert.equal(file.download, undefined);
      else assert.match(file.download, /^https:\/\/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/[0-9a-f]{40}\//, 'pinned to a commit');
    }
    if (season.cd) {
      const { cd } = season;
      // The archive.org item's image by size and digests, its sector layout and volume, and where the tables are on it.
      assert.match(cd.item, /^[a-z0-9-]+$/);
      assert.equal(doc.source.url, `https://archive.org/details/${cd.item}`);
      assert.ok(Number.isInteger(cd.imageBytes) && cd.imageBytes % cd.sector === 0, cd.image);
      assert.match(cd.imageMd5, /^[0-9a-f]{32}$/);
      assert.match(cd.imageSha1, /^[0-9a-f]{40}$/);
      assert.ok([[2048, 0], [2352, 16]].some(([sector, offset]) => cd.sector === sector && cd.dataOffset === offset));
      assert.ok(cd.volume.trim() && /^\d{16}$/.test(cd.created));
      if (cd.cabinet) {
        assert.match(cd.cabinet.headerSha256, /^[0-9a-f]{64}$/);
        assert.ok(Number.isInteger(cd.cabinet.headerLba) && Number.isInteger(cd.cabinet.cabinetLba));
        for (const file of season.files) assert.match(file.md5, /^[0-9a-f]{32}$/, 'the MD5 its cabinet header records');
      } else {
        assert.ok(cd.folder.trim());
      }
    }
  }
  // The listing's comment names each source.
  for (const season of MANIFEST.seasons) assert.ok(read('src/data/footballSeasons.js').includes(`// ${season.season}: ${season.listing}`));
});

test('every season rebuilds byte for byte from its pinned sources (when they are in data-src/)', t => {
  const files = MANIFEST.seasons.flatMap(season => season.files || [season.file]);
  const missing = files.filter(file => !existsSync(path.join(root, 'data-src', file.folder, file.name)));
  if (missing.length) {
    t.skip(`sources not in data-src/: ${missing.map(file => `${file.folder}/${file.name}`).join(', ')}`);
    return;
  }
  const run = spawnSync(process.execPath, [path.join(root, 'scripts/build-retro-seasons.mjs'), '--check'], { cwd: root, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, new RegExp(`${MANIFEST.seasons.length + 2} files rebuild byte for byte`), 'every season, the listing and the audit');
});

// Each season's coverage: what its source rates, written exactly.
const COVERAGE = {
  'cm0102-2002-11': { players: 2599, nations: 162, completeXIs: 108, clubs: 129, leagues: 7 },
  'cm0102-2001-09': { players: 2458, nations: 143, completeXIs: 96, clubs: 130, leagues: 7 },
  'cm-0001': { players: 2284, nations: 134, completeXIs: 82, clubs: 130, leagues: 7 },
  'cm-9900': { players: 2178, nations: 123, completeXIs: 74, clubs: 130, leagues: 7 },
  'cm0102-2020-11-cm3': { players: 2066, nations: 113, completeXIs: 64, clubs: 130, leagues: 7 },
  'cm-9798': { players: 1899, nations: 102, completeXIs: 52, clubs: 124, leagues: 7 },
  'swos-9697': { players: 1463, nations: 133, completeXIs: 133, clubs: 0, leagues: 0 },
};

test('each season decodes, and fields the nations and clubs its source rates', () => {
  for (const id of IDS) {
    const doc = committed(id);
    const set = decodeFootballSet(doc);
    assert.deepEqual(doc.coverage, COVERAGE[id], id);
    assert.equal(Object.keys(set.rosters).length, Object.keys(NATIONS).length, `${id}: every nation has a roster`);
    assert.deepEqual([...new Set(set.clubs.map(club => club.league))].sort(), setHasClubs(id)
      ? ['Bundesliga', 'Eredivisie', 'La Liga', 'Liga Portugal', 'Ligue 1', 'Premier League', 'Serie A'] : [], id);
    assert.ok(set.clubs.every(club => club.squad.length >= 11), `${id}: a club fields eleven`);
    const ids = tuplesOf(doc).map(tuple => tuple[0]);
    assert.equal(new Set(ids).size, new Set(ids.map(String)).size, `${id}: one id per player`);
  }
  // Only SWOS 96/97 has nations only, as FIFA 05 and FIFA 06 do.
  assert.deepEqual(IDS.filter(id => !setHasClubs(id)), ['swos-9697']);
});

test('each season with clubs plays on its own two Europe maps: its strongest 124 and 32 clubs', () => {
  const places = JSON.parse(read('scripts/data/europe-clubs.json')).clubs;
  for (const id of IDS) {
    const doc = committed(id);
    const maps = europeMapsOf(id);
    if (!setHasClubs(id)) {
      assert.deepEqual(maps, [], `${id} has no maps`);
      assert.ok(!EUROPE_MAPS.some(entry => entry.seasons?.includes(id)));
      continue;
    }
    assert.deepEqual(maps.map(map => [map.id, map.clubs, map.theatre, map.seasons]),
      [[`eu124s${doc.year}`, TOP_CLUBS, 'all', [id]], [`eu32s${doc.year}`, ELITE_CLUBS, 'elite', [id]]], id);
    for (const [count, map] of [[TOP_CLUBS, maps[0]], [ELITE_CLUBS, maps[1]]]) {
      const file = JSON.parse(read(`public/domestic/${map.id}.json`));
      assert.equal(file.version, map.version);
      assert.deepEqual(file.clubs.map(club => club.id), strongestClubs(doc.clubs, count).map(club => club.id), map.id);
      assert.ok(file.clubs.every(club => places[club.id] && club.shape === (places[club.id].shape ?? doc.clubs.find(c => c.id === club.id).country)));
    }
  }
});

// ---------- federations ----------

test('the federations of the seasons\' own years: FR Yugoslavia holds Montenegro, and Kosovo until 1999', () => {
  assert.equal(FIRST_YEAR, 1962, 'the first World Cup season the federations table covers');
  const year = id => committed(id).year;
  for (const id of IDS) assert.deepEqual(committed(id).territory, territoryFor(FOOTBALL_FEDERATIONS, year(id)), id);
  // These seasons were built before identities: none carries one, and none of their years has a federation of the day.
  for (const id of IDS) assert.ok(!('identities' in committed(id)) && !Object.keys(identitiesFor(FOOTBALL_FEDERATIONS, year(id))).length, id);
  const of = id => seasonSport(decodeFootballSet(committed(id)));
  // A FIFA member of the season's year: neither merged into another federation nor inactive. It fields a team only with
  // a real side (fieldedNations).
  const member = (sport, shape) => !Object.hasOwn(sport.territory.merged, shape) && !sport.territory.inactive.includes(shape);
  // 1996/97: Bosnia (FIFA, July 1996) is a member; Eritrea, Palestine (1998), Mongolia (July 1998) and Bhutan (2000) are not.
  const swos = of('swos-9697');
  assert.deepEqual(swos.territory.merged, { 499: '688', 540: '250', 728: '729', KOS: '688' });
  assert.ok(['064', '232', '275', '496', '626'].every(shape => swos.territory.inactive.includes(shape)));
  assert.ok(member(swos, '070') && !member(swos, 'KOS') && !fieldedNations(swos).includes('KOS'));
  assert.ok(!fieldedNations(swos).includes('070'), 'Bosnia, with no SWOS player, fields no team');
  assert.ok(heldShapes(swos).some(([shape, holder]) => shape === 'KOS' && holder === '688'));
  // 1997/98: Eritrea and Palestine are members; Mongolia joined after the season.
  const cm97 = of('cm-9798');
  assert.equal(cm97.territory.merged.KOS, '688');
  assert.ok(member(cm97, '232') && member(cm97, '275') && !member(cm97, '496'));
  // 1998/99: the United Nations took Kosovo over on 10 June 1999, before the season's end; Mongolia is a member, Bhutan
  // not yet.
  const cm3 = of('cm0102-2020-11-cm3');
  assert.ok(cm3.territory.inactive.includes('KOS') && !Object.hasOwn(cm3.territory.merged, 'KOS'));
  assert.ok(member(cm3, '496') && !member(cm3, '064'));
  // 1999/00: Kosovo under the United Nations, FR Yugoslavia holding Montenegro, Bhutan not yet a member (August 2000).
  assert.deepEqual(committed('cm-9900').territory, { merged: { 499: '688', 540: '250', 728: '729' }, inactive: ['064', '626', 'KOS'] });
  // From 2000/01 every one of them plays but Montenegro, Kosovo, Timor-Leste, New Caledonia and South Sudan.
  for (const id of ['cm-0001', 'cm0102-2001-09', 'cm0102-2002-11']) {
    assert.deepEqual(committed(id).territory, { merged: { 499: '688', 540: '250', 728: '729' }, inactive: ['626', 'KOS'] }, id);
  }
  for (const entry of Object.values(FOOTBALL_FEDERATIONS.shapes)) assert.match(entry.source, /^https:\/\/inside\.fifa\.com\/associations\/[A-Z]{3}$/);
});

// ---------- ratings ----------

test('conversions to the game\'s 1-99 are documented, pinned and applied to every player', () => {
  assert.equal(CM_CONVERSION, 'round(ca * 99 / 200)');
  assert.deepEqual([1, 100, 150, 175, 200].map(cmGameRating), [1, 50, 74, 87, 99]);
  assert.equal(SWOS_CONVERSION, 'round(40 + value * 59 / 49)');
  assert.equal(SWOS_SCALE, 49);
  assert.deepEqual([0, 1, 14, 25, 36, 45, 48, 49].map(swosGameRating), [40, 41, 57, 70, 83, 94, 98, 99]);
  assert.equal(SWOS_PRICES.length, 50);
  assert.deepEqual([SWOS_PRICES[1], SWOS_PRICES[23], SWOS_PRICES[36], SWOS_PRICES[48], SWOS_PRICES[49]], [25e3, 700e3, 2.25e6, 15e6, 16e6]);
  for (const id of IDS) {
    const set = decodeFootballSet(committed(id));
    const players = [...Object.values(set.rosters).flatMap(([, , squad]) => squad), ...set.clubs.flatMap(club => club.squad)];
    for (const [, , rating, info] of players) {
      if (id === 'swos-9697') {
        assert.deepEqual([info.rawScale, info.conversion, rating], [SWOS_SCALE, SWOS_CONVERSION, swosGameRating(info.rawRating)]);
        // An outfield player's price step is the sum of his skills (1 to 48); a keeper has none.
        if (info.positions[0] === 'GK') assert.equal(info.skills, undefined);
        else assert.equal(Math.max(1, Math.min(48, SWOS_SKILLS.reduce((sum, skill) => sum + info.skills[skill], 0))), info.rawRating);
        assert.equal(info.price, SWOS_PRICES[info.rawRating]);
      } else {
        assert.deepEqual([info.rawScale, info.conversion, rating], [CM_SCALE, CM_CONVERSION, cmGameRating(info.rawRating)]);
      }
    }
  }
});

test('the CM 01/02 seasons are SI\'s own databases, the CM3 port with its birth years moved back three years', () => {
  for (const id of ['cm0102-2002-11', 'cm0102-2001-09', 'cm-0001', 'cm-9900', 'cm0102-2020-11-cm3']) {
    const release = CM0102_RELEASES.find(entry => entry.id === id);
    const { source } = committed(id);
    assert.deepEqual([source.provider, source.version, source.url, source.dobShift, source.edition],
      [release.provider, release.label, release.url, release.shifts.birth, release.edition ?? 'CM 01/02']);
  }
  // SI's CM 99/00 and CM 00/01 are their own editions, kind 'cm', read from the CDs with their real dates of birth.
  for (const [id, edition, version, snapshot] of [['cm-9900', 'CM 99/00', '3.70', '1999-11'], ['cm-0001', 'CM 00/01', '3.81', '2000-10']]) {
    const doc = committed(id);
    assert.deepEqual([doc.kind, doc.label, doc.source.edition, doc.source.version, doc.source.snapshotDate, doc.source.conversion, doc.source.dobShift],
      ['cm', `${edition} · ${version}`, edition, version, snapshot, CM_CONVERSION, 0]);
    assert.equal(sourceLabel({ sourceInfo: decodeFootballSet(doc).rosters['250'][2][0][3] }), edition);
  }
  // Squads of their seasons: Vieri at Inter in 1999/00; Figo at Real Madrid and Crespo at Lazio in 2000/01.
  assert.deepEqual(committed('cm-9900').nations['380'][2].find(tuple => tuple[1] === 'Christian Vieri').slice(3),
    [194, 'st', 'Italy', 'Internazionale', '1973-07-12']);
  assert.deepEqual(committed('cm-0001').nations['620'][2].find(tuple => tuple[1] === 'Figo').slice(2),
    ['Luis Filipe Madeira', 185, 'rw', 'Portugal', 'Real Madrid C.F.', '1972-11-04']);
  assert.deepEqual(committed('cm-0001').nations['032'][2].find(tuple => tuple[1] === 'Hernan Jorge Crespo').slice(6), ['Lazio', '1975-07-05']);
  // CM 99/00 names the Eredivisie after its sponsor and misspells Burkina Faso; both are read.
  const cm9900 = committed('cm-9900');
  assert.equal(cm9900.clubs.filter(club => club.league === 'Eredivisie').length, 18);
  assert.ok(cm9900.nations['854'][2].length && cm9900.nations['854'][2].every(tuple => tuple[5] === 'Burkino Faso'));
  const cm3 = CM0102_RELEASES.find(entry => entry.id === 'cm0102-2020-11-cm3');
  assert.deepEqual([cm3.season, cm3.shifts.birth, cm3.snapshotDate, cm3.signatures[0].staffTrailing], ['1998/99', -3, '1999-03', 230]);
  const zidane = committed('cm0102-2020-11-cm3').nations['250'][2].find(tuple => tuple[1] === 'Zinedine Zidane');
  assert.deepEqual([zidane[3], zidane[6], zidane[7]], [190, 'Juventus', '1972-06-23'], 'stored as 1975, born 1972');
  const balakov = committed('cm0102-2002-11').nations['100'][2].find(tuple => tuple[1] === 'Krassimir Balakov');
  assert.deepEqual([balakov[6], balakov[7]], ['VfB Stuttgart', '1966-03-29']);
  // The labels read in the Season choice when a season is shared, and the players' Source column.
  assert.deepEqual(['cm0102-2002-11', 'cm0102-2020-11-cm3', 'cm-9798', 'swos-9697'].map(id => committed(id).label),
    ['CM 01/02 · 3.9.68', 'CM3 · 98/99 for CM 01/02', 'CM 97/98', 'SWOS 96/97']);
  const first = id => decodeFootballSet(committed(id)).rosters['250'][2][0];
  assert.deepEqual(['cm0102-2020-11-cm3', 'cm-9798', 'swos-9697'].map(id => sourceLabel({ sourceInfo: first(id)[3] })), ['CM3', 'CM 97/98', 'SWOS 96/97']);
});

// ---------- SI's CM 99/00 and CM 00/01 ----------

test('CM 99/00\'s own names, its sponsor\'s Eredivisie and Burkino Faso, are read on an invented folder', () => {
  const db = sampleDatabase();
  db.clubComps.find(comp => comp.name === 'Dutch Premier Division').name = 'Dutch KPN-Telecompetition';
  const nation = db.nations.push({ name: 'Burkino Faso', short: 'Burkino Faso', code: 'BFA', continent: 0 }) - 1;
  db.people.push({ first: 'Fakeo', second: 'Burkinotest', dob: { year: 1978, month: 11, day: 3 }, nation, club: -1, job: 11,
    player: { ca: 120, ratings: { f: 20, centre: 20 } } });
  const { doc, audit } = buildFootballSet(writeCm0102Files(db, { format: 1 }),
    { identity: { label: 'Fixture', released: '1999-11', url: 'https://example.test/cm9900', dobShift: 0 } });
  assert.equal(audit.leagues.find(league => league.league === 'Eredivisie').competition, 'Dutch KPN-Telecompetition');
  assert.ok(doc.clubs.some(club => club.name === 'Stubvoort' && club.league === 'Eredivisie'));
  assert.deepEqual(doc.nations['854'][2].map(tuple => [tuple[1], tuple[5]]), [['Fakeo Burkinotest', 'Burkino Faso']]);
  assert.deepEqual(audit.unmapped, {});
});

test('an SI edition before CM 01/02 in the same tables makes a set of kind cm, and the builder checks the kind it is told', () => {
  const files = writeCm0102Files(sampleDatabase(), { format: 1 });
  const release = { id: 'cm-1234', edition: 'CM Fixture', label: '9.99', provider: 'Fixture makers', season: '1999/00', year: 2000, released: '1999-11',
    url: 'https://example.test/cm-fixture', shifts: { birth: 0 }, signatures: [{ club: files['club.dat'].length, staff: files['staff.dat'].length }] };
  const { doc } = buildFootballSet(files, { databases: [release], local: false, kind: 'cm' });
  assert.deepEqual(Object.keys(doc).slice(0, 3), ['format', 'kind', 'id'], 'the kind where CM 97/98\'s file has it');
  assert.deepEqual([doc.kind, doc.id, doc.season, doc.label, doc.source.edition], ['cm', 'cm-1234', '1999/00', 'CM Fixture · 9.99', 'CM Fixture']);
  assert.equal(doc.version, `cm-1234-${contentHash(doc)}`);
  assert.doesNotThrow(() => decodeFootballSet(doc));
  assert.throws(() => buildFootballSet(files, { databases: [release], kind: 'cm0102' }), /cm-1234 makes a set of kind cm, not cm0102/);
  const plain = buildFootballSet(files, { databases: [], identity: { label: 'Fixture', released: '1999-11', url: 'https://example.test/x', dobShift: 0 }, kind: 'cm0102' });
  assert.equal(plain.doc.kind, undefined, 'a CM 01/02 set names no kind');
});

// ---------- CM 97/98 ----------

const SOURCE_9798 = { provider: 'Sports Interactive', edition: 'CM 97/98', version: 'test', snapshotDate: '1997-10', url: 'https://example.test/cm9798',
  rawScale: CM_SCALE, conversion: CM_CONVERSION };
const POSITIONS = { gk: { goalkeeper: 2, central: 2 }, d: { defence: 2, central: 2 }, m: { midfield: 2, central: 2 }, f: { attack: 2, central: 2 } };
function record(over = {}) {
  const positions = { goalkeeper: 0, sweeper: 0, defence: 0, anchor: 0, midfield: 0, support: 0, attack: 0, right: 0, left: 0, central: 0,
    ...POSITIONS[over.role ?? 'm'] };
  return { id: 7, firstName: 'Fake', secondName: `Player${over.n ?? 0}`, nation: 'England', currentClub: 'Testford United', ability: 120,
    potential: 150, reputation: 100, attributes: {}, ...over, positions: { ...positions, ...over.positions } };
}
const TEAMS = [{ name: 'Testford United', shortName: 'Testford', nation: 'England', division: 'EPR' },
  { name: 'Real Ficticio', shortName: '', nation: 'Spain', division: 'SP1' },
  ...['ISA', 'GD1', 'FD1', 'HD1', 'PD1'].map(division => ({ name: `Club ${division}`, shortName: '', nation: 'X', division })),
  { name: 'Free Transfer', shortName: '', nation: '', division: '' }, { name: 'Retired', shortName: '', nation: '', division: '' },
  // The clubs players name otherwise (CM9798_CLUB_ALIASES), here in no top division.
  ...['Newcastle United', 'Sheffield Wednesday', 'FC Schalke 04'].map(name => ({ name, shortName: '', nation: 'X', division: 'X' }))];

test('CM 97/98: the extraction\'s own players, by their place in the file, positions as CM 01/02 reads them', () => {
  const xi = ['gk', 'd', 'd', 'd', 'd', 'm', 'm', 'm', 'm', 'f', 'f'];
  const players = [
    ...xi.map((role, n) => record({ role, n, ability: 100 + n })),
    record({ n: 20, ability: 0 }), // unrated: left out
    record({ n: 21, currentClub: 'Retired', ability: 150 }), // retired: plays for nobody
    record({ n: 22, currentClub: 'Free Transfer', nation: 'Republic of Congo', ability: 140 }), // DR Congo, no club
    record({ n: 23, positions: { midfield: 12 }, ability: 130 }), // a value outside 0-2 reads as 0: no position left
    record({ n: 24, currentClub: 'Real Ficticio', nation: 'Eire', ability: 90 }),
    record({ n: 25, currentClub: 'Partick T', nation: 'Bielorussia', ability: 80 }), // a club with no record keeps its name
    record({ n: 26, currentClub: 'Newcastle U', nation: 'Scotland', ability: 85 }), // another of its names
  ];
  const { doc, audit, warnings } = buildCm9798Season({ players, teams: TEAMS }, { source: SOURCE_9798, year: 1998 });
  assert.deepEqual([doc.kind, doc.id, doc.season, doc.label, doc.local], ['cm', 'cm-9798', '1997/98', 'CM 97/98', false]);
  // Every player keeps the id of his place in the file, whatever the extraction's own (all 7 here).
  assert.deepEqual(doc.nations['826'][2].map(tuple => tuple[0]).sort((a, b) => a - b), Array.from({ length: 11 }, (_, i) => i + 1));
  assert.equal(doc.clubs.length, 1, 'Testford United alone has eleven');
  assert.deepEqual([doc.clubs[0].name, doc.clubs[0].league, doc.clubs[0].country], ['Testford United', 'Premier League', '826']);
  assert.deepEqual(doc.nations['180'][2].map(tuple => [tuple[0], tuple[6]]), [[14, '']], 'Republic of Congo is DR Congo; a free agent has no club');
  assert.deepEqual(doc.nations['372'][2].map(tuple => tuple[6]), ['Real Ficticio']);
  assert.deepEqual(doc.nations['112'][2].map(tuple => tuple[6]), ['Partick T']);
  assert.deepEqual(doc.nations.SCO[2].map(tuple => tuple[6]), ['Newcastle United']);
  assert.deepEqual(audit.dropped, { noAbility: 1, noPositions: 1, retired: 1, noName: 0 });
  assert.ok(warnings.some(w => /Player23 \(Testford United\): midfield 12/.test(w)));
  assert.ok(tuplesOf(doc).every(tuple => tuple[7] === '' && tuple[2] === 0), 'no dates of birth, no separate full names');
  assert.deepEqual(doc.territory, territoryFor(FOOTBALL_FEDERATIONS, 1998));
  assert.doesNotThrow(() => decodeFootballSet(doc));
  // Natural where position and side are both 2; a 1 (can play there) is below CM 01/02's accomplished 15.
  assert.deepEqual(cm9798Ratings({ goalkeeper: 0, sweeper: 1, defence: 2, anchor: 0, midfield: 1, support: 0, attack: 0, right: 2, left: 0, central: 1 }),
    { wb: 0, free: 0, gk: 0, sw: 10, d: 20, dm: 0, m: 10, am: 0, f: 0, right: 20, left: 0, centre: 10 });
  assert.deepEqual(CM9798_CLUB_ALIASES, { 'Newcastle U': 'Newcastle United', 'Sheff W': 'Sheffield Wednesday', Schalke: 'FC Schalke 04' });
});

test('CM 97/98 stops rather than guess', () => {
  const build = (players, teams = TEAMS) => () => buildCm9798Season({ players, teams }, { source: SOURCE_9798, year: 1998 });
  assert.throws(build([record({ nation: 'Atlantis' })]), /no game nation, and not listed as having no team: Atlantis/);
  assert.throws(build([record({ ability: 250 })]), /ability 250/);
  assert.throws(build([record()], [...TEAMS, { name: 'Other', shortName: 'Testford', nation: 'England', division: 'ED1' }]), /EPR team Testford United shares a name/);
  assert.throws(build([record()], TEAMS.filter(team => team.division !== 'PD1')), /No PD1 teams/);
  // The committed season: the clubs of the seven top divisions with eleven rated players, and its provenance stated.
  const doc = committed('cm-9798');
  assert.equal(doc.clubs.length, 124);
  assert.match(doc.source.provenance, /names neither the tool .* nor the game's version/);
  assert.ok(tuplesOf(doc).every(tuple => tuple[7] === ''));
});

// ---------- SWOS 96/97 ----------

test('SWOS names are set in their country\'s case, changing only the case', () => {
  const cases = [['ALAN SHEARER', 'ENG', 'Alan Shearer'], ['STEVE MCMANAMAN', 'ENG', 'Steve McManaman'], ['EDWIN VAN DER SAR', 'HOL', 'Edwin van der Sar'],
    ['FRANK DE BOER', 'HOL', 'Frank de Boer'], ['GILLES DE BILDE', 'BEL', 'Gilles De Bilde'], ['FRANKY VAN DER ELST', 'BEL', 'Franky Van der Elst'],
    ['ROBERTO DI MATTEO', 'ITA', 'Roberto Di Matteo'], ['IVAN DE LA PENA', 'ESP', 'Ivan de la Pena'], ['JOSE DEL SOLAR', 'PER', 'Jose del Solar'],
    ['FRANCOIS OMAM-BIYIK', 'CMR', 'Francois Omam-Biyik'], ['S.M. ASLAM', 'BAN', 'S.M. Aslam'], ['TERRY ST. LOUIS', 'TRI', 'Terry St. Louis'],
    ['NGUYEN VAN DUNG', 'VIE', 'Nguyen Van Dung'], ['DE BOER', 'HOL', 'De Boer']];
  for (const [name, nationality, cased] of cases) {
    assert.equal(properCase(name, nationality), cased);
    assert.equal(cased.toUpperCase(), name);
  }
  const doc = committed('swos-9697');
  assert.ok(tuplesOf(doc).every(tuple => tuple[1] === properCase(tuple[1].toUpperCase(), null) || /\b(van|de|der|del|la|da|dos)\b/.test(tuple[1])));
});

const SOURCE_SWOS = { provider: 'Sensible Software', edition: 'SWOS 96/97', version: 'test', snapshotDate: '1996', url: 'https://example.test/swos',
  rawScale: SWOS_SCALE, conversion: SWOS_CONVERSION };
let nextRow = 1;
/** A national team's sixteen invented records: two keepers and a 4-4-2 of SWOS positions, skills summing to the price step. */
function nationalTeam(team, nat, over = {}) {
  const positions = ['G', 'G', 'RB', 'LB', 'D', 'D', 'D', 'RW', 'LW', 'M', 'M', 'M', 'A', 'A', 'A', 'A'];
  return positions.map((pos, i) => {
    const skills = pos === 'G' ? [0, 0, 0, 0, 0, 0, 0] : [3, 3, 3, 3, 3, 3, i % 4];
    const step = pos === 'G' ? 20 + i : Math.max(1, Math.min(48, skills.reduce((s, x) => s + x, 0)));
    return { id: nextRow++, player_no: i + 1, name: `${team} PLAYER ${i + 1}`, pos, nat, PA: skills[0], VE: skills[1], HE: skills[2], TA: skills[3],
      CO: skills[4], SP: skills[5], FI: skills[6], GK: pos === 'G' ? step : 0, value: SWOS_PRICES[step], team, league: 'EUROPE', type: 'NATIONAL', ...over[i] };
  });
}

test('SWOS 96/97: each nation\'s own sixteen, its best eleven by SWOS\'s positions, rated by price step', () => {
  nextRow = 1;
  const rows = [...nationalTeam('ENGLAND', 'ENG'), ...nationalTeam('HOLLAND', 'HOL'), ...nationalTeam('MALTA', 'MLT')];
  const { doc, audit } = buildSwosSeason(rows, { source: SOURCE_SWOS, year: 1997, prices: SWOS_PRICES });
  assert.deepEqual([doc.kind, doc.id, doc.season, doc.clubs, doc.local], ['swos', 'swos-9697', '1996/97', [], false]);
  assert.deepEqual([doc.nations['826'][1], doc.nations['826'][2].length, doc.nations['528'][1]], [SWOS_SQUAD, 11, SWOS_SQUAD]);
  assert.deepEqual(audit.noTeam, { Malta: 16 }, 'a team with no shape on the map is left out');
  const england = decodeFootballSet(doc).rosters['826'][2];
  assert.deepEqual(england.map(player => player[1]).sort(), ['DF', 'DF', 'DF', 'DF', 'FW', 'FW', 'GK', 'MF', 'MF', 'MF', 'MF'], 'a natural 4-4-2, wingers in midfield');
  for (const [name, , rating, info] of england) {
    assert.equal(rating, swosGameRating(info.rawRating));
    assert.equal(info.nationality, 'England');
    assert.deepEqual(swosTupleOf(name, info), doc.nations['826'][2].find(tuple => tuple[1] === name));
  }
  // A shape held by a federation SWOS has no squad for stays neutral: here France, FR Yugoslavia and Sudan field none.
  assert.deepEqual(doc.territory, territoryFor(FOOTBALL_FEDERATIONS, 1997, { fields: id => ['826', '528'].includes(id) }));
  assert.throws(() => expandSwosTuple([1, 'X', 0, 20, 'g', 'England', '', '', '1234567'], SOURCE_SWOS), /Invalid SWOS tuple/, 'a keeper has no skills');
});

test('SWOS 96/97 stops rather than guess', () => {
  const build = rows => () => buildSwosSeason(rows, { source: SOURCE_SWOS, year: 1997, prices: SWOS_PRICES });
  nextRow = 1;
  assert.throws(build(nationalTeam('ATLANTIS', 'ATL')), /no game nation, and not listed as having no team: ATLANTIS/);
  assert.throws(build(nationalTeam('ENGLAND', 'ENG').slice(1)), /ENGLAND has 15 players, not 16/);
  assert.throws(build(nationalTeam('ENGLAND', 'ENG', { 2: { value: 26000 } })), /price 26000, not a SWOS value step/);
  assert.throws(build(nationalTeam('ENGLAND', 'ENG', { 2: { PA: 7 } })), /skills summing to 24 but price step 20/);
  assert.throws(build(nationalTeam('ENGLAND', 'ENG', { 0: { GK: 3 } })), /Goalkeeper .* GK 3 for price step 20/);
  assert.throws(build(nationalTeam('ENGLAND', 'ENG', { 3: { pos: 'SW' } })), /position SW/);
  assert.throws(build([...nationalTeam('YUGOSLAVIA', 'YUG'), ...nationalTeam('YUGOSLAVIA', 'YUG')]), /YUGOSLAVIA has 32 players/);
  // The committed season: every national team SWOS has, sixteen each, and none for a nation it lacks.
  const doc = committed('swos-9697');
  const listed = Object.values(doc.nations).filter(([, pool]) => pool);
  assert.equal(listed.length, 133);
  assert.ok(listed.every(([, pool, squad]) => pool === SWOS_SQUAD && squad.length === 11));
  const shearer = doc.nations['826'][2].find(tuple => tuple[1] === 'Alan Shearer');
  assert.deepEqual(shearer.slice(3), [48, 'a', 'England', '', '', '7777777']);
  assert.deepEqual(doc.nations['070'], [40, 0, []], 'Bosnia played, but SWOS has no team for it');
  assert.match(doc.source.provenance, /predate 1996/);
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
  const f = syncAppFixture({ App: B.App, phase: 'setup', ids: ['826', '250', '724'],
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

test('the running App launches a 1996/97 nations campaign on SWOS\'s squads, and resumes it without the file', async () => {
  const doc = committed('swos-9697');
  await withApp(async fixture => {
    const { app, time } = fixture;
    await app.requestSeasons();
    assert.ok(app.state.footballSets.some(set => set.id === 'swos-9697' && set.season === '1996/97'), 'listed before any request');
    app.pickSetup('layer', 'clubs');
    app.pickSetup('dataSet', 'swos-9697');
    assert.equal(app.state.setup.layer, 'nations', 'a season with nations only takes the nations');
    time.advance(200);
    await app.loadSet('swos-9697');
    await settle();
    assert.equal(app.seasonStatus().state, 'ready');
    assert.equal(buildSetupModel(app.state.setup, { managerTeams: app.setupTeams(), season: app.seasonStatus() }).campaignSummary,
      'Football · Nations · Europe · 1996/97');

    app.startCampaign();
    const st = app.state;
    assert.equal(st.phase, 'playing');
    assert.deepEqual([st.settings.dataSet, st.settings.dataVersion, st.settings.dataYear, st.settings.dataSeason], ['swos-9697', doc.version, 1997, '1996/97']);
    assert.equal(st.campaignName, 'Football 1996/97 · Europe');
    assert.deepEqual(st.teams['826'].squad.map(player => player.name), doc.nations['826'][2].map(tuple => tuple[1]), 'England\'s SWOS XI');
    assert.ok(st.teams['826'].squad.every(player => player.sourceInfo.source === 'swos' && player.sourceInfo.edition === 'SWOS 96/97'
      && player.rating === swosGameRating(player.sourceInfo.rawRating)));
    // FR Yugoslavia holds Montenegro and Kosovo; Bosnia had joined FIFA.
    assert.ok(!st.teams['499'] && !st.teams.KOS && st.own['499'] === '688' && st.own.KOS === '688');
    assert.ok(!st.teams['070'] && !('070' in st.own), 'Bosnia, a member with no SWOS player, fields no team: its land is neutral');
    resumes(fixture, '/football/swos-9697.json', { kind: 'swos', source: { provider: 'Sensible Software', edition: 'SWOS 96/97',
      version: doc.source.version, snapshotDate: '1996', url: doc.source.url } });
  });
});

test('the running App launches a 2001/02 clubs campaign on its own map of Europe, and resumes it without the file', async () => {
  const doc = committed('cm0102-2001-09');
  await withApp(async fixture => {
    const { app, time } = fixture;
    app.pickSetup('layer', 'clubs');
    app.pickSetup('clubScope', 'domestic:eu32');
    app.pickSetup('dataSet', 'cm0102-2001-09');
    assert.deepEqual([app.state.setup.layer, app.state.setup.clubScope], ['clubs', 'domestic:eu32s2002'], 'the theatre follows the season');
    time.advance(200);
    await app.loadSet('cm0102-2001-09');
    await app.loadCountry('eu32s2002');
    await settle();
    app.startCampaign();
    const st = app.state;
    assert.equal(st.phase, 'playing');
    assert.deepEqual([st.settings.dataSet, st.settings.dataSeason, st.settings.domesticVersion],
      ['cm0102-2001-09', '2001/02', EUROPE_MAPS.find(entry => entry.id === 'eu32s2002').version]);
    const elite = strongestClubs(doc.clubs, ELITE_CLUBS);
    assert.deepEqual(Object.keys(st.teams).sort(), elite.map(club => club.id).sort(), 'the season\'s elite');
    const top = elite[0];
    assert.deepEqual(st.teams[top.id].squad.map(player => player.name), top.squad.map(tuple => tuple[1]), 'with its CM players');
    assert.ok(st.teams[top.id].squad.every(player => player.sourceInfo.source === 'cm0102' && player.sourceInfo.version === '3.9.60'
      && player.sourceInfo.provider === 'Sports Interactive'));
    resumes(fixture, '/football/cm0102-2001-09.json', { kind: 'cm0102', source: { provider: 'Sports Interactive', edition: 'CM 01/02',
      version: '3.9.60', snapshotDate: '2001-09', url: 'https://www.champman0102.co.uk/viewtopic.php?t=65' } });
  }, { layer: 'nations' });
});

test('the running App offers 2000/01 and 1999/00 with clubs and nations, and plays 1999/00\'s clubs on its own map of Europe', async () => {
  const doc = committed('cm-9900');
  await withApp(async fixture => {
    const { app, time } = fixture;
    await app.requestSeasons();
    const options = buildSetupModel(app.state.setup, { season: app.seasonStatus() }).season.options.map(option => option.name);
    assert.ok(options.includes('2000/01') && options.includes('1999/00'), 'listed by season, as no other source shares them');
    // Nations stay nations with 2000/01; clubs with 1999/00 follow it onto its map.
    app.pickSetup('dataSet', 'cm-0001');
    assert.deepEqual([app.state.setup.layer, app.state.setup.dataSet], ['nations', 'cm-0001']);
    app.pickSetup('layer', 'clubs');
    app.pickSetup('clubScope', 'domestic:eu32');
    app.pickSetup('dataSet', 'cm-9900');
    assert.deepEqual([app.state.setup.layer, app.state.setup.clubScope], ['clubs', 'domestic:eu32s2000'], 'the theatre follows the season');
    time.advance(200);
    await app.loadSet('cm-9900');
    await app.loadCountry('eu32s2000');
    await settle();
    app.startCampaign();
    const st = app.state;
    assert.equal(st.phase, 'playing');
    assert.deepEqual([st.settings.dataSet, st.settings.dataSeason, st.settings.domesticVersion],
      ['cm-9900', '1999/00', EUROPE_MAPS.find(entry => entry.id === 'eu32s2000').version]);
    const elite = strongestClubs(doc.clubs, ELITE_CLUBS);
    assert.deepEqual(Object.keys(st.teams).sort(), elite.map(club => club.id).sort(), 'the season\'s elite');
    assert.equal(elite[0].name, 'Juventus');
    assert.deepEqual(st.teams[elite[0].id].squad.map(player => player.name), elite[0].squad.map(tuple => tuple[1]), 'with its CM 99/00 players');
    assert.ok(st.teams[elite[0].id].squad.every(player => player.sourceInfo.edition === 'CM 99/00' && player.sourceInfo.version === '3.70'
      && player.sourceInfo.provider === 'Sports Interactive'));
    resumes(fixture, '/football/cm-9900.json', { kind: 'cm', source: { provider: 'Sports Interactive', edition: 'CM 99/00',
      version: '3.70', snapshotDate: '1999-11', url: 'https://archive.org/details/championship-manager-season-9900' } });
  }, { layer: 'nations' });
});
