// Ice hockey's built-in earlier seasons (docs/design/hockey.md, "Earlier seasons"): NHLPA Hockey '93, NHL '94, NHL 95,
// NHL 07 and NHL 22, each EA edition's NHL clubs and its nations by birth country, built from committed snapshots; the
// classic games' overall (NHL '94's own rule; NHLPA '93's by NHL '94's weights), rescaled rank for rank onto NHL 27's
// ratings by the player's choice; their era maps (the Hartford Whalers,
// Quebec Nordiques and old Winnipeg Jets, the Minnesota North Stars until 1993, the Atlanta Thrashers and Phoenix
// Coyotes in 2007); the loader; and the App, which plays a season with its nations or with its clubs on the map of
// their day.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { act } from 'react';
import { SAVE_KEY } from '../src/config.js';
import { BUILT_IN_HOCKEY_SEASONS } from '../src/data/hockeySeasons.js';
import { CLUB_MAPS } from '../src/data/clubMaps.js';
import { CLUBS } from '../src/data/clubs.hockey.js';
import { buildTeam, makeRng, selectLineup } from '../src/data/teams.js';
import { decodeDomestic } from '../src/engine/domestic.js';
import { BUILT_IN_SETS, builtInSeasonOf, decodeFootballSet, seasonMapOf, seasonSport, setHasClubs, setHasNations, setSportOf, sportOf } from '../src/engine/footballSets.js';
import { parseCampaign } from '../src/engine/storage.js';
import { BASELINE } from '../src/sports/hockey.js';
import { buildSetupModel } from '../src/screens/setup/setupModel.js';
import { pointInPolys } from './lib/domestic-partition.mjs';
import {
  findPlayer, nhl94Overall, nhlpa93Displayed, nhlpa93Overall, norm, quantileRescale, ratingsOf, seasonIdOf, teamsOf,
} from './lib/nhl-seasons.mjs';
import { bundleComponents, findElement, syncAppFixture, withDom } from './lib/app-harness.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const MANIFEST = JSON.parse(read('scripts/data/nhl-seasons.json'));
const SOURCES = JSON.parse(read('scripts/data/nhl-seasons-sources.json')).sources;
const AUDIT = JSON.parse(read('docs/design/hockey-seasons-audit.json'));
const snapshotOf = id => JSON.parse(read(`scripts/data/nhl-seasons/${id}.json`));
const seasonFile = id => JSON.parse(read(`public/hockey/${id}.json`));
const mapFile = id => JSON.parse(read(`public/domestic/${id}.json`));
const ERA_MAPS = CLUB_MAPS.filter(entry => entry.sport === 'hockey' && entry.seasons);
// The five EA editions; the computed and converted seasons have their own tests (scripts/hockey-computed.test.mjs).
const IDS = ['nhl-2022', 'nhl-2007', 'nhl-1995', 'nhl-1994', 'nhl-1993'];
const EDITIONS = MANIFEST.seasons.filter(season => !season.method);
const ALL_IDS = MANIFEST.seasons.map(season => season.id).sort((a, b) => b.localeCompare(a));
const sectionAt = (map, point) => map.geo.countries.find(section => pointInPolys(point, section.polys))?.id ?? null;
const home = (map, id) => map.clubs.find(club => club.id === id).homeSection;
const playerOf = (id, name) => {
  for (const club of seasonFile(id).clubs) {
    const player = club.squad.find(([n]) => n === name);
    if (player) return [club.code, ...player.slice(1)];
  }
  return null;
};
/** A player's own overall in the edition, as the snapshot keeps it: [club, position, overall]. */
const gameOf = (id, name) => snapshotOf(id).players.find(([n]) => n === name)?.slice(1, 4) ?? null;
const CLASSIC = ['nhl-1993', 'nhl-1994', 'nhl-1995'];
const rescaledOf = id => AUDIT.seasons.find(season => season.id === id).rescaled;

// ---------- building ----------

test('every season rebuilds byte for byte from its committed snapshot, and the built-in season is unchanged', () => {
  assert.match(execFileSync(process.execPath, ['scripts/build-nhl-seasons.mjs', '--check'], { cwd: root, encoding: 'utf8' }), /Verified the 59 hockey seasons/);
  assert.match(execFileSync(process.execPath, ['scripts/build-hockey.mjs', '--check'], { cwd: root, encoding: 'utf8' }), /Verified the NHL clubs and the hockey nations/);
  assert.deepEqual(EDITIONS.map(season => season.id).sort(), IDS.slice().sort());
  for (const season of EDITIONS) {
    const snapshot = snapshotOf(season.id);
    assert.deepEqual(snapshot.source, { id: season.id, edition: season.edition, label: season.label, retrieved: season.retrieved });
    assert.ok(snapshot.players.every(([name, team, pos, rating]) => name && team && ['C', 'LW', 'RW', 'D', 'G'].includes(pos)
      && Number.isInteger(rating) && rating >= 1 && rating <= 99), `${season.id}: every row is a rated player`);
  }
  // Every download is pinned by its SHA-256.
  assert.ok(Object.keys(SOURCES).length > 300);
  assert.ok(Object.values(SOURCES).every(source => /^[0-9a-f]{64}$/.test(source.sha256) && /^https?:\/\//.test(source.url)));
});

const cached = existsSync(new URL('../data-src/nhl-seasons', import.meta.url));
test('the snapshots rebuild from their pinned downloads', { skip: !cached && 'the downloads (data-src/nhl-seasons/) are not on this computer' }, () => {
  assert.match(execFileSync(process.execPath, ['scripts/sync-nhl-seasons.mjs', '--check'], { cwd: root, encoding: 'utf8' }),
    /Verified the hockey season snapshots byte for byte/);
});

test('the built-in seasons are the manifest\'s, newest first, each on its era\'s map', () => {
  assert.deepEqual(BUILT_IN_HOCKEY_SEASONS.map(set => set.id), ALL_IDS);
  assert.deepEqual(BUILT_IN_HOCKEY_SEASONS.filter(set => IDS.includes(set.id)).map(set => [set.season, set.label, set.map]), [
    ['2021/22', 'NHL 22', 'nhl2022'], ['2006/07', 'NHL 07', 'nhl2007'], ['1994/95', 'NHL 95', 'nhl1995'], ['1993/94', 'NHL 94', 'nhl1994'],
    ['1992/93', 'NHLPA 93', 'nhl1993']]);
  assert.equal(builtInSeasonOf('hockey').season, '2026/27', 'the built-in season stays the current one');
  for (const listed of BUILT_IN_HOCKEY_SEASONS) {
    assert.deepEqual(BUILT_IN_SETS.find(entry => entry.id === listed.id), listed, `${listed.id} is listed as built`);
    assert.equal(setSportOf(listed.id), 'hockey');
    assert.ok(setHasClubs(listed.id), 'a hockey season fields clubs');
    assert.equal(setHasNations(listed.id), listed.year >= 1978, 'and nations from 1977/78');
    assert.equal(seasonMapOf(listed.id), listed.map);
    assert.equal(seasonFile(listed.id).version, listed.version);
    assert.equal(listed.id, seasonIdOf(listed.year));
  }
  const shipped = ['nhl1993', 'nhl1994', 'nhl1995', 'nhl2007', 'nhl2022'];
  assert.deepEqual(ERA_MAPS.filter(entry => shipped.includes(entry.id)).map(entry => [entry.id, entry.seasons, entry.clubs]), [
    ['nhl1993', ['nhl-1993'], 24], ['nhl1994', ['nhl-1994'], 26], ['nhl1995', ['nhl-1995'], 26],
    ['nhl2007', ['nhl-2007', 'nhl-2008', 'nhl-2009', 'nhl-2010', 'nhl-2011'], 30], ['nhl2022', ['nhl-2022'], 32]]);
});

// ---------- the seasons ----------

test('every season loads and fits its era\'s map: its clubs named, coded and housed as that season had them', () => {
  for (const listed of BUILT_IN_HOCKEY_SEASONS) {
    const doc = seasonFile(listed.id);
    const entry = MANIFEST.seasons.find(season => season.id === listed.id);
    const set = decodeFootballSet(doc, listed.id);
    assert.deepEqual([set.meta.year, set.meta.season, set.meta.map], [listed.year, listed.season, listed.map]);
    if (entry.method !== 'computed') assert.equal(set.meta.source.provider, 'EA Sports');
    const map = decodeDomestic(mapFile(listed.map), listed.map);
    assert.deepEqual(map.clubs.map(club => club.id).sort(), doc.clubs.map(club => club.id).sort(), `${listed.id}'s clubs are its map's`);
    const teams = teamsOf(MANIFEST, listed.year);
    // An era map keeps the arenas of the first season it serves (a later season's may have moved, within its county).
    const mapEntry = MANIFEST.maps.find(m => m.seasons.includes(listed.year));
    const firstTeams = teamsOf(MANIFEST, mapEntry.seasons[0]);
    const arenas = new Map(mapFile(listed.map).clubs.map(club => [club.id, club.arena]));
    for (const club of doc.clubs) {
      const team = teams.find(t => t.id === club.id);
      assert.ok(team, `${club.name} is a club of ${listed.season}`);
      assert.deepEqual([club.name, club.code, club.league, club.country], [team.name, team.code, 'NHL', team.country]);
      if (listed.map !== 'nhl') assert.equal(arenas.get(club.id), firstTeams.find(t => t.id === club.id).arena, `${listed.season} ${club.name}'s map arena`);
      assert.ok(club.squad.length >= 12 && club.squad.length <= 23, `${listed.season} ${club.name} keeps ${club.squad.length}`);
      const lineup = selectLineup({ sport: 'hockey', squad: club.squad.map(([name, pos, rating]) => ({ name, pos, rating })) });
      assert.equal(lineup.rating, club.str, `${listed.season} ${club.name}'s strength is its lineup's`);
      assert.ok(lineup.slots.every(slot => !slot.player || slot.player.pos !== 'G' || slot.position === 'G'), 'no goalie skates');
    }
    // The snapshot's players are all there: in their club's squad or beyond its 23.
    const snapshot = snapshotOf(listed.id);
    assert.equal(doc.coverage.players, snapshot.players.length);
    assert.equal(doc.coverage.left, snapshot.left.length);
    assert.deepEqual(doc.territory, { merged: { SCO: '826', WAL: '826', NIR: '826' }, inactive: [] }, 'Great Britain plays as one');
    if (setHasNations(listed.id)) assert.ok(doc.nations['124'][0] >= doc.nations['840'][0], `${listed.season}: Canada first`);
  }
});

test('nothing is estimated: a club the edition leaves short fields what it has', () => {
  const short = id => AUDIT.seasons.find(season => season.id === id).clubs.filter(line => /short of/.test(line))
    .map(line => line.replace(/ \d+(\.\d+)? \(/, ' (')).sort();
  assert.deepEqual(short('nhl-1994'), ['Florida Panthers (17 players; short of 3 forwards)', 'Mighty Ducks of Anaheim (18 players; short of 3 forwards)']);
  assert.deepEqual(short('nhl-1993'), ['Ottawa Senators (17 players; short of 2 forwards)', 'Tampa Bay Lightning (18 players; short of 2 forwards)']);
  assert.deepEqual(short('nhl-1995'), [], 'every club full in NHL 95');
  assert.deepEqual(short('nhl-2007'), [], 'and in NHL 07');
  assert.equal(short('nhl-2022').length, 8, 'eight clubs of NHL 22 are one to three players short');
  // The game fills a short club's empty places at its floor, never with a goalie on a forward line.
  const anaheim = seasonFile('nhl-1994').clubs.find(club => club.id === 'nhl-mighty-ducks-of-anaheim');
  assert.equal(anaheim.squad.filter(([, pos]) => pos === 'G').length, 1, 'its backup goalie would have skated: left out');
  assert.equal(anaheim.squad.length, 17);
});

test('NHL \'94: KinGraph\'s attributes, the game\'s own overall: Gretzky 87, Lemieux capped at 99', () => {
  assert.deepEqual(gameOf('nhl-1994', 'Wayne Gretzky'), ['LAK', 'C', 87]);
  assert.deepEqual(gameOf('nhl-1994', 'Mario Lemieux'), ['PIT', 'C', 99]);
  assert.deepEqual(gameOf('nhl-1994', 'Ed Belfour'), ['CHI', 'G', 98]);
  // wboy's rule (forum.nhl94.com topic 228): Gretzky's attributes; a weak player's sum below 50 halves and rounds down;
  // a goalie's 4.5 terms round down; 99 at most.
  const gretzky = { agility: 6, speed: 4, offence: 5, defence: 4, shotPower: 2, checking: 2, stickHandling: 6, shotAccuracy: 2, endurance: 6, passing: 6 };
  assert.equal(nhl94Overall(gretzky, false), 87);
  assert.equal(nhl94Overall({ ...gretzky, offence: 6, defence: 4, agility: 5, shotPower: 4, checking: 3, shotAccuracy: 6, speed: 4 }, false), 99, 'Lemieux\'s 100 caps at 99');
  assert.equal(nhl94Overall({ agility: 2, speed: 3, offence: 2, defence: 3, shotPower: 2, checking: 4, stickHandling: 2, shotAccuracy: 1, endurance: 3, passing: 1 }, false), 48,
    'Troy Loney: 47 halves to 48.5, rounded down (NHL94.com and KinGraph show 49)');
  assert.equal(nhl94Overall({ agility: 6, defence: 6, puckControl: 5, stickRight: 6, stickLeft: 6, gloveRight: 5, gloveLeft: 5 }, true), 98, 'Belfour');
  const snapshot = snapshotOf('nhl-1994');
  assert.equal(snapshot.players.length, 605);
  assert.deepEqual(snapshot.left.map(([name]) => name), ['Matt Hervey']);
  // The cartridge's spellings are the NHL's names.
  for (const name of ['Alexander Mogilny', 'John Vanbiesbrouck', 'Scott Niedermayer', 'Vyacheslav Kozlov']) {
    assert.ok(snapshot.players.some(([player]) => player === name), name);
  }
  assert.equal(snapshot.players.filter(([, team]) => team === 'ANA').length, 18, 'the expansion players are Anaheim\'s only');
});

test('NHLPA \'93: the cartridge\'s attributes, overall by NHL \'94\'s weights on their displayed values', () => {
  assert.equal(nhlpa93Displayed(15), 100);
  assert.equal(nhlpa93Displayed(2), 13);
  const chambers = { agility: 0, speed: 0, offence: 0, defence: 0, shotPower: 0, checking: 2, stickHandling: 0, shotAccuracy: 0, endurance: 2, passing: 0 };
  assert.equal(nhlpa93Overall(chambers, false), 1, 'Shawn Chambers\'s infamous 1');
  assert.deepEqual(gameOf('nhl-1993', 'Shawn Chambers'), ['TBL', 'D', 1]);
  assert.equal(nhlpa93Overall({ agility: 15, defence: 15, puckControl: 15, stickRight: 15, stickLeft: 15, gloveRight: 15, gloveLeft: 15 }, true), 99, '99 at most');
  const snapshot = snapshotOf('nhl-1993');
  assert.equal(snapshot.players.length, 556);
  assert.deepEqual(snapshot.left.map(([name]) => name), ['Mike McNeill']);
  // The goalies the CSV files as forwards are goalies: the NHL says so.
  assert.equal(playerOf('nhl-1993', 'Andy Moog')[1], 'G');
  assert.match(seasonFile('nhl-1993').source.overall, /NHL '94's weights/);
});

test('NHL 95: nhl-95.com\'s Genesis overall, the Rangers\' skaters Segathon\'s', () => {
  assert.deepEqual(gameOf('nhl-1995', 'Esa Tikkanen'), ['NYR', 'RW', 75]);
  assert.deepEqual(gameOf('nhl-1995', 'Glenn Anderson'), ['NYR', 'RW', 67]);
  assert.deepEqual(gameOf('nhl-1995', 'Mike Richter'), ['NYR', 'G', 78], 'the Rangers\' goalies are nhl-95.com\'s');
  assert.deepEqual(gameOf('nhl-1995', 'Sergei Fedorov'), ['DET', 'C', 99]);
  const snapshot = snapshotOf('nhl-1995');
  assert.deepEqual(snapshot.left.map(([name, team]) => `${name} ${team}`), ['Alexander Karpotsev NYR', 'Rob Burakowsky OTT']);
  assert.equal(snapshot.notes.fromSegathon.length, 21);
  assert.equal(snapshot.players.length, 616);
});

test('the 1990s seasons are rescaled onto NHL 27\'s ratings rank for rank; NHL 07 and NHL 22 keep EA\'s own numbers', () => {
  // The reference is NHL 27's built-in clubs as the game fields them, frozen in the manifest.
  const reference = ratingsOf(MANIFEST.rescale.histogram);
  assert.equal(reference.length, 733);
  if (builtInSeasonOf('hockey').season === '2026/27') {
    assert.deepEqual(reference, CLUBS.flatMap(club => club.squad.map(([, , rating]) => rating)).sort((a, b) => a - b), 'NHL 27\'s squads');
  }
  assert.deepEqual(MANIFEST.seasons.filter(season => season.rescale).map(season => season.id), CLASSIC);
  for (const id of CLASSIC) {
    const doc = seasonFile(id), snapshot = snapshotOf(id), { mapping, ratings } = rescaledOf(id);
    // The rule: every overall takes the reference rating at its mid-rank among the season's players.
    const steps = Object.entries(mapping).map(([game, rating]) => [Number(game), rating]).sort((a, b) => a[0] - b[0]);
    const expected = quantileRescale(snapshot.players.map(([, , , overall]) => overall), reference);
    assert.deepEqual(steps, [...expected].sort((a, b) => a[0] - b[0]));
    // Nobody passes anybody, and ties stay ties: the mapping never goes down.
    assert.ok(steps.every(([, rating], i) => i === 0 || rating >= steps[i - 1][1]), `${id}: the order holds`);
    assert.deepEqual([ratings.lowest, ratings.median], [71, 82], `${id}: NHL 27's floor and middle`);
    // Every rating in the file is the rescaled game overall of its player.
    const game = new Map(snapshot.players.map(([name, team, , overall]) => [`${name}|${team}`, overall]));
    for (const club of doc.clubs) {
      for (const [name, , rating] of club.squad) assert.equal(rating, mapping[game.get(`${name}|${club.code}`)], `${id} ${name}`);
    }
    const anyGame = new Map(snapshot.players.map(([name, , , overall]) => [name, overall]));
    for (const [, , squad] of Object.values(doc.nations)) {
      for (const [name, , rating] of squad) assert.equal(rating, mapping[anyGame.get(name)], `${id} ${name}`);
    }
    assert.match(doc.source.conversion, /rescaled onto NHL 27's ratings rank for rank/);
    assert.match(doc.source.conversion, new RegExp(`among the season's ${snapshot.players.length} rated players`));
  }
  assert.match(seasonFile('nhl-1993').source.conversion, /^NHL '94's weights on the cartridge's displayed attributes .*99 at most; then rescaled/);
  assert.match(seasonFile('nhl-1994').source.conversion, /^the game's overall, rescaled/);
  // Named: Gretzky 87 to 94, Lemieux 99 to 97, Roy 94 to 95, Chambers 1 to 71, the median 54 to 82.
  assert.deepEqual(playerOf('nhl-1994', 'Wayne Gretzky'), ['LAK', 'C', 94]);
  assert.deepEqual(playerOf('nhl-1994', 'Mario Lemieux'), ['PIT', 'C', 97]);
  assert.deepEqual(playerOf('nhl-1994', 'Patrick Roy'), ['MTL', 'G', 95]);
  assert.deepEqual(playerOf('nhl-1993', 'Shawn Chambers'), ['TBL', 'D', 71]);
  assert.equal(rescaledOf('nhl-1994').mapping[54], 82);
  assert.deepEqual(playerOf('nhl-1995', 'Esa Tikkanen'), ['NYR', 'RW', 88]);
  // The later seasons are EA's numbers, unconverted.
  for (const id of ['nhl-2007', 'nhl-2022']) {
    const doc = seasonFile(id);
    assert.equal(doc.source.conversion, undefined);
    assert.equal(rescaledOf(id), undefined);
    const game = new Map(snapshotOf(id).players.map(([name, team, , overall]) => [`${name}|${team}`, overall]));
    assert.ok(doc.clubs.every(club => club.squad.every(([name, , rating]) => game.get(`${name}|${club.code}`) === rating)), id);
  }
  assert.deepEqual(BUILT_IN_HOCKEY_SEASONS.filter(set => ['nhl-2022', 'nhl-2007'].includes(set.id)).map(set => set.version), ['nhl-2022-c91e9cb4', 'nhl-2007-7fbf9804']);
});

test('a rank-preserving rescale keeps ties and lets nobody pass', () => {
  const rating = quantileRescale([10, 20, 20, 30, 40, 50], [70, 75, 80, 85, 90, 95]);
  assert.deepEqual([...rating].sort((a, b) => a[0] - b[0]), [[10, 70], [20, 80], [30, 85], [40, 90], [50, 95]]);
  // A narrower scale may bring neighbours together, never past each other.
  const narrow = [...quantileRescale([1, 2, 3, 4, 5, 6, 7, 8], [80, 80, 81, 99])].sort((a, b) => a[0] - b[0]).map(([, value]) => value);
  assert.ok(narrow.every((value, i) => i === 0 || value >= narrow[i - 1]));
  assert.deepEqual([narrow[0], narrow.at(-1)], [80, 99]);
});

test('NHL 07: IGN\'s pages of EA\'s ratings, goalies rounded, nations by EA\'s NHL 08 country', () => {
  assert.deepEqual(playerOf('nhl-2007', 'Sidney Crosby'), ['PIT', 'C', 91]);
  assert.deepEqual(playerOf('nhl-2007', 'Jean-Sebastien Giguere'), ['ANA', 'G', 86], '85.57 rounds to 86');
  const snapshot = snapshotOf('nhl-2007');
  assert.equal(snapshot.players.length, 858);
  assert.equal(snapshot.left.filter(([, team]) => team === 'Free Agents').length, 7, 'the free agents play for no club');
  assert.equal(snapshot.notes.nation.ea + snapshot.notes.nation.birth, 858);
  const doc = seasonFile('nhl-2007');
  const nationOf = name => Object.keys(doc.nations).filter(id => doc.nations[id][2].some(([player]) => player === name));
  assert.deepEqual(nationOf('Craig Adams'), [], 'born in Brunei, Canadian by EA: one of Canada\'s depth, not Brunei\'s');
  assert.ok(doc.clubs.some(club => club.id === 'nhl-phoenix-coyotes') && doc.clubs.some(club => club.id === 'nhl-atlanta-thrashers'));
});

test('NHL 22: NHLRatings.net\'s launch pages, every rating EA\'s own lists show matching, Crosby and Malkin from EA', () => {
  const snapshot = snapshotOf('nhl-2022');
  assert.deepEqual(snapshot.notes.eaCheck, { listed: 63, compared: 60, equal: 60, mismatches: [] });
  assert.deepEqual(snapshot.notes.addedFromEA, ['Sidney Crosby (PIT): EA 93', 'Evgeni Malkin (PIT): EA 90']);
  assert.deepEqual(snapshot.left, [['Tuukka Rask', 'Free Agent', "a free agent in EA's launch lists"]]);
  assert.equal(snapshot.players.length, 679);
  assert.deepEqual(playerOf('nhl-2022', 'Connor McDavid'), ['EDM', 'C', 95]);
  assert.match(seasonFile('nhl-2022').source.compiler, /names no source/);
  // Every NHL 22 page is CommonCrawl's capture, pinned with the record it comes from.
  const pages = Object.entries(SOURCES).filter(([file]) => file.startsWith('nhlratings/'));
  assert.equal(pages.length, 32);
  assert.ok(pages.every(([, source]) => source.warc && /^crawl-data\/CC-MAIN-2022-/.test(source.warc.file)));
});

test('clubs of their era: the Whalers, Nordiques and old Jets, the North Stars until 1993, the Capitals at Landover', () => {
  const ids = id => seasonFile(id).clubs.map(club => club.id);
  for (const id of ['nhl-1993', 'nhl-1994', 'nhl-1995']) {
    for (const club of ['nhl-hartford-whalers', 'nhl-quebec-nordiques', 'nhl-winnipeg-jets-1979']) assert.ok(ids(id).includes(club), `${id}: ${club}`);
    assert.ok(!ids(id).includes('nhl-carolina-hurricanes') && !ids(id).includes('nhl-utah-mammoth'));
  }
  assert.ok(ids('nhl-1993').includes('nhl-minnesota-north-stars') && !ids('nhl-1993').includes('nhl-dallas-stars'));
  assert.ok(ids('nhl-1994').includes('nhl-dallas-stars') && ids('nhl-1994').includes('nhl-mighty-ducks-of-anaheim'));
  assert.ok(ids('nhl-2022').includes('nhl-arizona-coyotes') && ids('nhl-2022').includes('nhl-seattle-kraken'));
  // The eras' clubs keep today's id where nothing changed, and today's colour with it.
  const bruins = seasonFile('nhl-1994').clubs.find(club => club.id === 'nhl-boston-bruins');
  assert.equal(bruins.col, CLUBS.find(club => club.id === 'nhl-boston-bruins').col);
  const old = decodeDomestic(mapFile('nhl1994'), 'nhl1994');
  assert.equal(old.sectionNames[home(old, 'nhl-washington-capitals')], 'Landover');
  assert.equal(sectionAt(old, [-76.8469, 38.9025]), home(old, 'nhl-washington-capitals'), 'USAir Arena, Maryland');
  assert.equal(sectionAt(old, [-71.2464, 46.8308]), home(old, 'nhl-quebec-nordiques'), 'the Colisée de Québec');
  assert.equal(sectionAt(old, [-73.5847, 45.4903]), home(old, 'nhl-montreal-canadiens'), 'the Montreal Forum');
  const stars = decodeDomestic(mapFile('nhl1993'), 'nhl1993');
  assert.equal(sectionAt(stars, [-93.24, 44.8583]), home(stars, 'nhl-minnesota-north-stars'), 'the Met Center');
  for (const entry of ERA_MAPS) {
    const map = decodeDomestic(mapFile(entry.id), entry.id);
    for (const club of map.clubs) assert.ok(map.geo.countries.some(section => section.id === club.homeSection), `${entry.id}: ${club.name} has land`);
  }
});

test('a source\'s name finds the NHL\'s player: its club first, a namesake on another club never taken twice', () => {
  const league = [
    { id: 1, name: 'Petr Sykora', last: 'Sykora', pos: 'C', team: 'EDM' }, { id: 2, name: 'Petr Sykora', last: 'Sykora', pos: 'C', team: 'WSH' },
    { id: 3, name: 'Theo Fleury', last: 'Fleury', pos: 'RW', team: 'CGY' }, { id: 4, name: 'Tim Sweeney', last: 'Sweeney', pos: 'C', team: 'BOS' },
    { id: 5, name: 'Mark Recchi', last: 'Recchi', pos: 'RW', team: 'PHI' }, { id: 6, name: 'Jean-Sebastien Giguere', last: 'Giguere', pos: 'G', team: 'ANA' },
  ];
  assert.equal(findPlayer(league, { name: 'Petr Sykora', team: 'WSH', group: 'F' }).player.id, 2);
  assert.equal(findPlayer(league, { name: 'Petr Sykora', team: 'NYR', group: 'F' }, {}, { taken: new Set([2]) }).player.id, 1);
  assert.equal(findPlayer(league, { name: 'Theoren Fleury', team: 'CGY', group: 'F' }).how, 'surname');
  assert.equal(findPlayer(league, { name: 'Bob Sweeney', team: 'BOS', group: 'F' }, {}, { onTeamOnly: true }), null, 'another first name is another player');
  assert.equal(findPlayer(league, { name: 'Mike Ricci', team: 'PHI', group: 'F' }), null, 'nor is a near surname with another first name');
  assert.equal(findPlayer(league, { name: 'Jean-Sebastian Giguere', team: 'ANA', group: 'G' }).player.id, 6);
  assert.equal(findPlayer(league, { name: 'John Vanbiesbrk', team: 'FLA' }, { 'John Vanbiesbrk': 'Tim Sweeney' }).how, 'alias');
  assert.equal(norm('Rod Brind\'Amour'), 'rod brind amour');
});

test('the loader refuses a hockey season that is not the builder\'s', () => {
  const doc = seasonFile('nhl-1994');
  const broken = edit => { const copy = JSON.parse(JSON.stringify(doc)); edit(copy); return () => decodeFootballSet(copy, copy.id); };
  assert.throws(broken(d => { d.map = 'nhl1995'; }), /map "nhl1995" is not/);
  assert.throws(broken(d => { d.season = '1994'; }), /season "1994" must be "1993\/94"/);
  assert.throws(broken(d => { d.clubs[0].squad[0][1] = 'QB'; }), /is not one of the sport's/);
  assert.throws(broken(d => { d.clubs[0].squad[0][2] = 100; }), /rating must be a whole number 1-99/);
  assert.throws(broken(d => { d.clubs.pop(); }), /clubs must be the 26 of map nhl1994/);
  assert.throws(broken(d => { d.clubs[0].squad = d.clubs[0].squad.slice(0, 11); }), /needs at least 12 players/);
  assert.throws(broken(d => { d.clubs[0].id = 'b-boston-celtics'; }), /must look like the built-in clubs'/);
  assert.throws(broken(d => { d.source.rawScale = '99'; }), /rawScale must be a number/);
  assert.throws(broken(d => { d.nations.XXX = [50, 1, [['A', 'C', 50]]]; }), /is not a nation id/);
});

test('a season binds hockey to its nations and clubs; a nation it does not list is a minnow', () => {
  const set = decodeFootballSet(seasonFile('nhl-1994'), 'nhl-1994');
  const sport = seasonSport(set);
  assert.deepEqual([sport.id, sport.dataSet, sport.dataSeason, sport.dataLabel, sport.clubMap], ['hockey', 'nhl-1994', '1993/94', 'NHL 94', 'nhl1994']);
  assert.equal(sport.clubs.length, 26);
  const canada = buildTeam('124', makeRng(1994), sport);
  assert.deepEqual(canada.squad.filter(p => !p.gen).map(p => p.name), set.rosters['124'][2].map(([name]) => name), 'the 1993/94 Canadians');
  assert.ok(canada.squad.some(p => p.name === 'Wayne Gretzky'));
  const brazil = buildTeam('076', makeRng(1994), sport);
  assert.equal(brazil.str, BASELINE);
  assert.equal(sportOf({ sport: 'hockey', layer: 'nations', dataSet: 'nhl-1994' }), null, 'until it has loaded');
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
    const [, folder, id] = String(url).match(/^\/(domestic|hockey)\/([0-9A-Za-z-]+)\.json$/) || [];
    const file = folder ? `public/${folder}/${id}.json` : null;
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
    settings: { sport: 'hockey', layer: 'nations', scope: 'UEFA', clubScope: 'domestic:nhl', role: 'spectator', seed: '11' } });
  f.app.opening = B.App.prototype.opening;
  try { return await fn({ ...f, calls }); } finally {
    f.close();
    if (prior) Object.defineProperty(globalThis, 'fetch', prior); else delete globalThis.fetch;
  }
}
const modelOf = app => buildSetupModel(app.state.setup, { managerTeams: app.setupTeams(), domestic: app.domesticStatus(), season: app.seasonStatus() });
const edited = (items, edit) => {
  const data = JSON.parse(items.get(SAVE_KEY));
  edit(data.settings);
  if (data.initialSettings) edit(data.initialSettings);
  return JSON.stringify(data);
};

test('hockey\'s Season choice lists its seasons; a season keeps Nations, and Clubs take its era\'s map', async () => {
  await withApp(async ({ app }) => {
    app.pickSetup('sport', 'hockey');
    const model = modelOf(app);
    // A computed or converted season says so on screen; an EA edition's is named by its years.
    const methodOf = id => MANIFEST.seasons.find(season => season.id === id).method;
    assert.deepEqual(model.season.options.map(option => option.name), ['2026/27',
      ...BUILT_IN_HOCKEY_SEASONS.map(set => (methodOf(set.id) ? `${set.season} · ${methodOf(set.id)}` : set.season))]);
    assert.deepEqual(['nhl-2009', 'nhl-1994', 'nhl-1968'].map(id => model.season.options.find(option => option.id === id).name),
      ['2008/09 · converted', '1993/94', '1967/68 · computed']);
    assert.deepEqual(model.season.options.slice(1).map(option => option.label), BUILT_IN_HOCKEY_SEASONS.map(set => `${set.season} · ${set.label}`));
    assert.equal(model.season.options.length, 60, 'the built-in season and every season from 1966/67 but 2004/05');
    app.pickSetup('dataSet', 'nhl-1994');
    assert.deepEqual([app.state.setup.layer, app.state.setup.dataSet], ['nations', 'nhl-1994'], 'a hockey season keeps its nations');
    app.pickSetup('layer', 'clubs');
    assert.equal(app.state.setup.clubScope, 'domestic:nhl1994', 'the 1993/94 clubs on the map of 1993/94');
    app.pickSetup('dataSet', 'nhl-2007');
    assert.equal(app.state.setup.clubScope, 'domestic:nhl2007');
    app.pickSetup('dataSet', null);
    assert.equal(app.state.setup.clubScope, 'domestic:nhl', 'the built-in season plays on today\'s map');
  });
});

test('the Season choice shows the chosen season\'s credit as text under it: the databank\'s statement whole, MoneyPuck\'s, or none', async () => {
  const creditOf = id => BUILT_IN_HOCKEY_SEASONS.find(set => set.id === id).credit;
  const statement = MANIFEST.computed.sources.hdb.attribution;
  await withApp(async ({ app }) => {
    app.pickSetup('sport', 'hockey');
    // The model, from the App's own listing: the chosen season's credit, known while the season loads.
    assert.equal(modelOf(app).season.credit, '', 'the built-in season shows none');
    app.pickSetup('dataSet', 'nhl-2011');
    const model = modelOf(app);
    assert.equal(model.season.state, 'loading');
    assert.equal(model.season.credit, `Data: MoneyPuck.com. ${statement}`);
    assert.equal(model.season.options.find(option => option.id === 'nhl-2011').credit, creditOf('nhl-2011'));
    assert.equal(model.season.options.find(option => option.id === 'nhl-2022').credit, '', 'an EA edition credits no one here');
    await withDom(async ({ document, mount }) => {
      const part = () => findElement(app.render(), 'SetupOverlay');
      const view = await mount(part());
      const refresh = () => act(async () => view.root.render(part()));
      const credit = () => document.querySelector('.setup-season__credit')?.textContent ?? null;
      const describedBy = () => document.getElementById('setup-season').getAttribute('aria-describedby');
      /** Pick a season in the dropdown as the player does, then render what the App now holds. */
      const pickSeason = async id => {
        const select = document.getElementById('setup-season');
        select.value = id;
        await act(async () => select.dispatchEvent(new document.defaultView.Event('change', { bubbles: true })));
        await refresh();
      };
      assert.equal(credit(), creditOf('nhl-2011'), 'on screen, whole');
      const shown = document.querySelector('.setup-season__credit');
      assert.equal(shown.classList.contains('sr-only') || !!shown.closest('[hidden]'), false);
      assert.equal(shown.previousElementSibling.contains(document.getElementById('setup-season')), true, 'right under the Season choice');
      assert.equal(describedBy(), 'setup-season-note setup-season-credit');
      await pickSeason('nhl-2026');
      assert.equal(credit(), 'Data: MoneyPuck.com', '2025/26 takes nothing from the databank');
      await pickSeason('nhl-1985');
      assert.equal(credit(), statement, '1984/85 from the databank');
      assert.equal(credit().replace(/\s+/g, ' '), 'The information used herein was obtained free of charge from and is copyrighted by the Hockey Databank '
        + 'project. For more information about the Hockey Databank project please visit http://sports.groups.yahoo.com/group/hockey-databank');
      await pickSeason('nhl-2009');
      assert.equal(credit(), statement, 'NHL 09: the databank\'s positions and birth countries');
      await pickSeason('nhl-2022');
      assert.equal(credit(), null, 'NHL 22 shows none');
      assert.equal(describedBy(), 'setup-season-note');
      await pickSeason('');
      assert.equal(credit(), null, 'nor does the built-in season');
    });
  });
});

test('a 1993/94 nations campaign launches with NHL \'94\'s players and resumes as it was played', async () => {
  await withApp(async ({ app, time, items, calls }) => {
    app.pickSetup('sport', 'hockey');
    app.pickSetup('scope', 'UEFA');
    app.pickSetup('dataSet', 'nhl-1994');
    time.advance(200);
    await app.loadSet('nhl-1994');
    await settle();
    assert.equal(app.seasonStatus().state, 'ready');
    const doc = seasonFile('nhl-1994');
    app.startCampaign();
    const st = app.state;
    assert.equal(st.phase, 'playing');
    assert.deepEqual([st.settings.layer, st.settings.dataSet, st.settings.dataVersion, st.settings.dataYear, st.settings.dataSeason],
      ['nations', 'nhl-1994', doc.version, 1994, '1993/94']);
    assert.ok(calls.includes('/hockey/nhl-1994.json'));
    const sweden = st.teams['752'];
    assert.deepEqual(sweden.squad.filter(p => !p.gen).map(p => [p.name, p.rating]), doc.nations['752'][2].map(([name, , rating]) => [name, rating]),
      'the Swedes of 1993/94, as NHL \'94 rated them');
    const saved = parseCampaign(items.get(SAVE_KEY));
    assert.equal(JSON.stringify(saved.teams), JSON.stringify(st.teams));
    assert.throws(() => parseCampaign(edited(items, s => { s.dataSeason = '1994'; })), /Campaign data set is invalid/);
  });
});

test('a 2006/07 clubs campaign plays on the map of 2006/07, the Atlanta Thrashers among its clubs, and resumes on it', async () => {
  await withApp(async ({ app, time, items }) => {
    app.pickSetup('sport', 'hockey');
    app.pickSetup('layer', 'clubs');
    app.pickSetup('dataSet', 'nhl-2007');
    assert.equal(app.state.setup.clubScope, 'domestic:nhl2007');
    time.advance(200);
    await Promise.all([app.loadCountry('nhl2007'), app.loadSet('nhl-2007')]);
    await settle();
    assert.equal(app.domesticStatus().state, 'ready');
    const doc = seasonFile('nhl-2007');
    app.startCampaign();
    const st = app.state;
    assert.equal(st.phase, 'playing');
    assert.deepEqual([st.settings.clubScope, st.settings.domesticVersion, st.settings.dataSet, st.settings.dataSeason],
      ['domestic:nhl2007', CLUB_MAPS.find(entry => entry.id === 'nhl2007').version, 'nhl-2007', '2006/07']);
    assert.deepEqual(Object.keys(st.teams).sort(), doc.clubs.map(club => club.id).sort());
    const atlanta = st.teams['nhl-atlanta-thrashers'];
    const listed = doc.clubs.find(club => club.id === 'nhl-atlanta-thrashers');
    assert.deepEqual([atlanta.name, atlanta.code, atlanta.str], ['Atlanta Thrashers', 'ATL', listed.str]);
    assert.deepEqual(atlanta.squad.map(p => p.name), listed.squad.map(([name]) => name), 'the 2006/07 Thrashers');
    assert.equal(app.territoryName(atlanta.home), 'Atlanta');
    assert.equal(JSON.stringify(parseCampaign(items.get(SAVE_KEY)).teams), JSON.stringify(st.teams));
    assert.throws(() => parseCampaign(edited(items, s => { s.clubScope = 'domestic:nhl'; s.domesticVersion = CLUB_MAPS.find(entry => entry.id === 'nhl').version; })),
      /Campaign data set is invalid/);
  });
});

test('a 1992/93 clubs campaign gives the North Stars Minnesota and the Nordiques Quebec City', async () => {
  await withApp(async ({ app, time }) => {
    app.pickSetup('sport', 'hockey');
    app.pickSetup('layer', 'clubs');
    app.pickSetup('dataSet', 'nhl-1993');
    time.advance(200);
    await Promise.all([app.loadCountry('nhl1993'), app.loadSet('nhl-1993')]);
    await settle();
    app.startCampaign();
    const { teams } = app.state;
    assert.equal(Object.keys(teams).length, 24);
    assert.equal(teams['nhl-minnesota-north-stars'].name, 'Minnesota North Stars');
    assert.equal(app.territoryName(teams['nhl-quebec-nordiques'].home), 'Quebec City');
    assert.equal(app.territoryName(teams['nhl-new-york-rangers'].home), 'Manhattan');
  });
});
