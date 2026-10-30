// Owner: WP-SETUP (see PLAN.md §4). Pure view model for the three-step setup wizard (PLAN A-5, M§1.8, M§3):
// Campaign → Rules (the draw, Show matches, More rules) → Your role (role, team and, for a manager, the opponent choice).
// The in-game settings panel reads the same option lists, Show matches helpers and `campaignFacts`.
// Everything here is a pure function of the setup record and the opening teams App already computes
// (`setupTeams()` → `managerTeams`): no window/document, no RNG, no timers. Caches are keyed by immutable data.
import { NATIONS, SCOPES } from '../../data/teams.js';
import { CLUB_SCOPES } from '../../data/scopes.js';
import { DOMESTIC } from '../../data/domestic.js';
import { nationPriority } from '../../data/domesticTiers.js';
import { clubMapOf, domesticEntry, domesticLabel, isDomesticScope } from '../../data/domesticScope.js';
import { SPORT_LIST, getSport } from '../../sports/index.js';
import { BUILT_IN_SEASON, fieldedNations } from '../../engine/footballSets.js';
import { V4, ratingTierOf } from '../../theme.js';
import { politicalFill } from '../../data/empireColours.js';

export const PACING_OPTIONS = [['duel', 'One by one'], ['blitz', 'Blitz round'], ['chaos', 'Chaos draw']];
export const RESOLUTION_OPTIONS = [['ticker', 'Live ticker'], ['instant', 'Instant result']];
export const PACING_HELP = {
  duel: 'One attacker and a compass direction choose one reachable opponent. One match per round. Separated teams use coastal sea routes or a neutral transit treaty; neutral land stays unclaimed.',
  blitz: 'Pair every team, preferring neighbours, then other opponents. The field roughly halves each round; an odd team gets a bye. Distant pairings ignore directional route restrictions; neutral land stays unclaimed.',
  chaos: 'Draw neighbour-preferred matchups until a team would repeat, then resolve the batch. Round size varies. Distant pairings ignore directional route restrictions; neutral land stays unclaimed.',
};

export function campaignPreview(count, sport, setup) {
  const matches = Math.max(0, count - 1);
  const extra = setup.finale === 'best-of-three' ? '–' + (matches + 2) : '';
  const seconds = setup.express ? 2.5 : setup.resolution === 'instant' ? 5 : sport.clock.length * sport.clock.msPerUnit / 1000 + 7;
  const minutes = Math.max(1, Math.ceil(matches * seconds / 60));
  return { matches: `${matches}${extra}`, duration: `about ${minutes}–${Math.ceil(minutes * 1.35)} min at 1× autoplay` };
}

/** Wizard steps (M§1.8, M§3.3). `pending` is the rail subtitle until the step is done. */
export const SETUP_STEPS = Object.freeze([
  { n: 1, id: 'campaign', title: 'Campaign', pending: 'Sport, teams, theatre', next: 'Next: Rules', note: 'The default rules suit a first campaign' },
  { n: 2, id: 'rules', title: 'Rules', pending: 'How matches are drawn', next: 'Next: Your role', note: 'Rules are fixed at launch; Show matches can change any time' },
  { n: 3, id: 'role', title: 'Your role', pending: 'Manage a team, or watch', next: 'Launch campaign', note: 'Rules are fixed at launch' },
]);

/** The draw's name in setup, the rail summary and the in-game settings: one-by-one turn order, else the pacing. */
export const DRAW_NAMES = Object.freeze({ random: 'Random draw', 'round-robin': 'Round robin', blitz: 'Blitz round', chaos: 'Chaos draw' });

/**
 * Step 2's one rules choice: pacing and the one-by-one turn order as four cards (M§3.4 card pattern). `pacing` /
 * `turnOrder` are the stored values a card writes; Blitz and Chaos leave `turnOrder` alone (DEC D2 normalises it at
 * launch). `dots`: on | current | off squares. `dotStyle` picks the fill rule: `rand` filled squares are `muted` until
 * that card is selected; the others are always `you`.
 */
export const DRAW_CARDS = Object.freeze([
  { value: 'random', title: DRAW_NAMES.random, tag: 'Recommended', tone: 'you', dotStyle: 'rand', dots: ['off', 'on', 'off', 'off', 'on'],
    pacing: 'duel', turnOrder: 'random',
    body: 'One match per turn. A random team is drawn to attack, so some teams attack often and some wait.' },
  { value: 'round-robin', title: DRAW_NAMES['round-robin'], dotStyle: 'rr', dots: ['on', 'on', 'current', 'off', 'off'],
    pacing: 'duel', turnOrder: 'round-robin',
    body: 'One match per turn. Every team attacks once per round, strongest first.' },
  { value: 'blitz', title: DRAW_NAMES.blitz, dotStyle: 'all', dots: ['on', 'on', 'on', 'on', 'on'], pacing: 'blitz',
    body: 'Teams are paired off each round, with a neighbour where possible; with an odd number, one sits out. The field roughly halves each round.' },
  { value: 'chaos', title: DRAW_NAMES.chaos, dotStyle: 'rand', dots: ['on', 'off', 'on', 'on', 'off'], pacing: 'chaos',
    body: 'Matches are drawn, mostly between neighbours, until a team would play twice, so the number of matches each round varies.' },
]);

/** Step 3's opponent choice: a manager under a one-match draw only (DEC D2). `body` is the help under the control. */
export const TARGETING_CARDS = Object.freeze([
  { value: 'player', title: 'You choose',
    body: "On your team's turn you pick any rival in reach on the map. Every other team spins the compass." },
  { value: 'compass', title: 'Compass',
    body: 'A spinning compass picks your opponent, as it does for every other team.' },
]);

export const ROLE_CARDS = Object.freeze([
  { value: 'manager', title: 'Manager',
    body: 'Run one team. Choose its approach before each match and one of up to three signings after each win.' },
  { value: 'spectator', title: 'Spectator',
    body: 'Watch the war play out on its own. Nothing waits for you, and you can follow any team once it starts.' },
]);

/** The conquest rules the old setup intro listed (ui-interaction contract copy). */
export const CONQUEST_RULES = Object.freeze([
  "Win a match to take all of the loser's territories.",
  'Claim a player; some signings add bench options.',
  'Last team standing wins.',
]);

/** "More rules": the launch-fixed options behind step 2's disclosure, shared with the in-game settings. */
export const UNCERTAINTY_OPTIONS = Object.freeze([['predictable', 'Predictable'], ['balanced', 'Balanced'], ['wild', 'Wild']]);
export const UNCERTAINTY_HELP = {
  predictable: 'The stronger team usually wins.',
  balanced: 'The stronger team is favoured, but upsets happen.',
  wild: 'Underdogs win more often.',
};
export const FINALE_OPTIONS = Object.freeze([['single', 'Single match'], ['best-of-three', 'Best of three']]);
export const FINALE_HELP = {
  single: 'One match decides the champion.',
  'best-of-three': 'The last two teams play until one has won twice.',
};
export const RECRUITMENT_OPTIONS = Object.freeze([['highest-rated', 'Best-rated player'], ['best-fit', 'Best lineup fit']]);
export const RECRUITMENT_HELP = {
  'highest-rated': "After a win, a team you don't manage signs the loser's highest-rated player.",
  'best-fit': "After a win, a team you don't manage signs the loser's player who most improves its starting lineup.",
};
export const ROSTER_OPTIONS = Object.freeze([['authentic', 'Real-world'], ['competitive', 'Evened out']]);
export const ROSTER_HELP = {
  authentic: 'Teams start at their real-world strength.',
  competitive: 'The gaps between strong and weak teams shrink; each roster keeps its own stars.',
};

/**
 * "Show matches": `resolution` and `express` as one choice that can change any time. Express already reveals every
 * match at once (matchMethods `presentMatch`), so Fast-forward is the third mode. Read: express wins over resolution.
 */
export const SHOW_MATCH_OPTIONS = Object.freeze([['ticker', 'Live, minute by minute'], ['instant', 'Final score only'], ['express', 'Fast-forward']]);
export const SHOW_MATCH_HELP = {
  ticker: 'Scores and events appear as the match clock runs.',
  instant: 'Each match skips straight to its final score.',
  express: 'Final scores only. Routine matches flash past; yours, upsets and the final still pause. Your decisions still wait.',
};
export const SHOW_MATCH_BUSY = 'You can switch between Live and Final score only after this draw or match.';

const nameOf = (options, id, fallback) => (options.find(([key]) => key === id) || options.find(([key]) => key === fallback))[1];
const valid = (options, id, fallback) => (options.some(([key]) => key === id) ? id : fallback);

export const showMatchesOf = (settings = {}) => (settings?.express ? 'express' : settings?.resolution === 'instant' ? 'instant' : 'ticker');

/**
 * The [key, value] writes that select Show matches `mode`, only for keys that change. Fast-forward writes `express`
 * only, so it never needs the `resolution` write `setSetting` refuses during a draw or a live match.
 */
export function showMatchesWrites(mode, settings = {}) {
  const express = !!settings?.express;
  const resolution = settings?.resolution === 'instant' ? 'instant' : 'ticker';
  if (mode === 'express') return express ? [] : [['express', true]];
  const writes = express ? [['express', false]] : [];
  if ((mode === 'ticker' || mode === 'instant') && mode !== resolution) writes.push(['resolution', mode]);
  return writes;
}

/** Show matches options; while `busy` (a draw or live match), the modes that need a `resolution` write are disabled. */
export function showMatchOptions(settings = {}, { busy = false } = {}) {
  const current = showMatchesOf(settings);
  const resolution = settings?.resolution === 'instant' ? 'instant' : 'ticker';
  return SHOW_MATCH_OPTIONS.map(([value, label]) => ({
    value, label, disabled: busy && value !== current && value !== 'express' && value !== resolution,
  }));
}

/** The More rules summary line: "Standard", or only what differs from the defaults. */
export function moreRulesSummary(setup = {}) {
  const parts = [];
  const uncertainty = valid(UNCERTAINTY_OPTIONS, setup.uncertainty, 'balanced');
  if (uncertainty !== 'balanced') parts.push(`Upsets: ${nameOf(UNCERTAINTY_OPTIONS, uncertainty)}`);
  if (setup.finale === 'best-of-three') parts.push(`Final: ${nameOf(FINALE_OPTIONS, 'best-of-three')}`);
  if (setup.acquisitionPolicy === 'best-fit') parts.push(`Computer signings: ${nameOf(RECRUITMENT_OPTIONS, 'best-fit')}`);
  if (setup.rosterPreset === 'competitive' && getSport(setup.sport).id === 'basketball') {
    parts.push(`Team strengths: ${nameOf(ROSTER_OPTIONS, 'competitive')}`);
  }
  const seed = String(setup.seed ?? '').trim();
  if (seed) parts.push(`Seed ${seed}`);
  return parts.length ? parts.join(' · ') : 'Standard';
}

/**
 * The in-game settings' read-only "This campaign" rows, from the launched settings. Missing or unknown values read as
 * their defaults, so old saves and partial fixtures never show `undefined`. `stored` is the value behind the text.
 * → [{ id, label, value, stored, inner?: { id, stored }, num? }]
 */
export function campaignFacts(settings = {}, { seed = null, managementEnded = false, managedName = null } = {}) {
  const s = settings || {};
  const pacing = valid(PACING_OPTIONS, s.pacing, 'duel');
  const duel = pacing === 'duel';
  const turnOrder = s.turnOrder === 'round-robin' ? 'round-robin' : 'random';
  const targeting = s.targeting === 'player' ? 'player' : 'compass';
  const role = s.role === 'manager' ? 'manager' : 'spectator';
  const uncertainty = valid(UNCERTAINTY_OPTIONS, s.uncertainty, 'balanced');
  const finale = valid(FINALE_OPTIONS, s.finale, 'single');
  const recruitment = valid(RECRUITMENT_OPTIONS, s.acquisitionPolicy, 'highest-rated');
  const roster = valid(ROSTER_OPTIONS, s.rosterPreset, 'authentic');
  const roleText = role !== 'manager' ? 'Spectator'
    : managementEnded ? (managedName ? `Spectator · ${managedName} knocked out` : 'Spectator · knocked out')
      : managedName ? `Manager · ${managedName}` : 'Manager';
  const rows = [
    { id: 'role', label: 'Your role', value: roleText, stored: role },
    { id: 'pacing', label: 'Draw', value: DRAW_NAMES[duel ? turnOrder : pacing], stored: pacing,
      ...(duel ? { inner: { id: 'turn-order', stored: turnOrder } } : {}) },
  ];
  if (duel) {
    const choosing = targeting === 'player' && role === 'manager' && !managementEnded;
    rows.push({ id: 'targeting', label: 'Opponents', value: choosing ? 'You choose on your turns' : 'Compass', stored: targeting });
  }
  rows.push(
    { id: 'uncertainty', label: 'Upsets', value: nameOf(UNCERTAINTY_OPTIONS, uncertainty), stored: uncertainty },
    { id: 'finale', label: 'Final', value: nameOf(FINALE_OPTIONS, finale), stored: finale },
    { id: 'recruitment', label: 'Computer signings', value: nameOf(RECRUITMENT_OPTIONS, recruitment), stored: recruitment },
  );
  if (s.sport === 'basketball') rows.push({ id: 'roster-preset', label: 'Team strengths', value: nameOf(ROSTER_OPTIONS, roster), stored: roster });
  if (seed != null && String(seed) !== '') rows.push({ id: 'seed', label: 'Seed', value: String(seed), stored: String(seed), num: true });
  return rows;
}

/** Step 1's estimate footnote: which Show matches mode the length assumes, and what adds time. */
export function estimateNote(showMatches, role) {
  const mode = { ticker: 'live matches', instant: 'final scores only', express: 'Fast-forward' }[showMatches] || 'live matches';
  const extra = role === 'manager'
    ? (showMatches === 'ticker' ? ' Ties and your decisions add time.' : ' Your decisions add time.')
    : (showMatches === 'ticker' ? ' Ties add time.' : '');
  return `Estimated with ${mode} at 1× speed.${extra}`;
}

/** Setup caches key on the data set build, so a set's nations and clubs never collide with the built-in ones. */
const sportKey = sport => sport.dataVersion || sport.id;

const nationCountCache = new Map();
function nationCounts(sport) {
  const key = sportKey(sport);
  if (!nationCountCache.has(key)) {
    // A data set's season can leave out shapes merged into another federation or with none.
    const nations = fieldedNations(sport).map(id => NATIONS[id]);
    nationCountCache.set(key, Object.fromEntries(SCOPES.map(scope => [scope.id, scope.id === 'world'
      ? nations.length
      : scope.id === 'elite' ? Math.min(32, nations.length) : nations.filter(nation => scope.filter({ conf: nation[2] })).length])));
  }
  return nationCountCache.get(key);
}

/**
 * One theatre row. A trailing "*" on a scope's data name ("Asia & Oceania*") is a footnote marker: `label` drops it
 * (summaries, where no footnote is shown) and `note` carries the scope's own description (shown under the list). A
 * marked scope without a description just loses the marker.
 */
export function theatreRow(scope, count) {
  const name = String(scope.name);
  const marked = /\*\s*$/.test(name);
  const label = marked ? name.replace(/\s*\*\s*$/, '') : name;
  return { id: scope.id, name, label, count, note: marked && scope.desc ? String(scope.desc) : '' };
}

const clubScopeCache = new Map();
function clubTheatres(sport) {
  const key = sportKey(sport);
  if (!clubScopeCache.has(key)) {
    clubScopeCache.set(key, CLUB_SCOPES(sport).map(scope => theatreRow(scope, sport.clubs.filter(scope.filter).length)));
  }
  return clubScopeCache.get(key);
}

// Keyed on the club list itself: a data set's clubs hold every squad, so the index must not outlive the decoded set.
const clubIndexCache = new WeakMap();
function clubIndex(sport) {
  if (!clubIndexCache.has(sport.clubs)) clubIndexCache.set(sport.clubs, new Map(sport.clubs.map(club => [club.id, club])));
  return clubIndexCache.get(sport.clubs);
}

const clubMapRows = new Map();
/** The one theatre of a sport whose clubs have their own map: 'NBA', on the USA and Canada. */
function clubMapTheatre(map) {
  if (!clubMapRows.has(map.id)) {
    clubMapRows.set(map.id, Object.freeze([Object.freeze({ id: `domestic:${map.id}`, name: map.league, label: map.league, count: map.clubs, note: '' })]));
  }
  return clubMapRows.get(map.id);
}

/** Theatre rows for the active layer: [{ id, name, label, count, note }] (counts as in HEAD's setup). */
export function theatreOptions(sport, clubLayer) {
  if (clubLayer) {
    const map = clubMapOf(sport.id);
    return map ? clubMapTheatre(map) : clubTheatres(sport);
  }
  const counts = nationCounts(sport);
  return SCOPES.map(scope => theatreRow(scope, counts[scope.id]));
}

/**
 * Theatre rows while a chosen data set loads, with no counts (`count: null`): its nations and leagues are not known
 * yet. Clubs offer every club and the elite, plus a league already chosen, which the set keeps or drops once loaded.
 */
function pendingTheatres(builtIn, clubLayer, clubScope) {
  if (!clubLayer) return SCOPES.map(scope => theatreRow(scope, null));
  const [all, elite, ...leagues] = CLUB_SCOPES(builtIn);
  return [all, elite, ...leagues.filter(scope => scope.id === clubScope)].map(scope => theatreRow(scope, null));
}

/** Theatre list group headings (and the `#setup-theatre` mirror's optgroup labels) when countries are offered. */
export const LEAGUE_GROUP = 'European leagues';
export const DOMESTIC_GROUP = 'One country · top clubs';

let domesticRowCache = null;
/**
 * One country's own top clubs (docs/design/domestic-campaigns.md): one row per shipped map, in the leagues' priority
 * order (data/domesticTiers.js), in the theatre row shape. Offered for football clubs only (`domesticOffered`).
 */
export function domesticTheatres() {
  if (!domesticRowCache) {
    domesticRowCache = Object.freeze([...DOMESTIC]
      .sort((a, b) => nationPriority(a.id) - nationPriority(b.id) || a.name.localeCompare(b.name))
      .map(entry => Object.freeze({ id: `domestic:${entry.id}`, name: entry.name, label: entry.name, count: entry.clubs, note: '' })));
  }
  return domesticRowCache;
}

/** Country maps are built from the built-in data, so a chosen data set (`dataSet`) leaves them out. */
export const domesticOffered = (sport, clubLayer, dataSet = null) => !!clubLayer && sport?.id === 'football' && dataSet == null;

/** Copy under the Season choice: where the other seasons come from. */
export const SEASON_NOTE = 'Other seasons are local data sets, built on this computer from your own copy of the database.';

/**
 * The Season choice (docs/design/football-years.md): the built-in season, then each listed data set newest first, as
 * `{ id, key, season, source, label, checked }`. Null when there is nothing to choose, so the setup is unchanged
 * without data sets. `sport` names a chosen set the index no longer lists.
 */
function seasonOptions(sets, dataSet, sport) {
  if (!sets.length && dataSet == null) return null;
  const row = (id, season, source) => ({ id, key: id ?? 'built-in', season, source,
    label: [season, source].filter(Boolean).join(' · '), checked: id === dataSet });
  const rows = [row(null, BUILT_IN_SEASON.season, 'built in'), ...sets.map(set => row(set.id, set.season, set.label))];
  if (dataSet != null && !sets.some(set => set.id === dataSet)) rows.push(row(dataSet, sport.dataSeason || '', sport.dataLabel || dataSet));
  return rows;
}

/** "Arsenal, Chelsea and Liverpool lead 100 clubs fighting over England, …" */
export function domesticDescription(entry) {
  const top = entry.top || [];
  const leaders = top.length > 1 ? `${top.slice(0, -1).join(', ')} and ${top.at(-1)} lead` : top.length ? `${top[0]} leads` : 'The strongest clubs lead';
  // Format-1 index entries have no `sections`: one section per club.
  const clubs = entry.clubs, sections = entry.sections ?? clubs;
  if (entry.league) {
    return `${leaders} the ${clubs} ${entry.league} clubs, each starting on the land nearest its arena: ${entry.name} split into `
      + `${sections} territories along county and regional borders.`;
  }
  const fewer = Math.floor(sections / clubs), more = Math.ceil(sections / clubs);
  const share = sections === clubs ? '' : `; each club starts with ${fewer === more ? fewer : `${fewer} or ${more}`} of them`;
  return `${leaders} ${clubs} clubs fighting over ${entry.name}, split into ${sections} sections drawn from its administrative divisions${share}.`;
}

const countryPreviewCache = new WeakMap();
/**
 * Step 1's static country card (the v4 form of the setup preview): a decoded country map's sections, each in the
 * pastel its starting club takes at kick-off (`politicalFill(club.id)`, DEC D18), over the neighbouring land
 * (`backdrop`: [{ id, d }], App's `surroundings(map).shapes`). Framed on the map's opening focus, else on all sections,
 * in the fitted 960×540 frame. Pure; memoised per decoded map, fitted paths and backdrop.
 * → { viewBox, sections: [{ id, d, fill }], backdrop: [{ id, d }] } | null
 */
export function countryMapPreview(domestic, backdrop = null) {
  const paths = domestic?.geo?.paths;
  if (!paths || !domestic.sectionNames) return null;
  const hit = countryPreviewCache.get(domestic);
  if (hit && hit.paths === paths && hit.backdrop === backdrop) return hit.value;
  // Section -> starting club id for every section (a club's whole starting group); home sections without startOwners.
  const starter = domestic.startOwners || Object.fromEntries((domestic.clubs || []).map(club => [club.homeSection, club.id]));
  const ids = Object.keys(domestic.sectionNames).filter(id => paths[id]?.d);
  if (!ids.length) return null;
  const sections = ids.map(id => Object.freeze({ id, d: paths[id].d, fill: starter[id] ? politicalFill(starter[id]) : V4.landNeutral }));
  let box = domestic.focus && typeof domestic.geo.focusView === 'function' ? domestic.geo.focusView(domestic.focus) : null;
  if (!(box && box.w > 0 && box.h > 0)) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const id of ids) {
      const b = paths[id].fullBounds || paths[id].bbox;
      if (!b) continue;
      x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h);
    }
    box = Number.isFinite(x0) && x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : { x: 0, y: 0, w: 960, h: 540 };
  }
  const pad = Math.max(box.w, box.h) * .04;
  const viewBox = [box.x - pad, box.y - pad, box.w + pad * 2, box.h + pad * 2].map(n => Number(n.toFixed(1))).join(' ');
  const shapes = Array.isArray(backdrop) ? backdrop.filter(shape => shape?.d).map(shape => Object.freeze({ id: shape.id, d: shape.d })) : [];
  const value = Object.freeze({ viewBox, sections: Object.freeze(sections), backdrop: Object.freeze(shapes) });
  countryPreviewCache.set(domestic, { paths, backdrop, value });
  return value;
}

const theatrePreviewCache = new WeakMap();
/**
 * Step 1's world card, the country card's counterpart for every world theatre: the opening board, each held
 * territory in its team's kick-off pastel (`politicalFill(teamId)`, DEC D18) over the land nobody holds. `countries` is the
 * chart's draw order ([{ id }]); a shape comes from `paths` (the display atlas, as WorldMap draws it), else `basePaths`
 * (the topology), both fitted. `own` is territory → team at kick-off (overseas territory included). The card frames
 * `focus` (a fitted { x, y, w, h }) when given, else the main polygons of `frameIds`, the teams' starting land.
 * Pure; memoised per opening board, paths and focus.
 * → { viewBox, teams, sections: [{ id, d, fill }], backdrop: [{ id, d }] } | null
 */
export function theatreMapPreview({ countries, paths = null, basePaths, own, frameIds = [], focus = null } = {}) {
  if (!Array.isArray(countries) || !basePaths || !own) return null;
  const focusKey = focus ? [focus.x, focus.y, focus.w, focus.h].join(' ') : '';
  const hit = theatrePreviewCache.get(own);
  if (hit && hit.countries === countries && hit.paths === paths && hit.basePaths === basePaths
    && hit.frameIds === frameIds && hit.focusKey === focusKey) return hit.value;
  const pathOf = id => paths?.[id] || basePaths[id];
  const sections = [], backdrop = [];
  for (const { id } of countries) {
    const d = pathOf(id)?.d;
    if (!d) continue;
    if (own[id]) sections.push(Object.freeze({ id, d, fill: politicalFill(own[id]) }));
    else backdrop.push(Object.freeze({ id, d }));
  }
  if (!sections.length) return null;
  let box = focus && focus.w > 0 && focus.h > 0 ? focus : null;
  if (!box) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const id of frameIds) {
      const b = pathOf(id)?.bbox;
      if (!b) continue;
      x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h);
    }
    box = Number.isFinite(x0) && x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : { x: 0, y: 0, w: 960, h: 540 };
  }
  const pad = Math.max(box.w, box.h) * .04;
  const viewBox = [box.x - pad, box.y - pad, box.w + pad * 2, box.h + pad * 2].map(n => Number(n.toFixed(1))).join(' ');
  const value = Object.freeze({ viewBox, teams: new Set(Object.values(own)).size,
    sections: Object.freeze(sections), backdrop: Object.freeze(backdrop) });
  theatrePreviewCache.set(own, { countries, paths, basePaths, frameIds, focusKey, value });
  return value;
}

/** Sport card subtitle, derived from the sport's own club data so it never overstates the leagues. */
export function sportNote(sport) {
  const clubs = sport.clubs || [];
  const leagues = [...new Set(clubs.map(club => club.league))];
  if (!clubs.length) return 'Nations';
  if (leagues.length === 1) return `Nations · ${clubs.length} ${leagues[0]} clubs`;
  return `Nations · ${clubs.length} clubs from ${leagues.length} leagues`;
}

/**
 * Board 03 tier (V1 L1969). The cut-offs (4 / 12 / 30) suit a field of Europe's 46 or more; a smaller field scales them
 * down, so the last of ten clubs reads "Long shot" rather than "Contender".
 */
export function tierOf(rank, field = Infinity) {
  const cut = limit => Math.min(limit, Math.ceil(field * limit / 46));
  return rank <= cut(4) ? 'Favourite' : rank <= cut(12) ? 'Contender' : rank <= cut(30) ? 'Outsider' : 'Long shot';
}

/** Board 03 front label (V1 L1971): a neighbour more than one strength point away is Stronger / Weaker. */
export function frontRelation(neighbourRating, ownRating) {
  const diff = (Number.isFinite(neighbourRating) ? neighbourRating : 0) - (Number.isFinite(ownRating) ? ownRating : 0);
  return diff > 1 ? { rel: 'Stronger', tone: 'loss' } : diff < -1 ? { rel: 'Weaker', tone: 'gain' } : { rel: 'Level', tone: 'even' };
}

/**
 * Board 03 "Fronts" (V1 L929-944). `picked.neighbours` is the optional list of team ids sharing a land border with the
 * picked team on the opening board; without it (no map geometry yet) the block is left out (`null`).
 * Rows: the four strongest neighbours, strongest first.
 */
function frontsOf(picked, managerTeams, row) {
  if (!Array.isArray(picked.neighbours)) return null;
  const byId = new Map(managerTeams.map(team => [team.id, team]));
  const neighbours = [...new Set(picked.neighbours)].filter(id => id !== picked.id && byId.has(id)).map(id => byId.get(id));
  const rows = neighbours
    .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0) || String(a.name).localeCompare(String(b.name)))
    .slice(0, 4)
    .map(team => ({ ...row(team), ...frontRelation(team.rating, picked.rating) }));
  const count = neighbours.length;
  return { count, countText: `${count} land border${count === 1 ? '' : 's'}`, rows };
}

/**
 * Effective rules (DEC D2, the same outcome as engine/turns.js `launchRules` for a known pacing): turn order applies to
 * one-by-one pacing only, and "You choose" to a manager under it (`canPick`). `draw` is the step-2 card; `stored` keeps
 * the raw values a hidden choice leaves behind, which launch normalises.
 */
export function rulesOf(setup = {}) {
  const pacing = valid(PACING_OPTIONS, setup.pacing, 'duel');
  const turnOrder = setup.turnOrder === 'round-robin' ? 'round-robin' : 'random';
  const targeting = setup.targeting === 'player' ? 'player' : 'compass';
  const applies = pacing === 'duel';
  const canPick = applies && setup.role === 'manager';
  const draw = applies ? turnOrder : pacing;
  const drawName = DRAW_NAMES[draw];
  return {
    pacing, pacingName: nameOf(PACING_OPTIONS, pacing, 'duel'), applies, canPick, draw, drawName,
    turnOrder: applies ? turnOrder : 'random', targeting: canPick ? targeting : 'compass',
    targetingHelp: TARGETING_CARDS.find(card => card.value === (canPick ? targeting : 'compass')).body,
    stored: { turnOrder, targeting },
    note: applies ? '' : `${drawName} pairs every match itself, so there's no opponent to pick.`,
    summary: drawName,
  };
}

function bestPlayers(sport, team, clubLayer, setup) {
  if (Array.isArray(team.players)) return team.players.slice(0, 5);
  // Competitive starting ratings rescale every roster; raw source ratings would contradict the shown strength.
  if (setup.rosterPreset === 'competitive' && sport.id === 'basketball') return [];
  const raw = clubLayer ? clubIndex(sport).get(team.id)?.squad : sport.rosters?.[team.id]?.[2];
  if (!Array.isArray(raw)) return [];
  return raw.map(([name, pos, rating]) => ({ name, pos, rating }))
    .filter(player => Number.isFinite(player.rating))
    .sort((a, b) => b.rating - a.rating || String(a.name).localeCompare(String(b.name)))
    .slice(0, 5);
}

function teamIdentity(sport, id, clubLayer) {
  if (clubLayer) {
    const club = clubIndex(sport).get(id);
    return { code: club?.code || String(id).slice(0, 3).toUpperCase(), group: club?.league || '', isClub: true };
  }
  const nation = NATIONS[id];
  return { code: nation?.[1] || String(id), group: nation?.[2] || '', isClub: false };
}

const NO_ROWS = Object.freeze([]);
// What step 1 shows for a chosen data set that has not loaded: no clubs counted, no matches or length estimated.
const NO_CLUBS = Object.freeze({ clubs: NO_ROWS });
const PENDING_PREVIEW = Object.freeze({ matches: '–', duration: '–' });

/**
 * The wizard model. `ctx.managerTeams` is App's `setupTeams()` list: [{ id, name, rating }] sorted by name
 * (optional extras: `code`, `isClub`, `meta`, `players: [{ pos, name, rating }]`, `neighbours: [teamId]`).
 * `ctx.domestic` is App's load state of the chosen country map ({ state: idle | loading | ready | error, message });
 * `ctx.launching` is true while App prepares a country campaign after Launch. `ctx.season` is App's `seasonStatus()`:
 * the listed data sets and the chosen one's load state ({ sets, state, message, sport }), `sport` once it has loaded.
 */
export function buildSetupModel(setup = {}, ctx = {}) {
  const managerTeams = Array.isArray(ctx.managerTeams) ? ctx.managerTeams : [];
  const football = getSport(setup.sport).id === 'football';
  // A chosen data set plays with its own nations and clubs once it has loaded.
  const dataSet = football ? setup.dataSet ?? null : null;
  const seasonCtx = ctx.season || {};
  const sport = dataSet != null && seasonCtx.sport?.dataSet === dataSet ? seasonCtx.sport : getSport(setup.sport);
  // Until then no figure from the built-in season stands in for the set's.
  const pending = dataSet != null && sport.dataSet !== dataSet;
  const clubLayer = setup.layer === 'clubs';
  const noun = clubLayer ? 'club' : 'nation';
  const nouns = `${noun}s`;
  const scopes = pending ? pendingTheatres(sport, clubLayer, setup.clubScope) : theatreOptions(sport, clubLayer);
  // One country's own top clubs: football clubs only, listed after the leagues.
  const domesticOn = domesticOffered(sport, clubLayer, dataSet);
  const domesticScopes = domesticOn ? domesticTheatres() : NO_ROWS;
  // A chosen country (football), or the map a sport's clubs play on (basketball: the NBA's USA and Canada).
  const chosenMap = clubLayer && isDomesticScope(setup.clubScope) ? domesticEntry(setup.clubScope) : null;
  const country = chosenMap && (chosenMap.sport ? chosenMap.sport === sport.id : domesticOn) ? chosenMap : null;
  // Changing sport can leave a league from the previous sport in the saved setup; same fallback as startCampaign.
  const activeScope = scopes.find(scope => scope.id === (clubLayer ? setup.clubScope : setup.scope)) || scopes[0];
  const scopeId = country ? setup.clubScope : activeScope.id;
  const scopeName = country ? domesticLabel(setup.clubScope) : activeScope.label;
  const count = country ? country.clubs : activeScope.count;
  const preview = pending ? PENDING_PREVIEW : campaignPreview(count, sport, setup);
  const rules = rulesOf(setup);
  const showMatches = showMatchesOf(setup);
  const seasonRows = seasonOptions(football && Array.isArray(seasonCtx.sets) ? seasonCtx.sets : NO_ROWS, dataSet, sport);
  const chosenSeason = seasonRows?.find(row => row.checked && row.id != null) || null;
  // Summaries use the label: the "*" footnote is only drawn under the theatre list in step 1.
  const campaignSummary = `${sport.name} · ${clubLayer ? 'Clubs' : 'Nations'} · ${scopeName}${chosenSeason?.season ? ` · ${chosenSeason.season}` : ''}`;
  const launching = !!ctx.launching;
  const countryState = country && ['loading', 'ready', 'error'].includes(ctx.domestic?.state) ? ctx.domestic.state : 'idle';
  const countryWaits = countryState === 'loading' || countryState === 'error';
  // A chosen set is ready once its sport is here; a failed load stays failed until Retry.
  const seasonState = dataSet == null ? 'idle' : !pending ? 'ready' : seasonCtx.state === 'error' ? 'error' : 'loading';
  const seasonWaits = pending;
  const setName = chosenSeason?.source || dataSet;
  const setLoading = dataSet != null ? `Loading the ${setName} data set…` : '';
  const setFailed = dataSet != null ? `The ${setName} data set could not be loaded.` : '';

  const ranked = managerTeams.slice().sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0) || String(a.name).localeCompare(String(b.name)));
  const rankOf = new Map(ranked.map((team, index) => [team.id, index + 1]));
  const field = managerTeams.length;
  const row = team => {
    const identity = teamIdentity(sport, team.id, clubLayer);
    const rank = rankOf.get(team.id);
    return {
      id: team.id, name: team.name, code: team.code || identity.code, isClub: team.isClub ?? identity.isClub,
      rating: team.rating, ratingText: Number.isFinite(team.rating) ? team.rating.toFixed(1) : '–', rank,
    };
  };
  const teams = managerTeams.map(row);
  const role = setup.role === 'manager' ? 'manager' : 'spectator';
  const picked = managerTeams.find(team => team.id === setup.managedTeamId) || null;
  let managed = null;
  if (role === 'manager' && picked) {
    const identity = teamIdentity(sport, picked.id, clubLayer);
    const rank = rankOf.get(picked.id);
    managed = {
      ...row(picked),
      meta: picked.meta || [identity.group || country?.name, `${sport.name} ${noun}`].filter(Boolean).join(' · '),
      rankText: `${rank} / ${field}`, tier: tierOf(rank, field),
      players: bestPlayers(sport, picked, clubLayer, setup).map(player => ({
        ...player, ratingText: String(Math.round(player.rating)), tier: ratingTierOf(player.rating),
      })),
      fronts: frontsOf(picked, managerTeams, row),
    };
  }
  const favourites = ranked.slice(0, 5).map(row);
  const favouriteIds = new Set(favourites.map(team => team.id));
  const longShots = [...new Set([.55, .7, .85].map(share => ranked[Math.round(field * share)]).filter(Boolean))]
    .filter(team => !favouriteIds.has(team.id)).map(row);
  const teamChosen = role !== 'manager' || !!picked;
  // A country campaign also waits for its map (and never launches twice while App prepares it), a data set for its file.
  const canLaunch = teamChosen && !countryWaits && !seasonWaits && !launching;
  const mapLoading = country ? `Loading the map of ${country.name}…` : '';
  const mapFailed = country ? `The map of ${country.name} could not be loaded.` : '';
  const launchNote = launching ? `Preparing the map of ${country?.name || 'the country'}…`
    : countryState === 'loading' ? mapLoading
      : countryState === 'error' ? mapFailed
        : seasonState === 'loading' ? setLoading
          : seasonState === 'error' ? setFailed
            : teamChosen ? SETUP_STEPS[2].note : `Choose a ${noun} to manage`;

  return {
    sport: { id: sport.id, name: sport.name },
    // The chosen set's card counts its own clubs.
    sports: SPORT_LIST.map(item => ({ id: item.id, name: item.name,
      note: item.id !== sport.id ? sportNote(item) : pending ? sportNote(NO_CLUBS) : sportNote(sport), selected: item.id === sport.id })),
    season: seasonRows ? {
      id: dataSet, options: seasonRows, state: seasonState, note: SEASON_NOTE, loading: setLoading,
      message: seasonState === 'error' ? (seasonCtx.message || setFailed) : '',
    } : null,
    layer: clubLayer ? 'clubs' : 'nations', clubLayer, noun, nouns,
    // `scopes` stays the league / region rows; countries are their own group (`domesticScopes`) after them.
    scopes, scopeId, scopeName, scopeKey: clubLayer ? 'clubScope' : 'scope',
    theatreNotes: scopes.filter(scope => scope.note),
    domesticScopes, leagueGroup: LEAGUE_GROUP, domesticGroup: DOMESTIC_GROUP,
    country: country ? { id: country.id, name: country.name, clubs: country.clubs, sections: country.sections ?? country.clubs } : null,
    countryNote: country ? domesticDescription(country) : '',
    countryState, countryMessage: countryState === 'error' ? (ctx.domestic?.message || mapFailed) : '',
    mapLoading, launching,
    // Step 3's team list is empty until a country's map decodes.
    teamsEmpty: countryState === 'loading' ? mapLoading : countryState === 'error' ? mapFailed
      : seasonState === 'loading' ? setLoading : seasonState === 'error' ? setFailed : `No ${nouns} in this theatre.`,
    count, preview,
    stats: [
      { id: 'teams', label: clubLayer ? 'Clubs' : 'Nations', value: pending ? '–' : String(count) },
      { id: 'matches', label: 'Matches', value: preview.matches },
      { id: 'length', label: 'Length', value: preview.duration.replace(' at 1× autoplay', ''), small: true },
    ],
    status: pending ? (seasonState === 'error' ? setFailed : setLoading) : `${count} ${nouns} · ${preview.matches} matches · ${preview.duration}`,
    estimateNote: estimateNote(showMatches, setup.role),
    campaignSummary,
    rules,
    showMatches, showMatchesHelp: SHOW_MATCH_HELP[showMatches],
    uncertainty: valid(UNCERTAINTY_OPTIONS, setup.uncertainty, 'balanced'),
    finale: valid(FINALE_OPTIONS, setup.finale, 'single'),
    acquisitionPolicy: valid(RECRUITMENT_OPTIONS, setup.acquisitionPolicy, 'highest-rated'),
    rosterPreset: valid(ROSTER_OPTIONS, setup.rosterPreset, 'authentic'),
    moreRules: moreRulesSummary(setup),
    role, teams, field, managed, favourites, longShots, canLaunch,
    // Spectators pick no team, so their step-3 heading names what they do choose.
    roleTitle: role === 'manager' ? `Choose your ${noun}` : 'Choose your role',
    roleMeta: `${scopeName} · ${sport.name} ${nouns}${pending ? '' : ` · ${count} ${nouns}`}`,
    stepSummaries: {
      1: campaignSummary,
      2: rules.summary,
      3: role === 'manager' ? (picked ? `Manager · ${picked.name}` : 'Manager') : 'Spectator',
    },
    launchNote,
  };
}
