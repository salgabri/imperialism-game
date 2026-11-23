// The earlier seasons' fields of Europe's strongest clubs by results (scripts/lib/europe-field.mjs), as committed: each
// season's 124 ranked strongest first, from far more countries than its ratings gave, a club EA lacks filled from the CM
// 01/02 Update Team's database on EA's scale.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodeFootballSet, setHasClubs } from '../src/engine/footballSets.js';
import { BUILT_IN_SEASONS } from '../src/data/footballSeasons.js';
import { strongestClubs, TOP_CLUBS, ELITE_CLUBS } from '../src/data/scopes.js';
import { EUROPEAN_LEAGUES, firstDivisionOf } from '../src/data/footballLeagues.js';

const read = file => JSON.parse(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'));
const seasons = BUILT_IN_SEASONS.map(season => season.id).filter(id => setHasClubs(id) && /^(ea-|cm|swos)/.test(id)).map(id => read(`public/football/${id}.json`)).filter(doc => doc.clubs.length);

test('every earlier season with clubs ranks its 124 by results, strongest first, its Elite 32 the first 32', () => {
  assert.equal(seasons.length, 31, '1993/94 to 2025/26 but for 2004/05 and 2005/06');
  for (const doc of seasons) {
    assert.deepEqual(doc.clubs.map(club => club.rank), Array.from({ length: TOP_CLUBS }, (_, i) => i + 1), doc.id);
    assert.deepEqual(strongestClubs(doc.clubs, ELITE_CLUBS).map(club => club.id), doc.clubs.slice(0, ELITE_CLUBS).map(club => club.id), doc.id);
    assert.ok(doc.clubs.every(club => EUROPEAN_LEAGUES[club.league] === club.country || club.league === firstDivisionOf(club.country, doc.year)), doc.id);
  }
});

test('the fields span Europe: 20 or more countries a season, the five big leagues far from filling them', () => {
  const big = ['Premier League', 'La Liga', 'Serie A', 'Bundesliga', 'Ligue 1'];
  for (const doc of seasons) {
    const countries = new Set(doc.clubs.map(club => club.country)).size;
    // 2006/07 has no Update Team database to fill the leagues FIFA 07 does not rate.
    assert.ok(countries >= (doc.id === 'ea-fifa-07' ? 17 : 20), `${doc.id}: ${countries} countries`);
    if (doc.id.startsWith('ea-') && doc.id !== 'ea-fifa-07') {
      assert.ok(doc.clubs.filter(club => big.includes(club.league)).length <= 85, doc.id);
    }
  }
  // 2009/10: Ukraine's, Croatia's, Serbia's, Romania's, Cyprus's, Israel's and Belarus's champions of results, which FIFA 10
  // does not rate, play from the Update Team's database; Salzburg and Basel from FIFA 10.
  const fifa10 = seasons.find(doc => doc.id === 'ea-fifa-10');
  const filled = new Set(fifa10.clubs.filter(club => club.fill).map(club => club.name));
  for (const name of ['Dinamo Kiev', 'Shakhtar Donetsk', 'NK Dinamo Zagreb', 'Partizan Belgrade', 'APOEL Nicosia', 'Maccabi Haifa', 'BATE Borisov']) {
    assert.ok(filled.has(name), name);
  }
  assert.ok(['FC Red Bull Salzburg', 'FC Basel 1893'].every(name => fifa10.clubs.some(club => club.name === name && !club.fill)));
});

test('a filled club plays on its season\'s scale, by the line fitted over the clubs both sources rate', () => {
  for (const doc of seasons.filter(entry => entry.clubs.some(club => club.fill))) {
    assert.ok(doc.id.startsWith('ea-'), `${doc.id}: only an EA season fills`);
    const { scale, source } = doc.clubFill;
    assert.ok(scale.r >= 0.8 && scale.clubs >= 150 && scale.b > 0.4 && scale.b < 0.9, `${doc.id}: ${JSON.stringify(scale)}`);
    assert.equal(source.provider, 'CM 01/02 Update Team');
    const set = decodeFootballSet(doc);
    for (const club of set.clubs.filter(entry => entry.fill)) {
      for (const [, , rating, info] of club.squad) {
        assert.equal(rating, Math.min(99, Math.max(1, Math.round(scale.a + scale.b * info.unscaledRating))), `${doc.id} ${club.name}`);
        assert.equal(info.source, 'cm0102', "the Update Team's record");
      }
      const mean = club.squad.reduce((sum, [, , rating]) => sum + rating, 0) / club.squad.length;
      assert.equal(club.str, Math.round(mean), `${doc.id} ${club.name}: its strength is its XI's on the season's scale`);
    }
  }
});

test('each season\'s field is the ranked clubs that have squads, the audit naming every one passed over', () => {
  const { seasons: strengths } = read('scripts/data/club-strength.json');
  const audits = [...read('docs/design/football-seasons-audit.json').seasons, ...read('docs/design/football-retro-seasons-audit.json').seasons.map(entry => entry.audit)];
  for (const doc of seasons) {
    const field = audits.find(entry => entry.id === doc.id)?.field;
    assert.ok(field, `${doc.id} has its field's audit`);
    const ranked = strengths[doc.year].map(([club]) => club);
    // Every club passed over ranks among those above the last one kept.
    assert.ok(field.passed.every(club => ranked.indexOf(club) >= 0 && ranked.indexOf(club) < TOP_CLUBS + field.passed.length), doc.id);
  }
});
