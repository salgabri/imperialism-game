import { selectLineup, teamEff } from '../data/teams.js';

export function acquisitionOptions(winner, loser) {
  const before = selectLineup(winner);
  return loser.squad.map((player, index) => {
    const after = selectLineup({ ...winner, squad: [...winner.squad, player] });
    const replaced = before.starters.find(p => !after.starters.some(q => q.originalIndex === p.originalIndex));
    return { ...player, index, gain: Math.round((after.rating - before.rating) * 10) / 10,
      replaces: replaced || null, entersLineup: after.starters.some(p => p.originalIndex === winner.squad.length) };
  }).sort((a, b) => b.gain - a.gain || b.rating - a.rating || a.index - b.index).slice(0, 3);
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
