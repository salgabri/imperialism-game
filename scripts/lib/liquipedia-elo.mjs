// A team esport's player Elo from a Liquipedia export, and the national teams it fields: the rules Rocket League's
// ratings were built with (scripts/lib/rocket-league.mjs, docs/design/rocket-league.md), shared with Counter-Strike's
// (scripts/lib/counter-strike.mjs, docs/design/counter-strike.md). Each sport passes its own numbers (how many play, how
// many a nation names, its K, its scale) and its own reading of the wiki (which events count, how a game reads); the
// rules themselves are one. No I/O.
//
// Every rating is an Elo, built game by game from every series the export holds, in date order: a team plays at the
// mean of its players' Elo, the winner of each game takes K × (1 − E) from the loser (E, Elo's expected score for the
// gap), and each player moves by his team's amount. A player's K shrinks with the games he has played (`kFactor`), so a
// newcomer finds his level quickly and a veteran's rating holds. Nothing is estimated: a player is rated only from the
// games Liquipedia records him in, and only a player who has played lately (`activeDays`) plays.
import { FLAG_CODES } from '../../src/data/flags.js';
import { HOME_NATIONS, NATIONS, nationIdentity } from '../../src/data/teams.js';
import { isStagePage, normalTitle, personOf, plainText, rootOf, rostersOf, seriesOf, subpagesOf, teamKeys, tournamentOf }
  from './liquipedia.mjs';

/** Elo's expected score for a side `gap` points ahead. */
export const expected = gap => 1 / (1 + 10 ** (-gap / 400));

// ---------- nations ----------

// Liquipedia's flags are ISO 3166 alpha-2 codes for the most part ("fr", "us"), with its own codes for the United
// Kingdom's home nations ("uken", "uksc", "ukwa", "ukni"), now and then a country's name, abbreviation or misspelling, and
// territories whose players play for their state: Réunion, Guadeloupe and New Caledonia for France, Curaçao and Aruba for
// the Kingdom of the Netherlands (as baseball's World Baseball Classic counts them), Jersey for Great Britain. Counted
// over Rocket League's export of 2026-11-14.
const FLAG_ALIASES = {
  uk: '826', gb: '826', en: '826', eng: '826', england: '826', 'gb-eng': '826', uken: '826', 'united kingdom': '826',
  'great britain': '826', je: '826', jersey: '826',
  sco: 'SCO', sct: 'SCO', scotland: 'SCO', 'gb-sct': 'SCO', uksc: 'SCO', wal: 'WAL', wls: 'WAL', wales: 'WAL', 'gb-wls': 'WAL',
  ukwa: 'WAL', wa: 'WAL', nir: 'NIR', 'northern ireland': 'NIR', 'gb-nir': 'NIR', ukni: 'NIR',
  usa: '840', 'united states of america': '840', ksa: '682', uae: '784', kosovo: 'KOS', xk: 'KOS', korea: '410',
  'south korea': '410', 'republic of korea': '410', czechia: '203', 'czech republic': '203', czech: '203', turkiye: '792',
  holland: '528', 'bosnia and herzegovina': '070', 'ivory coast': '384', 'cote d ivoire': '384', 'dr congo': '180',
  'democratic republic of the congo': '180', 'north macedonia': '807', macedonia: '807', taiwan: '158', 'chinese taipei': '158',
  tw: '158', // the game flies Chinese Taipei's own flag ("tpe"); the sites file its players under Taiwan's code
  russia: '643', 'russian federation': '643', vietnam: '704', 'viet nam': '704', iran: '364', syria: '760', palestine: '275',
  mex: '484', arg: '032', gha: '288', ger: '276', phl: '608', auz: '036', sweeden: '752', hn: '340', honduras: '340',
  re: '250', reunion: '250', gp: '250', guadeloupe: '250', mq: '250', martinique: '250', gf: '250', 'french guiana': '250',
  nc: '250', ncl: '250', 'new caledonia': '250', pf: '250', 'french polynesia': '250',
  cw: '528', curacao: '528', aw: '528', aruba: '528',
};
// Flags of a region, not a country: a player filed only under one has no nation until his page or a national team gives one.
const REGION_FLAGS = new Set(['usca', 'north america', 'na', 'oce', 'sam', 'mena', 'eu', 'europe', 'anz', 'asia', 'apac', 'world',
  'africa', 'caf', 'south america', 'ssa', 'emea', 'latam', 'nordic', 'nordics', 'benelux', 'balkans', 'cis', 'unknown', 'tbd']);
// Accents dropped first, so "réunion", "türkiye" and "curaçao" read as their plain spellings.
const letters = text => String(text).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z-]+/g, ' ').trim();
const NATION_OF_FLAG = new Map([
  ...Object.entries(FLAG_CODES).filter(([id]) => Object.hasOwn(NATIONS, id)).map(([id, code]) => [code, id]),
  ...Object.entries(NATIONS).map(([id, record]) => [letters(record[0]), id]),
  ...Object.entries(FLAG_ALIASES).filter(([, id]) => Object.hasOwn(NATIONS, id)),
]);

/**
 * The game's nation for a Liquipedia flag (or a country's name), or null for none, a region's flag, or a country the map
 * does not draw (Hong Kong, Singapore, Malta). The esports play Great Britain as one, as tennis does: the home nations
 * are the United Kingdom's (826).
 */
export function nationOfFlag(flag) {
  if (!flag) return null;
  const text = String(flag).toLowerCase().trim();
  if (REGION_FLAGS.has(text)) return null;
  const id = NATION_OF_FLAG.get(text) ?? NATION_OF_FLAG.get(letters(flag)) ?? null;
  return id && HOME_NATIONS.includes(id) ? '826' : id;
}

/** Whether a flag names a region rather than a country ("usca", "north america", "eu"). */
export const isRegionFlag = flag => REGION_FLAGS.has(String(flag ?? '').toLowerCase().trim());

// ---------- players ----------

/** A player's key: the page he links to, else his name, as MediaWiki compares titles. */
export const playerKey = player => normalTitle(player.link || player.name);

/** A player key's loose spelling: lower case, letters and digits only ("Atow." and "atow" → "atow"). */
export const looseKey = key => String(key ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '');

/**
 * One key a player, whatever a roster calls him: a page that redirects is its target's, and the spellings of one name that
 * differ only in case and punctuation ("Atow" on Belgium's national roster, "Atow." on his clubs'; "AcroniK", "AcroniK.")
 * are the spelling the rosters use most, unless their nations clash (each spelling's flags and national teams). A page
 * the wiki disambiguates ("Dead (Israeli Player)") is spelt apart, so it never meets a namesake. Each roster player whose
 * key folds gets the kept key as his `link`, so every game of his counts for one rating. `nationOfName`: the nation a
 * national team's name is (nationOfTeam by default).
 * → Map(folded key → kept key)
 */
export function foldPlayers(tournaments, redirects = new Map(), nationOfName = nationOfTeam) {
  const follow = key => {
    let at = key;
    for (let hop = 0; hop < 5 && redirects.has(at); hop++) at = redirects.get(at);
    return at;
  };
  const uses = new Map();
  for (const tournament of tournaments) {
    const national = tournament.nations;
    for (const roster of tournament.rosters) {
      const side = national ? nationOfName(roster.team) : null;
      for (const player of roster.players) {
        const key = follow(playerKey(player));
        const row = uses.get(key) ?? { key, n: 0, nations: new Set() };
        row.n++;
        const nation = nationOfFlag(player.flag) ?? side;
        if (nation) row.nations.add(nation);
        uses.set(key, row);
      }
    }
  }
  const groups = new Map();
  for (const row of uses.values()) {
    const loose = looseKey(row.key);
    if (!loose) continue;
    if (!groups.has(loose)) groups.set(loose, []);
    groups.get(loose).push(row);
  }
  const kept = new Map();
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    members.sort((a, b) => b.n - a.n || a.key.localeCompare(b.key));
    const [head, ...rest] = members;
    const nations = new Set(head.nations);
    for (const member of rest) {
      if (member.nations.size && nations.size && ![...member.nations].some(nation => nations.has(nation))) continue;
      kept.set(member.key, head.key);
      for (const nation of member.nations) nations.add(nation);
    }
  }
  const folded = new Map();
  for (const tournament of tournaments) {
    for (const roster of tournament.rosters) {
      for (const player of roster.players) {
        const own = playerKey(player), followed = follow(own), to = kept.get(followed) ?? followed;
        if (to !== own) {
          folded.set(own, to);
          player.link = to;
        }
      }
    }
  }
  return folded;
}

// ---------- teams ----------

// A series names its teams by the wiki's team templates ("nip", "kc", "flcn", "Genesis (South American Team)"), its event's
// rosters by their names ("Ninjas in Pyjamas", "Karmine Corp", "Team Falcons", "Genesis"): the templates themselves are not
// in the export, so a template is matched to a roster of the same event by its name without a disambiguation or region
// tag, else as an abbreviation.
const DISAMBIGUATION = /\s*\([^)]*\)\s*/g;
const REGION_TAG = /\s+(?:eu|euw|na|sam|br|oce|au|nz|ksa|mena|me|apac|ssa|za|us|uk|fr)$/i;
/** A team's name without its disambiguation or region tag: "Genesis (South American Team)" and "genesis sam" → "genesis". */
export const baseTeamName = name => plainText(name).replace(DISAMBIGUATION, ' ').replace(REGION_TAG, '').trim();
/** The nation a national team's name is ("France", "Saudi Arabia"), or null for a club's. */
export const nationOfTeam = name => nationOfFlag(baseTeamName(name));
const words = name => plainText(name).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/).filter(Boolean);
const FILLER = new Set(['team', 'esports', 'esport', 'gaming', 'club', 'gg', 'the']);
const isSubsequence = (short, long) => { let i = 0; for (const c of long) if (c === short[i]) i++; return i === short.length; };

/**
 * How well a short template (`short`: a team key, "nip") names a roster's team (`name`): 3 its initials ("Ninjas in
 * Pyjamas", "Karmine Corp", "Shopify Rebellion"), 2 the start of its name ("vit": "Team Vitality", "dig": "Dignitas"), 1
 * its letters in order from the first ("flcn": "Team Falcons", "ssg": "Spacestation Gaming"), 0 none.
 */
export function abbreviationScore(short, name) {
  if (!short || short.length > 6) return 0;
  const all = words(name), own = all.filter(word => !FILLER.has(word));
  const initials = [all, own].map(list => list.map(word => word[0]).join(''));
  if (initials.includes(short) && short.length >= 2) return 3;
  const joined = own.join('') || all.join(''), whole = all.join('');
  if (joined.startsWith(short) && short.length >= 3) return 2;
  return short.length >= 2 && [joined, whole].some(name => name[0] === short[0] && isSubsequence(short, name)) ? 1 : 0;
}

/**
 * Whether a template names a roster's team by one of its words: its first word ("eclot", "betboom", the "unity" of
 * "unity.sk"), three letters or more, is a word of the team's name ("Dynamo Eclot", "BetBoom Team", "UNiTY esports").
 * Counter-Strike's wiki names many teams so; Rocket League's reading does not use it.
 */
export function wordScore(template, name) {
  const first = words(template)[0];
  return first && first.length >= 3 && words(name).includes(first) ? 2 : 0;
}

/** How near in days a tournament's roster may be borrowed for a team its own lists under no name the series uses. */
export const BORROW_DAYS = 120;

const DAY = 86400000;
const daysBetween = (from, to) => Math.round((Date.parse(to) - Date.parse(from)) / DAY);

/**
 * The roster a series' team played with: its own tournament's (by name, by name without its tag, else as the unique best
 * abbreviation, or with `templateWords` the unique best of an abbreviation and a word of its name: wordScore), else the
 * same team's at the nearest tournament within BORROW_DAYS.
 */
function rosterFinder(tournaments, { templateWords = false } = {}) {
  const byKey = new Map();
  tournaments.forEach((tournament, at) => {
    for (const roster of tournament.rosters) {
      for (const key of new Set([...roster.keys, ...teamKeys(baseTeamName(roster.team))])) {
        if (!byKey.has(key)) byKey.set(key, []);
        byKey.get(key).push({ at, roster });
      }
    }
  });
  const days = (a, b) => Math.abs(Date.parse(tournaments[a].start ?? '') - Date.parse(tournaments[b].start ?? '')) / DAY;
  return (tournamentAt, team) => {
    const keys = [...new Set([...teamKeys(team), ...teamKeys(baseTeamName(team))])];
    const candidates = keys.flatMap(key => byKey.get(key) ?? []);
    const own = candidates.find(candidate => candidate.at === tournamentAt);
    if (own) return { roster: own.roster, borrowed: false };
    // An abbreviation, if exactly one of the event's rosters answers to it best.
    const short = teamKeys(baseTeamName(team))[0];
    const scoreOf = roster => Math.max(abbreviationScore(short, roster.team), templateWords ? wordScore(team, roster.team) : 0);
    const scored = tournaments[tournamentAt].rosters.map(roster => ({ roster, score: scoreOf(roster) }))
      .filter(entry => entry.score > 0).sort((a, b) => b.score - a.score);
    if (scored.length && (scored.length === 1 || scored[0].score > scored[1].score)) return { roster: scored[0].roster, borrowed: false, alias: true };
    const near = candidates.filter(candidate => days(candidate.at, tournamentAt) <= BORROW_DAYS)
      .sort((a, b) => days(a.at, tournamentAt) - days(b.at, tournamentAt))[0];
    return near ? { roster: near.roster, borrowed: true } : null;
  };
}

/**
 * The nation each player last played for in a national-team event (a tournament marked `nations`) → Map(player key →
 * { nation, team, date }): his team there is his country's (`nationOfName`, nationOfTeam by default). The ratings take it
 * before any flag, as rugby league takes a player's Test side before his birthplace.
 */
export function nationalTeams(tournaments, nationOfName = nationOfTeam) {
  const out = new Map();
  for (const tournament of tournaments) {
    if (!tournament.nations) continue;
    for (const roster of tournament.rosters) {
      const nation = nationOfName(roster.team);
      if (!nation) continue;
      for (const player of roster.players) {
        const key = playerKey(player), date = tournament.start ?? '';
        if (!out.has(key) || String(out.get(key).date) <= date) out.set(key, { nation, team: roster.team, date });
      }
    }
  }
  return out;
}

// ---------- scoring a prediction ----------

function newScore() { return { n: 0, logLoss: 0, brier: 0 }; }
function score(into, e, won) {
  const p = Math.min(1 - 1e-9, Math.max(1e-9, e));
  into.n++;
  into.logLoss -= won ? Math.log(p) : Math.log(1 - p);
  into.brier += (won - p) ** 2;
}
/** A score's means: { n, logLoss, brier }. */
export const scoreOf = into => ({ n: into.n, logLoss: into.n ? into.logLoss / into.n : null, brier: into.n ? into.brier / into.n : null });

/** A player's home region: the one whose events he has played most games in, or null (international events only). */
export const homeOf = player => [...(player?.regions ?? new Map()).entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))[0]?.[0] ?? null;

/**
 * A player's flag: of the flags his team cards file him under, the one naming a country most often (a region's, "usca" or
 * "eu", only if nothing else), else the country his own page gives (`people`, readTournaments'), as the wiki reads it.
 */
export function flagOf(player, people = new Map()) {
  const flags = [...player.flags.entries()].sort((x, y) => y[1] - x[1]);
  const country = flags.find(([flag]) => nationOfFlag(flag) != null)?.[0];
  const page = people.get(player.key) ?? people.get(`~${looseKey(player.key)}`) ?? null;
  return country ?? (page && nationOfFlag(page) != null ? page : null) ?? flags[0]?.[0] ?? page;
}

/**
 * The nation a player plays for (`player` a run's): the one he last played for in a national-team event (`national`,
 * nationalTeams'), else his flag's (flagOf), else none.
 */
export const nationOfPlayer = (player, people = new Map(), national = new Map()) =>
  national.get(player.key)?.nation ?? nationOfFlag(flagOf(player, people));

/**
 * The favourite's odds a game, in ODDS_BINS bins of 1% from even (0.50–0.51 the first, 0.99–1 the last): how an earlier
 * season's real games are kept, so its scoring can be solved at their own odds.
 */
export const ODDS_BINS = 50;
export const oddsBin = e => Math.min(ODDS_BINS - 1, Math.floor((Math.max(e, 1 - e) - 0.5) * 2 * ODDS_BINS));
/** A bin's middle: 0.505 for the first. */
export const binOdds = bin => 0.5 + (bin + 0.5) / (2 * ODDS_BINS);

/** The snapshot's row: `[key, name, flag, nation, national team, elo, games, wins, last, team, region]`. */
export const rowOf = p => [p.key, p.name, p.flag, p.nation, p.side, p.elo, p.games, p.wins, p.last, p.team, p.region];

const byElo = (a, b) => b.elo - a.elo || a.name.localeCompare(b.name);

/**
 * A squad whose players each have a name of his own: two of a nation's who go by one name (two players Liquipedia keeps
 * apart, or one under two pages) are each shown by his page's title, a disambiguation left out ("Abdullah (Omani Player)"
 * and "Abdullahrll" rather than two Abdullahs), and one still alike gets " II".
 */
function distinctNames(squad) {
  const count = new Map();
  for (const player of squad) count.set(player.name, (count.get(player.name) ?? 0) + 1);
  const seen = new Set();
  return squad.map(player => {
    let name = count.get(player.name) > 1 ? player.key.replace(/ \([^)]*\)$/, '') : player.name;
    if (seen.has(name)) name = `${name} II`;
    seen.add(name);
    return name === player.name ? player : { ...player, name };
  });
}

// ---------- one sport's ratings ----------

/**
 * One sport's ratings, its numbers bound in (`config`):
 *   wiki, sourceId, edition: where the ratings come from, as a player's source names it;
 *   lineup: how many play for a team (the Elo's mean, the nation's strength); teamSize: how many a nation names; minPlayers:
 *     the fewest a nation needs to field a team;
 *   minGames: the games a player needs behind him to be rated; activeDays: how long since his last game he still plays;
 *   start: a newcomer's Elo; eloPerPoint, eloOffset: the game's scale (rating = (Elo + eloOffset) / eloPerPoint);
 *   kScale, kFloor: K per game, kScale / (games + 5) ^ 0.4, never below kFloor;
 *   position: every player's place in the game's squads ('PLR');
 *   tournamentOf(page): the wiki's reading of an infobox (liquipedia.mjs's tournamentOf by default);
 *   skips: { reason: (tournament, title) → true to leave the event out }, tested in order;
 *   isNationsEvent(title, tournament, rosters): whether national teams play it; nationOfTeamName(name): the nation a
 *     national team's name is (nationOfTeam by default);
 *   starters: a team card's places that start (rostersOf); gameOf: how the wiki writes a game (seriesOf);
 *   templateWords: a series' team template may name its roster by a word of its name (wordScore).
 */
export function createLiquipediaElo(config) {
  const { wiki, sourceId = 'liquipedia', edition = 'Liquipedia Elo', lineup, teamSize, minPlayers, minGames, activeDays,
    start = 1500, eloPerPoint, eloOffset, kScale, kFloor, position = 'PLR', skips = {}, isNationsEvent = () => false,
    nationOfTeamName = nationOfTeam, starters = lineup, gameOf, templateWords = false } = config;
  const readTournament = config.tournamentOf ?? (page => tournamentOf(page));
  const rosterOptions = { starters };
  const seriesOptions = gameOf ? { gameOf } : {};
  // A side is the host nation's at a LAN when most of its players are of it: two of three, three of five.
  const majority = Math.floor(lineup / 2) + 1;

  /** A player's Elo on the game's scale, rounded. */
  const gameRating = elo => Math.round((elo + eloOffset) / eloPerPoint);

  /** A player's K after `games` games. */
  const kFactor = (games, scale = kScale) => Math.max(kFloor, scale / (games + 5) ** 0.4);

  /**
   * Liquipedia's pages (readExport, every file's) → what the ratings play: the tournaments no skip leaves out, each with
   * its teams and series, and what was left out and why.
   * → { tournaments: [{ title, ...tournament, nations, rosters, series }], missing: [stage pages linked but not exported],
   *     skipped: { reason: [titles] (each skip's, then noInfobox) }, people: Map(player page title, and '~' + its loose
   *     spelling → the country his page files him under), folded: Map(a player's other spelling → the key he plays
   *     under, foldPlayers) }
   */
  function readTournaments(pages) {
    const byTitle = new Map();
    for (const page of pages) {
      if (page.ns !== 0) continue;
      const title = normalTitle(page.title);
      // A title exported twice (two files): the later revision stands.
      const previous = byTitle.get(title);
      if (previous && String(previous.timestamp) > String(page.timestamp)) continue;
      byTitle.set(title, { ...page, title, tournament: readTournament(page) });
    }
    const roots = new Map();
    const skipped = { ...Object.fromEntries(Object.keys(skips).map(reason => [reason, new Set()])), noInfobox: new Set() };
    const people = new Map(), redirects = new Map();
    for (const page of byTitle.values()) {
      const target = /^\s*#REDIRECT\s*\[\[([^\]|#]+)/i.exec(page.text)?.[1];
      if (target) {
        redirects.set(page.title, normalTitle(target));
        continue;
      }
      const person = personOf(page);
      if (person) {
        if (person.country) {
          people.set(person.title, person.country);
          if (!people.has(`~${looseKey(person.title)}`)) people.set(`~${looseKey(person.title)}`, person.country);
        }
        continue;
      }
      const root = rootOf(page.title, byTitle);
      if (!root) { skipped.noInfobox.add(page.title); continue; }
      const reason = Object.keys(skips).find(key => skips[key](root.tournament, root.title));
      if (reason) { skipped[reason].add(root.title); continue; }
      if (!roots.has(root.title)) roots.set(root.title, { root, pages: [] });
      roots.get(root.title).pages.push(page);
    }
    const missing = new Set();
    const tournaments = [];
    // A stage page not exported is worth exporting only if the nearest page above it with an infobox is a counted
    // tournament's: one under an event left out (a qualifier of another tier, a showmatch) would be left out too.
    const counted = sub => roots.has(rootOf(sub, byTitle)?.title);
    for (const { root, pages: own } of roots.values()) {
      own.sort((a, b) => (a.title === root.title ? -1 : b.title === root.title ? 1 : a.title.localeCompare(b.title)));
      for (const page of own) for (const sub of subpagesOf(page)) if (!byTitle.has(sub) && isStagePage(sub) && counted(sub)) missing.add(sub);
      const rosters = own.flatMap(page => rostersOf(page.text, rosterOptions));
      const series = own.flatMap(page => seriesOf(page.text, seriesOptions).map((one, index) => ({ ...one, page: page.title, index })));
      tournaments.push({ title: root.title, ...root.tournament, nations: isNationsEvent(root.title, root.tournament, rosters), rosters, series });
    }
    // Only the stages of a counted tournament are worth exporting, the latest events' first.
    const startOf = new Map([...roots.values()].map(({ root }) => [root.title, root.tournament.start ?? '']));
    const rootOfStage = title => [...roots.keys()].filter(root => title.startsWith(`${root}/`)).sort((a, b) => b.length - a.length)[0];
    const missingStages = [...missing].filter(rootOfStage)
      .sort((a, b) => String(startOf.get(rootOfStage(b))).localeCompare(String(startOf.get(rootOfStage(a)))) || a.localeCompare(b));
    const folded = foldPlayers(tournaments, redirects, nationOfTeamName);
    return {
      tournaments: tournaments.sort((a, b) => String(a.start).localeCompare(String(b.start)) || a.title.localeCompare(b.title)),
      missing: missingStages,
      stageStarts: new Map(missingStages.map(title => [title, startOf.get(rootOfStage(title))])),
      skipped: Object.fromEntries(Object.entries(skipped).map(([key, set]) => [key, [...set].sort()])),
      people,
      folded,
    };
  }

  /** Those who start for a roster: its first `lineup` players who are no substitutes and did play. */
  const startersOf = roster => {
    const playing = roster.players.filter(player => !player.sub && !player.dnp);
    return (playing.length >= lineup ? playing : roster.players.filter(player => !player.dnp)).slice(0, lineup);
  };

  /**
   * Every series the ratings play, in date order (its own date, else its tournament's first day; then the order the pages
   * list them): { date, event, tier, region, international, nations, host, teams: [[player], [player]], names: [team,
   * team], rosters, games, winner, bestOf }. A series whose team has no roster near it, or too few players to field a
   * lineup, is left out (`unplayable`); `aliased` and `borrowed` list the teams found by abbreviation and at another event.
   */
  function seriesInOrder(tournaments) {
    const find = rosterFinder(tournaments, { templateWords });
    const out = [], unplayable = [], borrowed = new Set(), aliased = new Set();
    tournaments.forEach((tournament, at) => {
      for (const series of tournament.series) {
        if (series.walkover || !series.games.length) continue;
        if (series.opponents.some(opponent => opponent.kind !== 'team')) continue;
        const found = series.opponents.map(opponent => find(at, opponent.team));
        if (found.some(entry => !entry || startersOf(entry.roster).length < lineup)) {
          unplayable.push({ event: tournament.title, date: series.date ?? tournament.start, teams: series.opponents.map(opponent => opponent.team) });
          continue;
        }
        found.forEach((entry, side) => {
          const label = `${tournament.title}: ${series.opponents[side].team}`;
          if (entry.borrowed) borrowed.add(label);
          if (entry.alias) aliased.add(`${label} → ${entry.roster.team}`);
        });
        const won = [1, 2].map(side => series.games.filter(game => game.winner === side).length);
        out.push({
          date: series.date ?? tournament.start, event: tournament.title, tier: tournament.tier, region: tournament.region,
          international: tournament.region == null, nations: tournament.nations, page: series.page, index: series.index,
          // A LAN's host nation, for the home crowd's edge (homeEdge).
          host: /^offline$/i.test(tournament.type ?? '') ? nationOfFlag(tournament.country) : null,
          names: series.opponents.map(opponent => opponent.team),
          teams: found.map(entry => startersOf(entry.roster)),
          rosters: found.map(entry => entry.roster),
          // A series names its format rarely: a finished one is best of twice its winner's games less one.
          games: series.games, winner: series.winner, bestOf: series.bestOf ?? 2 * Math.max(...won) - 1,
        });
      }
    });
    out.sort((a, b) => String(a.date).localeCompare(String(b.date)) || a.event.localeCompare(b.event)
      || a.page.localeCompare(b.page) || a.index - b.index);
    return { series: out, unplayable, borrowed: [...borrowed].sort(), aliased: [...aliased].sort() };
  }

  /**
   * Elo over `series` (seriesInOrder's), game by game. `scale`: kScale; `starts`: a region's starting Elo for a newcomer
   * whose first game is in that region's event (`start` elsewhere); `holdout`: the date from which each game's prediction
   * is scored, before it is played (log loss, Brier score, the same for the international events alone, and calibration
   * by tenths of the expected score). Each international game is kept in `international` as the two sides' player keys
   * and the first side's surprise (won − expected), for regionalStarts. `onGame(one, game, expected, sides)` is told of
   * each game before it moves anyone, its sides' players as they stand (each one's `games` those he had played before).
   * → { players: Map(key → player), games, scored, international, lan }
   */
  function runElo(series, { scale = kScale, starts = {}, holdout = null, onGame = null } = {}) {
    const players = new Map();
    const scored = { all: newScore(), international: newScore(), bins: Array.from({ length: 10 }, () => ({ n: 0, expected: 0, won: 0 })) };
    const international = [], lan = [];
    let games = 0;
    const playerOfEntry = (entry, one) => {
      const key = playerKey(entry);
      let player = players.get(key);
      if (!player) {
        player = { key, name: entry.name, elo: starts[one.region] ?? start, games: 0, wins: 0, first: one.date, last: one.date,
          flags: new Map(), regions: new Map(), team: null };
        players.set(key, player);
      }
      return player;
    };
    for (const one of series) {
      const sides = one.teams.map(team => team.map(entry => playerOfEntry(entry, one)));
      // Each player's flag, name and team as this series' rosters file him.
      one.rosters.forEach((roster, side) => {
        for (const entry of roster.players) {
          const player = players.get(playerKey(entry));
          if (player && entry.flag) player.flags.set(entry.flag, (player.flags.get(entry.flag) ?? 0) + 1);
        }
        for (const player of sides[side]) {
          player.name = roster.players.find(entry => playerKey(entry) === player.key)?.name ?? player.name;
          player.team = roster.team;
          player.last = one.date;
          if (one.region) player.regions.set(one.region, (player.regions.get(one.region) ?? 0) + one.games.length);
        }
      });
      const keys = one.international || one.host ? sides.map(side => side.map(player => player.key)) : null;
      for (const game of one.games) {
        const [a, b] = sides.map(side => side.reduce((sum, player) => sum + player.elo, 0) / side.length);
        const e = expected(a - b);
        const won = game.winner === 1 ? 1 : 0;
        if (onGame) onGame(one, game, e, sides);
        if (one.international) international.push({ keys, surprise: won - e });
        if (one.host) lan.push({ keys, host: one.host, surprise: won - e });
        if (holdout && one.date >= holdout) {
          score(scored.all, e, won);
          if (one.international) score(scored.international, e, won);
          const bin = scored.bins[Math.min(9, Math.floor(e * 10))];
          bin.n++; bin.expected += e; bin.won += won;
        }
        sides.forEach((side, s) => {
          const delta = s === 0 ? won - e : e - won;
          for (const player of side) {
            player.elo += kFactor(player.games, scale) * delta;
            player.games++;
            if ((s === 0) === (won === 1)) player.wins++;
          }
        });
        games++;
      }
    }
    return { players, games, scored, international, lan };
  }

  /**
   * The home crowd's edge at a LAN, from runElo's `lan` games: each game where exactly one side is of the host nation (most
   * of its players, `nationOf` a player's key's), that side's surprise (won − expected); their mean, in Elo points on the
   * slope at an even game (1600 / ln 10 a unit), with its standard error. → { games, surprise, elo, se } (null with no such game).
   */
  function homeEdge(lan, nationOf) {
    const nationOfSide = side => {
      const counts = new Map();
      for (const key of side) {
        const nation = nationOf(key);
        if (nation) counts.set(nation, (counts.get(nation) ?? 0) + 1);
      }
      return [...counts.entries()].find(([, n]) => n >= majority)?.[0] ?? null;
    };
    const surprises = [];
    for (const { keys, host, surprise } of lan) {
      const [a, b] = keys.map(nationOfSide);
      if ((a === host) === (b === host)) continue;
      surprises.push(a === host ? surprise : -surprise);
    }
    if (!surprises.length) return null;
    const mean = surprises.reduce((sum, x) => sum + x, 0) / surprises.length;
    const sd = Math.sqrt(surprises.reduce((sum, x) => sum + (x - mean) ** 2, 0) / Math.max(1, surprises.length - 1));
    const toElo = 1600 / Math.LN10;
    return { games: surprises.length, surprise: Math.round(mean * 10000) / 10000, elo: Math.round(mean * toElo * 10) / 10,
      se: Math.round(sd / Math.sqrt(surprises.length) * toElo * 10) / 10 };
  }

  /**
   * Each region's starting Elo, solved so that its teams win as often at the international events as Elo expects: run
   * the Elo, move each region's start by its sides' mean surprise there (won − expected, on Elo's slope at an even game:
   * 1600 / ln 10 points a unit; a side counts for the region most of its players call home), and again, `passes` times.
   * Without it a newcomer is rated as an average player wherever he starts, and the regions meet too rarely for Elo alone
   * to bring a whole region's players to its level.
   */
  function regionalStarts(series, { scale = kScale, passes = 8, damping = 0.6, least = 10 } = {}) {
    const starts = {};
    for (let pass = 0; pass < passes; pass++) {
      const { players, international } = runElo(series, { scale, starts });
      const surprise = new Map();
      for (const { keys, surprise: first } of international) {
        keys.forEach((side, s) => {
          const homes = side.map(key => homeOf(players.get(key))).filter(Boolean);
          const counts = new Map();
          for (const home of homes) counts.set(home, (counts.get(home) ?? 0) + 1);
          const home = [...counts.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))[0]?.[0];
          if (!home) return;
          const row = surprise.get(home) ?? { n: 0, sum: 0 };
          row.n++;
          row.sum += s === 0 ? first : -first;
          surprise.set(home, row);
        });
      }
      for (const [region, { n, sum }] of surprise) {
        if (n >= least) starts[region] = (starts[region] ?? start) + damping * (sum / n) * 1600 / Math.LN10;
      }
    }
    return Object.fromEntries(Object.entries(starts).sort().map(([region, elo]) => [region, Math.round(elo)]));
  }

  /**
   * The rated players of a run, strongest first: those with `minGames` behind them whose last game is within
   * `activeDays` of the export's last day (`asOf`). Each as the snapshot keeps it: his flag from his cards or his page
   * (`people`), his nation from his national team or his flag (`national`).
   */
  function ratedPlayers(players, asOf, people = new Map(), national = new Map()) {
    return [...players.values()]
      .filter(player => player.games >= minGames && daysBetween(player.last, asOf) <= activeDays)
      .map(player => ({ key: player.key, name: player.name, flag: flagOf(player, people), nation: nationOfPlayer(player, people, national),
        side: national.get(player.key)?.team ?? null, elo: Math.round(player.elo * 10) / 10, games: player.games, wins: player.wins,
        last: player.last, team: player.team, region: homeOf(player) }))
      .sort((a, b) => b.elo - a.elo || a.name.localeCompare(b.name));
  }

  /**
   * The players rated at the end of an earlier season (`asOf`, its last day): the Elo of the games up to that day, rated as
   * ratedPlayers rates them then, each with the flag, nation and national team the whole record gives him (`whole`, the run
   * of every game's players): a player's country is his, whichever year it is.
   */
  function playersAsOf(series, asOf, { starts = {}, people = new Map(), national = new Map(), whole }) {
    const { players } = runElo(series.filter(one => one.date <= asOf), { starts });
    return ratedPlayers(players, asOf, people, national).map(player => {
      const all = whole.get(player.key);
      return { ...player, flag: flagOf(all, people), nation: nationOfPlayer(all, people, national) };
    });
  }

  /** A snapshot row as a player of the game: its rating and nation, and the source a squad keeps. */
  function playerOf([key, name, flag, nation, side, elo, games, wins, last, team, region], snapshotDate, eloRank) {
    return { key, name, flag, nation, side, elo, games, wins, last, team, region, rating: gameRating(elo),
      source: { id: `lp:${key}`, source: sourceId, edition, snapshotDate, rawRating: elo, rawScale: 'Elo', eloRank,
        games, lastPlayed: last, ...(team ? { team } : {}), ...(side ? { nationalTeam: side } : {}),
        url: `${wiki}${encodeURI(key.replace(/ /g, '_'))}` } };
  }

  /** A squad player as the game's files hold it: `[name, position, rating, source]`. */
  const tupleOf = player => [player.name, position, player.rating, player.source];

  /**
   * The nations that field a team, strongest first: each `{ id, name, str, squad, players }`, `squad` its `teamSize` best
   * by Elo (distinctNames), `players` how many it has in all, `str` its `lineup` best players' mean rating (the lineup the
   * game fields).
   */
  function nationsOf(players, sport = null) {
    const pools = new Map();
    for (const player of players) {
      if (player.nation == null) continue;
      if (!pools.has(player.nation)) pools.set(player.nation, []);
      pools.get(player.nation).push(player);
    }
    return [...pools.entries()].filter(([, pool]) => pool.length >= minPlayers).map(([id, pool]) => {
      const squad = distinctNames(pool.slice().sort(byElo).slice(0, teamSize));
      const str = Math.round(squad.slice(0, lineup).reduce((sum, player) => sum + player.rating, 0) / lineup * 10) / 10;
      return { id, name: nationIdentity(id, sport).name, str, squad, players: pool.length };
    }).sort((a, b) => b.str - a.str || a.name.localeCompare(b.name));
  }

  /**
   * Rated players who play for nobody, by reason: no nation from a national team, a card or a page (`noFlag`: no country's
   * flag at all; `offMap`: a country the map does not draw), or a nation of fewer than `minPlayers`.
   */
  function leftOut(players) {
    const noFlag = players.filter(player => player.nation == null && (!player.flag || isRegionFlag(player.flag)));
    const offMap = players.filter(player => player.nation == null && player.flag && !isRegionFlag(player.flag));
    const counts = new Map();
    for (const player of players) if (player.nation != null) counts.set(player.nation, (counts.get(player.nation) || 0) + 1);
    const short = players.filter(player => player.nation != null && counts.get(player.nation) < minPlayers);
    return { noFlag, offMap, short };
  }

  return { gameRating, kFactor, readTournaments, startersOf, seriesInOrder, runElo, homeEdge, regionalStarts, ratedPlayers,
    playersAsOf, playerOf, tupleOf, nationsOf, leftOut };
}
