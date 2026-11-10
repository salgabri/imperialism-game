// Nation theatres only where a sport is played (src/data/scopes.js `nationTheatres`): the world always, a continent once
// four of its nations field a real side, the Elite 32 once 32 do. Rugby league in Africa, all generated players, and
// women's tennis in Africa, no nation at all, are not offered. Basketball's EuroBasket is basketball's alone.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NATIONS, SCOPES, buildTeam, fieldsRealSide, hashStr, makeRng, teamEff } from '../src/data/teams.js';
import { ELITE_NATIONS, MIN_REAL_SIDES, nationTheatre, nationTheatres } from '../src/data/scopes.js';
import { decodeFootballSet, fieldedNations, seasonSport } from '../src/engine/footballSets.js';
import { SPORT_LIST, getSport } from '../src/sports/index.js';
import { buildSetupModel } from '../src/screens/setup/setupModel.js';
import { challengeQuery, readChallenge } from '../src/screens/setup/challenge.js';
import { bundleComponents, syncAppFixture } from './lib/app-harness.mjs';

const ids = sport => nationTheatres(sport).map(scope => scope.id);
const NATION_SPORTS = SPORT_LIST.filter(sport => !sport.clubsOnly);
const inScope = (scope, id) => scope.filter({ id, conf: NATIONS[id][2] });
// A competition of one sport (basketball's EuroBasket) is a theatre of that sport alone.
const playedIn = (scope, sport) => !scope.sports || scope.sports.includes(sport.id);

test('only a nation with a real side fields a team, so no team is made up or nearly empty', () => {
  const fielded = Object.fromEntries(NATION_SPORTS.map(sport => [sport.id, fieldedNations(sport).length]));
  assert.deepEqual(fielded, { football: 173, 'womens-football': 36, basketball: 47, baseball: 12, hockey: 7, tennis: 52,
    'womens-tennis': 45, 'rugby-league': 6 });
  for (const sport of NATION_SPORTS) assert.ok(fieldedNations(sport).every(id => fieldsRealSide(id, sport)), sport.id);
  assert.ok(!fieldedNations(getSport('rugby-league')).some(id => NATIONS[id][2] === 'CAF'), 'no rugby league team in Africa');
});

test('a real side is one whose own rated players hold at least half the lineup it fields', () => {
  const rugby = getSport('rugby-league'), hockey = getSport('hockey'), tennis = getSport('tennis');
  assert.equal(fieldsRealSide('036', rugby), true, 'Australia in rugby league');
  assert.equal(fieldsRealSide('566', rugby), false, 'Nigeria, no NRL players: all generated');
  assert.equal(hockey.rosters['036']?.[2]?.length, 1, 'one Australian in the NHL');
  assert.equal(fieldsRealSide('036', hockey), false, 'one player is no hockey side');
  // A tennis nation fields a team with two rated players, who also play the doubles: two of the four places.
  const pair = Object.keys(tennis.rosters).find(id => tennis.rosters[id][2].length === 2);
  assert.ok(pair, 'some Davis Cup nation has exactly two rated players');
  assert.equal(fieldsRealSide(pair, tennis), true);
  // Football fields only rated players, every nation it fields has a side.
  const football = getSport('football');
  assert.ok(fieldedNations(football).every(id => fieldsRealSide(id, football)));
});

test('every sport offers the world, a continent only with four real sides and the Elite 32 only with 32', () => {
  for (const sport of NATION_SPORTS) {
    const offered = ids(sport);
    const real = fieldedNations(sport).filter(id => fieldsRealSide(id, sport));
    assert.equal(offered[0], 'world', `${sport.id}: the world first`);
    assert.equal(offered.includes('elite'), real.length >= ELITE_NATIONS, `${sport.id}: Elite 32`);
    for (const scope of SCOPES.filter(item => item.id !== 'world' && item.id !== 'elite')) {
      const sides = real.filter(id => inScope(scope, id)).length;
      assert.equal(offered.includes(scope.id), playedIn(scope, sport) && sides >= MIN_REAL_SIDES, `${sport.id} in ${scope.name}: ${sides} real sides`);
    }
    // So no offered theatre is empty, or one team's.
    for (const scope of nationTheatres(sport).filter(item => item.filter)) {
      assert.ok(fieldedNations(sport).filter(id => inScope(scope, id)).length >= MIN_REAL_SIDES, `${sport.id} in ${scope.name}`);
    }
  }
});

test('rugby league plays the world and Asia & Oceania, women\'s tennis no Africa, football everywhere', () => {
  assert.deepEqual(ids(getSport('rugby-league')), ['world', 'AFC'], 'no Africa, the Americas or Europe (England alone)');
  assert.ok(!ids(getSport('womens-tennis')).includes('CAF'), 'no African nation fields a Billie Jean King Cup team');
  assert.deepEqual(ids(getSport('football')), SCOPES.filter(scope => !scope.sports).map(scope => scope.id), 'every theatre but basketball\'s EuroBasket');
});

test('a theatre the sport lacks gives way to its heartland, the continent with the most real sides', () => {
  assert.equal(nationTheatre(getSport('rugby-league'), 'CAF').id, 'AFC');
  assert.equal(nationTheatre(getSport('rugby-league'), 'elite').id, 'AFC');
  assert.equal(nationTheatre(getSport('baseball'), 'UEFA').id, 'CONCACAF');
  assert.equal(nationTheatre(getSport('hockey'), 'CONCACAF').id, 'UEFA');
  assert.equal(nationTheatre(getSport('rugby-league'), 'world').id, 'world', 'an offered choice stands');
  assert.equal(nationTheatre(getSport('football'), 'CAF').id, 'CAF');
});

test('setup lists only the offered theatres, and a choice the sport lacks shows as its heartland until it is offered again', () => {
  const setup = { sport: 'rugby-league', layer: 'nations', scope: 'CAF' };
  const rugby = buildSetupModel(setup, {});
  assert.deepEqual(rugby.scopes.map(scope => scope.id), ['world', 'AFC']);
  assert.equal(rugby.scopeId, 'AFC');
  assert.match(rugby.campaignSummary, /Rugby league · Nations · Asia & Oceania/);
  const football = buildSetupModel({ ...setup, sport: 'football' }, {});
  assert.equal(football.scopeId, 'CAF', 'football offers Africa, so the choice comes back');
});

test('a season decides its theatres once it has loaded: women\'s FIFA 16 has no Africa', () => {
  const set = decodeFootballSet(JSON.parse(readFileSync(new URL('../public/womens-football/eaw-fifa-16.json', import.meta.url), 'utf8')));
  const sport = seasonSport(set);
  assert.ok(!fieldedNations(sport).some(id => NATIONS[id][2] === 'CAF'), 'EA rated no African women\'s team in FIFA 16');
  assert.ok(!ids(sport).includes('CAF'));
  assert.ok(!ids(sport).includes('elite'), 'fewer than 32 nations');
  const setup = { sport: 'womens-football', layer: 'nations', scope: 'CAF', dataSet: 'eaw-fifa-16' };
  const loading = buildSetupModel(setup, { season: { state: 'loading' } });
  assert.ok(loading.scopes.some(scope => scope.id === 'CAF' && scope.count == null), 'every theatre while it loads, uncounted');
  assert.equal(loading.scopeId, 'CAF');
  const loaded = buildSetupModel(setup, { season: { state: 'ready', sport } });
  assert.ok(!loaded.scopes.some(scope => scope.id === 'CAF'));
  assert.equal(loaded.scopeId, nationTheatre(sport, 'CAF').id);
  assert.equal(loaded.scopeId, 'UEFA');
});

test('a challenge link names only a theatre the sport offers, and writes the one it plays', () => {
  const africa = readChallenge('?sport=rugby-league&theatre=CAF');
  assert.deepEqual(africa.ignored, ['theatre']);
  assert.equal(buildSetupModel(africa.setup, {}).scopeId, 'AFC');
  assert.deepEqual(readChallenge('?sport=rugby-league&theatre=AFC').ignored, []);
  assert.match(challengeQuery({ sport: 'rugby-league', layer: 'nations', scope: 'CAF' }, 3), /theatre=AFC/);
  // A season's nations are known once it loads: its link keeps the theatre, and setup falls back then.
  assert.deepEqual(readChallenge('?sport=womens-football&season=eaw-fifa-16&theatre=CAF').ignored, []);
});

const B = await bundleComponents({ App: 'src/App.jsx' }, { jsx: 'automatic' });

test('launch plays the theatre setup shows, and the campaign keeps it', () => {
  const f = syncAppFixture({ App: B.App, phase: 'setup', ids: ['036', '554', '598'],
    settings: { sport: 'rugby-league', layer: 'nations', scope: 'CAF', clubScope: 'all', role: 'manager', seed: '11' } });
  f.app.opening = B.App.prototype.opening;
  try {
    const { app } = f;
    const asia = fieldedNations(getSport('rugby-league')).filter(id => ['AFC', 'OFC'].includes(NATIONS[id][2]));
    const listed = app.setupTeams(app.state.setup).map(team => team.id).sort();
    assert.deepEqual(listed, asia.slice().sort(), 'the team list is Asia & Oceania');
    app.startCampaign();
    const { state } = app;
    assert.equal(state.phase, 'playing');
    assert.equal(state.settings.scope, 'AFC', 'the campaign records the theatre it plays');
    assert.deepEqual(state.aliveIds.slice().sort(), asia.slice().sort());
    assert.equal(state.teams[state.managedTeamId].id, '036', 'the suggested team, the strongest: Australia');
  } finally {
    f.close();
  }
});

/** The Elite 32 as it was ranked before the ranks were kept per sport: every nation rebuilt on its own fixed draw. */
function eliteField(sport) {
  const all = fieldedNations(sport).map(id => buildTeam(id, makeRng(1), sport));
  const rank = new Map(all.map(team => [team.id, teamEff(buildTeam(team.id, makeRng(hashStr(`elite ${team.id}`)), sport))]));
  return all.slice().sort((a, b) => b.str - a.str || rank.get(b.id) - rank.get(a.id)).slice(0, 32).map(team => team.id);
}

test('the Elite 32 keeps its ranks per sport and is the same field after: a season\'s, and basketball\'s drawn ties', async () => {
  const id = 'ea-fc-25';
  const text = readFileSync(new URL(`../public/football/${id}.json`, import.meta.url), 'utf8');
  const season = seasonSport(decodeFootballSet(JSON.parse(text), id));
  assert.equal(nationTheatre(season, 'elite').id, 'elite');
  const fetchBefore = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
  globalThis.fetch = async url => String(url).endsWith(`football/${id}.json`)
    ? { ok: true, status: 200, json: async () => JSON.parse(text) } : { ok: false, status: 404 };
  const f = syncAppFixture({ App: B.App, phase: 'setup', settings: { sport: 'football', layer: 'nations', scope: 'elite', dataSet: id } });
  f.app.opening = B.App.prototype.opening;
  try {
    const { app } = f;
    await app.loadSet(id);
    const field = (setup, seed) => app.opening(setup, makeRng(seed)).included.map(team => team.id);
    const expected = eliteField(season);
    assert.equal(expected.length, 32);
    for (const seed of [1, 1, 2026]) assert.deepEqual(field(app.state.setup, seed), expected, `${id}, seed ${seed}`);
    // Basketball builds generated players, so its ties are ranked on each nation's own draw: the same field too.
    const basketball = { ...app.state.setup, sport: 'basketball', dataSet: null };
    const drawn = eliteField(getSport('basketball'));
    for (const seed of [7, 7, 99]) assert.deepEqual(field(basketball, seed), drawn, `basketball, seed ${seed}`);
  } finally {
    f.close();
    if (fetchBefore) Object.defineProperty(globalThis, 'fetch', fetchBefore); else delete globalThis.fetch;
  }
});
