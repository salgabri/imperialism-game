// The computed NFL and AFL seasons (docs/design/american-football.md, "Computed seasons"): the reader of Pro Football
// Archives' team-season pages, its positions as the game's, the season value on invented clubs, the ranking and the
// mapping onto Madden NFL 2002 recomputed from each snapshot, every club's lineup or its documented gaps, the calibration
// as recorded (and held out on 2000), each snapshot's day of retrieval, and the snapshots rebuilt byte for byte where
// data-src/ has the pages (in data-src/pfa/ and a later download's data-src/pfa-<name>/).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { FORMATION, shortOf, squadOf } from './lib/nfl.mjs';
import { maddenReferencePlayers, overallsOf, referenceOf } from './lib/nfl-reference.mjs';
import { marginPerPoint, moveSeason, PER_POINT_GAMES, playedStrength, rounded } from './lib/nfl-results.mjs';
import { clubPagesOf, countOf, parseTeamSeason, placePlayers, playersOfBoxScore, positionOfCode, replacementPlayers, seasonGames, seasonValues,
  settleKickers, spearman, VALUE_WEIGHTS } from './lib/pfa.mjs';
import { mean, srsOf } from './lib/computed-ratings.mjs';
import { cacheFolders, copiesOf, STRIKE_GAMES } from './fetch-pfa.mjs';
import { ranked } from './sync-pfa.mjs';
import { seasonRules } from '../src/sports/americanFootball.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = file => readFileSync(path.join(root, file), 'utf8');
const MANIFEST = JSON.parse(read('scripts/data/nfl-seasons.json'));
const KEYS = [...MANIFEST.seasons.filter(year => MANIFEST.sources[year].kind === 'pfa').map(String), ...MANIFEST.afl.seasons.map(year => `afl-${year}`)];
const snapshotOf = key => JSON.parse(read(`scripts/data/pfa-seasons/${key}.json`));
const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'OL', 'DL', 'LB', 'CB', 'S', 'K'];

// ---------- a page made up as the site lays it out ----------

const td = text => `<td style="text-align:right">${text}</td>`;
const player = (id, name) => `<td style="text-align:left"><a href="/players/${id}.html">${name}</a></td>`;
const statTable = (title, heads, rows, totals = null) => `<div class="stats"><table><tr><th style="text-align:left">${title}</th>${heads.map(h => `<th>${h}</th>`).join('')}</tr>${
  rows.map(([id, name, values]) => `<tr>${player(id, name)}${values.map(td).join('')}</tr>`).join('')}${
  totals ? `<tr class="career"><td style="text-align:left">Team Totals</td>${totals.map(td).join('')}</tr>` : ''}</table></div>`;
const game = (kind, site, pf, pa, venue) => `<tr${kind ? ` class="${kind}"` : ''}><td>Sun</td><td>9/1/1965</td><td>${site}</td><td><a href="x.html">Opponent</a></td>${td(pf)}${td(pa)}<td>W</td><td></td><td>City, ST</td><td>${venue}</td>${td(40000)}</tr>`;
const page = ({ team = 'Green Bay Packers', league = 'NFL', games, roster, stats = '' }) => `<html><head><title>1965 ${team} (${league}) Scores, Roster, Stats - Pro Football Archives</title></head><body>
<div class="scores"><table><tr><th colspan="11" style="text-align:left">SCORES</th></tr><tr><th>Day</th><th>Date</th><th></th><th>Opponent</th><th colspan="4">Result</th><th>Location</th><th>Venue</th><th>Attendance</th></tr>${games.join('')}</table></div>
<div class="stats"><table><tr><th colspan="9" style="text-align:left">ROSTER</th></tr><tr><th>Player</th><th>No</th><th>Pos</th><th>Ht</th><th>Wt</th><th>Age</th><th>College</th><th>GP</th><th>GS</th></tr>${
  roster.map(([id, name, no, pos, gp, gs]) => `<tr>${player(id, name)}${td(no)}<td>${pos}</td><td>6-1</td>${td(200)}${td(25)}<td>State</td>${td(gp)}${td(gs)}</tr>`).join('')}</table></div>
<div class="stats"><table><tr><th colspan="5" style="text-align:left">DRAFT LIST</th></tr><tr><th>Round</th><th>Overall</th><th>Player</th><th>Pos</th><th>College</th></tr><tr>${td(1)}${td(7)}${player('d/draft001', 'Donny Draftee')}<td>HB</td><td>Texas Tech</td></tr></table></div>
${stats}</body></html>`;

test('a team-season page gives the regular season\'s games, the roster with its starts and the stat tables, not the draft', () => {
  const parsed = parseTeamSeason(page({
    games: [game('exh', 'H', 44, 7, 'Lambeau Field'), game('', 'H', 20, 17, 'Lambeau Field'), game('', 'A', 10, 31, 'Wrigley Field'),
      game('', 'H', 13, 3, 'County Stadium'), game('playoff', 'H', 23, 12, 'Lambeau Field')],
    roster: [['s/star03200', 'Bart Starr', 15, 'QB', 3, 3], ['c/caff00200', 'Lee Roy Caffey', 60, 'RLB-MLB', 3, 3],
      ['m/moor13000', 'Tom Moore', 25, 'HB-FB', '3TOM MOORE', 1], ['c/chan00800', 'Don Chandler', 34, 'P-K', 3, 0]],
    stats: statTable('RUSHING', ['ATT', 'YDS', 'TD'], [['m/moor13000', 'Tom Moore', [51, 124, 0]]], [86, 316, 2])
      + statTable('FIELD GOALS', ['MADE', 'ATT', 'PCT'], [['c/chan00800', 'Don Chandler', [17, 26, '65.4']]], [17, 26, '65.4']),
  }));
  assert.deepEqual([parsed.year, parsed.team, parsed.league], [1965, 'Green Bay Packers', 'NFL']);
  assert.deepEqual(parsed.games.map(g => [g.site, g.for, g.against, g.venue]), [['H', 20, 17, 'Lambeau Field'], ['A', 10, 31, 'Wrigley Field'],
    ['H', 13, 3, 'County Stadium']], 'exhibition and playoff games are not the season');
  assert.deepEqual(parsed.games.map(g => g.opponentPage), ['x.html', 'x.html', 'x.html'], 'each game names its opponent\'s page');
  assert.deepEqual(parsed.roster.map(r => [r.name, r.positions, r.gp, r.gs]), [['Bart Starr', ['QB'], 3, 3],
    ['Lee Roy Caffey', ['RLB', 'MLB'], 3, 3], ['Tom Moore', ['HB', 'FB'], 3, 1], ['Don Chandler', ['P', 'K'], 3, 0]]);
  assert.ok(!parsed.roster.some(r => r.name === 'Donny Draftee'), 'the draft list is not the roster');
  assert.deepEqual(parsed.notes, ['Tom Moore: GP reads "3TOM MOORE"'], 'the site\'s slip is read past and noted');
  assert.deepEqual(parsed.stats.RUSHING['m/moor13000'], { ATT: 51, YDS: 124, TD: 0 });
  assert.deepEqual(parsed.totals.RUSHING.team, { ATT: 86, YDS: 316, TD: 2 });
  assert.deepEqual([countOf('12'), countOf(''), countOf('4.5'), countOf('-3'), countOf('47t')], [12, 0, 4.5, -3, 47]);
  assert.deepEqual(clubPagesOf('<a href="1965aflbuf.html">x</a><a href="/1965aflnyj.html">y</a><a href="1965aflbuf.html">x</a><a href="1965afldraft.html">d</a><a href="1965afl-boxscores.html">b</a>', 1965, 'afl'),
    ['1965aflbuf.html', '1965aflnyj.html']);
});

test('a stray note after a player\'s name is cut: a name holds no digit or question mark', () => {
  // The 1981 Dolphins' page names "Bob Baumhower 9SK?" (scripts/lib/pfa.mjs); a nickname in quotes is his own.
  const parsed = parseTeamSeason(page({ games: [game('', 'H', 20, 17, 'Field')],
    roster: [['b/baum01000', 'Bob Baumhower 9SK?', 73, 'NT', 1, 1], ['j/jone08000', 'Ed "Too Tall" Jones', 72, 'RDE', 1, 1],
      ['s/smit00100', 'Bubba Smith', 78, 'LDE', 1, 1]] }));
  assert.deepEqual(parsed.roster.map(r => r.name), ['Bob Baumhower', 'Ed "Too Tall" Jones', 'Bubba Smith']);
});

test('the site\'s positions are the game\'s: LS and RS are safeties, flankers and ends receivers, slips read as meant', () => {
  assert.deepEqual(['LS', 'RS', 'FL', 'SE', 'OE', 'HB', 'FB', 'LOT', 'ROG', 'C', 'LDE', 'MG', 'RLB', 'WLB', 'LCB', 'DB', 'HBK', 'K', 'P', 'LONG']
    .map(positionOfCode), ['S', 'S', 'WR', 'WR', 'WR', 'RB', 'RB', 'OL', 'OL', 'OL', 'DL', 'DL', 'LB', 'LB', 'CB', 'CB', 'TE', 'K', 'P', 'LONG']);
  assert.deepEqual(['Fl', 'mLB', 'lCB', 'RCB=LCB', 'ROG0LOT', 'LOG0LOT', 'RDTLDE', 'RO0', 'D'].map(positionOfCode), ['WR', 'LB', 'CB', 'CB', 'OL', 'OL', 'DL', 'OL', 'DL']);
  assert.deepEqual(['NG', 'UBK', 'WS', 'SILB', 'RHB', 'KR'].map(positionOfCode), ['DL', 'TE', 'S', 'LB', 'RB', 'KR'], 'nose guards, U-backs, weak safeties; kick returners have no place');
  assert.throws(() => positionOfCode('XYZ'), /Unknown position XYZ/);
});

test('a kicker who also played a position is listed once, at his larger share; nobody who played no game is listed', () => {
  const parsed = parseTeamSeason(page({
    games: [1, 2, 3, 4].map(() => game('', 'H', 20, 10, 'Field')),
    roster: [['b/blan', 'George Blanda', 16, 'QB-K', 4, 4], ['c/capp', 'Gino Cappelletti', 20, 'FL-K', 4, 1], ['g/groz', 'Lou Groza', 76, 'OT', 4, 0],
      ['c/chan', 'Don Chandler', 34, 'P-K', 4, 0], ['n/none', 'Never Played', 99, 'LB', 0, 0]],
    stats: statTable('FIELD GOALS', ['MADE', 'ATT'], [['b/blan', 'George Blanda', [5, 9]], ['c/capp', 'Gino Cappelletti', [8, 12]],
      ['g/groz', 'Lou Groza', [3, 4]], ['c/chan', 'Don Chandler', [2, 3]]]),
  }));
  assert.deepEqual(placePlayers(parsed).map(p => [p.name, p.position, p.kicks]), [['George Blanda', 'QB', true], ['Gino Cappelletti', 'WR', true],
    ['Lou Groza', 'OL', true], ['Don Chandler', 'K', true]], 'a punter who kicked is a kicker; the others keep their position, and kick too');
  // Where his value stands higher among every player who could be there: Blanda's quarterbacking, Groza's kicking.
  const players = [{ name: 'George Blanda', position: 'QB', value: 30, kickValue: 10 }, { name: 'Lou Groza', position: 'OL', value: 2, kickValue: 25 },
    { name: 'Other QB', position: 'QB', value: 10 }, { name: 'Third QB', position: 'QB', value: 20 }, { name: 'Line', position: 'OL', value: 12 },
    { name: 'Kicker', position: 'K', value: 15 }, { name: 'Second kicker', position: 'K', value: 5 }];
  assert.deepEqual(settleKickers(players).map(p => [p.name, p.position, p.value, p.played ?? null]), [['George Blanda', 'QB', 30, null],
    ['Lou Groza', 'K', 25, 'OL'], ['Other QB', 'QB', 10, null], ['Third QB', 'QB', 20, null], ['Line', 'OL', 12, null], ['Kicker', 'K', 15, null],
    ['Second kicker', 'K', 5, null]]);
});

test('the value shares each club\'s credit: the line by starts, defenders mostly by starts, every league its own mean', () => {
  const club = (team, pf, pa, roster, stats = '') => parseTeamSeason(page({ team, games: [1, 2].map(() => game('', 'H', pf, pa, 'Field')), roster, stats }));
  const roster = [['a/ol1', 'Line One', 70, 'LOT', 2, 2], ['a/ol2', 'Line Two', 71, 'ROT', 2, 1], ['a/de1', 'End One', 80, 'LDE', 2, 2],
    ['a/de2', 'End Two', 81, 'RDE', 2, 2], ['a/qb', 'Quarter Back', 12, 'QB', 2, 2]];
  const picks = statTable('INTERCEPTIONS', ['INT', 'YDS', 'TD'], [['a/de2', 'End Two', [1, 10, 0]]]);
  const pass = statTable('PASSING', ['ATT', 'YDS', 'TD', 'INT'], [['a/qb', 'Quarter Back', [20, 300, 2, 1]]]);
  const strong = club('Strong', 30, 10, roster, picks + pass), weak = club('Weak', 10, 30, roster.map(r => [r[0].replace('a/', 'b/'), ...r.slice(1)]), pass.replace('a/qb', 'b/qb'));
  const values = seasonValues([strong, weak]);
  const of = (club, name) => values.find(v => v.club === club && v.name === name).value;
  assert.ok(of(0, 'Line One') > of(0, 'Line Two'), 'a lineman\'s share is his starts');
  assert.equal(of(0, 'Line One') / of(0, 'Line Two'), 2);
  assert.ok(of(0, 'Line One') > of(1, 'Line One'), 'a club that scores more credits its line more');
  assert.ok(of(0, 'End Two') > of(0, 'End One'), 'a defender\'s plays add to his starts');
  const credit = (pf, league) => (pf / league) ** VALUE_WEIGHTS.team;
  // The offensive line holds the club's offensive credit by starts: each starter of every game 1/5 of it.
  assert.ok(Math.abs(of(0, 'Line One') - 100 * credit(30, 20) * 2 / (5 * 2)) < 1e-6);
  // Each league's mean apart: the same club in a league of weaker clubs is credited more.
  const alone = seasonValues([strong, club('Weaker', 5, 40, roster.map(r => [r[0].replace('a/', 'c/'), ...r.slice(1)]))]);
  assert.ok(alone.find(v => v.club === 0 && v.name === 'Line One').value > of(0, 'Line One'));
});

test('a replacement player of 1987 played strike games only, by their box scores, or a few games and no other season', () => {
  const box = ids => playersOfBoxScore(ids.map(id => `<a href="/players/${id}.html">x</a>`).join('') + '<a href="/players/a/aaaa00100.html">x</a>');
  assert.deepEqual(box(['k/kell00800']), ['k/kell00800', 'a/aaaa00100'], 'every player a box score names, once');
  const scores = [box(['r/repl00100', 'c/cros00100']), box(['r/repl00100']), box(['r/repl00100', 'c/cros00100'])];
  const players = [{ id: 'r/repl00100', gp: 3 }, { id: 'c/cros00100', gp: 12 }, { id: 'k/kell00800', gp: 12 }, { id: 'b/brie00100', gp: 1 }];
  assert.deepEqual([...replacementPlayers(players, scores, { strikeGames: 3, around: new Set(['b/brie00100']) })], ['r/repl00100'],
    'three strike games of three played: a replacement; one who crossed the line and played the rest is the club\'s own; one in no strike game who played in 1986 or 1988 too');
  assert.deepEqual([...replacementPlayers([...players, { id: 'u/unna00100', gp: 2 }], scores, { strikeGames: 3, around: new Set(['b/brie00100']) })],
    ['r/repl00100', 'u/unna00100'], 'two games, in no box score and no other season: a substitute of the strike games');
});

test('a season\'s games are read once each, every club\'s points from its own page, the strike\'s left out where asked', () => {
  const on = (date, site, opponent, pf, pa) => `<tr><td>Sun</td><td><a href="/nflboxscores1/x.html">${date}</a></td><td>${site}</td><td><a href="${opponent}">Opponent</a></td>${td(pf)}${td(pa)}<td>W</td><td></td><td>City, ST</td><td>Field</td>${td(40000)}</tr>`;
  const club = (team, rows) => parseTeamSeason(page({ team, games: rows, roster: [] }));
  const a = club('Green Bay Packers', [on('9/19/1965', 'H', '1965nflb.html', 20, 17), on('9/26/1965', 'A', '1965nflb.html', 10, 31),
    on('10/3/1965', 'N', '1965nflb.html', 13, 3), on('10/10/1965', 'H', '1965nflb.html', 24, 0)]);
  const b = club('Chicago Bears', [on('9/19/1965', 'A', '1965nfla.html', 17, 20), on('9/26/1965', 'H', '1965nfla.html', 31, 10),
    on('10/3/1965', 'N', '1965nfla.html', 3, 13), on('10/10/1965', 'A', '1965nfla.html', 9, 24)]);
  const clubs = [{ file: '1965nfla.html', page: a }, { file: '1965nflb.html', page: b }];
  const clubOf = file => ({ '1965nfla.html': 'gb', '1965nflb.html': 'chi' })[file];
  const { games, slips } = seasonGames(clubs, clubOf);
  assert.deepEqual(games, [
    { date: '1965-09-19', home: 'gb', away: 'chi', homeScore: 20, awayScore: 17 },
    { date: '1965-09-26', home: 'chi', away: 'gb', homeScore: 31, awayScore: 10 },
    { date: '1965-10-03', home: 'gb', away: 'chi', homeScore: 13, awayScore: 3, neutral: true },
    { date: '1965-10-10', home: 'gb', away: 'chi', homeScore: 24, awayScore: 9 },
  ], 'each game once; the home club\'s; the 24–0 slip read as each club\'s own points, 24–9');
  assert.deepEqual(slips, ['1965-10-10: 1965nfla.html reads 24–0, 1965nflb.html 9–24; each club\'s own points kept']);
  assert.deepEqual(seasonGames(clubs, clubOf, { leave: ['1965-09-26', '1965-10-03'] }).games.map(g => g.date), ['1965-09-19', '1965-10-10']);
  const lonely = [{ file: '1965nfla.html', page: club('Green Bay Packers', [on('9/19/1965', 'H', '1965nflb.html', 20, 17)]) },
    { file: '1965nflb.html', page: club('Chicago Bears', []) }];
  assert.throws(() => seasonGames(lonely, clubOf), /1965nfla\.html has a game on 1965-09-19 that 1965nflb\.html does not/);
  const both = [{ file: '1965nfla.html', page: club('Green Bay Packers', [on('9/19/1965', 'H', '1965nflb.html', 20, 17)]) },
    { file: '1965nflb.html', page: club('Chicago Bears', [on('9/19/1965', 'H', '1965nfla.html', 17, 20)]) }];
  assert.throws(() => seasonGames(both, clubOf), /sites H and H/);
  assert.throws(() => seasonGames([clubs[0]], clubOf), /is no club of the season/);
});

test('the strength the match model plays is its lineup\'s offence and defence; m is the margin a point of it is worth', () => {
  const snapshot = snapshotOf('1977');
  const pool = snapshot.players.filter(p => p[1] === 'nfl-dallas-cowboys').map(([name, , , pos, rating]) => ({ name, pos, rating }));
  const { squad } = squadOf(pool, '1977 Dallas Cowboys');
  const up = squad.map(p => ({ ...p, rating: p.rating + 1 }));
  assert.ok(Math.abs(playedStrength(up) - playedStrength(squad) - 1) < 1e-9, 'a point for every player is a point of strength');
  const rules = seasonRules('NFL', 1977);
  const m = marginPerPoint(rules, 'pfa-move:1977', 4000);
  assert.ok(m > 1.4 && m < 2, `about two points of margin a point of strength, both sides' drives counted: ${m}`);
  assert.equal(marginPerPoint(rules, 'pfa-move:1977', 4000), m, 'the same seed, the same margin');
});

test('ties are broken by starts, then games; the mapping onto Madden NFL 2002 stays within 1–99 and never falls', () => {
  const players = [{ value: 5, gs: 3, gp: 10 }, { value: 5, gs: 4, gp: 9 }, { value: 5, gs: 4, gp: 12 }, { value: 2, gs: 9, gp: 9 }, { value: 5, gs: 4, gp: 12 }];
  const rank = ranked(players);
  assert.deepEqual(players.map(p => rank.get(p)), [2, 3, 4, 1, 4]);
  const overall = overallsOf([1, 2, 3, 4, 4], [40, 60, 80, 99]);
  assert.deepEqual([1, 2, 3, 4].map(r => overall.get(r)), [40, 54, 70, 93], 'mid-rank percentiles read off the reference');
  // The calibration's rank correlation: ties share a mid-rank.
  assert.equal(spearman([1, 2, 3, 4], [10, 20, 30, 40]), 1);
  assert.equal(spearman([1, 2, 3, 4], [40, 30, 20, 10]), -1);
  assert.equal(spearman([1, 2, 2, 3], [1, 2, 3, 4]), 0.949);
});

test('the pages of a later download, in a data-src/pfa-<name>/ of their own, are read beside data-src/pfa/', t => {
  const base = mkdtempSync(path.join(tmpdir(), 'pfa-folders-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  for (const file of ['pfa-1998-2000/1998/1998nfl.html', 'pfa/1997/1997nfl.html', 'pfaroster/1999/1999nfl.html', 'madden-seasons/x.html']) {
    mkdirSync(path.dirname(path.join(base, file)), { recursive: true });
    writeFileSync(path.join(base, file), '');
  }
  const folders = cacheFolders(base);
  assert.deepEqual(folders.map(folder => path.basename(folder)), ['pfa', 'pfa-1998-2000'], 'data-src/pfa/ first; nothing else');
  assert.deepEqual(copiesOf('1997/1997nfl.html', folders).map(file => path.relative(base, file)), [path.join('pfa', '1997', '1997nfl.html')]);
  assert.deepEqual(copiesOf('1998/1998nfl.html', folders).map(file => path.relative(base, file)), [path.join('pfa-1998-2000', '1998', '1998nfl.html')]);
  assert.deepEqual(copiesOf('1999/1999nfl.html', folders), []);
});

// ---------- the snapshots ----------

const MADDEN_2002 = maddenReferencePlayers(JSON.parse(read('scripts/data/madden-seasons/2001.json')));
/**
 * Each player's overall as read off Madden NFL 2002, before his club's move: his rank at his position by value, starts and
 * games, read off the snapshot's reference (checked against Madden NFL 2002's own). → Map row → rating.
 */
function readOff(key, snapshot) {
  const clubs = Object.keys(snapshot.teams).length;
  const rated = new Map();
  for (const position of POSITIONS) {
    const at = snapshot.players.filter(p => p[3] === position).map(p => ({ row: p, value: p[5].value, gs: p[5].gs, gp: p[5].gp }));
    const reference = snapshot.conversion.reference.positions[position];
    assert.deepEqual(reference.madden, referenceOf(MADDEN_2002, position, at.length / clubs), `${key} ${position}`);
    const rank = ranked(at);
    const overall = overallsOf(at.map(p => rank.get(p)), reference.madden);
    for (const p of at) rated.set(p.row, overall.get(rank.get(p)));
    const order = at.slice().sort((a, b) => rank.get(a) - rank.get(b));
    assert.ok(order.every((p, i) => !i || rated.get(p.row) >= rated.get(order[i - 1].row)), `${key} ${position}: never falls as the value rises`);
  }
  return rated;
}
/** A snapshot's games as srsOf reads them. */
const gamesOf = snapshot => snapshot.games.map(([date, home, away, homeScore, awayScore, site]) => ({ date, home, away, homeScore, awayScore,
  ...(site === 'N' ? { neutral: true } : {}) }));

test('every computed season is recomputed from its snapshot: ranks read off Madden NFL 2002, then each club moved whole', () => {
  assert.equal(KEYS.length, 36 + 10, 'NFL 1960–1989, 1991 and 1996–2000; the AFL 1960–1969');
  for (const key of KEYS) {
    const snapshot = snapshotOf(key);
    assert.deepEqual(snapshot.conversion.weights, VALUE_WEIGHTS, `${key}: the frozen weights`);
    assert.match(snapshot.conversion.overall, /^Ours, computed/);
    assert.match(snapshot.conversion.overall, /T = μ \+ √r × S ÷ m/);
    assert.match(snapshot.conversion.overall, /The results count twice, by design/, `${key}: the credit and the move both read the results, and say so`);
    const rated = readOff(key, snapshot);
    assert.deepEqual(Object.keys(snapshot.moves), Object.keys(snapshot.teams), `${key}: every club moved`);
    for (const [franchise, move] of Object.entries(snapshot.moves)) {
      // Every player by the club's shift, its best `plus` (by the read-off, then the snapshot's order) by one more.
      const rows = snapshot.players.filter(p => p[1] === franchise);
      const best = rows.map((row, index) => ({ row, index })).sort((a, b) => rated.get(b.row) - rated.get(a.row) || a.index - b.index);
      best.forEach(({ row }, place) => {
        assert.equal(row[4], Math.min(99, Math.max(1, rated.get(row) + move.shift + (place < move.plus ? 1 : 0))), `${key} ${row[0]}`);
      });
      assert.ok(move.plus >= 0 && move.plus < rows.length, `${key} ${franchise}: ${move.plus} of ${rows.length} one more`);
      for (const a of rows) {
        for (const b of rows) assert.ok(!(rated.get(a) > rated.get(b)) || a[4] >= b[4], `${key} ${franchise}: ${a[0]} never falls below ${b[0]}`);
      }
    }
  }
});

test('each club moves to the target its results set, T = μ + √r × S ÷ m, recomputed from the snapshot\'s games', () => {
  const two = x => rounded(x, 2);
  for (const key of KEYS) {
    const snapshot = snapshotOf(key);
    const { move } = snapshot.conversion;
    const games = gamesOf(snapshot);
    assert.equal(games.length, move.games, key);
    // S and its reliability from the games; the AFL's clubs rated within the AFL, its games its own clubs'.
    const srs = srsOf(games);
    assert.deepEqual(Object.keys(srs.ratings).sort(), Object.keys(snapshot.teams).sort(), key);
    assert.deepEqual([two(srs.homeEdge), two(srs.sigma), rounded(srs.reliability, 3)], [move.srs.homeEdge, move.srs.sigma, move.srs.reliability], key);
    // The strength the match model plays each club at, before (the read-off) and after (the snapshot's overall) its move.
    const rated = readOff(key, snapshot);
    const strengthOf = (franchise, rating) => playedStrength(squadOf(snapshot.players.filter(p => p[1] === franchise)
      .map(row => ({ name: row[0], pos: row[3], rating: rating(row) })), `${key} ${franchise}`, { gaps: snapshot.lineup.gaps[franchise] ?? {} }).squad);
    const before = Object.fromEntries(Object.keys(snapshot.teams).map(f => [f, strengthOf(f, row => rated.get(row))]));
    const level = mean(Object.values(before));
    assert.equal(two(level), move.mean, key);
    assert.ok(Math.abs(move.scale - Math.sqrt(srs.reliability) / move.perPoint) < 1e-4, key);
    for (const [franchise, club] of Object.entries(snapshot.moves)) {
      const target = level + Math.sqrt(srs.reliability) / move.perPoint * srs.ratings[franchise];
      const after = strengthOf(franchise, row => row[4]);
      assert.deepEqual([club.srs, club.target, club.before, club.after], [two(srs.ratings[franchise]), two(target), two(before[franchise]), two(after)],
        `${key} ${franchise}`);
      assert.ok(Math.abs(after - target) < 0.25, `${key} ${franchise}: within a step of its target (${JSON.stringify(club)})`);
    }
  }
  // The whole search replayed on seasons of each era, both leagues and the strike: no other move lands nearer.
  for (const key of ['1960', '1965', '1977', '1987', '1991', '2000', 'afl-1960', 'afl-1969']) {
    const snapshot = snapshotOf(key);
    const rated = readOff(key, snapshot);
    const pools = Object.fromEntries(Object.keys(snapshot.teams).map(franchise => [franchise, snapshot.players.filter(p => p[1] === franchise)
      .map(row => ({ name: row[0], pos: row[3], rating: rated.get(row) }))]));
    const result = moveSeason({ pools, gaps: snapshot.lineup.gaps, games: gamesOf(snapshot), perPoint: snapshot.conversion.move.perPoint, label: key });
    assert.deepEqual(result.clubs, snapshot.moves, `${key}: each club's move`);
    for (const [franchise, pool] of Object.entries(result.pools)) {
      assert.deepEqual(pool.map(p => p.rating), snapshot.players.filter(p => p[1] === franchise).map(p => p[4]), `${key} ${franchise}`);
    }
  }
});

test('m is measured as recorded; the 1987 strike\'s replacement games are left out of the results, as their players are', () => {
  for (const key of ['1965', 'afl-1965', '2000']) {
    const { move, reference } = snapshotOf(key).conversion;
    assert.equal(move.perPointGames, 4 * PER_POINT_GAMES);
    assert.equal(move.seed, `pfa-move:${key}`);
    const league = key.startsWith('afl-') ? 'AFL' : 'NFL', year = Number(key.replace('afl-', ''));
    assert.equal(marginPerPoint(seasonRules(league, year), move.seed), move.perPoint, key);
    assert.ok(reference.game === 'Madden NFL 2002');
  }
  const strike = snapshotOf('1987');
  assert.deepEqual(strike.conversion.move.left, STRIKE_GAMES[1987]);
  assert.ok(strike.games.every(([date]) => date < STRIKE_GAMES[1987][0] || date > STRIKE_GAMES[1987][1]));
  assert.equal(strike.games.length, 28 * 12 / 2, 'twelve games a club of the fifteen played');
  assert.ok(KEYS.filter(key => key !== '1987').every(key => !snapshotOf(key).conversion.move.left));
});

test('every club fields its lineup, or exactly the gaps its snapshot documents; the AFL\'s clubs only in AFL seasons', () => {
  for (const key of KEYS) {
    const snapshot = snapshotOf(key);
    assert.deepEqual(snapshot.lineup.needs, FORMATION);
    for (const franchise of Object.keys(snapshot.teams)) {
      const pool = snapshot.players.filter(p => p[1] === franchise).map(([name, , , pos, rating]) => ({ name, pos, rating }));
      assert.deepEqual(shortOf(pool), snapshot.lineup.gaps[franchise] ?? {}, `${key} ${franchise}`);
    }
    assert.equal(snapshot.source.league, key.startsWith('afl-') ? 'AFL' : 'NFL');
  }
  const afl = new Set(Object.keys(snapshotOf('afl-1965').teams)), nfl = new Set(Object.keys(snapshotOf('1965').teams));
  assert.deepEqual([...afl].filter(f => nfl.has(f)), [], 'no club in both leagues');
  assert.deepEqual([afl.size, nfl.size], [8, 14]);
});

test('the calibration holds as recorded: the frozen weights on 2001–2005 against the next season\'s Madden', () => {
  const calibration = JSON.parse(read('scripts/data/pfa-seasons/calibration.json'));
  assert.deepEqual(calibration.weights, VALUE_WEIGHTS);
  assert.ok(calibration.mean >= 0.75, `mean Spearman ${calibration.mean}`);
  for (const position of ['QB', 'WR', 'LB', 'CB']) assert.ok(calibration.positions[position] >= 0.78, `${position} ${calibration.positions[position]}`);
  for (const position of POSITIONS) assert.ok(calibration.positions[position] >= 0.6, `${position} ${calibration.positions[position]}`);
  // The credit's power is the one whose 2001 spread of club strengths is nearest Madden NFL 2002's in width.
  const width = ([low, high]) => high - low;
  const nearest = Object.entries(calibration.team.computed2001).reduce((a, b) => (Math.abs(width(b[1]) - width(calibration.team.madden2002))
    < Math.abs(width(a[1]) - width(calibration.team.madden2002)) ? b : a));
  assert.equal(Number(nearest[0]), VALUE_WEIGHTS.team);
  for (const key of KEYS) assert.equal(snapshotOf(key).conversion.calibration.mean, calibration.mean);
  // Out of sample: 2000, which the weights were not tuned on, against Madden NFL 2002 orders its players nearly as well.
  assert.deepEqual(Object.values(calibration.holdout.seasons).flat().map(row => row.season), POSITIONS.map(() => 2000));
  assert.ok(calibration.holdout.mean >= 0.7, `held out: mean Spearman ${calibration.holdout.mean}`);
  for (const position of POSITIONS) assert.ok(calibration.holdout.positions[position] >= 0.6, `held out: ${position} ${calibration.holdout.positions[position]}`);
  // The credit was kept beside the move: without it the players order worse, tuned and held out.
  assert.ok(calibration.withoutCredit.mean < calibration.mean, `without the credit ${calibration.withoutCredit.mean}`);
  assert.ok(calibration.withoutCredit.holdout.mean < calibration.holdout.mean, `held out without the credit ${calibration.withoutCredit.holdout.mean}`);
});

test('each snapshot says on which day its pages were saved: 1998 to 2000 a day after the rest', () => {
  const { retrieved } = JSON.parse(read('scripts/data/pfa-pages.json'));
  const dayOf = year => Object.keys(retrieved).find(day => retrieved[day].includes(year));
  for (const key of KEYS) {
    const { source } = snapshotOf(key);
    assert.equal(source.retrieved, dayOf(source.season), key);
    assert.ok(Object.keys(source.files).every(file => dayOf(Number(file.slice(0, 4))) === source.retrieved), `${key}: every page it read`);
  }
  assert.deepEqual(['1997', '1998', '1999', '2000', '2001'].map(key => key === '2001' ? dayOf(2001) : snapshotOf(key).source.retrieved),
    ['2026-11-09', '2026-11-10', '2026-11-10', '2026-11-10', '2026-11-09']);
});

test('every snapshot and the calibration rebuild byte for byte from the pinned pages', t => {
  const pins = JSON.parse(read('scripts/data/pfa-pages.json')).files;
  const missing = Object.keys(pins).filter(file => !copiesOf(file).length);
  if (missing.length) { t.skip(`data-src/pfa*/ lack ${missing.length} pinned pages (${missing[0]} …): the rebuild runs where they are`); return; }
  assert.match(execFileSync(process.execPath, ['scripts/sync-pfa.mjs', '--check'], { cwd: root, encoding: 'utf8' }),
    /Verified 46 computed seasons and the calibration byte for byte/);
});
