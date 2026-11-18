// The leagues' maps, today's and every era's (docs/design/domestic-campaigns.md, "The NBA map", "The NFL map", "The MLB
// map", "The NHL map", "The NRL map" and "The FBS map"): a club holds its own state or province (in New Zealand, region)
// and nothing else, a state with several clubs is divided between them, and every state and province without a club stays
// empty. The boundary layers are not in the repository, so towns stand in for them: every town lies on empty land of its
// own state or on a club's section, and no club's section reaches into a second state.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { feature } from 'topojson-client';
import { CLUB_MAPS } from '../src/data/clubMaps.js';
import { decodeDomestic } from '../src/engine/domestic.js';
import { kmToPolys, pointInPolys, polysOf } from './lib/domestic-partition.mjs';
import { cfbMapOf, cfbSeasonIdOf, cfbTeamsOf } from './lib/cfb-maps.mjs';

// Inland towns, clear of the simplified coasts and borders; the states that can be shared have several.
const TOWNS = {
  'US-AL': [[-86.3, 32.37]], 'US-AZ': [[-111.65, 35.2], [-111.84, 33.42]], 'US-AR': [[-92.29, 34.75]],
  'US-CA': [[-119.79, 36.74], [-122.39, 40.59], [-117.29, 34.11], [-121.89, 37.34]],
  'US-CO': [[-104.82, 38.83], [-108.55, 39.06]], 'US-CT': [[-72.68, 41.76]], 'US-DE': [[-75.52, 39.16]], 'US-DC': [[-77.02, 38.91]],
  'US-FL': [[-82.33, 29.65], [-84.28, 30.44], [-81.87, 26.64]], 'US-GA': [[-83.63, 32.84]], 'US-ID': [[-116.2, 43.62]],
  'US-IL': [[-89.65, 39.8], [-89.22, 37.73], [-89.09, 42.27]], 'US-IN': [[-85.14, 41.08], [-86.16, 39.77]], 'US-IA': [[-93.62, 41.59]],
  'US-KS': [[-97.34, 37.69]], 'US-KY': [[-84.5, 38.04]], 'US-LA': [[-92.45, 31.31]], 'US-ME': [[-68.77, 44.8]],
  'US-MD': [[-77.41, 39.41], [-76.88, 38.54]], 'US-MA': [[-71.8, 42.26], [-72.59, 42.1]], 'US-MI': [[-84.55, 42.73], [-87.67, 46.49]],
  'US-MN': [[-94.16, 45.56]], 'US-MS': [[-90.18, 32.3]], 'US-MO': [[-92.33, 38.95], [-93.29, 37.21]], 'US-MT': [[-108.5, 45.78]],
  'US-NE': [[-96.7, 40.81]], 'US-NV': [[-115.76, 40.83]], 'US-NH': [[-71.54, 43.21]], 'US-NJ': [[-74.45, 40.49], [-74.76, 39.95]],
  'US-NM': [[-106.65, 35.08]], 'US-NY': [[-76.15, 43.05], [-73.76, 42.65], [-78.88, 42.89]], 'US-NC': [[-79.79, 36.07]], 'US-ND': [[-100.78, 46.81]],
  'US-OH': [[-82.99, 39.96], [-83.55, 41.65], [-84.19, 39.76]], 'US-OK': [[-97.52, 35.47]], 'US-OR': [[-121.31, 44.06]],
  'US-PA': [[-76.88, 40.27], [-80.09, 42.13], [-77.86, 40.79]], 'US-RI': [[-71.46, 41.8]], 'US-SC': [[-81.03, 34]], 'US-SD': [[-100.35, 44.37]],
  'US-TN': [[-86.78, 36.16]], 'US-TX': [[-97.74, 30.27], [-102.37, 31.85], [-101.83, 35.2], [-97.33, 32.75]], 'US-UT': [[-111.66, 40.23]],
  'US-VT': [[-72.58, 44.26]], 'US-VA': [[-77.44, 37.54]], 'US-WA': [[-120.51, 46.6]], 'US-WV': [[-81.63, 38.35]], 'US-WI': [[-89.4, 43.07]],
  'US-WY': [[-106.31, 42.85]],
  'CA-AB': [[-114.07, 51.05]], 'CA-BC': [[-120.33, 50.67]], 'CA-MB': [[-97.14, 49.9]], 'CA-NB': [[-66.64, 45.96]], 'CA-NL': [[-54.61, 48.95]],
  'CA-NS': [[-63.28, 45.37]], 'CA-NT': [[-114.37, 62.45]], 'CA-NU': [[-96.03, 64.32]], 'CA-ON': [[-81, 46.49], [-89.25, 48.38]], 'CA-PE': [[-63.4, 46.35]],
  'CA-QC': [[-77.78, 48.1]], 'CA-SK': [[-106.67, 52.13]], 'CA-YT': [[-135.05, 60.72]],
  // The NRL's Australia and New Zealand: New South Wales and Queensland are shared.
  'AU-NSW': [[148.6, -32.25], [147.37, -35.12], [150.93, -31.09], [141.47, -31.95], [149.1, -33.28], [149.72, -34.75]],
  'AU-QLD': [[151.95, -27.56], [150.51, -23.38], [139.49, -20.73], [144.25, -23.44]], 'AU-VIC': [[143.85, -37.56], [144.28, -36.76]],
  'AU-ACT': [[149.13, -35.28]], 'AU-SA': [[137.77, -32.49], [139.27, -35.12]], 'AU-WA': [[121.47, -30.75]], 'AU-TAS': [[147.14, -41.44]],
  'AU-NT': [[133.88, -23.7]],
  'NZ-AUK': [[174.76, -36.85]], 'NZ-NTL': [[174.32, -35.73]], 'NZ-WKO': [[175.28, -37.79]], 'NZ-BOP': [[176.25, -38.14]],
  'NZ-GIS': [[177.7, -38.4]], 'NZ-HKB': [[176.84, -39.64]], 'NZ-TKI': [[174.28, -39.34]], 'NZ-MWT': [[175.61, -40.36]],
  'NZ-WGN': [[175.66, -40.95]], 'NZ-TAS': [[172.33, -41.8]], 'NZ-MBH': [[173.95, -41.51]], 'NZ-WTC': [[171.2, -42.45]],
  'NZ-CAN': [[172.64, -43.53]], 'NZ-OTA': [[169.38, -45.25]], 'NZ-STL': [[168.94, -46.1]],
};
// The country each region's code belongs to, by the game's world shape: a map tests the towns of its own hosts.
const HOST_OF = { US: '840', CA: '124', AU: '036', NZ: '554' };
// Empty regions with no town of their own, by host: Alaska joins the land only through Canada; Jervis Bay is
// Australia's other territory on the mainland, and the city of Nelson's region is a sliver of coast.
const UNTOWNED = { '124': ['US-AK'], '036': ['AUS-Other Territories'], '554': ['NZ-NLS'] };
// Off every map; Alaska only reaches the two that hold Canada.
const OFF_THE_MAP = { 'US-HI': [[-157.86, 21.31]] };
// Overseas land a league's club holds, which its map keeps (an island state is dropped unless a club plays there):
// college football's Hawaii, the Rainbow Warriors' (scripts/data/cfb-teams.json).
const HELD_OVERSEAS = { FBS: { 'US-HI': [[-157.86, 21.31]] } };
const ALASKA = [[-149.9, 61.22]];
// A league may join a state to another's clubs (LEAGUES in scripts/build-club-maps.mjs): those clubs hold both.
const JOINED = { NFL: { 'nfl-new-york-giants': ['US-NJ', 'US-NY'], 'nfl-new-york-jets': ['US-NJ', 'US-NY'],
  'nfl-baltimore-ravens': ['US-DC', 'US-MD'], 'nfl-washington-commanders': ['US-DC', 'US-MD'],
  // Washington's earlier names, on the earlier seasons' maps (scripts/data/nfl-seasons.json).
  'nfl-washington': ['US-DC', 'US-MD'], 'nfl-washington-football-team': ['US-DC', 'US-MD'] },
  // Boston Legacy FC plays in Rhode Island until White Stadium opens in 2028.
  NWSL: { 'w-boston-legacy-fc': ['US-MA', 'US-RI'] } };
const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

for (const entry of CLUB_MAPS) {
  test(`${entry.id}: every club holds its own state only, and every state without one stays empty`, () => {
    const text = read(`public/domestic/${entry.id}.json`);
    const doc = JSON.parse(text);
    const map = decodeDomestic(JSON.parse(text), entry.id);
    const empties = new Map(doc.topology.objects.empty.geometries.map(g => [g.id, polysOf(feature(doc.topology, g).geometry)]));
    const sectionAt = point => map.geo.countries.find(section => pointInPolys(point, section.polys))?.id ?? null;
    const canada = doc.hosts.includes('124'), america = doc.hosts.includes('840');
    const overseas = HELD_OVERSEAS[entry.league] || {};
    const towns = [...Object.entries(TOWNS), ...Object.entries(overseas)].filter(([region]) => doc.hosts.includes(HOST_OF[region.slice(0, 2)]));
    const untowned = doc.hosts.flatMap(host => UNTOWNED[host] || []);

    const regionsOf = new Map();
    for (const [region, points] of towns) {
      for (const point of points) {
        const section = sectionAt(point);
        if (empties.has(region)) {
          assert.equal(section, null, `${region}: ${point} is nobody's, yet lies in ${map.sectionNames[section]}`);
          assert.ok(pointInPolys(point, empties.get(region)), `${region}: ${point} lies on its own empty land`);
        } else {
          assert.ok(section, `${region} has a club, yet ${point} is nobody's`);
          regionsOf.set(section, (regionsOf.get(section) || new Set()).add(region));
        }
      }
    }
    for (const club of map.clubs) {
      const held = [...(regionsOf.get(club.homeSection) || [])].sort();
      // A club holds one state, or the states its league joins.
      const allowed = JOINED[entry.league]?.[club.id];
      if (allowed && held.every(region => allowed.includes(region))) continue;
      assert.ok(held.length <= 1, `${club.name} holds ${held}`);
      // One of those clubs away from the joined states that season (the Giants at the Yale Bowl in 1973–74) holds the
      // state its stadium stands in, alone.
      if (allowed) assert.equal(sectionAt(club.homePoint), club.homeSection, `${club.name} holds ${held}, where it plays`);
    }
    // Empty land covers whatever no club holds: the states and provinces without a town in a section.
    const played = new Set([...regionsOf.values()].flatMap(regions => [...regions]));
    const known = new Set(towns.map(([region]) => region));
    assert.deepEqual([...empties.keys()].filter(region => !known.has(region)).sort(), untowned.slice().sort(),
      'every empty region is a state or province');
    assert.equal(played.size + empties.size, known.size + untowned.length, 'a state has a club or is empty, and never both');
    if (!america) return;
    for (const [where, points] of Object.entries(OFF_THE_MAP).filter(([region]) => !overseas[region])) {
      for (const point of points) assert.equal(sectionAt(point), null, `${where} is off the map`);
      assert.ok(!empties.has(where), `${where} is not drawn`);
    }
    for (const point of ALASKA) assert.equal(sectionAt(point), null, 'Alaska is nobody\'s');
    assert.equal(empties.has('US-AK'), canada, 'Alaska is drawn when Canada joins it to the land');
    // An island a strait from the mainland is drawn like the rest of its country.
    if (canada && empties.has('CA-PE')) assert.ok(pointInPolys(TOWNS['CA-PE'][0], empties.get('CA-PE')), 'Prince Edward Island stays on the map');
  });
}

// ---------- college football: the FBS seasons 2009–2025 (scripts/data/cfb-seasons.json) ----------

const CFB_TEAMS = JSON.parse(read('scripts/data/cfb-teams.json')).teams;
const CFB = JSON.parse(read('scripts/data/cfb-seasons.json'));
const FBS_YEARS = Array.from({ length: 17 }, (_, i) => 2009 + i);
// Today's schools as today's map ranks them (strongest first), then the schools the built-in season lacks.
const CFB_ORDER = [...JSON.parse(read('public/domestic/cfb.json')).clubs.map(club => club.id), ...Object.keys(CFB.schools)];
// The contiguous states, and Hawaii.
const inUSA = ([lon, lat]) => (lon > -125 && lon < -66.9 && lat > 24.5 && lat < 49.4) || (lon > -160.3 && lon < -154.8 && lat > 18.9 && lat < 22.3);

test('the FBS seasons 2009–2025: each on one era map of its schools, each venue era a stadium of seasons its school played', () => {
  const { maps, venues, schools, espn } = CFB;
  assert.deepEqual(maps.flatMap(map => map.seasons), FBS_YEARS, 'the maps serve 2009 to 2025, each season once, in order');
  const placesOf = (map, year = map.seasons[0]) => JSON.stringify(cfbTeamsOf(CFB_TEAMS, CFB, year, CFB_ORDER));
  maps.forEach((map, i) => {
    assert.equal(map.id, `cfb${map.seasons[0]}`);
    assert.deepEqual(map.schools, [...new Set(map.schools)].sort(), `${map.id}: its schools once each, in order`);
    for (const id of map.schools) {
      assert.ok(CFB_TEAMS[id] || schools[id], `${map.id}: ${id} is a school of scripts/data/cfb-teams.json or the manifest's`);
      assert.ok(Number.isInteger(espn[id]), `${map.id}: ESPN names ${id}`);
    }
    for (const year of map.seasons.slice(1)) assert.equal(placesOf(map, year), placesOf(map), `${map.id}: ${year} plays where ${map.seasons[0]} does`);
    if (i) assert.notEqual(placesOf(map), placesOf(maps[i - 1]), `${map.id}: a season with its predecessor's schools and stadiums shares its map`);
  });
  for (const [id, school] of Object.entries(schools)) {
    assert.ok(!CFB_TEAMS[id], `${id} is a school of the built-in season`);
    assert.ok(school.name && /^[A-Z]{3}$/.test(school.code) && school.city && school.stadium && inUSA(school.home), `${id}: named, coded and placed`);
    assert.ok(!Object.values(CFB_TEAMS).some(team => team.code === school.code || team.city === school.city), `${id}: its code and town its own`);
  }
  for (const [id, eras] of Object.entries(venues)) {
    const today = CFB_TEAMS[id] ?? schools[id];
    assert.ok(today, `${id} is a school of the game's or the manifest's`);
    eras.forEach((era, k) => {
      assert.ok(Number.isInteger(era.from) && era.from <= era.to, `${id}: ${era.stadium} from ${era.from} to ${era.to}`);
      if (k) assert.ok(eras[k - 1].to < era.from, `${id}: its eras in order, never overlapping`);
      for (let year = era.from; year <= era.to; year++) {
        assert.ok(cfbMapOf(CFB, year)?.schools.includes(id), `${id}: ${era.stadium} in ${year}, an FBS season it played`);
      }
      assert.ok(era.stadium !== today.stadium || String(era.home) !== String(today.home), `${id}: ${era.stadium} is where it plays today`);
      assert.ok(inUSA(era.home), `${id}: ${era.stadium} at [lon, lat]`);
      assert.ok(typeof era.article === 'string' && Number.isInteger(era.revision) && era.revision > 0, `${id}: ${era.stadium} placed from a pinned article`);
      for (const revision of Object.values(era.evidence ?? {})) assert.ok(Number.isInteger(revision) && revision > 0, `${id}: its season articles pinned`);
    });
  }
});

// The season snapshots the seasons are built from (scripts/sync-cfb-seasons.mjs) name each season's schools.
const snapshotFile = year => `scripts/data/cfb-seasons/${year}.json`;
const noSnapshots = !existsSync(new URL(`../${snapshotFile(2009)}`, import.meta.url)) && 'no season snapshots';
test('each FBS era map\'s schools are those of its seasons\' snapshots', { skip: noSnapshots }, () => {
  for (const year of FBS_YEARS) {
    assert.deepEqual(cfbMapOf(CFB, year).schools, Object.keys(JSON.parse(read(snapshotFile(year))).schools).sort(), `the ${year} season`);
  }
});

for (const entry of CLUB_MAPS.filter(item => item.sport === 'college-football' && item.seasons)) {
  test(`${entry.id}: each school of ${entry.seasons.join(', ')} holds one territory around the stadium it played most of its home games in`, () => {
    const map = CFB.maps.find(item => item.id === entry.id);
    assert.ok(map, `${entry.id} is a map of scripts/data/cfb-seasons.json`);
    const teams = cfbTeamsOf(CFB_TEAMS, CFB, map.seasons[0], CFB_ORDER);
    const text = read(`public/domestic/${entry.id}.json`);
    const doc = JSON.parse(text);
    const { clubs, geo, sectionNames } = decodeDomestic(JSON.parse(text), entry.id);
    assert.deepEqual(entry.seasons, map.seasons.map(cfbSeasonIdOf));
    assert.deepEqual(doc.seasons, entry.seasons);
    assert.deepEqual([entry.league, entry.name, entry.clubs, entry.sections, entry.venue, entry.lines, entry.version, entry.top],
      ['FBS', 'USA', teams.length, teams.length, 'stadium', 'state', doc.version, undefined]);
    assert.ok(Buffer.byteLength(text) <= 250000);
    assert.ok(read(`public/domestic/ATTRIBUTION-${entry.id}.txt`).includes(doc.version));
    assert.deepEqual(doc.clubs.map(club => [club.id, club.name, club.arena, club.home]), teams.map(t => [t.id, t.name, t.stadium, t.home]),
      'its seasons\' schools in today\'s order, each at its stadium of the day');
    for (const club of clubs) {
      assert.equal(sectionNames[club.homeSection], teams.find(t => t.id === club.id).city);
      const land = geo.countries.find(section => section.id === club.homeSection).polys;
      assert.ok(kmToPolys(club.homePoint, land) <= 2, `${club.name} plays inside its own territory`);
    }
    assert.equal(new Set(Object.values(sectionNames)).size, teams.length, 'every territory its own name');
  });
}

test('an FBS season\'s map holds a school where it played: Kansas City in 2024, Carson, Foxborough, Houston; Idaho Boise State\'s', () => {
  const ownerAt = (mapId, point) => {
    const { clubs, geo } = decodeDomestic(JSON.parse(read(`public/domestic/${mapId}.json`)), mapId);
    const section = geo.countries.find(item => pointInPolys(point, item.polys))?.id;
    return clubs.find(club => club.homeSection === section)?.id ?? null;
  };
  const lawrence = [-95.25, 38.96], moscow = [-117, 46.73];
  assert.equal(ownerAt('cfb2024', [-94.48, 39.05]), 'cfb-kansas', 'Kansas at Arrowhead Stadium, Kansas City, Missouri');
  assert.equal(ownerAt('cfb2024', lawrence), 'cfb-kansas-state', 'Lawrence Kansas State\'s while Kansas plays away from it');
  assert.equal(ownerAt('cfb2025', lawrence), 'cfb-kansas', 'and Kansas\'s again');
  assert.equal(ownerAt('cfb2020', [-118.26, 33.86]), 'cfb-san-diego-state', 'San Diego State at Carson');
  assert.equal(ownerAt('cfb2015', [-71.26, 42.09]), 'cfb-umass', 'UMass at Gillette Stadium, Foxborough');
  assert.equal(ownerAt('cfb2017', [-72.54, 42.38]), 'cfb-umass', 'UMass at home in Amherst from 2017');
  assert.equal(ownerAt('cfb2025', [-95.35, 29.75]), 'cfb-sam-houston', 'Sam Houston at Shell Energy Stadium, Houston');
  assert.equal(ownerAt('cfb2011', [-122.44, 37.76]), 'cfb-cal', 'Cal at AT&T Park, San Francisco');
  assert.equal(ownerAt('cfb2013', [-84.4, 33.76]), 'cfb-georgia-state', 'Georgia State at the Georgia Dome');
  // Idaho, FBS to 2017, fields no season (its rosters are too thin): Boise State holds the whole state.
  for (const entry of CLUB_MAPS.filter(item => item.sport === 'college-football')) {
    assert.equal(ownerAt(entry.id, moscow), 'cfb-boise-state', `${entry.id}: Moscow, Idaho is Boise State's`);
  }
});
