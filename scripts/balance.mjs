// Reproducible, headless balance report. Run: node scripts/balance.mjs --runs=12
// These are probes of the game's model, not forecasts of real sporting results.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { NATIONS, DEPENDENCIES, buildTeam, hashStr, makeRng, teamEff } from '../src/data/teams.js';
import { SPORT_LIST } from '../src/sports/index.js';
import { WorldGeometry } from '../src/engine/geo.js';
import { CAPITALS } from '../src/data/capitals.js';
import { createAttackRouteIndex } from '../src/engine/attackRoutes.js';
import { createDuelDraw } from '../src/engine/duelDraw.js';
import { drawBlitzPairs, drawChaosPairs, pickTarget } from '../src/engine/campaign.js';
import { UNCERTAINTY_PRESETS, estimateWinProbability } from '../src/engine/odds.js';

const load = name => JSON.parse(readFileSync(new URL(`../public/${name}`, import.meta.url), 'utf8'));
let geography;
function world() {
  if (!geography) {
    const geo = new WorldGeometry(load('world-110m.v1.json'), CAPITALS).fitTo(Object.keys(NATIONS));
    const { s, tx, ty } = geo.fit;
    const routingPaths = new WorldGeometry(load('countries-50m.json'), CAPITALS).buildPaths(s, tx, ty);
    geography = { geo, routingPaths, routeIndex: createAttackRouteIndex(routingPaths) };
  }
  return geography;
}

export function probeCampaign({ sport, seed = 1, scope = 'elite', pacing = 'blitz', preset = 'balanced', finalSeries = 1, acquisition = 'best-rating' }) {
  const rosterRng = makeRng(hashStr(`rosters:${seed}`));
  let included = Object.keys(NATIONS).map(id => buildTeam(id, rosterRng, sport));
  if (scope === 'elite') included = included.sort((a, b) => b.str - a.str || teamEff(b) - teamEff(a)).slice(0, 32);
  else if (scope !== 'world') included = included.filter(team => team.conf === scope);
  const teams = Object.fromEntries(included.map(team => [team.id, team]));
  const initialRatings = Object.fromEntries(included.map(team => [team.id, teamEff(team)]));
  const initialRank = included.slice().sort((a, b) => teamEff(b) - teamEff(a)).map(team => team.id);
  const own = Object.fromEntries(included.map(team => [team.id, team.id]));
  for (const [countryId, dependency] of Object.entries(DEPENDENCIES)) if (teams[dependency.of]) own[countryId] = dependency.of;
  const board = { ...world(), own, aliveIds: included.map(team => team.id) };
  const drawRng = makeRng(hashStr(`draws:${seed}`));
  const drama = UNCERTAINTY_PRESETS[preset]?.drama ?? 6;
  let queue = [];
  let fixtures = 0, games = 0, redraws = 0, emptyDraws = 0;
  let strengthTurnovers = 0, territoryTurnovers = 0, usefulAcquisitions = 0, unchangedAcquisitions = 0;
  let acquisitionGain = 0;
  const leader = by => board.aliveIds.slice().sort((a, b) => by(b) - by(a) || a.localeCompare(b))[0];
  const held = id => Object.values(own).filter(owner => owner === id).length;
  let strengthLeader = leader(id => teamEff(teams[id]));
  let territoryLeader = leader(held);
  let stalled = false;
  while (board.aliveIds.length > 1 && fixtures < included.length * 2) {
    if (!queue.length) {
      if (pacing === 'duel') {
        const draw = createDuelDraw(drawRng, board, { reducedMotion: true });
        if (!draw) {
          redraws++;
          if (!board.aliveIds.some(id => pickTarget(board, id, 0))) { stalled = true; break; }
          if (++emptyDraws >= Math.max(64, board.aliveIds.length * 8)) { stalled = true; break; }
          continue;
        }
        queue = [[draw.attackerId, draw.targetId]];
      } else if (pacing === 'chaos') queue = drawChaosPairs(drawRng, board);
      else queue = drawBlitzPairs(drawRng, board).pairs;
      if (!queue.length) { stalled = true; break; }
    }
    emptyDraws = 0;
    const [aId, dId] = queue.shift();
    const a = teams[aId], d = teams[dId];
    const matchRng = makeRng(hashStr(`match:${seed}:${fixtures}:${aId}:${dId}`));
    const seriesLength = board.aliveIds.length === 2 ? finalSeries : 1;
    const winsNeeded = Math.floor(seriesLength / 2) + 1;
    let aWins = 0, dWins = 0;
    while (aWins < winsNeeded && dWins < winsNeeded) {
      const result = sport.simulate(matchRng, a, d, drama, teamEff(a), teamEff(d));
      if (result.winner === aId) aWins++; else dWins++;
      games++;
    }
    const winner = aWins > dWins ? a : d;
    const loser = winner === a ? d : a;
    const before = teamEff(winner);
    const candidates = loser.squad.slice().sort((x, y) => y.rating - x.rating);
    if (acquisition === 'best-fit') candidates.sort((x, y) =>
      teamEff({ ...winner, squad: winner.squad.concat(y) }) - teamEff({ ...winner, squad: winner.squad.concat(x) }) || y.rating - x.rating);
    if (candidates[0]) {
      winner.squad = winner.squad.concat({ ...candidates[0], from: loser.code });
      const gain = teamEff(winner) - before;
      acquisitionGain += gain;
      if (gain > .05) usefulAcquisitions++; else unchangedAcquisitions++;
    }
    for (const countryId of Object.keys(own)) if (own[countryId] === loser.id) own[countryId] = winner.id;
    board.aliveIds = board.aliveIds.filter(id => id !== loser.id);
    fixtures++;
    const nextStrength = leader(id => teamEff(teams[id]));
    const nextTerritory = leader(held);
    if (nextStrength !== strengthLeader) strengthTurnovers++;
    if (nextTerritory !== territoryLeader) territoryTurnovers++;
    strengthLeader = nextStrength;
    territoryLeader = nextTerritory;
  }
  const championId = board.aliveIds.length === 1 ? board.aliveIds[0] : null;
  return {
    seed, sport: sport.id, scope, pacing, preset, finalSeries, acquisition,
    completed: !!championId, stalled, startingTeams: included.length, survivors: board.aliveIds.length,
    champion: championId ? teams[championId].name : null,
    championInitialRank: championId ? initialRank.indexOf(championId) + 1 : null,
    championStrengthGain: championId ? Math.round((teamEff(teams[championId]) - initialRatings[championId]) * 10) / 10 : null,
    fixtures, games, redraws, strengthTurnovers, territoryTurnovers,
    usefulAcquisitions, unchangedAcquisitions, acquisitionGain: Math.round(acquisitionGain * 10) / 10,
  };
}

export function summarizeCampaigns(results) {
  const completed = results.filter(result => result.completed);
  const acquisitions = results.reduce((total, result) => total + result.usefulAcquisitions + result.unchangedAcquisitions, 0);
  const mean = key => Math.round(results.reduce((total, result) => total + result[key], 0) / Math.max(1, results.length) * 100) / 100;
  const champions = {};
  for (const result of completed) champions[result.champion] = (champions[result.champion] || 0) + 1;
  return {
    runs: results.length, completed: completed.length, stalled: results.filter(result => result.stalled).length,
    champions, topFiveChampionShare: completed.filter(result => result.championInitialRank <= 5).length / Math.max(1, completed.length),
    meanFixtures: mean('fixtures'), meanGames: mean('games'), meanRedraws: mean('redraws'),
    meanStrengthLeaderTurnovers: mean('strengthTurnovers'), meanTerritoryLeaderTurnovers: mean('territoryTurnovers'),
    usefulAcquisitionShare: results.reduce((total, result) => total + result.usefulAcquisitions, 0) / Math.max(1, acquisitions),
    meanCampaignAcquisitionGain: mean('acquisitionGain'),
    meanGainPerAcquisition: Math.round(results.reduce((total, result) => total + result.acquisitionGain, 0) / Math.max(1, acquisitions) * 100) / 100,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const requestedRuns = Number(process.argv.find(argument => argument.startsWith('--runs='))?.split('=')[1] || 12);
  const runs = Math.max(1, Math.min(200, Number.isFinite(requestedRuns) ? Math.round(requestedRuns) : 12));
  const report = { note: 'Seeded model probes; single and series variants share roster, draw and per-fixture random streams.',
    scope: 'elite', campaignPreset: 'balanced', acquisition: 'best-rating', seedStart: 20261002,
    seriesStartsAt: 2, runs, ratingGapProbes: [], campaigns: [] };
  for (const sport of SPORT_LIST) {
    const synthetic = (rating, id) => ({ id, sport: sport.id, squad: sport.positionPlan.map((pos, index) => ({ name: `${id}-${index}`, pos, rating })) });
    for (const preset of Object.keys(UNCERTAINTY_PRESETS)) for (const gap of [0, 5, 10, 20]) {
      const odds = estimateWinProbability({ sport, attacker: synthetic(65 + gap, 'A'), defender: synthetic(65, 'D'), preset, samples: 5000 });
      report.ratingGapProbes.push({ sport: sport.id, preset, gap, favouriteWinChance: odds.attacker, samples: odds.samples });
    }
    for (const pacing of ['blitz', 'chaos', 'duel']) for (const finalSeries of [1, 3]) {
      const results = Array.from({ length: runs }, (_, index) => probeCampaign({ sport, seed: 20261002 + index, pacing, finalSeries }));
      report.campaigns.push({ sport: sport.id, pacing, finalSeries, ...summarizeCampaigns(results) });
      console.error(`${sport.id} ${pacing} finalSeries=${finalSeries}: ${results.filter(result => result.completed).length}/${runs} completed`);
    }
  }
  console.log(JSON.stringify(report, null, 2));
}
