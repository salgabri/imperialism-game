// The computed fills (docs/design/football-years.md, "Computed fills"; docs/design/computed-ratings.md, "Where it applies
// now"): an EA season's nation that fields a side but is short of a natural XI takes, for each place EA's own players
// leave empty, a real player capped for it around the season (Wikidata's national-team stints, the computed national-team
// seasons' rule), rated so its XI meets the strength its World Football Elo gives on the season's ratings date. Every
// EA-rated player keeps EA's rating; nothing is generated. No I/O: scripts/sync-football-fills.mjs writes the facts
// (scripts/data/football-fills/), scripts/build-ea-seasons.mjs hands them to assembleEaSeason (scripts/lib/ea-seasons.mjs).
import { NATIONS, selectLineup } from '../../src/data/teams.js';
import { FOOTBALL_FEDERATIONS } from '../../src/data/footballFederations.js';
import { NO_TEAM, dayNationResolver, nationResolver, territoryFor } from '../../src/data/footballSetBuild.js';
import { naturalFootballRoles } from '../../src/data/footballSquad.js';
import { listedPosition, seasonPools } from './national-team-seasons.mjs';
import { nameWords, namesAgree, wordsAgree } from './person-names.mjs';
import { RESULTS_NAMES } from './results-names.mjs';
import { levelOf, levelled, levelsText } from './confederation-levels.mjs';

/** The calendar years the fills' seasons reach: FIFA 05's 2004/05 window (2004, 2005) to the built-in 2026/27's (2026, 2027). */
export const FILL_YEARS = Object.freeze([2004, 2027]);
/** A computed player's `source`: an estimate, marked wherever it is shown (src/data/estimates.js), in international football's words. */
export const FILL_SOURCE = 'estimate';
export const FILL_LEAGUE = 'International football';
const ROLES = ['GK', 'DF', 'MF', 'FW'];
const XI = 11;

const WIKIDATA_DAY = /^\d{4}-\d{2}-\d{2}T00:00:00Z$/;
/** Wikidata's female (sex or gender, P21). */
export const FEMALE = 'Q6581072';

/**
 * The players QLever's sex-or-gender answer (sparqlRows' rows of `sexes`: player, sex) records as women: a membership of
 * a men's team of theirs is Wikidata's error, as for three of Haiti's women's internationals filed under its men's team.
 * An unknown value is no answer. → Set(qid)
 */
export function womenOf(rows) {
  return new Set(rows.filter(row => String(row.sex).endsWith(`/entity/${FEMALE}`)).map(row => String(row.player).split('/').pop()));
}

/**
 * QLever's stint rows with each start or end that is no Wikidata day (a typed year such as 112020) read as unknown, so
 * the stint has no start (and is left out) or no end. → `{ rows, malformed: [[statement, qualifier, value]] }`.
 */
export function withoutMalformedDays(rows) {
  const malformed = [];
  const cleaned = rows.map(row => {
    const copy = { ...row };
    for (const key of ['start', 'end']) {
      const value = copy[key];
      if (value == null || WIKIDATA_DAY.test(value) || /\/\.well-known\/genid\//.test(value)) continue;
      malformed.push([String(row.st), key, value]);
      copy[key] = null;
    }
    return copy;
  });
  return { rows: cleaned, malformed: malformed.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1)) };
}

const median = xs => {
  const s = xs.slice().sort((a, b) => a - b), n = s.length;
  if (!n) throw new Error('No values to take the median of');
  return n % 2 ? s[n >> 1] : (s[n / 2 - 1] + s[n / 2]) / 2;
};
const qidNumber = qid => Number(qid.slice(1));
const round2 = x => Math.round(x * 100) / 100;

/**
 * Each Wikidata team's game nation in the season ending in `year` (`teams`: [[qid, country]]), by the computed
 * national-team seasons' resolver and the manifest's names; a team whose country has no shape, or whose shape the year
 * merges into another or leaves out, has none. → Map(qid → nation id)
 */
export function teamNations(teams, year, names, federations = FOOTBALL_FEDERATIONS) {
  const resolve = dayNationResolver(nationResolver(names.nations), federations, year);
  const { merged, inactive } = territoryFor(federations, year);
  const out = new Map();
  for (const [qid, country] of teams) {
    const nation = resolve(country);
    if (nation == null || nation === NO_TEAM || Object.hasOwn(merged, nation) || inactive.includes(nation)) continue;
    out.set(qid, nation);
  }
  return out;
}

/**
 * The level of the season's line at its best Elo: the median, over the nations whose own EA players make a full natural
 * XI (`points`: [{ strength, elo }], strength the XI's mean), of strength + perHundredElo × (E_best − E) / 100. With the
 * computed seasons' slope, this puts the line where the season's own full XIs sit.
 */
export function lineLevel(points, bestElo, perHundredElo) {
  return median(points.map(({ strength, elo }) => strength + perHundredElo * (bestElo - elo) / 100));
}

/** A nation's target strength: the line's level less perHundredElo for every 100 Elo below the season's best. */
export const fillTarget = (elo, bestElo, level, perHundredElo) => level - perHundredElo * (bestElo - elo) / 100;

/**
 * The deviations `m` added players take: the XI profile (the computed seasons' D, strongest first) read at m evenly
 * spaced places of the eleven, by straight lines between them, less their mean. Eleven take D itself (less its mean, a
 * hundredth); one takes 0.
 */
export function profileOf(m, profile) {
  if (!Number.isInteger(m) || m < 1 || m > profile.length) throw new Error(`Cannot spread ${m} players over a profile of ${profile.length}`);
  const n = profile.length;
  const at = place => {
    const lo = Math.min(n, Math.max(1, Math.floor(place))), hi = Math.min(n, lo + 1), f = place - lo;
    return profile[lo - 1] * (1 - f) + profile[hi - 1] * f;
  };
  const raw = Array.from({ length: m }, (_, j) => at((j + 0.5) * n / m + 0.5));
  const mean = raw.reduce((sum, d) => sum + d, 0) / m;
  return raw.map(d => d - mean);
}

/**
 * The sum of m added players' ratings: the one that brings an XI of `size` whose EA players sum to `eaSum` to
 * round(size × T), but never further from m × T than the profile reaches (their mean within T + min D … T + max D), so
 * the added players are rated as members of an XI at T, not as a correction of how EA rated the rest of it.
 * → `{ sum, held }` (held: −1 or 1 where the range stopped it, else 0)
 */
export function addedSum(m, eaSum, size, T, profile) {
  const wanted = Math.round(size * T) - eaSum;
  const lo = Math.ceil(m * (T + Math.min(...profile))), hi = Math.floor(m * (T + Math.max(...profile)));
  return wanted < lo ? { sum: lo, held: -1 } : wanted > hi ? { sum: hi, held: 1 } : { sum: wanted, held: 0 };
}

/** Where one added player's rating may lie: where an XI member at T can, T + min D to T + max D, within 1–99. */
export const playerRange = (T, profile) => [Math.max(1, Math.ceil(T + Math.min(...profile))), Math.min(99, Math.floor(T + Math.max(...profile)))];

/**
 * Whole ratings that sum to `sum`, around their mean by `deviations` (which sum to zero): each rounded down, then the
 * largest fractions (the earlier first on a tie) up, so the order never inverts; then each held to `[lo, hi]`.
 */
export function spreadRatings(sum, deviations, [lo, hi]) {
  const mean = sum / deviations.length;
  const exact = deviations.map(d => mean + d);
  const ratings = exact.map(Math.floor);
  const up = sum - ratings.reduce((total, r) => total + r, 0);
  const order = exact.map((x, k) => [x - ratings[k], k]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (const [, k] of order.slice(0, up)) ratings[k]++;
  return ratings.map(r => Math.min(hi, Math.max(lo, r)));
}

/**
 * The EA players of an edition indexed for samePersonIn: by birth date and by each name word of three letters or more.
 * `players` are eaPlayersOf's.
 */
export function personIndex(players) {
  const byDob = new Map(), byWord = new Map();
  const add = (map, key, player) => (map.get(key) || map.set(key, []).get(key)).push(player);
  for (const player of players) {
    const { dateOfBirth, fullName } = player.sourceInfo;
    if (dateOfBirth) add(byDob, dateOfBirth, player);
    for (const word of new Set([...nameWords(player.name), ...nameWords(fullName)])) if (word.length >= 3) add(byWord, word, player);
  }
  return { byDob, byWord };
}

/**
 * The EA player who is this Wikidata player (`{ name, born }`, of `nation`), or null: one born the same day whose name
 * shares a word with his, or one whose short or full name agrees with his (namesAgree) and who plays for the same nation
 * or was born the same year. EA's birth dates are not always right (FIFA 05 and 06 have many wrong ones), so a name of the
 * same nation is enough.
 */
export function samePersonIn(index, { name, born }, nation) {
  const words = nameWords(name);
  const namesOf = player => [player.name, player.sourceInfo.fullName];
  if (born) {
    for (const player of index.byDob.get(born) || []) {
      if (namesOf(player).some(other => nameWords(other).some(a => a.length >= 3 && words.some(b => wordsAgree(a, b))))) return player;
    }
  }
  const seen = new Set();
  for (const word of words.filter(w => w.length >= 3)) {
    for (const player of index.byWord.get(word) || []) {
      if (seen.has(player)) continue;
      seen.add(player);
      if (!namesOf(player).some(other => namesAgree(other, name))) continue;
      const year = player.sourceInfo.dateOfBirth?.slice(0, 4);
      if (player.nationId === nation || (born && year === born.slice(0, 4))) return player;
    }
  }
  return null;
}

/** Candidates strongest claim first: caps a year in the window (the figure), then caps for the nation by the season's end, then the lower id. */
const byFigure = (a, b) => b.figure - a.figure || b.total - a.total || qidNumber(a.qid) - qidNumber(b.qid);

/**
 * One nation's XI, filled. `pool` is the nation's EA players (eaPlayersOf's), `squad` pickFootballSquad's pick of them,
 * `candidates` its Wikidata pool for the season (seasonPools' entries) less anyone EA rates, and `rate(m, eaSum, size)`
 * gives the ratings of m added players, strongest first, for an XI of `size` whose EA players' ratings sum to eaSum.
 * EA's natural part stays; each role it leaves short takes the candidates of that position, the strongest claim first;
 * a place still empty keeps EA's own player out of position (as the unfilled squad has him), and only then takes a
 * candidate out of position. → `{ ea: [EA players kept], added: [{ ...candidate, role, rating }], droppedEa: [EA players
 * left out] }`, or null when no candidate is added.
 */
export function fillEleven({ pool, squad, candidates, rate }) {
  const natural = naturalFootballRoles(pool);
  const short = Object.fromEntries(ROLES.map(role => [role, { GK: 1, DF: 4, MF: 4, FW: 2 }[role] - natural.roles.filter(r => r === role).length]));
  const ordered = candidates.slice().sort(byFigure);
  const taken = new Set(), added = [];
  for (const role of ROLES) {
    for (const candidate of ordered) {
      if (short[role] <= 0) break;
      if (taken.has(candidate.qid) || !candidate.positions.includes(role)) continue;
      taken.add(candidate.qid);
      added.push({ ...candidate, role });
      short[role]--;
    }
  }
  if (!added.length) return null;
  const left = ROLES.flatMap(role => Array(Math.max(0, short[role])).fill(role));
  const topUps = squad.filter(player => !natural.squad.includes(player));
  const keptTopUps = topUps.slice(0, left.length);
  const rest = left.slice(keptTopUps.length);
  for (const candidate of ordered) {
    if (!rest.length) break;
    if (taken.has(candidate.qid)) continue;
    taken.add(candidate.qid);
    added.push({ ...candidate, role: rest.shift() });
  }
  const ea = [...natural.squad, ...keptTopUps];
  const size = ea.length + added.length;
  const ratings = rate(added.length, ea.reduce((sum, player) => sum + player.rating, 0), size);
  const strongestFirst = added.slice().sort(byFigure);
  return {
    ea,
    added: strongestFirst.map((candidate, k) => ({ ...candidate, rating: ratings[k] })),
    droppedEa: topUps.slice(keptTopUps.length),
  };
}

/**
 * A computed player as an EA season writes him: `[name, position, rating, source]`, his position the role he fills then
 * his other positions, his source naming him (`wd:Q…`), the season, his team, its Elo and day, and his stint.
 */
export function filledPlayer(player, { edition, eloDate, teamElo, country, name = player.name }) {
  return [name, listedPosition(player), player.rating, {
    id: `wd:${player.qid}`, source: FILL_SOURCE, edition, league: FILL_LEAGUE, snapshotDate: eloDate,
    url: player.title ? `https://en.wikipedia.org/wiki/${encodeURIComponent(player.title.replace(/ /g, '_'))}` : `https://www.wikidata.org/wiki/${player.qid}`,
    team: country, teamElo,
    ...(player.caps != null ? { caps: player.caps } : {}), ...(player.goals != null ? { goals: player.goals } : {}),
    from: player.from, to: player.to, ...(player.ended ? { toEstimated: true } : {}),
    ...(player.born ? { dateOfBirth: player.born } : {}),
  }];
}

/** The rule as a season's source names it. */
export function fillConversion(manifest, { eloDate, best, level, levels }) {
  const plus = x => (x > 0 ? `+${x.toFixed(1)}` : x === 0 ? '0.0' : `−${(-x).toFixed(1)}`);
  return `T = L − ${manifest.strength.perHundredElo} × (E′_best − E′) / 100, E′ = E + the level of the nation's confederation: E its Elo on ${eloDate}, `
    + `the levels ${levelsText(levels)}, one step ahead, E′_best the best E′ of the teams active in the four years before (${best.team}, ${best.elo}) `
    + `and L = ${level.toFixed(2)}, the median over this season's full EA XIs of their mean + ${manifest.strength.perHundredElo} × (E′_best − E′) / 100; `
    + 'each place EA\'s players leave empty in a fielded nation\'s '
    + 'natural XI taken by a player of that position whose Wikidata stint for the nation covers the season\'s year or the year before, '
    + 'the most caps a year first; the m added players rated so the XI sums to round(11 × T), ordered by caps, each R + d_j, '
    + `d the profile D = ${manifest.profile.map(plus).join(', ')} read at m evenly spaced places and centred, their mean R and `
    + 'each rating held within T + min D and T + max D, where a member of an XI at T can be';
}

/**
 * The fill of one EA season. `nations` maps each nation the season lists to `{ pool, squad }` (its EA players and
 * pickFootballSquad's pick); `players` are every EA player of the edition (eaPlayersOf's), so nobody EA rates is added
 * again; `fill` is `{ year, season, elo: { date, best, ratings }, wikidata: { teams, players, stints }, manifest }`.
 * A nation is filled when it fields a side as the game decides (its EA players hold at least half the lineup), has an
 * Elo, and is short of a natural XI. → `{ squads: Map(nation → players for the file, strongest first), source, audit }`.
 */
export function fillSeason({ nations, players, fill, federations = FOOTBALL_FEDERATIONS }) {
  const { year, season, elo, wikidata, manifest } = fill;
  const { perHundredElo } = manifest.strength;
  // A nation's Elo with its confederation's level (scripts/lib/confederation-levels.mjs): E′ = E + the level, which the line reads.
  const eloOf = new Map(elo.ratings.map(([team, value, rank, confederation]) => {
    const level = levelOf(elo.levels, confederation);
    return [team, { value, rank, confederation, level, levelled: level == null ? null : levelled(value, level) }];
  }));
  const nationElo = nation => {
    const found = eloOf.get(RESULTS_NAMES[nation]) ?? null;
    if (found && found.level == null) throw new Error(`${season}: ${RESULTS_NAMES[nation]} has an Elo but no confederation`);
    return found;
  };
  const lineupOf = squad => selectLineup({ sport: 'football', squad });
  const fields = squad => lineupOf(squad).slots.filter(slot => slot.player).length * 2 >= XI;
  const fullXI = squad => squad.length === XI && lineupOf(squad).slots.every(slot => slot.player && !slot.outOfPosition);

  const { merged, inactive } = territoryFor(federations, year);
  const fielded = Object.entries(nations).filter(([nation, { squad }]) => !Object.hasOwn(merged, nation) && !inactive.includes(nation)
    && squad.length && fields(squad));
  const points = fielded.filter(([nation, { squad }]) => fullXI(squad) && nationElo(nation))
    .map(([nation, { squad }]) => ({ strength: squad.reduce((sum, p) => sum + p.rating, 0) / XI, elo: nationElo(nation).levelled }));
  const level = lineLevel(points, elo.levelledBest.elo, perHundredElo);

  const teamNation = teamNations(wikidata.teams, year, manifest.names, federations);
  // The national-team seasons' ages: a stint whose player would be under 14 or over 45 when the season starts names the wrong
  // person or the wrong years (the roster audit's age-impossible).
  const pools = seasonPools(wikidata, year, team => teamNation.get(team) ?? null, { ages: manifest.selection.ages });
  const countryOf = new Map(wikidata.teams);
  const index = personIndex(players);
  const edition = `${season} national team, computed`;
  const squads = new Map(), audit = [];
  for (const [nation, { pool, squad }] of fielded) {
    if (fullXI(squad)) continue;
    const before = lineupOf(squad).rating;
    const row = { id: nation, name: NATIONS[nation][0], ea: squad.length, before };
    const teamElo = nationElo(nation);
    if (!teamElo) { audit.push({ ...row, why: 'no Elo' }); continue; }
    const T = fillTarget(teamElo.levelled, elo.levelledBest.elo, level, perHundredElo);
    let sameAsEa = 0; // candidates who are EA players already
    const candidates = (pools.get(nation) || []).filter(candidate => {
      if (candidate.caps === 0) return false;
      const ea = samePersonIn(index, candidate, nation);
      if (ea) sameAsEa++;
      return !ea;
    });
    let held = 0;
    const rate = (m, eaSum, size) => {
      const added = addedSum(m, eaSum, size, T, manifest.profile);
      held = added.held;
      return spreadRatings(added.sum, profileOf(m, manifest.profile), playerRange(T, manifest.profile));
    };
    const filled = fillEleven({ pool, squad, candidates, rate });
    const levelRow = { confederation: teamElo.confederation, level: teamElo.level, levelled: teamElo.levelled };
    if (!filled) { audit.push({ ...row, elo: teamElo.value, ...levelRow, T: round2(T), why: `no candidate for the ${XI - naturalFootballRoles(pool).squad.length} places`, sameAsEa }); continue; }
    const used = new Set(filled.ea.map(player => player.name));
    const records = filled.added.map(player => {
      const shared = used.has(player.name) || filled.added.filter(other => other.name === player.name).length > 1;
      used.add(player.name);
      // Namesakes in one XI carry their birth year, as the computed seasons' do; one with no birth date keeps his name.
      const name = shared && player.born ? `${player.name} (${player.born.slice(0, 4)})` : player.name;
      return filledPlayer(player, { edition, eloDate: elo.date, teamElo: teamElo.value, country: countryOf.get(player.team), name });
    });
    const file = [...filled.ea.map(player => ({ rating: player.rating, id: player.sourceInfo.id, row: player.tuple, player })),
      ...records.map(record => ({ rating: record[2], id: record[3].id, row: record, player: { name: record[0], pos: record[1].split('/')[0],
        positions: record[1].split('/'), rating: record[2] } }))]
      .sort((a, b) => b.rating - a.rating || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const after = lineupOf(file.map(entry => entry.player));
    squads.set(nation, { players: file.map(entry => entry.row), strength: after.rating, added: records.length });
    audit.push({
      ...row, elo: teamElo.value, rank: teamElo.rank, ...levelRow, T: round2(T), after: after.rating, kept: filled.ea.length,
      ...(held ? { held: held < 0 ? 'up to T + min D' : 'down to T + max D' } : {}),
      added: filled.added.map((player, k) => `${records[k][0]} ${records[k][1]} ${player.rating} ${player.caps ?? '?'} caps ${player.from}–${player.to}${player.ended ? '*' : ''} (${round2(player.figure)})`),
      ...(filled.droppedEa.length ? { droppedEa: filled.droppedEa.map(player => `${player.name} ${player.positions.join('/')} ${player.rating}`) } : {}),
      outOfPosition: after.slots.filter(slot => slot.outOfPosition).map(slot => `${slot.player.name} (${slot.player.pos} as ${slot.position})`),
      ...(after.slots.some(slot => !slot.player) ? { empty: after.slots.filter(slot => !slot.player).map(slot => slot.position) } : {}),
      sameAsEa,
    });
  }
  const source = {
    method: 'computed', computed: true, rawScale: 'Elo', snapshotDate: elo.date, retrieved: manifest.retrieved,
    conversion: fillConversion(manifest, { eloDate: elo.date, best: elo.levelledBest, level, levels: elo.levels }),
    players: { name: 'Wikidata', endpoint: manifest.sources.wikidata.endpoint, licence: manifest.sources.wikidata.licence,
      files: Object.fromEntries(manifest.sources.wikidata.files.map(file => [file.name, file.sha256])) },
    results: { name: manifest.sources.results.name, commit: manifest.sources.results.commit, licence: manifest.sources.results.licence },
  };
  return { squads, source, audit: { level: round2(level), fullXIs: points.length, best: elo.best, levels: elo.levels, levelledBest: elo.levelledBest, nations: audit } };
}
