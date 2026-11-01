// Challenge links and the daily campaign (README §Sharing a campaign): writing a setup into a link's query, reading it
// back into setup, the fallback for anything this build doesn't offer, and the daily seeds.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHALLENGE_KEYS, CHALLENGE_LABELS, challengeQuery, challengeUrl, dailyLabel, dailySeed, dailySetup, dayOf, fieldedTeam, isDaily,
  readChallenge,
} from '../src/screens/setup/challenge.js';
import { DEFAULT_SETUP } from '../src/app/shared.js';
import { BUILT_IN_SETS } from '../src/engine/footballSets.js';
import { launchRules } from '../src/engine/turns.js';
import { hashStr } from '../src/data/teams.js';

const setupOf = patch => ({ ...DEFAULT_SETUP, ...patch });
/** App's `setupSeed`: the number a seed field launches. */
const launchSeed = entered => (/^\d+$/.test(entered) ? Number(entered) >>> 0 : hashStr(entered));

// Setups as launch sees them (hidden choices already dropped), each with the exact query its link carries.
const CASES = [
  ['the default setup', setupOf({ seed: '42' }), 'seed=42'],
  ['nations, every rule changed, a manager', setupOf({ scope: 'world', pacing: 'blitz', resolution: 'instant', uncertainty: 'wild',
    finale: 'best-of-three', acquisitionPolicy: 'best-fit', role: 'manager', managedTeamId: '276', seed: '7' }),
  'theatre=world&draw=blitz&show=instant&upsets=wild&final=best-of-three&signings=best-fit&role=manager&team=276&seed=7'],
  ['a league, round robin, You choose, Fast-forward', setupOf({ layer: 'clubs', clubScope: 'Premier League', turnOrder: 'round-robin',
    targeting: 'player', express: true, role: 'manager', managedTeamId: 'f-real-madrid', seed: '3051207313' }),
  'teams=clubs&theatre=Premier+League&draw=round-robin&opponent=player&show=express&role=manager&team=f-real-madrid&seed=3051207313'],
  ['one country’s top clubs, chaos', setupOf({ layer: 'clubs', clubScope: 'domestic:826', pacing: 'chaos', seed: '9' }),
    'teams=clubs&theatre=domestic:826&draw=chaos&seed=9'],
  ['an earlier football season', setupOf({ scope: 'AFC', dataSet: 'ea-fifa-18', seed: '11' }), 'theatre=AFC&season=ea-fifa-18&seed=11'],
  ['basketball nations, evened out', setupOf({ sport: 'basketball', scope: 'elite', rosterPreset: 'competitive', role: 'manager',
    managedTeamId: '840', seed: '5' }), 'sport=basketball&theatre=elite&strengths=competitive&role=manager&team=840&seed=5'],
  ['an earlier NBA season on its era’s map', setupOf({ sport: 'basketball', layer: 'clubs', clubScope: 'domestic:nba2009',
    dataSet: 'nba-2k09', seed: '13' }), 'sport=basketball&season=nba-2k09&seed=13'],
  ['basketball clubs on the NBA map', setupOf({ sport: 'basketball', layer: 'clubs', clubScope: 'domestic:nba', seed: '17' }),
    'sport=basketball&teams=clubs&seed=17'],
  ['the NFL, managed', setupOf({ sport: 'american-football', layer: 'clubs', clubScope: 'domestic:nfl', role: 'manager',
    managedTeamId: 'nfl-baltimore-ravens', seed: '19' }), 'sport=american-football&role=manager&team=nfl-baltimore-ravens&seed=19'],
  ['baseball clubs on the MLB map', setupOf({ sport: 'baseball', layer: 'clubs', clubScope: 'domestic:mlb', seed: '23' }),
    'sport=baseball&teams=clubs&seed=23'],
];

test('a page without a challenge opens a new setup', () => {
  for (const search of ['', '?', '?playtest', 'utm_source=chat&fbclid=x']) {
    assert.deepEqual(readChallenge(search), { found: false, setup: DEFAULT_SETUP, ignored: [] }, JSON.stringify(search));
  }
  assert.deepEqual(readChallenge(undefined).setup, DEFAULT_SETUP);
});

for (const [name, setup, query] of CASES) {
  test(`a link writes and reads back ${name}`, () => {
    assert.equal(challengeQuery(setup), query);
    const read = readChallenge(`?${query}`);
    assert.deepEqual(read, { found: true, setup, ignored: [] });
    assert.deepEqual(launchRules(read.setup), launchRules(setup), 'the same rules launch');
  });
}

test('a link writes only what differs from a new setup, then the seed', () => {
  assert.equal(challengeQuery(DEFAULT_SETUP), '');
  assert.equal(challengeUrl('https://imperialism-game.vercel.app/', DEFAULT_SETUP), 'https://imperialism-game.vercel.app/');
  assert.equal(challengeUrl('https://imperialism-game.vercel.app/', DEFAULT_SETUP, 3051207313),
    'https://imperialism-game.vercel.app/?seed=3051207313');
  // Keys come in one order whatever the setup's.
  const query = challengeQuery(setupOf({ role: 'manager', managedTeamId: '380', sport: 'basketball', finale: 'best-of-three' }), 1);
  assert.equal(query, 'sport=basketball&final=best-of-three&role=manager&team=380&seed=1');
  const keys = query.split('&').map(pair => pair.split('=')[0]);
  assert.deepEqual(keys, CHALLENGE_KEYS.filter(key => keys.includes(key)));
  assert.deepEqual(Object.keys(CHALLENGE_LABELS), CHALLENGE_KEYS, 'every key has a label for the fallback note');
});

test('choices launch would drop stay out of the link', () => {
  // A spectator's stored "You choose", and a pairing draw's turn order.
  assert.equal(challengeQuery(setupOf({ targeting: 'player', seed: '1' })), 'seed=1');
  assert.equal(challengeQuery(setupOf({ pacing: 'blitz', turnOrder: 'round-robin', role: 'manager', targeting: 'player', seed: '1' })),
    'draw=blitz&role=manager&seed=1');
  // Team strengths outside basketball, a spectator's team, the theatre of a sport's own map.
  assert.equal(challengeQuery(setupOf({ rosterPreset: 'competitive', managedTeamId: '276', seed: '1' })), 'seed=1');
  assert.equal(challengeQuery(setupOf({ sport: 'american-football', layer: 'clubs', clubScope: 'Premier League' }), 2),
    'sport=american-football&seed=2');
  // A launched campaign's settings carry their stamps (map and set versions); the link names the choices only.
  assert.equal(challengeQuery({ ...CASES[4][1], dataVersion: 'ea-fifa-18-1234abcd', dataYear: 2018, dataSeason: '2017/18' }),
    CASES[4][2]);
  // The seed given wins over the setup's field: a blank field shares the seed it would launch.
  assert.equal(challengeQuery(setupOf({ seed: '' }), 1234), 'seed=1234');
});

test('values are written readably and read in any encoding', () => {
  assert.match(challengeQuery(setupOf({ layer: 'clubs', clubScope: 'Liga Portugal' })), /theatre=Liga\+Portugal/);
  assert.match(challengeQuery(setupOf({ layer: 'clubs', clubScope: 'domestic:032' })), /theatre=domestic:032/);
  for (const search of ['teams=clubs&theatre=Premier%20League', '?teams=clubs&theatre=Premier+League',
    'teams=clubs&theatre=Premier%20League&theatre=La+Liga']) {
    assert.equal(readChallenge(search).setup.clubScope, 'Premier League', search);
  }
  assert.equal(readChallenge('teams=clubs&theatre=domestic%3A826').setup.clubScope, 'domestic:826');
  assert.equal(readChallenge('?seed=+42+').setup.seed, '42', 'surrounding spaces are trimmed');
});

test('unknown values fall back to the defaults and are reported', () => {
  const cases = [
    ['sport=hockey', {}, ['sport']],
    ['sport=Football', {}, ['sport']],
    ['teams=martians', {}, ['teams']],
    ['theatre=Mars', {}, ['theatre']],
    ['teams=clubs&theatre=Mars', { layer: 'clubs' }, ['theatre']],
    ['draw=sometimes', {}, ['draw']],
    ['opponent=nobody', {}, ['opponent']],
    ['show=never', {}, ['show']],
    ['upsets=extreme&final=best-of-five&signings=anyone', {}, ['upsets', 'final', 'signings']],
    ['strengths=balanced', {}, ['strengths']],
    ['role=coach', {}, ['role']],
    ['season=fifa', {}, ['season']],
    ['seed=', {}, ['seed']],
    ['sport=&teams=&theatre=', {}, ['sport', 'teams', 'theatre']],
  ];
  for (const [search, patch, ignored] of cases) {
    assert.deepEqual(readChallenge(search), { found: true, setup: setupOf(patch), ignored }, search);
  }
  // The rest of the link still counts.
  assert.deepEqual(readChallenge('sport=hockey&theatre=CONMEBOL&draw=chaos&seed=5'),
    { found: true, setup: setupOf({ scope: 'CONMEBOL', pacing: 'chaos', seed: '5' }), ignored: ['sport'] });
});

test('stale values fall back: seasons, theatres and teams this build no longer offers', () => {
  const cases = [
    // A season that was never built in, another sport's season, a CM 01/02 database built on someone else's computer.
    ['season=ea-fifa-99', {}, ['season']],
    ['season=nba-2k20', {}, ['season']],
    ['sport=basketball&season=ea-fifa-18', { sport: 'basketball' }, ['season']],
    ['season=cm0102-2026-05', {}, ['season']],
    // A country map no longer shipped, a removed confederation, a league from another sport.
    ['teams=clubs&theatre=domestic:999', { layer: 'clubs' }, ['theatre']],
    ['theatre=OFC', {}, ['theatre']],
    ['sport=basketball&teams=clubs&theatre=Premier+League', { sport: 'basketball', layer: 'clubs', clubScope: 'domestic:nba' }, ['theatre']],
    // Country maps are built from the built-in clubs: with an earlier season the clubs play everywhere.
    ['teams=clubs&theatre=domestic:826&season=ea-fifa-18', { layer: 'clubs', dataSet: 'ea-fifa-18' }, ['theatre']],
    // American football has clubs only; its NFL map is its one theatre.
    ['sport=american-football&teams=nations&theatre=UEFA', { sport: 'american-football', layer: 'clubs', clubScope: 'domestic:nfl' },
      ['teams', 'theatre']],
    // An NBA season plays NBA clubs on its era's map.
    ['sport=basketball&season=nba-2k09&teams=nations', { sport: 'basketball', layer: 'clubs', clubScope: 'domestic:nba2009',
      dataSet: 'nba-2k09' }, ['teams']],
    // Team strengths is basketball's; only a manager names a team, and a team id is a plain id.
    ['strengths=competitive', {}, ['strengths']],
    ['team=276', {}, ['team']],
    ['role=manager&team=%3Cscript%3E', { role: 'manager' }, ['team']],
  ];
  for (const [search, patch, ignored] of cases) {
    assert.deepEqual(readChallenge(search), { found: true, setup: setupOf(patch), ignored }, search);
  }
  // A CM 01/02 season built on this computer is listed with the rest, and then a link to it works.
  const local = Object.freeze({ id: 'cm0102-2026-05', version: null, year: 2002, season: '2001/02', label: 'CM 01/02 · May 2026' });
  assert.equal(readChallenge('season=cm0102-2026-05', { sets: [...BUILT_IN_SETS, local] }).setup.dataSet, 'cm0102-2026-05');
});

test('a team is kept only once the theatre is known to field it', () => {
  const teams = [{ id: '076', name: 'Brazil' }, { id: '032', name: 'Argentina' }];
  assert.equal(fieldedTeam(setupOf({ managedTeamId: '076' }), teams), '076');
  assert.equal(fieldedTeam(setupOf({ managedTeamId: '276' }), teams), '', 'Germany plays no South American campaign');
  assert.equal(fieldedTeam(setupOf({ managedTeamId: '' }), teams), '');
  assert.equal(fieldedTeam(setupOf({ managedTeamId: '076' }), []), '');
  assert.equal(fieldedTeam(null, teams), '');
});

test('a link’s seed is the number the campaign launches with', () => {
  for (const seed of ['0', '1', '42', '3051207313', '4294967295']) {
    const read = readChallenge(`seed=${seed}`);
    assert.deepEqual(read.ignored, []);
    assert.equal(launchSeed(read.setup.seed), Number(seed));
  }
  assert.equal(readChallenge('seed=007').setup.seed, '7');
  for (const seed of ['-1', '1.5', '1e5', '4294967296', '99999999999', 'abc', '0x10', '½']) {
    assert.deepEqual(readChallenge(`seed=${encodeURIComponent(seed)}`), { found: true, setup: DEFAULT_SETUP, ignored: ['seed'] }, seed);
  }
  // Setup's blank seed launches App's opening seed: the link carries that number, and reading it launches it again.
  const shared = readChallenge(challengeQuery(setupOf({ seed: '' }), 2860311234)).setup;
  assert.equal(launchSeed(shared.seed), 2860311234);
});

test('the daily seed is fixed for each sport and day', () => {
  // Pinned: changing how a daily seed is made would change everyone's daily campaign mid-day.
  const sports = ['football', 'basketball', 'american-football', 'baseball'];
  assert.deepEqual(sports.map(sport => dailySeed(sport, '2026-11-01')), [2163291708, 382462174, 3840094371, 293440551]);
  assert.equal(dailySeed('football', '2026-11-02'), dailySeed('football', '2026-11-02'));
  assert.notEqual(dailySeed('football', '2026-11-02'), dailySeed('football', '2026-11-01'));
  const seeds = new Set();
  for (let day = 1; day <= 30; day++) for (const sport of sports) {
    const seed = dailySeed(sport, `2026-11-${String(day).padStart(2, '0')}`);
    assert.ok(Number.isInteger(seed) && seed >= 1 && seed <= 0xffffffff);
    seeds.add(seed);
  }
  assert.equal(seeds.size, 120, 'a month of dailies never repeats a seed');
  assert.equal(dailySeed('hockey', '2026-11-01'), dailySeed('football', '2026-11-01'), 'an unknown sport is the default sport');
});

test('the daily campaign is a short fixed setup per sport', () => {
  const day = '2026-11-01';
  assert.deepEqual(dailySetup('football', day), setupOf({ scope: 'elite', express: true, role: 'manager', seed: '2163291708' }));
  assert.deepEqual(dailySetup('basketball', day), setupOf({ sport: 'basketball', scope: 'elite', express: true, role: 'manager',
    seed: '382462174' }));
  assert.deepEqual(dailySetup('american-football', day), setupOf({ sport: 'american-football', layer: 'clubs', scope: 'elite',
    clubScope: 'domestic:nfl', express: true, role: 'manager', seed: '3840094371' }));
  assert.deepEqual(dailySetup('baseball', day), setupOf({ sport: 'baseball', scope: 'elite', express: true, role: 'manager',
    seed: '293440551' }));
  // It is still the daily with your own team, role, opponent choice and Show matches; not another day's or theatre.
  const daily = dailySetup('football', day);
  assert.ok(isDaily(daily, day));
  assert.ok(isDaily({ ...daily, managedTeamId: '276', targeting: 'player', express: false, resolution: 'instant' }, day));
  assert.ok(isDaily({ ...daily, role: 'spectator' }, day));
  assert.ok(!isDaily(daily, '2026-11-02'));
  assert.ok(!isDaily({ ...daily, scope: 'UEFA' }, day));
  assert.ok(!isDaily({ ...daily, finale: 'best-of-three' }, day));
  assert.ok(!isDaily(dailySetup('basketball', day), '2026-11-02'));
  assert.ok(!isDaily(daily, 'yesterday'));
  assert.ok(!isDaily(null, day));
  // A launched daily's settings (the seed as launched, the stamps of a campaign) are still the daily.
  assert.ok(isDaily({ ...daily, seed: String(2163291708), dataSet: null, managedTeamId: '250' }, day));
  // A shared daily reads back as the daily.
  assert.ok(isDaily(readChallenge(challengeQuery({ ...daily, managedTeamId: '250' })).setup, day));
});

test('days are the player’s own calendar days', () => {
  assert.equal(dayOf(new Date(2026, 10, 1, 0, 0)), '2026-11-01');
  assert.equal(dayOf(new Date(2026, 10, 1, 23, 59, 59)), '2026-11-01');
  assert.equal(dayOf(new Date(2026, 0, 9, 12)), '2026-01-09');
  assert.equal(dayOf(new Date(2026, 10, 1, 12).getTime()), '2026-11-01');
  assert.equal(dailyLabel('2026-11-01'), 'Sunday 1 November');
  assert.equal(dailyLabel('2027-02-28'), 'Sunday 28 February');
  assert.equal(dailyLabel('2026-12-25'), 'Friday 25 December');
  assert.equal(dailyLabel('not a day'), '');
});
