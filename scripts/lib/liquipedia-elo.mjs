// A team esport's player Elo from a Liquipedia export, and the national teams it fields: the rules Rocket League's
// ratings were built with (scripts/lib/rocket-league.mjs, docs/design/rocket-league.md), shared with Counter-Strike's
// (scripts/lib/counter-strike.mjs, docs/design/counter-strike.md). Each sport passes its own numbers (how many play, how
// many a nation names, its K, its scale) and its own reading of the wiki (which events count, how a game reads); the
// rules themselves are one. No I/O.
//
// Every rating is an Elo, built game by game from every series the export holds, in date order: a team plays at the
// mean of its players' Elo, the winner of each game takes K × (1 − E) from the loser (E, Elo's expected score for the
// gap), and each player moves by his team's amount. A player's K shrinks with the games he has played (`kFactor`), so a
// newcomer finds his level quickly and a veteran's rating holds. A newcomer starts at his region's level (`regionLevels`),
// so a region whose teams mostly play each other is not rated as if it were the world's equal. Nothing is estimated: a
// player is rated only from the games Liquipedia records him in, and only a player who has played lately (`activeDays`)
// plays.
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

// ---------- renamed players ----------

// A player whose page the wiki renamed ("Magiskb0Y" to "Magisk"), or whom rosters link under two titles ("Dev1ce" and
// "Device", "JT (South African player)" and "JT"), is two players to an export without the old title's redirect. Two keys
// are one player by what the rosters show of them (renameOf): alike names, one nation, the same team-mates about the same
// time, and nothing that puts him in two teams at once.
const DISAMBIGUATED = / \(([^)]*)\)$/;
const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', 9: 'g', $: 's', '@': 'a', '!': 'i', l: 'i' };
const bareName = key => String(key).replace(DISAMBIGUATED, '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ø/g, 'o');
const looseName = key => bareName(key).replace(/[^a-z0-9]+/g, '');
/** A name as its letters, the digits players write for them turned back: "Dev1ce" → "device", "P4TriCK" → "patrick". */
const leetName = key => bareName(key).replace(/[01345789$@!l]/g, c => LEET[c]).replace(/[^a-z]+/g, '');
/** Whether two names are one typing slip apart: a letter added, dropped, changed or swapped with its neighbour. */
function oneSlip(a, b) {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const restA = a.slice(i), restB = b.slice(i);
  return restA.slice(1) === restB || restA === restB.slice(1) || restA.slice(1) === restB.slice(1)
    || (restA.length > 1 && restA[0] === restB[1] && restA[1] === restB[0] && restA.slice(2) === restB.slice(2));
}

/**
 * How alike two players' keys are: 'same' (but for a disambiguation, case and punctuation), 'leet' (the digits written
 * for letters), 'part' (one begins or ends the other: "Magisk", "Magiskb0Y"), 'slip' (a typing slip apart), or null.
 */
export function alikeNames(a, b) {
  const la = looseName(a), lb = looseName(b), short = Math.min(la.length, lb.length);
  if (short < 2) return null;
  if (la === lb) return 'same';
  if (leetName(a).length >= 3 && leetName(a) === leetName(b)) return 'leet';
  if (short >= 3 && (la.startsWith(lb) || lb.startsWith(la))) return 'part';
  if (short >= 4 && (la.endsWith(lb) || lb.endsWith(la))) return 'part';
  return short >= 5 && oneSlip(la, lb) ? 'slip' : null;
}

/** A line-up two rosters share: three team-mates or more, the rosters within 200 days of each other. */
export const RENAME_MATES = 3;
export const RENAME_DAYS = 200;
// Two teams at once: rosters of two teams, a team-mate at most between them, within a month.
const CLASH_DAYS = 30;
// A page that moved without a shared line-up: the new title's first roster within a year of the old one's last.
const HANDOVER_DAYS = 365;
// A name the wiki tells apart by a person's name ("Seb (Sebastian Dietrich)"), not by his country ("(Polish player)").
const isPersonal = key => { const tag = DISAMBIGUATED.exec(key)?.[1] ?? ''; return /^\S+ \S+/.test(tag) && !/player/i.test(tag); };
const oneTeam = (x, y) => x.keys.some(key => y.keys.includes(key));
function sharedMates(x, y) {
  let n = 0;
  for (const mate of x.mates) if (y.mates.has(mate)) n++;
  return n;
}
/**
 * What every roster that lists two keys says of them → { links: the line-ups they share (RENAME_MATES team-mates within
 * RENAME_DAYS), eachFirst: whether each comes first in some, clashes: how often they stand in two teams within a month,
 * apart: whether a roster lists both, or one event lists them in two teams (but for an all-star match among a hundred
 * shared line-ups) }.
 */
function together(a, b) {
  let links = 0, clashes = 0, twoTeams = 0, before = false, after = false;
  for (const x of a.rosters) {
    for (const y of b.rosters) {
      const gap = Math.abs(x.day - y.day), oneEvent = x.event === y.event;
      if (gap > RENAME_DAYS && !oneEvent) continue;
      const mates = sharedMates(x, y);
      if (mates >= RENAME_MATES) {
        links++;
        if (x.day < y.day) before = true;
        if (x.day > y.day) after = true;
      } else if (!oneTeam(x, y)) {
        if (oneEvent) twoTeams++;
        if (gap <= CLASH_DAYS && mates <= 1) clashes++;
      }
    }
  }
  return { links, clashes, eachFirst: before && after, apart: a.rosters.some(one => one.mates.has(b.key)) || twoTeams > 0.01 * links };
}

/**
 * Whether two keys are one player, by every roster that lists them (`a`, `b`: { key, nation, about, rosters: [{ day, event,
 * keys, mates: Set }], in date order }; `about` his nation, else half his team-mates'): alike names, no clash of
 * nations, nothing that tells them apart (together), and
 *   - the same name, or the same in leet: a shared line-up, and at most one clash to twenty of them; or, with no line-up,
 *     one title's first roster within a year after the other's last, about one nation (five letters or more, in leet). A name
 *     the wiki tells apart by a person's name has namesakes: ten shared line-ups, each title first in some of them;
 *   - one name part of the other: two shared line-ups, and at most one clash to fifty;
 *   - a typing slip apart: three, no clash, and either one spelling in two rosters at most or each first in some.
 */
export function renameOf(a, b) {
  const alike = alikeNames(a.key, b.key);
  if (!alike || (a.nation && b.nation && a.nation !== b.nation)) return false;
  const { links, clashes, eachFirst, apart } = together(a, b);
  if (apart) return false;
  if (alike === 'same' || alike === 'leet') {
    if (isPersonal(a.key) || isPersonal(b.key)) return links >= 10 && eachFirst && clashes <= 0.05 * links;
    if (links) return clashes <= 0.05 * links;
    const [first, second] = a.rosters[0].day <= b.rosters[0].day ? [a, b] : [b, a];
    const gap = second.rosters[0].day - first.rosters.at(-1).day;
    return gap > 0 && gap <= HANDOVER_DAYS && !!a.about && a.about === b.about
      && (alike === 'same' || Math.min(looseName(a.key).length, looseName(b.key).length) >= 5);
  }
  if (alike === 'part') return links >= 2 && clashes <= 0.02 * links;
  return links >= 3 && !clashes && (eachFirst || Math.min(a.rosters.length, b.rosters.length) <= 2);
}

/**
 * Renamed players folded into one key each (renameOf), the title his latest roster uses: every roster player under an older
 * title gets the kept one as his `link`, in all of `tournaments` (readTournaments', of one record or several). `people`: the countries of the players' pages, a kept key without one taking its
 * older title's. A player's nation is his national team's, else his cards' flags' or his page's; `about`, for one without,
 * that of half his team-mates or more.
 * → Map(folded key → kept key)
 */
export function foldRenames(tournaments, people = new Map(), nationOfName = nationOfTeam) {
  const national = nationalTeams(tournaments, nationOfName);
  const players = new Map();
  for (const tournament of tournaments) {
    if (!tournament.start) continue;
    const day = Date.parse(tournament.start) / DAY;
    for (const roster of tournament.rosters) {
      const keys = roster.players.map(playerKey);
      roster.players.forEach((player, i) => {
        const key = keys[i];
        if (!players.has(key)) players.set(key, { key, flags: new Map(), rosters: [] });
        const row = players.get(key);
        if (player.flag) row.flags.set(player.flag, (row.flags.get(player.flag) ?? 0) + 1);
        row.rosters.push({ day, event: tournament.title, keys: roster.keys, mates: new Set(keys.filter(mate => mate !== key)) });
      });
    }
  }
  const byMate = new Map(), bySpelling = new Map();
  const listed = (map, at, row) => { if (!map.has(at)) map.set(at, []); map.get(at).push(row); };
  for (const row of players.values()) row.nation = nationOfPlayer(row, people, national);
  const known = new Map([...players.values()].map(row => [row.key, row.nation]));
  for (const row of players.values()) {
    row.rosters.sort((x, y) => x.day - y.day);
    const mates = row.rosters.flatMap(one => [...one.mates]);
    const theirs = new Map();
    for (const mate of mates) if (known.get(mate)) theirs.set(known.get(mate), (theirs.get(known.get(mate)) ?? 0) + 1);
    const told = [...theirs.values()].reduce((sum, n) => sum + n, 0);
    row.about = row.nation ?? [...theirs].find(([, n]) => n >= 0.5 * told)?.[0] ?? null;
    for (const mate of new Set(mates)) listed(byMate, mate, row);
    for (const name of new Set([`=${looseName(row.key)}`, `~${leetName(row.key)}`])) if (name.length > 2) listed(bySpelling, name, row);
  }
  // Two keys worth a look: alike names that have shared a team-mate, or that spell one name.
  const pairs = new Map();
  for (const list of [...byMate.values(), ...bySpelling.values()]) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const [a, b] = list[i].key < list[j].key ? [list[i], list[j]] : [list[j], list[i]];
        const id = `${a.key}\n${b.key}`;
        if (!pairs.has(id)) pairs.set(id, alikeNames(a.key, b.key) ? [a, b] : null);
      }
    }
  }
  // The surest names first; a group never takes in a player its rosters tell apart from one of its own.
  const SURE = ['same', 'leet', 'part', 'slip'];
  const found = [...pairs.values()].filter(pair => pair && renameOf(...pair))
    .map(([a, b]) => ({ a, b, rank: SURE.indexOf(alikeNames(a.key, b.key)) }))
    .sort((p, q) => p.rank - q.rank || p.a.key.localeCompare(q.a.key) || p.b.key.localeCompare(q.b.key));
  const groupOf = new Map();
  for (const { a, b } of found) {
    const ga = groupOf.get(a.key) ?? [a], gb = groupOf.get(b.key) ?? [b];
    if (ga === gb || ga.some(x => gb.some(y => together(x, y).apart))) continue;
    const group = [...ga, ...gb];
    for (const member of group) groupOf.set(member.key, group);
  }
  const folded = new Map();
  for (const group of new Set(groupOf.values())) {
    const kept = group.slice().sort((x, y) => y.rosters.at(-1).day - x.rosters.at(-1).day || y.rosters.length - x.rosters.length
      || x.key.localeCompare(y.key))[0].key;
    for (const { key } of group) {
      if (key === kept) continue;
      folded.set(key, kept);
      if (people.has(key) && !people.has(kept)) people.set(kept, people.get(key));
    }
  }
  for (const tournament of tournaments) {
    for (const roster of tournament.rosters) {
      for (const player of roster.players) {
        const to = folded.get(playerKey(player));
        if (to) player.link = to;
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

/** The key the most games give, of a Map(key → count); ties to the first in key order; null for none. */
const mostOf = counts => [...(counts ?? new Map()).entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))[0]?.[0] ?? null;

/** A player's home region: the one whose events he has played most games in, or null (international events only). */
export const homeOf = player => mostOf(player?.regions);

/**
 * A nation's region by a sport's table → id → region or null: `nations` (region → [nation ids]) first, else its
 * confederation's in the game's own list (src/data/teams.js NATIONS: 'UEFA', 'AFC'…; `confederations`: confederation →
 * region).
 */
export function regionByConfederation({ confederations, nations = {} }) {
  const own = new Map(Object.entries(nations).flatMap(([region, ids]) => ids.map(id => [id, region])));
  return id => (id == null ? null : own.get(id) ?? confederations[NATIONS[id]?.[2]] ?? null);
}

/**
 * How region levels are fitted (regionLevels): a player's own strength about his region's level has a normal prior of
 * spread OFFSET_TAU, a region's level about the players' mean one of LEVEL_TAU (so a region that has met the others in a
 * handful of games stays near the middle), and the levels are then moved together so that ANCHOR's (Europe's) is a
 * newcomer's old start. Both spreads were chosen on Rocket League's held-out years 2021-11 to 2026-11, each year scored
 * with the levels fitted on the games before it (docs/design/rocket-league.md, "Regions").
 */
export const OFFSET_TAU = 250;
export const LEVEL_TAU = 150;
export const ANCHOR = 'EU';

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
 *   templateWords: a series' team template may name its roster by a word of its name (wordScore);
 *   homeBy: what a player's home region is (homesOf), 'event' (the region whose events he has played most games in, else
 *     his nation's) or 'nation' (his nation's, else that); regionOfNation(id): a nation's region (regionByConfederation);
 *   resultGames(tournament): whether a series of it that records a winner but no game counts as one game, its winner's;
 *     minRecent: the games of the last `activeDays` a player needs to be rated (0: having played in them is enough).
 */
export function createLiquipediaElo(config) {
  const { wiki, sourceId = 'liquipedia', edition = 'Liquipedia Elo', lineup, teamSize, minPlayers, minGames, activeDays,
    start = 1500, eloPerPoint, eloOffset, kScale, kFloor, position = 'PLR', skips = {}, isNationsEvent = () => false,
    nationOfTeamName = nationOfTeam, starters = lineup, gameOf, templateWords = false, homeBy = 'event',
    regionOfNation = () => null, resultGames = () => false, minRecent = 0 } = config;
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
   * A series that records a winner but no game counts as one game, its winner's (`result` true), at the tournaments
   * `resultGames` names; elsewhere it is left out.
   */
  function seriesInOrder(tournaments) {
    const find = rosterFinder(tournaments, { templateWords });
    const out = [], unplayable = [], borrowed = new Set(), aliased = new Set();
    tournaments.forEach((tournament, at) => {
      for (const series of tournament.series) {
        const games = series.games.length || !resultGames(tournament) ? series.games : [{ winner: series.winner, result: true }];
        if (series.walkover || !games.length) continue;
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
        const won = [1, 2].map(side => games.filter(game => game.winner === side).length);
        out.push({
          date: series.date ?? tournament.start, event: tournament.title, tier: tournament.tier, region: tournament.region,
          international: tournament.region == null, nations: tournament.nations, page: series.page, index: series.index,
          // A LAN's host nation, for the home crowd's edge (homeEdge).
          host: /^offline$/i.test(tournament.type ?? '') ? nationOfFlag(tournament.country) : null,
          names: series.opponents.map(opponent => opponent.team),
          teams: found.map(entry => startersOf(entry.roster)),
          rosters: found.map(entry => entry.roster),
          // A series names its format rarely: a finished one is best of twice its winner's games less one.
          games, winner: series.winner, bestOf: series.bestOf ?? 2 * Math.max(...won) - 1,
        });
      }
    });
    out.sort((a, b) => String(a.date).localeCompare(String(b.date)) || a.event.localeCompare(b.event)
      || a.page.localeCompare(b.page) || a.index - b.index);
    return { series: out, unplayable, borrowed: [...borrowed].sort(), aliased: [...aliased].sort() };
  }

  /**
   * Elo over `series` (seriesInOrder's), game by game. `scale`: kScale; `starts`: each region's starting Elo
   * (regionLevels'), a newcomer's his home's (`homes`: key → region, homesOf), else his first event's region's, else
   * `starts.world` (the world's mean, for a newcomer of no known region), else `start`; `seeds`: what a newcomer brings
   * from elsewhere (Map(key → { above: how far above his region's level, in Elo, games: the games behind it })), added to
   * that start; `holdout`: the date from which each
   * game's prediction is scored, before it is played (log loss, Brier score, the same for the international events alone
   * and, with `homes`, for the games between two regions' sides, and calibration by tenths of the expected score);
   * `recentFrom`: the date from which a player's games count as recent (`recent`).
   * `onGame(one, game, expected, sides)` is told of each game before it moves anyone, its sides' players as they stand
   * (each one's `games` those he had played before, `brought` those of his seed).
   * → { players: Map(key → player), games, scored, lan }
   */
  function runElo(series, { scale = kScale, starts = {}, homes = null, seeds = null, holdout = null, recentFrom: since = null, onGame = null } = {}) {
    const players = new Map();
    const scored = { all: newScore(), international: newScore(), cross: newScore(),
      bins: Array.from({ length: 10 }, () => ({ n: 0, expected: 0, won: 0 })) };
    const lan = [];
    let games = 0;
    const playerOfEntry = (entry, one) => {
      const key = playerKey(entry);
      let player = players.get(key);
      if (!player) {
        const seed = seeds?.get(key);
        player = { key, name: entry.name, elo: (starts[homes?.get(key)] ?? starts[one.region] ?? starts.world ?? start) + (seed?.above ?? 0),
          games: 0, wins: 0, brought: seed?.games ?? 0, recent: 0, first: one.date, last: one.date, flags: new Map(), regions: new Map(), team: null };
        players.set(key, player);
      }
      return player;
    };
    for (const one of series) {
      const sides = one.teams.map(team => team.map(entry => playerOfEntry(entry, one)));
      // Two regions' sides, each most of its players' home (crossRegion), for the held-out score of the games between regions.
      const cross = homes && holdout && one.date >= holdout && crossRegion(sides.map(side => side.map(player => player.key)), homes);
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
      const keys = one.host ? sides.map(side => side.map(player => player.key)) : null;
      for (const game of one.games) {
        const [a, b] = sides.map(side => side.reduce((sum, player) => sum + player.elo, 0) / side.length);
        const e = expected(a - b);
        const won = game.winner === 1 ? 1 : 0;
        if (onGame) onGame(one, game, e, sides);
        if (one.host) lan.push({ keys, host: one.host, surprise: won - e });
        if (holdout && one.date >= holdout) {
          score(scored.all, e, won);
          if (one.international) score(scored.international, e, won);
          if (cross) score(scored.cross, e, won);
          const bin = scored.bins[Math.min(9, Math.floor(e * 10))];
          bin.n++; bin.expected += e; bin.won += won;
        }
        sides.forEach((side, s) => {
          const delta = s === 0 ? won - e : e - won;
          for (const player of side) {
            player.elo += kFactor(player.games, scale) * delta;
            player.games++;
            if (since && one.date >= since) player.recent++;
            if ((s === 0) === (won === 1)) player.wins++;
          }
        });
        games++;
      }
    }
    return { players, games, scored, lan };
  }

  /** A side's region: the home (`homes`) of most of its players, else null. */
  const regionOfSide = (keys, homes) => {
    const counts = new Map();
    for (const key of keys) {
      const home = homes.get(key);
      if (home) counts.set(home, (counts.get(home) ?? 0) + 1);
    }
    return [...counts.entries()].find(([, n]) => n >= majority)?.[0] ?? null;
  };
  /** The two sides' regions ([first's, second's]) when they are two regions, else null. */
  function crossRegion(keys, homes) {
    const [a, b] = keys.map(side => regionOfSide(side, homes));
    return a && b && a !== b ? [a, b] : null;
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
   * Each player's home region over the games before `until` (all of them when null), → Map(key → region): with `homeBy`
   * 'event' the region whose events he has played most games in (homeOf), else his nation's (`regionOfNation` of
   * `nationOf(key)`), for the players seen before `until` (one first seen later starts at his first event's region's level,
   * runElo); with 'nation' his nation's, else the region whose events he has played most games in, for every player, as a
   * nation is a player's whenever he plays.
   */
  function homesOf(series, { until = null, nationOf = () => null } = {}) {
    const counts = new Map();
    for (const one of series) {
      const before = !(until && one.date >= until);
      if (!before && homeBy !== 'nation') continue;
      for (const team of one.teams) {
        for (const entry of team) {
          const key = playerKey(entry);
          if (!counts.has(key)) counts.set(key, new Map());
          if (before && one.region) counts.get(key).set(one.region, (counts.get(key).get(one.region) ?? 0) + one.games.length);
        }
      }
    }
    const homes = new Map();
    for (const [key, played] of counts) {
      const event = mostOf(played), nation = regionOfNation(nationOf(key));
      const home = homeBy === 'nation' ? nation ?? event : event ?? nation;
      if (home) homes.set(key, home);
    }
    return homes;
  }

  /**
   * Each region's level, the start of a newcomer who calls it home (`homes`, homesOf's), fitted at once with every player's
   * own strength over the games before `until` (all of them when null), as League of Legends' circuits are
   * (scripts/lib/esports-elo.mjs, circuitLevels): a player plays at his home's level plus his own offset, which a normal
   * prior of spread `tau` keeps near 0 where his games say little; a region's level has a normal prior of spread
   * `levelTau` about the players' mean, so a region a handful of games against the others say little about stays near the
   * middle; a side plays at its players' mean and wins with Elo's odds. Gradient ascent on that likelihood (Adam, steps of
   * about `rate` points, `iterations` of them), then every level moved by one amount so that `anchor`'s is `start`.
   * Regions meet at the international events and wherever a player of one plays in another's: too rarely for Elo alone,
   * as a closed pool's mean stays where its newcomers start. Fitted at once, every such game counts, each for what it says.
   * → { [region]: level, world: the players' mean, where a newcomer of no known region starts }
   */
  function regionLevels(series, homes, { until = null, tau = OFFSET_TAU, levelTau = LEVEL_TAU, iterations = 600, rate = 4,
    anchor = ANCHOR } = {}) {
    const index = new Map(), games = [];
    for (const one of series) {
      if (until && one.date >= until) continue;
      const sides = one.teams.map(team => Int32Array.from(team, entry => {
        const key = playerKey(entry);
        if (!index.has(key)) index.set(key, index.size);
        return index.get(key);
      }));
      for (const game of one.games) games.push({ sides, won: game.winner === 1 ? 1 : 0 });
    }
    const keys = [...index.keys()];
    const regions = [...new Set(keys.map(key => homes.get(key)).filter(Boolean))].sort();
    const home = Int32Array.from(keys, key => (homes.has(key) ? regions.indexOf(homes.get(key)) : -1));
    // theta: the regions' levels, then the players' offsets.
    const C = regions.length, P = keys.length, slope = Math.LN10 / 400;
    const theta = new Float64Array(C + P), grad = new Float64Array(C + P);
    const first = new Float64Array(C + P), second = new Float64Array(C + P);
    const strength = i => (home[i] >= 0 ? theta[home[i]] : 0) + theta[C + i];
    for (let step = 1; step <= iterations; step++) {
      grad.fill(0);
      for (const { sides, won } of games) {
        let a = 0, b = 0;
        for (const i of sides[0]) a += strength(i);
        for (const i of sides[1]) b += strength(i);
        const g = (won - expected(a / sides[0].length - b / sides[1].length)) * slope;
        for (let s = 0; s < 2; s++) {
          const side = sides[s], share = (s === 0 ? g : -g) / side.length;
          for (const i of side) {
            grad[C + i] += share;
            if (home[i] >= 0) grad[home[i]] += share;
          }
        }
      }
      for (let i = 0; i < P; i++) grad[C + i] -= theta[C + i] / (tau * tau);
      for (let c = 0; c < C; c++) grad[c] -= theta[c] / (levelTau * levelTau);
      for (let j = 0; j < C + P; j++) {
        first[j] = 0.9 * first[j] + 0.1 * grad[j];
        second[j] = 0.999 * second[j] + 0.001 * grad[j] * grad[j];
        theta[j] += rate * (first[j] / (1 - 0.9 ** step)) / (Math.sqrt(second[j] / (1 - 0.999 ** step)) + 1e-12);
      }
      let sum = 0, homed = 0;
      for (let i = 0; i < P; i++) if (home[i] >= 0) { sum += theta[home[i]]; homed++; }
      if (homed) for (let c = 0; c < C; c++) theta[c] -= sum / homed;
    }
    const zero = regions.includes(anchor) ? theta[regions.indexOf(anchor)] : 0;
    return Object.fromEntries([...regions.map((region, c) => [region, Math.round(start + theta[c] - zero)]),
      ['world', Math.round(start - zero)]].sort((x, y) => x[0].localeCompare(y[0])));
  }

  /** The first of the `activeDays` to `asOf`: from then on a game is recent (runElo's `recentFrom`). */
  const recentFrom = asOf => new Date(Date.parse(asOf) - activeDays * DAY).toISOString().slice(0, 10);

  /**
   * The rated players of a run, strongest first: those with `minGames` behind them (a seed's games counted) whose last game
   * is within `activeDays` of the export's last day (`asOf`), and who have played `minRecent` games or more in those days (a
   * run's `recent`, its `recentFrom` recentFrom(asOf)). Each as the snapshot keeps it: his flag from his cards or his page
   * (`people`), his nation from his national team or his flag (`national`), his region the home his start was his
   * region's level by (`homes`, homesOf's), else the region whose events he has played most games in.
   */
  function ratedPlayers(players, asOf, people = new Map(), national = new Map(), homes = null) {
    return [...players.values()]
      .filter(player => player.games + (player.brought ?? 0) >= minGames && daysBetween(player.last, asOf) <= activeDays
        && (!minRecent || player.recent >= minRecent))
      .map(player => ({ key: player.key, name: player.name, flag: flagOf(player, people), nation: nationOfPlayer(player, people, national),
        side: national.get(player.key)?.team ?? null, elo: Math.round(player.elo * 10) / 10, games: player.games, wins: player.wins,
        last: player.last, team: player.team, region: homes?.get(player.key) ?? homeOf(player) }))
      .sort((a, b) => b.elo - a.elo || a.name.localeCompare(b.name));
  }

  /**
   * The players rated at the end of an earlier season (`asOf`, its last day): the Elo of the games up to that day, each
   * newcomer at the level of his region then (`starts` and `homes`: regionLevels' and homesOf's over those games), rated as
   * ratedPlayers rates them then, each with the flag, nation and national team the whole record gives him (`whole`, the run
   * of every game's players): a player's country is his, whichever year it is.
   */
  function playersAsOf(series, asOf, { starts = {}, homes = null, seeds = null, people = new Map(), national = new Map(), whole }) {
    const { players } = runElo(series.filter(one => one.date <= asOf), { starts, homes, seeds, recentFrom: recentFrom(asOf) });
    return ratedPlayers(players, asOf, people, national, homes).map(player => {
      const all = whole.get(player.key);
      return { ...player, flag: flagOf(all, people), nation: nationOfPlayer(all, people, national), recent: players.get(player.key).recent };
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

  return { gameRating, kFactor, readTournaments, startersOf, seriesInOrder, runElo, crossRegion, homeEdge, homesOf, regionLevels,
    recentFrom, ratedPlayers, playersAsOf, playerOf, tupleOf, nationsOf, leftOut };
}
