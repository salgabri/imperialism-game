// Compare shipped maps with their committed versions (git HEAD, or --base=<rev>): each club's land and how far its
// ground lies outside it, and per map the smallest land, clubs under a quarter of a fair share and the spread of land
// per fair share (sd of its log).
// Usage: node scripts/compare-maps.mjs <id> [<id> ...] [--base=<rev>] [--clubs] [--json=<out>]
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { feature } from 'topojson-client';
import { bboxOf, kmToPolys, pointInPolys, polysAreaKm2, polysOf } from './lib/domestic-partition.mjs';

const args = process.argv.slice(2);
const flag = name => args.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const base = flag('base') ?? 'HEAD';
const ids = args.filter(a => !a.startsWith('--'));

function summary(doc) {
  const geoms = doc.topology.objects.sections.geometries;
  const index = new Map(geoms.map((g, i) => [g.id, i]));
  const polys = geoms.map(g => polysOf(feature(doc.topology, g).geometry));
  const shifted = bboxOf(polys.flat())[2] > 180;
  const frame = ([lon, lat]) => [shifted && lon < 0 ? lon + 360 : lon, lat];
  const clubs = doc.clubs.map(club => {
    const own = (club.sections || [club.section]).flatMap(id => polys[index.get(id)]);
    const area = polysAreaKm2(own);
    const home = club.home && frame(club.home);
    const km = home ? (pointInPolys(home, own) ? 0 : kmToPolys(home, own)) : null;
    return { id: club.id, name: club.name ?? club.id, area, km, sections: (club.sections || [club.section]).length };
  });
  const total = clubs.reduce((s, c) => s + c.area, 0);
  const S = clubs.reduce((s, c) => s + c.sections, 0);
  const logs = clubs.map(c => Math.log(c.area / (total * c.sections / S)));
  const mean = logs.reduce((a, b) => a + b, 0) / logs.length;
  return {
    clubs,
    min: Math.min(...clubs.map(c => c.area)),
    quarter: clubs.filter(c => c.area < 0.25 * total * c.sections / S).length,
    spread: Math.sqrt(logs.reduce((s, l) => s + (l - mean) ** 2, 0) / logs.length),
    out: clubs.filter(c => c.km != null && c.km > 0.5).length,
  };
}

const rows = [];
for (const id of ids) {
  const file = `public/domestic/${id}.json`;
  const after = summary(JSON.parse(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')));
  let before = null;
  try { before = summary(JSON.parse(execFileSync('git', ['show', `${base}:${file}`], { encoding: 'utf8', maxBuffer: 64 << 20 }))); } catch { /* new map */ }
  const f = v => (v == null ? '-' : v >= 100 ? Math.round(v) : v.toFixed(2));
  console.log(`${id}: smallest ${f(before?.min)} -> ${f(after.min)} km²; under a quarter share ${before?.quarter ?? '-'} -> ${after.quarter}; spread ${f(before?.spread)} -> ${f(after.spread)}; grounds out ${before?.out ?? '-'} -> ${after.out}`);
  if (args.includes('--clubs')) {
    for (const club of after.clubs) {
      const was = before?.clubs.find(c => c.id === club.id);
      const changed = !was || Math.abs(was.area - club.area) > 0.02 * Math.max(was.area, club.area) || (was.km ?? 0) > 0.5;
      if (changed) console.log(`   ${club.name.padEnd(32)} ${f(was?.area).toString().padStart(8)} -> ${f(club.area).toString().padStart(8)} km²   ground ${f(was?.km)} -> ${f(club.km)} km`);
    }
  }
  rows.push({ id, before: before && { ...before, clubs: undefined }, after: { ...after, clubs: undefined } });
}
if (flag('json')) writeFileSync(flag('json'), JSON.stringify(rows, null, 1));
