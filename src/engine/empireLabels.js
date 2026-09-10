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

function containsCountries(countries, x, y) {
  for (const country of countries) {
    const b = country.bbox;
    if (x < b.x - EPS || x > b.x + b.w + EPS || y < b.y - EPS || y > b.y + b.h + EPS) continue;
    if (windingAt(country.rings, x, y)) return true;
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

function rasterFits(raster, x, y, angle, width, fontSize, curveRise = 0) {
  const footprint = labelFootprint(x, y, angle, width, fontSize, curveRise);
  // Scan the full rotated rectangle, not merely its corners or a capsule around
  // its centerline. A capsule needlessly rounds off a broad country's corners
  // and can favor a diagonal label even when a larger horizontal label fits.
  // Prefix counts make each covered raster row a constant-time interior check.
  for (const [px, py] of [...footprint, [x, y]]) {
    const gx = Math.floor((px - raster.x0) / raster.cell), gy = Math.floor((py - raster.y0) / raster.cell);
    if (gx < 0 || gy < 0 || gx >= raster.nx || gy >= raster.ny || !raster.mask[gy * raster.nx + gx]) return false;
  }
  const minY = Math.min(...footprint.map(p => p[1])), maxY = Math.max(...footprint.map(p => p[1]));
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

function coastalRasterFits(raster, bbox, footprint, allowance, maxSeaFraction) {
  const frame = rectangleFrame(footprint);
  let sea = 0, count = 0;
  // A cheap candidate filter only. Exact foreign-land intersection, union area
  // and a certified distance bound below decide whether a coastal fit is legal.
  for (let y = 0; y <= 4; y++) for (let x = 0; x <= 12; x++) {
    const [px, py] = frame.world(frame.w * x / 12, frame.h * y / 4);
    const dx = Math.max(0, bbox.x - px, px - bbox.x - bbox.w), dy = Math.max(0, bbox.y - py, py - bbox.y - bbox.h);
    if (Math.hypot(dx, dy) > allowance + EPS) return false;
    const gx = Math.floor((px - raster.x0) / raster.cell), gy = Math.floor((py - raster.y0) / raster.cell);
    if (gx < 0 || gy < 0 || gx >= raster.nx || gy >= raster.ny || !raster.mask[gy * raster.nx + gx]) sea++;
    count++;
  }
  return sea / count <= maxSeaFraction + 0.12;
}

function foreignLandIntersects(foreignCountries, footprint) {
  const bbox = boundsOf([footprint]);
  for (const country of foreignCountries) {
    if (!overlaps(country.bbox, bbox)) continue;
    if (footprint.some(([x, y]) => windingAt(country.rings, x, y))) return true;
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

function visibleUsableArea(component, view, minSize) {
  const raster = component.raster || (component.raster = rasterize(component));
  if (!raster) return 0;
  component.area = raster.area;
  const margin = minSize * FONT_HEIGHT / 2;
  const x0 = clamp(Math.ceil((view.x + margin - raster.x0) / raster.cell - 0.5), 0, raster.nx);
  const x1 = clamp(Math.ceil((view.x + view.w - margin - raster.x0) / raster.cell - 0.5), 0, raster.nx);
  const y0 = clamp(Math.ceil((view.y + margin - raster.y0) / raster.cell - 0.5), 0, raster.ny);
  const y1 = clamp(Math.ceil((view.y + view.h - margin - raster.y0) / raster.cell - 0.5), 0, raster.ny);
  let count = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (raster.distance[y * raster.nx + x] * raster.cell >= margin) count++;
  return count * raster.cell * raster.cell;
}

function componentCandidates(component, definition, options, previous, coastal = false) {
  const raster = component.raster || (component.raster = rasterize(component));
  if (!raster) return [];
  component.area = raster.area;
  const { unitsPerPixel: k, minFontPx, maxFontPx, viewBox } = options;
  const characters = Math.max(1, [...definition.text].length);
  const advance = Number.isFinite(definition.widthEm) && definition.widthEm > 0 ? definition.widthEm : characters * 0.72;
  const trackingEm = characters > 1 ? TRACKING : 0;
  const widthEm = advance + Math.max(0, characters - 1) * trackingEm;
  const minSize = minFontPx * k, maxSize = maxFontPx * k;
  const results = [];
  const candidates = raster.candidates.slice();
  if (previous && previous.componentKey === component.key && !candidates.some(p => p.x === previous.x && p.y === previous.y)) candidates.unshift({ x: previous.x, y: previous.y, clearance: previous.clearance || 0 });
  for (const candidate of candidates) {
    if (candidate.x < viewBox.x || candidate.x > viewBox.x + viewBox.w || candidate.y < viewBox.y || candidate.y > viewBox.y + viewBox.h) continue;
    for (const angle of angleOptions(raster.pca)) {
      const fits = size => {
        const width = widthEm * size, rise = width * (options.curveRatio || 0);
        const footprint = labelFootprint(candidate.x, candidate.y, angle, width, size, rise);
        return (coastal
          ? coastalRasterFits(raster, component.bbox, footprint, options.coastalAllowancePx * k, options.maxSeaFraction)
          : rasterFits(raster, candidate.x, candidate.y, angle, width, size, rise)) && inView(footprint, viewBox, 2 * k);
      };
      if (!fits(minSize)) continue;
      let lo = minSize, hi = maxSize;
      for (let n = 0; n < 9; n++) { const mid = (lo + hi) / 2; if (fits(mid)) lo = mid; else hi = mid; }
      const fontSize = lo, width = widthEm * fontSize, curveRise = width * (options.curveRatio || 0);
      const preferred = previous && previous.componentKey === component.key && Math.abs(previous.x - candidate.x) < EPS && Math.abs(previous.y - candidate.y) < EPS && Math.abs(previous.angle - angle) < EPS;
      const score = fontSize / k * (1 - Math.abs(angle) / 60 * 0.17) * (preferred ? 1.1 : 1) + 0.35 * candidate.clearance / Math.max(component.bbox.w, component.bbox.h);
      results.push({ id: definition.id, text: definition.text, x: candidate.x, y: candidate.y, angle, fontSize, letterSpacing: trackingEm * fontSize, width, height: FONT_HEIGHT * fontSize + Math.abs(curveRise), curveRise, coastal, seaFraction: 0, footprint: labelFootprint(candidate.x, candidate.y, angle, width, fontSize, curveRise), componentArea: raster.area, componentKey: component.key, clearance: candidate.clearance, score });
    }
  }
  return results.sort((a, b) => b.score - a.score || Math.abs(a.angle) - Math.abs(b.angle) || a.y - b.y || a.x - b.x);
}

function strictComponentLabel(component, definition, options, previous, accepts) {
  const candidates = componentCandidates(component, definition, options, previous);
  for (const candidate of candidates.slice(0, 36)) {
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
 * Create once per fitted display geometry; reuse for every conquest and zoom.
 *
 * countryShapes: [{id, rings: [[[x,y],...], ...]}], SVG nonzero winding.
 * layout({ownership: {countryId: ownerId}, labels: [{id,text,widthEm}],
 *         viewBox:{x,y,w,h}, unitsPerPixel, minFontPx=11, maxFontPx=32,
 *         curveRatio=0, coastalAllowancePx=0, maxSeaFraction=.22})
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
    layout({ ownership = {}, labels = [], viewBox = { x: 0, y: 0, w: 960, h: 540 }, unitsPerPixel = 1, minFontPx = 11, maxFontPx = 32, curveRatio = 0, coastalAllowancePx = 0, maxSeaFraction = 0.22 } = {}) {
      if (!Number.isFinite(unitsPerPixel) || unitsPerPixel <= 0 || viewBox.w <= 0 || viewBox.h <= 0) return [];
      const groups = prepare(ownership);
      const definitions = labels.filter(l => l && l.text && groups.has(String(l.id))).map(l => ({ ...l, id: String(l.id), text: String(l.text) })).sort((a, b) => a.id.localeCompare(b.id));
      const options = { unitsPerPixel, viewBox, minFontPx: Math.max(1, minFontPx), maxFontPx: Math.max(minFontPx, maxFontPx), curveRatio: Number.isFinite(curveRatio) ? clamp(curveRatio, 0, 0.15) : 0, coastalAllowancePx: Number.isFinite(coastalAllowancePx) ? Math.max(0, coastalAllowancePx) : 0, maxSeaFraction: Number.isFinite(maxSeaFraction) ? clamp(maxSeaFraction, 0, 0.22) : 0.22 };
      const cacheKey = JSON.stringify([preparedKey, definitions.map(d => [d.id, d.text, d.widthEm]), options]);
      if (cacheKey === lastLayoutKey) return lastLayout;
      const output = [];
      for (const definition of definitions) {
        const group = groups.get(definition.id);
        const previous = previousLabels.get(definition.id);
        const ownedIds = new Set(group.countries.map(country => country.id));
        const foreignCountries = options.coastalAllowancePx > 0 ? [...countries.values()].filter(country => !ownedIds.has(country.id)) : [];
        const strictlyFits = (footprint, component) => exactFootprint(group, footprint, component) && (!foreignCountries.length || !foreignLandIntersects(foreignCountries, footprint));
        // Rank the useful land *on screen*, not each island's worldwide area.
        // Otherwise a sliver of Greenland at the edge of a Europe view can steal
        // Germany's name from its much more prominent continental empire.
        // Area creates a bounded shortlist, not the final winner: the best
        // legible name on the continent should beat a smaller name squeezed
        // into a broad but awkward visible corner of an overseas possession.
        const rankedComponents = group.components.filter(component => overlaps(component.bbox, viewBox) && component.bbox.w * component.bbox.h >= (options.minFontPx * unitsPerPixel) ** 2)
          .map(component => ({ component, score: visibleUsableArea(component, viewBox, options.minFontPx * unitsPerPixel) }))
          .filter(item => item.score > 0)
          .sort((a, b) => b.score - a.score || a.component.key.localeCompare(b.component.key));
        let chosen = null;
        let bestQuality = -Infinity;
        const largestVisibleArea = rankedComponents[0]?.score || 1;
        const shortlist = rankedComponents.slice(0, 6);
        const priorComponent = rankedComponents.find(item => item.component.key === previous?.componentKey);
        if (priorComponent && !shortlist.includes(priorComponent)) shortlist.push(priorComponent);
        for (const { component, score: visibleArea } of shortlist) {
          const componentLabel = strictComponentLabel(component, definition, options, previous, strictlyFits);
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
        if (options.coastalAllowancePx > 0 && options.maxSeaFraction > 0 && !chosen) {
          for (const { component, score: visibleArea } of shortlist) {
            const candidates = componentCandidates(component, definition, options, previous, true);
            let componentLabel = null;
            for (const candidate of candidates.slice(0, 24)) {
              const minimum = options.minFontPx * unitsPerPixel;
              const sizes = [...new Set([candidate.fontSize, candidate.fontSize * 0.98, candidate.fontSize * 0.95, candidate.fontSize * 0.9, minimum].map(size => Math.max(minimum, size)))];
              for (const fontSize of sizes) {
                const shrink = fontSize / candidate.fontSize;
                const adjusted = shrink === 1 ? candidate : { ...candidate, fontSize, width: candidate.width * shrink, height: candidate.height * shrink, letterSpacing: candidate.letterSpacing * shrink, curveRise: candidate.curveRise * shrink };
                adjusted.footprint = labelFootprint(adjusted.x, adjusted.y, adjusted.angle, adjusted.width, adjusted.fontSize, adjusted.curveRise);
                const valid = coastalFootprint(group, foreignCountries, adjusted.footprint, options.coastalAllowancePx * unitsPerPixel, options.maxSeaFraction);
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
        if (!chosen && options.curveRatio > 0.025) {
          const gentleOptions = { ...options, curveRatio: 0.025 };
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
      const ownedIds = new Set(group.countries.map(country => country.id));
      const foreignCountries = [...countries.values()].filter(country => !ownedIds.has(country.id));
      return !!coastalFootprint(group, foreignCountries, footprint, coastalAllowancePx * unitsPerPixel, clamp(maxSeaFraction, 0, 0.22));
    },
  };
}
