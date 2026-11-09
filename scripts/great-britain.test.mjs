// The United Kingdom as one team: Great Britain (GBR, the Union Jack) in the sports that merge the home nations into
// its shape (basketball, baseball, ice hockey, tennis), football's and women's football's England as before. The team
// keeps the id 826 (src/data/teams.js GREAT_BRITAIN and nationIdentity, `playsAs` in src/sports).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { GREAT_BRITAIN, HOME_NATIONS, NATIONS, buildTeam, makeRng, nationIdentity } from '../src/data/teams.js';
import { FLAG_CODES } from '../src/data/flags.js';
import { SPORT_LIST, getSport } from '../src/sports/index.js';
import { decodeFootballSet, fieldedNations, seasonSport } from '../src/engine/footballSets.js';
import { buildSetupModel } from '../src/screens/setup/setupModel.js';
import { exportCampaign, parseCampaign } from '../src/engine/storage.js';
import { bundleApp, bundleComponents, forceResult, syncAppFixture, withDom } from './lib/app-harness.mjs';

const App = await bundleApp();
const { SetupOverlay } = await bundleComponents({ SetupOverlay: 'src/components/SetupOverlay.jsx' });
const IDS = ['250', '276', '826'];
const AS_ONE = ['basketball', 'baseball', 'hockey', 'tennis', 'womens-tennis'];
const identityOf = team => [team.name, team.code, team.flagId];
const GB = ['Great Britain', 'GBR', 'GBR'];
const ENGLAND = ['England', 'ENG', '826'];

test('basketball, baseball, ice hockey and tennis (both cups) play the United Kingdom as Great Britain, football as England', () => {
  for (const id of AS_ONE) {
    const team = buildTeam('826', makeRng(1), getSport(id));
    assert.deepEqual(identityOf(team), GB, id);
    assert.deepEqual([team.id, team.home, team.origin], ['826', '826', '826'], `${id}: the same shape and id as before`);
  }
  for (const id of ['football', 'womens-football']) assert.deepEqual(identityOf(buildTeam('826', makeRng(1), getSport(id))), ENGLAND, id);
  // A sport plays Great Britain exactly where Scotland, Wales and Northern Ireland start in the United Kingdom's empire.
  for (const sport of SPORT_LIST) {
    const asOne = HOME_NATIONS.every(id => sport.territory?.merged[id] === '826');
    assert.equal(sport.playsAs?.['826'] === GREAT_BRITAIN, asOne, sport.id);
  }
  // Every other nation keeps its own name, code and flag in every sport.
  for (const sport of SPORT_LIST) {
    for (const [id, [name, code]] of Object.entries(NATIONS)) {
      if (id === '826' && AS_ONE.includes(sport.id)) continue;
      assert.deepEqual(nationIdentity(id, sport), { name, code, flagId: id }, `${sport.id} ${id}`);
    }
  }
  assert.deepEqual(nationIdentity('826'), { name: 'England', code: 'ENG', flagId: '826' }, 'no sport: the nation\'s own');
  assert.equal(nationIdentity('XYZ', getSport('basketball')), null);
});

test('an earlier baseball season plays Great Britain too', () => {
  const set = decodeFootballSet(JSON.parse(readFileSync(new URL('../public/baseball/mlb-the-show-24.json', import.meta.url), 'utf8')));
  const sport = seasonSport(set);
  assert.equal(sport.dataSeason, '2024');
  assert.deepEqual(identityOf(buildTeam('826', makeRng(1), sport)), GB);
});

test('Great Britain flies the vendored Union Jack; England keeps the cross of St George', () => {
  assert.equal(FLAG_CODES[GREAT_BRITAIN.flagId], 'gb');
  assert.equal(FLAG_CODES['826'], 'gb-eng');
  const svg = readFileSync(new URL('../public/flags/gb.svg', import.meta.url), 'utf8');
  assert.match(svg, /id="flag-icons-gb" viewBox="0 0 640 480"/, 'flag-icons\' gb, copied by npm run sync-flags');
  assert.match(svg, /fill="#012169"/, 'the blue field');
});

test('the setup wall lists Great Britain under the Union Jack where the sport plays it, England in football', async () => {
  // Great Britain fields a team where its own rated players hold half the lineup (fieldedNations): in both tennis games.
  // Its basketball, baseball and hockey players are too few, and its land stays neutral there.
  const playing = AS_ONE.filter(sport => fieldedNations(getSport(sport)).includes('826'));
  assert.deepEqual(playing, ['tennis', 'womens-tennis']);
  for (const sport of [...playing, 'football']) {
    const [name, code, flagId] = sport === 'football' ? ENGLAND : GB;
    const flag = sport === 'football' ? '/flags/gb-eng.svg' : '/flags/gb.svg';
    const f = syncAppFixture({ App, ids: IDS, phase: 'setup',
      settings: { sport, layer: 'nations', scope: 'UEFA', role: 'manager', managedTeamId: '826', seed: '7' } });
    try {
      f.app.opening = App.prototype.opening; // every nation of the theatre, built for the sport (the fixture's are football's)
      const setup = f.app.state.setup;
      const managerTeams = f.app.setupTeams(setup);
      const uk = managerTeams.find(team => team.id === '826');
      assert.deepEqual([uk.name, uk.code, uk.flagId], [name, code, flagId], sport);
      const model = buildSetupModel(setup, { managerTeams });
      const row = model.teams.find(team => team.id === '826');
      assert.deepEqual([row.name, row.code, row.flagId], [name, code, flagId], `${sport}: the wall's row`);
      assert.deepEqual([model.managed.name, model.managed.flagId], [name, flagId], `${sport}: the selected team`);
      // Without App's teams, the row's identity still comes from the sport.
      const bare = buildSetupModel(setup, { managerTeams: [{ id: '826', name, rating: 70 }] }).teams[0];
      assert.deepEqual([bare.code, bare.flagId], [code, flagId], `${sport}: identity from the sport`);
      await withDom(({ window }) => {
        const markup = renderToStaticMarkup(React.createElement(SetupOverlay, {
          setup, managerTeams, hasSave: false, savedText: '', onPick() {}, onStart() {}, onResume() {}, onDiscard() {},
          onImport() {}, onManageSaves() {},
        }));
        const doc = new window.DOMParser().parseFromString(markup, 'text/html');
        const radio = [...doc.querySelectorAll('.setup-teams [role=radio]')].find(element => element.textContent.includes(name));
        assert.ok(radio, `${sport}: ${name} is on the wall`);
        assert.equal(radio.querySelector('img')?.getAttribute('src'), flag, `${sport}: the wall's flag`);
        assert.equal(doc.querySelector('.setup-pick__flag img')?.getAttribute('src'), flag, `${sport}: the selected team's flag`);
        assert.equal(doc.querySelector('.setup-pick__name')?.textContent, name);
      });
    } finally { f.close(); }
  }
});

test('a basketball campaign shows Great Britain on the map, its banner, the squad, the ledger, the chronicle and the conquest', () => {
  const f = syncAppFixture({ App, ids: IDS, settings: { sport: 'basketball' } });
  try {
    const { app } = f;
    assert.deepEqual(identityOf(app.state.teams['826']), GB);
    assert.deepEqual(app.mapLabels(true).find(label => label.id === '826'), { id: '826', text: 'GREAT BRITAIN' });
    app.geo.fitTo = () => {};
    App.prototype.fitMap.call(app, IDS);
    app.setState({ mapMode: 'flags' });
    const banner = app.mapFlags(true).flagPatterns.find(pattern => pattern.ownerId === '826');
    assert.equal(banner.url, '/flags/gb.svg');
    assert.equal(banner.symbolProfile, undefined, 'no emblem to keep upright: the Union Jack stretches like any striped flag');
    const row = app.powerTable(true).find(entry => entry.tid === '826');
    assert.deepEqual([row.name, row.code, row.flagId], GB, 'the standings');
    app.setState({ selected: '826' });
    const squad = app.squadModel();
    assert.deepEqual([squad.name, squad.team.code, squad.team.flagId], GB, 'the squad');
    app.setState({ hoverCid: '826' });
    const tip = app.tooltip(true);
    assert.deepEqual([tip.name, tip.held], ['England', 'Capital of Great Britain'], 'the land is England, its holder Great Britain');

    app.startMatch('276', '826');
    forceResult(app, '276', { aId: '276', dId: '826' });
    app.finishMatch();
    f.time.advance(3000);
    assert.equal(app.state.match.applied, true);
    const entry = app.state.history.at(-1);
    assert.deepEqual([entry.b.name, entry.b.code, entry.b.id], GB, 'the chronicle\'s record of the match');
    assert.equal(entry.result.title, 'GERMANY ANNEXES GREAT BRITAIN');
    assert.equal(entry.result.loserName, 'Great Britain');
    assert.deepEqual(entry.result.territoryNames, ['England'], 'the land taken keeps its own name');
    assert.ok(app.state.log.some(line => line.txt === 'GREAT BRITAIN FALLS — 1 TERRITORY ANNEXED BY GERMANY'), 'the log');
    const chronicle = app.chronicleModel();
    const side = chronicle.history.at(-1).b;
    assert.deepEqual([side.name, side.code, side.id], GB, 'the chronicle\'s match, under the Union Jack');
    const feed = chronicle.feed.map(line => line.text);
    assert.deepEqual(feed.slice(1), ['GREAT BRITAIN FALLS — 1 TERRITORY ANNEXED BY GERMANY', 'GER 1–0 GBR']);
    assert.match(feed[0], /^GER CLAIMS .+ FROM GBR$/);
    assert.equal(chronicle.historyTeams.find(team => team.id === '826').name, 'Great Britain');
  } finally { f.close(); }
});

test('football\'s England keeps its name, code and the cross of St George', () => {
  const f = syncAppFixture({ App, ids: IDS, settings: { sport: 'football' } });
  try {
    const { app } = f;
    assert.deepEqual(identityOf(app.state.teams['826']), ENGLAND);
    assert.deepEqual(app.mapLabels(true).find(label => label.id === '826'), { id: '826', text: 'ENGLAND' });
    app.geo.fitTo = () => {};
    App.prototype.fitMap.call(app, IDS);
    app.setState({ mapMode: 'flags' });
    assert.equal(app.mapFlags(true).flagPatterns.find(pattern => pattern.ownerId === '826').url, '/flags/gb-eng.svg');
    app.startMatch('276', '826');
    forceResult(app, '276', { aId: '276', dId: '826' });
    app.finishMatch();
    f.time.advance(3000);
    assert.equal(app.state.history.at(-1).result.title, 'GERMANY ANNEXES ENGLAND');
  } finally { f.close(); }
});

test('Great Britain survives a save, and a campaign saved as England before loads as it was saved', () => {
  const f = syncAppFixture({ App, ids: IDS, settings: { sport: 'hockey' } });
  try {
    const { app } = f;
    assert.deepEqual(identityOf(parseCampaign(exportCampaign(app.state)).teams['826']), GB);
    // Before Great Britain, the same campaign built 826 as England under the cross of St George.
    const before = { ...app.state, teams: { ...app.state.teams, 826: { ...app.state.teams['826'], name: 'England', code: 'ENG', flagId: '826' } } };
    const loaded = parseCampaign(exportCampaign(before));
    assert.deepEqual(identityOf(loaded.teams['826']), ENGLAND);
    assert.deepEqual(loaded.aliveIds, IDS);
  } finally { f.close(); }
});
