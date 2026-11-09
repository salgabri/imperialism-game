// Nation theatres only where a sport is played (src/data/scopes.js `nationTheatres`): the world always, a continent once
// four of its nations field a real side, the Elite 32 once 32 do. Rugby league in Africa, all generated players, and
// women's tennis in Africa, no nation at all, are not offered.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NATIONS, SCOPES, fieldsRealSide } from '../src/data/teams.js';
import { ELITE_NATIONS, MIN_REAL_SIDES, nationTheatre, nationTheatres } from '../src/data/scopes.js';
import { decodeFootballSet, fieldedNations, seasonSport } from '../src/engine/footballSets.js';
import { SPORT_LIST, getSport } from '../src/sports/index.js';
import { buildSetupModel } from '../src/screens/setup/setupModel.js';
import { challengeQuery, readChallenge } from '../src/screens/setup/challenge.js';
import { bundleComponents, syncAppFixture } from './lib/app-harness.mjs';

const ids = sport => nationTheatres(sport).map(scope => scope.id);
const NATION_SPORTS = SPORT_LIST.filter(sport => !sport.clubsOnly);
const inScope = (scope, id) => scope.filter({ conf: NATIONS[id][2] });

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
      assert.equal(offered.includes(scope.id), sides >= MIN_REAL_SIDES, `${sport.id} in ${scope.name}: ${sides} real sides`);
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
  assert.deepEqual(ids(getSport('football')), SCOPES.map(scope => scope.id));
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
