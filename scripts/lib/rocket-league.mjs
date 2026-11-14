// Rocket League's ratings from Liquipedia's results (npm run sync:rocket-league) and its national teams (npm run
// build-rocket-league). No I/O: scripts/sync-rocket-league.mjs reads the export, scripts/build-rocket-league.mjs the
// snapshot this computes.
//
// Every rating is an Elo, built game by game from every 3v3 series the export holds, in date order: a team plays at
// the mean of its three players' Elo, the winner of each game takes K × (1 − E) from the loser (E, Elo's expected
// score for the gap), and each player moves by his team's amount. A player's K shrinks with the games he has played
// (`kFactor`), so a newcomer finds his level quickly and a veteran's rating holds. Nothing is estimated: a player is
// rated only from the games Liquipedia records him in, and only a player who has played lately (ACTIVE_DAYS) plays.
//
// On the game's scale a rating is Elo / 25 − 2, so a rating point is 25 Elo points, as in tennis, and the match model
// plays Elo's own odds for each game (src/sports/rocketLeague.js); the offset puts the best player of the exports of
// 2026-11-14 (dralii, 2,470) at 97 and a newcomer at 1,500 at 58. A nation names its best players by Elo (TEAM_SIZE); it
// needs three for a team, so a nation with fewer fields none and its land stays neutral.
import { FLAG_CODES } from '../../src/data/flags.js';
import { HOME_NATIONS, NATIONS, nationIdentity } from '../../src/data/teams.js';
import { isStagePage, normalTitle, personOf, plainText, rootOf, rostersOf, seriesOf, subpagesOf, teamKeys, tournamentOf }
  from './liquipedia.mjs';

export const SPORT = 'rocket-league';
export const TEAM_SIZE = 5;
export const MIN_PLAYERS = 3;
export const LINEUP = 3;
export const ELO_PER_POINT = 25;
const ELO_OFFSET = -50;
export const START = 1500;
export const SOURCE_ID = 'liquipedia';
export const EDITION = 'Liquipedia Elo';
export const WIKI = 'https://liquipedia.net/rocketleague/';
/** How long since his last game a player still plays for his nation: a year. */
export const ACTIVE_DAYS = 365;
/** The fewest games a player needs behind him to be rated at all. */
export const MIN_GAMES = 20;
/** The tiers that count: S-Tier (1), A-Tier (2) and B-Tier (3) 3v3 events. */
export const TIERS = Object.freeze([1, 2, 3]);

/** A player's Elo on the game's scale: Elo / 25 − 2, rounded. */
export const gameRating = elo => Math.round((elo + ELO_OFFSET) / ELO_PER_POINT);

/** Elo's expected score for a side `gap` points ahead. */
export const expected = gap => 1 / (1 + 10 ** (-gap / 400));

// K per game: K_SCALE / (games + 5) ^ 0.4, FiveThirtyEight's shape, never below K_FLOOR. A newcomer's first game moves
// him about 5.2 times a 300-game veteran's. K_SCALE is the one that best foresaw the last 180 days of the exports of
// 2026-11-14 (2,462 games, each scored before it was played; regional starts on): log loss 0.5829 at 320, 0.6021 at
// 110, 0.5853 at 240, 0.5835 at 400, 0.5868 at 500; at 320 the games it gave 75% went 78%, those at 94.5% went 92.5%.
// Rocket League's form moves fast: rosters change and a team's level with them.
export const K_SCALE = 320;
export const K_FLOOR = 8;
/** A player's K after `games` games. */
export const kFactor = (games, scale = K_SCALE) => Math.max(K_FLOOR, scale / (games + 5) ** 0.4);

// ---------- nations ----------

// Liquipedia's flags are ISO 3166 alpha-2 codes for the most part ("fr", "us"), with its own codes for the United
// Kingdom's home nations ("uken", "uksc", "ukwa", "ukni"), now and then a country's name, abbreviation or misspelling, and
// territories whose players play for their state: Réunion, Guadeloupe and New Caledonia for France, Curaçao and Aruba for
// the Kingdom of the Netherlands (as baseball's World Baseball Classic counts them), Jersey for Great Britain. Counted
// over the export of 2026-11-14.
const FLAG_ALIASES = {
  uk: '826', gb: '826', en: '826', eng: '826', england: '826', 'gb-eng': '826', uken: '826', 'united kingdom': '826',
  'great britain': '826', je: '826', jersey: '826',
  sco: 'SCO', sct: 'SCO', scotland: 'SCO', 'gb-sct': 'SCO', uksc: 'SCO', wal: 'WAL', wls: 'WAL', wales: 'WAL', 'gb-wls': 'WAL',
  ukwa: 'WAL', wa: 'WAL', nir: 'NIR', 'northern ireland': 'NIR', 'gb-nir': 'NIR', ukni: 'NIR',
  usa: '840', 'united states of america': '840', ksa: '682', uae: '784', kosovo: 'KOS', xk: 'KOS', korea: '410',
  'south korea': '410', 'republic of korea': '410', czechia: '203', 'czech republic': '203', czech: '203', turkiye: '792',
  holland: '528', 'bosnia and herzegovina': '070', 'ivory coast': '384', 'cote d ivoire': '384', 'dr congo': '180',
  'democratic republic of the congo': '180', 'north macedonia': '807', macedonia: '807', taiwan: '158', 'chinese taipei': '158',
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
 * does not draw (Hong Kong, Singapore, Malta). Rocket League plays Great Britain as one, as tennis does: the home nations
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

// ---------- the export, read ----------

/** A player's key: the page he links to, else his name, as MediaWiki compares titles. */
export const playerKey = player => normalTitle(player.link || player.name);

/** Whether an event is a school's (Collegiate Rocket League): its players a pool of their own, outside the RLCS's regions. */
const isSchool = (title, tournament) => /^school$/i.test(tournament.tierType ?? '') || /^Collegiate Rocket League\//.test(title);

/**
 * Whether an event is played by national teams: the FIFAe World Cup and its regionals, the Esports Nations Cup and its
 * regionals (Rocket League's, on this wiki), whose rosters say whom each player plays for.
 */
const isNationsEvent = (title, tournament) => /FIFAe|Nations Cup/i.test(`${title} ${tournament.series ?? ''}`);

/**
 * Liquipedia's pages (readExport, every file's) → what the ratings play: the 3v3 tournaments of the counted tiers but no
 * school's, each with its teams and series, and what was left out and why.
 * → { tournaments: [{ title, ...tournamentOf, nations, rosters, series }], missing: [stage pages linked but not exported],
 *     skipped: { mode, tier, school, noInfobox }, people: Map(player page title, and '~' + its loose spelling → the country
 *     his page files him under), folded: Map(a player's other spelling → the key he plays under, foldPlayers) }
 */
export function readTournaments(pages, { tiers = TIERS } = {}) {
  const byTitle = new Map();
  for (const page of pages) {
    if (page.ns !== 0) continue;
    const title = normalTitle(page.title);
    // A title exported twice (two files): the later revision stands.
    const previous = byTitle.get(title);
    if (previous && String(previous.timestamp) > String(page.timestamp)) continue;
    byTitle.set(title, { ...page, title, tournament: tournamentOf(page) });
  }
  const roots = new Map();
  const skipped = { mode: new Set(), tier: new Set(), school: new Set(), noInfobox: new Set() };
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
    if (root.tournament.mode !== '3v3') { skipped.mode.add(root.title); continue; }
    if (!tiers.includes(root.tournament.tier)) { skipped.tier.add(root.title); continue; }
    if (isSchool(root.title, root.tournament)) { skipped.school.add(root.title); continue; }
    if (!roots.has(root.title)) roots.set(root.title, { root, pages: [] });
    roots.get(root.title).pages.push(page);
  }
  const missing = new Set();
  const tournaments = [];
  for (const { root, pages: own } of roots.values()) {
    own.sort((a, b) => (a.title === root.title ? -1 : b.title === root.title ? 1 : a.title.localeCompare(b.title)));
    for (const page of own) for (const sub of subpagesOf(page)) if (!byTitle.has(sub) && isStagePage(sub)) missing.add(sub);
    const rosters = own.flatMap(page => rostersOf(page.text));
    const series = own.flatMap(page => seriesOf(page.text).map((one, index) => ({ ...one, page: page.title, index })));
    tournaments.push({ title: root.title, ...root.tournament, nations: isNationsEvent(root.title, root.tournament), rosters, series });
  }
  // Only the stages of a counted tournament are worth exporting, the latest events' first.
  const startOf = new Map([...roots.values()].map(({ root }) => [root.title, root.tournament.start ?? '']));
  const rootOfStage = title => [...roots.keys()].filter(root => title.startsWith(`${root}/`)).sort((a, b) => b.length - a.length)[0];
  const missingStages = [...missing].filter(rootOfStage)
    .sort((a, b) => String(startOf.get(rootOfStage(b))).localeCompare(String(startOf.get(rootOfStage(a)))) || a.localeCompare(b));
  const folded = foldPlayers(tournaments, redirects);
  return {
    tournaments: tournaments.sort((a, b) => String(a.start).localeCompare(String(b.start)) || a.title.localeCompare(b.title)),
    missing: missingStages,
    stageStarts: new Map(missingStages.map(title => [title, startOf.get(rootOfStage(title))])),
    skipped: Object.fromEntries(Object.entries(skipped).map(([key, set]) => [key, [...set].sort()])),
    people,
    folded,
  };
}

/** A player key's loose spelling: lower case, letters and digits only ("Atow." and "atow" → "atow"). */
export const looseKey = key => String(key ?? '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '');

/**
 * One key a player, whatever a roster calls him: a page that redirects is its target's, and the spellings of one name that
 * differ only in case and punctuation ("Atow" on Belgium's national roster, "Atow." on his clubs'; "AcroniK", "AcroniK.")
 * are the spelling the rosters use most, unless their nations clash (each spelling's flags and national teams). A page
 * the wiki disambiguates ("Dead (Israeli Player)") is spelt apart, so it never meets a namesake. Each roster player whose
 * key folds gets the kept key as his `link`, so every game of his counts for one rating.
 * → Map(folded key → kept key)
 */
export function foldPlayers(tournaments, redirects = new Map()) {
  const follow = key => {
    let at = key;
    for (let hop = 0; hop < 5 && redirects.has(at); hop++) at = redirects.get(at);
    return at;
  };
  const uses = new Map();
  for (const tournament of tournaments) {
    const national = tournament.nations;
    for (const roster of tournament.rosters) {
      const side = national ? nationOfFlag(baseTeamName(roster.team)) : null;
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

// A series names its teams by the wiki's team templates ("nip", "kc", "flcn", "Genesis (South American Team)"), its event's
// rosters by their names ("Ninjas in Pyjamas", "Karmine Corp", "Team Falcons", "Genesis"): the templates themselves are not
// in the export, so a template is matched to a roster of the same event by its name without a disambiguation or region
// tag, else as an abbreviation.
const DISAMBIGUATION = /\s*\([^)]*\)\s*/g;
const REGION_TAG = /\s+(?:eu|euw|na|sam|br|oce|au|nz|ksa|mena|me|apac|ssa|za|us|uk|fr)$/i;
/** A team's name without its disambiguation or region tag: "Genesis (South American Team)" and "genesis sam" → "genesis". */
export const baseTeamName = name => plainText(name).replace(DISAMBIGUATION, ' ').replace(REGION_TAG, '').trim();
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

/** How near in days a tournament's roster may be borrowed for a team its own lists under no name the series uses. */
export const BORROW_DAYS = 120;

/**
 * The roster a series' team played with: its own tournament's (by name, by name without its tag, else as the unique best
 * abbreviation), else the same team's at the nearest tournament within BORROW_DAYS.
 */
function rosterFinder(tournaments) {
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
    const scored = tournaments[tournamentAt].rosters.map(roster => ({ roster, score: abbreviationScore(short, roster.team) }))
      .filter(entry => entry.score > 0).sort((a, b) => b.score - a.score);
    if (scored.length && (scored.length === 1 || scored[0].score > scored[1].score)) return { roster: scored[0].roster, borrowed: false, alias: true };
    const near = candidates.filter(candidate => days(candidate.at, tournamentAt) <= BORROW_DAYS)
      .sort((a, b) => days(a.at, tournamentAt) - days(b.at, tournamentAt))[0];
    return near ? { roster: near.roster, borrowed: true } : null;
  };
}

/** The three who start for a roster: its first three players who are no substitutes and did play. */
export const startersOf = roster => {
  const starters = roster.players.filter(player => !player.sub && !player.dnp);
  return (starters.length >= LINEUP ? starters : roster.players.filter(player => !player.dnp)).slice(0, LINEUP);
};

/**
 * Every series the ratings play, in date order (its own date, else its tournament's first day; then the order the pages
 * list them): { date, event, tier, region, international, nations, host, teams: [[player], [player]], names: [team, team],
 * rosters, games, winner, bestOf }. A series whose team has no roster near it, or fewer than three players, is left out
 * (`unplayable`); `aliased` and `borrowed` list the teams found by abbreviation and at another event.
 */
export function seriesInOrder(tournaments) {
  const find = rosterFinder(tournaments);
  const out = [], unplayable = [], borrowed = new Set(), aliased = new Set();
  tournaments.forEach((tournament, at) => {
    for (const series of tournament.series) {
      if (series.walkover || !series.games.length) continue;
      if (series.opponents.some(opponent => opponent.kind !== 'team')) continue;
      const found = series.opponents.map(opponent => find(at, opponent.team));
      if (found.some(entry => !entry || startersOf(entry.roster).length < LINEUP)) {
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
 * The nation each player last played for in a national-team event (isNationsEvent: the FIFAe World Cup, the Esports
 * Nations Cup and their regionals) → Map(player key → { nation, team, date }): his team there is his country's. The ratings
 * take it before any flag, as rugby league takes a player's Test side before his birthplace.
 */
export function nationalTeams(tournaments) {
  const out = new Map();
  for (const tournament of tournaments) {
    if (!tournament.nations) continue;
    for (const roster of tournament.rosters) {
      const nation = nationOfFlag(baseTeamName(roster.team));
      if (!nation) continue;
      for (const player of roster.players) {
        const key = playerKey(player), date = tournament.start ?? '';
        if (!out.has(key) || String(out.get(key).date) <= date) out.set(key, { nation, team: roster.team, date });
      }
    }
  }
  return out;
}

// ---------- the Elo ----------

const DAY = 86400000;
const daysBetween = (from, to) => Math.round((Date.parse(to) - Date.parse(from)) / DAY);

/**
 * Elo over `series` (seriesInOrder's), game by game. `scale`: K_SCALE; `starts`: a region's starting Elo for a newcomer
 * whose first game is in that region's event (START elsewhere); `holdout`: the date from which each game's prediction
 * is scored, before it is played (log loss, Brier score, the same for the international events alone, and calibration
 * by tenths of the expected score). Each international game is kept in `international` as the two sides' player keys
 * and the first side's surprise (won − expected), for regionalStarts.
 * → { players: Map(key → player), games, scored, international }
 */
export function runElo(series, { scale = K_SCALE, starts = {}, holdout = null } = {}) {
  const players = new Map();
  const scored = { all: newScore(), international: newScore(), bins: Array.from({ length: 10 }, () => ({ n: 0, expected: 0, won: 0 })) };
  const international = [], lan = [];
  let games = 0;
  const playerOf = (entry, one) => {
    const key = playerKey(entry);
    let player = players.get(key);
    if (!player) {
      player = { key, name: entry.name, elo: starts[one.region] ?? START, games: 0, wins: 0, first: one.date, last: one.date,
        flags: new Map(), regions: new Map(), team: null };
      players.set(key, player);
    }
    return player;
  };
  for (const one of series) {
    const sides = one.teams.map(team => team.map(entry => playerOf(entry, one)));
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
 * The home crowd's edge at a LAN, from runElo's `lan` games: each game where exactly one side is of the host nation (two
 * of its three players', `nationOf` a player's key's), that side's surprise (won − expected); their mean, in Elo points on the slope at an even
 * game (1600 / ln 10 a unit), with its standard error. → { games, surprise, elo, se } (null with no such game).
 */
export function homeEdge(lan, nationOf) {
  const nationOfSide = side => {
    const counts = new Map();
    for (const key of side) {
      const nation = nationOf(key);
      if (nation) counts.set(nation, (counts.get(nation) ?? 0) + 1);
    }
    return [...counts.entries()].find(([, n]) => n >= 2)?.[0] ?? null;
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
 * Each region's starting Elo, solved so that its teams win as often at the international events as Elo expects: run
 * the Elo, move each region's start by its sides' mean surprise there (won − expected, on Elo's slope at an even game:
 * 1600 / ln 10 points a unit; a side counts for the region most of its players call home), and again, `passes` times.
 * Without it a newcomer is rated as an average player wherever he starts, and the regions meet too rarely (a few teams
 * each at a major) for Elo alone to bring a whole region's players to its level.
 */
export function regionalStarts(series, { scale = K_SCALE, passes = 8, damping = 0.6, least = 10 } = {}) {
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
      if (n >= least) starts[region] = (starts[region] ?? START) + damping * (sum / n) * 1600 / Math.LN10;
    }
  }
  return Object.fromEntries(Object.entries(starts).sort().map(([region, elo]) => [region, Math.round(elo)]));
}

// ---------- the snapshot's players, and the nations ----------

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
 * The rated players of a run, strongest first: those with MIN_GAMES behind them whose last game is within ACTIVE_DAYS
 * of the export's last day (`asOf`). Each as the snapshot keeps it: his flag from his cards or his page (`people`), his
 * nation from his national team or his flag (`national`).
 */
export function ratedPlayers(players, asOf, people = new Map(), national = new Map()) {
  return [...players.values()]
    .filter(player => player.games >= MIN_GAMES && daysBetween(player.last, asOf) <= ACTIVE_DAYS)
    .map(player => ({ key: player.key, name: player.name, flag: flagOf(player, people), nation: nationOfPlayer(player, people, national),
      side: national.get(player.key)?.team ?? null, elo: Math.round(player.elo * 10) / 10, games: player.games, wins: player.wins,
      last: player.last, team: player.team, region: homeOf(player) }))
    .sort((a, b) => b.elo - a.elo || a.name.localeCompare(b.name));
}

/** The snapshot's row: `[key, name, flag, nation, national team, elo, games, wins, last, team, region]`. */
export const rowOf = p => [p.key, p.name, p.flag, p.nation, p.side, p.elo, p.games, p.wins, p.last, p.team, p.region];

/** A snapshot row as a player of the game: its rating and nation, and the source a squad keeps. */
export function playerOf([key, name, flag, nation, side, elo, games, wins, last, team, region], snapshotDate, eloRank) {
  return { key, name, flag, nation, side, elo, games, wins, last, team, region, rating: gameRating(elo),
    source: { id: `lp:${key}`, source: SOURCE_ID, edition: EDITION, snapshotDate, rawRating: elo, rawScale: 'Elo', eloRank,
      games, lastPlayed: last, ...(team ? { team } : {}), ...(side ? { nationalTeam: side } : {}),
      url: `${WIKI}${encodeURI(key.replace(/ /g, '_'))}` } };
}

const byElo = (a, b) => b.elo - a.elo || a.name.localeCompare(b.name);

/** A squad player as the game's files hold it: `[name, 'PLR', rating, source]`. */
export const tupleOf = player => [player.name, 'PLR', player.rating, player.source];

/**
 * The nations that field a team, strongest first: each `{ id, name, str, squad, players }`, `squad` its TEAM_SIZE best
 * by Elo, `players` how many it has in all, `str` its three best players' mean rating (the lineup the game fields).
 */
export function nationsOf(players, sport = null) {
  const pools = new Map();
  for (const player of players) {
    if (player.nation == null) continue;
    if (!pools.has(player.nation)) pools.set(player.nation, []);
    pools.get(player.nation).push(player);
  }
  return [...pools.entries()].filter(([, pool]) => pool.length >= MIN_PLAYERS).map(([id, pool]) => {
    const squad = pool.slice().sort(byElo).slice(0, TEAM_SIZE);
    const str = Math.round(squad.slice(0, LINEUP).reduce((sum, player) => sum + player.rating, 0) / LINEUP * 10) / 10;
    return { id, name: nationIdentity(id, sport).name, str, squad, players: pool.length };
  }).sort((a, b) => b.str - a.str || a.name.localeCompare(b.name));
}

/**
 * Rated players who play for nobody, by reason: no nation from a national team, a card or a page (`noFlag`: no country's
 * flag at all; `offMap`: a country the map does not draw), or a nation of fewer than three.
 */
export function leftOut(players) {
  const noFlag = players.filter(player => player.nation == null && (!player.flag || isRegionFlag(player.flag)));
  const offMap = players.filter(player => player.nation == null && player.flag && !isRegionFlag(player.flag));
  const counts = new Map();
  for (const player of players) if (player.nation != null) counts.set(player.nation, (counts.get(player.nation) || 0) + 1);
  const short = players.filter(player => player.nation != null && counts.get(player.nation) < MIN_PLAYERS);
  return { noFlag, offMap, short };
}
