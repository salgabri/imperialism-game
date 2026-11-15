// Owner: scores entered by you (README §Scores entered by you, src/engine/enteredResult.js). The result form's
// view-model: the match waiting for the score the player types in, and what that score would do. Pure: (state, ctx) in,
// plain data out; no window, document, timers or RNG.
import { matchSport } from '../sports/index.js';
import { EMPTY_DRAFT, readResult } from '../engine/enteredResult.js';
import { displayRound, roman } from './format.js';

const side = team => ({
  teamId: team.id, flagId: team.flagId ?? null, isClub: team.kind === 'club', code: team.code || team.name || '',
  color: team.col || null, name: team.name || '',
});

/**
 * What a level final score is missing, in a sport that plays on until one side wins: the score after its overtime
 * (an ice hockey shoot-out's winner scores one more, as the NHL counts it), or, in a sport that cannot end level (a
 * tennis tie, a Rocket League series), a winner.
 */
function levelLine(sport) {
  if (sport.tieBreak === 'none') return 'Level scores need a winner: one side wins the tie.';
  if (sport.overtime?.shootoutAt != null) return 'Level scores need a winner: type the final score, overtime and shoot-out included.';
  const overtime = (sport.words?.overtime || 'overtime').toLowerCase();
  return `Level scores need a winner: type the score after ${overtime}.`;
}

/**
 * The best-of-three final this match is a game of, if it is one (App.startMatch starts the series at its first game):
 * { wins: { [teamId]: n }, games }, else null.
 */
function finalSeries(st, aId, dId) {
  if (st.settings?.finale !== 'best-of-three' || (st.aliveIds || []).length !== 2) return null;
  const series = st.series;
  return series?.teamIds?.includes(aId) && series.teamIds.includes(dId) ? series : { wins: { [aId]: 0, [dId]: 0 }, games: 0 };
}

/**
 * The result form (ResultEntry) for the match waiting for its score → null without one:
 * { round, a, b (team marks), unit ('goals', 'points', 'runs', 'rubbers', 'games'), draft, shootout (show the penalties
 *   row), state ('incomplete' | 'level' | 'ready'), ready, line (what the score does, or what it lacks), series (the
 *   final's games so far) | null }.
 */
export function buildResultEntry(st, ctx = {}) {
  const entry = st?.resultEntry, teams = st?.teams || {};
  const A = teams[entry?.aId], D = teams[entry?.dId];
  if (!entry || !A || !D) return null;
  const sport = ctx?.sport || matchSport(st.settings);
  const draft = { ...EMPTY_DRAFT, ...st.resultDraft };
  const result = readResult(sport, draft, A.id, D.id);
  const series = finalSeries(st, A.id, D.id);
  let line;
  if (result.state === 'incomplete') line = `Play ${A.name} v ${D.name}, then type its final score.`;
  else if (result.state === 'level') {
    line = result.shootout ? (draft.pa !== '' && draft.pb !== '' ? 'A shoot-out needs a winner.' : 'Level: type the penalty shoot-out’s score.')
      : levelLine(sport);
  } else {
    const W = result.winner === A.id ? A : D, L = W === A ? D : A;
    // The winner's score first: the match's, or the shoot-out's after a level one.
    const [scoreA, scoreD] = result.tie ? [result.tie.ga, result.tie.gd] : [result.ga, result.gd];
    const score = W === A ? `${scoreA}–${scoreD}` : `${scoreD}–${scoreA}`;
    const how = result.tie ? `${score} on penalties` : score;
    const decides = !series || (Number(series.wins?.[W.id]) || 0) + 1 >= 2;
    line = decides ? `${W.name} wins ${how} and takes ${L.name}.`
      : `${W.name} wins ${how}: game ${(Number(series.games) || 0) + 1} of the final.`;
  }
  const round = displayRound(st);
  return {
    round: round > 0 ? `Round ${roman(round)}` : '',
    a: side(A), b: side(D),
    unit: String(sport.labels?.score || 'score').toLowerCase(),
    draft, shootout: result.shootout, state: result.state, ready: result.state === 'ready', line,
    series: series && series.games > 0
      ? `Final · ${A.code || A.name} ${Number(series.wins[A.id]) || 0}–${Number(series.wins[D.id]) || 0} ${D.code || D.name} · first to two`
      : null,
  };
}
