// Acceptance checks for every shipped domestic map (docs/design/domestic-campaigns.md,
// "Acceptance checks"): public/domestic/<id>.json against its committed snapshot,
// the game's own loader, the generated index and the attribution file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { feature, neighbors } from 'topojson-client';
import { DOMESTIC, DOMESTIC_FORMAT } from '../src/data/domestic.js';
import { decodeDomestic, DOMESTIC_SECTIONS } from '../src/engine/domestic.js';
import { expandFmTuple, FM_ROLES } from '../src/data/fmPlayers.js';
import { FOREIGN_DEPTH_KM, hostShapes, loadWorldMap } from './lib/domestic-boundaries.mjs';
import { bboxOf, facingKm, facingSections, kmToPolys, pointInPolys, polysAreaKm2, splitOnLand } from './lib/domestic-partition.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const shippedDir = path.join(root, 'public/domestic');
const snapshotDir = path.join(root, 'scripts/data/domestic');
const FILE = /^(\d{3}|KOS)\.json$/;
const MAX_BYTES = 250000;
const shipped = readdirSync(shippedDir).filter(f => FILE.test(f)).map(f => f.slice(0, -5)).sort();
const attribution = readFileSync(path.join(shippedDir, 'ATTRIBUTION.txt'), 'utf8');
const world = loadWorldMap(JSON.parse(readFileSync(path.join(root, 'public/countries-50m.json'), 'utf8')));

/** Why a section name would read badly in a tooltip or a conquest result, or null. */
function nameProblem(name) {
  const letters = name.replace(/[^\p{L}]/gu, '');
  if (name !== name.trim() || /\s{2}/.test(name)) return 'stray spaces';
  if (/[\u0000-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/.test(name)) return 'control or bidi characters';
  if (/[ÃÂ][\u0080-\u00bf]|\ufffd/.test(name)) return 'mojibake';
  if (/[^\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]/u.test(name)) return 'not in Latin script';
  if (/[:?*\\|[\]{}<>=#@$%^~_`]/.test(name)) return 'stray symbols';
  if (/\p{L}\d|\d\p{L}/u.test(name.replace(/\b\d+(st|nd|rd|th|ro|ra|er|re|e|o|a)\b\.?/gi, ' '))) return 'digits inside a word';
  if (letters.length < 2 || /^[A-Z]{1,3}$/.test(name)) return 'a code, not a name';
  if (/^(Unit|Region|Zone) \d+/.test(name) || /\)\s*\(/.test(name)) return 'a placeholder or stacked suffixes';
  return null;
}

test('the index lists every shipped map once, in name order', () => {
  const ids = DOMESTIC.map(e => e.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate index ids');
  assert.deepEqual([...ids].sort(), shipped, 'index entries and public/domestic/*.json differ');
  const names = DOMESTIC.map(e => e.name);
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b, 'en')), 'index is not in name order');
  for (const e of DOMESTIC) assert.ok(attribution.includes(`(${e.id}), ${e.version}:`), `ATTRIBUTION.txt lacks ${e.id} ${e.version}`);
});

const polysOf = (topo, g) => {
  const geometry = feature(topo, g).geometry;
  return geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
};

for (const entry of DOMESTIC) {
  test(`${entry.id} ${entry.name}: shipped map`, () => {
    const file = path.join(shippedDir, `${entry.id}.json`);
    assert.ok(statSync(file).size <= MAX_BYTES, `${statSync(file).size} bytes > ${MAX_BYTES}`);
    const doc = JSON.parse(readFileSync(file, 'utf8'));
    const snapshot = JSON.parse(readFileSync(path.join(snapshotDir, `${entry.id}.json`), 'utf8'));
    const { id } = entry;
    const n = snapshot.clubs.length;

    // Header, version hash and index entry.
    assert.equal(doc.format, DOMESTIC_FORMAT);
    assert.equal(doc.id, id);
    assert.equal(doc.name, entry.name);
    assert.equal(doc.version, entry.version);
    const { version, ...rest } = doc;
    assert.equal(version, `${id}-${createHash('sha256').update(JSON.stringify(rest)).digest('hex').slice(0, 8)}`, 'version is not the content hash');
    assert.equal(entry.clubs, n);
    assert.equal(entry.sections, DOMESTIC_SECTIONS);
    assert.equal(entry.level, doc.boundaries.level);
    const strongest = doc.clubs.map((c, i) => [c.str, i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]).slice(0, 3).map(([, i]) => doc.clubs[i].name);
    assert.deepEqual(entry.top, strongest);
    assert.equal(doc.source.version, snapshot.source.version);
    assert.equal(doc.source.snapshotDate, snapshot.source.fetchedAt.slice(0, 10));

    // 100 sections <id>-001..100 shared out as N club groups: home first, ids in club rank
    // order, sizes floor or ceil(100 / N) with exactly 100 mod N larger groups.
    const S = DOMESTIC_SECTIONS;
    assert.ok(n >= 2 && n <= S, `N = ${n}`);
    const geoms = doc.topology.objects.sections.geometries;
    assert.equal(geoms.length, S, 'sections');
    assert.equal(doc.clubs.length, n, 'clubs');
    const sectionIds = geoms.map(g => g.id);
    assert.deepEqual(sectionIds, Array.from({ length: S }, (_, k) => `${id}-${String(k + 1).padStart(3, '0')}`), 'section ids');
    doc.clubs.forEach(club => assert.equal(club.sections[0], club.section, `${club.name}: home section first`));
    assert.deepEqual(doc.clubs.flatMap(c => c.sections), sectionIds, 'club groups do not list every section once, in club rank order');
    const q = Math.floor(S / n);
    const sizes = doc.clubs.map(c => c.sections.length);
    assert.ok(sizes.every(k => k === q || k === q + 1), `group sizes ${[...new Set(sizes)].join('/')}`);
    assert.equal(sizes.filter(k => k === q + 1).length, S - q * n, 'number of larger groups');
    const clubAt = geoms.map(g => doc.clubs.findIndex(c => c.sections.includes(g.id)));
    assert.equal(new Set(doc.clubs.map(c => c.id)).size, n, 'duplicate club ids');
    assert.equal(new Set(doc.clubs.map(c => c.code)).size, n, 'duplicate codes');

    // Every club and tuple is the committed snapshot's.
    const source = { ...doc.source };
    doc.clubs.forEach((club, i) => {
      const s = snapshot.clubs[i];
      const label = `${id} ${club.name}`;
      assert.equal(club.fm, s.fm, `${label}: rank ${i + 1} is not the snapshot's club`);
      assert.equal(club.id, `d${id}-${s.fm}`);
      assert.equal(club.name, s.name);
      assert.equal(club.rep, s.rep);
      assert.equal(club.league, s.competition || 'Regional football');
      // Letters; a club number only as in S04 or H96, never as padding.
      assert.match(club.code, /^[A-Z]{3}$|^[A-Z]\d\d$/, `${label}: code ${club.code}`);
      if (/\d/.test(club.code)) assert.match(club.name, new RegExp(`(^|\\D)${club.code.slice(1)}(\\D|$)`), `${label}: code ${club.code} pads with digits`);
      assert.deepEqual(club.squad, s.squad, `${label}: squad differs from the snapshot`);
      if (/^placed:/.test(club.homeSource ?? '')) {
        // An estimate for a club with no usable home: a GeoNames place.
        assert.match(club.homeSource, /^placed:\d+$/, `${label}: placed home source`);
        assert.ok(club.home.every(Number.isFinite), `${label}: placed home`);
      } else if (club.home) {
        assert.deepEqual(club.home, [s.location.lon, s.location.lat], `${label}: home`);
        assert.equal(club.homeSource, s.location.source);
      } else {
        assert.equal(club.home, null);
      }
      assert.ok(club.squad.length >= 11, `${label}: ${club.squad.length} players`);
      assert.ok(club.squad.some(t => t[3].split(',').includes('gk')), `${label}: no natural goalkeeper`);
      assert.equal(new Set(club.squad.map(t => t[0])).size, club.squad.length, `${label}: duplicate players`);
      for (const tuple of club.squad) {
        assert.ok(Number.isInteger(tuple[2]) && tuple[2] >= 1 && tuple[2] <= 100, `${label}: ability ${tuple[2]}`);
        assert.ok(tuple[3].split(',').every(k => Object.hasOwn(FM_ROLES, k)), `${label}: positions ${tuple[3]}`);
        const rating = expandFmTuple(tuple, source, club.name)[2];
        assert.ok(Number.isInteger(rating) && rating >= 1 && rating <= 99, `${label}: rating ${rating}`);
      }
      assert.ok(Number.isFinite(club.str) && club.str >= 1 && club.str <= 99, `${label}: str ${club.str}`);
    });

    // The game's own loader accepts it, and every section has a finite, non-empty shape.
    const decoded = decodeDomestic(doc, id);
    assert.equal(decoded.clubs.length, n);
    for (const sid of sectionIds) {
      const p = decoded.geo.paths[sid];
      assert.ok(p && Number.isFinite(p.cx) && Number.isFinite(p.cy) && p.area > 0, `${sid} does not decode to a finite, non-empty shape`);
    }

    // Dissolved: no section uses an arc twice (an internal border, or two touching parts).
    // Contiguous except across water: every part but the largest touches the coast.
    const use = new Map();
    const partsOf = g => (g.type === 'Polygon' ? [g.arcs] : g.arcs);
    for (const g of geoms) for (const poly of partsOf(g)) for (const ring of poly) for (const a of ring) {
      const k = a < 0 ? ~a : a;
      use.set(k, (use.get(k) || 0) + 1);
    }
    const sectionPolys = geoms.map(g => polysOf(doc.topology, g));
    geoms.forEach((g, i) => {
      const own = partsOf(g).flatMap(poly => poly.flat()).map(a => (a < 0 ? ~a : a));
      assert.equal(new Set(own).size, own.length, `${g.id} is not dissolved`);
      const areas = sectionPolys[i].map(poly => polysAreaKm2([poly]));
      const main = areas.indexOf(Math.max(...areas));
      partsOf(g).forEach((poly, j) => {
        if (j !== main) assert.ok(poly[0].some(a => use.get(a < 0 ? ~a : a) === 1), `${g.id} part ${j} is landlocked by other sections`);
      });
    });
    // A club's group is contiguous except across water: one part per landmass.
    const split = splitOnLand(geoms, clubAt).map(c => doc.clubs[c].name);
    assert.deepEqual(split, [], `groups split on land: ${split.join(', ')}`);

    // Neighbouring clubs' groups differ clearly in colour (OKLab distance).
    const lab = col => {
      const [l, c, h] = col.match(/^oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)$/).slice(1).map(Number);
      return [l, c * Math.cos(h * Math.PI / 180), c * Math.sin(h * Math.PI / 180)];
    };
    // So do sections facing each other across a strait, a few pixels apart at the opening fit.
    const colours = doc.clubs.map(c => lab(c.col));
    const across = facingSections(sectionPolys, facingKm(doc.focus));
    neighbors(geoms).forEach((list, i) => [...list, ...across[i]].forEach(j => {
      const [a, b] = [clubAt[i], clubAt[j]];
      if (a === b) return;
      const d = Math.hypot(...colours[a].map((v, k) => v - colours[b][k]));
      assert.ok(d >= 0.1, `${geoms[i].id} and ${geoms[j].id} are neighbours with similar colours (${d.toFixed(3)})`);
    }));

    // Section names read well and tell sections apart.
    const names = geoms.map(g => g.properties.name);
    names.forEach((name, i) => assert.equal(nameProblem(name), null, `${geoms[i].id} is named ${JSON.stringify(name)}`));
    assert.equal(new Set(names.map(name => name.toLowerCase())).size, S, 'section names repeat');

    // Area within 2% of the source units; no overlaps on a sample grid.
    const areas = sectionPolys.map(polysAreaKm2);
    const total = areas.reduce((s, a) => s + a, 0);
    assert.ok(areas.every(a => a > 0), 'a section has no area');
    assert.ok(Math.abs(total - doc.boundaries.areaKm2) <= 0.02 * doc.boundaries.areaKm2, `sections ${Math.round(total)} km² vs source ${doc.boundaries.areaKm2} km²`);
    const boxes = sectionPolys.map(bboxOf);
    const sectionAt = p => sectionPolys.findIndex((polys, k) => {
      const b = boxes[k];
      return p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3] && pointInPolys(p, polys);
    });
    const [w, s, e, nn] = bboxOf(sectionPolys.flat());
    const steps = 60;
    let hits = 0;
    for (let iy = 0; iy < steps; iy++) for (let ix = 0; ix < steps; ix++) {
      const p = [w + (e - w) * (ix + 0.5) / steps, s + (nn - s) * (iy + 0.5) / steps];
      let inside = 0;
      sectionPolys.forEach((polys, k) => {
        const b = boxes[k];
        if (p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3] && pointInPolys(p, polys)) inside++;
      });
      assert.ok(inside <= 1, `sections overlap at ${p.map(v => v.toFixed(4))}`);
      hits += inside;
    }
    assert.ok(hits > 0, 'no sample point hit any section');

    // A club's home is in its own group or a stronger club's: where clubs share a town,
    // the strongest holds it (simplified borders may shift by a few hundred metres). When
    // every club starts on several sections, clubs crowded into one city are fanned out
    // from it or start just outside it: a home may then lie in a weaker club's group, but
    // the club's home section stays within a club territory's width of it.
    const frame = ([lon, lat]) => [w > 0 && lon < 0 ? lon + 360 : lon, lat];
    const groupPolys = c => doc.clubs[c].sections.flatMap(sid => sectionPolys[sectionIds.indexOf(sid)]);
    const reachKm = Math.sqrt(doc.boundaries.areaKm2 / n);
    doc.clubs.forEach((club, i) => {
      if (!club.home || /^placed:/.test(club.homeSource)) return;
      const p = frame(club.home);
      const k = sectionAt(p);
      if (k < 0 || clubAt[k] <= i || kmToPolys(p, groupPolys(i)) <= 0.6) return;
      const gap = kmToPolys(p, sectionPolys[sectionIds.indexOf(club.section)]);
      assert.ok(q >= 2 && gap <= reachKm, `${club.name}'s home lies in weaker ${doc.clubs[clubAt[k]].name}'s section ${geoms[k].id} (${gap.toFixed(1)} km from its own)`);
    });

    // A club placed at a GeoNames place (no usable home) gets an ordinary share of the land.
    doc.clubs.forEach((club, i) => {
      if (!/^placed:/.test(club.homeSource ?? '')) return;
      const own = club.sections.reduce((t, sid) => t + areas[sectionIds.indexOf(sid)], 0);
      assert.ok(own <= 6 * total / n, `placed ${club.name} holds ${(100 * own / total).toFixed(1)}% of the land`);
    });

    // No land the game's world map draws for another country, beyond its coarse borders.
    const host = hostShapes(world, id);
    let land = 0, foreign = 0;
    const grid = 100;
    for (let iy = 0; iy < grid; iy++) for (let ix = 0; ix < grid; ix++) {
      const p = [w + (e - w) * (ix + 0.5) / grid, s + (nn - s) * (iy + 0.5) / grid];
      if (sectionAt(p) < 0) continue;
      const cell = Math.cos(p[1] * Math.PI / 180) * ((e - w) / grid) * ((nn - s) / grid) * 111.195 ** 2; // km²
      land += cell;
      const r = [p[0] > 180 ? p[0] - 360 : p[0], p[1]];
      if (host.some(h => h.contains(r)) || !world.some(shape => !host.includes(shape) && shape.contains(r))) continue;
      if (!host.some(h => h.near(r, FOREIGN_DEPTH_KM))) foreign += cell;
    }
    assert.ok(foreign <= Math.max(0.005 * land, 50), `${Math.round(foreign)} km² (${(100 * foreign / land).toFixed(2)}%) of the map is another country's land on the world map`);
  });
}
