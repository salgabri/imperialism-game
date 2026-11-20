// The FBS's scoring, season by season (docs/design/college-football.md, "Rules by era"): each season's games between
// two FBS schools, regular season and bowls, from sportsdataverse's cfbfastR-cfb-data tables (ESPN's schedules, drives
// and box scores as Parquet, read by scripts/lib/parquet.mjs): team-games, points, touchdowns, regulation's possessions,
// field goals, extra points and safeties. An earlier season plays at its own (src/sports/collegeFootball.js,
// collegeSeasonRules), each rate moved from College Football 27's by as far as the season's sits from 2024 and 2025's.
//
//   npm run build:college-scoring              read every season's tables: scripts/data/college-scoring.json and
//                                              src/data/collegeLeagueAverages.js
//   npm run build:college-scoring -- --check   both files byte for byte where data-src/ has every table, else the
//                                              module from the committed table; and each season's average matchup
//                                              from its schools
//   npm run build:college-scoring -- --report  each season's figures a team-game, from the committed table
//
// The tables are the ignored data-src/cfb-history/cfbfastR-cfb-data/<table>/<table>_<year>.parquet (sportsdataverse's
// https://github.com/sportsdataverse/cfbfastR-cfb-data, cfb/<table>/parquet/, saved there on 2026-11-18 beside the
// files scripts/sync-cfb-seasons.mjs reads): cfb_schedules (each game's schools, their divisions and its final score),
// drives (each possession: its team, the quarter it started in, its offensive plays and how it ended) and player_box
// (each kicker's field goals and extra points, "made/tried"). The table pins every file it read by SHA-256. No source
// has two-point tries.
//
// A season's games: those between two FBS schools that were played (`completed`), regular season and postseason. A game
// counts when its drives cover all four quarters and both schools' points add up from their box scores (below); the
// table names how many did not, and why.
//
// - Touchdowns: from each school's scoring, all of a game's, overtime's and the defence's and returners' included. Its
//   points less its extra points and field goals made and its safeties (the other school's drives that ended in one)
//   leave six a touchdown and two a two-point try made; with the extra points tried, the fewest tries that add up give
//   its touchdowns (extra points tried and two-point tries). Two points no try explains are a safety the drives did not
//   name (a fifth of 2012's), counted as one. A walk-off touchdown, which has no try, counts as a failed two-point try,
//   so the two-point tries so found (`twoAtt`, `twoMade`) are a check only. A school whose points still do not add up (a
//   kicker's row missing with an odd number of extra points) leaves its game out. So do the few games that reached a
//   two-point shoot-out (2019 on), whose plays add twos of their own.
// - Overtime's touchdowns and field-goal tries (`otTd`, `otFga`): its drives (from the fifth period) that ended in one,
//   a touchdown on a possession of a play or more (the shoot-out's plays are drives of none).
// - Possessions: regulation's drives of at least one offensive play. ESPN's drive lists also hold kick and turnover
//   returns as drives of no play (a kick-off return touchdown, an interception return, before 2014 a punt return's twin of
//   the punting team's drive) and, before 2014, a half that ended before the receiving side's first snap; none is a
//   possession of the model's, and leaving out every drive of no play counts the same in every season. 2004's lists also
//   log each kickoff as a drive of one play ('KICKOFF', with no description: about eight a game), which is no possession
//   either; every later 'KICKOFF' drive has its plays described and stands.
// - Field goals and extra points: the kickers' rows of the box score, overtime's included. 2011's rows name no missed
//   extra point (each reads n/n, a miss counting as no try: `unrecorded`), so its extra points are unknown; its
//   touchdowns still add up (a miss reads as a failed two-point try). Safeties: those the scoring counts, less any of
//   overtime's drives.
import { existsSync } from 'node:fs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readParquet } from './lib/parquet.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SOURCE = path.join(root, 'data-src/cfb-history/cfbfastR-cfb-data');
const TABLE = path.join(root, 'scripts/data/college-scoring.json');
const MODULE = path.join(root, 'src/data/collegeLeagueAverages.js');
const SEASON_FILES = path.join(root, 'public/college-football');
const REPO = 'https://github.com/sportsdataverse/cfbfastR-cfb-data';

/** The seasons the table holds: the FBS's 2004 (ESPN's first box scores and drives) to 2025. */
export const SEASONS = Object.freeze(Array.from({ length: 22 }, (_, i) => 2004 + i));
/** The seasons College Football 27's rules were fitted on: every other season's rates move from theirs. */
export const REFERENCE_SEASONS = Object.freeze([2024, 2025]);
const TABLES = Object.freeze(['cfb_schedules', 'drives', 'player_box']);

const fileOf = (table, year) => `${table}/${table}_${year}.parquet`;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

/** The first overtime period of two-point plays (the NCAA's shoot-out) in `year`, or null: the fifth in 2019 and 2020, the third from 2021. */
const shootoutFrom = year => (year >= 2021 ? 3 : year >= 2019 ? 5 : null);

/** A drive result that is a touchdown, whoever scored it ('TD', 'PASSING TD', 'INT TD', 'PUNT RETURN TD', 'INT RETURN TOUCH' …). */
export const isTouchdown = result => typeof result === 'string' && (/(^| )TD$/.test(result) || result === 'INT RETURN TOUCH');
/** A drive result that is a field-goal try, made or missed ('FG', 'FG GOOD', 'MISSED FG', 'FG MISSED', a missed one returned 'MISSED FG TD' …). */
export const isFieldGoalTry = result => typeof result === 'string' && /^(FG|FG GOOD|MISSED FG|FG MISSED)( TD)?$/.test(result);
/** A kickoff ESPN's drive list logs as a drive of its own (2004's): 'KICKOFF' with no description of its plays. */
export const isLoggedKickoff = drive => drive.result === 'KICKOFF' && drive.description == null;
/** "made/tried" as two numbers, or null. */
const madeOf = text => {
  const match = /^(\d+)\/(\d+)$/.exec(text ?? '');
  return match ? [Number(match[1]), Number(match[2])] : null;
};

/**
 * A school's touchdowns from its scoring: `points`, its kickers' `xpm`/`xpa` and `fgm`, and the safeties its opponent's
 * drives name. The points left after the kicks and safeties are six a touchdown beyond those whose extra point was tried,
 * and two a two-point try made: → { td, twoAtt, twoMade, safeties } with the fewest two-point tries that add up, or null
 * when none do. Points that add up only with a safety or two more than the drives name (ESPN's drives leave some
 * unnamed, a fifth of 2012's) count those safeties.
 */
export function touchdownsOf({ points, xpm, xpa, fgm, safeties }) {
  for (let unnamed = 0; unnamed <= 2; unnamed++) {
    const rest = points - xpm - 3 * fgm - 2 * (safeties + unnamed) - 6 * xpa;
    for (let twoAtt = 0; 6 * twoAtt <= rest; twoAtt++) {
      const twoMade = (rest - 6 * twoAtt) / 2;
      if (Number.isInteger(twoMade) && twoMade <= twoAtt) return { td: xpa + twoAtt, twoAtt, twoMade, safeties: safeties + unnamed };
    }
  }
  return null;
}

const COUNTS = Object.freeze(['games', 'points', 'td', 'otTd', 'possessions', 'fga', 'otFga', 'fgm', 'xpa', 'xpm', 'safeties', 'twoAtt', 'twoMade']);

/**
 * One season's figures from its tables' rows (readParquet's): `{ fbs, games, points, td, otTd, possessions, fga, otFga,
 * fgm, xpa, xpm, safeties, twoAtt, twoMade, left }`, `fbs` the season's games between two FBS schools, `games` the
 * team-games counted, `left` the games left out by reason (`drives`: none, or a quarter without one; `scoring`: a
 * school's points do not add up; `shootout`: a two-point shoot-out).
 */
export function seasonFigures(year, { schedule, drives, box }) {
  const games = schedule.filter(g => g.home_division === 'fbs' && g.away_division === 'fbs' && g.completed
    && (g.season_type === 'regular' || g.season_type === 'postseason') && Number.isInteger(g.home_points) && Number.isInteger(g.away_points));
  const ids = new Set(games.map(g => g.game_id));
  const drivesOf = new Map();
  for (const d of drives) if (ids.has(d.game_id)) (drivesOf.get(d.game_id) ?? drivesOf.set(d.game_id, []).get(d.game_id)).push(d);
  const kicks = new Map();
  for (const row of box) {
    if (row.category !== 'kicking' || !ids.has(row.game_id)) continue;
    const fg = madeOf(row['fieldGoalsMade/fieldGoalAttempts']), xp = madeOf(row['extraPointsMade/extraPointAttempts']);
    if (!fg || !xp) throw new Error(`${year}: game ${row.game_id}'s kicking row for team ${row.team_id} has no "made/tried"`);
    const key = `${row.game_id}|${row.team_id}`;
    const k = kicks.get(key) ?? kicks.set(key, { fgm: 0, fga: 0, xpm: 0, xpa: 0 }).get(key);
    k.fgm += fg[0]; k.fga += fg[1]; k.xpm += xp[0]; k.xpa += xp[1];
  }
  const out = { fbs: games.length, ...Object.fromEntries(COUNTS.map(key => [key, 0])), left: { drives: 0, scoring: 0, shootout: 0 } };
  const shootout = shootoutFrom(year);
  for (const game of games) {
    const all = drivesOf.get(game.game_id) ?? [];
    const possessions = all.filter(d => d.start_period >= 1 && d.start_period <= 4 && d.offensive_plays >= 1 && !isLoggedKickoff(d));
    if (![1, 2, 3, 4].every(quarter => possessions.some(d => d.start_period === quarter))) { out.left.drives++; continue; }
    if (shootout && all.some(d => d.start_period >= 4 + shootout)) { out.left.shootout++; continue; }
    const overtime = all.filter(d => d.start_period >= 5);
    const sides = [[game.home_id, game.home_points, game.away_id], [game.away_id, game.away_points, game.home_id]].map(([team, points, other]) => {
      const k = kicks.get(`${game.game_id}|${team}`) ?? { fgm: 0, fga: 0, xpm: 0, xpa: 0 };
      const safeties = all.filter(d => d.team_id === other && d.result === 'SF').length;
      const scoring = touchdownsOf({ points, ...k, safeties });
      return scoring && { ...k, ...scoring, points };
    });
    if (sides.some(side => !side)) { out.left.scoring++; continue; }
    out.games += 2;
    for (const side of sides) for (const key of ['points', 'td', 'fga', 'fgm', 'xpa', 'xpm', 'safeties', 'twoAtt', 'twoMade']) out[key] += side[key];
    out.otTd += overtime.filter(d => isTouchdown(d.result) && d.offensive_plays >= 1).length;
    out.otFga += overtime.filter(d => isFieldGoalTry(d.result)).length;
    out.safeties -= overtime.filter(d => d.result === 'SF').length;
    out.possessions += possessions.length;
  }
  // A season whose box scores name not one missed extra point did not record them (2011's: every kicker's row reads
  // n/n, a miss counting as no try): its extra points are unknown, its touchdowns still add up.
  if (out.xpm === out.xpa) out.unrecorded = ['xp'];
  return out;
}

// ---------- the matchups ----------

/**
 * Each season's average matchup and its spread, as the match model rates its schools' lineups: the built-in season's
 * (src/data/clubs.college-football.js) and every season file's (public/college-football/cfb-<year>.json) there is.
 */
async function seasonMatchups() {
  const { buildClub, selectLineup } = await import('../src/data/teams.js');
  const { americanFootballProfile } = await import('../src/sports/americanFootball.js');
  const { CLUBS } = await import('../src/data/clubs.college-football.js');
  const sport = { id: 'college-football' };
  const average = clubs => {
    const profiles = clubs.map(club => americanFootballProfile(selectLineup(buildClub(club, sport))));
    const mean = key => profiles.reduce((sum, p) => sum + p[key], 0) / profiles.length;
    const edge = mean('offence') - mean('defence');
    // The variance of a drive's edge about the average matchup, over every pairing of two of the schools (an offence
    // against the other's defence), which the season's drive odds allow for (collegeSeasonRules).
    let spread = 0;
    for (const a of profiles) for (const d of profiles) if (a !== d) spread += (a.offence - d.defence - edge) ** 2;
    spread /= profiles.length * (profiles.length - 1);
    const round = value => Math.round(value * 1000) / 1000;
    return { edge: round(edge), kicking: round(mean('kicking')), spread: round(spread) };
  };
  const out = { 'built-in': average(CLUBS) };
  const files = existsSync(SEASON_FILES) ? (await readdir(SEASON_FILES)).filter(name => /^cfb-\d{4}\.json$/.test(name)).sort() : [];
  for (const name of files) {
    const set = JSON.parse(await readFile(path.join(SEASON_FILES, name), 'utf8'));
    out[name.slice(0, -5)] = average(set.clubs);
  }
  return out;
}

// ---------- the table ----------

/** Every season read from its tables, each file pinned by SHA-256, and the seasons' matchups → scripts/data/college-scoring.json. */
async function buildTable() {
  const files = {}, seasons = {};
  for (const year of SEASONS) {
    const rows = {};
    for (const table of TABLES) {
      const bytes = await readFile(path.join(SOURCE, fileOf(table, year)));
      files[fileOf(table, year)] = sha256(bytes);
      rows[table] = readParquet(bytes);
    }
    seasons[year] = seasonFigures(year, { schedule: rows.cfb_schedules, drives: rows.drives, box: rows.player_box });
  }
  return {
    note: 'The FBS\'s scoring, season by season (npm run build:college-scoring; docs/design/college-football.md, "Rules by era"): '
      + 'its games between two FBS schools, regular season and bowls (`fbs`), of which those whose drives cover all four quarters '
      + 'and whose schools\' points add up from their box scores count (`left`: the rest, by reason). For those: team-games '
      + '(`games`), points, touchdowns (`td`, from each school\'s points less its kicks and safeties; overtime\'s `otTd`), '
      + 'regulation\'s possessions (its drives of a play or more), field goals tried (`fga`, overtime\'s `otFga`) and made '
      + '(`fgm`), extra points tried and made (`xpa`, `xpm`; `unrecorded` where the box scores name no miss, 2011\'s), '
      + 'regulation\'s safeties (with those the drives did not name that the points need), and the two-point tries those points '
      + 'leave (`twoAtt`, `twoMade`: a walk-off touchdown, which has no try, counts as a failed one; a check only). From '
      + 'sportsdataverse\'s cfbfastR-cfb-data tables (ESPN-derived), each file as `source.files` pins it. `matchups`: each '
      + 'season\'s schools\' mean offence less mean defence, mean kicker, and the variance of an offence\'s edge over another '
      + 'school\'s defence about that mean, as the match model rates their lineups (src/sports/americanFootball.js).',
    source: { repo: REPO, path: 'cfb/<table>/parquet/<table>_<year>.parquet', cache: 'data-src/cfb-history/cfbfastR-cfb-data/', files },
    seasons,
    matchups: await seasonMatchups(),
  };
}

/** The table as committed: one season, matchup and file a line. */
function tableText(table) {
  const lines = entries => Object.entries(entries).map(([key, value]) => `\n    ${JSON.stringify(key)}: ${JSON.stringify(value)}`).join(',');
  const { files, ...source } = table.source;
  return `{\n  "note": ${JSON.stringify(table.note)},\n  "source": {${lines(source)},\n    "files": {${lines(files).replace(/\n {4}/g, '\n      ')}\n    }\n  },\n`
    + `  "seasons": {${lines(table.seasons)}\n  },\n  "matchups": {${lines(table.matchups)}\n  }\n}\n`;
}

/** src/data/collegeLeagueAverages.js from the table. */
export function moduleText(table) {
  const years = Object.keys(table.seasons).map(Number);
  const known = (s, key) => (s.unrecorded?.includes('xp') && (key === 'xpa' || key === 'xpm') ? null : s[key]);
  const season = s => `{ games: ${s.games}, points: ${s.points}, td: ${s.td}, otTd: ${s.otTd}, possessions: ${s.possessions}, `
    + `fga: ${s.fga}, otFga: ${s.otFga}, fgm: ${s.fgm}, xpa: ${known(s, 'xpa')}, xpm: ${known(s, 'xpm')}, safeties: ${s.safeties} }`;
  const seasons = Object.entries(table.seasons).map(([year, s]) => `  ${year}: Object.freeze(${season(s)}),`).join('\n');
  const matchups = Object.entries(table.matchups).map(([id, m]) => `  '${id}': Object.freeze({ edge: ${m.edge}, kicking: ${m.kicking}, spread: ${m.spread} }),`).join('\n');
  return `// GENERATED by npm run build:college-scoring from scripts/data/college-scoring.json; do not edit.
// The FBS's seasons, games between two FBS schools (regular season and bowls) as sportsdataverse's cfbfastR-cfb-data
// tables give them (ESPN's schedules, drives and box scores: ${REPO}):
// the team-games counted (games), their points, touchdowns (td: every touchdown, overtime's otTd among them),
// regulation's possessions (drives of a play or more), field goals tried (fga, overtime's otFga) and made (fgm), extra
// points tried and made (xpa, xpm; null where the box scores name no miss: 2011's) and safeties. A season's possessions
// and rates a possession move College Football 27's rules (fitted on 2024 and 2025) by as far as they sit from 2024 and
// 2025's (src/sports/collegeFootball.js, collegeSeasonRules).
export const COLLEGE_LEAGUE_AVERAGES = Object.freeze({
${seasons}
});

/** The first and latest seasons in the table. */
export const FIRST_COLLEGE_SEASON = ${Math.min(...years)};
export const LATEST_COLLEGE_SEASON = ${Math.max(...years)};

/** The seasons College Football 27's rules were fitted on, whose figures every other season's are measured from. */
export const COLLEGE_REFERENCE_SEASONS = Object.freeze([${REFERENCE_SEASONS.join(', ')}]);

// Each season's average matchup, as the match model rates its schools' lineups: their mean offence less their mean
// defence (\`edge\`), their mean kicker (\`kicking\`), and the variance of a drive's edge about that average over every
// pairing of two schools (\`spread\`); 'built-in' is the built-in season's (College Football 27), and a season without a
// file of its own (public/college-football/cfb-<year>.json) plays at it. A season's drive odds are stated at its own
// average matchup, and allow for its spread beyond the built-in season's.
export const COLLEGE_SEASON_MATCHUPS = Object.freeze({
${matchups}
});
`;
}

/** Each season's figures a team-game, and 2024 and 2025's against cfbstats.com's (docs/design/college-football.md). */
function report(table) {
  const f = (x, d = 2) => x.toFixed(d);
  const line = (label, s, fbs, left) => {
    const reg = s.td - s.otTd, g = s.games;
    return `${label} ${fbs != null ? `games ${s.games / 2}/${fbs}${left ? ` (left out: ${Object.entries(left).filter(([, n]) => n).map(([k, n]) => `${k} ${n}`).join(', ') || 'none'})` : ''} ` : ''}`
      + `pts ${f(s.points / g)} TD ${f(s.td / g, 3)} poss ${f(s.possessions / g)} TD/poss ${f(reg / s.possessions, 4)} FGA ${f(s.fga / g, 3)}`
      + ` FGA/non-TD ${f((s.fga - s.otFga) / (s.possessions - reg), 4)} FG% ${f(100 * s.fgm / s.fga, 1)}`
      + ` XP% ${s.unrecorded?.includes('xp') ? '(no miss named)' : f(100 * s.xpm / s.xpa, 2)}`
      + ` SF ${f(s.safeties / g, 3)} 2PA/TD ${f(100 * s.twoAtt / s.td, 1)}% 2P% ${f(100 * s.twoMade / s.twoAtt, 1)}`;
  };
  for (const [year, s] of Object.entries(table.seasons)) console.log(line(year, s, s.fbs, s.left));
  const sum = {};
  for (const year of REFERENCE_SEASONS) for (const key of COUNTS) sum[key] = (sum[key] ?? 0) + table.seasons[year][key];
  console.log(line(`${REFERENCE_SEASONS.join('+')}`, sum));
  console.log('cfbstats 2024+2025: pts 26.50 TD 3.27 FGA 1.59 FG% 76.1 XP% 98.3 SF 0.030 2PA/TD 8.3% 2P% 46.1');
  for (const [id, m] of Object.entries(table.matchups)) console.log(`${id}: edge ${m.edge} kicking ${m.kicking} spread ${m.spread}`);
}

async function main() {
  const argv = process.argv.slice(2);
  const unknown = argv.filter(arg => !['--check', '--report'].includes(arg));
  if (unknown.length) throw new Error(`Unknown option ${unknown[0]}`);
  if (argv.includes('--report')) return report(JSON.parse(await readFile(TABLE, 'utf8')));
  const check = argv.includes('--check');
  const complete = SEASONS.every(year => TABLES.every(table => existsSync(path.join(SOURCE, fileOf(table, year)))));
  let table;
  if (complete) table = await buildTable();
  else if (check) {
    // Without the tables, the committed table's seasons stand; its matchups are still the season files' own.
    table = JSON.parse(await readFile(TABLE, 'utf8'));
    if (JSON.stringify(await seasonMatchups()) !== JSON.stringify(table.matchups)) {
      throw new Error(`${path.relative(root, TABLE)}'s matchups differ from the seasons' schools: npm run build:college-scoring where data-src/ has the tables`);
    }
    console.log('data-src/ lacks some tables: the matchups are checked against the seasons, the module against the committed table');
  } else throw new Error(`data-src/ lacks some of ${TABLES.join(', ')} for ${SEASONS[0]}–${SEASONS.at(-1)} (data-src/cfb-history/cfbfastR-cfb-data/)`);
  const outputs = [...(complete ? [[TABLE, tableText(table)]] : []), [MODULE, moduleText(table)]];
  if (check) {
    for (const [file, text] of outputs) {
      if ((existsSync(file) ? await readFile(file, 'utf8') : null) !== text) throw new Error(`${path.relative(root, file)} differs from its rebuild`);
    }
    console.log(`Verified ${outputs.map(([file]) => path.relative(root, file)).join(' and ')} byte for byte`);
    return;
  }
  for (const [file, text] of outputs) await writeFile(file, text);
  console.log(`Wrote ${Object.keys(table.seasons).length} seasons to ${outputs.map(([file]) => path.relative(root, file)).join(' and ')}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(`build-college-scoring: ${error.message}`);
    process.exitCode = 1;
  });
}
