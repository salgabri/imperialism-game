// A flag region's land as a coarse grid of cells, for placing its banner: the emblem fitter (flagSymbolLayout.js) and
// the whole-flag fit (flagFit.js) read the same grid. All coordinates are projected map units. The grid only proposes:
// the emblem fitter certifies its rectangle against the exact outlines before using it.

const MAX_SIDE = 120;
const MAX_CELLS = 10000;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

/**
 * A region's land, country by country: `countries` holds each country's edges (`{ a, b, country, x0, x1, y0, y1 }`,
 * `country` the list the edge sits in), `allEdges` every edge. A country's rings keep their own nonzero winding, so
 * neighbouring countries drawn the opposite way round never cancel each other's land.
 */
export function regionCountries(component) {
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
  return { countries, allEdges };
}

// Preserve each country's nonzero winding before OR-ing countries. Opposite
// ring orientations in neighboring countries must never cancel owned land.
export function landIntervals(countries, y, epsilon = 0) {
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

/**
 * The land of `{ countries, bbox }` as a grid of at most `maxSide` cells a side and about `maxCells` cells (MAX_SIDE and
 * MAX_CELLS unless a caller needs less), with a one-cell margin of sea: a cell is land when its centre is, on the scan line through its row. → null without land, else
 * `{ cell, nx, ny, x0, y0, mask, prefix, main, mainMask, area }`: `prefix` sums the cells that are not land (for
 * rectangle tests), `main` lists the cells of the largest 4-connected piece of land (the region's main body, fixed by
 * geography, never by zoom or labels), `area` is all the land's.
 */
export function makeRaster(geometry, { maxSide = MAX_SIDE, maxCells = MAX_CELLS } = {}) {
  const b = geometry.bbox;
  const cell = Math.max(b.w / maxSide, b.h / maxSide, Math.sqrt(b.w * b.h / maxCells));
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
  return { cell, nx, ny, x0, y0, mask, prefix, main, mainMask, area: landCount * cell * cell };
}
