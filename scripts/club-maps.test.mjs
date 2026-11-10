// The leagues' maps, today's and every era's (docs/design/domestic-campaigns.md, "The NBA map", "The NFL map", "The MLB
// map", "The NHL map" and "The NRL map"): a club holds its own state or province (in New Zealand, region) and nothing
// else, a state with several clubs is divided between them, and every state and province without a club stays empty.
// The boundary layers are not in the repository, so towns stand in for them: every town lies on empty land of its own
// state or on a club's section, and no club's section reaches into a second state.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { feature } from 'topojson-client';
import { CLUB_MAPS } from '../src/data/clubMaps.js';
import { decodeDomestic } from '../src/engine/domestic.js';
import { pointInPolys, polysOf } from './lib/domestic-partition.mjs';

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
    const towns = Object.entries(TOWNS).filter(([region]) => doc.hosts.includes(HOST_OF[region.slice(0, 2)]));
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
      const allowed = JOINED[entry.league]?.[club.id];
      if (allowed) assert.ok(held.every(region => allowed.includes(region)), `${club.name} holds ${held}`);
      else assert.ok(held.length <= 1, `${club.name} holds ${held}`);
    }
    // Empty land covers whatever no club holds: the states and provinces without a town in a section.
    const played = new Set([...regionsOf.values()].flatMap(regions => [...regions]));
    const known = new Set(towns.map(([region]) => region));
    assert.deepEqual([...empties.keys()].filter(region => !known.has(region)).sort(), untowned.slice().sort(),
      'every empty region is a state or province');
    assert.equal(played.size + empties.size, known.size + untowned.length, 'a state has a club or is empty, and never both');
    if (!america) return;
    for (const [where, points] of Object.entries(OFF_THE_MAP)) {
      for (const point of points) assert.equal(sectionAt(point), null, `${where} is off the map`);
      assert.ok(!empties.has(where), `${where} is not drawn`);
    }
    for (const point of ALASKA) assert.equal(sectionAt(point), null, 'Alaska is nobody\'s');
    assert.equal(empties.has('US-AK'), canada, 'Alaska is drawn when Canada joins it to the land');
    // An island a strait from the mainland is drawn like the rest of its country.
    if (canada && empties.has('CA-PE')) assert.ok(pointInPolys(TOWNS['CA-PE'][0], empties.get('CA-PE')), 'Prince Edward Island stays on the map');
  });
}
