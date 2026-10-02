import { selectLineup, teamEff, teamSportId } from '../data/teams.js';

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const round = value => Math.round(value * 100) / 100;

export const TACTICS = [
  { id: 'attack', label: 'Attack', description: 'Push for an advantage. More matchday variation gives underdogs a chance but makes a lead less reliable.' },
  { id: 'balanced', label: 'Balanced', description: 'Trust the starting lineup. Keep the campaign’s normal matchday variation.' },
  { id: 'defend', label: 'Defend', description: 'Trade some match strength for steadier form. Useful for protecting a quality advantage; harder to spring an upset.' },
];

// Bench players provide bounded tactical support through their natural position.
// The best useful reserve matters; hoarding dozens of players cannot stack it.
const SUPPORT = {
  football: { FW: [1, 0], MF: [.65, .65], DF: [0, 1], GK: [0, 1] },
  basketball: { PG: [.75, .25], SG: [1, 0], SF: [1, .4], PF: [0, 1], C: [0, 1] },
};

export function tacticalProfile(team) {
  const bench = selectLineup(team).bench;
  const weights = SUPPORT[teamSportId(team)];
  let attack = 0, defend = 0;
  for (const player of bench) {
    const quality = clamp((player.rating - 50) / 40, 0, 1) * 1.2;
    const [a, d] = weights[player.pos] || [0, 0];
    attack = Math.max(attack, quality * a);
    defend = Math.max(defend, quality * d);
  }
  return { attack: round(attack), defend: round(defend) };
}

export function tacticalOptions(team, opponent, drama = 6) {
  const profile = tacticalProfile(team);
  const variation = Number.isFinite(drama) ? clamp(drama, 0, 12) : 6;
  const strength = teamEff(team), opponentStrength = teamEff(opponent);
  return TACTICS.map(tactic => {
    const support = tactic.id === 'balanced' ? 0 : profile[tactic.id];
    const bonus = tactic.id === 'attack' ? .6 + support : tactic.id === 'defend' ? -.9 + support : 0;
    const nextDrama = tactic.id === 'attack' ? Math.min(12, variation + 5)
      : tactic.id === 'defend' ? Math.max(0, variation - 4) : variation;
    return { ...tactic, bonus: round(bonus), support, drama: nextDrama,
      strength: round(strength + bonus), opponentStrength, baseDrama: variation,
      varianceMultiplier: variation ? round(nextDrama / variation) : nextDrama ? null : 1,
      context: strength < opponentStrength - 2 ? 'You are the underdog.' : strength > opponentStrength + 2
        ? 'Your lineup has the quality advantage.' : 'These starting lineups are closely matched.' };
  });
}

/** Pure parameters used by BOTH the real outcome and the displayed odds. */
export function tacticalMatchParameters({ attacker, defender, managedId, tactic = 'balanced', drama = 6 }) {
  const isAttacker = managedId === attacker.id, isDefender = managedId === defender.id;
  const option = isAttacker || isDefender
    ? tacticalOptions(isAttacker ? attacker : defender, isAttacker ? defender : attacker, drama)
      .find(item => item.id === tactic) : null;
  const selected = option || { id: 'balanced', bonus: 0, drama, support: 0, varianceMultiplier: 1 };
  return {
    effA: teamEff(attacker) + (isAttacker ? selected.bonus : 0),
    effD: teamEff(defender) + (isDefender ? selected.bonus : 0),
    drama: selected.drama, tactic: selected.id, bonus: selected.bonus,
    support: selected.support, varianceMultiplier: selected.varianceMultiplier,
  };
}

/**
 * Optional competition format. Shift an entire basketball roster equally,
 * compressing between-team gaps while preserving every within-roster gap.
 * Authentic ratings remain available for display, and the input is never edited.
 */
export function competitiveBasketballTeams(teams, preset = 'authentic') {
  if (preset !== 'competitive') return teams;
  return Object.fromEntries(Object.entries(teams).map(([id, team]) => {
    if (teamSportId(team) !== 'basketball' || !team.squad.length) return [id, team];
    const authenticEff = teamEff(team);
    const target = 80 + (authenticEff - 80) * .28;
    const min = Math.min(...team.squad.map(player => player.rating));
    const max = Math.max(...team.squad.map(player => player.rating));
    const shift = round(clamp(target - authenticEff, 1 - min, 99 - max));
    return [id, { ...team, authenticEff, rosterPreset: 'competitive', str: round(team.str + shift),
      squad: team.squad.map(player => ({ ...player, authenticRating: player.rating, rating: round(player.rating + shift) })) }];
  }));
}
