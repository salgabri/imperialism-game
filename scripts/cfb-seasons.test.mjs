// The earlier college football seasons (docs/design/college-football.md, "Earlier seasons"): the FBS seasons 2009 to
// 2025, computed from sportsdataverse's facts. The library's readers and value on invented rows (scripts/lib/cfb-history.mjs);
// every committed snapshot's invariants (its schools, squads, ratings, SRS and moves recomputed from the snapshot alone)
// and the frozen weights; the snapshots rebuilt byte for byte where data-src/ holds the pinned sources (CI has none);
// every season built from its snapshot onto its era's map, its listing and audit; the loader's refusals; and the running
// App choosing a season, launching its schools on their era's map, saving and resuming.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  boxOf, DEPTH, fitWeights, participantsOf, PARTICIPANTS_FROM, pooledWindow, positionOf, POSITIONS, rateSeason, rawSignals,
  recruitsOf, regimeOf, scheduleOf, shrinkSignals, SIGNALS, standardise,
} from './lib/cfb-history.mjs';
import { ratingsOf, spearman, srsOf } from './lib/computed-ratings.mjs';
import { FORMATION, shortOf, squadOf } from './lib/nfl.mjs';
import { MAX_GAPS, VALUE_WEIGHTS } from './sync-cfb-seasons.mjs';

const root = new URL('../', import.meta.url);
const read = file => readFileSync(new URL(file, root), 'utf8');
const manifest = JSON.parse(read('scripts/data/cfb-seasons.json'));
const snapshotOf = year => JSON.parse(read(`scripts/data/cfb-seasons/${year}.json`));
const SPORT = 'college-football';

// ---------- the readers ----------

test('a roster position is the game\'s; a generic defensive back a corner or a safety by his recruiting, else his weight', () => {
  assert.equal(positionOf({ code: 'OT' }), 'OL');
  assert.equal(positionOf({ code: 'EDGE' }), 'DL');
  assert.equal(positionOf({ code: 'FB' }), 'RB');
  assert.equal(positionOf({ code: 'PK' }), 'K');
  for (const code of ['P', 'LS', 'PR', 'KR']) assert.equal(positionOf({ code }), null, `${code} has no place in the lineup`);
  assert.equal(positionOf({ code: 'DB', recruit: { position: 'S' }, weight: 180 }), 'S', 'his recruiting first');
  assert.equal(positionOf({ code: 'DB', recruit: { position: 'ATH' }, weight: 196 }), 'S', 'a heavy back without one is a safety');
  assert.equal(positionOf({ code: 'DB', weight: 185 }), 'CB');
  assert.equal(positionOf({ code: 'DB', others: ['DB', 'CB'], recruit: { position: 'S' } }), 'CB', 'another season that names his place first');
  assert.equal(positionOf({ code: 'DB', others: ['LB'], weight: 185 }), 'CB', 'a back\'s other season counts only as a corner or a safety');
  assert.equal(positionOf({ code: '?', others: ['NA', 'TE'] }), 'TE', 'an unplaced player his nearest season\'s');
  assert.equal(positionOf({ code: 'NA', recruit: { position: 'LB' } }), 'LB');
  assert.equal(positionOf({ code: null, box: { passAtt: 30, rushAtt: 5, rec: 0, fga: 0, xpa: 0 } }), 'QB');
  assert.equal(positionOf({ code: null, box: { passAtt: 0, rushAtt: 2, rec: 9, fga: 0, xpa: 0 } }), 'WR');
  assert.equal(positionOf({ code: 'ATH' }), null, 'nothing places him');
});

test('recruits are found by name and school, a name two recruits share by neither', () => {
  const r = (player_name, team_id, position = 'WR', grade = 85) => ({ player_name, team_id: String(team_id), position, grade, stars: 3 });
  const { byTeam, byName } = recruitsOf([[2016, [r('Ray-Ray McCloud', 228), r('John Smith', 333, 'OT'), r('Mike Jones', 52)]],
    [2017, [r('John Smith', 2, 'CB'), r('Mike Jones', 52, 'WR', 88)]]]);
  assert.equal(byTeam.get('rayraymccloud|228').class, 2016);
  assert.equal(byTeam.get('johnsmith|333').position, 'OL');
  assert.equal(byName.get('johnsmith'), null, 'two John Smiths');
  assert.equal(byName.get('mikejones').class, 2017, 'one recruit listed twice by one school keeps the later class');
  assert.equal(byTeam.get('mikejones|52').grade, 88);
});

test('a box score counts only the categories every season has; a player plays for the school he has most games with', () => {
  const row = (game_id, team_id, category, extra = {}) => ({ game_id, team_id, athlete_id: 7, athlete_name: 'A Back', category, ...extra });
  const box = boxOf([
    row(1, 10, 'rushing', { rushingAttempts: '20', rushingYards: '120', rushingTouchdowns: '2' }),
    row(1, 10, 'receiving', { receptions: '3', receivingYards: '25', receivingTouchdowns: '0' }),
    row(2, 10, 'rushing', { rushingAttempts: '15', rushingYards: '60', rushingTouchdowns: '0' }),
    row(3, 11, 'rushing', { rushingAttempts: '4', rushingYards: '9', rushingTouchdowns: '0' }),
    row(4, 10, 'defensive', { totalTackles: '3' }),
    row(5, 10, 'kicking', { 'fieldGoalsMade/fieldGoalAttempts': '2/3', 'extraPointsMade/extraPointAttempts': '4/4' }),
  ]);
  const p = box.get(7);
  assert.deepEqual([p.team, p.games.size, p.rushAtt, p.rushYds, p.rushTd, p.rec, p.recYds, p.fgm, p.fga, p.xpm, p.xpa], [10, 4, 39, 189, 2, 3, 25, 2, 3, 4, 4]);
  assert.ok(!p.games.has(4), 'the defence\'s own rows (from 2023) are not read');
  const parts = participantsOf([{ game_id: 1, tackler_player_id: 9, assisted_by_player_id: 8 }, { game_id: 2, tackler_player_id: 8, sacked_by_player_id: 8 },
    { game_id: 2, pass_defender_player_id: '9', forced_by_player_id: null }]);
  assert.deepEqual([parts.get(8).tackles, parts.get(8).sacks, parts.get(8).games.size, parts.get(9).tackles, parts.get(9).passesDefended], [2, 1, 2, 1, 1]);
});

test('a season\'s schools are the FBS schools that played one another; its games only theirs', () => {
  const g = (game_id, home_id, away_id, home_points, away_points, divisions = ['fbs', 'fbs'], extra = {}) => ({ game_id, season_type: 'regular', completed: true,
    neutral_site: false, home_id, away_id, home_points, away_points, home_division: divisions[0], away_division: divisions[1], home_conference: 'A', away_conference: 'B', ...extra });
  const { fbs, games, schools, conference } = scheduleOf([g(1, 1, 2, 30, 20), g(2, 3, 9, 10, 7, ['fbs', 'fcs']), g(3, 2, 1, 14, 21, ['fbs', 'fbs'], { neutral_site: true, season_type: 'postseason' }),
    g(4, 1, 2, null, null)]);
  assert.deepEqual([...fbs].sort(), [1, 2, 3]);
  assert.deepEqual([...schools].sort(), [1, 2], 'school 3 played no FBS school (New Mexico State in 2020)');
  assert.deepEqual(games.map(x => [x.id, x.neutral, x.postseason]), [[1, false, false], [3, true, true]], 'an unplayed game is left out');
  assert.equal(conference.get(3), 'A');
});

test('a player\'s window pools three seasons 3:2:1 by his school\'s games; the plays\' signals only where they are named', () => {
  const team = (games, passAtt, rushAtt, rec) => ({ games: new Set(Array.from({ length: games }, (_, i) => i)), passAtt, rushAtt, rec });
  const season = (games, t, box, part = null, named = true) => ({ games, team: t, box, part, participants: named });
  const box = (rushAtt, rushYds, games) => ({ games: new Set(Array.from({ length: games }, (_, i) => i)), passAtt: 0, passYds: 0, passTd: 0, passInt: 0, rushAtt,
    rushYds, rushTd: 0, rec: 0, recYds: 0, recTd: 0, int: 0, fgm: 0, fga: 0, xpa: 0 });
  const sum = pooledWindow([season(12, team(12, 400, 500, 250), box(200, 1000, 12), { games: new Set([0, 1]), tackles: 2, sacks: 0, passesDefended: 0 }),
    season(13, team(13, 380, 450, 230), box(100, 400, 10), null, false), null]);
  assert.equal(sum.G, 3 * 12 + 2 * 13);
  assert.equal(sum.rushAtt, 3 * 200 + 2 * 100);
  assert.equal(sum.partG, 36, 'only the season whose plays are named');
  const signals = rawSignals(sum, { grade: 90, exp: 3, weight: 210 });
  assert.equal(signals.rushShare, (3 * 200 + 2 * 100) / (3 * 500 + 2 * 450));
  assert.equal(signals.rushYdsPG, (3 * 1000 + 2 * 400) / 62);
  assert.equal(signals.tacklesPG, 6 / 36);
  assert.deepEqual(signals.ypc, { x: 3800, n: 800 });
  assert.equal(signals.boxAppearShare, (3 * 12 + 2 * 10) / 62);
  assert.equal(rawSignals(pooledWindow([season(12, team(12, 1, 1, 1), null, null, false)])).tacklesPG, null, 'no named plays, no signal');
});

test('an efficiency is shrunk toward the replacement rate of the quarter with the least exposure', () => {
  const players = [{ x: 50, n: 10 }, { x: 500, n: 100 }, { x: 1200, n: 200 }, { x: 2400, n: 400 }].map(ypc => ({ signals: { ypc, anya: { x: 0, n: 0 }, fgPct: { x: 0, n: 0 } } }));
  const { ypc } = shrinkSignals(players);
  assert.equal(ypc, 5, 'the least-exposed quarter: 50 in 10');
  assert.equal(players[0].signals.ypc, (50 + 60 * 5) / (10 + 60));
  assert.equal(players[3].signals.ypc, (2400 + 60 * 5) / (400 + 60));
});

test('signals are standardised over the position, a missing grade read as the graded players\' tenth percentile', () => {
  const players = [80, 85, 90, 95, null].map((grade, i) => ({ signals: { grade, exp: i + 1 } }));
  const { columns, fill } = standardise(players, ['grade', 'exp']);
  assert.equal(fill.grade, 80);
  assert.ok(Math.abs(columns.grade.reduce((t, v) => t + v, 0)) < 1e-9);
  assert.ok(columns.grade[4] === columns.grade[0], 'the walk-on reads as the low end of the recruits');
  assert.ok(columns.exp[4] > columns.exp[0]);
});

test('the weights are fitted by least squares, a signal that would weigh negatively dropped', () => {
  const n = 400, X = { a: [], b: [], noise: [] }, y = [];
  let seed = 7;
  const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 - 0.5; };
  for (let i = 0; i < n; i++) {
    const a = rand(), b = rand(), noise = rand();
    X.a.push(a); X.b.push(b); X.noise.push(noise);
    y.push(70 + 6 * a + 2 * b - 0.5 * noise + 0.2 * rand());
  }
  const { weights } = fitWeights(X, y);
  assert.deepEqual(Object.keys(weights), ['a', 'b'], 'the negative signal dropped');
  assert.ok(Math.abs(weights.a - 0.75) < 0.02 && Math.abs(weights.b - 0.25) < 0.02, JSON.stringify(weights));
});

test('each school\'s best at a position are rated by their rank across the season, read off the reference', () => {
  const players = [];
  for (const school of ['a', 'b', 'c']) {
    for (let i = 0; i < 6; i++) players.push({ id: players.length, name: `${school}${i}`, school, position: 'QB', value: (school === 'a' ? 2 : 0) - i / 2, exp: 1, grade: null });
  }
  const reference = { QB: [60, 65, 70, 75, 80, 85, 90, 95, 97, 99, 62, 68].sort((a, b) => a - b) };
  const { rated, population } = rateSeason(players, reference, ratingsOf);
  assert.equal(population.QB, 3 * DEPTH.QB, 'each school\'s DEPTH best');
  const best = rated.find(p => p.rank === 1);
  assert.deepEqual([best.name, best.rating], ['a0', 99]);
  const order = rated.slice().sort((x, y) => y.value - x.value);
  for (let i = 1; i < order.length; i++) assert.ok(order[i].rating <= order[i - 1].rating, 'a higher value never rates lower');
});

// ---------- the committed snapshots ----------

const SEASONS = manifest.seasons;

test('the seasons are 2009 to 2025, their regimes as the plays name their tacklers from 2014', () => {
  assert.deepEqual(SEASONS, Array.from({ length: 17 }, (_, i) => 2009 + i));
  for (const year of SEASONS) assert.equal(snapshotOf(year).source.regime, year >= PARTICIPANTS_FROM ? 'full' : 'early');
  assert.equal(regimeOf(2013), 'early');
  assert.equal(regimeOf(2014), 'full');
});

test('the frozen weights are the calibration\'s, and order College Football 27\'s launch ratings as it records', () => {
  const calibration = JSON.parse(read('scripts/data/cfb-seasons/calibration.json'));
  assert.equal(calibration.season, 2025);
  for (const regime of ['full', 'early']) {
    for (const position of POSITIONS) {
      const row = calibration.regimes[regime][position];
      assert.deepEqual(row.weights, { ...VALUE_WEIGHTS[regime][position] }, `${regime} ${position}`);
      assert.ok(Object.keys(row.weights).every(signal => SIGNALS[regime][position].includes(signal)), `${regime} ${position}'s signals are its regime's`);
      assert.ok(Math.abs(Object.values(row.weights).reduce((t, w) => t + w, 0) - 1) < 0.005);
      assert.ok(row.heldOut > (regime === 'full' ? 0.64 : 0.62), `${regime} ${position} orders the held-out schools' players at ${row.heldOut}`);
    }
  }
  assert.ok(!SIGNALS.early.LB.some(signal => ['tacklesPG', 'sacksPG', 'pdPG', 'appearShare'].includes(signal)), 'the early seasons read no named plays');
});

test('every snapshot\'s squads are the game\'s lineup and backups of its rated players, its gaps documented', () => {
  for (const year of SEASONS) {
    const s = snapshotOf(year);
    assert.deepEqual(s.lineup.needs, FORMATION);
    for (const [school, rows] of Object.entries(s.squads)) {
      const pool = rows.map(([name, pos, , , , , , rating]) => ({ name, pos, rating }));
      assert.ok(rows.every(row => Number.isInteger(row[7]) && row[7] >= 1 && row[7] <= 99), `${year} ${school}'s ratings are 1–99`);
      assert.ok(rows.every(row => Number.isInteger(row[6]) && row[6] >= 1 && row[6] <= 99 && Number.isInteger(row[5]) && row[5] >= 1));
      const gaps = s.lineup.gaps[school] ?? {};
      assert.deepEqual(shortOf(pool), gaps, `${year} ${school}'s gaps`);
      assert.ok(Object.values(gaps).reduce((t, n) => t + n, 0) <= MAX_GAPS);
      assert.equal(squadOf(pool, `${year} ${school}`, { gaps, sport: SPORT }).squad.length, pool.length, `${year} ${school} fields its whole squad`);
      // The move never reorders a school's players at a position.
      for (const pos of POSITIONS) {
        const at = rows.filter(row => row[1] === pos).sort((a, b) => b[6] - a[6]);
        for (let i = 1; i < at.length; i++) assert.ok(at[i][7] <= at[i - 1][7], `${year} ${school} ${pos}: ${at[i][0]} passed ${at[i - 1][0]}`);
      }
    }
    for (const left of s.left.schools ?? []) assert.ok(Object.values(left.short).reduce((t, n) => t + n, 0) > MAX_GAPS, `${year}: ${left.school} is left out only when it cannot field`);
  }
});

test('every school moves toward its results: the SRS recomputed from the snapshot\'s games, each within reach of its target', () => {
  for (const year of SEASONS) {
    const s = snapshotOf(year);
    const games = s.games.map(([home, away, homeScore, awayScore, neutral]) => ({ home, away, homeScore, awayScore, neutral: !!neutral }));
    const srs = srsOf(games);
    assert.equal(Math.round(srs.reliability * 1000) / 1000, s.conversion.move.srs.reliability, `${year}'s reliability`);
    const scale = Math.sqrt(srs.reliability) / s.conversion.move.perPoint;
    for (const [school, m] of Object.entries(s.moves)) {
      assert.equal(m.srs, Math.round(srs.ratings[school] * 100) / 100, `${year} ${school}'s SRS`);
      assert.ok(Math.abs(m.target - (s.conversion.move.mean + scale * srs.ratings[school])) < 0.02, `${year} ${school}'s target`);
      assert.ok(Math.abs(m.after - m.target) <= 0.25 || m.after >= 98, `${year} ${school} lands at ${m.after} for ${m.target}`);
    }
    // After the move a school's shown strength follows its results.
    const after = Object.keys(s.moves);
    assert.ok(spearman(after.map(id => s.moves[id].after), after.map(id => s.moves[id].srs)) > 0.99, `${year}: played strength follows the SRS`);
  }
});

// Each season's national champion (the BCS's to 2013, the College Football Playoff's since).
const CHAMPIONS = { 2009: 'alabama', 2010: 'auburn', 2011: 'alabama', 2012: 'alabama', 2013: 'florida-state', 2014: 'ohio-state', 2015: 'alabama',
  2016: 'clemson', 2017: 'alabama', 2018: 'clemson', 2019: 'lsu', 2020: 'alabama', 2021: 'georgia', 2022: 'georgia', 2023: 'michigan',
  2024: 'ohio-state', 2025: 'indiana' };

test('every season\'s national champion is among its five strongest schools', () => {
  const places = [];
  for (const year of SEASONS) {
    const s = snapshotOf(year);
    const order = Object.entries(s.moves).sort((a, b) => b[1].after - a[1].after).map(([id]) => id);
    const place = order.indexOf(`cfb-${CHAMPIONS[year]}`) + 1;
    assert.ok(place >= 1 && place <= 5, `${year}: ${CHAMPIONS[year]} is ${place}th`);
    places.push(place);
  }
  assert.ok(places.filter(place => place === 1).length >= 10, `champions first in ${places.filter(place => place === 1).length} seasons`);
});

test('the snapshots rebuild byte for byte from the pinned sources (where data-src/ has them)', { skip: !existsSync(new URL('data-src/cfb-history/cfbfastR-cfb-data/player_box/player_box_2025.parquet', root)) && 'data-src/cfb-history/ is not here' }, async () => {
  const { execFileSync } = await import('node:child_process');
  for (const season of [2011, 2025]) {
    execFileSync(process.execPath, [fileURLToPath(new URL('scripts/sync-cfb-seasons.mjs', root)), `--season=${season}`, '--check'], { stdio: 'pipe', timeout: 600000 });
  }
});

// ---------- the seasons built from the snapshots ----------

const { LABEL, mapOf, schoolOf, seasonIdOf } = await import('./build-cfb-seasons.mjs');
const { BUILT_IN_COLLEGE_FOOTBALL_SEASONS } = await import('../src/data/collegeFootballSeasons.js');
const { CLUB_MAPS } = await import('../src/data/clubMaps.js');
const { contentHash } = await import('../src/data/footballSetBuild.js');
const { selectLineup } = await import('../src/data/teams.js');
const { decodeDomestic } = await import('../src/engine/domestic.js');
const { BUILT_IN_SETS, builtInSeasonOf, decodeFootballSet, seasonMapOf, seasonSport, setHasClubs, setHasNations, setSportOf, sportOf } = await import('../src/engine/footballSets.js');
const { collegeFootball } = await import('../src/sports/collegeFootball.js');
const { colourFor } = await import('./lib/nfl.mjs');
const TEAMS = JSON.parse(read('scripts/data/cfb-teams.json')).teams;
const seasonFile = id => JSON.parse(read(`public/college-football/${id}.json`));
const mapFile = id => JSON.parse(read(`public/domestic/${id}.json`));
const ERA_MAPS = CLUB_MAPS.filter(entry => entry.sport === SPORT && entry.seasons);

test('every season, its listing and audit rebuild byte for byte from the committed snapshots', async () => {
  const { execFileSync } = await import('node:child_process');
  assert.match(execFileSync(process.execPath, ['scripts/build-cfb-seasons.mjs', '--check'], { cwd: fileURLToPath(root), encoding: 'utf8' }),
    new RegExp(`Verified the ${SEASONS.length} college football seasons`));
});

test('the built-in seasons are 2025 back to 2009, newest first, each labelled computed and on its era\'s map', () => {
  assert.deepEqual(BUILT_IN_COLLEGE_FOOTBALL_SEASONS.map(set => set.id), SEASONS.slice().reverse().map(seasonIdOf));
  assert.deepEqual(builtInSeasonOf(SPORT), { year: 2026, season: '2026' }, 'the built-in season stays the current one');
  for (const listed of BUILT_IN_COLLEGE_FOOTBALL_SEASONS) {
    const set = BUILT_IN_SETS.find(entry => entry.id === listed.id);
    assert.deepEqual(set, listed, `${listed.id} is listed as built`);
    assert.equal(setSportOf(set.id), SPORT);
    assert.ok(!setHasNations(set.id) && setHasClubs(set.id), 'schools only');
    assert.equal(listed.label, LABEL);
    assert.equal(seasonMapOf(set.id), listed.map);
    assert.equal(mapOf(manifest, set.year), listed.map);
    assert.equal(seasonFile(set.id).version, listed.version);
  }
  assert.deepEqual(ERA_MAPS.map(entry => entry.id), manifest.maps.map(map => map.id));
  for (const entry of ERA_MAPS) {
    assert.equal(entry.league, 'FBS');
    assert.deepEqual([...entry.seasons].sort(), BUILT_IN_COLLEGE_FOOTBALL_SEASONS.filter(set => set.map === entry.id).map(set => set.id).sort());
    assert.ok(!('top' in entry), 'an era\'s strongest schools are its seasons\' own');
  }
});

test('every season loads and fits its era\'s map: its schools, named, coloured and in the conference of that season', () => {
  for (const listed of BUILT_IN_COLLEGE_FOOTBALL_SEASONS) {
    const doc = seasonFile(listed.id), snapshot = snapshotOf(listed.year);
    const set = decodeFootballSet(structuredClone(doc), listed.id);
    assert.equal(doc.version, `${listed.id}-${contentHash(doc)}`, `${listed.id} is the builder's file`);
    assert.deepEqual([doc.kind, doc.source.method, doc.source.rawScale, doc.source.conversion], ['cfb', 'computed', 'value', snapshot.conversion.overall]);
    assert.deepEqual([set.meta.year, set.meta.season, set.meta.label, set.meta.map], [listed.year, listed.season, listed.label, listed.map]);
    const map = decodeDomestic(mapFile(listed.map), listed.map);
    assert.equal(map.meta.version, CLUB_MAPS.find(item => item.id === listed.map).version);
    assert.deepEqual(map.clubs.map(club => club.id).sort(), doc.clubs.map(club => club.id).sort(), `${listed.id}'s schools are its map's`);
    assert.deepEqual(doc.clubs.map(club => club.id).sort(), Object.keys(snapshot.squads).sort());
    for (const club of doc.clubs) {
      const school = schoolOf(club.id, TEAMS, manifest);
      assert.deepEqual([club.name, club.code, club.league, club.country, club.col], [school.name, school.code, snapshot.schools[club.id].conference, '840', colourFor(club.id)]);
      assert.deepEqual(club.squad, snapshot.squads[club.id].map(([name, pos, , , , , , rating]) => [name, pos, rating]), `${listed.id} ${club.name}'s squad is its snapshot's`);
      assert.equal(club.str, selectLineup({ sport: SPORT, squad: club.squad.map(([name, pos, rating]) => ({ name, pos, rating })) }).rating);
      assert.equal(map.clubs.find(row => row.id === club.id).name, club.name, 'an era map names its season\'s schools');
    }
  }
  const conferences = new Set(BUILT_IN_COLLEGE_FOOTBALL_SEASONS.flatMap(listed => seasonFile(listed.id).clubs.map(club => club.league)));
  for (const old of ['Pac-10', 'Big East', 'WAC']) assert.ok(conferences.has(old), `the ${old} plays in its seasons`);
  for (const year of [2009, 2013, 2016, 2017]) {
    assert.ok(!seasonFile(`cfb-${year}`).clubs.some(club => club.id === 'cfb-idaho'), `Idaho, FBS to 2017, does not play ${year}: its rosters list no linemen`);
    assert.ok(snapshotOf(year).left.schools.some(left => left.school === 'cfb-idaho' && left.short.OL >= 4), `${year}'s snapshot says why`);
  }
  assert.ok(!seasonFile('cfb-2020').clubs.some(club => club.id === 'cfb-new-mexico-state'), 'New Mexico State played no FBS school in 2020');
});

test('the loader refuses an FBS season that is not the builder\'s', () => {
  const doc = seasonFile('cfb-2011');
  const broken = edit => { const copy = structuredClone(doc); edit(copy); return () => decodeFootballSet(copy, 'cfb-2011'); };
  assert.throws(broken(d => { d.map = 'cfb'; }), /clubs must be the 138 of map cfb, found \d+/, 'today\'s map serves today\'s schools only');
  assert.throws(broken(d => { d.map = BUILT_IN_COLLEGE_FOOTBALL_SEASONS.find(set => set.id === 'cfb-2022').map; }), /is not one of College football's maps listing this season/);
  assert.throws(broken(d => { d.map = 'nfl2001'; }), /is not one of College football's maps/);
  assert.throws(broken(d => { d.season = '2010/11'; }), /season "2010\/11" must be "2011"/);
  assert.throws(broken(d => { d.nations = {}; }), /clubs only/);
  assert.throws(broken(d => { d.clubs.pop(); }), /clubs must be the \d+ of map/);
  assert.throws(broken(d => { d.clubs[0].id = 'nfl-dallas-cowboys'; }), /must look like the built-in clubs'/);
  assert.throws(broken(d => { d.clubs[0].league = 'Southwest Conference'; }), /not a built-in league/);
  assert.throws(broken(d => { d.clubs[0].squad[0][1] = 'SS'; }), /is not one of the sport's/);
  assert.throws(broken(d => { d.clubs[0].squad.length = 22; }), /squad needs at least 23 players/);
  assert.throws(broken(d => { delete d.source.conversion; }), /conversion must say how the overalls were derived/);
  assert.throws(broken(d => { d.source.method = 'converted'; }), /method must be "computed"/);
  assert.throws(broken(d => { d.kind = 'pfa'; }), /kind "pfa" is not the kind its id names/);
  assert.doesNotThrow(broken(() => {}));
});

test('a season binds college football to its schools and its era\'s map', () => {
  const id = 'cfb-2013';
  const set = decodeFootballSet(seasonFile(id), id);
  const sport = seasonSport(set);
  const listed = BUILT_IN_COLLEGE_FOOTBALL_SEASONS.find(entry => entry.id === id);
  assert.deepEqual([sport.id, sport.dataSet, sport.dataYear, sport.dataSeason, sport.dataLabel, sport.clubMap, sport.clubNoun],
    [SPORT, id, 2013, '2013', LABEL, listed.map, 'schools']);
  assert.equal(sport.clubs, set.clubs);
  assert.equal(set.rosters, null, 'no national teams');
  assert.equal(sportOf({ sport: SPORT, layer: 'clubs', dataSet: 'cfb-2012' }), null, 'until it has loaded');
  assert.equal(sportOf({ sport: 'american-football', layer: 'clubs', dataSet: 'cfb-2012' }).id, 'american-football', 'a season plays only in its sport');
  assert.equal(collegeFootball.formation.QB, 1);
});

// ---------- the running App ----------

const { SAVE_KEY } = await import('../src/config.js');
const { parseCampaign } = await import('../src/engine/storage.js');
const { buildSetupModel } = await import('../src/screens/setup/setupModel.js');
const { bundleComponents, syncAppFixture } = await import('./lib/app-harness.mjs');
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
    const [, folder, id] = String(url).match(/^\/(domestic|college-football)\/([0-9A-Za-z-]+)\.json$/) || [];
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
async function chooseSeason(app, time, id) {
  app.pickSetup('dataSet', id);
  time.advance(200);
  await Promise.all([app.loadCountry(seasonMapOf(id)), app.loadSet(id)]);
  await settle();
  assert.equal(app.seasonStatus().state, 'ready');
  assert.equal(app.domesticStatus().state, 'ready');
}
const modelOf = app => buildSetupModel(app.state.setup, { managerTeams: app.setupTeams(), domestic: app.domesticStatus(), season: app.seasonStatus() });

test('college football\'s Season choice lists its seasons, each "computed"; one takes the schools onto its era\'s map', async () => {
  await withApp(async ({ app }) => {
    app.pickSetup('sport', SPORT);
    const model = modelOf(app);
    assert.deepEqual(model.season.options.map(option => option.label), ['2026 · built in', ...BUILT_IN_COLLEGE_FOOTBALL_SEASONS.map(set => `${set.season} · ${LABEL}`)]);
    assert.deepEqual(model.season.options.map(option => option.name), ['2026', ...BUILT_IN_COLLEGE_FOOTBALL_SEASONS.map(set => `${set.season} · computed`)]);
    const listed = BUILT_IN_COLLEGE_FOOTBALL_SEASONS.find(set => set.id === 'cfb-2010');
    app.pickSetup('dataSet', 'cfb-2010');
    assert.deepEqual([app.state.setup.layer, app.state.setup.dataSet, app.state.setup.clubScope], ['clubs', 'cfb-2010', `domestic:${listed.map}`]);
    assert.equal(modelOf(app).canLaunch, false, 'Launch waits for the season and its map');
    app.pickSetup('dataSet', null);
    assert.equal(app.state.setup.clubScope, 'domestic:cfb', 'the built-in season plays on today\'s map');
    app.pickSetup('dataSet', 'cfb-2012');
    app.pickSetup('sport', 'american-football');
    assert.equal(app.state.setup.dataSet, null, 'a season stays with its sport');
  });
});

test('a computed FBS season launches its schools on their era\'s map, saves, and resumes as played', async () => {
  for (const id of ['cfb-2010', 'cfb-2021']) {
    await withApp(async ({ app, time, items, calls }) => {
      app.pickSetup('sport', SPORT);
      await chooseSeason(app, time, id);
      const doc = seasonFile(id), listed = BUILT_IN_COLLEGE_FOOTBALL_SEASONS.find(set => set.id === id);
      assert.deepEqual(modelOf(app).scopes.map(row => [row.id, row.count]), [[`domestic:${listed.map}`, doc.clubs.length]]);
      app.startCampaign();
      const st = app.state;
      assert.equal(st.phase, 'playing');
      assert.deepEqual([st.settings.sport, st.settings.layer, st.settings.dataSet, st.settings.dataVersion, st.settings.dataYear, st.settings.dataSeason,
        st.settings.clubScope], [SPORT, 'clubs', id, doc.version, doc.year, doc.season, `domestic:${listed.map}`]);
      assert.equal(st.settings.domesticVersion, CLUB_MAPS.find(entry => entry.id === listed.map).version);
      assert.deepEqual(Object.keys(st.teams).sort(), doc.clubs.map(club => club.id).sort());
      for (const club of doc.clubs) {
        const team = st.teams[club.id];
        assert.deepEqual([team.name, team.code, team.str], [club.name, club.code, club.str]);
        assert.deepEqual(team.squad.map(p => [p.name, p.pos, p.rating]), club.squad, `${club.name}'s ${doc.season} squad`);
        assert.equal(st.own[team.home], team.id);
      }
      assert.ok(calls.includes(`/college-football/${id}.json`) && calls.includes(`/domestic/${listed.map}.json`));
      const text = items.get(SAVE_KEY);
      const saved = parseCampaign(text);
      assert.equal(JSON.stringify(saved.teams), JSON.stringify(st.teams), 'saved as played');
      B.clearFootballSetCache();
      app.continueSaved(saved);
      assert.equal(app.state.phase, 'playing');
      assert.equal(JSON.stringify(app.state.teams), JSON.stringify(st.teams), 'resumed as played');
      assert.deepEqual(app.state.own, st.own);
      // A season belongs on its own map.
      const edited = edit => { const data = JSON.parse(text); edit(data.settings); if (data.initialSettings) edit(data.initialSettings); return JSON.stringify(data); };
      const today = CLUB_MAPS.find(entry => entry.id === 'cfb').version;
      assert.throws(() => parseCampaign(edited(s => { s.clubScope = 'domestic:cfb'; s.domesticVersion = today; })), /Campaign data set is invalid/);
    });
  }
});
