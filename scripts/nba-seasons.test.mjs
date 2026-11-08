// The built-in earlier basketball seasons (docs/design/football-years.md, "Earlier basketball seasons"): the builder
// on invented players (scripts/lib/nba-seasons.mjs), the readers of the seasons before NBA 2K (a 2kratings MyNBA Eras
// page, NBA Live 99's dBase tables, Basketball-Reference's player seasons) and NBA Live 99's line on invented data, the
// shipped seasons against their era maps, the manifest and the audit, the loader's checks, and the running App: a
// season's Season row, its era's map, a launch with its fives, and a save that resumes as it was played.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SAVE_KEY } from '../src/config.js';
import { BUILT_IN_BASKETBALL_SEASONS } from '../src/data/basketballSeasons.js';
import { CLUB_MAPS } from '../src/data/clubMaps.js';
import { CLUBS } from '../src/data/clubs.basketball.js';
import { colourFor, contentHash } from '../src/data/footballSetBuild.js';
import { decodeDomestic } from '../src/engine/domestic.js';
import { BUILT_IN_SETS, builtInSeasonOf, clearFootballSetIndex, decodeFootballSet, loadFootballSetIndex, seasonMapOf, seasonSport,
  setSportOf, sportOf } from '../src/engine/footballSets.js';
import { parseCampaign } from '../src/engine/storage.js';
import { buildSetupModel } from '../src/screens/setup/setupModel.js';
import { buildNbaSeason, editionOf, extractYears, fitLine, labelOf, leftOutNotes, liveScale, mapOf, nameKey, notListed, onLine, parseCsv,
  parseErasPage, parseLive99, positionsOf, readDbf, readPlayerSeasons, realPlayers, seasonIdOf, setIdOf, teamsOf } from './lib/nba-seasons.mjs';
import { bundleComponents, syncAppFixture } from './lib/app-harness.mjs';

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const MANIFEST = JSON.parse(read('scripts/data/nba-seasons.json'));
const ARENAS = JSON.parse(read('scripts/data/nba-arenas.json')).clubs;
const seasonFile = id => JSON.parse(read(`public/basketball/${id}.json`));
const mapFile = id => JSON.parse(read(`public/domestic/${id}.json`));

// ---------- the builder, on invented players ----------

const TEST_MANIFEST = {
  source: { name: 'Test Archive', url: 'https://example.test/ratings', file: 'home.html', sha256: '0'.repeat(64) },
  teams: {
    // Moved after 2001: its own city and arena before, then the game's club's.
    MOV: [{ to: 2001, id: 'b-old-town-movers', name: 'Old Town Movers', city: 'Old Town', arena: 'Old Hall', home: [-100, 40] },
      { from: 2002, id: 'b-boston-celtics', name: 'Boston Celtics' }],
    NEW: [{ id: 'b-new-city-testers', name: 'New City Testers', city: 'New City', arena: 'Test Dome', home: [-90, 35] }],
  },
  maps: [{ id: 'test2001', seasons: [2001] }, { id: 'test2002', seasons: [2002] }],
};
const player = (n, p, o, t) => ({ n, p, o, t });
const five = (team, base) => [player(`${team} Point`, 'PG', base + 4, team), player(`${team} Shooter`, 'SG/SF', base + 3, team),
  player(`${team} Wing`, 'SF', base + 2, team), player(`${team} Forward`, 'PF/C', base + 1, team), player(`${team} Centre`, 'C', base, team)];
const YEARS = {
  2001: [...five('MOV', 80), player('MOV Bench', 'C', 60, 'MOV'), player('Blank Guard', '', 99, 'MOV'),
    player('Nobody Knows', '', 98, 'NEW'), ...five('NEW', 70), player('Free Agent', 'PG', 97, 'FA')],
  2002: [...five('MOV', 81), player('Blank Guard', 'SG/C', 90, 'NEW'), ...five('NEW', 71)],
};

test('editions, ids and positions read as the game names them', () => {
  assert.deepEqual([2000, 2008, 2024].map(editionOf), ['NBA 2K', 'NBA 2K8', 'NBA 2K24']);
  assert.deepEqual([2000, 2008, 2024].map(seasonIdOf), ['nba-2k00', 'nba-2k08', 'nba-2k24']);
  assert.deepEqual(['SF/PF', 'C', 'PG/C', 'G', ''].map(positionsOf), [['SF', 'PF'], ['C'], ['PG'], null, null],
    'a second position that is no neighbour is dropped');
});

test('the YEARS table is read as data: braces inside strings do not end it, and nothing on the page runs', () => {
  const html = '<script>const NOTE = "}"; const YEARS = {"2001":[{"n":"Brace } \\"Quote\\" {","o":80,"p":"PG","t":"MOV"}]};'
    + ' globalThis.ran = true;</script>';
  assert.deepEqual(extractYears(html), { 2001: [{ n: 'Brace } "Quote" {', o: 80, p: 'PG', t: 'MOV' }] });
  assert.equal(globalThis.ran, undefined);
  assert.throws(() => extractYears('<p>No ratings here</p>'), /no YEARS table/);
  assert.throws(() => extractYears('const YEARS = {"2001": ['), /never closes/);
});

test('a season keeps each club\'s best five as 2K rated them, on its era\'s teams and map', () => {
  const builtIn = [{ id: 'b-boston-celtics', code: 'BCE', col: 'oklch(0.5 0.1 10)' }];
  const arenas = { 'b-boston-celtics': { city: 'Boston', arena: 'TD Garden', home: [-71.06, 42.37] } };
  assert.deepEqual(teamsOf(TEST_MANIFEST, 2002, arenas).map(team => [team.code, team.id, team.city]),
    [['MOV', 'b-boston-celtics', 'Boston'], ['NEW', 'b-new-city-testers', 'New City']]);
  assert.deepEqual([mapOf(TEST_MANIFEST, 2001), mapOf(TEST_MANIFEST, 2002)], ['test2001', 'test2002']);

  const { doc, text, audit } = buildNbaSeason(YEARS, 2001, TEST_MANIFEST, { arenas, builtIn });
  assert.equal(text, `${JSON.stringify(doc)}\n`);
  assert.deepEqual({ ...doc, clubs: undefined, version: undefined }, { format: 1, kind: 'nba2k', id: 'nba-2k01', version: undefined,
    year: 2001, season: '2000/01', label: 'NBA 2K1', local: false,
    source: { provider: '2K Sports', edition: 'NBA 2K1', compiler: 'Test Archive', url: 'https://example.test/ratings', rawScale: 99 },
    map: 'test2001', clubs: undefined, coverage: { players: 10, clubs: 2 } });
  assert.equal(doc.version, `nba-2k01-${contentHash(doc)}`, 'content-hash version');
  const [movers, testers] = doc.clubs;
  // The blank position comes from the nearest edition that lists him (2002's, the only one: 'SG/C' keeps SG). The five
  // is the strongest lineup the positions allow: the shooter covers SF, so the wing (82) sits for the centre (80).
  // 2K's ratings stay as rated.
  assert.deepEqual(movers, { id: 'b-old-town-movers', name: 'Old Town Movers', code: movers.code, league: 'NBA', country: '840',
    col: colourFor('b-old-town-movers'), str: 85,
    squad: [['Blank Guard', 'SG', 99], ['MOV Point', 'PG', 84], ['MOV Shooter', 'SG/SF', 83], ['MOV Forward', 'PF/C', 81], ['MOV Centre', 'C', 80]] });
  assert.match(movers.code, /^[A-Z]{3}$/);
  assert.equal(testers.str, 72, 'a player with no position in any edition is left out, never guessed');
  assert.deepEqual(audit.filledPositions, ['Blank Guard SG (NBA 2K2)']);
  assert.deepEqual(audit.droppedNoPosition, ['Nobody Knows']);
  assert.ok(!text.includes('Free Agent'), 'free agents play for nobody');

  // A club that kept its id keeps the game's code and colour.
  const later = buildNbaSeason(YEARS, 2002, TEST_MANIFEST, { arenas, builtIn }).doc;
  assert.deepEqual(later.clubs.map(club => [club.id, club.code, club.col]),
    [['b-boston-celtics', 'BCE', 'oklch(0.5 0.1 10)'], ['b-new-city-testers', later.clubs[1].code, colourFor('b-new-city-testers')]]);
});

// ---------- the seasons before NBA 2K, on invented sources ----------

const card = (team, rows) => `<div class="card"><span class="h5 card-title">${team}</span><table><tbody>${rows.map(([name, pos, ovr]) =>
  `<tr><td><div class="entries"> <span class="entry-font entry-font-narrow">${name} <small class="entry-pos">${pos}</small></span></div></td><td> `
  + `<span data-order="${ovr}.00" class="attribute-box gold">${ovr}</span></td><td> <span data-order="50" class="attribute-box low">50</span></td></tr>`).join('')}</tbody></table></div>`;

test('a MyNBA Eras page is read as data: each card\'s players with 2K\'s position and overall, by the manifest\'s team codes', () => {
  const html = `<html>${card('Old Town Movers', [['Moe O&#039;Neal', 'PF', 86], ['R. Filler', 'PG', 66]])}${card('New City Testers', [['Ana Ruiz &amp; Co', 'C', 70]])}</html>`;
  const teams = { 'Old Town Movers': 'MOV', 'New City Testers': 'NEW' };
  assert.deepEqual(parseErasPage(html, teams), [{ n: "Moe O'Neal", o: 86, p: 'PF', t: 'MOV' }, { n: 'R. Filler', o: 66, p: 'PG', t: 'MOV' },
    { n: 'Ana Ruiz & Co', o: 70, p: 'C', t: 'NEW' }]);
  assert.throws(() => parseErasPage(html, { 'Old Town Movers': 'MOV' }), /a team the manifest does not know: New City Testers/);
  assert.throws(() => parseErasPage(html, { ...teams, 'Gone Club': 'GON' }), /no card for GON/);
  assert.throws(() => parseErasPage(`${card('Old Town Movers', [])}`, { 'Old Town Movers': 'MOV' }), /no players for Old Town Movers/);
  assert.throws(() => parseErasPage('<p>nothing</p>', teams), /no team cards/);
});

/** A dBase III table of text fields, as NBA Live 99 writes them; a row may be marked deleted. */
function dbf(fields, rows) {
  const headerLength = 32 + fields.length * 32 + 1, recordLength = 1 + fields.reduce((sum, [, length]) => sum + length, 0);
  const buffer = Buffer.alloc(headerLength + rows.length * recordLength + 1, 0x20);
  buffer.fill(0, 0, headerLength);
  buffer[0] = 0x03;
  buffer.writeUInt32LE(rows.length, 4);
  buffer.writeUInt16LE(headerLength, 8);
  buffer.writeUInt16LE(recordLength, 10);
  fields.forEach(([name, length], i) => { buffer.write(name, 32 + i * 32, 'latin1'); buffer[32 + i * 32 + 11] = 0x43; buffer[32 + i * 32 + 16] = length; });
  buffer[headerLength - 1] = 0x0d;
  rows.forEach((row, r) => {
    let at = headerLength + r * recordLength;
    buffer[at++] = row.deleted ? 0x2a : 0x20;
    row.values.forEach((value, i) => { buffer.write(String(value).padEnd(fields[i][1]), at, 'latin1'); at += fields[i][1]; });
  });
  buffer[buffer.length - 1] = 0x1a;
  return buffer;
}

test('NBA Live 99\'s roster files are read as data: each NBA player\'s name, EA\'s overall, position and team', () => {
  const teams = readDbf(dbf([['TEAMNUM', 3], ['CITYNAME', 16], ['TEAMNAME', 15], ['ABBREV', 4]], [
    { values: [0, 'Old Town', 'Movers', 'OT'] }, { values: [1, 'New City', 'Testers', 'NC'] },
    { values: [29, 'Free Agents', 'Free Agents', 'FA'] }, { values: [30, 'East', 'All-Stars', 'ASE'] }])).rows;
  const players = readDbf(dbf([['NAME', 20], ['FNAME', 20], ['POSITION', 1], ['POSITION2', 2], ['OVERALLRTG', 3], ['TEAM', 3]], [
    { values: ['Centre', 'Ana', 0, 1, 61, 0] }, { values: ['Guard', 'Bo', 4, -1, 48, 1] }, { values: ['Wing', 'Cy', 2, 3, 55, 1] },
    { values: ['Free', 'Dee', 3, -1, 40, 29] }, { values: ['Centre', 'Ana', 0, 1, 61, 30] }, { values: ['Gone', 'Ed', 1, -1, 50, 0], deleted: true }])).rows;
  assert.deepEqual(players.map(p => p.NAME), ['Centre', 'Guard', 'Wing', 'Free', 'Centre'], 'a deleted row is left out');
  const codes = { OT: 'MOV', NC: 'NEW' };
  // POSITION 0-4 is C, PF, SF, SG, PG; POSITION2 -1 is none. Free agents and All-Stars play for no club.
  assert.deepEqual(parseLive99(players, teams, { codes, others: ['FA', 'ASE'] }), [
    { n: 'Ana Centre', raw: 61, p: 'C/PF', t: 'MOV' }, { n: 'Bo Guard', raw: 48, p: 'PG', t: 'NEW' }, { n: 'Cy Wing', raw: 55, p: 'SF/SG', t: 'NEW' }]);
  assert.throws(() => parseLive99(players, teams, { codes, others: ['FA'] }), /a team the manifest does not know: ASE/);
  assert.throws(() => parseLive99(players, teams, { codes: { ...codes, XX: 'GON' }, others: ['FA', 'ASE'] }), /no team for GON/);
  assert.throws(() => parseLive99([{ ...players[0], POSITION: '7' }], teams, { codes, others: ['FA', 'ASE'] }), /has position 7/);
  assert.throws(() => readDbf(Buffer.from('not a table at all, not a table at all')), /Not a dBase III table/);
});

// Basketball-Reference's seasons, invented: who played where, and for how long.
const PLAYED = readPlayerSeasons([
  'season,lg,player,player_id,team,g,mp',
  '2001,NBA,Real Starter,a,MVR,80,2500',
  '2001,NBA,Spelt Otherwise,b,MVR,10,100',
  '2001,NBA,Elsewhere Guy,c,OTH,50,1500',
  '2001,NBA,Missing Star,d,MVR,82,3000',
  '2000,NBA,Injured Veteran,e,MVR,60,1800',
  '2001,NBA,Renamed Later,f,MVR,70,2000',
  '2001,NBA,Traded Twice,g,2TM,40,900',
  '2001,ABA,Other League,h,MVR,30,800',
  '"2001","NBA","Quoted, Name",i,"NEW",5,"30"',
].join('\n'));

test('Basketball-Reference\'s player seasons are read as data, quotes and commas kept', () => {
  assert.deepEqual(parseCsv('a,"b, ""c""",d\r\n1,2\n'), [['a', 'b, "c"', 'd'], ['1', '2']]);
  assert.deepEqual(PLAYED.at(-1), { season: 2001, league: 'NBA', name: 'Quoted, Name', team: 'NEW', games: 5, minutes: 30 });
  assert.throws(() => readPlayerSeasons('season,lg,player,team\n'), /no g column/);
  assert.deepEqual(['Dražen Petrović', 'Gary Payton II', 'J.R. Reid', "Shaquille O'Neal", 'Abdul-Jabbar'].map(nameKey),
    ['drazen petrovic', 'gary payton', 'jr reid', 'shaquille oneal', 'abdul jabbar']);
});

test('only real players stay: those who played for their club, or whom the manifest documents on its roster', () => {
  const listed = [
    { n: 'Real Starter', o: 85, p: 'PG', t: 'MOV' }, { n: 'Spelled Otherwise', o: 80, p: 'SG', t: 'MOV' },
    { n: 'R. Filler', o: 66, p: 'SF', t: 'MOV' }, { n: 'Elsewhere Guy', o: 75, p: 'PF', t: 'MOV' },
    { n: 'I. Veteran', o: 82, p: 'C', t: 'MOV' }, { n: 'R. Later', o: 78, p: 'C', t: 'MOV' }, { n: 'O. League', o: 70, p: 'C', t: 'MOV' }];
  const options = { season: 2001, rule: 'club', codes: { MOV: 'MVR' }, aliases: { 'Spelled Otherwise': 'Spelt Otherwise' },
    roster: { 'MOV I. Veteran': { name: 'Injured Veteran', note: 'on injured reserve all season' },
      'MOV R. Later': { name: 'Before Rename', bref: 'Renamed Later', note: 'took his later name in 2003' } } };
  const { kept, leftOut, named } = realPlayers(listed, PLAYED, options);
  assert.deepEqual(kept.map(p => [p.n, p.o]), [['Real Starter', 85], ['Spelled Otherwise', 80], ['Injured Veteran', 82], ['Before Rename', 78]],
    'an initial becomes the real player\'s name; his rating stays the source\'s');
  assert.deepEqual(leftOut.map(p => p.n), ['R. Filler', 'Elsewhere Guy', 'O. League'], 'a filler, another club\'s player and another league\'s');
  assert.deepEqual(named, ['Spelled Otherwise (MOV) is Basketball-Reference\'s Spelt Otherwise',
    'I. Veteran (MOV) is Injured Veteran: did not play for the club in 2000/01; on injured reserve all season',
    'R. Later (MOV) is Before Rename (Basketball-Reference\'s Renamed Later)']);
  assert.deepEqual(leftOutNotes(leftOut, PLAYED, 2001, { MOV: 'MVR' }),
    ['R. Filler (MOV, SF 66)', 'Elsewhere Guy (MOV, PF 75): Elsewhere Guy played for OTH', 'O. League (MOV, C 70)']);
  // A real player of the season the source does not list at all, by the minutes he played for his club.
  assert.deepEqual(notListed(listed, PLAYED, 2001, { ...options, minutes: 1000 }), ['MOV Missing Star (3000 min)']);
  assert.deepEqual(notListed(listed, PLAYED, 2001, { ...options, minutes: 30 }), ['MOV Missing Star (3000 min)', 'NEW Quoted, Name (30 min)'],
    'a total over several clubs (Traded Twice) is no club\'s');

  // A roster entry must hold: a player who did not play needs the manifest's note and NBA seasons around it.
  const without = note => () => realPlayers(listed, PLAYED, { ...options, roster: { 'MOV I. Veteran': { name: 'Injured Veteran', note } } });
  assert.throws(without(undefined), /I. Veteran \(MOV\) is not Injured Veteran/);
  assert.throws(() => realPlayers(listed, PLAYED, { ...options, roster: { 'MOV R. Filler': { name: 'Nobody Real', note: 'made up' } } }),
    /R. Filler \(MOV\) is not Nobody Real/);
  assert.throws(() => realPlayers(listed, PLAYED, { ...options, roster: { 'NEW R. Filler': { name: 'X', note: 'y' } } }), /names no listed player/);
  assert.throws(() => realPlayers(listed, PLAYED, { ...options, aliases: { 'Not Listed': 'Somebody' } }), /matches 0 players/);
  // NBA Live 99's rule: a real NBA player, whatever his club.
  assert.deepEqual(realPlayers(listed, PLAYED, { season: 2001, rule: 'league', aliases: options.aliases }).kept.map(p => p.n),
    ['Real Starter', 'Spelled Otherwise', 'Elsewhere Guy']);
});

test('NBA Live 99\'s overalls go on NBA 2K\'s scale by one straight line, the least-squares one, fixed in the manifest', () => {
  assert.deepEqual(fitLine([[1, 3], [2, 5], [3, 7]]), { intercept: 1, slope: 2, correlation: 1 });
  // Worked in thousandths: 20.22 + 1.089 × 70 = 96.45 rounds to 96, never by a float's whim.
  assert.deepEqual([28, 61, 70].map(onLine({ intercept: 20.22, slope: 1.089 })), [51, 87, 96]);
  const players = [40, 45, 50, 55, 60, 65, 70].map((raw, i) => ({ n: `Player ${i}`, raw }));
  const others = [40, 45, 50, 55, 60, 65].map((raw, i) => ({ n: `Player ${i}`, o: raw + 25 })).concat({ n: 'Only In 2K', o: 99 });
  const { map, table, check } = liveScale(players, others, { intercept: 25, slope: 1 });
  assert.deepEqual(table, { 40: 65, 45: 70, 50: 75, 55: 80, 60: 85, 65: 90, 70: 95 });
  assert.equal(map(70), 95, 'a player only NBA Live 99 rates takes the line too');
  assert.deepEqual([check.common, check.correlation, check.line.meanAbsolute, check.splitHalves[0].meanAbsolute], [6, 1, 0, 0]);
  assert.deepEqual(check.rawPlus30, { players: 6, meanAbsolute: 5, rootMeanSquare: 5, bias: 5, above99: 1 });
  assert.throws(() => liveScale(players, others, { intercept: 24, slope: 1 }), /line through the 6 players both editions rate is 25 \+ 1 × raw, not the manifest's 24/);
  // A name either list holds twice is nobody's pair.
  assert.equal(liveScale([...players, { n: 'Player 0', raw: 41 }], others, { intercept: 25, slope: 1 }).check.common, 5);
});

test('a season from another source takes its id, label, edition and maker from the manifest, and its audit says what was checked', () => {
  const manifest = { ...TEST_MANIFEST, maps: [...TEST_MANIFEST.maps, { id: 'test1999', seasons: [1999] }],
    teams: { MOV: [{ id: 'b-old-town-movers', name: 'Old Town Movers', city: 'Old Town', arena: 'Old Hall', home: [-100, 40] }],
      NEW: TEST_MANIFEST.teams.NEW },
    extra: { 1999: { format: 'nba-live-dbf', id: 'nba-live-99', label: 'Old Game 99', edition: 'Old Game 99', provider: 'Old Games', name: 'A Fan Site',
      url: 'https://example.test/old-game-99' } } };
  const players = [...five('MOV', 80), ...five('NEW', 70)].map(p => ({ ...p, raw: p.o - 25 }));
  const source = { players, rows: 12, named: ['X (MOV) is Y'], leftOut: ['Roster Player (MOV, SG 71)'],
    scale: { table: { 45: 70 }, check: { common: 9 } } };
  const { doc, audit } = buildNbaSeason({ 1999: players }, 1999, manifest, { arenas: {}, source });
  assert.deepEqual([doc.id, doc.season, doc.label, doc.map], ['nba-live-99', '1998/99', 'Old Game 99', 'test1999']);
  assert.deepEqual(doc.source, { provider: 'Old Games', edition: 'Old Game 99', compiler: 'A Fan Site', url: 'https://example.test/old-game-99', rawScale: 99 });
  assert.equal(doc.version, `nba-live-99-${contentHash(doc)}`);
  assert.deepEqual([audit.label, audit.sourceRows, audit.kept, audit.named, audit.leftOut], ['Old Game 99', 12, 10, source.named, source.leftOut]);
  assert.equal(audit.scale.fives[0], 'Old Town Movers: MOV Point 59→84, MOV Shooter 58→83, MOV Wing 57→82, MOV Forward 56→81, MOV Centre 55→80');
  assert.deepEqual([setIdOf(manifest, 1999), labelOf(manifest, 1999), setIdOf(manifest, 2001), labelOf(manifest, 2001)],
    ['nba-live-99', 'Old Game 99', 'nba-2k01', 'NBA 2K1']);
});

test('the builder stops on an edition whose teams are not the manifest\'s, or a club short of five', () => {
  const arenas = { 'b-boston-celtics': { city: 'Boston', arena: 'TD Garden', home: [-71.06, 42.37] } };
  const build = years => () => buildNbaSeason(years, 2001, TEST_MANIFEST, { arenas });
  assert.throws(build({ 2001: [...YEARS[2001], player('Stranger', 'PG', 70, 'ZZZ')] }), /teams ZZZ are not the manifest's/);
  assert.throws(build({ 2001: five('MOV', 80) }), /missing NEW/);
  assert.throws(build({ 2001: [...five('MOV', 80), ...five('NEW', 70).slice(1)] }), /New City Testers has 4 players/);
  assert.throws(build({ 2001: [...five('MOV', 80), ...five('NEW', 70), player('Bad Rating', 'PG', 120, 'NEW')] }), /rating outside 1-99/);
  assert.throws(() => buildNbaSeason(YEARS, 2003, TEST_MANIFEST, { arenas }), /no NBA 2K3/);
});

// ---------- the shipped seasons ----------

// Basketball's era maps; baseball's are scripts/baseball-seasons.test.mjs's.
const ERA_MAPS = CLUB_MAPS.filter(entry => entry.seasons && entry.sport === 'basketball');

test('the built-in seasons are the manifest\'s, newest first: every NBA 2K edition, then three seasons before it', () => {
  assert.deepEqual(BUILT_IN_BASKETBALL_SEASONS.map(set => set.year), MANIFEST.seasons.slice().sort((a, b) => b - a));
  assert.deepEqual(BUILT_IN_BASKETBALL_SEASONS.map(set => set.id), MANIFEST.seasons.slice().sort((a, b) => b - a).map(year => setIdOf(MANIFEST, year)));
  assert.equal(BUILT_IN_BASKETBALL_SEASONS.length, 30);
  assert.deepEqual([BUILT_IN_BASKETBALL_SEASONS[0].label, BUILT_IN_BASKETBALL_SEASONS.at(-1).label], ['NBA 2K26', 'NBA 2K27 (Magic vs Bird era)']);
  assert.deepEqual(MANIFEST.seasons, [1984, 1992, 1999, ...Array.from({ length: 27 }, (_, i) => 2000 + i)], 'no NBA 2K season is missing');
  // 2K Archive lists only three Philadelphia and San Antonio players for NBA 2K12: that season is The Real 2K Insider's list.
  const twelve = BUILT_IN_BASKETBALL_SEASONS.find(set => set.year === 2012);
  assert.deepEqual([twelve.label, twelve.season, twelve.map], ['NBA 2K12', '2011/12', 'nba2009']);
  assert.equal(MANIFEST.extra['2012'].name, 'The Real 2K Insider');
  assert.deepEqual(builtInSeasonOf('basketball'), { year: MANIFEST.builtIn.year, season: MANIFEST.builtIn.season });
  // Listed with the football seasons, each with its map; a local index never adds a basketball season.
  for (const listed of BUILT_IN_BASKETBALL_SEASONS) {
    const set = BUILT_IN_SETS.find(entry => entry.id === listed.id);
    assert.deepEqual(set, { id: listed.id, version: listed.version, year: listed.year, season: listed.season, label: listed.label, map: listed.map });
    assert.equal(setSportOf(set.id), 'basketball');
    assert.equal(seasonMapOf(set.id), mapOf(MANIFEST, set.year));
  }
  assert.ok(BUILT_IN_SETS.filter(set => setSportOf(set.id) === 'football').every(set => !('map' in set)));
});

test('a local index never lists a basketball season', async () => {
  clearFootballSetIndex();
  const index = { format: 1, sets: [{ id: 'nba-2k99', year: 2099, season: '2098/99', label: 'NBA 2K99', map: 'nba' }] };
  const sets = await loadFootballSetIndex({ fetch: async () => ({ ok: true, json: async () => index }) });
  assert.equal(sets, BUILT_IN_SETS);
  clearFootballSetIndex();
});

test('every season loads and fits its era\'s map: the same franchises, named and housed as that season had them', () => {
  const today = new Set(CLUBS.map(club => club.id));
  for (const listed of BUILT_IN_BASKETBALL_SEASONS) {
    const doc = seasonFile(listed.id);
    const set = decodeFootballSet(structuredClone(doc), listed.id);
    assert.equal(doc.version, listed.version);
    assert.equal(doc.version, `${listed.id}-${contentHash(doc)}`, `${listed.id} is the builder's file`);
    assert.equal(doc.label, labelOf(MANIFEST, doc.year));
    assert.equal(doc.id, setIdOf(MANIFEST, doc.year));
    const map = decodeDomestic(mapFile(listed.map), listed.map);
    const entry = CLUB_MAPS.find(item => item.id === listed.map);
    assert.equal(map.meta.version, entry.version);
    assert.deepEqual(set.clubs.map(club => club.id).sort(), map.clubs.map(club => club.id).sort(), `${listed.id} has ${listed.map}'s franchises`);
    const teams = new Map(teamsOf(MANIFEST, doc.year, ARENAS).map(team => [team.id, team]));
    for (const row of map.clubs) {
      const team = teams.get(row.id), club = set.clubs.find(item => item.id === row.id);
      assert.equal(club.name, team.name);
      assert.equal(map.sectionNames[row.homeSection], team.city, `${team.name} starts at home`);
      assert.deepEqual(row.homePoint, team.home);
      if (entry.seasons) assert.equal(row.name, club.name, 'an era map names its season\'s franchises');
      // The best five, rated as 2K rated them.
      assert.equal(club.squad.length, 5);
      assert.equal(club.str, Math.round(club.squad.reduce((sum, [, , rating]) => sum + rating, 0) / 5));
    }
    if (entry.seasons) assert.ok(entry.seasons.includes(listed.id));
    else assert.deepEqual(new Set(set.clubs.map(club => club.id)), today, 'today\'s map serves seasons with today\'s franchises');
  }
  // Every era map serves at least one season, and only seasons that name it.
  for (const entry of ERA_MAPS) {
    assert.deepEqual(entry.seasons, BUILT_IN_BASKETBALL_SEASONS.filter(set => set.map === entry.id).map(set => set.id).sort());
    assert.ok(!('top' in entry), 'an era\'s strongest clubs are its seasons\' own');
  }
  assert.deepEqual(ERA_MAPS.map(entry => entry.id), MANIFEST.maps.map(map => map.id).filter(id => id !== 'nba'));
});

test('franchises that moved play where they played then', () => {
  const homeOf = (season, id) => {
    const listed = BUILT_IN_BASKETBALL_SEASONS.find(set => set.id === season);
    const map = decodeDomestic(mapFile(listed.map), listed.map);
    const row = map.clubs.find(club => club.id === id);
    return row && [seasonFile(season).clubs.find(club => club.id === id).name, map.sectionNames[row.homeSection]];
  };
  assert.deepEqual(homeOf('nba-2k00', 'b-vancouver-grizzlies'), ['Vancouver Grizzlies', 'Vancouver']);
  assert.deepEqual(homeOf('nba-2k02', 'b-memphis-grizzlies'), ['Memphis Grizzlies', 'Memphis']);
  assert.deepEqual(homeOf('nba-2k08', 'b-seattle-supersonics'), ['Seattle SuperSonics', 'Seattle']);
  assert.deepEqual(homeOf('nba-2k09', 'b-oklahoma-city-thunder'), ['Oklahoma City Thunder', 'Oklahoma City']);
  assert.deepEqual(homeOf('nba-2k07', 'b-new-orleans-oklahoma-city-hornets'), ['New Orleans/Oklahoma City Hornets', 'Oklahoma City']);
  assert.deepEqual(homeOf('nba-2k02', 'b-charlotte-hornets'), ['Charlotte Hornets', 'Charlotte']);
  assert.deepEqual(homeOf('nba-2k03', 'b-new-orleans-hornets'), ['New Orleans Hornets', 'New Orleans']);
  assert.deepEqual(homeOf('nba-2k11', 'b-new-jersey-nets'), ['New Jersey Nets', 'New Jersey']);
  assert.deepEqual(homeOf('nba-2k13', 'b-brooklyn-nets'), ['Brooklyn Nets', 'Brooklyn']);
  assert.equal(homeOf('nba-2k02', 'b-vancouver-grizzlies'), undefined, 'gone the season after');
  // Before 1999/00 every franchise names the arena it played in that season.
  assert.deepEqual(homeOf('nba-eras-1984', 'b-kansas-city-kings'), ['Kansas City Kings', 'Kansas City']);
  assert.deepEqual(homeOf('nba-eras-1984', 'b-san-diego-clippers'), ['San Diego Clippers', 'San Diego']);
  assert.deepEqual(homeOf('nba-eras-1984', 'b-washington-bullets'), ['Washington Bullets', 'Landover']);
  assert.deepEqual(homeOf('nba-eras-1984', 'b-detroit-pistons'), ['Detroit Pistons', 'Pontiac']);
  assert.deepEqual(homeOf('nba-eras-1984', 'b-cleveland-cavaliers'), ['Cleveland Cavaliers', 'Richfield']);
  assert.equal(homeOf('nba-eras-1984', 'b-charlotte-hornets'), undefined, 'no Hornets before 1988/89');
  assert.deepEqual(homeOf('nba-eras-1992', 'b-detroit-pistons'), ['Detroit Pistons', 'Auburn Hills']);
  assert.deepEqual(homeOf('nba-eras-1992', 'b-los-angeles-clippers'), ['Los Angeles Clippers', 'Los Angeles']);
  assert.deepEqual(homeOf('nba-eras-1992', 'b-charlotte-hornets'), ['Charlotte Hornets', 'Charlotte']);
  assert.deepEqual(homeOf('nba-live-99', 'b-vancouver-grizzlies'), ['Vancouver Grizzlies', 'Vancouver']);
  assert.deepEqual(homeOf('nba-live-99', 'b-washington-wizards'), ['Washington Wizards', 'Washington']);
  const arena = (season, id) => mapFile(BUILT_IN_BASKETBALL_SEASONS.find(set => set.id === season).map).clubs.find(club => club.id === id).arena;
  assert.deepEqual([arena('nba-eras-1984', 'b-los-angeles-lakers'), arena('nba-live-99', 'b-los-angeles-lakers'), arena('nba-2k00', 'b-los-angeles-lakers')],
    ['The Forum', 'Great Western Forum', 'Crypto.com Arena'], 'the 1999/00 maps keep their own rule');
  assert.deepEqual([arena('nba-live-99', 'b-atlanta-hawks'), arena('nba-live-99', 'b-toronto-raptors')], ['Georgia Dome', 'Air Canada Centre']);
});

test('the seasons before NBA 2K come from their own pinned sources: every player real, every rating the source\'s', () => {
  const audit = JSON.parse(read('docs/design/basketball-seasons-audit.json'));
  const before = BUILT_IN_BASKETBALL_SEASONS.filter(set => set.year < 2000);
  assert.deepEqual(before.map(set => [set.id, set.season, set.label, set.map]), [
    ['nba-live-99', '1998/99', 'NBA Live 99', 'nba1999'],
    ['nba-eras-1992', '1991/92', 'NBA 2K27 (Jordan era)', 'nba1992'],
    ['nba-eras-1984', '1983/84', 'NBA 2K27 (Magic vs Bird era)', 'nba1984'],
  ]);
  assert.match(MANIFEST.check.sha256, /^[0-9a-f]{64}$/);
  for (const set of before) {
    const extra = MANIFEST.extra[String(set.year)];
    const pins = [extra.sha256, ...Object.values(extra.archive ?? {}), ...Object.values(extra.files ?? {}).map(file => file.sha256)].filter(Boolean);
    assert.ok(pins.length && pins.every(sha256 => /^[0-9a-f]{64}$/.test(sha256)), `${set.id}'s sources are pinned`);
    const doc = seasonFile(set.id);
    // NBA Live 99's overalls are put on NBA 2K's scale, and its file states the line; 2K's eras are not converted.
    const conversion = extra.scale ? { conversion: `round(${extra.scale.intercept} + ${extra.scale.slope} * raw): the least-squares line of `
      + `NBA 2K's overall (1999/00) on NBA Live 99's, through the players both rate` } : {};
    assert.deepEqual(doc.source, { provider: extra.provider, edition: extra.edition, compiler: extra.name, url: extra.url, rawScale: 99, ...conversion });
    assert.equal(!!extra.scale, set.id === 'nba-live-99', `${set.id}: only NBA Live 99 is converted`);
    const entry = audit.seasons.find(season => season.id === set.id);
    assert.equal(entry.kept + entry.leftOut.length, entry.sourceRows, 'every listed player is kept or left out, and the audit says which');
    // No five holds a player the check left out, or one by an initial alone.
    const clubOf = new Map(teamsOf(MANIFEST, set.year, ARENAS).map(team => [team.code, team.id]));
    for (const left of entry.leftOut) {
      const [, name, code] = /^(.+) \(([A-Z]{3}), /.exec(left);
      assert.ok(!doc.clubs.find(club => club.id === clubOf.get(code)).squad.some(([player]) => player === name), `${left} is in no five`);
    }
    assert.ok(doc.clubs.every(club => club.squad.every(([name]) => !/^[A-Z]\. /.test(name))), `${set.id}: every five is of named, real players`);
  }

  // NBA 2K27's eras: 2K's opening-night rosters, a player 2K names by an initial shown by his own name.
  const jordanEra = seasonFile('nba-eras-1992');
  const five = (doc, id) => doc.clubs.find(club => club.id === id).squad;
  assert.deepEqual(five(jordanEra, 'b-los-angeles-lakers').find(([name]) => name === 'Magic Johnson'), ['Magic Johnson', 'PG', 89]);
  assert.deepEqual(five(jordanEra, 'b-washington-bullets').find(([name]) => name === 'Bernard King'), ['Bernard King', 'SF', 82]);
  assert.deepEqual(five(jordanEra, 'b-denver-nuggets').find(([name]) => name === 'Chris Jackson'), ['Chris Jackson', 'SG', 78]);
  const named = audit.seasons.find(season => season.id === 'nba-eras-1992').named;
  assert.equal(named.length, Object.keys(MANIFEST.extra['1992'].roster).length);
  assert.ok(named.some(line => line.startsWith('M. Johnson (LAL) is Magic Johnson: did not play for the club in 1991/92;')));
  // 2K lists no player it has no licence for: the audit names the real ones its fives lack.
  assert.ok(audit.seasons.find(season => season.id === 'nba-eras-1992').notListed.includes('PHI Charles Barkley (2881 min)'));
  assert.ok(audit.seasons.find(season => season.id === 'nba-eras-1984').notListed.includes('PHI Andrew Toney (2556 min)'));
  // Indiana's 1983/84 roster has no power forward: by the game's own rule a forward plays there.
  assert.deepEqual(audit.seasons.find(season => season.id === 'nba-eras-1984').outOfPosition, ['Indiana Pacers: George Johnson (SF) at PF']);

  // NBA Live 99: every rating is the manifest's line on EA's raw overall, as the audit's table and fives show it.
  const live = audit.seasons.find(season => season.id === 'nba-live-99');
  const line = onLine(MANIFEST.extra['1999'].scale);
  for (const [raw, rating] of Object.entries(live.scale.table)) assert.equal(rating, line(Number(raw)));
  const liveDoc = seasonFile('nba-live-99');
  assert.equal(live.scale.fives.length, liveDoc.clubs.length);
  for (const text of live.scale.fives) {
    const [clubName, players] = text.split(': ');
    const club = liveDoc.clubs.find(item => item.name === clubName);
    players.split(', ').forEach((player, i) => {
      const [, name, raw, rating] = /^(.+) (\d+)→(\d+)$/.exec(player);
      assert.deepEqual([club.squad[i][0], club.squad[i][2]], [name, Number(rating)]);
      assert.equal(line(Number(raw)), Number(rating));
    });
  }
  assert.ok(liveDoc.clubs.every(club => club.squad.every(([name]) => name !== 'Roster Player')), 'the made-up Roster Player plays nowhere');
  assert.ok(live.leftOut.some(text => text.startsWith('Roster Player (CHI,')));
  const { check } = live.scale;
  assert.ok(check.common > 250 && check.correlation > 0.75, 'fitted on the players both editions rate');
  assert.ok(check.line.meanAbsolute < 4.5 && Math.abs(check.line.bias) < 0.5, 'within about four points of NBA 2K\'s ratings, unbiased');
  assert.ok(check.splitHalves.every(half => half.meanAbsolute < 5), 'a line fitted on half the players does as well on the other half');
  assert.ok(check.rawPlus30.meanAbsolute > check.line.meanAbsolute, 'better than the raw overall plus 30');
});

test('the loader refuses a basketball season that is not the builder\'s', () => {
  const doc = seasonFile('nba-2k08');
  const broken = edit => { const copy = structuredClone(doc); edit(copy); return () => decodeFootballSet(copy, 'nba-2k08'); };
  assert.throws(broken(d => { d.map = 'nba2000'; }), /map "nba2000" is not a basketball map listing this season/);
  assert.throws(broken(d => { d.map = '826'; }), /is not a basketball map/);
  assert.throws(broken(d => { d.nations = {}; }), /clubs only/);
  assert.throws(broken(d => { d.clubs.pop(); }), /clubs must be the 30 of map nba2008, found 29/);
  assert.throws(broken(d => { d.kind = 'ea'; }), /kind "ea" is not the kind its id names/);
  assert.throws(broken(d => { d.clubs[0].id = 'f-phoenix-suns'; }), /must look like "b-<name>"/);
  assert.throws(broken(d => { d.clubs[1].code = d.clubs[0].code; }), /is duplicated/);
  assert.throws(broken(d => { d.clubs[0].league = 'EuroLeague'; }), /not a built-in league/);
  assert.throws(broken(d => { d.clubs[0].squad.pop(); }), /needs at least five players/);
  assert.throws(broken(d => { d.clubs[0].squad[0][1] = 'PG/SF'; }), /one position or two neighbouring ones/);
  assert.throws(broken(d => { d.clubs[0].squad[0][2] = 95.5; }), /whole number 1-99/);
  assert.throws(broken(d => { d.clubs[0].squad[1][0] = d.clubs[0].squad[0][0]; }), /repeats/);
  assert.throws(broken(d => { d.source.rawScale = 100; }), /rawScale must be 99/);
  assert.throws(broken(d => { delete d.source.compiler; }), /who compiled its ratings/);
  assert.throws(broken(d => { d.source.conversion = 'raw + 1'; }), /NBA 2K ratings are not converted/);
  // NBA Live's overalls are converted, and its file has to say how.
  const live = seasonFile('nba-live-99');
  assert.equal(decodeFootballSet(structuredClone(live), 'nba-live-99').meta.source.conversion, live.source.conversion);
  const { conversion: _line, ...unstated } = live.source;
  assert.throws(() => decodeFootballSet({ ...structuredClone(live), source: unstated }, 'nba-live-99'),
    /source conversion must say how NBA Live's overalls were put on NBA 2K's scale/);
});

test('a basketball season binds the basketball sport to its clubs and map, for clubs only', () => {
  const set = decodeFootballSet(seasonFile('nba-2k08'), 'nba-2k08');
  const sport = seasonSport(set);
  assert.equal(sport.id, 'basketball');
  assert.equal(sport.clubs, set.clubs);
  assert.deepEqual([sport.clubMap, sport.dataSet, sport.dataYear, sport.dataSeason, sport.dataLabel], ['nba2008', 'nba-2k08', 2008, '2007/08', 'NBA 2K8']);
  assert.equal(set.rosters, null, 'no national teams');
  // Until it loads, a basketball season plays nothing; with nations it is not played at all.
  assert.equal(sportOf({ sport: 'basketball', layer: 'clubs', dataSet: 'nba-2k07' }), null);
  assert.equal(sportOf({ sport: 'basketball', layer: 'nations', dataSet: 'nba-2k07' }).dataSet, undefined);
  assert.equal(sportOf({ sport: 'football', layer: 'clubs', dataSet: 'nba-2k07' }).id, 'football');
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
    const [, folder, id] = String(url).match(/^\/(domestic|basketball)\/([0-9A-Za-z-]+)\.json$/) || [];
    const file = folder === 'domestic' ? `public/domestic/${id}.json` : folder ? `public/basketball/${id}.json` : null;
    let text = null;
    try { text = file && read(file); } catch { text = null; }
    return text ? { ok: true, status: 200, json: async () => JSON.parse(text) }
      : { ok: false, status: 404, json: async () => { throw new Error('Not found'); } };
  };
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
  Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true, value: fetch });
  B.clearDomesticCache();
  B.clearFootballSetCache();
  B.clearFootballSetIndex();
  const f = syncAppFixture({ App: B.App, phase: 'setup', ids: ['840', '124', '484'],
    settings: { sport: 'basketball', layer: 'nations', scope: 'UEFA', clubScope: 'domestic:nba', role: 'spectator', seed: '11' } });
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
const strongest = doc => doc.clubs.slice().sort((a, b) => b.str - a.str || a.name.localeCompare(b.name)).slice(0, 3).map(club => club.name);

test('basketball\'s Season choice lists its own seasons; one takes the clubs onto its era\'s map, and Nations goes back', async () => {
  await withApp(async ({ app, time }) => {
    const model = modelOf(app);
    assert.deepEqual(model.season.options.map(option => option.label),
      ['2026/27 · built in', ...BUILT_IN_BASKETBALL_SEASONS.map(set => `${set.season} · ${set.label}`)]);
    assert.equal(model.season.options.at(-1).label, '1983/84 · NBA 2K27 (Magic vs Bird era)');
    assert.deepEqual(model.season.options.map(option => option.name), ['2026/27', ...BUILT_IN_BASKETBALL_SEASONS.map(set => set.season)],
      'the dropdown names each by its season alone');
    assert.match(model.season.note, /NBA 2K ratings of that season, as compiled by 2K Archive/);
    assert.match(model.season.note, /NBA clubs only/);
    assert.equal(model.season.id, null);

    app.pickSetup('dataSet', 'nba-2k08');
    assert.deepEqual([app.state.setup.layer, app.state.setup.clubScope], ['clubs', 'domestic:nba2008'], 'clubs only, on the 2007/08 map');
    const loading = modelOf(app);
    assert.deepEqual(loading.scopes.map(scope => [scope.id, scope.label, scope.count]), [['domestic:nba2008', 'NBA', 30]]);
    assert.equal(loading.canLaunch, false, 'Launch waits for the season and its map');
    assert.match(loading.countryNote, /^The strongest clubs lead the 30 NBA clubs/, 'no club named before the season loads');

    app.pickSetup('layer', 'nations');
    assert.deepEqual([app.state.setup.dataSet, app.state.setup.clubScope], [null, 'domestic:nba'], 'Nations plays the built-in season');
    app.pickSetup('dataSet', 'nba-2k15');
    assert.deepEqual([app.state.setup.layer, app.state.setup.clubScope], ['clubs', 'domestic:nba'], 'today\'s franchises play on today\'s map');
    app.pickSetup('sport', 'football');
    assert.equal(app.state.setup.dataSet, null, 'a season stays with its sport');
    assert.ok(modelOf(app).season.options.every(option => option.id == null || setSportOf(option.id) === 'football'));
    app.pickSetup('dataSet', 'ea-fifa-18');
    app.pickSetup('sport', 'basketball');
    assert.equal(app.state.setup.dataSet, null);
  });
});

test('a season launches its own fives on its era\'s map and resumes as it was played', async () => {
  await withApp(async ({ app, time, items, calls }) => {
    app.pickSetup('sport', 'basketball');
    await chooseSeason(app, time, 'nba-2k08');
    const doc = seasonFile('nba-2k08');
    const model = modelOf(app);
    assert.equal(model.canLaunch, true);
    assert.equal(model.campaignSummary, 'Basketball · Clubs · NBA · USA and Canada · 2007/08');
    const [first, second, third] = strongest(doc);
    assert.match(model.countryNote, new RegExp(`^${first}, ${second} and ${third} lead the 30 NBA clubs`));
    const sonics = model.teams.find(team => team.id === 'b-seattle-supersonics');
    assert.equal(sonics.name, 'Seattle SuperSonics');

    app.startCampaign();
    const st = app.state;
    assert.equal(st.phase, 'playing');
    assert.deepEqual([st.settings.dataSet, st.settings.dataVersion, st.settings.dataYear, st.settings.dataSeason, st.settings.clubScope],
      ['nba-2k08', doc.version, 2008, '2007/08', 'domestic:nba2008']);
    assert.equal(st.settings.domesticVersion, CLUB_MAPS.find(entry => entry.id === 'nba2008').version);
    assert.equal(st.campaignName, 'Basketball 2007/08 · NBA · USA and Canada');
    assert.deepEqual(Object.keys(st.teams).sort(), doc.clubs.map(club => club.id).sort());
    for (const club of doc.clubs) {
      const team = st.teams[club.id];
      assert.deepEqual([team.name, team.code, team.str], [club.name, club.code, club.str]);
      assert.deepEqual(team.squad.map(p => [p.name, p.rating]), club.squad.map(([name, , rating]) => [name, rating]), `${club.name}'s 2K8 five`);
      assert.equal(st.own[team.home], team.id);
    }
    assert.equal(app.territoryName(st.teams['b-seattle-supersonics'].home), 'Seattle');
    assert.ok(calls.includes('/basketball/nba-2k08.json') && calls.includes('/domestic/nba2008.json'));

    // The save holds every player as played, so it needs no season file to resume.
    const text = items.get(SAVE_KEY);
    assert.equal(JSON.parse(text).playerPack, undefined);
    const saved = parseCampaign(text);
    assert.equal(JSON.stringify(saved.teams), JSON.stringify(st.teams));
    B.clearFootballSetCache();
    app.continueSaved(saved);
    assert.equal(app.state.phase, 'playing');
    assert.equal(JSON.stringify(app.state.teams), JSON.stringify(st.teams));

    // A season belongs on its own map, and an era's map belongs to its seasons.
    const edited = edit => { const data = JSON.parse(text); edit(data.settings); if (data.initialSettings) edit(data.initialSettings); return JSON.stringify(data); };
    const today = CLUB_MAPS.find(entry => entry.id === 'nba').version;
    assert.throws(() => parseCampaign(edited(s => { s.clubScope = 'domestic:nba'; s.domesticVersion = today; })), /Campaign data set is invalid/);
    assert.throws(() => parseCampaign(edited(s => { s.dataSet = null; s.dataVersion = null; s.dataYear = null; s.dataSeason = null; })), /Campaign data set is invalid/);
    assert.throws(() => parseCampaign(edited(s => { s.layer = 'nations'; })), /Campaign data set is invalid/);
    assert.throws(() => parseCampaign(edited(s => { s.sport = 'football'; })), /Campaign data set is invalid/);
  });
});

test('a season with today\'s franchises plays on today\'s map with that season\'s fives', async () => {
  await withApp(async ({ app, time }) => {
    app.pickSetup('sport', 'basketball');
    await chooseSeason(app, time, 'nba-2k15');
    const doc = seasonFile('nba-2k15');
    assert.match(modelOf(app).countryNote, new RegExp(`^${strongest(doc).join(', ').replace(/, ([^,]*)$/, ' and $1')} lead the 30 NBA clubs`));
    app.startCampaign();
    const st = app.state;
    assert.equal(st.settings.clubScope, 'domestic:nba');
    const warriors = doc.clubs.find(club => club.id === 'b-golden-state-warriors');
    assert.deepEqual(st.teams['b-golden-state-warriors'].squad.map(p => p.name), warriors.squad.map(([name]) => name), 'the 2K15 five, not today\'s');
    assert.notDeepEqual(warriors.squad.map(([name]) => name), CLUBS.find(club => club.id === 'b-golden-state-warriors').squad.map(([name]) => name));
  });
});

test('1983/84 launches its 23 franchises on their own map, the Kings in Kansas City and the Bullets in Landover', async () => {
  await withApp(async ({ app, time, items }) => {
    app.pickSetup('sport', 'basketball');
    await chooseSeason(app, time, 'nba-eras-1984');
    const doc = seasonFile('nba-eras-1984');
    const model = modelOf(app);
    assert.deepEqual(model.scopes.map(scope => [scope.id, scope.count]), [['domestic:nba1984', 23]]);
    assert.match(model.countryNote, new RegExp(`^${strongest(doc).join(', ').replace(/, ([^,]*)$/, ' and $1')} lead the 23 NBA clubs`));
    app.startCampaign();
    const st = app.state;
    assert.deepEqual([st.settings.dataSet, st.settings.dataSeason, st.settings.clubScope], ['nba-eras-1984', '1983/84', 'domestic:nba1984']);
    assert.deepEqual(Object.keys(st.teams).sort(), doc.clubs.map(club => club.id).sort());
    assert.equal(app.territoryName(st.teams['b-kansas-city-kings'].home), 'Kansas City');
    assert.equal(app.territoryName(st.teams['b-washington-bullets'].home), 'Landover');
    assert.deepEqual(st.teams['b-boston-celtics'].squad.map(p => [p.name, p.rating]), doc.clubs.find(club => club.id === 'b-boston-celtics').squad.map(([name, , rating]) => [name, rating]));
    // Its save holds every player as played.
    const saved = parseCampaign(items.get(SAVE_KEY));
    assert.equal(JSON.stringify(saved.teams), JSON.stringify(st.teams));
  });
});
