// A country map cut to fewer clubs (src/engine/clubSplit.js, docs/design/domestic-campaigns.md "Choosing the number of
// clubs"): the cut itself on shipped maps, the loader, the index entries, setup and challenge links, and saves.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { SPLIT_MIN_CLUBS, mapFileId, parseSplitId, splitDomestic, splitMapId } from '../src/engine/clubSplit.js';
import { clearDomesticCache, decodeDomestic, getLoadedDomestic, loadDomestic, retainDomestic } from '../src/engine/domestic.js';
import { colourDistance } from '../src/engine/colour.js';
import { fitDomesticCampaign } from '../src/engine/storage.js';
import { isEraMap, isSeasonCountryMap } from '../src/engine/footballSets.js';
import { SEASON_COUNTRY_MAPS, countryMapWith, domesticEntry, domesticLabel, fullMapOf } from '../src/data/domesticScope.js';
import { DOMESTIC } from '../src/data/domestic.js';
import { DEFAULT_SETUP, setClubScope } from '../src/app/shared.js';
import { buildSetupModel } from '../src/screens/setup/setupModel.js';
import { challengeQuery, readChallenge } from '../src/screens/setup/challenge.js';
import { europeMapOf } from '../src/data/domesticScope.js';
// Today's Europe maps, by the index: the built-in season's field by results (eu124b2027).
const TODAY_TOP = europeMapOf('all').id, TODAY_ELITE = europeMapOf('elite').id;

const ROOT = new URL('../public/domestic/', import.meta.url);
const files = new Map();
const raw = id => {
  if (!files.has(id)) files.set(id, readFileSync(new URL(`${id}.json`, ROOT), 'utf8'));
  return JSON.parse(files.get(id));
};
const sectionsOf = doc => doc.topology.objects.sections.geometries;
const arcsOf = geometry => (geometry.type === 'Polygon' ? [geometry.arcs] : geometry.arcs);

/** Sections sharing an arc, by id. */
function landBorders(doc) {
  const owners = {};
  for (const g of sectionsOf(doc)) for (const polygon of arcsOf(g)) for (const ring of polygon) for (const i of ring) (owners[i < 0 ? ~i : i] ||= new Set()).add(g.id);
  const next = {};
  for (const set of Object.values(owners)) for (const a of set) for (const b of set) if (a !== b) (next[a] ||= new Set()).add(b);
  return next;
}

/** Landmass (sections joined by land) per section id. */
function landmasses(doc, next = landBorders(doc)) {
  const mass = {};
  let count = 0;
  for (const g of sectionsOf(doc)) {
    if (mass[g.id] != null) continue;
    const stack = [g.id];
    mass[g.id] = count;
    while (stack.length) for (const t of next[stack.pop()] || []) if (mass[t] == null) { mass[t] = count; stack.push(t); }
    count++;
  }
  return mass;
}

/**
 * The rules every cut map keeps: its first clubs, whole; every section held once; each club starting on all of its
 * full map's sections (renumbered) and in one piece on each landmass; ids and order as the build writes them.
 */
function checkCut(full, doc, clubs) {
  const id = splitMapId(full.id, clubs);
  assert.equal(doc.id, id);
  assert.match(doc.version, new RegExp(`^${id}-[0-9a-f]{8}$`));
  assert.equal(doc.base, full.id);
  assert.equal(doc.baseVersion, full.version);
  assert.equal(doc.clubs.length, clubs);
  const ids = sectionsOf(doc).map(g => g.id);
  assert.deepEqual(ids, ids.map((_, i) => `${id}-${String(i + 1).padStart(3, '0')}`), `${id}: sections numbered in order`);
  assert.deepEqual(doc.clubs.flatMap(club => club.sections), ids, `${id}: the groups list every section once, club by club`);
  // The same geometry: each new section is one of the full map's, by its arcs.
  const oldByArcs = new Map(sectionsOf(full).map(g => [JSON.stringify(g.arcs), g.id]));
  const oldOf = Object.fromEntries(sectionsOf(doc).map(g => [g.id, oldByArcs.get(JSON.stringify(g.arcs))]));
  assert.equal(new Set(Object.values(oldOf)).size, sectionsOf(full).length, `${id}: every section of the full map, once`);
  const next = landBorders(doc), mass = landmasses(doc, next);
  doc.clubs.forEach((club, i) => {
    const before = full.clubs[i];
    const { section, sections, col, ...rest } = club;
    const { section: oldSection, sections: oldSections, col: oldCol, ...oldRest } = before;
    assert.deepEqual(rest, oldRest, `${id}: ${club.name} is the full map's club ${i + 1}`);
    assert.equal(sections[0], section, `${id}: ${club.name} lists its home first`);
    assert.equal(oldOf[section], oldSection, `${id}: ${club.name} keeps its home section`);
    const mine = new Set(sections.map(s => oldOf[s]));
    for (const s of oldSections) assert.ok(mine.has(s), `${id}: ${club.name} keeps ${s}`);
    // One piece on each landmass.
    const inGroup = new Set(sections), seen = new Set(), masses = new Set();
    for (const s of sections) {
      if (seen.has(s)) continue;
      assert.ok(!masses.has(mass[s]), `${id}: ${club.name}'s land is in two pieces on one landmass`);
      masses.add(mass[s]);
      const stack = [s];
      seen.add(s);
      while (stack.length) for (const t of next[stack.pop()] || []) if (inGroup.has(t) && !seen.has(t)) { seen.add(t); stack.push(t); }
    }
  });
  return { next, oldOf };
}

test('a cut map id names its full map and its number of clubs', () => {
  assert.deepEqual(parseSplitId('724c20'), { base: '724', clubs: 20 });
  assert.deepEqual(parseSplitId('826y2011c5'), { base: '826y2011', clubs: 5 });
  assert.deepEqual(parseSplitId('SCOy2016c12'), { base: 'SCOy2016', clubs: 12 });
  for (const id of ['724', '826y2011', 'nba', 'cfb2004', 'eu124e1996', '724c0', '724c100', '724c', 'c20', 'euc20']) assert.equal(parseSplitId(id), null, id);
  assert.equal(splitMapId('724', 20), '724c20');
  assert.equal(mapFileId('724y2016c20'), '724y2016');
  assert.equal(mapFileId('nba'), 'nba');
});

test('England, Spain of 2015/16 and Indonesia cut to several counts keep every rule and decode', () => {
  for (const id of ['826', '724y2016', '360']) {
    const full = raw(id);
    for (const clubs of [SPLIT_MIN_CLUBS, 4, 10, 20, full.clubs.length - 1]) {
      const doc = splitDomestic(full, clubs);
      checkCut(full, doc, clubs);
      const decoded = decodeDomestic(doc, doc.id);
      assert.equal(decoded.clubs.length, clubs);
      assert.equal(Object.keys(decoded.startOwners).length, sectionsOf(full).length);
    }
  }
});

test('a cut is the same every time, and its version changes with the count', () => {
  const full = raw('380');
  const a = splitDomestic(full, 20), b = splitDomestic(raw('380'), 20), c = splitDomestic(full, 19);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.notEqual(a.version.slice(-8), c.version.slice(-8));
  // The full map's file is left as it was.
  assert.equal(JSON.stringify(full), JSON.stringify(raw('380')));
});

test('neighbouring clubs on a cut map are coloured apart', () => {
  let pairs = 0, close = 0;
  for (const [id, clubs] of [['826', 20], ['724', 20], ['380', 10], ['276', 18], ['250', 12], ['076', 30]]) {
    const full = raw(id), doc = splitDomestic(full, clubs);
    const next = landBorders(doc);
    const clubOf = Object.fromEntries(doc.clubs.flatMap((club, i) => club.sections.map(s => [s, i])));
    const seen = new Set();
    for (const [s, list] of Object.entries(next)) {
      for (const t of list) {
        const a = clubOf[s], b = clubOf[t];
        if (a === b || seen.has(`${Math.min(a, b)}-${Math.max(a, b)}`)) continue;
        seen.add(`${Math.min(a, b)}-${Math.max(a, b)}`);
        pairs++;
        if (colourDistance(doc.clubs[a].col, doc.clubs[b].col) < 0.1) close++;
      }
    }
  }
  assert.ok(pairs > 200, `${pairs} neighbouring pairs`);
  assert.equal(close, 0, `${close} of ${pairs} neighbouring clubs too close in colour`);
});

test('every country map of today cuts quickly to two, a quarter and all but one of its clubs', () => {
  let slowest = 0;
  for (const entry of DOMESTIC) {
    const full = raw(entry.id);
    for (const clubs of new Set([SPLIT_MIN_CLUBS, Math.max(SPLIT_MIN_CLUBS, Math.round(full.clubs.length / 4)), full.clubs.length - 1])) {
      const start = performance.now();
      const doc = splitDomestic(full, clubs);
      slowest = Math.max(slowest, performance.now() - start);
      checkCut(full, doc, clubs);
    }
  }
  assert.ok(slowest < 400, `the slowest cut took ${slowest.toFixed(0)} ms`);
});

test('a sample of the earlier seasons\' country maps cut and decode', () => {
  const ids = readdirSync(ROOT).filter(name => /^[0-9A-Z]{3}y\d{4}\.json$/.test(name)).map(name => name.slice(0, -5)).sort();
  // Every twentieth map, and the islands and crowded capitals of the sample with them.
  const sample = [...new Set([...ids.filter((_, i) => i % 20 === 0), '826y1995', '724y2016', '380y2003', '300y2016'])].filter(id => ids.includes(id));
  assert.ok(sample.length > 50);
  for (const id of sample) {
    const full = raw(id);
    const clubs = Math.max(SPLIT_MIN_CLUBS, Math.floor(full.clubs.length / 2));
    const doc = splitDomestic(full, clubs);
    checkCut(full, doc, clubs);
    decodeDomestic(doc, doc.id);
  }
});

test('the count must leave a campaign and cut something', () => {
  const full = raw('242');
  assert.throws(() => splitDomestic(full, 1), /Fiji has 16 clubs, so it cannot be cut to 1/);
  assert.throws(() => splitDomestic(full, 16), /cannot be cut to 16/);
  assert.throws(() => splitDomestic(full, 2.5), /cannot be cut to 2.5/);
  // A cut map says which map it is: a file of another count, or none, is refused.
  const doc = splitDomestic(full, 8);
  assert.throws(() => decodeDomestic(doc, '242c9'), /file id "242c8" does not match the requested country/);
  assert.throws(() => decodeDomestic({ ...doc, id: '242c9', version: `242c9-${doc.version.slice(-8)}` }, '242c9'), /must be 242's map cut to 9 clubs/);
  assert.throws(() => decodeDomestic({ ...doc, id: '242', version: full.version }, '242'), /base is only for a map cut to fewer clubs/);
});

test('the loader cuts a map from its full map\'s file, fetched once, and drops the file when a campaign takes over', async () => {
  clearDomesticCache();
  const fetched = [];
  const fetch = async url => {
    fetched.push(String(url));
    const id = String(url).match(/([^/]+)\.json$/)[1];
    return { ok: true, status: 200, json: async () => raw(id) };
  };
  const twenty = await loadDomestic('724c20', { baseUrl: '/', fetch });
  // The map on show stays decoded while others are browsed.
  retainDomestic(['724c20']);
  assert.equal(twenty.meta.id, '724c20');
  assert.equal(twenty.clubs.length, 20);
  assert.deepEqual(twenty.clubs.map(club => club.id), raw('724').clubs.slice(0, 20).map(club => club.id));
  assert.equal(Object.values(twenty.startOwners).length, 100);
  const ten = await loadDomestic('724c10', { baseUrl: '/', fetch });
  assert.equal(ten.clubs.length, 10);
  const full = await loadDomestic('724', { baseUrl: '/', fetch });
  assert.equal(full.clubs.length, 100);
  assert.deepEqual(fetched, ['/domestic/724.json'], 'one fetch for the file');
  // A campaign keeps its own map decoded, and no file.
  retainDomestic(['724c20'], 0);
  assert.ok(getLoadedDomestic('724c20'));
  assert.equal(getLoadedDomestic('724c10'), null);
  await loadDomestic('724c12', { baseUrl: '/', fetch });
  assert.equal(fetched.length, 2, 'the file fetched again');
  // A count the map cannot be cut to fails with the map named; an id that names no country map is no cut, only a file.
  await assert.rejects(loadDomestic('242c20', { baseUrl: '/', fetch }), /Domestic map 242c20: Fiji has 16 clubs, so it cannot be cut to 20/);
  await assert.rejects(loadDomestic('nbac2', { baseUrl: '/', fetch: async () => ({ ok: false, status: 404 }) }), /Domestic map nbac2 failed to load \(HTTP 404\)/);
  clearDomesticCache();
});

test('index entries, labels and the season checks see a cut map as its country\'s', () => {
  const spain = domesticEntry('domestic:724');
  const cut = domesticEntry('domestic:724c20');
  assert.equal(cut.id, '724c20');
  assert.equal(cut.name, 'Spain');
  assert.equal(cut.country, '724');
  assert.equal(cut.clubs, 20);
  assert.equal(cut.cut, 20);
  assert.equal(cut.baseClubs, spain.clubs);
  assert.equal(domesticEntry('domestic:724c20'), cut, 'one entry per id');
  assert.equal(fullMapOf(cut), spain);
  assert.equal(domesticLabel('domestic:724c20'), 'Spain · top 20 clubs');
  assert.equal(domesticEntry('domestic:724c100'), null, 'Spain has 100 clubs: nothing to cut');
  assert.equal(domesticEntry('domestic:724c1'), null);
  assert.equal(domesticEntry('domestic:999c20'), null);
  assert.equal(countryMapWith(spain, 20), cut);
  assert.equal(countryMapWith(cut, null), spain);
  assert.equal(countryMapWith(cut, 100), spain);
  assert.equal(countryMapWith(cut, 500), spain);
  const season = SEASON_COUNTRY_MAPS.find(entry => entry.id === '724y2016');
  const seasonCut = domesticEntry('domestic:724y2016c20');
  assert.equal(seasonCut.season, season.season);
  assert.equal(seasonCut.country, '724');
  assert.ok(isSeasonCountryMap('724y2016c20', season.season));
  assert.ok(isEraMap('724y2016c20'));
  assert.ok(!isEraMap('724c20'));
});

test('the number of clubs follows the country and the season, and a challenge link carries it', () => {
  const setup = { ...DEFAULT_SETUP, sport: 'football', layer: 'clubs', clubScope: 'domestic:724', clubCount: 20 };
  assert.equal(setClubScope(setup), 'domestic:724c20');
  // Another country takes as many as it has; all of them is the map as built.
  const fiji = DOMESTIC.find(entry => entry.id === '242');
  assert.equal(setClubScope({ ...setup, clubScope: 'domestic:242' }), fiji.clubs > 20 ? 'domestic:242c20' : 'domestic:242');
  assert.equal(setClubScope({ ...setup, clubCount: null }), 'domestic:724');
  // A setup that names no count keeps its map's.
  const { clubCount, ...unnamed } = setup;
  assert.equal(setClubScope({ ...unnamed, clubScope: 'domestic:724c12' }), 'domestic:724c12');
  // An earlier season's map of the country, cut alike.
  const season = SEASON_COUNTRY_MAPS.find(entry => entry.id === '724y2016');
  assert.equal(setClubScope({ ...setup, dataSet: season.season }), 'domestic:724y2016c20');
  // The link names the cut map; opening it sets the count.
  const query = challengeQuery({ ...setup, clubScope: 'domestic:724c20' }, 7);
  assert.match(query, /theatre=domestic:724c20/);
  const read = readChallenge(`?${query}`, DEFAULT_SETUP);
  assert.equal(read.setup.clubScope, 'domestic:724c20');
  assert.equal(read.setup.clubCount, 20);
});

test('setup offers the number of clubs beside the country, and describes the cut map', () => {
  const model = buildSetupModel({ ...DEFAULT_SETUP, sport: 'football', layer: 'clubs', clubScope: 'domestic:724c20', clubCount: 20 },
    { domestic: { state: 'ready', top: ['Real Madrid', 'FC Barcelona', 'Atlético de Madrid'] } });
  assert.deepEqual(model.clubCount, { value: 20, min: SPLIT_MIN_CLUBS, max: 100, cut: true });
  assert.equal(model.countryScopeId, 'domestic:724');
  assert.equal(model.scopeName, 'Spain · top 20 clubs');
  assert.equal(model.count, 20);
  assert.match(model.countryNote, /^Real Madrid, FC Barcelona and Atlético de Madrid lead the top 20 of Spain's 100 clubs fighting over its 100 sections/);
  const full = buildSetupModel({ ...DEFAULT_SETUP, sport: 'football', layer: 'clubs', clubScope: 'domestic:724' }, {});
  assert.deepEqual(full.clubCount, { value: 100, min: SPLIT_MIN_CLUBS, max: 100, cut: false });
  // Europe's maps have no such choice.
  const europe = buildSetupModel({ ...DEFAULT_SETUP, sport: 'football', layer: 'clubs', clubScope: `domestic:${TODAY_TOP}` }, {});
  assert.equal(europe.clubCount, null);
  assert.equal(europe.countryScopeId, null);
});

test('a campaign saved on a cut map fits it again, and moves club by club when the map is rebuilt', () => {
  const doc = splitDomestic(raw('724'), 20);
  const map = decodeDomestic(doc, doc.id);
  const own = { ...map.startOwners };
  // Real Madrid has taken Getafe's land.
  const getafe = map.clubs.find(club => club.name === 'Getafe'), madrid = map.clubs.find(club => club.name === 'Real Madrid');
  for (const s of getafe.startSections) own[s] = madrid.id;
  const teams = Object.fromEntries(map.clubs.map(club => [club.id, { id: club.id, name: club.name, home: club.homeSection }]));
  const campaign = { teams, own, settings: { clubScope: 'domestic:724c20', domesticVersion: map.meta.version } };
  assert.equal(fitDomesticCampaign(campaign, map).campaign, campaign);
  // Saved on an earlier build of the cut: its section ids still run club by club, home first.
  const moved = fitDomesticCampaign({ ...campaign, settings: { ...campaign.settings, domesticVersion: '724c20-00000000' } }, map);
  assert.ok(!moved.error, moved.error);
  assert.deepEqual(moved.campaign.own, own);
});
