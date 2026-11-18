// The roster audit (scripts/lib/roster-audit.mjs, docs/design/roster-audit.md): its checks on invented players, and
// every season of every sport the game offers, read as a campaign reads it, which must hold no error.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILT_IN_SETS } from '../src/engine/footballSets.js';
import { SPORT_LIST } from '../src/sports/index.js';
import {
  AGE_IMPOSSIBLE, AGE_UNUSUAL, CHECKS, HANDLES, acrossSeasons, ageOn, auditReport, auditRosters, auditSeason, collectPeople, findingLine,
  findingsOf, foldName, nameCorruption, nameSpacing, seasonStart,
} from './lib/roster-audit.mjs';

const char = code => String.fromCharCode(code);

test('a name damaged on its way from the source is told from one its source spells on purpose', () => {
  const damaged = ['Masashi\r\nMasashi Nakayama', 'Bob Baumhower 9SK?', 'Jos' + char(0xC3) + char(0xA9) + ' Mourinho',
    char(0xE2) + char(0x20AC) + char(0x2122) + 'quote', "O&#39;Neil", 'Lee &amp; Co', 'Bo' + char(0xFFFD) + 'ek', 'Tab' + char(9) + 'Name',
    'Player 9', 'Zero' + char(0x200B) + 'Width'];
  for (const name of damaged) assert.ok(nameCorruption(name), JSON.stringify(name));
  const meant = ['Sebastian Aho (1997)', 'Steve Smith (1963-04-30)', 'Joao Pinto(ii)', "Shaquille O'Neal", 'Jean-Pierre Papin', 'N. Kanté',
    'Nikola Jokić', 'Kristaps Porziņģis', "Na'il Diggs", 'Ō', 'Ğökhan Şahin', 'Ñandú'];
  for (const name of meant) assert.equal(nameCorruption(name), null, name);
  assert.match(nameSpacing(' Lead'), /leading or trailing/);
  assert.match(nameSpacing('Medhat Abdel  Hady'), /doubled space/);
  assert.match(nameSpacing('Non' + char(0xA0) + 'breaking'), /other than a space/);
  assert.equal(nameSpacing('Medhat Abdel Hady'), null);
});

test('names fold alike with and without diacritics; ages are whole years on the day the season starts', () => {
  assert.equal(foldName('Nikola Jokić'), foldName('Nikola Jokic'));
  assert.equal(foldName('Jonas Valančiūnas'), foldName('Jonas Valanciunas'));
  assert.equal(foldName('Martin Ødegaard'), foldName('Martin Odegaard'));
  assert.notEqual(foldName('Luis Garcia'), foldName('Luis Gracia'));
  // A winter's season starts on 1 July of its first year, a calendar year's on 1 January.
  assert.equal(new Date(seasonStart({ year: 2026, season: '2025/26' })).toISOString().slice(0, 10), '2025-07-01');
  assert.equal(new Date(seasonStart({ year: 2026, season: '2026' })).toISOString().slice(0, 10), '2026-01-01');
  const start = seasonStart({ year: 1972, season: '1971/72' });
  assert.deepEqual(['1957-07-01', '1957-07-02', '1925-07-01', '1925-07-02', 'unknown'].map(born => ageOn(born, start)), [14, 13, 46, 45, null],
    'a birthday counts on its day');
  assert.deepEqual([AGE_IMPOSSIBLE.under, AGE_IMPOSSIBLE.over, AGE_UNUSUAL.under, AGE_UNUSUAL.over], [14, 45, 16, 40]);
});

// An invented season's teams, in seasonTeams' shape.
const player = (name, rating, extra = {}) => ({ name, pos: 'MF', positions: null, rating, info: null, starter: true, ...extra });
const team = (kind, name, players, extra = {}) => ({ kind, id: name.toLowerCase(), name, str: 70, fielded: true,
  lineup: { rating: 70, empty: [], outOfPosition: [] }, players, ...extra });

test('each check finds what it names, and only that', () => {
  const season = { id: 'test-1990', sportId: 'football', year: 1990, season: '1989/90' };
  const teams = [
    team('nation', 'Atlantis', [
      player('Clean Name', 70),
      player('Broken ?Name', 70),
      player('Double  Space', 70),
      player('Off Scale', 100),
      player('Same Id', 70, { info: { id: 'x:1' } }),
      player('Same Id Again', 70, { info: { id: 'x:1' } }),
      player('Child Star', 60, { info: { id: 'x:2', dateOfBirth: '1980-01-01' } }),
      player('Teen Star', 60, { info: { id: 'x:3', dateOfBirth: '1974-01-01' } }),
      player('Tagged Name (1960)', 70),
      player('Twin', 65), player('Twin', 66),
      player('Nikola Jokic', 80),
      player('Dario Saric', 74),
    ], { lineup: { rating: 66, empty: ['GK'], outOfPosition: [] } }),
    team('club', 'Club Ltd', [player('Nikola Jokić', 80), player('Dario Šarić', 78)], { str: 75, lineup: { rating: 70, empty: [],
      outOfPosition: [{ name: 'Nikola Jokić', position: 'GK', gen: false }] } }),
    team('nation', 'Benchland', [player('Unfielded Player', 70)], { fielded: false, lineup: { rating: 40, empty: ['GK', 'DF'], outOfPosition: [] } }),
  ];
  const found = auditSeason(season, teams);
  const of = check => found.filter(f => f.check === check).map(f => f.player ?? f.team);
  assert.deepEqual(of('name-corrupt'), ['Broken ?Name']);
  assert.deepEqual(of('name-spacing'), ['Double  Space']);
  assert.deepEqual(of('rating-range'), ['Off Scale']);
  assert.deepEqual(of('player-repeated'), ['Same Id Again']);
  assert.deepEqual(of('age-impossible'), ['Child Star'], '9 when 1989/90 starts');
  assert.deepEqual(of('age-unusual'), ['Teen Star'], '15');
  assert.deepEqual(of('name-unusual'), ['Tagged Name (1960)']);
  assert.deepEqual(of('namesakes-in-team'), ['Twin']);
  assert.deepEqual(of('spelling-variant'), ['Nikola Jokic / Nikola Jokić']);
  assert.deepEqual(of('rating-conflict'), ['Dario Saric']);
  assert.deepEqual(of('lineup-gap'), ['nation:Atlantis', 'club:Club Ltd'], 'an unfielded nation is no gap');
  assert.deepEqual(of('strength-mismatch'), ['nation:Atlantis', 'club:Club Ltd']);
  // A source id tells namesakes apart: two "L. Martínez" of one nation are two players, not one rated twice.
  const ids = auditSeason(season, [team('nation', 'Argentina', [player('L. Martinez', 82, { info: { id: 'ea:1' } })]),
    team('club', 'Inter', [player('L. Martinez', 89, { info: { id: 'ea:2' } })])]);
  assert.deepEqual(ids.filter(f => f.check === 'rating-conflict'), []);
  assert.match(findingLine(found.find(f => f.check === 'lineup-gap')), /^test-1990 nation:Atlantis — lineup-gap: empty GK$/);
});

test('an esport\'s gamer tags keep their digits and punctuation, but not damage', () => {
  for (const sport of ['rocket-league', 'counter-strike', 'valorant', 'league-of-legends']) assert.ok(HANDLES.has(sport), sport);
  for (const tag of ['M0nkey M00n', 'Rw9', '2Die4', 'scream33.']) {
    assert.equal(nameCorruption(tag, { handle: true }), null, tag);
    assert.equal(nameCorruption(tag), 'a digit', `${tag}, as a name`);
  }
  assert.equal(nameCorruption('Ry4n?', { handle: true }), 'a question mark');
  assert.equal(nameCorruption('Bo' + char(0xFFFD) + 'ek', { handle: true }), 'a control or replacement character');
  const season = { id: 'test-esport', sportId: 'rocket-league', year: 2026, season: '2026' };
  const found = auditSeason(season, [team('nation', 'Atlantis', [player('M0nkey M00n', 90), player('Q_U_I_E_T_', 43),
    player('bjdn!', 60), player('Tag  Twice', 50), player('Atlantis', 50), player('Atlantis', 49)])]);
  assert.deepEqual(found.map(f => `${f.check} ${f.player ?? f.team}`), ['name-spacing Tag  Twice', 'namesakes-in-team Atlantis']);
});

test('two scripts glued into one name, and one player in two nations, are errors', () => {
  const season = { id: 'test-2026', sportId: 'football', year: 2026, season: '2025/26' };
  // "Vitaliy Buyalskyi" with his name in Cyrillic glued on, as EA FC 26's SoFIFA snapshot held 286 full names.
  const glued = 'Vitaliy Buyalskyi' + char(0x411) + char(0x443) + char(0x44F) + char(0x43B) + char(0x44C) + char(0x441) + char(0x44C) + char(0x43A) + char(0x438) + char(0x439);
  const found = auditSeason(season, [
    team('nation', 'Ukraine', [player('V. Buyalskyi', 75, { info: { id: 'ea:1', fullName: glued } }), player('A. Two', 70, { info: { id: 'ea:2' } })]),
    team('nation', 'Poland', [player('A. Two', 70, { info: { id: 'ea:2' } })]),
    // A full name only in another script is a source's own: Wang Shuang's.
    team('club', 'Wuhan', [player('Wang Shuang', 80, { info: { id: 'ea:3', fullName: char(0x738B) + char(0x971C) } })]),
  ]);
  assert.deepEqual(found.map(f => `${f.check} ${f.player}`), ['name-scripts-glued V. Buyalskyi', 'player-in-two-teams A. Two']);
  assert.equal(found[1].detail, 'in the nations Ukraine and Poland');
});

test('across seasons: a date of birth most seasons disagree with, and an EA rating that jumps between editions', () => {
  const rec = (season, year, dob, rating, id = 'ea:9') => ({ id, season, year, team: 'nation:Croatia', name: 'D. Livakovic', dob, rating });
  const found = acrossSeasons(new Map([['football|ea:9', [rec('ea-fifa-20', 2020, '1995-09-02', 70), rec('ea-fifa-21', 2021, '1995-01-09', 74),
    rec('ea-fifa-22', 2022, '1995-01-09', 90), rec('ea-fifa-23', 2023, '1995-01-10', 80)]]]));
  assert.deepEqual(found.map(f => `${f.check} ${f.season}`), ['birth-date-disagreement ea-fifa-20', 'rating-jump ea-fifa-22'],
    'a day apart is no disagreement, nor 10 points a jump');
  assert.equal(found[0].detail, 'D. Livakovic born 1995-09-02 here, 1995-01-09 in 2 other seasons');
  assert.equal(found[1].detail, 'D. Livakovic 74 in ea-fifa-21, 90 here (+16)');
  // A tie goes to the newer season's date; Wikidata's ids name people, but only EA's ratings are compared.
  const tie = acrossSeasons(new Map([['x', [rec('a', 2020, '1994-01-25', 50, 'wd:Q1'), rec('b', 2021, '1994-10-25', 80, 'wd:Q1')]]]));
  assert.deepEqual(tie.map(f => `${f.check} ${f.season}`), ['birth-date-disagreement a']);
  // Championship Manager's ids number a database's rows, not people: they are left out.
  const people = collectPeople(new Map(), { id: 's', sportId: 'football', year: 2002 }, [team('club', 'X', [
    player('A', 70, { info: { id: 'cm:1', dateOfBirth: '1980-01-01' } }), player('B', 70, { info: { id: 'ea:5', dateOfBirth: '1980-01-01' } })])]);
  assert.deepEqual([...people.keys()], ['football|ea:5']);
});

test('every season of every sport, as the game plays it, holds no error', () => {
  const audit = auditRosters(new URL('../', import.meta.url));
  assert.equal(audit.seasons.length, SPORT_LIST.length + BUILT_IN_SETS.length, 'each sport\'s built-in season and every earlier one');
  assert.deepEqual([...new Set(audit.seasons.map(s => s.sport))].sort(), SPORT_LIST.map(s => s.id).sort());
  assert.ok(audit.seasons.every(s => s.ratings.players > 0), 'every season has players');
  const errors = findingsOf(audit.findings, 'error');
  assert.deepEqual(errors.map(findingLine), [], 'npm run audit:rosters lists them');
  const report = auditReport(audit);
  assert.deepEqual(Object.keys(report.checks), Object.keys(CHECKS));
  assert.deepEqual(report.errors, []);
  assert.ok(Object.values(report.warnings).every(bySeason => Object.values(bySeason).every(entry => entry.examples.length <= 3)));
});
