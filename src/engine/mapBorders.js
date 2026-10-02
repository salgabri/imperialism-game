// Display-only border mesh. Country paths remain the map's interactive geometry.
// The source rings use the same rounded coordinates as the painted SVG paths.

const ownerOf = value => value == null || value === '' ? null : String(value);

/**
 * Index the undirected segments of the rendered country rings once per map fit.
 * Resolve the index against ownership to separate quiet national seams from
 * current empire perimeters. Disconnected rings are never stitched together.
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
          segment = { d: `M${a}L${b}`, countryIds: new Set() };
          segments.set(key, segment);
        }
        segment.countryIds.add(countryId);
      }
    }
  }

  const ids = [...countryIds].sort();
  let previousKey, previousResult;

  return {
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
          byOwner.get(ownerId).push(segment.d);
        }
      }

      previousKey = key;
      previousResult = {
        internalD: internal.join(''),
        borderD: borders.join(''),
        ownerPaths: [...byOwner].sort(([a], [b]) => a.localeCompare(b))
          .map(([ownerId, paths]) => ({ ownerId, d: paths.join('') })),
      };
      return previousResult;
    },
  };
}
