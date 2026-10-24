import test from 'node:test';
import assert from 'node:assert/strict';
import { SAVE_KEY, SAVE_VERSION } from '../src/config.js';
import { buildClub, buildTeam, makeRng } from '../src/data/teams.js';
import { expandFmTuple } from '../src/data/fmPlayers.js';
import { getSport } from '../src/sports/index.js';
import { CAMPAIGN_BACKUP_KEY, CAMPAIGN_DAMAGED_KEY, campaignStorageKey, createCampaignId, parseCampaign, writeSave,
  campaignSnapshot, inspectSave, inspectCampaign, loadSave, loadCampaign, listCampaigns, renameCampaign,
  forkCampaign, clearSave, detectSaveConflict, isCampaignStorageEvent, serializeCampaign, exportCampaign, deleteCampaign,
  fitDomesticCampaign } from '../src/engine/storage.js';

function checkpoint() {
  const rng = makeRng(42), sport = getSport('football');
  const teams = Object.fromEntries(['250', '276'].map(id => [id, buildTeam(id, rng, sport)]));
  return { phase: 'playing', settings: { sport: 'football', layer: 'nations', pacing: 'duel', resolution: 'ticker', role: 'manager' },
    teams, own: { 250: '250', 276: '276' }, aliveIds: ['250', '276'], fallen: [], stats: {},
    round: 1, matches: 0, queue: [], history: [], log: [], seed: 42, rngState: rng.getState(),
    followedId: '250', managedTeamId: '250', campaignId: createCampaignId(), revision: 0,
    campaignName: 'France campaign', metrics: { acquisitions: [], leaderChanges: 0 },
    match: null, spin: null, choice: null, series: null, tacticalChoice: null };
}
function withStorage(run) {
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'localStorage'), items = new Map();
  const storage = { getItem: key => items.get(key) ?? null, setItem: (key, value) => items.set(key, String(value)), removeItem: key => items.delete(key) };
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  try { run({ storage, items }); } finally {
    if (prior) Object.defineProperty(globalThis, 'localStorage', prior); else delete globalThis.localStorage;
  }
}
function saved(state) { return JSON.stringify(campaignSnapshot(state)); }
function match() { return { aId: '250', dId: '276', winner: '250', finalGa: 2, finalGd: 0, effA: 84, effD: 82,
  ga: 0, gd: 0, allEv: [{ m: 10, tid: '250', name: 'Scorer' }], shown: [], applied: false, done: false }; }

test('strict import rejects invalid state before it can replace the existing checkpoint', () => withStorage(({ storage }) => {
  const state = checkpoint();
  assert.equal(writeSave(state).ok, true);
  const good = storage.getItem(SAVE_KEY);
  const variants = [
    [s => { s.queue = [['250', 'missing']]; }, /fixture queue/],
    [s => { s.queue = [['250', '250']]; }, /fixture queue/],
    [s => { s.history = 42; }, /history must be a list/],
    [s => { s.rngState = 'bad'; }, /random state/],
    [s => { s.rngState = null; }, /random state/],
    [s => { s.seed = -1; }, /random state/],
    [s => { s.aliveIds.push('250'); }, /territory/],
    [s => { s.own['276'] = 'missing'; }, /territory/],
    [s => { s.settings.sport = 'tennis'; }, /setting/],
    [s => { s.match = { ...match(), winner: 'missing' }; }, /match is incomplete/],
    [s => { s.match = { ...match(), allEv: [{ m: 2, tid: 'missing' }] }; }, /match is incomplete/],
    [s => { s.spin = { targetId: '276' }; }, /draw references/],
    [s => { s.choice = { candidates: [] }; }, /signing decision/],
    [s => { s.match = match(); s.choice = { candidates: [{ index: 999, name: 'Missing', rating: 82, gain: 0 }] }; }, /candidate/],
    [s => { s.tacticalChoice = { aId: '250', dId: 'missing' }; }, /tactical decision/],
    [s => { s.series = { teamIds: ['250', '276'], wins: { 250: 2, 276: 0 }, games: 1 }; }, /series/],
    [s => { s.phase = 'victory'; }, /one champion/],
    // Both used to pass and then crash: lineup selection and PlayerRow call positions.includes, resume reads shown[i].m.
    [s => { s.teams['250'].squad[0].positions = 'ST'; }, /territory data are incomplete/],
    [s => { s.match = { ...match(), shown: [null] }; }, /match is incomplete/],
  ];
  for (const [mutate, expected] of variants) {
    const invalid = structuredClone(state); mutate(invalid);
    assert.throws(() => parseCampaign(saved(invalid)), expected);
    assert.equal(storage.getItem(SAVE_KEY), good);
  }
}));

test('pending match, signing and manager decisions retain their references on export/import', () => {
  const state = checkpoint(); state.match = match();
  state.choice = { candidates: [{ ...state.teams['276'].squad[0], index: 0, gain: 0.3 }], winnerName: 'France', loserName: 'Germany' };
  assert.equal(parseCampaign(saved(state)).choice.candidates[0].index, 0);
  state.choice = null; state.match = null; state.tacticalChoice = { aId: '250', dId: '276', managerName: 'France', opponentName: 'Germany',
    options: ['attack', 'balanced', 'defend'].map(id => ({ id, label: id, description: 'Approach', strength: 84, bonus: 0, support: 0, drama: 6, baseDrama: 6 })) };
  assert.equal(parseCampaign(saved(state)).tacticalChoice.dId, '276');
});

test('numeric penalty results and player evidence survive a campaign checkpoint', () => withStorage(() => {
  const state = checkpoint();
  const player = state.teams['276'].squad[0];
  const mark = id => ({ name: state.teams[id].name, score: 1, eff: '80.0', id });
  state.history = [{ id: 'match-1', aId: '250', dId: '276', winnerId: '250', a: mark('250'), b: mark('276'),
    events: [], kicks: { a: [1, 0, 1, 1, 1], b: [1, 0, 1, 0] },
    result: { title: 'France wins on penalties', player: { ...player }, strengthBefore: 80, strengthAfter: 81, strengthGain: 1 } }];
  assert.equal(writeSave(state).ok, true, 'the simulator records scored/missed penalties as 1/0');
  assert.deepEqual(loadSave().history[0].kicks, state.history[0].kicks);
  assert.deepEqual(loadSave().history[0].result.player.sourceInfo, player.sourceInfo);
  state.history[0].kicks.a = [true, false];
  assert.deepEqual(parseCampaign(saved(state)).history[0].kicks.a, [true, false], 'legacy boolean kicks remain valid');
  for (const invalid of [2, 'scored', null]) {
    state.history[0].kicks.a = [invalid];
    assert.throws(() => parseCampaign(saved(state)), /match history is incomplete/);
  }
}));

test('damaged current save is retained and offers the last valid checkpoint', () => withStorage(({ storage }) => {
  const state = checkpoint(), first = writeSave(state);
  Object.assign(state, first); state.round = 2;
  assert.equal(writeSave(state).ok, true);
  storage.setItem(SAVE_KEY, '{damaged');
  const inspection = inspectSave();
  assert.equal(inspection.state, 'recovery'); assert.equal(inspection.raw, '{damaged');
  assert.equal(inspection.backup.round, 1); assert.match(inspection.message, /previous checkpoint/);
  assert.equal(loadSave(), null); assert.equal(storage.getItem(SAVE_KEY), '{damaged');
  const restored = forkCampaign(inspection.backup, 'Recovered France');
  assert.equal(writeSave(restored).ok, true);
  assert.equal(loadSave().campaignName, 'Recovered France');
  assert.equal(storage.getItem(CAMPAIGN_DAMAGED_KEY), '{damaged', 'damaged bytes survive recovery');
  assert.equal(loadCampaign(state.campaignId).round, 2, 'recovering never overwrites the old slot');
}));

test('missing and unreadable browser storage are distinct from a damaged checkpoint', () => withStorage(({ storage }) => {
  assert.equal(inspectSave().state, 'missing');
  storage.setItem(SAVE_KEY, '{}'); storage.setItem(CAMPAIGN_BACKUP_KEY, '{}');
  assert.equal(inspectSave().state, 'recovery'); assert.equal(inspectSave().backup, null);
  storage.getItem = () => { throw new Error('blocked'); };
  assert.equal(inspectSave().state, 'unavailable');
}));

test('named slots survive starting, renaming, loading and discarding a resume pointer', () => withStorage(() => {
  const first = checkpoint(), second = forkCampaign(first, 'Germany experiment');
  Object.assign(first, writeSave(first));
  Object.assign(second, writeSave(second));
  assert.equal(listCampaigns().length, 2);
  assert.equal(loadCampaign(first.campaignId).campaignName, 'France campaign');
  const renamed = renameCampaign(first.campaignId, 'French comeback');
  assert.equal(renamed.ok, true); assert.equal(renamed.revision, 2);
  assert.equal(loadCampaign(first.campaignId).campaignName, 'French comeback');
  assert.equal(loadCampaign(second.campaignId).campaignName, 'Germany experiment');
  assert.equal(loadSave().campaignId, second.campaignId, 'renaming an inactive run does not switch quick resume');
  assert.equal(clearSave(), true); assert.equal(loadSave(), null);
  assert.equal(listCampaigns().length, 2, 'discarding does not delete named runs');
}));

test('a damaged named slot can recover its own previous checkpoint', () => withStorage(({ storage }) => {
  const state = checkpoint(); Object.assign(state, writeSave(state));
  state.round = 3; Object.assign(state, writeSave(state));
  storage.setItem(campaignStorageKey(state.campaignId), '{broken slot');
  const inspection = inspectCampaign(state.campaignId);
  assert.equal(inspection.state, 'recovery'); assert.equal(inspection.raw, '{broken slot');
  assert.equal(inspection.backup.round, 1);
  assert.equal(listCampaigns()[0].damaged, true);
}));

test('two independent tabs cannot overwrite each other and can fork a stale campaign', () => withStorage(({ storage }) => {
  const state = checkpoint(); Object.assign(state, writeSave(state));
  const tabOne = loadCampaign(state.campaignId), tabTwo = loadCampaign(state.campaignId);
  tabOne.round = 7; Object.assign(tabOne, writeSave(tabOne));
  const current = storage.getItem(campaignStorageKey(state.campaignId));
  tabTwo.round = 4;
  const conflict = writeSave(tabTwo);
  assert.equal(conflict.ok, false); assert.equal(conflict.conflict.round, 7);
  assert.equal(storage.getItem(campaignStorageKey(state.campaignId)), current);
  assert.equal(detectSaveConflict(tabTwo).round, 7);
  assert.equal(detectSaveConflict(tabOne), null);
  const fork = forkCampaign(tabTwo, 'My tab'); Object.assign(fork, writeSave(fork));
  assert.notEqual(fork.campaignId, state.campaignId);
  assert.equal(loadCampaign(fork.campaignId).round, 4); assert.equal(loadCampaign(state.campaignId).round, 7);
  assert.equal(isCampaignStorageEvent({ key: campaignStorageKey(state.campaignId) }, state.campaignId), true);
  assert.equal(isCampaignStorageEvent({ key: campaignStorageKey(fork.campaignId) }, state.campaignId), false);
}));

test('version-one saves retain squads/ownership and migrate manager identity safely', () => {
  const state = checkpoint(), legacy = campaignSnapshot(state);
  legacy.v = 1; delete legacy.campaignId; delete legacy.revision; delete legacy.seed; delete legacy.rngState;
  delete legacy.managedTeamId;
  const migrated = parseCampaign(JSON.stringify(legacy));
  assert.equal(migrated.legacy, true); assert.equal(migrated.seed, 1);
  assert.equal(migrated.managedTeamId, '250'); assert.deepEqual(migrated.teams, legacy.teams);
});

test('starting a new campaign archives the old singleton instead of overwriting its only copy', () => withStorage(({ storage }) => {
  const legacy = campaignSnapshot(checkpoint()); legacy.v = 1;
  delete legacy.campaignId; delete legacy.revision;
  storage.setItem(SAVE_KEY, JSON.stringify(legacy));
  const next = checkpoint(); next.campaignName = 'Fresh campaign';
  assert.equal(writeSave(next).ok, true);
  const slots = listCampaigns(); assert.equal(slots.length, 2);
  const archived = loadCampaign(slots.find(item => item.id !== next.campaignId).id);
  assert.deepEqual(archived.own, legacy.own); assert.deepEqual(archived.teams, legacy.teams);
}));

// ---------- v3: turn order × targeting (DEC D8, PLAN §3.2) ----------
function turnCheckpoint() {
  const state = checkpoint();
  state.teams['380'] = buildTeam('380', makeRng(9), getSport('football')); // eliminated, still known
  state.settings = { ...state.settings, turnOrder: 'round-robin', targeting: 'player' };
  state.initialSettings = { ...state.settings };
  state.turnQueue = ['276', '380', '250']; state.turnIndex = 3;
  state.pendingTarget = { attackerId: '250', optionIds: ['276'], selectedId: '276', round: 1, openedAt: 1_700_000_000_000,
    resumeAutoplay: true, turn: { turnQueue: ['276', '380', '250'], turnIndex: 3, round: 1, newRound: false } };
  return state;
}
const tactical = () => ({ aId: '250', dId: '276', managerName: 'France', opponentName: 'Germany',
  options: ['attack', 'balanced', 'defend'].map(id => ({ id, label: id, description: 'Approach', strength: 84, bonus: 0, support: 0, drama: 6, baseDrama: 6 })) });

test('v3 checkpoints keep the round-robin queue, the pending target and the locked turn rules', () => withStorage(({ storage }) => {
  assert.equal(SAVE_VERSION, 4);
  const state = turnCheckpoint();
  assert.equal(writeSave(state).ok, true);
  assert.equal(JSON.parse(storage.getItem(SAVE_KEY)).v, SAVE_VERSION);
  const loaded = loadSave();
  assert.equal(loaded.v, SAVE_VERSION); assert.equal(loaded.legacy, false);
  assert.deepEqual(loaded.turnQueue, state.turnQueue); assert.equal(loaded.turnIndex, 3);
  assert.deepEqual(loaded.pendingTarget, state.pendingTarget);
  assert.deepEqual([loaded.settings.turnOrder, loaded.settings.targeting], ['round-robin', 'player']);
  assert.deepEqual(loaded.initialSettings, state.initialSettings);
  // A pending target may follow an applied match, and a target turn may be absent (random order).
  state.match = { ...match(), applied: true }; state.pendingTarget = { ...state.pendingTarget, turn: null };
  delete state.pendingTarget.openedAt; delete state.pendingTarget.resumeAutoplay;
  assert.equal(parseCampaign(saved(state)).pendingTarget.turn, null);
  state.pendingTarget = null; state.turnQueue = []; state.turnIndex = 0;
  assert.deepEqual(parseCampaign(saved(state)).turnQueue, []);
}));

test('version-two saves still load, as the random draw with compass targets', () => {
  const v2 = campaignSnapshot(checkpoint()); v2.v = 2;
  for (const key of ['turnQueue', 'turnIndex', 'pendingTarget']) delete v2[key];
  const migrated = parseCampaign(JSON.stringify(v2));
  assert.equal(migrated.v, SAVE_VERSION); assert.equal(migrated.legacy, false);
  assert.deepEqual([migrated.turnQueue, migrated.turnIndex, migrated.pendingTarget], [[], 0, null]);
  assert.deepEqual([migrated.settings.turnOrder, migrated.settings.targeting], ['random', 'compass']);
  assert.equal(migrated.settings.pacing, 'duel', 'other settings are untouched');
  assert.equal(migrated.initialSettings, undefined);
  const withInitial = { ...v2, initialSettings: { ...v2.settings } };
  assert.equal(parseCampaign(JSON.stringify(withInitial)).initialSettings.turnOrder, 'random');
  for (const version of [2, 3, 4]) {
    const missing = { ...v2, v: version }; delete missing.rngState;
    assert.throws(() => parseCampaign(JSON.stringify(missing)), /random state/, `v${version} still requires the RNG state`);
  }
  for (const version of [0, 5, '4']) assert.throws(() => parseCampaign(JSON.stringify({ ...v2, v: version })), /not a supported/);
  const v1 = { ...v2, v: 1 }; delete v1.seed; delete v1.rngState;
  assert.equal(parseCampaign(JSON.stringify(v1)).legacy, true, 'v1 saves keep loading without a seed');
});

test('strict import rejects malformed turn order, pending targets and overlapping decisions', () => withStorage(({ storage }) => {
  const state = turnCheckpoint();
  assert.equal(writeSave(state).ok, true);
  const good = storage.getItem(SAVE_KEY);
  const variants = [
    [s => { s.turnQueue = ['250', 'missing']; }, /turn order/],
    [s => { s.turnQueue = 'abc'; }, /turn order/],
    [s => { s.turnQueue = Array(201).fill('250'); s.turnIndex = 0; }, /turn order/],
    [s => { s.turnIndex = 4; }, /turn position/],
    [s => { s.turnIndex = -1; }, /turn position/],
    [s => { s.turnIndex = 1.5; }, /turn position/],
    [s => { s.turnQueue = null; s.turnIndex = 2; }, /turn position/],
    [s => { s.settings.turnOrder = 'swiss'; }, /turnOrder setting/],
    [s => { s.initialSettings.targeting = 'auto'; }, /targeting setting/],
    [s => { s.pendingTarget = 'yes'; }, /target choice references/],
    [s => { s.pendingTarget.attackerId = 'missing'; }, /target choice references/],
    [s => { s.pendingTarget.attackerId = '380'; }, /target choice references/],
    [s => { s.pendingTarget.optionIds = []; }, /target choice references/],
    [s => { s.pendingTarget.optionIds = '276'; }, /target choice references/],
    [s => { s.pendingTarget.optionIds = ['250']; s.pendingTarget.selectedId = '250'; }, /target choice references/],
    [s => { s.pendingTarget.optionIds = ['276', '380']; }, /target choice references/],
    [s => { s.pendingTarget.optionIds = ['276', '276']; }, /target choice references/],
    [s => { s.pendingTarget.selectedId = '380'; }, /target choice references/],
    [s => { s.pendingTarget.selectedId = null; }, /target choice references/],
    [s => { s.pendingTarget.round = -1; }, /target choice references/],
    [s => { delete s.pendingTarget.round; }, /target choice references/],
    [s => { s.pendingTarget.openedAt = 'now'; }, /target choice is incomplete/],
    [s => { s.pendingTarget.resumeAutoplay = 1; }, /target choice is incomplete/],
    [s => { s.pendingTarget.turn = { ...s.pendingTarget.turn, turnIndex: 9 }; }, /target choice is incomplete/],
    [s => { s.pendingTarget.turn = { ...s.pendingTarget.turn, turnQueue: ['missing'], turnIndex: 0 }; }, /target choice is incomplete/],
    [s => { s.pendingTarget.turn = { ...s.pendingTarget.turn, newRound: null }; }, /target choice is incomplete/],
    [s => { s.pendingTarget.turn = ['276']; }, /target choice is incomplete/],
    [s => { s.match = match(); }, /overlaps another pending decision/],
    [s => { s.spin = { attackerId: '250', targetId: '276', rotation: 0, x: 0, y: 0, targetX: 1, targetY: 1, spinMs: 0, holdMs: 480 }; }, /overlaps/],
    [s => { s.tacticalChoice = tactical(); }, /overlaps/],
  ];
  for (const [mutate, expected] of variants) {
    const invalid = structuredClone(state); mutate(invalid);
    assert.throws(() => parseCampaign(saved(invalid)), expected);
    assert.equal(storage.getItem(SAVE_KEY), good);
  }
}));

test('a saved signing selection must be one of the offered candidates', () => {
  const state = checkpoint(); state.match = match();
  const squad = state.teams['276'].squad;
  state.choice = { candidates: [{ ...squad[0], index: 0, gain: .3 }, { ...squad[1], index: 1, gain: .1 }], selected: 1,
    winnerName: 'France', loserName: 'Germany' };
  assert.equal(parseCampaign(saved(state)).choice.selected, 1);
  delete state.choice.selected;
  assert.equal(parseCampaign(saved(state)).choice.selected, undefined, 'older saves have no selection');
  for (const selected of [2, '1', -1, 0.5]) {
    state.choice.selected = selected;
    assert.throws(() => parseCampaign(saved(state)), /signing selection/);
  }
});

// ---------- country checkpoints, full storage and deletion ----------

const FM_SOURCE = { edition: 'FM 26', version: '26.3.0', snapshotDate: '2026-10-18' };

/** A small country campaign with FM-sourced squads, one transfer and its records. */
function domesticCheckpoint() {
  const sport = getSport('football');
  const clubs = ['Alpha Football Club', 'Beta United', 'Gamma Town'].map((name, c) => buildClub({
    id: `d826-${100 + c}`, name, code: ['ALP', 'BET', 'GAM'][c], league: 'Premier League', col: '#336699', str: 70,
    homeSection: `826-00${c + 1}`,
    squad: Array.from({ length: 12 }, (_, i) => expandFmTuple([1000 * (c + 1) + i, `Player ${c}-${i}`, 55 + i * 3,
      i ? (i % 3 ? 'cm,am' : 'st,lw') : 'gk', i % 2 ? 'ENG' : undefined], FM_SOURCE, name)),
  }, sport));
  const teams = Object.fromEntries(clubs.map(team => [team.id, team]));
  const [a, b, c] = clubs;
  const taken = { ...c.squad[5], from: c.code };
  a.squad.push(taken);
  c.squad.splice(5, 1);
  const replaced = { ...a.squad[3], originalIndex: 3, assignedPos: 'MF', effectiveRating: 64, outOfPosition: false };
  const settings = { sport: 'football', layer: 'clubs', clubScope: 'domestic:826', domesticVersion: '826-0a1b2c3d',
    pacing: 'duel', resolution: 'instant', role: 'spectator' };
  const result = { title: 'ALPHA ANNEXES GAMMA', winnerId: a.id, loserId: c.id, player: { ...taken }, replacedPlayer: replaced,
    strengthBefore: 70, strengthAfter: 71, strengthGain: 1, territoryNames: ['Gamma'], territoryIds: ['826-003'] };
  const mark = team => ({ id: null, tid: team.id, code: team.code, name: team.name, color: team.col, score: '1', eff: '70.0' });
  return { phase: 'playing', settings, initialSettings: { ...settings }, teams,
    own: { '826-001': a.id, '826-002': b.id, '826-003': a.id }, aliveIds: [a.id, b.id], fallen: [{ id: c.id, r: 1 }],
    stats: {}, round: 1, matches: 1, queue: [], log: [], seed: 7, rngState: 7, conquestIds: ['826-003'],
    history: [{ id: 'match-1', aId: a.id, dId: c.id, winnerId: a.id, a: mark(a), b: mark(c), events: [], result }],
    match: { aId: a.id, dId: c.id, winner: a.id, finalGa: 1, finalGd: 0, effA: 70, effD: 69, ga: 1, gd: 0, allEv: [], shown: [],
      applied: true, done: true, playerTaken: { ...taken }, replacedPlayer: replaced, territoryIds: ['826-003'] },
    campaignId: createCampaignId(), revision: 0, campaignName: 'England campaign', metrics: { acquisitions: [], leaderChanges: 0 },
    spin: null, choice: null, series: null, tacticalChoice: null };
}

const plain = value => JSON.parse(JSON.stringify(value));

test('country checkpoints pack FM players and rebuild them exactly; world checkpoints are unchanged', () => withStorage(() => {
  const state = domesticCheckpoint(), snapshot = campaignSnapshot(state);
  const full = JSON.stringify(snapshot), text = serializeCampaign(snapshot), stored = JSON.parse(text);
  assert.ok(stored.playerPack && Array.isArray(stored.playerPack.clubs), 'one shared player header');
  assert.ok(Object.values(stored.teams).every(team => team.squad.every(Array.isArray)), 'every squad player is packed');
  assert.ok(Array.isArray(stored.history[0].result.player) && Array.isArray(stored.match.playerTaken));
  assert.ok(text.length * 3 < full.length, `${text.length} packed vs ${full.length} full`);
  const restored = parseCampaign(text);
  assert.equal(restored.playerPack, undefined);
  for (const key of ['teams', 'history', 'match', 'own']) assert.deepEqual(plain(restored[key]), plain(snapshot[key]), key);
  assert.equal(restored.teams['d826-100'].squad.at(-1).from, 'GAM', 'a transfer keeps its origin');
  assert.equal(restored.teams['d826-100'].squad.at(-1).sourceInfo.club, 'Gamma Town', 'and its original club');

  // A record that would not rebuild exactly is stored in full.
  const odd = domesticCheckpoint();
  odd.teams['d826-101'].squad[0].sourceInfo.url = 'https://example.org/player';
  const oddText = serializeCampaign(campaignSnapshot(odd));
  assert.equal(Array.isArray(JSON.parse(oddText).teams['d826-101'].squad[0]), false);
  assert.deepEqual(plain(parseCampaign(oddText).teams), plain(campaignSnapshot(odd).teams));

  // Saved and exported through the normal paths.
  assert.equal(writeSave(state).ok, true);
  assert.deepEqual(plain(loadCampaign(state.campaignId).teams), plain(snapshot.teams));
  assert.deepEqual(plain(parseCampaign(exportCampaign(state)).teams), plain(snapshot.teams));

  const world = campaignSnapshot(checkpoint());
  assert.equal(serializeCampaign(world), JSON.stringify(world), 'a world campaign\'s portable text is its plain snapshot');
  assert.equal(serializeCampaign(world, 2), JSON.stringify(world, null, 2));
}));

test('a damaged packed squad is rejected before it can replace anything', () => {
  const stored = JSON.parse(serializeCampaign(campaignSnapshot(domesticCheckpoint())));
  for (const mutate of [
    s => { s.teams['d826-101'].squad[0][5] = 99; },
    s => { s.teams['d826-101'].squad[0][3] = 'constructor'; },
    s => { s.teams['d826-101'].squad[0][2] = 0; },
    s => { s.teams['d826-101'].squad[0].push('extras'); },
    s => { s.playerPack.clubs = 'Alpha'; },
    s => { delete s.playerPack.source.version; },
  ]) {
    const copy = structuredClone(stored); mutate(copy);
    assert.throws(() => parseCampaign(JSON.stringify(copy)), /squads are incomplete/);
  }
});

/** Browser-like storage: key + value length count against the quota, and a write over it throws. */
function withQuota(run) {
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'localStorage'), items = new Map();
  let used = 0;
  const size = (key, value) => key.length + value.length;
  const storage = {
    quota: Infinity,
    get used() { return used; },
    getItem: key => items.get(key) ?? null,
    setItem(key, value) {
      value = String(value);
      const next = used - (items.has(key) ? size(key, items.get(key)) : 0) + size(key, value);
      if (next > storage.quota) { const error = new Error('The quota has been exceeded.'); error.name = 'QuotaExceededError'; throw error; }
      items.set(key, value); used = next;
    },
    removeItem(key) { if (items.has(key)) { used -= size(key, items.get(key)); items.delete(key); } },
  };
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  try { run({ storage, items }); } finally {
    if (prior) Object.defineProperty(globalThis, 'localStorage', prior); else delete globalThis.localStorage;
  }
}
/** A campaign whose checkpoint is a little over `chars` long. */
function sized(name, chars) {
  const state = checkpoint();
  state.campaignName = name;
  state.log = [{ t: 'sys', r: 0, txt: 'x'.repeat(chars) }];
  return state;
}
const backupOf = id => `${campaignStorageKey(id)}:backup`;

test('full storage never deletes another campaign’s recovery copy, and a failed save changes nothing', () => withQuota(({ storage, items }) => {
  const damaged = sized('Damaged', 20_000), other = sized('Other', 20_000);
  Object.assign(damaged, writeSave(damaged)); Object.assign(damaged, writeSave(damaged));
  Object.assign(other, writeSave(other)); Object.assign(other, writeSave(other));
  storage.setItem(campaignStorageKey(damaged.campaignId), '{damaged slot');
  assert.equal(inspectCampaign(damaged.campaignId).state, 'recovery');
  const before = new Map(items);
  storage.quota = storage.used + 5_000;
  const big = sized('Big', 30_000), result = writeSave(big);
  assert.equal(result.ok, false); assert.equal(result.quota, true);
  assert.match(result.message, /storage is full.*Saved campaigns/);
  assert.deepEqual(new Map(items), before, 'nothing was written or removed');
  assert.ok(inspectCampaign(damaged.campaignId).backup, 'the damaged campaign keeps its only readable copy');
  assert.ok(items.has(backupOf(other.campaignId)));
  // With room for the new checkpoint the save succeeds, and the other copies stay.
  storage.quota = storage.used + 70_000;
  assert.equal(writeSave(big).ok, true);
  assert.ok(items.has(backupOf(damaged.campaignId)) && items.has(backupOf(other.campaignId)));
}));

test('when only its own recovery copy is in the way, a campaign saves without it and says so', () => withQuota(({ storage, items }) => {
  const other = sized('Other', 20_000), state = sized('Growing', 20_000);
  Object.assign(other, writeSave(other)); Object.assign(other, writeSave(other));
  Object.assign(state, writeSave(state)); Object.assign(state, writeSave(state));
  assert.ok(items.has(backupOf(state.campaignId)));
  storage.quota = storage.used + 8_000;
  state.log = [{ t: 'sys', r: 0, txt: 'y'.repeat(40_000) }];
  const result = writeSave(state);
  assert.equal(result.ok, true);
  assert.match(result.message, /without a recovery copy.*Saved campaigns/);
  assert.equal(items.has(backupOf(state.campaignId)), false, 'its own copy made room');
  assert.ok(items.has(backupOf(other.campaignId)), 'another campaign’s copy is untouched');
  assert.equal(loadCampaign(state.campaignId).revision, result.revision);
}));

test('a save that runs out of room part-way leaves no slot ahead of the game, so the next save is no false conflict', () => withQuota(({ storage, items }) => {
  const small = sized('Small', 1_000);
  Object.assign(small, writeSave(small));
  const big = sized('Big', 40_000);
  // The new slot would fit; the quick-resume copy of it would not.
  storage.quota = storage.used + 45_000;
  const before = new Map(items);
  const failed = writeSave(big);
  assert.equal(failed.ok, false); assert.equal(failed.quota, true);
  assert.deepEqual(new Map(items), before, 'slot, list and pointer are all as they were');
  assert.equal(listCampaigns().some(item => item.damaged), false, 'no list entry without a slot');
  storage.quota = Infinity;
  const retried = writeSave(big);
  assert.equal(retried.ok, true, retried.message); assert.equal(retried.revision, 1);
  assert.equal(retried.conflict, undefined);
}));

test('a damaged resume pointer goes through the same all-or-nothing save', () => withQuota(({ storage, items }) => {
  storage.setItem(SAVE_KEY, '{damaged pointer' + 'z'.repeat(30_000));
  const state = sized('Fresh', 5_000);
  storage.quota = storage.used + 12_000;
  const before = new Map(items);
  const result = writeSave(state);
  assert.equal(result.ok, false); assert.equal(result.quota, true, 'reported as full storage, not a generic failure');
  assert.deepEqual(new Map(items), before);
  storage.quota = Infinity;
  assert.equal(writeSave(state).ok, true);
  assert.match(storage.getItem(CAMPAIGN_DAMAGED_KEY), /^\{damaged pointer/, 'the damaged bytes are kept once the pointer moves on');
}));

test('deleting a campaign removes its checkpoint, recovery copy, list entry and quick resume', () => withQuota(({ storage, items }) => {
  const keep = sized('Keep', 2_000), gone = sized('Gone', 2_000);
  Object.assign(keep, writeSave(keep)); Object.assign(keep, writeSave(keep));
  Object.assign(gone, writeSave(gone)); Object.assign(gone, writeSave(gone));
  assert.equal(loadSave().campaignId, gone.campaignId);
  const used = storage.used;
  assert.equal(deleteCampaign(gone.campaignId).ok, true);
  for (const key of [campaignStorageKey(gone.campaignId), backupOf(gone.campaignId), SAVE_KEY]) assert.equal(items.has(key), false, key);
  assert.notEqual(JSON.parse(items.get(CAMPAIGN_BACKUP_KEY) || 'null')?.campaignId, gone.campaignId);
  assert.deepEqual(listCampaigns().map(item => item.id), [keep.campaignId]);
  assert.ok(storage.used < used / 2, 'its space is free again');
  assert.equal(loadCampaign(keep.campaignId).revision, 2);
  assert.ok(items.has(backupOf(keep.campaignId)));
}));

test('a save from another build of a country map moves club by club, or is refused and kept', () => {
  const state = parseCampaign(serializeCampaign(campaignSnapshot(domesticCheckpoint())));
  const names = { '826-001': 'One', '826-002': 'Two', '826-003': 'Three' };
  const build = (version, homes) => ({ meta: { name: 'England', version }, sectionNames: names,
    clubs: Object.entries(homes).map(([id, homeSection]) => ({ id, homeSection })) });
  const same = build('826-0a1b2c3d', { 'd826-100': '826-001', 'd826-101': '826-002', 'd826-102': '826-003' });
  assert.equal(fitDomesticCampaign(state, same).campaign, state, 'the same build resumes as saved');
  // A rebuild that reorders the clubs: each club's land and its holder follow the club.
  const reordered = build('826-99999999', { 'd826-100': '826-003', 'd826-101': '826-001', 'd826-102': '826-002' });
  const { campaign: moved } = fitDomesticCampaign(state, reordered);
  assert.deepEqual(moved.own, { '826-003': 'd826-100', '826-001': 'd826-101', '826-002': 'd826-100' });
  assert.deepEqual(Object.values(moved.teams).map(team => team.home), ['826-003', '826-001', '826-002']);
  assert.deepEqual(moved.conquestIds, ['826-002']);
  assert.deepEqual(moved.match.territoryIds, ['826-002']);
  assert.deepEqual(moved.history[0].result.territoryIds, ['826-002']);
  assert.equal(state.own['826-001'], 'd826-100', 'the save itself is untouched');
  const missing = fitDomesticCampaign(state, build('826-99999999', { 'd826-100': '826-001', 'd826-101': '826-002', 'd826-777': '826-003' }));
  assert.match(missing.error, /no longer matches the map of England: 1 of its clubs is not on the updated map.*save is kept/);
  const added = fitDomesticCampaign(state, build('826-99999999',
    { 'd826-100': '826-001', 'd826-101': '826-002', 'd826-102': '826-003', 'd826-103': '826-004' }));
  assert.match(added.error, /the updated map adds 1 club it never had/);
  const lost = fitDomesticCampaign(state, { ...same, sectionNames: { '826-001': 'One', '826-002': 'Two' } });
  assert.match(lost.error, /1 of its sections is missing/);
});

// ---------- v4: bundled roster sources stored by id ----------
/** Every kind of saved player copy: squads, and a claimed and a replaced player in history and the match. */
function sourcedCheckpoint() {
  const state = checkpoint();
  const claimed = state.teams['276'].squad[0], replaced = state.teams['250'].squad[1];
  const mark = id => ({ name: state.teams[id].name, score: 1, eff: '80.0', id });
  state.history = [{ id: 'match-1', aId: '250', dId: '276', winnerId: '250', a: mark('250'), b: mark('276'), events: [],
    result: { title: 'France annexes Germany', player: { ...claimed, from: 'GER', fromId: '276', joined: 1 },
      replacedPlayer: { ...replaced, originalIndex: 1 } } }];
  state.match = { ...match(), playerTaken: { ...claimed }, replacedPlayer: { ...replaced, originalIndex: 1 } };
  return state;
}
const SOURCED = ['teams', 'history', 'match'];
const inlineSources = text => (text.match(/"sourceInfo":\s*\{/g) || []).length;

test('v4 checkpoints store bundled roster sources by id and rebuild them exactly', () => withStorage(({ storage }) => {
  const state = sourcedCheckpoint(), squad = state.teams['250'].squad;
  assert.ok(squad.length >= 11 && squad.every(player => typeof player.sourceInfo?.id === 'string'), 'the fixture squads are sourced');
  assert.equal(writeSave(state).ok, true);
  const text = storage.getItem(SAVE_KEY), stored = JSON.parse(text);
  assert.equal(stored.v, 4);
  assert.equal(inlineSources(text), 0, 'no copy of a bundled source is stored inline');
  assert.equal(stored.teams['250'].squad[0].sourceInfo, squad[0].sourceInfo.id);
  assert.equal(stored.history[0].result.player.sourceInfo, state.teams['276'].squad[0].sourceInfo.id);
  assert.equal(stored.match.replacedPlayer.sourceInfo, squad[1].sourceInfo.id);
  assert.ok(text.length < saved(state).length * 0.6, 'sources were most of the checkpoint');
  const loaded = loadSave();
  for (const key of SOURCED) assert.deepEqual(loaded[key], plain(state[key]), `${key} rebuilt from the roster`);
  assert.equal(JSON.stringify(loaded.teams), JSON.stringify(state.teams), 'in the same key order (squads are compared as JSON)');
  // Each load gets its own copies: changing one never reaches the bundled roster or the next load.
  loaded.teams['250'].squad[0].sourceInfo.positions.push('GK');
  assert.deepEqual(loadSave().teams['250'].squad[0].sourceInfo, plain(squad[0].sourceInfo));
}));

test('v3 saves load with inline sources and move to references on their next checkpoint', () => withStorage(({ storage }) => {
  const state = sourcedCheckpoint();
  const v3 = JSON.stringify({ ...campaignSnapshot(state), v: 3 }); // v3 stored every source inline
  storage.setItem(campaignStorageKey(state.campaignId), v3); storage.setItem(SAVE_KEY, v3);
  const loaded = loadSave();
  assert.equal(loaded.v, SAVE_VERSION);
  for (const key of SOURCED) assert.deepEqual(loaded[key], plain(state[key]), `v3 ${key} unchanged`);
  const result = writeSave(loaded);
  assert.equal(result.ok, true); assert.equal(result.conflict, undefined); assert.equal(result.revision, 1);
  const text = storage.getItem(SAVE_KEY);
  assert.equal(JSON.parse(text).v, 4); assert.equal(inlineSources(text), 0);
  assert.ok(text.length < v3.length * 0.6);
  assert.equal(storage.getItem(backupOf(state.campaignId)), v3, 'the v3 bytes remain the recovery copy');
  for (const key of SOURCED) assert.deepEqual(loadSave()[key], plain(state[key]), `migrated ${key} unchanged`);
}));

test('sources the bundle does not hold stay inline; a reference the bundle lost loads without a source', () => withStorage(({ storage }) => {
  const state = checkpoint(), squad = state.teams['250'].squad;
  squad[0] = { ...squad[0], sourceInfo: { ...squad[0].sourceInfo, snapshotDate: '2024-09-19' } }; // another roster snapshot
  squad[1] = { ...squad[1], sourceInfo: { id: 'custom:1', fullName: 'Imported player' } };
  assert.equal(writeSave(state).ok, true);
  const stored = JSON.parse(storage.getItem(SAVE_KEY));
  assert.deepEqual(stored.teams['250'].squad.slice(0, 2).map(player => player.sourceInfo), plain([squad[0].sourceInfo, squad[1].sourceInfo]));
  assert.equal(typeof stored.teams['250'].squad[2].sourceInfo, 'string');
  assert.deepEqual(loadSave().teams, plain(state.teams));
  // A later roster update that drops a player keeps them in the squad, without source evidence.
  stored.teams['250'].squad[2].sourceInfo = 'ea:0';
  const kept = parseCampaign(JSON.stringify(stored)).teams['250'].squad[2];
  assert.equal(kept.name, squad[2].name); assert.equal(kept.rating, squad[2].rating); assert.equal(kept.id, squad[2].id);
  assert.equal(Object.hasOwn(kept, 'sourceInfo'), false);
}));

test('exports keep every source inline and import back to the same campaign', () => {
  const state = sourcedCheckpoint(), text = exportCampaign(state);
  assert.equal(JSON.parse(text).v, SAVE_VERSION);
  assert.ok(inlineSources(text) >= state.teams['250'].squad.length, 'a file can outlive the bundled roster');
  const imported = parseCampaign(text);
  for (const key of SOURCED) assert.deepEqual(imported[key], plain(state[key]));
});

test('a country checkpoint packs its FM players first; a bundled roster player in it is stored by reference', () => withStorage(({ storage }) => {
  const state = domesticCheckpoint(), rostered = checkpoint().teams['250'].squad[0];
  state.teams['d826-101'].squad.push({ ...rostered });
  assert.equal(writeSave(state).ok, true);
  const text = storage.getItem(SAVE_KEY), stored = JSON.parse(text);
  assert.ok(stored.playerPack, 'FM players are still packed');
  assert.ok(stored.teams['d826-100'].squad.every(Array.isArray));
  assert.equal(stored.teams['d826-101'].squad.at(-1).sourceInfo, rostered.sourceInfo.id);
  assert.equal(inlineSources(text), 0);
  assert.deepEqual(plain(loadSave().teams), plain(campaignSnapshot(state).teams));
}));

test('a damaged campaign index is rebuilt from the slots: saves go on and every campaign stays listed', () => {
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'localStorage'), items = new Map();
  // A real Storage enumerates its keys; the index rebuild needs that.
  const storage = { getItem: key => items.get(key) ?? null, setItem: (key, value) => items.set(key, String(value)),
    removeItem: key => items.delete(key), key: i => [...items.keys()][i] ?? null, get length() { return items.size; } };
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  try {
    const first = checkpoint(), second = { ...checkpoint(), campaignId: createCampaignId(), campaignName: 'Second' };
    assert.equal(writeSave(first).ok, true);
    assert.equal(writeSave(second).ok, true);
    for (const damage of ['{not json', '{"a":1}']) {
      storage.setItem(`${SAVE_KEY}:campaigns`, damage);
      assert.deepEqual(listCampaigns().map(item => item.name).sort(), ['France campaign', 'Second']);
      const again = writeSave({ ...second, revision: loadCampaign(second.campaignId).revision });
      assert.equal(again.ok, true, `autosave works over a damaged index: ${again.message}`);
      assert.deepEqual(JSON.parse(storage.getItem(`${SAVE_KEY}:campaigns`)).map(item => item.id).sort(),
        [first.campaignId, second.campaignId].sort(), 'the save writes a repaired index');
    }
  } finally {
    if (prior) Object.defineProperty(globalThis, 'localStorage', prior); else delete globalThis.localStorage;
  }
});
