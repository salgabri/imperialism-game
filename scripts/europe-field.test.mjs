// An earlier season's field of Europe's strongest clubs by results (scripts/lib/europe-field.mjs): the strengths'
// clubs matched to the squads the season's sources rate.
import test from 'node:test';
import assert from 'node:assert/strict';
import { matchClub, matchScore, nameWords, resultName, strengthField } from './lib/europe-field.mjs';

test('a name\'s words: accents, special letters, dotted initials and legal forms set aside, one spelling of a place', () => {
  assert.deepEqual(nameWords('F.C. København'), ['copenhagen']);
  assert.deepEqual(nameWords('Wisła Kraków'), ['wisla', 'krakow']);
  assert.deepEqual(nameWords('U.C. Sampdoria'), ['uc', 'sampdoria']);
  assert.deepEqual(nameWords('Dynamo Kyiv'), ['dinamo', 'kiev']);
  assert.deepEqual(nameWords('Dinamo Kiev'), ['dinamo', 'kiev']);
  assert.deepEqual(nameWords('FC Basel 1893'), ['basel']);
  assert.deepEqual(nameWords('Spartak Moskva-2'), ['spartak', 'moscow', '2'], 'a reserve side keeps its mark');
});

test('scores: every word of the shorter name first, the share of all words to tell two apart', () => {
  assert.deepEqual(matchScore('Basel', 'FC Basel 1893'), [1, 1, 1]);
  assert.deepEqual(matchScore('Salzburg', 'FC Red Bull Salzburg'), [1, 1 / 3, 1]);
  assert.deepEqual(matchScore('Metalist Kharkov', 'Metalist Kharkiv'), [1, 1, 1]);
  assert.deepEqual(matchScore('Olympique Lyon', 'Olympique Lyonnais'), [1, 1, 0.5]);
  assert.deepEqual(matchScore('Lecce', 'Lecco'), [1, 1, 0]);
  assert.equal(matchScore('Manchester United', 'Manchester City')[0], 0.5);
  assert.deepEqual(matchScore('Spartak Moskva', 'Spartak Moskva-2'), [0, 0, 0], 'a reserve side is never its club');
  assert.deepEqual(matchScore('Real Madrid', 'Real Madrid Castilla'), [0, 0, 0]);
});

test('a club is the one candidate with all the shorter name\'s words, or the one the names file gives', () => {
  const pool = ['Glasgow Rangers', 'Berwick Rangers', 'Celtic'].map(name => ({ name }));
  assert.equal(matchClub('Rangers (Scotland)', pool), null, 'two Rangers: no guess');
  assert.equal(matchClub('Rangers (Scotland)', pool, ['Glasgow Rangers']).club.name, 'Glasgow Rangers');
  assert.equal(matchClub('Celtic (Scotland)', pool).club.name, 'Celtic');
  assert.equal(matchClub('Celtic (Scotland)', pool, null), null, 'null: no source has the club');
  const milan = ['AC Milan', 'Inter Milan'].map(name => ({ name }));
  assert.equal(matchClub('Milan (Italy)', milan).club.name, 'AC Milan', 'the closer of two with every word');
  assert.equal(resultName('Dynamo Kyiv (Ukraine)'), 'Dynamo Kyiv');
});

test('a field takes the strongest clubs with a squad, a source in order, passing over those with none', () => {
  const strengths = [['Dynamo Kyiv (Ukraine)', '804', 2012], ['Barcelona (Spain)', '724', 2000], ['Lincoln (Gibraltar)', '804', 1990],
    ['Salzburg (Austria)', '040', 1800], ['Sevilla (Spain)', '724', 1790]];
  const ea = [{ name: 'FC Barcelona', country: '724' }, { name: 'Sevilla FC', country: '724' }, { name: 'FC Red Bull Salzburg', country: '040' }];
  const cm = [{ name: 'Dinamo Kiev', country: '804' }, { name: 'Barcelona', country: '724' }];
  const { kept, passed, matches } = strengthField(strengths, [ea, cm], { count: 3 });
  assert.deepEqual(kept.map(club => [club.name, club.rank, club.source]), [['Dinamo Kiev', 1, 1], ['FC Barcelona', 2, 0], ['FC Red Bull Salzburg', 3, 0]]);
  assert.deepEqual(passed, ['Lincoln (Gibraltar)']);
  assert.ok(matches.includes('Salzburg (Austria) = FC Red Bull Salzburg'));
  assert.throws(() => strengthField(strengths, [ea], { count: 5 }), /Only 3 of the 5 ranked clubs/);
});

test('of two with every word, the one spelt the same: Porto not Portomosense, Manchester City not Chester City', () => {
  const pick = (ident, names) => matchClub(ident, names.map(name => ({ name })))?.club.name ?? null;
  assert.equal(pick('Porto (Portugal)', ['Associação Desportiva Portomosense', 'Futebol Clube do Porto']), 'Futebol Clube do Porto');
  assert.equal(pick('Manchester City (England)', ['Chester City', 'Manchester City']), 'Manchester City');
  assert.equal(pick('Lecce (Italy)', ['Lecco', 'Lecce']), 'Lecce');
  assert.equal(pick('Hapoel Be\'er Sheva (Israel)', ['Hapoel Beer Sheva', 'Hapoel Haifa']), 'Hapoel Beer Sheva');
});
