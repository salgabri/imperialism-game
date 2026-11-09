// The NFL seasons of Madden NFL 99, 2000 and 2001 (docs/design/american-football.md, "Madden NFL 99 to 2001"), from NFL
// Draft Buzz's copy of EA's data: the readers of its team pages, position lists and player pages (its synthetic OVR*
// never read), its positions as the game's, the conversion of Madden NFL 99 and 2000's attributes (weights fitted on
// Madden NFL 2001, read off Madden NFL 2002), recomputed from each snapshot, the checks as recorded, Madden NFL 2001's EA
// overalls unchanged, and the snapshots rebuilt byte for byte where data-src/ has the pages.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { maddenReferencePlayers, overallsOf, referenceOf } from './lib/nfl-reference.mjs';
import {
  ATTRIBUTES, EDITIONS, groupOf, leastSquares, normaliseAttributes, parseList, parsePlayerEdition, parseTeamPage, positionOf, scoreOf, spearman,
} from './lib/ndb-madden.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = file => readFileSync(path.join(root, file), 'utf8');
const snapshotOf = year => JSON.parse(read(`scripts/data/madden-early/${year}.json`));
const seasonFile = id => JSON.parse(read(`public/american-football/${id}.json`));
const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'OL', 'DL', 'LB', 'CB', 'S', 'K'];

// ---------- the readers, on pages made up as the site lays them out ----------

const badge = (head, value) => (value == null ? `<td>\n<span class="rtg-badge rtg-na" title="Not tracked for this player in Madden NFL 2000">-</span>\n</td>`
  : `<td>\n<span class="rtg-badge rtg-good" title="${head}: ${value}">${value}</span>\n</td>`);
const teamRow = (first, last, pos, no, values) => `<tr>
<td class="mt-player"><div class="team-meta"><a href="/madden/player/100-${first.toLowerCase()}-${last.toLowerCase()}"><span class="firstName">${first}<br /></span><span class="lastName">${last}</span></a></div></td>
<td class="mt-pos">${pos}</td><td class="mt-jersey">#${no}</td>
${values.map(([head, value]) => badge(head, value)).join('\n')}
</tr>`;
const teamTable = (title, heads, rows) => `<div class="card__header"><h4>${title}</h4></div><div class="card__content"><div class="table-responsive" style="overflow-x:auto;">
<table class="mt-table"><thead><tr><th class="mt-player">Player</th><th class="mt-pos">Pos</th><th class="mt-jersey">#</th>${heads.map(h => `<th>${h}</th>`).join('')}</tr></thead>
<tbody>${rows.join('\n')}</tbody></table></div></div>`;
const teamPage = (title, tables) => `<html><head><title>${title}</title></head><body>${tables.join('\n')}</body></html>`;

test('a team page gives each player\'s position, number and attributes, EA\'s overall only under OVR', () => {
  const page = parseTeamPage(teamPage('Buffalo Bills Madden NFL 2001 Player Ratings - 2000 Roster', [
    teamTable('Quarterbacks', ['OVR', 'SPD', 'THP'], [teamRow('Rob', 'Johnson', 'QB', 11, [['OVR', 85], ['SPD', 58], ['THP', 88]])]),
    teamTable('Other', ['SPD', 'STR', 'TAK'], [teamRow('Ken', 'Irvin', 'LCB/RCB', 27, [['SPD', 90], ['STR', 40], ['TAK', null]])]),
  ]));
  assert.deepEqual([page.team, page.edition, page.season], ['Buffalo Bills', 2001, 2000]);
  assert.deepEqual(page.rows.map(r => [r.name, r.listed, r.no, r.overall ?? null, r.attributes]), [
    ['Rob Johnson', 'QB', 11, 85, { SPD: 58, THP: 88 }],
    ['Ken Irvin', 'LCB/RCB', 27, null, { SPD: 90, STR: 40 }], // a value the edition did not track is absent
  ]);
  // The site's own synthetic overall, wherever it shows one, is never read.
  const synthetic = parseTeamPage(teamPage('Buffalo Bills Madden NFL 2000 Player Ratings - 1999 Roster', [
    teamTable('Kickers', ['OVR*', 'KPW'], [teamRow('Steve', 'Christie', 'K', 2, [['OVR*', 88], ['KPW', 84]])])]));
  assert.equal(synthetic.rows[0].overall, undefined);
  assert.deepEqual(synthetic.rows[0].attributes, { KPW: 84 });
  // A club that has moved since has an empty page for these editions.
  assert.deepEqual(parseTeamPage(teamPage('Las Vegas Raiders Madden NFL 2001 Player Ratings - 2000 Roster', [])).rows, []);
  assert.throws(() => parseTeamPage(teamPage('Something else', [])), /Not a team page/);
});

const listRow = (name, pos, code, values) => `<tr>
<td class="my-rk">1</td>
<td class="my-player" data-sortval="${name}"><div class="team-meta"><a href="/madden/player/200-x"><img /></a><h4 class="team-meta__name"><div class="lastName" style="font-size:12px;">${pos}</div><a href="/madden/player/200-x"><span class="firstName">x<br /></span><span class="lastName">y</span></a></h4></div></td>
<td class="my-team" data-sortval="${code}"><a href="/madden/team/x/1999"></a></td>
${values.map(v => `<td data-sortval="${v}"><span>${v}</span></td>`).join('\n')}
</tr>`;
const listPage = (title, heads, rows) => `<html><head><title>${title}</title></head><body><table class="my-table my-sortable"><thead><tr><th class="my-rk">#</th><th class="my-player">Player</th><th class="my-team">Team</th>${heads.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('\n')}</tbody></table></body></html>`;

test('a position list gives each player\'s club code and the attributes it shows; OVR* is the site\'s and never read', () => {
  const synthetic = parseList(listPage('Madden NFL 2000 Quarterback Ratings - 1999 NFL Season', ['OVR*', 'THP', 'TKL'],
    [listRow('Steve Young', 'QB', 'SF', [98, 88, 9]), listRow('Rich Gannon', 'QB', 'OAK', [90, 85, 12])]));
  assert.equal(synthetic.edition, 2000);
  assert.deepEqual(synthetic.rows.map(r => [r.name, r.listed, r.code, r.overall ?? null, r.attributes]),
    [['Steve Young', 'QB', 'SF', null, { THP: 88, TKL: 9 }], ['Rich Gannon', 'QB', 'OAK', null, { THP: 85, TKL: 12 }]]);
  assert.deepEqual(normaliseAttributes({ TKL: 9, THP: 88 }), { TAK: 9, THP: 88 }, 'the lists call tackling TKL, the team pages TAK');
  const ea = parseList(listPage('Madden NFL 2001 Special Teams Ratings - 2000 NFL Season', ['OVR', 'KPW'], [listRow('John Carney', 'K', 'SD', [88, 85])]));
  assert.equal(ea.rows[0].overall, 88, 'Madden NFL 2001 kept EA\'s overall');
});

test('a player page gives one edition\'s values, never its calculated overall', () => {
  const row = (edition, ovr, syn, speed, kpw) => `<tr data-legacy15="0"><td class="mr-yr"><a href="/madden/year/${edition}">${edition}</a></td>
<td class="mr-team"><a href="/madden/team/Raiders/${edition - 1}"></a></td><td class="mr-pos">K</td>
<td><span class="rtg-badge${syn ? ' rtg-syn' : ''}">${ovr}</span></td><td><span class="rtg-badge">${speed}</span></td><td><span class="rtg-badge">${kpw}</span></td></tr>`;
  const html = `<title>Greg Davis Madden Career Ratings 1992-1999 | Peak 86 OVR</title><table><thead><tr><th>Madden</th><th>Team</th><th>Pos</th><th>OVR</th><th>Speed</th><th>KPW</th></tr></thead><tbody>${row(1999, 81, true, 44, 85)}${row(2001, 80, false, 40, 83)}</tbody></table>`;
  assert.deepEqual(parsePlayerEdition(html, 1999), { name: 'Greg Davis', listed: 'K', team: 'Raiders', attributes: { SPD: 44, KPW: 85 } });
  assert.equal(parsePlayerEdition(html, 2001).overall, 80);
  assert.equal(parsePlayerEdition(html, 2000), null, 'no row for that edition');
  assert.equal(parsePlayerEdition(html.replace('Greg Davis Madden Career Ratings', 'Greg Davis (K, Raiders) Madden Ratings'), 1999).name, 'Greg Davis');
});

test('the site\'s position labels play the game\'s positions; a generic DB is left to nflverse, P and LS to nobody', () => {
  assert.deepEqual(['LLB', 'RLB', 'LT/RT', 'LG/C', 'RDT/LDE', 'LCB/RCB', 'FS/SS', 'HB', 'FB', 'NT', 'ILB', 'K'].map(positionOf),
    ['LB', 'LB', 'OL', 'OL', 'DL', 'CB', 'S', 'RB', 'RB', 'DL', 'LB', 'K']);
  assert.equal(positionOf('DB'), null);
  assert.deepEqual([positionOf('P'), positionOf('LS')], ['P', 'LS']);
  assert.throws(() => positionOf('XYZ'), /Unknown position XYZ/);
  assert.deepEqual(['LT', 'RG', 'C', 'T', 'G'].map(label => groupOf('OL', label)), ['OT', 'OG', 'C', 'OT', 'OG'], 'the line fits tackles, guards and centres apart');
});

test('least squares recovers a rule exactly, and Spearman\'s correlation ranks ties together', () => {
  const x = [[1, 2], [2, 1], [3, 5], [4, 3], [5, 8]];
  const w = leastSquares(x, x.map(([a, b]) => 3 + 2 * a - 0.5 * b));
  assert.deepEqual(w.map(v => Math.round(v * 1e6) / 1e6), [3, 2, -0.5]);
  assert.equal(scoreOf('K', { K: [1, 0.5, 0.25, 0.25] }, { AWR: 80, KPW: 90, KAC: 70 }), 1 + 40 + 22.5 + 17.5);
  assert.throws(() => scoreOf('K', { K: [1, 0.5, 0.25, 0.25] }, { AWR: 80, KPW: 90 }), /No KAC for a K/);
  assert.equal(spearman([1, 2, 3, 4], [10, 20, 30, 40]), 1);
  assert.equal(spearman([1, 2, 3, 4], [40, 30, 20, 10]), -1);
});

// ---------- the snapshots ----------

test('Madden NFL 99 and 2000\'s overall is recomputed from the snapshot alone: its weights, then its reference', () => {
  const madden = maddenReferencePlayers(JSON.parse(read('scripts/data/madden-seasons/2001.json')));
  for (const year of [1998, 1999]) {
    const snapshot = snapshotOf(year);
    const { weights, attributes, reference } = snapshot.conversion;
    assert.deepEqual(attributes, ATTRIBUTES, `${year}: the groups' attributes`);
    assert.match(snapshot.conversion.overall, /^Ours, not the game's/);
    const clubs = Object.keys(snapshot.teams).length;
    for (const position of POSITIONS) {
      const players = snapshot.players.filter(p => p[3] === position);
      const ref = reference.positions[position];
      assert.equal(ref.players, players.length);
      assert.deepEqual(ref.madden, referenceOf(madden, position, players.length / clubs), `${year} ${position}: Madden NFL 2002's reference`);
      for (const [name, , label, , , { score, attributes: values }] of players) {
        assert.equal(scoreOf(groupOf(position, label), weights, values), score, `${year} ${name}: the score from his attributes`);
      }
      const overall = overallsOf(players.map(p => p[5].score), ref.madden);
      for (const [name, , , , rating, { score }] of players) {
        assert.equal(rating, overall.get(score), `${year} ${name}`);
        assert.ok(Number.isInteger(rating) && rating >= 1 && rating <= 99);
      }
      const order = players.slice().sort((a, b) => a[5].score - b[5].score);
      assert.ok(order.every((p, i) => !i || p[4] >= order[i - 1][4]), `${year} ${position}: a higher score never rates lower`);
    }
  }
});

test('the checks hold as recorded: team overalls, the 99 and 100 overall clubs, nflverse and the lists', () => {
  const check = (year, pattern) => snapshotOf(year).checks.find(c => pattern.test(c.name));
  // Club strengths against maddenratings.net's team overalls.
  assert.ok(check(1999, /team overalls/).spearman >= 0.85, 'Madden NFL 2000');
  assert.ok(check(1998, /team overalls/).spearman >= 0.75, 'Madden NFL 99');
  assert.ok(check(2000, /team overalls/).spearman >= 0.8, 'Madden NFL 2001, EA\'s own overall');
  assert.deepEqual([1998, 1999, 2000].map(year => check(year, /team overalls/).clubs), [30, 31, 31]);
  const club = check(1998, /99 and 100/).players;
  for (const [player, rank] of [['WR Jerry Rice', 1], ['OT Tony Boselli', 1], ['TE Ben Coates', 1], ['DE Bruce Smith', 1]]) {
    assert.match(club.find(line => line.startsWith(player)), new RegExp(`: ${rank} of \\d+ at`), player);
  }
  assert.ok(club.includes('CB Jason Sehorn: not on a club here'), 'the site\'s Madden NFL 99 has no Jason Sehorn');
  assert.match(check(1999, /99 and 100/).players.find(line => line.startsWith('CB Deion Sanders')), /: 1 of \d+ at CB/);
  assert.match(check(1999, /99 and 100/).players.find(line => line.startsWith('C Dermontti Dawson')), /: 1 of \d+ at OL/);
  for (const year of [1998, 1999, 2000]) {
    const names = check(year, /nflverse/);
    assert.ok(names.sameClub >= names.players * 0.88, `${year}: ${names.sameClub} of ${names.players} on nflverse's club`);
    const lists = check(year, /position lists/);
    assert.ok(lists.identical >= lists.compared - 3, `${year}: the lists agree with the team pages`);
  }
});

test('Madden NFL 2001 keeps EA\'s overall: the season\'s squads rate every player as the snapshot does', () => {
  const snapshot = snapshotOf(2000), doc = seasonFile('madden-2000');
  assert.equal(snapshot.conversion, undefined);
  assert.deepEqual([doc.kind, doc.source.rawScale, doc.source.overall, doc.source.conversion], ['madden', 99, undefined, undefined]);
  const rated = new Set(snapshot.players.map(([name, , , pos, overall]) => `${name}|${pos}|${overall}`));
  for (const club of doc.clubs) for (const [name, pos, rating] of club.squad) assert.ok(rated.has(`${name}|${pos}|${rating}`), `${club.name}: ${name}`);
  for (const id of ['madden-1998', 'madden-1999']) {
    const converted = seasonFile(id);
    assert.deepEqual([converted.source.overall, converted.source.rawScale], ['converted', 99]);
    assert.equal(converted.source.conversion, snapshotOf(converted.year).conversion.overall);
    assert.match(converted.label, /\(converted\)$/);
  }
  assert.deepEqual(Object.keys(EDITIONS).map(edition => EDITIONS[edition].season), [1998, 1999, 2000]);
});

test('every snapshot rebuilds byte for byte from the pinned pages', t => {
  const pins = JSON.parse(read('scripts/data/ndb-pages.json')).files;
  const missing = Object.keys(pins).filter(file => !existsSync(path.join(root, 'data-src', file)));
  if (missing.length) { t.skip(`data-src/ lacks ${missing.length} pinned pages (${missing[0]} …): the rebuild runs where they are`); return; }
  assert.match(execFileSync(process.execPath, ['scripts/sync-madden-early.mjs', '--check'], { cwd: root, encoding: 'utf8' }),
    /Verified 3 Madden NFL 99–2001 snapshots byte for byte/);
});
