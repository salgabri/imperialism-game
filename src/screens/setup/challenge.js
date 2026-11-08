// Challenge links (README §Sharing a campaign). A challenge link carries a setup in the page address's query: sport,
// teams, theatre, season, the rules of war, your role and the seed. Opening it fills in setup without launching, and the
// same setup and seed replay the same campaign (README §Finale, seeds and saves). Pure: no window or document, and
// nothing here draws from a campaign's random stream.
import { SCOPES } from '../../data/teams.js';
import { CLUB_SCOPES } from '../../data/scopes.js';
import { domesticEntry, isDomesticScope } from '../../data/domesticScope.js';
import { SPORT_LIST, getSport } from '../../sports/index.js';
import { BUILT_IN_SETS, setHasClubs, setHasNations, setSportOf } from '../../engine/footballSets.js';
import { DEFAULT_SETUP, dataSetOf, setClubScope } from '../../app/shared.js';
import {
  DRAW_CARDS, FINALE_OPTIONS, HOME_OPTIONS, RECRUITMENT_OPTIONS, ROSTER_OPTIONS, SHOW_MATCH_OPTIONS, TARGETING_CARDS,
  UNCERTAINTY_OPTIONS, rulesOf, showMatchesOf,
} from './setupModel.js';

/** A link's query keys, in the order it writes them. */
export const CHALLENGE_KEYS = Object.freeze(['sport', 'teams', 'theatre', 'season', 'draw', 'opponent', 'show', 'upsets', 'final',
  'signings', 'home', 'strengths', 'role', 'team', 'seed']);

/** How setup names each key, for the note that lists the ones a link could not use. */
export const CHALLENGE_LABELS = Object.freeze({
  sport: 'sport', teams: 'teams', theatre: 'theatre', season: 'season', draw: 'draw', opponent: 'opponent choice',
  show: 'Show matches', upsets: 'upsets', final: 'final', signings: 'computer signings', home: 'home advantage',
  strengths: 'team strengths', role: 'role', team: 'team', seed: 'seed',
});

// The seed field's range (an unsigned 32-bit number), written in plain digits.
const SEED = /^\d{1,10}$/;
const MAX_SEED = 0xffffffff;
// Nation ids ('276'), club ids ('f-real-madrid') and country clubs ('d826-679'); the theatre's own list decides the rest.
const TEAM_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/;
const offers = (options, value) => options.some(([id]) => id === value);

/**
 * Whether `value` is a club theatre this build offers the sport: the strongest clubs or the elite, a country of its own
 * (football's built-in clubs only: country maps are built from them) or a map its clubs play on. The map of the sport and
 * season then takes over in `setClubScope`, as in setup. A link to one league's theatre, which this build no longer has,
 * keeps the default.
 */
function offeredClubTheatre(sport, dataSet, value) {
  if (isDomesticScope(value)) {
    const entry = domesticEntry(value);
    return !!entry && (entry.sport ? entry.sport === sport.id : sport.id === 'football' && dataSet == null);
  }
  return CLUB_SCOPES(sport).some(scope => scope.id === value);
}

/**
 * The challenge in a page address's query (`search`, with or without its "?"): `{ found, setup, ignored }`. `setup` is a
 * whole setup record, a new setup's defaults (DEFAULT_SETUP) with every value the link names that this build offers. A
 * value it doesn't offer — an unknown sport, a theatre or season it no longer has, a malformed seed — stays at its
 * default, and its key is listed in `ignored`. `found` is whether the query names any challenge key. `sets` are the
 * data sets on offer (the built-in earlier seasons; a CM 01/02 set lives on one computer only). Whether a manager's
 * team plays in the theatre is known only once the theatre's teams are (`fieldedTeam`).
 */
export function readChallenge(search = '', { sets = BUILT_IN_SETS } = {}) {
  const params = new URLSearchParams(String(search ?? ''));
  const given = new Map(CHALLENGE_KEYS.filter(key => params.has(key)).map(key => [key, params.get(key).trim()]));
  const setup = { ...DEFAULT_SETUP };
  const ignored = [];
  const take = (key, offered, apply) => {
    if (!given.has(key)) return;
    const value = given.get(key);
    if (value !== '' && offered(value)) apply(value);
    else ignored.push(key);
  };

  take('sport', value => SPORT_LIST.some(sport => sport.id === value), value => { setup.sport = value; });
  const sport = getSport(setup.sport);
  take('season', value => setSportOf(value) === sport.id && sets.some(set => set.id === value), value => { setup.dataSet = value; });
  // A sport with clubs only (American football: the NFL's) and a season with clubs only (an NBA season) play clubs.
  const clubsOnly = !!sport.clubsOnly || (setup.dataSet != null && !setHasNations(setup.dataSet));
  // FIFA 05 and FIFA 06 have no clubs to play, nor has tennis.
  const nationsOnly = !!sport.nationsOnly || (setup.dataSet != null && !setHasClubs(setup.dataSet));
  take('teams', value => (value === 'clubs' && !nationsOnly) || (value === 'nations' && !clubsOnly), value => { setup.layer = value; });
  if (clubsOnly) setup.layer = 'clubs';
  if (sport.nationsOnly) setup.layer = 'nations';
  const clubLayer = setup.layer === 'clubs';
  take('theatre', value => (clubLayer ? offeredClubTheatre(sport, setup.dataSet, value) : SCOPES.some(scope => scope.id === value)),
    value => { setup[clubLayer ? 'clubScope' : 'scope'] = value; });
  if (clubLayer) setup.clubScope = setClubScope(setup);

  take('draw', value => DRAW_CARDS.some(card => card.value === value), value => {
    const card = DRAW_CARDS.find(item => item.value === value);
    setup.pacing = card.pacing;
    if (card.turnOrder) setup.turnOrder = card.turnOrder;
  });
  take('opponent', value => TARGETING_CARDS.some(card => card.value === value), value => { setup.targeting = value; });
  take('show', value => offers(SHOW_MATCH_OPTIONS, value), value => {
    setup.express = value === 'express';
    if (value !== 'express') setup.resolution = value;
  });
  take('upsets', value => offers(UNCERTAINTY_OPTIONS, value), value => { setup.uncertainty = value; });
  take('final', value => offers(FINALE_OPTIONS, value), value => { setup.finale = value; });
  take('signings', value => offers(RECRUITMENT_OPTIONS, value), value => { setup.acquisitionPolicy = value; });
  take('home', value => offers(HOME_OPTIONS, value), value => { setup.homeAdvantage = value; });
  // Team strengths is a basketball rule.
  take('strengths', value => sport.id === 'basketball' && offers(ROSTER_OPTIONS, value), value => { setup.rosterPreset = value; });
  take('role', value => value === 'manager' || value === 'spectator', value => { setup.role = value; });
  take('team', value => setup.role === 'manager' && TEAM_ID.test(value), value => { setup.managedTeamId = value; });
  take('seed', value => SEED.test(value) && Number(value) <= MAX_SEED, value => { setup.seed = String(Number(value)); });
  return { found: given.size > 0, setup, ignored };
}

/** The setup's managed team if it plays in the theatre (`teams`: App's `setupTeams()`), else none (''). */
export function fieldedTeam(setup, teams) {
  const id = setup?.managedTeamId ? String(setup.managedTeamId) : '';
  return id && Array.isArray(teams) && teams.some(team => team.id === id) ? id : '';
}

// encodeURIComponent, keeping the theatre's "domestic:826" colon and a league's spaces ("Premier+League") readable.
const encodeValue = value => encodeURIComponent(value).replace(/%3A/gi, ':').replace(/%20/g, '+');

/**
 * The challenge query of a setup, or of a launched campaign's settings, without the "?": in CHALLENGE_KEYS order, only
 * what differs from a new setup, plus the seed. `seed` is the number the campaign plays (App's `setupSeed`), so a blank
 * seed field still shares the campaign it would launch. Rules hidden by another choice are left out, as launch drops
 * them: a spectator's opponent choice, a pairing draw's turn order, a sport's own club map.
 */
export function challengeQuery(settings = {}, seed = settings?.seed) {
  const s = { ...DEFAULT_SETUP, ...settings };
  const sport = getSport(s.sport);
  const dataSet = dataSetOf(s);
  const clubsOnly = !!sport.clubsOnly || (dataSet != null && !setHasNations(dataSet));
  const clubLayer = (s.layer === 'clubs' || clubsOnly) && !sport.nationsOnly;
  const theatre = clubLayer ? setClubScope({ ...s, layer: 'clubs' }) : s.scope;
  const rules = rulesOf(s);
  const show = showMatchesOf(s);
  const manager = s.role === 'manager';
  const values = {
    sport: sport.id !== DEFAULT_SETUP.sport ? sport.id : null,
    teams: clubLayer && !clubsOnly ? 'clubs' : null,
    // A sport's own map is its clubs' only theatre: the reader puts it back.
    theatre: theatre !== (clubLayer ? setClubScope({ ...s, layer: 'clubs', clubScope: DEFAULT_SETUP.clubScope }) : DEFAULT_SETUP.scope)
      ? theatre : null,
    season: dataSet,
    draw: rules.draw !== 'random' ? rules.draw : null,
    opponent: rules.targeting !== 'compass' ? rules.targeting : null,
    show: show !== 'ticker' ? show : null,
    upsets: s.uncertainty !== 'balanced' && offers(UNCERTAINTY_OPTIONS, s.uncertainty) ? s.uncertainty : null,
    final: s.finale === 'best-of-three' ? s.finale : null,
    signings: s.acquisitionPolicy === 'best-fit' ? s.acquisitionPolicy : null,
    home: s.homeAdvantage === 'on' ? s.homeAdvantage : null,
    strengths: sport.id === 'basketball' && s.rosterPreset === 'competitive' ? s.rosterPreset : null,
    role: manager ? 'manager' : null,
    team: manager && s.managedTeamId ? String(s.managedTeamId) : null,
    seed: seed != null && String(seed).trim() !== '' ? String(seed).trim() : null,
  };
  return CHALLENGE_KEYS.filter(key => values[key] != null).map(key => `${key}=${encodeValue(values[key])}`).join('&');
}

/** The challenge link: the page (`base`, its origin and path) and the setup's query. */
export function challengeUrl(base, settings, seed) {
  const query = challengeQuery(settings, seed);
  return `${base || ''}${query ? `?${query}` : ''}`;
}

const listed = names => (names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0] || '');

/** Setup's note for a setup a link filled in (App's `challenge`: the link's seed and the keys it could not use). */
export function challengeNote({ seed = '', ignored = [] } = {}) {
  const names = [...new Set(ignored)].map(key => CHALLENGE_LABELS[key]).filter(Boolean);
  return `${seed ? `Seed ${seed}. ` : ''}${names.length ? `Not offered here: ${listed(names)}.` : 'Launch it to play the same campaign.'}`;
}
