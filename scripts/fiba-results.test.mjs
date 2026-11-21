// FIBA's men's results of 2023–2026 (npm run sync:fiba-results: scripts/sync-fiba-results.mjs, scripts/lib/fiba-results.mjs)
// and basketball's national fives against them (scripts/lib/fiba-nations.mjs, docs/design/basketball-nations-audit.json;
// docs/design/euroleague.md, "The nations' level against FIBA's results"). Runs offline: the two checks that rebuild from
// data-src/ skip where it is missing (CI has none).
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { boxesOf, connectedSides, gamesOfPage, homeOf, isoDate, pageOf, resultsStrength, scoreOf } from './lib/fiba-results.mjs';
import { ANCHOR_SHARE, CURATED_SHARE, RULES, TOURNAMENTS, moveOf, nationOfName, regionOf } from './lib/fiba-nations.mjs';
import { ROSTERS } from '../src/data/rosters.basketball.js';

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const FACTS = JSON.parse(read('scripts/data/fiba-results.json'));
const SOURCES = JSON.parse(read('scripts/data/fiba-results-sources.json'));
const AUDIT = JSON.parse(read('docs/design/basketball-nations-audit.json'));
const root = fileURLToPath(new URL('../', import.meta.url));

// ---------- the pages ----------

/** A game box as Template:Basketballbox renders it (the tournaments' pages). */
const box = ({ date, a, score, b, venue }) => `<div style="width: 100%; " about="#mwt1"> <table style=" float:left; width:14%; table-layout:fixed">
 <tbody><tr><td style="border-style:none"><div style="text-align:center">${date}<br/><small> 16:00</small></div></td></tr> </tbody></table>
 <table style=" float:left; width:7%; table-layout:fixed"> <tbody><tr><td style="border-style:none"><div style="font-size:85%"><a href="x">Boxscore</a></div></td></tr> </tbody></table>
 <table style=" float:left; width:54%; text-align:center"> <tbody><tr style="vertical-align:top"> <td style="width:38%; text-align:right; border-style:none"><a href="https://en.wikipedia.org/wiki/T" title="T">${a}</a><span class="flagicon"><span> </span></span></td>
 <td style="width:20%; text-align:center; vertical-align:top; border-style:none">${score}</td>
 <td style="width:38%; text-align:left; border-style:none"><b><a href="https://en.wikipedia.org/wiki/U">${b}</a></b></td></tr>
 <tr style="vertical-align:top; font-size:85%"><td style="text-align:center; border-style:none" colspan="3"><b>Scoring by quarter:</b> 17–<b>23</b></td></tr> </tbody></table>
 <table style=" float:right; width:24%; table-layout:fixed"> <tbody><tr><td style="border-style:none"><div style="font-size:85%">${venue}<br/><b>Attendance:</b> 21,214</div></td></tr> </tbody></table><div style="clear:both"></div></div>`;
/** A game box as Template:Basketballbox collapsible renders it (the qualifiers' pages). */
const collapsible = ({ date, a, score, b, venue }) => `<span class="summary" style="display: none;">${a} v ${b}</span> <table cellspacing="1" class="mw-collapsible mw-collapsed" style="width: 100%">
 <tbody><tr> <td><span style="white-space:nowrap;float:right;margin-left:.5em">${date}</span></td> <td style="text-align:right;vertical-align:top" class="vcard attendee"><span class="fn org"><b><a href="x">${a}</a></b></span></td>
 <td style="text-align:center;vertical-align:top"><span style="white-space:nowrap; display:inline;">${score}</span></td> <td class="vcard attendee" valign="top"><span class="fn org"><a href="y">${b}</a></span></td>
 <th style="text-align:left;vertical-align:top;font-weight:normal"><span style="font-size:85%;">${venue}</span></th></tr> <tr><td>19:00</td></tr> </tbody></table>`;

test('a page names its revision, its own title and the title it was asked for when it redirected', () => {
  const html = '<script>RLCONF={"wgPageName":"FIBA_AfroBasket_2025","wgRevisionId":1314835605,"wgRedirectedFrom":"AfroBasket_2025"};</script>';
  assert.deepEqual(pageOf(html), { page: 'FIBA AfroBasket 2025', revision: 1314835605, redirectedFrom: 'AfroBasket 2025' });
  assert.throws(() => pageOf('<html></html>'), /names no revision/);
});

test('scores, overtimes, aggregates and dates read as the boxes give them', () => {
  assert.deepEqual(scoreOf('67–81'), { a: 67, b: 81, overtimes: 0 });
  assert.deepEqual(scoreOf('96–101 (OT)'), { a: 96, b: 101, overtimes: 1 });
  assert.deepEqual(scoreOf('106–102(2OT)'), { a: 106, b: 102, overtimes: 2 });
  assert.deepEqual(scoreOf('87–66(144–125 agg.)'), { a: 87, b: 66, overtimes: 0 }, 'a two-legged tie\'s aggregate is not the game\'s score');
  assert.equal(scoreOf('vs.'), null, 'a game not yet played');
  assert.throws(() => scoreOf('w/o'), /Not a score/);
  assert.equal(isoDate('25 August 2023'), '2023-08-25');
  assert.equal(isoDate('9 August 2025'), '2025-08-09');
  assert.throws(() => isoDate('2023-08-25'), /Not a date/);
});

test('both box layouts read in page order, a hidden padding figure out of the score', () => {
  const html = box({ date: '25 August 2023', a: 'Angola', score: '67<span typeof="mw:Entity">–</span><b>81</b>', b: 'Italy',
    venue: '<a href="p">Philippine Arena</a>, <a href="b">Bocaue</a>' })
    + collapsible({ date: '9 August 2025', a: 'Costa Rica', b: 'Jamaica', venue: '<a href="c">Ciudad Obregón</a>, Mexico',
      score: '76<span>–</span><b>80</b><span aria-hidden="true" style="visibility:hidden;color:transparent;">0</span>(OT)' })
    + collapsible({ date: '26 November 2026', a: 'Mexico', b: 'Spain', venue: 'Zacatecas', score: 'vs.' });
  assert.deepEqual(boxesOf(html), [
    { date: '25 August 2023', a: 'Angola', score: '67–81', b: 'Italy', venue: 'Philippine Arena, Bocaue' },
    { date: '9 August 2025', a: 'Costa Rica', score: '76–80(OT)', b: 'Jamaica', venue: 'Ciudad Obregón, Mexico' },
    { date: '26 November 2026', a: 'Mexico', score: 'vs.', b: 'Spain', venue: 'Zacatecas' },
  ]);
  const qualifiers = gamesOfPage(html, { id: 'wcq', kind: 'qualifiers' });
  assert.deepEqual(qualifiers.map(game => game.slice(0, 8)), [
    ['2023-08-25', 'wcq', 'Angola', 'Italy', 67, 81, 0, 'A'],
    ['2025-08-09', 'wcq', 'Costa Rica', 'Jamaica', 76, 80, 1, 'N'],
  ], 'the unplayed game is left out; Mexico, a side the page names, is neither side of the game: neutral');
});

test('home: a tournament\'s host cities, a qualifier\'s city alone or with its country', () => {
  const tournament = { kind: 'tournament', hosts: { Bocaue: 'Philippines', Jakarta: 'Indonesia' } };
  assert.equal(homeOf({ a: 'Dominican Republic', b: 'Philippines', venue: 'Philippine Arena, Bocaue' }, tournament), 'B');
  assert.equal(homeOf({ a: 'Angola', b: 'Italy', venue: 'Philippine Arena, Bocaue' }, tournament), 'N');
  assert.throws(() => homeOf({ a: 'Angola', b: 'Italy', venue: 'Arena, Elsewhere' }, tournament), /does not list/);
  const qualifiers = { kind: 'qualifiers' };
  const countries = new Set(['Latvia', 'Ukraine', 'Georgia', 'United States', 'Mexico']);
  assert.equal(homeOf({ a: 'Latvia', b: 'Georgia', venue: 'Riga' }, qualifiers, countries), 'A', 'a city alone: the first side\'s home');
  assert.equal(homeOf({ a: 'Ukraine', b: 'Georgia', venue: 'Riga, Latvia' }, qualifiers, countries), 'N', 'a home game played abroad');
  assert.equal(homeOf({ a: 'Ukraine', b: 'Latvia', venue: 'Riga, Latvia' }, qualifiers, countries), 'B');
  assert.equal(homeOf({ a: 'United States', b: 'Mexico', venue: 'Washington, D.C.' }, qualifiers, countries), 'A', 'D.C. is no country');
});

test('the weighted SRS finds known ratings and home edge, sums them to zero, and needs its sides joined', () => {
  const truth = { A: 9, B: 3, C: -4, D: -8 };
  const games = [];
  for (const a of Object.keys(truth)) for (const b of Object.keys(truth)) {
    if (a === b) continue;
    games.push({ a, b, scoreA: 80 + truth[a] - truth[b] + 4, scoreB: 80, home: 'A', weight: 1 });
    games.push({ a, b, scoreA: 80 + truth[a] - truth[b], scoreB: 80, home: 'N', weight: 3 });
  }
  const srs = resultsStrength(games);
  for (const [side, r] of Object.entries(truth)) assert.ok(Math.abs(srs.ratings[side] - r) < 1e-9, side);
  assert.ok(Math.abs(srs.homeEdge - 4) < 1e-9);
  assert.ok(srs.reliability > 0.99, 'no noise, every rating is sure');
  const fixed = resultsStrength(games, { homeEdge: 4 });
  assert.equal(fixed.homeEdge, 4);
  assert.ok(Math.abs(fixed.ratings.A - 9) < 1e-9);
  assert.throws(() => resultsStrength([...games.slice(0, 2), { a: 'X', b: 'Y', scoreA: 70, scoreB: 60, home: 'N', weight: 1 }]), /not all connected/);
  assert.deepEqual([...connectedSides([{ a: 'P', b: 'Q' }, { a: 'Q', b: 'R' }, { a: 'S', b: 'T' }], 'P')].sort(), ['P', 'Q', 'R']);
});

// ---------- the facts ----------

test('the facts: every game played of each competition, once, dated, scored and placed', () => {
  const count = {};
  for (const game of FACTS.games) count[game[1]] = (count[game[1]] ?? 0) + 1;
  // The 2023 World Cup's 92 (classification included), the Olympic qualifiers' four tournaments of nine, the Olympics'
  // 26, EuroBasket's 76, the AmeriCup's 26, AfroBasket's and the Asia Cup's 36 each, and the qualifiers played so far.
  assert.deepEqual(count, { wc2023: 92, oqt2024: 36, og2024: 26, eurobasket2025: 76, americup2025: 26, afrobasket2025: 36, asiacup2025: 36, wcq2027: 378 });
  const seen = new Set();
  for (const [date, competition, a, b, scoreA, scoreB, overtimes, home, venue] of FACTS.games) {
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(date) && date >= '2023-08-01' && date <= '2026-11-21', date);
    assert.ok(Object.hasOwn(FACTS.competitions, competition), competition);
    assert.ok(a && b && a !== b);
    assert.ok(Number.isInteger(scoreA) && Number.isInteger(scoreB) && scoreA > 20 && scoreB > 20 && scoreA !== scoreB, `${date} ${a} ${b}`);
    assert.ok(Number.isInteger(overtimes) && overtimes >= 0 && overtimes <= 3);
    assert.ok(['A', 'B', 'N'].includes(home));
    assert.ok(typeof venue === 'string' && venue.length > 2);
    const key = `${date}|${[a, b].sort().join('|')}`;
    assert.ok(!seen.has(key), `${key} twice`);
    seen.add(key);
  }
  // The tournaments' hosts at home: the Philippines in its own World Cup group, France at its Olympics.
  assert.ok(FACTS.games.some(g => g[1] === 'wc2023' && g[2] === 'Philippines' && g[3] === 'Italy' && g[7] === 'A'));
  assert.ok(FACTS.games.some(g => g[1] === 'og2024' && g[2] === 'France' && g[3] === 'United States' && g[7] === 'A' && g[4] === 87 && g[5] === 98));
  assert.ok(FACTS.games.some(g => g[1] === 'wc2023' && g[2] === 'Germany' && g[3] === 'Serbia' && g[4] === 83 && g[5] === 77 && g[7] === 'N'), 'the 2023 final');
});

test('every page is pinned at its revision, and every basketball nation is in the results', () => {
  assert.equal(SOURCES.pages.length, 34);
  assert.equal(FACTS.pages.length, SOURCES.pages.length);
  for (const page of SOURCES.pages) {
    assert.ok(Number.isInteger(page.revision) && page.revision > 0 && /^[0-9a-f]{64}$/.test(page.sha256) && page.bytes > 10000, page.title);
    assert.ok(Object.hasOwn(SOURCES.competitions, page.competition), page.title);
  }
  for (const [, , revision, address] of FACTS.pages) assert.ok(revision > 0 && address.startsWith('https://en.wikipedia.org/wiki/'));
  const named = new Set(FACTS.games.flatMap(game => [game[2], game[3]]).map(nationOfName).filter(Boolean));
  for (const id of Object.keys(ROSTERS)) assert.ok(named.has(id), `${id} plays a FIBA game of 2023–2026`);
  assert.equal(regionOf('036'), 'Asia');
  assert.equal(regionOf('554'), 'Asia', 'Australia and New Zealand play in FIBA Asia');
  assert.equal(regionOf('380'), 'Europe');
});

// ---------- the nations' level ----------

test('the audit: each nation\'s results against its five, the anchors\' relation, and the moves left unapplied while they predict worse', () => {
  assert.deepEqual(Object.keys(AUDIT.nations).sort(), Object.keys(ROSTERS).sort(), 'every fielded nation is placed');
  for (const n of Object.values(AUDIT.nations)) {
    assert.ok(['tournaments', 'qualifiers'].includes(n.from), n.name);
    assert.ok(Math.abs(n.stands - n.five - n.gap) < 0.02, n.name);
  }
  const anchors = Object.values(AUDIT.nations).filter(n => n.share <= ANCHOR_SHARE).map(n => n.name).sort();
  assert.deepEqual(AUDIT.line.anchors.slice().sort(), anchors, 'the anchors: fives the NBA and the EuroLeague rate but for one player at most');
  assert.ok(AUDIT.line.slope > 0 && AUDIT.srs.reliability > 0.8, JSON.stringify([AUDIT.line, AUDIT.srs]));
  // Only the nations no tournament rated come from the qualifiers.
  assert.deepEqual(Object.values(AUDIT.nations).filter(n => n.from === 'qualifiers').map(n => n.name).sort(), ['Netherlands', 'Ukraine']);
  assert.deepEqual(Object.keys(AUDIT.validation.rules), [...RULES]);
  assert.deepEqual(Object.keys(AUDIT.validation.rules.nation.leaveOneOut).filter(k => k !== 'all'), [...TOURNAMENTS]);
  // The decision rests on the validation: the method's moves score the held-out games worse than the ratings as they are.
  const { logLoss, brier } = AUDIT.validation.rules.nation.leaveOneOut.all;
  assert.ok(logLoss[1] > logLoss[0] && brier[1] > brier[0], `revisit the decision: ${JSON.stringify({ logLoss, brier })}`);
  assert.match(AUDIT.decision, /^not applied/);
});

test('a curated five lands on the relation; a mixed five\'s curated players move by its gap, the rest of it left to the others', () => {
  assert.equal(moveOf(-3, 1), -3);
  assert.ok(Math.abs(moveOf(2, 0.8) - 2.5) < 1e-12, 'four of five curated: the five lands on the relation');
  assert.equal(moveOf(4, 0.2), 4, 'one of five: he moves by the gap, the five by a fifth of it');
  assert.ok(CURATED_SHARE > ANCHOR_SHARE);
});

const hasPages = existsSync(new URL('../data-src/fiba-results/', import.meta.url));
test('the facts rebuild byte for byte from the pinned pages', { skip: !hasPages && 'data-src/fiba-results/ is not here' }, () => {
  execFileSync(process.execPath, ['scripts/sync-fiba-results.mjs', '--check'], { cwd: root, stdio: 'pipe' });
});

const has2k = existsSync(new URL('../data-src/bball-2karchive/', import.meta.url));
test('the rosters and the nations\' audit rebuild byte for byte', { skip: !has2k && 'data-src/bball-2karchive/ is not here' }, () => {
  execFileSync(process.execPath, ['scripts/build-basketball.mjs', '--check'], { cwd: root, stdio: 'pipe' });
});
