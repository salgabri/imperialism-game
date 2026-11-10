// Claimed land (docs/design/claimed-land.md, src/engine/claims.js): empty land takes a team's colour when the team's
// line of attack crosses it (the match's winner keeps it) or when the team landlocks it, and never becomes territory.
// The rules on small made-up maps; the NBA, Elite 32 and world maps as shipped; saves; and a match on the NBA map in
// the running App.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createLand, crossedLand, encloseClaims, landlocked, MAX_OPEN_EDGE, MIN_CROSSING, sameClaims, settleClaims,
  touchingLand } from '../src/engine/claims.js';
import { decodeDomestic, domesticLand, domesticSurroundings } from '../src/engine/domestic.js';
import { WorldGeometry, mergeSharedIds } from '../src/engine/geo.js';
import { CAPITALS } from '../src/data/capitals.js';
import { EXCLUDED_SHAPES, buildTeam, makeRng } from '../src/data/teams.js';
import { getSport } from '../src/sports/index.js';
import { createTargetedDraw } from '../src/engine/duelDraw.js';
import { campaignSnapshot, createCampaignId, parseCampaign } from '../src/engine/storage.js';
import { tooltipModel } from '../src/viewModels/map.js';
import { bundleComponents, forceResult, syncAppFixture } from './lib/app-harness.mjs';

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const ATLAS_TEXT = read('public/countries-50m.json');
const ATLAS = mergeSharedIds(JSON.parse(ATLAS_TEXT));

// ---------- the rules on a made-up map ----------

// Territories A1, A2 (team A) and B1 (team B); empty land X, Y (inland) and Z (a peninsula off A1).
//   X: A1 4, A2 4, Y 2, coast 1     Y: X 2, B1 3, coast 1     Z: A1 1, coast 9
const BORDERS = {
  X: new Map([['A1', 4], ['A2', 4], ['Y', 2]]),
  Y: new Map([['X', 2], ['B1', 3]]),
  Z: new Map([['A1', 1]]),
};
const COAST = { X: 1, Y: 1, Z: 9 };
const square = (x, y, size = 10) => [[[x, y], [x + size, y], [x + size, y + size], [x, y + size]]];
const PATHS = { X: { labelRings: square(0, 0), d: 'M0,0h10v10h-10Z' }, Y: { labelRings: square(10, 0), d: 'M10,0h10v10h-10Z' },
  Z: { labelRings: square(0, 20), d: 'M0,20h10v10h-10Z' } };
const land = createLand({ ids: ['Z', 'X', 'Y', 'X'], neighbours: id => BORDERS[id], edge: id => COAST[id], paths: PATHS,
  names: id => ({ X: 'Xland', Y: 'Yland' })[id] ?? null });
const OWN = { A1: 'A', A2: 'A', B1: 'B' };

test('the land knows its shapes, their borders and their coasts', () => {
  assert.deepEqual(land.ids, ['X', 'Y', 'Z'], 'sorted, once each');
  assert.deepEqual(land.adj.get('X'), ['A1', 'A2', 'Y']);
  assert.equal(land.measured, true);
  assert.deepEqual([...land.d.keys()], ['X', 'Y', 'Z']);
  assert.deepEqual([...land.names], [['X', 'Xland'], ['Y', 'Yland']], 'land with no name has none');
  assert.ok(land.index, 'drawn land can be crossed');
  assert.equal(MAX_OPEN_EDGE, 0.5);
});

test('enclosure: land a team alone landlocks is its own; a patch two teams border stays empty', () => {
  assert.deepEqual(encloseClaims(land, OWN), {}, 'X and Y touch both teams; Z is mostly coast');
  // B1 falls to A: the patch X + Y now borders A alone, and most of its edge is land.
  assert.deepEqual(encloseClaims(land, { ...OWN, B1: 'A' }), { X: 'A', Y: 'A' });
  assert.equal(landlocked(land, OWN, ['X', 'Y']), true, 'open 2 of 13');
  assert.equal(landlocked(land, OWN, ['Z']), false, 'open 9 of 10: an island hanging off A1 is not landlocked');
  // Without lengths there is no coast to weigh: Z is A's.
  const unmeasured = createLand({ ids: ['X', 'Y', 'Z'], neighbours: id => [...BORDERS[id].keys()] });
  assert.equal(unmeasured.measured, false);
  assert.deepEqual(encloseClaims(unmeasured, OWN), { Z: 'A' });
  // Land outside the theatre (neither territory nor claimable) borders nobody and counts as open edge.
  const outside = createLand({ ids: ['Q'], neighbours: () => new Map([['A1', 3], ['far', 4]]), edge: () => 0 });
  assert.deepEqual(encloseClaims(outside, OWN), {}, 'open 4 of 7');
  assert.deepEqual(encloseClaims(outside, { ...OWN, far: 'A' }), { Q: 'A' }, 'once it is territory it closes the ring');
});

test('claims keep only claimable land held by a team that is still on the map', () => {
  assert.deepEqual(encloseClaims(land, OWN, { Y: 'B', W: 'B', X: 'gone' }), { Y: 'B' });
  assert.deepEqual(encloseClaims(null, OWN, { Y: 'B' }), {});
  assert.ok(sameClaims({ X: 'A', Y: 'B' }, { Y: 'B', X: 'A' }));
  assert.ok(!sameClaims({ X: 'A' }, { X: 'B' }));
  assert.ok(sameClaims(null, {}));
});

test('a claimed patch passes to the team that alone landlocks it, never while its holder or empty land still borders it', () => {
  // C holds land far away; X is C's (it crossed it). A borders X, but so does the empty Y.
  const own = { ...OWN, C1: 'C' };
  assert.deepEqual(encloseClaims(land, own, { X: 'C' }), { X: 'C' });
  // Y is A's too: X now borders A alone.
  assert.deepEqual(encloseClaims(land, own, { X: 'C', Y: 'A' }), { X: 'A', Y: 'A' });
  // B's own claim next to B's land stays B's.
  assert.deepEqual(encloseClaims(land, own, { Y: 'B' }), { Y: 'B' });
});

test('settling a match: the loser\'s claims and the land its line crossed go to the winner, then enclosure', () => {
  // B wins a match whose line crossed Y: Y is B's, and X (touching A and B's Y) stays empty.
  const first = settleClaims(land, { own: OWN, claims: {}, winnerId: 'B', loserId: 'C', crossedIds: ['Y', 'nowhere'] });
  assert.deepEqual(first, { Y: 'B' });
  // A then beats B: B1 and Y pass to A, and X, landlocked by A, follows.
  assert.deepEqual(settleClaims(land, { own: { ...OWN, B1: 'A' }, claims: first, winnerId: 'A', loserId: 'B' }), { X: 'A', Y: 'A' });
  // Land a third team already claimed stays its own when another match crosses it.
  assert.deepEqual(settleClaims(land, { own: { ...OWN, C1: 'C' }, claims: { Y: 'C' }, winnerId: 'B', loserId: 'Q', crossedIds: ['Y'] }), { Y: 'C' });
  // An old match has no list: B's Y is A's, and so is X, landlocked by A's land and A's claim.
  assert.deepEqual(settleClaims(land, { own: { ...OWN, B1: 'A' }, claims: { Y: 'B' }, winnerId: 'A', loserId: 'B', crossedIds: undefined }),
    { X: 'A', Y: 'A' });
  // A fill never judges a patch on colours an earlier fill changed: Y, A's, touches B's land.
  assert.deepEqual(settleClaims(land, { own: OWN, claims: { Y: 'A' }, winnerId: 'A', loserId: 'Q' }), { X: 'A', Y: 'A' });
});

test('a line of attack claims the empty land it travels over, in order, and not a corner it only grazes', () => {
  assert.deepEqual(crossedLand(land, [[-5, 5], [25, 5]]), ['X', 'Y']);
  assert.deepEqual(crossedLand(land, [[25, 5], [15, 5], [15, 25], [5, 25]]), ['Y', 'Z'], 'every leg of a bent route');
  // Through X's corner at (0, 10): about 0.14 map units inside.
  assert.deepEqual(crossedLand(land, [[-0.2, 9.7], [0.4, 10.3]]), []);
  assert.ok(MIN_CROSSING > 0.14);
  assert.deepEqual(crossedLand(land, [[-5, 5]]), []);
  assert.deepEqual(crossedLand(createLand({ ids: ['X'] }), [[-5, 5], [25, 5]]), [], 'no outlines, nothing to cross');
});

test('land from two sources is joined by looking just beyond each edge, and an edge with nothing beyond it is coast', () => {
  const found = touchingLand([{ id: 'S', rings: square(0, 0) }], [{ id: 'T', rings: square(10.3, 0) }, { id: 'S', rings: square(0, 0) }]);
  const { borders, edge } = found.get('S');
  assert.deepEqual([...borders.keys()], ['T'], 'a 0.3 gap is no sea');
  assert.ok(Math.abs(borders.get('T') - 10) < 1e-9);
  assert.ok(Math.abs(edge - 30) < 1e-9);
});

// ---------- the maps as shipped ----------

const NBA_TEXT = read('public/domestic/nba.json');
const NBA = decodeDomestic(JSON.parse(NBA_TEXT), 'nba');
const nbaLand = domesticLand(NBA, domesticSurroundings(ATLAS, NBA));
const nbaClub = name => NBA.clubs.find(club => club.name === name);

test('the NBA map: every empty state and province can be claimed, and its borders come from the map itself', () => {
  assert.equal(nbaLand.ids.length, 40);
  assert.equal(nbaLand.measured, true);
  assert.equal(domesticLand(NBA, domesticSurroundings(ATLAS, NBA)), nbaLand, 'built once per map and fit');
  const nevada = nbaLand.adj.get('US-NV');
  assert.ok(nevada.includes('US-ID'));
  for (const name of ['Los Angeles Lakers', 'Portland Trail Blazers', 'Utah Jazz', 'Phoenix Suns']) {
    assert.ok(nevada.includes(nbaClub(name).homeSection), name);
  }
  assert.equal(nbaLand.names.get('US-NV'), 'Nevada');
  assert.ok(nbaLand.d.get('US-NV')?.startsWith('M'));
  assert.equal(landlocked(nbaLand, NBA.startOwners, ['US-NV']), true);
  assert.equal(landlocked(nbaLand, NBA.startOwners, ['CA-NS']), false, 'Nova Scotia is all coast');
  assert.deepEqual(encloseClaims(nbaLand, { ...NBA.startOwners }), {}, 'no state is landlocked by one club at kick-off');
  // The Lakers hold every territory around Nevada and have claimed Idaho: Nevada is theirs.
  const lakers = nbaClub('Los Angeles Lakers').id;
  const own = { ...NBA.startOwners };
  for (const id of nevada) if (own[id]) own[id] = lakers;
  assert.deepEqual(encloseClaims(nbaLand, own, { 'US-ID': lakers }), { 'US-ID': lakers, 'US-NV': lakers });
});

test('Elite 32: Europe\'s countries without a club can be claimed; an island or peninsula off one club stays empty', () => {
  const eu = decodeDomestic(JSON.parse(read('public/domestic/eu32.json')), 'eu32');
  const euLand = domesticLand(eu, domesticSurroundings(ATLAS, eu));
  for (const id of ['756', '040', '208', '372', '643']) assert.ok(euLand.claimable.has(id), id);
  for (const host of eu.meta.hosts) assert.ok(!euLand.claimable.has(host), `${host} has clubs`);
  const swiss = euLand.adj.get('756');
  const country = id => eu.clubs.find(club => club.homeSection === id)?.name;
  assert.ok(swiss.some(id => country(id)), 'Switzerland touches club land');
  assert.equal(euLand.names.get('756'), 'Switzerland');
  assert.equal(landlocked(euLand, eu.startOwners, ['756']), true);
  assert.equal(landlocked(euLand, eu.startOwners, ['208']), false, 'Denmark is nearly all coast');
  assert.equal(landlocked(euLand, eu.startOwners, ['372']), false, 'so is Ireland');
  assert.deepEqual(encloseClaims(euLand, { ...eu.startOwners }), {});
});

test('Top 124: the surroundings keep every land border of the atlas, which joins land the probes cannot', () => {
  const eu = decodeDomestic(JSON.parse(read('public/domestic/eu124.json')), 'eu124');
  const around = domesticSurroundings(ATLAS, eu);
  // Built without border lengths, which nothing here reads, the atlas in the map's projection keeps its adjacency.
  const full = new WorldGeometry(ATLAS, {}, { projection: eu.meta.projection });
  const adjacency = adj => JSON.stringify(Object.entries(adj).map(([id, set]) => [id, [...set]]));
  assert.equal(adjacency(around.atlasNeighbours), adjacency(full.adj));
  // Germany holds clubs, so its own shape is no obstacle the probes could meet: Austria–Germany is the atlas's alone.
  const euLand = domesticLand(eu, around);
  assert.ok(euLand.claimable.has('040') && euLand.adj.get('040').includes('276'), 'Austria borders Germany');
  assert.ok(!domesticLand(eu, { ...around, atlasNeighbours: {} }).adj.get('040').includes('276'), 'a link only the atlas gives');
});

test('the world map: a nation landlocked by one team is claimed at once, an island hanging off one is not', () => {
  const geo = new WorldGeometry(JSON.parse(read('public/world-110m.v1.json')), CAPITALS);
  // South Africa, Great Britain (with Northern Ireland) and Thailand play; nobody else does.
  const own = { 710: '710', 826: '826', NIR: '826', SCO: '826', WAL: '826', 764: '764' };
  const ids = geo.countries.map(country => country.id).filter(id => !own[id] && !EXCLUDED_SHAPES.has(id));
  const world = createLand({ ids, neighbours: id => geo.borders[id] || new Map(), edge: id => geo.edges[id] || 0 });
  assert.equal(world.measured, true);
  assert.ok(geo.borders['426'].get('710') > 0 && !(geo.edges['426'] > 0), 'Lesotho: all border, no coast');
  const claims = encloseClaims(world, own);
  assert.equal(claims['426'], '710', 'Lesotho');
  for (const id of ['372', '458', '360']) assert.equal(claims[id], undefined, `${id}: mostly coast`);
});

// ---------- saves ----------

function checkpoint(extra = {}) {
  const rng = makeRng(42), sport = getSport('football');
  const teams = Object.fromEntries(['250', '276', '380'].map(id => [id, buildTeam(id, rng, sport)]));
  return { phase: 'playing', settings: { sport: 'football', layer: 'nations', pacing: 'duel', resolution: 'ticker', role: 'spectator' },
    teams, own: { 250: '250', 276: '276', 380: '380' }, aliveIds: ['250', '276', '380'], fallen: [], stats: {},
    round: 1, matches: 0, queue: [], history: [], log: [], seed: 42, rngState: rng.getState(), followedId: null,
    campaignId: createCampaignId(), revision: 0, campaignName: 'Claims', metrics: { acquisitions: [], leaderChanges: 0 },
    match: null, spin: null, choice: null, series: null, tacticalChoice: null, ...extra };
}

test('a save keeps its claims, an older save has none, and a claim by an unknown or fallen team is refused', () => {
  assert.deepEqual(parseCampaign(JSON.stringify(campaignSnapshot(checkpoint({ claims: { '756': '250', '040': '276' } })))).claims,
    { '756': '250', '040': '276' });
  assert.equal(parseCampaign(JSON.stringify(campaignSnapshot(checkpoint()))).claims, undefined, 'none saved, none read');
  const refused = claims => () => parseCampaign(JSON.stringify(campaignSnapshot(checkpoint({ claims }))));
  assert.throws(refused({ 756: 'nobody' }), /claimed land is invalid/);
  assert.throws(refused([]), /claimed land is invalid/);
  const fallen = checkpoint({ claims: { 756: '380' } });
  fallen.aliveIds = ['250', '276'];
  fallen.own = { 250: '250', 276: '276', 380: '276' };
  assert.throws(() => parseCampaign(JSON.stringify(campaignSnapshot(fallen))), /claimed land is invalid/);
});

test('the tooltip names claimed land and its holder, and says it is no territory', () => {
  const st = { phase: 'playing', own: { A1: 'A' }, claims: { X: 'A' }, teams: { A: { id: 'A', name: 'Alpha' } }, history: [] };
  assert.deepEqual(tooltipModel(st, { claimNames: land.names }, 'X'),
    { visible: true, name: 'Xland', held: 'Claimed by Alpha', result: 'Not a territory', link: null });
  assert.equal(tooltipModel(st, {}, 'X').visible, false, 'land the map does not name has no card');
  assert.equal(tooltipModel({ ...st, phase: 'setup' }, { claimNames: land.names }, 'X').held, 'Awaiting campaign', 'no claims outside a campaign');
});

// ---------- the running App ----------

const B = await bundleComponents({ App: 'src/App.jsx', clearDomesticCache: ['src/engine/domestic.js', 'clearDomesticCache'] }, { jsx: 'automatic' });
const settle = () => new Promise(resolve => setImmediate(resolve));

/** An NBA campaign launched in the App (the map and the atlas loaded as the page would): `fn({ app, time, items })`. */
async function onTheNbaMap(fn, settings = {}) {
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
  Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true,
    value: async url => (url === '/domestic/nba.json' ? { ok: true, status: 200, json: async () => JSON.parse(NBA_TEXT) }
      : { ok: false, status: 404, json: async () => { throw new Error('Not found'); } }) });
  B.clearDomesticCache();
  const f = syncAppFixture({ App: B.App, phase: 'setup', ids: ['840', '124', '484'],
    settings: { sport: 'basketball', layer: 'clubs', clubScope: 'domestic:nba', role: 'spectator', seed: '11', ...settings } });
  f.app.opening = B.App.prototype.opening;
  try {
    f.app.atlasText = ATLAS_TEXT;
    await f.app.loadCountry('nba');
    await settle();
    f.app.startCampaign();
    await fn(f);
  } finally {
    f.close();
    if (prior) Object.defineProperty(globalThis, 'fetch', prior); else delete globalThis.fetch;
  }
}

test('on the NBA map a challenge across Maryland colours it for the winner, without a territory changing hands', async () => {
  await onTheNbaMap(async ({ app, time, items }) => {
    assert.equal(app.state.phase, 'playing');
    assert.deepEqual(app.state.claims, {}, 'nothing is landlocked at kick-off');
    const sections = Object.keys(app.state.own).sort();

    const phi = nbaClub('Philadelphia 76ers').id, wsh = nbaClub('Washington Wizards').id;
    const draw = createTargetedDraw(app.board(), phi, wsh);
    assert.ok(draw, 'Philadelphia reaches Washington');
    app.startMatch(phi, wsh, draw);
    assert.ok(app.state.match.crossed.includes('US-MD'), `the line crosses Maryland: ${app.state.match.crossed}`);
    forceResult(app, phi, { aId: phi, dId: wsh });
    app.finishMatch();
    time.advance(10000);
    assert.equal(app.state.claims['US-MD'], phi, 'the winner colours the land it crossed');
    assert.deepEqual(Object.keys(app.state.own).sort(), sections, 'claimed land is never territory');
    assert.ok(!('US-MD' in app.state.own));

    const rows = app.mapClaims(true);
    const maryland = rows.find(row => row.id === 'US-MD');
    assert.equal(maryland.ownerId, phi);
    assert.match(maryland.d, /^M/);
    assert.ok(maryland.fill && maryland.fill !== 'transparent');
    assert.equal(app.mapClaims(true), rows, 'the same rows until something they show changes');
    app.setState({ hoverCid: 'US-MD' });
    assert.deepEqual([app.tooltip().name, app.tooltip().held, app.tooltip().result], ['Maryland', 'Claimed by Philadelphia 76ers', 'Not a territory']);

    const saved = [...items.values()].map(text => { try { return JSON.parse(text); } catch { return null; } })
      .find(data => data?.claims?.['US-MD']);
    assert.equal(saved?.claims['US-MD'], phi, 'the checkpoint keeps the claim');
  });
});

test('a world map paints a claimed nation exactly as its holder\'s land, yet it stays nobody\'s', () => {
  const f = syncAppFixture({ App: B.App, ids: ['250', '276', '826'], settings: { scope: 'world' } });
  try {
    const { app } = f;
    // England (826) fields no team here, and France has claimed it.
    app.setState({ own: { 250: '250', 276: '276' }, aliveIds: ['250', '276'], claims: { 826: '250' } });
    const painted = app.mapOwnership();
    assert.equal(painted['826'], '250', 'borders, outlines and labels see it as France\'s');
    assert.equal(app.state.own['826'], undefined, 'never territory');
    assert.equal(app.mapOwnership(), painted, 'one object until the holdings or the claims change');
    const row = id => app.mapCountries().countries.find(country => country.id === id);
    assert.equal(row('826').fill, row('250').fill, 'no colour difference');
    assert.deepEqual([row('826').ownerId ?? null, row('826').claimOwnerId, row('826').cursor], [null, '250', 'default'], 'no click or target');
    assert.equal(row('276').claimOwnerId, undefined);
    assert.deepEqual(app.mapClaims(true), [], 'a country shape, not a layer over the backdrop');
    app.setState({ hoverCid: '826' });
    assert.equal(app.tooltip().held, 'Claimed by France');
    app.setState({ claims: {} });
    assert.equal(app.mapOwnership(), app.state.own, 'without claims the map paints the territory itself');
  } finally { f.close(); }
});

test('while the manager signs a player the map already shows the land the win claims, and the signing settles it', async () => {
  const wsh = nbaClub('Washington Wizards').id, phi = nbaClub('Philadelphia 76ers').id;
  await onTheNbaMap(async ({ app, time }) => {
    assert.equal(app.state.managedTeamId, wsh);
    app.startMatch(wsh, phi, createTargetedDraw(app.board(), wsh, phi), 'balanced');
    assert.ok(app.state.match.crossed.includes('US-MD'));
    forceResult(app, wsh, { aId: wsh, dId: phi });
    app.finishMatch();
    assert.ok(app.state.choice, 'the signing screen is open');
    assert.deepEqual(app.state.claims, {}, 'nothing is settled yet');
    const shown = app.mapClaims(true).find(row => row.id === 'US-MD');
    assert.equal(shown?.ownerId, wsh, 'the projected map shows Maryland as the winner\'s');
    app.chooseAcquisition(app.state.choice.selected);
    time.advance(10000);
    assert.equal(app.state.choice, null);
    assert.equal(app.state.claims['US-MD'], wsh);
  }, { role: 'manager', managedTeamId: 'b-washington-wizards' });
});
