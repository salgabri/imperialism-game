// Build ice hockey's rules by era (docs/design/hockey.md, "Rules by era").
//
//   node scripts/build-nhl-league.mjs           writes src/data/nhlLeagueAverages.js and scripts/data/nhl-playoff-overtimes.json
//   node scripts/build-nhl-league.mjs --check   builds both and compares them byte for byte, writes nothing
//   node scripts/build-nhl-league.mjs --fetch   first downloads the NHL.com pages missing from data-src/nhl-overtimes/
//
// Each built-in season's goals a club scored a game come from the pinned downloads in data-src/nhl-seasons/ (node
// scripts/sync-nhl-seasons.mjs --fetch downloads them), and its scoring factor is solved on its clubs
// (public/hockey/<id>.json) under its own overtime (scripts/lib/nhl-league.mjs). Without those downloads the committed
// goals are kept, and only the factors are solved again. The playoff overtimes are read from NHL.com's lists, as the
// Wayback Machine keeps them (cached in data-src/nhl-overtimes/, each pinned by SHA-256 in the JSON); without the pages
// the committed list is kept.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { politeFetch } from './lib/polite-fetch.mjs';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { BUILT_IN_HOCKEY_SEASONS } from '../src/data/hockeySeasons.js';
import { leagueGoals, parseOvertimePage, pinnedReader, seasonClubs, solveScoring } from './lib/nhl-league.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const moduleFile = path.join(root, 'src/data/nhlLeagueAverages.js');
const overtimesFile = path.join(root, 'scripts/data/nhl-playoff-overtimes.json');
const pagesDir = path.join(root, 'data-src/nhl-overtimes');

// NHL.com's "Overtime Games" of the Stanley Cup playoffs, a page a decade (the one titled 2000-08 runs on to 2010, read to
// 2009: LAST_PLAYOFFS), as the Wayback Machine captured them on 10 November 2012 (linked from Wikipedia's Overtime (ice
// hockey), "List of all NHL overtime games by decade"). web.archive.org has no robots.txt.
const OVERTIME_PAGES = [
  ['1960-69', 'https://web.archive.org/web/20121110085429/http://www.nhl.com/ice/page.htm?id=31242'],
  ['1970-79', 'https://web.archive.org/web/20121110085434/http://www.nhl.com/ice/page.htm?id=31243'],
  ['1980-89', 'https://web.archive.org/web/20121110085419/http://www.nhl.com/ice/page.htm?id=31244'],
  ['1990-99', 'https://web.archive.org/web/20121110085424/http://www.nhl.com/ice/page.htm?id=31245'],
  ['2000-08', 'https://web.archive.org/web/20121110085832/http://www.nhl.com/ice/page.htm?id=31027'],
];

const args = process.argv.slice(2);
const check = args.includes('--check'), fetchMissing = args.includes('--fetch');
const unknown = args.filter(arg => !['--check', '--fetch'].includes(arg));
if (unknown.length) throw new Error(`Unknown arguments: ${unknown.join(' ')}`);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

/** The playoff overtimes: from the cached pages (each checked against its pin), else the committed list. */
async function playoffOvertimes(committed) {
  const pins = new Map((committed?.sources ?? []).map(source => [source.decade, source.sha256]));
  const pages = [];
  for (const [decade, url] of OVERTIME_PAGES) {
    const file = path.join(pagesDir, `${decade}.html`);
    if (!existsSync(file) && fetchMissing) {
      await mkdir(pagesDir, { recursive: true });
      const response = await politeFetch(url);
      if (!response.ok) throw new Error(`${url}: ${response.status}`);
      await writeFile(file, Buffer.from(await response.arrayBuffer()));
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    if (!existsSync(file)) return { doc: committed, from: 'kept' };
    const bytes = await readFile(file);
    const hash = sha256(bytes);
    if (pins.has(decade) && pins.get(decade) !== hash) throw new Error(`data-src/nhl-overtimes/${decade}.html is not the pinned page (SHA-256 ${hash})`);
    pages.push({ decade, url, sha256: hash, games: parseOvertimePage(bytes.toString('utf8')) });
  }
  const games = pages.flatMap(page => page.games);
  const doc = {
    note: 'Every NHL playoff overtime game from 1960 to 2009, as NHL.com listed them a decade a page: the date and how long '
      + 'the overtime ran, every period of it (m:ss; a game settled in its first overtime ran 20:00 or less). Built by node '
      + 'scripts/build-nhl-league.mjs from the pages cached in data-src/nhl-overtimes/ (--fetch), each pinned here by '
      + 'SHA-256 (`games`: the rows read from it); the pre-shoot-out overtimes of src/sports/hockey.js are calibrated on it.',
    sources: pages.map(({ decade, url, sha256: hash }) => ({ decade, url, sha256: hash, games: pages.find(p => p.decade === decade).games.length })),
    games,
  };
  return { doc, from: 'pages' };
}

const overtimesText = doc => `{\n  "note": ${JSON.stringify(doc.note)},\n  "sources": [\n${doc.sources.map(source => `    ${JSON.stringify(source)}`).join(',\n')}\n  ],\n`
  + `  "games": [\n${doc.games.map(game => `    ${JSON.stringify(game)}`).join(',\n')}\n  ]\n}\n`;

function moduleText(rows) {
  const lines = rows.map(({ season, goals, scoring }) => `  '${season}': Object.freeze({ goals: ${goals.toFixed(2)}, scoring: ${scoring} }),`);
  return `// GENERATED by node scripts/build-nhl-league.mjs; do not edit.
// NHL league averages per regular season (docs/design/hockey.md, "Rules by era"). \`goals\`: the goals a club scored a
// game, a shoot-out's deciding goal left out (the NHL counts one for the shoot-out's winner, which nobody scored). To
// 2017/18 the Hockey Databank's Teams.csv (version 13.0, github.com/rippinrobr/hockey-databank commit de59443): every NHL
// club's goals for (GF) less its shoot-out wins (SoW), over its games (G). From 2018/19 MoneyPuck.com's game-by-game skater
// files: the goals every skater of a club scored in a regular-season game, over the club-games they hold (a game they
// hold for one side only is left out, one each in 2019/20 and 2025/26); for 2021/22, which it keeps no game file of, its
// season summary's skater goals over the 32 clubs' 82 games each (Wikipedia's 2021–22 NHL season,
// https://en.wikipedia.org/w/index.php?oldid=1383879616, read 2026-11-10). Every download is pinned by SHA-256 in
// scripts/data/nhl-seasons-sources.json, and the build recomputes every figure from them when they are on the computer.
// \`scoring\`: the match model's, not the league's: the factor on the season's scoring rates that brings its clubs' games
// to \`goals\` under its own overtime (src/sports/hockey.js, \`hockeyIn\`), solved over every pairing of its clubs. The
// built-in season, 2026/27, plays today's level, 1: its clubs average 3.05 goals a game, the latest full season's league
// ${rows.at(-1).goals.toFixed(2)}.
export const NHL_LEAGUE_AVERAGES = Object.freeze({
${lines.join('\n')}
});

/** The latest full season, the one the built-in season's level stands for until its own season is complete. */
export const LATEST_NHL_SEASON = '${rows.at(-1).season}';
`;
}

const seasons = BUILT_IN_HOCKEY_SEASONS.map(({ id, year, season }) => ({ id, year, season })).sort((a, b) => a.year - b.year);
const committedModule = existsSync(moduleFile) ? await import(pathToFileURL(moduleFile).href) : null;
const recomputed = leagueGoals(pinnedReader(root), seasons);
const goalsOf = season => {
  if (recomputed) return recomputed[season].goals;
  const kept = committedModule?.NHL_LEAGUE_AVERAGES?.[season]?.goals;
  if (!Number.isFinite(kept)) throw new Error(`${season}: no goals to keep, and the downloads are not in data-src/nhl-seasons/`);
  return kept;
};

const rows = [];
for (const { id, year, season } of seasons) {
  const goals = goalsOf(season);
  const scoring = solveScoring(year, seasonClubs(root, id), goals);
  rows.push({ season, goals, scoring });
  if (!check) console.log(`${season}  ${goals.toFixed(2)} goals a club a game${recomputed ? ` (${recomputed[season].source})` : ''}, scoring ${scoring}`);
}

const committedOvertimes = existsSync(overtimesFile) ? JSON.parse(await readFile(overtimesFile, 'utf8')) : null;
const overtimes = await playoffOvertimes(committedOvertimes);
if (!overtimes.doc) throw new Error('No playoff overtimes: run with --fetch to download NHL.com\'s pages');

const outputs = [[moduleFile, moduleText(rows)], [overtimesFile, overtimesText(overtimes.doc)]];
if (check) {
  const differ = [];
  for (const [file, text] of outputs) if (!existsSync(file) || await readFile(file, 'utf8') !== text) differ.push(path.relative(root, file));
  if (differ.length) {
    console.error(`Out of date: ${differ.join(', ')}. Run node scripts/build-nhl-league.mjs`);
    process.exit(1);
  }
  console.log(`Verified the ${rows.length} seasons' league goals (${recomputed ? 'recomputed from the downloads' : 'kept'}) and scoring, `
    + `and ${overtimes.doc.games.length} playoff overtimes (${overtimes.from === 'pages' ? 'from the pages' : 'kept'}), byte for byte.`);
} else {
  for (const [file, text] of outputs) await writeFile(file, text);
  console.log(`Wrote ${outputs.map(([file]) => path.relative(root, file)).join(' and ')}.`);
}
