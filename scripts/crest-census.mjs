// The clubs the game shows under a monogram somewhere, by country and id: where a crest pass starts
// (docs/design/period-marks.md, "No club without a crest"). A club is its country and its id, never its id alone
// (scripts/lib/crest-census.mjs): a namesake's crest found for one country's club is no crest for the other's.
//
// Usage: node scripts/crest-census.mjs [--json]
//   prints one line per club, "<country> <id> <years> <maps and seasons>", then the totals; --json prints
//   [{ country, id, years, where }] instead (years: season years, "today" for today's season).
import { crestCensus } from './lib/crest-census.mjs';

const json = process.argv.includes('--json');
const clubs = new Map();
let appearances = 0;
for (const { where, country, id, year, file } of crestCensus()) {
  if (file) continue;
  appearances++;
  const key = `${country ?? '-'} ${id}`;
  if (!clubs.has(key)) clubs.set(key, { country, id, years: new Set(), where: new Set() });
  const club = clubs.get(key);
  club.years.add(year ?? 'today');
  club.where.add(where);
}
const list = [...clubs.values()].map(club => ({ ...club, years: [...club.years].sort(), where: [...club.where].sort() }))
  .sort((a, b) => `${a.country} ${a.id}`.localeCompare(`${b.country} ${b.id}`, 'en', { numeric: true }));
if (json) console.log(JSON.stringify(list, null, 1));
else {
  for (const { country, id, years, where } of list) console.log(`${country ?? '-'} ${id} ${years.join(',')} ${where.join(',')}`);
  console.log(`${list.length} clubs in ${appearances} club appearances show a monogram.`);
}
