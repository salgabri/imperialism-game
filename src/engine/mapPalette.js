// Map colours that keep bordering empires apart. The user, 21 November 2026, of two clubs around Moscow painted in all
// but the same mauve: "never put this close colors next to each other".
//
// An empire's own colour (ownColour: a nation's chosen colour, a club's crest colour, an earlier season's club its
// twin's, a club with neither its map colour) is where its choice starts, not what it must wear. Each empire has a
// list of colours, cheapest first: its own; the same hue turned a little either way; a nation's other flag colours;
// any other hue, the nearest first; grey; each in the three lightness steps of theme.js empireFill. The empires choose
// one at a time in a fixed order: the managed empire keeps clay when the map paints it so; then clubs by strength (the
// clubs people know keep their colours), nations by their land, largest first. Each takes its cheapest colour that
// stands CLOSE apart (APART: a hair more), in both themes, from every bordering empire that chose before it, and, when
// it has to leave its own, from the first choices of those still to choose; a look-alike pair the order leaves is
// mended after. So of two look-alike neighbours the stronger keeps its colour and the weaker makes room.
//
// The order and the colours of kick-off hold all campaign long: on a later board each empire first tries the colour
// it started in, so it changes only when a conquest brings it a look-alike, or a neighbour that chose before it moved
// (about one empire a conquest, none in most). Nations start in their table colours (scripts/build-nation-colours.mjs
// keeps the same rule), so a world map at kick-off is the table.
//
// Flags (Crests) mode paints a club's land in its map colour (`col`, chosen by the map builders to differ from its
// neighbours at kick-off: scripts/lib/domestic-output.mjs) behind its crest: the same choice over that palette keeps
// clubs whose empires meet later in the campaign apart there too. Nations fly their flags and are left as they are.
//
// Pure: a function of the board, so the map, its key, the ledger and the share image paint an empire alike.
import { NATION_COLOURS } from '../data/nationColours.js';
import { empireColour } from '../data/empireColours.js';
import { clubColour } from '../data/clubColours.js';
import { twinOf } from '../data/crests.js';
import { V4, darkFill, empireFill, empireFillPair, paintTwin } from '../theme.js';
import { toOklch } from './colour.js';

/**
 * Political fills nearer than this read as one colour across a border: OKLab with lightness counted at L_WEIGHT (two
 * pastels of one hue read as one colour however light), in whichever theme has them nearer. As
 * scripts/build-nation-colours.mjs.
 */
export const CLOSE = 0.065;
/**
 * The gap the choice keeps: CLOSE and a little more, because two colours can give the same light fill with dark twins a
 * unit apart (theme.js empireFillPair), and the map paints one twin for both.
 */
export const APART = CLOSE + 0.002;
const L_WEIGHT = 0.4;
/** Flags mode's club colours (full-strength, one for both themes) nearer than this in OKLab read as one. */
export const FLAGS_CLOSE = 0.1;

const STEPS = [0, 1, 2];
const GREY_CHROMA = 0.04;      // as theme.js: a colour below this chroma draws grey
const OFF_STEP = 0.02;         // another lightness step than the empire's own
const TURNS = [[0, 0], [-18, 0.15], [18, 0.15], [-36, 0.3], [36, 0.3]]; // its own hue turned (degrees, cost)
const FIT_COST = 0.35, FIT_RANK = 0.01;   // its other fitting colours, the best first
const WHEEL = Array.from({ length: 12 }, (_, i) => i * 30); // any hue, at the band's full chroma
const WHEEL_COST = 0.6, WHEEL_TURN = 0.4; // + WHEEL_TURN for the far side of the wheel
const GREY_COST = 0.75;
// Flags: the map builders' palette (two lightness levels over a 24-step hue wheel at chroma 0.15).
const FLAG_WHEEL = [0.74, 0.6].flatMap(l => Array.from({ length: 24 }, (_, i) => ({ l, h: i * 15 })));
const FLAG_COST = 0.3, FLAG_TURN = 0.3, FLAG_LEVEL = 0.05;

const hueGap = (a, b) => {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
};
const lab = (colour, lWeight) => {
  const [L, C, H] = toOklch(colour);
  return [L * lWeight, C * Math.cos(H * Math.PI / 180), C * Math.sin(H * Math.PI / 180)];
};
const distance = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
/** The lightness step theme.js empireFill gives an id without one of its own. */
function idStep(id) {
  let x = 0;
  for (const ch of String(id)) x = (x * 31 + ch.charCodeAt(0)) >>> 0;
  return x % 3;
}

// ---- Political choices ----

/**
 * A political fill as a choice: the light literal, and both themes' points (the dark one from the twin its own colour
 * and step give, theme.js empireFillPair); `kind` says how far it strays from the empire's own colour.
 */
const politicalChoice = ({ light, dark }, cost, kind) => ({ fill: light, twin: dark, cost, kind, light: lab(light, L_WEIGHT),
  dark: lab(dark, L_WEIGHT) });
const politicalGap = (p, q) => Math.min(distance(p.light, q.light), distance(p.dark, q.dark));
const PINNED = Object.freeze(politicalChoice({ light: V4.youFill, dark: darkFill(V4.youFill) }, 0, 'you'));

/**
 * What an empire may wear on the political map, cheapest first: its own colour in its own lightness step (`step`), in
 * the others, turned a little; its other fitting colours (`fits`: a nation's flag colours, nationColours.js); any hue,
 * the nearest first; grey. An empire without a colour starts from its hash pastel (theme.js EMPIRE_PASTELS). Kept per
 * colour, step and fits.
 */
const choiceLists = new Map();
function politicalChoices(colour, step, id, fits = []) {
  const lch = colour ? toOklch(colour) : null;
  const key = `${lch ? colour : `~${empireFill(id)}`}|${step}|${fits.join(' ')}`;
  let list = choiceLists.get(key);
  if (list) return list;
  const out = new Map(); // fill → choice (the cheapest way to it)
  const add = (pair, cost, kind) => {
    if (!out.has(pair.light) || out.get(pair.light).cost > cost) out.set(pair.light, politicalChoice(pair, cost, kind));
  };
  const off = at => (at === step ? 0 : OFF_STEP);
  const own = at => (at === step ? 'own' : 'step');
  const grey = lch && lch[1] < GREY_CHROMA;
  if (!lch) add(empireFillPair(id), 0, 'own');
  else if (grey) for (const at of STEPS) add(empireFillPair('', colour, at), off(at), own(at));
  else {
    const [L, C, H] = lch;
    for (const [turn, cost] of TURNS) {
      const tinted = turn ? `oklch(${L.toFixed(4)} ${C.toFixed(4)} ${((H + turn + 360) % 360).toFixed(2)})` : colour;
      for (const at of STEPS) add(empireFillPair('', tinted, at), cost + off(at), turn ? 'turn' : own(at));
    }
  }
  fits.forEach((fit, i) => {
    if (toOklch(fit)) for (const at of STEPS) add(empireFillPair('', fit, at), FIT_COST + FIT_RANK * i + off(at), 'fit');
  });
  for (const hue of WHEEL) {
    const turn = lch && !grey ? hueGap(hue, lch[2]) / 180 : 0.5;
    for (const at of STEPS) add(empireFillPair('', `oklch(0.7 0.2 ${hue})`, at), WHEEL_COST + WHEEL_TURN * turn + off(at), 'wheel');
  }
  if (!grey) for (const at of STEPS) add(empireFillPair('', '#808080', at), GREY_COST + off(at), 'grey');
  list = [...out.values()].sort((a, b) => a.cost - b.cost);
  choiceLists.set(key, list);
  return list;
}

/**
 * The colour an empire's political fill starts from, its lightness step and its other fitting colours: a nation's
 * (nationColours.js); a club's crest colour, else that of its twin's crest, the one it wears (an earlier season's club,
 * src/data/crests.js), else its map colour (`team.col`), else none (its hash pastel). The twin is the one its own map
 * gives it (`team.twin`, null for none: engine/domestic.js decodeDomestic): a season's `f-<name>` id names namesakes in
 * other countries in other seasons, and the twin remembered last for that id may be one of theirs. Only a team that
 * carries no `twin` looks it up by id (crests.js twinOf).
 */
export function ownColour(id, team = null) {
  const nation = NATION_COLOURS[id];
  if (nation) return { colour: nation[0], step: nation[1], fits: nation[2] || [] };
  const twin = team?.twin !== undefined ? team.twin : twinOf(id);
  const colour = empireColour(id) || (twin && clubColour(twin)) || team?.col || null;
  return { colour: colour && toOklch(colour) ? colour : null, step: idStep(id), fits: [] };
}

// ---- Flags choices ----

const flagLists = new Map();
function flagChoices(col) {
  let list = flagLists.get(col);
  if (list) return list;
  const own = toOklch(col);
  const choice = (fill, cost) => ({ fill, cost, point: lab(fill, 1) });
  list = [choice(col, 0)];
  for (const { l, h } of FLAG_WHEEL) {
    const fill = `oklch(${l.toFixed(2)} 0.15 ${h})`;
    if (fill === col) continue;
    const turn = own[1] >= GREY_CHROMA ? hueGap(h, own[2]) / 180 : 0.5;
    list.push(choice(fill, FLAG_COST + FLAG_TURN * turn + (Math.abs(l - own[0]) > 0.02 ? FLAG_LEVEL : 0)));
  }
  list.sort((a, b) => a.cost - b.cost);
  flagLists.set(col, list);
  return list;
}
const flagGap = (p, q) => distance(p.point, q.point);

// ---- The choice ----

/**
 * Each of `order`'s empires takes a choice in turn: the cheapest of `choicesOf(id)` (sorted cheapest first) that is at
 * least `close` (by `gap`) from every neighbour that chose before it, else the one farthest from them. `fixed` holds
 * choices made already, never changed. A look-alike pair the order leaves (no choice was clear of the neighbours that
 * chose first: a small club ringed by nine others in nine colours) is then mended, the later empires first: one of the
 * two takes its cheapest choice clear of all its neighbours, itself before the other; else it takes its cheapest choice
 * that only one or two neighbours stand too near, and they move to choices clear of all of theirs.
 * → Map(id → choice)
 */
export function separate(order, neighboursOf, choicesOf, gap, close, fixed = new Map()) {
  const chosen = new Map(fixed);
  // The cheapest choice for `id` clear of `near`; with `fallback`, else the one farthest from them.
  const choose = (id, near, fallback) => {
    const choices = choicesOf(id);
    let far = null, farGap = -1;
    for (const choice of choices) {
      let least = Infinity;
      for (const other of near) least = Math.min(least, gap(choice, other));
      if (least >= close) return choice;
      if (least > farGap) { far = choice; farGap = least; }
    }
    return fallback ? far || choices[0] : null;
  };
  const chosenNear = id => {
    const near = [];
    for (const other of neighboursOf(id)) if (chosen.has(other)) near.push(chosen.get(other));
    return near;
  };
  const tooNear = (id, choice) => [...neighboursOf(id)].filter(other => chosen.has(other) && gap(choice, chosen.get(other)) < close);
  // `id` takes a choice whose one or two blockers can each move clear of all their neighbours.
  const moveBlockers = id => {
    const was = chosen.get(id);
    for (const choice of choicesOf(id)) {
      const blockers = tooNear(id, choice);
      if (blockers.length > 2 || blockers.some(other => fixed.has(other))) continue;
      const before = blockers.map(other => chosen.get(other));
      chosen.set(id, choice);
      if (blockers.every(other => {
        const clear = choose(other, chosenNear(other), false);
        if (clear) chosen.set(other, clear);
        return !!clear;
      })) return true;
      chosen.set(id, was);
      blockers.forEach((other, k) => chosen.set(other, before[k]));
    }
    return false;
  };
  for (const id of order) {
    if (chosen.has(id)) continue;
    const near = chosenNear(id);
    const choices = choicesOf(id);
    // Its first choice when that is clear; else, if it can, one that also leaves the first choices of the neighbours
    // still to choose free, so they need not move in turn.
    if (near.every(other => gap(choices[0], other) >= close)) { chosen.set(id, choices[0]); continue; }
    const later = [];
    for (const other of neighboursOf(id)) if (!chosen.has(other)) later.push(choicesOf(other)[0]);
    chosen.set(id, (later.length && choose(id, near.concat(later), false)) || choose(id, near, true));
  }
  for (let sweep = 0; sweep < 4; sweep++) {
    let mended = false;
    for (let i = order.length - 1; i >= 0; i--) {
      const id = order[i];
      if (fixed.has(id)) continue;
      const clashing = tooNear(id, chosen.get(id));
      if (!clashing.length) continue;
      const moved = [id, ...clashing].some(who => {
        if (fixed.has(who)) return false;
        const clear = choose(who, chosenNear(who), false);
        if (clear) chosen.set(who, clear);
        return !!clear;
      });
      if (moved || moveBlockers(id)) mended = true;
    }
    if (!mended) break;
  }
  return chosen;
}

/**
 * Bordering empires: id → Set of ids, from `own` (territory → empire) and `adj` (territory → its bordering
 * territories, WorldGeometry.adj).
 */
export function empireNeighbours(own, adj) {
  const out = new Map();
  const link = (a, b) => {
    if (!out.has(a)) out.set(a, new Set());
    out.get(a).add(b);
  };
  for (const [territory, owner] of Object.entries(own)) {
    if (owner == null) continue;
    if (!out.has(owner)) out.set(owner, new Set());
    for (const other of adj?.[territory] || []) {
      const neighbour = own[other];
      if (neighbour != null && neighbour !== owner) link(owner, neighbour);
    }
  }
  return out;
}

// A list of choices with `first` moved to its head (kept per list and first choice).
const reordered = new WeakMap();
function startingWith(first, list) {
  if (!first || list[0] === first) return list;
  let byFirst = reordered.get(list);
  if (!byFirst) reordered.set(list, byFirst = new Map());
  let out = byFirst.get(first);
  if (!out) byFirst.set(first, out = [first, ...list.filter(choice => choice !== first)]);
  return out;
}

/**
 * The choices on board `own`, empires choosing by `rank` (id → number, lower first; unranked last, by id). With
 * `start` (the kick-off's choices), each empire tries the colour it started in before its own list.
 */
function solve(own, adj, rank, teams, managedId, start = null) {
  const neighbours = empireNeighbours(own, adj);
  const order = [...neighbours.keys()].sort((a, b) => (rank.get(a) ?? Infinity) - (rank.get(b) ?? Infinity) || (a < b ? -1 : a > b ? 1 : 0));
  const near = id => neighbours.get(id) || [];
  const fixed = managedId != null && neighbours.has(managedId) ? new Map([[managedId, PINNED]]) : new Map();
  const choicesOf = id => {
    const { colour, step, fits } = ownColour(id, teams[id]);
    return politicalChoices(colour, step, id, fits);
  };
  const political = separate(order, near, id => startingWith(start?.political.get(id), choicesOf(id)), politicalGap, APART, fixed);
  // The managed empire is painted clay over its own colour (identityFill), which Flags mode shows without its flag.
  if (fixed.size) political.set(managedId, choicesOf(managedId)[0]);
  const clubs = order.filter(id => teams[id]?.col && teams[id].kind !== 'nation' && toOklch(teams[id].col));
  const isClub = new Set(clubs);
  const flagNear = id => [...near(id)].filter(other => isClub.has(other));
  const flags = separate(clubs, flagNear, id => startingWith(start?.flags.get(id), flagChoices(teams[id].col)), flagGap, FLAGS_CLOSE);
  return { political, flags, neighbours };
}

// The fills chosen (id → fill). The dark theme then paints each political fill with the twin it was measured with. One
// light fill paints one twin, so where empires wear one light fill from different colours (`neighbours` given: the
// political map), the twin of the last to choose it unless that leaves one of them nearer than CLOSE to a neighbour in
// the dark theme, then the first of the others' twins that does not (Cartaginés's light fill, worn by San Carlos too, on
// Costa Rica's maps of 2009/10 and 2010/11: San Carlos's twin had painted it 0.063 from bordering Goicoechea).
const fills = (choices, neighbours = null) => {
  const twinOf = new Map();
  for (const [, choice] of choices) if (choice.twin) twinOf.set(choice.fill, choice.twin);
  if (neighbours) {
    const holders = new Map();
    for (const [id, choice] of choices) if (choice.twin) (holders.get(choice.fill) ?? holders.set(choice.fill, []).get(choice.fill)).push(id);
    for (const [fill, ids] of holders) {
      const twins = [...new Set(ids.map(id => choices.get(id).twin).reverse())];
      if (twins.length < 2) continue;
      const clear = twin => ids.every(id => [...(neighbours.get(id) || [])].every(other => {
        const near = choices.get(other);
        // A pair already alike in the light theme no twin mends; else the dark theme must keep them apart too.
        return !near || distance(lab(fill, L_WEIGHT), lab(near.fill, L_WEIGHT)) < CLOSE
          || distance(lab(twin, L_WEIGHT), lab(twinOf.get(near.fill) ?? near.twin ?? near.fill, L_WEIGHT)) >= CLOSE;
      }));
      twinOf.set(fill, twins.find(clear) ?? twins[0]);
    }
  }
  for (const [fill, twin] of twinOf) paintTwin(fill, twin);
  return new Map([...choices].map(([id, choice]) => [id, choice.fill]));
};
// Kick-off solutions, per starting board and managed empire.
const kickoffs = new WeakMap();
function kickoff(home, adj, areaOf, ranks, teams, managedId) {
  let byManaged = kickoffs.get(home);
  if (!byManaged) kickoffs.set(home, byManaged = new Map());
  const cached = byManaged.get(managedId);
  if (cached?.adj === adj && cached.ranks === ranks) return cached;
  // By `ranks` (the strongest club first), then the larger the land an empire starts on, the earlier it chooses.
  const area = new Map();
  for (const [territory, id] of Object.entries(home)) {
    if (id != null) area.set(id, (area.get(id) || 0) + (Number(areaOf(territory)) || 0));
  }
  const at = id => ranks?.get(id) ?? Infinity;
  const rank = new Map([...area.keys()].sort((a, b) => at(a) - at(b) || area.get(b) - area.get(a) || (a < b ? -1 : a > b ? 1 : 0))
    .map((id, i) => [id, i]));
  const choices = solve(home, adj, rank, teams, managedId);
  const start = { adj, ranks, rank, ...choices, palette: { political: fills(choices.political, choices.neighbours), flags: fills(choices.flags) } };
  byManaged.set(managedId, start);
  return start;
}

/**
 * The order clubs choose their colours in: the strongest first (`str`, the map's own rating, not a campaign's), so the
 * clubs people know keep theirs. → Map(id → rank) for empirePalette's `ranks`; kept per club list.
 */
const clubRankCache = new WeakMap();
export function clubRanks(clubs) {
  if (!Array.isArray(clubs)) return null;
  let ranks = clubRankCache.get(clubs);
  if (!ranks) {
    const order = clubs.map((club, i) => [club.id, Number(club.str), i])
      .sort((a, b) => (Number.isFinite(b[1]) ? b[1] : -Infinity) - (Number.isFinite(a[1]) ? a[1] : -Infinity) || a[2] - b[2]);
    ranks = new Map(order.map(([id], i) => [id, i]));
    clubRankCache.set(clubs, ranks);
  }
  return ranks;
}

/**
 * The map's colours for the board `own` (territory → empire id, as the map paints it) over `adj` (WorldGeometry.adj).
 * `home` is the board the empires started on (territory → id; `own` itself in setup, the same object kept for the
 * whole campaign). The empires choose in one order all campaign long: by `ranks` (clubRanks: the strongest club first)
 * where given, then by the area of their starting land (`areaOf(territory)`), largest first. On `home` each empire
 * tries its own colour first; on a later board, the colour it had at kick-off, so it keeps that unless a conquest brings
 * a look-alike to its borders. `teams` (id → team) give a club's map colour (`col`); `managedId`, when the map paints
 * that empire clay (identityFill's `meFill`), keeps clay and its neighbours keep clear of it. Every empire on the board
 * gets a political fill (a light literal for themedPaint), and every club with a map colour a Flags colour.
 * → { political: Map(id → fill), flags: Map(id → colour) }
 */
export function empirePalette({ own, adj, home = own, areaOf = () => 1, ranks = null, teams = {}, managedId = null }) {
  const start = kickoff(home || own, adj, areaOf, ranks, teams, managedId ?? null);
  if (own === (home || own)) return start.palette;
  const choices = solve(own, adj, start.rank, teams, managedId ?? null, start);
  return { political: fills(choices.political, choices.neighbours), flags: fills(choices.flags) };
}

