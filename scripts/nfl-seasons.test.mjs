// The built-in earlier American football seasons (docs/design/american-football.md, "Earlier seasons" and "Tecmo
// seasons"): Madden NFL 2002 to 26, the 2001 to 2025 seasons, each edition's launch roster, and the Tecmo Super Bowl
// games' 1990 and 1992 to 1995, built from committed snapshots by the built-in season's squad rules (a Tecmo club's
// documented gaps left to the game); the readers that make the Madden snapshots; the era maps (the Phoenix Cardinals,
// the Raiders in Los Angeles and the Rams in Anaheim, the Houston Oilers, the Panthers in Clemson in 1995, the St. Louis
// Rams, the San Diego Chargers, the Oakland Raiders, the Saints in Baton Rouge in 2005, no Texans in 2001); the loader's
// checks; and the running App, which plays a season's clubs on the map of their day and saves and resumes the campaign.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { strToU8, zipSync } from 'fflate';
import { SAVE_KEY } from '../src/config.js';
import { BUILT_IN_AMERICAN_FOOTBALL_SEASONS } from '../src/data/americanFootballSeasons.js';
import { CLUB_MAPS } from '../src/data/clubMaps.js';
import { CLUBS } from '../src/data/clubs.american-football.js';
import { contentHash } from '../src/data/footballSetBuild.js';
import { selectLineup } from '../src/data/teams.js';
import { decodeDomestic } from '../src/engine/domestic.js';
import { BUILT_IN_SETS, builtInSeasonOf, decodeFootballSet, seasonMapOf, seasonSport, setHasClubs, setHasNations, setSportOf,
  sportOf } from '../src/engine/footballSets.js';
import { parseCampaign } from '../src/engine/storage.js';
import { americanFootball } from '../src/sports/americanFootball.js';
import { buildSetupModel } from '../src/screens/setup/setupModel.js';
import { kmToPolys, pointInPolys } from './lib/domestic-partition.mjs';
import { readWorkbook, readXlsx } from './lib/madden-workbooks.mjs';
import { colourFor, LEFT_OUT, mapOf, playerOf, POSITION_OF, seasonIdOf, setIdOf, shortOf, squadOf, teamsOf } from './lib/nfl.mjs';
import { buildNflSeason, buildTecmoSeason } from './build-nfl-seasons.mjs';
import { agreement, headerOf, parseCsv, plainName, tableOf, teamOfLabel, UNNAMED } from './sync-madden-seasons.mjs';
import { bundleComponents, syncAppFixture } from './lib/app-harness.mjs';

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const MANIFEST = JSON.parse(read('scripts/data/nfl-seasons.json'));
const FRANCHISES = JSON.parse(read('scripts/data/nfl-teams.json')).teams;
const isTecmo = year => MANIFEST.sources[year].kind === 'tecmo';
const MADDEN = MANIFEST.seasons.filter(year => !isTecmo(year));
const TECMO = MANIFEST.seasons.filter(isTecmo);
const snapshotOf = year => JSON.parse(read(`scripts/data/madden-seasons/${year}.json`));
const tecmoSnapshotOf = year => JSON.parse(read(`scripts/data/tecmo/${year}.json`));
const seasonFile = id => JSON.parse(read(`public/american-football/${id}.json`));
const mapFile = id => JSON.parse(read(`public/domestic/${id}.json`));
const ERA_MAPS = CLUB_MAPS.filter(entry => entry.sport === 'american-football' && entry.seasons);
const FORMATION = americanFootball.formation;
const naturalCount = (squad, pos) => squad.filter(([, position]) => position === pos).length;
const squadPlayers = squad => squad.map(([name, pos, rating]) => ({ name, pos, rating }));

// ---------- the builder, on invented players ----------

test('Madden\'s positions group into the game\'s; punters and long snappers play no part', () => {
  const groups = Object.fromEntries(['QB', 'HB', 'FB', 'WR', 'TE', 'LT', 'LG', 'C', 'RG', 'RT', 'LE', 'RE', 'LEDG', 'REDG', 'DT', 'LOLB',
    'MLB', 'ROLB', 'SAM', 'MIKE', 'WILL', 'CB', 'FS', 'SS', 'K'].map(code => [code, playerOf('A Player', code, 70).pos]));
  assert.deepEqual(groups, { QB: 'QB', HB: 'RB', FB: 'RB', WR: 'WR', TE: 'TE', LT: 'OL', LG: 'OL', C: 'OL', RG: 'OL', RT: 'OL', LE: 'DL',
    RE: 'DL', LEDG: 'DL', REDG: 'DL', DT: 'DL', LOLB: 'LB', MLB: 'LB', ROLB: 'LB', SAM: 'LB', MIKE: 'LB', WILL: 'LB', CB: 'CB', FS: 'S',
    SS: 'S', K: 'K' });
  assert.equal(playerOf('A Punter', 'P', 80), null);
  assert.equal(playerOf('A Snapper', 'LS', 60), null);
  assert.throws(() => playerOf('A Returner', 'KR', 70), /Unknown Madden position KR/);
  assert.ok([...Object.values(POSITION_OF)].every(pos => FORMATION[pos]), 'every group is a place in the lineup');
  assert.deepEqual([...LEFT_OUT], ['P', 'LS']);
});

/** An invented roster: the formation's natural players at `base`, then two backups at each place. */
function roster(prefix, base, extra = []) {
  const players = [];
  for (const [pos, count] of Object.entries(FORMATION)) {
    for (let i = 0; i < count + 2; i++) players.push({ name: `${prefix} ${pos} ${i + 1}`, pos, rating: base - i });
  }
  return [...players, ...extra];
}

test('a franchise fields the lineup the game picks, keeps the natural players it passed over, then its backups', () => {
  const full = squadOf(roster('Full', 80), 'Full');
  assert.equal(full.squad.length, 23 + 11, 'the 23 and DEPTH\'s eleven backups');
  assert.equal(full.str, selectLineup({ sport: 'american-football', squad: full.squad }).rating);
  assert.deepEqual([...new Set(full.squad.map(p => p.pos))], ['QB', 'RB', 'WR', 'TE', 'OL', 'DL', 'LB', 'CB', 'S', 'K'], 'offence first');

  // A 40-rated kicker: the game starts a linebacker at K (85, less 25), and the kicker stays in the squad.
  const weak = roster('Weak', 80).filter(p => p.pos !== 'K').concat([{ name: 'Weak Kicker', pos: 'K', rating: 40 },
    { name: 'Strong Backer', pos: 'LB', rating: 85 }]);
  const lineup = selectLineup({ sport: 'american-football', squad: weak.slice().sort((a, b) => b.rating - a.rating) });
  assert.ok(lineup.slots.find(slot => slot.position === 'K').outOfPosition, 'the game prefers an emergency kicker');
  const { squad } = squadOf(weak, 'Weak');
  assert.ok(squad.some(p => p.name === 'Weak Kicker'), 'the natural kicker it passed over is kept');
  for (const [pos, count] of Object.entries(FORMATION)) assert.ok(squad.filter(p => p.pos === pos).length >= count, `${pos} covered`);

  assert.throws(() => squadOf(roster('Short', 80).filter(p => p.pos !== 'CB' || p.name.endsWith(' 1')), 'Short'),
    /Short cannot field every position: CB/);
});

test('a documented gap is left to the game to fill out of position; any other shortfall stops the build', () => {
  // A 3-4 club with two corners and no tight end, as NES Tecmo Super Bowl's run-and-shoot Lions.
  const short = roster('Tecmo', 80).filter(p => !(p.pos === 'DL' && /DL [4-6]$/.test(p.name)) && !(p.pos === 'CB' && /CB [3-5]$/.test(p.name))
    && p.pos !== 'TE');
  assert.deepEqual(shortOf(short), { TE: 1, DL: 1, CB: 1 });
  const { squad, str } = squadOf(short, 'Tecmo', { gaps: { CB: 1, DL: 1, TE: 1 } });
  assert.ok(squad.every(p => short.includes(p)), 'no player added');
  const lineup = selectLineup({ sport: 'american-football', squad });
  assert.deepEqual(lineup.slots.filter(slot => slot.outOfPosition).map(slot => slot.position).sort(), ['CB', 'DL', 'TE'], 'the game fills the gaps');
  assert.equal(str, lineup.rating);
  assert.throws(() => squadOf(short, 'Tecmo', { gaps: { DL: 1, CB: 1 } }), /Tecmo is short of TE, DL, CB, not the documented DL, CB/);
  assert.throws(() => squadOf(roster('Full', 80), 'Full', { gaps: { DL: 1 } }), /Full is short of nothing, not the documented DL/);
  assert.throws(() => squadOf(short, 'Tecmo', { gaps: { TE: 1, DL: 1, CB: 1, P: 1 } }), /no place P in the lineup/);
});

const TEST_FRANCHISES = {
  'nfl-boston-testers': { ea: 1, name: 'Boston Testers', code: 'BOT', city: 'Boston', stadium: 'Test Field', home: [-71.1, 42.3] },
  'nfl-new-city-movers': { ea: 2, name: 'New City Movers', code: 'NCM', city: 'New City', stadium: 'New Dome', base: 'New Camp', home: [-90, 35] },
  'nfl-late-joiners': { ea: 3, name: 'Late Joiners', code: 'LJN', city: 'Late Town', stadium: 'Late Park', home: [-100, 40] },
};
const TEST_MANIFEST = {
  source: { name: 'Madden NFL', provider: 'EA Sports', rawScale: 99 },
  sources: {
    2001: { edition: 'Madden Test 2002', kind: 'maddenratings', compiler: 'Test Archive', url: 'https://example.test/2002', iteration: 'original roster', retrieved: '2026-11-08' },
    2002: { edition: 'Madden Test 2003', kind: 'table', compiler: 'Test Archive', url: 'https://example.test/2003', iteration: 'launch ratings', retrieved: '2026-11-08' },
  },
  teams: {
    // Moved after 2001: another name, code and city, and its own stadium (no training base) before.
    'nfl-new-city-movers': [{ to: 2001, id: 'nfl-old-town-movers', name: 'Old Town Movers', code: 'OTM', city: 'Old Town', stadium: 'Old Bowl', home: [-80, 30] }],
    'nfl-late-joiners': [{ to: 2001, absent: true }],
  },
  maps: [{ id: 'test2001', seasons: [2001] }, { id: 'test2002', seasons: [2002] }],
};

test('a season\'s franchises are today\'s but for the manifest\'s eras', () => {
  const at = year => teamsOf(TEST_FRANCHISES, TEST_MANIFEST, year).map(t => [t.id, t.name, t.code, t.city, t.stadium, t.base ?? null, t.home]);
  assert.deepEqual(at(2001), [
    ['nfl-boston-testers', 'Boston Testers', 'BOT', 'Boston', 'Test Field', null, [-71.1, 42.3]],
    ['nfl-old-town-movers', 'Old Town Movers', 'OTM', 'Old Town', 'Old Bowl', null, [-80, 30]],
  ], 'an era replaces the venue whole, training base and all; an absent franchise is left out');
  assert.deepEqual(at(2002).map(row => row[0]), ['nfl-boston-testers', 'nfl-new-city-movers', 'nfl-late-joiners']);
  assert.deepEqual(at(2002)[1], ['nfl-new-city-movers', 'New City Movers', 'NCM', 'New City', 'New Dome', 'New Camp', [-90, 35]]);
  assert.deepEqual([mapOf(TEST_MANIFEST, 2001), mapOf(TEST_MANIFEST, 2002)], ['test2001', 'test2002']);
  assert.throws(() => mapOf(TEST_MANIFEST, 2003), /No map for the 2003 season/);
  assert.deepEqual([seasonIdOf(2005), setIdOf(TEST_MANIFEST, 2001), setIdOf({ sources: { 1990: { id: 'tecmo-1990' } } }, 1990)],
    ['madden-2005', 'madden-2001', 'tecmo-1990'], 'a source may name its own set');
});

test('a season keeps every club\'s squad as Madden rated it, on its era\'s teams and map', () => {
  const players = (ea, prefix, base) => roster(prefix, base).map(p => [p.name, ea, { RB: 'HB', OL: 'LT', DL: 'LE', LB: 'MLB', S: 'FS' }[p.pos] ?? p.pos, p.rating]);
  const snapshot = {
    source: { edition: 'Madden Test 2002', season: '2001' },
    teams: { 1: 'Boston Testers', 2: 'Old Town Movers' },
    players: [...players(1, 'Boston', 80), ...players(2, 'Old', 70), ['Old Punter', 2, 'P', 99]],
  };
  const { doc, text, audit } = buildNflSeason(snapshot, 2001, TEST_MANIFEST, TEST_FRANCHISES);
  assert.equal(text, `${JSON.stringify(doc)}\n`);
  assert.equal(doc.version, `madden-2001-${contentHash(doc)}`);
  assert.deepEqual({ ...doc, version: undefined, clubs: undefined }, { format: 1, kind: 'madden', id: 'madden-2001', version: undefined,
    year: 2001, season: '2001', label: 'Madden Test 2002', local: false,
    source: { provider: 'EA Sports', edition: 'Madden Test 2002', compiler: 'Test Archive', url: 'https://example.test/2002',
      iteration: 'original roster', retrieved: '2026-11-08', rawScale: 99 },
    map: 'test2001', clubs: undefined, coverage: { players: snapshot.players.length, clubs: 2 } });
  const [boston, old] = doc.clubs;
  assert.deepEqual([boston.id, boston.code, boston.col, old.id, old.name, old.code, old.col],
    ['nfl-boston-testers', 'BOT', colourFor('nfl-boston-testers'), 'nfl-old-town-movers', 'Old Town Movers', 'OTM', colourFor('nfl-old-town-movers')]);
  assert.equal(boston.squad.length, 34);
  assert.ok(!text.includes('Old Punter'), 'a punter plays no part');
  assert.deepEqual(boston.squad[0], ['Boston QB 1', 'QB', 80], 'ratings as Madden gave them');
  assert.equal(boston.str, selectLineup({ sport: 'american-football', squad: squadPlayers(boston.squad) }).rating);
  assert.deepEqual(audit.clubs, [`Boston Testers ${boston.str}`, `Old Town Movers ${old.str}`]);

  const build = edit => () => { const copy = structuredClone(snapshot); edit(copy); return buildNflSeason(copy, 2001, TEST_MANIFEST, TEST_FRANCHISES); };
  assert.throws(build(s => { s.teams[2] = 'New City Movers'; }), /are not the season's 2/);
  assert.throws(build(s => { s.teams[3] = 'Late Joiners'; }), /are not the season's 2/, 'a franchise that had not joined');
  assert.throws(build(s => { s.players.push(['Stranger', 3, 'QB', 70]); }), /plays for EA team 3, no team of the season/);
  assert.throws(build(s => { s.players[0][3] = 100; }), /rating outside 1-99/);
  assert.throws(build(s => { s.players.push(['Returner', 1, 'KR', 70]); }), /Unknown Madden position KR/);
  assert.throws(build(s => { s.source.edition = 'Madden Test 2003'; }), /snapshot is Madden Test 2003/);
  assert.throws(build(s => { s.players = s.players.filter(p => p[1] !== 2 || p[2] !== 'K'); }), /Old Town Movers cannot field every position: K/);
});

// ---------- the readers ----------

test('a ratings table is read under each header it repeats, by first and last name or by full name', () => {
  assert.deepEqual(headerOf(['PLYR_FIRSTNAME', 'PLYR_LASTNAME', 'Position', 'PLYR_OVERALLRATING']), { first: 0, last: 1, full: -1, pos: 2, overall: 3, team: -1 });
  assert.deepEqual(headerOf(['Team', 'Full Name', 'Overall Rating', 'Position']), { first: -1, last: -1, full: 1, pos: 3, overall: 2, team: 0 });
  assert.equal(headerOf(['Kevin', 'Kolb', 'QB', '80']), null);
  // Madden NFL 12's sheets start a header for each position; blank rows, unnamed and unrated rows are no players.
  const { players, skipped } = tableOf([
    ['Name', 'Position', 'Overall'], ['Kevin Kolb', 'QB', '80'], ['', '', ''], ['Name', 'Position', 'Overall'],
    ['Larry  Fitzgerald ', 'WR', '96'], ['', 'FB', ''], ['Phil Loadholt', 'RT', ''], ['Odd Rating', 'CB', '0'], ['Decimal', 'K', '66.0'],
  ]);
  assert.deepEqual(players.map(p => [p.name, p.pos, p.overall]), [['Kevin Kolb', 'QB', 80], ['Larry Fitzgerald', 'WR', 96], ['Decimal', 'K', 66]]);
  assert.deepEqual(skipped, [{ name: '(no name)', pos: 'FB', why: 'no name' }, { name: 'Phil Loadholt', pos: 'RT', why: 'no overall' },
    { name: 'Odd Rating', pos: 'CB', why: 'overall 0' }]);
  assert.deepEqual(parseCsv('a,"b, ""c""",d\r\n1,2,3\n'), [['a', 'b, "c"', 'd'], ['1', '2', '3']]);
  assert.ok(['C.#25', 'LG #65', 'CB #37'].every(name => UNNAMED.test(name)));
  assert.ok(!['Michael Carter II', 'H.B. Blades', 'Jaxon Smith-Njigba'].some(name => UNNAMED.test(name)));
});

test('an .xlsx workbook is read as text: shared and inline strings, numbers, and rows by their numbers', () => {
  const xml = body => strToU8(`<?xml version="1.0" encoding="UTF-8"?>${body}`);
  const bytes = zipSync({
    'xl/workbook.xml': xml('<workbook xmlns:r="r"><sheets><sheet name="Arizona &amp; Co" sheetId="1" r:id="rId1"/></sheets></workbook>'),
    'xl/_rels/workbook.xml.rels': xml('<Relationships><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/></Relationships>'),
    'xl/sharedStrings.xml': xml('<sst><si><t>Name</t></si><si><r><t>Larry </t></r><r><t>Fitzgerald</t></r></si><si><t>WR</t></si></sst>'),
    'xl/worksheets/sheet1.xml': xml('<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="inlineStr"><is><t>Overall</t></is></c></row>'
      + '<row r="3"><c r="A3" t="s"><v>1</v></c><c r="B3" t="s"><v>2</v></c><c r="C3"><v>96</v></c></row></sheetData></worksheet>'),
  });
  assert.deepEqual(readXlsx(bytes), [{ name: 'Arizona & Co', rows: [['Name', '', 'Overall'], [], ['Larry Fitzgerald', 'WR', '96']] }]);
  assert.deepEqual(readWorkbook(bytes), readXlsx(bytes));
  assert.throws(() => readWorkbook(strToU8('Team,Name')), /neither an .xlsx nor an .xls workbook/);
});

test('a second source is compared player by player, by name, team and position', () => {
  const ours = [{ name: 'Michael Carter', ea: 18, pos: 'HB', overall: 73 }, { name: 'Michael Carter', ea: 18, pos: 'CB', overall: 66 },
    { name: 'Germán Ifedi', ea: 1, pos: 'RT', overall: 70 }, { name: 'Nobody Else', ea: 1, pos: 'QB', overall: 50 }];
  const theirs = [{ name: 'Michael Carter', pos: 'CB', overall: 66 }, { name: 'Michael Carter', pos: 'HB', overall: 74 },
    { name: 'German Ifedi', pos: 'RT', overall: 70, ea: 1 }, { name: 'Free Agent', pos: 'QB', overall: 60 }];
  assert.deepEqual(agreement(ours, theirs), { rows: 4, matched: 3, sameOverall: 2, samePosition: 3, differences: ['Michael Carter HB 73 (74)'] });
  assert.equal(agreement([{ name: 'German Ifedi', ea: 2, pos: 'RT', overall: 70 }], theirs).matched, 0, 'a check that names teams must agree on the team');
  assert.equal(plainName('Ja\'Marr  Chase'), 'jamarr chase');
  const teams = teamsOf(FRANCHISES, MANIFEST, 2021);
  assert.deepEqual(['NY Jets', 'Football Team', 'Washington Football Team', 'Bucs', 'Rams'].map(label => teamOfLabel(teams, label)?.name ?? null),
    ['New York Jets', 'Washington Football Team', 'Washington Football Team', null, 'Los Angeles Rams']);
});

// ---------- the shipped seasons ----------

test('every season, its listing and audit rebuild byte for byte from the committed snapshots; so does the 2026 season', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  assert.match(execFileSync(process.execPath, ['scripts/build-nfl-seasons.mjs', '--check'], { cwd: root, encoding: 'utf8' }), /Verified the 30 American football seasons/);
  assert.match(execFileSync(process.execPath, ['scripts/build-nfl.mjs', '--check'], { cwd: root, encoding: 'utf8' }), /Verified the NFL clubs byte for byte/);
  for (const year of MADDEN) {
    const snapshot = snapshotOf(year);
    assert.equal(snapshot.source.season, String(year));
    assert.equal(snapshot.source.edition, MANIFEST.sources[year].edition);
    assert.equal(snapshot.players.length, snapshot.source.players);
    assert.equal(Object.keys(snapshot.teams).length, year === 2001 ? 31 : 32);
    for (const [name, ea, position, overall] of snapshot.players) {
      assert.ok(snapshot.teams[ea], `${year} ${name} plays for a team of the season`);
      assert.ok(Object.hasOwn(POSITION_OF, position) || LEFT_OUT.has(position), `${year} ${name}: ${position}`);
      assert.ok(Number.isInteger(overall) && overall >= 1 && overall <= 99, `${year} ${name}: ${overall}`);
      assert.ok(!UNNAMED.test(name), `${year}: ${name} is no player anyone can name`);
    }
  }
  assert.match(snapshotOf(2003).notes.join(' '), /left out, unnamed by the game: .*San Diego Chargers CB C\.#25 \(72\)/);
  assert.match(snapshotOf(2010).notes.join(' '), /left out, no overall: Minnesota Vikings RT Phil Loadholt/);
});

test('a second source agrees with every Madden season, and EA\'s own copies agree player for player', () => {
  for (const year of MADDEN) {
    const { checks } = snapshotOf(year);
    assert.equal(checks.length, MANIFEST.sources[year].checks.length, `${year}: every check ran`);
    for (const check of checks) {
      assert.ok(check.matched >= Math.min(90, check.rows * 0.9), `${year} ${check.name}: ${check.matched} of ${check.rows} found`);
      assert.ok(check.sameOverall >= check.matched * 0.99, `${year} ${check.name}: ${check.sameOverall} of ${check.matched} rated the same`);
    }
  }
  const exact = (year, pattern) => {
    const check = snapshotOf(year).checks.find(c => pattern.test(c.name));
    assert.ok(check && check.matched > 0 && check.sameOverall === check.matched && check.samePosition === check.matched, `${year} ${pattern}`);
    return check.matched;
  };
  assert.equal(exact(2015, /Madden NFL 16 player ratings/), 2326, 'EA\'s Madden NFL 16 list');
  assert.equal(exact(2016, /Madden NFL 17 ratings sheet/), 2363, 'EA\'s Madden NFL 17 sheet');
  assert.equal(exact(2021, /ratings API/), 1000, 'EA\'s API in August 2021');
  assert.equal(exact(2022, /austinreese/), 2368, 'EA\'s API in 2022');
  assert.deepEqual(snapshotOf(2024).checks.map(c => [c.matched, c.sameOverall]), [[73, 73], [70, 70]], 'two team pages at launch');
});

test('the built-in seasons are the manifest\'s, newest first, from Madden NFL 26 back to Tecmo Super Bowl, each on its era\'s map', () => {
  assert.deepEqual(BUILT_IN_AMERICAN_FOOTBALL_SEASONS.map(set => set.id), [...MANIFEST.seasons].reverse().map(year => setIdOf(MANIFEST, year)));
  assert.deepEqual(MADDEN, Array.from({ length: 25 }, (_, i) => 2001 + i), 'no Madden season is missing');
  assert.deepEqual(TECMO, [1990, 1992, 1993, 1994, 1995], 'every Tecmo Super Bowl season: no edition rates 1991');
  assert.deepEqual(BUILT_IN_AMERICAN_FOOTBALL_SEASONS.slice(25).map(set => [set.id, set.season, set.label, set.map]), [
    ['tecmo-1995', '1995', 'Tecmo Super Bowl III', 'nfl1995'], ['tecmo-1994', '1994', 'Tecmo Super Bowl II', 'nfl1994'],
    ['tecmo-1993', '1993', 'Tecmo Super Bowl (SNES)', 'nfl1992'], ['tecmo-1992', '1992', 'Tecmo Super Bowl II', 'nfl1992'],
    ['tecmo-1990', '1990', 'Tecmo Super Bowl (NES)', 'nfl1990']], 'after the Madden seasons, each game by its name');
  assert.deepEqual(BUILT_IN_AMERICAN_FOOTBALL_SEASONS.map(set => [set.season, set.label, set.map]).filter((_, i) => [0, 1, 11, 12, 20, 24].includes(i)), [
    ['2025', 'Madden NFL 26', 'nfl'], ['2024', 'Madden NFL 25', 'nfl'], ['2014', 'Madden NFL 15', 'nfl2014'], ['2013', 'Madden NFL 25', 'nfl2010'],
    ['2005', 'Madden NFL 06', 'nfl2005'], ['2001', 'Madden NFL 2002', 'nfl2001']]);
  assert.deepEqual(builtInSeasonOf('american-football'), { year: 2026, season: '2026' }, 'the built-in season stays the current one');
  for (const listed of BUILT_IN_AMERICAN_FOOTBALL_SEASONS) {
    const set = BUILT_IN_SETS.find(entry => entry.id === listed.id);
    assert.deepEqual(set, listed, `${listed.id} is listed as built`);
    assert.equal(setSportOf(set.id), 'american-football');
    assert.ok(!setHasNations(set.id) && setHasClubs(set.id), 'clubs only');
    assert.equal(seasonMapOf(set.id), listed.map);
    assert.equal(mapOf(MANIFEST, set.year), listed.map);
    assert.equal(seasonFile(set.id).version, listed.version);
  }
  assert.deepEqual(ERA_MAPS.map(entry => entry.id), MANIFEST.maps.map(map => map.id).filter(id => id !== 'nfl'));
  for (const entry of ERA_MAPS) {
    assert.deepEqual(entry.seasons, BUILT_IN_AMERICAN_FOOTBALL_SEASONS.filter(set => set.map === entry.id).map(set => set.id).sort());
    assert.ok(!('top' in entry), 'an era\'s strongest clubs are its seasons\' own');
  }
});

test('every season loads and fits its era\'s map: the same clubs, named and housed as that season had them', () => {
  const today = new Set(CLUBS.map(club => club.id));
  for (const listed of BUILT_IN_AMERICAN_FOOTBALL_SEASONS) {
    const doc = seasonFile(listed.id);
    const set = decodeFootballSet(structuredClone(doc), listed.id);
    assert.equal(doc.version, `${listed.id}-${contentHash(doc)}`, `${listed.id} is the builder's file`);
    assert.deepEqual([set.meta.year, set.meta.season, set.meta.label, set.meta.map], [listed.year, listed.season, listed.label, listed.map]);
    const map = decodeDomestic(mapFile(listed.map), listed.map);
    const entry = CLUB_MAPS.find(item => item.id === listed.map);
    assert.equal(map.meta.version, entry.version);
    assert.deepEqual(map.clubs.map(club => club.id).sort(), doc.clubs.map(club => club.id).sort(), `${listed.id}'s clubs are its map's`);
    const teams = new Map(teamsOf(FRANCHISES, MANIFEST, listed.year).map(team => [team.id, team]));
    for (const row of map.clubs) {
      const team = teams.get(row.id), club = doc.clubs.find(item => item.id === row.id);
      assert.deepEqual([club.name, club.code, club.league, club.country, club.col], [team.name, team.code, 'NFL', '840', colourFor(team.id)]);
      assert.equal(map.sectionNames[row.homeSection], team.city, `${listed.year} ${team.name} starts at home`);
      assert.deepEqual(row.homePoint, team.home);
      if (entry.seasons) assert.equal(row.name, club.name, 'an era map names its season\'s clubs');
      assert.ok(club.squad.length >= americanFootball.squadSize);
      // A Tecmo club keeps every natural player of a place it is short of; the game fills the rest out of position.
      const gaps = isTecmo(listed.year) ? tecmoSnapshotOf(listed.year).lineup.gaps[team.franchise] || {} : {};
      for (const [pos, count] of Object.entries(FORMATION)) {
        assert.ok(naturalCount(club.squad, pos) >= count - (gaps[pos] ?? 0), `${listed.year} ${club.name} has its ${pos}`);
      }
      assert.equal(club.str, selectLineup({ sport: 'american-football', squad: squadPlayers(club.squad) }).rating);
    }
    if (!entry.seasons) assert.deepEqual(new Set(doc.clubs.map(club => club.id)), today, 'today\'s map serves seasons with today\'s clubs');
  }
});

const sectionAt = (map, point) => map.geo.countries.find(section => pointInPolys(point, section.polys))?.id ?? null;
const homeSection = (map, id) => map.clubs.find(club => club.id === id).homeSection;
const eraMap = id => decodeDomestic(mapFile(id), id);
const clubOf = (season, id) => seasonFile(season).clubs.find(club => club.id === id) ?? null;
/** A season's club as `[name, code, the name of the section it starts in]`, or null. */
const homeOf = (season, id) => {
  const listed = BUILT_IN_AMERICAN_FOOTBALL_SEASONS.find(set => set.id === season);
  const map = eraMap(listed.map);
  const row = map.clubs.find(club => club.id === id);
  return row ? [clubOf(season, id).name, clubOf(season, id).code, map.sectionNames[row.homeSection]] : null;
};
/** That `point` lies in the territory club `id` starts with on map `mapId`. */
const at = (mapId, point, id, what) => {
  const map = eraMap(mapId);
  assert.equal(sectionAt(map, point), homeSection(map, id), `${mapId}: ${what}`);
};

test('clubs play where they played then: St. Louis, San Diego and Oakland, Baton Rouge in 2005, no Texans in 2001', () => {
  assert.equal(seasonFile('madden-2001').clubs.length, 31);
  assert.equal(clubOf('madden-2001', 'nfl-houston-texans'), null, 'the Texans joined in 2002');
  assert.deepEqual(homeOf('madden-2002', 'nfl-houston-texans'), ['Houston Texans', 'HOU', 'Houston']);
  assert.deepEqual(homeOf('madden-2001', 'nfl-st-louis-rams'), ['St. Louis Rams', 'STL', 'St. Louis']);
  assert.deepEqual(homeOf('madden-2015', 'nfl-st-louis-rams'), ['St. Louis Rams', 'STL', 'St. Louis']);
  assert.deepEqual(homeOf('madden-2016', 'nfl-los-angeles-rams'), ['Los Angeles Rams', 'LAR', 'Los Angeles (Rams)']);
  assert.deepEqual(homeOf('madden-2016', 'nfl-san-diego-chargers'), ['San Diego Chargers', 'SDC', 'San Diego']);
  assert.deepEqual(homeOf('madden-2017', 'nfl-los-angeles-chargers'), ['Los Angeles Chargers', 'LAC', 'Los Angeles (Chargers)']);
  assert.deepEqual(homeOf('madden-2019', 'nfl-oakland-raiders'), ['Oakland Raiders', 'OAK', 'Oakland']);
  assert.deepEqual(homeOf('madden-2020', 'nfl-las-vegas-raiders'), ['Las Vegas Raiders', 'LVR', 'Las Vegas']);
  assert.equal(homeOf('madden-2016', 'nfl-st-louis-rams'), null, 'gone the season after');
  // Washington: its own name before 2020, then the Washington Football Team, then the Commanders.
  assert.deepEqual(['madden-2001', 'madden-2019', 'madden-2020', 'madden-2021', 'madden-2022'].map(season => homeOf(season,
    { 'madden-2001': 'nfl-washington', 'madden-2019': 'nfl-washington', 'madden-2020': 'nfl-washington-football-team',
      'madden-2021': 'nfl-washington-football-team', 'madden-2022': 'nfl-washington-commanders' }[season])), [
    ['Washington', 'WAS', 'Washington'], ['Washington', 'WAS', 'Washington'], ['Washington Football Team', 'WAS', 'Washington'],
    ['Washington Football Team', 'WAS', 'Washington'], ['Washington Commanders', 'WAS', 'Washington']]);

  at('nfl2001', [-90.1886, 38.6328], 'nfl-st-louis-rams', 'the Edward Jones Dome is the Rams\'');
  at('nfl2001', [-94.4839, 39.0489], 'nfl-kansas-city-chiefs', 'Arrowhead is the Chiefs\': Missouri is split');
  at('nfl2001', [-83.255, 42.6458], 'nfl-detroit-lions', 'the Silverdome');
  at('nfl2002', [-88.2358, 40.0992], 'nfl-chicago-bears', 'the Bears in Champaign while Soldier Field was rebuilt');
  at('nfl2005', [-91.1856, 30.4119], 'nfl-new-orleans-saints', 'the Saints at Tiger Stadium after Katrina');
  at('nfl2006', [-73.6005, 40.7146], 'nfl-new-york-jets', 'the Jets\' Hofstra base');
  at('nfl2017', [-118.2878, 34.0142], 'nfl-los-angeles-rams', 'the Coliseum is the Rams\'');
  at('nfl2017', [-118.2611, 33.8644], 'nfl-los-angeles-chargers', 'the StubHub Center is the Chargers\': Los Angeles County is cut');
  at('nfl2020', [-118.8789, 34.2247], 'nfl-los-angeles-rams', 'the Rams\' Thousand Oaks base');
  at('nfl2020', [-117.9052, 33.6737], 'nfl-los-angeles-chargers', 'the Chargers\' Costa Mesa base');
  at('nfl2020', [-115.183, 36.0908], 'nfl-las-vegas-raiders', 'Allegiant Stadium');
  for (const entry of ERA_MAPS) {
    const map = eraMap(entry.id);
    for (const club of map.clubs) {
      const land = map.geo.countries.find(section => section.id === club.homeSection).polys;
      assert.ok(kmToPolys(club.homePoint, land) <= 2, `${entry.id}: ${club.name} plays inside its own territory`);
    }
  }
});

// ---------- the Tecmo seasons ----------

test('a Tecmo season is its snapshot: its clubs, players and overalls unchanged, its documented gaps left to the game', () => {
  const audit = JSON.parse(read('docs/design/american-football-seasons-audit.json')).seasons;
  for (const year of TECMO) {
    const snapshot = tecmoSnapshotOf(year), id = setIdOf(MANIFEST, year), doc = seasonFile(id);
    assert.equal(doc.kind, 'tecmo');
    assert.deepEqual([doc.source.provider, doc.source.url, doc.source.conversion, doc.source.retrieved, doc.source.compiler],
      ['Tecmo', snapshot.source.dump.repo, snapshot.conversion.overall, MANIFEST.sources[year].retrieved, MANIFEST.sources[year].compiler]);
    assert.ok(doc.source.edition.startsWith(`${snapshot.source.game} (${snapshot.source.platform})`), doc.source.edition);
    assert.ok(!('rawScale' in doc.source), 'the overall is ours, on no scale of the game\'s');
    assert.equal(doc.coverage.players, snapshot.players.length);
    const teams = teamsOf(FRANCHISES, MANIFEST, year);
    assert.deepEqual(doc.clubs.map(club => club.id).sort(), Object.values(snapshot.teams).map(club => club.era).sort());
    const rows = audit.find(row => row.id === id);
    assert.equal(rows.version, doc.version);
    for (const club of doc.clubs) {
      const team = teams.find(t => t.id === club.id);
      const roster = new Set(snapshot.players.filter(p => p[1] === team.franchise).map(([name, , , pos, overall]) => `${name}|${pos}|${overall}`));
      for (const [name, pos, rating] of club.squad) assert.ok(roster.has(`${name}|${pos}|${rating}`), `${year} ${club.name}: ${name} as the snapshot rates him`);
      // Each documented gap is a place the game fills out of position.
      const lineup = selectLineup({ sport: 'american-football', squad: squadPlayers(club.squad) });
      for (const [pos, n] of Object.entries(snapshot.lineup.gaps[team.franchise] || {})) {
        assert.ok(lineup.slots.filter(slot => slot.position === pos && slot.outOfPosition).length >= n, `${year} ${club.name}: ${pos} filled out of position`);
      }
      const away = lineup.slots.filter(slot => slot.outOfPosition).map(slot => `${slot.position}: ${slot.player.name} (${slot.player.pos} ${slot.player.rating})`);
      assert.deepEqual(rows.outOfPosition[club.name] ?? [], away, `${year} ${club.name}: the audit names every place filled out of position`);
    }
  }
  // NES Tecmo Super Bowl's 3-4 of two corners: every 1990 club a lineman and a corner short, and the game fills both.
  assert.ok(seasonFile('tecmo-1990').clubs.every(club => {
    const slots = selectLineup({ sport: 'american-football', squad: squadPlayers(club.squad) }).slots;
    return ['DL', 'CB'].every(pos => slots.some(slot => slot.position === pos && slot.outOfPosition));
  }));
  // A build stops on a club the season does not have, and on a shortfall the snapshot does not document.
  const build = edit => () => { const snapshot = tecmoSnapshotOf(1992); edit(snapshot); return buildTecmoSeason(snapshot, 1992, MANIFEST, FRANCHISES); };
  assert.throws(build(s => { s.teams['nfl-las-vegas-raiders'].name = 'Oakland Raiders'; }), /the snapshot's clubs Oakland Raiders are not the season's 28/);
  assert.throws(build(s => { delete s.lineup.gaps['nfl-washington-commanders']; }), /1992 Washington cannot field every position: OL/);
  assert.throws(build(s => { s.players = s.players.filter(p => !(p[1] === 'nfl-dallas-cowboys' && p[3] === 'S')); }),
    /1992 Dallas Cowboys cannot field every position: S/);
  assert.throws(() => buildTecmoSeason(tecmoSnapshotOf(1993), 1992, MANIFEST, FRANCHISES), /Tecmo snapshot rates 1993/);
});

test('the Tecmo seasons play where the clubs played then: Phoenix, the Raiders in Los Angeles, the Oilers, Clemson in 1995', () => {
  assert.deepEqual(TECMO.map(year => seasonFile(setIdOf(MANIFEST, year)).clubs.length), [28, 28, 28, 28, 30]);
  for (const id of ['nfl-baltimore-ravens', 'nfl-houston-texans', 'nfl-carolina-panthers', 'nfl-jacksonville-jaguars']) {
    assert.equal(clubOf('tecmo-1994', id), null, `${id} had no club in 1994`);
  }
  assert.deepEqual(homeOf('tecmo-1990', 'nfl-phoenix-cardinals'), ['Phoenix Cardinals', 'PHO', 'Phoenix']);
  assert.deepEqual(homeOf('tecmo-1993', 'nfl-phoenix-cardinals'), ['Phoenix Cardinals', 'PHO', 'Phoenix']);
  assert.deepEqual(homeOf('tecmo-1994', 'nfl-arizona-cardinals'), ['Arizona Cardinals', 'ARI', 'Arizona']);
  assert.deepEqual(homeOf('tecmo-1990', 'nfl-los-angeles-raiders'), ['Los Angeles Raiders', 'RAI', 'Los Angeles (Raiders)']);
  assert.deepEqual(homeOf('tecmo-1994', 'nfl-los-angeles-rams'), ['Los Angeles Rams', 'LAR', 'Los Angeles (Rams)']);
  assert.deepEqual(homeOf('tecmo-1995', 'nfl-oakland-raiders'), ['Oakland Raiders', 'OAK', 'Oakland']);
  assert.deepEqual(homeOf('tecmo-1995', 'nfl-st-louis-rams'), ['St. Louis Rams', 'STL', 'St. Louis']);
  assert.deepEqual(homeOf('tecmo-1992', 'nfl-houston-oilers'), ['Houston Oilers', 'HOU', 'Houston']);
  assert.deepEqual(homeOf('tecmo-1992', 'nfl-washington'), ['Washington', 'WAS', 'Washington']);
  assert.deepEqual(homeOf('tecmo-1995', 'nfl-carolina-panthers'), ['Carolina Panthers', 'CAR', 'Carolina']);
  assert.deepEqual(homeOf('tecmo-1995', 'nfl-jacksonville-jaguars'), ['Jacksonville Jaguars', 'JAX', 'Jacksonville']);
  assert.deepEqual(homeOf('tecmo-1995', 'nfl-cleveland-browns'), ['Cleveland Browns', 'CLE', 'Cleveland'], 'the Browns\' last season before Baltimore');
  assert.deepEqual(ERA_MAPS.find(entry => entry.id === 'nfl1992').seasons, ['tecmo-1992', 'tecmo-1993'], 'one map for two seasons alike');

  at('nfl1990', [-84.3894, 33.7394], 'nfl-atlanta-falcons', 'Atlanta–Fulton County Stadium');
  at('nfl1990', [-118.2878, 34.0142], 'nfl-los-angeles-raiders', 'the Coliseum is the Raiders\'');
  at('nfl1990', [-117.8828, 33.8003], 'nfl-los-angeles-rams', 'Anaheim Stadium is the Rams\'');
  at('nfl1990', [-95.4078, 29.685], 'nfl-houston-oilers', 'the Astrodome');
  at('nfl1990', [-76.9719, 38.89], 'nfl-washington', 'RFK Stadium, in the District');
  at('nfl1990', [-84.5083, 39.0967], 'nfl-cincinnati-bengals', 'Riverfront Stadium');
  at('nfl1990', [-122.3331, 47.5956], 'nfl-seattle-seahawks', 'the Kingdome');
  at('nfl1992', [-84.4008, 33.7575], 'nfl-atlanta-falcons', 'the Georgia Dome');
  at('nfl1995', [-82.8431, 34.6786], 'nfl-carolina-panthers', 'the Panthers\' first season, at Clemson in South Carolina');
  at('nfl1995', [-90.1886, 38.6328], 'nfl-st-louis-rams', 'the Trans World Dome');
  at('nfl1995', [-94.4839, 39.0489], 'nfl-kansas-city-chiefs', 'Arrowhead: Missouri divided again');
  assert.equal(sectionAt(eraMap('nfl1995'), [-80.8431, 35.2271]), null, 'Charlotte is nobody\'s in 1995');
});

test('the loader refuses an American football season that is not the builder\'s', () => {
  const doc = seasonFile('madden-2005');
  const broken = edit => { const copy = structuredClone(doc); edit(copy); return () => decodeFootballSet(copy, 'madden-2005'); };
  assert.throws(broken(d => { d.map = 'nfl2001'; }), /map "nfl2001" is not one of American football's maps listing this season/);
  assert.throws(broken(d => { d.map = 'mlb2022'; }), /is not one of American football's maps/);
  assert.throws(broken(d => { d.season = '2004/05'; }), /season "2004\/05" must be "2005"/);
  assert.throws(broken(d => { d.nations = {}; }), /clubs only/);
  assert.throws(broken(d => { d.clubs.pop(); }), /clubs must be the 32 of map nfl2005, found 31/);
  assert.throws(broken(d => { d.kind = 'show'; }), /kind "show" is not the kind its id names/);
  assert.throws(broken(d => { d.clubs[0].id = 'b-boston-celtics'; }), /must look like the built-in clubs'/);
  assert.throws(broken(d => { d.clubs[1].code = d.clubs[0].code; }), /is duplicated/);
  assert.throws(broken(d => { d.clubs[0].league = 'XFL'; }), /not a built-in league/);
  assert.throws(broken(d => { d.clubs[0].squad[0][1] = 'SS'; }), /is not one of the sport's/);
  assert.throws(broken(d => { d.clubs[0].squad[0][2] = 95.5; }), /whole number 1-99/);
  assert.throws(broken(d => { d.clubs[0].squad.length = 22; }), /squad needs at least 23 players/);
  assert.throws(broken(d => { d.source.rawScale = 100; }), /rawScale must be 99/);
  assert.throws(broken(d => { delete d.source.compiler; }), /who compiled its ratings/);
  // A Tecmo season must say how its overalls were made, and plays only on its own era's map.
  const tecmo = seasonFile('tecmo-1990');
  const brokenTecmo = edit => { const copy = structuredClone(tecmo); edit(copy); return () => decodeFootballSet(copy, 'tecmo-1990'); };
  assert.throws(brokenTecmo(d => { delete d.source.conversion; }), /conversion must say how the overalls were derived/);
  assert.throws(brokenTecmo(d => { d.map = 'nfl1992'; }), /map "nfl1992" is not one of American football's maps listing this season/);
  assert.throws(brokenTecmo(d => { d.clubs[0].squad.length = 22; }), /squad needs at least 23 players/);
});

test('a season binds American football to its clubs and its era\'s map', () => {
  const set = decodeFootballSet(seasonFile('madden-2005'), 'madden-2005');
  const sport = seasonSport(set);
  assert.deepEqual([sport.id, sport.dataSet, sport.dataYear, sport.dataSeason, sport.dataLabel, sport.clubMap],
    ['american-football', 'madden-2005', 2005, '2005', 'Madden NFL 06', 'nfl2005']);
  assert.equal(sport.clubs, set.clubs);
  assert.equal(set.rosters, null, 'no national teams');
  assert.equal(sportOf({ sport: 'american-football', layer: 'clubs', dataSet: 'madden-2004' }), null, 'until it has loaded');
  assert.equal(sportOf({ sport: 'football', layer: 'clubs', dataSet: 'madden-2004' }).id, 'football', 'a season plays only in its sport');
});

// ---------- the running App ----------

const B = await bundleComponents({
  App: 'src/App.jsx',
  clearDomesticCache: ['src/engine/domestic.js', 'clearDomesticCache'],
  clearFootballSetCache: ['src/engine/footballSets.js', 'clearFootballSetCache'],
  clearFootballSetIndex: ['src/engine/footballSets.js', 'clearFootballSetIndex'],
}, { jsx: 'automatic' });
const settle = () => new Promise(resolve => setImmediate(resolve));

async function withApp(fn) {
  const calls = [];
  const fetch = async url => {
    calls.push(String(url));
    const [, folder, id] = String(url).match(/^\/(domestic|american-football)\/([0-9A-Za-z-]+)\.json$/) || [];
    let text = null;
    try { text = folder && read(`public/${folder}/${id}.json`); } catch { text = null; }
    return text ? { ok: true, status: 200, json: async () => JSON.parse(text) }
      : { ok: false, status: 404, json: async () => { throw new Error('Not found'); } };
  };
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
  Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true, value: fetch });
  B.clearDomesticCache();
  B.clearFootballSetCache();
  B.clearFootballSetIndex();
  const f = syncAppFixture({ App: B.App, phase: 'setup', ids: ['840', '124', '484'],
    settings: { sport: 'football', layer: 'nations', scope: 'UEFA', clubScope: 'all', role: 'spectator', seed: '11' } });
  f.app.opening = B.App.prototype.opening;
  try { return await fn({ ...f, calls }); } finally {
    f.close();
    if (prior) Object.defineProperty(globalThis, 'fetch', prior); else delete globalThis.fetch;
  }
}

/** Choose a season and wait for it and its map, as the player waits on the setup screen. */
async function chooseSeason(app, time, id) {
  app.pickSetup('dataSet', id);
  time.advance(200);
  await Promise.all([app.loadCountry(seasonMapOf(id)), app.loadSet(id)]);
  await settle();
  assert.equal(app.seasonStatus().state, 'ready');
  assert.equal(app.domesticStatus().state, 'ready');
}
const modelOf = app => buildSetupModel(app.state.setup, { managerTeams: app.setupTeams(), domestic: app.domesticStatus(), season: app.seasonStatus() });

test('American football\'s Season choice lists its seasons; one takes the clubs onto its era\'s map', async () => {
  await withApp(async ({ app }) => {
    app.pickSetup('sport', 'american-football');
    const model = modelOf(app);
    assert.deepEqual(model.season.options.map(option => option.label),
      ['2026 · built in', ...BUILT_IN_AMERICAN_FOOTBALL_SEASONS.map(set => `${set.season} · ${set.label}`)]);
    assert.deepEqual(model.season.options.map(option => option.name), ['2026', ...BUILT_IN_AMERICAN_FOOTBALL_SEASONS.map(set => set.season)]);
    assert.equal(model.season.options.at(-1).label, '1990 · Tecmo Super Bowl (NES)');

    app.pickSetup('dataSet', 'madden-2001');
    assert.deepEqual([app.state.setup.layer, app.state.setup.dataSet, app.state.setup.clubScope], ['clubs', 'madden-2001', 'domestic:nfl2001']);
    const loading = modelOf(app);
    assert.deepEqual(loading.scopes.map(scope => [scope.id, scope.label, scope.count]), [['domestic:nfl2001', 'NFL', 31]]);
    assert.equal(loading.canLaunch, false, 'Launch waits for the season and its map');
    app.pickSetup('dataSet', 'madden-2025');
    assert.equal(app.state.setup.clubScope, 'domestic:nfl', 'today\'s clubs in today\'s stadiums play on today\'s map');
    app.pickSetup('dataSet', null);
    assert.equal(app.state.setup.clubScope, 'domestic:nfl', 'the built-in season plays on today\'s map');
    app.pickSetup('dataSet', 'madden-2010');
    app.pickSetup('sport', 'basketball');
    assert.equal(app.state.setup.dataSet, null, 'a season stays with its sport');
  });
});

test('a season\'s clubs launch on their era\'s map, save, and resume as they were played', async () => {
  await withApp(async ({ app, time, items, calls }) => {
    app.pickSetup('sport', 'american-football');
    await chooseSeason(app, time, 'madden-2005');
    const doc = seasonFile('madden-2005');
    assert.equal(modelOf(app).canLaunch, true);
    app.startCampaign();
    const st = app.state;
    assert.equal(st.phase, 'playing');
    assert.deepEqual([st.settings.sport, st.settings.layer, st.settings.dataSet, st.settings.dataVersion, st.settings.dataYear, st.settings.dataSeason,
      st.settings.clubScope], ['american-football', 'clubs', 'madden-2005', doc.version, 2005, '2005', 'domestic:nfl2005']);
    assert.equal(st.settings.domesticVersion, CLUB_MAPS.find(entry => entry.id === 'nfl2005').version);
    assert.equal(st.campaignName, 'American football 2005 · NFL · USA');
    assert.deepEqual(Object.keys(st.teams).sort(), doc.clubs.map(club => club.id).sort());
    for (const club of doc.clubs) {
      const team = st.teams[club.id];
      assert.deepEqual([team.name, team.code, team.str], [club.name, club.code, club.str]);
      assert.deepEqual(team.squad.map(p => [p.name, p.pos, p.rating]), club.squad, `${club.name}'s Madden NFL 06 squad`);
      assert.equal(st.own[team.home], team.id);
    }
    assert.equal(app.territoryName(st.teams['nfl-st-louis-rams'].home), 'St. Louis');
    assert.equal(app.territoryName(st.teams['nfl-new-orleans-saints'].home), 'New Orleans');
    assert.ok(calls.includes('/american-football/madden-2005.json') && calls.includes('/domestic/nfl2005.json'));

    // The save holds every player as played, so it resumes without the season file.
    const text = items.get(SAVE_KEY);
    const saved = parseCampaign(text);
    assert.equal(JSON.stringify(saved.teams), JSON.stringify(st.teams));
    B.clearFootballSetCache();
    app.continueSaved(saved);
    assert.equal(app.state.phase, 'playing');
    assert.equal(JSON.stringify(app.state.teams), JSON.stringify(st.teams));

    // A season belongs on its own map, and an era's map belongs to its seasons.
    const edited = edit => { const data = JSON.parse(text); edit(data.settings); if (data.initialSettings) edit(data.initialSettings); return JSON.stringify(data); };
    const today = CLUB_MAPS.find(entry => entry.id === 'nfl').version;
    assert.throws(() => parseCampaign(edited(s => { s.clubScope = 'domestic:nfl'; s.domesticVersion = today; })), /Campaign data set is invalid/);
    assert.throws(() => parseCampaign(edited(s => { s.dataSeason = '2004/05'; })), /Campaign data set is invalid/);
    assert.throws(() => parseCampaign(edited(s => { s.sport = 'baseball'; })), /Campaign data set is invalid/);
  });
});

test('a season with today\'s clubs plays on today\'s map with that season\'s squads', async () => {
  await withApp(async ({ app, time }) => {
    app.pickSetup('sport', 'american-football');
    await chooseSeason(app, time, 'madden-2024');
    app.startCampaign();
    const st = app.state;
    assert.equal(st.settings.clubScope, 'domestic:nfl');
    const doc = seasonFile('madden-2024');
    const niners = doc.clubs.find(club => club.id === 'nfl-san-francisco-49ers');
    assert.deepEqual(st.teams['nfl-san-francisco-49ers'].squad.map(p => p.name), niners.squad.map(([name]) => name), 'Madden NFL 25\'s 49ers');
    assert.notDeepEqual(niners.squad.map(([name]) => name), CLUBS.find(club => club.id === 'nfl-san-francisco-49ers').squad.map(([name]) => name),
      'not today\'s');
  });
});

test('a Tecmo season launches its clubs on their era\'s map: the Raiders in Los Angeles in 1990', async () => {
  await withApp(async ({ app, time, items }) => {
    app.pickSetup('sport', 'american-football');
    await chooseSeason(app, time, 'tecmo-1990');
    const doc = seasonFile('tecmo-1990');
    app.startCampaign();
    const st = app.state;
    assert.equal(st.phase, 'playing');
    assert.deepEqual([st.settings.dataSet, st.settings.dataVersion, st.settings.dataYear, st.settings.dataSeason, st.settings.clubScope],
      ['tecmo-1990', doc.version, 1990, '1990', 'domestic:nfl1990']);
    assert.equal(st.campaignName, 'American football 1990 · NFL · USA');
    assert.equal(Object.keys(st.teams).length, 28);
    const raiders = st.teams['nfl-los-angeles-raiders'];
    assert.deepEqual([raiders.name, raiders.code], ['Los Angeles Raiders', 'RAI']);
    assert.equal(app.territoryName(raiders.home), 'Los Angeles (Raiders)');
    assert.deepEqual(raiders.squad.map(p => [p.name, p.pos, p.rating]), doc.clubs.find(club => club.id === 'nfl-los-angeles-raiders').squad);
    const saved = parseCampaign(items.get(SAVE_KEY));
    assert.equal(JSON.stringify(saved.teams), JSON.stringify(st.teams), 'saved as played');
  });
});
