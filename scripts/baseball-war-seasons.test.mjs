// The baseball seasons no game rated, 1960 to 2017, computed from the players' WAR (docs/design/baseball.md, "Seasons
// before 2018: computed from WAR"): their snapshots and calibration, the ratings rank for rank on MLB The Show's scale,
// the clubs and nations of each season, the franchise eras and their maps (a ballpark renamed in place keeps its map;
// the Angels of 1962-65 and the Yankees of 1974-75, tenants of another club's ballpark, grow from their own), each club's
// move toward its real record, the loader and the App, which plays a 1961 season with its clubs on the map of 1961.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SAVE_KEY } from '../src/config.js';
import { BUILT_IN_BASEBALL_SEASONS } from '../src/data/baseballSeasons.js';
import { CLUB_MAPS } from '../src/data/clubMaps.js';
import { nationTheatres } from '../src/data/scopes.js';
import { buildClub, hashStr, makeRng, selectLineup } from '../src/data/teams.js';
import { decodeDomestic } from '../src/engine/domestic.js';
import {
  BUILT_IN_SETS, decodeFootballSet, fieldedNations, seasonLabelOf, seasonMapOf, seasonSport, setHasClubs, setHasNations, setIsMapped, setKindOf,
  setSportOf,
} from '../src/engine/footballSets.js';
import { parseCampaign } from '../src/engine/storage.js';
import { buildSetupModel } from '../src/screens/setup/setupModel.js';
import { readChallenge } from '../src/screens/setup/challenge.js';
import { kmToPolys, pointInPolys } from './lib/domestic-partition.mjs';
import { baseball, baseballOfSeason, seasonPremium } from '../src/sports/baseball.js';
import { nationOfBirthCountry, rateByRank, resultsMove, teamsOfWar, warScoreOf, warSeasonIdOf } from './lib/mlb-war.mjs';
import { bundleComponents, syncAppFixture } from './lib/app-harness.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const MANIFEST = JSON.parse(read('scripts/data/mlb-war-seasons.json'));
const REFERENCE = JSON.parse(read('scripts/data/mlb-war-reference.json'));
const FRANCHISES = JSON.parse(read('scripts/data/mlb-teams.json')).teams;
const AUDIT = JSON.parse(read('docs/design/baseball-war-seasons-audit.json'));
const YEARS = Array.from({ length: 58 }, (_, i) => 1960 + i);
const snapshotOf = year => JSON.parse(read(`scripts/data/mlb-war-seasons/${year}.json`));
const seasonFile = year => JSON.parse(read(`public/baseball/${warSeasonIdOf(year)}.json`));
const mapFile = id => JSON.parse(read(`public/domestic/${id}.json`));
const WAR_SEASONS = BUILT_IN_BASEBALL_SEASONS.filter(set => /^mlb-war-/.test(set.id));
const sectionAt = (map, point) => map.geo.countries.find(section => pointInPolys(point, section.polys))?.id ?? null;
const home = (map, id) => map.clubs.find(club => club.id === id).homeSection;
const clubOf = (year, code) => seasonFile(year).clubs.find(club => club.code === code);
const rows = year => snapshotOf(year).players.map(([id, name, alias, club, role, positions, score, war, use, li, born]) => ({ id, name, alias, club, role, positions, score, war, use, li, born }));
const pearson = (xs, ys) => {
  const mean = list => list.reduce((s, v) => s + v, 0) / list.length;
  const mx = mean(xs), my = mean(ys);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < xs.length; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
  return sxy / Math.sqrt(sxx * syy);
};

// ---------- building ----------

const cached = [MANIFEST.sources.war.cache, MANIFEST.sources.databank.cache].every(dir => existsSync(new URL(`../${dir}`, import.meta.url)));
test('the snapshots and the reference rebuild byte for byte from the pinned WAR and Baseball Databank files', { skip: !cached && 'the WAR and Databank caches (data-src/mlb-war/) are not on this computer' }, () => {
  assert.match(execFileSync(process.execPath, ['scripts/import-mlb-war.mjs', '--check'], { cwd: root, encoding: 'utf8' }),
    /Verified the 58 snapshots and the reference byte for byte/);
});

test('every snapshot holds its season\'s players, each score its inputs\' by the manifest\'s rule', () => {
  for (const year of YEARS) {
    const snapshot = snapshotOf(year);
    assert.equal(snapshot.season, year);
    assert.equal(Object.keys(snapshot.teams).length, snapshot.clubs);
    for (const row of rows(year)) {
      assert.equal(warScoreOf(row, MANIFEST.method), row.score, `${year} ${row.name}`);
      assert.ok(['H', 'SP', 'RP'].includes(row.role));
      assert.ok(snapshot.teams[row.club], `${year} ${row.name} plays for a club of the season`);
    }
  }
  // 16 clubs in 1960, 18 in 1961, 20 from 1962, 24 from 1969, 26 from 1977, 28 from 1993 and 30 from 1998.
  assert.deepEqual([1960, 1961, 1962, 1969, 1977, 1993, 1998, 2017].map(year => snapshotOf(year).clubs), [16, 18, 20, 24, 26, 28, 30, 30]);
  const mantle = rows(1961).find(row => row.id === 'mantlmi01');
  assert.deepEqual([mantle.name, mantle.club, mantle.role, mantle.positions, mantle.born], ['Mickey Mantle', 'NYY', 'H', 'CF', 'USA']);
});

test('the reference is MLB The Show 18 to 24\'s 9,674 matched cards, and leaving a season out costs about 4.4 points a player', () => {
  assert.deepEqual(REFERENCE.years, [2018, 2019, 2020, 2021, 2022, 2023, 2024]);
  assert.equal(REFERENCE.teamSeasons, 210);
  assert.deepEqual(Object.values(REFERENCE.cards), [1333, 1332, 1224, 1447, 1465, 1440, 1433]);
  assert.deepEqual(['H', 'SP', 'RP'].map(role => REFERENCE.reference[role].length), [4375, 1798, 3501]);
  for (const role of ['H', 'SP', 'RP']) {
    const ref = REFERENCE.reference[role];
    assert.ok(ref.every((v, i) => Number.isInteger(v) && (!i || v <= ref[i - 1])), `${role} runs strongest first`);
  }
  const { players, roles, clubs, seasons } = REFERENCE.leaveOneOut;
  assert.ok(players.mae <= 4.5, `players MAE ${players.mae}`);
  assert.ok(clubs.pearson >= 0.88, `clubs r ${clubs.pearson}`);
  assert.ok(roles.H.spearman >= 0.84 && roles.SP.spearman >= 0.8 && roles.RP.spearman >= 0.7);
  // The real records are the Baseball Databank's, whose seasons end with 2022.
  assert.deepEqual(seasons.map(season => [season.year, season.winShare === null]),
    [[2018, false], [2019, false], [2020, false], [2021, false], [2022, false], [2023, true], [2024, true]]);
});

test('ratings keep each role\'s order: nobody passes anybody, and equal scores rate alike', () => {
  for (const year of [1960, 1975, 1994, 2017]) {
    const list = rows(year);
    const ratings = rateByRank(list, REFERENCE.reference, snapshotOf(year).clubs, REFERENCE.teamSeasons);
    for (const role of ['H', 'SP', 'RP']) {
      const sorted = list.filter(row => row.role === role).sort((a, b) => b.score - a.score);
      sorted.forEach((row, i) => {
        if (!i) return;
        assert.ok(ratings.get(row.id) <= ratings.get(sorted[i - 1].id), `${year} ${role} ${row.name}`);
        if (row.score === sorted[i - 1].score) assert.equal(ratings.get(row.id), ratings.get(sorted[i - 1].id));
      });
    }
    // Each season's best hitter takes the reference's value at its depth: 98 at the top of a 30-club season.
    assert.ok(Math.max(...list.map(row => ratings.get(row.id))) <= 98);
  }
});

// ---------- the seasons ----------

test('the computed seasons are listed after MLB The Show\'s, newest first, from 2017 back to 1960, each on its era\'s map', () => {
  assert.deepEqual(WAR_SEASONS.map(set => set.year), [...YEARS].reverse());
  assert.deepEqual(BUILT_IN_BASEBALL_SEASONS.slice(0, 8).map(set => set.id.startsWith('mlb-the-show-')), Array(8).fill(true));
  for (const listed of WAR_SEASONS) {
    assert.deepEqual([listed.season, listed.label], [String(listed.year), `Computed from WAR, end of ${listed.year}`]);
    assert.equal(listed.map, MANIFEST.maps.find(map => map.seasons.includes(listed.year)).id);
    assert.deepEqual(BUILT_IN_SETS.find(set => set.id === listed.id), listed);
    assert.equal(seasonMapOf(listed.id), listed.map);
  }
  assert.equal(setKindOf('mlb-war-1961'), 'show');
  assert.deepEqual([setSportOf('mlb-war-1961'), setHasNations('mlb-war-1961'), setHasClubs('mlb-war-1961'), setIsMapped('mlb-war-1961'), seasonLabelOf('mlb-war-1961', 1961)],
    ['baseball', true, true, true, '1961']);
});

test('every computed season loads, says it is computed and fits its era\'s map: its clubs, each fielding its lineup naturally', () => {
  for (const listed of WAR_SEASONS) {
    const doc = seasonFile(listed.year);
    const set = decodeFootballSet(doc, listed.id);
    assert.deepEqual([set.meta.year, set.meta.season, set.meta.map, set.meta.version], [listed.year, listed.season, listed.map, listed.version]);
    assert.equal(doc.source.computed, true);
    assert.equal(doc.source.rawScale, 'WAR');
    assert.match(doc.source.conversion, /rank for rank/i);
    assert.equal(doc.source.url, MANIFEST.sources.war.url);
    const map = decodeDomestic(mapFile(listed.map), listed.map);
    assert.deepEqual(map.clubs.map(club => club.id).sort(), doc.clubs.map(club => club.id).sort(), `${listed.id}'s clubs are its map's`);
    const teams = teamsOfWar(FRANCHISES, MANIFEST, listed.year);
    for (const club of doc.clubs) {
      const team = teams.find(t => t.id === club.id);
      assert.deepEqual([club.name, club.code, club.league], [team.name, team.code, 'MLB']);
      const squad = club.squad.map(([name, positions, rating]) => {
        const [pos, ...others] = positions.split('/');
        return { name, pos, positions: [pos, ...others], rating };
      });
      const lineup = selectLineup({ sport: 'baseball', squad });
      assert.ok(lineup.slots.every(slot => slot.player && !slot.outOfPosition), `${listed.year} ${club.name} fields every position`);
      assert.equal(lineup.rating, club.str);
      // An active roster of 26; a club that used fewer than thirteen pitchers all season keeps every one beside 13 hitters.
      const pitchers = squad.filter(p => p.pos === 'SP' || p.pos === 'RP').length;
      const used = rows(listed.year).filter(row => row.club === team.war && row.role !== 'H').length;
      if (squad.length !== 26) assert.deepEqual([squad.length - pitchers, pitchers], [13, used], `${listed.year} ${club.name}`);
      assert.ok(squad.every(p => Number.isInteger(p.rating) && p.rating >= 1 && p.rating <= 99));
    }
    assert.deepEqual(doc.territory, { merged: { SCO: '826', WAL: '826', NIR: '826' }, inactive: [] });
  }
});

test('the computed seasons look like their years: Mantle and Mays in 1961, the Orioles of 1969, the Big Red Machine', () => {
  const rating = (year, name) => seasonFile(year).clubs.flatMap(club => club.squad).find(([player]) => player === name)?.[2];
  assert.ok(rating(1961, 'Mickey Mantle') >= 93 && rating(1961, 'Willie Mays') >= 93);
  assert.equal(seasonFile(1961).clubs[0].name, 'New York Yankees');
  assert.equal(seasonFile(1969).clubs[0].name, 'Baltimore Orioles');
  assert.equal(seasonFile(1975).clubs[0].name, 'Cincinnati Reds');
  assert.equal(seasonFile(1998).clubs[0].name, 'New York Yankees');
  // Club strength follows the real records: r 0.94 on average over the 58 seasons once each club has moved toward its
  // record (0.82 from the players alone), 0.89 at the least (2014).
  const rs = YEARS.map(year => {
    const { teams } = snapshotOf(year);
    const clubs = teamsOfWar(FRANCHISES, MANIFEST, year);
    const doc = seasonFile(year);
    return pearson(clubs.map(t => doc.clubs.find(c => c.id === t.id).str), clubs.map(t => teams[t.war].w / (teams[t.war].w + teams[t.war].l)));
  });
  assert.ok(rs.reduce((s, r) => s + r, 0) / rs.length >= 0.92 && Math.min(...rs) >= 0.85, `r ${rs}`);
  assert.deepEqual(AUDIT.seasons.map(season => season.id), [...YEARS].reverse().map(warSeasonIdOf));
});

// ---------- each club's move toward its record ----------

test('each club moves toward its record: every player by one whole number, the lineup\'s best few by one more, nobody passing a teammate', () => {
  for (const year of [1961, 1984, 1991, 2004, 2017]) {
    const list = rows(year);
    const unmoved = rateByRank(list, REFERENCE.reference, snapshotOf(year).clubs, REFERENCE.teamSeasons);
    const audit = AUDIT.seasons.find(season => season.id === warSeasonIdOf(year));
    const doc = seasonFile(year);
    const teams = teamsOfWar(FRANCHISES, MANIFEST, year);
    for (const club of doc.clubs) {
      const war = teams.find(team => team.id === club.id).war;
      // The squad's players by the name the season gives them (a namesake's alias where it has one).
      const own = list.filter(row => row.club === war);
      const squad = club.squad.map(([name, , rating]) => {
        const row = own.find(r => r.alias === name) ?? own.find(r => r.name === name);
        return { name, before: unmoved.get(row.id), after: rating };
      });
      const deltas = squad.filter(p => p.after > 1 && p.after < 99).map(p => p.after - p.before);
      const shift = Math.min(...deltas);
      assert.ok(deltas.every(d => d === shift || d === shift + 1), `${year} ${club.name}: moves ${[...new Set(deltas)]}`);
      const line = audit.moves.find(move => move.startsWith(`${club.name} `));
      assert.match(line, new RegExp(`; ${shift > 0 ? `\\+${shift}` : shift < 0 ? `−${-shift}` : '±0'} each`), line);
      for (const a of squad) for (const b of squad) {
        if (a.before > b.before) assert.ok(a.after >= b.after, `${year} ${club.name}: ${b.name} passes ${a.name}`);
      }
    }
    // The strength the match model plays follows the record exactly; the conversion says how, with the season's constants.
    assert.ok(audit.playedVsRecord >= 0.999 && audit.strengthVsRecord > audit.strengthVsRecordBefore, `${year}`);
    assert.match(doc.source.conversion, /Then each club moves toward its real won-lost record/);
    assert.ok(doc.source.conversion.includes(`r ${audit.results.reliability.toFixed(3)},`) && doc.source.conversion.includes(`m ${audit.results.perPoint.toFixed(4)},`),
      `${year}: the conversion states the move's constants`);
    assert.ok(audit.results.perPoint > 0.022 && audit.results.perPoint < 0.027, `${year}: m ${audit.results.perPoint}`);
  }
  // Moves of −5 to +4 points a player, most within two.
  const shifts = AUDIT.seasons.flatMap(season => season.moves.map(move => /; ([+−±])(\d+) each/.exec(move)).map(([, sign, n]) => (sign === '−' ? -1 : 1) * Number(n)));
  assert.equal(shifts.length, 1522);
  assert.ok(Math.min(...shifts) >= -5 && Math.max(...shifts) <= 4 && shifts.filter(s => Math.abs(s) <= 2).length > 0.9 * shifts.length);
});

test('a club\'s target is μ + √r × (W% − ½) × (n − 1)/n ÷ m, and the extra point goes to the lineup before the bench', () => {
  // Two leagues: a club's share counts against the others of its own league, never itself.
  const player = (id, rating) => ({ id, rating });
  const clubs = [
    { id: 'a', league: 'AL', w: 60, l: 40, pool: [player('a1', 70), player('a2', 70), player('a3', 90)] },
    { id: 'b', league: 'AL', w: 50, l: 50, pool: [player('b1', 70), player('b2', 70), player('b3', 70)] },
    { id: 'c', league: 'AL', w: 40, l: 60, pool: [player('c1', 70), player('c2', 70), player('c3', 70)] },
    { id: 'd', league: 'NL', w: 55, l: 45, pool: [player('d1', 70), player('d2', 70), player('d3', 70)] },
    { id: 'e', league: 'NL', w: 45, l: 55, pool: [player('e1', 70), player('e2', 70), player('e3', 70)] },
  ];
  // The first two of each pool play; the third, however good, sits on the bench.
  const lineupOf = pool => new Set(pool.filter(p => /[12]$/.test(p.id)).map(p => p.id));
  const strengthOf = pool => (pool.find(p => /1$/.test(p.id)).rating + pool.find(p => /2$/.test(p.id)).rating) / 2;
  const order = (x, y) => y.rating - x.rating || (x.id < y.id ? -1 : 1);
  const perPoint = 0.025;
  const { level, reliability, moves } = resultsMove(clubs, { perPoint, strengthOf, order, lineupOf });
  assert.equal(level, 70);
  const shares = [0.6, 0.5, 0.4, 0.55, 0.45];
  const luck = shares.reduce((s, p) => s + p * (1 - p) / 100, 0) / 5, mean = 0.5;
  const spread = shares.reduce((s, p) => s + (p - mean) ** 2, 0) / 5;
  assert.ok(Math.abs(reliability - (1 - luck / spread)) < 1e-12);
  const target = (share, n) => 70 + Math.sqrt(reliability) * (share - 0.5) * (n - 1) / n / perPoint;
  [target(0.6, 3), target(0.5, 3), target(0.4, 3), target(0.55, 2), target(0.45, 2)].forEach((t, i) => assert.ok(Math.abs(moves[i].target - t) < 1e-9));
  // Club a (target 70 + √r × 2.67) moves its lineup; its bench player gets the shift alone, never the extra point first.
  const a = moves[0];
  assert.ok(Math.abs(a.after - a.target) <= 0.5);
  const rated = Object.fromEntries(a.pool.map(p => [p.id, p.rating]));
  assert.equal(rated.a3, 90 + a.shift);
  assert.ok([rated.a1, rated.a2].every(r => r === 70 + a.shift || r === 71 + a.shift));
});

test('played as their leagues played, the moved seasons\' standings spread as the real ones did', () => {
  // Each club against its own league only, as many games as it played, 40 seasons of each: the win% spread a season
  // against the real one (the Databank's records).
  const sims = [], reals = [];
  for (const year of YEARS) {
    const doc = seasonFile(year), snapshot = snapshotOf(year), teams = teamsOfWar(FRANCHISES, MANIFEST, year);
    const clubs = doc.clubs.map(club => buildClub(club, baseball));
    const sport = baseballOfSeason(year, seasonPremium(clubs));
    const leagueOf = clubs.map(club => snapshot.teams[teams.find(team => team.id === club.id).war].league);
    const records = Object.values(snapshot.teams);
    const games = Math.round(records.reduce((s, t) => s + t.w + t.l, 0) / records.length);
    const rng = makeRng(hashStr(`leagues ${year}`));
    const prepared = new Map();
    let spread = 0;
    for (let season = 0; season < 40; season++) {
      const wins = clubs.map(() => 0), played = clubs.map(() => 0);
      for (const league of ['AL', 'NL']) {
        const at = clubs.map((club, i) => i).filter(i => leagueOf[i] === league);
        for (let g = 0; g < games * at.length / 2; g++) {
          // A random pairing of the league each game: every club plays about as many as it really did.
          const i = at[Math.floor(rng() * at.length)];
          let j = at[Math.floor(rng() * (at.length - 1))];
          if (j === i) j = at[at.length - 1];
          const key = `${i}:${j}`;
          if (!prepared.has(key)) prepared.set(key, sport.prepareMatch(clubs[i], clubs[j]));
          const { winner } = sport.sampleResult(rng, prepared.get(key), 6);
          wins[winner === clubs[i].id ? i : j]++;
          played[i]++; played[j]++;
        }
      }
      const shares = wins.map((w, i) => w / played[i]);
      const m = shares.reduce((s, x) => s + x, 0) / shares.length;
      spread += Math.sqrt(shares.reduce((s, x) => s + (x - m) ** 2, 0) / shares.length) / 40;
    }
    const real = records.map(t => t.w / (t.w + t.l)), mr = real.reduce((s, x) => s + x, 0) / real.length;
    sims.push(spread);
    reals.push(Math.sqrt(real.reduce((s, x) => s + (x - mr) ** 2, 0) / real.length));
  }
  const gap = sims.reduce((s, x, i) => s + Math.abs(x - reals[i]), 0) / sims.length;
  assert.ok(gap < 0.003, `the spreads are ${gap.toFixed(4)} from the real ones on average`);
  assert.ok(pearson(sims, reals) > 0.95, `r ${pearson(sims, reals)}`);
});

test('nations by birthplace: four in 1960, the Databank\'s countries placed, one corrected, nobody without a birthplace', () => {
  const fielded = year => {
    const set = decodeFootballSet(seasonFile(year), warSeasonIdOf(year));
    return fieldedNations(seasonSport(set));
  };
  assert.deepEqual(fielded(1960).slice().sort(), ['192', '214', '630', '840']);
  for (const year of YEARS) {
    const count = fielded(year).length;
    assert.ok(count >= 4 && count <= 10, `${year}: ${count} nations field a team`);
  }
  // North and Central America needs four of its nations' real sides: every season has them but 1985–87 and 1989–90,
  // whose fourth is Venezuela, South America's. Those seasons' nations play the world.
  const offersNca = year => nationTheatres(seasonSport(decodeFootballSet(seasonFile(year), warSeasonIdOf(year)))).some(scope => scope.id === 'CONCACAF');
  assert.deepEqual(YEARS.filter(year => !offersNca(year)), [1985, 1986, 1987, 1989, 1990]);
  // The Baseball Databank's birth countries: its own spellings (V.I., Curacao), today's countries for those of their day,
  // the home nations as the United Kingdom, and Hong Kong (Austin Brice) as China, as MLB The Show files him.
  const { nations } = MANIFEST;
  assert.deepEqual(['Germany', 'United Kingdom', 'Russia', 'Slovakia', 'Viet Nam', 'Belize', 'Curacao', 'V.I.', 'Hong Kong', 'Panama']
    .map(country => nationOfBirthCountry(country, nations)), ['276', '826', '643', '703', '704', '084', '528', '840', '156', '591']);
  assert.equal(nationOfBirthCountry('', nations), null);
  assert.equal(nationOfBirthCountry('Singapore', nations), null);
  assert.throws(() => nationOfBirthCountry('Atlantis', nations), /No nation for the birth country/);
  assert.throws(() => nationOfBirthCountry('Czech Republic', nations), /No nation for the birth country/);
  // The one birth country the Databank gets wrong: Elmer Valo, born in Rybník, Levice District (Slovakia), whom it files
  // under the Czech Republic. The correction names its pinned Wikipedia article, and the snapshots hold it.
  assert.deepEqual(Object.keys(MANIFEST.birthCountries), ['valoel01']);
  const valo = MANIFEST.birthCountries.valoel01;
  assert.deepEqual([valo.databank, valo.country], ['Czech Republic', 'Slovakia']);
  assert.ok(MANIFEST.sources.wikipedia.articles[valo.article], 'the correction\'s article is pinned');
  assert.deepEqual([1960, 1961].map(year => rows(year).find(row => row.id === 'valoel01').born), ['Slovakia', 'Slovakia']);
  // Rod Carew, born in Gatun in the Panama Canal Zone, is Panama's, as the Databank files him: in 1978, with Mike Eden
  // (Fort Clayton), Panama fields a team.
  assert.deepEqual([1967, 1985].map(year => rows(year).find(row => row.id === 'carewro01').born), ['Panama', 'Panama']);
  assert.ok(seasonFile(1977).nations['591'][2].some(([name]) => name === 'Rod Carew'));
  assert.ok(fielded(1978).includes('591'));
  // Bob Johnson of the 1969 Mets (johnsbo03, born in Aurora, Illinois) is American. Every player of the 58 seasons has a
  // birthplace, and only Robin Jennings, born in Singapore, has none of the game's nations.
  assert.equal(rows(1969).find(row => row.id === 'johnsbo03').born, 'USA');
  assert.ok(seasonFile(1969).clubs.find(club => club.code === 'NYM').squad.some(([name]) => name === 'Bob Johnson'));
  assert.ok(YEARS.every(year => rows(year).every(row => row.born !== '')), 'every player has a birthplace');
  assert.deepEqual([...new Set(AUDIT.seasons.flatMap(season => season.noNation))], ['Robin Jennings (jenniro01): born in Singapore, no nation of the game']);
  // His namesake of the same seasons, Bob W. Johnson, is told apart by the middle initials the Databank's given names hold.
  assert.deepEqual(rows(1970).filter(row => row.name === 'Bob Johnson').map(row => row.alias).sort(), ['Bob D. Johnson', 'Bob W. Johnson']);
  // Victor Cole, born in Leningrad (the Databank's St. Petersburg, Russia), plays for Russia in 1992.
  assert.ok(seasonFile(1992).nations['643']?.[2].some(([name]) => name === 'Victor Cole'));
});

test('namesakes who share a squad are told apart, the best keeping the name', () => {
  const renamed = AUDIT.seasons.flatMap(season => season.renamed.map(line => `${season.id}: ${line}`));
  assert.deepEqual(renamed, ['mlb-war-1995: Pedro Martinez (martipe03) → Pedro Martinez (1968)', 'mlb-war-1994: Pedro Martinez (martipe03) → Pedro Martinez (1968)',
    'mlb-war-1993: Pedro Martinez (martipe03) → Pedro Martinez (1968)']);
  const dominicans = seasonFile(1994).nations['214'][2].map(([name]) => name);
  assert.ok(dominicans.includes('Pedro Martinez') && dominicans.includes('Pedro Martinez (1968)'));
  // The Databank's names, with the WAR file's generational suffixes and initials written as MLB The Show writes them.
  const names = seasonFile(1990).clubs.find(club => club.code === 'SEA').squad.map(([name]) => name);
  assert.ok(names.includes('Ken Griffey Jr.') && names.includes('Ken Griffey'), 'the Griffeys of the 1990 Mariners');
  assert.ok(seasonFile(1965).clubs.flatMap(club => club.squad).some(([name]) => name === 'Hank Aaron'), 'the Databank\'s Hank, not the WAR file\'s Henry');
});

// ---------- the clubs of their day and their maps ----------

test('the clubs of their day: the Senators, the Milwaukee and Kansas City clubs, the Pilots, the Expos and the Angels\' names', () => {
  const ids = year => seasonFile(year).clubs.map(club => club.id).sort();
  assert.ok(['mlb-washington-senators-1901', 'mlb-milwaukee-braves', 'mlb-kansas-city-athletics'].every(id => ids(1960).includes(id)));
  assert.ok(['mlb-washington-senators-1961', 'mlb-los-angeles-angels', 'mlb-minnesota-twins'].every(id => ids(1961).includes(id)));
  assert.ok(['mlb-seattle-pilots', 'mlb-montreal-expos', 'mlb-kansas-city-royals', 'mlb-san-diego-padres'].every(id => ids(1969).includes(id)));
  assert.ok(ids(1970).includes('mlb-milwaukee-brewers') && !ids(1970).includes('mlb-seattle-pilots'));
  assert.deepEqual([1964, 1965, 1997, 2005, 2016].map(year => clubOf(year, { 1964: 'LAA', 1965: 'CAL', 1997: 'ANA', 2005: 'LAA', 2016: 'LAA' }[year]).name),
    ['Los Angeles Angels', 'California Angels', 'Anaheim Angels', 'Los Angeles Angels of Anaheim', 'Los Angeles Angels']);
  assert.equal(clubOf(1962, 'HOU').name, "Houston Colt .45's");
  assert.equal(clubOf(2005, 'WSH').name, 'Washington Nationals');
  assert.equal(clubOf(2007, 'TBD').name, 'Tampa Bay Devil Rays');
  assert.equal(clubOf(2012, 'MIA').name, 'Miami Marlins');
});

test('a ballpark renamed in place keeps its map: 37 maps for 58 seasons, each named as its first season knew it', () => {
  const maps = CLUB_MAPS.filter(entry => entry.sport === 'baseball' && entry.seasons?.some(id => /^mlb-war-/.test(id)));
  assert.equal(maps.length, 37);
  assert.deepEqual(maps.map(entry => entry.id), MANIFEST.maps.map(map => map.id));
  for (const entry of maps) {
    const map = MANIFEST.maps.find(m => m.id === entry.id);
    assert.deepEqual(entry.seasons, map.seasons.map(warSeasonIdOf));
    assert.equal(entry.clubs, teamsOfWar(FRANCHISES, MANIFEST, map.seasons[0]).length);
  }
  const of = id => MANIFEST.maps.find(map => map.id === id).seasons;
  assert.deepEqual([of('mlb1966'), of('mlb1977'), of('mlb1982'), of('mlb2012')], [[1966, 1967], [1977, 1978, 1979, 1980, 1981], [1982, 1983, 1984, 1985, 1986, 1987, 1988], [2012, 2013, 2014, 2015]]);
  // Atlanta Stadium became Atlanta–Fulton County Stadium in 1976 and Busch Memorial Stadium Busch Stadium in 1982, in place.
  const arena = (mapId, clubId) => mapFile(mapId).clubs.find(club => club.id === clubId).arena;
  assert.deepEqual([arena('mlb1966', 'mlb-atlanta-braves'), arena('mlb1976', 'mlb-atlanta-braves')], ['Atlanta Stadium', 'Atlanta–Fulton County Stadium']);
  assert.deepEqual([arena('mlb1977', 'mlb-st-louis-cardinals'), arena('mlb1982', 'mlb-st-louis-cardinals')], ['Busch Memorial Stadium', 'Busch Stadium']);
  assert.deepEqual([arena('mlb1960', 'mlb-detroit-tigers'), arena('mlb1961', 'mlb-detroit-tigers'), arena('mlb1962', 'mlb-chicago-white-sox')],
    ['Briggs Stadium', 'Tiger Stadium', 'White Sox Park']);
  // 2017 has 2018's clubs in 2018's ballparks, on a map of its own.
  const places = id => mapFile(id).clubs.map(club => [club.id, club.home]).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  assert.deepEqual(places('mlb2017'), places('mlb2018'));
});

test('every era map gives each club its ballpark\'s land, and shares a state between its clubs', () => {
  for (const { id } of MANIFEST.maps) {
    const map = decodeDomestic(mapFile(id), id);
    for (const club of map.clubs) {
      const land = map.geo.countries.find(section => section.id === club.homeSection).polys;
      assert.ok(kmToPolys(club.homePoint, land) <= 2, `${id}: ${club.name} grows from inside its own territory`);
    }
    assert.equal(sectionAt(map, [-87.6556, 41.9481]), home(map, 'mlb-chicago-cubs'), `${id}: Wrigley Field`);
  }
  // 1961: the Dodgers at the Coliseum and the Angels at Wrigley Field split Los Angeles County.
  const la = decodeDomestic(mapFile('mlb1961'), 'mlb1961');
  assert.equal(sectionAt(la, [-118.2878, 34.0142]), home(la, 'mlb-los-angeles-dodgers'));
  assert.equal(sectionAt(la, [-118.2661, 34.0075]), home(la, 'mlb-los-angeles-angels'));
  assert.deepEqual([la.sectionNames[home(la, 'mlb-los-angeles-dodgers')], la.sectionNames[home(la, 'mlb-los-angeles-angels')]],
    ['Los Angeles (Dodgers)', 'Los Angeles (Angels)']);
  // 1962-63: the Mets at the Polo Grounds hold Manhattan, the Yankees the Bronx; the Angels, Dodger Stadium's tenants,
  // grow from Wrigley Field.
  const ny = decodeDomestic(mapFile('mlb1962'), 'mlb1962');
  assert.equal(sectionAt(ny, [-73.9372, 40.8317]), home(ny, 'mlb-new-york-mets'));
  assert.equal(sectionAt(ny, [-73.9281, 40.8269]), home(ny, 'mlb-new-york-yankees'));
  assert.deepEqual([ny.sectionNames[home(ny, 'mlb-new-york-mets')], ny.sectionNames[home(ny, 'mlb-new-york-yankees')]], ['Manhattan', 'The Bronx']);
  const angels = mapFile('mlb1962').clubs.find(club => club.id === 'mlb-los-angeles-angels');
  assert.deepEqual([angels.arena, angels.home], ['Dodger Stadium', [-118.2661, 34.0075]]);
  assert.equal(sectionAt(ny, [-118.24, 34.0736]), home(ny, 'mlb-los-angeles-dodgers'), 'Dodger Stadium is the Dodgers\'');
  // 1974-75: the Yankees play at Shea Stadium but grow from Yankee Stadium; Shea is the Mets'.
  const shea = decodeDomestic(mapFile('mlb1974'), 'mlb1974');
  const yankees = mapFile('mlb1974').clubs.find(club => club.id === 'mlb-new-york-yankees');
  assert.deepEqual([yankees.arena, yankees.home], ['Shea Stadium', [-73.9281, 40.8269]]);
  assert.equal(sectionAt(shea, [-73.8481, 40.7556]), home(shea, 'mlb-new-york-mets'));
  assert.equal(sectionAt(shea, [-73.9281, 40.8269]), home(shea, 'mlb-new-york-yankees'));
  // 1960: the Senators hold the District; 1969: the Expos Quebec, the Pilots Washington State.
  const sixty = decodeDomestic(mapFile('mlb1960'), 'mlb1960');
  assert.equal(sixty.sectionNames[home(sixty, 'mlb-washington-senators-1901')], 'Washington');
  const expos = decodeDomestic(mapFile('mlb1969'), 'mlb1969');
  assert.equal(sectionAt(expos, [-73.6269, 45.5328]), home(expos, 'mlb-montreal-expos'));
  assert.equal(sectionAt(expos, [-120.51, 46.6]), home(expos, 'mlb-seattle-pilots'));
});

test('the loader refuses a computed season that is not the builder\'s', () => {
  const doc = seasonFile(1961);
  const broken = edit => { const copy = JSON.parse(JSON.stringify(doc)); edit(copy); return () => decodeFootballSet(copy, copy.id); };
  assert.throws(broken(d => { d.map = 'mlb1962'; }), /not a baseball map listing this season/);
  assert.throws(broken(d => { d.source.computed = false; }), /must say the ratings are computed/);
  assert.throws(broken(d => { delete d.source.conversion; }), /how the ratings were derived/);
  assert.throws(broken(d => { d.source.rawScale = 99; }), /rawScale must be "WAR"/);
  assert.throws(broken(d => { d.clubs.pop(); }), /clubs must be the 18 of map mlb1961/);
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
  const fetch = async url => {
    const [, folder, id] = String(url).match(/^\/(domestic|baseball)\/([0-9A-Za-z-]+)\.json$/) || [];
    let text = null;
    try { text = folder ? read(`public/${folder}/${id}.json`) : null; } catch { text = null; }
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
  // The fixture stubs the opening; the campaign's real one names its theatre.
  f.app.opening = B.App.prototype.opening;
  try { return await fn(f); } finally {
    f.close();
    if (prior) Object.defineProperty(globalThis, 'fetch', prior); else delete globalThis.fetch;
  }
}
const modelOf = app => buildSetupModel(app.state.setup, { managerTeams: app.setupTeams(), domestic: app.domesticStatus(), season: app.seasonStatus() });

test('the Season choice lists 1960 to 2017 after MLB The Show\'s seasons, and a 1961 clubs campaign plays on the map of 1961 and resumes', async () => {
  await withApp(async ({ app, time, items }) => {
    app.pickSetup('sport', 'baseball');
    const model = modelOf(app);
    assert.deepEqual(model.season.options.slice(-3).map(option => option.label),
      ['1962 · Computed from WAR, end of 1962', '1961 · Computed from WAR, end of 1961', '1960 · Computed from WAR, end of 1960']);
    assert.match(model.season.note, /1960–2017 are computed/);
    app.pickSetup('layer', 'clubs');
    app.pickSetup('dataSet', 'mlb-war-1961');
    assert.equal(app.state.setup.clubScope, 'domestic:mlb1961');
    time.advance(200);
    await Promise.all([app.loadCountry('mlb1961'), app.loadSet('mlb-war-1961')]);
    await settle();
    assert.equal(app.domesticStatus().state, 'ready');
    assert.equal(app.seasonStatus().state, 'ready');
    const doc = seasonFile(1961);
    app.startCampaign();
    const st = app.state;
    assert.equal(st.phase, 'playing');
    assert.deepEqual([st.settings.clubScope, st.settings.dataSet, st.settings.dataVersion, st.settings.dataSeason],
      ['domestic:mlb1961', 'mlb-war-1961', doc.version, '1961']);
    assert.equal(st.campaignName, 'Baseball 1961 · MLB · USA and Canada');
    // It plays 1961's rules (docs/design/baseball.md, "Rules by era"): extra innings as the ninth, twelve of them.
    const sport = app.sport();
    const rules = sport.prepareMatch(st.teams['mlb-new-york-yankees'], st.teams['mlb-detroit-tigers']).rules;
    assert.deepEqual([sport.simulationVersion, rules.runner, rules.maxExtra], [3, false, 12]);
    assert.deepEqual(Object.keys(st.teams).sort(), doc.clubs.map(club => club.id).sort());
    const yankees = st.teams['mlb-new-york-yankees'];
    assert.ok(yankees.squad.some(p => p.name === 'Roger Maris') && yankees.squad.some(p => p.name === 'Mickey Mantle'));
    assert.equal(app.territoryName(st.teams['mlb-los-angeles-angels'].home), 'Los Angeles (Angels)');
    assert.equal(app.territoryName(st.teams['mlb-washington-senators-1961'].home), 'Washington');
    // The save holds every player as played, so it resumes without the season file, on the map of 1961 and no other.
    const text = items.get(SAVE_KEY);
    const saved = parseCampaign(text);
    assert.equal(JSON.stringify(saved.teams), JSON.stringify(st.teams));
    B.clearFootballSetCache();
    app.continueSaved(saved);
    assert.equal(app.state.phase, 'playing');
    assert.deepEqual([app.state.settings.clubScope, app.state.settings.dataSet], ['domestic:mlb1961', 'mlb-war-1961']);
    assert.equal(app.sport(), sport, 'the resumed campaign plays the same rules');
    assert.equal(JSON.stringify(app.state.teams), JSON.stringify(st.teams));
    const edited = edit => { const data = JSON.parse(text); edit(data.settings); if (data.initialSettings) edit(data.initialSettings); return JSON.stringify(data); };
    const map1962 = CLUB_MAPS.find(entry => entry.id === 'mlb1962').version;
    assert.throws(() => parseCampaign(edited(s => { s.clubScope = 'domestic:mlb1962'; s.domesticVersion = map1962; })), /Campaign data set is invalid/);
    assert.throws(() => parseCampaign(edited(s => { s.dataSeason = '1962'; })), /Campaign data set is invalid/);
  });
  // A challenge link reaches back to 1960, and no further.
  assert.deepEqual(readChallenge('?sport=baseball&season=mlb-war-1960').ignored, []);
  assert.deepEqual(readChallenge('?sport=baseball&season=mlb-war-1959').ignored, ['season']);
});
