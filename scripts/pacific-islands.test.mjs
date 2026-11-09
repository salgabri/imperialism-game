// Tonga, Samoa and the Cook Islands (docs/design/pacific-islands.md): the 110m rules map gains them from the 50m map,
// they are nations, and each sport fields them where it can.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CAPITALS } from '../src/data/capitals.js';
import { FLAG_CODES } from '../src/data/flags.js';
import { NATION_COLOURS } from '../src/data/nationColours.js';
import { NATIONS, PACIFIC_ISLANDS, SCOPES, buildTeam, makeRng } from '../src/data/teams.js';
import { fieldedNations } from '../src/engine/footballSets.js';
import { WorldGeometry, drawnPaths, mergeSharedIds } from '../src/engine/geo.js';
import { SPORT_LIST, getSport } from '../src/sports/index.js';
import { runProductionCampaign } from './production-balance.mjs';

const load = name => JSON.parse(readFileSync(new URL(`../public/${name}`, import.meta.url), 'utf8'));
const RULES = load('world-110m.v1.json'), DISPLAY = load('countries-50m.json');
const ISLANDS = { 776: ['Tonga', 3], 882: ['Samoa', 2], 184: ['Cook Islands', 1] };

/** Each polygon's outer ring of shape `id` as lon/lat points. */
function rings(topo, id) {
  const { scale: [sx, sy], translate: [tx, ty] } = topo.transform;
  const arcs = topo.arcs.map(arc => { let x = 0, y = 0; return arc.map(([dx, dy]) => [(x += dx) * sx + tx, (y += dy) * sy + ty]); });
  const shape = topo.objects.countries.geometries.find(geometry => String(geometry.id) === id);
  const polygons = shape.type === 'Polygon' ? [shape.arcs] : shape.arcs;
  return polygons.map(polygon => polygon[0].flatMap((ref, k) => (ref < 0 ? arcs[~ref].slice().reverse() : arcs[ref]).slice(k ? 1 : 0)));
}

test('the rules map takes Tonga, Samoa and the Cook Islands from the 50m map, ring for ring, after every other shape', () => {
  const geometries = RULES.objects.countries.geometries;
  assert.deepEqual(geometries.slice(-3).map(geometry => geometry.id), ['776', '882', '184']);
  for (const id of PACIFIC_ISLANDS) assert.equal(geometries.filter(geometry => geometry.id === id).length, 1, `${NATIONS[id][0]} once`);
  const [sx, sy] = RULES.transform.scale;
  for (const [id, [name, count]] of Object.entries(ISLANDS)) {
    const rule = rings(RULES, id), display = rings(DISPLAY, id);
    assert.equal(rule.length, count, `${name}: polygons`);
    rule.forEach((ring, k) => {
      assert.equal(ring.length, display[k].length, `${name} ${k}: the 50m map's corners`);
      ring.forEach(([lon, lat], i) => {
        assert.ok(Math.abs(lon - display[k][i][0]) <= sx / 2 + 1e-9 && Math.abs(lat - display[k][i][1]) <= sy / 2 + 1e-9, `${name} ${k}:${i}`);
      });
    });
    // Each ring is an arc of its own: no border with anyone, and the land object has it.
    const own = (geometries.find(geometry => geometry.id === id).arcs.flat(Infinity));
    const others = new Set(geometries.filter(geometry => geometry.id !== id).flatMap(geometry => geometry.arcs.flat(Infinity)).map(ref => (ref < 0 ? ~ref : ref)));
    assert.ok(own.every(ref => ref >= 0 && !others.has(ref)), `${name}: arcs of its own`);
    const land = new Set(RULES.objects.land.geometries[0].arcs.flat(Infinity));
    assert.ok(own.every(ref => land.has(ref)), `${name}: on the land object`);
  }
  const world = new WorldGeometry(RULES, CAPITALS);
  for (const id of PACIFIC_ISLANDS) assert.ok(!world.adj[id]?.size, `${NATIONS[id][0]} borders nobody`);
});

test('they are OFC nations with a capital, a flag and a colour, drawn from the 50m map and routed to like any nation', () => {
  for (const [id, [name]] of Object.entries(ISLANDS)) {
    assert.deepEqual(NATIONS[id].slice(0, 4), [name, { 776: 'TGA', 882: 'SAM', 184: 'COK' }[id], 'OFC', 'pac']);
    assert.ok(CAPITALS[id] && FLAG_CODES[id] && NATION_COLOURS[id], name);
    assert.ok(SCOPES.find(scope => scope.id === 'AFC').filter({ conf: NATIONS[id][2] }), `${name} plays in Asia & Oceania`);
  }
  const world = new WorldGeometry(RULES, CAPITALS).fitTo(Object.keys(NATIONS));
  const { s, tx, ty } = world.fit;
  const routing = drawnPaths(new WorldGeometry(mergeSharedIds(DISPLAY), CAPITALS).buildPaths(s, tx, ty), world.countries);
  for (const id of PACIFIC_ISLANDS) assert.ok(world.paths[id] && routing[id], `${NATIONS[id][0]} is drawn`);
  // Nukuʻalofa and Avarua anchor on the city; Apia is just north of Upolu's generalised coast, so Samoa takes its
  // centroid, as Vanuatu does.
  assert.deepEqual(['776', '184'].map(id => world.capitals[id]), [CAPITALS['776'], CAPITALS['184']]);
  assert.equal(world.capitals['882'], undefined);
});

test('each sport fields them only with a real side: rugby league Tonga and Samoa, nobody else', () => {
  // A nation fields a team only when its own rated players hold half the lineup (fieldedNations): nobody rates the
  // islanders in football, basketball, baseball, hockey or tennis.
  const fields = Object.fromEntries(SPORT_LIST.filter(sport => !sport.clubsOnly)
    .map(sport => [sport.id, PACIFIC_ISLANDS.filter(id => fieldedNations(sport).includes(id))]));
  assert.deepEqual(fields, { football: [], 'womens-football': [], basketball: [], baseball: [], hockey: [], tennis: [],
    'womens-tennis': [], 'rugby-league': ['776', '882'] });
  // Rugby league's are the NRL players of their 2025 Test sides (docs/design/rugby-league.md). The Cook Islands' five
  // fall short of half a matchday 17.
  for (const [id, real] of [['776', 17], ['882', 17], ['184', 5]]) {
    const team = buildTeam(id, makeRng(7), getSport('rugby-league'));
    assert.ok(team.squad.filter(player => !player.gen).length >= real, `rugby league: ${team.name} fields ${real} NRL players or more`);
  }
});

test('a world war plays to a champion whether the islands play or stay neutral, as in a campaign saved before them', () => {
  // Rugby league fields Tonga and Samoa; football leaves their land neutral, which is how a campaign saved before them
  // resumes.
  const played = runProductionCampaign({ seed: 20261108, sport: 'rugby-league', scope: 'world', pacing: 'blitz', resolution: 'instant' });
  assert.equal(played.startingTeams, 6);
  assert.ok(played.completed);
  assert.ok(['776', '882'].every(id => played.outcomes.some(outcome => outcome.split(':').slice(0, 2).includes(id))), 'Tonga and Samoa play');
  const neutral = runProductionCampaign({ seed: 20261108, sport: 'football', scope: 'world', pacing: 'blitz', resolution: 'instant' });
  assert.equal(neutral.startingTeams, 173);
  assert.ok(neutral.completed);
  assert.ok(!neutral.outcomes.some(outcome => outcome.split(':').slice(0, 2).some(id => PACIFIC_ISLANDS.includes(id))), 'nobody plays them');
});
