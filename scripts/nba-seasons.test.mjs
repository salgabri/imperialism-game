// The built-in earlier basketball seasons (docs/design/football-years.md, "Earlier basketball seasons"): the builder
// on invented players (scripts/lib/nba-seasons.mjs), the readers of the seasons before NBA 2K (a 2kratings MyNBA Eras
// page, NBA Live 99's dBase tables, Basketball-Reference's player seasons) and NBA Live 99's line on invented data, the
// computed seasons' score, ranking and positions on invented statistics, the shipped seasons against their era maps,
// the manifest and the audit, the loader's checks, and the running App: a season's Season row, its era's map, a launch
// with its fives, and a save that resumes as it was played.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SAVE_KEY } from '../src/config.js';
import { BUILT_IN_BASKETBALL_SEASONS } from '../src/data/basketballSeasons.js';
import { CLUB_MAPS } from '../src/data/clubMaps.js';
import { CLUBS } from '../src/data/clubs.basketball.js';
import { colourFor, contentHash } from '../src/data/footballSetBuild.js';
import { NBA_LEAGUE_AVERAGES } from '../src/data/nbaLeagueAverages.js';
import { decodeDomestic } from '../src/engine/domestic.js';
import { BUILT_IN_SETS, builtInSeasonOf, clearFootballSetIndex, decodeFootballSet, loadFootballSetIndex, seasonMapOf, seasonSport,
  setSportOf, sportOf } from '../src/engine/footballSets.js';
import { parseCampaign } from '../src/engine/storage.js';
import { buildSetupModel } from '../src/screens/setup/setupModel.js';
import { brefPlayerSeasons, brefPositions, buildNbaSeason, checkScore, checkSpread, computedConversion, computedSeasonPlayers, editionOf, extractYears,
  fitLine, isComputed, labelOf, leastSquares, leftOutNotes, listedPositions, liveScale, mapOf, nameKey, notListed, onLine, parseCsv,
  parseErasPage, parseLive99, positionsOf, rateComputedSeason, ratingSpread, readDbf, readPlayerSeasons, readTable, realPlayers,
  SCORE_INPUTS, scoreInputs, scoreOf, seasonIdOf, setIdOf, teamsOf, trainingPairs } from './lib/nba-seasons.mjs';
import { bundleComponents, syncAppFixture } from './lib/app-harness.mjs';

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const MANIFEST = JSON.parse(read('scripts/data/nba-seasons.json'));
const ARENAS = JSON.parse(read('scripts/data/nba-arenas.json')).clubs;
const seasonFile = id => JSON.parse(read(`public/basketball/${id}.json`));
// A season's NBA franchises: from 2000/01 its file carries the EuroLeague's clubs too (scripts/euroleague.test.mjs).
const nbaClubs = doc => doc.clubs.filter(club => club.league === 'NBA');
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

// ---------- the computed seasons, on invented statistics ----------

// Basketball-Reference's tables as Sumitro Datta's copy holds them, invented: a traded player has a row per club after
// his total, an ABA season is another league's, and a position may be missing (NA).
const BREF = {
  advanced: ['season,lg,player,player_id,team,pos,g,mp,per,ws_48,dws',
    '1971,NBA,Star Centre,starce01,MOV,C,80,3200,25.0,0.250,6.0',
    '1971,NBA,Traded Wing,tradewi01,2TM,SF,70,2400,15.0,0.100,2.0',
    '1971,NBA,Traded Wing,tradewi01,NEW,SF,30,900,14.0,0.090,0.8',
    '1971,NBA,Traded Wing,tradewi01,MOV,SF,40,1500,15.6,0.105,1.2',
    '1971,NBA,Even Split,evensp01,2TM,PF,20,400,10.0,0.050,0.4',
    '1971,NBA,Even Split,evensp01,MOV,PF,10,200,10.0,0.050,0.2',
    '1971,NBA,Even Split,evensp01,NEW,PF,10,200,10.0,0.050,0.2',
    '1971,NBA,Bench Guard,benchgu01,NEW,NA,10,40,30.0,0.400,0.1',
    '1971,ABA,Other League,otherle01,ABQ,PG,80,3000,20.0,0.200,3.0',
    '1970,NBA,Bench Guard,benchgu01,NEW,PG,50,600,10.0,0.020,0.3'].join('\n'),
  totals: ['season,lg,player_id,team,pts,trb,ast',
    '1971,NBA,starce01,MOV,2000,1200,240', '1971,NBA,tradewi01,2TM,1050,350,140', '1971,NBA,evensp01,2TM,100,80,10',
    '1971,NBA,benchgu01,NEW,12,4,6', '1971,ABA,otherle01,ABQ,1500,300,600', '1970,NBA,benchgu01,NEW,150,40,90'].join('\n'),
  allStar: ['player,player_id,team,season,lg', 'Star Centre,starce01,West,1971,NBA', 'Other League,otherle01,East,1971,ABA'].join('\n'),
  endOfSeason: ['season,lg,type,number_tm,player,player_id', '1971,NBA,All-NBA,1st,Star Centre,starce01', '1971,NBA,All-Defense,2nd,Star Centre,starce01',
    '1971,NBA,All-NBA,2nd,Traded Wing,tradewi01'].join('\n'),
};
const ALL_NBA = { '1st': 3, '2nd': 2, '3rd': 1 };

test('Basketball-Reference\'s player seasons are read as data: a traded player\'s whole season, for the club of most minutes', () => {
  assert.deepEqual(readTable('a,b\n1,2\n3\n', ['a']), [{ a: '1', b: '2' }], 'a row of another length is left out');
  assert.throws(() => readTable('a,b\n1,2\n', ['c'], 'Some.csv'), /Some.csv has no c column/);
  const records = brefPlayerSeasons(BREF, ALL_NBA);
  assert.deepEqual(records.map(r => `${r.season} ${r.name} ${r.team}`), ['1971 Star Centre MOV', '1971 Traded Wing MOV', '1971 Even Split MOV',
    '1971 Bench Guard NEW', '1970 Bench Guard NEW'], 'NBA seasons only, in the table\'s order');
  const [star, traded, even, bench] = records;
  assert.deepEqual(star, { season: 1971, id: 'starce01', name: 'Star Centre', pos: 'C', team: 'MOV', stints: [{ team: 'MOV', minutes: 3200, games: 80 }],
    games: 80, minutes: 3200, per: 25, ws48: 0.25, dws: 6, points: 2000, rebounds: 1200, assists: 240, allStar: 1, allNba: 3 });
  // His total line, both clubs in the order he played for them, and the club he played the most minutes for.
  assert.deepEqual([traded.games, traded.minutes, traded.per, traded.points, traded.allNba, traded.allStar], [70, 2400, 15, 1050, 2, 0]);
  assert.deepEqual(traded.stints.map(s => s.team), ['NEW', 'MOV']);
  assert.equal(even.team, 'MOV', 'equal minutes and games: the earlier club');
  assert.equal(bench.pos, null, 'NA is no position');
  assert.throws(() => brefPlayerSeasons({ ...BREF, advanced: BREF.advanced.replace('2TM,SF', 'NEW,SF') }, ALL_NBA), /tradewi01 has 0 total rows/);
  assert.throws(() => brefPlayerSeasons({ ...BREF, endOfSeason: `${BREF.endOfSeason}\n1971,NBA,All-NBA,4th,Bench Guard,benchgu01` }, ALL_NBA),
    /an All-NBA team "4th"/);
});

test('the score\'s inputs shrink PER and WS/48 toward a bench player\'s by minutes, and the score sums them', () => {
  const [star, , , bench] = brefPlayerSeasons(BREF, ALL_NBA);
  const shrink = { minutes: 400, per: 11, ws48: 0.05 };
  const inputs = scoreInputs(star, { shrink });
  assert.deepEqual(Object.keys(inputs), SCORE_INPUTS);
  assert.equal(inputs.per, (25 * 3200 + 11 * 400) / 3600);
  assert.equal(inputs.ws48, (0.25 * 3200 + 0.05 * 400) / 3600);
  assert.deepEqual([inputs.mpg, inputs.mpg2, inputs.ppg, inputs.rpg, inputs.apg, inputs.allStar, inputs.allNba, inputs.dws], [40, 1600, 25, 15, 3, 1, 3, 6]);
  // Forty minutes at a PER of 30 count for little.
  assert.ok(scoreInputs(bench, { shrink }).per < 13);
  assert.equal(scoreInputs({ ...star, per: null }, { shrink }), null, 'a season without PER has no score');
  assert.equal(scoreInputs({ ...star, games: 0 }, { shrink }), null);
  const coefficients = Object.fromEntries(SCORE_INPUTS.map((name, i) => [name, i + 1]));
  assert.equal(scoreOf({ intercept: -1, coefficients })(Object.fromEntries(SCORE_INPUTS.map(name => [name, 1]))), -1 + 55);
});

/** Invented pairs whose z is exactly the score `score` gives their inputs. */
function invented(score, count = 40) {
  let seed = 7;
  const next = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
  return Array.from({ length: count }, (_, i) => {
    const inputs = Object.fromEntries(SCORE_INPUTS.map(name => [name, next() * 10]));
    return { edition: 2000 + (i % 3), inputs, z: scoreOf(score)(inputs) };
  });
}

test('the score is the least-squares fit, fixed in the manifest: the build fits it again and stops if it has moved', () => {
  // y = 1 + 2a - 3b, exactly.
  const rows = [[1, 0, 0], [1, 1, 0], [1, 0, 1], [1, 2, 3], [1, 5, 1]];
  assert.deepEqual(leastSquares(rows, rows.map(([, a, b]) => 1 + 2 * a - 3 * b)).map(v => Number(v.toFixed(9))), [1, 2, -3]);
  assert.throws(() => leastSquares([[1, 1], [1, 1]], [1, 2]), /not independent/);
  const score = { intercept: -1.5, coefficients: Object.fromEntries(SCORE_INPUTS.map((name, i) => [name, (i + 1) / 8])) };
  const fit = checkScore(invented(score), score);
  assert.deepEqual([fit.pairs, fit.editions, fit.correlation], [40, 3, 1]);
  assert.deepEqual(fit.coefficients, { intercept: -1.5, ...score.coefficients });
  assert.throws(() => checkScore(invented(score), { ...score, coefficients: { ...score.coefficients, dws: 0.5 } }),
    /fitted on the 40 pairs is not the manifest's: dws 1\.25, not 0\.5/);
  const { per, ...short } = score.coefficients;
  assert.throws(() => checkScore(invented(score), { ...score, coefficients: { ...short, per } }), /inputs must be per, ws48/);
});

test('the score is fitted on each 2K rating beside the player\'s season before, matched by name and club', () => {
  const records = brefPlayerSeasons(BREF, ALL_NBA);
  const inputsOf = record => scoreInputs(record, { shrink: { minutes: 400, per: 11, ws48: 0.05 } });
  const years = { 1972: [{ n: 'Star Centre', o: 90, p: 'C', t: 'MOV' }, { n: 'Traded Wing', o: 80, p: 'SF', t: 'MOV' },
    { n: 'Nobody Matched', o: 70, p: 'PG', t: 'NEW' }, { n: 'Unrated', o: null, p: 'PG', t: 'NEW' }] };
  const pairs = trainingPairs(years, records, { editions: [1972, 1972], lag: 1 }, inputsOf);
  assert.deepEqual(pairs.map(pair => [pair.record.name, pair.rating]), [['Star Centre', 90], ['Traded Wing', 80]]);
  // z within the edition: mean 80, sample deviation 10.
  assert.deepEqual(pairs.map(pair => pair.z), [1, 0]);
  assert.throws(() => trainingPairs(years, records, { editions: [1972, 1973], lag: 1 }, inputsOf), /2K Archive has no NBA 2K.* to fit the score on/);
});

test('a computed season ranks the league by score onto the spread: no player passes another, ties go by player id', () => {
  const record = (id, team, minutes, value) => ({ season: 2001, id, name: `Player ${id}`, team, minutes, value, stints: [{ team, minutes, games: 50 }] });
  const records = [record('a1', 'AAA', 3000, 2), record('a2', 'AAA', 2000, 1), record('a3', 'AAA', 100, 5),
    record('b1', 'BBB', 2500, 1), record('b2', 'BBB', 2400, null), { ...record('c1', 'CCC', 3000, 9), season: 2000 }];
  const options = { roster: 2, inputsOf: r => (r.value == null ? null : { value: r.value }), scoreFor: inputs => inputs.value, spread: [70, 75, 80, 90] };
  const { rated, unscored } = rateComputedSeason(records, 2001, options);
  // Each club's two with the most minutes; one without a score is left out.
  assert.deepEqual(rated.map(entry => [entry.record.id, entry.rating]), [['a1', 90], ['a2', 70], ['b1', 80]]);
  assert.deepEqual(unscored.map(r => r.id), ['b2']);
  // Quantile (rank - 0.5) / N of the spread: the best takes its top, the worst its bottom.
  const many = Array.from({ length: 30 }, (_, i) => record(`p${String(i).padStart(2, '0')}`, `T${i % 3}`, 1000, i));
  const spread = ratingSpread([...Array.from({ length: 20 }, (_, i) => ({ t: `C${i % 2}`, o: 60 + i })), { t: 'FA', o: 99 }], 13);
  assert.equal(spread.length, 20, 'free agents are no club\'s');
  const ratings = rateComputedSeason(many, 2001, { roster: 13, inputsOf: r => ({ value: r.value }), scoreFor: inputs => inputs.value, spread }).rated
    .sort((a, b) => a.score - b.score).map(entry => entry.rating);
  assert.deepEqual([ratings[0], ratings.at(-1)], [60, 79]);
  assert.ok(ratings.every((rating, i) => i === 0 || rating >= ratings[i - 1]), 'no player passes another');
  // The manifest fixes the spread too: a page whose ratings moved stops the build.
  assert.equal(checkSpread([70, 70, 75], { 70: 2, 75: 1 }).length, 3);
  assert.throws(() => checkSpread([70, 71, 75], { 70: 2, 75: 1 }), /spread's ratings are not the manifest's: 1 rated 70, not 2; 1 rated 71, not 0/);
});

test('a computed player\'s positions: the season\'s, a neighbour he played elsewhere, else his career position\'s', () => {
  const careerPositions = { G: ['PG', 'SG'], F: ['SF', 'PF'], 'F-C': ['PF', 'C'] };
  const season = (id, season, pos, minutes) => ({ id, season, pos, minutes });
  const listed = listedPositions([season('wing', 1970, 'SG', 500), season('wing', 1969, 'PF', 800), season('wing', 1971, 'SF', 2000),
    season('even', 1970, 'SG', 500), season('even', 1975, 'PF', 500), season('none', 1970, null, 900)]);
  assert.deepEqual(brefPositions({ id: 'wing', pos: 'SF' }, listed, 'F', careerPositions), ['SF', 'PF'], 'the neighbour of most minutes');
  assert.deepEqual(brefPositions({ id: 'even', pos: 'SF' }, listed, 'F', careerPositions), ['SF', 'PF'], 'equal minutes: the later season\'s');
  assert.deepEqual(brefPositions({ id: 'big', pos: 'C' }, listed, 'F-C', careerPositions), ['C', 'PF'], 'his career position\'s neighbour');
  assert.deepEqual(brefPositions({ id: 'none', pos: null }, listed, 'G', careerPositions), ['PG', 'SG'], 'no position that season: his career\'s');
  assert.deepEqual(brefPositions({ id: 'lone', pos: 'PG' }, listed, undefined, careerPositions), ['PG']);
  assert.equal(brefPositions({ id: 'none', pos: null }, listed, 'NA', careerPositions), null, 'none at all: left out');
});

test('a computed season\'s players take the manifest\'s codes; a teammate\'s namesake with fewer minutes is left out', () => {
  const entry = (id, name, team, rating, pos = 'C', stints = [{ team, minutes: 1000 }]) => ({ record: { season: 2001, id, name, team, pos, minutes: 1000, stints },
    score: rating / 10, rating });
  const rated = [entry('sun1', 'Sun Centre', 'PHO', 85), entry('sun2', 'Sun Centre', 'PHO', 75),
    entry('tra1', 'Moved Man', 'PHO', 80, 'SF', [{ team: 'BOS', minutes: 300 }, { team: 'PHO', minutes: 700 }]), entry('nop1', 'No Place', 'BOS', 70, null)];
  const out = computedSeasonPlayers(rated, { listed: new Map(), career: new Map(), careerPositions: {}, codes: { PHX: 'PHO' } });
  assert.deepEqual(out.players, [{ n: 'Sun Centre', o: 85, p: 'C', t: 'PHX' }, { n: 'Moved Man', o: 80, p: 'SF', t: 'PHX' }]);
  assert.deepEqual(out.namesakes, ['Sun Centre (PHX, 75, 1000 min; Basketball-Reference\'s sun2)']);
  assert.deepEqual(out.noPosition, ['No Place (BOS, 70)']);
  assert.deepEqual(out.traded, ['Moved Man (BOS 300 min, PHX 700 min): PHX']);
  assert.equal(out.scores.get('PHX|Moved Man'), 8);
});

test('a computed season names its id, label and maker, and its source says how it was computed', () => {
  const coefficients = Object.fromEntries(SCORE_INPUTS.map((name, i) => [name, (i + 1) / 100]));
  const computed = { label: 'Test Stats (computed)', provider: 'Test Reference', name: 'A Test Copy, CC0', url: 'https://example.test/stats', seasons: [2001],
    score: { intercept: -2, coefficients, shrink: { minutes: 400, per: 11, ws48: 0.05 }, allNba: ALL_NBA, training: { editions: [2000, 2026], lag: 1 } },
    roster: 13, spread: { edition: 2027, perClub: 13 } };
  const manifest = { ...TEST_MANIFEST, computed };
  assert.deepEqual([isComputed(manifest, 2001), isComputed(manifest, 2002), setIdOf(manifest, 2001), labelOf(manifest, 2001), setIdOf(manifest, 2002)],
    [true, false, 'nba-stats-2001', 'Test Stats (computed)', 'nba-2k02']);
  const conversion = computedConversion(computed);
  assert.match(conversion, /^computed: score = -2 \+ 0\.01 \* PER \+ 0\.02 \* WS\/48 \+ 0\.03 \* MPG \+ 0\.04 \* MPG\^2 .* \+ 0\.1 \* DWS, PER and WS\/48 shrunk toward 11 and 0\.05 by 400 minutes/);
  assert.match(conversion, /NBA 2K to NBA 2K26, 2K Archive\) against each player's season before; each club's 13 players with the most minutes ranked by score and given NBA 2K27's ratings of each club's 13 best, rank for rank$/);
  const players = [...five('MOV', 80), ...five('NEW', 70)];
  const source = { computed: true, players, rows: 12, rated: 12, unscored: ['Short Season (NEW)'], noPosition: [], namesakes: [], traded: ['MOV Point (NEW 10 min, MOV 900 min): MOV'],
    scores: new Map(players.map(p => [`${p.t}|${p.n}`, p.o / 50])), srs: new Map([['MOV', 5], ['NEW', -5]]), averages: { pace: 100, rating: 105, points: 105 } };
  const arenas = { 'b-boston-celtics': { city: 'Boston', arena: 'TD Garden', home: [-71.06, 42.37] } };
  const { doc, audit } = buildNbaSeason({ 2001: players }, 2001, manifest, { arenas, source });
  assert.deepEqual([doc.id, doc.season, doc.label, doc.map], ['nba-stats-2001', '2000/01', 'Test Stats (computed)', 'test2001']);
  assert.deepEqual(doc.source, { provider: 'Test Reference', edition: '2000/01 NBA regular season', compiler: 'A Test Copy, CC0', url: 'https://example.test/stats',
    rawScale: 99, method: 'computed', conversion });
  assert.equal(doc.version, `nba-stats-2001-${contentHash(doc)}`);
  assert.deepEqual([audit.label, audit.population, audit.rated, audit.unscored, audit.traded, audit.clubsAgainstSRS],
    ['Test Stats (computed)', 12, 12, ['Short Season (NEW)'], source.traded, 1]);
  assert.equal(audit.fives[0], 'Old Town Movers 82: MOV Point PG 84 (1.680), MOV Shooter SG/SF 83 (1.660), MOV Wing SF 82 (1.640), MOV Forward PF/C 81 (1.620), MOV Centre C 80 (1.600)');
  assert.equal(audit.namesakes, undefined, 'no namesakes, no line');
});

// ---------- the shipped seasons ----------

// Basketball's era maps; baseball's are scripts/baseball-seasons.test.mjs's.
const ERA_MAPS = CLUB_MAPS.filter(entry => entry.seasons && entry.sport === 'basketball');

test('the built-in seasons are the manifest\'s, newest first: every NBA 2K edition, then every season back to 1960/61', () => {
  assert.deepEqual(BUILT_IN_BASKETBALL_SEASONS.map(set => set.year), MANIFEST.seasons.slice().sort((a, b) => b - a));
  assert.deepEqual(BUILT_IN_BASKETBALL_SEASONS.map(set => set.id), MANIFEST.seasons.slice().sort((a, b) => b - a).map(year => setIdOf(MANIFEST, year)));
  assert.equal(BUILT_IN_BASKETBALL_SEASONS.length, 66);
  assert.deepEqual([BUILT_IN_BASKETBALL_SEASONS[0].label, BUILT_IN_BASKETBALL_SEASONS.at(-1).label], ['NBA 2K26', 'Basketball-Reference (computed)']);
  assert.deepEqual(MANIFEST.seasons, Array.from({ length: 66 }, (_, i) => 1961 + i), 'no season from 1960/61 to 2025/26 is missing');
  // The seasons no game rated are computed; a season a game rated never is.
  const computed = MANIFEST.computed.seasons;
  assert.deepEqual(computed, MANIFEST.seasons.filter(year => year < 1999 && !MANIFEST.extra[String(year)]));
  assert.deepEqual(BUILT_IN_BASKETBALL_SEASONS.filter(set => set.id.startsWith('nba-stats-')).map(set => [set.id, set.label]),
    computed.slice().reverse().map(year => [`nba-stats-${year}`, 'Basketball-Reference (computed)']));
  assert.deepEqual(BUILT_IN_BASKETBALL_SEASONS.filter(set => set.year >= 1983 && set.year <= 1985).map(set => set.id),
    ['nba-stats-1985', 'nba-eras-1984', 'nba-stats-1983'], 'computed and game seasons run by year');
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
    assert.deepEqual(nbaClubs(set).map(club => club.id).sort(), map.clubs.map(club => club.id).sort(), `${listed.id} has ${listed.map}'s franchises`);
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
    else assert.deepEqual(new Set(nbaClubs(set).map(club => club.id)), today,'today\'s map serves seasons with today\'s franchises');
  }
  // Every era map serves at least one season, and only seasons that name it, in the order they were played.
  for (const entry of ERA_MAPS) {
    assert.deepEqual(entry.seasons, BUILT_IN_BASKETBALL_SEASONS.filter(set => set.map === entry.id).sort((a, b) => a.year - b.year).map(set => set.id));
    assert.ok(!('top' in entry), 'an era\'s strongest clubs are its seasons\' own');
  }
  // 1981/82 to 1983/84 had the same franchises in the same arenas: one map.
  assert.deepEqual(CLUB_MAPS.find(entry => entry.id === 'nba1984').seasons, ['nba-stats-1982', 'nba-stats-1983', 'nba-eras-1984']);
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
  // The 1960s and 1970s: franchises long since moved, merged or renamed, each where it played that season.
  assert.deepEqual(homeOf('nba-stats-1961', 'b-philadelphia-warriors'), ['Philadelphia Warriors', 'Philadelphia']);
  assert.deepEqual(homeOf('nba-stats-1961', 'b-syracuse-nationals'), ['Syracuse Nationals', 'Syracuse']);
  assert.deepEqual(homeOf('nba-stats-1961', 'b-st-louis-hawks'), ['St. Louis Hawks', 'St. Louis']);
  assert.deepEqual(homeOf('nba-stats-1961', 'b-cincinnati-royals'), ['Cincinnati Royals', 'Cincinnati']);
  assert.deepEqual(homeOf('nba-stats-1961', 'b-los-angeles-lakers'), ['Los Angeles Lakers', 'Los Angeles']);
  assert.deepEqual(homeOf('nba-stats-1962', 'b-chicago-packers'), ['Chicago Packers', 'Chicago']);
  assert.deepEqual(homeOf('nba-stats-1966', 'b-san-francisco-warriors'), ['San Francisco Warriors', 'San Francisco']);
  assert.deepEqual(homeOf('nba-stats-1968', 'b-san-francisco-warriors'), ['San Francisco Warriors', 'Daly City'], 'back at the Cow Palace');
  assert.deepEqual(homeOf('nba-stats-1968', 'b-san-diego-rockets'), ['San Diego Rockets', 'San Diego']);
  assert.deepEqual(homeOf('nba-stats-1970', 'b-baltimore-bullets'), ['Baltimore Bullets', 'Baltimore']);
  assert.deepEqual(homeOf('nba-stats-1974', 'b-capital-bullets'), ['Capital Bullets', 'Landover']);
  assert.deepEqual(homeOf('nba-stats-1974', 'b-kansas-city-omaha-kings'), ['Kansas City-Omaha Kings', 'Kansas City']);
  assert.deepEqual(homeOf('nba-stats-1977', 'b-buffalo-braves'), ['Buffalo Braves', 'Buffalo']);
  assert.deepEqual(homeOf('nba-stats-1977', 'b-new-york-nets'), ['New York Nets', 'Uniondale']);
  assert.deepEqual(homeOf('nba-stats-1979', 'b-new-orleans-jazz'), ['New Orleans Jazz', 'New Orleans']);
  assert.deepEqual(homeOf('nba-stats-1980', 'b-utah-jazz'), ['Utah Jazz', 'Salt Lake City']);
  assert.equal(homeOf('nba-stats-1961', 'b-chicago-bulls'), undefined, 'no Bulls before 1966/67');
  assert.deepEqual([arena('nba-stats-1961', 'b-detroit-pistons'), arena('nba-stats-1962', 'b-detroit-pistons'), arena('nba-stats-1979', 'b-detroit-pistons')],
    ['Detroit Olympia', 'Cobo Arena', 'Pontiac Silverdome']);
});

test('the computed seasons are computed by the manifest\'s rule, and say so', () => {
  const audit = JSON.parse(read('docs/design/basketball-seasons-audit.json'));
  const { computed } = audit;
  assert.match(MANIFEST.computed.terms, /CC0/);
  assert.deepEqual(computed.fit.coefficients, { intercept: MANIFEST.computed.score.intercept, ...MANIFEST.computed.score.coefficients },
    'the fit, run again on the pinned sources, is the manifest\'s');
  assert.ok(Object.values(MANIFEST.computed.score.coefficients).every(value => value > 0), 'every input counts for a player');
  assert.equal(computed.fit.pairs, 9970);
  assert.ok(computed.fit.correlation > 0.85, `in-sample r ${computed.fit.correlation}`);
  // End to end, the rule rates the seasons NBA 2K27's MyNBA Eras rate as 2K does.
  for (const id of ['nba-eras-1984', 'nba-eras-1992']) {
    const check = computed.checks[id];
    assert.ok(check.matched > 200 && check.rankCorrelation >= 0.94 && check.meanError < 2.5, `${id}: ${JSON.stringify(check)}`);
  }
  assert.deepEqual([computed.spreadRatings.edition, computed.spreadRatings.ratings, computed.spreadRatings.quantiles['0'], computed.spreadRatings.quantiles['1']],
    ['NBA 2K27', 390, 69, 97]);
  const counts = Object.entries(MANIFEST.computed.spread.counts).map(([rating, count]) => [Number(rating), count]);
  assert.deepEqual([counts.reduce((sum, [, count]) => sum + count, 0), counts[0][0], counts.at(-1)[0]], [390, 69, 97], 'the manifest pins all 390');
  const conversion = computedConversion(MANIFEST.computed);
  for (const listed of BUILT_IN_BASKETBALL_SEASONS.filter(set => isComputed(MANIFEST, set.year))) {
    const doc = seasonFile(listed.id);
    assert.deepEqual(doc.source, { provider: 'Basketball-Reference', edition: `${doc.season} NBA regular season`, compiler: MANIFEST.computed.name,
      url: MANIFEST.computed.url, rawScale: 99, method: 'computed', conversion }, `${listed.id} says how it was computed`);
    const entry = audit.seasons.find(season => season.id === listed.id);
    assert.equal(entry.fives.length, doc.clubs.length);
    // Each five as the audit gives it: the season's own players, rated by their scores, none passing another.
    const scored = [];
    for (const text of entry.fives) {
      const [, clubName, str, players] = /^(.+) (\d+): (.+)$/.exec(text);
      const club = doc.clubs.find(item => item.name === clubName);
      assert.equal(club.str, Number(str));
      players.split(', ').forEach((player, i) => {
        const [, name, positions, rating, score] = /^(.+) ([A-Z]{1,2}(?:\/[A-Z]{1,2})?) (\d+) \((-?\d+\.\d{3})\)$/.exec(player);
        assert.deepEqual(club.squad[i], [name, positions, Number(rating)]);
        scored.push([Number(score), Number(rating)]);
      });
    }
    scored.sort((a, b) => a[0] - b[0]);
    assert.ok(scored.every(([score, rating], i) => i === 0 || score === scored[i - 1][0] || rating >= scored[i - 1][1]), `${listed.id}: no player passes another`);
    assert.ok(doc.clubs.every(club => club.squad.every(([, , rating]) => rating >= 69 && rating <= 97)), 'on NBA 2K27\'s spread');
    assert.ok(entry.population >= doc.clubs.length * 10 && entry.rated === entry.population, `${listed.id}: every club's rotation is rated`);
    assert.ok(entry.clubsAgainstSRS > 0.45, `${listed.id}: clubs against SRS ${entry.clubsAgainstSRS}`);
    assert.deepEqual(entry.leagueAverages, NBA_LEAGUE_AVERAGES[doc.season], 'played at its league\'s averages');
  }
  // The strongest of a few seasons, as history has them (each its season's best record).
  const top = id => { const [first, second] = seasonFile(id).clubs; assert.ok(first.str > second.str, id); return first.name; };
  assert.deepEqual(['nba-stats-1962', 'nba-stats-1968', 'nba-stats-1972', 'nba-stats-1973', 'nba-stats-1983'].map(top),
    ['Boston Celtics', 'Philadelphia 76ers', 'Los Angeles Lakers', 'Boston Celtics', 'Philadelphia 76ers']);
  const player = (id, club, name) => seasonFile(id).clubs.find(item => item.name === club).squad.find(([who]) => who === name);
  assert.deepEqual(player('nba-stats-1962', 'Philadelphia Warriors', 'Wilt Chamberlain'), ['Wilt Chamberlain', 'C', 97]);
  assert.deepEqual(player('nba-stats-1965', 'San Francisco Warriors', 'Wilt Chamberlain'), ['Wilt Chamberlain', 'C', 97],
    'traded in January 1965, he plays for the club he played the most minutes for');
  assert.deepEqual(player('nba-stats-1972', 'Milwaukee Bucks', 'Kareem Abdul-Jabbar'), ['Kareem Abdul-Jabbar', 'C', 97]);
  // 1988/89's Bullets had two Charles Joneses: the one with more minutes plays.
  assert.deepEqual(audit.seasons.find(season => season.id === 'nba-stats-1989').namesakes, ['Charles Jones (WSB, 74, 516 min; Basketball-Reference\'s jonesch02)']);
});

test('the seasons before NBA 2K come from their own pinned sources: every player real, every rating the source\'s', () => {
  const audit = JSON.parse(read('docs/design/basketball-seasons-audit.json'));
  const before = BUILT_IN_BASKETBALL_SEASONS.filter(set => set.year < 2000 && !isComputed(MANIFEST, set.year));
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
  assert.throws(broken(d => { d.clubs.shift(); }), /clubs must be the 30 of map nba2008, found 29/);
  // Its EuroLeague clubs, after the NBA's, are the 24 of its EuroLeague map.
  assert.throws(broken(d => { d.clubs.pop(); }), /the EuroLeague's clubs must be the 24 of map el2008, found 23/);
  assert.throws(broken(d => { delete d.euroleague; }), /EuroLeague clubs need their map/);
  assert.throws(broken(d => { d.euroleague = 'el2010'; }), /euroleague "el2010" is not a EuroLeague map listing this season/);
  assert.throws(broken(d => { d.clubs.at(-1).id = 'b-cska-moscow'; }), /must look like "el-<name>"/);
  assert.throws(broken(d => { d.clubs.unshift(d.clubs.pop()); }), /is a EuroLeague club before the NBA's/);
  assert.throws(broken(d => { d.kind = 'ea'; }), /kind "ea" is not the kind its id names/);
  assert.throws(broken(d => { d.clubs[0].id = 'f-phoenix-suns'; }), /must look like "b-<name>"/);
  assert.throws(broken(d => { d.clubs[1].code = d.clubs[0].code; }), /is duplicated/);
  assert.throws(broken(d => { d.clubs[0].league = 'EuroLeague'; }), /clubs must be the 30 of map nba2008, found 29/, 'an NBA franchise in the EuroLeague');
  assert.throws(broken(d => { d.clubs[0].league = 'ABA'; }), /not a built-in league/);
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
  // So are a computed season's: it says how they were computed.
  const stats = seasonFile('nba-stats-1975');
  assert.equal(decodeFootballSet(structuredClone(stats), 'nba-stats-1975').meta.source.conversion, stats.source.conversion);
  const { conversion: _rule, ...silent } = stats.source;
  assert.throws(() => decodeFootballSet({ ...structuredClone(stats), source: silent }, 'nba-stats-1975'),
    /source conversion must say how the overalls were computed from the statistics/);
  assert.throws(() => decodeFootballSet({ ...structuredClone(stats), map: 'nba1976' }, 'nba-stats-1975'), /not a basketball map listing this season/);
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
const strongest = doc => nbaClubs(doc).sort((a, b) => b.str - a.str || a.name.localeCompare(b.name)).slice(0, 3).map(club => club.name);

test('basketball\'s Season choice lists its own seasons; one takes the clubs onto its era\'s map, and Nations goes back', async () => {
  await withApp(async ({ app, time }) => {
    const model = modelOf(app);
    assert.deepEqual(model.season.options.map(option => option.label),
      ['2026/27 · built in', ...BUILT_IN_BASKETBALL_SEASONS.map(set => `${set.season} · ${set.label}`)]);
    assert.equal(model.season.options.at(-1).label, '1960/61 · Basketball-Reference (computed)');
    assert.ok(model.season.options.some(option => option.label === '1983/84 · NBA 2K27 (Magic vs Bird era)'));
    assert.deepEqual(model.season.options.map(option => option.name), ['2026/27', ...BUILT_IN_BASKETBALL_SEASONS.map(set => (set.id.startsWith('nba-stats-')
      ? `${set.season} · computed` : set.season))], 'the dropdown names each by its season, a computed one saying so');
    assert.equal(model.season.options.at(-1).name, '1960/61 · computed');
    assert.match(model.season.note, /NBA 2K ratings of that season, as compiled by 2K Archive/);
    assert.match(model.season.note, /seasons no game rated, back to 1960\/61, are computed from Basketball-Reference's statistics/);
    assert.match(model.season.note, /They have clubs only: the NBA franchises of that season, on the map of their day, and from 2000\/01 the EuroLeague's clubs of that season/);
    assert.equal(model.season.id, null);

    app.pickSetup('dataSet', 'nba-2k08');
    assert.deepEqual([app.state.setup.layer, app.state.setup.clubScope], ['clubs', 'domestic:nba2008'], 'clubs only, on the 2007/08 map');
    const loading = modelOf(app);
    assert.deepEqual(loading.scopes.map(scope => [scope.id, scope.label, scope.count]), [['domestic:nba2008', 'NBA', 30], ['domestic:el2008', 'EuroLeague', 24]]);
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
    assert.deepEqual(Object.keys(st.teams).sort(), nbaClubs(doc).map(club => club.id).sort());
    for (const club of nbaClubs(doc)) {
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
    assert.deepEqual(Object.keys(st.teams).sort(), nbaClubs(doc).map(club => club.id).sort());
    assert.equal(app.territoryName(st.teams['b-kansas-city-kings'].home), 'Kansas City');
    assert.equal(app.territoryName(st.teams['b-washington-bullets'].home), 'Landover');
    assert.deepEqual(st.teams['b-boston-celtics'].squad.map(p => [p.name, p.rating]), doc.clubs.find(club => club.id === 'b-boston-celtics').squad.map(([name, , rating]) => [name, rating]));
    // Its save holds every player as played.
    const saved = parseCampaign(items.get(SAVE_KEY));
    assert.equal(JSON.stringify(saved.teams), JSON.stringify(st.teams));
  });
});

test('a 1983/84 campaign saved before 1981/82 and 1982/83 joined its map resumes on the map\'s new build', async () => {
  await withApp(async ({ app, time, items }) => {
    app.pickSetup('sport', 'basketball');
    await chooseSeason(app, time, 'nba-eras-1984');
    app.startCampaign();
    const st = app.state;
    // The build of nba1984 that served 1983/84 alone.
    const before = 'nba1984-c324172f', current = CLUB_MAPS.find(entry => entry.id === 'nba1984').version;
    assert.notEqual(current, before);
    const data = JSON.parse(items.get(SAVE_KEY));
    for (const settings of [data.settings, data.initialSettings].filter(Boolean)) settings.domesticVersion = before;
    app.continueSaved(parseCampaign(JSON.stringify(data)));
    assert.equal(app.state.phase, 'playing');
    assert.equal(app.state.settings.domesticVersion, current);
    assert.equal(JSON.stringify(app.state.teams), JSON.stringify(st.teams), 'every club as it was played');
    assert.deepEqual(app.state.own, st.own, 'every section with its holder');
  });
});

test('1960/61 launches its eight franchises on their own map, the Warriors in Philadelphia and the Nationals in Syracuse', async () => {
  await withApp(async ({ app, time, items }) => {
    app.pickSetup('sport', 'basketball');
    await chooseSeason(app, time, 'nba-stats-1961');
    const doc = seasonFile('nba-stats-1961');
    const model = modelOf(app);
    assert.deepEqual(model.scopes.map(scope => [scope.id, scope.count]), [['domestic:nba1961', 8]]);
    assert.match(model.countryNote, new RegExp(`^${strongest(doc).join(', ').replace(/, ([^,]*)$/, ' and $1')} lead the 8 NBA clubs`));
    assert.equal(model.campaignSummary, 'Basketball · Clubs · NBA · USA and Canada · 1960/61');
    app.startCampaign();
    const st = app.state;
    assert.deepEqual([st.settings.dataSet, st.settings.dataSeason, st.settings.clubScope], ['nba-stats-1961', '1960/61', 'domestic:nba1961']);
    assert.deepEqual(Object.keys(st.teams).sort(), nbaClubs(doc).map(club => club.id).sort());
    for (const [id, city] of [['b-los-angeles-lakers', 'Los Angeles'], ['b-philadelphia-warriors', 'Philadelphia'], ['b-cincinnati-royals', 'Cincinnati'],
      ['b-st-louis-hawks', 'St. Louis'], ['b-syracuse-nationals', 'Syracuse'], ['b-new-york-knicks', 'New York'], ['b-detroit-pistons', 'Detroit']]) {
      assert.equal(app.territoryName(st.teams[id].home), city);
    }
    for (const club of nbaClubs(doc)) {
      assert.deepEqual(st.teams[club.id].squad.map(p => [p.name, p.rating]), club.squad.map(([name, , rating]) => [name, rating]), `${club.name}'s 1960/61 five`);
    }
    // Its save holds every player as played, and resumes as it was.
    const saved = parseCampaign(items.get(SAVE_KEY));
    assert.equal(JSON.stringify(saved.teams), JSON.stringify(st.teams));
    B.clearFootballSetCache();
    app.continueSaved(saved);
    assert.equal(app.state.phase, 'playing');
    assert.equal(JSON.stringify(app.state.teams), JSON.stringify(st.teams));
  });
});
