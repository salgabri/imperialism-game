// Display-only border mesh. Country paths remain the map's interactive geometry.
// The source rings use the same rounded coordinates as the painted SVG paths.

const ownerOf = value => value == null || value === '' ? null : String(value);
// Segment keys pack two point ids into one number (exact below 2^53 for up to 2^26 points).
const POINT_SPAN = 0x4000000;

/**
 * Join segments that share endpoints into polylines, one `M` per run (`Z` when a run closes on itself), in a
 * deterministic order. Browsers restart a dash pattern at every subpath, and almost every ring edge is shorter
 * than one dash on screen, so an outline drawn as one `M a L b` per edge never shows its dashes (the your-turn
 * reach outline, DEC D21). Only exact shared point keys are joined: disconnected rings stay apart.
 * `list` holds segment indexes; `mesh` their end point ids (`a`, `b`) and the point keys.
 */
function chainSegments(list, mesh) {
  if (!list.length) return '';
  const { a, b, points } = mesh;
  const at = new Map();
  list.forEach((segment, index) => {
    for (const point of [a[segment], b[segment]]) {
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
      const segment = list[index];
      point = a[segment] === point ? b[segment] : a[segment];
      out.push(point);
    }
    return out;
  };
  let d = '';
  for (let index = 0; index < list.length; index++) {
    if (used[index]) continue;
    used[index] = 1;
    const segment = list[index];
    const forward = walk(b[segment], [a[segment], b[segment]]);
    const run = walk(a[segment], []).reverse().concat(forward);
    const closed = run.length > 3 && run[0] === run[run.length - 1];
    d += `M${(closed ? run.slice(0, -1) : run).map(point => points[point]).join('L')}${closed ? 'Z' : ''}`;
  }
  return d;
}

/**
 * Index the undirected segments of the rendered country rings once per map fit.
 * Resolve the index against ownership to separate quiet national seams from
 * current empire perimeters, or use layers() for the v4 coast / inner / outer
 * classes. Disconnected rings are never stitched together.
 *
 * Every segment drawn by the same set of countries is classified alike for any
 * ownership, so segments are kept in those groups (a country's coast, one
 * shared border) and each group's path is chained once. A new ownership only
 * re-sorts the few thousand groups; the world-sized coastline never changes.
 */
export function createMapBorderIndex(geometry = []) {
  const pointIds = new Map(), points = [];
  const pointOf = key => {
    let id = pointIds.get(key);
    if (id === undefined) { id = points.length; points.push(key); pointIds.set(key, id); }
    return id;
  };
  const segmentIds = new Map(), segmentCountries = [], a = [], b = [];
  const countryIndex = new Map(), countryIds = [];

  for (const shape of geometry) {
    if (shape?.id == null) continue;
    const countryId = String(shape.id);
    let country = countryIndex.get(countryId);
    if (country === undefined) { country = countryIds.length; countryIds.push(countryId); countryIndex.set(countryId, country); }
    for (const ring of shape.rings || []) {
      if (ring.length < 2) continue;
      for (let i = 0, previous = ring.length - 1; i < ring.length; previous = i++) {
        const start = ring[previous], end = ring[i];
        if (!start || !end || ![start[0], start[1], end[0], end[1]].every(Number.isFinite)) continue;
        const startKey = `${start[0]},${start[1]}`, endKey = `${end[0]},${end[1]}`;
        if (startKey === endKey) continue;
        const [low, high] = startKey < endKey ? [startKey, endKey] : [endKey, startKey];
        const lowId = pointOf(low), highId = pointOf(high), key = lowId * POINT_SPAN + highId;
        let segment = segmentIds.get(key);
        if (segment === undefined) {
          segment = a.length;
          a.push(lowId); b.push(highId); segmentCountries.push([]);
          segmentIds.set(key, segment);
        }
        if (!segmentCountries[segment].includes(country)) segmentCountries[segment].push(country);
      }
    }
  }

  // Segments by the set of countries drawing them, in first-seen order.
  const groupIds = new Map(), groups = [];
  segmentCountries.forEach((countries, segment) => {
    const key = countries.length === 1 ? countries[0] : countries.slice().sort((x, y) => x - y).join(',');
    let group = groupIds.get(key);
    if (group === undefined) {
      group = groups.length;
      groupIds.set(key, group);
      groups.push({ countries: countries.map(index => countryIds[index]), segments: [], d: null });
    }
    groups[group].segments.push(segment);
  });
  pointIds.clear();
  groupIds.clear();
  const mesh = { a: Int32Array.from(a), b: Int32Array.from(b), points };
  for (const group of groups) group.segments = Int32Array.from(group.segments);
  const pathOf = group => group.d ??= chainSegments(group.segments, mesh);
  let coastD = null;
  const coast = () => coastD ??= groups.filter(group => group.countries.length === 1).map(pathOf).join('');

  const ids = [...countryIds].sort();
  /** The owner of every country and the cache key of that assignment. */
  const ownersOf = ownership => {
    const owners = new Map(ids.map(id => [id, ownerOf(ownership[id])]));
    return { owners, key: JSON.stringify(ids.map(id => owners.get(id))) };
  };
  /**
   * Each group's place for one assignment: a seam inside one empire (`sameOwnerSeam`), and the owners whose
   * perimeter it is (none for a seam or land nobody holds).
   */
  const placesOf = owners => groups.map(group => {
    const countryOwners = group.countries.map(id => owners.get(id));
    const active = [...new Set(countryOwners.filter(owner => owner != null))];
    const sameOwnerSeam = group.countries.length > 1 && active.length === 1
      && countryOwners.every(owner => owner === countryOwners[0]);
    return { sameOwnerSeam, perimeterOf: !active.length || sameOwnerSeam ? [] : active };
  });
  /** Owner outlines (sorted by owner id), each one chained path, built when first read. */
  const outlines = places => {
    const byOwner = new Map();
    places.forEach((place, group) => {
      for (const ownerId of place.perimeterOf) {
        if (!byOwner.has(ownerId)) byOwner.set(ownerId, []);
        byOwner.get(ownerId).push(group);
      }
    });
    const chained = new Map();
    const outline = ownerId => {
      const id = ownerOf(ownerId);
      if (!byOwner.has(id)) return '';
      if (!chained.has(id)) chained.set(id, chainSegments(byOwner.get(id).flatMap(group => [...groups[group].segments]), mesh));
      return chained.get(id);
    };
    let all = null;
    return { outline, all: () => all ??= [...byOwner.keys()].sort((x, y) => x.localeCompare(y))
      .map(ownerId => ({ ownerId, d: outline(ownerId) })) };
  };
  /** A result whose `ownerPaths` are chained on first read; `outline(ownerId)` chains just one. */
  const withOutlines = (result, places) => {
    const { outline, all } = outlines(places);
    Object.defineProperty(result, 'ownerPaths', { enumerable: true, get: all });
    Object.defineProperty(result, 'outline', { value: outline });
    return result;
  };

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
      const { owners, key } = ownersOf(ownership);
      if (key === layersKey) return layersResult;
      const places = placesOf(owners), inner = [], outer = [];
      places.forEach((place, group) => {
        if (groups[group].countries.length === 1) return;
        (place.sameOwnerSeam ? inner : outer).push(pathOf(groups[group]));
      });
      layersKey = key;
      layersResult = withOutlines({ coastD: coast(), innerD: inner.join(''), outerD: outer.join('') }, places);
      return layersResult;
    },

    /**
     * Neutral-only edges stay quiet, including neutral coastlines. An edge is
     * an empire perimeter when it meets sea, neutral land or another owner.
     * A boundary shared by countries of the same owner remains an inner seam.
     * Equivalent ownership objects reuse the previous mesh without rebuilding.
     */
    resolve(ownership = {}) {
      const { owners, key } = ownersOf(ownership);
      if (key === previousKey) return previousResult;
      const places = placesOf(owners), internal = [], borders = [];
      places.forEach((place, group) => (place.perimeterOf.length ? borders : internal).push(pathOf(groups[group])));
      previousKey = key;
      previousResult = withOutlines({ internalD: internal.join(''), borderD: borders.join('') }, places);
      return previousResult;
    },
  };
}
