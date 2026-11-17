// The roster audit (docs/design/roster-audit.md, logic in scripts/lib/roster-audit.mjs): every season of every sport,
// read as a campaign reads it, checked for what the loader's structural validation does not catch.
//
//   npm run audit:rosters                          prints each sport's totals, every error and a few of each warning
//   npm run audit:rosters -- --sport=hockey,tennis  only those sports
//   npm run audit:rosters -- --all                 prints every finding
//   npm run audit:rosters -- --write               also writes docs/design/roster-audit.json (all sports only)
//
// Exits 1 when any error is found. Reads only the repository: the built-in data and public/<sport>/<id>.json.
import { writeFileSync } from 'node:fs';
import { CHECKS, auditReport, auditRosters, findingLine, findingsOf } from './lib/roster-audit.mjs';

const root = new URL('../', import.meta.url);
const arg = name => process.argv.slice(2).find(a => a === `--${name}` || a.startsWith(`--${name}=`));
const value = name => arg(name)?.split('=').slice(1).join('=') || null;
const sports = value('sport')?.split(',').filter(Boolean) ?? null;
const all = !!arg('all');
if (arg('write') && sports) throw new Error('--write writes the whole report: run it without --sport');

const started = Date.now();
const audit = auditRosters(root, { sports });
const { seasons, findings } = audit;

const pad = (text, n) => String(text).padEnd(n);
const lpad = (text, n) => String(text).padStart(n);
const bySport = new Map();
for (const s of seasons) {
  const row = bySport.get(s.sport) ?? { seasons: 0, teams: 0, players: 0 };
  row.seasons++; row.teams += s.nations + s.clubs; row.players += s.ratings.players;
  bySport.set(s.sport, row);
}
console.log(`${pad('sport', 18)}${lpad('seasons', 8)}${lpad('teams', 8)}${lpad('players', 9)}  errors  warnings`);
for (const [sport, row] of bySport) {
  const mine = findings.filter(f => seasons.find(s => s.id === f.season)?.sport === sport);
  console.log(`${pad(sport, 18)}${lpad(row.seasons, 8)}${lpad(row.teams, 8)}${lpad(row.players, 9)}  ${lpad(findingsOf(mine, 'error').length, 6)}  ${lpad(findingsOf(mine, 'warning').length, 8)}`);
}
console.log('');
const idWidth = Math.max(...Object.keys(CHECKS).map(id => id.length));
for (const [id, { severity, about }] of Object.entries(CHECKS)) {
  const found = findings.filter(f => f.check === id);
  console.log(`${severity === 'error' ? 'ERROR  ' : 'warning'} ${pad(id, idWidth)} ${lpad(found.length, 5)}  ${about}`);
  const shown = severity === 'error' || all ? found : found.slice(0, 5);
  for (const f of shown) console.log(`          ${findingLine(f)}`);
  if (shown.length < found.length) console.log(`          … ${found.length - shown.length} more (--all lists them)`);
}

if (arg('write')) {
  const file = new URL('docs/design/roster-audit.json', root);
  writeFileSync(file, `${JSON.stringify(auditReport(audit), null, 1)}\n`);
  console.log(`\nWrote docs/design/roster-audit.json`);
}
const errors = findingsOf(findings, 'error').length;
console.log(`\n${seasons.length} seasons, ${errors} error${errors === 1 ? '' : 's'}, ${findingsOf(findings, 'warning').length} warnings (${((Date.now() - started) / 1000).toFixed(1)} s)`);
if (errors) process.exitCode = 1;
