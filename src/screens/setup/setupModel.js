// Owner: WP-SETUP (see PLAN.md §4). Pure view model for the three-step setup wizard (PLAN A-5, M§1.8, M§3).
// Everything here is a pure function of the setup record and the opening teams App already computes
// (`setupTeams()` → `managerTeams`): no window/document, no RNG, no timers. Caches are keyed by immutable data.
import { NATIONS, SCOPES } from '../../data/teams.js';
import { CLUB_SCOPES } from '../../data/scopes.js';
import { DOMESTIC } from '../../data/domestic.js';
import { domesticEntry, domesticLabel, isDomesticScope } from '../../data/domesticScope.js';
import { SPORT_LIST, getSport } from '../../sports/index.js';
import { BUILT_IN_SEASON, fieldedNations } from '../../engine/footballSets.js';
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

/** Theatre rows for the active layer: [{ id, name, label, count, note }] (counts as in HEAD's setup). */
export function theatreOptions(sport, clubLayer) {
  if (clubLayer) return clubTheatres(sport);
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

/** Sport card subtitle, derived from the sport's own club data so it never overstates the leagues. */
export function sportNote(sport) {
  const clubs = sport.clubs || [];
  const leagues = [...new Set(clubs.map(club => club.league))];
  if (!clubs.length) return 'Nations';
  if (leagues.length === 1) return `Nations · ${clubs.length} ${leagues[0]} clubs`;
  return `Nations · ${clubs.length} clubs from ${leagues.length} leagues`;
}

/** Board 03 tier (V1 L1969). */
export function tierOf(rank) {
  return rank <= 4 ? 'Favourite' : rank <= 12 ? 'Contender' : rank <= 30 ? 'Outsider' : 'Long shot';
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
  const country = domesticOn && isDomesticScope(setup.clubScope) ? domesticEntry(setup.clubScope) : null;
  // Changing sport can leave a league from the previous sport in the saved setup; same fallback as startCampaign.
  const activeScope = scopes.find(scope => scope.id === (clubLayer ? setup.clubScope : setup.scope)) || scopes[0];
  const scopeId = country ? setup.clubScope : activeScope.id;
  const scopeName = country ? domesticLabel(setup.clubScope) : activeScope.label;
  const count = country ? country.clubs : activeScope.count;
  const preview = pending ? PENDING_PREVIEW : campaignPreview(count, sport, setup);
  const rules = rulesOf(setup);
  const resolution = RESOLUTION_OPTIONS.some(([id]) => id === setup.resolution) ? setup.resolution : 'ticker';
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
      rankText: `${rank} / ${field}`, tier: tierOf(rank),
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
    country: country ? { id: country.id, name: country.name, clubs: country.clubs } : null,
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
      { id: 'length', label: 'At 1× autoplay', value: preview.duration.replace(' at 1× autoplay', ''), small: true },
    ],
    status: pending ? (seasonState === 'error' ? setFailed : setLoading) : `${count} ${nouns} · ${preview.matches} matches · ${preview.duration}`,
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
    roleMeta: `${scopeName} · ${sport.name} ${nouns}${pending ? '' : ` · ${count} ${nouns}`}`,
    stepSummaries: {
      1: campaignSummary,
      2: rules.summary,
      3: role === 'manager' ? (picked ? `Manager · ${picked.name}` : 'Manager') : 'Spectator',
    },
    launchNote,
  };
}
