// Rugby league's earlier seasons (docs/design/rugby-league.md, "Earlier seasons"): the 2008 NRL season from Rugby League
// 2: World Cup Edition's database. The database's reader, the Rugby League Project pages it is checked against, the rule
// that names a database player as a real one, and the overall, which is ours: the game rates twelve attributes from 1 to
// 10 and gives no overall. Then the seasons no game rated, 2009–2024, computed from NRL.com's match centre ("the
// computed seasons", below). No I/O here: scripts/sync-rugby-league-seasons.mjs reads the pinned inputs and writes the
// snapshots, scripts/build-rugby-league-seasons.mjs builds the seasons from them.
import { NATIONS, RUGBY_NEAR_PENALTY, buildClub, makeRng, teamEff } from '../../src/data/teams.js';
import { BASELINE, rugbyLeague } from '../../src/sports/rugbyLeague.js';
import { rosterOf } from './nrl.mjs';

// ---------- the database (RLDatabase.xml) ----------

/**
 * The database's XML as a tree of `{ tag, text, children }`. The file has no attributes, entities or empty elements, so
 * elements and their text are all there is; comments and the declaration are skipped.
 */
export function parseXmlTree(text) {
  const root = { tag: '#root', text: '', children: [] };
  const stack = [root];
  const token = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<\/([A-Za-z_]\w*)>|<([A-Za-z_]\w*)>|([^<]+)|(<)/g;
  let m;
  while ((m = token.exec(text))) {
    if (m[4]) throw new Error(`Unreadable markup at offset ${m.index}`);
    if (m[1]) {
      const node = stack.pop();
      if (node.tag !== m[1]) throw new Error(`</${m[1]}> closes <${node.tag}>`);
    } else if (m[2]) {
      const node = { tag: m[2], text: '', children: [] };
      stack.at(-1).children.push(node);
      stack.push(node);
    } else if (m[3] && stack.length > 1) stack.at(-1).text += m[3];
  }
  if (stack.length !== 1) throw new Error(`<${stack.at(-1).tag}> is never closed`);
  return root;
}

const child = (node, tag) => node.children.find(c => c.tag === tag);
const children = (node, tag) => node.children.filter(c => c.tag === tag);
const textOf = (node, tag) => {
  const found = child(node, tag);
  if (!found) throw new Error(`No <${tag}> in <${node.tag}>`);
  return found.text.trim();
};
const integer = (node, tag) => {
  const value = textOf(node, tag);
  if (!/^-?\d+$/.test(value)) throw new Error(`<${tag}> ${JSON.stringify(value)} is not a whole number`);
  return Number(value);
};

/**
 * The game's primary positions, by `primary_position` (0–12): its own order, read off the 2008 clubs (the fullbacks are
 * 0: Slater, Minichiello, Hornby; the halfbacks 1: Cronk, Kimmorley, Orford; the wingers 2 and 3; the centres 4 and 5;
 * the five-eighths 6: Lockyer, Marshall, Thurston; the props 7 and 9; the hookers 8: Cameron Smith, Buderus; the
 * second-rowers 10 and 11; the locks 12: Dallas Johnson, Tongue).
 */
export const PRIMARY_POSITION = Object.freeze(['FB', 'HB', 'WG', 'WG', 'CE', 'CE', 'FE', 'PR', 'HK', 'PR', 'SR', 'SR', 'LK']);

/** The twelve rated attributes, by the database's element names, and the keys this file uses for them. */
export const ATTRIBUTES = Object.freeze({
  fitness: 'FIT', speed: 'SPD', acceleration: 'ACC', aggressiveness: 'AGG', agility: 'AGI', break_tackle_ability: 'BRK',
  tackle_ability: 'TKL', pass_accuracy: 'PAS', offload_ability: 'OFF', general_kick_accuracy: 'KCK', goal_kick_accuracy: 'GKA',
  catch_ability: 'CAT',
});
/** The attributes in the order snapshots list them. */
export const ATTRIBUTE_ORDER = Object.freeze(Object.values(ATTRIBUTES));

/**
 * A team's own ratings, 1–10, by this file's keys and the database's element names: the five parts the database rates a
 * side by. It gives no overall; its three all-star sides (the NRL and Super League dream teams, and Sidhe's own) have 10
 * in all five, so all five measure a side.
 */
export const TEAM_RATING_PARTS = Object.freeze({ willingness: 'willingness_to_attack', attack: 'attack', defence: 'defense', flair: 'flair',
  support: 'support' });

/**
 * A database name as the game spells it: `\x20` joins the words of a first name ("Jean\x20Philippe Baile", "Jeremy\x20J
 * Smith"), so the first word is the first name and the rest the surname ("Hazem El Masri").
 */
export function nameParts(raw) {
  const [first, ...rest] = String(raw).trim().split(/\s+/);
  if (!first || !rest.length) throw new Error(`${JSON.stringify(raw)} is not a first name and a surname`);
  const given = first.replace(/\\x20/g, ' ');
  return { name: `${given} ${rest.join(' ')}`, first: given, last: rest.join(' ') };
}

/**
 * The players and teams of RLDatabase.xml: players `{ index, dbIndex, name, first, last, born, primary, pos, attributes, star }`
 * (`index` the entry's place in the file, which the teams' lists name: six entries an editor copied keep the copied
 * entry's `db_index`, `dbIndex`, Rhys Lovegrove's and Chaz I'Anson's among them, and only their place tells them apart;
 * `attributes` by ATTRIBUTES' keys, each 1–10, or 0 where the file omits it (its own comment: an omitted value is zero); `star` the database's 0–100 "star" value, whose meaning the game does not
 * document), teams `{ index, name, mnemonic, type, comp, available, players, goalKickers }` (`type` 0 club, 1 representative,
 * 2 national; `players` the database indexes it lists, in order).
 */
export function readRl2Database(xmlText) {
  const tree = parseXmlTree(String(xmlText).trimStart().replace(/\r\n/g, '\n'));
  const entry = child(child(child(child(tree, 'MabStream'), 'database'), 'dynamic_database'), 'entry');
  const players = children(child(entry, 'players'), 'entry').map((node, index) => {
    const primary = integer(node, 'primary_position');
    if (!PRIMARY_POSITION[primary]) throw new Error(`Unknown primary position ${primary} (${textOf(node, 'name')})`);
    const attributes = {};
    for (const [tag, key] of Object.entries(ATTRIBUTES)) {
      const value = integer(node, tag);
      if (value < 0 || value > 10) throw new Error(`${textOf(node, 'name')}: ${tag} ${value} is not 0–10`);
      attributes[key] = value;
    }
    // The file writes aggressiveness twice, once misspelt: both always agree.
    if (integer(node, 'agressiveness') !== attributes.AGG) throw new Error(`${textOf(node, 'name')}: the two aggressiveness values differ`);
    const [year, month, day] = ['year', 'month', 'day'].map(tag => integer(node, tag));
    return { index, dbIndex: integer(node, 'db_index'), ...nameParts(textOf(node, 'name')),
      born: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`, primary, pos: PRIMARY_POSITION[primary],
      attributes, star: integer(node, 'star') };
  });
  const declared = integer(entry, 'num_players');
  if (players.length !== declared) throw new Error(`The database lists ${players.length} players, not its ${declared}`);
  const teams = children(child(entry, 'teams'), 'entry').map(node => {
    const listed = children(child(node, 'players'), 'entry').map(e => integer(e, 'index'));
    if (listed.length !== integer(node, 'num_players')) throw new Error(`${textOf(node, 'name')} lists ${listed.length} players, not its num_players`);
    if (listed.some(i => !players[i])) throw new Error(`${textOf(node, 'name')} lists a player the database does not have`);
    const ratings = Object.fromEntries(Object.entries(TEAM_RATING_PARTS).map(([key, tag]) => {
      const value = integer(node, tag);
      if (value < 1 || value > 10) throw new Error(`${textOf(node, 'name')}: ${tag} ${value} is not 1–10`);
      return [key, value];
    }));
    return { index: integer(node, 'db_index'), name: textOf(node, 'name'), mnemonic: textOf(node, 'short_mnemonic'), type: integer(node, 'team_type'),
      comp: integer(node, 'primary_comp'), available: integer(node, 'available'), players: listed, ratings,
      goalKickers: children(child(node, 'goal_kicker'), 'entry').map(e => Number(e.text.trim())) };
  });
  if (teams.length !== integer(entry, 'num_teams')) throw new Error('The team count disagrees with num_teams');
  return { players, teams };
}

// ---------- the Rugby League Project's pages ----------

// RLP's pages carry a build time, a render time and each player's current age, which change from one request to the
// next: a pin covers only the part read (`…Part`), which does not.
const decode = text => text.replace(/&#0*39;|&#x27;|&rsquo;|&#8217;/gi, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&')
  .replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
const between = (html, start, end, what) => {
  const from = html.indexOf(start);
  const to = from < 0 ? -1 : html.indexOf(end, from);
  if (from < 0 || to < 0) throw new Error(`RLP's page has no ${what}`);
  return html.slice(from, to + end.length);
};

/** A club season page's player list (`/seasons/<season>/<club>/players.html`): its "grid lines" table. */
export const gridPart = html => between(html, '<table class="grid lines">', '</table>', 'player grid');
/** The World Cup's squads page: its squad tables, one a nation. */
export function squadsPart(html) {
  const tables = html.match(/<table class="list(?: left)?"><tr><td colspan="\d+"><h3>[\s\S]*?<\/table>/g);
  if (!tables) throw new Error("RLP's page has no squad tables");
  return tables.join('\n');
}
/** A competition's players page (the 2008 Test matches): its "All Players" table. */
export const testsPart = html => between(html, '<table class="list x">', '</table>', 'players table');
/** A season's results page: its results table. */
export const resultsPart = html => between(html, '<table class="list is"', '</table>', 'results table');
/** A player page: his name, date of birth and career positions (which the computed seasons read). */
export function playerPart(html) {
  const name = between(html, '<h1>', '</h1>', 'name');
  const born = html.match(/<dt>Born<\/dt><dd>[^<]*<\/dd>/)?.[0] ?? '';
  const positions = html.match(/<dt>Position\(s\)<\/dt><dd>[^<]*<\/dd>/)?.[0] ?? '';
  return `${name}\n${born}\n${positions}`;
}

/**
 * RLP's "First SURNAME" as `{ first, last }`: the surname starts at the first word in capitals (after a Mc or Mac:
 * "Adam MacDOUGALL", "Hazem EL MASRI", "Sonny Bill WILLIAMS").
 */
export function rlpName(text) {
  const words = decode(text).trim().split(/\s+/);
  const at = words.findIndex((word, i) => i > 0 && /[A-Z]/.test(word) && word.replace(/^(Mc|Mac)/, '') === word.replace(/^(Mc|Mac)/, '').toUpperCase());
  if (at < 1) throw new Error(`No surname in RLP's ${JSON.stringify(text)}`);
  return { first: words.slice(0, at).join(' '), last: words.slice(at).join(' ') };
}
/** RLP's "SURNAME, First" as `{ first, last }`. */
export function rlpListName(text) {
  const [last, first] = decode(text).split(',').map(part => part.trim());
  if (!last || !first) throw new Error(`No surname, first name in RLP's ${JSON.stringify(text)}`);
  return { first, last };
}

/** The players a club season page lists: `[{ id, first, last }]`, RLP's player ids. */
export function rlpGrid(html) {
  return [...gridPart(html).matchAll(/<a href="\/players\/(\d+)">([^<]*)<\/a>/g)].map(m => ({ id: Number(m[1]), ...rlpName(m[2]) }));
}

/** The World Cup's squads, by RLP's name of each nation: `{ Australia: [{ id, first, last }], … }`. */
export function rlpSquads(html) {
  const squads = {};
  for (const part of squadsPart(html).split('<h3>').slice(1)) {
    const nation = decode(part.slice(0, part.indexOf('</h3>'))).trim();
    squads[nation] = [...part.matchAll(/<a href="\/players\/(\d+)">([^<]*)<\/a>/g)].map(m => ({ id: Number(m[1]), ...rlpListName(m[2]) }));
  }
  return squads;
}

/** Every player of a competition's players page: `[{ id, first, last, teams }]`, `teams` RLP's codes ('AUS', 'PNG' …). */
export function rlpTestPlayers(html) {
  return [...testsPart(html).matchAll(/<tr><td><a href="\/players\/(\d+)">([^<]*)<\/a><td>[^<]*<td>([^<]*)/g)].map(m => ({
    id: Number(m[1]), ...rlpListName(m[2]), teams: m[3].split(',').map(code => code.trim().replace(/-\d+$/, '')).filter(Boolean) }));
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** A player page's name and date of birth (YYYY-MM-DD, or null where RLP has none). */
export function rlpPlayer(html) {
  const part = playerPart(html);
  const name = decode(part.slice(4, part.indexOf('</h1>'))).trim();
  const born = part.match(/<dd>\w+, (\d+)\w\w (\w+), (\d{4})<\/dd>/);
  if (born && !MONTHS.includes(born[2])) throw new Error(`RLP's player ${name}: unreadable date of birth`);
  return { name, born: born ? `${born[3]}-${String(MONTHS.indexOf(born[2]) + 1).padStart(2, '0')}-${born[1].padStart(2, '0')}` : null };
}

/**
 * A season's games from its results page: `[{ competition, round, home, away, homeScore, awayScore }]`, the clubs by
 * RLP's slug for the season ('melbourne', 'bulldogs' …), the regular season's rounds as 'Round 1' … and the finals by
 * name.
 */
export function rlpResults(html) {
  const games = [];
  let round = null, competition = null;
  for (const row of resultsPart(html).split('<tr>').slice(1)) {
    const heading = row.match(/<h3[^>]*><a href="[^"]*">([^<]*)<\/a><\/h3>/);
    if (heading) { competition = decode(heading[1]).trim(); continue; }
    const roundHead = row.match(/^<th colspan="\d+">(?:<a [^>]*>)?([^<]+)/);
    if (roundHead) { round = decode(roundHead[1]).trim(); continue; }
    const teams = [...row.matchAll(/<td class="team"><a href="\/seasons\/[^/]+\/([^/]+)\/summary\.html">[^<]*<\/a><\/td><td class="n">(\d+)<\/td>/g)];
    if (teams.length !== 2) continue;
    games.push({ competition, round, home: teams[0][1], away: teams[1][1], homeScore: Number(teams[0][2]), awayScore: Number(teams[1][2]) });
  }
  return games;
}

// ---------- naming a database player ----------

const FOLD = { ø: 'o', đ: 'd', ð: 'd', ł: 'l', ß: 'ss', æ: 'ae', œ: 'oe' };
/** A name as the sources may spell it differently: no accents, case, spaces, hyphens or apostrophes. */
export const fold = name => String(name).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[øđðłßæœ]/g, c => FOLD[c]).replace(/[^a-z]/g, '');

export function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return d[a.length][b.length];
}

/**
 * The listed player (RLP's) a database player is, among `pool` (`[{ id, first, last }]`), or null: `{ entry, how }`.
 * - 'name': the whole name the same, folded (accents, case, spaces, hyphens and apostrophes aside: Nu'uausala, Seu Seu);
 * - 'surname and initial': the surname the same and the first names starting with the same letter (Dan and Danny,
 *   Darryl and Daryl), when exactly one listed player fits;
 * - 'near spelling': the first name the same and the surname a letter off (two in a surname of eight letters or more),
 *   when exactly one listed player fits.
 * Anything but 'name' names him only if RLP gives a date of birth like the database's (bornAlike; the sync checks it on
 * his player page).
 */
export function findListed(pool, { first, last }) {
  const whole = fold(first + last), given = fold(first), surname = fold(last);
  const unique = (list, how) => (new Set(list.map(entry => entry.id)).size === 1 ? { entry: list[0], how } : null);
  const named = pool.filter(entry => fold(entry.first + entry.last) === whole);
  if (named.length) return unique(named, 'name');
  const initial = pool.filter(entry => fold(entry.last) === surname && fold(entry.first)[0] === given[0]);
  if (initial.length) return unique(initial, 'surname and initial');
  const near = pool.filter(entry => fold(entry.first) === given
    && editDistance(fold(entry.last), surname) <= (surname.length >= 8 ? 2 : 1));
  return near.length ? unique(near, 'near spelling') : null;
}

/**
 * Whether two dates of birth (YYYY-MM-DD) are one player's: the same, or the same year with the day or the month alike (a
 * slip of one field: RLP's Sam Moa was born 14 August 1986, the database's Samuela Moa 14 June). A date RLP does not give
 * proves nothing.
 */
export function bornAlike(a, b) {
  if (!a || !b) return false;
  const [ya, ma, da] = a.split('-'), [yb, mb, db] = b.split('-');
  return a === b || (ya === yb && (ma === mb || da === db));
}

// ---------- the overall ----------

/**
 * The database's defaults: values most players were left at rather than rated (fitness 7 for 336 of the 2008 clubs' 462
 * players, general kicking 4 for 303, goal-kicking 3 for 350). A default says nothing of the player, so it never counts;
 * nor does a value the file omits (0).
 */
export const DEFAULTS = Object.freeze({ FIT: 7, KCK: 4, GKA: 3 });

/**
 * Each position's score: a weighted mean of the attributes its job asks for, the weights in per cent. Goal-kicking counts
 * nowhere: the match model converts every try at the NRL's rate, whoever kicks, and goal-kicking is no position's job.
 * General kicking counts only for the halves, whose job it is. Each weight's reason is REASONS'.
 */
export const WEIGHTS = Object.freeze({
  FB: Object.freeze({ CAT: 20, SPD: 15, ACC: 10, AGI: 15, BRK: 15, TKL: 10, PAS: 5, FIT: 10 }),
  WG: Object.freeze({ SPD: 25, ACC: 10, AGI: 10, BRK: 15, CAT: 20, TKL: 15, FIT: 5 }),
  CE: Object.freeze({ BRK: 20, SPD: 10, ACC: 10, AGI: 10, TKL: 20, PAS: 10, OFF: 5, CAT: 10, FIT: 5 }),
  FE: Object.freeze({ PAS: 25, KCK: 15, AGI: 15, SPD: 10, ACC: 10, BRK: 5, TKL: 10, CAT: 5, FIT: 5 }),
  HB: Object.freeze({ PAS: 30, KCK: 30, AGI: 10, ACC: 10, TKL: 5, CAT: 5, FIT: 10 }),
  HK: Object.freeze({ PAS: 30, TKL: 25, ACC: 10, AGI: 10, CAT: 5, AGG: 5, FIT: 15 }),
  PR: Object.freeze({ BRK: 25, TKL: 25, OFF: 15, AGG: 15, ACC: 5, CAT: 5, FIT: 10 }),
  SR: Object.freeze({ TKL: 25, BRK: 20, SPD: 10, ACC: 5, AGI: 5, OFF: 10, AGG: 10, CAT: 5, FIT: 10 }),
  LK: Object.freeze({ TKL: 30, BRK: 15, PAS: 15, OFF: 10, AGG: 10, CAT: 5, FIT: 15 }),
});

/** Why each weight is what it is. */
export const REASONS = Object.freeze({
  FB: {
    CAT: 'fields the kicks: the bomb and the grubber are his first duty',
    SPD: 'kick returns and support runs cover the length of the field',
    ACC: 'returns start from a standstill under the high ball',
    AGI: 'beats the first chaser on a return and in broken play',
    BRK: 'the kick return is a carry into contact: metres after it start the set',
    TKL: 'the last line of defence, one on one',
    PAS: 'joins the line as an extra ball-player, a small part of his game',
    FIT: 'covers the whole field for eighty minutes',
  },
  WG: {
    SPD: 'finishing on the edge is a race to the corner',
    ACC: 'beats a defender to the line from a standing start',
    AGI: 'steps the last defender in a narrow channel',
    BRK: 'carries the ball out of his own end on the early tackles',
    CAT: 'takes the cross-field bomb and the kick returns',
    TKL: 'defends the edge one on one, with no one outside him',
    FIT: 'repeated returns and chases; less than a forward\'s workload',
  },
  CE: {
    BRK: 'runs hard lines into the defence on the edge',
    SPD: 'turns a line-break into a try',
    ACC: 'hits the gap before it closes',
    AGI: 'steps the inside defender',
    TKL: 'defends the edge channel, where most attacks are aimed',
    PAS: 'gives the winger the last pass',
    OFF: 'keeps the ball alive in the tackle for his winger',
    CAT: 'takes the pass at speed and the high ball on the edge',
    FIT: 'chases and covers; less than a forward\'s workload',
  },
  FE: {
    PAS: 'the second receiver: his passing shapes the attack',
    KCK: 'the second kicker, for the attacking kick and the long kick',
    AGI: 'his running game is the step off the line',
    SPD: 'takes the line on and supports the break',
    ACC: 'hits the line from a flat start',
    BRK: 'holds his own in contact; not his job',
    TKL: 'defends in the line, a channel attacks aim at',
    CAT: 'handles under pressure in the line',
    FIT: 'eighty minutes of decisions; not a forward\'s workload',
  },
  HB: {
    PAS: 'runs the attack: the long and the short pass',
    KCK: 'the main kicker: the last-tackle kick, the grubber, the kick to touch',
    AGI: 'runs around the ruck and takes the short side',
    ACC: 'the dart from the ruck',
    TKL: 'defends, usually where the side shields him',
    CAT: 'handles every play: a small part, as all of them catch',
    FIT: 'involved in every set, at both ends',
  },
  HK: {
    PAS: 'passes from dummy-half on nearly every play',
    TKL: 'makes more tackles than anyone in the side',
    ACC: 'the dart out of dummy-half',
    AGI: 'steps the marker from dummy-half',
    CAT: 'picks the ball up at the ruck',
    AGG: 'stands up in the middle of the defence',
    FIT: 'at every ruck for most of the game',
  },
  PR: {
    BRK: 'the hit-up: metres after contact are his job',
    TKL: 'the middle defence',
    OFF: 'the second-phase play off the hit-up',
    AGG: 'dominance in contact, at both ends',
    ACC: 'leg drive off the mark',
    CAT: 'takes the pass into contact; a small part',
    FIT: 'work rate in his stints',
  },
  SR: {
    TKL: 'edge defence and high tackle counts',
    BRK: 'runs the edge lines into contact',
    SPD: 'edge running makes breaks a prop never sees',
    ACC: 'hits the hole from a short run',
    AGI: 'a step on the edge; a small part',
    OFF: 'offloads to his centre',
    AGG: 'contact at both ends',
    CAT: 'takes the pass on the edge',
    FIT: 'plays more minutes than the props',
  },
  LK: {
    TKL: 'leads the middle defence, the side\'s busiest tackler',
    BRK: 'carries in the middle',
    PAS: 'the link to the backs: a ball-playing forward',
    OFF: 'second-phase play',
    AGG: 'contact at both ends',
    CAT: 'handles as the extra ball-player',
    FIT: 'covers the most ground of the forwards',
  },
});

/**
 * A player's score at `position`: the weighted mean of the attributes WEIGHTS gives it, leaving out any attribute at its
 * database default (DEFAULTS) or omitted (0); six decimals.
 */
export function positionScore(position, attributes) {
  const weights = WEIGHTS[position];
  if (!weights) throw new Error(`No weights for ${position}`);
  let total = 0, weight = 0;
  for (const [key, w] of Object.entries(weights)) {
    const value = attributes[key];
    if (!Number.isInteger(value) || value < 0 || value > 10) throw new Error(`${position}: ${key} ${value} is not 0–10`);
    if (value === 0 || DEFAULTS[key] === value) continue;
    total += w * value;
    weight += w;
  }
  if (!weight) throw new Error(`${position}: no rated attribute`);
  return Math.round(total / weight * 1e6) / 1e6;
}

/**
 * The built-in season's overalls a position's 2008 players are read against, lowest first: as many of each 2025 club's
 * best at the position (its players' first position, Rugby League 26's overall) as the 2008 clubs carry per club
 * (`quota`, which may be fractional: every club's first whole number of players, then the best of the next rank across
 * the league), so that a 2008 backup meets 2025's backups rather than its development players. `players`:
 * `[{ club, pos, rating, name }]`.
 */
export function referenceOf(players, position, quota) {
  const byClub = new Map();
  for (const player of players.filter(p => p.pos === position)) {
    if (!byClub.has(player.club)) byClub.set(player.club, []);
    byClub.get(player.club).push(player);
  }
  const ranked = [];
  for (const list of byClub.values()) {
    list.sort((a, b) => b.rating - a.rating || a.name.localeCompare(b.name));
    list.forEach((player, depth) => ranked.push({ ...player, depth }));
  }
  ranked.sort((a, b) => a.depth - b.depth || b.rating - a.rating || a.club.localeCompare(b.club) || a.name.localeCompare(b.name));
  return ranked.slice(0, Math.round(quota * byClub.size)).map(player => player.rating).sort((a, b) => a - b);
}

/**
 * A score's overall: its mid-rank percentile among `scores` (a position's 2008 club players; ties share one, and a score
 * no club player has falls between its neighbours), read off `reference` (ascending) by linear interpolation, rounded and
 * held to 1–99. A higher score never gets a lower overall.
 */
export function overallOf(score, scores, reference) {
  return Math.min(99, Math.max(1, Math.round(readOff(score, scores, reference))));
}

/**
 * `value`'s mid-rank percentile among `values` (ties share one; a value none has falls between its neighbours), read off
 * `reference` (ascending) by linear interpolation, unrounded: the percentile rule of the overall and of the club shift.
 */
export function readOff(value, values, reference) {
  if (!values.length || !reference.length) throw new Error('No values or no reference');
  const below = values.filter(v => v < value).length, equal = values.filter(v => v === value).length;
  const p = (below + equal / 2) / values.length;
  const m = reference.length;
  const h = Math.min(Math.max(p * m - 0.5, 0), m - 1);
  const lo = Math.floor(h), hi = Math.ceil(h);
  return reference[lo] + (reference[hi] - reference[lo]) * (h - lo);
}

// ---------- the club shift ----------

/** A team's rating: the equal-weight mean of its five parts (TEAM_RATING_PARTS), fixed before any result was read. */
export const teamRatingOf = ratings => Object.keys(TEAM_RATING_PARTS).reduce((sum, key) => sum + ratings[key], 0) / Object.keys(TEAM_RATING_PARTS).length;

/** A club's players `pool` with every rating moved by `shift`, held to 1–99: their order is kept. */
export const shifted = (pool, shift) => pool.map(player => ({ ...player, rating: Math.min(99, Math.max(1, player.rating + shift)) }));

/**
 * The whole number of points every player of a club moves by: the one that brings its lineup's strength (clubSquadOf, its
 * players `pool` shifted and held to 1–99) closest to `target`; of two as close, the smaller move, then the lower.
 * → `{ shift, before, after }`, the lineup's strength unshifted and shifted.
 */
export function clubShiftOf(pool, target) {
  const strength = shift => clubSquadOf(shifted(pool, shift)).lineup.rating;
  const before = strength(0);
  let best = null;
  for (let shift = -40; shift <= 40; shift++) {
    const after = strength(shift), miss = Math.abs(after - target);
    if (!best || miss < best.miss - 1e-9 || (Math.abs(miss - best.miss) <= 1e-9
      && (Math.abs(shift) < Math.abs(best.shift) || (Math.abs(shift) === Math.abs(best.shift) && shift < best.shift)))) best = { shift, after, miss };
  }
  return { shift: best.shift, before, after: best.after };
}

/** Spearman's rank correlation (mid-ranks for ties). */
export function spearman(xs, ys) {
  const ranks = values => {
    const order = values.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
    const out = new Array(values.length);
    for (let i = 0; i < order.length;) {
      let j = i;
      while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++;
      for (let k = i; k <= j; k++) out[order[k][1]] = (i + j) / 2 + 1;
      i = j + 1;
    }
    return out;
  };
  const rx = ranks(xs), ry = ranks(ys);
  const mean = v => v.reduce((s, x) => s + x, 0) / v.length;
  const mx = mean(rx), my = mean(ry);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < rx.length; i++) { sxy += (rx[i] - mx) * (ry[i] - my); sxx += (rx[i] - mx) ** 2; syy += (ry[i] - my) ** 2; }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0;
}

/** The chance a random positive outranks a random negative by `value` (ties half): the area under the ROC curve. */
export function areaUnderCurve(items, value, positive) {
  const pos = items.filter(positive).map(value), neg = items.filter(item => !positive(item)).map(value);
  let wins = 0;
  for (const p of pos) for (const n of neg) wins += p > n ? 1 : p === n ? 0.5 : 0;
  return pos.length && neg.length ? wins / (pos.length * neg.length) : null;
}

// ---------- the season's clubs and nations ----------

/** The data set id of an NRL season: 'nrl-2008'. */
export const seasonIdOf = year => `nrl-${year}`;

/** The era map the season of `year` plays on (scripts/data/rugby-league-seasons.json `maps`). */
export function mapOf(manifest, year) {
  const map = manifest.maps.find(entry => entry.seasons.includes(year));
  if (!map) throw new Error(`No NRL map for ${year}`);
  return map.id;
}

/**
 * The clubs of the season of `year` (scripts/data/rugby-league-seasons.json `teams`): `{ list, franchise, id, name, code,
 * city, ground, base?, home, country }`, `franchise` today's club, `id` the season's own (today's unless the club has been
 * renamed or moved since).
 */
export function teamsOf(manifest, year) {
  const list = manifest.teams[String(year)];
  if (!list) throw new Error(`No NRL clubs listed for ${year}`);
  const teams = list.map(team => ({ ...team, id: team.id ?? team.franchise }));
  for (const key of ['list', 'id', 'code', 'city', 'franchise']) {
    const values = teams.map(team => team[key]);
    if (new Set(values).size !== values.length) throw new Error(`Two NRL clubs of ${year} share a ${key}`);
  }
  return teams;
}

const byRating = (a, b) => b.rating - a.rating || a.name.localeCompare(b.name);
const fielded = player => ({ ...player, others: [] });

/**
 * A club's squad from its players `pool` (`[{ name, pos, rating }]`, one position each): the matchday 17 the game picks,
 * then its best players left, up to 24 (scripts/lib/nrl.mjs rosterOf). Nobody is added: a place no player of the club's
 * own unit can fill is `open`, and the game plays whoever it puts there out of position.
 */
export function clubSquadOf(pool) {
  const { squad, lineup } = rosterOf(pool.map(fielded).sort(byRating));
  const open = lineup.slots.filter(slot => !slot.player || slot.penalty > RUGBY_NEAR_PENALTY).map(slot => slot.position);
  return { squad, lineup, open };
}

/**
 * A nation's team from its players `pool`, as the built-in nations are (scripts/lib/nrl.mjs nationsOf): the matchday
 * 17 and depth up to 24; `str` counts a place its own players cannot fill at the sport's baseline, where the game fields
 * a generated player.
 */
export function nationSquadOf(id, pool) {
  if (!NATIONS[id]) throw new Error(`The game has no nation ${id}`);
  const { squad, lineup } = rosterOf(pool.map(fielded).sort(byRating));
  const covered = lineup.slots.map(slot => (slot.player && slot.penalty <= RUGBY_NEAR_PENALTY ? slot.effectiveRating : BASELINE));
  const open = lineup.slots.filter(slot => !slot.player || slot.penalty > RUGBY_NEAR_PENALTY).map(slot => slot.position);
  return { id, name: NATIONS[id][0], str: Math.round(covered.reduce((s, v) => s + v, 0) / covered.length), squad, open };
}

// ---------- the season played ----------

/** Circle-method rounds for an even number of teams, as scripts/simulation-realism.mjs plays them. */
function roundRobin(n) {
  const ids = [...Array(n).keys()];
  const rounds = [];
  for (let r = 0; r < n - 1; r++) {
    const pairs = [];
    for (let i = 0; i < n / 2; i++) pairs.push(r % 2 ? [ids[n - 1 - i], ids[i]] : [ids[i], ids[n - 1 - i]]);
    rounds.push(pairs);
    ids.splice(1, 0, ids.pop());
  }
  return rounds;
}

/**
 * Plays `seasons` seeded seasons of `clubs` (a season file's), 24 games each, every game at a neutral venue at Balanced,
 * as scripts/simulation-realism.mjs plays the built-in clubs, and measures what it measures of the NRL: points, margins and
 * the standings, and each club's mean record (`clubs`, strongest first). An odd number of clubs (the seventeen of 2023
 * on) adds a bye, as the NRL's draw has one: each round one club sits out, over enough rounds that each plays 24 or 25,
 * and records count by games played.
 */
export function playSeasons(clubs, { seasons = 40, seed = 20261108, games = 24 } = {}) {
  const teams = clubs.map(club => buildClub(club, rugbyLeague));
  const eff = teams.map(teamEff);
  const rng = makeRng(seed);
  const n = teams.length, slots = n % 2 ? n + 1 : n;
  const roundsPlayed = slots === n ? games : Math.ceil(games * slots / n);
  const points = [], margins = [], spreads = [], best = [], worst = [];
  const totals = teams.map(() => ({ wins: 0, for: 0, against: 0, played: 0 }));
  for (let s = 0; s < seasons; s++) {
    const order = [...Array(slots).keys()];
    for (let i = slots - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    const rounds = roundRobin(slots);
    const table = teams.map(() => ({ won: 0, played: 0 }));
    for (let g = 0; g < roundsPlayed; g++) {
      const flip = Math.floor(g / rounds.length) % 2 === 1;
      for (const [x, y] of rounds[g % rounds.length]) {
        const [i, j] = flip ? [order[y], order[x]] : [order[x], order[y]];
        if (i >= n || j >= n) continue;
        const result = rugbyLeague.simulate(rng, teams[i], teams[j], 6, eff[i], eff[j]);
        points.push(result.ga, result.gd);
        margins.push(Math.abs(result.ga - result.gd));
        const winner = result.winner === teams[i].id ? i : j;
        for (const [k, own, other] of [[i, result.ga, result.gd], [j, result.gd, result.ga]]) {
          table[k].played++;
          totals[k].played++;
          totals[k].for += own;
          totals[k].against += other;
          if (winner === k) { table[k].won++; totals[k].wins++; }
        }
      }
    }
    const values = table.map(t => t.won / t.played);
    spreads.push(sd(values));
    best.push(Math.max(...values) * games);
    worst.push(Math.min(...values) * games);
  }
  return {
    pointsPerTeam: mean(points), teamPointsSd: sd(points), marginMean: mean(margins),
    byOne: share(margins, m => m === 1), withinSix: share(margins, m => m > 0 && m <= 6), withinTwelve: share(margins, m => m > 0 && m <= 12),
    byThirteenPlus: share(margins, m => m >= 13), byTwentyFivePlus: share(margins, m => m >= 25),
    nilRate: share(points, p => p === 0), fortyPlusRate: share(points, p => p >= 40),
    winPctSd: mean(spreads), bestWins: mean(best), worstWins: mean(worst),
    clubs: clubs.map((club, k) => ({ id: club.id, name: club.name, str: club.str, wins: totals[k].wins / totals[k].played * games,
      pointsFor: totals[k].for / totals[k].played, pointsAgainst: totals[k].against / totals[k].played }))
      .sort((a, b) => b.wins - a.wins || a.name.localeCompare(b.name)),
  };
}

// ---------- the real season ----------

const mean = xs => xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length);
const sd = xs => { const m = mean(xs); return Math.sqrt(mean(xs.map(x => (x - m) ** 2))); };
const share = (xs, test) => xs.filter(test).length / Math.max(1, xs.length);
const round3 = x => Math.round(x * 1000) / 1000;

/**
 * A regular season's figures from its games (`[{ home, away, homeScore, awayScore }]`), as scripts/lib/nrl-seasons.mjs
 * measures the NRL's: points, margins, draws and the standings (`records` by club: won, drawn, lost, for, against).
 */
export function seasonFigures(games) {
  const points = games.flatMap(game => [game.homeScore, game.awayScore]);
  const margins = games.map(game => Math.abs(game.homeScore - game.awayScore));
  const records = {};
  for (const game of games) {
    for (const [club, own, other] of [[game.home, game.homeScore, game.awayScore], [game.away, game.awayScore, game.homeScore]]) {
      const record = (records[club] ||= { won: 0, drawn: 0, lost: 0, for: 0, against: 0 });
      record.for += own;
      record.against += other;
      if (own > other) record.won++; else if (own === other) record.drawn++; else record.lost++;
    }
  }
  const winPct = Object.values(records).map(r => (r.won + r.drawn / 2) / (r.won + r.drawn + r.lost));
  const decided = games.filter(game => game.homeScore !== game.awayScore);
  return {
    games: games.length,
    pointsPerTeam: round3(mean(points)), teamPointsSd: round3(sd(points)),
    draws: games.length - decided.length,
    marginMean: round3(mean(margins)),
    byOne: round3(share(margins, m => m === 1)), withinSix: round3(share(margins, m => m > 0 && m <= 6)),
    withinTwelve: round3(share(margins, m => m > 0 && m <= 12)), byThirteenPlus: round3(share(margins, m => m >= 13)),
    byTwentyFivePlus: round3(share(margins, m => m >= 25)),
    nilRate: round3(share(points, p => p === 0)), fortyPlusRate: round3(share(points, p => p >= 40)),
    homeWins: round3(share(decided, game => game.homeScore > game.awayScore)),
    winPctSd: round3(sd(winPct)),
    bestWins: Math.max(...Object.values(records).map(r => r.won)), worstWins: Math.min(...Object.values(records).map(r => r.won)),
    records,
  };
}

// ---------- the computed seasons: NRL.com's match centre ----------
//
// No game rated the NRL's seasons from 1998 to 2007 or from 2009 to 2024. Each is computed from what NRL.com's match
// centre recorded of it (its team lists and player stats): a player's season is scored at NRL Fantasy's points for the
// stats NRL.com kept that season (all eleven from 2003), ranked within his position and read off Rugby League 26's
// overalls there, as 2008's attribute overall is read; then each club moves by its results that season (its Simple
// Rating System), as 2008's moves by the game's own team rating.

/** NRL.com's team-list positions, as the game's. A player listed at one started there, whatever his jersey number. */
export const NRLCOM_POSITION = Object.freeze({ Fullback: 'FB', Winger: 'WG', Centre: 'CE', 'Five-Eighth': 'FE', Halfback: 'HB',
  Prop: 'PR', Hooker: 'HK', '2nd Row': 'SR', Lock: 'LK' });
/** NRL.com's names for a place off the field at kick-off: the interchange, the 18th and 19th men, and one it did not record. */
export const NRLCOM_BENCH = Object.freeze(['Interchange', 'Replacement', 'Reserve', 'Unknown']);
/** The Rugby League Project's career positions (a player page's "Position(s)"), as the game's. */
export const RLP_POSITION = Object.freeze({ Fullback: 'FB', Wing: 'WG', Centre: 'CE', 'Five-eighth': 'FE', Halfback: 'HB',
  'Front row': 'PR', Hooker: 'HK', 'Second row': 'SR', Lock: 'LK' });

/**
 * The stats a player's game counts, by NRL.com's names, at NRL Fantasy's points: the eleven NRL.com has kept since 2003.
 * Least squares on NRL.com's own fantasy totals (7,344 player-games of 2025) recovers them: 8.03, 5.13, 3.98, 2.16, 1.02,
 * −1.95, 2.06, 3.66, −1.97, 0.1008 a metre run and 0.0328 a metre kicked. Goals and field goals count nowhere, as in
 * 2008's overall: the match model converts every try at the NRL's rate, whoever kicks. CORE_REASONS gives each its reason.
 */
export const CORE = Object.freeze({ tries: 8, tryAssists: 5, lineBreaks: 4, lineBreakAssists: 2, tacklesMade: 1, missedTackles: -2,
  tackleBreaks: 2, offloads: 4, errors: -2, allRunMetres: 1 / 10, kickMetres: 1 / 30 });
/** Why each stat counts, and at its weight. */
export const CORE_REASONS = Object.freeze({
  tries: 'the try is what the game is played for: NRL Fantasy\'s biggest award',
  tryAssists: 'the last pass or kick before a try',
  lineBreaks: 'a run through the defensive line, the best gain short of a try',
  lineBreakAssists: 'the pass that puts a runner through the line',
  tacklesMade: 'a point a tackle: defence is half the game, and most of the middle forwards\' work',
  missedTackles: 'a missed tackle lets the attack through: twice a tackle\'s worth taken away',
  tackleBreaks: 'beating a tackler in contact',
  offloads: 'keeping the ball alive through the tackle',
  errors: 'a knock-on or other error hands the ball over',
  allRunMetres: 'a point every ten metres carried: the forwards\' and outside backs\' work',
  kickMetres: 'a point every thirty metres kicked: territory, the halves\' and fullbacks\' work',
});
/**
 * The stats a snapshot keeps of a player's season, in this order: the counted ones, then his minutes, goals and field
 * goals (matchRecord says where it reads errors and goals from).
 */
export const KEPT = Object.freeze([...Object.keys(CORE), 'minutesPlayed', 'goals', 'fieldGoals']);
/** The season before counts at this weight beside the season itself, when he played in it. */
export const PREVIOUS_WEIGHT = 0.5;
// CORE in thirtieths of a point, whole numbers, so that a season's points add up exactly.
const CORE_30 = Object.values(CORE).map(points => Math.round(points * 30));

/**
 * A season's core points from its stats' sums (`sums`, CORE's order first): exact, four decimals. `counted`, the stats
 * that count (statCensus's `recorded`), all of CORE's unless named: a stat NRL.com did not record that season scores
 * nothing.
 */
export function corePoints(sums, counted = null) {
  if (!Array.isArray(sums) || sums.length < CORE_30.length) throw new Error('No stats to count');
  const stats = Object.keys(CORE);
  if (counted && counted.some(stat => !stats.includes(stat))) throw new Error(`${counted.join(', ')}: not CORE's stats`);
  let thirtieths = 0;
  CORE_30.forEach((points, i) => {
    if (!Number.isInteger(sums[i])) throw new Error(`${stats[i]} ${sums[i]} is not a whole number`);
    if (!counted || counted.includes(stats[i])) thirtieths += points * sums[i];
  });
  return Math.round(thirtieths / 30 * 1e4) / 1e4 + 0;
}

/**
 * The share of a season's games with team lists a stat must appear in (non-zero for at least one player) for NRL.com
 * to have recorded it that season. NRL.com did not keep all eleven of CORE's stats from 1998: try assists from 1999, line
 * breaks' assists, tackle breaks and kick metres from 2003 (a few finals before carry them all). From 2003 every stat
 * appears in 96% of games or more.
 */
export const RECORDED_SHARE = 0.95;

/**
 * Which of CORE's stats NRL.com recorded throughout a season (`games`, its games with team lists or without, as
 * nrlcomSeason gives them): those that appear in at least RECORDED_SHARE of its games with team lists, less any the
 * manifest marks as recorded only in part (`partial`: 1998's run metres, which cover some runs only). →
 * `{ games, given: { stat: games it appears in }, recorded: [stat …] }` in CORE's order.
 */
export function statCensus(games, partial = []) {
  const stats = Object.keys(CORE);
  if (partial.some(stat => !stats.includes(stat))) throw new Error(`${partial.join(', ')}: not CORE's stats`);
  const listed = games.filter(game => game.home.players && game.away.players);
  const given = Object.fromEntries(stats.map(stat => [stat, 0]));
  for (const game of listed) {
    const rows = [...game.home.players, ...game.away.players];
    stats.forEach((stat, i) => { if (rows.some(row => row[4 + i] !== 0)) given[stat]++; });
  }
  const recorded = stats.filter(stat => listed.length && given[stat] >= RECORDED_SHARE * listed.length && !partial.includes(stat));
  return { games: listed.length, given, recorded };
}

/**
 * A player's value, his core points a club game: the season's in full, and the season before's at PREVIOUS_WEIGHT when
 * he played in it, over his club's games in each (the mean of his clubs' where he played for two). `season` and
 * `previous` are `{ points, clubGames }`; six decimals.
 */
export function seasonValue(season, previous = null) {
  const points = season.points + (previous ? PREVIOUS_WEIGHT * previous.points : 0);
  const games = season.clubGames + (previous ? PREVIOUS_WEIGHT * previous.clubGames : 0);
  if (!(games > 0)) throw new Error('A value needs club games');
  return Math.round(points / games * 1e6) / 1e6 + 0;
}

/** The mean of the clubs' game counts: `clubs` a player's `[[club, his games there], …]`, `counts` each club's games. */
export function clubGamesOf(clubs, counts) {
  const values = clubs.map(([club]) => {
    if (!Number.isInteger(counts[club])) throw new Error(`No game count for ${club}`);
    return counts[club];
  });
  return values.reduce((s, v) => s + v, 0) / values.length;
}

/** A season's rounds, from its draw reply: `[[value, name]]` in order. */
export function drawRounds(body) {
  const rounds = (body?.filterRounds || []).map(round => [round.value, String(round.name)]);
  if (!rounds.length || rounds.some(([value]) => !Number.isInteger(value))) throw new Error('The draw offers no rounds');
  return rounds.sort((a, b) => a[0] - b[0]);
}

/**
 * A round's finished games, from its draw reply, in the draw's order: `[{ url, title, kickOff, venue, city, home: [teamId,
 * nickname, score], away: […] }]`. The draw's score is the result.
 */
export function drawGames(body) {
  return (body?.fixtures || []).filter(f => f.type === 'Match' && f.matchState === 'FullTime' && f.matchCentreUrl).map(f => ({
    url: f.matchCentreUrl, title: f.roundTitle, kickOff: f.clock?.kickOffTimeLong ?? null, venue: f.venue ?? null, city: f.venueCity ?? null,
    home: [f.homeTeam.teamId, f.homeTeam.nickName, f.homeTeam.score], away: [f.awayTeam.teamId, f.awayTeam.nickName, f.awayTeam.score] }));
}

/**
 * A game's team lists, from its match centre reply, as a snapshot reads them: `{ id, title, home, away }`, each side
 * `{ team, score, players }`, a row a player, `[playerId, name, position, jersey, ...KEPT]` (a stat the reply does not
 * give him 0); null when the reply has no team lists. Two of KEPT are not read by their own names. NRL.com's `goals`
 * is empty in every season, so a player's goals are his `conversions` and `penaltyGoals` (the goals scripts/sync-nrl.mjs
 * counts from the timeline). And its replies of 2013–2015 record no `errors` at all, only `handlingErrors`: in a game
 * whose reply gives no player an error, a player's errors are his handling errors.
 */
export function matchRecord(body) {
  if (!body?.homeTeam?.players?.length || !body?.awayTeam?.players?.length) return null;
  const count = value => (Number.isFinite(value) ? value : 0);
  const rowsOf = key => body.stats?.players?.[key] || [];
  const noErrors = [...rowsOf('homeTeam'), ...rowsOf('awayTeam')].every(row => !count(row.errors));
  const statOf = (row, stat) => (stat === 'goals' ? count(row.conversions) + count(row.penaltyGoals)
    : stat === 'errors' && noErrors ? count(row.handlingErrors) : count(row[stat]));
  const side = key => {
    const team = body[key];
    const stats = new Map(rowsOf(key).map(row => [row.playerId, row]));
    return { team: team.teamId, score: team.score, players: team.players.map(p => {
      const row = stats.get(p.playerId) || {};
      return [p.playerId, `${p.firstName ?? ''} ${p.lastName ?? ''}`.replace(/\s+/g, ' ').trim(), p.position, p.number,
        ...KEPT.map(stat => statOf(row, stat))];
    }) };
  };
  return { id: body.matchId, title: body.roundTitle, home: side('homeTeam'), away: side('awayTeam') };
}

/**
 * Whether a team-list row (matchRecord's) took the field: a player listed at a position started there; one named off
 * the field (NRLCOM_BENCH) played only if NRL.com gives him minutes or any counted stat. An unused interchange or 18th man
 * has neither; where NRL.com kept no minutes for a game, the bench count by their stats alone.
 */
export function tookField(row) {
  const [, name, position] = row;
  if (Object.hasOwn(NRLCOM_POSITION, position)) return true;
  if (!NRLCOM_BENCH.includes(position)) throw new Error(`${name}: the team-list place ${JSON.stringify(position)} is no position NRL.com uses`);
  return KEPT.some((stat, i) => row[4 + i] !== 0 && (stat === 'minutesPlayed' || Object.hasOwn(CORE, stat)));
}

/**
 * A season's players from its games (`[{ order, home: { club, players }, away: { club, players } }]`, `order` rising with
 * the games' kick-offs across seasons, `players` the side's team-list rows or null where NRL.com has none), by NRL.com's
 * player id: `{ id, name, games, clubs, lastAt, starts, lastStart, sums }`, the games he took the field in (tookField) by
 * club and the order of his last for each, his starts by position and the order of his last at each, and his KEPT
 * stats summed. His name is the one of his last game.
 */
export function seasonPlayers(games) {
  const players = new Map();
  for (const game of games) {
    for (const side of [game.home, game.away]) {
      for (const row of side.players || []) {
        if (!tookField(row)) continue;
        const [id, name, position] = row;
        let player = players.get(id);
        if (!player) players.set(id, player = { id, name, games: 0, clubs: {}, lastAt: {}, starts: {}, lastStart: {}, sums: KEPT.map(() => 0) });
        player.name = name;
        player.games++;
        player.clubs[side.club] = (player.clubs[side.club] || 0) + 1;
        player.lastAt[side.club] = game.order;
        const pos = NRLCOM_POSITION[position];
        if (pos) {
          player.starts[pos] = (player.starts[pos] || 0) + 1;
          player.lastStart[pos] = game.order;
        }
        KEPT.forEach((stat, i) => { player.sums[i] += row[4 + i]; });
      }
    }
  }
  return players;
}

/** The club a player played most games for; of two as many, the one he played for last. */
export function clubOf(player) {
  return Object.keys(player.clubs).sort((a, b) => player.clubs[b] - player.clubs[a] || player.lastAt[b] - player.lastAt[a])[0];
}

/**
 * The position a player started at most over `records` (his records of one season or more, seasonPlayers'); of two as
 * often, the one he started at last. Null if he started at none.
 */
export function mostStarted(records) {
  const starts = {}, last = {};
  for (const record of records) {
    for (const [pos, count] of Object.entries(record?.starts || {})) {
      starts[pos] = (starts[pos] || 0) + count;
      last[pos] = Math.max(last[pos] ?? -Infinity, record.lastStart[pos]);
    }
  }
  return Object.keys(starts).sort((a, b) => starts[b] - starts[a] || last[b] - last[a])[0] ?? null;
}

/**
 * A Rugby League Project player page's career positions (its "Position(s)"), as the game's, in its order. "Utility
 * Forward" (a bench forward's) names no position and is passed over; a page may list no position at all.
 */
export function rlpPositions(html) {
  const listed = String(html).match(/<dt>Position\(s\)<\/dt><dd>([^<]*)<\/dd>/);
  if (!listed) return [];
  return decode(listed[1]).split('/').map(name => name.trim()).filter(name => name && !/^Utility\b/.test(name)).map(name => {
    if (!Object.hasOwn(RLP_POSITION, name)) throw new Error(`RLP's position ${JSON.stringify(name)} is no position of the game's`);
    return RLP_POSITION[name];
  });
}

/**
 * The Simple Rating System of a season's games (`[{ home, away, homeScore, awayScore }]`): each club's rating and one home
 * edge that fit every margin as the home club's rating less the away club's, plus the edge, by least squares, the
 * ratings summing to zero. Solved exactly: the normal equations with that constraint, by Gaussian elimination. →
 * `{ ratings: { club: rating }, homeEdge }`, in points a game, three decimals.
 */
export function srsOf(games) {
  const clubs = [...new Set(games.flatMap(game => [game.home, game.away]))].sort();
  const n = clubs.length, at = new Map(clubs.map((club, i) => [club, i]));
  // Unknowns: the n ratings, the home edge and the constraint's multiplier; the last column is the right-hand side.
  const size = n + 2;
  const m = Array.from({ length: size }, () => new Array(size + 1).fill(0));
  for (const game of games) {
    const row = new Array(n + 1).fill(0);
    row[at.get(game.home)] += 1;
    row[at.get(game.away)] -= 1;
    row[n] = 1;
    const margin = game.homeScore - game.awayScore;
    for (let i = 0; i <= n; i++) {
      if (!row[i]) continue;
      for (let j = 0; j <= n; j++) m[i][j] += row[i] * row[j];
      m[i][size] += row[i] * margin;
    }
  }
  for (let i = 0; i < n; i++) { m[i][n + 1] = 1; m[n + 1][i] = 1; }
  for (let col = 0; col < size; col++) {
    let pivot = col;
    for (let r = col + 1; r < size; r++) if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
    if (Math.abs(m[pivot][col]) < 1e-12) throw new Error('The games do not rate every club');
    [m[col], m[pivot]] = [m[pivot], m[col]];
    for (let r = 0; r < size; r++) {
      if (r === col || !m[r][col]) continue;
      const factor = m[r][col] / m[col][col];
      for (let c = col; c <= size; c++) m[r][c] -= factor * m[col][c];
    }
  }
  const round = value => Math.round(value * 1000) / 1000 + 0;
  return { ratings: Object.fromEntries(clubs.map((club, i) => [club, round(m[i][size] / m[i][i])])), homeEdge: round(m[n][size] / m[n][n]) };
}
