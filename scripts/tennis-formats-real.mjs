// The real figures behind the cups' formats by year (docs/design/tennis.md and womens-tennis.md, "Format by year"),
// counted from Jeff Sackmann's match files as the seasons' syncs pin them (npm run sync:tennis-seasons and
// sync:womens-tennis-seasons cache them in data-src/): how each era's sets ended (when the tie-breaks came), the order
// the cups' rubbers were played in, the World Group's rubbers and ties by era, and how often an Elo favourite won a
// best-of-five match against Elo's odds over five sets (each player's Elo before the match by Tennis Abstract's method,
// scripts/lib/tennis-elo.mjs). The files hold the singles of every tie and none of the doubles; the Federation Cup's
// first years, 1963-1967, come from English Wikipedia's pages as the women's seasons' sync pins them (singles and
// doubles). Reads; writes nothing.
// Run: node scripts/tennis-formats-real.mjs [--men=<folder>] [--women=<folder>] [--wikipedia=<folder>] (the pinned files;
// data-src's by default)
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { orderMatches, parseMatchFile, rateMatches, ROUND_ORDER } from './lib/tennis-elo.mjs';
import { cupTies, pinnedPages, wikiFile, wikipediaMatches } from './lib/tennis-wikipedia.mjs';
import { bestOfFive, bestOfThree, daySetChances } from '../src/sports/tennis.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const option = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const TOURS = {
  atp: { manifest: 'scripts/data/tennis-seasons.json', dir: option('men') || path.join(root, 'data-src/tennis-seasons/sackmann'),
    file: year => `atp_matches_${year}.csv`, other: year => `atp_matches_qual_chall_${year}.csv` },
  wta: { manifest: 'scripts/data/womens-tennis-seasons.json', dir: option('women') || path.join(root, 'data-src/womens-tennis-seasons/sackmann'),
    file: year => `wta_matches_${year}.csv` },
};
for (const tour of Object.values(TOURS)) tour.pins = JSON.parse(readFileSync(path.join(root, tour.manifest), 'utf8')).archive.files;

/** A pinned match file's text, checked against its SHA-256 (the sync downloads a missing one). */
function pinned(tourId, file) {
  const tour = TOURS[tourId], at = path.join(tour.dir, file);
  if (!existsSync(at)) throw new Error(`${at} is missing: run the seasons' sync (npm run sync:tennis-seasons / sync:womens-tennis-seasons)`);
  const text = readFileSync(at);
  if (createHash('sha256').update(text).digest('hex') !== tour.pins[file]) throw new Error(`${file} does not match its pin`);
  return text.toString('utf8');
}

/** A match file's rows: the cells this counts, by the header's names. The amateur file's rows stop short: padded. */
function rowsOf(text) {
  const lines = text.replace(/\r/g, '').split('\n').filter(Boolean);
  const head = lines[0].split(',');
  const at = name => head.indexOf(name);
  const I = Object.fromEntries(['tourney_id', 'tourney_name', 'tourney_level', 'tourney_date', 'match_num', 'winner_ioc', 'loser_ioc', 'winner_name',
    'loser_name', 'winner_rank', 'loser_rank', 'score', 'best_of'].map(name => [name, at(name)]));
  return lines.slice(1).map((line, i) => {
    const c = line.split(',');
    return { row: i + 1, tie: `${c[I.tourney_id]}|${c[I.tourney_name]}`, name: c[I.tourney_name], level: c[I.tourney_level],
      year: Math.floor(Number(c[I.tourney_date]) / 10000), num: Number(c[I.match_num]), winnerIoc: c[I.winner_ioc], loserIoc: c[I.loser_ioc],
      winnerName: c[I.winner_name], loserName: c[I.loser_name], winnerRank: Number(c[I.winner_rank]) || Infinity,
      loserRank: Number(c[I.loser_rank]) || Infinity, score: c[I.score] ?? '', bestOf: Number(c[I.best_of]) };
  });
}

/** A completed score's sets, each [winner's games, loser's games, tie-break or null] from the match winner's side; null if not completed. */
function setsOf(score) {
  const tokens = String(score).trim().split(/\s+/);
  const sets = tokens.map(token => /^(\d+)-(\d+)(?:\((\d+)\))?$/.exec(token));
  return tokens.length && sets.every(Boolean) ? sets.map(m => [Number(m[1]), Number(m[2]), m[3] == null ? null : Number(m[3])]) : null;
}
const high = ([a, b]) => Math.max(a, b), low = ([a, b]) => Math.min(a, b);
const isTiebreakSet = set => high(set) === 7 && low(set) === 6;
// An advantage set that played on from 6–6: two games clear, past 7–5.
const isPast = set => high(set) >= 8 && high(set) - low(set) === 2;

const cupRows = new Map();
/** Every cup row of `tourId`'s files, `from`–`to`, whose event name matches `pattern` (the Davis Cup's or the Fed Cup's). */
function cup(tourId, from, to, pattern) {
  const out = [];
  for (let year = from; year <= to; year++) {
    const key = `${tourId}${year}`;
    if (!cupRows.has(key)) cupRows.set(key, rowsOf(pinned(tourId, TOURS[tourId].file(year))).filter(r => r.level === 'D'));
    out.push(...cupRows.get(key).filter(r => pattern.test(r.name)));
  }
  return out;
}
const amateurDavisCup = (from, to) => rowsOf(pinned('atp', 'atp_matches_amateur.csv'))
  .filter(r => /Davis Cup/.test(r.name) && r.year >= from && r.year <= to);

const pct = x => `${(100 * x).toFixed(1)}%`;
const lines = [];
const say = text => lines.push(text);

/** The sets of `rows`, those `pick(set, k, sets, row)` keeps: how many, how many ended 7–6 and how many played on past 7–5. */
function setTally(rows, pick = () => true) {
  let sets = 0, tiebreaks = 0, past = 0, sixAll = 0;
  for (const row of rows) {
    const played = setsOf(row.score);
    if (!played) continue;
    played.forEach((set, k) => {
      if (!pick(set, k, played, row)) return;
      sets++;
      if (isTiebreakSet(set)) tiebreaks++;
      if (isPast(set)) past++;
      if (low(set) >= 6) sixAll++;
    });
  }
  return { sets, tiebreaks, past, sixAll };
}
const tallyText = ({ sets, tiebreaks, past }) => `${sets} sets, ${tiebreaks} ended 7–6, ${past} went past 7–5`;

// ---------- when the tie-breaks came ----------

say('When the tie-breaks came');
const davisCup = cup('atp', 1968, 2025, /Davis Cup/);
const early = [...amateurDavisCup(1960, 1967), ...davisCup.filter(r => r.year <= 1988)];
say(`  Davis Cup 1960–1988, best-of-five rubbers: ${tallyText(setTally(early.filter(r => r.bestOf === 5)))}`);
say(`  Davis Cup 1960–1988, rubbers shortened to best of three: ${tallyText(setTally(early.filter(r => r.bestOf === 3)))}`);
const tiebreakEra = davisCup.filter(r => r.year >= 1989 && r.year <= 2015 && r.bestOf === 5);
say(`  Davis Cup 1989–2015, best of five, sets 1–4: ${tallyText(setTally(tiebreakEra, (set, k) => k < 4))}`);
say(`  Davis Cup 1989–2015, best of five, fifth sets: ${tallyText(setTally(tiebreakEra, (set, k) => k === 4))}`);
say(`  Davis Cup 2016–2018, best of five, fifth sets: ${tallyText(setTally(davisCup.filter(r => r.year >= 2016 && r.year <= 2018 && r.bestOf === 5), (set, k) => k === 4))}`);
const recent = davisCup.filter(r => r.year >= 2019);
say(`  Davis Cup 2019–2025: ${recent.length} rubbers, ${recent.filter(r => r.bestOf === 3).length} of them best of three`);
const fedCup = cup('wta', 1968, 2025, /Fed Cup|BJK Cup|Billie Jean King Cup/);
const fedYears = (from, to) => fedCup.filter(r => r.year >= from && r.year <= to && /Fed Cup/.test(r.name));
for (const [from, to] of [[1968, 1975], [1976, 1976], [1977, 1979]]) say(`  Fed Cup ${from === to ? from : `${from}–${to}`}: ${tallyText(setTally(fedYears(from, to)))}`);
const worldGroup = (from, to) => fedCup.filter(r => r.year >= from && r.year <= to && /Fed Cup WG1?\b/.test(r.name));
say(`  Fed Cup World Group 1980–2017, the first two sets: ${tallyText(setTally(worldGroup(1980, 2017), (set, k) => k < 2))}`);
const deciders = setTally(worldGroup(1980, 2017), (set, k) => k === 2);
// A deciding set that ended 7–6: was its rubber dead, the tie decided by the singles before it (the doubles came last)?
const deadAt = new Map();
for (const row of worldGroup(1980, 2017).sort((x, y) => x.num - y.num)) {
  const wins = deadAt.get(row.tie) ?? new Map();
  row.dead = [...wins.values()].some(n => n >= 3);
  wins.set(row.winnerIoc, (wins.get(row.winnerIoc) ?? 0) + 1);
  deadAt.set(row.tie, wins);
}
const sevenSixDeciders = worldGroup(1980, 2017).filter(r => { const s = setsOf(r.score); return s?.length === 3 && isTiebreakSet(s[2]); });
say(`  Fed Cup World Group 1980–2017, deciding sets: ${tallyText(deciders)}; the 7–6 ones' rubbers dead: ${sevenSixDeciders.filter(r => r.dead).length} of ${sevenSixDeciders.length}`);
say(`  Fed Cup World Group and Billie Jean King Cup 2018–2025: ${tallyText(setTally(fedCup.filter(r => r.year >= 2018 && /Fed Cup WG\b|BJK Cup/.test(r.name))))}`);

// ---------- the order of play ----------

say('\nThe order of play');
const byTie = rows => {
  const ties = new Map();
  for (const row of rows) {
    if (!ties.has(row.tie)) ties.set(row.tie, new Map());
    ties.get(row.tie).set(row.num, row);
  }
  return [...ties.values()];
};
const sumRank = row => row.winnerRank + row.loserRank;
const minRank = row => Math.min(row.winnerRank, row.loserRank);
for (const [label, rows] of [['Fed Cup 1975–1994', fedYears(1975, 1994)], ['Fed Cup World Group round robin, 2000–2001', fedYears(2000, 2001).filter(r => /WG RR/.test(r.name))]]) {
  const ties = byTie(rows).filter(m => m.get(1) && m.get(2) && Number.isFinite(minRank(m.get(1))) && Number.isFinite(minRank(m.get(2))));
  say(`  ${label}: the first singles the weaker pair's (its better player ranked below the second's) in ${ties.filter(m => minRank(m.get(1)) > minRank(m.get(2))).length} of ${ties.length} ties`);
}
const davisWorldGroup = davisCup.filter(r => r.year >= 1985 && r.year <= 2018 && /Davis Cup WG/.test(r.name));
for (const [label, rows, first, second] of [['Davis Cup World Group 1985–2018', davisWorldGroup, 4, 5],
  ['Fed Cup World Group and play-offs 1995–2022', fedCup.filter(r => r.year >= 1995 && r.year <= 2022 && /Fed Cup WG\b|Fed Cup WG1\b|BJK Cup Playoffs/.test(r.name)), 3, 4]]) {
  const ties = byTie(rows).filter(m => m.get(first) && m.get(second) && Number.isFinite(sumRank(m.get(first))) && Number.isFinite(sumRank(m.get(second))));
  say(`  ${label}: the first reverse singles the stronger pair's (its players' rankings adding up to less) in ${ties.filter(m => sumRank(m.get(first)) < sumRank(m.get(second))).length} of ${ties.length} ties`);
}
const numbered = (rows, singles) => byTie(rows).filter(m => [...m.keys()].every(n => singles.includes(n))).length;
say(`  Davis Cup 1968–2025: ${numbered(davisCup, [1, 2, 4, 5])} of ${byTie(davisCup).length} ties number their singles among 1, 2, 4 and 5 (the doubles third)`);
const fedFive = fedCup.filter(r => r.year >= 1995 && r.year <= 2022 && /Fed Cup WG\b|Fed Cup WG1\b|BJK Cup Playoffs/.test(r.name));
say(`  Fed Cup World Group and play-offs 1995–2022: ${numbered(fedFive, [1, 2, 3, 4])} of ${byTie(fedFive).length} ties number their singles among 1 to 4 (the doubles fifth)`);

// ---------- the World Group by era ----------

/** How the advantage sets among `sets` that played on past 7–5 ended, and the longest. */
function pastText(sets) {
  const past = sets.filter(isPast);
  if (!past.length) return 'none past 7–5';
  const longest = past.reduce((max, set) => (high(set) > high(max) ? set : max));
  return `${past.length} past 7–5: ${pct(past.filter(s => high(s) === 8).length / past.length)} 8–6, ${pct(past.filter(s => high(s) === 9).length / past.length)} 9–7, `
    + `${pct(past.filter(s => high(s) >= 10).length / past.length)} longer, the longest ${high(longest)}–${low(longest)}`;
}

say('\nThe Davis Cup World Group by era: its live best-of-five singles (a dead rubber was shortened to best of three, or not played)');
for (const [from, to] of [[1981, 1988], [1989, 2015], [2016, 2018]]) {
  const ties = byTie(davisCup.filter(r => r.year >= from && r.year <= to && /Davis Cup WG/.test(r.name)));
  const decided = { '3–0': 0, '3–1': 0, '3–2': 0 };
  let otherwise = 0;
  const live = [];
  for (const m of ties) {
    const [r1, r2, r4, r5] = [1, 2, 4, 5].map(n => m.get(n));
    if (!r1 || !r2) { otherwise++; continue; }
    // A live fifth rubber: 2–2 after four. Else a live fourth: 2–1 after three. Else 3–0, which needs one side's two day-one singles.
    const score = r5?.bestOf === 5 ? '3–2' : r4?.bestOf === 5 ? '3–1' : '3–0';
    if (score === '3–0' && r1.winnerIoc !== r2.winnerIoc) { otherwise++; continue; }
    decided[score]++;
    live.push(...[r1, r2, r4, r5].filter(r => r?.bestOf === 5 && setsOf(r.score)));
  }
  const n = decided['3–0'] + decided['3–1'] + decided['3–2'];
  const sets = live.flatMap(r => setsOf(r.score));
  const fifth = live.map(r => setsOf(r.score)[4]).filter(Boolean);
  say(`  ${from}–${to}: ${live.length} rubbers, ${pct(live.filter(r => setsOf(r.score).length === 5).length / live.length)} to a fifth set, `
    + `${pct(live.filter(r => setsOf(r.score).length === 3).length / live.length)} in three; ${sets.length} sets, ${pct(sets.filter(s => low(s) >= 6).length / sets.length)} reached 6–6; `
    + `${pastText(sets)} (${fifth.filter(isPast).length} of ${fifth.length} fifth sets); `
    + `${n} ties decided 3–0 ${pct(decided['3–0'] / n)}, 3–1 ${pct(decided['3–1'] / n)}, 3–2 ${pct(decided['3–2'] / n)} (${otherwise} read otherwise)`);
}
say(`  1989–2015, every World Group fifth set of a best-of-five rubber: ${pastText(davisCup
  .filter(r => r.year >= 1989 && r.year <= 2015 && /Davis Cup WG/.test(r.name) && r.bestOf === 5).map(r => setsOf(r.score)?.[4]).filter(Boolean))}`);

say('\nThe Fed Cup World Group by era: every tie\'s singles (the doubles decided only a level tie)');
for (const [from, to, pattern, three] of [[1968, 1975, /Fed Cup WG/, true], [1980, 1994, /Fed Cup WG/, true], [1995, 2017, /Fed Cup WG1?\b (QF|SF|F|R1|PO)/, false]]) {
  const decided = {};
  let skipped = 0;
  const singles = [];
  for (const m of byTie(fedCup.filter(r => r.year >= from && r.year <= to && pattern.test(r.name)))) {
    const sideOf = n => m.get(n)?.winnerIoc;
    // A 3–0 lead after three singles may leave the fourth unplayed.
    const sweep = !three && [1, 2, 3].every(n => m.get(n)) && new Set([1, 2, 3].map(sideOf)).size === 1;
    const nums = three ? [1, 2] : sweep && !m.get(4) ? [1, 2, 3] : [1, 2, 3, 4];
    if (!nums.every(n => m.get(n) && setsOf(m.get(n).score))) { skipped++; continue; }
    const first = sideOf(1);
    const wins = nums.map(n => sideOf(n) === first);
    const after = k => { const x = wins.slice(0, k).filter(Boolean).length; return Math.max(x, Math.min(k, wins.length) - x); };
    const score = three ? (wins[0] === wins[1] ? '2–0' : '2–1') : after(3) === 3 ? '3–0' : after(4) === 3 ? '3–1' : '3–2';
    decided[score] = (decided[score] ?? 0) + 1;
    singles.push(...nums.map(n => m.get(n)));
  }
  const n = Object.values(decided).reduce((sum, x) => sum + x, 0);
  const sets = singles.flatMap(r => setsOf(r.score));
  say(`  ${from}–${to}: ${n} ties (${skipped} without their singles), ${Object.entries(decided).sort().map(([score, x]) => `${score} ${pct(x / n)}`).join(', ')}; `
    + `${singles.length} singles, ${pct(singles.filter(r => setsOf(r.score).length === 3).length / singles.length)} to a third set; `
    + `${sets.length} sets, ${pct(sets.filter(s => low(s) >= 6).length / sets.length)} reached 6–6`);
}
say(`  Fed Cup 1968–1975 and 1977–1979, every set: ${pastText([...fedYears(1968, 1975), ...fedYears(1977, 1979)].flatMap(r => setsOf(r.score) ?? []))}`);
say(`  Fed Cup World Group 1980–2017, deciding sets: ${pastText(worldGroup(1980, 2017).map(r => setsOf(r.score)?.[2]).filter(Boolean))}`);

// ---------- the Federation Cup's first years ----------

// Every tie of 1963-1967 from Wikipedia's pinned pages: its rubbers' sets (singles and doubles), its order of play by
// each player's Elo before the tie (the women's second run of the pages' results, scripts/sync-tennis-seasons.mjs), and
// whether its third rubber was played once the tie was decided.
say('\nThe Federation Cup 1963–1967 (English Wikipedia\'s pages, as npm run sync:womens-tennis-seasons pins them)');
const wta = JSON.parse(readFileSync(path.join(root, TOURS.wta.manifest), 'utf8'));
const wikiDir = option('wikipedia') || path.join(root, 'data-src/womens-tennis-seasons/wikipedia');
const hash = (algorithm, data) => createHash(algorithm).update(data).digest('hex');
const pageAt = title => path.join(wikiDir, wikiFile(title, data => hash('sha1', data)));
const pagesCached = [...wta.wikipedia.draws.flatMap(row => [row[0], row[4]]), ...wta.wikipedia.cups.map(row => row[0]),
  ...wta.wikipedia.redirects.items.map(row => row[0])].every(title => existsSync(pageAt(title)));
if (pagesCached) await firstCups();
else say(`  skipped: the pinned pages are not in ${wikiDir} (npm run sync:womens-tennis-seasons caches them)`);

async function firstCups() {
  const pages = await pinnedPages(wta.wikipedia, (title, sha) => {
    const bytes = readFileSync(pageAt(title));
    if (hash('sha256', bytes) !== sha) throw new Error(`${pageAt(title)} does not match its pin`);
    return bytes.toString('utf8');
  });
  const tiesOf = pages.cups.flatMap(cupPage => cupTies(cupPage.html, cupPage.year).map((tie, t) => ({ ...tie, event: `${cupPage.event}-${String(t + 1).padStart(2, '0')}` })));
  const scoreSets = score => score.split(' ').map(set => set.split('-').map(Number)).filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b));
  const rubbers = tiesOf.flatMap(tie => tie.rubbers.filter(r => !r.unplayed));
  const cupSets = rubbers.flatMap(r => scoreSets(r.score));
  say(`  ${tiesOf.length} ties, ${rubbers.length} rubbers (${rubbers.filter(r => r.doubles).length} doubles): ${cupSets.length} sets, ${cupSets.filter(isTiebreakSet).length} ended 7–6, `
    + `${cupSets.filter(isPast).length} went past 7–5; ${pastText(cupSets)}`);
  const decided = tiesOf.filter(tie => tie.rubbers.length >= 2 && !tie.rubbers[0].doubles && !tie.rubbers[1].doubles && tie.rubbers[0].winner === tie.rubbers[1].winner);
  say(`  The doubles third in ${tiesOf.filter(tie => tie.rubbers[2]?.doubles && !tie.rubbers[0].doubles && !tie.rubbers[1].doubles).length} of the `
    + `${tiesOf.filter(tie => tie.rubbers.length === 3).length} ties that list three rubbers; played, though the singles had decided the tie, in `
    + `${decided.filter(tie => tie.rubbers[2] && !tie.rubbers[2].unplayed).length} of the ${decided.length} ties they decided`);
  const answer = readFileSync(path.join(root, 'data-src/womens-tennis-seasons/wikidata', wta.wikipedia.wikidata.file));
  if (hash('sha256', answer) !== wta.wikipedia.wikidata.sha256) throw new Error('The pinned Wikidata answer does not match its pin');
  const playerLines = pinned('wta', 'wta_players.csv').replace(/\r/g, '').split('\n').filter(Boolean);
  const people = new Map(playerLines.slice(1).map(line => { const c = line.split(','); return [c[0], { name: `${c[1]} ${c[2]}`.trim(), ioc: c[5] || null, wikidata: /^Q\d+$/.test(c[7] ?? '') ? c[7] : null }]; }));
  const W = wta.wikipedia, E = wta.method.early;
  const wiki = wikipediaMatches({ ...pages, people, roundOrder: ROUND_ORDER,
    qids: new Map(JSON.parse(answer.toString('utf8')).results.bindings.map(row => [row.title.value, row.item.value.replace(/^.*\//, '')])),
    rules: { flags: W.flags, teams: W.teams, sameCodes: W.sameCodes, aliases: E.aliases.items, joins: E.joins.items } });
  const before = new Map();
  rateMatches(orderMatches(wiki.matches), { ...wta.method, start: { ...wta.method.start, amateur: E.start.amateur },
    layoff: { ...wta.method.layoff, from: E.layoff.from, amateurWeeks: E.layoff.amateurWeeks } }, {
    levelOf: () => 'amateur',
    before: (m, w, l) => { if (m.level === 'D') before.set(`${m.event}|${m.num}`, [w, l]); },
  });
  // A tie whose four singles players have three rated matches behind them: was the first singles the weaker pair's (its
  // better player's Elo below the second's)?
  const ordered = tiesOf.map(tie => [1, 2].map(num => before.get(`${tie.event}|${num}`))).filter(pair => pair.every(r => r && r.every(p => p.n >= 3)));
  say(`  The first singles the weaker pair's (its better player's Elo below the second's) in ${ordered.filter(([r1, r2]) => Math.max(...r1.map(p => p.elo)) < Math.max(...r2.map(p => p.elo))).length} `
    + `of ${ordered.length} ties whose four singles players have three rated matches behind them`);

}

// ---------- best of five against Elo ----------

say('\nBest of five against Elo: completed best-of-five matches, both men with twenty rated matches behind them, Elo before the match');
const manifest = JSON.parse(readFileSync(path.join(root, TOURS.atp.manifest), 'utf8'));
let matches = [];
const extra = new Map();
for (let season = 1968; season <= 2025; season++) {
  for (const [file, name] of [[0, TOURS.atp.file(season)], [1, TOURS.atp.other(season)]]) {
    if (!TOURS.atp.pins[name]) continue;
    const text = pinned('atp', name);
    matches.push(...parseMatchFile(text, { season, file }));
    for (const row of rowsOf(text)) extra.set(`${season}|${file}|${row.row}`, row);
  }
}
const rated = [];
rateMatches(orderMatches(matches), manifest.method, {
  before: (m, w, l) => { if (w.n >= 20 && l.n >= 20) rated.push({ m, row: extra.get(`${m.season}|${m.file}|${m.row}`), w: w.elo, l: l.elo }); },
});
const eloOdds = (x, y) => 1 / (1 + 10 ** ((y - x) / 400));
const independentSet = odds => { let lo = 0, hi = 1; for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (bestOfThree(mid) < odds) lo = mid; else hi = mid; } return (lo + hi) / 2; };
const dayForm = (odds, f) => daySetChances(odds).reduce((sum, { weight, s }) => sum + weight * f(s), 0);
const mean = (xs, f) => xs.reduce((sum, x) => sum + f(x), 0) / xs.length;
for (const [label, keep] of [['The majors, 1968–2025', ({ m, row }) => m.level === 'G' && row.bestOf === 5],
  ['The Davis Cup, 1968–2018', ({ m, row }) => /Davis Cup/.test(m.eventName) && row.bestOf === 5]]) {
  const xs = rated.filter(x => x.row && keep(x) && setsOf(x.row.score)).map(x => ({ p: eloOdds(Math.max(x.w, x.l), Math.min(x.w, x.l)), favWon: x.w >= x.l, sets: setsOf(x.row.score).length }));
  say(`  ${label}: ${xs.length} matches; the favourite: Elo's best-of-three odds ${pct(mean(xs, x => x.p))}, day form over five sets ${pct(mean(xs, x => dayForm(x.p, bestOfFive)))}, `
    + `independent sets ${pct(mean(xs, x => bestOfFive(independentSet(x.p))))}, won ${pct(mean(xs, x => (x.favWon ? 1 : 0)))}; to a fifth set: day form ${pct(mean(xs, x => dayForm(x.p, s => 6 * s * s * (1 - s) ** 2)))}, `
    + `independent sets ${pct(mean(xs, x => { const s = independentSet(x.p); return 6 * s * s * (1 - s) ** 2; }))}, real ${pct(mean(xs, x => (x.sets === 5 ? 1 : 0)))}; `
    + `straight sets: day form ${pct(mean(xs, x => dayForm(x.p, s => s ** 3 + (1 - s) ** 3)))}, real ${pct(mean(xs, x => (x.sets === 3 ? 1 : 0)))}`);
}
const tour = rated.filter(({ m, row }) => row && m.file === 0 && !['G', 'D'].includes(m.level) && row.bestOf === 3 && m.season >= 2000 && setsOf(row.score))
  .map(x => ({ p: eloOdds(Math.max(x.w, x.l), Math.min(x.w, x.l)), favWon: x.w >= x.l }));
say(`  The tour's best-of-three matches, 2000–2025: ${tour.length}; the favourite: Elo's odds ${pct(mean(tour, x => x.p))}, won ${pct(mean(tour, x => (x.favWon ? 1 : 0)))}`);
process.stdout.write(`${lines.join('\n')}\n`);
