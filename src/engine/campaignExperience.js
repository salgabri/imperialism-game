import { selectLineup, teamEff } from '../data/teams.js';
import { tacticalProfile } from './managerStrategy.js';

const round = value => Math.round(value * 100) / 100;
const preview = lineup => lineup.slots.map(slot => ({ position: slot.position, name: slot.player?.name || 'Unfilled shirt',
  rating: slot.effectiveRating, outOfPosition: slot.outOfPosition }));

export function acquisitionCandidates(winner, loser) {
  const before = selectLineup(winner);
  const beforeSupport = tacticalProfile(winner);
  return loser.squad.map((player, index) => {
    const recruited = { ...winner, squad: [...winner.squad, player] };
    const after = selectLineup(recruited);
    const support = tacticalProfile(recruited);
    const replaced = before.starters.find(p => !after.starters.some(q => q.originalIndex === p.originalIndex));
    return { ...player, index, gain: Math.round((after.rating - before.rating) * 10) / 10,
      replaces: replaced || null, entersLineup: after.starters.some(p => p.originalIndex === winner.squad.length),
      support, supportBefore: beforeSupport,
      attackGain: round(support.attack - beforeSupport.attack), defendGain: round(support.defend - beforeSupport.defend),
      lineupPreview: { beforeRating: before.rating, afterRating: after.rating, before: preview(before), after: preview(after) } };
  });
}

export function acquisitionOptions(winner, loser, { limit = 3 } = {}) {
  const candidates = acquisitionCandidates(winner, loser);
  const rated = (a, b) => b.gain - a.gain || b.rating - a.rating || a.index - b.index;
  const chosen = [];
  const choose = (sorted, role) => {
    const candidate = sorted.find(item => !chosen.some(selected => selected.index === item.index));
    if (candidate && chosen.length < limit) chosen.push({ ...candidate, role });
  };
  choose(candidates.slice().sort(rated), 'Starting lineup');
  choose(candidates.filter(item => item.attackGain > 0).sort((a, b) => b.attackGain - a.attackGain || rated(a, b)), 'Attack support');
  choose(candidates.filter(item => item.defendGain > 0).sort((a, b) => b.defendGain - a.defendGain || rated(a, b)), 'Defensive support');
  for (const candidate of candidates.slice().sort(rated)) {
    if (chosen.length >= limit) break;
    if (!chosen.some(item => item.index === candidate.index)) chosen.push({ ...candidate, role: candidate.entersLineup ? 'Starting lineup' : 'Squad depth' });
  }
  return chosen;
}

export function automaticAcquisition(winner, loser, policy = 'highest-rated') {
  const candidates = acquisitionCandidates(winner, loser);
  return candidates.sort(policy === 'best-fit'
    ? (a, b) => b.gain - a.gain || b.rating - a.rating || a.index - b.index
    : (a, b) => b.rating - a.rating || a.index - b.index)[0] || null;
}

export function recordMatch(state, match, extras = {}) {
  const a = state.teams[match.aId], b = state.teams[match.dId];
  const mark = (team, score, eff) => ({ id: team.flagId, tid: team.id, code: team.code,
    name: team.name, color: team.col, isClub: team.kind === 'club', score: String(score), eff: eff.toFixed(1) });
  return {
    id: `match-${state.matches + 1}`, round: state.round, aId: a.id, bId: b.id, dId: b.id,
    a: mark(a, match.finalGa, match.effA), b: mark(b, match.finalGd, match.effD),
    winnerId: match.winner, winnerName: state.teams[match.winner].name,
    ratingGap: Math.abs(match.effA - match.effD),
    upsetGap: (match.winner === match.aId ? match.effD - match.effA : match.effA - match.effD),
    events: match.allEv.map(e => ({ ...state.sport.formatEvent(e, state.teams[e.tid].code), color: state.teams[e.tid].col })),
    odds: match.odds, series: match.series, routeLabel: match.routeLabel, ...extras,
  };
}

export function campaignRecap(history = []) {
  const upset = history.filter(m => m.upsetGap > 0).sort((a, b) => b.upsetGap - a.upsetGap)[0];
  const impact = history.filter(m => m.result?.player).sort((a, b) => (b.result.strengthGain || 0) - (a.result.strengthGain || 0))[0];
  const final = history.at(-1);
  return {
    biggestUpset: upset ? `${upset.winnerName} overturned a ${upset.upsetGap.toFixed(1)}-point strength gap` : 'No underdog wins recorded',
    decisiveMatch: final ? `${final.a.name} ${final.a.score}–${final.b.score} ${final.b.name}${final.result?.tieText ? ` · ${final.result.tieText}` : ''}` : 'No matches recorded',
    transferImpact: impact ? `${impact.result.player.name}: +${impact.result.strengthGain.toFixed(1)} strength for ${impact.winnerName}` : 'No acquisitions recorded',
  };
}

export function estimateSession(remaining, settings, speed = 1, series = null) {
  let games = Math.max(0, remaining - 1) + (remaining > 1 && settings.finale === 'best-of-three' ? 2 : 0);
  if (remaining === 2 && settings.finale === 'best-of-three' && series) games = Math.max(0, 3 - series.games);
  const secondsPerGame = settings.express ? 2.5 : settings.resolution === 'instant' ? 7 : 12;
  return { games, seconds: Math.ceil(games * secondsPerGame / speed) };
}

export function advanceSeries(series, aId, bId, winnerId) {
  const current = series && series.teamIds.includes(aId) && series.teamIds.includes(bId)
    ? series : { teamIds: [aId, bId], wins: { [aId]: 0, [bId]: 0 }, games: 0 };
  const next = { ...current, wins: { ...current.wins, [winnerId]: current.wins[winnerId] + 1 }, games: current.games + 1 };
  return { series: next, complete: next.wins[winnerId] >= 2 };
}
