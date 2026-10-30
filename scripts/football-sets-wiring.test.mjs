// Football data sets in the running App (docs/design/football-years.md): the setup's Season choice and its loading,
// error and Retry states, a launch built from a set (territory included), saves that resume with no data set, the
// season in names, and the built-in path left as it was. A synthetic CM set is served through an injected fetch, and
// so is one of the built-in earlier seasons, read from public/football/.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { SAVE_KEY } from '../src/config.js';
import { CM_CONVERSION, expandCmTuple } from '../src/data/cmPlayers.js';
import { BUILT_IN_SEASONS } from '../src/data/footballSeasons.js';
import { NATIONS, selectLineup } from '../src/data/teams.js';
import { getSport } from '../src/sports/index.js';
import { parseCampaign } from '../src/engine/storage.js';
import { buildSetupModel } from '../src/screens/setup/setupModel.js';
import { bundleComponents, findElement, syncAppFixture, withDom } from './lib/app-harness.mjs';

// One bundle, so the test clears the very data set caches the App reads.
const B = await bundleComponents({
  App: 'src/App.jsx',
  clearFootballSetCache: ['src/engine/footballSets.js', 'clearFootballSetCache'],
  clearFootballSetIndex: ['src/engine/footballSets.js', 'clearFootballSetIndex'],
}, { jsx: 'automatic' });

// ---------- a synthetic data set (fake players, as in scripts/football-sets.test.mjs) ----------

const ID = 'cm0102-2002-05';
const SOURCE = { provider: 'CM 01/02 Update Team', edition: 'CM 01/02', version: 'Test 2002', snapshotDate: '2002-05',
  url: 'https://example.test/cm0102/test-2002', rawScale: 200, conversion: CM_CONVERSION, dobShift: 0 };
const XI = ['gk', 'lb', 'cb', 'cb', 'rb', 'lm', 'cm', 'cm', 'rm', 'st', 'st'];
const EMPTY = '442'; // Luxembourg: nobody in this fake database
const CLUBS = [['Premier League', '826', [['Testford United', 'TFU'], ['Mockley Town', 'MCK'], ['Shamwick City', 'SHC']]],
  ['La Liga', '724', [['Real Ficticio', 'RFI'], ['Atletico Simulado', 'ATS']]]];

function syntheticSet() {
  let next = 1;
  const player = (nation, key, i, club = '') => {
    const cmId = next++;
    return [cmId, `Fake${nation} ${key.toUpperCase()}${i}`, i % 3 ? 0 : `Fakeson Fake${nation} ${i}`, 60 + (cmId * 37) % 140,
      key, NATIONS[nation][0], club, i % 2 ? '' : `19${70 + i}-0${1 + (i % 9)}-1${i % 9}`];
  };
  const expanded = tuples => tuples.map(tuple => expandCmTuple(tuple, SOURCE));
  const strength = tuples => Math.round(selectLineup({ sport: 'football',
    squad: expanded(tuples).map(([name, pos, rating, info]) => ({ name, pos, rating, positions: info.positions })) }).rating);
  const nations = Object.fromEntries(Object.keys(NATIONS).map(nation => {
    if ([EMPTY, '499', 'KOS'].includes(nation)) return [nation, [40, 0, []]];
    const squad = XI.map((key, i) => player(nation, key, i));
    return [nation, [strength(squad), squad.length, squad]];
  }));
  const clubs = CLUBS.flatMap(([league, country, rows]) => rows.map(([name, code]) => {
    const squad = XI.map((key, i) => player(country, key, i, name));
    const ratings = expanded(squad).map(row => row[2]);
    return { id: `f-${name.toLowerCase().replaceAll(' ', '-')}`, name, code, league, country, col: '#2255aa',
      str: Math.round(ratings.reduce((sum, r) => sum + r, 0) / ratings.length), squad };
  }));
  const doc = { format: 1, id: ID, version: '', year: 2002, season: '2001/02', label: 'CM 01/02 · Test 2002', local: true,
    source: { ...SOURCE }, nations, clubs, territory: { merged: { 499: '688' }, inactive: ['KOS'] },
    coverage: { players: next - 1, nations: 167, completeXIs: 167, clubs: clubs.length, leagues: 2 } };
  const { version: _version, ...rest } = doc;
  doc.version = `${ID}-${createHash('sha256').update(JSON.stringify(rest)).digest('hex').slice(0, 8)}`;
  return doc;
}
const SET = syntheticSet();
const INDEX = { format: 1, sets: [{ id: ID, version: SET.version, year: 2002, season: '2001/02', label: SET.label,
  provider: SOURCE.provider, local: true, coverage: SET.coverage }] };
const SET_URL = `/football/${ID}.json`;
const UEFA_FIELD = Object.values(NATIONS).filter(nation => nation[2] === 'UEFA').length - 2; // without Montenegro and Kosovo

// ---------- harness ----------

/** fetch over `files` (url → JSON, a promise of it, or an Error to throw), read at call time; else a 404. */
function fakeFetch(files) {
  const calls = [];
  const fetch = async url => {
    calls.push(String(url));
    const body = await files[url];
    if (body instanceof Error) throw body;
    if (body === undefined) return { ok: false, status: 404, json: async () => { throw new Error('Not found'); } };
    return { ok: true, status: 200, json: async () => structuredClone(body) };
  };
  return { fetch, calls };
}
const settle = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

/** The real App's setup lifecycle (syncAppFixture, real opening) with `files` served as the page's fetch. */
async function withSetup(files, fn, { ids = ['250', '276', '826'], settings = {} } = {}) {
  const { fetch, calls } = fakeFetch(files);
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
  Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true, value: fetch });
  B.clearFootballSetCache();
  B.clearFootballSetIndex();
  const f = syncAppFixture({ App: B.App, phase: 'setup', ids,
    settings: { sport: 'football', layer: 'nations', scope: 'UEFA', clubScope: 'all', role: 'spectator', seed: '11', ...settings } });
  f.app.opening = B.App.prototype.opening;
  try { return await fn({ ...f, files, calls }); } finally {
    f.close();
    if (prior) Object.defineProperty(globalThis, 'fetch', prior); else delete globalThis.fetch;
  }
}

/** Mount what the App renders for `name`, and re-render it from the App's current state. */
async function mountPart(app, mount, name) {
  const element = () => findElement(app.render(), name);
  const view = await mount(element());
  return { ...view, refresh: () => act(async () => view.root.render(element())) };
}

/** Pick the set and wait for it, as the player waits on the setup screen (the load starts after a short pause). */
async function chooseSet(app, time) {
  app.pickSetup('dataSet', ID);
  time.advance(200);
  await app.loadSet(ID);
  await settle();
  assert.equal(app.seasonStatus().state, 'ready');
}

const setNames = nation => SET.nations[nation][2].map(tuple => tuple[1]);
/** The listed football seasons' ids (basketball's are listed with them: scripts/nba-seasons.test.mjs). */
const footballSetIds = app => app.state.footballSets.filter(set => !set.id.startsWith('nba-')).map(set => set.id);

const seasonPicker = document => document.getElementById('setup-season');
const seasonNames = document => [...seasonPicker(document).options].map(option => option.textContent);
/** Pick a season in the dropdown as the player does. */
async function pickSeason(document, id) {
  const select = seasonPicker(document);
  select.value = id;
  await act(async () => select.dispatchEvent(new document.defaultView.Event('change', { bubbles: true })));
}
/** The Season dropdown's names for the built-in earlier seasons: "2023/24" … "2014/15", without their source. */
const EARLIER = BUILT_IN_SEASONS.map(set => set.season);

// ---------- setup ----------

test('the Season choice offers the built-in season, then every earlier season built in, and reads the local index once', async () => {
  await withSetup({}, async ({ app, calls }) => {
    assert.deepEqual(footballSetIds(app), BUILT_IN_SEASONS.map(set => set.id), 'listed before any request');
    await app.requestSeasons();
    assert.deepEqual(calls, ['/football/index.json']);
    assert.deepEqual(footballSetIds(app), BUILT_IN_SEASONS.map(set => set.id));
    assert.equal(app.seasonStatus().state, 'idle');
    assert.equal(app.state.saveStatus, null, 'a missing index reports nothing');
    await withDom(async ({ document, mount }) => {
      await mountPart(app, mount, 'SetupOverlay');
      assert.equal(seasonPicker(document).tagName, 'SELECT', 'the seasons are a dropdown');
      assert.equal(seasonPicker(document).getAttribute('aria-labelledby'), 'setup-season-label');
      assert.deepEqual(seasonNames(document), ['2025/26', ...EARLIER]);
      assert.deepEqual(EARLIER.slice(0, 2), ['2023/24', '2022/23']);
      assert.equal(EARLIER.at(-1), '2014/15');
      assert.equal(seasonPicker(document).selectedIndex, 0, 'the built-in season by default');
      assert.equal(seasonPicker(document).value, '');
      assert.match(document.getElementById('setup-season-note').textContent, /Earlier seasons use EA FIFA ratings/);
      assert.ok(!document.querySelector('input[webkitdirectory]')
        && ![...document.querySelectorAll('button')].some(button => /season/i.test(button.textContent)), 'no season to load from files');
    });
    app.pickSetup('layer', 'clubs');
    await settle();
    assert.equal(calls.length, 1, 'later picks reuse the answer');
  });
});

test('a listed set adds the Season choice; picking it loads the set, and Launch waits until it is ready', async () => {
  const gate = deferred();
  const files = { '/football/index.json': INDEX, [SET_URL]: gate.promise.then(() => SET) };
  await withSetup(files, async ({ app, calls, time }) => {
    await app.requestSeasons();
    assert.deepEqual(footballSetIds(app), [...BUILT_IN_SEASONS.map(set => set.id), ID], 'the local set after the built-in ones');
    await withDom(async ({ document, mount }) => {
      const view = await mountPart(app, mount, 'SetupOverlay');
      assert.deepEqual(seasonNames(document), ['2025/26', ...EARLIER, '2001/02']);
      assert.equal(seasonPicker(document).value, '', 'the built-in season is chosen');

      await pickSeason(document, ID);
      assert.equal(app.state.setup.dataSet, ID);
      assert.equal(app.seasonStatus().state, 'loading');
      assert.deepEqual(app.setupTeams(), [], 'nobody is listed until the set loads');
      await view.refresh();
      assert.equal(document.querySelector('.setup-season__loading[role=status]')?.textContent, 'Loading the CM 01/02 · Test 2002 season…');
      assert.equal(document.querySelector('.setup-launch').disabled, true, 'Launch waits for the set');

      assert.ok(!calls.includes(SET_URL), 'the request waits for the player to stay on the season');
      time.advance(200);
      gate.resolve();
      await app.loadSet(ID);
      await settle();
      assert.deepEqual(app.state.footballSetLoad, { id: ID, state: 'ready', message: null });
      await view.refresh();
      assert.equal(seasonPicker(document).value, ID);
      assert.ok(!document.querySelector('.setup-season__loading'), 'the loading line is gone');
      assert.equal(document.querySelector('.setup-launch').disabled, false);
    });
    const teams = app.setupTeams(), byId = new Map(teams.map(team => [team.id, team]));
    assert.equal(teams.length, UEFA_FIELD, 'the set fields every UEFA nation it has a federation for');
    assert.ok(!byId.has('499') && !byId.has('KOS'), 'Montenegro plays for Serbia and Kosovo has no team');
    assert.deepEqual(byId.get(EMPTY).players, [], 'an empty nation lists nobody');
    assert.ok(byId.get('250').players.every(player => setNames('250').includes(player.name)), 'France fields the set\'s players');
    assert.deepEqual(calls, ['/football/index.json', SET_URL], 'one request for the set');
    const model = buildSetupModel(app.state.setup, { managerTeams: teams, season: app.seasonStatus() });
    assert.equal(model.campaignSummary, 'Football · Nations · Europe · 2001/02');
    assert.equal(model.scopes.find(scope => scope.id === 'UEFA').count, UEFA_FIELD);
  });
});

test('a set that cannot load shows the error with Retry; Retry loads it again', async () => {
  const files = { '/football/index.json': INDEX, [SET_URL]: new Error('offline') };
  await withSetup(files, async ({ app, calls, time }) => {
    await app.requestSeasons();
    app.pickSetup('dataSet', ID);
    time.advance(200);
    await settle();
    const status = app.seasonStatus();
    assert.equal(status.state, 'error');
    assert.equal(status.message, 'The CM 01/02 · Test 2002 season could not be loaded. Football data set cm0102-2002-05 failed to load: offline');
    app.pickSetup('pacing', 'blitz');
    await settle();
    assert.equal(calls.filter(url => url === SET_URL).length, 1, 'a failed set stays failed until Retry');
    await withDom(async ({ document, mount }) => {
      const view = await mountPart(app, mount, 'SetupOverlay');
      const alert = document.querySelector('.setup-season__error[role=alert]');
      assert.match(alert?.textContent || '', /could not be loaded\. Football data set cm0102-2002-05 failed to load: offline/);
      assert.equal(document.querySelector('.setup-launch').disabled, true);
      files[SET_URL] = SET;
      const retry = [...alert.querySelectorAll('button')].find(button => button.textContent === 'Retry');
      await act(async () => retry.click());
      assert.equal(app.seasonStatus().state, 'loading');
      time.advance(200);
      await app.loadSet(ID);
      await settle();
      assert.equal(app.seasonStatus().state, 'ready');
      await view.refresh();
      assert.ok(!document.querySelector('.setup-season__error'));
      assert.equal(document.querySelector('.setup-launch').disabled, false);
    });
    assert.equal(calls.filter(url => url === SET_URL).length, 2);
  });
});

test('stepping through the seasons fetches only the set the player stays on', async () => {
  const december = { ...structuredClone(SET), id: 'cm0102-2001-12', version: 'cm0102-2001-12-0123abcd', label: 'CM 01/02 · December 2001' };
  const index = { format: 1, sets: [...INDEX.sets, { ...INDEX.sets[0], id: december.id, version: december.version, label: december.label }] };
  const files = { '/football/index.json': index, [SET_URL]: SET, '/football/cm0102-2001-12.json': december };
  await withSetup(files, async ({ app, calls, time }) => {
    await app.requestSeasons();
    assert.deepEqual(app.state.footballSets.filter(set => set.id.startsWith('cm0102-')).map(set => set.id), [ID, december.id], 'the later release first');
    assert.deepEqual(buildSetupModel(app.state.setup, { season: app.seasonStatus() }).season.options.slice(-2).map(option => option.name),
      ['2001/02 · CM 01/02 · Test 2002', '2001/02 · CM 01/02 · December 2001'], 'two sets of one season keep their source');
    app.pickSetup('dataSet', december.id);
    time.advance(50);
    app.pickSetup('dataSet', ID);
    time.advance(200);
    await app.loadSet(ID);
    await settle();
    assert.equal(app.seasonStatus().state, 'ready');
    assert.deepEqual(calls, ['/football/index.json', SET_URL]);
  });
});

test('while a chosen set loads, step 1 shows none of the built-in season\'s figures or leagues', async () => {
  const gate = deferred();
  const files = { '/football/index.json': INDEX, [SET_URL]: gate.promise.then(() => SET) };
  await withSetup(files, async ({ app, time }) => {
    await app.requestSeasons();
    app.pickSetup('layer', 'clubs');
    app.pickSetup('clubScope', 'Premier League');
    app.pickSetup('dataSet', ID);
    time.advance(200);
    const model = () => buildSetupModel(app.state.setup, { season: app.seasonStatus() });
    const loading = model();
    assert.equal(loading.season.state, 'loading');
    assert.deepEqual(loading.scopes.map(scope => [scope.id, scope.count]), [['all', null], ['elite', null], ['Premier League', null]],
      'no built-in league is offered, and the chosen one stays chosen until the set answers');
    assert.equal(loading.scopeId, 'Premier League');
    assert.equal(loading.sports.find(sport => sport.id === 'football').note, 'Nations', 'no built-in club count on the card');
    assert.deepEqual(loading.stats.map(stat => stat.value), ['–', '–', '–']);
    assert.equal(loading.status, 'Loading the CM 01/02 · Test 2002 season…');
    assert.equal(loading.canLaunch, false);
    await withDom(async ({ document, mount }) => {
      const view = await mountPart(app, mount, 'SetupOverlay');
      const rows = () => [...document.querySelectorAll('[aria-labelledby="setup-theatre-label"] [role=radio]')];
      assert.deepEqual(rows().map(row => row.querySelector('.setup-theatre__count').textContent), ['', '', '']);
      assert.deepEqual([...document.querySelectorAll('#setup-theatre option')].map(option => option.textContent),
        ['All Leagues', 'Elite 32', 'Premier League']);
      gate.resolve();
      await app.loadSet(ID);
      await settle();
      await view.refresh();
      assert.deepEqual(rows().map(row => row.querySelector('.setup-theatre__count').textContent),
        ['5 clubs', '5 clubs', '3 clubs', '2 clubs'], 'the set\'s own leagues and counts once it has loaded');
    });
    const ready = model();
    assert.equal(ready.scopeId, 'Premier League', 'the set has the league, so it stays');
    assert.match(ready.status, /^3 clubs · 2 matches · /);
    app.pickSetup('role', 'manager');
    app.pickSetup('managedTeamId', 'f-testford-united');
    const managed = buildSetupModel(app.state.setup, { season: app.seasonStatus(), managerTeams: app.setupTeams() }).managed;
    assert.equal(managed.meta, 'Premier League · Football club', 'read from the set\'s own clubs');

    // Nations too: the theatres are listed, uncounted, until the set loads.
    B.clearFootballSetCache();
    app.pickSetup('layer', 'nations');
    app.retrySet();
    const nations = model();
    assert.equal(nations.season.state, 'loading');
    assert.ok(nations.scopes.length > 1 && nations.scopes.every(scope => scope.count === null));
    assert.equal(nations.roleMeta, 'Europe · Football nations');
  });
});

test('a set keeps the built-in season\'s country maps out of the club theatres, and stays with football', async () => {
  await withSetup({ '/football/index.json': INDEX, [SET_URL]: SET }, async ({ app, time }) => {
    await app.requestSeasons();
    app.pickSetup('layer', 'clubs');
    app.pickSetup('clubScope', 'domestic:826');
    assert.ok(buildSetupModel(app.state.setup, { season: app.seasonStatus() }).domesticScopes.length > 0, 'country maps on offer');
    await chooseSet(app, time);
    assert.equal(app.state.setup.clubScope, 'all', 'a chosen country falls back to every club');
    const model = buildSetupModel(app.state.setup, { season: app.seasonStatus() });
    assert.deepEqual(model.domesticScopes, [], 'no "One country" group with a set');
    assert.deepEqual(model.scopes.map(scope => [scope.id, scope.count]), [['all', 5], ['elite', 5], ['Premier League', 3], ['La Liga', 2]]);
    assert.equal(model.sports.find(sport => sport.id === 'football').note, 'Nations · 5 clubs from 2 leagues');
    app.pickSetup('clubScope', 'Serie A');
    assert.equal(app.state.setup.clubScope, 'all', 'a league the set leaves out is not a theatre');
    app.pickSetup('clubScope', 'domestic:826');
    assert.equal(app.state.setup.clubScope, 'all', 'nor is a country map');
    app.pickSetup('clubScope', 'La Liga');
    assert.equal(app.state.setup.clubScope, 'La Liga');

    app.pickSetup('sport', 'basketball');
    assert.equal(app.state.setup.dataSet, null, 'basketball resets the season');
    assert.ok(buildSetupModel(app.state.setup, { season: app.seasonStatus() }).season.options
      .every(option => option.id == null || option.id.startsWith('nba-')), 'basketball lists its own seasons');
    app.pickSetup('sport', 'football');
    assert.equal(app.state.setup.dataSet, null);
  });
});

// ---------- launch, saves and names ----------

test('launch builds the nations from the set: Montenegro held by Serbia, Kosovo neutral, an empty nation kept empty', async () => {
  const files = { '/football/index.json': INDEX, [SET_URL]: SET };
  await withSetup(files, async ({ app, items, calls, time }) => {
    await app.requestSeasons();
    await chooseSet(app, time);
    app.startCampaign();
    const st = app.state;
    assert.equal(st.phase, 'playing');
    assert.equal(st.aliveIds.length, UEFA_FIELD);
    assert.deepEqual(st.teams['250'].squad.map(player => player.name), setNames('250'));
    assert.ok(st.teams['250'].squad.every(player => player.sourceInfo.source === 'cm0102' && player.gen === false));
    assert.equal(st.teams['250'].str, SET.nations['250'][0]);
    assert.deepEqual([st.teams[EMPTY].squad.length, st.teams[EMPTY].real, st.teams[EMPTY].str], [0, 0, 40], 'nobody is invented');
    assert.ok(!st.teams['499'] && st.own['499'] === '688', 'Montenegro starts in Serbia\'s empire');
    assert.ok(!st.teams.KOS && !('KOS' in st.own), 'Kosovo is neutral land');
    for (const settings of [st.settings, st.initialSettings]) {
      assert.deepEqual([settings.dataSet, settings.dataVersion, settings.dataYear, settings.dataSeason], [ID, SET.version, 2002, '2001/02']);
    }
    assert.equal(st.campaignName, 'Football 2001/02 · Europe');
    assert.equal(app.mapOverlaysModel().titleCard.title, 'The European Campaign · 2001/02');
    assert.match(app.ledgerModel().header.kicker, /^The European Campaign · 2001\/02 · /);

    // The checkpoint packs the CM players and needs no data set to come back.
    const text = items.get(SAVE_KEY);
    assert.equal(JSON.parse(text).playerPack.kind, 'cm0102');
    B.clearFootballSetCache();
    files[SET_URL] = new Error('the data set is gone');
    const before = calls.length;
    const saved = parseCampaign(text);
    assert.equal(JSON.stringify(saved.teams), JSON.stringify(st.teams), 'squads rebuild exactly');
    app.continueSaved(saved);
    assert.equal(app.state.phase, 'playing', 'resumed at once');
    assert.equal(app.state.saveStatus.ok, true);
    assert.equal(JSON.stringify(app.state.teams), JSON.stringify(st.teams));
    assert.equal(app.state.own['499'], '688');
    assert.equal(calls.length, before, 'resuming fetched nothing');

    // Saved campaigns name the season of a set campaign.
    app.openStorageDialog('slots');
    await withDom(async ({ document, mount }) => {
      await mountPart(app, mount, 'CampaignStorageDialog');
      const rows = [...document.querySelectorAll('.campaign-storage-list li')];
      assert.equal(rows.length, 1);
      assert.match(rows[0].textContent, /Football 2001\/02 · Europe/);
      const terms = [...rows[0].querySelectorAll('dt')].map(dt => [dt.textContent, dt.nextElementSibling.textContent]);
      assert.deepEqual(terms.find(([term]) => term === 'Season'), ['Season', `2001/02 · ${ID}`]);
    });
  });
});

test('clubs on a set are the set\'s clubs, with their CM squads', async () => {
  await withSetup({ '/football/index.json': INDEX, [SET_URL]: SET }, async ({ app, time }) => {
    await chooseSet(app, time);
    app.pickSetup('layer', 'clubs');
    app.startCampaign();
    const st = app.state;
    assert.equal(st.phase, 'playing');
    assert.deepEqual(Object.keys(st.teams).sort(), SET.clubs.map(club => club.id).sort());
    assert.deepEqual(st.teams['f-testford-united'].squad.map(player => player.name), SET.clubs[0].squad.map(tuple => tuple[1]));
    assert.equal(st.settings.dataSet, ID);
    assert.equal(st.campaignName, 'Football 2001/02 · All Leagues');
  }, { ids: ['250', '276', '826', '724', '380', '056'] });
});

test('Retry this setup loads the set first, and refuses clearly when it cannot', async () => {
  const files = { '/football/index.json': INDEX, [SET_URL]: SET };
  await withSetup(files, async ({ app, time }) => {
    await app.requestSeasons();
    await chooseSet(app, time);
    app.pickSetup('role', 'manager');
    app.pickSetup('managedTeamId', '688');
    app.startCampaign();
    assert.equal(app.state.campaignName, 'Football 2001/02 · Europe · Serbia');
    const first = app.state.campaignId;

    // Serbia is knocked out, and the checkpoint recording it was saved.
    const eliminate = () => app.setState({ managerElimination: { teamId: '688', opponentId: '191', matchId: 'none', placement: 9,
      conquests: 0, signings: 0 }, paused: true, saveStatus: { ok: true, message: 'Progress saved' } });
    eliminate();
    B.clearFootballSetCache();
    const gate = deferred();
    files[SET_URL] = gate.promise.then(() => new Error('offline'));
    await withDom(async ({ document, mount }) => {
      const view = await mountPart(app, mount, 'ManagerElimination');
      const note = () => document.querySelector('.manager-note');
      assert.match(note().textContent, /^Your run is saved\./);
      const retrying = app.retryManager();
      await view.refresh();
      assert.equal(note().textContent, 'Loading the CM 01/02 · Test 2002 season…', 'the dialog says what Retry waits for');
      gate.resolve();
      await retrying;
      await view.refresh();
      assert.ok(app.state.managerElimination, 'the dialog stays open');
      assert.equal(app.state.campaignId, first, 'the campaign stays as it is');
      assert.equal(note().textContent,
        'This setup needs the CM 01/02 · Test 2002 season, which could not be loaded. Football data set cm0102-2002-05 failed to load: offline');
      assert.ok(note().classList.contains('manager-note--unsaved'));
      assert.deepEqual(app.state.saveStatus, { ok: true, message: 'Progress saved' }, 'the run was saved, and the status still says so');
    });

    // Following the remaining teams while the set loads drops the retry.
    const late = deferred();
    files[SET_URL] = late.promise.then(() => SET);
    const dropped = app.retryManager();
    app.continueAsSpectator();
    late.resolve();
    await dropped;
    assert.equal(app.state.campaignId, first, 'no new campaign behind the player\'s back');
    assert.equal(app.state.managementEnded, true);
    assert.equal(app.state.retrySetup, null);

    B.clearFootballSetCache();
    eliminate();
    files[SET_URL] = SET;
    await app.retryManager();
    assert.notEqual(app.state.campaignId, first, 'the setup starts again');
    assert.equal(app.state.phase, 'playing');
    assert.equal(app.state.managedTeamId, '688');
    assert.equal(app.state.settings.dataVersion, SET.version);
    assert.equal(app.state.own['499'], '688');
    assert.equal(app.state.retrySetup, null);
  });
});

test('the built-in season launches exactly as before, beside a listed set', async () => {
  await withSetup({ '/football/index.json': INDEX, [SET_URL]: SET }, async ({ app, calls, time }) => {
    await app.requestSeasons();
    await chooseSet(app, time);
    app.pickSetup('dataSet', null);
    assert.equal(app.seasonStatus().state, 'idle');
    app.startCampaign();
    const st = app.state, football = getSport('football');
    assert.equal(st.settings.dataSet, null);
    assert.ok(!['dataVersion', 'dataYear', 'dataSeason'].some(key => key in st.settings), 'no season stamps');
    assert.equal(st.campaignName, 'Football · Europe');
    assert.equal(app.mapOverlaysModel().titleCard.title, 'The European Campaign');
    assert.equal(st.aliveIds.length, UEFA_FIELD + 2, 'Montenegro and Kosovo field their own teams');
    assert.deepEqual(st.teams['499'].squad.map(player => player.name), football.rosters['499'][2].map(row => row[0]));
    assert.equal(st.own['499'], '499');
    assert.equal(calls.filter(url => url === SET_URL).length, 1);
  });
});

// ---------- the built-in earlier seasons ----------

const EA_ID = 'ea-fifa-18';
const EA_URL = `/football/${EA_ID}.json`;
const EA_SET = JSON.parse(readFileSync(new URL(`../public${EA_URL}`, import.meta.url), 'utf8'));

test('an earlier season loads its own file and plays that season\'s EA players; its campaigns resume without the file', async () => {
  const files = { [EA_URL]: EA_SET };
  await withSetup(files, async ({ app, items, calls, time }) => {
    await app.requestSeasons();
    await withDom(async ({ document, mount }) => {
      const view = await mountPart(app, mount, 'SetupOverlay');
      assert.equal(seasonPicker(document).options[seasonNames(document).indexOf('2017/18')].value, EA_ID);
      await pickSeason(document, EA_ID);
      assert.equal(app.state.setup.dataSet, EA_ID);
      await view.refresh();
      assert.equal(document.querySelector('.setup-season__loading[role=status]')?.textContent, 'Loading the FIFA 18 season…');
    });
    time.advance(200);
    await app.loadSet(EA_ID);
    await settle();
    assert.equal(app.seasonStatus().state, 'ready');
    assert.equal(calls.filter(url => url === EA_URL).length, 1);
    const model = buildSetupModel(app.state.setup, { managerTeams: app.setupTeams(), season: app.seasonStatus() });
    assert.equal(model.campaignSummary, 'Football · Nations · Europe · 2017/18');

    app.startCampaign();
    const st = app.state;
    assert.equal(st.phase, 'playing');
    assert.deepEqual([st.settings.dataSet, st.settings.dataVersion, st.settings.dataYear, st.settings.dataSeason],
      [EA_ID, EA_SET.version, 2018, '2017/18']);
    assert.equal(st.campaignName, 'Football 2017/18 · Europe');
    assert.deepEqual(st.teams['250'].squad.map(player => player.name), EA_SET.nations['250'][2].map(tuple => tuple[1]), 'France\'s FIFA 18 XI');
    assert.ok(st.teams['250'].squad.every(player => player.sourceInfo.source === 'ea-fc' && player.sourceInfo.edition === 'FIFA 18'
      && player.sourceInfo.url.endsWith('/180002') && player.rating === player.sourceInfo.rawRating), 'EA ratings, unchanged');
    assert.ok(st.teams.KOS, 'Kosovo had joined FIFA by the end of 2017/18');

    // The checkpoint packs the season's players as EA tuples and needs no file to come back.
    const text = items.get(SAVE_KEY);
    assert.deepEqual(JSON.parse(text).playerPack, { kind: 'ea', source: { edition: 'FIFA 18', update: 2, snapshotDate: '2017-09-18', roster: '180002' } });
    B.clearFootballSetCache();
    files[EA_URL] = new Error('the season file is gone');
    const before = calls.length;
    const saved = parseCampaign(text);
    assert.equal(JSON.stringify(saved.teams), JSON.stringify(st.teams), 'squads rebuild exactly');
    app.continueSaved(saved);
    assert.equal(app.state.phase, 'playing', 'resumed at once');
    assert.equal(JSON.stringify(app.state.teams), JSON.stringify(st.teams));
    assert.equal(calls.length, before, 'resuming fetched nothing');
  });
});
