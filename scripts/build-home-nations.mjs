// The home nations on the world map. Football fields England, Scotland, Wales and Northern Ireland, each with its
// own association and team, while the world-atlas maps draw one United Kingdom (826). This splits that shape along
// Natural Earth's borders between them, in both maps the game reads:
//   public/world-110m.v1.json  the rules geometry (world-atlas 1.1.4 world/110m.json)
//   public/countries-50m.json  display and routing (world-atlas 2.0.2 countries-50m.json)
// 826 becomes England; Scotland, Wales and Northern Ireland become shapes SCO, WAL and NIR. Every other shape and arc
// stays the upstream file's: Great Britain's coast is cut into arcs where the borders meet it, the two borders are new
// arcs, and the islands and Northern Ireland keep their arcs whole.
//
// Usage:
//   node scripts/build-home-nations.mjs [--check]
//     --check  rebuild offline from the caches and compare both maps byte for byte
//
// Inputs:  the upstream atlases (pinned by SHA-256) and Natural Earth 1:10m Admin 1 v5.1.2 (public domain), cached
//          under the gitignored data-src/ (world-atlas/, and boundaries/ne/ beside the domestic builds' copy).
// Outputs: public/world-110m.v1.json, public/countries-50m.json.
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDownloader, NE_URL } from './lib/domestic-boundaries.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const check = process.argv.includes('--check');
if (process.argv.slice(2).some(argument => argument !== '--check')) throw new Error('Only --check is supported');
const download = createDownloader({ offline: check, log: console.log });

const ATLASES = [
  { file: 'public/world-110m.v1.json', url: 'https://cdn.jsdelivr.net/npm/world-atlas@1.1.4/world/110m.json',
    sha256: '3e6e0d3e91071e1ca253ff14ed046701405eff584840276e876010028f0e6c11', cache: 'world-atlas-1.1.4-110m.json' },
  { file: 'public/countries-50m.json', url: 'https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-50m.json',
    sha256: '04342cdc1e3016bcd7db1630de95684d67b79fe3c8c460321e87aef469502394', cache: 'world-atlas-2.0.2-countries-50m.json' },
];
const UK = '826';
// Natural Earth admin-1 geounit (gu_a3) -> the game's shape. A 50m map names its shapes; the 110m map does not.
const NATIONS = [
  { gu: 'ENG', id: UK, name: 'England' },
  { gu: 'SCT', id: 'SCO', name: 'Scotland' },
  { gu: 'WLS', id: 'WAL', name: 'Wales' },
  { gu: 'NIR', id: 'NIR', name: 'Northern Ireland' },
];
// The two land borders across Great Britain, by their ends ([lon, lat] in Natural Earth) on the shore. A coarse map's
// coast may close the estuary an end is on (the 110m map has no Solway Firth), so past the shore a border follows the
// line as far from one nation's land as from the other's, an estuary's middle, until it leaves the island.
const BORDERS = [
  { a: 'ENG', b: 'SCT', ends: [[-3.050291, 54.98151], [-2.022857, 55.805487]] }, // the Solway Firth; north of Berwick
  { a: 'ENG', b: 'WLS', ends: [[-3.084543, 53.258572], [-2.665354, 51.617255]] }, // the Dee estuary; the Severn
];
// Plane for distances and simplification: longitude shrunk at Britain's latitude.
const KX = Math.cos(54 * Math.PI / 180);
// Steps (plane degrees, ~1 km) and their most along the seaward line.
const SEA_STEP = 0.01;
const SEA_STEPS = 400;

const sha256 = text => createHash('sha256').update(text).digest('hex');

// ---- Natural Earth: each home nation's land and the borders between them ----

async function naturalEarth() {
  const text = await download(NE_URL, path.join(root, 'data-src/boundaries/ne/ne_10m_admin_1.geojson'));
  const polys = Object.fromEntries(NATIONS.map(nation => [nation.gu, []]));
  for (const { properties, geometry } of JSON.parse(text).features) {
    if (properties.adm0_a3 !== 'GBR') continue;
    if (!polys[properties.gu_a3]) throw new Error(`Natural Earth has a UK unit in geounit ${properties.gu_a3}`);
    polys[properties.gu_a3].push(...(geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates));
  }
  const points = NATIONS.flatMap(nation => polys[nation.gu].flatMap(poly => poly.flatMap(ring => ring.map(([lon, lat]) => [lon * KX, lat, nation.gu]))));
  const borders = BORDERS.map(border => {
    const line = sharedLine(polys[border.a], polys[border.b], border);
    // Each side's outline without the border itself: its coast meets the other's at the border's ends.
    const shared = new Set(line.slice(1).map((point, i) => [line[i].join(), point.join()].sort().join('|')));
    const outline = gu => polys[gu].flatMap(poly => poly.flatMap(ring => ring.slice(1).flatMap((point, i) => (
      shared.has([ring[i].join(), point.join()].sort().join('|')) ? [] : [[plane(ring[i]), plane(point)]]))));
    const [a, b] = [outline(border.a), outline(border.b)];
    return { ...border, line, sea: [seaward(line.slice().reverse(), a, b, onLand), seaward(line, a, b, onLand)] };
  });
  return { points, borders };

  function onLand(p) {
    return Object.values(polys).some(list => list.some(poly => poly.filter(ring => insideRing(p, ring.map(plane))).length % 2 === 1));
  }
}

/**
 * The line on from a border's last point (on the shore) out to sea, as far from one nation's outline as from the
 * other's (`a` and `b`: plane edges). Each step is the point of that kind a step away, at sea on the first step and
 * after that the one straightest ahead.
 */
function seaward(line, a, b, onLand) {
  const near = (edges, p) => {
    let best = Infinity;
    for (const [q, r] of edges) {
      const dx = r[0] - q[0], dy = r[1] - q[1], length = dx * dx + dy * dy;
      const t = length ? Math.max(0, Math.min(1, ((p[0] - q[0]) * dx + (p[1] - q[1]) * dy) / length)) : 0;
      best = Math.min(best, (q[0] + t * dx - p[0]) ** 2 + (q[1] + t * dy - p[1]) ** 2);
    }
    return Math.sqrt(best);
  };
  const [x, y] = plane(line.at(-1));
  const local = edges => edges.filter(([q]) => Math.abs(q[0] - x) < 3 && Math.abs(q[1] - y) < 3);
  const [nearA, nearB] = [local(a), local(b)];
  const gap = p => near(nearA, p) - near(nearB, p);
  // Points a step from `p` where the gap closes, by angle within `spread` of `heading`.
  const closing = (p, heading, spread) => {
    const at = angle => [p[0] + Math.cos(angle) * SEA_STEP, p[1] + Math.sin(angle) * SEA_STEP];
    const found = [], samples = 90;
    let previous = heading - spread, previousGap = gap(at(previous));
    for (let i = 1; i <= samples; i++) {
      const angle = heading - spread + (2 * spread * i) / samples, value = gap(at(angle));
      if (Math.sign(value) !== Math.sign(previousGap)) {
        let lo = previous, hi = angle;
        for (let k = 0; k < 30; k++) {
          const mid = (lo + hi) / 2;
          if (Math.sign(gap(at(mid))) === Math.sign(previousGap)) lo = mid; else hi = mid;
        }
        found.push({ angle: (lo + hi) / 2, point: at((lo + hi) / 2) });
      }
      previous = angle;
      previousGap = value;
    }
    return found;
  };
  const turn = (angle, heading) => Math.abs(Math.atan2(Math.sin(angle - heading), Math.cos(angle - heading)));
  // The border's own heading, from ~5 km back, decides between two ways out to sea.
  let p = plane(line.at(-1)), back = line.length - 2;
  while (back > 0 && Math.hypot(...plane(line[back]).map((v, k) => v - p[k])) < 0.05) back--;
  let heading = Math.atan2(p[1] - plane(line[back])[1], p[0] - plane(line[back])[0]);
  const out = [];
  for (let step = 0; step < SEA_STEPS; step++) {
    const options = step ? closing(p, heading, Math.PI / 2.5) : closing(p, heading, Math.PI).filter(option => !onLand(option.point));
    if (!options.length) throw new Error(`The seaward line from ${line.at(-1)} loses its way at ${[p[0] / KX, p[1]]}`);
    const best = options.reduce((x, y) => (turn(y.angle, heading) < turn(x.angle, heading) ? y : x));
    heading = best.angle;
    p = best.point;
    out.push([p[0] / KX, p[1]]);
  }
  return out;
}

/** The one line of edges two geounits share, from its first listed end to its second. */
function sharedLine(a, b, border) {
  const edges = polys => {
    const out = new Set();
    for (const poly of polys) for (const ring of poly) for (let i = 0; i + 1 < ring.length; i++) {
      const p = ring[i].join(), q = ring[i + 1].join();
      out.add(p < q ? `${p}|${q}` : `${q}|${p}`);
    }
    return out;
  };
  const theirs = edges(b), next = new Map();
  for (const edge of edges(a)) {
    if (!theirs.has(edge)) continue;
    const [p, q] = edge.split('|');
    for (const [from, to] of [[p, q], [q, p]]) (next.get(from) || next.set(from, []).get(from)).push(to);
  }
  const ends = [...next].filter(([, to]) => to.length === 1).map(([at]) => at);
  const [start, finish] = border.ends.map(end => end.join());
  if (ends.length !== 2 || ![start, finish].every(end => ends.includes(end)) || [...next.values()].some(to => to.length > 2)) {
    throw new Error(`The ${border.a}-${border.b} border is not one line from ${start} to ${finish} (ends: ${ends.join(' ')})`);
  }
  const line = [start];
  while (line.at(-1) !== finish) line.push(next.get(line.at(-1)).find(to => to !== line.at(-2)));
  if (line.length !== next.size) throw new Error(`The ${border.a}-${border.b} border has pieces apart from its line`);
  return line.map(point => point.split(',').map(Number));
}

/** The geounit nearest a lon/lat point, by Natural Earth's vertices. */
function nearestNation(points, [lon, lat]) {
  let best = null, bestD = Infinity;
  const x = lon * KX;
  for (const [px, py, gu] of points) {
    const d = (px - x) ** 2 + (py - lat) ** 2;
    if (d < bestD) { bestD = d; best = gu; }
  }
  return best;
}

/** The geounit most of these lon/lat points are nearest to. */
function nationOf(points, ring) {
  const votes = {};
  const step = Math.max(1, Math.floor(ring.length / 60));
  for (let i = 0; i < ring.length; i += step) {
    const gu = nearestNation(points, ring[i]);
    votes[gu] = (votes[gu] || 0) + 1;
  }
  return Object.entries(votes).sort((p, q) => q[1] - p[1])[0][0];
}

// ---- Planar helpers (lon/lat, longitude scaled by KX) ----

const plane = ([lon, lat]) => [lon * KX, lat];
const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

/** Where segments p1-p2 and q1-q2 cross: { t along p, u along q }, or null. */
function segmentCrossing(p1, p2, q1, q2) {
  const r = [p2[0] - p1[0], p2[1] - p1[1]], s = [q2[0] - q1[0], q2[1] - q1[1]];
  const denominator = r[0] * s[1] - r[1] * s[0];
  if (denominator === 0) return null;
  const qp = [q1[0] - p1[0], q1[1] - p1[1]];
  const t = (qp[0] * s[1] - qp[1] * s[0]) / denominator, u = (qp[0] * r[1] - qp[1] * r[0]) / denominator;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? { t, u } : null;
}

function insideRing(point, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > point[1]) !== (yj > point[1]) && point[0] < (xj - xi) * (point[1] - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Douglas-Peucker on lon/lat points, distances in the scaled plane. */
function simplify(points, tolerance) {
  const keep = new Array(points.length).fill(false);
  keep[0] = keep[points.length - 1] = true;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    const a = plane(points[first]), b = plane(points[last]);
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let worst = -1, worstD = tolerance;
    for (let i = first + 1; i < last; i++) {
      const p = plane(points[i]);
      const d = length ? Math.abs(cross(a, b, p)) / length : Math.hypot(p[0] - a[0], p[1] - a[1]);
      if (d > worstD) { worstD = d; worst = i; }
    }
    if (worst > 0) { keep[worst] = true; stack.push([first, worst], [worst, last]); }
  }
  return points.filter((_, i) => keep[i]);
}

// ---- TopoJSON ----

function arcPoints(topo, index) {
  let x = 0, y = 0;
  const points = topo.arcs[index < 0 ? ~index : index].map(([dx, dy]) => [x += dx, y += dy]);
  return index < 0 ? points.reverse() : points;
}

/** A ring's quantized points from its arc references (closed: last equals first). */
function ringPoints(topo, refs) {
  const points = [];
  refs.forEach((ref, k) => points.push(...arcPoints(topo, ref).slice(k ? 1 : 0)));
  return points;
}

const encodeArc = points => points.map(([x, y], i) => (i ? [x - points[i - 1][0], y - points[i - 1][1]] : [x, y]));

/**
 * Cut Great Britain's ring along both borders. `ring` is quantized and closed; returns each nation's rings as lists
 * of quantized points: the coast between two border ends, then the border back.
 */
function splitIsland(topo, ring, borders, points, label) {
  const { scale: [sx, sy], translate: [tx, ty] } = topo.transform;
  const toLonLat = ([x, y]) => [x * sx + tx, y * sy + ty];
  const toGrid = ([lon, lat]) => [Math.round((lon - tx) / sx), Math.round((lat - ty) / sy)];
  const coast = ring.map(toLonLat), coastPlane = coast.map(plane);
  const segments = coast.slice(1).reduce((total, point, i) => total + Math.hypot(...plane(point).map((v, k) => v - coastPlane[i][k])), 0);
  const tolerance = segments / (coast.length - 1) / 4;

  // Each border, walked out from its middle until it first meets the coast on either side.
  const cuts = [];
  const chords = borders.map(border => {
    const line = border.line;
    let middle = Math.floor(line.length / 2);
    while (middle < line.length && !insideRing(plane(line[middle]), coastPlane)) middle++;
    if (middle === line.length) throw new Error(`${label}: the ${border.a}-${border.b} border never crosses ${label}'s Great Britain`);
    const halves = [line.slice(0, middle + 1).reverse().concat(border.sea[0]), line.slice(middle).concat(border.sea[1])];
    const walked = halves.map(half => {
      for (let i = 0; i + 1 < half.length; i++) {
        const p = plane(half[i]), q = plane(half[i + 1]);
        let hit = null;
        for (let k = 0; k + 1 < coast.length; k++) {
          const crossing = segmentCrossing(p, q, coastPlane[k], coastPlane[k + 1]);
          if (crossing && (!hit || crossing.t < hit.t)) hit = { ...crossing, segment: k };
        }
        if (hit) {
          const at = [half[i][0] + (half[i + 1][0] - half[i][0]) * hit.t, half[i][1] + (half[i + 1][1] - half[i][1]) * hit.t];
          return { inland: half.slice(1, i + 1), at, segment: hit.segment, u: hit.u };
        }
      }
      throw new Error(`${label}: the ${border.a}-${border.b} border runs out of waypoints before it reaches the sea`);
    });
    const [west, east] = walked;
    const lonLat = [west.at, ...west.inland.reverse(), line[middle], ...east.inland, east.at];
    const simple = simplify(lonLat, tolerance).map(toGrid).filter((point, i, all) => !i || point.join() !== all[i - 1].join());
    // Simplified, the border may only touch the coast at its two ends (a grid step or two off the coast line).
    const across = simple.map(toLonLat).map(plane), near = 3 * Math.max(sx, sy);
    for (let i = 0; i + 1 < across.length; i++) for (let k = 0; k + 1 < coast.length; k++) {
      const crossing = segmentCrossing(across[i], across[i + 1], coastPlane[k], coastPlane[k + 1]);
      if (!crossing) continue;
      const point = across[i].map((v, n) => v + (across[i + 1][n] - v) * crossing.t);
      if (![across[0], across.at(-1)].some(end => Math.hypot(end[0] - point[0], end[1] - point[1]) < near)) {
        throw new Error(`${label}: the simplified ${border.a}-${border.b} border crosses the coast`);
      }
    }
    const chord = { border, points: simple, ends: [] };
    for (const [end, side] of [[west, 0], [east, 1]]) {
      const cut = { segment: end.segment, u: end.u, point: simple[side ? simple.length - 1 : 0], chord, side };
      chord.ends.push(cut);
      cuts.push(cut);
    }
    return chord;
  });

  // The coast with each cut point inserted, in ring order.
  cuts.sort((p, q) => p.segment - q.segment || p.u - q.u);
  const coastWithCuts = [];
  let next = 0;
  for (let k = 0; k + 1 < ring.length; k++) {
    coastWithCuts.push({ point: ring[k] });
    while (next < cuts.length && cuts[next].segment === k) coastWithCuts.push({ point: cuts[next].point, cut: cuts[next++] });
  }
  // Pieces of coast from one cut to the next (cyclic).
  const firstCut = coastWithCuts.findIndex(entry => entry.cut);
  const cyclic = [...coastWithCuts.slice(firstCut), ...coastWithCuts.slice(0, firstCut)];
  const pieces = [];
  // A cut that rounds onto a coast vertex is that vertex, not a repeat of it.
  const add = (piece, point) => { if (piece.points.at(-1).join() !== point.join()) piece.points.push(point); };
  for (const entry of cyclic) {
    if (entry.cut) {
      if (pieces.length) add(pieces.at(-1), entry.point);
      pieces.push({ from: entry.cut, points: [entry.point] });
    } else add(pieces.at(-1), entry.point);
  }
  add(pieces.at(-1), cyclic[0].point);
  pieces.forEach((piece, k) => { piece.to = pieces[(k + 1) % pieces.length].from; });

  // Faces: a piece of coast, then the border at its end back to the next piece, until the ring closes.
  const faces = [], used = new Set();
  for (const start of pieces) {
    if (used.has(start)) continue;
    const parts = [];
    let piece = start;
    do {
      used.add(piece);
      const chord = piece.to.chord, side = piece.to.side;
      const across = side === 0 ? chord.points : chord.points.slice().reverse();
      parts.push({ coast: piece.points, points: piece.points }, { chord, forward: side === 0, points: across });
      const other = chord.ends[1 - side];
      piece = pieces.find(candidate => candidate.from === other);
    } while (piece !== start);
    const outline = parts.flatMap(part => part.points.map(toLonLat));
    faces.push({ parts, nation: nationOf(points, outline.filter((_, i) => i % 2 === 0)) });
  }
  const nations = faces.map(face => face.nation).sort().join();
  if (nations !== 'ENG,SCT,WLS') throw new Error(`${label}: Great Britain splits into ${nations}, not England, Scotland and Wales`);
  return faces;
}

/** Split the UK of one atlas into the home nations; returns the new topology. */
function splitAtlas(upstream, { points, borders }, label, named) {
  const topo = structuredClone(upstream);
  const geometries = topo.objects.countries.geometries;
  const at = geometries.findIndex(geometry => String(geometry.id) === UK);
  if (at < 0 || geometries.some(geometry => NATIONS.some(nation => nation.id !== UK && String(geometry.id) === nation.id))) {
    throw new Error(`${label} is not the upstream atlas: no ${UK}, or home nations already`);
  }
  const uk = geometries[at];
  const polygons = uk.type === 'Polygon' ? [uk.arcs] : uk.arcs;
  const toLonLat = ([x, y]) => [x * topo.transform.scale[0] + topo.transform.translate[0], y * topo.transform.scale[1] + topo.transform.translate[1]];
  const area = refs => {
    const ring = ringPoints(topo, refs);
    return Math.abs(ring.slice(1).reduce((total, point, i) => total + cross([0, 0], ring[i], point), 0));
  };
  const island = polygons.reduce((best, polygon) => (!best || area(polygon[0]) > area(best[0]) ? polygon : best), null);
  if (island.length !== 1 || island[0].length !== 1) throw new Error(`${label}: Great Britain is not one closed arc with no holes`);
  const coastArc = island[0][0];
  const owners = geometries.filter(geometry => JSON.stringify(geometry.arcs).match(new RegExp(`[\\[,](${coastArc}|${~coastArc})[\\],]`)));
  if (owners.length !== 1) throw new Error(`${label}: Great Britain's coast arc is shared`);

  const out = Object.fromEntries(NATIONS.map(nation => [nation.gu, []]));
  for (const polygon of polygons) {
    if (polygon === island) continue;
    out[nationOf(points, ringPoints(topo, polygon[0]).map(toLonLat))].push(polygon);
  }

  // Great Britain: the coast pieces replace its arc (the first in place), the borders are new arcs.
  const faces = splitIsland(topo, ringPoints(topo, island[0]), borders, points, label);
  const coastIndex = new Map(), chordIndex = new Map();
  const coastOrder = [];
  for (const face of faces) for (const part of face.parts) {
    if (part.coast && !coastIndex.has(part.coast)) coastOrder.push(part.coast);
    if (part.coast) coastIndex.set(part.coast, null);
    if (part.chord && !chordIndex.has(part.chord)) chordIndex.set(part.chord, null);
  }
  // Coast pieces in ring order, so the land object's ring reads them in sequence.
  const pieceStart = piece => piece[0].join();
  const ringOrder = [];
  {
    const byStart = new Map(coastOrder.map(piece => [pieceStart(piece), piece]));
    let piece = coastOrder[0];
    do { ringOrder.push(piece); piece = byStart.get(piece.at(-1).join()); } while (piece !== coastOrder[0]);
    if (ringOrder.length !== coastOrder.length) throw new Error(`${label}: the coast pieces do not close a ring`);
  }
  ringOrder.forEach((piece, k) => {
    const index = k === 0 && coastArc >= 0 ? coastArc : topo.arcs.length;
    topo.arcs[index] = encodeArc(piece);
    coastIndex.set(piece, index);
  });
  for (const chord of chordIndex.keys()) {
    chordIndex.set(chord, topo.arcs.length);
    topo.arcs.push(encodeArc(chord.points));
  }
  for (const face of faces) {
    out[face.nation].push([face.parts.map(part => (part.coast ? coastIndex.get(part.coast)
      : part.forward ? chordIndex.get(part.chord) : ~chordIndex.get(part.chord)))]);
  }

  // The land object keeps Great Britain whole: its one arc becomes the coast pieces in turn.
  const coastRing = ringOrder.map(piece => coastIndex.get(piece));
  const replaceInLand = arcs => (Array.isArray(arcs[0]) ? arcs.map(replaceInLand)
    : arcs.flatMap(ref => (ref === coastArc ? coastRing : ref === ~coastArc ? coastRing.map(index => ~index).reverse() : [ref])));
  for (const geometry of topo.objects.land.geometries || [topo.objects.land]) {
    if (geometry.arcs) geometry.arcs = replaceInLand(geometry.arcs);
  }

  const shapes = NATIONS.map(nation => {
    const polys = out[nation.gu];
    if (!polys.length) throw new Error(`${label}: ${nation.name} has no land`);
    return { type: polys.length === 1 ? 'Polygon' : 'MultiPolygon', arcs: polys.length === 1 ? polys[0] : polys, id: nation.id,
      ...(named ? { properties: { name: nation.name } } : {}) };
  });
  // Keys in the upstream order (type, arcs, id, properties).
  geometries.splice(at, 1, ...shapes);
  return { topo, counts: Object.fromEntries(NATIONS.map(nation => [nation.name, out[nation.gu].length])) };
}

const nations = await naturalEarth();
let stale = 0;
for (const atlas of ATLASES) {
  const text = await download(atlas.url, path.join(root, 'data-src/world-atlas', atlas.cache));
  if (sha256(text) !== atlas.sha256) throw new Error(`${atlas.url} is not the pinned file (SHA-256 ${sha256(text)})`);
  const { topo, counts } = splitAtlas(JSON.parse(text), nations, atlas.file, atlas.file.includes('50m'));
  const output = `${JSON.stringify(topo)}\n`;
  const file = path.join(root, atlas.file);
  const current = await readFile(file, 'utf8').catch(() => null);
  const parts = Object.entries(counts).map(([name, n]) => `${name} ${n}`).join(', ');
  if (check) {
    if (current !== output) { stale++; console.log(`${atlas.file}: differs from a rebuild`); }
    else console.log(`${atlas.file}: up to date (${parts} polygons)`);
  } else {
    if (current !== output) await writeFile(file, output);
    console.log(`${atlas.file}: ${current === output ? 'unchanged' : 'written'} (${parts} polygons)`);
  }
}
if (stale) process.exit(1);
