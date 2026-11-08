// The Tecmo seasons' data (docs/design/american-football.md, "Tecmo seasons (data)"): the NFL's 1990 and 1992–1995
// seasons as the Tecmo Super Bowl games rate them, snapshotted in scripts/data/tecmo/<season>.json by
// scripts/sync-tecmo.mjs. The snapshots rebuild byte for byte from the pinned inputs (when data-src/ has them), each
// season has its clubs and players, every unlicensed star is named only where the snapshot shows the evidence, the
// overall (ours) follows from the raw attributes, never falls as the score rises and stays in 1–99, and every club fields
// the game's lineup or leaves exactly the gap the library documents.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { selectLineup } from '../src/data/teams.js';
import {
  ATTRIBUTES, EDITIONS, FRANCHISE_OF, LINEUP, NFTGL_WEIGHTS, POSITIONS, SCALE, SEASONS, TECMO_GEEK, casedName, documentedGaps, editDistance,
  eraOf, genericGroups, identify, kindOf, lineupGaps, nftglScore, overallsOf, parseDump, referenceOf, slotPosition, splitName, tecmoGeekScore,
} from './lib/tecmo.mjs';

const EVERY_TEAM = FRANCHISE_OF;

const root = fileURLToPath(new URL('..', import.meta.url));
const read = file => readFileSync(path.join(root, file), 'utf8');
const snapshotOf = season => JSON.parse(read(`scripts/data/tecmo/${season}.json`));
const SNAPSHOTS = SEASONS.map(({ season }) => [season, snapshotOf(season)]);
const FRANCHISES = JSON.parse(read('scripts/data/nfl-teams.json')).teams;
// Players a club carries in each edition's dump: NES 30, SNES 32, TSB II and III 37.
const ROSTER = { nes: 30, snes: 32, tsb2: 37, tsb3: 37 };
const EXPECTED = {
  1990: { clubs: 28, players: 810, generic: 3, named: 1 },
  1992: { clubs: 28, players: 991, generic: 60, named: 43 },
  1993: { clubs: 28, players: 868, generic: 4, named: 4 },
  1994: { clubs: 28, players: 1002, generic: 33, named: 27 },
  1995: { clubs: 30, players: 1079, generic: 16, named: 15 },
};

// ---------- building ----------

test('the snapshots rebuild byte for byte from the pinned inputs', t => {
  const snapshot = snapshotOf(1990);
  const missing = Object.keys(snapshot.source.files).filter(file => !existsSync(path.join(root, 'data-src', file)));
  if (missing.length) { t.skip(`data-src/ lacks ${missing.length} pinned inputs (${missing[0]} …): the rebuild runs where they are`); return; }
  const out = execFileSync(process.execPath, ['scripts/sync-tecmo.mjs', '--check'], { cwd: root, encoding: 'utf8' });
  assert.match(out, /Verified 5 Tecmo snapshots byte for byte/);
});

test('every input is pinned by SHA-256 and every dump by its tsbtools blob', () => {
  for (const [season, snapshot] of SNAPSHOTS) {
    const { source } = snapshot;
    assert.equal(source.season, season);
    assert.deepEqual([source.game, source.platform, source.released], [EDITIONS[SEASONS.find(s => s.season === season).edition].game,
      EDITIONS[SEASONS.find(s => s.season === season).edition].platform, EDITIONS[SEASONS.find(s => s.season === season).edition].released]);
    for (const [file, sha256] of Object.entries(source.files)) assert.match(sha256, /^[0-9a-f]{64}$/, `${season}: ${file}`);
    assert.match(source.dump.blob, /^[0-9a-f]{40}$/);
    assert.equal(source.dump.repo, 'https://github.com/BAD-AL/tsbtools');
    assert.equal(Object.keys(source.files).filter(file => file.includes('madden-nfl-2002')).length, 31, `${season}: Madden NFL 2002's 31 team spreadsheets`);
    assert.equal(Object.keys(source.files).filter(file => /nflverse-rosters-1980-2000\/roster_\d{4}\.csv$/.test(file)).length, 21);
  }
});

// ---------- the seasons ----------

test('each season has its clubs, named as they were that season, and their players', () => {
  for (const [season, snapshot] of SNAPSHOTS) {
    const { edition } = SEASONS.find(s => s.season === season);
    const expected = EXPECTED[season];
    const clubs = Object.keys(snapshot.teams);
    assert.equal(clubs.length, expected.clubs, `${season} clubs`);
    assert.equal(snapshot.players.length, expected.players, `${season} players`);
    for (const franchise of clubs) {
      assert.ok(FRANCHISES[franchise], `${franchise} is today's franchise`);
      assert.deepEqual(snapshot.teams[franchise], eraOf(franchise, season));
      // A club's players: its whole roster but the punter and the unlicensed stars left out.
      const leftOut = snapshot.placeholders.filter(d => d.franchise === franchise && !d.named && d.slot !== 'P').length;
      assert.equal(snapshot.players.filter(p => p[1] === franchise).length, ROSTER[edition] - 1 - leftOut, `${season} ${franchise}`);
    }
    assert.ok(snapshot.players.every(p => clubs.includes(p[1])));
  }
  const eras = Object.fromEntries(SNAPSHOTS.map(([season, s]) => [season, s.teams]));
  assert.deepEqual(eras[1990]['nfl-tennessee-titans'], { era: 'nfl-houston-oilers', name: 'Houston Oilers', code: 'HOU' });
  assert.deepEqual(eras[1993]['nfl-arizona-cardinals'], { era: 'nfl-phoenix-cardinals', name: 'Phoenix Cardinals', code: 'PHO' });
  assert.deepEqual(eras[1994]['nfl-arizona-cardinals'], { era: 'nfl-arizona-cardinals', name: 'Arizona Cardinals', code: 'ARI' });
  assert.deepEqual(eras[1994]['nfl-las-vegas-raiders'], { era: 'nfl-los-angeles-raiders', name: 'Los Angeles Raiders', code: 'RAI' });
  assert.deepEqual(eras[1995]['nfl-las-vegas-raiders'], { era: 'nfl-oakland-raiders', name: 'Oakland Raiders', code: 'OAK' });
  assert.deepEqual(eras[1995]['nfl-los-angeles-rams'], { era: 'nfl-st-louis-rams', name: 'St. Louis Rams', code: 'STL' });
  assert.deepEqual(eras[1992]['nfl-washington-commanders'], { era: 'nfl-washington', name: 'Washington', code: 'WAS' }, 'as the game names Washington before 2020');
  assert.ok(eras[1995]['nfl-carolina-panthers'] && eras[1995]['nfl-jacksonville-jaguars'] && !eras[1994]['nfl-carolina-panthers']);
});

test('the era table is the eras research file\'s, Washington\'s name aside (when the file is there)', t => {
  const file = path.join(root, 'data-src/research/eras/nfl.json');
  if (!existsSync(file)) { t.skip('data-src/research/eras/nfl.json is not here'); return; }
  const eras = JSON.parse(readFileSync(file, 'utf8')).franchises;
  for (const [season, snapshot] of SNAPSHOTS) {
    for (const [franchise, ours] of Object.entries(snapshot.teams)) {
      const era = eras[franchise].find(e => e.from <= season && season <= e.to);
      const theirs = { era: era.id ?? franchise, name: era.name, code: era.code };
      if (franchise === 'nfl-washington-commanders') assert.deepEqual(theirs, { era: 'nfl-washington-redskins', name: 'Washington Redskins', code: 'WAS' });
      else assert.deepEqual(ours, theirs, `${season} ${franchise}`);
    }
  }
});

test('the unlicensed stars are named only with their evidence; the rest are left out', () => {
  for (const [season, snapshot] of SNAPSHOTS) {
    const { generic, named } = EXPECTED[season];
    assert.equal(snapshot.placeholders.length, generic, `${season} generic players`);
    assert.equal(snapshot.placeholders.filter(d => d.named).length, named, `${season} named`);
    for (const decision of snapshot.placeholders) {
      const team = decision.rom.split(' ')[1].toLowerCase();
      assert.ok(genericGroups(decision.rom, team === 'niners' ? '49ers' : team), `${decision.rom} is a generic name`);
      const player = snapshot.players.find(p => p[1] === decision.franchise && p[2] === decision.slot && p[5].rom === decision.rom
        && p[5].no === decision.number);
      if (!decision.named) {
        assert.equal(player, undefined, `${season} ${decision.rom} stays out`);
        assert.ok(['not certain', 'number unknown', 'number shared'].includes(decision.rule));
        continue;
      }
      assert.ok(decision.candidates.includes(decision.named), `${decision.named} was on the club's nflverse roster`);
      if (decision.rule === 'number') assert.ok(decision.number > 0 && decision.evidence.length, `${decision.rom}: a source shows #${decision.number}`);
      else if (decision.rule === 'only candidate') assert.deepEqual(decision.candidates, [decision.named]);
      else assert.equal(decision.rule, 'same season');
      if (decision.slot !== 'P') assert.equal(player?.[0], decision.named, `${season} ${decision.rom} plays as ${decision.named}`);
    }
    // No generic name survives among the players.
    for (const p of snapshot.players.filter(q => !snapshot.placeholders.some(d => d.rom === q[5].rom && d.franchise === q[1] && d.slot === q[2]))) {
      const team = Object.keys(EVERY_TEAM).find(key => EVERY_TEAM[key] === p[1]);
      assert.equal(genericGroups(p[5].rom, team), null, `${season}: ${p[5].rom} is a generic name`);
    }
  }
  const nes = snapshotOf(1990).placeholders;
  assert.deepEqual(nes.map(d => [d.rom, d.named]), [['qb BILLS', null], ['qb BROWNS', null], ['qb EAGLES', 'Randall Cunningham']]);
  assert.deepEqual(nes[0].candidates, ['Gale Gilbert', 'Jim Kelly'], 'two Bills quarterbacks the game does not name: not certain');
  const snes = snapshotOf(1993).placeholders;
  assert.deepEqual(snes.map(d => [d.rom, d.named, d.rule]), [['p BENGALS', 'Lee Johnson', 'only candidate'], ['qb CHIEFS', 'Joe Montana', 'same season'],
    ['k BEARS', 'Kevin Butler', 'only candidate'], ['qb VIKINGS', 'Jim McMahon', 'same season']]);
  const thurman = snapshotOf(1992).placeholders.find(d => d.rom === 'hb BILLS');
  assert.equal(thurman.named, 'Thurman Thomas');
  assert.ok(thurman.evidence.includes('SNES Tecmo Super Bowl 1993'));
});

// ---------- attributes and positions ----------

test('every attribute is on the 16-step scale, by the screen\'s names and as many as the edition rates', () => {
  for (const [season, snapshot] of SNAPSHOTS) {
    const { edition } = SEASONS.find(s => s.season === season);
    for (const [name, , slot, , , raw] of snapshot.players) {
      const kind = kindOf(slot);
      const names = Object.keys(raw).filter(key => ATTRIBUTES.includes(key));
      const layout = EDITIONS[edition].layout[kind];
      assert.deepEqual(names, ATTRIBUTES.filter(key => layout.includes(key)), `${season} ${name}: screen order`);
      for (const key of names) assert.ok(SCALE.includes(raw[key]), `${season} ${name} ${key} ${raw[key]}`);
      assert.ok(Number.isInteger(raw.no) && raw.rom.length > 0);
    }
  }
  // Read in the screen's order, every edition rates quarterbacks' rushing power 69 and nearly all their running speed 25,
  // and every kicker 56 and 81, as NES Tecmo Super Bowl does: TSB II and III's dumps list the two the other way round.
  for (const [season, snapshot] of SNAPSHOTS) {
    const qbs = snapshot.players.filter(p => p[3] === 'QB').map(p => p[5]);
    assert.ok(qbs.every(raw => raw.RP === 69), `${season}: quarterbacks' RP`);
    assert.ok(qbs.filter(raw => raw.RS === 25).length / qbs.length > 0.85, `${season}: quarterbacks' RS`);
    assert.ok(snapshot.players.filter(p => p[3] === 'K').every(p => p[5].RS === 56 && p[5].RP === 81), `${season}: kickers`);
  }
});

test('every slot maps onto the game\'s positions: defenders by slot, backs and receivers by their own position', () => {
  for (const [season, snapshot] of SNAPSHOTS) {
    const { edition } = SEASONS.find(s => s.season === season);
    for (const [name, , slot, position] of snapshot.players) {
      assert.ok(POSITIONS.includes(position), `${season} ${name}: ${position}`);
      const fromSlot = slotPosition(edition, slot);
      if (['RB', 'WR', 'TE'].includes(fromSlot)) assert.ok(['RB', 'WR', 'TE'].includes(position), `${season} ${name} ${slot} → ${position}`);
      else assert.equal(position, fromSlot, `${season} ${name} ${slot}`);
    }
    assert.equal(snapshot.players.filter(p => p[3] !== slotPosition(edition, p[2])).length, snapshot.conversion.positions.relabelled);
  }
  assert.equal(slotPosition('snes', 'DB1'), 'CB');
  assert.equal(slotPosition('snes', 'DB2'), 'S');
  assert.deepEqual(['DB1', 'DB2', 'DB3'].map(slot => slotPosition('tsb3', slot)), ['CB', 'CB', 'S']);
  // Cortez Kennedy at inside linebacker (NES) stays a linebacker.
  const kennedy = snapshotOf(1990).players.find(p => p[0] === 'Cortez Kennedy');
  assert.deepEqual([kennedy[2], kennedy[3]], ['RILB', 'LB']);
  // The run-and-shoot Falcons of 1990 field six receivers and no tight end, as Tecmo Geek lists them.
  const falcons = snapshotOf(1990).players.filter(p => p[1] === 'nfl-atlanta-falcons');
  assert.deepEqual(['RB', 'WR', 'TE'].map(pos => falcons.filter(p => p[3] === pos).length), [4, 6, 0]);
  assert.equal(snapshotOf(1990).players.filter(p => p[3] === 'P').length, 0, 'punters are left out');
});

test('every club fields the game\'s lineup or leaves exactly the documented gap', () => {
  const plan = selectLineup({ sport: 'american-football', squad: [] }).slots.map(slot => slot.position);
  const needs = {};
  for (const position of plan) needs[position] = (needs[position] || 0) + 1;
  assert.deepEqual(needs, LINEUP, 'the library\'s lineup is the game\'s');
  for (const [season, snapshot] of SNAPSHOTS) {
    assert.deepEqual(snapshot.lineup.needs, LINEUP);
    for (const franchise of Object.keys(snapshot.teams)) {
      const players = snapshot.players.filter(p => p[1] === franchise);
      const gaps = lineupGaps(players.map(p => p[3]));
      assert.deepEqual(gaps, documentedGaps(season, franchise), `${season} ${franchise}`);
      assert.deepEqual(snapshot.lineup.gaps[franchise] ?? {}, gaps);
      // The game fills every place, the documented gaps out of position.
      const lineup = selectLineup({ sport: 'american-football', squad: players.map(([name, , , pos, rating]) => ({ name, pos, rating })) });
      assert.equal(lineup.starters.length, plan.length);
      const short = lineup.slots.filter(slot => slot.outOfPosition).length;
      assert.ok(short >= Object.values(gaps).reduce((sum, n) => sum + n, 0), `${season} ${franchise}: ${short} out of position`);
    }
  }
  assert.deepEqual(documentedGaps(1990, 'nfl-buffalo-bills'), { DL: 1, CB: 1 });
  assert.deepEqual(documentedGaps(1990, 'nfl-atlanta-falcons'), { DL: 1, CB: 1, TE: 1 });
  assert.deepEqual(documentedGaps(1993, 'nfl-dallas-cowboys'), { DL: 1 });
  assert.deepEqual(documentedGaps(1994, 'nfl-dallas-cowboys'), {});
});

// ---------- the overall ----------

/** Each player's score, recomputed from his raw attributes by the snapshot's formula. */
function scoresOf(snapshot) {
  const { formula } = snapshot.conversion;
  return snapshot.players.map(([, , , position, , raw]) => (formula.id.startsWith('tecmogeek')
    ? tecmoGeekScore(position, raw, formula.maxima) : nftglScore(position, raw)));
}

test('the snapshot states the formula it applies, the library\'s', () => {
  for (const [season, snapshot] of SNAPSHOTS) {
    const { formula, overall } = snapshot.conversion;
    assert.match(overall, /^Ours, not the game's/);
    assert.match(snapshot.note, /The overall is ours/);
    if (formula.id.startsWith('tecmogeek')) {
      assert.deepEqual([formula.weights, formula.bands, formula.groups], [TECMO_GEEK.weights, TECMO_GEEK.bands, TECMO_GEEK.groups]);
      for (const weights of Object.values(formula.weights)) assert.equal(Object.values(weights).reduce((a, b) => a + b, 0), 100);
    } else {
      for (const position of POSITIONS) {
        const expected = Object.fromEntries(Object.entries(NFTGL_WEIGHTS[position]).filter(([name]) => season === 1995 || name !== 'AG'));
        assert.deepEqual(formula.weights[position], expected, `${season} ${position}`);
      }
    }
  }
  assert.equal(snapshotOf(1990).conversion.formula.id, 'tecmogeek-nes');
  assert.equal(snapshotOf(1995).conversion.formula.id, 'nftgl-2017');
});

test('the overall follows from the score: Madden NFL 2002\'s overall at the score\'s percentile, never lower for a higher score, in 1–99', () => {
  for (const [season, snapshot] of SNAPSHOTS) {
    const scores = scoresOf(snapshot);
    for (const position of POSITIONS) {
      const at = snapshot.players.map((p, i) => [p, scores[i]]).filter(([p]) => p[3] === position);
      const { madden, players } = snapshot.conversion.reference.positions[position];
      assert.equal(players, at.length);
      assert.deepEqual(madden, [...madden].sort((a, b) => a - b));
      const overall = overallsOf(at.map(([, score]) => score), madden);
      const sorted = at.slice().sort((a, b) => a[1] - b[1]);
      for (const [p, score] of at) {
        assert.equal(p[4], overall.get(score), `${season} ${p[0]} (${position})`);
        assert.ok(Number.isInteger(p[4]) && p[4] >= 1 && p[4] <= 99);
      }
      for (let i = 1; i < sorted.length; i++) {
        assert.ok(sorted[i][0][4] >= sorted[i - 1][0][4], `${season} ${position}: ${sorted[i][0][0]} scores above ${sorted[i - 1][0][0]}`);
        if (sorted[i][1] === sorted[i - 1][1]) assert.equal(sorted[i][0][4], sorted[i - 1][0][4], 'equal scores, equal overalls');
      }
      assert.ok(sorted.at(-1)[0][4] <= madden.at(-1) && sorted[0][0][4] >= madden[0], `${season} ${position}: within Madden's range`);
    }
  }
});

test('the percentile mapping: monotonic, bounded and matched to the reference', () => {
  const reference = [40, 50, 60, 70, 80, 90];
  const map = overallsOf([1, 2, 3, 4, 5, 6], reference);
  assert.deepEqual([...map.values()], reference, 'as many scores as overalls map one to one');
  const ties = overallsOf([5, 5, 1, 9], [20, 40, 60, 80]);
  assert.equal(ties.get(5), 50, 'a tie shares the mid-rank');
  assert.deepEqual([ties.get(1), ties.get(9)], [20, 80]);
  const wide = overallsOf([1, 2, 3], [1, 99]);
  assert.ok([...wide.values()].every(v => v >= 1 && v <= 99));
  // As many of each Madden team's best as the season carries per club, fractional quotas filling by rank.
  const madden = [['a', 90], ['a', 80], ['a', 70], ['b', 85], ['b', 60]].map(([team, overall], i) => ({ team, position: 'WR', overall, name: `p${i}` }));
  assert.deepEqual(referenceOf(madden, 'WR', 1), [85, 90]);
  assert.deepEqual(referenceOf(madden, 'WR', 1.5), [80, 85, 90]);
  assert.deepEqual(referenceOf(madden, 'WR', 2), [60, 80, 85, 90]);
});

test('Tecmo Geek\'s ratings are reproduced, and the copies confirm the dumps', () => {
  const nes = snapshotOf(1990).source.checks[0];
  assert.deepEqual([nes.name, nes.compared, nes.identical], ['Tecmo Geek', 840, 839]);
  assert.match(nes.differences[0], /^John Taylor .*REC 69 in the dump, 63 at Tecmo Geek/);
  assert.equal(nes.ratings.reproduced, '811/812');
  assert.ok(snapshotOf(1990).source.notes.some(note => /John Taylor/.test(note)));
  const snes = snapshotOf(1993).source.checks[0];
  assert.ok(snes.identical / snes.compared > 0.97 && snes.unlisted === 0, 'the GameFAQs FAQ agrees with 98% of the SNES dump');
  for (const season of [1992, 1994]) {
    const copy = snapshotOf(season).source.checks[0];
    assert.equal(copy.identical, copy.compared, `${season}: the second TSB II dump agrees`);
    assert.match(snapshotOf(season).source.limit, /one extraction/);
  }
  const book = snapshotOf(1995).source.checks[0];
  assert.ok(book.identical / book.compared > 0.99, 'the Book of Armaments agrees with 99.5% of the TSB III dump');
  assert.equal(book.weights.reproducedAtListedPosition + book.weights.reproducedAtAnotherSkillPosition, book.weights.pointValues,
    'the weights reproduce every point value in the Book');
});

test('Tecmo Geek\'s formula reproduces its published examples', () => {
  // about_ratings: Jerry Rice and Bo Jackson as receivers and rushers, against the NES maxima (RS 63, MS 75, BC 81, REC 81).
  const maxima = { skill: { RS: 63, MS: 75, HP: 94, BC: 81, REC: 81 } };
  const rice = { RS: 44, RP: 69, MS: 69, HP: 13, BC: 81, REC: 81 }, bo = { RS: 38, RP: 69, MS: 75, HP: 31, BC: 81, REC: 19 };
  assert.equal(Math.round(tecmoGeekScore('WR', rice, maxima) * 100) / 100, 88.38);
  assert.equal(Math.round(tecmoGeekScore('WR', bo, maxima) * 100) / 100, 64.24);
  assert.equal(Math.round(tecmoGeekScore('RB', rice, maxima) * 100) / 100, 81.38);
  assert.equal(Math.round(tecmoGeekScore('RB', bo, maxima) * 100) / 100, 82.2);
  // The NFTGL's Steve Young (TSB III) by the sheet's column order: 3023 points.
  assert.equal(nftglScore('QB', { RS: 69, RP: 25, MS: 44, HP: 31, BB: 38, AG: 38, PS: 69, PC: 81, PA: 63, AR: 75, CO: 81 }), 3023);
  assert.equal(nftglScore('QB', { RS: 69, RP: 25, MS: 44, HP: 31, BB: 38, PS: 69, PC: 81, PA: 63, AR: 75, CO: 81 }), 3023 - 3 * 38, 'TSB II has no agility');
});

// ---------- reading ----------

test('the dump reader and the name matching', () => {
  const [kelly, line] = parseDump([
    'SEASON 2', 'TEAM = bills,SimData=0xD8', 'QB1,jim KELLY,Face=0x00,#12,69,25,13,13,13,63,81,69,69,75,[08,01,C3]',
    'C,kent HULL,Face=0x0b,#67,69,44,25,69,13,',
  ].join('\n'));
  assert.deepEqual([kelly.block, kelly.team, kelly.slot, kelly.rom, kelly.number, kelly.values], [2, 'bills', 'QB1', 'jim KELLY', 12, [69, 25, 13, 13, 13, 63, 81, 69, 69, 75]]);
  assert.deepEqual(line.values, [69, 44, 25, 69, 13]);
  assert.deepEqual(splitName('ivy joe HUNTER'), { first: 'ivy joe', last: 'HUNTER' });
  assert.equal(casedName('keith MCKELLER'), 'Keith McKeller');
  assert.equal(editDistance('jeffries', 'jeffires'), 1);
  const row = (full_name, first_name, last_name, birth_date = '1960-01-01') => ({ full_name, first_name, last_name, birth_date, gsis_id: '' });
  const rows = [row('Eugene Robinson', 'Eugene', 'Robinson', '1963-05-28'), row('Rafael Robinson', 'Eugene', 'Robinson', '1969-06-19'),
    row('Haywood Jeffires', 'Haywood', 'Jeffires'), row('Bill Brooks', 'William', 'Brooks'), row('Flipper Anderson', 'Willie', 'Anderson')];
  assert.equal(identify('e. ROBINSON', rows)?.full_name, 'Eugene Robinson', 'the name he went by beats his given name');
  assert.equal(identify('haywood JEFFRIES', rows)?.full_name, 'Haywood Jeffires');
  assert.equal(identify('bucky BROOKS', rows), null, 'Bucky Brooks is not Bill Brooks');
  assert.equal(identify('willie ANDERSON', rows)?.full_name, 'Flipper Anderson');
  assert.deepEqual(genericGroups('qb BILLS', 'bills'), ['QB']);
  assert.deepEqual(genericGroups('wr NINERS', '49ers'), ['WR']);
  assert.equal(genericGroups('jim KELLY', 'bills'), null);
});
