// Domestic campaigns: one country's top clubs fight over its own sections. Plays
// seeded campaigns on the shipped England map with the real engine rules (draws,
// match model, acquisitions, saves), and kicks off every other shipped country.
// No React; the jsdom smoke covers the UI.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DOMESTIC } from '../src/data/domestic.js';
import { decodeDomestic, domesticScope, domesticSurroundings } from '../src/engine/domestic.js';
import { buildClub, makeRng, selectLineup, squadAverage, teamEff } from '../src/data/teams.js';
import { getSport } from '../src/sports/index.js';
import { drawBlitzPairs, drawChaosPairs, territories, validateReachability } from '../src/engine/campaign.js';
import { createDuelDraw } from '../src/engine/duelDraw.js';
import { createAttackRouteIndex, routeLandCrossings } from '../src/engine/attackRoutes.js';
import { automaticAcquisition, recordMatch } from '../src/engine/campaignExperience.js';
import { tacticalMatchParameters } from '../src/engine/managerStrategy.js';
import { UNCERTAINTY_PRESETS } from '../src/engine/odds.js';
import { campaignSnapshot, fitDomesticCampaign, parseCampaign, serializeCampaign } from '../src/engine/storage.js';

const ID = '826';
const entry = DOMESTIC.find(item => item.id === ID);
const raw = JSON.parse(readFileSync(new URL(`../public/domestic/${ID}.json`, import.meta.url), 'utf8'));
const domestic = decodeDomestic(raw, ID);
const { geo, sectionNames } = domestic;
const sport = getSport('football');
const sectionIds = geo.countries.map(country => country.id);
const routeIndex = createAttackRouteIndex(geo.paths);
// Sea routes are legitimate only where land contact is missing: a section with
// no land neighbour, or one with detached parts such as Hampshire's Isle of Wight.
const islandSections = new Set(geo.countries.filter(country => !geo.adj[country.id]?.size || country.polys.length > 1)
  .map(country => country.id));
const SETTINGS = { sport: 'football', layer: 'clubs', scope: 'UEFA', clubScope: domesticScope(ID), domesticVersion: domestic.meta.version,
  pacing: 'duel', resolution: 'instant', preset: 'custom', uncertainty: 'balanced', express: false, finale: 'single',
  role: 'spectator', managedTeamId: '', acquisitionPolicy: 'highest-rated', rosterPreset: 'authentic' };
// Saves pack FM players (storage.js), so a 100-club campaign stays well inside browser storage.
const MAX_CHECKPOINT_BYTES = 500_000;

/** The contract's opening: every club starts alone on its home section. */
function opening() {
  const teams = {}, own = {}, stats = {};
  for (const row of domestic.clubs) {
    const team = buildClub(row, sport);
    team.baseEff = teamEff(team);
    team.baseAvg = squadAverage(team);
    teams[team.id] = team;
    own[team.home] = team.id;
    stats[team.id] = { conq: 0, steals: [] };
  }
  return { teams, own, stats, aliveIds: domestic.clubs.map(club => club.id) };
}

function boardOf(state) {
  return { geo, routingPaths: geo.paths, routeIndex, own: state.own, aliveIds: state.aliveIds };
}

function assertConserved(state, label) {
  const owners = Object.values(state.own);
  assert.deepEqual(Object.keys(state.own).sort(), [...sectionIds].sort(), `${label}: every section stays owned`);
  assert.ok(owners.every(owner => state.aliveIds.includes(owner)), `${label}: only survivors own land`);
  assert.ok(state.aliveIds.every(id => owners.includes(id)), `${label}: every survivor holds land`);
}

/**
 * Independent of pickTarget: the drawn polyline really reaches the announced enemy.
 * `islands` (England's by default) limits sea routes; null skips that rule.
 */
function assertLegalDraw(board, draw, label, { routeIndex = board.routeIndex, islands = islandSections } = {}) {
  assert.ok(draw, `${label}: a placed field always resolves a duel`);
  assert.notEqual(draw.attackerId, draw.targetId);
  assert.ok(board.aliveIds.includes(draw.attackerId) && board.aliveIds.includes(draw.targetId));
  assert.notEqual(draw.routeKind, 'neutral-transit', `${label}: no neutral land, so never a transit treaty`);
  assert.deepEqual([...draw.transitCountryIds], []);
  const crossings = draw.routePoints.slice(1).flatMap((point, i) => routeLandCrossings(routeIndex,
    { ax: draw.routePoints[i][0], ay: draw.routePoints[i][1], bx: point[0], by: point[1] }));
  const foreign = crossings.filter(({ countryId }) => board.own[countryId] !== draw.attackerId);
  assert.ok(foreign.some(({ countryId }) => board.own[countryId] === draw.targetId), `${label}: route reaches the announced enemy`);
  assert.ok(foreign.every(({ countryId }) => board.own[countryId] === draw.targetId), `${label}: route crosses no third club`);
  if (draw.routeKind === 'sea' && islands) {
    const holdsIsland = id => territories(board, id).some(cid => islands.has(cid));
    assert.ok(holdsIsland(draw.attackerId) || holdsIsland(draw.targetId),
      `${label}: a sea route needs an island section on one side (${draw.attackerId} → ${draw.targetId})`);
  }
}

/** The App's match card shape, so saved history has its real size. */
function card(state, match) {
  const mark = (team, score, eff) => ({ teamId: team.id, id: team.flagId, isClub: true, code: team.code, color: team.col,
    name: team.name, eff: eff.toFixed(1), score });
  const a = state.teams[match.aId], b = state.teams[match.dId];
  return {
    round: String(state.round).padStart(3, '0'), mode: state.settings.pacing.toUpperCase(), status: match.status,
    a: mark(a, match.ga, match.effA), b: mark(b, match.gd, match.effD),
    kicks: match.tie ? { a: match.tie.A, b: match.tie.D } : null,
    events: match.allEv.map(e => ({ ...sport.formatEvent(e, state.teams[e.tid].code), color: state.teams[e.tid].col })),
    odds: match.odds, series: null, routeLabel: match.routeLabel,
    result: { title: match.resTitle, text: match.resText, upset: false, winnerId: match.winner,
      loserId: match.winner === match.aId ? match.dId : match.aId, winnerName: match.winnerName, loserName: match.loserName,
      territories: match.territoriesGained, player: match.playerTaken, strengthBefore: match.strengthBefore,
      strengthAfter: match.strengthAfter, strengthGain: match.strengthGained, territoryNames: match.territoryNames,
      territoryIds: match.territoryIds, replacedPlayer: match.replacedPlayer,
      tieText: match.tie ? `${match.tie.ga}–${match.tie.gd} on penalties` : null },
  };
}

/** Play one match and apply the conquest the way App.applyConquest does. */
function playMatch(state, rng, attackerId, defenderId, route = {}) {
  const a = state.teams[attackerId], d = state.teams[defenderId];
  const { effA, effD, drama } = tacticalMatchParameters({ attacker: a, defender: d, managedId: null,
    drama: UNCERTAINTY_PRESETS[state.settings.uncertainty].drama });
  const sim = sport.simulate(rng, a, d, drama, effA, effD);
  assert.ok([attackerId, defenderId].includes(sim.winner), 'every match has a winner');
  const winnerId = sim.winner, loserId = winnerId === attackerId ? defenderId : attackerId;
  const before = { alive: state.aliveIds.length, winnerLand: territories(state, winnerId).length,
    loserLand: territories(state, loserId).length, players: Object.values(state.teams).reduce((n, t) => n + t.squad.length, 0) };

  const W = { ...state.teams[winnerId], squad: state.teams[winnerId].squad.slice() };
  const L = { ...state.teams[loserId], squad: state.teams[loserId].squad.slice() };
  const strengthBefore = teamEff(W), beforeLineup = selectLineup(W);
  const stolen = L.squad[automaticAcquisition(W, L, state.settings.acquisitionPolicy).index];
  W.squad.push({ ...stolen, from: L.code });
  L.squad = L.squad.filter(player => player !== stolen);
  const afterLineup = selectLineup(W);
  const taken = territories(state, loserId);
  const own = { ...state.own };
  for (const cid of taken) own[cid] = winnerId;
  const teams = { ...state.teams, [winnerId]: W, [loserId]: L };
  const completed = { aId: attackerId, dId: defenderId, effA, effD, ga: sim.ga, gd: sim.gd, finalGa: sim.ga, finalGd: sim.gd,
    shown: sim.ev, allEv: sim.ev, tie: sim.tie, tieShown: null, winner: winnerId, status: sport.labels.end,
    applied: true, done: true, odds: { a: .5, b: .5 }, routeLabel: route.routeLabel || '', routeKind: route.routeKind || 'straight',
    resTitle: `${W.name.toUpperCase()} ANNEXES ${L.name.toUpperCase()}`, resText: `+${taken.length} territories`,
    winnerName: W.name, loserName: L.name, territoriesGained: taken.length, territoryIds: taken,
    territoryNames: taken.map(cid => sectionNames[cid]), playerTaken: { ...stolen },
    replacedPlayer: beforeLineup.starters.find(p => !afterLineup.starters.some(q => q.originalIndex === p.originalIndex)) || null,
    strengthBefore, strengthAfter: teamEff(W), strengthGained: Math.round((teamEff(W) - strengthBefore) * 10) / 10 };
  const next = { ...state, teams, own, aliveIds: state.aliveIds.filter(id => id !== loserId), matches: state.matches + 1,
    fallen: [...state.fallen, { id: loserId, r: state.round }], match: completed, spin: null,
    stats: { ...state.stats, [winnerId]: { conq: state.stats[winnerId].conq + 1, steals: [...state.stats[winnerId].steals, stolen.name] } } };
  next.history = [...state.history, recordMatch({ ...state, teams, sport }, completed, card({ ...state, teams }, completed))];
  next.log = [...state.log, { t: 'match', r: state.round, txt: `${a.code} ${sim.ga}–${sim.gd} ${d.code}`, chip: W.col },
    { t: 'elim', r: state.round, txt: `${L.name.toUpperCase()} FALLS — ${taken.length} ANNEXED BY ${W.name.toUpperCase()}`, chip: '#c44' },
    { t: 'steal', r: state.round, txt: `${W.code} CLAIMS ${stolen.name.toUpperCase()} FROM ${L.code}`, chip: '#4cc' }].slice(-220);

  assert.equal(next.aliveIds.length, before.alive - 1, 'exactly one club is eliminated per match');
  assert.ok(!next.aliveIds.includes(loserId) && next.aliveIds.includes(winnerId));
  assert.ok(before.loserLand > 0, 'the loser held land before the match');
  assert.equal(territories(next, loserId).length, 0, 'the loser keeps no section');
  assert.equal(territories(next, winnerId).length, before.winnerLand + before.loserLand, 'the winner annexes everything');
  assert.equal(Object.values(next.teams).reduce((n, t) => n + t.squad.length, 0), before.players, 'one player changes shirts');
  assert.equal(W.squad.length, state.teams[winnerId].squad.length + 1);
  return next;
}

function kickoff(settings) {
  const { teams, own, stats, aliveIds } = opening();
  return { phase: 'playing', settings, initialSettings: settings, teams, own, aliveIds, stats, fallen: [], round: 0, matches: 0,
    queue: [], batchTotal: 0, log: [{ t: 'sys', r: 0, txt: `CAMPAIGN START — ${aliveIds.length} CLUBS · THEATRE: ${entry.name.toUpperCase()}` }],
    history: [], match: null, spin: null, series: null, choice: null, tacticalChoice: null, followedId: null,
    managedTeamId: null, managementEnded: false, managerElimination: null, decisionLedger: [], conquestIds: [],
    metrics: { leaderChanges: 0, acquisitions: [], previousLeader: null }, campaignId: `domestic-${settings.pacing}`, revision: 0,
    campaignName: `Football · ${entry.name} · top ${entry.clubs} clubs`, startedAt: Date.now(), completedAt: null };
}

/** Seeded duel campaign to a champion; every draw and conquest is checked as it happens. */
function playDuelCampaign(seed, { onMatch } = {}) {
  const rng = makeRng(seed);
  let state = { ...kickoff({ ...SETTINGS, seed: String(seed) }), seed, rngState: rng.getState() };
  const routes = { straight: 0, sea: 0, 'neutral-transit': 0 };
  while (state.aliveIds.length > 1) {
    const board = boardOf(state);
    const draw = createDuelDraw(rng, board, { speed: 80 });
    assertLegalDraw(board, draw, `seed ${seed} match ${state.matches + 1}`);
    routes[draw.routeKind] = (routes[draw.routeKind] || 0) + 1;
    state = { ...state, round: state.round + 1, spin: { ...draw, key: state.round + 1, tid: draw.attackerId, stage: 'locked' } };
    onMatch?.(state);
    state = playMatch(state, rng, draw.attackerId, draw.targetId, draw);
    assertConserved(state, `seed ${seed} after match ${state.matches}`);
  }
  return { state: { ...state, rngState: rng.getState(), phase: 'victory', completedAt: Date.now() }, routes };
}

test('the shipped England map matches its generated index and pairs every club with one section', () => {
  assert.ok(entry, 'England is in the generated domestic index');
  assert.equal(domestic.meta.version, entry.version);
  assert.equal(domestic.clubs.length, entry.clubs);
  assert.equal(sectionIds.length, entry.clubs);
  assert.deepEqual(domestic.clubs.map((club, rank) => ({ club, rank })).sort((a, b) => b.club.str - a.club.str || a.rank - b.rank)
    .slice(0, 3).map(({ club }) => club.name), entry.top, 'the index names the three strongest clubs');
  const { teams, own, aliveIds } = opening();
  assert.equal(new Set(Object.values(own)).size, entry.clubs, 'no section is double-booked');
  assert.deepEqual(Object.keys(own).sort(), [...sectionIds].sort(), 'every section starts owned');
  for (const id of aliveIds) {
    assert.ok(sectionIds.includes(teams[id].home), `${teams[id].name} starts on a real section`);
    assert.equal(own[teams[id].home], id);
    assert.deepEqual(territories({ own }, id), [teams[id].home], `${teams[id].name} holds exactly its home section`);
    assert.equal(teams[id].kind, 'club');
    assert.equal(teams[id].flagId, null);
    assert.match(teams[id].code, /^[A-Z0-9]{3}$/);
  }
  assert.equal(new Set(aliveIds.map(id => teams[id].code)).size, aliveIds.length, 'club codes are unique in the country');
  assert.ok(sectionIds.every(id => Number.isFinite(geo.paths[id].cx) && Number.isFinite(geo.paths[id].cy) && geo.paths[id].area > 0));
  assert.ok(sectionIds.every(id => typeof sectionNames[id] === 'string' && sectionNames[id].length > 0));
});

test('every England club can open the campaign with a legal duel draw', () => {
  const state = kickoff(SETTINGS);
  const board = boardOf(state);
  assert.deepEqual(validateReachability(board).unplacedIds, []);
  state.aliveIds.forEach((id, i) => {
    let calls = 0;
    const samples = [(i + .01) / state.aliveIds.length, (i * .61803398875) % 1, .5];
    const draw = createDuelDraw(() => samples[calls++], board);
    assert.equal(calls, 3, 'one draw consumes exactly three samples');
    assert.equal(draw?.attackerId, id, 'the requested attacker is never rerouted at kickoff');
    assertLegalDraw(board, draw, `kickoff ${state.teams[id].name}`);
  });
});

test('a lone section can still finish a two-club final against a merged England', () => {
  const extremes = ['cx', 'cy'].flatMap(axis => {
    const sorted = sectionIds.slice().sort((a, b) => geo.paths[a][axis] - geo.paths[b][axis]);
    return [sorted[0], sorted.at(-1)];
  });
  const smallest = sectionIds.slice().sort((a, b) => geo.paths[a].area - geo.paths[b].area)[0];
  for (const lone of [...new Set([...extremes, smallest, ...islandSections])]) {
    const own = Object.fromEntries(sectionIds.map(id => [id, id === lone ? 'Lone' : 'Merged']));
    const board = { geo, routingPaths: geo.paths, routeIndex, own, aliveIds: ['Lone', 'Merged'] };
    for (const attacker of board.aliveIds) {
      let calls = 0;
      const draw = createDuelDraw(() => [attacker === 'Lone' ? 0 : .75, .17, .25][calls++], board);
      assertLegalDraw(board, draw, `final ${sectionNames[lone]} (${attacker} attacks)`);
      assert.equal(draw.attackerId, attacker);
    }
  }
});

test('seeded duel campaigns play to a champion with conserved territory and no transit treaties', () => {
  for (const seed of [20261018, 7]) {
    const { state, routes } = playDuelCampaign(seed);
    const championId = state.aliveIds[0];
    assert.equal(state.aliveIds.length, 1);
    assert.equal(state.matches, entry.clubs - 1, 'N clubs need exactly N - 1 matches');
    assert.equal(state.fallen.length, entry.clubs - 1);
    assert.equal(territories(state, championId).length, entry.clubs, 'the champion holds every section');
    assert.equal(state.stats[championId].conq, state.teams[championId].squad.filter(player => player.from).length);
    assert.equal(routes['neutral-transit'], 0);
    assert.equal(routes.straight + routes.sea, entry.clubs - 1);
    assert.equal(state.history.length, entry.clubs - 1);
    assert.ok(state.history.every(match => match.result.territoryNames.every(name => Object.values(sectionNames).includes(name))),
      'conquest summaries name sections');
  }
});

test('seeded blitz and chaos campaigns also finish with one fewer club per match', () => {
  for (const [pacing, draw] of [['blitz', drawBlitzPairs], ['chaos', drawChaosPairs]]) {
    const rng = makeRng(20261019);
    let state = kickoff({ ...SETTINGS, pacing });
    let rounds = 0;
    while (state.aliveIds.length > 1) {
      rounds++;
      const pairs = pacing === 'blitz' ? draw(rng, boardOf(state)).pairs : draw(rng, boardOf(state));
      assert.ok(pairs.length > 0, `${pacing}: every round draws at least one match`);
      const ids = pairs.flat();
      assert.equal(new Set(ids).size, ids.length, `${pacing}: no club plays twice in one round`);
      if (pacing === 'blitz') assert.equal(pairs.length, Math.floor(state.aliveIds.length / 2), 'blitz pairs everyone but an odd bye');
      state = { ...state, round: rounds };
      for (const [a, d] of pairs) state = playMatch(state, rng, a, d);
      assertConserved(state, `${pacing} round ${rounds}`);
    }
    assert.equal(state.matches, entry.clubs - 1);
    assert.equal(territories(state, state.aliveIds[0]).length, entry.clubs);
    if (pacing === 'blitz') assert.equal(rounds, Math.ceil(Math.log2(entry.clubs)), 'blitz halves the field each round');
  }
});

test('domestic checkpoints round-trip through storage and stay under 0.5 MB', () => {
  let paused = null;
  const { state: finished } = playDuelCampaign(20261020, {
    // A duel paused on a locked draw mid-campaign, as autosave would store it.
    onMatch: state => { if (state.matches === 40) paused = { ...state, rngState: 123456789 }; },
  });
  const atKickoff = { ...kickoff({ ...SETTINGS, seed: '20261020' }), seed: 20261020, rngState: 20261020 };
  for (const [label, state] of [['kickoff', atKickoff], ['paused draw', paused], ['champion', finished]]) {
    const text = serializeCampaign(campaignSnapshot(state));
    const bytes = Buffer.byteLength(text, 'utf8');
    assert.ok(bytes <= MAX_CHECKPOINT_BYTES, `${label} checkpoint is ${(bytes / 1e6).toFixed(2)} MB`);
    const restored = parseCampaign(text);
    assert.equal(restored.settings.clubScope, domesticScope(ID));
    assert.equal(restored.settings.layer, 'clubs');
    assert.equal(restored.settings.domesticVersion, entry.version);
    assert.deepEqual(restored.own, state.own);
    assert.deepEqual(restored.aliveIds, state.aliveIds);
    assert.equal(Object.keys(restored.teams).length, entry.clubs, 'eliminated clubs stay on record');
    assert.ok(Object.values(restored.teams).every(team => sectionIds.includes(team.home)), 'every saved home is a section');
    assert.ok(Object.keys(restored.own).every(id => sectionIds.includes(id)), 'every saved territory is a section');
    assert.deepEqual(restored.teams, JSON.parse(JSON.stringify(state.teams)), 'squads and FM source details survive exactly');
    assert.deepEqual(restored.history, JSON.parse(JSON.stringify(state.history)), 'match records and their players too');
    if (label === 'paused draw') assert.equal(restored.spin.attackerId, state.spin.attackerId);
    if (label === 'champion') assert.equal(restored.history.length, entry.clubs - 1);
  }
});

test('every shipped country kicks off with one club per section and legal duel draws', () => {
  for (const item of DOMESTIC) {
    const country = decodeDomestic(JSON.parse(readFileSync(new URL(`../public/domestic/${item.id}.json`, import.meta.url), 'utf8')), item.id);
    const sections = country.geo.countries.map(section => section.id);
    const own = Object.fromEntries(country.clubs.map(club => [club.homeSection, club.id]));
    assert.equal(country.meta.version, item.version, `${item.name}: the file is the indexed build`);
    assert.deepEqual(Object.keys(own).sort(), [...sections].sort(), `${item.name}: every section starts owned, once`);
    const board = { geo: country.geo, routingPaths: country.geo.paths, routeIndex: createAttackRouteIndex(country.geo.paths),
      own, aliveIds: country.clubs.map(club => club.id) };
    assert.deepEqual(validateReachability(board).unplacedIds, [], `${item.name}: every club is placed`);
    // A spread of attackers, each with the three samples one duel draw consumes.
    const step = Math.ceil(board.aliveIds.length / 8);
    for (let i = 0; i < board.aliveIds.length; i += step) {
      let calls = 0;
      const samples = [(i + .01) / board.aliveIds.length, (i * .61803398875) % 1, .5];
      const draw = createDuelDraw(() => samples[calls++], board);
      assert.equal(draw?.attackerId, board.aliveIds[i], `${item.name}: the requested attacker draws at kickoff`);
      // Coastal sea routes stay legal wherever a club's home point leaves it no
      // straight line (e.g. The Hague), so only England pins the island rule.
      assertLegalDraw(board, draw, `${item.name} kickoff ${country.clubs[i].name}`, { islands: null });
    }
  }
});

test('a save from a rebuilt England map moves club by club: every club keeps its land and its holder', () => {
  let paused = null;
  playDuelCampaign(20261021, { onMatch: state => { if (state.matches === 30) paused = state; } });
  const saved = parseCampaign(serializeCampaign(campaignSnapshot({ ...paused, seed: 1, rngState: 1 })));
  // A refreshed club list that shifts every club down one rank, so every section id now names another club's start.
  const homes = domestic.clubs.map(club => club.homeSection);
  const rebuilt = { ...domestic, meta: { ...domestic.meta, version: '826-0badf00d' },
    clubs: domestic.clubs.map((club, i) => ({ ...club, homeSection: homes[(i + 1) % homes.length] })) };
  const { campaign: moved, error } = fitDomesticCampaign(saved, rebuilt);
  assert.equal(error, undefined);
  for (const club of rebuilt.clubs) {
    const before = domestic.clubs.find(item => item.id === club.id).homeSection;
    assert.equal(moved.own[club.homeSection], saved.own[before], `${club.name}: whoever held its start still does`);
    assert.equal(moved.teams[club.id].home, club.homeSection);
  }
  assert.deepEqual(Object.keys(moved.own).sort(), [...sectionIds].sort(), 'every section is still held');
  for (const id of moved.aliveIds) assert.equal(territories(moved, id).length, territories(saved, id).length, 'empires keep their size');
  assert.doesNotThrow(() => parseCampaign(serializeCampaign(campaignSnapshot(moved))), 'the moved save is a valid checkpoint');
  // A club the save never had, or one the rebuild dropped, refuses the save rather than guessing.
  const dropped = { ...rebuilt, clubs: rebuilt.clubs.slice(1) };
  assert.match(fitDomesticCampaign(saved, dropped).error, /1 of its clubs is not on the updated map/);
});

test('the app board blocks neighbouring land: draws stay legal and only exclaves cross a foreign country', () => {
  const atlas = JSON.parse(readFileSync(new URL('../public/countries-50m.json', import.meta.url), 'utf8'));
  const { obstacles } = domesticSurroundings(atlas, domestic);
  assert.ok(obstacles.length > 0 && obstacles.every(shape => !sectionIds.includes(shape.id)), 'neighbours, never sections');
  // As App.board(): no prepared index, so the rules build (and cache) one that includes the obstacles.
  const appBoard = state => ({ geo, routingPaths: geo.paths, own: state.own, aliveIds: state.aliveIds, obstacles, borderRoutes: true });
  const rng = makeRng(20261022);
  let state = kickoff({ ...SETTINGS, seed: '20261022' }), obstacleRoutes = 0;
  while (state.aliveIds.length > 1) {
    const board = appBoard(state);
    const draw = createDuelDraw(rng, board, { speed: 80 });
    // Legality is judged on the sections alone; the obstacle index also reports foreign land.
    assertLegalDraw(board, draw, `obstacle board match ${state.matches + 1}`, { routeIndex, islands: null });
    const index = createAttackRouteIndex(geo.paths, obstacles);
    if (draw.routeKind === 'straight') obstacleRoutes += draw.routePoints.slice(1).flatMap((point, i) => routeLandCrossings(index,
      { ax: draw.routePoints[i][0], ay: draw.routePoints[i][1], bx: point[0], by: point[1] })).filter(hit => hit.obstacle).length;
    assert.notEqual(draw.routeKind, 'foreign-transit', 'England has no exclave');
    state = playMatch({ ...state, round: state.round + 1 }, rng, draw.attackerId, draw.targetId, draw);
    assertConserved(state, `obstacle board after match ${state.matches}`);
  }
  assert.equal(createAttackRouteIndex(geo.paths, obstacles), createAttackRouteIndex(geo.paths, obstacles), 'one cached index per map');
  assert.equal(obstacleRoutes, 0, 'no direct challenge crosses a neighbouring country');
});
