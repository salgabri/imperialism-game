// Every club of every country an earlier football season's source rates, for that season's own country maps
// (docs/design/domestic-campaigns.md, "Earlier seasons"). A built-in country map holds Football Manager 26's top clubs
// of today; an earlier season's holds that season's: England's 92 league clubs of FIFA 11 are not FIFA 21's. No I/O here:
// scripts/build-season-countries.mjs reads the sources through the season builders and hands each edition's players
// over.
//
// A club plays for the country it stands in, whatever league it plays in: the Welsh clubs of the English leagues,
// Canada's MLS clubs and Wellington Phoenix play for Wales, Canada and New Zealand, which have no map in any EA season,
// as on the built-in maps; AS Monaco stays on France's, as it does there. A club of a competition several countries
// play in (EA's Rest of World, FC 25's Libertadores and Sudamericana) plays for the country most of its players are
// from. Its squad is the season file's: pickFootballSquad's natural 4-4-2 XI, so a club on both a Europe map and a
// country map fields the same eleven.
import { NATIONS } from '../../src/data/teams.js';
import { setKindOf } from '../../src/engine/footballSets.js';
import { pickFootballSquad } from '../../src/data/footballSquad.js';
import { domesticCap } from '../../src/data/domesticTiers.js';
import { EUROPEAN_LEAGUES } from '../../src/data/footballLeagues.js';
import { eaPlayersOf } from './ea-seasons.mjs';
import { FOOTBALL_LEAGUES } from './first-divisions.mjs';
import { MIN_CLUBS, foldedNames, nameReason } from './domestic-sync.mjs';

export { MIN_CLUBS };
export const CLUB_SIZE = 11;

const league = (country, name) => Object.freeze({ country, name });
// Europe's first divisions as the club layer names them (scripts/lib/first-divisions.mjs), and every other competition
// an EA edition from FIFA 15 rates, by EA's competition id, which is the edition's own: the FIFA 15 – EA FC 24 export
// names a club's league as a later edition does (FIFA 15's Burnley sits in "Championship"), its id does not.
// Rest of World (76) is no country's.
export const EA_COMPETITIONS = Object.freeze({
  ...Object.fromEntries(Object.entries(FOOTBALL_LEAGUES).map(([id, entry]) => [id, league(entry.country, entry.league)])),
  14: league('826', 'Championship'), 60: league('826', 'League One'), 61: league('826', 'League Two'), 62: league('826', 'National League'),
  17: league('250', 'Ligue 2'), 20: league('276', '2. Bundesliga'), 2076: league('276', '3. Liga'), 32: league('380', 'Serie B'),
  54: league('724', 'La Liga 2'), 51: league('SCO', 'Scottish Championship'),
  39: league('840', 'MLS'), 341: league('484', 'Liga MX'), 353: league('032', 'Liga Profesional'), 7: league('076', 'Série A'),
  2025: league('076', 'Série B'), 335: league('152', 'Chilean Primera División'), 336: league('170', 'Categoría Primera A'),
  337: league('600', 'Paraguayan Primera División'), 338: league('858', 'Uruguayan Primera División'), 2017: league('068', 'Bolivian Primera División'),
  2018: league('218', 'LigaPro'), 2019: league('862', 'Venezuelan Primera División'), 2020: league('604', 'Liga 1'),
  347: league('710', 'South African Premiership'), 349: league('392', 'J1 League'), 350: league('682', 'Saudi Pro League'),
  351: league('036', 'A-League'), 83: league('410', 'K League 1'), 2012: league('156', 'Chinese Super League'),
  2013: league('784', 'UAE Pro League'), 2149: league('356', 'Indian Super League'),
});
// EA's Rest of World and the cup competitions EA's website files clubs under: no country's.
export const EA_REST_OF_WORLD = 76;

// FIFA 07 – FIFA 14's leagues as the SoFIFA scrape names them (scripts/lib/ea-legacy-seasons.mjs). The scrape names a
// club's league as it was later, so a club's division may be a later one; its country is the same.
export const SOFIFA_COMPETITIONS = Object.freeze({
  'English Premier League': league('826', 'Premier League'), 'English League Championship': league('826', 'Championship'),
  'English League One': league('826', 'League One'), 'English League Two': league('826', 'League Two'),
  'Spain Primera Division': league('724', 'La Liga'), 'Spanish Segunda División': league('724', 'La Liga 2'),
  'Italian Serie A': league('380', 'Serie A'), 'Italian Serie B': league('380', 'Serie B'),
  'German 1. Bundesliga': league('276', 'Bundesliga'), 'German 2. Bundesliga': league('276', '2. Bundesliga'),
  'French Ligue 1': league('250', 'Ligue 1'), 'French Ligue 2': league('250', 'Ligue 2'),
  'Holland Eredivisie': league('528', 'Eredivisie'), 'Portuguese Liga ZON SAGRES': league('620', 'Liga Portugal'),
  'Belgian Jupiler Pro League': league('056', 'Belgian Pro League'), 'Scottish Premiership': league('SCO', 'Scottish Premiership'),
  'Scottish Championship': league('SCO', 'Scottish Championship'), 'Scottish League One': league('SCO', 'Scottish League One'),
  'Turkish Süper Lig': league('792', 'Süper Lig'), 'Danish Superliga': league('208', 'Danish Superliga'),
  'Norwegian Eliteserien': league('578', 'Eliteserien'), 'Swedish Allsvenskan': league('752', 'Allsvenskan'),
  'Polish T-Mobile Ekstraklasa': league('616', 'Ekstraklasa'), 'Polish I liga': league('616', 'I liga'),
  'Polish II liga': league('616', 'II liga'), 'Polish IV liga': league('616', 'IV liga'),
  'Austrian Football Bundesliga': league('040', 'Austrian Bundesliga'), 'Swiss Super League': league('756', 'Swiss Super League'),
  'Swiss Challenge League': league('756', 'Swiss Challenge League'), 'Rep. Ireland Airtricity League': league('372', 'League of Ireland'),
  'Russian Premier League': league('643', 'Russian Premier League'), 'Czech Republic Gambrinus Liga': league('203', 'Czech First League'),
  'Greek Super League': league('300', 'Greek Super League'), 'Ukrainian Premier League': league('804', 'Ukrainian Premier League'),
  'USA Major League Soccer': league('840', 'MLS'), 'Mexican Liga MX': league('484', 'Liga MX'),
  'Argentina Primera División': league('032', 'Primera División'), 'Argentinian Primera B Nacional': league('032', 'Primera B Nacional'),
  'Campeonato Brasileiro Série A': league('076', 'Série A'), 'Campeonato Brasileiro Série B': league('076', 'Série B'),
  'Campeonato Brasileiro Série C': league('076', 'Série C'), 'Chilean Campeonato Nacional': league('152', 'Chilean Primera División'),
  'Colombian Liga Postobón': league('170', 'Categoría Primera A'), 'Korean K League 1': league('410', 'K League 1'),
  'Australian Hyundai A-League': league('036', 'A-League'), 'Saudi Abdul L. Jameel League': league('682', 'Saudi Pro League'),
  'South African Premier Division': league('710', 'South African Premiership'),
});

// EA FC 25's competitions as EA's website names them (scripts/lib/ea-site-seasons.mjs). Its Libertadores and
// Sudamericana list South America's clubs that play in them, whose own leagues it does not rate: no country's.
export const SITE_COMPETITIONS = Object.freeze({
  'Premier League': league('826', 'Premier League'), 'EFL Championship': league('826', 'Championship'),
  'EFL League One': league('826', 'League One'), 'EFL League Two': league('826', 'League Two'),
  'LALIGA EA SPORTS': league('724', 'La Liga'), 'LALIGA HYPERMOTION': league('724', 'La Liga 2'),
  'Serie A Enilive': league('380', 'Serie A'), 'Serie BKT': league('380', 'Serie B'),
  Bundesliga: league('276', 'Bundesliga'), 'Bundesliga 2': league('276', '2. Bundesliga'), '3. Liga': league('276', '3. Liga'),
  "Ligue 1 McDonald's": league('250', 'Ligue 1'), 'Ligue 2 BKT': league('250', 'Ligue 2'),
  Eredivisie: league('528', 'Eredivisie'), 'Liga Portugal': league('620', 'Liga Portugal'),
  'Trendyol Süper Lig': league('792', 'Süper Lig'), '1A Pro League': league('056', 'Belgian Pro League'),
  'Hellas Liga': league('300', 'Greek Super League'), 'Česká Liga': league('203', 'Czech First League'),
  'Scottish Prem': league('SCO', 'Scottish Premiership'), '3F Superliga': league('208', 'Danish Superliga'),
  Eliteserien: league('578', 'Eliteserien'), 'Ukrayina Liha': league('804', 'Ukrainian Premier League'),
  'Liga Hrvatska': league('191', 'Croatian HNL'), 'PKO BP Ekstraklasa': league('616', 'Ekstraklasa'),
  CSSL: league('756', 'Swiss Super League'), 'Ö. Bundesliga': league('040', 'Austrian Bundesliga'),
  'Liga Azerbaijan': league('031', 'Azerbaijan Premier League'), 'Magyar Liga': league('348', 'Hungarian NB I'),
  SUPERLIGA: league('642', 'Romanian Liga I'), 'Liga Cyprus': league('196', 'Cypriot First Division'),
  Allsvenskan: league('752', 'Allsvenskan'), Finnliiga: league('246', 'Veikkausliiga'),
  'SSE Airtricity PD': league('372', 'League of Ireland'), MLS: league('840', 'MLS'),
  'ROSHN Saudi League': league('682', 'Saudi Pro League'), 'Primera División': league('032', 'Liga Profesional'),
  CSL: league('156', 'Chinese Super League'), 'A-League': league('036', 'A-League'), ISL: league('356', 'Indian Super League'),
  'K League 1': league('410', 'K League 1'), 'United Emirates League': league('784', 'UAE Pro League'),
  'Liga Colombia': league('170', 'Categoría Primera A'),
});
export const SITE_CUPS = Object.freeze(['Libertadores', 'Sudamericana']);

for (const table of [EA_COMPETITIONS, SOFIFA_COMPETITIONS, SITE_COMPETITIONS]) {
  for (const entry of Object.values(table)) if (!NATIONS[entry.country]) throw new Error(`No game nation ${entry.country} (${entry.name})`);
}
for (const [name, country] of Object.entries(EUROPEAN_LEAGUES)) if (!NATIONS[country]) throw new Error(`No game nation ${country} (${name})`);

const fold = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Clubs that stand in another country than their league's, by their folded name, and the country they stand in: the
// built-in maps leave them off their league's country too (FM files them under their own nation).
const ABROAD = [
  [/^(?:cardiff city|swansea city|newport county|wrexham|merthyr town)(?: a ?f ?c| fc)?$/, 'WAL'],
  [/^(?:toronto fc|toronto|toronto blizzard|(?:vancouver )?whitecaps(?: fc)?|vancouver|vancouver 86ers|montreal impact|cf montreal|club de foot montreal|impact montreal|montreal)$/, '124'],
  [/^(?:wellington phoenix(?: fc)?|well phoenix|wellington|auckland fc|auckland)$/, '554'],
  [/^derry city(?: fc)?$/, 'NIR'],
  [/^(?:fc )?vaduz$/, null], [/^(?:fc )?andorra$/, null],
];
/** The country a club stands in when it is not its league's: a nation id, null for none the game has, undefined for its league's. */
export function abroadCountry(name) {
  const key = fold(name);
  const hit = ABROAD.find(([pattern]) => pattern.test(key));
  return hit ? hit[1] : undefined;
}

/** The nation most of a club's players are from, when it is more than half of them; else null. */
function homeNationOf(pool) {
  const tally = new Map();
  for (const player of pool) if (player.nationId) tally.set(player.nationId, (tally.get(player.nationId) || 0) + 1);
  const [nation, n] = [...tally].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0] || [null, 0];
  return n * 2 > pool.length ? nation : null;
}

/**
 * An EA edition's clubs by country, from the player records one of the EA season builders hands its `assemble`
 * (scripts/lib/ea-season-builds.mjs): each record names its club (`clubKey`, `club`) and its competition (`leagueId`
 * for the export and the snapshot, `leagueName` for the FIFA 07 – FIFA 14 scrape, `siteLeague` and `team` for EA FC 25's
 * website export). Returns `{ id, year, edition, source, kind: 'ea', clubs, skipped }`: `clubs` every club with a
 * competition of a country, `{ key, name, league, country, squad }` (`squad` pickFootballSquad's XI, players carrying
 * their tuples), and `skipped` the competitions no table names, with their club counts.
 */
export function eaSeasonClubs(records, { id, year, edition, source }) {
  const { players } = eaPlayersOf(records, { edition, source });
  const byClub = new Map(), skipped = {};
  records.forEach((record, i) => {
    const player = players[i];
    let competition = null, key = null, cup = false;
    if (record.leagueId !== undefined) {
      if (!record.leagueId || !record.clubKey) return;
      key = `ea:${record.clubKey}`;
      competition = EA_COMPETITIONS[record.leagueId] || null;
      cup = record.leagueId === EA_REST_OF_WORLD;
      if (!competition && !cup) skipped[`${record.leagueId}`] = (skipped[`${record.leagueId}`] || 0) + 1;
    } else if (record.leagueName !== undefined) {
      if (!record.clubKey) return;
      key = `club:${record.clubKey}`;
      competition = SOFIFA_COMPETITIONS[record.leagueName] || null;
      if (!competition) skipped[record.leagueName] = (skipped[record.leagueName] || 0) + 1;
    } else if (record.siteLeague !== undefined) {
      if (!record.team) return;
      key = `site:${record.siteLeague}:${record.team}`;
      competition = SITE_COMPETITIONS[record.siteLeague] || null;
      cup = SITE_CUPS.includes(record.siteLeague);
      if (!competition && !cup) skipped[record.siteLeague] = (skipped[record.siteLeague] || 0) + 1;
    } else {
      throw new Error(`${edition}: a player record names no competition; build it through scripts/lib/ea-season-builds.mjs`);
    }
    if (!competition && !cup) return;
    const name = player.sourceInfo.club;
    if (!byClub.has(key)) byClub.set(key, { key, name, competition, cup, pool: [] });
    const club = byClub.get(key);
    if (club.name !== name) throw new Error(`${edition}: club ${key} is both ${club.name} and ${name}`);
    club.pool.push(player);
  });
  const clubs = [];
  for (const club of byClub.values()) {
    const abroad = abroadCountry(club.name);
    const country = abroad !== undefined ? abroad : club.cup ? homeNationOf(club.pool) : club.competition.country;
    if (!country) continue;
    // A cup club's league is its country's first division as EA names it nowhere: its country's top flight.
    const leagueName = club.competition?.name ?? null;
    clubs.push({ key: club.key, name: club.name, league: leagueName, country, cup: club.cup, squad: pickFootballSquad(club.pool) });
  }
  return { id, year, edition, source, kind: 'ea', clubs, skipped };
}

/**
 * A season before FIFA 05, Championship Manager's or SWOS's, from its reader's result with `everyClub`
 * (scripts/lib/retro-season-builds.mjs): `{ doc, allClubs }`, each club with its nation as the game names it (`country`:
 * a CM club's own nation, a SWOS club its league file's). A club with no nation of the game's plays on no map. Returns
 * eaSeasonClubs' shape.
 */
export function retroSeasonClubs({ doc, allClubs }) {
  if (!Array.isArray(allClubs)) throw new Error(`${doc.id}: its reader gave no clubs (everyClub)`);
  const clubs = [];
  for (const club of allClubs) {
    const abroad = abroadCountry(club.name);
    const country = abroad !== undefined ? abroad : NATIONS[club.country] ? club.country : null;
    if (country) clubs.push({ key: club.key, name: club.name, short: club.short ?? null, league: club.league, country, cup: false, squad: club.squad });
  }
  return { id: doc.id, year: doc.year, edition: doc.label, source: doc.source, kind: setKindOf(doc.id), clubs, skipped: {} };
}

const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// The seasons' sources shorten the first team's name in its reserve side's ("B. Dortmund II", "Ath. Bilbao B",
// "SpVgg Gr. Fürth Amateure") or put the marker inside it ("Dinamo-2 Kiev", "Dinamo-Yuni Minsk"), which the built-in
// maps' rule, written for FM's names, does not read. Markers: last word, "Jong" first, or a hyphen's inside the name.
const END_MARKERS = new Set(['b', 'c', 'ii', 'iii', '2', '3', 'reserve', 'reserves', 'reserva', 'reservas', 'amateure', 'amateurs', 'castilla', 'atletic']);
const INNER_MARKERS = new Set(['2', 'ii', 'yuni']);
const NAME_TOKENS = new Set(['fc', 'cf', 'ac', 'sc', 'afc', 'cd', 'ss', 'as', 'us', 'ssc', 'rcd', 'ud', 'sd', 'ca', 'rc', 'sk', 'sv', 'fk', 'nk',
  'krc', 'kaa', 'kv', 'rsc', 'rfc', 'ksv', 'kvc', 'club', 'sad']);
const plain = text => String(text || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/['’]/g, '');
/**
 * A name's words, a shortened one keeping its full stop ("ath."), club words (FC, SV) and ordinals ("1. FC Köln") left
 * out, with the hyphens that join them.
 */
const wordsOf = text => plain(text).split(/\s+/).flatMap(part => part.split(/(?=-)|(?<=-)/)).map(word => word.replace(/[^a-z0-9.-]/g, ''))
  .filter(word => word && !NAME_TOKENS.has(word.replace(/\.$/, '')) && !/^\d+\.$/.test(word));
/** Whether two words of five letters or more differ by one letter added, dropped or changed ("metalurg", "metallurg"). */
function oneLetterApart(a, b) {
  if (a.length < 5 || b.length < 5 || Math.abs(a.length - b.length) > 1 || a.includes('.') || b.includes('.')) return false;
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  return a.slice(i + (a.length >= b.length ? 1 : 0)) === b.slice(i + (b.length >= a.length ? 1 : 0));
}
/**
 * One word of a name read as another: the same, one cut short with a full stop ("ath." for "athletic", "b." for
 * "borussia"), or one spelt a letter apart, as two editions of a source spell a club ("Metalurg-2 Donetsk" beside
 * "Metallurg Donetsk").
 */
const sameWord = (a, b) => a === b || (a.endsWith('.') && b.startsWith(a.slice(0, -1)) && a.length > 1)
  || (b.endsWith('.') && a.startsWith(b.slice(0, -1)) && b.length > 1) || oneLetterApart(a, b);
/**
 * Whether `first`'s words run on in `second`'s, word for word, with at least one whole word of three letters or more the
 * same ("Borussia Dortmund" in CM's "BV Borussia Dortmund"). Numbers do not count ("Bayer Leverkusen Amateure" is Bayer
 * 04 Leverkusen's, "TSV München 1860 Amateure" TSV 1860 München's).
 */
const unnumbered = words => words.filter(word => !/^\d+$/.test(word));
const within = (first, second) => {
  const [a, b] = [unnumbered(first), unnumbered(second)];
  if (!a.length || a.length > b.length) return false;
  for (let at = 0; at + a.length <= b.length; at++) {
    if (a.every((word, i) => sameWord(word, b[at + i])) && a.some((word, i) => word === b[at + i] && word.length >= 3)) return true;
  }
  return false;
};

/** A name's words without its second-team marker, or null when it carries none. */
function withoutMarker(name) {
  const words = wordsOf(name);
  if (words.length > 1 && words[0] === 'jong') return words.slice(1).filter(word => word !== '-');
  if (words.length > 1 && END_MARKERS.has(words.at(-1).replace(/\.$/, ''))) return words.slice(0, -1).filter(word => word !== '-');
  const inner = words.findIndex((word, i) => INNER_MARKERS.has(word) && words[i - 1] === '-');
  return inner > 0 ? words.filter((word, i) => i !== inner && word !== '-') : null;
}

/**
 * Why a season's club is no senior side of its own, or null: the built-in maps' rule (nameReason in
 * scripts/lib/domestic-sync.mjs), so a second-team marker counts only when the rest of the name is a stronger club of
 * the same country, and that rest may shorten the stronger club's name (withoutMarker). "Borussia Dortmund II", "B.
 * Dortmund II", "FC Barcelona B" and "Real Madrid Castilla" are reserve sides; "Willem II" is Tilburg's club and
 * "Jong Rambaan" a senior club. Age groups (U-21, Sub-20) and all-star sides are never senior sides; a school's name
 * counts only outside a senior league. `stronger`: the country's clubs ranked above it, `{ folded, words }` (rememberStronger).
 */
export function secondTeamReason(club, stronger) {
  const reason = nameReason({ name: club.name, shortName: club.short ?? null, competition: club.league ? { name: club.league } : null }, stronger.folded);
  if (reason) return reason;
  const base = withoutMarker(club.name);
  if (!base?.length) return null;
  // The stronger club's name runs on in the rest, or the rest in that name; a rest of one word must be the whole name.
  return stronger.words.some(parent => within(parent, base) || (unnumbered(base).length > 1 && within(base, parent))) ? 'reserve side' : null;
}

/**
 * Adds a club's names to a country's `stronger` record (secondTeamReason): its name, short name and, for a SWOS club,
 * the name SWOS writes (its key, "swos:024:ATHLETIC BILBAO"), which its reserve side's shortens ("ATH. BILBAO B").
 */
export function rememberStronger(stronger, club) {
  for (const name of foldedNames({ name: club.name, shortName: club.short ?? null })) stronger.folded.add(name);
  const written = /^swos:[^:]+:(.+)$/.exec(club.key ?? '')?.[1];
  for (const name of [club.name, club.short, written].filter(Boolean)) stronger.words.push(wordsOf(name).filter(word => word !== '-'));
}

/**
 * A season's country fields: every country with at least MIN_CLUBS clubs that field eleven players and a natural
 * goalkeeper, reserve and youth sides left out as the built-in maps leave them out (secondTeamReason), each its
 * strongest min(tier, clubs) of them (src/data/domesticTiers.js, as the built-in maps), strongest first by
 * `strengthOf(club)` (ties by name). `clubs` are eaSeasonClubs' (or the CM and SWOS readers'). Returns
 * `{ fields: Map(country → clubs), short: [{ country, clubs }] }`: `short` the countries below MIN_CLUBS.
 */
export function countryFields(clubs, strengthOf) {
  const byCountry = new Map();
  for (const club of clubs) {
    if (club.squad.length < CLUB_SIZE || !club.squad.some(player => player.positions.includes('GK'))) continue;
    (byCountry.get(club.country) || byCountry.set(club.country, []).get(club.country)).push({ ...club, str: strengthOf(club) });
  }
  const fields = new Map(), short = [];
  for (const [country, ranked] of [...byCountry].sort(([a], [b]) => byText(a, b))) {
    ranked.sort((a, b) => b.str - a.str || byText(a.name, b.name) || byText(a.key, b.key));
    const stronger = { folded: new Set(), words: [] }, list = [];
    for (const club of ranked) {
      if (!secondTeamReason(club, stronger)) list.push(club);
      rememberStronger(stronger, club);
    }
    if (list.length < MIN_CLUBS) { short.push({ country, clubs: list.length }); continue; }
    fields.set(country, list.slice(0, domesticCap(country)));
  }
  return { fields, short };
}
