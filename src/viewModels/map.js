// Owner: WP-MAP (see PLAN.md §4). Map view-models (PLAN §3.6). Pure: (state, ctx) in, plain data out; no window,
// document, timers or campaign RNG (win chances use estimateWinProbability's own generator, DEC D5). Every builder
// tolerates the tests' tiny atlas, phase 'loading'/'setup', `stats: {}` and matches without odds/route/live fields.
// strengthSteps was written final by WP-0 in W1: its signature and semantics are FROZEN (WP-COL's key reads it).
import { teamEff, NATIONS, DEPENDENCIES } from '../data/teams.js';
import { MAP, V4 } from '../theme.js';
import { politicalFill } from '../data/empireColours.js';
import { memo, roman, historyRound, winTone } from './format.js';
import { matchupOdds, winChanceFor } from './odds.js';
import { reachableTargets } from '../engine/turns.js';

/** Switch order (README §Map rendering): Political (default, DEC D18) · Strength · Fronts · Flags. */
export const MAP_MODES = Object.freeze(['political', 'strength', 'fronts', 'flags']);
export const DEFAULT_MAP_MODE = 'political';
export const MAP_MODE_LABELS = Object.freeze({ political: 'Political', strength: 'Strength', fronts: 'Fronts', flags: 'Flags' });

const isPlaying = st => st?.phase === 'playing' || st?.phase === 'victory';
const effOf = team => {
  if (!team) return NaN;
  try { return teamEff(team); } catch { return NaN; }
};

/** A-7: the map's "you" is the managed team, else the followed team (spectator). */
export function mapMeId(st, ctx = {}) {
  const teams = st?.teams || {};
  const managed = ctx?.managedId ?? null;
  if (managed && teams[managed]) return managed;
  const followed = ctx?.followedId !== undefined ? ctx.followedId : st?.followedId;
  return followed && teams[followed] ? followed : null;
}

/**
 * DEC D19 / A-7: the side facing "you" once the fixture is known — the selected target while you choose
 * (managed only), a locked draw, the tactical gate or an unapplied match. Never during a spin, before the
 * draw, or on the conquest screen (D1 has no target).
 */
export function mapOpponentId(st, ctx = {}) {
  if (!isPlaying(st) || st.choice) return null;
  const me = mapMeId(st, ctx);
  if (!me) return null;
  const teams = st.teams || {};
  const pending = st.pendingTarget;
  if (pending && ctx?.managedId === me && pending.attackerId === me) {
    return teams[pending.selectedId] ? pending.selectedId : null;
  }
  const pairs = [];
  if (st.spin?.stage === 'locked') pairs.push([st.spin.attackerId, st.spin.targetId]);
  if (st.tacticalChoice) pairs.push([st.tacticalChoice.aId, st.tacticalChoice.dId]);
  if (st.match && !st.match.applied) pairs.push([st.match.aId, st.match.dId]);
  for (const [a, d] of pairs) {
    const other = a === me ? d : d === me ? a : null;
    if (other && teams[other]) return other;
  }
  return null;
}

/** WorldMap identity props: `meFill` only for a managed empire (a followed empire keeps its pastel, A-7). */
export function mapIdentity(st, ctx = {}) {
  const meId = mapMeId(st, ctx);
  return { meId, meFill: !!meId && meId === (ctx?.managedId ?? null), opponentId: mapOpponentId(st, ctx) };
}

/**
 * Strength mode fills (DEC D18): every alive empire's step by current strength, lightest = weakest, read from
 * strengthSteps itself so the map and the key ("74.2+") cannot disagree → { [teamId]: colour }. An empire takes
 * the highest step whose label it reaches (`eff ≥ min`; `min` is floored to one decimal, so the team that defines
 * a step, and every team tied with it, is in that step). When several steps share a label (fewer than five
 * distinct strengths), the lowest of them is used, so the weakest empire is always the lightest and the strongest
 * the darkest.
 */
export function strengthFills(st, ctx = {}) {
  const teams = st?.teams || {};
  const ids = (st?.aliveIds || []).filter(id => teams[id]);
  if (!ids.length) return {};
  return memo(ctx?.cache, 'map:strength-fills', [st.teams, st.aliveIds], () => {
    const steps = strengthSteps(st, ctx);
    const out = {};
    if (!steps.length) return out;
    for (const id of ids) {
      const eff = effOf(teams[id]);
      if (!Number.isFinite(eff)) continue;
      out[id] = strengthStepOf(steps, eff).color;
    }
    return out;
  });
}

/** The step an empire of strength `eff` is painted with (see strengthFills); steps are sorted by `min`. */
function strengthStepOf(steps, eff) {
  let pick = steps[0];
  // 1e-9 absorbs float noise in the one-decimal floor, so a step's own team never drops below its label.
  for (const step of steps) if (step.min > pick.min && eff + 1e-9 >= step.min) pick = step;
  return pick;
}

/**
 * "Your" side of the pending fixture, exactly as the fronts table and the fixture block read it (viewModels/
 * campaign.js pendingFixture + fixtureOverride): a live match uses its own odds, the tactical gate and a locked
 * draw the default-approach estimate in the fixture's orientation; nothing while the compass still spins (D19).
 * → { opponentId, p } | null
 */
export function fixtureWinChance(st, ctx = {}, me = mapMeId(st, ctx)) {
  const teams = st?.teams || {};
  if (!me || !teams[me]) return null;
  let pair = null;
  const m = st.match, tc = st.tacticalChoice, spin = st.spin;
  if (m && !m.applied && !m.done && teams[m.aId] && teams[m.dId]) pair = { kind: 'live', aId: m.aId, dId: m.dId };
  else if (tc && teams[tc.aId] && teams[tc.dId]) pair = { kind: 'tactical', aId: tc.aId, dId: tc.dId };
  else if (spin && teams[spin.attackerId] && teams[spin.targetId]) {
    pair = { kind: spin.stage === 'locked' ? 'locked' : 'drawing', aId: spin.attackerId, dId: spin.targetId };
  }
  if (!pair || pair.kind === 'drawing' || (pair.aId !== me && pair.dId !== me)) return null;
  const attacking = pair.aId === me;
  let p = null;
  if (pair.kind === 'live') {
    p = m.odds ? Number(attacking ? m.odds.a : m.odds.b) : null;
  } else {
    const odds = memo(ctx?.cache, 'map:fixture-odds',
      [st.teams, pair.aId, pair.dId, ctx?.managedId ?? null, ctx?.drama, ctx?.sport],
      () => matchupOdds(st, ctx, pair.aId, pair.dId));
    p = odds ? (attacking ? odds.attacker : odds.defender) : null;
  }
  return Number.isFinite(p) ? { opponentId: attacking ? pair.dId : pair.aId, p } : null;
}

/**
 * Fronts mode fills (DEC D18, D4, D5): "your" fronts — the land tier of reachableTargets, else every reachable
 * target — tinted by your win chance (gain ≥60 / even 45–59 / loss <45 on the displayed integer). The current
 * fixture's opponent uses the fixture's own probability (fixtureWinChance), so the map agrees with the table
 * (RM §1.9). null when there is no "you" (the map then stays political) → { [teamId]: tint } otherwise.
 */
export function frontsFills(st, ctx = {}) {
  const me = mapMeId(st, ctx);
  if (!me || !ctx?.board || !isPlaying(st)) return null;
  const fixture = fixtureWinChance(st, ctx, me);
  return memo(ctx.cache, 'map:fronts-fills',
    [st.own, st.teams, st.aliveIds, me, ctx.sport, ctx.drama, fixture?.opponentId ?? null, fixture?.p ?? null], () => {
      let reach = [];
      try { reach = reachableTargets(ctx.board, me) || []; } catch { reach = []; }
      const land = reach.filter(row => row.tier === 'land');
      const out = {};
      for (const row of land.length ? land : reach) {
        const p = fixture && fixture.opponentId === row.tid ? fixture.p : winChanceFor(st, ctx, me, row.tid);
        if (p == null) continue;
        out[row.tid] = MAP.frontsTint[winTone(p)] || MAP.frontsTint.even;
      }
      return out;
    });
}

/**
 * Identity fills on top of a base fill (README §Map rendering, DEC D18/D19). Flags mode and flag-patterned
 * land are never recoloured. Your empire is you-fill only with `meFill`; the next opponent is opponent-fill
 * except in Fronts mode, where its win-chance tint is the information. WorldMap applies the same rule.
 */
export function identityFill(baseFill, { ownerId, meId, meFill, opponentId, mapMode } = {}) {
  if (!ownerId || mapMode === 'flags' || baseFill === 'transparent' || String(baseFill).startsWith('url(')) return baseFill;
  if (meFill && meId && ownerId === meId) return V4.youFill;
  if (opponentId && ownerId === opponentId && mapMode !== 'fronts') return V4.opponentFill;
  return baseFill;
}

/**
 * One country's fill (mapCountries). Rules in order: flag parts → transparent; unowned → a country map's setup
 * preview (`preview`: the club starting in that section) in the colour it takes at kick-off, else setup nations
 * pastel, otherwise land-neutral; Flags mode → club colour (clubs fly no flag) or pastel; Strength → ramp; Fronts →
 * tint for your fronts, land-neutral elsewhere; Political → the pastel of the empire's own colour (politicalFill); then
 * identityFill().
 */
export function countryFill({ countryId, ownerId = null, owner = null, mapMode = DEFAULT_MAP_MODE, hasFlagParts = false,
  setup = false, meId = null, meFill = false, opponentId = null, strength = null, fronts = null, preview = null } = {}) {
  if (hasFlagParts) return 'transparent';
  if (!ownerId || !owner) {
    // Decoded club rows carry no `kind`, hence their own parameter: Flags = the club colour, Political = its pastel.
    if (preview?.id) return mapMode === 'flags' && preview.col ? preview.col : politicalFill(preview.id);
    return setup && NATIONS[countryId] ? politicalFill(countryId) : V4.landNeutral;
  }
  if (mapMode === 'flags') return owner.kind === 'club' && owner.col ? owner.col : politicalFill(ownerId);
  const base = mapMode === 'strength' ? strength?.[ownerId] || politicalFill(ownerId)
    : mapMode === 'fronts' && fronts ? fronts[ownerId] || V4.landNeutral
      : politicalFill(ownerId);
  return identityFill(base, { ownerId, meId, meFill, opponentId, mapMode });
}

/** The last conquest that brought `cid` to `ownerId`, newest first (history entries are matchCard models). */
function lastConquestOf(history, ownerId, cid) {
  for (let i = (history?.length || 0) - 1; i >= 0; i--) {
    const entry = history[i];
    const result = entry?.result;
    if (result && (result.winnerId ?? entry.winnerId) === ownerId && (result.territoryIds || []).includes(cid)) return entry;
  }
  return null;
}

/**
 * A history tie-break, oriented like the winner-first line it follows. The stored shoot-out text is attacker
 * first (matchMethods: `${tie.ga}–${tie.gd} on penalties`), so a defender's win swaps the kicks (as
 * conquest.js buildElimination does); overtime copy has no orientation and is only lower-cased.
 */
function winnerFirstTie(tieText, attackerWon) {
  if (!tieText) return '';
  const kicks = String(tieText).match(/^(\d+)–(\d+) on penalties$/);
  if (kicks) return attackerWon ? `${kicks[1]}–${kicks[2]} on penalties` : `${kicks[2]}–${kicks[1]} on penalties`;
  return `${tieText.charAt(0).toLowerCase()}${tieText.slice(1)}`;
}

function wonLine(entry, ownerId) {
  const aWon = (entry.a?.tid ?? entry.a?.teamId ?? entry.aId) === ownerId;
  const winner = aWon ? entry.a : entry.b, loser = aWon ? entry.b : entry.a;
  if (!winner || !loser) return null;
  const tie = winnerFirstTie(entry.result?.tieText, aWon);
  const tail = tie ? ` · ${tie}` : '';
  return `Won ${winner.score}–${loser.score} against ${loser.name || entry.result?.loserName || ''}${tail}`;
}

/**
 * Hover tooltip (README §Interactions): name (CSS uppercases it), "Held by Italy since Round XII" |
 * "Capital of Italy" | "Held by Italy", "Won 2–1 against Austria" | "Strength 84.6", "Click to open the Italy
 * squad". Unowned land: "Not in this theatre" (playing) / "Awaiting campaign" (setup), no link.
 * A country map names its sections (`ctx.sectionNames`): "Home of Burnley" on a club's home section, and in setup
 * the club starting there (`ctx.homeClubs`: "Home of Burnley" on its home section, "Burnley starts here" on the rest of
 * its starting group), else "Awaiting campaign"; an unheld section reads "Unclaimed".
 * → { visible, name, held, result, link }.
 */
export function tooltipModel(st, ctx = {}, cid) {
  const hidden = { visible: false, name: '', held: null, result: null, link: null };
  if (!cid) return hidden;
  const section = ctx?.sectionNames?.[cid] || null;
  const nation = NATIONS[cid], dependency = DEPENDENCIES[cid];
  if (!section && !nation && !dependency) return hidden;
  const name = section || nation?.[0] || dependency.name;
  const playing = isPlaying(st);
  const ownerId = playing ? st.own?.[cid] : null;
  const owner = ownerId ? st.teams?.[ownerId] : null;
  if (!owner) {
    const starting = section && !playing ? ctx?.homeClubs?.[cid] : null;
    const held = !starting ? (playing ? section ? 'Unclaimed' : 'Not in this theatre' : 'Awaiting campaign')
      : (starting.homeSection ?? cid) === cid ? `Home of ${starting.name}` : `${starting.name} starts here`;
    return { visible: true, name, held, result: null, link: null };
  }
  const conquest = lastConquestOf(st.history, ownerId, cid);
  const round = conquest ? roman(historyRound(conquest)) : '';
  const held = conquest && round ? `Held by ${owner.name} since Round ${round}`
    : cid === owner.home ? `${section ? 'Home' : 'Capital'} of ${owner.name}` : `Held by ${owner.name}`;
  const eff = effOf(owner);
  const result = (conquest && wonLine(conquest, ownerId)) || (Number.isFinite(eff) ? `Strength ${eff.toFixed(1)}` : null);
  return { visible: true, name, held, result, link: `Click to open the ${owner.name} squad` };
}

/**
 * Phone frame (A-7, README §A 390, M§8): the union of the bounding boxes of your holdings and your next
 * opponent's, dependencies excluded → { x, y, w, h } | null. While you choose a target it is you + every empire
 * in reach (`pendingTarget.optionIds`), so all of them can be tapped and changing the selection never moves the
 * camera. WorldMap frames it with NEAR_LAYOUT below 700px unless the player asked for the whole map. Values only
 * change when those holdings, the reach or the opponent change.
 */
export function nearFocus(st, ctx = {}) {
  if (!isPlaying(st)) return null;
  const meId = mapMeId(st, ctx);
  const paths = ctx?.displayGeo?.paths || ctx?.geo?.paths;
  if (!meId || !paths) return null;
  const pending = st.pendingTarget;
  const choosing = !st.choice && pending && ctx?.managedId === meId && pending.attackerId === meId
    && Array.isArray(pending.optionIds) && pending.optionIds.length > 0;
  const others = choosing ? pending.optionIds.filter(id => id !== meId) : [mapOpponentId(st, ctx)].filter(Boolean);
  const framed = new Set([meId, ...others]);
  return memo(ctx.cache, 'map:near', [st.own, meId, `${choosing ? 'reach' : 'opponent'}:${others.join(',')}`, ctx.geo, ctx.displayGeo], () => {
    const boxes = [];
    for (const [cid, owner] of Object.entries(st.own || {})) {
      if (!framed.has(owner) || DEPENDENCIES[cid]) continue;
      const box = (ctx.displayGeo?.paths?.[cid] || ctx.geo?.paths?.[cid])?.bbox;
      if (box && [box.x, box.y, box.w, box.h].every(Number.isFinite)) boxes.push(box);
    }
    if (!boxes.length) return null;
    const x = Math.min(...boxes.map(b => b.x)), y = Math.min(...boxes.map(b => b.y));
    const right = Math.max(...boxes.map(b => b.x + b.w)), bottom = Math.max(...boxes.map(b => b.y + b.h));
    return { x, y, w: right - x, h: bottom - y };
  });
}

/**
 * Strength-mode legend and fill steps (DEC D18, A-11): quintile lower bounds of the alive teams' strength,
 * lowest first → [{ min: 74.2, color: MAP.strengthRamp[i] }] × 5; [] when no team is alive.
 * `min` is floored to one decimal, so every team of a step is ≥ its label.
 */
export function strengthSteps(st, ctx = {}) {
  const teams = st?.teams || {};
  const ids = (st?.aliveIds || []).filter(id => teams[id]);
  if (!ids.length) return [];
  return memo(ctx?.cache, 'map:strength-steps', [st.teams, st.aliveIds], () => {
    const effs = ids.map(id => {
      try { return teamEff(teams[id]); } catch { return NaN; }
    }).filter(Number.isFinite).sort((a, b) => a - b);
    if (!effs.length) return [];
    return MAP.strengthRamp.map((color, i) => ({
      min: Math.floor(effs[Math.floor(i * effs.length / MAP.strengthRamp.length)] * 10) / 10,
      color,
    }));
  });
}
