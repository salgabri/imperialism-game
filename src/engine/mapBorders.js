// Display-only border mesh. Country paths remain the map's interactive geometry.
// The source rings use the same rounded coordinates as the painted SVG paths.

const ownerOf = value => value == null || value === '' ? null : String(value);

/**
 * Join segments that share endpoints into polylines, one `M` per run (`Z` when a run closes on itself), in a
 * deterministic order. Browsers restart a dash pattern at every subpath, and almost every ring edge is shorter
 * than one dash on screen, so an outline drawn as one `M a L b` per edge never shows its dashes (the your-turn
 * reach outline, DEC D21). Only exact shared point keys are joined: disconnected rings stay apart.
 */
function chainSegments(list) {
  if (!list.length) return '';
  const at = new Map();
  list.forEach((segment, index) => {
    for (const point of [segment.a, segment.b]) {
      const ends = at.get(point);
      if (ends) ends.push(index); else at.set(point, [index]);
    }
  });
  const used = new Uint8Array(list.length);
  // The next unused segment leaving `point`, marked used, or -1.
  const take = point => {
    for (const index of at.get(point)) if (!used[index]) { used[index] = 1; return index; }
    return -1;
  };
  const walk = (from, out) => {
    for (let point = from, index; (index = take(point)) >= 0;) {
      point = list[index].a === point ? list[index].b : list[index].a;
      out.push(point);
    }
    return out;
  };
  let d = '';
  for (let index = 0; index < list.length; index++) {
    if (used[index]) continue;
    used[index] = 1;
    const forward = walk(list[index].b, [list[index].a, list[index].b]);
    const run = walk(list[index].a, []).reverse().concat(forward);
    const closed = run.length > 3 && run[0] === run[run.length - 1];
    d += `M${(closed ? run.slice(0, -1) : run).join('L')}${closed ? 'Z' : ''}`;
  }
  return d;
}

/** Owner outlines (sorted by owner id), each one chained path. */
function ownerOutlines(byOwner) {
  return [...byOwner].sort(([a], [b]) => a.localeCompare(b))
    .map(([ownerId, list]) => ({ ownerId, d: chainSegments(list) }));
}

/**
 * Index the undirected segments of the rendered country rings once per map fit.
 * Resolve the index against ownership to separate quiet national seams from
 * current empire perimeters, or use layers() for the v4 coast / inner / outer
 * classes. Disconnected rings are never stitched together.
 */
export function createMapBorderIndex(geometry = []) {
  const segments = new Map();
  const countryIds = new Set();

  for (const shape of geometry) {
    if (shape?.id == null) continue;
    const countryId = String(shape.id);
    countryIds.add(countryId);
    for (const ring of shape.rings || []) {
      if (ring.length < 2) continue;
      for (let i = 0, previous = ring.length - 1; i < ring.length; previous = i++) {
        const start = ring[previous], end = ring[i];
        if (!start || !end || ![start[0], start[1], end[0], end[1]].every(Number.isFinite)) continue;
        const startKey = `${start[0]},${start[1]}`, endKey = `${end[0]},${end[1]}`;
        if (startKey === endKey) continue;
        const [a, b] = startKey < endKey ? [startKey, endKey] : [endKey, startKey];
        const key = `${a}|${b}`;
        let segment = segments.get(key);
        if (!segment) {
          segment = { a, b, d: `M${a}L${b}`, countryIds: new Set() };
          segments.set(key, segment);
        }
        segment.countryIds.add(countryId);
      }
    }
  }

  const ids = [...countryIds].sort();
  let previousKey, previousResult;
  let layersKey, layersResult;

  return {
    /**
     * v4 border classes (README "Map rendering", DEC D19), resolved against the
     * same rendered segments as resolve() but cached separately from it:
     *   coastD  - a segment of exactly one country (sea, holes, islands), any owner;
     *   innerD  - a seam between countries that all share one non-null owner;
     *   outerD  - every other land border: two owners, owned v neutral and
     *             neutral v neutral alike (the design's `oa && oa === ob` test).
     * The three paths partition the mesh: every segment is in exactly one.
     * ownerPaths keeps resolve()'s meaning (where an owner meets sea, neutral
     * land or another owner), so outlines can be drawn from either result. Each
     * owner's segments are chained into continuous runs, so a dashed outline
     * keeps its dash phase along the border (chainSegments).
     */
    layers(ownership = {}) {
      const owners = new Map(ids.map(id => [id, ownerOf(ownership[id])]));
      const key = JSON.stringify(ids.map(id => owners.get(id)));
      if (key === layersKey) return layersResult;

      const coast = [], inner = [], outer = [];
      const byOwner = new Map();
      for (const segment of segments.values()) {
        const countryOwners = [...segment.countryIds].map(id => owners.get(id));
        const activeOwners = new Set(countryOwners.filter(owner => owner != null));
        const sameOwnerSeam = segment.countryIds.size > 1 && activeOwners.size === 1
          && countryOwners.every(owner => owner === countryOwners[0]);
        if (segment.countryIds.size === 1) coast.push(segment.d);
        else if (sameOwnerSeam) inner.push(segment.d);
        else outer.push(segment.d);
        if (!activeOwners.size || sameOwnerSeam) continue;
        for (const ownerId of activeOwners) {
          if (!byOwner.has(ownerId)) byOwner.set(ownerId, []);
          byOwner.get(ownerId).push(segment);
        }
      }

      layersKey = key;
      layersResult = {
        coastD: coast.join(''),
        innerD: inner.join(''),
        outerD: outer.join(''),
        ownerPaths: ownerOutlines(byOwner),
      };
      return layersResult;
    },

    /**
     * Neutral-only edges stay quiet, including neutral coastlines. An edge is
     * an empire perimeter when it meets sea, neutral land or another owner.
     * A boundary shared by countries of the same owner remains an inner seam.
     * Equivalent ownership objects reuse the previous mesh without rebuilding.
     */
    resolve(ownership = {}) {
      const owners = new Map(ids.map(id => [id, ownerOf(ownership[id])]));
      const key = JSON.stringify(ids.map(id => owners.get(id)));
      if (key === previousKey) return previousResult;

      const internal = [], borders = [];
      const byOwner = new Map();
      for (const segment of segments.values()) {
        const countryOwners = [...segment.countryIds].map(id => owners.get(id));
        const activeOwners = new Set(countryOwners.filter(owner => owner != null));
        const sameOwnerSeam = segment.countryIds.size > 1 && activeOwners.size === 1
          && countryOwners.every(owner => owner === countryOwners[0]);
        if (!activeOwners.size || sameOwnerSeam) {
          internal.push(segment.d);
          continue;
        }
        borders.push(segment.d);
        for (const ownerId of activeOwners) {
          if (!byOwner.has(ownerId)) byOwner.set(ownerId, []);
          byOwner.get(ownerId).push(segment);
        }
      }

      previousKey = key;
      previousResult = {
        internalD: internal.join(''),
        borderD: borders.join(''),
        ownerPaths: ownerOutlines(byOwner),
      };
      return previousResult;
    },
  };
}
