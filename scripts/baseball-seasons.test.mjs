// The built-in earlier baseball seasons (docs/design/baseball.md, "Earlier seasons"): MLB The Show 18 to 25, each
// edition's nations by birthplace and MLB clubs, built from committed snapshots (18 to 20 ShowZone's copies, whose
// missing birthplaces come from nearby editions and MLB's own records), their era maps (the Athletics in Oakland until
// 2024, the Cleveland Indians until 2021, the Blue Jays in Buffalo in 2020, the Rays at Steinbrenner Field in 2025), the
// loader and the App, which plays a season with its nations or with its clubs on the map of their day.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SAVE_KEY } from '../src/config.js';
import { BUILT_IN_BASEBALL_SEASONS } from '../src/data/baseballSeasons.js';
import { CLUB_MAPS } from '../src/data/clubMaps.js';
import { CLUBS } from '../src/data/clubs.baseball.js';
import { NATIONS, buildTeam, makeRng, selectLineup } from '../src/data/teams.js';
import { nationTheatres } from '../src/data/scopes.js';
import { decodeDomestic } from '../src/engine/domestic.js';
import { BUILT_IN_SETS, builtInSeasonOf, decodeFootballSet, seasonMapOf, seasonSport, setHasNations, setSportOf, sportOf } from '../src/engine/footballSets.js';
import { parseCampaign } from '../src/engine/storage.js';
import { BASELINE, baseball } from '../src/sports/baseball.js';
import { buildSetupModel } from '../src/screens/setup/setupModel.js';
import { readChallenge } from '../src/screens/setup/challenge.js';
import { kmToPolys, pointInPolys } from './lib/domestic-partition.mjs';
import { editionOf, nameKey, nearestBirthplace, seasonIdOf, teamsOf } from './lib/mlb.mjs';
import { bundleComponents, syncAppFixture } from './lib/app-harness.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const MANIFEST = JSON.parse(read('scripts/data/mlb-seasons.json'));
const FRANCHISES = JSON.parse(read('scripts/data/mlb-teams.json')).teams;
const AUDIT = JSON.parse(read('docs/design/baseball-seasons-audit.json'));
const snapshotOf = year => JSON.parse(read(`scripts/data/mlb-the-show-${editionOf(year)}.json`));
const seasonFile = id => JSON.parse(read(`public/baseball/${id}.json`));
const mapFile = id => JSON.parse(read(`public/domestic/${id}.json`));
// MLB The Show's seasons and their era maps (the seasons computed from WAR, 1960 to 2017, are
// scripts/baseball-war-seasons.test.mjs's).
const SHOW_SEASONS = BUILT_IN_BASEBALL_SEASONS.filter(set => /^mlb-the-show-/.test(set.id));
const ERA_MAPS = CLUB_MAPS.filter(entry => entry.sport === 'baseball' && entry.seasons?.some(id => /^mlb-the-show-/.test(id)));
const SHOWZONE_SEASONS = [2018, 2019, 2020];
const sectionAt = (map, point) => map.geo.countries.find(section => pointInPolys(point, section.polys))?.id ?? null;
const home = (map, id) => map.clubs.find(club => club.id === id).homeSection;
const ballpark = (mapId, clubId) => mapFile(mapId).clubs.find(club => club.id === clubId).arena;

// ---------- building ----------

test('every season rebuilds byte for byte from its committed snapshot', () => {
  assert.match(execFileSync(process.execPath, ['scripts/build-mlb-seasons.mjs', '--check'], { cwd: root, encoding: 'utf8' }),
    /Verified the 66 baseball seasons \(8 from MLB The Show, 58 computed from WAR\)/);
  for (const year of MANIFEST.seasons) {
    const snapshot = snapshotOf(year);
    assert.equal(snapshot.players.length, snapshot.source.cards);
    assert.equal(snapshot.source.season, String(year));
    assert.equal(Object.keys(snapshot.teams).length, 31, `${year}: the 30 clubs and the free agents`);
  }
});

test('MLB The Show 18 to 20 are ShowZone\'s copies of each edition\'s last roster update', () => {
  const { showzone } = MANIFEST;
  assert.deepEqual(SHOWZONE_SEASONS.map(year => {
    const { source, players } = snapshotOf(year);
    return [source.edition, source.compiler, source.url, source.rosterUpdate.id, source.rosterUpdate.date, players.length];
  }), [
    ['MLB The Show 18', 'ShowZone', 'https://data.showzone.gg/api/players', 10021, '2018-11-01', 1571],
    ['MLB The Show 19', 'ShowZone', 'https://data.showzone.gg/api/players', 27, '2019-09-27', 1609],
    ['MLB The Show 20', 'ShowZone', 'https://data.showzone.gg/api/players', 18, '2020-10-30', 1996],
  ]);
  for (const year of SHOWZONE_SEASONS) {
    const { source, teams } = snapshotOf(year);
    assert.ok(source.provenance.startsWith(showzone.provenance) && source.provenance.endsWith(showzone.editions[year].checks));
    assert.equal(teams.CLE, 'Indians', `${year}: the Cleveland Indians`);
  }
  // Every cached page is pinned; the control edition is Sony's own MLB The Show 21.
  assert.equal(Object.keys(showzone.sha256).length, 2 + 16 + 17 + 20 + 21);
  assert.ok(Object.values(showzone.sha256).every(sha => /^[0-9a-f]{64}$/.test(sha)));
  assert.equal(snapshotOf(showzone.control).source.url, 'https://mlb21.theshow.com/apis/items.json');
  // ShowZone keeps neither a birthplace nor a secondary position for any MLB The Show 18 card; it does for 19 and 20.
  const count = (year, field) => snapshotOf(year).players.filter(row => row[field]).length;
  assert.deepEqual(SHOWZONE_SEASONS.map(year => [count(year, 4), count(year, 6)]), [[0, 0], [601, 1605], [742, 1988]]);
  // The season files credit ShowZone beside the publisher.
  assert.deepEqual(seasonFile('mlb-the-show-19').source, { provider: 'San Diego Studio', edition: 'MLB The Show 19',
    update: 'Roster update 27 (September 27, 2019)', retrieved: '2026-11-08', url: 'https://data.showzone.gg/api/players', rawScale: 99, compiler: 'ShowZone' });
  assert.equal(seasonFile('mlb-the-show-21').source.compiler, undefined, 'Sony\'s own editions name no compiler');
});

const cached = ['data-src/showzone', 'data-src/mlb-stats-api'].every(dir => existsSync(new URL(`../${dir}`, import.meta.url)));
test('the ShowZone snapshots and MLB\'s birthplaces rebuild from their pinned caches', { skip: !cached && 'the ShowZone and MLB Stats API caches (data-src/) are not on this computer' }, () => {
  const run = script => execFileSync(process.execPath, [script, '--check'], { cwd: root, encoding: 'utf8' });
  assert.match(run('scripts/import-mlb-showzone.mjs'), /ShowZone's MLB The Show 21 is Sony's, all 2092 cards[\s\S]*Verified the 3 ShowZone snapshots byte for byte/);
  assert.match(run('scripts/sync-mlb-birthplaces.mjs'), /Verified scripts\/data\/mlb-birthplaces\.json byte for byte/);
});

test('the built-in seasons are the manifest\'s, newest first, from 2025 back to 2018, each on its era\'s map', () => {
  assert.deepEqual(SHOW_SEASONS.map(set => set.id), [...MANIFEST.seasons].reverse().map(seasonIdOf));
  assert.deepEqual(BUILT_IN_BASEBALL_SEASONS.slice(0, SHOW_SEASONS.length), SHOW_SEASONS, 'MLB The Show\'s seasons come first, newest first');
  assert.deepEqual(SHOW_SEASONS.map(set => [set.season, set.label, set.map]), [
    ['2025', 'MLB The Show 25', 'mlb2025'], ['2024', 'MLB The Show 24', 'mlb2022'], ['2023', 'MLB The Show 23', 'mlb2022'],
    ['2022', 'MLB The Show 22', 'mlb2022'], ['2021', 'MLB The Show 21', 'mlb2021'], ['2020', 'MLB The Show 20', 'mlb2020'],
    ['2019', 'MLB The Show 19', 'mlb2019'], ['2018', 'MLB The Show 18', 'mlb2018']]);
  assert.equal(builtInSeasonOf('baseball').season, '2026', 'the built-in season stays the current one');
  for (const listed of SHOW_SEASONS) {
    const set = BUILT_IN_SETS.find(entry => entry.id === listed.id);
    assert.deepEqual(set, listed, `${listed.id} is listed as built`);
    assert.equal(setSportOf(set.id), 'baseball');
    assert.ok(setHasNations(set.id), 'a baseball season fields nations');
    assert.equal(seasonMapOf(set.id), listed.map);
    assert.equal(seasonFile(set.id).version, listed.version);
  }
  assert.deepEqual(ERA_MAPS.map(entry => [entry.id, entry.seasons]), [
    ['mlb2018', ['mlb-the-show-18']], ['mlb2019', ['mlb-the-show-19']], ['mlb2020', ['mlb-the-show-20']],
    ['mlb2021', ['mlb-the-show-21']], ['mlb2022', ['mlb-the-show-22', 'mlb-the-show-23', 'mlb-the-show-24']], ['mlb2025', ['mlb-the-show-25']]]);
});

// ---------- the seasons ----------

test('every season loads and fits its era\'s map: the same clubs, named and housed as that season had them', () => {
  for (const listed of SHOW_SEASONS) {
    const doc = seasonFile(listed.id);
    const set = decodeFootballSet(doc, listed.id);
    assert.deepEqual([set.meta.year, set.meta.season, set.meta.map], [listed.year, listed.season, listed.map]);
    const map = decodeDomestic(mapFile(listed.map), listed.map);
    assert.deepEqual(map.clubs.map(club => club.id).sort(), doc.clubs.map(club => club.id).sort(), `${listed.id}'s clubs are its map's`);
    const teams = teamsOf(FRANCHISES, MANIFEST, listed.year);
    for (const club of doc.clubs) {
      const team = teams.find(t => t.id === club.id);
      assert.ok(team, `${club.name} is a club of ${listed.year}`);
      assert.deepEqual([club.name, club.code, club.league], [team.name, team.code, 'MLB']);
      assert.equal(ballpark(listed.map, club.id), team.ballpark, `${listed.year} ${club.name} plays at ${team.ballpark}`);
      assert.equal(club.squad.length, 26);
      const lineup = selectLineup({ sport: 'baseball', squad: club.squad.map(([name, listedPositions, rating]) => {
        const [pos, ...others] = listedPositions.split('/');
        return { name, pos, positions: [pos, ...others], rating };
      }) });
      assert.ok(lineup.slots.every(slot => slot.player && !slot.outOfPosition), `${listed.year} ${club.name} fields every position`);
      assert.equal(lineup.rating, club.str);
    }
    assert.ok(Object.keys(doc.nations).length >= 18, `${listed.year} has its baseball nations`);
    assert.ok(doc.nations['840'][0] > doc.nations['214'][0] - 10, 'the United States among the strongest');
    assert.deepEqual(doc.territory, { merged: { SCO: '826', WAL: '826', NIR: '826' }, inactive: [] });
  }
  // MLB The Show 18 lists no secondary positions: its players field their primary one only.
  assert.ok(seasonFile('mlb-the-show-18').clubs.every(club => club.squad.every(([, positions]) => !positions.includes('/'))));
});

test('clubs play where they played then: Cleveland\'s Indians until 2021, Oakland until 2024, the Rays in Tampa in 2025', () => {
  const clubIds = id => seasonFile(id).clubs.map(club => club.id);
  for (const id of ['mlb-the-show-18', 'mlb-the-show-19', 'mlb-the-show-20', 'mlb-the-show-21']) {
    assert.ok(clubIds(id).includes('mlb-cleveland-indians') && !clubIds(id).includes('mlb-cleveland-guardians'), `${id}: the Cleveland Indians`);
  }
  assert.ok(clubIds('mlb-the-show-22').includes('mlb-cleveland-guardians'));
  for (const id of ['mlb-the-show-18', 'mlb-the-show-19', 'mlb-the-show-20', 'mlb-the-show-21', 'mlb-the-show-22', 'mlb-the-show-23', 'mlb-the-show-24']) {
    assert.ok(clubIds(id).includes('mlb-oakland-athletics') && !clubIds(id).includes('mlb-athletics'), `${id}: the Oakland Athletics`);
  }
  assert.ok(clubIds('mlb-the-show-25').includes('mlb-athletics'), '2025: the Athletics in Sacramento');
  const oakland = decodeDomestic(mapFile('mlb2022'), 'mlb2022');
  assert.equal(oakland.sectionNames[home(oakland, 'mlb-oakland-athletics')], 'Oakland');
  assert.equal(sectionAt(oakland, [-122.2006, 37.7517]), home(oakland, 'mlb-oakland-athletics'), 'the Coliseum is the A\'s');
  const tampa = decodeDomestic(mapFile('mlb2025'), 'mlb2025');
  const rays = tampa.clubs.find(club => club.id === 'mlb-tampa-bay-rays');
  assert.deepEqual(rays.homePoint, [-82.5067, 27.9803], 'Steinbrenner Field');
  assert.equal(sectionAt(tampa, [-121.5138, 38.5804]), home(tampa, 'mlb-athletics'), 'Sutter Health Park is the Athletics\'');
  for (const entry of ERA_MAPS) {
    const map = decodeDomestic(mapFile(entry.id), entry.id);
    for (const club of map.clubs) {
      const land = map.geo.countries.find(section => section.id === club.homeSection).polys;
      assert.ok(kmToPolys(club.homePoint, land) <= 2, `${entry.id}: ${club.name} plays inside its own territory`);
    }
    assert.equal(sectionAt(map, [-87.6556, 41.9481]), home(map, 'mlb-chicago-cubs'), `${entry.id}: Wrigley Field`);
    assert.equal(sectionAt(map, [-87.6339, 41.83]), home(map, 'mlb-chicago-white-sox'), `${entry.id}: the White Sox's ballpark`);
  }
});

test('2018 to 2020: the Blue Jays in Buffalo in 2020, the Rangers at Globe Life Park until 2019, the ballparks named as they were', () => {
  const ROGERS_CENTRE = [-79.3892, 43.6414], SAHLEN_FIELD = [-78.8743, 42.8813];
  const covid = decodeDomestic(mapFile('mlb2020'), 'mlb2020');
  const jays = home(covid, 'mlb-toronto-blue-jays');
  assert.equal(covid.sectionNames[jays], 'Buffalo');
  assert.equal(sectionAt(covid, SAHLEN_FIELD), jays, 'Sahlen Field is the Blue Jays\'');
  assert.equal(sectionAt(covid, ROGERS_CENTRE), null, 'Ontario is nobody\'s in 2020');
  // New York State is cut three ways: Yankee Stadium and Citi Field stay with their clubs.
  assert.equal(sectionAt(covid, [-73.9264, 40.8296]), home(covid, 'mlb-new-york-yankees'));
  assert.equal(sectionAt(covid, [-73.8458, 40.757]), home(covid, 'mlb-new-york-mets'));
  for (const id of ['mlb2018', 'mlb2019']) {
    const map = decodeDomestic(mapFile(id), id);
    assert.equal(map.sectionNames[home(map, 'mlb-toronto-blue-jays')], 'Toronto', `${id}: the Blue Jays in Toronto`);
    assert.equal(sectionAt(map, ROGERS_CENTRE), home(map, 'mlb-toronto-blue-jays'));
    assert.equal(sectionAt(map, SAHLEN_FIELD), home(map, 'mlb-new-york-yankees'), `${id}: Buffalo is New York's`);
  }
  const clubs = ['mlb-atlanta-braves', 'mlb-oakland-athletics', 'mlb-seattle-mariners', 'mlb-san-francisco-giants', 'mlb-miami-marlins',
    'mlb-milwaukee-brewers', 'mlb-texas-rangers', 'mlb-toronto-blue-jays'];
  assert.deepEqual(['mlb2018', 'mlb2019', 'mlb2020'].map(id => clubs.map(club => ballpark(id, club))), [
    ['SunTrust Park', 'Oakland–Alameda County Coliseum', 'Safeco Field', 'AT&T Park', 'Marlins Park', 'Miller Park', 'Globe Life Park in Arlington', 'Rogers Centre'],
    ['SunTrust Park', 'RingCentral Coliseum', 'T-Mobile Park', 'Oracle Park', 'Marlins Park', 'Miller Park', 'Globe Life Park in Arlington', 'Rogers Centre'],
    ['Truist Park', 'Oakland–Alameda County Coliseum', 'T-Mobile Park', 'Oracle Park', 'Marlins Park', 'Miller Park', 'Globe Life Field', 'Sahlen Field'],
  ]);
  const rangers = id => decodeDomestic(mapFile(id), id).clubs.find(club => club.id === 'mlb-texas-rangers').homePoint;
  assert.deepEqual([rangers('mlb2019'), rangers('mlb2020')], [[-97.0828, 32.7514], [-97.0842, 32.7474]]);
});

test('MLB The Show 18 names no birthplace: its players take theirs from MLB The Show 19 to 21, else from MLB\'s own records', () => {
  assert.ok(snapshotOf(2018).players.every(row => row[6] === ''));
  const audit = AUDIT.seasons.find(season => season.id === 'mlb-the-show-18');
  assert.equal(audit.birthplacesFromOtherEditions.length + audit.birthplacesFromMlb.length + audit.noNation.length, 1571);
  assert.ok(audit.birthplacesFromOtherEditions.length > 1300);
  assert.ok(audit.birthplacesFromOtherEditions.every(line => /\(MLB The Show (19|20|21)\)$/.test(line)), 'at most three editions away');
  assert.ok(audit.birthplacesFromMlb.every(line => /\(MLB player \d+, .+\)$/.test(line)));
  // The Giants' closer, not the Dodgers' catcher of the same name; spellings that changed; retired players MLB knows.
  for (const line of ['Will Smith: "" → Georgia (MLB The Show 19)', 'Isiah Kiner Falefa: "" → Hawaii (MLB The Show 19)',
    'Mike Wright: "" → South Carolina (MLB The Show 19)', 'Chih Wei Hu: "" → Taiwan (MLB The Show 19)']) {
    assert.ok(audit.birthplacesFromOtherEditions.includes(line), line);
  }
  for (const line of ['Joe Mauer: "" → Minnesota (MLB player 408045, St. Paul, MN, USA)',
    'Hisashi Iwakuma: "" → Japan (MLB player 547874, Tokyo, Japan)', 'Zach Britton: "" → California (MLB player 502154, Panorama City, CA, USA)']) {
    assert.ok(audit.birthplacesFromMlb.includes(line), line);
  }
  assert.deepEqual(audit.noNation, ['Chris Smith: "" (MLB\'s records: 2 players of that name, role and hands: 434672, 627262)']);
  const doc = seasonFile('mlb-the-show-18');
  const nationsOf = name => Object.keys(doc.nations).filter(id => doc.nations[id][2].some(([player]) => player === name));
  assert.deepEqual(['Francisco Lindor', 'Shohei Ohtani', 'Hisashi Iwakuma', 'Jose Altuve', 'Kenley Jansen', 'Juan Soto', 'Mike Trout'].map(nationsOf),
    [['630'], ['392'], ['392'], ['862'], ['528'], ['214'], ['840']]);
  // MLB The Show 19 and 20 name three places the later editions do not: Northern Ireland plays as the United Kingdom.
  const later = seasonFile('mlb-the-show-19');
  assert.deepEqual(['826', '440', '682'].map(id => later.nations[id][2].map(([player]) => player)), [['P.J. Conlon'], ['Dovydas Neverauskas'], ['Alex Wilson']]);
});

test('a birthplace comes from the nearest edition within three that names one, the player\'s role and club deciding between namesakes', () => {
  const snapshots = new Map([
    [2019, { players: [['a', 'Will Smith', 'LAD', 'C', '', 70, 'Kentucky'], ['b', 'Will Smith', 'SF', 'CP', '', 80, 'Georgia'],
      ['c', 'Luis Garcia', 'FA', 'SP', '', 70, 'Venezuela'], ['d', 'Luis Garcia', 'SD', 'RP', '', 71, 'Dominican Republic']] }],
    [2022, { players: [['e', 'Ichiro Suzuki', 'SEA', 'RF', '', 70, 'Japan']] }],
    [2021, { players: [['f', 'Isiah Kiner-Falefa', 'TEX', 'SS', '', 75, 'Hawaii'], ['g', 'Shohei Ohtani', 'LAA', 'DH', '', 90, 'At Sea']] }],
  ]);
  const near = row => nearestBirthplace(snapshots, 2018, row);
  assert.deepEqual(near(['x', 'Will Smith', 'SF', 'CP', '', 78, '']), { born: 'Georgia', from: 2019 });
  assert.deepEqual(near(['x', 'Will Smith', 'FA', 'C', '', 60, '']), { born: 'Kentucky', from: 2019 });
  assert.deepEqual(near(['x', 'Luis Garcia', 'BOS', 'RP', '', 69, '']), { born: 'Dominican Republic', from: 2019 }, 'a reliever of that name');
  assert.equal(near(['x', 'Luis Garcia', 'BOS', 'CF', '', 69, '']), null, 'no hitter of that name: neither pitcher is chosen');
  assert.deepEqual(near(['x', 'Isiah Kiner Falefa', 'TEX', 'C', '', 70, '']), { born: 'Hawaii', from: 2021 });
  assert.equal(near(['x', 'Ichiro Suzuki', 'SEA', 'RF', '', 80, '']), null, 'four editions away is too far');
  assert.equal(near(['x', 'Shohei Ohtani', 'LAA', 'SP', '', 80, '']), null, 'a place the game does not know places nobody');
  assert.equal(nearestBirthplace(snapshots, 2020, ['x', 'Will Smith', 'SF', 'CP', '', 78, ''], { 2019: 'unsound' }), null);
  assert.equal(nameKey('Germán Márquez'), nameKey('German Marquez'));
  assert.equal(nameKey('Robbie Ross Jr.'), nameKey('Robbie Ross'));
});

test('the loader refuses a baseball season that is not the builder\'s', () => {
  const doc = seasonFile('mlb-the-show-23');
  const broken = edit => { const copy = JSON.parse(JSON.stringify(doc)); edit(copy); return () => decodeFootballSet(copy, copy.id); };
  assert.throws(broken(d => { d.map = 'mlb2025'; }), /not a baseball map listing this season/);
  assert.throws(broken(d => { d.season = '2022/23'; }), /season "2022\/23" must be "2023"/);
  assert.throws(broken(d => { d.clubs[0].squad[0][1] = 'QB'; }), /must be baseball positions/);
  assert.throws(broken(d => { d.clubs.pop(); }), /clubs must be the 30 of map mlb2022/);
  assert.throws(broken(d => { d.nations['840'][1] = 5; }), /counts 5 players/);
  assert.throws(broken(d => { d.nations.XXX = [50, 1, [['A', 'SS', 50]]]; }), /is not a nation id/);
  assert.throws(broken(d => { d.clubs[0].id = 'b-boston-celtics'; }), /must look like "mlb-<name>"/);
  const covid = seasonFile('mlb-the-show-20');
  assert.throws(() => decodeFootballSet({ ...covid, map: 'mlb2021' }, covid.id), /not a baseball map listing this season/);
});

test('a season binds baseball to its nations and clubs; a nation it does not list is a minnow', () => {
  const set = decodeFootballSet(seasonFile('mlb-the-show-21'), 'mlb-the-show-21');
  const sport = seasonSport(set);
  assert.deepEqual([sport.id, sport.dataSet, sport.dataSeason, sport.clubMap], ['baseball', 'mlb-the-show-21', '2021', 'mlb2021']);
  assert.equal(sport.clubs.length, 30);
  const rng = makeRng(2021);
  const usa = buildTeam('840', rng, sport);
  assert.deepEqual(usa.squad.filter(p => !p.gen).map(p => p.name), set.rosters['840'][2].map(([name]) => name), 'the 2021 Americans');
  const brazil = buildTeam('076', rng, sport);
  assert.equal(set.rosters['076'] == null ? brazil.str : BASELINE, BASELINE);
  // Nations and clubs both play a season; a basketball season stays clubs only.
  assert.equal(sportOf({ sport: 'baseball', layer: 'nations', dataSet: 'mlb-the-show-21' }), null, 'until it has loaded');
  assert.ok(!setHasNations('nba-2k10'));
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
    const [, folder, id] = String(url).match(/^\/(domestic|baseball)\/([0-9A-Za-z-]+)\.json$/) || [];
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
  const f = syncAppFixture({ App: B.App, phase: 'setup', ids: ['840', '124', '484', '214', '862'],
    settings: { sport: 'baseball', layer: 'nations', scope: 'CONCACAF', clubScope: 'domestic:mlb', role: 'spectator', seed: '11' } });
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

test('baseball\'s Season choice lists its own seasons; a season keeps Nations, and Clubs take its era\'s map', async () => {
  await withApp(async ({ app, time }) => {
    app.pickSetup('sport', 'baseball');
    const model = modelOf(app);
    assert.deepEqual(model.season.options.map(option => option.name), ['2026', '2025', '2024', '2023', '2022', '2021', '2020', '2019', '2018',
      ...Array.from({ length: 58 }, (_, i) => String(2017 - i))]);
    assert.deepEqual(model.season.options.map(option => option.label),
      ['2026 · built in', ...BUILT_IN_BASEBALL_SEASONS.map(set => `${set.season} · ${set.label}`)]);
    assert.match(model.season.note, /MLB The Show ratings of each season/);

    app.pickSetup('dataSet', 'mlb-the-show-23');
    assert.deepEqual([app.state.setup.layer, app.state.setup.dataSet], ['nations', 'mlb-the-show-23'], 'a baseball season keeps its nations');
    time.advance(200);
    await app.loadSet('mlb-the-show-23');
    await settle();
    assert.equal(app.seasonStatus().state, 'ready');
    assert.equal(modelOf(app).canLaunch, true);

    app.pickSetup('layer', 'clubs');
    assert.deepEqual([app.state.setup.dataSet, app.state.setup.clubScope], ['mlb-the-show-23', 'domestic:mlb2022'], 'the 2023 clubs on the map of 2022–24');
    app.pickSetup('dataSet', 'mlb-the-show-20');
    assert.equal(app.state.setup.clubScope, 'domestic:mlb2020', 'the 2020 clubs on the map of 2020');
    app.pickSetup('dataSet', null);
    assert.equal(app.state.setup.clubScope, 'domestic:mlb', 'the built-in season plays on today\'s map');
    app.pickSetup('sport', 'basketball');
    assert.equal(app.state.setup.dataSet, null, 'a season stays with its sport');
  });
});

test('a season\'s nations launch with that year\'s players and resume as they were played', async () => {
  await withApp(async ({ app, time, items, calls }) => {
    app.pickSetup('sport', 'baseball');
    app.pickSetup('scope', 'CONCACAF');
    app.pickSetup('dataSet', 'mlb-the-show-22');
    time.advance(200);
    await app.loadSet('mlb-the-show-22');
    await settle();
    const doc = seasonFile('mlb-the-show-22');
    app.startCampaign();
    const st = app.state;
    assert.equal(st.phase, 'playing');
    assert.deepEqual([st.settings.layer, st.settings.dataSet, st.settings.dataVersion, st.settings.dataYear, st.settings.dataSeason],
      ['nations', 'mlb-the-show-22', doc.version, 2022, '2022']);
    const usa = st.teams['840'];
    assert.deepEqual(usa.squad.filter(p => !p.gen).map(p => [p.name, p.rating]), doc.nations['840'][2].map(([name, , rating]) => [name, rating]),
      'the 2022 Americans, as The Show 22 rated them');
    assert.ok(calls.includes('/baseball/mlb-the-show-22.json'));
    const saved = parseCampaign(items.get(SAVE_KEY));
    assert.equal(JSON.stringify(saved.teams), JSON.stringify(st.teams));
    assert.throws(() => parseCampaign(edited(items, s => { s.dataSeason = '2021/22'; })), /Campaign data set is invalid/);
    assert.throws(() => parseCampaign(edited(items, s => { s.sport = 'basketball'; })), /Campaign data set is invalid/);
  });
});

test('a 2018 nations campaign fields MLB The Show 18\'s players by the birthplaces found for them', async () => {
  await withApp(async ({ app, time, items, calls }) => {
    app.pickSetup('sport', 'baseball');
    app.pickSetup('scope', 'CONCACAF');
    app.pickSetup('dataSet', 'mlb-the-show-18');
    time.advance(200);
    await app.loadSet('mlb-the-show-18');
    await settle();
    assert.equal(app.seasonStatus().state, 'ready');
    const doc = seasonFile('mlb-the-show-18');
    app.startCampaign();
    const st = app.state;
    assert.equal(st.phase, 'playing');
    assert.deepEqual([st.settings.layer, st.settings.dataSet, st.settings.dataVersion, st.settings.dataYear, st.settings.dataSeason],
      ['nations', 'mlb-the-show-18', doc.version, 2018, '2018']);
    assert.ok(calls.includes('/baseball/mlb-the-show-18.json'));
    for (const id of ['840', '214', '630']) {
      assert.deepEqual(st.teams[id].squad.filter(p => !p.gen).map(p => [p.name, p.rating]), doc.nations[id][2].map(([name, , rating]) => [name, rating]),
        `${st.teams[id].name} as The Show 18 rated them`);
    }
    assert.ok(st.teams['630'].squad.some(p => p.name === 'Francisco Lindor'), 'Lindor plays for Puerto Rico');
    assert.equal(JSON.stringify(parseCampaign(items.get(SAVE_KEY)).teams), JSON.stringify(st.teams));
  });
});

test('a season\'s clubs launch on their era\'s map: the Oakland Athletics in Oakland', async () => {
  await withApp(async ({ app, time, items }) => {
    app.pickSetup('sport', 'baseball');
    app.pickSetup('layer', 'clubs');
    app.pickSetup('dataSet', 'mlb-the-show-24');
    time.advance(200);
    await Promise.all([app.loadCountry('mlb2022'), app.loadSet('mlb-the-show-24')]);
    await settle();
    assert.equal(app.domesticStatus().state, 'ready');
    const doc = seasonFile('mlb-the-show-24');
    app.startCampaign();
    const st = app.state;
    assert.deepEqual([st.settings.clubScope, st.settings.dataSet], ['domestic:mlb2022', 'mlb-the-show-24']);
    assert.equal(st.settings.domesticVersion, CLUB_MAPS.find(entry => entry.id === 'mlb2022').version);
    assert.equal(st.campaignName, 'Baseball 2024 · MLB · USA and Canada');
    assert.deepEqual(Object.keys(st.teams).sort(), doc.clubs.map(club => club.id).sort());
    const oakland = st.teams['mlb-oakland-athletics'];
    const listed = doc.clubs.find(club => club.id === 'mlb-oakland-athletics');
    assert.deepEqual([oakland.name, oakland.code, oakland.str], ['Oakland Athletics', 'OAK', listed.str]);
    assert.equal(app.territoryName(oakland.home), 'Oakland');
    assert.deepEqual(oakland.squad.map(p => p.name), listed.squad.map(([name]) => name), 'the 2024 A\'s');
    const today = CLUB_MAPS.find(entry => entry.id === 'mlb').version;
    assert.throws(() => parseCampaign(edited(items, s => { s.clubScope = 'domestic:mlb'; s.domesticVersion = today; })), /Campaign data set is invalid/);
    assert.ok(CLUBS.every(club => club.id !== 'mlb-oakland-athletics'), 'today\'s Athletics are another club');
  });
});

test('a 2019 clubs campaign plays on the map of 2019, the Cleveland Indians among its clubs, and resumes on it', async () => {
  await withApp(async ({ app, time, items }) => {
    app.pickSetup('sport', 'baseball');
    app.pickSetup('layer', 'clubs');
    app.pickSetup('dataSet', 'mlb-the-show-19');
    assert.equal(app.state.setup.clubScope, 'domestic:mlb2019');
    time.advance(200);
    await Promise.all([app.loadCountry('mlb2019'), app.loadSet('mlb-the-show-19')]);
    await settle();
    assert.equal(app.domesticStatus().state, 'ready');
    const doc = seasonFile('mlb-the-show-19');
    app.startCampaign();
    const st = app.state;
    assert.equal(st.phase, 'playing');
    assert.deepEqual([st.settings.clubScope, st.settings.domesticVersion, st.settings.dataSet, st.settings.dataSeason],
      ['domestic:mlb2019', CLUB_MAPS.find(entry => entry.id === 'mlb2019').version, 'mlb-the-show-19', '2019']);
    assert.equal(st.campaignName, 'Baseball 2019 · MLB · USA and Canada');
    assert.deepEqual(Object.keys(st.teams).sort(), doc.clubs.map(club => club.id).sort());
    const cleveland = st.teams['mlb-cleveland-indians'];
    const listed = doc.clubs.find(club => club.id === 'mlb-cleveland-indians');
    assert.deepEqual([cleveland.name, cleveland.code, cleveland.str], ['Cleveland Indians', 'CLE', listed.str]);
    assert.deepEqual(cleveland.squad.map(p => p.name), listed.squad.map(([name]) => name), 'the 2019 Indians');
    assert.equal(app.territoryName(cleveland.home), 'Cleveland');
    assert.equal(app.territoryName(st.teams['mlb-toronto-blue-jays'].home), 'Toronto');
    assert.equal(JSON.stringify(parseCampaign(items.get(SAVE_KEY)).teams), JSON.stringify(st.teams));
    // Its clubs play on 2019's map only.
    assert.throws(() => parseCampaign(edited(items, s => { s.clubScope = 'domestic:mlb2020'; s.domesticVersion = CLUB_MAPS.find(entry => entry.id === 'mlb2020').version; })),
      /Campaign data set is invalid/);
  });
});

test('a 2020 clubs campaign gives the Blue Jays Buffalo', async () => {
  await withApp(async ({ app, time }) => {
    app.pickSetup('sport', 'baseball');
    app.pickSetup('layer', 'clubs');
    app.pickSetup('dataSet', 'mlb-the-show-20');
    time.advance(200);
    await Promise.all([app.loadCountry('mlb2020'), app.loadSet('mlb-the-show-20')]);
    await settle();
    app.startCampaign();
    const jays = app.state.teams['mlb-toronto-blue-jays'];
    assert.equal(jays.name, 'Toronto Blue Jays');
    assert.equal(app.territoryName(jays.home), 'Buffalo');
  });
});

test('a challenge link to a season\'s nations keeps the manager\'s team once the season loads', async () => {
  await withApp(async ({ app, time }) => {
    const link = readChallenge('?sport=baseball&theatre=CONCACAF&season=mlb-the-show-24&role=manager&team=214&seed=1');
    assert.deepEqual(link.ignored, []);
    app.setState({ setup: link.setup });
    app.showSetupSet();
    time.advance(200);
    await app.loadSet('mlb-the-show-24');
    await settle();
    assert.equal(app.seasonStatus().state, 'ready');
    assert.equal(app.state.setup.clubScope, 'domestic:mlb2022', 'the clubs\' map follows the season');
    assert.equal(app.state.setup.managedTeamId, '214', 'the nations field is unchanged, so the Dominican Republic stays picked');
  });
  // MLB The Show's first season is 2018 (the computed ones reach back to 1960): a link to an older edition is not followed.
  assert.deepEqual(readChallenge('?sport=baseball&season=mlb-the-show-18').ignored, []);
  assert.deepEqual(readChallenge('?sport=baseball&season=mlb-the-show-17').ignored, ['season']);
});

test('baseball offers no Elite 32, so an elite setup plays N. & C. America, the same nations for every seed', async () => {
  // Fewer than 32 nations field a real baseball side (data/scopes.js): the rest of an Elite 32 would be generated
  // players, tied on strength.
  assert.ok(!nationTheatres(baseball).some(scope => scope.id === 'elite'));
  await withApp(async ({ app }) => {
    const setup = { ...app.state.setup, sport: 'baseball', layer: 'nations', scope: 'elite', dataSet: null };
    const openings = [1, 2, 3, 2026, 4294967295].map(seed => app.opening(setup, makeRng(seed)));
    const fields = openings.map(({ included }) => included.map(team => team.id).sort().join());
    assert.equal(new Set(fields).size, 1);
    assert.ok(fields[0].split(',').every(id => NATIONS[id][2] === 'CONCACAF'), 'baseball\'s heartland');
    assert.equal(openings[0].scopeName, 'N. & C. America');
  });
});
