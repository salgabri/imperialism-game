// Owner: WP-0 (see PLAN.md §4). Masthead view-model (PLAN §3.4) — FROZEN shape.
// Pure: tolerates loading/setup state (teams {}, board null), stats {} and teams without baseEff.
import { teamEff } from '../data/teams.js';
import { territories } from '../engine/campaign.js';
import { displayRound, memo, roman, signedDelta, teamChip } from './format.js';
import { getSport } from '../sports/index.js';

function territoryCounts(own) {
  const counts = new Map();
  for (const cid in own || {}) counts.set(own[cid], (counts.get(own[cid]) || 0) + 1);
  return counts;
}

function strengthOf(team) {
  try { return teamEff(team); } catch { return 0; }
}

/** ctx.sport is the getSport object (or an id); a bare state falls back to its settings. */
function sportIdOf(st, ctx) {
  return (typeof ctx?.sport === 'string' ? ctx.sport : ctx?.sport?.id) || st?.settings?.sport || 'football';
}

function managerStats(st, ctx, id) {
  const team = st.teams[id];
  const eff = strengthOf(team);
  const base = Number.isFinite(team.baseEff) ? team.baseEff : eff;
  const delta = signedDelta(eff - base);
  const terr = ctx.board ? territories(ctx.board, id).length : 0;
  return [
    { key: 'strength', label: 'Strength', short: 'Str', value: eff.toFixed(1), delta: delta.text, tone: delta.tone,
      tip: `${getSport(sportIdOf(st, ctx)).words.lineup} strength · change since Round I` },
    { key: 'territories', label: 'Territories', short: 'Terr', value: String(terr), delta: '', tone: 'muted', tip: 'Land held' },
    { key: 'conquests', label: 'Conquests', short: 'Conq', value: String(st.stats?.[id]?.conq ?? 0), delta: '', tone: 'muted',
      tip: 'Empires annexed' },
    { key: 'claimed', label: 'Claimed', short: 'Claimed', value: String(st.stats?.[id]?.steals?.length ?? 0), delta: '', tone: 'muted',
      tip: 'Players taken from fallen squads' },
  ];
}

function largestEmpire(st, ctx) {
  const own = ctx.board ? ctx.board.own : null;
  return memo(ctx.cache, 'mast:largest', [own, st.aliveIds, st.teams], () => {
    const counts = territoryCounts(own);
    let best = null, most = -1;
    for (const id of st.aliveIds || []) {
      const n = counts.get(id) || 0;
      if (n > most) { most = n; best = id; }
    }
    const team = best ? st.teams[best] : null;
    return team ? `${team.code} · ${most}` : '—';
  });
}

function spectatorStats(st, ctx) {
  const stat = (key, label, value, tip) => ({ key, label, short: label, value: String(value), delta: '', tone: 'muted', tip });
  return [
    stat('empires', 'Empires', (st.aliveIds || []).length, 'Empires still in the campaign'),
    stat('matches', 'Matches', st.matches ?? 0, 'Matches played'),
    stat('upsets', 'Upsets', (st.history || []).filter(entry => entry?.result?.upset).length, 'Matches won by the weaker side'),
    stat('largest', 'Largest', largestEmpire(st, ctx), 'Empire with the most territories'),
  ];
}

/**
 * → { variant, team, name, role, roman, roundLabel, roundShort, remain, stats[] }
 * Manager: the managed team; spectator: the followed team. DEC D15: during a pending signing the values
 * are the current (pre-signing) ones, because the state has not changed yet.
 */
export function buildMasthead(st, ctx = {}) {
  const teams = st?.teams || {};
  const state = { ...st, teams };
  const managedId = ctx.managedId && teams[ctx.managedId] ? ctx.managedId : null;
  const followedId = ctx.followedId && teams[ctx.followedId] ? ctx.followedId : null;
  const round = Number.isFinite(ctx.displayRound) ? ctx.displayRound : displayRound(st);
  const numeral = roman(round);
  const total = Number.isFinite(ctx.totalTeams) ? ctx.totalTeams : Object.keys(teams).length;
  const common = {
    roman: numeral,
    roundLabel: numeral ? `Round ${numeral}` : 'Round',
    roundShort: numeral ? `R ${numeral}` : 'R',
    remain: `${(st?.aliveIds || []).length} of ${total} remain`,
  };
  if (managedId) {
    const team = teams[managedId];
    return { variant: 'manager', team: teamChip(team), name: team.name, role: 'Managed by you', ...common,
      stats: managerStats(state, ctx, managedId) };
  }
  const followed = followedId ? teams[followedId] : null;
  return { variant: 'spectator', team: teamChip(followed), name: 'Spectating',
    role: followed ? `Following ${followed.name}` : 'No team followed', ...common, stats: spectatorStats(state, ctx) };
}
