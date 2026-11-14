// The computed women's seasons before EA rated women (docs/design/womens-football.md, "Computed seasons"): the women's
// World Cups of 1991, 1995 and 2003 to 2015 and the Olympic tournaments of 1996 and 2004 to 2012, rated as the men's computed
// World Cups are. The Elo's constants and its cross-check against FIFA's women's ranking, the Olympic pages' readers,
// the committed facts and seasons rebuilt byte for byte, history's spot checks, the tie-break and the names each season
// plays, the loader's refusals, and a 2012 campaign launched as Great Britain, saved and resumed without the season's file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SAVE_KEY } from '../src/config.js';
import { HOME_NATIONS, NATIONS, nationIdentity } from '../src/data/teams.js';
import { BUILT_IN_WOMENS_SEASONS } from '../src/data/womensFootballSeasons.js';
import {
  BUILT_IN_SETS, decodeFootballSet, fieldedNations, seasonSport, setHasClubs, setHasNations, setKindOf, setSportOf,
} from '../src/engine/footballSets.js';
import { footballRate, footballWinProbability } from '../src/engine/winProbability.js';
import { parseCampaign } from '../src/engine/storage.js';
import { loadSportData } from '../src/sports/sportData.js';
import { matchSport } from '../src/sports/index.js';
import { readChallenge } from '../src/screens/setup/challenge.js';
import { SEASON_NOTES, buildSetupModel } from '../src/screens/setup/setupModel.js';
import { sourceLabel, sourceTitle, sourceUrl } from '../src/viewModels/squad.js';
import { expectedScore, kFactor } from './lib/football-elo.mjs';
import { elevenRatings, orderEleven, pickEleven } from './lib/world-cup-seasons.mjs';
import { matchName, nameMatch, olympicSquads, rsssfLineups, shareWord, spellings, wikipediaLineups } from './lib/womens-tournament-facts.mjs';
import { bundleComponents, syncAppFixture } from './lib/app-harness.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = file => readFileSync(path.join(root, file), 'utf8');
const MANIFEST = JSON.parse(read('scripts/data/womens-tournament-seasons.json'));
const MEN = JSON.parse(read('scripts/data/world-cup-seasons.json'));
const IDS = ['wwc-2015', 'wol-2012', 'wwc-2011', 'wol-2008', 'wwc-2007', 'wol-2004', 'wwc-2003', 'wol-1996', 'wwc-1995', 'wwc-1991'];
const committed = id => JSON.parse(read(`public/womens-football/${id}.json`));
const names = (doc, id) => doc.nations[id][2].map(([name]) => name);
const mean = xs => xs.reduce((sum, x) => sum + x, 0) / xs.length;
await loadSportData('womens-football');

// ---------- the method ----------

test('Elo: the men\'s engine and constants, the women\'s tournaments\' names; the Olympic tournament weighs as the World Cup', () => {
  const { k } = MANIFEST.elo;
  assert.deepEqual(['FIFA World Cup', 'Olympic Games', 'UEFA Euro', 'AFC Championship', 'African Championship', 'CONCACAF Gold Cup',
    'FIFA World Cup qualification', 'AFC Olympic Qualifying Tournament', 'CONCACAF Pre-Olympic Tournament', 'Friendly', 'Algarve Cup', 'Cyprus Cup']
    .map(tournament => kFactor(tournament, k)), [60, 60, 50, 50, 50, 50, 40, 40, 40, 20, 30, 30]);
  // Every other constant is the men's computed World Cup seasons'.
  const { k: _women, start: womenStart, ...women } = MANIFEST.elo;
  const { k: _men, start: menStart, ...men } = MEN.elo;
  assert.deepEqual(women, men);
  assert.deepEqual({ ...womenStart, rule: null }, { ...menStart, rule: null });
  assert.deepEqual([MANIFEST.xi, MANIFEST.awards, MANIFEST.strength.perHundredElo, MANIFEST.strength.rule], [MEN.xi, MEN.awards, 3.2, MEN.strength.rule]);
});

test('the constants: the scale\'s top is the built-in women\'s strongest, 3.2 points per 100 Elo, and the women\'s XI profile', () => {
  assert.equal(MANIFEST.strength.best, 88, 'Spain, EA FC 27');
  for (const gap of [50, 100, 200, 300]) {
    const delta = MANIFEST.strength.perHundredElo * gap / 100;
    const game = footballWinProbability({ rA: footballRate(0.075 * delta), rD: footballRate(-0.075 * delta), remaining: 1 });
    assert.ok(Math.abs(game - expectedScore(gap)) < 0.01, `${gap} Elo: ${game} against ${expectedScore(gap)}`);
  }
  const { profile } = MANIFEST;
  assert.deepEqual(profile, [4.9, 2.6, 1.9, 1.2, 0.3, -0.2, -0.7, -1.3, -1.7, -2.7, -4.3]);
  assert.ok(profile.every((d, i) => !i || d < profile[i - 1]), 'strictly falling');
  assert.ok(Math.abs(profile.reduce((sum, d) => sum + d, 0)) < 1e-9, 'sums to 0');
  for (let t = 50; t <= 88; t += 0.017) {
    const ratings = elevenRatings(t, profile);
    assert.ok(ratings.every((r, i) => !i || r <= ratings[i - 1]), String(t));
    assert.ok(Math.abs(mean(ratings) - t) <= 1 / 22 + 1e-9, `${t}: mean ${mean(ratings)}`);
  }
  assert.deepEqual(elevenRatings(88, profile), [93, 91, 90, 89, 88, 88, 87, 87, 86, 85, 84]);
});

test('the XI where the line-ups give no minutes (1996): starts, then appearances; ordered by goals an appearance', () => {
  const player = (id, position, starts, apps, goals = 0) => ({ id, name: id, shirt: Number(id.slice(2)), position, starts, apps, goals, awards: [] });
  const squad = [player('P-01', 'GK', 5, 5), player('P-02', 'GK', 0, 0), ...[3, 4, 5, 6].map(n => player(`P-0${n}`, 'DF', 5, 5)),
    player('P-07', 'DF', 0, 2), ...[8, 9, 10, 11].map(n => player(n < 10 ? `P-0${n}` : `P-${n}`, 'MF', 4, 5)),
    player('P-12', 'FW', 5, 5, 3), player('P-13', 'FW', 1, 4, 1), player('P-14', 'FW', 0, 3, 2), player('P-15', 'MF', 0, 0)];
  const { eleven } = pickEleven(squad, MANIFEST.xi);
  assert.deepEqual(eleven.map(p => p.id), ['P-01', 'P-03', 'P-04', 'P-05', 'P-06', 'P-08', 'P-09', 'P-10', 'P-11', 'P-12', 'P-13']);
  // A substitute who never started still played, before one who never came on.
  assert.deepEqual(pickEleven(squad.filter(p => p.id !== 'P-13'), MANIFEST.xi).eleven.at(-1).id, 'P-14');
  const order = orderEleven(eleven, MANIFEST.awards).map(p => p.id);
  assert.deepEqual(order.slice(0, 2), ['P-12', 'P-13'], '3 goals in 5 games, then 1 in 4');
});

// ---------- the sources ----------

test('every source is pinned, and the computed Elo agrees with FIFA\'s women\'s ranking', () => {
  const { worldCup, results, crossCheck, wikipedia, rsssf } = MANIFEST.sources;
  assert.deepEqual(worldCup, MEN.sources.worldCup, 'the men\'s World Cup seasons\' database, which holds the women\'s World Cups too');
  assert.equal(results.commit, 'd2aa1d5e5337881481b04844339f8a43a5f132f2');
  assert.match(crossCheck.commit, /^[0-9a-f]{40}$/);
  for (const file of [...results.files, ...crossCheck.files, ...wikipedia.pages, ...rsssf.pages]) {
    assert.match(file.sha256, /^[0-9a-f]{64}$/, file.name ?? file.file);
    assert.ok(Number.isInteger(file.bytes) && file.bytes > 0);
  }
  for (const page of wikipedia.pages) assert.ok(Number.isInteger(page.revision) && page.revision > 0, page.title);
  const check = JSON.parse(read('scripts/data/womens-tournament-seasons/elo-crosscheck.json'));
  assert.equal(check.releases.length, 52, 'every release from July 2003 to December 2015');
  assert.ok(check.mean.spearmanTop48 >= 0.85 && check.mean.spearmanTop20 >= 0.95 && check.mean.pearson >= 0.75, JSON.stringify(check.mean));
  // FIFA published nothing before July 2003: the 1990s' seasons have no release to check against.
  assert.deepEqual(Object.keys(check.seasons).sort(), IDS.filter(id => Number(id.slice(4)) >= 2003).sort());
});

test('the facts rebuild byte for byte from the pinned sources (when they are in data-src/)', t => {
  const { worldCup, results, crossCheck, wikipedia, rsssf } = MANIFEST.sources;
  const files = [...[worldCup, results, crossCheck].flatMap(source => source.files.map(f => [source.folder, f.name])),
    ...wikipedia.pages.map(p => [wikipedia.folder, p.file]), ...rsssf.pages.map(p => [rsssf.folder, p.file])];
  const missing = files.filter(([folder, name]) => !existsSync(path.join(root, 'data-src', folder, name)));
  if (missing.length) {
    t.skip(`sources not in data-src/: ${missing.slice(0, 3).map(([folder, name]) => `${folder}/${name}`).join(', ')}${missing.length > 3 ? ', …' : ''}`);
    return;
  }
  const run = spawnSync(process.execPath, [path.join(root, 'scripts/sync-womens-tournament-seasons.mjs'), '--check'], { cwd: root, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /12 files rebuild byte for byte/);
});

// ---------- the Olympic pages' readers ----------

test('RSSSF\'s three layouts: starters, substitutes and their minutes, a chain of them, a minute without its space', () => {
  const surnames = rsssfLineups(['21 July 1996 Orlando, Florida', 'UNITED STATES 3 (Venturini, Hamm, Milbrett)', 'DENMARK       0',
    'USA: Scurry - Overbeck, Chastain, Fawcett, MacMillan, Foudy, Venturini,', '     Lilly, Hamm(Gabarra), Milbrett(Roberts), Akers(Parlow).',
    'Denmark: Larsen - B.Madsen, Flaeng, Holm, C.Pedersen, Kolding(Laursen),', '         Christensen, Krogh(Bonde), L.Madsen(Jensen), Terp, Nielsen.'].join('\n'), 'surnames', 1996);
  assert.equal(surnames.length, 1);
  assert.equal(surnames[0].date, '1996-07-21');
  const usa = surnames[0].sides[0];
  assert.equal(usa.label, 'USA');
  assert.deepEqual(usa.players.filter(p => p.started).map(p => p.token), ['Scurry', 'Overbeck', 'Chastain', 'Fawcett', 'MacMillan', 'Foudy',
    'Venturini', 'Lilly', 'Hamm', 'Milbrett', 'Akers']);
  assert.deepEqual(usa.players.filter(p => !p.started).map(p => [p.token, p.on]), [['Gabarra', null], ['Roberts', null], ['Parlow', null]]);

  const caps = rsssfLineups(['[Aug 11]', 'Sweden        0-1    Japan                Stadium: Panthessaliko (Volos )',
    'SWE:   JOENSSON Caroline, WESTBERG Karolina, TOERNQVIST Jane, MARKLUND Hanna, BENGTSSON Kristin, MOSTROEM Malin, OESTBERG Frida, ANDERSSON Malin (SJOESTROEM Anna 57), LJUNGBERG Hanna, SVENSSON Victoria, SJOEGRAN Therese (OLSSON Salina84).',
    'JAP:   YAMAGO Nozomi, ISOZAKI Hiromi, KAWAKAMI Naoko, SAKAI Tomoe, MIYAMOTO Tomomi, ARAKAWA Eriko (MARUYAMA Karina 66), SAWA Homare, OTANI Mio, YAMAGISHI Yasuyo, SHIMOKOZURU Aya, KOBAYASHI Yayoi (ANDO Kozue 56 (YANAGITA Miyuki 85)).',
    '[Aug 23, 2004]', 'USA           2-1aet Germany                    Stadium: Pankritio (Heraklio)',
    'USA:   A1, A2, A3, A4, A5, A6, A7, A8, A9, A10, A11.',
    'GER:   B1, B2, B3, B4, WUNDERLICH Pia, (BACHOR Isabell 39), B6, B7, B8, B9, B10, B11.'].join('\n'), 'caps', 2004);
  assert.deepEqual(caps.map(box => [box.date, box.aet]), [['2004-08-11', false], ['2004-08-23', true]]);
  const japan = caps[0].sides[1].players;
  assert.deepEqual(japan.slice(-3).map(p => [p.token, p.started, p.on, p.off]),
    [['KOBAYASHI Yayoi', true, null, 56], ['ANDO Kozue', false, 56, 85], ['YANAGITA Miyuki', false, 85, null]], 'a chain of substitutes');
  assert.deepEqual(caps[0].sides[0].players.at(-1), { token: 'OLSSON Salina', shirt: null, started: false, on: 84, off: null }, '"Salina84"');
  const germany = caps[1].sides[1].players;
  assert.deepEqual([germany[4].off, germany[5].token, germany[5].on], [39, 'BACHOR Isabell', 39], 'a substitute the commas cut from her starter');

  const numbered = rsssfLineups(['[Aug 12]', 'In Tianjin (Tianjin Olympic Sports Center Stadium)', 'Canada 2 (Chapman 27)', 'Sweden 0',
    '[After extra-time]', 'CAN: 18-Erin McLeod; 7-Rhian Wilkinson, 9-Candace Chapman, 10-Martina', '     Franko, 3-Emily Zurrer; 4-Clare Rustad, 8-Diana Matheson',
    '     (17-Brittany Timko 80), 6-Sophie Schmidt, 15-Kara Lang; 14-Melissa', '     Tancredi (2-Jodi-Ann Robinson 42; 16-Jonelle Filigno 83),', '     12-Christine Sinclair ©.',
    'Coach: Even Pellerud (Norway).', 'SWE: 1-A; 2-B, 3-C, 4-D, 5-E; 6-F, 7-G, 8-H, 9-I; 10-J, 11-K.'].join('\n'), 'numbered', 2008);
  assert.equal(numbered[0].aet, true);
  const canada = numbered[0].sides[0].players;
  assert.deepEqual(canada.filter(p => p.started).map(p => p.shirt), [18, 7, 9, 10, 3, 4, 8, 6, 15, 14, 12]);
  assert.deepEqual(canada.filter(p => !p.started).map(p => [p.shirt, p.token, p.on, p.off]),
    [[17, 'Brittany Timko', 80, null], [2, 'Jodi-Ann Robinson', 42, 83], [16, 'Jonelle Filigno', 83, null]]);
  assert.throws(() => rsssfLineups('[Aug 6]\nIn Tianjin\nCAN: 1-A; 2-B, 3-C.', 'numbered', 2008), /3 starters/);
});

// The pages are downloads in data-src/, which CI does not have. node:test reads a test's options only before its
// function: after it they are ignored, and the test runs and fails without the pages.
const OLYMPIC_PAGES_HERE = ['2012-squads.html', '2012-knockout.html']
  .every(page => existsSync(path.join(root, 'data-src/wikipedia-womens-olympics', page)));
test('Wikipedia\'s pages: squads with their unenrolled alternates, and line-ups with every substitution\'s minute', {
  skip: !OLYMPIC_PAGES_HERE && 'the pages are not in data-src/',
}, () => {
  const html = read('data-src/wikipedia-womens-olympics/2012-squads.html');
  const britain = olympicSquads(html).find(squad => squad.team === 'Great Britain');
  assert.ok(britain.players.some(p => p.name === 'Kim Little' && p.shirt === 12 && p.position === 'FW' && !p.alternate));
  assert.ok(britain.players.filter(p => p.alternate).length >= 2);
  const final = wikipediaLineups(read('data-src/wikipedia-womens-olympics/2012-knockout.html'))
    .find(box => box.date === '2012-08-09' && box.sides[1].label === 'Japan');
  assert.equal(final.aet, false);
  assert.equal(final.sides[1].label, 'Japan');
  assert.deepEqual(final.sides[1].players.filter(p => !p.started).map(p => [p.token, p.on]), [['Asuna Tanaka', 59], ['Mana Iwabuchi', 77], ['Karina Maruyama', 86]]);
});

test('a line-up\'s name is a squad player\'s by the same words, her surname or her initial; RSSSF\'s ASCII spellings too', () => {
  const squad = ['Caroline Jönsson', 'Malin Moström', 'Ann Kristin Aarønes', 'Bonny Madsen', 'Lene Madsen', 'Marlene Sandoval', 'Lisa De Vanna',
    'Birgit Prinz'].map((name, i) => ({ name, shirt: i + 1 }));
  assert.equal(matchName('JOENSSON Caroline', squad).name, 'Caroline Jönsson');
  assert.equal(matchName('MOSTROEM Malin', squad).name, 'Malin Moström');
  assert.equal(matchName('Aarones', squad).name, 'Ann Kristin Aarønes');
  assert.equal(matchName('B.Madsen', squad).name, 'Bonny Madsen');
  assert.equal(matchName('Madsen', squad), null, 'two Madsens');
  assert.deepEqual(nameMatch('SANDOVAL Rubi', squad), { player: squad[5], rule: 'surname' }, 'the capitals are her surname');
  assert.equal(matchName('DE VANNA Lisa', squad).name, 'Lisa De Vanna');
  assert.equal(matchName('Prinz', squad).name, 'Birgit Prinz');
  assert.deepEqual(spellings('Sjöström'), ['sjostrom', 'sjoestroem']);
  assert.ok(shareWord('Maria Quinones', 'Florencia Quiñones') && !shareWord('Njoya Nkout', 'Ajara Nchout'));
});

test('the reviewed names: every line-up name no rule matches is reviewed by hand, and listed with every looser match', () => {
  for (const entry of MANIFEST.names.lineupSpellings) {
    assert.match(entry.key, /^\d{4}\|[^|]+\|\d*\|.+$/);
    assert.ok(Number.isInteger(entry.shirt) && entry.why, entry.key);
  }
  for (const entry of MANIFEST.names.lineupErrors) assert.ok(entry.skip === true && entry.why, entry.key);
  const listed = JSON.parse(read('scripts/data/womens-tournament-seasons/lineup-names.json')).seasons;
  const reviewed = Object.values(listed).flat().filter(line => line.endsWith('(reviewed)'));
  assert.equal(reviewed.length, MANIFEST.names.lineupSpellings.length);
  assert.ok(listed['wol-1996'].includes('1996|Denmark||Pedersen → 6 Christina Petersen (reviewed)'),
    'she started the other two matches; Merete Pedersen came on in one');
  assert.ok(listed['wol-2012'].includes('2012|Colombia|18|Sandra Sepulveda → 12 Sandra Sepúlveda (name, not number)'));
});

// ---------- the seasons ----------

test('the ten seasons are built in after EA\'s, labelled computed, each its committed file', () => {
  const computed = BUILT_IN_WOMENS_SEASONS.filter(set => !set.id.startsWith('eaw-'));
  assert.deepEqual(computed.map(set => [set.id, set.season, set.label]), [
    ['wwc-2015', '2014/15', 'Computed · 2015 World Cup'], ['wol-2012', '2012/13', 'Computed · 2012 Olympics'],
    ['wwc-2011', '2010/11', 'Computed · 2011 World Cup'], ['wol-2008', '2008/09', 'Computed · 2008 Olympics'],
    ['wwc-2007', '2007/08', 'Computed · 2007 World Cup'], ['wol-2004', '2004/05', 'Computed · 2004 Olympics'],
    ['wwc-2003', '2003/04', 'Computed · 2003 World Cup'], ['wol-1996', '1996/97', 'Computed · 1996 Olympics'],
    ['wwc-1995', '1994/95', 'Computed · 1995 World Cup'], ['wwc-1991', '1991/92', 'Computed · 1991 World Cup']]);
  assert.deepEqual(BUILT_IN_WOMENS_SEASONS.slice(-computed.length), computed, 'after EA\'s, newest first');
  for (const listed of computed) {
    assert.deepEqual(BUILT_IN_SETS.find(set => set.id === listed.id), listed);
    assert.equal(setSportOf(listed.id), 'womens-football');
    assert.equal(setKindOf(listed.id), listed.id.slice(0, 3));
    assert.ok(setHasNations(listed.id) && !setHasClubs(listed.id), 'nations only');
    assert.equal(committed(listed.id).version, listed.version);
  }
  assert.match(SEASON_NOTES['womens-football'], /World Cups of 1991, 1995 and 2003 to 2015 and the Olympic tournaments of 1996 and 2004 to 2012 are computed/);
});

test('every season rebuilds byte for byte from its committed facts, with its credits', () => {
  const run = spawnSync(process.execPath, [path.join(root, 'scripts/build-womens-tournament-seasons.mjs'), '--check'], { cwd: root, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /13 files rebuild byte for byte/);
  const credits = read('public/womens-football/ATTRIBUTION-computed.txt');
  assert.match(credits, /CC BY-SA 4\.0/);
  assert.match(credits, /Joshua C\. Fjelstul/);
  assert.match(credits, /RSSSF/);
  assert.match(credits, /Macario Reyes/);
  for (const page of MANIFEST.sources.wikipedia.pages) assert.ok(credits.includes(`revision ${page.revision}`), page.title);
});

test('each season decodes: its finalists, eleven players each, rated 1–99 strongest first, from its Elo the day after the final', () => {
  const counts = { 'wwc-2015': 24, 'wol-2012': 12, 'wwc-2011': 16, 'wol-2008': 12, 'wwc-2007': 16, 'wol-2004': 10, 'wwc-2003': 16, 'wol-1996': 8,
    'wwc-1995': 12, 'wwc-1991': 12 };
  for (const id of IDS) {
    const doc = committed(id);
    const set = decodeFootballSet(doc, id);
    const sport = seasonSport(set);
    assert.equal(sport.id, 'womens-football');
    assert.equal(Object.keys(doc.nations).length, counts[id], id);
    assert.equal(fieldedNations(sport).length, counts[id], `${id}: every finalist fields its side, no one else`);
    assert.equal(doc.source.computed, true);
    assert.equal(doc.source.rawScale, 'Elo');
    const final = id.startsWith('wwc') ? null : MANIFEST.seasons.find(season => season.id === id).final;
    if (final) assert.equal(doc.source.snapshotDate > final, true);
    for (const [nation, [strength, size, eleven]] of Object.entries(doc.nations)) {
      assert.equal(eleven.length, 11, `${id} ${NATIONS[nation][0]}`);
      assert.ok(size >= 11 && strength >= 50 && strength <= 88);
      for (const [, , rating, source] of eleven) {
        assert.ok(rating >= 1 && rating <= 99);
        assert.equal(source.snapshotDate, doc.source.snapshotDate);
        assert.equal(source.source, id.startsWith('wwc') ? 'world-cup' : 'olympics');
        if (id === 'wol-1996') assert.ok(source.minutes === undefined && source.apps >= 1, 'RSSSF gives 1996\'s line-ups no minutes');
        else assert.ok(Number.isInteger(source.minutes) && source.apps === undefined);
      }
    }
  }
});

test('spot checks: each season\'s strongest nations are its champions and runners-up, and its first players its stars', () => {
  const top = id => Object.entries(committed(id).nations).sort((a, b) => b[1][0] - a[1][0]).slice(0, 2).map(([nation]) => nation);
  assert.deepEqual(top('wwc-1991')[0], '840', 'the United States, the champions');
  assert.deepEqual(top('wwc-1995')[0], '578', 'Norway, the champions');
  assert.deepEqual(top('wwc-2003')[0], '276', 'Germany, the champions');
  assert.deepEqual(top('wwc-2015')[0], '840');
  assert.deepEqual(top('wol-2004'), ['276', '840']);
  assert.equal(names(committed('wwc-1991'), '840')[0], 'Michelle Akers');
  assert.equal(names(committed('wwc-1995'), '578')[0], 'Hege Riise');
  assert.equal(names(committed('wwc-2003'), '276')[0], 'Birgit Prinz');
  assert.equal(names(committed('wwc-2007'), '076')[0], 'Marta');
  assert.equal(names(committed('wwc-2011'), '392')[0], 'Homare Sawa');
  assert.equal(names(committed('wwc-2015'), '840')[0], 'Carli Lloyd');
  assert.equal(names(committed('wol-2004'), '276')[0], 'Birgit Prinz');
  assert.equal(names(committed('wol-2012'), '840')[0], 'Abby Wambach');
  assert.ok(names(committed('wol-2008'), '076').includes('Marta'));
  // 1996, with no minutes: three goals in five games put MacMillan, who started four, first.
  const [macMillan] = committed('wol-1996').nations['840'][2];
  assert.deepEqual([macMillan[0], macMillan[3].starts, macMillan[3].apps, macMillan[3].goals], ['Shannon MacMillan', 4, 5, 3]);
});

test('each season plays its day\'s tie-break, on that year\'s map, under the names it played as', () => {
  for (const id of IDS) {
    const listed = BUILT_IN_WOMENS_SEASONS.find(set => set.id === id);
    const rules = matchSport({ sport: 'womens-football', dataSet: id, dataYear: listed.year }).prepareMatch({ squad: [] }, { squad: [] }, 70, 70).rules.id;
    assert.equal(rules, ['wwc-2003', 'wol-1996'].includes(id) ? 'golden' : 'penalties', id);
  }
  // Great Britain at the 2012 Olympic tournament: the United Kingdom's shape, the home nations' land, its own name and flag.
  const doc = committed('wol-2012');
  assert.deepEqual(doc.identities, { 826: { name: 'Great Britain', code: 'GBR', flagId: 'GBR' } });
  assert.deepEqual(HOME_NATIONS.map(id => doc.territory.merged[id]), ['826', '826', '826']);
  const sport = seasonSport(decodeFootballSet(doc, 'wol-2012'));
  assert.deepEqual(nationIdentity('826', sport), { name: 'Great Britain', code: 'GBR', flagId: 'GBR' });
  assert.ok(['Steph Houghton', 'Casey Stoney', 'Karen Bardsley'].every(name => names(doc, '826').includes(name)), 'Great Britain\'s own squad');
  // England is England at the World Cups.
  assert.deepEqual(nationIdentity('826', seasonSport(decodeFootballSet(committed('wwc-2015'), 'wwc-2015'))).name, 'England');
  // A challenge link names a computed season; it plays nations only.
  const link = readChallenge('sport=womens-football&season=wol-2012&teams=clubs');
  assert.deepEqual([link.setup.dataSet, link.setup.layer, link.ignored], ['wol-2012', 'nations', ['teams']]);
});

// ---------- the loader ----------

test('the loader refuses a damaged computed women\'s season', () => {
  const doc = committed('wol-2012');
  const refuses = (change, pattern, base = doc) => {
    const copy = structuredClone(base);
    change(copy);
    assert.throws(() => decodeFootballSet(copy, copy.id), pattern);
  };
  const first = copy => copy.nations['840'][2][0];
  refuses(copy => { copy.kind = 'wwc'; }, /is not the kind its id names/);
  refuses(copy => { delete copy.source.method; }, /ratings are computed/);
  refuses(copy => { copy.clubs = [{ id: 'w-arsenal' }]; }, /nations only/);
  refuses(copy => { copy.nations['840'][2].pop(); }, /must name its eleven/);
  refuses(copy => { first(copy)[3].id = 'wc:P-12345'; }, /source must name the player/);
  refuses(copy => { delete first(copy)[3].minutes; }, /source must name the player/);
  refuses(copy => { first(copy)[3].apps = 5; }, /source must name the player/);
  refuses(copy => { first(copy)[3].ballonDor = { 2012: 10 }; }, /Ballon d'Or/);
  refuses(copy => { first(copy)[3].url = 'https://example.com/wambach'; }, /her Wikipedia article/);
  refuses(copy => { copy.identities = { 826: { name: 'United Kingdom', code: 'GBR', flagId: 'GBR' } }; }, /no identity but Great Britain/);
  refuses(copy => { delete copy.territory.merged.SCO; }, /no identity but Great Britain/);
  refuses(copy => { copy.identities = { 826: { name: 'Great Britain', code: 'GBR', flagId: 'GBR' } }; copy.territory.merged = Object.fromEntries(HOME_NATIONS.map(id => [id, '826'])); },
    /identities of their day/, committed('wwc-2015'));
  refuses(copy => { copy.nations['278'] = copy.nations['076']; delete copy.nations['076']; }, /earlier years only/, committed('wwc-1991'));
  assert.ok(decodeFootballSet(structuredClone(doc)), 'the file itself loads');
});

// ---------- in the running game ----------

const B = await bundleComponents({
  App: 'src/App.jsx',
  clearFootballSetCache: ['src/engine/footballSets.js', 'clearFootballSetCache'],
  clearFootballSetIndex: ['src/engine/footballSets.js', 'clearFootballSetIndex'],
}, { jsx: 'automatic' });
const settle = () => new Promise(resolve => setImmediate(resolve));

test('a 2012/13 campaign plays Great Britain\'s computed eleven, saves its players whole, and resumes without the file', async () => {
  const doc = committed('wol-2012');
  const calls = [], gone = new Set();
  const fetch = async url => {
    const at = String(url);
    calls.push(at);
    if (gone.has(at)) throw new Error('the file is gone');
    if (/^\/womens-football\/w(?:wc|ol)-\d{4}\.json$/.test(at)) return { ok: true, status: 200, json: async () => JSON.parse(read(`public${at}`)) };
    return { ok: false, status: 404, json: async () => { throw new Error('Not found'); } };
  };
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
  Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true, value: fetch });
  B.clearFootballSetCache();
  B.clearFootballSetIndex();
  const f = syncAppFixture({ App: B.App, phase: 'setup', ids: ['826', 'SCO', 'WAL', 'NIR', '250', '752', '840', '076'],
    settings: { sport: 'womens-football', layer: 'nations', scope: 'world', clubScope: 'all', role: 'manager', managedTeamId: '826', seed: '5' } });
  f.app.opening = B.App.prototype.opening;
  try {
    const { app, items, time } = f;
    app.pickSetup('sport', 'womens-football');
    await app.requestSeasons();
    assert.ok(app.state.footballSets.some(set => set.id === 'wol-2012' && set.label === 'Computed · 2012 Olympics'));
    app.pickSetup('layer', 'clubs');
    app.pickSetup('dataSet', 'wol-2012');
    assert.equal(app.state.setup.layer, 'nations', 'a season with nations only takes the nations');
    time.advance(200);
    await app.loadSet('wol-2012');
    await settle();
    assert.equal(app.seasonStatus().state, 'ready');
    app.pickSetup('managedTeamId', '826');
    const wall = app.setupTeams();
    assert.deepEqual(wall.map(team => team.id).sort(), Object.keys(doc.nations).sort(), 'the twelve finalists, no one else');
    const britain = wall.find(team => team.id === '826');
    assert.deepEqual([britain.name, britain.code, britain.flagId], ['Great Britain', 'GBR', 'GBR']);
    const model = buildSetupModel(app.state.setup, { managerTeams: wall, season: app.seasonStatus() });
    assert.equal(model.campaignSummary, 'Women\'s football · Nations · World War · 2012/13');

    app.startCampaign();
    const st = app.state;
    assert.equal(st.phase, 'playing');
    assert.deepEqual([st.settings.dataSet, st.settings.dataVersion, st.settings.dataYear, st.settings.dataSeason], ['wol-2012', doc.version, 2013, '2012/13']);
    assert.deepEqual(st.teams['826'].squad.map(player => player.name), names(doc, '826'), 'the computed eleven');
    assert.ok(['SCO', 'WAL', 'NIR'].every(shape => st.own[shape] === '826'), 'Great Britain holds the home nations');
    assert.ok(!st.teams.SCO && !st.teams['724'], 'only the finalists field a side');
    const player = st.teams['826'].squad[0];
    assert.equal(sourceLabel(player), '2012 Women\'s Olympic tournament, computed');
    assert.equal(sourceUrl(player), player.sourceInfo.url);
    assert.equal(sourceTitle(player), `2012 Women's Olympic tournament, computed · Team Elo ${player.sourceInfo.teamElo} on 2012-08-10`);

    // The checkpoint keeps the players whole (a computed player is a plain record) and resumes with no file.
    const text = items.get(SAVE_KEY);
    assert.equal(JSON.parse(text).playerPack, undefined);
    B.clearFootballSetCache();
    gone.add('/womens-football/wol-2012.json');
    const before = calls.length;
    const saved = parseCampaign(text);
    assert.equal(JSON.stringify(saved.teams), JSON.stringify(st.teams), 'squads rebuild exactly');
    app.continueSaved(saved);
    assert.equal(app.state.phase, 'playing');
    assert.equal(JSON.stringify(app.state.teams), JSON.stringify(st.teams));
    assert.equal(calls.length, before, 'resuming fetched nothing');
  } finally {
    f.close();
    if (prior) Object.defineProperty(globalThis, 'fetch', prior); else delete globalThis.fetch;
  }
});
