// The facts the computed national-team seasons are built from (docs/design/football-years.md, "Computed national-team
// seasons"): Wikidata's records of the men's national teams (QLever's answers to the manifest's queries: the teams, the
// stints of their players with start, end, caps and goals, the players' names, births, English Wikipedia articles and
// positions), martj42's results through the Elo engine (scripts/lib/football-elo.mjs), and Wikipedia's Ballon d'Or
// voting tables (scripts/lib/world-cup-facts.mjs ballonDorVotes). Pure: scripts/sync-national-team-seasons.mjs reads the
// pinned files and writes the committed facts (scripts/data/national-team-seasons/), which
// scripts/build-national-team-seasons.mjs turns into the seasons.

import { yearsBefore } from './football-elo.mjs';

const ENTITY = /^http:\/\/www\.wikidata\.org\/entity\/(Q\d+)$/;
const DAY = /^(\d{4})-(\d{2})-(\d{2})T00:00:00Z$/;
const ENWIKI = /^https:\/\/en\.wikipedia\.org\/wiki\/(\S+)$/;
const RANK = 'http://wikiba.se/ontology#';
const DEPRECATED = `${RANK}DeprecatedRank`, NORMAL = `${RANK}NormalRank`, PREFERRED = `${RANK}PreferredRank`;

/** A SPARQL JSON answer's rows as `{ variable: value }`, every variable it declares present (null when unbound). */
export function sparqlRows(answer) {
  const vars = answer?.head?.vars;
  const bindings = answer?.results?.bindings;
  if (!Array.isArray(vars) || !Array.isArray(bindings)) throw new Error('Not a SPARQL JSON answer');
  return bindings.map(row => Object.fromEntries(vars.map(name => [name, row[name]?.value ?? null])));
}

/** 'http://www.wikidata.org/entity/Q123' → 'Q123'; anything else throws. */
export function entityId(uri) {
  const m = ENTITY.exec(String(uri));
  if (!m) throw new Error(`${uri} is not a Wikidata entity`);
  return m[1];
}

/** A Wikidata time at day precision or coarser ('1961-01-01T00:00:00Z') → its year, or null. */
export function yearOf(time) {
  if (time == null) return null;
  const m = DAY.exec(time);
  if (!m) throw new Error(`${time} is not a Wikidata day`);
  return Number(m[1]);
}

/** A Wikidata time → 'YYYY-MM-DD', or null for none (a year or month alone keeps its first day, as Wikidata stores it). */
export function dayOf(time) {
  if (time == null) return null;
  const m = DAY.exec(time);
  if (!m) throw new Error(`${time} is not a Wikidata day`);
  return `${m[1]}-${m[2]}-${m[3]}`;
}

/** An English Wikipedia sitelink → its title with spaces ('Gerd Müller'), or null. */
export function articleTitle(url) {
  if (url == null) return null;
  const m = ENWIKI.exec(url);
  if (!m) throw new Error(`${url} is not an English Wikipedia article`);
  return decodeURIComponent(m[1]).replace(/_/g, ' ').normalize('NFC');
}

// Wikidata's "unknown value" (somevalue) comes back as a blank node: a value the statement says exists but not what.
const UNKNOWN = /^http:\/\/www\.wikidata\.org\/\.well-known\/genid\/[0-9a-f]+$/;
const known = value => (value == null || UNKNOWN.test(value) ? null : value);

/** A whole number, or null for none; a fraction or a negative number throws. */
const count = (value, what) => {
  if (value == null) return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${what} ${value} is not a count`);
  return n;
};

/** The country a team's label names: 'England men's national association football team' → 'England'. */
export function teamCountry(label, names) {
  const country = String(label).replace(new RegExp(names.teamSuffix), '').replace(/^The /, '').trim();
  return names.countries[country] ?? country;
}

/**
 * The national teams' records, from QLever's four answers (sparqlRows' rows of `teams`, `stints`, `players` and
 * `positions`) and the manifest's `positions` (a position item → GK, DF, MF or FW; any other is not a football
 * position) and `names`. Keeps the stints of `years` (`[first, last]`, the seasons' calendar years) that have a start;
 * a stint Wikidata has not closed (no end: Paolo Maldini's for Italy, 1988–) ends as its caps would run out at
 * `openCapsPerYear` a year, start + ⌈caps / openCapsPerYear⌉ − 1, and is marked so; one with neither end nor caps is
 * left out, as no season can tell whether it covers it. Deprecated statements are left out. Returns `{ teams: [[qid,
 * country]], players: [[qid, name, born, title, positions]], stints: [[player, team, from, to, caps, goals, ended]],
 * audit }`, each sorted, with only the teams and players the stints name; `ended` is 0 for an end of Wikidata's, 1 for
 * one the rule gave.
 */
export function wikidataTables({ teams, stints, players, positions }, { positions: positionOf, names, years: [first, last], openCapsPerYear }) {
  if (!(openCapsPerYear > 0)) throw new Error('openCapsPerYear must be a number of caps');
  const countryOf = new Map();
  for (const row of teams) {
    const qid = entityId(row.team);
    if (countryOf.has(qid)) throw new Error(`Team ${qid} is listed twice`);
    if (!row.teamLabel) continue; // a team with no English name names no country
    if (names.ignoreTeams.includes(qid)) continue;
    countryOf.set(qid, teamCountry(row.teamLabel, names));
  }
  const audit = { multiValued: 0, deprecated: 0, noStart: 0, noEnd: 0, ended: 0, reversed: 0, noCaps: 0, conceded: 0, ignoredTeams: names.ignoreTeams.length, otherPositions: {} };
  const kept = [];
  // A statement with two values of a qualifier comes back as a row for each: one stint, from the earliest start to the
  // latest end, with the most caps and goals any of its rows gives.
  const merged = new Map();
  for (const row of stints) {
    const statement = String(row.st);
    const held = merged.get(statement);
    if (!held) { merged.set(statement, { ...row, rows: 1 }); continue; }
    if (held.player !== row.player || held.team !== row.team || held.rank !== row.rank) throw new Error(`Stint ${statement} names two players or teams`);
    const pick = (key, better) => {
      const a = known(held[key]), b = known(row[key]);
      held[key] = a == null ? row[key] : b == null ? held[key] : better(a, b) ? row[key] : held[key];
    };
    pick('start', (a, b) => b < a);
    pick('end', (a, b) => b > a);
    pick('caps', (a, b) => Number(b) > Number(a));
    pick('goals', (a, b) => Number(b) > Number(a));
    held.rows++;
  }
  audit.multiValued = [...merged.values()].filter(row => row.rows > 1).length;
  for (const row of merged.values()) {
    const team = entityId(row.team);
    if (!countryOf.has(team)) continue;
    const statement = String(row.st);
    // A deprecated statement is one Wikidata keeps only to say it is wrong.
    if (row.rank === DEPRECATED) { audit.deprecated++; continue; }
    if (![NORMAL, PREFERRED].includes(row.rank)) throw new Error(`Stint ${statement} has rank ${row.rank}`);
    const from = yearOf(known(row.start));
    if (from == null) { audit.noStart++; continue; }
    const caps = count(known(row.caps), `Caps of ${statement}`);
    const end = yearOf(known(row.end));
    if (end == null && !caps) { audit.noEnd++; continue; }
    const to = end ?? from + Math.ceil(caps / openCapsPerYear) - 1;
    if (to < from) { audit.reversed++; continue; }
    if (to < first || from > last) continue;
    if (end == null) audit.ended++;
    if (caps == null) audit.noCaps++;
    // Wikidata writes a goalkeeper's goals conceded as negative goals: not goals he scored, so none are kept.
    const conceded = known(row.goals) != null && Number(row.goals) < 0;
    if (conceded) audit.conceded++;
    const goals = conceded ? null : count(known(row.goals), `Goals of ${statement}`);
    kept.push([entityId(row.player), team, from, to, caps, goals, end == null ? 1 : 0]);
  }
  const wanted = new Set(kept.map(stint => stint[0]));
  const roles = new Map();
  for (const row of positions) {
    const player = entityId(row.player);
    if (!wanted.has(player)) continue;
    const item = entityId(row.position);
    const role = positionOf[item];
    if (!role) { audit.otherPositions[item] = (audit.otherPositions[item] || 0) + 1; continue; }
    if (!roles.has(player)) roles.set(player, new Set());
    roles.get(player).add(role);
  }
  const ORDER = ['GK', 'DF', 'MF', 'FW'];
  const people = [];
  const named = new Set();
  for (const row of players) {
    const qid = entityId(row.player);
    if (!wanted.has(qid)) continue;
    if (named.has(qid)) throw new Error(`Player ${qid} is listed twice`);
    named.add(qid);
    const name = (row.label ?? row.mulLabel ?? '').trim();
    people.push([qid, name || null, dayOf(known(row.birth)), articleTitle(row.enwiki), ORDER.filter(role => roles.get(qid)?.has(role))]);
  }
  for (const qid of wanted) if (!named.has(qid)) throw new Error(`Player ${qid} has a stint but no record`);
  const byId = (a, b) => Number(a[0].slice(1)) - Number(b[0].slice(1));
  const used = new Set(kept.map(stint => stint[1]));
  return {
    teams: [...countryOf].filter(([qid]) => used.has(qid)).sort(byId),
    players: people.sort(byId),
    stints: kept.sort((a, b) => byId(a, b) || Number(a[1].slice(1)) - Number(b[1].slice(1)) || a[2] - b[2] || a[3] - b[3]),
    audit,
  };
}

const round1 = x => Math.round(x * 10) / 10;

/**
 * One season's Elo facts from eloOn's `snapshot` on `date`: every team that played in the `activeYears` before it, its
 * Elo (to a tenth) and rank, the best of them first. → `{ date, activeSince, best: { team, elo }, ratings: [[team, elo,
 * rank]] }`.
 */
export function seasonElo(snapshot, date, activeYears) {
  if (!snapshot) throw new Error(`No Elo on ${date}`);
  const since = yearsBefore(date, activeYears);
  const active = [...snapshot.ratings].filter(([team]) => snapshot.last.get(team) >= since)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  if (!active.length) throw new Error(`No team played from ${since} to ${date}`);
  return { date, activeSince: since, best: { team: active[0][0], elo: round1(active[0][1]) },
    ratings: active.map(([team, elo], i) => [team, round1(elo), i + 1]) };
}

const fold = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * A year's Ballon d'Or votes (ballonDorVotes' rows) matched to the Wikidata players: by the vote's article (the
 * player's English Wikipedia sitelink), else by one of the manifest's `pinned` votes (a vote whose link is a redirect
 * to the player's article, checked by hand: `{ vote, nationality, qid, name }`, `name` his Wikidata name), else by the
 * name, folded, of a player of the vote's nationality's team with a stint in that year (one such player only), else
 * unmatched. `nationalities` maps the table's nationality to the team's country. → `{ points: [[qid, points]],
 * unmatched: [[name, nationality, points]], pinned: [vote] }`, each sorted; `pinned` the pins used.
 */
export function ballonDorPoints(votes, { year, players, stints, teams, nationalities = {}, pinned = [] }) {
  const byTitle = new Map();
  for (const [qid, , , title] of players) if (title) byTitle.set(title, qid);
  const countryOf = new Map(teams);
  const nameOf = new Map(players.map(([qid, name]) => [qid, name]));
  const points = new Map(), unmatched = [], used = new Set();
  for (const vote of votes) {
    let qid = vote.title ? byTitle.get(vote.title) : undefined;
    const pin = qid ? null : pinned.find(p => p.vote === vote.name && p.nationality === vote.nationality);
    if (pin) {
      if (nameOf.get(pin.qid) !== pin.name) throw new Error(`The pinned vote ${pin.vote} names ${pin.qid}, whom Wikidata calls ${nameOf.get(pin.qid)}, not ${pin.name}`);
      qid = pin.qid;
      used.add(pin.vote);
    }
    if (!qid) {
      const country = nationalities[vote.nationality] ?? vote.nationality;
      const candidates = [...new Set(stints.filter(([, team, from, to]) => countryOf.get(team) === country && from <= year && year <= to)
        .map(([player]) => player))].filter(player => fold(nameOf.get(player) ?? '') === fold(vote.name));
      if (candidates.length === 1) [qid] = candidates;
    }
    if (!qid) { unmatched.push([vote.name, vote.nationality, vote.points]); continue; }
    points.set(qid, (points.get(qid) || 0) + vote.points);
  }
  return {
    points: [...points].sort((a, b) => b[1] - a[1] || Number(a[0].slice(1)) - Number(b[0].slice(1))),
    unmatched: unmatched.sort((a, b) => b[2] - a[2] || (a[0] < b[0] ? -1 : 1)),
    pinned: [...used].sort(),
  };
}
