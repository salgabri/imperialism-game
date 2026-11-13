// Shapes the map had in earlier years (docs/design/historic-maps.md), cut for scripts/build-home-nations.mjs. Each cut
// splits one of today's shapes along a line into the part that keeps the shape's id and a shape of its own, for the
// seasons up to its last year (`through`, a season-end year). Nothing of today's map changes: the cut's shapes go into
// a GeometryCollection of their own, `historic`, whose new arcs are appended after every arc of today's map, and the
// app swaps them in for those seasons (src/engine/historicMap.js). An arc of today's map that a cut ends on is split
// into two new arcs there, and today's other shape on that arc gets a historic copy reading the two pieces, so the
// shapes still share their border (and so their adjacency) in the historic map.
//
// East Germany (the German Democratic Republic, 7 October 1949 to 3 October 1990): the inner German border, read off
// Natural Earth's admin-1 states as the line the six eastern states (Mecklenburg-Vorpommern, Brandenburg, Berlin,
// Saxony-Anhalt, Thuringia, Saxony) share with the western ones, from the Baltic at Priwall to the tripoint with
// Czechoslovakia near Prex. Berlin is one point at the map's scale, so East Germany holds it whole (West Berlin, a
// West German exclave in practice, is not drawn). Amt Neuhaus, east of the Elbe, was East Germany's and joined Lower
// Saxony in 1993; Natural Earth's border follows today's line there, a few kilometres from the river.

import { HISTORIC_THROUGH } from '../../src/data/teams.js';

/** The historic shapes, each cut from `of` (today's shape) along the line its admin-1 units share with the rest. */
export const HISTORIC_CUTS = Object.freeze([
  Object.freeze({
    id: '278', of: '276', name: 'East Germany', through: HISTORIC_THROUGH['278'], adm0: 'DEU',
    // ISO 3166-2 codes of the states that were East Germany.
    units: Object.freeze(['DE-MV', 'DE-BB', 'DE-BE', 'DE-ST', 'DE-TH', 'DE-SN']),
    // The border's two ends in Natural Earth: on the Baltic shore (Priwall), and on the Czech border (the tripoint).
    sea: Object.freeze([10.906016, 53.961208]),
    land: Object.freeze({ at: Object.freeze([12.101344, 50.31398]), neighbour: '203' }),
  }),
  // South Vietnam (the Republic of Vietnam, to the fall of Saigon on 30 April 1975): the line Natural Earth's provinces
  // of Quảng Trị and southwards share with Quảng Bình, from the South China Sea to the tripoint with Laos. The 1954
  // demarcation line followed the Bến Hải river a few kilometres south of it (Vĩnh Linh, between them, was North
  // Vietnam's); at the map's scale they are one line. Vietnam keeps its id for the north, today's state's predecessor.
  Object.freeze({
    id: 'RVN', of: '704', name: 'South Vietnam', through: HISTORIC_THROUGH.RVN, adm0: 'VNM',
    units: Object.freeze(['VN-25', 'VN-26', 'VN-27', 'VN-DN', 'VN-28', 'VN-29', 'VN-30', 'VN-31', 'VN-32', 'VN-33', 'VN-34', 'VN-35',
      'VN-36', 'VN-37', 'VN-39', 'VN-40', 'VN-41', 'VN-43', 'VN-44', 'VN-45', 'VN-46', 'VN-47', 'VN-49', 'VN-50', 'VN-51', 'VN-52',
      'VN-55', 'VN-57', 'VN-58', 'VN-59', 'VN-72', 'VN-73', 'VN-SG', 'VN-CT']),
    sea: Object.freeze([107.007498, 17.162218]),
    land: Object.freeze({ at: Object.freeze([106.53355, 16.950638]), neighbour: '418' }),
  }),
]);

const plane = (kx, [lon, lat]) => [lon * kx, lat];
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

/** Douglas-Peucker on lon/lat points, distances in the plane scaled by `kx`. */
function simplify(points, tolerance, kx) {
  const keep = new Array(points.length).fill(false);
  keep[0] = keep[points.length - 1] = true;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    const a = plane(kx, points[first]), b = plane(kx, points[last]);
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let worst = -1, worstD = tolerance;
    for (let i = first + 1; i < last; i++) {
      const p = plane(kx, points[i]);
      const d = length ? Math.abs(cross(a, b, p)) / length : Math.hypot(p[0] - a[0], p[1] - a[1]);
      if (d > worstD) { worstD = d; worst = i; }
    }
    if (worst > 0) { keep[worst] = true; stack.push([first, worst], [worst, last]); }
  }
  return points.filter((_, i) => keep[i]);
}

/**
 * The cut's line and its two sides from Natural Earth admin-1 (`admin1`, the parsed GeoJSON): `line` from the sea end
 * to the land end (lon/lat), and `points` ([x, y, side] in the scaled plane, side 'cut' or 'rest') to tell land apart.
 */
export function cutLine(admin1, cut) {
  const units = new Set(cut.units);
  const polys = { cut: [], rest: [] };
  for (const { properties, geometry } of admin1.features) {
    if (properties.adm0_a3 !== cut.adm0) continue;
    const list = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    polys[units.has(properties.iso_3166_2) ? 'cut' : 'rest'].push(...list);
  }
  for (const code of cut.units) {
    if (!admin1.features.some(f => f.properties.adm0_a3 === cut.adm0 && f.properties.iso_3166_2 === code)) {
      throw new Error(`Natural Earth has no ${code} in ${cut.adm0}`);
    }
  }
  const edges = list => {
    const out = new Set();
    for (const poly of list) for (const ring of poly) for (let i = 0; i + 1 < ring.length; i++) {
      const p = ring[i].join(), q = ring[i + 1].join();
      out.add(p < q ? `${p}|${q}` : `${q}|${p}`);
    }
    return out;
  };
  const theirs = edges(polys.rest), next = new Map();
  for (const edge of edges(polys.cut)) {
    if (!theirs.has(edge)) continue;
    const [p, q] = edge.split('|');
    for (const [from, to] of [[p, q], [q, p]]) (next.get(from) || next.set(from, []).get(from)).push(to);
  }
  const ends = [...next].filter(([, to]) => to.length === 1).map(([at]) => at);
  const [start, finish] = [cut.sea.join(), cut.land.at.join()];
  if (ends.length !== 2 || ![start, finish].every(end => ends.includes(end)) || [...next.values()].some(to => to.length > 2)) {
    throw new Error(`${cut.name}'s border is not one line from ${start} to ${finish} (ends: ${ends.join(' ')})`);
  }
  const line = [start];
  while (line.at(-1) !== finish) line.push(next.get(line.at(-1)).find(to => to !== line.at(-2)));
  if (line.length !== next.size) throw new Error(`${cut.name}'s border has pieces apart from its line`);
  const kx = Math.cos(cut.sea[1] * Math.PI / 180);
  const points = Object.entries(polys).flatMap(([side, list]) => list.flatMap(poly => poly.flatMap(ring => ring.map(([lon, lat]) => [lon * kx, lat, side]))));
  return { line: line.map(point => point.split(',').map(Number)), points, kx };
}

/** The side ('cut' or 'rest') most of these lon/lat points are nearest to. */
function sideOf(points, kx, ring) {
  const votes = { cut: 0, rest: 0 };
  const step = Math.max(1, Math.floor(ring.length / 60));
  for (let i = 0; i < ring.length; i += step) {
    const x = ring[i][0] * kx, y = ring[i][1];
    let best = null, bestD = Infinity;
    for (const [px, py, side] of points) {
      const d = (px - x) ** 2 + (py - y) ** 2;
      if (d < bestD) { bestD = d; best = side; }
    }
    votes[best]++;
  }
  return votes.cut > votes.rest ? 'cut' : 'rest';
}

// ---- TopoJSON ----

function arcPoints(topo, index) {
  let x = 0, y = 0;
  const points = topo.arcs[index < 0 ? ~index : index].map(([dx, dy]) => [x += dx, y += dy]);
  return index < 0 ? points.reverse() : points;
}

const encodeArc = points => points.map(([x, y], i) => (i ? [x - points[i - 1][0], y - points[i - 1][1]] : [x, y]));
const polygonsOf = geometry => (geometry.type === 'Polygon' ? [geometry.arcs] : geometry.arcs);
// Keys in the upstream order (type, arcs, id, properties).
const geometryOf = (polygons, id, properties) => ({ type: polygons.length === 1 ? 'Polygon' : 'MultiPolygon',
  arcs: polygons.length === 1 ? polygons[0] : polygons, id, ...(properties ? { properties } : {}) });

/** Which geometries reference arc `index` (either way round). */
function ownersOf(topo, index) {
  return topo.objects.countries.geometries.filter(geometry => (geometry.type === 'Polygon' || geometry.type === 'MultiPolygon')
    && polygonsOf(geometry).some(polygon => polygon.some(ring => ring.some(ref => ref === index || ref === ~index))));
}

/**
 * Cut `cut`'s shape in `topo` (changed in place: arcs appended, `objects.historic` added or extended). `ne` is
 * cutLine's result; `named` gives the historic shapes names (the 50m atlas names its shapes). Returns a summary.
 */
export function addHistoricCut(topo, cut, ne, label, named) {
  const { scale: [sx, sy], translate: [tx, ty] } = topo.transform;
  const toLonLat = ([x, y]) => [x * sx + tx, y * sy + ty];
  const toGrid = ([lon, lat]) => [Math.round((lon - tx) / sx), Math.round((lat - ty) / sy)];
  const { kx } = ne;
  const geometries = topo.objects.countries.geometries;
  const holder = geometries.find(geometry => String(geometry.id) === cut.of);
  if (!holder) throw new Error(`${label} has no shape ${cut.of}`);
  if (geometries.some(geometry => String(geometry.id) === cut.id)) throw new Error(`${label} already has a shape ${cut.id}`);
  const polygons = polygonsOf(holder);
  const area = ring => Math.abs(ring.slice(1).reduce((total, point, i) => total + cross([0, 0], ring[i], point), 0));
  const ringOf = refs => {
    const points = [];
    refs.forEach((ref, k) => points.push(...arcPoints(topo, ref).slice(k ? 1 : 0)));
    return points;
  };
  const mainland = polygons.reduce((best, polygon) => (!best || area(ringOf(polygon[0])) > area(ringOf(best[0])) ? polygon : best), null);
  if (mainland.length !== 1) throw new Error(`${label}: ${cut.of}'s mainland has holes`);

  // The mainland ring, segment by segment, each knowing its arc reference and where in that arc it lies.
  const refs = mainland[0];
  const segments = [];
  for (const [k, ref] of refs.entries()) {
    const points = arcPoints(topo, ref);
    for (let i = 0; i + 1 < points.length; i++) segments.push({ k, ref, i, a: points[i], b: points[i + 1] });
  }
  const segmentPlane = segments.map(segment => [plane(kx, toLonLat(segment.a)), plane(kx, toLonLat(segment.b))]);
  const ringPlane = segmentPlane.map(([a]) => a);

  // Each end lies on one arc of the coarse ring: the sea end on the holder's own coast, the land end on its border with
  // the neighbour. Which segments those are, by their arcs' owners.
  const owners = ref => ownersOf(topo, ref < 0 ? ~ref : ref).map(geometry => String(geometry.id)).sort().join();
  const ownersByRef = new Map(refs.map(ref => [ref, owners(ref)]));
  const onCoast = s => ownersByRef.get(segments[s].ref) === cut.of;
  const onBorder = s => ownersByRef.get(segments[s].ref) === [cut.of, cut.land.neighbour].sort().join();

  // Walk the border out from its middle to its first crossing with the coarse ring on each side. Where Natural Earth's
  // end lies inside the coarse shape (its coast or the tripoint short of the coarse line), the border goes on to the
  // nearest point of the arc that end belongs on.
  const { line } = ne;
  let middle = Math.floor(line.length / 2);
  while (middle < line.length && !insideRing(plane(kx, line[middle]), ringPlane)) middle++;
  if (middle === line.length) throw new Error(`${label}: ${cut.name}'s border never crosses ${cut.of}`);
  const firstCrossing = half => {
    for (let i = 0; i + 1 < half.length; i++) {
      const p = plane(kx, half[i]), q = plane(kx, half[i + 1]);
      let hit = null;
      segmentPlane.forEach(([a, b], s) => {
        const crossing = segmentCrossing(p, q, a, b);
        if (crossing && (!hit || crossing.t < hit.t)) hit = { ...crossing, s };
      });
      if (hit) return { inland: half.slice(1, i + 1), at: [half[i][0] + (half[i + 1][0] - half[i][0]) * hit.t, half[i][1] + (half[i + 1][1] - half[i][1]) * hit.t], s: hit.s, u: hit.u };
    }
    return null;
  };
  const nearestOn = (half, allowed) => {
    const end = plane(kx, half.at(-1));
    let best = null;
    segmentPlane.forEach(([a, b], s) => {
      if (!allowed(s)) return;
      const dx = b[0] - a[0], dy = b[1] - a[1], length = dx * dx + dy * dy;
      const u = length ? Math.max(0, Math.min(1, ((end[0] - a[0]) * dx + (end[1] - a[1]) * dy) / length)) : 0;
      const d = Math.hypot(a[0] + u * dx - end[0], a[1] + u * dy - end[1]);
      if (!best || d < best.d) best = { d, s, u };
    });
    if (!best) throw new Error(`${label}: ${cut.of} has no arc for ${cut.name}'s border to end on`);
    const [a, b] = segmentPlane[best.s];
    return { inland: half.slice(1), at: [(a[0] + (b[0] - a[0]) * best.u) / kx, a[1] + (b[1] - a[1]) * best.u], s: best.s, u: best.u };
  };
  const toSea = line.slice(0, middle + 1).reverse(), toLand = line.slice(middle);
  const seaEnd = firstCrossing(toSea) || nearestOn(toSea, onCoast);
  const landEnd = firstCrossing(toLand) || nearestOn(toLand, onBorder);
  if (!onCoast(seaEnd.s)) throw new Error(`${label}: ${cut.name}'s sea end is on ${ownersByRef.get(segments[seaEnd.s].ref)}'s arc, not ${cut.of}'s coast`);
  if (!onBorder(landEnd.s)) {
    throw new Error(`${label}: ${cut.name}'s land end is on ${ownersByRef.get(segments[landEnd.s].ref)}'s arc, not the border with ${cut.land.neighbour}`);
  }

  // The border, simplified to the ring's own detail and put on its grid, sea end first.
  const lonLat = [seaEnd.at, ...seaEnd.inland.reverse(), line[middle], ...landEnd.inland, landEnd.at];
  const perimeter = segmentPlane.reduce((total, [a, b]) => total + Math.hypot(b[0] - a[0], b[1] - a[1]), 0);
  const tolerance = perimeter / segments.length / 4;
  const chord = simplify(lonLat, tolerance, kx).map(toGrid).filter((point, i, all) => !i || point.join() !== all[i - 1].join());
  if (chord.length < 2) throw new Error(`${label}: ${cut.name}'s border simplifies away`);
  const across = chord.map(toLonLat).map(point => plane(kx, point)), near = 3 * Math.max(sx, sy);
  for (let i = 0; i + 1 < across.length; i++) segmentPlane.forEach(([a, b]) => {
    const crossing = segmentCrossing(across[i], across[i + 1], a, b);
    if (!crossing) return;
    const point = across[i].map((v, n) => v + (across[i + 1][n] - v) * crossing.t);
    if (![across[0], across.at(-1)].some(end => Math.hypot(end[0] - point[0], end[1] - point[1]) < near)) {
      throw new Error(`${label}: the simplified ${cut.name} border crosses ${cut.of}'s outline at ${[point[0] / kx, point[1]].map(v => v.toFixed(3))} (border ${chord.map(toLonLat).map(p => p.map(v => v.toFixed(2)).join(" ")).join(", ")})`);
    }
  });

  // Split each end's arc at its cut point: two new arcs, in the arc's own direction.
  const pieces = new Map();
  const split = (end, point) => {
    const { ref, i } = segments[end.s];
    const index = ref < 0 ? ~ref : ref;
    const points = arcPoints(topo, index);
    // `i` counts along the ring's reading of the arc; the arc's own index of that segment's first point.
    const at = ref < 0 ? points.length - 2 - i : i;
    const first = [...points.slice(0, at + 1), point].filter((p, n, all) => !n || p.join() !== all[n - 1].join());
    const second = [point, ...points.slice(at + 1)].filter((p, n, all) => !n || p.join() !== all[n - 1].join());
    if (first.length < 2 || second.length < 2) throw new Error(`${label}: ${cut.name}'s border ends on a corner of arc ${index}`);
    const a = topo.arcs.push(encodeArc(first)) - 1, b = topo.arcs.push(encodeArc(second)) - 1;
    pieces.set(index, [a, b]);
    return index;
  };
  const seaIndex = split(seaEnd, chord[0]), landIndex = split(landEnd, chord.at(-1));
  if (seaIndex === landIndex) throw new Error(`${label}: both ends of ${cut.name}'s border are on arc ${seaIndex}`);
  const chordIndex = topo.arcs.push(encodeArc(chord)) - 1;
  const replace = ref => {
    const index = ref < 0 ? ~ref : ref;
    if (!pieces.has(index)) return [ref];
    const [a, b] = pieces.get(index);
    return ref < 0 ? [~b, ~a] : [a, b];
  };

  // The mainland's two faces: from one cut round the ring to the other, then back along the border.
  const ring = refs.flatMap(replace);
  const seaPieces = pieces.get(seaIndex), landPieces = pieces.get(landIndex);
  // In the ring, the cut lies between the two pieces of each split arc: after the first piece read.
  const cutAfter = pieces => ring.findIndex((ref, n) => {
    const next = ring[(n + 1) % ring.length];
    return [ref, next].map(r => (r < 0 ? ~r : r)).sort().join() === pieces.slice().sort().join();
  });
  const seaAt = cutAfter(seaPieces), landAt = cutAfter(landPieces);
  if (seaAt < 0 || landAt < 0) throw new Error(`${label}: ${cut.name}'s cut points are not on ${cut.of}'s mainland ring`);
  const stretch = (from, to) => {
    const out = [];
    for (let n = (from + 1) % ring.length; ; n = (n + 1) % ring.length) {
      out.push(ring[n]);
      if (n === to) return out;
    }
  };
  // From the sea cut round to the land cut, then the border back to the sea (read backwards); and the other way.
  const faceA = [...stretch(seaAt, landAt), ~chordIndex];
  const faceB = [...stretch(landAt, seaAt), chordIndex];
  const sides = new Map([[faceA, sideOf(ne.points, kx, ringOf(faceA).map(toLonLat))], [faceB, sideOf(ne.points, kx, ringOf(faceB).map(toLonLat))]]);
  if (new Set(sides.values()).size !== 2) throw new Error(`${label}: both halves of ${cut.of} fall on one side of ${cut.name}'s border`);
  const out = { cut: [], rest: [] };
  for (const [face, side] of sides) out[side].push([face]);
  // Islands go with the side they are nearest to.
  for (const polygon of polygons) {
    if (polygon === mainland) continue;
    out[sideOf(ne.points, kx, ringOf(polygon[0]).map(toLonLat))].push(polygon.map(r => r.flatMap(replace)));
  }

  // The land neighbour, reading the two pieces of its border arc: the same shape as today's.
  const neighbour = geometries.find(geometry => String(geometry.id) === cut.land.neighbour);
  const replaced = polygonsOf(neighbour).map(polygon => polygon.map(r => r.flatMap(replace)));
  const years = { through: cut.through };
  const historic = topo.objects.historic ||= { type: 'GeometryCollection', geometries: [] };
  historic.geometries.push(
    geometryOf(out.rest, holder.id, named ? { name: holder.properties?.name, ...years } : years),
    geometryOf(out.cut, cut.id, named ? { name: cut.name, ...years } : years),
    { type: neighbour.type, arcs: neighbour.type === 'Polygon' ? replaced[0] : replaced, id: neighbour.id,
      properties: { ...(named ? { name: neighbour.properties?.name } : {}), ...years } },
  );
  return { [cut.name]: out.cut.length, [`${cut.of} without it`]: out.rest.length, [`${cut.name} border points`]: chord.length };
}
