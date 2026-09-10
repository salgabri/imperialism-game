// A flag's field can deform with an empire; its coat of arms cannot. Place one
// undistorted emblem on substantial land, then register the stretched field to
// the emblem's original focal point. All coordinates are projected map units.
// Raster cells only propose candidates. A vector sweep certifies the complete
// padded rectangle, including holes, before any symbol is returned.

const CACHE = new WeakMap();
const MAX_SIDE = 120;
const MAX_CELLS = 10000;
const MAX_CANDIDATES = 20;
const SYMBOL_PADDING = 1.1;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const finiteBox = b => b && [b.x, b.y, b.w, b.h].every(Number.isFinite) && b.w > 0 && b.h > 0;

function prepare(component) {
  const grouped = new Map();
  for (const part of component.parts || []) {
    const id = String(part.countryId);
    if (!grouped.has(id)) grouped.set(id, []);
    for (const ring of part.rings || []) {
      if (ring.length >= 3 && ring.every(p => p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]))) grouped.get(id).push(ring);
    }
  }
  const countries = [];
  const allEdges = [];
  for (const rings of grouped.values()) {
    const edges = [];
    for (const ring of rings) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[j], b = ring[i];
      if (a[0] === b[0] && a[1] === b[1]) continue;
      const edge = { a, b, country: edges, x0: Math.min(a[0], b[0]), x1: Math.max(a[0], b[0]), y0: Math.min(a[1], b[1]), y1: Math.max(a[1], b[1]) };
      edges.push(edge); allEdges.push(edge);
    }
    if (edges.length) countries.push(edges);
  }
  // Native atlas borders have matching segments. Remove only proven internal
  // duplicates from the certification sweep; retaining thousands of vanished
  // national borders would turn a late-game empire fit into quadratic work.
  // Countries remain separate for every winding/union query below.
  const duplicates = new Map();
  for (const edge of allEdges) {
    const a = `${edge.a[0]},${edge.a[1]}`, b = `${edge.b[0]},${edge.b[1]}`;
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (!duplicates.has(key)) duplicates.set(key, []);
    duplicates.get(key).push(edge);
  }
  const epsilon = Math.max(component.bbox.w, component.bbox.h) * 1e-9;
  const edges = [];
  for (const matching of duplicates.values()) {
    let internal = false;
    if (matching.length > 1) {
      const edge = matching[0], dx = edge.b[0] - edge.a[0], dy = edge.b[1] - edge.a[1], length = Math.hypot(dx, dy);
      const x = (edge.a[0] + edge.b[0]) / 2, y = (edge.a[1] + edge.b[1]) / 2;
      internal = [-1, 1].every(side => matching.some(candidate => containsCountry(candidate.country, x - side * dy / length * epsilon, y + side * dx / length * epsilon)));
    }
    if (!internal) edges.push(matching[0]);
  }
  return { countries, edges, bbox: component.bbox };
}

function containsCountry(edges, x, y) {
  let winding = 0;
  for (const { a, b } of edges) {
    const cross = (b[0] - a[0]) * (y - a[1]) - (x - a[0]) * (b[1] - a[1]);
    if (a[1] <= y && b[1] > y && cross > 0) winding++;
    else if (a[1] > y && b[1] <= y && cross < 0) winding--;
  }
  return winding !== 0;
}

// Preserve each country's nonzero winding before OR-ing countries. Opposite
// ring orientations in neighboring countries must never cancel owned land.
function landIntervals(countries, y, epsilon = 0) {
  const intervals = [];
  for (const edges of countries) {
    const events = [];
    for (const { a, b, y0, y1 } of edges) {
      if (y < y0 || y >= y1) continue;
      events.push([a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1]), b[1] > a[1] ? 1 : -1]);
    }
    events.sort((a, b) => a[0] - b[0]);
    let winding = 0, start = 0;
    for (let i = 0; i < events.length;) {
      const x = events[i][0];
      let delta = 0;
      while (i < events.length && events[i][0] === x) delta += events[i++][1];
      if (!winding && winding + delta) start = x;
      if (winding && !(winding + delta)) intervals.push([start, x]);
      winding += delta;
    }
  }
  intervals.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged = [];
  for (const interval of intervals) {
    const last = merged[merged.length - 1];
    if (last && interval[0] <= last[1] + epsilon) last[1] = Math.max(last[1], interval[1]);
    else merged.push(interval.slice());
  }
  return merged;
}

function makeRaster(geometry) {
  const b = geometry.bbox;
  const cell = Math.max(b.w / MAX_SIDE, b.h / MAX_SIDE, Math.sqrt(b.w * b.h / MAX_CELLS));
  const nx = Math.ceil(b.w / cell) + 2, ny = Math.ceil(b.h / cell) + 2;
  const x0 = b.x - cell, y0 = b.y - cell;
  const mask = new Uint8Array(nx * ny);
  let landCount = 0;
  for (let row = 1; row < ny - 1; row++) {
    for (const [left, right] of landIntervals(geometry.countries, y0 + (row + 0.5) * cell)) {
      const start = clamp(Math.ceil((left - x0) / cell - 0.5), 1, nx - 1);
      const end = clamp(Math.ceil((right - x0) / cell - 0.5), 1, nx - 1);
      mask.fill(1, row * nx + start, row * nx + end);
      landCount += end - start;
    }
  }
  if (!landCount) return null;
  // Select a connected substantial landmass, not an isolated, conveniently
  // round speck. This choice is fixed by geography, never by zoom or labels.
  const visited = new Uint8Array(mask.length);
  let main = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || visited[start]) continue;
    const flood = [start]; visited[start] = 1;
    for (let j = 0; j < flood.length; j++) {
      const i = flood[j];
      for (const next of [i - 1, i + 1, i - nx, i + nx]) {
        if (mask[next] && !visited[next]) { visited[next] = 1; flood.push(next); }
      }
    }
    if (flood.length > main.length) main = flood;
  }
  const prefix = new Uint32Array((nx + 1) * (ny + 1));
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const p = (y + 1) * (nx + 1) + x + 1;
    prefix[p] = (mask[y * nx + x] ? 0 : 1) + prefix[p - 1] + prefix[p - nx - 1] - prefix[p - nx - 2];
  }
  const mainMask = new Uint8Array(mask.length);
  for (const i of main) mainMask[i] = 1;
  return { cell, nx, ny, x0, y0, prefix, main, mainMask, area: landCount * cell * cell };
}

function rasterFits(r, cx, cy, w, h) {
  const left = Math.floor((cx - w / 2 - r.x0) / r.cell);
  const top = Math.floor((cy - h / 2 - r.y0) / r.cell);
  const right = Math.floor((cx + w / 2 - r.x0) / r.cell) + 1;
  const bottom = Math.floor((cy + h / 2 - r.y0) / r.cell) + 1;
  if (left < 0 || top < 0 || right > r.nx || bottom > r.ny) return false;
  const stride = r.nx + 1;
  return r.prefix[bottom * stride + right] - r.prefix[top * stride + right]
    - r.prefix[bottom * stride + left] + r.prefix[top * stride + left] === 0;
}

function clipEdge(edge, box) {
  let low = 0, high = 1;
  for (const [a, delta, start, end] of [
    [edge.a[0], edge.b[0] - edge.a[0], box.x, box.x + box.w],
    [edge.a[1], edge.b[1] - edge.a[1], box.y, box.y + box.h],
  ]) {
    if (delta === 0) { if (a < start || a > end) return null; }
    else {
      const s = (start - a) / delta, e = (end - a) / delta;
      low = Math.max(low, Math.min(s, e)); high = Math.min(high, Math.max(s, e));
      if (low > high) return null;
    }
  }
  const dy = edge.b[1] - edge.a[1];
  return [edge.a[1] + low * dy, edge.a[1] + high * dy];
}

function crossingY(first, second) {
  const ax = first.b[0] - first.a[0], ay = first.b[1] - first.a[1];
  const bx = second.b[0] - second.a[0], by = second.b[1] - second.a[1];
  const cross = ax * by - ay * bx;
  if (!cross) return null;
  const dx = second.a[0] - first.a[0], dy = second.a[1] - first.a[1];
  const t = (dx * by - dy * bx) / cross, u = (dx * ay - dy * ax) / cross;
  return t > 0 && t < 1 && u > 0 && u < 1 ? first.a[1] + t * ay : null;
}

function exactFits(geometry, box) {
  const epsilon = Math.max(geometry.bbox.w, geometry.bbox.h) * 1e-10;
  const ys = [box.y, box.y + box.h];
  const edges = [];
  for (const edge of geometry.edges) {
    if (edge.x1 < box.x || edge.x0 > box.x + box.w || edge.y1 < box.y || edge.y0 > box.y + box.h) continue;
    const clipped = clipEdge(edge, box);
    if (clipped) { ys.push(...clipped); edges.push(edge); }
  }
  // An overlap of country shapes may change the ordering of scanline edges
  // between vertices. Include actual intersections, not just vertex rows.
  edges.sort((a, b) => a.x0 - b.x0);
  for (let i = 0; i < edges.length; i++) for (let j = i + 1; j < edges.length && edges[j].x0 <= edges[i].x1; j++) {
    const a = edges[i], b = edges[j];
    if (a.y1 < b.y0 || b.y1 < a.y0) continue;
    const y = crossingY(a, b);
    if (y !== null && y > box.y && y < box.y + box.h) ys.push(y);
  }
  ys.sort((a, b) => a - b);
  for (let i = 1; i < ys.length; i++) {
    const low = ys[i - 1], high = ys[i];
    if (high - low <= epsilon) continue;
    const inset = Math.min(epsilon, (high - low) * 1e-5);
    // Within a strip all endpoints are linear and their order is fixed.
    // Checking both limiting rows proves the whole width remains owned; this
    // rejects even tiny holes that no raster sample or four-corner test sees.
    for (const y of [low + inset, high - inset]) {
      if (!landIntervals(geometry.countries, y, epsilon).some(([left, right]) => left <= box.x + epsilon && right >= box.x + box.w - epsilon)) return false;
    }
  }
  return true;
}

function fit(geometry, profile) {
  const raster = makeRaster(geometry);
  if (!raster) return null;
  const b = geometry.bbox, native = profile.bounds;
  const fx = (native.x + native.w / 2) / profile.sourceWidth;
  const fy = (native.y + native.h / 2) / profile.sourceHeight;
  const constraints = profile.fieldConstraints;
  const maxFieldW = constraints?.maxWidthRatio ? (b.w + 0.2) * constraints.maxWidthRatio : Infinity;
  const maxFieldH = constraints?.maxHeightRatio ? (b.h + 0.2) * constraints.maxHeightRatio : Infinity;
  const constrained = Number.isFinite(maxFieldW) || Number.isFinite(maxFieldH);
  const constraintEpsilon = Math.max(b.w, b.h) * 1e-10;
  const nativeX = b.x - 0.1 + (b.w + 0.2) * fx, nativeY = b.y - 0.1 + (b.h + 0.2) * fy;
  const naturalScale = Math.sqrt(raster.area / (profile.sourceWidth * profile.sourceHeight)) * 1.15;
  const cap = Math.min(naturalScale, Math.sqrt(raster.area * 0.55 / (native.w * native.h)), maxFieldW / profile.sourceWidth, maxFieldH / profile.sourceHeight);
  const paddedW = native.w * SYMBOL_PADDING, paddedH = native.h * SYMBOL_PADDING;
  let meanX = 0, meanY = 0;
  for (const i of raster.main) { meanX += raster.x0 + (i % raster.nx + 0.5) * raster.cell; meanY += raster.y0 + (Math.floor(i / raster.nx) + 0.5) * raster.cell; }
  meanX /= raster.main.length; meanY /= raster.main.length;
  const points = raster.main.map(i => ({ x: raster.x0 + (i % raster.nx + 0.5) * raster.cell, y: raster.y0 + (Math.floor(i / raster.nx) + 0.5) * raster.cell }));
  points.push({ x: meanX, y: meanY }, { x: b.x + b.w / 2, y: b.y + b.h / 2 });
  if (constrained) points.push({ x: nativeX, y: nativeY });
  const ranked = [];
  for (const point of points) {
    // Overscan caps define a legal interval for the field's native focal
    // point. Enforce it during the search, not after a central placement has
    // already displaced a structural stripe entirely beyond the coastline.
    if (point.x < b.x + b.w + 0.1 - (1 - fx) * maxFieldW - constraintEpsilon || point.x > b.x - 0.1 + fx * maxFieldW + constraintEpsilon
      || point.y < b.y + b.h + 0.1 - (1 - fy) * maxFieldH - constraintEpsilon || point.y > b.y - 0.1 + fy * maxFieldH + constraintEpsilon) continue;
    const column = Math.floor((point.x - raster.x0) / raster.cell), row = Math.floor((point.y - raster.y0) / raster.cell);
    if (!raster.mainMask[row * raster.nx + column]) continue;
    if (!rasterFits(raster, point.x, point.y, 0, 0)) continue;
    let low = 0, high = cap;
    for (let step = 0; step < 10; step++) {
      const mid = (low + high) / 2;
      if (rasterFits(raster, point.x, point.y, paddedW * mid, paddedH * mid)) low = mid;
      else high = mid;
    }
    const focalDistance = Math.hypot((point.x - nativeX) / b.w, (point.y - nativeY) / b.h);
    const placementWeight = constrained ? 1 / (1 + 1.5 * focalDistance) : 1;
    ranked.push({ ...point, scale: low, placementWeight, score: low * placementWeight, centrality: Math.hypot(point.x - meanX, point.y - meanY) });
  }
  ranked.sort((a, z) => z.score - a.score || a.centrality - z.centrality || a.y - z.y || a.x - z.x);
  const candidates = [];
  const spacing = Math.max(raster.cell * 2, Math.sqrt(raster.main.length) * raster.cell * 0.065);
  for (const point of ranked) {
    if (candidates.every(other => Math.hypot(other.x - point.x, other.y - point.y) >= spacing)) candidates.push(point);
    if (candidates.length === MAX_CANDIDATES) break;
  }
  let best = null;
  for (const point of candidates) {
    if (best && point.score <= best.score) continue;
    const rectangle = scale => ({ x: point.x - paddedW * scale / 2, y: point.y - paddedH * scale / 2, w: paddedW * scale, h: paddedH * scale });
    let scale = point.scale;
    if (scale <= 0) continue;
    if (!exactFits(geometry, rectangle(scale))) {
      let low = 0, high = scale;
      for (let step = 0; step < 12; step++) {
        const mid = (low + high) / 2;
        if (exactFits(geometry, rectangle(mid))) low = mid;
        else high = mid;
      }
      scale = low;
    }
    const score = scale * point.placementWeight;
    if (scale > 0 && (!best || score > best.score)) best = { ...point, scale, score };
  }
  if (!best || best.scale * Math.min(native.w, native.h) < raster.cell * 0.15) return null;
  const symbol = Object.freeze({ x: best.x - native.w * best.scale / 2, y: best.y - native.h * best.scale / 2, w: native.w * best.scale, h: native.h * best.scale });
  // Expand each side of the field around the *native* focal fraction. For
  // Portugal this keeps the emblem centered exactly on the 40% green/red seam.
  // The third constraint also leaves the native symbol's surrounding stripe
  // tall/wide enough for the uniformly scaled emblem (e.g. Spain's yellow band).
  const w = Math.max((best.x - b.x + 0.1) / fx, (b.x + b.w + 0.1 - best.x) / (1 - fx), symbol.w * profile.sourceWidth / native.w);
  const h = Math.max((best.y - b.y + 0.1) / fy, (b.y + b.h + 0.1 - best.y) / (1 - fy), symbol.h * profile.sourceHeight / native.h);
  const field = Object.freeze({ x: best.x - w * fx, y: best.y - h * fy, w, h });
  return Object.freeze({ symbol, field, quality: Object.freeze({ landArea: raster.area, scale: best.scale, candidates: candidates.length, rasterCells: raster.nx * raster.ny }) });
}

/** One unrotated, aspect-correct emblem per flag-region component; no viewport input. */
export function layoutFlagSymbol(component, profile) {
  if (!component || typeof component !== 'object' || !finiteBox(component.bbox) || !finiteBox(profile?.bounds)
    || !Number.isFinite(profile.sourceWidth) || !Number.isFinite(profile.sourceHeight) || profile.sourceWidth <= 0 || profile.sourceHeight <= 0) return null;
  const n = profile.bounds;
  if (n.x < 0 || n.y < 0 || n.x + n.w > profile.sourceWidth || n.y + n.h > profile.sourceHeight) return null;
  for (const axis of ['maxWidthRatio', 'maxHeightRatio']) {
    const value = profile.fieldConstraints?.[axis];
    if (value !== undefined && (!Number.isFinite(value) || value <= 0)) return null;
  }
  let cached = CACHE.get(component);
  if (!cached) { cached = { geometry: prepare(component), profiles: new Map() }; CACHE.set(component, cached); }
  const key = [n.x, n.y, n.w, n.h, profile.sourceWidth, profile.sourceHeight, profile.fieldConstraints?.maxWidthRatio, profile.fieldConstraints?.maxHeightRatio].join(',');
  if (!cached.profiles.has(key)) cached.profiles.set(key, fit(cached.geometry, profile));
  return cached.profiles.get(key);
}
