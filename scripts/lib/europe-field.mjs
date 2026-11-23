// An earlier season's field of Europe's strongest clubs, by results (docs/design/domestic-campaigns.md, "The Europe maps"):
// the season's clubs ranked by their strength in scripts/data/club-strength.json (scripts/lib/club-strength.mjs), each
// matched to a squad its sources rate, down to the TOP_CLUBS'th. A club the strengths rank but no source gives eleven
// players is passed over, and the audit names it.
//
// A strength names its club as the results do ("Dynamo Kyiv (Ukraine)"); a source by its own name ("Dinamo Kiev"). The
// two are matched within the club's country: by scripts/data/club-strength-names.json where it names the club (its
// names in the sources, or null for none), else by the words of the two names (matchScore), when one candidate alone
// shares all the words of the shorter name. No I/O here.
import { firstDivisionOf } from '../../src/data/footballLeagues.js';
import { TOP_CLUBS } from '../../src/data/scopes.js';
import { fillRating } from '../../src/engine/footballSets.js';

/** Letters NFD does not take apart. */
const LETTERS = { ø: 'o', æ: 'ae', ß: 'ss', ł: 'l', đ: 'd', ı: 'i', œ: 'oe', þ: 'th', ð: 'd', ħ: 'h' };
/** Words that tell no club from another: legal forms, "club", "football" in the sources' languages, articles. */
const COMMON = new Set(['fc', 'cf', 'ac', 'sc', 'as', 'ss', 'us', 'afc', 'cd', 'sd', 'ud', 'rc', 'rcd', 'fk', 'nk', 'sk', 'hnk', 'gnk', 'pfc', 'sv',
  'vfl', 'vfb', 'tsv', 'fsv', 'bv', 'club', 'calcio', 'de', 'del', 'la', 'el', 'futbol', 'football', 'fotbal', 'futebol', 'ca', 'cs', 'ks', 'kv',
  'kaa', 'krc', 'rsc', 'osc', 'ogc', 'sad', 'if', 'ik', 'bk', 'ff', 'fotball', 'ofk', 'acf', 'ssc', 'spvgg', 'tsg', 'ssv', 'bsc', 'ksc', 'og', 'ao',
  'pae', 'gs', 'jk', 'kf', 'mfk', 'fcs', 'sl', 'ad', 'tj', 'csd', 'and', 'the', 'of', 'di', 'du', 'des', 'le', 'les', 'van', 'boldklub', 'klub',
  'kluby', 'idrottsforening', 'idrettslag']);
/** The same place or word in another spelling: each maps to one form. */
const SPELLINGS = {
  moskva: 'moscow', moskau: 'moscow', kyiv: 'kiev', kiyv: 'kiev', kharkiv: 'kharkov', dnipro: 'dnepr', dnipropetrovsk: 'dnepr', odesa: 'odessa',
  bucuresti: 'bucharest', beograd: 'belgrade', praha: 'prague', warszawa: 'warsaw', wien: 'vienna', koln: 'cologne', koeln: 'cologne',
  munchen: 'munich', muenchen: 'munich', lisboa: 'lisbon', torino: 'turin', genova: 'genoa', firenze: 'florence', athina: 'athens',
  thessaloniki: 'salonika', dynamo: 'dinamo', zvezda: 'star', crvena: 'red', sankt: 'st', sofiya: 'sofia', barysau: 'borisov', lviv: 'lvov',
  zaporizhzhia: 'zaporozhye', kobenhavn: 'copenhagen', goteborg: 'gothenburg', plzen: 'pilsen', bruxelles: 'brussels', brussel: 'brussels',
  antwerpen: 'antwerp', anvers: 'antwerp', gent: 'ghent', luik: 'liege', napoli: 'naples',
};
// A reserve or youth side's mark: kept as a word, so "Spartak 2" never passes for Spartak.
const RESERVE = /^(?:ii|iii|b|c|u\d\d|2|3|jong|castilla|atletic|amateure|reserves?)$/;

const wordsOf = new Map();
/** A club name's words, in one spelling, without the words that tell no club apart. */
export function nameWords(name) {
  let words = wordsOf.get(name);
  if (!words) wordsOf.set(name, words = splitName(name));
  return words;
}
function splitName(name) {
  let text = String(name).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  // Dotted initials are one word: "F.C. København", "U.C. Sampdoria", "R.C.D. Mallorca".
  // An apostrophe joins a word ("Be'er Sheva" is Beer Sheva).
  text = text.replace(/[øæßłđıœþðħ]/g, c => LETTERS[c]).replace(/\b(?:[a-z]\.){2,}/g, initials => `${initials.replace(/\./g, '')} `)
    .replace(/(?<=[a-z])['’`](?=[a-z])/g, '');
  const words = text.replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
  return [...new Set(words.filter(w => RESERVE.test(w) || (w.length > 1 && !/^\d+$/.test(w) && !COMMON.has(w))).map(w => SPELLINGS[w] ?? w))];
}

/** Whether two words differ by one edit: a letter changed, added or dropped (Metalist Kharkov, Metalist Kharkiv). */
function oneEdit(a, b) {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}
/**
 * Whether two words name the same thing: equal; of five letters or more and one edit apart (Kharkov, Kharkiv) or one
 * inside the other but for two letters (Grasshopper, Grasshoppers); or of four or more, one starting the other but for
 * four letters (Lyon, Lyonnais). Not Lorca in Mallorca, Istanbul in Istanbulspor, Porto in Portomosense.
 */
const sameWord = (a, b) => {
  if (a === b) return true;
  const gap = Math.abs(a.length - b.length);
  if (a.length >= 5 && b.length >= 5 && (oneEdit(a, b) || (gap <= 2 && (a.includes(b) || b.includes(a))))) return true;
  return Math.min(a.length, b.length) >= 4 && gap <= 4 && (a.startsWith(b) || b.startsWith(a)) && !RESERVE.test(a) && !RESERVE.test(b);
};

/**
 * How well two names match: [the share of the shorter name's words the other has, the share of all their words both
 * have, the share of the shorter name's words the other has spelt the same]. [1, 1, 1] for the same words; "Basel" and
 * "FC Basel 1893" [1, 1, 1]; "Salzburg" and "FC Red Bull Salzburg" [1, 1/3, 1]; "Lecce" and "Lecco" [1, 1, 0].
 */
export function matchScore(a, b) {
  const A = nameWords(a), B = nameWords(b);
  if (!A.length || !B.length) return [0, 0, 0];
  // A reserve mark on one side only is never the same club.
  if (A.some(w => RESERVE.test(w) && !B.includes(w)) || B.some(w => RESERVE.test(w) && !A.includes(w))) return [0, 0, 0];
  const shared = A.filter(word => B.some(other => sameWord(word, other))).length;
  const exact = A.filter(word => B.includes(word)).length;
  const shorter = Math.min(A.length, B.length);
  return [shared / shorter, shared / (A.length + B.length - shared), exact / shorter];
}
// Every word first, then the same spelling (Lecce's Lecce, not Lecco), then the fewest words besides.
const byScore = (x, y) => y[0][0] - x[0][0] || y[0][2] - x[0][2] || y[0][1] - x[0][1];
const sameScore = (x, y) => x[0] === y[0] && x[1] === y[1] && x[2] === y[2];

/** The name the results give a club, without its country: "Dynamo Kyiv (Ukraine)" → "Dynamo Kyiv". */
export const resultName = ident => ident.replace(/ \([^()]+\)$/, '');

/**
 * The candidate a strength's club is, among `pool` (the unclaimed candidates of its country, in their sources' order of
 * preference): by `names` when the names file lists the club (an exact name; null: none is), else the one candidate
 * sharing every word of the shorter name, ahead of the next by its share of all their words. `{ club, how }` or null.
 */
export function matchClub(ident, pool, names = undefined) {
  if (names !== undefined) {
    if (names === null) return null;
    const club = pool.find(candidate => names.includes(candidate.name));
    return club ? { club, how: 'named' } : null;
  }
  const ranked = pool.map(candidate => [matchScore(resultName(ident), candidate.name), candidate]).sort(byScore);
  if (!ranked.length || ranked[0][0][0] < 1) return null;
  if (ranked.length > 1 && sameScore(ranked[0][0], ranked[1][0])) return null;
  return { club: ranked[0][1], how: ranked[0][0][1] === 1 && ranked[0][0][2] === 1 ? 'same' : 'words' };
}

/**
 * A strength's club in one source: its candidates of the club's country or of the league it played in (Swansea's
 * England), not yet claimed by a stronger club nor named exactly as another ranked club (`owners`: FC Moskva is no
 * Lokomotiv Moskva's). `{ club, how }` or null.
 */
function matchIn(row, candidates, claimed, names, owners) {
  const [ident, shape, , league = null] = row;
  const pool = candidates.filter(candidate => (candidate.country === shape || candidate.country === league) && !claimed.has(candidate)
    && (!owners.has(candidate) || owners.get(candidate) === ident));
  return matchClub(ident, pool, Object.hasOwn(names, ident) ? names[ident] : undefined);
}

/**
 * Each candidate a ranked club names exactly (every word the same, spelt the same, or by the names file), and that club:
 * no other ranked club may take it by its words alone.
 */
function exactOwners(strengths, candidates, names) {
  const owners = new Map();
  for (const [ident, shape, , league = null] of strengths) {
    for (const candidate of candidates) {
      if (owners.has(candidate) || (candidate.country !== shape && candidate.country !== league)) continue;
      const listed = Object.hasOwn(names, ident) ? (names[ident] ?? []).includes(candidate.name) : false;
      const score = matchScore(resultName(ident), candidate.name);
      if (listed || (score[0] === 1 && score[1] === 1 && score[2] === 1)) owners.set(candidate, ident);
    }
  }
  return owners;
}

/**
 * The season's field: the `count` strongest clubs of `strengths` (the season's list in scripts/data/club-strength.json,
 * `[ident, shape, strength, league shape?]`, strongest first) that `sources` give a squad. `sources` are the candidates
 * by preference, each `[{ name, country, ... }]` (a season's own source first, a fill after it): a club is matched in
 * the first source that has it. Each kept candidate comes back with its `rank` (1 for the strongest), `strength` and
 * `source` (its index in `sources`); `passed` lists the ranked clubs above the last kept that no source gives a squad,
 * `matches` how each kept club was found where the names differ.
 */
export function strengthField(strengths, sources, { names = {}, count }) {
  const claimed = new Set();
  const kept = [], passed = [], matches = [];
  const owners = sources.map(candidates => exactOwners(strengths, candidates, names));
  for (const row of strengths) {
    if (kept.length >= count) break;
    let found = null, from = -1;
    for (let s = 0; s < sources.length && !found; s++) {
      found = matchIn(row, sources[s], claimed, names, owners[s]);
      from = s;
    }
    if (!found) { passed.push(row[0]); continue; }
    claimed.add(found.club);
    kept.push({ ...found.club, rank: kept.length + 1, strength: row[2], source: from, ident: row[0], leagueShape: row[3] ?? null });
    if (found.how !== 'same') matches.push(`${row[0]} = ${found.club.name}${found.how === 'named' ? ' (named)' : ''}`);
  }
  if (kept.length < count) throw new Error(`Only ${kept.length} of the ${strengths.length} ranked clubs have a squad in the season's sources, not ${count}`);
  return { kept, passed, matches };
}

/** Every strength's club `candidates` has, strongest first, each candidate taken once: Map(ident → candidate). */
export function matchAll(strengths, candidates, names = {}) {
  const claimed = new Set(), out = new Map(), owners = exactOwners(strengths, candidates, names);
  for (const row of strengths) {
    const found = matchIn(row, candidates, claimed, names, owners);
    if (!found) continue;
    claimed.add(found.club);
    out.set(row[0], found.club);
  }
  return out;
}

const mean = xs => xs.reduce((sum, x) => sum + x, 0) / xs.length;
const xiMean = club => mean(club.squad.map(player => player.rating));

/**
 * The line that puts a fill's ratings on the season's own scale (`{ a, b, clubs, r }`, own = a + b × fill): least squares
 * over the clubs both rate, each club's XI mean in one against its XI mean in the other. `pairs` are [fill club, own club].
 */
export function fillScale(pairs) {
  if (pairs.length < 20) throw new Error(`Only ${pairs.length} clubs are in both sources: too few to put one's ratings on the other's scale`);
  const xs = pairs.map(([fill]) => xiMean(fill)), ys = pairs.map(([, own]) => xiMean(own));
  const mx = mean(xs), my = mean(ys);
  const sxy = xs.reduce((sum, x, i) => sum + (x - mx) * (ys[i] - my), 0), sxx = xs.reduce((sum, x) => sum + (x - mx) ** 2, 0);
  const syy = ys.reduce((sum, y) => sum + (y - my) ** 2, 0);
  const b = sxy / sxx, a = my - b * mx;
  const round = (x, places) => Math.round(x * 10 ** places) / 10 ** places;
  return { a: round(a, 3), b: round(b, 4), clubs: pairs.length, r: round(sxy / Math.sqrt(sxx * syy), 3) };
}


/**
 * The `field` option a season builder takes in place of its strongest TOP_CLUBS by rating: its `count` strongest clubs
 * by results (strengthField), from its own candidates (`built`, as the builder makes them) and, where `fill` is given
 * (`{ candidates, source }`: another source's clubs of the same season, the CM 01/02 Update Team's for an EA season),
 * from the fill's for any club the season's own source lacks. A fill club comes back marked `fill`, its players rated on
 * the season's scale (fillScale over the clubs both rate) and its league that of the country it plays in (`firstDivision`).
 * `ids` (Map('<country>:<name>' → id), scripts/lib/season-map-ids.mjs) are the ids the season's own country maps already
 * give, `fill.ids` those of the maps its fill gives; `reserved` every id the season's maps give, which no other club takes.
 * Returns `{ clubs, clubFill, audit, idOf }`: the kept clubs strongest first, the fill's source and scale where any is
 * kept, and each club's id where its country map has it.
 */
export function resultsField({ strengths, names = {}, count, fill = null, firstDivision, ids = null, reserved = null }) {
  return built => {
    const sources = fill ? [built, fill.candidates] : [built];
    const { kept, passed, matches } = strengthField(strengths, sources, { names, count });
    const fills = kept.filter(club => club.source === 1);
    let clubFill = null, scale = null;
    if (fills.length) {
      const own = matchAll(strengths, built, names), other = matchAll(strengths, fill.candidates, names);
      scale = fillScale([...other].filter(([ident]) => own.has(ident)).map(([ident, club]) => [club, own.get(ident)]));
      clubFill = { source: fill.source, scale: { ...scale, conversion: 'round(a + b * rating), held to 1-99', basis: 'least squares over the XI means of the clubs both rate' } };
    }
    const clubs = kept.map(({ source, leagueShape, ...club }) => {
      if (source !== 1) return club;
      // A fill club plays in its league's country (Swansea's England), as the season's own clubs do.
      const country = leagueShape ?? club.country;
      // As the game rates them when it reads the season (src/engine/footballSets.js fillRating).
      const squad = club.squad.map(player => ({ ...player, rating: fillRating(player.rating, scale) }));
      return { ...club, league: firstDivision(country), country, squad, str: Math.round(xiMean({ squad })), fill: true };
    });
    const idOf = club => (club.fill ? fill?.ids : ids)?.get(`${club.country}:${club.name}`) ?? null;
    return { clubs, clubFill, audit: { passed, matches, ...(clubFill ? { fill: { clubs: fills.length, scale } } : {}) }, idOf, reserved };
  };
}

/**
 * The field option of the season ending in `year`, from the committed strengths (`strengths`, scripts/data/club-strength.json)
 * and names (`names`, scripts/data/club-strength-names.json `names`): Europe's TOP_CLUBS strongest by results, `fill`
 * where the season's own source lacks a club (an EA season's Update Team database, scripts/lib/update-team-fill.mjs).
 */
export function seasonField({ strengths, names = {}, year, fill = null, count = TOP_CLUBS, ids = null, reserved = null }) {
  const list = strengths.seasons[year];
  if (!list) throw new Error(`scripts/data/club-strength.json ranks no season ending in ${year}`);
  return resultsField({ strengths: list, names, count, fill, ids, reserved, firstDivision: country => firstDivisionOf(country, year) });
}
