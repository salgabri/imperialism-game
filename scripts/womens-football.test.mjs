// Women's football (docs/design/womens-football.md): EA SPORTS FC's women's players on football's own rulebook, with
// nothing invented: nations short of eleven start short-handed, and a nation with no rated player fields no team.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CLUBS } from '../src/data/clubs.womens-football.js';
import { ROSTERS } from '../src/data/rosters.womens-football.js';
import { clubLogoFile } from '../src/data/clubLogos.js';
import { CLUB_SCOPES } from '../src/data/scopes.js';
import { buildClub, buildTeam, makeRng, NATIONS, selectLineup, teamEff, teamSportId } from '../src/data/teams.js';
import { getSport, SPORT_LIST } from '../src/sports/index.js';
import { football } from '../src/sports/football.js';
import { estimateWinProbability } from '../src/engine/odds.js';
import { builtInSeasonOf, fieldedNations } from '../src/engine/footballSets.js';
import { tacticalProfile } from '../src/engine/managerStrategy.js';
import { isLiveModel, liveModelFor } from '../src/engine/winProbability.js';
import { exportCampaign, parseCampaign } from '../src/engine/storage.js';
import { buildSetupModel, sportNote } from '../src/screens/setup/setupModel.js';
import { buildSquad } from '../src/viewModels/squad.js';
import { bundleComponents, syncAppFixture } from './lib/app-harness.mjs';

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const sport = getSport('womens-football');
const TABLE = JSON.parse(read('scripts/data/ea-women-leagues.json'));
const MAIN_LEAGUES = Object.values(TABLE.leagues).filter(league => league.main).map(league => league.name);
const teams = CLUBS.map(club => buildClub(club, sport));

test('the nations and the clubs rebuild byte for byte from the committed EA snapshot', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  assert.match(execFileSync(process.execPath, ['scripts/build-womens-football.mjs', '--check'], { cwd: root, encoding: 'utf8' }), /Verified/);
  const rows = read('scripts/data/ea-fc27-women.csv').trim().split('\n');
  assert.ok(rows.length > 1000, `${rows.length} players`);
});

test('every player is EA\'s, with its overall and its source', () => {
  const rows = read('scripts/data/ea-fc27-women.csv').trim().split('\n').slice(1);
  const overall = new Map(rows.map(row => {
    const cells = row.split('","').map(cell => cell.replace(/^"|"$/g, ''));
    return [`ea:${cells[0]}`, Number(cells[8])];
  }));
  for (const tuple of [...CLUBS.flatMap(club => club.squad), ...Object.values(ROSTERS).flatMap(roster => roster[2])]) {
    const [name, role, rating, source] = tuple;
    assert.ok(['GK', 'DF', 'MF', 'FW'].includes(role), name);
    assert.equal(source.source, 'ea-fc');
    assert.equal(source.edition, 'EA FC 27');
    assert.equal(overall.get(source.id), rating, `${name}: EA's overall`);
    assert.match(source.url, /^https:\/\/www\.ea\.com\/games\/ea-sports-fc\/ratings\/player-ratings\//);
  }
});

test('football\'s rulebook, with the women\'s own players', () => {
  for (const key of ['squadSize', 'formation', 'positionPlan', 'clock', 'tieBreak', 'labels', 'words', 'prepareMatch', 'sampleResult', 'simulate']) {
    assert.equal(sport[key], football[key], key);
  }
  assert.notEqual(sport.rosters, football.rosters);
  assert.notEqual(sport.clubs, football.clubs);
  assert.equal(sport.name, "Women's football");
  assert.equal(builtInSeasonOf('womens-football').season, '2026/27');
  const nation = buildTeam('724', makeRng(1), sport);
  assert.equal(teamSportId(nation), 'womens-football');
  assert.ok(selectLineup(nation).starters.every(player => player.name && !player.gen));
  assert.ok(tacticalProfile({ ...nation, squad: [...nation.squad, { name: 'Bench', pos: 'FW', rating: 80 }] }).attack > 0, 'the bench counts as in football');
});

test('a nation short of eleven starts short-handed, and nothing is invented', () => {
  for (const id of Object.keys(ROSTERS)) {
    const team = buildTeam(id, makeRng(7), sport);
    assert.ok(team.squad.every(player => !player.gen), `${team.name} has no generated player`);
    assert.equal(team.squad.length, ROSTERS[id][2].length, `${team.name} fields only its rated players`);
    assert.ok(team.squad.length <= 11);
  }
  const morocco = buildTeam('504', makeRng(7), sport);
  assert.ok(fieldedNations(sport).includes('504'), 'seven rated players: half an XI and more, so Morocco plays');
  assert.ok(morocco.squad.length === 7 && morocco.squad.some(player => /Saoud/.test(player.name)), 'Morocco has Saoud and six others');
  const lineup = selectLineup(morocco);
  assert.ok(lineup.slots.some(slot => !slot.player && slot.effectiveRating === 40), 'an empty shirt counts 40');
  assert.ok(teamEff(morocco) < teamEff(buildTeam('724', makeRng(7), sport)), 'short-handed');
  const squad = buildSquad({ teams: { [morocco.id]: morocco }, aliveIds: [morocco.id], history: [] }, { sport }, morocco.id);
  assert.ok(squad.notes.some(note => /Source data covers/.test(note)), 'the squad screen says so');
});

test('a nation without half an XI of rated players fields no team and her land stays neutral', () => {
  const fielded = fieldedNations(sport);
  assert.deepEqual(fielded.slice().sort(), Object.keys(ROSTERS).filter(id => ROSTERS[id][2].length >= 6).sort());
  assert.ok(fielded.length < Object.keys(ROSTERS).length);
  for (const id of ['826', 'SCO', 'WAL']) assert.ok(fielded.includes(id), `${NATIONS[id][0]} plays on her own`);
  assert.ok(Object.hasOwn(ROSTERS, 'NIR') && !fielded.includes('NIR'), 'Northern Ireland\'s four rated players field no team');
  assert.ok(ROSTERS['894'][2].some(player => /Banda/.test(player[0])) && !fielded.includes('894'),
    'nor do Zambia\'s three, Barbra Banda among them');
  assert.ok(!Object.hasOwn(ROSTERS, '004') && !fielded.includes('004'), 'Afghanistan has no team');
  assert.deepEqual(['724', '826', '250', '276', '840'].filter(id => ROSTERS[id][0] >= 84).length, 5, 'the big five lead');
  const best = Object.entries(ROSTERS).sort((a, b) => b[1][0] - a[1][0])[0];
  assert.equal(best[0], '724', 'Spain');
});

test('the clubs: five leagues of their own, and EA\'s other clubs together', () => {
  assert.deepEqual([...new Set(CLUBS.map(club => club.league))].sort(), [...MAIN_LEAGUES, TABLE.rest].sort());
  assert.equal(new Set(CLUBS.map(club => club.id)).size, CLUBS.length);
  assert.equal(new Set(CLUBS.map(club => club.code)).size, CLUBS.length);
  const countries = { [MAIN_LEAGUES[0]]: '826', NWSL: '840', 'Liga F': '724', 'Frauen-Bundesliga': '276', 'Première Ligue': '250' };
  for (const club of CLUBS) {
    assert.match(club.id, /^w-[a-z0-9-]+$/);
    assert.match(club.code, /^[\p{Lu}0-9]{3}$/u);
    assert.equal(club.squad.length, 11, club.name);
    assert.ok(club.squad.some(([, role]) => role === 'GK'), `${club.name} has a goalkeeper`);
    if (countries[club.league]) assert.equal(club.country, countries[club.league], club.name);
  }
  assert.ok(CLUBS.filter(club => club.league === TABLE.rest).some(club => club.name === 'Juventus'));
  assert.ok(CLUBS.some(club => club.name === 'BK Häcken'), 'a garbled EA name, put right');
  assert.ok(CLUBS.some(club => club.name === 'Tottenham Hotspur') && !CLUBS.some(club => club.name === 'Spurs'));
  const scopes = CLUB_SCOPES(sport);
  assert.deepEqual(scopes.slice(0, 2).map(scope => scope.id), ['all', 'elite']);
  for (const league of MAIN_LEAGUES) assert.ok(scopes.some(scope => scope.id === league), league);
});

test('a club wears its men\'s club\'s crest, or its own', () => {
  assert.equal(clubLogoFile('w-arsenal'), clubLogoFile('f-arsenal'), 'Arsenal is Arsenal');
  assert.equal(clubLogoFile('w-fc-barcelona'), clubLogoFile('f-fc-barcelona'));
  assert.equal(clubLogoFile('w-gotham-fc'), 'w-gotham-fc', 'Gotham FC has no men\'s side');
  assert.equal(clubLogoFile('w-ol-lyonnes'), 'w-ol-lyonnes', 'OL Lyonnes has its own crest');
  const withCrest = CLUBS.filter(club => clubLogoFile(club.id));
  assert.ok(withCrest.length >= CLUBS.length - 6, `${withCrest.length} of ${CLUBS.length}`);
});

test('matches play as football\'s do: goals, penalties and a live chart', () => {
  const rng = makeRng(20261107);
  let goals = 0, games = 0, shootouts = 0;
  const league = teams.filter(team => team.conf === "Women's Super League");
  for (let i = 0; i < 2000; i++) {
    const a = league[i % league.length], d = league[(i * 5 + 3) % league.length];
    if (a === d) continue;
    const result = sport.simulate(rng, a, d, 6, teamEff(a), teamEff(d));
    assert.ok(result.winner === a.id || result.winner === d.id);
    assert.equal(result.ev.length, result.ga + result.gd, 'the feed adds up');
    goals += result.ga + result.gd;
    if (result.tie) shootouts++;
    games++;
  }
  assert.ok(goals / games > 2.3 && goals / games < 3.8, `${goals / games} goals a game`);
  assert.ok(shootouts / games > 0.12 && shootouts / games < 0.32, `${shootouts / games} level after ninety`);
  const model = liveModelFor(sport, teams[0], teams[1]);
  assert.ok(isLiveModel(model));
  assert.equal(model.kind, 'poisson');
  const odds = estimateWinProbability({ sport, attacker: teams[0], defender: teams.at(-1), preset: 'balanced', samples: 3000 }).attacker;
  assert.ok(odds > 0.7, `the best club against the weakest (${odds})`);
});

test('setup lists women\'s football after football, with nations and clubs on the built-in season', () => {
  assert.deepEqual(SPORT_LIST.map(item => item.id).slice(0, 2), ['football', 'womens-football']);
  assert.match(sportNote(sport), /^Nations · \d+ clubs from 6 leagues$/);
  const nations = buildSetupModel({ sport: 'womens-football', layer: 'nations', scope: 'UEFA' }, {});
  assert.equal(nations.sport.name, "Women's football");
  assert.deepEqual(nations.season.options.map(option => option.name), ['2026/27']);
  assert.match(nations.season.note, /short-handed/);
  assert.ok(nations.scopes.every(scope => scope.count >= 1), JSON.stringify(nations.scopes.map(scope => [scope.id, scope.count])));
  assert.equal(nations.scopes.find(scope => scope.id === 'world').count, Object.values(ROSTERS).filter(([, , players]) => players.length >= 6).length);
  const clubs = buildSetupModel({ sport: 'womens-football', layer: 'clubs', clubScope: 'NWSL' }, {});
  assert.equal(clubs.scopes.find(scope => scope.id === 'NWSL').count, 16);
  assert.equal(clubs.domesticScopes.length, 0, 'no country maps: those hold the men\'s clubs');
});

test('the squad screen is football\'s pitch and 4-4-2', () => {
  const team = { ...buildTeam('724', makeRng(2), sport) };
  const squad = buildSquad({ teams: { [team.id]: team }, aliveIds: [team.id], history: [] }, { sport }, team.id);
  assert.equal(squad.layout, 'pitch');
  assert.equal(squad.formation, '4-4-2');
  assert.equal(squad.sport, 'womens-football');
  assert.deepEqual(squad.profile.map(row => row.label), ['Attack', 'Defence', 'Goalkeeping']);
  assert.ok(squad.groups.flatMap(group => group.rows).every(row => row.source === 'EA FC 27'));
});

const B = await bundleComponents({ App: 'src/App.jsx' }, { jsx: 'automatic' });

test('women\'s football launches with nations, leaves unrated nations out, and saves', () => {
  const ids = ['724', '250', '276', '826', '380', '004'];
  const f = syncAppFixture({ App: B.App, phase: 'setup', ids,
    settings: { sport: 'football', layer: 'nations', scope: 'UEFA', clubScope: 'all', role: 'spectator', seed: '11' } });
  f.app.opening = B.App.prototype.opening;
  try {
    const { app } = f;
    app.pickSetup('sport', 'womens-football');
    assert.equal(app.state.setup.sport, 'womens-football');
    app.pickSetup('scope', 'world');
    app.startCampaign();
    const { state } = app;
    assert.equal(state.phase, 'playing');
    assert.equal(state.campaignName.startsWith("Women's football"), true);
    assert.ok(Object.values(state.teams).every(team => team.sport === 'womens-football'));
    assert.ok(!state.teams['004'], 'Afghanistan fields no team');
    assert.ok(state.teams['724'].squad.every(player => player.sourceInfo?.source === 'ea-fc'));
    const saved = parseCampaign(exportCampaign(state));
    assert.equal(saved.settings.sport, 'womens-football');
    assert.equal(Object.keys(saved.teams).length, Object.keys(state.teams).length);
    app.openSetup();
    app.pickSetup('sport', 'football');
    assert.equal(app.state.setup.sport, 'football');
  } finally {
    f.close();
  }
});
