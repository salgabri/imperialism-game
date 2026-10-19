// Cartographic labels for growing empires.
//
// Geometry is the *rendered*, rounded SVG rings, not capital points or political
// adjacency. Each country's rings use SVG's nonzero winding rule; countries
// owned by the same empire are a union. A bounded interior raster supplies
// stable geographic candidates, while the final padded text rectangle is
// checked against the actual vector boundary (including holes and enclaves).

const EPS = 1e-7;
const SQRT2 = Math.SQRT2;
const MAX_CELLS = 14000;
const MAX_SIDE = 210;
const RECENT_GROUP_CACHE = 8;
const FONT_HEIGHT = 1.5;
const SIDE_PADDING = 0.16;
const TRACKING = 0.085;

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const keyPoint = p => `${p[0]},${p[1]}`;
const overlaps = (a, b) => a.x <= b.x + b.w + EPS && a.x + a.w + EPS >= b.x && a.y <= b.y + b.h + EPS && a.y + a.h + EPS >= b.y;

function boundsOf(rings) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const ring of rings) for (const [x, y] of ring) {
    x0 = Math.min(x0, x); y0 = Math.min(y0, y);
    x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  return Number.isFinite(x0) ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

function unionBounds(items) {
  return boundsOf(items.flatMap(item => [[[item.x, item.y], [item.x + item.w, item.y + item.h]]]));
}

function ringArea(ring) {
  let area = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) area += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return area / 2;
}

function pointOnSegment(x, y, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  if (Math.abs(dx * (y - a[1]) - dy * (x - a[0])) > EPS * Math.max(1, Math.abs(dx), Math.abs(dy))) return false;
  return x >= Math.min(a[0], b[0]) - EPS && x <= Math.max(a[0], b[0]) + EPS && y >= Math.min(a[1], b[1]) - EPS && y <= Math.max(a[1], b[1]) + EPS;
}

function windingAt(rings, x, y, boundaryInside = true) {
  let winding = 0;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[j], b = ring[i];
      if (boundaryInside && pointOnSegment(x, y, a, b)) return true;
      const cross = (b[0] - a[0]) * (y - a[1]) - (x - a[0]) * (b[1] - a[1]);
      if (a[1] <= y && b[1] > y && cross > 0) winding++;
      else if (a[1] > y && b[1] <= y && cross < 0) winding--;
    }
  }
  return winding !== 0;
}

function makeDisjointSet(n) {
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = i => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  return { find, join: (a, b) => { a = find(a); b = find(b); if (a !== b) parent[Math.max(a, b)] = Math.min(a, b); } };
}

function makeCountry(shape) {
  const rings = (shape.rings || []).filter(ring => ring.length >= 3).map(ring => ring.map(p => [Number(p[0]), Number(p[1])]))
    .filter(ring => ring.every(p => p.every(Number.isFinite)) && Math.abs(ringArea(ring)) > EPS);
  if (!rings.length) return null;
  const ringBounds = rings.map(ring => boundsOf([ring]));
  const areas = rings.map(ring => Math.abs(ringArea(ring)));
  const sets = makeDisjointSet(rings.length);
  // Nest holes with their containing land mass. Separate islands remain separate
  // even when they belong to the same nation (France must not center in the Atlantic).
  for (let i = 0; i < rings.length; i++) {
    let parent = -1, parentArea = Infinity;
    const p = rings[i][0];
    for (let j = 0; j < rings.length; j++) {
      if (areas[j] <= areas[i] || areas[j] >= parentArea || !overlaps(ringBounds[i], ringBounds[j])) continue;
      if (windingAt([rings[j]], p[0], p[1], false)) { parent = j; parentArea = areas[j]; }
    }
    if (parent >= 0) sets.join(i, parent);
  }
  const groups = new Map();
  for (let i = 0; i < rings.length; i++) {
    const root = sets.find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(rings[i]);
  }
  const id = String(shape.id);
  const pieces = [...groups.values()].map((part, index) => ({ countryId: id, id: `${id}:${index}`, rings: part, bbox: boundsOf(part), edges: edgesOf(part) }));
  return { id, rings, bbox: boundsOf(rings), pieces };
}

// windingAt over a country's rings, answered from one horizontal band of edges.
// An edge only affects a point (crossing it, or holding it within EPS) when the
// point's y is inside the edge's own y range, so each band keeps every edge whose
// padded y range overlaps it; the integer winding sum is order independent.
const BAND_PAD = 1e-6;

function countryWinding(country, x, y) {
  const index = country.bands || (country.bands = edgeBands(country));
  if (!(y >= index.y0 && y <= index.y1)) return false;
  const band = index.edges[clamp(Math.floor((y - index.y0) / index.step), 0, index.edges.length - 1)];
  let winding = 0;
  for (let i = 0; i < band.length; i += 2) {
    const a = band[i], b = band[i + 1];
    if (pointOnSegment(x, y, a, b)) return true;
    const cross = (b[0] - a[0]) * (y - a[1]) - (x - a[0]) * (b[1] - a[1]);
    if (a[1] <= y && b[1] > y && cross > 0) winding++;
    else if (a[1] > y && b[1] <= y && cross < 0) winding--;
  }
  return winding !== 0;
}

function edgeBands(country) {
  const count = country.rings.reduce((sum, ring) => sum + ring.length, 0);
  const y0 = country.bbox.y - BAND_PAD, y1 = country.bbox.y + country.bbox.h + BAND_PAD;
  const edges = Array.from({ length: clamp(Math.ceil(count / 6), 1, 512) }, () => []);
  const step = (y1 - y0) / edges.length;
  for (const ring of country.rings) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j], b = ring[i];
    const first = clamp(Math.floor((Math.min(a[1], b[1]) - BAND_PAD - y0) / step), 0, edges.length - 1);
    const last = clamp(Math.floor((Math.max(a[1], b[1]) + BAND_PAD - y0) / step), 0, edges.length - 1);
    for (let band = first; band <= last; band++) edges[band].push(a, b);
  }
  return { y0, y1, step, edges };
}

function containsCountries(countries, x, y) {
  for (const country of countries) {
    const b = country.bbox;
    if (x < b.x - EPS || x > b.x + b.w + EPS || y < b.y - EPS || y > b.y + b.h + EPS) continue;
    if (countryWinding(country, x, y)) return true;
  }
  return false;
}

function edgesOf(rings) {
  const edges = [];
  for (const ring of rings) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j], b = ring[i];
    if (a[0] === b[0] && a[1] === b[1]) continue;
    edges.push({ a, b, bbox: { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(a[0] - b[0]), h: Math.abs(a[1] - b[1]) } });
  }
  return edges;
}

function exteriorEdges(pieces) {
  const edges = new Map();
  for (const piece of pieces) for (const edge of piece.edges) {
    const a = keyPoint(edge.a), b = keyPoint(edge.b), forward = a < b;
    const key = forward ? `${a}|${b}` : `${b}|${a}`;
    const previous = edges.get(key);
    if (previous) previous.count += forward ? 1 : -1;
    else edges.set(key, { edge, count: forward ? 1 : -1 });
  }
  // Opposing shared national boundaries disappear after conquest. Keeping an
  // unmatched edge is safe: the exact check below also recognizes shared edges
  // whose neighbors use a different vertex subdivision.
  return [...edges.values()].filter(e => e.count !== 0).map(e => e.edge);
}

function touchingAtFlatBounds(a, b) {
  const ix = Math.min(a.bbox.x + a.bbox.w, b.bbox.x + b.bbox.w) - Math.max(a.bbox.x, b.bbox.x);
  const iy = Math.min(a.bbox.y + a.bbox.h, b.bbox.y + b.bbox.h) - Math.max(a.bbox.y, b.bbox.y);
  if (ix < -EPS || iy < -EPS || (ix > EPS && iy > EPS)) return false;
  // Covers differently subdivided straight shared sides in synthetic/custom maps.
  for (const ra of a.rings) for (const p of ra) for (const rb of b.rings) {
    for (let i = 0, j = rb.length - 1; i < rb.length; j = i++) if (pointOnSegment(p[0], p[1], rb[j], rb[i])) return true;
  }
  return false;
}

function ownerComponents(countries) {
  const pieces = countries.flatMap(country => country.pieces);
  const sets = makeDisjointSet(pieces.length);
  const vertices = new Map();
  for (let i = 0; i < pieces.length; i++) for (const ring of pieces[i].rings) for (const p of ring) {
    const key = keyPoint(p), previous = vertices.get(key);
    if (previous !== undefined) sets.join(i, previous);
    else vertices.set(key, i);
  }
  // Natural Earth's shared arcs already match exactly. The cheap bounds-only
  // fallback also handles rectangular custom fixtures without identical vertices.
  for (let i = 0; i < pieces.length; i++) for (let j = i + 1; j < pieces.length; j++) {
    if (sets.find(i) !== sets.find(j) && pieces[i].countryId !== pieces[j].countryId && overlaps(pieces[i].bbox, pieces[j].bbox) && touchingAtFlatBounds(pieces[i], pieces[j])) sets.join(i, j);
  }
  const grouped = new Map();
  for (let i = 0; i < pieces.length; i++) {
    const root = sets.find(i);
    if (!grouped.has(root)) grouped.set(root, []);
    grouped.get(root).push(pieces[i]);
  }
  return [...grouped.values()].map(part => ({ pieces: part, bbox: unionBounds(part.map(p => p.bbox)), edges: exteriorEdges(part) }));
}

function rasterize(component) {
  const b = component.bbox;
  if (b.w <= EPS || b.h <= EPS) return null;
  const cell = Math.max(Math.max(b.w, b.h) / MAX_SIDE, Math.sqrt(b.w * b.h / MAX_CELLS), 0.001);
  const nx = Math.ceil(b.w / cell) + 2, ny = Math.ceil(b.h / cell) + 2;
  const x0 = b.x - cell, y0 = b.y - cell;
  const mask = new Uint8Array(nx * ny);
  const byCountry = new Map();
  for (const p of component.pieces) {
    if (!byCountry.has(p.countryId)) byCountry.set(p.countryId, []);
    byCountry.get(p.countryId).push(...p.rings);
  }
  // Scan-convert each country's nonzero winding intervals, then OR countries.
  // Counting winding across the entire empire would incorrectly cancel owners
  // with inconsistent polygon orientation, so keep this union step explicit.
  for (const rings of byCountry.values()) {
    const edges = edgesOf(rings);
    const rows = Array.from({ length: ny }, () => []);
    for (const edge of edges) {
      const { a, b: end } = edge;
      if (Math.abs(a[1] - end[1]) <= EPS) continue;
      const start = clamp(Math.ceil((Math.min(a[1], end[1]) - y0) / cell - 0.5), 0, ny - 1);
      const stop = clamp(Math.ceil((Math.max(a[1], end[1]) - y0) / cell - 0.5), 0, ny);
      for (let row = start; row < stop; row++) {
        const y = y0 + (row + 0.5) * cell;
        rows[row].push([a[0] + ((y - a[1]) / (end[1] - a[1])) * (end[0] - a[0]), end[1] > a[1] ? 1 : -1]);
      }
    }
    for (let row = 0; row < ny; row++) {
      const events = rows[row].sort((a, z) => a[0] - z[0]);
      let winding = 0, previous = 0;
      for (const [x, delta] of events) {
        if (winding !== 0) {
          const start = clamp(Math.ceil((previous - x0) / cell - 0.5), 0, nx);
          const end = clamp(Math.ceil((x - x0) / cell - 0.5), 0, nx);
          mask.fill(1, row * nx + start, row * nx + end);
        }
        winding += delta; previous = x;
      }
    }
  }
  const distance = new Float32Array(mask.length);
  let count = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const i = y * nx + x;
    if (mask[i]) {
      distance[i] = 1e6; count++; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
    }
  }
  if (!count) return null;
  for (let y = 1; y < ny - 1; y++) for (let x = 1; x < nx - 1; x++) {
    const i = y * nx + x;
    if (mask[i]) distance[i] = Math.min(distance[i], distance[i - 1] + 1, distance[i - nx] + 1, distance[i - nx - 1] + SQRT2, distance[i - nx + 1] + SQRT2);
  }
  for (let y = ny - 2; y >= 1; y--) for (let x = nx - 2; x >= 1; x--) {
    const i = y * nx + x;
    if (mask[i]) distance[i] = Math.min(distance[i], distance[i + 1] + 1, distance[i + nx] + 1, distance[i + nx + 1] + SQRT2, distance[i + nx - 1] + SQRT2);
  }
  const emptyPrefix = new Uint16Array((nx + 1) * ny);
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) emptyPrefix[y * (nx + 1) + x + 1] = emptyPrefix[y * (nx + 1) + x] + (mask[y * nx + x] ? 0 : 1);
  const mx = sx / count, my = sy / count;
  let pca = Math.atan2(2 * (sxy / count - mx * my), sxx / count - mx * mx - (syy / count - my * my)) * 90 / Math.PI;
  if (pca > 90) pca -= 180;
  if (pca < -90) pca += 180;
  pca = clamp(pca, -60, 60);
  const ranked = [];
  for (let y = 1; y < ny - 1; y++) for (let x = 1; x < nx - 1; x++) {
    const i = y * nx + x;
    if (distance[i] > 0.9) ranked.push({ x: x0 + (x + 0.5) * cell, y: y0 + (y + 0.5) * cell, clearance: distance[i] * cell, d: distance[i], centrality: Math.hypot(x - mx, y - my) });
  }
  ranked.sort((a, z) => z.d - a.d || a.centrality - z.centrality || a.y - z.y || a.x - z.x);
  const candidates = [];
  const spacing = Math.max(cell * 3, Math.sqrt(count) * cell * 0.09);
  for (const point of ranked) {
    if (candidates.every(p => Math.hypot(p.x - point.x, p.y - point.y) >= spacing)) candidates.push(point);
    if (candidates.length >= 28) break;
  }
  // Include unsnapped centers when they are genuinely on land; grid rounding
  // should not push an otherwise symmetric horizontal name toward one edge.
  for (const [x, y] of [[b.x + b.w / 2, b.y + b.h / 2], [x0 + (mx + 0.5) * cell, y0 + (my + 0.5) * cell]]) {
    const gx = Math.floor((x - x0) / cell), gy = Math.floor((y - y0) / cell);
    if (gx >= 0 && gy >= 0 && gx < nx && gy < ny && mask[gy * nx + gx]) candidates.unshift({ x, y, clearance: distance[gy * nx + gx] * cell });
  }
  return { nx, ny, cell, x0, y0, mask, distance, emptyPrefix, candidates, pca, area: count * cell * cell };
}

function labelFootprint(x, y, angle, width, fontSize, curveRise = 0) {
  const theta = angle * Math.PI / 180, cos = Math.cos(theta), sin = Math.sin(theta);
  // The quadratic baseline reaches ±rise/2, with end tangent slope ±4rise/width.
  // Include the sideways projection of its rotated glyph/halo band as well as
  // the vertical arch, rather than checking only a straight baseline rectangle.
  const tangent = Math.atan2(4 * Math.abs(curveRise), width);
  const hw = width / 2 + SIDE_PADDING * fontSize + FONT_HEIGHT * fontSize / 2 * Math.sin(tangent);
  const hh = FONT_HEIGHT * fontSize / 2 + Math.abs(curveRise) / 2;
  return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([u, v]) => [x + u * cos - v * sin, y + u * sin + v * cos]);
}

function inView(footprint, view, margin = 0) {
  return footprint.every(([x, y]) => x >= view.x + margin && x <= view.x + view.w - margin && y >= view.y + margin && y <= view.y + view.h - margin);
}

function rasterCellFilled(raster, px, py) {
  const gx = Math.floor((px - raster.x0) / raster.cell), gy = Math.floor((py - raster.y0) / raster.cell);
  return gx >= 0 && gy >= 0 && gx < raster.nx && gy < raster.ny && !!raster.mask[gy * raster.nx + gx];
}

function rasterFits(raster, x, y, angle, width, fontSize, curveRise = 0, footprint = labelFootprint(x, y, angle, width, fontSize, curveRise)) {
  // Scan the full rotated rectangle, not merely its corners or a capsule around
  // its centerline. A capsule needlessly rounds off a broad country's corners
  // and can favor a diagonal label even when a larger horizontal label fits.
  // Prefix counts make each covered raster row a constant-time interior check.
  for (const [px, py] of footprint) if (!rasterCellFilled(raster, px, py)) return false;
  if (!rasterCellFilled(raster, x, y)) return false;
  const minY = Math.min(footprint[0][1], footprint[1][1], footprint[2][1], footprint[3][1]);
  const maxY = Math.max(footprint[0][1], footprint[1][1], footprint[2][1], footprint[3][1]);
  const start = clamp(Math.ceil((minY - raster.y0) / raster.cell - 0.5), 0, raster.ny);
  const end = clamp(Math.ceil((maxY - raster.y0) / raster.cell - 0.5), 0, raster.ny);
  for (let row = start; row < end; row++) {
    const py = raster.y0 + (row + 0.5) * raster.cell;
    let left = Infinity, right = -Infinity;
    for (let i = 0, j = 3; i < 4; j = i++) {
      const a = footprint[j], b = footprint[i];
      if ((a[1] <= py && b[1] > py) || (b[1] <= py && a[1] > py)) {
        const px = a[0] + (py - a[1]) / (b[1] - a[1]) * (b[0] - a[0]);
        left = Math.min(left, px); right = Math.max(right, px);
      }
    }
    if (!Number.isFinite(left)) continue;
    const first = clamp(Math.ceil((left - raster.x0) / raster.cell - 0.5), 0, raster.nx);
    const stop = clamp(Math.ceil((right - raster.x0) / raster.cell - 0.5), 0, raster.nx);
    const offset = row * (raster.nx + 1);
    if (raster.emptyPrefix[offset + stop] !== raster.emptyPrefix[offset + first]) return false;
  }
  return true;
}

function edgeInsideRectangle(edge, footprint) {
  const [p0, p1, , p3] = footprint;
  const w = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]), h = Math.hypot(p3[0] - p0[0], p3[1] - p0[1]);
  const ux = (p1[0] - p0[0]) / w, uy = (p1[1] - p0[1]) / w;
  const vx = (p3[0] - p0[0]) / h, vy = (p3[1] - p0[1]) / h;
  const ax = (edge.a[0] - p0[0]) * ux + (edge.a[1] - p0[1]) * uy;
  const ay = (edge.a[0] - p0[0]) * vx + (edge.a[1] - p0[1]) * vy;
  const dx = (edge.b[0] - edge.a[0]) * ux + (edge.b[1] - edge.a[1]) * uy;
  const dy = (edge.b[0] - edge.a[0]) * vx + (edge.b[1] - edge.a[1]) * vy;
  let lo = 0, hi = 1;
  for (const [origin, delta, limit] of [[ax, dx, w], [ay, dy, h]]) {
    if (Math.abs(delta) <= EPS) { if (origin <= EPS || origin >= limit - EPS) return null; }
    else {
      const a = (EPS - origin) / delta, b = (limit - EPS - origin) / delta;
      lo = Math.max(lo, Math.min(a, b)); hi = Math.min(hi, Math.max(a, b));
      if (lo >= hi - EPS) return null;
    }
  }
  return [lo, hi];
}

function exactFootprint(group, footprint, component = null) {
  if (!footprint || footprint.length !== 4 || !footprint.every(p => p.length === 2 && p.every(Number.isFinite))) return false;
  if (!footprint.every(([x, y]) => containsCountries(group.countries, x, y))) return false;
  const bbox = boundsOf([footprint]);
  const parts = component ? [component] : group.components;
  for (const part of parts) {
    if (!overlaps(part.bbox, bbox)) continue;
    for (const edge of part.edges) {
      if (!overlaps(edge.bbox, bbox)) continue;
      const interval = edgeInsideRectangle(edge, footprint);
      if (!interval) continue;
      const dx = edge.b[0] - edge.a[0], dy = edge.b[1] - edge.a[1], len = Math.hypot(dx, dy);
      const epsilon = Math.max(0.00001, 8 * EPS / len);
      // A true coast/hole/enclave boundary inside the text's padded envelope is
      // forbidden. Both sides of an internal conquered border are owned, so it
      // imposes no label constraint, even with differently subdivided edges.
      for (const fraction of [0.01, 0.5, 0.99]) {
        const t = interval[0] + (interval[1] - interval[0]) * fraction;
        const x = edge.a[0] + dx * t, y = edge.a[1] + dy * t;
        if (!containsCountries(group.countries, x - dy / len * epsilon, y + dx / len * epsilon) || !containsCountries(group.countries, x + dy / len * epsilon, y - dx / len * epsilon)) return false;
      }
    }
  }
  return true;
}

function rectangleFrame(footprint) {
  const [p0, p1, , p3] = footprint;
  const w = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]), h = Math.hypot(p3[0] - p0[0], p3[1] - p0[1]);
  const ux = (p1[0] - p0[0]) / w, uy = (p1[1] - p0[1]) / w;
  const vx = (p3[0] - p0[0]) / h, vy = (p3[1] - p0[1]) / h;
  return { w, h,
    local: p => [(p[0] - p0[0]) * ux + (p[1] - p0[1]) * uy, (p[0] - p0[0]) * vx + (p[1] - p0[1]) * vy],
    world: (x, y) => [p0[0] + x * ux + y * vx, p0[1] + x * uy + y * vy],
  };
}

const COASTAL_SAMPLES = 13 * 5;

function coastalRasterFits(raster, bbox, footprint, allowance, maxSeaFraction) {
  const [p0, p1, , p3] = footprint;
  // rectangleFrame's world() arithmetic, inlined: this runs for every coastal
  // size probe, so it must not allocate per sample.
  const w = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]), h = Math.hypot(p3[0] - p0[0], p3[1] - p0[1]);
  const ux = (p1[0] - p0[0]) / w, uy = (p1[1] - p0[1]) / w;
  const vx = (p3[0] - p0[0]) / h, vy = (p3[1] - p0[1]) / h;
  const limit = maxSeaFraction + 0.12;
  let maxSea = COASTAL_SAMPLES;
  while (maxSea > 0 && !(maxSea / COASTAL_SAMPLES <= limit)) maxSea--;
  let sea = 0;
  // A cheap candidate filter only. Exact foreign-land intersection, union area
  // and a certified distance bound below decide whether a coastal fit is legal.
  for (let y = 0; y <= 4; y++) for (let x = 0; x <= 12; x++) {
    const fx = w * x / 12, fy = h * y / 4;
    const px = p0[0] + fx * ux + fy * vx, py = p0[1] + fx * uy + fy * vy;
    const dx = Math.max(0, bbox.x - px, px - bbox.x - bbox.w), dy = Math.max(0, bbox.y - py, py - bbox.y - bbox.h);
    if (Math.hypot(dx, dy) > allowance + EPS) return false;
    // Once more samples are at sea than the full count could allow, the answer is settled.
    if (!rasterCellFilled(raster, px, py) && ++sea > maxSea) return false;
  }
  return sea / COASTAL_SAMPLES <= limit;
}

function foreignLandIntersects(foreignCountries, footprint) {
  const bbox = boundsOf([footprint]);
  for (const country of foreignCountries) {
    if (!overlaps(country.bbox, bbox)) continue;
    if (footprint.some(([x, y]) => countryWinding(country, x, y))) return true;
    // An entire tiny island/enclave may sit between all sampled glyph points.
    // Inspect every relevant vector edge, including edges wholly in the band.
    for (const piece of country.pieces) {
      if (!overlaps(piece.bbox, bbox)) continue;
      for (const edge of piece.edges) if (overlaps(edge.bbox, bbox) && edgeInsideRectangle(edge, footprint)) return true;
    }
  }
  return false;
}

function clipToRectangle(ring, frame) {
  let points = ring.map(frame.local);
  for (const [axis, boundary, greater] of [[0, 0, true], [0, frame.w, false], [1, 0, true], [1, frame.h, false]]) {
    const clipped = [];
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const a = points[j], b = points[i];
      const aInside = greater ? a[axis] >= boundary : a[axis] <= boundary;
      const bInside = greater ? b[axis] >= boundary : b[axis] <= boundary;
      if (aInside !== bInside) {
        const t = (boundary - a[axis]) / (b[axis] - a[axis]);
        const p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        p[axis] = boundary; clipped.push(p);
      }
      if (bInside) clipped.push(b);
    }
    points = clipped;
    if (!points.length) break;
  }
  return points;
}

function ownedRectangleArea(group, footprint, frame) {
  const bbox = boundsOf([footprint]);
  const groups = [], allEdges = [], events = [0, frame.h];
  for (const country of group.countries) {
    if (!overlaps(country.bbox, bbox)) continue;
    const edges = [];
    for (const piece of country.pieces) {
      if (!overlaps(piece.bbox, bbox)) continue;
      for (const ring of piece.rings) {
        const clipped = clipToRectangle(ring, frame);
        for (const p of clipped) events.push(clamp(p[1], 0, frame.h));
        for (const edge of edgesOf([clipped])) if (Math.abs(edge.a[1] - edge.b[1]) > EPS) edges.push(edge);
      }
    }
    if (edges.length) { groups.push(edges); allEdges.push(...edges); }
  }
  // Fail closed on pathological custom geometry; normal coastal ribbons contain
  // tens of segments. The display fallback must never create unbounded work.
  if (allEdges.length > 1200) return null;
  // Between vertex/intersection heights, every boundary x(y) is linear. Exact
  // midpoint integration of union widths therefore measures full envelope area,
  // including holes, same-winding nested rings and overlapping owned polygons.
  for (let i = 0; i < allEdges.length; i++) for (let j = i + 1; j < allEdges.length; j++) {
    const a = allEdges[i], b = allEdges[j];
    if (!overlaps(a.bbox, b.bbox)) continue;
    const ax = a.b[0] - a.a[0], ay = a.b[1] - a.a[1], bx = b.b[0] - b.a[0], by = b.b[1] - b.a[1];
    const denominator = ax * by - ay * bx;
    if (Math.abs(denominator) <= EPS) continue;
    const dx = b.a[0] - a.a[0], dy = b.a[1] - a.a[1];
    const t = (dx * by - dy * bx) / denominator, u = (dx * ay - dy * ax) / denominator;
    if (t > EPS && t < 1 - EPS && u > EPS && u < 1 - EPS) events.push(clamp(a.a[1] + t * ay, 0, frame.h));
  }
  events.sort((a, b) => a - b);
  const heights = events.filter((y, i) => !i || y - events[i - 1] > EPS);
  if (heights.length > 4000) return null;
  let area = 0;
  for (let i = 1; i < heights.length; i++) {
    const y = (heights[i - 1] + heights[i]) / 2, intervals = [];
    for (const edges of groups) {
      const crossings = [];
      for (const { a, b } of edges) if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) crossings.push([a[0] + (y - a[1]) / (b[1] - a[1]) * (b[0] - a[0]), b[1] > a[1] ? 1 : -1]);
      crossings.sort((a, b) => a[0] - b[0]);
      let winding = 0, previous = 0;
      for (const [x, delta] of crossings) {
        if (winding !== 0 && x > previous) intervals.push([clamp(previous, 0, frame.w), clamp(x, 0, frame.w)]);
        winding += delta; previous = x;
      }
    }
    intervals.sort((a, b) => a[0] - b[0]);
    let left = 0, right = 0, width = 0;
    for (const [a, b] of intervals) {
      if (a > right) { width += right - left; left = a; right = b; }
      else right = Math.max(right, b);
    }
    width += right - left;
    area += width * (heights[i] - heights[i - 1]);
  }
  return clamp(area, 0, frame.w * frame.h);
}

function pointOwnedDistance(group, x, y) {
  if (containsCountries(group.countries, x, y)) return 0;
  let best = Infinity;
  for (const country of group.countries) for (const piece of country.pieces) {
    const dx = Math.max(0, piece.bbox.x - x, x - piece.bbox.x - piece.bbox.w), dy = Math.max(0, piece.bbox.y - y, y - piece.bbox.y - piece.bbox.h);
    if (dx * dx + dy * dy >= best) continue;
    for (const { a, b, bbox } of piece.edges) {
      const bx = Math.max(0, bbox.x - x, x - bbox.x - bbox.w), by = Math.max(0, bbox.y - y, y - bbox.y - bbox.h);
      if (bx * bx + by * by >= best) continue;
      const ex = b[0] - a[0], ey = b[1] - a[1], lengthSquared = ex * ex + ey * ey;
      const t = clamp(((x - a[0]) * ex + (y - a[1]) * ey) / lengthSquared, 0, 1);
      best = Math.min(best, (x - a[0] - t * ex) ** 2 + (y - a[1] - t * ey) ** 2);
    }
  }
  return Math.sqrt(best);
}

function certifiedCoastalDistance(group, footprint, frame, allowance) {
  if (footprint.some(([x, y]) => pointOwnedDistance(group, x, y) > allowance + EPS)) return false;
  const stack = [[0, 0, frame.w, frame.h, 0]];
  let work = 0;
  while (stack.length) {
    if (++work > 2048) return false;
    const [x, y, w, h, depth] = stack.pop();
    const point = frame.world(x + w / 2, y + h / 2), radius = Math.hypot(w, h) / 2;
    const distance = pointOwnedDistance(group, point[0], point[1]);
    if (distance > allowance + EPS) return false;
    // Distance to a closed land set is 1-Lipschitz. This upper bound certifies
    // every point in the cell, not just the sampled center or label perimeter.
    if (distance + radius <= allowance + EPS) continue;
    if (depth >= 12) return false;
    if (w >= h) stack.push([x, y, w / 2, h, depth + 1], [x + w / 2, y, w / 2, h, depth + 1]);
    else stack.push([x, y, w, h / 2, depth + 1], [x, y + h / 2, w, h / 2, depth + 1]);
  }
  return true;
}

function coastalFootprint(group, foreignCountries, footprint, allowance, maxSeaFraction) {
  if (!footprint || footprint.length !== 4 || !footprint.every(p => p.length === 2 && p.every(Number.isFinite))) return null;
  const frame = rectangleFrame(footprint);
  if (!(frame.w > EPS && frame.h > EPS)) return null;
  const center = frame.world(frame.w / 2, frame.h / 2);
  if (!containsCountries(group.countries, center[0], center[1]) || foreignLandIntersects(foreignCountries, footprint)) return null;
  const area = ownedRectangleArea(group, footprint, frame);
  if (area === null) return null;
  const seaFraction = clamp(1 - area / (frame.w * frame.h), 0, 1);
  if (seaFraction > maxSeaFraction + 1e-9 || !certifiedCoastalDistance(group, footprint, frame, allowance)) return null;
  return { seaFraction, coastal: seaFraction > 1e-8 };
}

function angleOptions(pca) {
  return [...new Set([0, pca, pca - 15, pca + 15, -30, 30, -45, 45, -60, 60].map(angle => Math.round(clamp(angle, -60, 60) * 10) / 10))];
}

// A proven ceiling on rasterFits, so hopeless sizes are never scanned. rasterFits
// checks every raster cell whose centre lies inside the footprint, so any empty
// cell centre strictly inside it makes the fit fail. The footprint's half sizes
// are linear in font size, which turns each known empty cell into a maximum
// size per angle. A few probes along rays from the candidate keep this bound
// close to the real limit; the margin covers floating-point rounding.
const PROBE_RAYS = 32;
const PROBE_MARGIN = 1e-6;

// Geometry-only caches per raster point. Raster candidates are stable objects
// and carry their record; a previous label's anchor is looked up by position.
function pointRecord(raster, point) {
  if (point.record) return point.record;
  const records = raster.records || (raster.records = new Map());
  const key = `${point.x},${point.y}`;
  let record = records.get(key);
  if (!record) records.set(key, record = { x: point.x, y: point.y, limits: new Map(), coastalLimits: new Map() });
  if (raster.candidates.includes(point)) point.record = record;
  return record;
}

function rasterProbes(raster, record) {
  if (record.probes) return record.probes;
  const found = record.probes = [];
  const { x, y } = record, { nx, ny, cell, x0, y0, mask } = raster;
  for (let ray = 0; ray < PROBE_RAYS; ray++) {
    const theta = 2 * Math.PI * ray / PROBE_RAYS, dx = Math.cos(theta) * cell / 2, dy = Math.sin(theta) * cell / 2;
    for (let step = 1; ; step++) {
      const gx = Math.floor((x + dx * step - x0) / cell), gy = Math.floor((y + dy * step - y0) / cell);
      if (gx < 0 || gy < 0 || gx >= nx || gy >= ny) break;
      if (!mask[gy * nx + gx]) { found.push(x0 + (gx + 0.5) * cell - x, y0 + (gy + 0.5) * cell - y); break; }
    }
  }
  return found;
}

/** labelFootprint's half width and half height per unit of font size. */
function footprintHalfSizes(widthEm, curveRatio) {
  const tangent = Math.atan2(4 * Math.abs(widthEm * curveRatio), widthEm);
  return [widthEm / 2 + SIDE_PADDING + FONT_HEIGHT / 2 * Math.sin(tangent), FONT_HEIGHT / 2 + Math.abs(widthEm * curveRatio) / 2];
}

/** Per-angle maximum font size that rasterFits could accept at (x, y); Infinity when unknown. */
function rasterSizeLimits(raster, record, angles, shape, widthEm, curveRatio) {
  let found = record.limits.get(shape);
  if (found) return found;
  const [halfWidth, halfHeight] = footprintHalfSizes(widthEm, curveRatio);
  const probes = rasterProbes(raster, record);
  found = angles.map(angle => {
    const theta = angle * Math.PI / 180, cos = Math.cos(theta), sin = Math.sin(theta);
    let limit = Infinity;
    for (let i = 0; i < probes.length; i += 2) {
      const u = Math.abs(probes[i] * cos + probes[i + 1] * sin), v = Math.abs(probes[i + 1] * cos - probes[i] * sin);
      limit = Math.min(limit, Math.max((u + PROBE_MARGIN) / halfWidth, (v + PROBE_MARGIN) / halfHeight));
    }
    return limit * (1 + 1e-9);
  });
  record.limits.set(shape, found);
  return found;
}

function convexHull(points) {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (sorted.length < 3) return sorted;
  const turn = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = list => {
    const out = [];
    for (const p of list) {
      while (out.length >= 2 && turn(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };
  return [...half(sorted), ...half(sorted.reverse())];
}

// The same kind of ceiling for coastalRasterFits, which tolerates at most 22
// of its 13 x 5 samples at sea. A land sample lies in a filled cell whose centre
// is inside the component, so it projects no further than the component's hull
// plus half a cell diagonal. Too wide a label leaves six whole columns of
// samples beyond that reach (30 at sea), too tall a label both outer rows (26).
function coastalSizeLimits(raster, component, record, angles, shape, widthEm, curveRatio) {
  let found = record.coastalLimits.get(shape);
  if (found) return found;
  const { x, y } = record;
  const hull = raster.hull || (raster.hull = convexHull(component.pieces.flatMap(piece => piece.rings.flat())));
  const [halfWidth, halfHeight] = footprintHalfSizes(widthEm, curveRatio);
  const slack = raster.cell * Math.SQRT1_2 + PROBE_MARGIN;
  found = angles.map(angle => {
    const theta = angle * Math.PI / 180, cos = Math.cos(theta), sin = Math.sin(theta);
    let along = 0, across = 0;
    for (const [px, py] of hull) {
      along = Math.max(along, Math.abs((px - x) * cos + (py - y) * sin));
      across = Math.max(across, Math.abs((py - y) * cos - (px - x) * sin));
    }
    return Math.min(1.5 * (along + slack) / halfWidth, (across + slack) / halfHeight) * (1 + 1e-9);
  });
  record.coastalLimits.set(shape, found);
  return found;
}

// Work that depends on the zoom is kept for a few recent scales, so panning and
// stepping the zoom buttons back and forth reuse it while memory stays bounded.
const SCALES_KEPT = 4;

function scaleCache(holder, field, scale, create = () => new Map()) {
  const caches = holder[field] || (holder[field] = new Map());
  let cache = caches.get(scale);
  if (cache) caches.delete(scale);
  else {
    cache = create();
    if (caches.size >= SCALES_KEPT) caches.delete(caches.keys().next().value);
  }
  caches.set(scale, cache);
  return cache;
}

/**
 * Font-size searches already run at a zoom, per candidate point and angle
 * (undefined: not run, null: no fit). Only view-independent searches are
 * stored, so panning reuses them.
 */
function pointSearches(record, scale, key, angleCount) {
  const searches = scaleCache(record, 'searches', scale);
  let results = searches.get(key);
  if (!results) searches.set(key, results = new Array(angleCount));
  return results;
}

/** Count raster cells with clearance >= margin in any window, in constant time per window. */
function clearanceTable(raster, margin) {
  return scaleCache(raster, 'clearance', margin, () => buildClearanceTable(raster, margin));
}

function buildClearanceTable(raster, margin) {
  const { nx, ny, cell, distance } = raster;
  const table = new Uint32Array((nx + 1) * (ny + 1));
  for (let y = 0; y < ny; y++) {
    let row = 0;
    for (let x = 0; x < nx; x++) {
      if (distance[y * nx + x] * cell >= margin) row++;
      table[(y + 1) * (nx + 1) + x + 1] = table[y * (nx + 1) + x + 1] + row;
    }
  }
  return table;
}

function visibleUsableArea(component, view, minSize) {
  const raster = component.raster || (component.raster = rasterize(component));
  if (!raster) return 0;
  component.area = raster.area;
  const margin = minSize * FONT_HEIGHT / 2;
  const x0 = clamp(Math.ceil((view.x + margin - raster.x0) / raster.cell - 0.5), 0, raster.nx);
  const x1 = clamp(Math.ceil((view.x + view.w - margin - raster.x0) / raster.cell - 0.5), 0, raster.nx);
  const y0 = clamp(Math.ceil((view.y + margin - raster.y0) / raster.cell - 0.5), 0, raster.ny);
  const y1 = clamp(Math.ceil((view.y + view.h - margin - raster.y0) / raster.cell - 0.5), 0, raster.ny);
  if (x1 <= x0 || y1 <= y0) return 0;
  // Every pan and zoom asks this for each visible empire. A fully visible raster
  // keeps its count per clearance threshold; a partial window uses a summed-area
  // table per threshold. Either way the same cells are counted.
  if (x0 === 0 && y0 === 0 && x1 === raster.nx && y1 === raster.ny) {
    const count = scaleCache(raster, 'usable', margin, () => raster.distance.reduce((sum, d) => sum + (d * raster.cell >= margin), 0));
    return count * raster.cell * raster.cell;
  }
  const table = clearanceTable(raster, margin), stride = raster.nx + 1;
  const count = table[y1 * stride + x1] - table[y0 * stride + x1] - table[y1 * stride + x0] + table[y0 * stride + x0];
  return count * raster.cell * raster.cell;
}

/** Yield at most `count` items, without pulling (and so computing) one more. */
function* first(items, count) {
  if (count <= 0) return;
  for (const item of items) {
    yield item;
    if (--count <= 0) return;
  }
}

/**
 * The (point, angle) pairs a component's candidate search can return, each with
 * its proven size ceiling `limit` and score ceiling `bound`. Pairs whose ceiling
 * is below the minimum size cannot fit and are left out.
 */
function candidatePairs(component, definition, options, previous, coastal) {
  const raster = component.raster || (component.raster = rasterize(component));
  if (!raster) return null;
  component.area = raster.area;
  const { unitsPerPixel: k, minFontPx, maxFontPx, viewBox } = options;
  const characters = Math.max(1, [...definition.text].length);
  const advance = Number.isFinite(definition.widthEm) && definition.widthEm > 0 ? definition.widthEm : characters * 0.72;
  const trackingEm = characters > 1 ? options.trackingEm ?? TRACKING : 0;
  const widthEm = advance + Math.max(0, characters - 1) * trackingEm;
  const minSize = minFontPx * k, maxSize = maxFontPx * k;
  const candidates = raster.candidates.slice();
  if (previous && previous.componentKey === component.key && !candidates.some(p => p.x === previous.x && p.y === previous.y)) candidates.unshift({ x: previous.x, y: previous.y, clearance: previous.clearance || 0 });
  const angles = angleOptions(raster.pca);
  const curveRatio = options.curveRatio || 0;
  const shape = `${widthEm}|${curveRatio}`, scale = `${minSize},${maxSize}`;
  const searchKey = `${coastal ? `coast:${options.coastalAllowancePx * k}:${options.maxSeaFraction}` : 'land'}|${shape}`;
  // A footprint never reaches further from its centre than its two half sizes
  // combined. When even the largest one stays clear of the view margin, inView
  // holds at every size the search tries, so the result is view independent.
  const reach = maxSize * footprintHalfSizes(widthEm, curveRatio).reduce((a, b) => a + b) * (1 + 1e-9) + PROBE_MARGIN;
  const scoreOf = (pair, fontSize) => fontSize / k * (1 - Math.abs(pair.angle) / 60 * 0.17) * (pair.preferred ? 1.1 : 1) + 0.35 * pair.candidate.clearance / Math.max(component.bbox.w, component.bbox.h);
  const pairs = [];
  for (const candidate of candidates) {
    if (candidate.x < viewBox.x || candidate.x > viewBox.x + viewBox.w || candidate.y < viewBox.y || candidate.y > viewBox.y + viewBox.h) continue;
    const record = pointRecord(raster, candidate);
    const limits = coastal ? coastalSizeLimits(raster, component, record, angles, shape, widthEm, curveRatio)
      : rasterSizeLimits(raster, record, angles, shape, widthEm, curveRatio);
    const clearOfView = candidate.x - reach >= viewBox.x + 2 * k && candidate.x + reach <= viewBox.x + viewBox.w - 2 * k
      && candidate.y - reach >= viewBox.y + 2 * k && candidate.y + reach <= viewBox.y + viewBox.h - 2 * k;
    const memo = clearOfView ? pointSearches(record, scale, searchKey, angles.length) : null;
    angles.forEach((angle, angleIndex) => {
      // Not even the smallest size can pass the raster test: no result.
      if (!(limits[angleIndex] >= minSize)) return;
      const preferred = previous && previous.componentKey === component.key && Math.abs(previous.x - candidate.x) < EPS && Math.abs(previous.y - candidate.y) < EPS && Math.abs(previous.angle - angle) < EPS;
      const pair = { candidate, angle, angleIndex, limit: limits[angleIndex], memo, preferred, order: pairs.length };
      // The search never returns more than maxSize or a size that failed the raster test.
      pair.bound = scoreOf(pair, Math.min(maxSize, pair.limit));
      pairs.push(pair);
    });
  }
  return { raster, pairs, widthEm, trackingEm, minSize, maxSize, curveRatio, scoreOf };
}

// A coarse grid of each country's nonzero edges (the edges piece.edges holds,
// which foreignLandIntersects tests) for questions about a small area.
function edgeGrid(country) {
  const edges = country.pieces.flatMap(piece => piece.edges), box = country.bbox;
  const side = Math.max(Math.sqrt(box.w * box.h / Math.max(1, edges.length / 4)), box.w / 256, box.h / 256, 1e-9);
  const nx = Math.max(1, Math.ceil(box.w / side)), ny = Math.max(1, Math.ceil(box.h / side));
  const cells = Array.from({ length: nx * ny }, () => []);
  const column = x => clamp(Math.floor((x - box.x) / side), 0, nx - 1), row = y => clamp(Math.floor((y - box.y) / side), 0, ny - 1);
  for (const edge of edges) {
    const b = edge.bbox;
    for (let gy = row(b.y); gy <= row(b.y + b.h); gy++) for (let gx = column(b.x); gx <= column(b.x + b.w); gx++) cells[gy * nx + gx].push(edge);
  }
  return { cells, nx, column, row };
}

/** Call visit(edge) for the country's edges whose bounds meet `box` (some more than once); stop when it returns true. */
function someEdgeIn(country, box, visit) {
  if (!overlaps(country.bbox, box)) return false;
  const grid = country.grid || (country.grid = edgeGrid(country));
  for (let gy = grid.row(box.y); gy <= grid.row(box.y + box.h); gy++) for (let gx = grid.column(box.x); gx <= grid.column(box.x + box.w); gx++) {
    for (const edge of grid.cells[gy * grid.nx + gx]) if (overlaps(edge.bbox, box) && visit(edge)) return true;
  }
  return false;
}

/** Does a foreign edge pass within `radius` of (x, y), keeping its clipped run well above edgeInsideRectangle's EPS? */
function foreignEdgeNear(countries, x, y, radius) {
  if (!(radius > 0)) return false;
  const box = { x: x - radius, y: y - radius, w: 2 * radius, h: 2 * radius };
  return countries.some(country => someEdgeIn(country, box, ({ a, b }) => {
    const ex = b[0] - a[0], ey = b[1] - a[1], length = Math.hypot(ex, ey), reach = radius - 4 * EPS * (1 + length);
    if (reach <= 0) return false;
    const t = clamp(((x - a[0]) * ex + (y - a[1]) * ey) / (length * length), 0, 1);
    return (x - a[0] - t * ex) ** 2 + (y - a[1] - t * ey) ** 2 < reach * reach;
  }));
}

/** Does a foreign edge run through the footprint's interior, clearly beyond EPS? */
function foreignEdgeCrosses(countries, footprint) {
  const box = boundsOf([footprint]);
  return countries.some(country => someEdgeIn(country, box, edge => {
    const interval = edgeInsideRectangle(edge, footprint);
    return !!interval && interval[1] - interval[0] > 4 * EPS;
  }));
}

// Every coastal footprint the layout tries for a pair is centred on its point,
// at its angle and at least the minimum size, so it contains that pair's minimum
// footprint shrunk by 0.1%. A foreign edge crossing this core (or passing within
// its inscribed circle, which settles every angle at once) therefore crosses
// all of them, and foreignLandIntersects rejects them. When every pair is
// blocked like this, the coastal search cannot produce a label: skip it.
function coastalBlocked(component, definition, options, previous, foreign) {
  const setup = candidatePairs(component, definition, options, previous, true);
  if (!setup?.pairs.length) return true;
  const { raster, pairs, widthEm, minSize, curveRatio } = setup;
  const size = minSize * (1 - 1e-3), [halfWidth, halfHeight] = footprintHalfSizes(widthEm, curveRatio);
  const inner = size * Math.min(halfWidth, halfHeight), margin = inner * 1e-3 + PROBE_MARGIN;
  const reach = size * (halfWidth + halfHeight) + raster.cell + PROBE_MARGIN, b = component.bbox;
  const key = `${size}|${widthEm}|${curveRatio}`;
  let near = null, point = null, aroundPoint = false;
  for (const { candidate, angle, angleIndex } of pairs) {
    // The verdicts depend only on this owner's geometry and the size, so pans reuse them.
    const record = pointRecord(raster, candidate);
    const blocked = scaleCache(record, 'blocked', key, () => []);
    if (blocked[angleIndex] === undefined) {
      near ||= foreign.filter(country => overlaps(country.bbox, { x: b.x - reach, y: b.y - reach, w: b.w + 2 * reach, h: b.h + 2 * reach }));
      // An edge inside the core's inscribed circle settles every angle at once.
      if (candidate !== point) { point = candidate; aroundPoint = foreignEdgeNear(near, candidate.x, candidate.y, inner - margin); }
      const width = widthEm * size;
      blocked[angleIndex] = aroundPoint || foreignEdgeCrosses(near, labelFootprint(candidate.x, candidate.y, angle, width, size, width * curveRatio));
    }
    if (!blocked[angleIndex]) return false;
  }
  return true;
}

/**
 * A component's label candidates, best first: exactly the order of a stable sort
 * by score, then flatter angle, then y and x. Callers only read the first few,
 * so the order is produced lazily. Each (point, angle) pair has a proven size
 * ceiling and so a score ceiling; a result is final once it outscores every
 * pair not yet searched, and lower pairs are never searched at all.
 */
function* componentCandidates(component, definition, options, previous, coastal = false) {
  const setup = candidatePairs(component, definition, options, previous, coastal);
  if (!setup) return;
  const { raster, pairs, widthEm, trackingEm, minSize, maxSize, curveRatio, scoreOf } = setup;
  const { unitsPerPixel: k, viewBox } = options;

  function search({ candidate, angle, angleIndex, limit, memo }) {
    let lo = memo?.[angleIndex];
    if (lo !== undefined) return lo;
    const fits = size => {
      // Above the proven ceiling the raster test must fail, so skip the scan.
      if (size > limit) return false;
      const width = widthEm * size, rise = width * curveRatio;
      const footprint = labelFootprint(candidate.x, candidate.y, angle, width, size, rise);
      return (coastal
        ? coastalRasterFits(raster, component.bbox, footprint, options.coastalAllowancePx * k, options.maxSeaFraction)
        : rasterFits(raster, candidate.x, candidate.y, angle, width, size, rise, footprint)) && inView(footprint, viewBox, 2 * k);
    };
    lo = null;
    if (fits(minSize)) {
      let hi = maxSize;
      lo = minSize;
      for (let n = 0; n < 9; n++) { const mid = (lo + hi) / 2; if (fits(mid)) lo = mid; else hi = mid; }
    }
    if (memo) memo[angleIndex] = lo;
    return lo;
  }

  const ranked = (a, b) => b.result.score - a.result.score || Math.abs(a.result.angle) - Math.abs(b.result.angle)
    || a.result.y - b.result.y || a.result.x - b.result.x || a.order - b.order;
  pairs.sort((a, b) => b.bound - a.bound);
  const ready = [];
  let next = 0, best = null;
  for (;;) {
    if (next < pairs.length && (!best || pairs[next].bound >= best.result.score)) {
      const pair = pairs[next++], fontSize = search(pair);
      if (fontSize === null) continue;
      const { candidate, angle } = pair, width = widthEm * fontSize, curveRise = width * curveRatio;
      const entry = { order: pair.order, result: { id: definition.id, text: definition.text, x: candidate.x, y: candidate.y, angle, fontSize, letterSpacing: trackingEm * fontSize, width, height: FONT_HEIGHT * fontSize + Math.abs(curveRise), curveRise, coastal, seaFraction: 0, footprint: labelFootprint(candidate.x, candidate.y, angle, width, fontSize, curveRise), componentArea: raster.area, componentKey: component.key, clearance: candidate.clearance, score: scoreOf(pair, fontSize) } };
      ready.push(entry);
      if (!best || ranked(entry, best) < 0) best = entry;
      continue;
    }
    if (!best) return;
    const { result } = best;
    ready.splice(ready.indexOf(best), 1);
    best = null;
    for (const entry of ready) if (!best || ranked(entry, best) < 0) best = entry;
    yield result;
  }
}

function strictComponentLabel(component, definition, options, previous, accepts) {
  for (const candidate of first(componentCandidates(component, definition, options, previous), 36)) {
    if (accepts(candidate.footprint, component)) return candidate;
    // Coarse raster may slightly overestimate coastline clearance. Retry safely
    // smaller text rather than rejecting a useful geographic anchor outright.
    for (const shrink of [0.96, 0.9, 0.8]) {
      const fontSize = candidate.fontSize * shrink;
      if (fontSize < options.minFontPx * options.unitsPerPixel) break;
      const smaller = { ...candidate, fontSize, width: candidate.width * shrink, height: candidate.height * shrink, letterSpacing: candidate.letterSpacing * shrink, curveRise: candidate.curveRise * shrink };
      smaller.footprint = labelFootprint(smaller.x, smaller.y, smaller.angle, smaller.width, smaller.fontSize, smaller.curveRise);
      if (accepts(smaller.footprint, component)) return smaller;
    }
  }
  return null;
}

/**
 * Reusable, raster-free ownership geometry for per-landmass map treatments.
 *
 * Create once per fitted display geometry, then call components(ownership).
 * Each result is {key, ownerId, bbox, parts:[{countryId, rings}]}. A part keeps
 * its country's nonzero-winding rings, including holes; neighboring countries
 * share a component after conquest, while detached colonies and dateline pieces
 * retain independent bounds. All coordinates match the rendered SVG geometry.
 *
 * Only the current ownership result is cached. Treat returned geometry as
 * read-only; unchanged ownership returns the same array and component objects.
 */
export function createTerritoryComponentIndex(countryShapes = []) {
  const countries = countryShapes.map(makeCountry).filter(Boolean).sort((a, b) => a.id.localeCompare(b.id));
  let lastKey = null, lastComponents = [];
  return {
    components(ownership = {}) {
      const byOwner = new Map();
      for (const country of countries) {
        const owner = ownership[country.id];
        if (owner === undefined || owner === null || owner === '') continue;
        const ownerId = String(owner);
        if (!byOwner.has(ownerId)) byOwner.set(ownerId, []);
        byOwner.get(ownerId).push(country);
      }
      const signature = JSON.stringify([...byOwner.entries()].map(([ownerId, owned]) => [ownerId, owned.map(country => country.id)]));
      if (signature === lastKey) return lastComponents;
      const result = [];
      for (const [ownerId, owned] of byOwner) {
        for (const component of ownerComponents(owned)) {
          const pieceKeys = component.pieces.map(piece => piece.id).sort();
          result.push({
            key: `${ownerId}|${pieceKeys.join('|')}`,
            ownerId,
            bbox: component.bbox,
            parts: component.pieces.map(piece => ({ countryId: piece.countryId, rings: piece.rings })),
          });
        }
      }
      result.sort((a, b) => a.key.localeCompare(b.key));
      lastKey = signature;
      lastComponents = result;
      return result;
    },
  };
}

/**
 * v4 label policy (README "Map rendering", DEC D19, PLAN A-6). Opt-in: pass
 * these to layout() explicitly; layout()'s own defaults stay the pre-v4 ones.
 * Archivo Narrow uppercase with .14em tracking, hidden below 9px except your
 * own label (down to 6.5px), arching 5% of its width, coastal fallback as before.
 */
export const V4_LABEL_POLICY = Object.freeze({
  trackingEm: 0.14,
  curveRatio: 0.05,
  minFontPx: 9,
  ownMinFontPx: 6.5,
  coastalAllowancePx: 10,
  maxSeaFraction: 0.22,
});

/** Largest label size by viewport width class (README "Responsive rules"). */
export const LABEL_SIZE_TIERS = Object.freeze([
  Object.freeze({ minWidth: 1600, maxFontPx: 30 }),
  Object.freeze({ minWidth: 1200, maxFontPx: 22 }),
  Object.freeze({ minWidth: 700, maxFontPx: 20 }),
  Object.freeze({ minWidth: 0, maxFontPx: 18 }),
]);

/**
 * ≥1600 → 30, 1200–1599 → 22, 700–1199 → 20, <700 → 18 (screen px).
 * An unknown width uses the 700–1199 tier, the class of jsdom's 1024px window.
 */
export function labelMaxFontPx(viewportWidth) {
  if (!Number.isFinite(viewportWidth)) return 20;
  return LABEL_SIZE_TIERS.find(tier => viewportWidth >= tier.minWidth)?.maxFontPx ?? 18;
}

/**
 * The layout() input for v4 labels: the tier for `viewportWidth` (or an
 * explicit `maxFontPx`), the 9px floor, and a per-label 6.5px floor for `meId`.
 * Label objects other than your own are passed through unchanged.
 */
export function v4LabelOptions({ viewportWidth, maxFontPx, meId = null, labels = [] } = {}) {
  const policy = V4_LABEL_POLICY;
  const own = meId == null || meId === '' ? null : String(meId);
  return {
    labels: labels.map(label => own !== null && label && String(label.id) === own
      ? { ...label, minFontPx: policy.ownMinFontPx } : label),
    minFontPx: policy.minFontPx,
    maxFontPx: Number.isFinite(maxFontPx) && maxFontPx > 0 ? maxFontPx : labelMaxFontPx(viewportWidth),
    curveRatio: policy.curveRatio,
    coastalAllowancePx: policy.coastalAllowancePx,
    maxSeaFraction: policy.maxSeaFraction,
    trackingEm: policy.trackingEm,
  };
}

// Uppercase advance widths in em for a narrow grotesque (Arial metrics × .82,
// close to Archivo Narrow / Arial Narrow). Used only where no canvas exists.
const NARROW_ADVANCE_EM = {
  A: 0.547, B: 0.547, C: 0.592, D: 0.592, E: 0.547, F: 0.501, G: 0.638, H: 0.592, I: 0.228,
  J: 0.41, K: 0.547, L: 0.456, M: 0.683, N: 0.592, O: 0.638, P: 0.547, Q: 0.638, R: 0.592,
  S: 0.547, T: 0.501, U: 0.592, V: 0.547, W: 0.774, X: 0.547, Y: 0.547, Z: 0.501,
  ' ': 0.228, '.': 0.228, ',': 0.228, '-': 0.273, '\u2013': 0.456, "'": 0.157, '\u2019': 0.182,
  '&': 0.547, '(': 0.273, ')': 0.273, '/': 0.228,
};
const NARROW_DIGIT_EM = 0.456;
const NARROW_DEFAULT_EM = 0.56;

/**
 * Deterministic stand-in for canvas `measureText(text).width / 100` with the
 * map font: the advance of the uppercased text in em, tracking excluded (the
 * engine adds it). Accents are measured as their base letter; weights above
 * 400 widen glyphs slightly (600 → +4%, 700 → +6%). Needs no DOM, so jsdom and
 * Node give identical results.
 */
export function estimateLabelWidthEm(text, weight = 600) {
  const letters = String(text ?? '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  let width = 0;
  for (const character of letters) {
    width += NARROW_ADVANCE_EM[character] ?? (character >= '0' && character <= '9' ? NARROW_DIGIT_EM : NARROW_DEFAULT_EM);
  }
  const boldness = clamp(((Number(weight) || 400) - 400) / 300, 0, 1);
  return Math.round(width * (1 + 0.06 * boldness) * 10000) / 10000;
}

/**
 * Create once per fitted display geometry; reuse for every conquest and zoom.
 *
 * countryShapes: [{id, rings: [[[x,y],...], ...]}], SVG nonzero winding.
 * layout({ownership: {countryId: ownerId}, labels: [{id,text,widthEm,minFontPx?}],
 *         viewBox:{x,y,w,h}, unitsPerPixel, minFontPx=11, maxFontPx=32,
 *         curveRatio=0, coastalAllowancePx=0, maxSeaFraction=.22, trackingEm=.085})
 *
 * `trackingEm` is the letter-spacing added between characters (v4: .14). A
 * label's own `minFontPx` replaces the shared minimum for that label only
 * (v4: 6.5 for your empire); labels that cannot reach their minimum are omitted.
 *
 * Returned x/y/fontSize/letterSpacing/width/height are map units; angle is
 * degrees. `width` is textLength including tracking, while `footprint` is a
 * four-corner rectangle padded for curved glyphs, stroke halo and edges.
 * `curveRise` defines the centered quadratic baseline: M(-width/2,rise/2),
 * Q(0,-1.5*rise),(width/2,rise/2). Render centered, with central dominant baseline.
 * `coastal` and `seaFraction` report the bounded fallback; default mode is strict.
 */
export function createEmpireLabelEngine(countryShapes = []) {
  const countries = new Map(countryShapes.map(makeCountry).filter(Boolean).sort((a, b) => a.id.localeCompare(b.id)).map(c => [c.id, c]));
  const groupCache = new Map();
  const previousLabels = new Map();
  let preparedKey = null, prepared = new Map(), lastLayoutKey = null, lastLayout = [];

  // Every land shape the owner does not hold, in engine order. Built once per
  // owner group rather than once per label per camera frame.
  function foreignOf(group) {
    if (!group.foreign) {
      const ownedIds = new Set(group.countries.map(country => country.id));
      group.foreign = [...countries.values()].filter(country => !ownedIds.has(country.id));
    }
    return group.foreign;
  }

  // Footprint validity is pure geometry, so pans at one zoom repeat the same
  // checks for the same candidates. Remember them for a few recent scales.
  function footprintChecks(group, scale) {
    const results = scaleCache(group, 'checks', scale);
    return (key, check) => {
      if (!results.has(key)) results.set(key, check());
      return results.get(key);
    };
  }

  function prepare(ownership = {}) {
    const byOwner = new Map();
    for (const id of [...countries.keys()]) {
      const owner = ownership[id];
      if (owner === undefined || owner === null || owner === '') continue;
      const key = String(owner);
      if (!byOwner.has(key)) byOwner.set(key, []);
      byOwner.get(key).push(id);
    }
    const signature = JSON.stringify([...byOwner.entries()]);
    if (signature === preparedKey) return prepared;
    preparedKey = signature;
    prepared = new Map();
    for (const [id, ids] of byOwner) {
      const key = JSON.stringify(ids);
      let group = groupCache.get(key);
      if (!group) {
        const owned = ids.map(cid => countries.get(cid));
        const components = ownerComponents(owned);
        for (const component of components) {
          component.key = component.pieces.map(p => p.id).sort().join('|');
          // Signed ring areas are only a priority estimate. Actual union area is
          // measured by the raster before the chosen component is returned.
          component.area = component.pieces.reduce((sum, p) => sum + Math.abs(p.rings.reduce((s, r) => s + ringArea(r), 0)), 0);
        }
        components.sort((a, b) => b.area - a.area || a.key.localeCompare(b.key));
        group = { countries: owned, components, key };
      } else groupCache.delete(key);
      groupCache.set(key, group);
      prepared.set(id, group);
    }
    // Keep all current empires and only eight recently replaced territory sets.
    // A long world conquest must not retain hundreds of historical world-sized
    // rasters. Boundary edges themselves are shared immutable geometry objects.
    const activeKeys = new Set([...prepared.values()].map(group => group.key));
    for (const key of groupCache.keys()) {
      if (groupCache.size <= activeKeys.size + RECENT_GROUP_CACHE) break;
      if (!activeKeys.has(key)) groupCache.delete(key);
    }
    for (const id of previousLabels.keys()) if (!prepared.has(id)) previousLabels.delete(id);
    return prepared;
  }

  return {
    layout({ ownership = {}, labels = [], viewBox = { x: 0, y: 0, w: 960, h: 540 }, unitsPerPixel = 1, minFontPx = 11, maxFontPx = 32, curveRatio = 0, coastalAllowancePx = 0, maxSeaFraction = 0.22, trackingEm } = {}) {
      if (!Number.isFinite(unitsPerPixel) || unitsPerPixel <= 0 || viewBox.w <= 0 || viewBox.h <= 0) return [];
      const groups = prepare(ownership);
      const definitions = labels.filter(l => l && l.text && groups.has(String(l.id))).map(l => ({ ...l, id: String(l.id), text: String(l.text) })).sort((a, b) => a.id.localeCompare(b.id));
      const options = { unitsPerPixel, viewBox, minFontPx: Math.max(1, minFontPx), maxFontPx: Math.max(minFontPx, maxFontPx), curveRatio: Number.isFinite(curveRatio) ? clamp(curveRatio, 0, 0.15) : 0, coastalAllowancePx: Number.isFinite(coastalAllowancePx) ? Math.max(0, coastalAllowancePx) : 0, maxSeaFraction: Number.isFinite(maxSeaFraction) ? clamp(maxSeaFraction, 0, 0.22) : 0.22, trackingEm: Number.isFinite(trackingEm) ? clamp(trackingEm, 0, 0.3) : TRACKING };
      const cacheKey = JSON.stringify([preparedKey, definitions.map(d => [d.id, d.text, d.widthEm, d.minFontPx]), options]);
      if (cacheKey === lastLayoutKey) return lastLayout;
      const output = [];
      for (const definition of definitions) {
        const group = groups.get(definition.id);
        const previous = previousLabels.get(definition.id);
        // A label may carry its own legibility floor (v4: your empire 6.5px).
        const labelMinFontPx = Number.isFinite(definition.minFontPx) && definition.minFontPx > 0
          ? clamp(definition.minFontPx, 1, options.maxFontPx) : options.minFontPx;
        const labelOptions = labelMinFontPx === options.minFontPx ? options : { ...options, minFontPx: labelMinFontPx };
        const foreignCountries = labelOptions.coastalAllowancePx > 0 ? foreignOf(group) : [];
        const checks = footprintChecks(group, `${unitsPerPixel}|${foreignCountries.length > 0}|${labelOptions.coastalAllowancePx}|${labelOptions.maxSeaFraction}`);
        const strictlyFits = (footprint, component) => checks(`land|${component.key}|${footprint.join()}`,
          () => exactFootprint(group, footprint, component) && (!foreignCountries.length || !foreignLandIntersects(foreignCountries, footprint)));
        // Rank the useful land *on screen*, not each island's worldwide area.
        // Otherwise a sliver of Greenland at the edge of a Europe view can steal
        // Germany's name from its much more prominent continental empire.
        // Area creates a bounded shortlist, not the final winner: the best
        // legible name on the continent should beat a smaller name squeezed
        // into a broad but awkward visible corner of an overseas possession.
        const rankedComponents = group.components.filter(component => overlaps(component.bbox, viewBox) && component.bbox.w * component.bbox.h >= (labelOptions.minFontPx * unitsPerPixel) ** 2)
          .map(component => ({ component, score: visibleUsableArea(component, viewBox, labelOptions.minFontPx * unitsPerPixel) }))
          .filter(item => item.score > 0)
          .sort((a, b) => b.score - a.score || a.component.key.localeCompare(b.component.key));
        let chosen = null;
        let bestQuality = -Infinity;
        const largestVisibleArea = rankedComponents[0]?.score || 1;
        const shortlist = rankedComponents.slice(0, 6);
        const priorComponent = rankedComponents.find(item => item.component.key === previous?.componentKey);
        if (priorComponent && !shortlist.includes(priorComponent)) shortlist.push(priorComponent);
        for (const { component, score: visibleArea } of shortlist) {
          const componentLabel = strictComponentLabel(component, definition, labelOptions, previous, strictlyFits);
          if (!componentLabel) continue;
          // Font size/readability dominates. Visible useful area is a mild 6%
          // prior; the previous component receives only 5% hysteresis, so a
          // clearly better mainland label can displace a small colony label.
          const quality = componentLabel.fontSize / unitsPerPixel
            * (1 - Math.abs(componentLabel.angle) / 60 * 0.17)
            * (0.94 + 0.06 * Math.sqrt(visibleArea / largestVisibleArea))
            * (previous?.componentKey === component.key ? 1.05 : 1);
          if (quality > bestQuality) { bestQuality = quality; chosen = componentLabel; }
        }
        // Prefer every readable on-land fit. Use water only to restore a name
        // that otherwise cannot fit, never as an automatic text-size boost.
        if (labelOptions.coastalAllowancePx > 0 && labelOptions.maxSeaFraction > 0 && !chosen) {
          for (const { component, score: visibleArea } of shortlist) {
            if (coastalBlocked(component, definition, labelOptions, previous, foreignCountries)) continue;
            let componentLabel = null;
            for (const candidate of first(componentCandidates(component, definition, labelOptions, previous, true), 24)) {
              const minimum = labelOptions.minFontPx * unitsPerPixel;
              const sizes = [...new Set([candidate.fontSize, candidate.fontSize * 0.98, candidate.fontSize * 0.95, candidate.fontSize * 0.9, minimum].map(size => Math.max(minimum, size)))];
              for (const fontSize of sizes) {
                const shrink = fontSize / candidate.fontSize;
                const adjusted = shrink === 1 ? candidate : { ...candidate, fontSize, width: candidate.width * shrink, height: candidate.height * shrink, letterSpacing: candidate.letterSpacing * shrink, curveRise: candidate.curveRise * shrink };
                adjusted.footprint = labelFootprint(adjusted.x, adjusted.y, adjusted.angle, adjusted.width, adjusted.fontSize, adjusted.curveRise);
                const valid = checks(`coast|${adjusted.footprint.join()}`,
                  () => coastalFootprint(group, foreignCountries, adjusted.footprint, labelOptions.coastalAllowancePx * unitsPerPixel, labelOptions.maxSeaFraction));
                if (valid) { componentLabel = { ...adjusted, ...valid }; break; }
              }
              if (componentLabel) break;
            }
            if (!componentLabel) continue;
            const quality = componentLabel.fontSize / unitsPerPixel
              * (1 - Math.abs(componentLabel.angle) / 60 * 0.17)
              * (0.94 + 0.06 * Math.sqrt(visibleArea / largestVisibleArea))
              * (previous?.componentKey === component.key ? 1.05 : 1);
            if (quality > bestQuality) { bestQuality = quality; chosen = componentLabel; }
          }
        }
        // Keep the preferred arch wherever it works. Before hiding a narrow
        // inland name entirely, try one still-curved but gentler on-land ribbon;
        // no new sea allowance or foreign-land exception is introduced.
        if (!chosen && labelOptions.curveRatio > 0.025) {
          const gentleOptions = { ...labelOptions, curveRatio: 0.025 };
          for (const { component, score: visibleArea } of shortlist) {
            const componentLabel = strictComponentLabel(component, definition, gentleOptions, previous, strictlyFits);
            if (!componentLabel) continue;
            const quality = componentLabel.fontSize / unitsPerPixel
              * (1 - Math.abs(componentLabel.angle) / 60 * 0.17)
              * (0.94 + 0.06 * Math.sqrt(visibleArea / largestVisibleArea))
              * (previous?.componentKey === component.key ? 1.05 : 1);
            if (quality > bestQuality) { bestQuality = quality; chosen = componentLabel; }
          }
        }
        if (chosen) { previousLabels.set(definition.id, chosen); output.push(chosen); }
      }
      lastLayoutKey = cacheKey; lastLayout = output;
      return output;
    },
    contains(ownership, ownerId, x, y) {
      const group = prepare(ownership).get(String(ownerId));
      return !!group && containsCountries(group.countries, x, y);
    },
    validateFootprint(ownership, ownerId, footprint, { unitsPerPixel = 1, coastalAllowancePx = 0, maxSeaFraction = 0.22 } = {}) {
      const group = prepare(ownership).get(String(ownerId));
      if (!group) return false;
      if (!(coastalAllowancePx > 0 && unitsPerPixel > 0)) return exactFootprint(group, footprint);
      return !!coastalFootprint(group, foreignOf(group), footprint, coastalAllowancePx * unitsPerPixel, clamp(maxSeaFraction, 0, 0.22));
    },
  };
}
