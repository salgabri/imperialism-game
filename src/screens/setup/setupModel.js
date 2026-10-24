// Owner: WP-SETUP (see PLAN.md §4). Pure view model for the three-step setup wizard (PLAN A-5, M§1.8, M§3).
// Everything here is a pure function of the setup record and the opening teams App already computes
// (`setupTeams()` → `managerTeams`): no window/document, no RNG, no timers. Caches are keyed by immutable data.
import { NATIONS, SCOPES } from '../../data/teams.js';
import { CLUB_SCOPES } from '../../data/scopes.js';
import { DOMESTIC } from '../../data/domestic.js';
import { domesticEntry, domesticLabel, isDomesticScope } from '../../data/domesticScope.js';
import { SPORT_LIST, getSport } from '../../sports/index.js';
import { V4, empireFill, ratingTierOf } from '../../theme.js';

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
  { n: 1, id: 'campaign', title: 'Campaign', pending: 'Sport, teams, theatre', next: 'Next: Rules', note: 'Rules can be changed in step 2' },
  { n: 2, id: 'rules', title: 'Rules', pending: 'Turn order, targeting, odds', next: 'Next: Nation & role', note: 'Rules are fixed once the campaign launches' },
  { n: 3, id: 'role', title: 'Nation & role', pending: 'Manage a team, or watch', next: 'Launch campaign', note: 'Rules are fixed once the campaign launches' },
]);

export const TURN_ORDER_OPTIONS = [['round-robin', 'Round robin'], ['random', 'Random draw']];
export const TARGETING_OPTIONS = [['player', 'You choose'], ['compass', 'Compass']];

/**
 * Board 12 option cards (M§3.4), copy verbatim. `dots`: on | current | off squares. `dotStyle` picks the fill rule:
 * `rr` squares are always `you`; `rand` filled squares are `muted` until that card is selected.
 */
export const TURN_ORDER_CARDS = Object.freeze([
  { value: 'round-robin', title: 'Round robin', dotStyle: 'rr', dots: ['on', 'on', 'current', 'off', 'off'],
    body: 'Every empire attacks once per round, strongest first. Everyone gets a turn.' },
  { value: 'random', title: 'Random draw', dotStyle: 'rand', dots: ['off', 'on', 'off', 'off', 'on'],
    body: 'Any surviving empire can be drawn to attack. Streaks, droughts and surprises.' },
]);
export const TARGETING_CARDS = Object.freeze([
  { value: 'player', title: 'You choose', tag: 'Manager only', tone: 'you',
    body: 'On your turns, pick any neighbour on the map. Other empires spin the compass.' },
  { value: 'compass', title: 'Compass', tag: 'Spectator-ready', tone: 'muted',
    body: 'A spin of the compass picks a neighbour for every attacker — you included.' },
]);

/**
 * Board 12 explainer matrix (M§3.5), copy verbatim. The board's " · selected" tag suffix is drawn as a separate
 * "Selected" status line on the selected cell (`cell.selected`), so the tag itself stays one line (M§3.5 nowrap).
 */
export const RULE_CELLS = Object.freeze([
  { turnOrder: 'round-robin', targeting: 'player', title: 'Your front, your call', tag: 'Manager', tone: 'you',
    body: 'Your turn comes once a round and you pick the neighbour. Everyone else spins.' },
  { turnOrder: 'round-robin', targeting: 'compass', title: 'Clockwork war', tag: 'Spectator-ready', tone: 'muted',
    body: 'Each empire in turn spins for a target. Fully automatic and easy to follow.' },
  { turnOrder: 'random', targeting: 'player', title: 'Wait for the draw', tag: 'Manager', tone: 'you',
    body: 'When the draw lands on you, choose the target. Your turns are not guaranteed.' },
  { turnOrder: 'random', targeting: 'compass', title: 'Pure chaos', tag: 'Spectator-ready · classic', tone: 'muted',
    body: 'Random attacker, random direction — the original Imperialism draw.' },
]);

export const ROLE_CARDS = Object.freeze([
  { value: 'manager', title: 'Manager',
    body: 'Commit to one team. Choose an approach before its matches and among up to three signings after its wins.' },
  { value: 'spectator', title: 'Spectator',
    body: 'Automatic draws, results and signings. Follow a favourite for match alerts.' },
]);

/** The conquest rules the old setup intro listed (ui-interaction contract copy). */
export const CONQUEST_RULES = Object.freeze([
  "Win a match to take all of the loser's territories.",
  'Claim a player; some signings add bench options.',
  'Last team standing wins.',
]);

const PACING_TAIL = { duel: 'a compass picks each fixture', blitz: 'every team plays each round', chaos: 'round size varies' };
const UNCERTAINTY_SUMMARY = {
  predictable: 'Predictable — strength usually decides',
  balanced: 'Balanced — strength matters, upsets happen',
  wild: 'Wild — more match-day swings and upsets',
};
export const UNCERTAINTY_HELP = {
  predictable: 'Strength usually decides the winner.',
  balanced: 'Strength matters, with room for surprises.',
  wild: 'More match-day variation and potential upsets.',
};
const FINALE_SUMMARY = { single: 'Single decisive match', 'best-of-three': 'Best of three — first to two wins' };
export const FINALE_HELP = {
  single: 'One decisive match crowns the champion.',
  'best-of-three': 'First to two wins claims the final territories and player.',
};
const RECRUITMENT_SUMMARY = {
  'highest-rated': 'Highest-rated player for unmanaged teams',
  'best-fit': 'Best lineup fit for unmanaged teams',
};

const nameOf = (options, id, fallback) => (options.find(([key]) => key === id) || options.find(([key]) => key === fallback))[1];

let nationCountCache = null;
function nationCounts() {
  if (nationCountCache) return nationCountCache;
  const nations = Object.values(NATIONS);
  nationCountCache = Object.fromEntries(SCOPES.map(scope => [scope.id, scope.id === 'world'
    ? nations.length
    : scope.id === 'elite' ? Math.min(32, nations.length) : nations.filter(nation => scope.filter({ conf: nation[2] })).length]));
  return nationCountCache;
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
  if (!clubScopeCache.has(sport.id)) {
    clubScopeCache.set(sport.id, CLUB_SCOPES(sport).map(scope => theatreRow(scope, sport.clubs.filter(scope.filter).length)));
  }
  return clubScopeCache.get(sport.id);
}

const clubIndexCache = new Map();
function clubIndex(sport) {
  if (!clubIndexCache.has(sport.id)) clubIndexCache.set(sport.id, new Map(sport.clubs.map(club => [club.id, club])));
  return clubIndexCache.get(sport.id);
}

/** Theatre rows for the active layer: [{ id, name, label, count, note }] (counts as in HEAD's setup). */
export function theatreOptions(sport, clubLayer) {
  if (clubLayer) return clubTheatres(sport);
  const counts = nationCounts();
  return SCOPES.map(scope => theatreRow(scope, counts[scope.id]));
}

/** Theatre list group headings (and the `#setup-theatre` mirror's optgroup labels) when countries are offered. */
export const LEAGUE_GROUP = 'European leagues';
export const DOMESTIC_GROUP = 'One country · top clubs';

let domesticRowCache = null;
/**
 * One country's own top clubs (docs/design/domestic-campaigns.md): one row per shipped map, A–Z, in the theatre row
 * shape. Offered for football clubs only (`domesticOffered`).
 */
export function domesticTheatres() {
  if (!domesticRowCache) {
    domesticRowCache = Object.freeze([...DOMESTIC].sort((a, b) => a.name.localeCompare(b.name))
      .map(entry => Object.freeze({ id: `domestic:${entry.id}`, name: entry.name, label: entry.name, count: entry.clubs, note: '' })));
  }
  return domesticRowCache;
}

export const domesticOffered = (sport, clubLayer) => !!clubLayer && sport?.id === 'football';

/** "Arsenal, Chelsea and Liverpool lead 100 clubs fighting over England, …" */
export function domesticDescription(entry) {
  const top = entry.top || [];
  const leaders = top.length > 1 ? `${top.slice(0, -1).join(', ')} and ${top.at(-1)} lead` : top.length ? `${top[0]} leads` : 'The strongest clubs lead';
  return `${leaders} ${entry.clubs} clubs fighting over ${entry.name}, split into ${entry.clubs} sections drawn from its administrative divisions.`;
}

const countryPreviewCache = new WeakMap();
/**
 * Step 1's static country card (the v4 form of the setup preview): a decoded country map's sections, each in the
 * pastel its starting club takes at kick-off (`empireFill(club.id)`, DEC D18), over the neighbouring land
 * (`backdrop`: [{ id, d }], App's `surroundings(map).shapes`). Framed on the map's opening focus, else on all sections,
 * in the fitted 960×540 frame. Pure; memoised per decoded map, fitted paths and backdrop.
 * → { viewBox, sections: [{ id, d, fill }], backdrop: [{ id, d }] } | null
 */
export function countryMapPreview(domestic, backdrop = null) {
  const paths = domestic?.geo?.paths;
  if (!paths || !domestic.sectionNames) return null;
  const hit = countryPreviewCache.get(domestic);
  if (hit && hit.paths === paths && hit.backdrop === backdrop) return hit.value;
  const clubOf = new Map((domestic.clubs || []).map(club => [club.homeSection, club]));
  const ids = Object.keys(domestic.sectionNames).filter(id => paths[id]?.d);
  if (!ids.length) return null;
  const sections = ids.map(id => {
    const club = clubOf.get(id);
    return Object.freeze({ id, d: paths[id].d, fill: club ? empireFill(club.id) : V4.landNeutral });
  });
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
 * territory in its team's kick-off pastel (`empireFill(teamId)`, DEC D18) over the land nobody holds. `countries` is the
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
    if (own[id]) sections.push(Object.freeze({ id, d, fill: empireFill(own[id]) }));
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

/** Effective rules (DEC D2): turn order × targeting apply to One by one pacing only. */
export function rulesOf(setup = {}) {
  const pacing = PACING_OPTIONS.some(([id]) => id === setup.pacing) ? setup.pacing : 'duel';
  const turnOrder = setup.turnOrder === 'round-robin' ? 'round-robin' : 'random';
  const targeting = setup.targeting === 'player' ? 'player' : 'compass';
  const applies = pacing === 'duel';
  const effective = applies ? { turnOrder, targeting } : { turnOrder: 'random', targeting: 'compass' };
  const pacingName = nameOf(PACING_OPTIONS, pacing, 'duel');
  return {
    pacing, pacingName, applies, turnOrder: effective.turnOrder, targeting: effective.targeting,
    stored: { turnOrder, targeting },
    note: applies ? '' : `Turn order and targeting apply to One by one pacing. ${pacingName} always uses a random draw and the compass.`,
    summary: `${applies ? nameOf(TURN_ORDER_OPTIONS, effective.turnOrder) : pacingName} · ${nameOf(TARGETING_OPTIONS, effective.targeting)}`,
    cells: RULE_CELLS.map(cell => {
      const selected = cell.turnOrder === effective.turnOrder && cell.targeting === effective.targeting;
      return { ...cell, id: `${cell.turnOrder}-${cell.targeting}`, selected };
    }),
  };
}

/** Read-only summary rows (board 02 L840-849, board 12 L218-225), bound to the setup values. */
export function summaryOf(setup = {}) {
  const rules = rulesOf(setup);
  return {
    pacing: `${rules.pacingName} — ${PACING_TAIL[rules.pacing]}`,
    uncertainty: UNCERTAINTY_SUMMARY[setup.uncertainty] || UNCERTAINTY_SUMMARY.balanced,
    finale: FINALE_SUMMARY[setup.finale] || FINALE_SUMMARY.single,
    recruitment: RECRUITMENT_SUMMARY[setup.acquisitionPolicy] || RECRUITMENT_SUMMARY['highest-rated'],
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

/**
 * The wizard model. `ctx.managerTeams` is App's `setupTeams()` list: [{ id, name, rating }] sorted by name
 * (optional extras: `code`, `isClub`, `meta`, `players: [{ pos, name, rating }]`, `neighbours: [teamId]`).
 * `ctx.domestic` is App's load state of the chosen country map ({ state: idle | loading | ready | error, message });
 * `ctx.launching` is true while App prepares a country campaign after Launch.
 */
export function buildSetupModel(setup = {}, ctx = {}) {
  const managerTeams = Array.isArray(ctx.managerTeams) ? ctx.managerTeams : [];
  const sport = getSport(setup.sport);
  const clubLayer = setup.layer === 'clubs';
  const noun = clubLayer ? 'club' : 'nation';
  const nouns = `${noun}s`;
  const scopes = theatreOptions(sport, clubLayer);
  // One country's own top clubs: football clubs only, listed after the leagues.
  const domesticOn = domesticOffered(sport, clubLayer);
  const domesticScopes = domesticOn ? domesticTheatres() : NO_ROWS;
  const country = domesticOn && isDomesticScope(setup.clubScope) ? domesticEntry(setup.clubScope) : null;
  // Changing sport can leave a league from the previous sport in the saved setup; same fallback as startCampaign.
  const activeScope = scopes.find(scope => scope.id === (clubLayer ? setup.clubScope : setup.scope)) || scopes[0];
  const scopeId = country ? setup.clubScope : activeScope.id;
  const scopeName = country ? domesticLabel(setup.clubScope) : activeScope.label;
  const count = country ? country.clubs : activeScope.count;
  const preview = campaignPreview(count, sport, setup);
  const rules = rulesOf(setup);
  const resolution = RESOLUTION_OPTIONS.some(([id]) => id === setup.resolution) ? setup.resolution : 'ticker';
  // Summaries use the label: the "*" footnote is only drawn under the theatre list in step 1.
  const campaignSummary = `${sport.name} · ${clubLayer ? 'Clubs' : 'Nations'} · ${scopeName}`;
  const launching = !!ctx.launching;
  const countryState = country && ['loading', 'ready', 'error'].includes(ctx.domestic?.state) ? ctx.domestic.state : 'idle';
  const countryWaits = countryState === 'loading' || countryState === 'error';

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
  // A country campaign also waits for its map (and never launches twice while App prepares it).
  const canLaunch = teamChosen && !countryWaits && !launching;
  const mapLoading = country ? `Loading the map of ${country.name}…` : '';
  const mapFailed = country ? `The map of ${country.name} could not be loaded.` : '';
  const launchNote = launching ? `Preparing the map of ${country?.name || 'the country'}…`
    : countryState === 'loading' ? mapLoading
      : countryState === 'error' ? mapFailed
        : teamChosen ? SETUP_STEPS[2].note : `Choose a ${noun} to manage`;

  return {
    sport: { id: sport.id, name: sport.name },
    sports: SPORT_LIST.map(item => ({ id: item.id, name: item.name, note: sportNote(item), selected: item.id === sport.id })),
    layer: clubLayer ? 'clubs' : 'nations', clubLayer, noun, nouns,
    // `scopes` stays the league / region rows; countries are their own group (`domesticScopes`) after them.
    scopes, scopeId, scopeName, scopeKey: clubLayer ? 'clubScope' : 'scope',
    theatreNotes: scopes.filter(scope => scope.note),
    domesticScopes, leagueGroup: LEAGUE_GROUP, domesticGroup: DOMESTIC_GROUP,
    country: country ? { id: country.id, name: country.name, clubs: country.clubs } : null,
    countryNote: country ? domesticDescription(country) : '',
    countryState, countryMessage: countryState === 'error' ? (ctx.domestic?.message || mapFailed) : '',
    mapLoading, launching,
    // Step 3's team list is empty until a country's map decodes.
    teamsEmpty: countryState === 'loading' ? mapLoading : countryState === 'error' ? mapFailed : `No ${nouns} in this theatre.`,
    count, preview,
    stats: [
      { id: 'teams', label: clubLayer ? 'Clubs' : 'Nations', value: String(count) },
      { id: 'matches', label: 'Matches', value: preview.matches },
      { id: 'length', label: 'At 1× autoplay', value: preview.duration.replace(' at 1× autoplay', ''), small: true },
    ],
    status: `${count} ${nouns} · ${preview.matches} matches · ${preview.duration}`,
    campaignSummary,
    summary: summaryOf(setup),
    rules,
    pacing: rules.pacing, resolution,
    pacingName: rules.pacingName, resolutionName: nameOf(RESOLUTION_OPTIONS, resolution, 'ticker'),
    uncertainty: UNCERTAINTY_HELP[setup.uncertainty] ? setup.uncertainty : 'balanced',
    finale: FINALE_HELP[setup.finale] ? setup.finale : 'single',
    role, teams, field, managed, favourites, longShots, canLaunch,
    // Spectators pick no team, so their step-3 heading names what they do choose.
    roleTitle: role === 'manager' ? `Choose your ${noun}` : 'Choose your role',
    roleMeta: `${scopeName} · ${sport.name} ${nouns} · ${count} ${nouns}`,
    stepSummaries: {
      1: campaignSummary,
      2: rules.summary,
      3: role === 'manager' ? (picked ? `Manager · ${picked.name}` : 'Manager') : 'Spectator',
    },
    launchNote,
  };
}
