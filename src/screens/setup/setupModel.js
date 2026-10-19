// Owner: WP-SETUP (see PLAN.md §4). Pure view model for the three-step setup wizard (PLAN A-5, M§1.8, M§3).
// Everything here is a pure function of the setup record and the opening teams App already computes
// (`setupTeams()` → `managerTeams`): no window/document, no RNG, no timers. Caches are keyed by immutable data.
import { NATIONS, SCOPES } from '../../data/teams.js';
import { CLUB_SCOPES } from '../../data/scopes.js';
import { SPORT_LIST, getSport } from '../../sports/index.js';
import { ratingTierOf } from '../../theme.js';

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

/**
 * The wizard model. `ctx.managerTeams` is App's `setupTeams()` list: [{ id, name, rating }] sorted by name
 * (optional extras: `code`, `isClub`, `meta`, `players: [{ pos, name, rating }]`, `neighbours: [teamId]`).
 */
export function buildSetupModel(setup = {}, ctx = {}) {
  const managerTeams = Array.isArray(ctx.managerTeams) ? ctx.managerTeams : [];
  const sport = getSport(setup.sport);
  const clubLayer = setup.layer === 'clubs';
  const noun = clubLayer ? 'club' : 'nation';
  const nouns = `${noun}s`;
  const scopes = theatreOptions(sport, clubLayer);
  // Changing sport can leave a league from the previous sport in the saved setup; same fallback as startCampaign.
  const activeScope = scopes.find(scope => scope.id === (clubLayer ? setup.clubScope : setup.scope)) || scopes[0];
  const count = activeScope.count;
  const preview = campaignPreview(count, sport, setup);
  const rules = rulesOf(setup);
  const resolution = RESOLUTION_OPTIONS.some(([id]) => id === setup.resolution) ? setup.resolution : 'ticker';
  // Summaries use the label: the "*" footnote is only drawn under the theatre list in step 1.
  const campaignSummary = `${sport.name} · ${clubLayer ? 'Clubs' : 'Nations'} · ${activeScope.label}`;

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
      meta: picked.meta || [identity.group, `${sport.name} ${noun}`].filter(Boolean).join(' · '),
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
  const canLaunch = role !== 'manager' || !!picked;

  return {
    sport: { id: sport.id, name: sport.name },
    sports: SPORT_LIST.map(item => ({ id: item.id, name: item.name, note: sportNote(item), selected: item.id === sport.id })),
    layer: clubLayer ? 'clubs' : 'nations', clubLayer, noun, nouns,
    scopes, scopeId: activeScope.id, scopeName: activeScope.label, scopeKey: clubLayer ? 'clubScope' : 'scope',
    theatreNotes: scopes.filter(scope => scope.note),
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
    roleMeta: `${activeScope.label} · ${sport.name} ${nouns} · ${count} ${nouns}`,
    stepSummaries: {
      1: campaignSummary,
      2: rules.summary,
      3: role === 'manager' ? (picked ? `Manager · ${picked.name}` : 'Manager') : 'Spectator',
    },
    launchNote: canLaunch ? SETUP_STEPS[2].note : `Choose a ${noun} to manage`,
  };
}
