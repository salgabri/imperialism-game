import test from 'node:test';
import assert from 'node:assert/strict';
import { buildClub, buildTeam, makeRng, selectLineup } from '../src/data/teams.js';
import { basketball } from '../src/sports/basketball.js';

// PG to C, the order of the floor: neighbouring entries are neighbouring positions.
const FLOOR = basketball.positionPlan;
const nations = () => Object.keys(basketball.rosters).map(id => buildTeam(id, makeRng(1), basketball));
const clubs = () => basketball.clubs.map(club => buildClub(club, basketball));

test('basketball tuples list every natural position, primary first', () => {
  const team = buildTeam('705', makeRng(2), { ...basketball, rosters: { '705': [80, 2, [['Combo guard', 'PG/SG', 90], ['Pure centre', 'C', 80]]] } });
  assert.deepEqual(team.squad[0], { name: 'Combo guard', pos: 'PG', rating: 90, gen: false, positions: ['PG', 'SG'] });
  assert.deepEqual(team.squad[1], { name: 'Pure centre', pos: 'C', rating: 80, gen: false });
});

test('every bundled basketball player lists one position or two neighbouring ones', () => {
  const tuples = [...Object.values(basketball.rosters).flatMap(roster => roster[2]), ...basketball.clubs.flatMap(club => club.squad)];
  assert.ok(tuples.length >= 350);
  for (const [name, listed] of tuples) {
    const at = listed.split('/').map(pos => FLOOR.indexOf(pos));
    assert.ok(at.length <= 2 && !at.includes(-1), `${name}: ${listed}`);
    if (at.length === 2) assert.equal(Math.abs(at[0] - at[1]), 1, `${name}: ${listed} are not neighbouring positions`);
  }
});

test('most real basketball players cover two positions', () => {
  for (const [label, teams] of [['national fives', nations()], ['NBA fives', clubs()]]) {
    const players = teams.flatMap(team => team.squad);
    const dual = players.filter(player => player.positions?.length === 2);
    assert.ok(dual.length / players.length > 0.5, `${label}: ${dual.length} of ${players.length} cover two positions`);
  }
});

test('every national and NBA five fields all five positions without a penalty, using second positions', () => {
  let second = 0;
  for (const team of [...nations(), ...clubs()]) {
    const lineup = selectLineup(team);
    assert.deepEqual(lineup.slots.filter(slot => slot.outOfPosition).map(slot => `${slot.player.name} at ${slot.position}`), [], team.name);
    second += lineup.starters.filter(player => player.assignedPos !== player.pos).length;
  }
  assert.ok(second >= 20, `${second} starters play their second position`);
});
