// Each club's games, runs and shutouts in MLB's own Stats API (MLB Advanced Media), for the seasons the Baseball
// Databank does not hold (2023 on) and for a spread of the seasons it does, to check the two agree. Baseball plays each
// season at its league's runs a game (src/data/mlbLeagueAverages.js, docs/design/baseball.md "Rules by era"); the
// Databank's seasons are summed from its Teams.csv by npm run import:mlb-war, the later ones from this file.
//
//   node scripts/sync-mlb-league-runs.mjs     reads the API (two requests a season, 1.5 s apart) and writes
//                                             scripts/data/mlb-league-runs.json (committed)
//
// The answers are https://statsapi.mlb.com/api/v1/teams/stats?season=<season>&sportIds=1&group=<hitting|pitching>
// &stats=season&gameType=R: the regular season of every MLB club, its games and runs scored (hitting) and its pitchers'
// shutouts and outs (pitching). statsapi.mlb.com serves no robots.txt (HTTP 404 on 2026-11-10); MLB Advanced Media's
// notice (http://gdx.mlb.com/components/copyright.txt) covers its other answers, and only these facts are kept.
// scripts/baseball-eras.test.mjs sums the file and holds src/data/mlbLeagueAverages.js to it.
import { writeFile } from 'node:fs/promises';
import { politeFetch } from './lib/polite-fetch.mjs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const output = path.join(root, 'scripts/data/mlb-league-runs.json');
const URL_PATTERN = 'https://statsapi.mlb.com/api/v1/teams/stats?season=<season>&sportIds=1&group=<group>&stats=season&gameType=R';
// The seasons after the Databank's last (2022), and seasons of every era it holds, to compare.
const SEASONS = [1960, 1968, 1981, 1987, 1994, 2000, 2010, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026];
const PAUSE_MS = 1500;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function answer(season, group) {
  const url = URL_PATTERN.replace('<season>', season).replace('<group>', group);
  const response = await politeFetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  const splits = (await response.json()).stats?.[0]?.splits;
  if (!Array.isArray(splits) || !splits.length) throw new Error(`${url}: no clubs`);
  await sleep(PAUSE_MS);
  return new Map(splits.map(split => [split.team.id, { name: split.team.name, stat: split.stat }]));
}

const NOTE = 'Each MLB club\'s regular season in MLB\'s Stats API (MLB Advanced Media), by season: [team id, name, games, runs scored, '
  + 'shutouts its pitchers threw, outs its pitchers recorded]. Games and runs from the hitting answer, shutouts and outs from the pitching '
  + 'answer (whose games must agree). '
  + 'Written by node scripts/sync-mlb-league-runs.mjs; src/data/mlbLeagueAverages.js takes 2023 on from it, and the earlier seasons here '
  + 'check its Baseball Databank totals (scripts/baseball-eras.test.mjs).';

async function main() {
  const seasons = {};
  for (const season of SEASONS) {
    const hitting = await answer(season, 'hitting');
    const pitching = await answer(season, 'pitching');
    const rows = [...hitting].sort(([a], [b]) => a - b).map(([id, { name, stat }]) => {
      const pitched = pitching.get(id)?.stat;
      if (!pitched || pitched.gamesPlayed !== stat.gamesPlayed) throw new Error(`${season}: ${name}'s pitching answer does not match its hitting`);
      return [id, name, stat.gamesPlayed, stat.runs, pitched.shutouts, pitched.outs];
    });
    if (rows.length !== pitching.size) throw new Error(`${season}: the pitching answer lists other clubs`);
    seasons[season] = rows;
    const total = key => rows.reduce((sum, row) => sum + row[key], 0);
    console.log(`${season}: ${rows.length} clubs, ${total(2)} games, ${total(3)} runs (${(total(3) / total(2)).toFixed(3)} a game, `
      + `${(27 * total(3) / total(5)).toFixed(3)} a nine innings), ${total(4)} shutouts, ${total(5)} outs`);
  }
  const source = { name: 'MLB Stats API', publisher: 'MLB Advanced Media', url: URL_PATTERN, retrieved: new Date().toISOString().slice(0, 10),
    robots: 'statsapi.mlb.com serves no robots.txt (HTTP 404)', userAgent: 'imperialism-game-data/1.0' };
  const lines = Object.entries(seasons).map(([season, rows]) => `    "${season}": [\n${rows.map(row => `      ${JSON.stringify(row)}`).join(',\n')}\n    ]`);
  await writeFile(output, `{\n  "note": ${JSON.stringify(NOTE)},\n  "source": ${JSON.stringify(source)},\n  "seasons": {\n${lines.join(',\n')}\n  }\n}\n`);
  console.log(`Wrote ${path.relative(root, output)}`);
}

main().catch(error => {
  console.error(`sync-mlb-league-runs: ${error.message}`);
  process.exitCode = 1;
});
