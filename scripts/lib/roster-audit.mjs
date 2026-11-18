// The roster audit (docs/design/roster-audit.md): every season of every sport the game offers, its built-in one and
// each built-in earlier season (BUILT_IN_SETS), read the way a campaign reads it. A season file is decoded and validated
// by the loader (src/engine/footballSets.js), bound to its sport (seasonSport), and each nation and club is built as
// play builds it (teams.js buildTeam, buildClub) and fielded by the game's own lineup picker (selectLineup). The checks
// then look at what the loader's structural validation does not: names a player's source spelled wrong in transit,
// dates of birth that cannot be the season's player, the same player twice, lineups the squad cannot fill, a team's
// stored strength against the lineup it plays, and one person spelled or rated two ways in one season.
//
// No I/O but reading the season files: scripts/audit-rosters.mjs prints and writes the report, and
// scripts/roster-audit.test.mjs runs it in `npm test`. An `error` is a defect the data must not ship with (the test
// fails on any); a `warning` is a fact to know (a source's own gap, a namesake), reported with counts and examples.
import { readFileSync } from 'node:fs';
import {
  BUILT_IN_SETS, builtInSeasonOf, decodeFootballSet, fieldedNations, seasonSport, setHasClubs, setHasNations, setSportOf,
} from '../../src/engine/footballSets.js';
import { SPORT_LIST } from '../../src/sports/index.js';
import { buildClub, buildTeam, hashStr, makeRng, selectLineup } from '../../src/data/teams.js';

/** Ages (years when the season starts) no player of the season can have, and ages worth a look. */
export const AGE_IMPOSSIBLE = Object.freeze({ under: 14, over: 45 });
export const AGE_UNUSUAL = Object.freeze({ under: 16, over: 40 });

/**
 * The checks, by id: `error`s must be absent from every season; `warning`s are counted and shown. `about` is the
 * report's description of each.
 */
export const CHECKS = Object.freeze({
  'name-corrupt': { severity: 'error', about: 'a name with a control character, a replacement character, mojibake (UTF-8 read as Latin-1), an HTML entity, a question mark, or a digit outside a birth-year tag such as "Sebastian Aho (1997)" (an esport\'s gamer tags may hold digits): text damaged on its way from the source' },
  'name-spacing': { severity: 'error', about: 'a name with leading, trailing or doubled whitespace, or whitespace other than a plain space' },
  'rating-range': { severity: 'error', about: 'a rating that is not a whole number from 1 to 99' },
  'player-repeated': { severity: 'error', about: 'one player (by source id) twice in one squad' },
  'age-impossible': { severity: 'error', about: `a date of birth that makes a player younger than ${AGE_IMPOSSIBLE.under} or older than ${AGE_IMPOSSIBLE.over} when the season starts: the record names the wrong person, or the wrong years` },
  'name-scripts-glued': { severity: 'error', about: 'a name or full name in which a Latin letter runs straight into a letter of another script ("Vitaliy BuyalskyiБуяльський"): two spellings of one name glued together on the way from the source' },
  'player-in-two-teams': { severity: 'error', about: 'one player (by source id) in two nations, or in two clubs, of one season' },
  'age-unusual': { severity: 'warning', about: `a player younger than ${AGE_UNUSUAL.under} or older than ${AGE_UNUSUAL.over} when the season starts` },
  'name-unusual': { severity: 'warning', about: 'a name with punctuation other than hyphens, apostrophes and full stops: a birth-year tag telling namesakes apart, or a source\'s quotes or brackets (an esport\'s gamer tags are not checked)' },
  'namesakes-in-team': { severity: 'warning', about: 'two players of one name in one squad (real namesakes; the match shows both alike)' },
  'spelling-variant': { severity: 'warning', about: 'one player spelled two ways in one season, with and without diacritics (the same rating and folded name in two squads)' },
  'rating-conflict': { severity: 'warning', about: 'a name in a national squad and a club of one season at different ratings, with no record of the club layer at the national rating: one player rated twice, or two namesakes' },
  'lineup-gap': { severity: 'warning', about: 'a team the game fields whose lineup has an empty place or a player out of position in goal: its source rates too few of its players' },
  'strength-mismatch': { severity: 'warning', about: 'a team whose stored strength differs by more than one point from the lineup the game fields from its squad' },
  'birth-date-disagreement': { severity: 'warning', about: 'a player (by an id that names one person in every season: EA\'s, Wikidata\'s) born here more than a month from the date most seasons give: one of the source\'s editions has it wrong' },
  'rating-jump': { severity: 'warning', about: 'a player (by EA id) rated 15 or more points apart in editions a year apart: a breakthrough, a fall, or a record joined to the wrong person' },
});

/** The rating change between editions a year apart that `rating-jump` reports. */
export const RATING_JUMP = 15;
/** How far apart two dates of birth of one person may be before `birth-date-disagreement` reports them. */
export const BIRTH_DATE_SLACK_DAYS = 31;
// Source ids that name one person in every season (EA's, Wikidata's). Championship Manager's and SWOS's number one
// database's rows: cm:59011 is David Weir in one and Gennady Tumilovich in another.
const PERSON_ID = /^(?:ea|wd):/;
// Two spellings of a name glued together: a Latin letter against a letter of another script, with no space between.
const GLUED = /\p{Script=Latin}[\p{L}--\p{Script=Latin}]|[\p{L}--\p{Script=Latin}]\p{Script=Latin}/v;

// A disambiguating tag the builders add to namesakes: a birth year or date ("Petr Sykora (1976)",
// "Steve Smith (1963-04-30)"), or SWOS's own "(i)"/"(ii)".
const TAG = /\s?\((?:\d{4}(?:-\d{2}-\d{2})?|i{1,3})\)$/;
// UTF-8 bytes read as Latin-1 or Windows-1252: "Ã©" for "é", "â€™" for "’", "Ã" before a continuation byte.
const MOJIBAKE = /\u00C3[\u0080-\u00BF\u2018-\u203A]|\u00C2[\u0080-\u00BF]|\u00E2\u20AC|\u00C4[\u0080-\u00BF]|\u00C5[\u0080-\u00BF]|\u00D0[\u0080-\u00BF]|\u00D1[\u0080-\u00BF]/;
const ENTITY = /&(?:[a-z]+|#\d+|#x[0-9a-f]+);/i;
const CONTROL = /[\p{Cc}\p{Cf}\u2028\u2029\uFFFD]/u;
const PLAIN = /^[\p{L}\p{M}' \u2019\u02BC.\-]+$/u;

// Sports whose players go by gamer tags, as Liquipedia, vlr.gg and gol.gg spell them ("M0nkey M00n", "Q_U_I_E_T_",
// "bjdn!", "s1mple", "Jamelinho213"): a digit or other punctuation is the player's own, so only the damage no tag carries
// on purpose is looked for.
export const HANDLES = new Set(['rocket-league', 'counter-strike', 'valorant', 'league-of-legends']);

/**
 * Why a name is damaged, or null: corruption signatures that no source spells on purpose. `handle`: the name is a gamer
 * tag (HANDLES), whose digits are its own.
 */
export function nameCorruption(name, { handle = false } = {}) {
  const text = String(name);
  if (CONTROL.test(text)) return 'a control or replacement character';
  if (MOJIBAKE.test(text)) return 'mojibake';
  if (ENTITY.test(text)) return 'an HTML entity';
  const untagged = text.replace(TAG, '');
  if (/\?/.test(untagged)) return 'a question mark';
  if (!handle && /\d/.test(untagged)) return 'a digit';
  return null;
}

/** Why a name's spacing is wrong, or null. */
export function nameSpacing(name) {
  const text = String(name);
  if (text !== text.trim()) return 'leading or trailing whitespace';
  if (/[^\S ]/.test(text)) return 'whitespace other than a space';
  if (/ {2}/.test(text)) return 'a doubled space';
  return null;
}

/** A name folded for comparison: no diacritics, case or punctuation ("Nikola Jokić" → "nikolajokic"). */
export const foldName = name => String(name).normalize('NFD').replace(/\p{M}/gu, '').replace(/[øØ]/g, 'o').replace(/[łŁ]/g, 'l')
  .replace(/[đĐ]/g, 'd').replace(/ß/g, 'ss').replace(/[æÆ]/g, 'ae').replace(/ı/g, 'i').toLowerCase().replace(/[^a-z]/g, '');

/**
 * The day a season starts, for ages: 1 July of its first year for a winter's season ('2025/26'), 1 January for a
 * calendar year's ('2025').
 */
export const seasonStart = ({ year, season }) => (String(season).includes('/') ? Date.UTC(year - 1, 6, 1) : Date.UTC(year, 0, 1));

/**
 * Completed years on `day` (ms, UTC) of a 'YYYY-MM-DD' birth date, or null: a birthday counts on the day itself, as the
 * builders' cut-offs do (src/data/footballSetBuild.js MIN_PLAYING_AGE, scripts/lib/national-team-seasons.mjs).
 */
export function ageOn(dateOfBirth, day) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateOfBirth ?? '');
  if (!m) return null;
  const on = new Date(day), [year, month, date] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const birthdayPassed = on.getUTCMonth() + 1 > month || (on.getUTCMonth() + 1 === month && on.getUTCDate() >= date);
  return on.getUTCFullYear() - year - (birthdayPassed ? 0 : 1);
}

/**
 * Every season the game offers: each sport's built-in one (`builtin:<sport>`), then each built-in earlier season, its
 * file read from `root`/public/<sport>/<id>.json and decoded by the loader. → [{ id, sportId, year, season, label, sport,
 * nations, clubs }]: `sport` is the sport bound to the season; `nations`/`clubs` whether it plays that layer.
 */
export function loadSeasons(root, { sports = null } = {}) {
  const wanted = id => !sports || sports.includes(id);
  const out = [];
  for (const sport of SPORT_LIST) {
    if (!wanted(sport.id)) continue;
    const { year, season } = builtInSeasonOf(sport.id);
    out.push({ id: `builtin:${sport.id}`, sportId: sport.id, year, season, label: 'built-in', sport, nations: true, clubs: true });
  }
  for (const set of BUILT_IN_SETS) {
    const sportId = setSportOf(set.id);
    if (!wanted(sportId)) continue;
    const data = JSON.parse(readFileSync(new URL(`public/${sportId}/${set.id}.json`, root), 'utf8'));
    out.push({ id: set.id, sportId, year: set.year, season: set.season, label: set.label, sport: seasonSport(decodeFootballSet(data, set.id)),
      nations: setHasNations(set.id), clubs: setHasClubs(set.id) });
  }
  return out;
}

const playerOf = (player, index, starters) => ({ name: player.name, pos: player.pos, positions: player.positions ?? null, rating: player.rating,
  info: player.sourceInfo ?? null, starter: starters.has(index) });

/**
 * A season's teams as play builds them: every nation with players (when the season plays nations) and every club (when
 * it plays clubs). → [{ kind, id, name, str, fielded, lineup: { rating, empty, outOfPosition }, players }], `players` the
 * squad's own rated players (no generated one), `fielded` whether the nation takes the field (clubs always do).
 */
export function seasonTeams(season) {
  const { sport } = season;
  const teams = [];
  const lineupOf = team => {
    const lineup = selectLineup(team);
    return { lineup, starters: new Set(lineup.starters.filter(p => !p.gen).map(p => p.originalIndex)) };
  };
  const summary = lineup => ({ rating: lineup.rating, empty: lineup.slots.filter(slot => !slot.player).map(slot => slot.position),
    outOfPosition: lineup.slots.filter(slot => slot.outOfPosition).map(slot => ({ name: slot.player.name, position: slot.position, gen: !!slot.player.gen })) });
  if (season.nations && sport.rosters) {
    const fielded = new Set(fieldedNations(sport));
    for (const id of Object.keys(sport.rosters)) {
      if (!sport.rosters[id]?.[2]?.length) continue;
      const team = buildTeam(id, makeRng(hashStr(`roster audit ${id}`)), sport);
      if (!team) continue;
      const { lineup, starters } = lineupOf(team);
      // A generated player is the game's, not the data's: `players` holds the nation's own.
      teams.push({ kind: 'nation', id, name: team.name, str: team.str, fielded: fielded.has(id), lineup: summary(lineup),
        players: team.squad.map((player, i) => (player.gen ? null : playerOf(player, i, starters))).filter(Boolean) });
    }
  }
  if (season.clubs) {
    for (const club of sport.clubs || []) {
      const team = buildClub(club, sport);
      const { lineup, starters } = lineupOf(team);
      teams.push({ kind: 'club', id: club.id, name: club.name, str: club.str, fielded: true, lineup: summary(lineup),
        players: team.squad.map((player, i) => playerOf(player, i, starters)) });
    }
  }
  return teams;
}

// Sports that fill a nation's missing places with generated players (teams.js buildTeam): their stored strength
// follows their builder's rule for their own players, which the filled lineup does not reproduce.
const FILLED = new Set(['baseball', 'hockey', 'rugby-league', 'rugby-union']);
const KEEPER = { football: 'GK', 'womens-football': 'GK', hockey: 'G' };

/**
 * One season's findings: `[{ check, season, team?, player?, detail }]` (`team` a "kind:name", `player` a name).
 * `teams` is seasonTeams(season).
 */
export function auditSeason(season, teams = seasonTeams(season)) {
  const findings = [];
  const add = (check, team, player, detail) => findings.push({ check, season: season.id, ...(team ? { team: `${team.kind}:${team.name}` } : {}),
    ...(player != null ? { player } : {}), detail });
  const start = seasonStart(season), handle = HANDLES.has(season.sportId);
  for (const team of teams) {
    const ids = new Map(), names = new Map();
    for (const p of team.players) {
      const corrupt = nameCorruption(p.name, { handle });
      if (corrupt) add('name-corrupt', team, p.name, `${JSON.stringify(p.name)} has ${corrupt}`);
      const spacing = nameSpacing(p.name);
      if (spacing) add('name-spacing', team, p.name, `${JSON.stringify(p.name)} has ${spacing}`);
      if (!corrupt && !handle && !PLAIN.test(p.name)) add('name-unusual', team, p.name, JSON.stringify(p.name));
      // A gamer tag is its player's own spelling; a full name never is two.
      const glued = [handle ? null : p.name, p.info?.fullName].find(text => text && GLUED.test(text));
      if (glued) add('name-scripts-glued', team, p.name, `${JSON.stringify(glued)} glues two scripts together`);
      if (!Number.isInteger(p.rating) || p.rating < 1 || p.rating > 99) add('rating-range', team, p.name, `rating ${JSON.stringify(p.rating)}`);
      const id = p.info?.id;
      if (id != null) {
        if (ids.has(id)) add('player-repeated', team, p.name, `${id} is also ${JSON.stringify(ids.get(id))}`);
        else ids.set(id, p.name);
      }
      if (names.has(p.name) && (id == null || names.get(p.name) !== id)) add('namesakes-in-team', team, p.name, `${p.pos} ${p.rating} and another ${p.name}`);
      names.set(p.name, id);
      const age = ageOn(p.info?.dateOfBirth, start);
      if (age != null) {
        const shown = `${age} when the season starts (born ${p.info.dateOfBirth})${p.starter ? ', a starter' : ''}`;
        if (age < AGE_IMPOSSIBLE.under || age > AGE_IMPOSSIBLE.over) add('age-impossible', team, p.name, shown);
        else if (age < AGE_UNUSUAL.under || age > AGE_UNUSUAL.over) add('age-unusual', team, p.name, shown);
      }
    }
    if (team.fielded) {
      const keeper = KEEPER[season.sportId];
      const keeperOut = keeper ? team.lineup.outOfPosition.filter(slot => slot.position === keeper && !slot.gen) : [];
      if (team.lineup.empty.length || keeperOut.length) {
        add('lineup-gap', team, null, [team.lineup.empty.length ? `empty ${team.lineup.empty.join(', ')}` : '',
          ...keeperOut.map(slot => `${slot.name} in goal`)].filter(Boolean).join('; '));
      }
      // A nation of a sport that fills its gaps with generated players stores its own players' strength by its
      // builder's rule, which no lineup of the game's reproduces: only the others are compared.
      if (Number.isFinite(team.str) && !(team.kind === 'nation' && FILLED.has(season.sportId)) && Math.abs(team.str - team.lineup.rating) > 1) {
        add('strength-mismatch', team, null, `stored ${team.str}, fields ${team.lineup.rating}${team.lineup.outOfPosition.length
          ? ` (${team.lineup.outOfPosition.map(slot => `${slot.name} at ${slot.position}`).join(', ')})` : ''}`);
      }
    }
  }
  // One person, by source id, in two nations or two clubs of the season (one squad twice is player-repeated's).
  const placed = new Map();
  for (const team of teams) {
    for (const p of team.players) {
      if (p.info?.id == null) continue;
      const key = `${team.kind}|${p.info.id}`;
      if (!placed.has(key)) placed.set(key, { name: p.name, kind: team.kind, teams: new Set() });
      placed.get(key).teams.add(team.name);
    }
  }
  for (const { name, kind, teams: names } of placed.values()) {
    if (names.size > 1) add('player-in-two-teams', null, name, `in the ${kind}s ${[...names].join(' and ')}`);
  }
  // One player spelled or rated two ways: names folded alike across the season's squads.
  const byFold = new Map();
  for (const team of teams) {
    for (const p of team.players) {
      const key = foldName(p.name.replace(TAG, ''));
      if (!key) continue;
      if (!byFold.has(key)) byFold.set(key, []);
      byFold.get(key).push({ team, p });
    }
  }
  for (const entries of byFold.values()) {
    if (entries.length < 2) continue;
    const spellings = [...new Set(entries.map(e => e.p.name))];
    const ratings = new Set(entries.map(e => e.p.rating));
    // Records that all carry source ids are one player only if the ids agree (EA's Ederson and Éderson are two).
    const ids = new Set(entries.map(e => e.p.info?.id ?? null));
    if (spellings.length > 1 && ratings.size === 1 && (ids.has(null) || ids.size === 1)) {
      add('spelling-variant', null, spellings.join(' / '), entries.map(e => `${e.p.name} (${e.team.kind}:${e.team.name})`).join(', '));
    }
    // A record with a source id is the same player only as another of that id (EA's "L. Suárez"s are two); without
    // ids, a folded name is all there is, and a club record at the national rating is the same player.
    const nationals = entries.filter(e => e.team.kind === 'nation'), clubs = entries.filter(e => e.team.kind === 'club');
    for (const n of nationals) {
      const id = n.p.info?.id;
      const same = clubs.filter(c => (id != null && c.p.info?.id != null ? c.p.info.id === id : true));
      if (!same.length || same.some(c => c.p.rating === n.p.rating)) continue;
      add('rating-conflict', n.team, n.p.name, `${n.p.rating} for ${n.team.name}, ${same.map(c => `${c.p.rating} as ${c.p.name} (${c.team.name})`).join(', ')}`);
    }
  }
  return findings;
}

/** Ratings of a season's players (each record once): { players, min, median, max }. */
function ratingSummary(teams) {
  const ratings = teams.flatMap(team => team.players.map(p => p.rating)).filter(Number.isFinite).sort((a, b) => a - b);
  return { players: ratings.length, min: ratings[0] ?? null, median: ratings[Math.floor(ratings.length / 2)] ?? null, max: ratings.at(-1) ?? null };
}

/**
 * Add a season's people to `people` (Map of `<sport>|<id>` → records): each player whose source id names one person in
 * every season (PERSON_ID), once a season, as { id, season, year, team, name, dob, rating }.
 */
export function collectPeople(people, season, teams) {
  const seen = new Set();
  for (const team of teams) {
    for (const p of team.players) {
      const id = p.info?.id;
      if (id == null || !PERSON_ID.test(id) || seen.has(id)) continue;
      seen.add(id);
      const key = `${season.sportId}|${id}`;
      if (!people.has(key)) people.set(key, []);
      people.get(key).push({ id, season: season.id, year: season.year, team: `${team.kind}:${team.name}`, name: p.name,
        dob: p.info.dateOfBirth || null, rating: p.rating });
    }
  }
  return people;
}

const daysApart = (a, b) => Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 864e5;

/**
 * Findings across seasons, from collectPeople's records: a date of birth more than BIRTH_DATE_SLACK_DAYS from the one
 * most seasons give (a tie goes to the newest season's date: a source corrects its errors in later editions), and an EA
 * rating RATING_JUMP or more from the edition a year before.
 */
export function acrossSeasons(people) {
  const findings = [];
  for (const records of people.values()) {
    if (records.length < 2) continue;
    const byYear = [...records].sort((a, b) => a.year - b.year || a.season.localeCompare(b.season));
    const dated = byYear.filter(r => r.dob);
    if (new Set(dated.map(r => r.dob)).size > 1) {
      const tally = new Map();
      for (const r of dated) tally.set(r.dob, { count: (tally.get(r.dob)?.count || 0) + 1, newest: r.year });
      const [common, { count }] = [...tally].sort((a, b) => b[1].count - a[1].count || b[1].newest - a[1].newest)[0];
      for (const r of dated) {
        if (daysApart(r.dob, common) <= BIRTH_DATE_SLACK_DAYS) continue;
        findings.push({ check: 'birth-date-disagreement', season: r.season, team: r.team, player: r.name,
          detail: `${r.name} born ${r.dob} here, ${common} in ${count} other season${count === 1 ? '' : 's'}` });
      }
    }
    for (let i = 1; i < byYear.length; i++) {
      const [a, b] = [byYear[i - 1], byYear[i]];
      if (!b.id.startsWith('ea:') || b.year - a.year !== 1 || Math.abs(b.rating - a.rating) < RATING_JUMP) continue;
      const change = b.rating - a.rating;
      findings.push({ check: 'rating-jump', season: b.season, team: b.team, player: b.name,
        detail: `${b.name} ${a.rating} in ${a.season}, ${b.rating} here (${change > 0 ? '+' : ''}${change})` });
    }
  }
  return findings;
}

/**
 * Audit every season under `root` (a file URL of the repository, ending in '/'). → { checks, seasons, findings }:
 * `seasons` one summary per season (teams, fielded nations, players, ratings, findings by check), `findings` all of them.
 */
export function auditRosters(root, { sports = null } = {}) {
  const seasons = [], findings = [], people = new Map();
  for (const season of loadSeasons(root, { sports })) {
    const teams = seasonTeams(season);
    findings.push(...auditSeason(season, teams));
    collectPeople(people, season, teams);
    seasons.push({ id: season.id, sport: season.sportId, year: season.year, season: season.season, label: season.label,
      nations: teams.filter(t => t.kind === 'nation').length, fielded: teams.filter(t => t.kind === 'nation' && t.fielded).length,
      clubs: teams.filter(t => t.kind === 'club').length, ratings: ratingSummary(teams), findings: {} });
  }
  findings.push(...acrossSeasons(people));
  const bySeason = new Map(seasons.map(s => [s.id, s.findings]));
  for (const f of findings) bySeason.get(f.season)[f.check] = (bySeason.get(f.season)[f.check] || 0) + 1;
  return { checks: CHECKS, seasons, findings };
}

/** The findings of severity `severity` ('error' or 'warning'). */
export const findingsOf = (findings, severity) => findings.filter(f => CHECKS[f.check].severity === severity);

/** A finding as one line: "nhl-2022 club:San Jose Sharks — lineup-gap: empty RW, RW, D". */
export const findingLine = f => `${f.season}${f.team ? ` ${f.team}` : ''} — ${f.check}: ${f.detail}`;

/**
 * The committed report: every check's description and count, each season's summary, every error, and each warning
 * check's findings by season (its count and up to `examples` of them), so the file stays small and reruns identical.
 */
export function auditReport({ checks, seasons, findings }, { examples = 3 } = {}) {
  const counts = Object.fromEntries(Object.keys(checks).map(id => [id, findings.filter(f => f.check === id).length]));
  const warnings = {};
  for (const f of findingsOf(findings, 'warning')) {
    const bySeason = (warnings[f.check] ??= {});
    const entry = (bySeason[f.season] ??= { count: 0, examples: [] });
    entry.count++;
    if (entry.examples.length < examples) entry.examples.push(findingLine(f).replace(`${f.season} `, ''));
  }
  return {
    generatedBy: 'scripts/audit-rosters.mjs',
    note: 'Every season of every sport as the game plays it: what the loader\'s structural checks do not catch. Errors must be none (scripts/roster-audit.test.mjs); warnings are facts to know. docs/design/roster-audit.md explains each check and the warnings that remain.',
    checks: Object.fromEntries(Object.entries(checks).map(([id, { severity, about }]) => [id, { severity, about, count: counts[id] }])),
    errors: findingsOf(findings, 'error').map(findingLine),
    warnings,
    seasons,
  };
}
