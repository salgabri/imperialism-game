// Snapshot the NFL seasons no game rated (and the AFL's, 1960 to 1969) from Pro Football Archives' facts
// (docs/design/american-football.md, "Computed seasons") into scripts/data/pfa-seasons/<season>.json and
// afl-<season>.json (committed), for the earlier American football seasons to build from: 1960 to 1989, 1991, 1996 and
// 1997, and the AFL's ten seasons.
//
// Each club's page gives who played, at which position, in how many games and starts, and the season's box-score totals.
// Each player's season value (scripts/lib/pfa.mjs: his club's points against the league's, shared out by starts,
// production and plays) is ranked among the league-season's players at his game position (ties by starts, then games)
// and read off Madden NFL 2002's overalls at that position (scripts/lib/nfl-reference.mjs), as the Tecmo seasons' scores
// are. The value's weights were tuned once on 2001 to 2005 against the next season's Madden launch ratings (--tune) and
// are frozen; scripts/data/pfa-seasons/calibration.json records how well they order each position.
//
// 1987 is ranked on the clubs' own players only: those who played nothing but the three strike games, by those games'
// box scores, are left out. 1982, whose strike cancelled games, is ranked as played (nine games).
//
// The pages stay in the gitignored data-src/pfa/, each read only when it is the file scripts/data/pfa-pages.json pins.
//
// Usage: node scripts/sync-pfa.mjs [--season=<year>|afl-<year>] [--check] [--tune]
//   --season  one season only
//   --check   rebuild the snapshots and the calibration and compare them byte for byte; writes nothing
//   --tune    search the weights' grid on 2001 to 2005 again and print the best (writes nothing)
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { FORMATION, POSITION_OF as MADDEN_POSITION_OF, shortOf, squadOf, teamsOf } from './lib/nfl.mjs';
import { maddenReferencePlayers, overallsOf, referenceOf } from './lib/nfl-reference.mjs';
import { clubPagesOf, parseTeamSeason, playersOfBoxScore, replacementPlayers, seasonValues, settleKickers, VALUE_WEIGHTS } from './lib/pfa.mjs';
import { STRIKE_GAMES } from './fetch-pfa.mjs';
import { spearman } from './lib/ndb-madden.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dataSrc = path.join(root, 'data-src');
const outDir = path.join(root, 'scripts/data/pfa-seasons');
const pinsFile = path.join(root, 'scripts/data/pfa-pages.json');
const SITE = 'https://www.profootballarchives.com';
const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'OL', 'DL', 'LB', 'CB', 'S', 'K'];
const CALIBRATION = [2001, 2002, 2003, 2004, 2005];

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const plain = text => String(text ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, '').replace(/[^a-z]/g, '');

let PINS = null, RETRIEVED = null;
/** A pinned page's text (by its path under data-src/pfa/); throws when it is missing or not the pinned page. */
async function pinned(file) {
  if (!PINS) ({ files: PINS, retrieved: RETRIEVED } = JSON.parse(await readFile(pinsFile, 'utf8')));
  if (!(file in PINS)) throw new Error(`pfa/${file} is not pinned in scripts/data/pfa-pages.json`);
  const full = path.join(dataSrc, 'pfa', file);
  if (!existsSync(full)) throw new Error(`data-src/pfa/${file} is missing (npm run fetch:pfa)`);
  const bytes = await readFile(full);
  if (sha256(bytes) !== PINS[file]) throw new Error(`data-src/pfa/${file} is not the pinned page (SHA-256 ${sha256(bytes)})`);
  return bytes.toString('utf8');
}

/** One league-season's club pages, parsed, in the index's order: `[{ file, page }]`. */
async function leagueSeason(year, league) {
  const index = `${year}/${year}${league.toLowerCase()}.html`;
  const files = clubPagesOf(await pinned(index), year, league.toLowerCase());
  const clubs = [];
  for (const file of files) {
    const page = parseTeamSeason(await pinned(`${year}/${file}`));
    if (page.year !== year || page.league !== league) throw new Error(`${file} is ${page.year} ${page.league}`);
    clubs.push({ file: `${year}/${file}`, page });
  }
  return { index, clubs };
}

// ---------- the franchises ----------

// Each club as the site names it, as today's franchise (scripts/data/nfl-teams.json).
const FRANCHISE_OF = {
  'Arizona Cardinals': 'nfl-arizona-cardinals', 'Phoenix Cardinals': 'nfl-arizona-cardinals', 'St. Louis Cardinals': 'nfl-arizona-cardinals',
  'Atlanta Falcons': 'nfl-atlanta-falcons', 'Baltimore Ravens': 'nfl-baltimore-ravens', 'Buffalo Bills': 'nfl-buffalo-bills',
  'Carolina Panthers': 'nfl-carolina-panthers', 'Chicago Bears': 'nfl-chicago-bears', 'Cincinnati Bengals': 'nfl-cincinnati-bengals',
  'Cleveland Browns': 'nfl-cleveland-browns', 'Dallas Cowboys': 'nfl-dallas-cowboys', 'Denver Broncos': 'nfl-denver-broncos',
  'Detroit Lions': 'nfl-detroit-lions', 'Green Bay Packers': 'nfl-green-bay-packers', 'Houston Texans': 'nfl-houston-texans',
  'Indianapolis Colts': 'nfl-indianapolis-colts', 'Baltimore Colts': 'nfl-indianapolis-colts', 'Jacksonville Jaguars': 'nfl-jacksonville-jaguars',
  'Kansas City Chiefs': 'nfl-kansas-city-chiefs', 'Dallas Texans': 'nfl-kansas-city-chiefs',
  'Oakland Raiders': 'nfl-las-vegas-raiders', 'Los Angeles Raiders': 'nfl-las-vegas-raiders',
  'San Diego Chargers': 'nfl-los-angeles-chargers', 'Los Angeles Chargers': 'nfl-los-angeles-chargers',
  'Los Angeles Rams': 'nfl-los-angeles-rams', 'St. Louis Rams': 'nfl-los-angeles-rams', 'Miami Dolphins': 'nfl-miami-dolphins',
  'Minnesota Vikings': 'nfl-minnesota-vikings', 'New England Patriots': 'nfl-new-england-patriots', 'Boston Patriots': 'nfl-new-england-patriots',
  'New Orleans Saints': 'nfl-new-orleans-saints', 'New York Giants': 'nfl-new-york-giants', 'New York Jets': 'nfl-new-york-jets',
  'New York Titans': 'nfl-new-york-jets', 'Philadelphia Eagles': 'nfl-philadelphia-eagles', 'Pittsburgh Steelers': 'nfl-pittsburgh-steelers',
  'San Francisco 49ers': 'nfl-san-francisco-49ers', 'Seattle Seahawks': 'nfl-seattle-seahawks', 'Tampa Bay Buccaneers': 'nfl-tampa-bay-buccaneers',
  'Tennessee Titans': 'nfl-tennessee-titans', 'Tennessee Oilers': 'nfl-tennessee-titans', 'Houston Oilers': 'nfl-tennessee-titans',
  'Washington Redskins': 'nfl-washington-commanders',
};
// The site's club names the game's eras name otherwise: Washington's club before 2020 is Washington here.
const NAME_AS = { 'Washington Redskins': 'Washington' };

// ---------- the overall ----------

/**
 * Each player of a league-season once, with his season value, at the club he started most for (then played most for):
 * a player of two clubs has his values at that position summed (his kicks too). A kicker who also played a position is
 * then listed at his larger share (settleKickers). → `[{ franchise, id, name, no, codes, position, gp, gs, value,
 * played?, also? }]`.
 */
export function seasonPlayers(clubs, franchiseOf, weights) {
  const rows = seasonValues(clubs.map(c => c.page), weights);
  const byId = new Map();
  for (const row of rows) {
    const entry = { ...row, franchise: franchiseOf(row.club) };
    if (!byId.has(row.id)) byId.set(row.id, []);
    byId.get(row.id).push(entry);
  }
  const round = v => Math.round(v * 1e6) / 1e6;
  const merged = [...byId.values()].map(rowsOf => {
    if (rowsOf.length === 1) return rowsOf[0];
    const main = rowsOf.slice().sort((a, b) => b.gs - a.gs || b.gp - a.gp || a.club - b.club)[0];
    const kick = r => (r.position === 'K' ? r.value : r.kickValue ?? 0);
    const kicked = rowsOf.some(r => r.position === 'K' || r.kickValue !== undefined);
    const { kickValue, ...rest } = main;
    return { ...rest, value: round(main.position === 'K' ? rowsOf.reduce((t, r) => t + kick(r), 0)
      : rowsOf.filter(r => r.position === main.position).reduce((t, r) => t + r.value, 0)),
    ...(kicked && main.position !== 'K' ? { kickValue: round(rowsOf.reduce((t, r) => t + kick(r), 0)) } : {}),
    gp: rowsOf.reduce((t, r) => t + r.gp, 0), gs: rowsOf.reduce((t, r) => t + r.gs, 0), also: rowsOf.filter(r => r !== main).map(r => r.franchise) };
  });
  return settleKickers(merged);
}

/** Each position's players ranked by value, then starts, then games: rank 1 the lowest, ties on all three sharing one. */
export function ranked(players) {
  const order = players.slice().sort((a, b) => a.value - b.value || a.gs - b.gs || a.gp - b.gp);
  const rank = new Map();
  order.forEach((p, i) => {
    const prev = order[i - 1];
    rank.set(p, prev && prev.value === p.value && prev.gs === p.gs && prev.gp === p.gp ? rank.get(prev) : i + 1);
  });
  return rank;
}

/** The overall of every player, by position: his rank read off Madden NFL 2002 at the position. → `{ reference }`. */
export function rate(players, clubs, madden) {
  const reference = {};
  for (const position of POSITIONS) {
    const at = players.filter(p => p.position === position);
    if (!at.length) continue;
    const rank = ranked(at);
    const madden2002 = referenceOf(madden, position, at.length / clubs);
    const overall = overallsOf(at.map(p => rank.get(p)), madden2002);
    for (const p of at) { p.rank = rank.get(p); p.overall = overall.get(p.rank); }
    reference[position] = { players: at.length, perClub: Math.round(at.length / clubs * 100) / 100, madden: madden2002 };
  }
  return reference;
}

// ---------- the calibration ----------

/** Madden NFL `edition` season's launch roster by plain name (a name two players share is left out). */
function maddenByName(snapshot) {
  const byName = new Map();
  for (const [name, , listed, overall] of snapshot.players) {
    const key = plain(name);
    byName.set(key, byName.has(key) ? null : { overall, position: MADDEN_POSITION_OF[listed] ?? listed });
  }
  return byName;
}
/** How well `weights` order 2001–2005's players as the next season's Madden launch ratings do, by position. */
async function calibrate(weights, seasons) {
  const per = Object.fromEntries(POSITIONS.map(p => [p, []]));
  for (const { year, clubs, next } of seasons) {
    const players = seasonPlayers(clubs, () => null, weights);
    for (const position of POSITIONS) {
      const matched = players.filter(p => p.position === position).map(p => ({ p, m: next.get(plain(p.name)) })).filter(r => r.m);
      const rank = ranked(matched.map(r => r.p));
      per[position].push({ season: year, players: matched.length, spearman: spearman(matched.map(r => rank.get(r.p)), matched.map(r => r.m.overall)) });
    }
  }
  const mean = Object.fromEntries(POSITIONS.map(p => [p, Math.round(per[p].reduce((t, r) => t + r.spearman, 0) / per[p].length * 1000) / 1000]));
  return { per, mean, overall: Math.round(POSITIONS.reduce((t, p) => t + mean[p], 0) / POSITIONS.length * 10000) / 10000 };
}
async function calibrationSeasons() {
  const out = [];
  for (const year of CALIBRATION) {
    const { clubs } = await leagueSeason(year, 'NFL');
    const next = maddenByName(JSON.parse(await readFile(path.join(root, `scripts/data/madden-seasons/${year + 1}.json`), 'utf8')));
    out.push({ year, clubs, next, files: clubs.map(c => c.file) });
  }
  return out;
}
// The grid the weights were chosen from (--tune), the club's credit linear in its points (team 1), around the rule's
// first draft (pass 0.5, td 20, int 45, start 0, teStart 0.5, sack 1, pick 1, starts 2/3, accuracy 1), in two passes:
// this is the second, around the first's best. Then the credit's power (TEAM) by the spread of club strengths.
const GRID = { pass: [0.15, 0.2, 0.3], td: [40, 60, 80], int: [30, 45, 60], teStart: [0.15, 0.25], start: [0.05, 0.1, 0.15], sack: [2, 3],
  pick: [1, 1.5], accuracy: [3, 5, 8] };
const TEAM = [1, 0.75, 0.5, 0.35, 0.3, 0.25, 0.2, 0.15, 0.1];

/** Each club's strength (its lineup rating) in a computed season of `clubs` by `weights`, clubs by the page's index. */
function strengths(clubs, weights, madden) {
  const players = seasonPlayers(clubs, club => club, weights).filter(p => p.position !== 'P' && p.position !== 'LONG');
  rate(players, clubs.length, madden);
  return clubs.map((_, club) => {
    const pool = players.filter(p => p.franchise === club).map(p => ({ name: p.name, pos: p.position, rating: p.overall }));
    return squadOf(pool, `club ${club}`, { gaps: shortOf(pool) }).str;
  });
}

// The site's name of a club's home venue, as the eras name the stadium (the one it still plays in by its present name,
// one it has left as it was best known), where the two differ.
const VENUE_AS = {
  'Arrowhead Stadium': ['GEHA Field at Arrowhead Stadium'], Astrodome: ['Houston Astrodome'], 'Atlanta-Fulton County Stadium': ['Atlanta–Fulton County Stadium'],
  'Bears Stadium': ['Mile High Stadium'], 'Boston University Field': ['Nickerson Field'], 'Boston College Alumni Stadium': ['Alumni Stadium'], 'Briggs Stadium': ['Tiger Stadium'],
  'Busch Stadium': ["Busch Stadium (Sportsman's Park)", 'Busch Memorial Stadium'], 'City Stadium': ['Lambeau Field'],
  'Cleveland Stadium': ['Cleveland Municipal Stadium'], 'D.C. Stadium': ['RFK Stadium'], 'Louisiana Superdome': ['Caesars Superdome'],
  'Memorial Coliseum': ['Los Angeles Memorial Coliseum'], 'Memorial Stadium': ['Memorial Stadium, Baltimore'],
  'Municipal Stadium': ['Municipal Stadium, Kansas City', 'EverBank Stadium'], 'Oakland-Alameda County Coliseum': ['Oakland–Alameda County Coliseum'],
  'Orange Bowl': ['Miami Orange Bowl'], 'Rich Stadium': ['Highmark Stadium'], 'San Diego Stadium': ['Qualcomm Stadium'],
  'Schaefer Stadium': ['Foxboro Stadium'], 'Sullivan Stadium': ['Foxboro Stadium'], 'Hoosier Dome': ['RCA Dome'], 'Joe Robbie Stadium': ['Hard Rock Stadium'],
  'Pro Player Stadium': ['Hard Rock Stadium'], 'Pro Player Park': ['Hard Rock Stadium'], '3Com Park': ['Candlestick Park'], 'ALLTEL Stadium': ['EverBank Stadium'],
  'Cinergy Field': ['Riverfront Stadium'], 'Ericsson Stadium': ['Bank of America Stadium'], "Houlihan's Stadium": ['Tampa Stadium'],
  'Jack Kent Cooke Stadium': ['Northwest Stadium'], 'Liberty Bowl': ['Liberty Bowl Memorial Stadium'], 'Trans World Dome': ['Edward Jones Dome'], 'Jack Murphy Stadium': ['Qualcomm Stadium'], Metrodome: ['Hubert H. Humphrey Metrodome'],
};
/** Whether the site's venue `venue` is the eras' stadium `stadium`. */
const isVenue = (venue, stadium) => venue === stadium || !!VENUE_AS[venue]?.includes(stadium);
// A second home a club played a few games a season at, not counted (as the franchise research of 1980–2025 has it): the
// Packers' games in Milwaukee, two to four a season to 1994 (three of the four in the strike season of 1982).
const SECOND_HOME = { 'nfl-green-bay-packers': 'County Stadium' };

// ---------- a season ----------

async function snapshotOf(year, league, manifest, franchises, madden, calibration) {
  const { index, clubs } = await leagueSeason(year, league);
  const teams = teamsOf(franchises, manifest, year, league);
  const franchiseOfPage = clubs.map(({ page, file }) => {
    const franchise = FRANCHISE_OF[page.team];
    if (!franchise) throw new Error(`${file}: no franchise named ${page.team}`);
    const team = teams.find(t => t.franchise === franchise);
    if (!team) throw new Error(`${year} ${league}: ${page.team} is no club of the season's eras`);
    if ((NAME_AS[page.team] ?? page.team) !== team.name) throw new Error(`${year} ${league}: the site's ${page.team} is ${team.name} in the eras`);
    return franchise;
  });
  if (new Set(franchiseOfPage).size !== teams.length) throw new Error(`${year} ${league}: the site has ${clubs.length} clubs, the eras ${teams.length}`);
  // 1987's three strike games were played by replacement players: the season ranks the clubs' own players only. A
  // replacement player is one every game of whose was a strike game (the strike games' box scores name him as often as
  // he played), or one who played no more games than the strike had and for no club the season before or after (a box
  // score names no substitute without a statistic). The 1982 strike cancelled games instead; that season is ranked as
  // played.
  const boxScores = STRIKE_GAMES[year] && league === 'NFL' ? Object.keys(PINS).filter(file => file.startsWith(`${year}/box/`)).sort() : [];
  if (STRIKE_GAMES[year] && league === 'NFL' && !boxScores.length) throw new Error(`${year}: the strike games' box scores are not pinned (npm run fetch:pfa)`);
  const named = [];
  for (const file of boxScores) named.push(playersOfBoxScore(await pinned(file)));
  const games = new Map();
  for (const { page } of clubs) for (const r of page.roster) games.set(r.id, (games.get(r.id) ?? 0) + r.gp);
  const around = new Set(), aroundFiles = [];
  if (boxScores.length) {
    for (const side of [year - 1, year + 1]) {
      const { index: sideIndex, clubs: sideClubs } = await leagueSeason(side, league);
      aroundFiles.push(sideIndex, ...sideClubs.map(c => c.file));
      for (const { page } of sideClubs) for (const r of page.roster) if (r.gp > 0) around.add(r.id);
    }
  }
  const [from, to] = STRIKE_GAMES[year] ?? [];
  const strikeGames = Math.max(0, ...clubs.map(({ page }) => page.games.filter(g => g.date >= from && g.date <= to).length));
  const replaced = boxScores.length ? replacementPlayers([...games].map(([id, gp]) => ({ id, gp })), named, { strikeGames, around }) : new Set();
  const regular = replaced.size ? clubs.map(club => ({ ...club, page: { ...club.page, roster: club.page.roster.filter(r => !replaced.has(r.id)) } })) : clubs;
  const players = seasonPlayers(regular, club => franchiseOfPage[club], VALUE_WEIGHTS).filter(p => p.position !== 'P' && p.position !== 'LONG');
  const reference = rate(players, teams.length, madden);
  // The lineups, and the places a club has too few natural players for.
  const gaps = {};
  for (const team of teams) {
    const pool = players.filter(p => p.franchise === team.franchise).map(p => ({ name: p.name, pos: p.position, rating: p.overall }));
    const short = shortOf(pool);
    if (Object.keys(short).length) gaps[team.franchise] = short;
    squadOf(pool, `${year} ${team.name}`, { gaps: short });
  }
  const order = new Map(teams.map((team, i) => [team.franchise, i]));
  players.sort((a, b) => order.get(a.franchise) - order.get(b.franchise) || POSITIONS.indexOf(a.position) - POSITIONS.indexOf(b.position)
    || b.overall - a.overall || b.value - a.value || a.name.localeCompare(b.name));
  const clubFacts = Object.fromEntries(clubs.map(({ page, file }, i) => {
    const home = page.games.filter(g => g.site === 'H');
    const venues = {};
    for (const game of home) venues[game.venue] = (venues[game.venue] ?? 0) + 1;
    const counted = Object.fromEntries(Object.entries(venues).filter(([venue]) => venue !== SECOND_HOME[franchiseOfPage[i]]));
    const won = page.games.filter(g => g.for > g.against).length, lost = page.games.filter(g => g.for < g.against).length;
    const tied = page.games.length - won - lost;
    // A club plays where it played most of its home games that season: the eras' stadium must be that venue (or one of
    // those that shared them evenly).
    const most = Math.max(...Object.values(counted));
    const team = teams.find(t => t.franchise === franchiseOfPage[i]);
    if (!Object.entries(counted).some(([venue, n]) => n === most && isVenue(venue, team.stadium))) {
      throw new Error(`${year} ${team.name} played most home games elsewhere (${JSON.stringify(venues)}); the eras have ${team.stadium}`);
    }
    return [franchiseOfPage[i], { page: file, name: page.team, games: page.games.length, record: `${won}-${lost}${tied ? `-${tied}` : ''}`,
      for: page.games.reduce((t, g) => t + g.for, 0), against: page.games.reduce((t, g) => t + g.against, 0), venues }];
  }));
  const source = {
    site: SITE, league, season: year, compiler: 'Pro Football Archives (the facts); the overall ours', retrieved: RETRIEVED,
    clubs: teams.length, players: players.length,
    files: Object.fromEntries([index, ...clubs.map(c => c.file), ...boxScores, ...aroundFiles].map(file => [file, PINS[file]])),
    ...(replaced.size ? { replacement: { rule: `The replacement players of the strike games (${from} to ${to}, ${strikeGames} a club) are left out: those the games' box scores (the starters and every player with a statistic) name as often as they played, and those who played no more than ${strikeGames} games and for no club in ${year - 1} or ${year + 1}.`,
      boxScores: boxScores.length, players: replaced.size } } : {}),
    notes: clubs.flatMap(({ page, file }) => page.notes.map(note => `${file}: ${note}`)),
  };
  const conversion = {
    overall: `Ours, computed: no game rated this ${league} season. Each player's season value (his club's credit, its points per game against the league's to the power ${VALUE_WEIGHTS.team}, offence and defence apart, shared out: the offensive line by starts; quarterbacks, backs, receivers and tight ends by production, rushing and receiving yards, ${VALUE_WEIGHTS.pass} a passing yard, ${VALUE_WEIGHTS.td} a touchdown and less ${VALUE_WEIGHTS.int} an interception thrown, and by starts; defenders two thirds by starts and one third by plays, ${VALUE_WEIGHTS.sack} a sack where recorded, ${VALUE_WEIGHTS.pick} an interception, ${VALUE_WEIGHTS.recovery} a fumble recovered, ${VALUE_WEIGHTS.returnTd} a return touchdown; kickers by field goals, extra points and accuracy against the league) is ranked among the league-season's players at his game position (ties by starts, then games played) and read off Madden NFL 2002's overalls at that position (the 2001 season: maddenratings.net's 31 team spreadsheets, punters left out), as many of each Madden team's best as the season carries per club, by linear interpolation; rounded and held to 1–99. Facts from Pro Football Archives; the weights tuned once on 2001–2005 against the next season's Madden launch ratings, then frozen.`,
    weights: VALUE_WEIGHTS,
    calibration: { seasons: CALIBRATION, spearman: calibration.mean, mean: calibration.overall },
    reference: { game: 'Madden NFL 2002', season: 2001, positions: reference },
  };
  const rowOf = p => [p.name, p.franchise, p.codes.join('-'), p.position, p.overall, { id: p.id, ...(p.no ? { no: p.no } : {}), gp: p.gp, gs: p.gs,
    value: p.value, ...(p.played ? { played: p.played } : {}), ...(p.also ? { also: p.also } : {}) }];
  const head = {
    note: `The ${year} ${league} season, computed from Pro Football Archives' facts: every player of its ${teams.length} clubs who played a game but the punters and long snappers, as [name, franchise (scripts/data/nfl-teams.json), the site's positions, game position, overall, { id: the site's player page, no: jersey, gp: games, gs: starts, value, played: the position a kicker also played, also: other clubs that season }], written by scripts/sync-pfa.mjs. The overall is ours (conversion).`,
    source, conversion,
    teams: Object.fromEntries(teams.map(team => [team.franchise, { era: team.id, name: team.name, code: team.code }])),
    clubs: clubFacts,
    lineup: { needs: FORMATION, gaps },
  };
  const lines = Object.entries(head).map(([key, value]) => `  ${JSON.stringify(key)}: ${JSON.stringify(value)}`);
  const list = (key, items) => `  ${JSON.stringify(key)}: [${items.length ? `\n${items.map(item => `    ${JSON.stringify(item)}`).join(',\n')}\n  ` : ''}]`;
  return { text: `{\n${[...lines, list('players', players.map(rowOf))].join(',\n')}\n}\n`, players, gaps, teams };
}

async function main() {
  const args = process.argv.slice(2);
  const checkOnly = args.includes('--check');
  const only = args.find(arg => arg.startsWith('--season='))?.slice('--season='.length);
  const unknown = args.filter(arg => arg !== '--check' && arg !== '--tune' && !arg.startsWith('--season='));
  if (unknown.length) throw new Error(`Unknown option ${unknown[0]}`);
  const manifest = JSON.parse(await readFile(path.join(root, 'scripts/data/nfl-seasons.json'), 'utf8'));
  const franchises = JSON.parse(await readFile(path.join(root, 'scripts/data/nfl-teams.json'), 'utf8')).teams;
  const madden = maddenReferencePlayers(JSON.parse(await readFile(path.join(root, 'scripts/data/madden-seasons/2001.json'), 'utf8')));
  const seasons = await calibrationSeasons();
  if (args.includes('--tune')) {
    let best = null;
    const keys = Object.keys(GRID);
    const walk = async (i, weights) => {
      if (i === keys.length) { const result = await calibrate(weights, seasons); if (!best || result.overall > best.overall) best = { ...result, weights }; return; }
      for (const value of GRID[keys[i]]) await walk(i + 1, { ...weights, [keys[i]]: value });
    };
    await walk(0, { ...VALUE_WEIGHTS, team: 1 });
    console.log(`Best of the grid: ${JSON.stringify(best.weights)}, mean Spearman ${best.overall}: ${JSON.stringify(best.mean)}`);
    // The credit's power: the computed 2001 season's spread of club strengths nearest Madden NFL 2002's in width.
    const madden2001 = JSON.parse(await readFile(path.join(root, 'public/american-football/madden-2001.json'), 'utf8')).clubs.map(c => c.str);
    const width = list => Math.max(...list) - Math.min(...list);
    const tried = TEAM.map(team => ({ team, width: width(strengths(seasons[0].clubs, { ...best.weights, team }, madden)) }));
    const chosen = tried.reduce((a, b) => (Math.abs(b.width - width(madden2001)) < Math.abs(a.width - width(madden2001)) ? b : a));
    console.log(`Madden NFL 2002's 2001 clubs span ${width(madden2001).toFixed(1)}; computed: ${tried.map(t => `team ${t.team} ${t.width.toFixed(1)}`).join(', ')}; nearest: team ${chosen.team}`);
    return;
  }
  const calibration = await calibrate(VALUE_WEIGHTS, seasons);
  const jobs = [
    ...manifest.seasons.filter(year => manifest.sources[year]?.kind === 'pfa').map(year => ({ year, league: 'NFL', key: String(year) })),
    ...(manifest.afl?.seasons ?? []).map(year => ({ year, league: 'AFL', key: `afl-${year}` })),
  ].filter(job => !only || job.key === only);
  if (!jobs.length && only) throw new Error(`No computed season ${only}`);
  const outputs = [];
  // The spread of club strengths the credit's power gives the computed 2001 season, beside Madden NFL 2002's.
  const madden2001 = JSON.parse(await readFile(path.join(root, 'public/american-football/madden-2001.json'), 'utf8')).clubs.map(c => c.str);
  const span = list => [Math.min(...list), Math.max(...list)];
  const spreads = Object.fromEntries(TEAM.map(team => [team, span(strengths(seasons[0].clubs, { ...VALUE_WEIGHTS, team }, madden))]));
  outputs.push([path.join(outDir, 'calibration.json'), `${JSON.stringify({
    note: 'How well the computed seasons\' value orders each position as the next season\'s Madden launch ratings do (Spearman\'s rank correlation; ties by starts, then games), on the 2001 to 2005 seasons the weights were tuned on (Madden NFL 2003 to 07), by npm run sync:pfa. Players are matched by name, a name two Madden players share left out. `team`: the spread of the computed 2001 season\'s club strengths by the credit\'s power, beside Madden NFL 2002\'s spread of 2001\'s.',
    weights: VALUE_WEIGHTS, grid: GRID, mean: calibration.overall, positions: calibration.mean, seasons: calibration.per,
    team: { madden2002: span(madden2001), computed2001: spreads },
    files: Object.fromEntries(seasons.flatMap(s => [`${s.year}/${s.year}nfl.html`, ...s.files]).map(file => [file, PINS[file]])),
  }, null, 1)}\n`]);
  console.log(`Calibration on 2001–2005: mean Spearman ${calibration.overall} (${POSITIONS.map(p => `${p} ${calibration.mean[p]}`).join(', ')})`);
  for (const { year, league, key } of jobs) {
    const target = league === 'AFL' ? { ...manifest, ...manifest.afl, teams: manifest.teams } : manifest;
    const { text, players, gaps, teams } = await snapshotOf(year, league, target, franchises, madden, calibration);
    console.log(`${key}: ${teams.length} clubs, ${players.length} players; short: ${Object.entries(gaps).map(([f, g]) => `${f.replace('nfl-', '')} ${JSON.stringify(g)}`).join(', ') || 'none'}`);
    outputs.push([path.join(outDir, `${key}.json`), text]);
  }
  const differs = [];
  for (const [file, text] of outputs) {
    if (checkOnly) {
      const current = existsSync(file) ? (await readFile(file, 'utf8')).replace(/\r\n/g, '\n') : null;
      if (current !== text) differs.push(path.relative(root, file));
    } else {
      await mkdir(outDir, { recursive: true });
      await writeFile(file, text);
    }
  }
  if (differs.length) throw new Error(`differs: ${differs.join(', ')}`);
  console.log(checkOnly ? `Verified ${jobs.length} computed seasons and the calibration byte for byte.` : `Wrote ${jobs.length} computed seasons and the calibration to ${path.relative(root, outDir)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.stack || error.message); process.exit(1); });
}
