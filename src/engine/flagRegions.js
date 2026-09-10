import { createTerritoryComponentIndex } from './empireLabels.js';

// A fixed geographic display rule, independent of camera zoom. Nearby islands
// share their owner's regional flag instead of repeating a complete flag on
// every little island. Distant overseas possessions keep their own flag canvas.
export const FLAG_REGION_GAP_KM = 180;

const EPS = 1e-10;

function combineBounds(bounds) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const b of bounds) {
    x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

function boundsDistanceSquared(a, b) {
  const dx = Math.max(0, a.x - b.x - b.w, b.x - a.x - a.w);
  const dy = Math.max(0, a.y - b.y - b.h, b.y - a.y - a.h);
  return dx * dx + dy * dy;
}

function edgesOf(parts) {
  const edges = [];
  for (const part of parts) for (const ring of part.rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[j], b = ring[i];
      if (a[0] === b[0] && a[1] === b[1]) continue;
      edges.push({ a, b, bbox: { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(a[0] - b[0]), h: Math.abs(a[1] - b[1]) } });
    }
  }
  return edges;
}

function makeEdgeTree(edges) {
  if (!edges.length) return null;
  const bbox = combineBounds(edges.map(edge => edge.bbox));
  if (edges.length <= 8) return { bbox, count: edges.length, edges };
  const axis = bbox.w >= bbox.h ? 'x' : 'y';
  const span = axis === 'x' ? 'w' : 'h';
  edges.sort((a, b) => a.bbox[axis] + a.bbox[span] / 2 - b.bbox[axis] - b.bbox[span] / 2);
  const middle = Math.floor(edges.length / 2);
  return { bbox, count: edges.length, left: makeEdgeTree(edges.slice(0, middle)), right: makeEdgeTree(edges.slice(middle)) };
}

function pointSegmentDistanceSquared(point, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared ? Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / lengthSquared)) : 0;
  const x = point[0] - a[0] - t * dx, y = point[1] - a[1] - t * dy;
  return x * x + y * y;
}

function segmentDistanceSquared(a, b) {
  const cross = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  // Endpoint distances alone miss two long sides intersecting in their middle.
  if (boundsDistanceSquared(a.bbox, b.bbox) <= EPS
    && cross(a.a, a.b, b.a) * cross(a.a, a.b, b.b) <= EPS
    && cross(b.a, b.b, a.a) * cross(b.a, b.b, a.b) <= EPS) return 0;
  return Math.min(
    pointSegmentDistanceSquared(a.a, b.a, b.b), pointSegmentDistanceSquared(a.b, b.a, b.b),
    pointSegmentDistanceSquared(b.a, a.a, a.b), pointSegmentDistanceSquared(b.b, a.a, a.b),
  );
}

function coastsWithinGap(first, second, gapSquared) {
  if (!first || !second) return false;
  const stack = [[first, second]];
  while (stack.length) {
    const [a, b] = stack.pop();
    if (boundsDistanceSquared(a.bbox, b.bbox) > gapSquared + EPS) continue;
    if (a.edges && b.edges) {
      for (const ea of a.edges) for (const eb of b.edges) {
        if (boundsDistanceSquared(ea.bbox, eb.bbox) <= gapSquared + EPS && segmentDistanceSquared(ea, eb) <= gapSquared + EPS) return true;
      }
      continue;
    }
    const pairs = !a.edges && (b.edges || a.count >= b.count)
      ? [[a.left, b], [a.right, b]] : [[a, b.left], [a, b.right]];
    // Visit the closer branch first: a single proven short coast-to-coast gap
    // establishes the graph edge; no full minimum-distance search is necessary.
    pairs.sort((p, q) => boundsDistanceSquared(q[0].bbox, q[1].bbox) - boundsDistanceSquared(p[0].bbox, p[1].bbox));
    for (const pair of pairs) if (boundsDistanceSquared(pair[0].bbox, pair[1].bbox) <= gapSquared + EPS) stack.push(pair);
  }
  return false;
}

function makeProximityGraph(nodes, maxGap) {
  const neighbors = Array.from({ length: nodes.length }, () => []);
  if (!nodes.length) return neighbors;
  const bounds = combineBounds(nodes.map(node => node.bbox));
  const cellSize = Math.max(maxGap * 4, Math.max(bounds.w, bounds.h) / 128, 0.001);
  const grid = new Map();
  const trees = nodes.map(node => makeEdgeTree(edgesOf(node.parts)));
  const gapSquared = maxGap * maxGap;
  const gridRange = (bbox, padding = 0) => ({
    x0: Math.floor((bbox.x - padding) / cellSize), x1: Math.floor((bbox.x + bbox.w + padding) / cellSize),
    y0: Math.floor((bbox.y - padding) / cellSize), y1: Math.floor((bbox.y + bbox.h + padding) / cellSize),
  });
  for (let i = 0; i < nodes.length; i++) {
    const query = gridRange(nodes[i].bbox, maxGap);
    const candidates = new Set();
    for (let y = query.y0; y <= query.y1; y++) for (let x = query.x0; x <= query.x1; x++) {
      for (const j of grid.get(`${x},${y}`) || []) candidates.add(j);
    }
    for (const j of candidates) {
      if (boundsDistanceSquared(nodes[i].bbox, nodes[j].bbox) <= gapSquared + EPS && coastsWithinGap(trees[i], trees[j], gapSquared)) {
        neighbors[i].push(j); neighbors[j].push(i);
      }
    }
    const insert = gridRange(nodes[i].bbox);
    for (let y = insert.y0; y <= insert.y1; y++) for (let x = insert.x0; x <= insert.x1; x++) {
      const key = `${x},${y}`;
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push(i);
    }
  }
  // The spatial grid and coastline trees are build-time-only. Per-frame work
  // retains just this small graph, native rings and the current ownership result.
  return neighbors;
}

/**
 * Flag-only regional grouping; does not alter land geometry or name placement.
 *
 * countryShapes: [{id,rings}], exact projected SVG nonzero-winding geometry.
 * maxGap: fixed map units, normally FLAG_REGION_GAP_KM / geo.kmPerUnit.
 *
 * components(ownership) returns [{key,ownerId,bbox,parts:[{countryId,rings}]}].
 * Nearby same-owner coasts form a region transitively (mainland -> Corsica ->
 * Sardinia), but another owner's land cannot bridge two possessions. Distance
 * tests use actual boundary segments, never just country centers or boxes.
 * Opposite rendered dateline edges are deliberately not wrapped together.
 *
 * Render only the unchanged `parts` shapes: the regional bounding box defines a
 * shared flag canvas, not newly filled land or a rectangle painted over water.
 * Create once per fitted geometry. Ownership regrouping has a current-result
 * cache; results are read-only and stable when ownership key order changes.
 */
export function createFlagRegionIndex(countryShapes = [], { maxGap = 0 } = {}) {
  const gap = Number.isFinite(maxGap) ? Math.max(0, maxGap) : 0;
  const nativeOwnership = Object.fromEntries(countryShapes.map(shape => [String(shape.id), String(shape.id)]));
  const nodes = createTerritoryComponentIndex(countryShapes).components(nativeOwnership);
  const neighbors = makeProximityGraph(nodes, gap);
  let lastKey = null, lastComponents = [];
  return {
    components(ownership = {}) {
      const owners = nodes.map(node => {
        const owner = ownership[node.ownerId];
        return owner === undefined || owner === null || owner === '' ? null : String(owner);
      });
      const signature = JSON.stringify(owners);
      if (signature === lastKey) return lastComponents;
      const parent = nodes.map((_, i) => i);
      const find = i => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
      for (let i = 0; i < nodes.length; i++) {
        if (owners[i] === null) continue;
        for (const j of neighbors[i]) {
          if (j >= i || owners[j] !== owners[i]) continue;
          const a = find(i), b = find(j);
          if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
        }
      }
      const groups = new Map();
      for (let i = 0; i < nodes.length; i++) {
        if (owners[i] === null) continue;
        const root = find(i);
        if (!groups.has(root)) groups.set(root, []);
        groups.get(root).push(i);
      }
      const result = [...groups.values()].map(indices => {
        const ownerId = owners[indices[0]];
        return {
          key: `${ownerId}|${indices.flatMap(i => nodes[i].key.split('|').slice(1)).sort().join('|')}`,
          ownerId,
          bbox: combineBounds(indices.map(i => nodes[i].bbox)),
          parts: indices.flatMap(i => nodes[i].parts),
        };
      }).sort((a, b) => a.key.localeCompare(b.key));
      lastKey = signature; lastComponents = result;
      return result;
    },
  };
}
