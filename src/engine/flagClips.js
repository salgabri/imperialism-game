// Flags mode draws each region's banner (FlagArt, in the map's defs) through the land it flies over: WorldMap clips a
// <use> of the banner to that land (README §Map rendering). This module says which clip paths a region's land takes:
// rather than one per part (an island, a mainland with its lakes), a territory's small parts that lie close together
// share one path; a large part keeps its own (GROUP_VERTICES, SPREAD). A World War board then draws about 700 banner
// copies instead of about 1,300. Each <use> is a copy of its banner that the browser builds, lays out and paints
// again, so the first Flags view and every later re-render of the banners cost less.
//
// A joined path covers exactly the land its parts' own paths covered between them. A clip path fills by the nonzero
// rule: a point is inside when the windings of the rings around it add up to anything but zero. Inside one part they
// add up to one sign, or to zero (a lake); outside a part's box they add up to zero. So where at most one part of the
// path is around a point, the joined path decides it as that part's own path did. Only parts whose boxes meet can
// both be around a point, and there they could cancel out if they wound opposite ways, so such parts join only when
// they wind the same way. A part that winds the other way, or could wind both ways inside itself, keeps a path of its
// own. Every path is its parts' own path data, put end to end.
//
// The clips are kept per region object: a region that survives a conquest unchanged is handed back as the same object
// (flagRegions.js), so only the regions a conquest makes are joined again.

const CLIPS = new WeakMap(); // region → [{ countryId, d }]

// How far a joined path may reach. The browser rasterises a clip path in every map tile its box touches, all of its
// vertices each time: joined into its mainland's path, Canada's arctic islands were drawn again in every tile of the
// mainland. With every part of a territory in one path, Chrome's raster threads worked about a third longer while the
// map was panned and zoomed (headless Chrome, 2026-11-10). A joined path holds at most GROUP_VERTICES vertices, so a
// large part is never joined, and its box covers at most SPREAD times its parts' boxes added up: then the vertices
// rasterised per tile, counted over the World War board at every zoom, stay within 2% of a path per part.
const GROUP_VERTICES = 250;
const SPREAD = 4;

/** A part's rings as SVG path data, as WorldMap's clip paths draw them. */
export const partPath = part => part.rings.map(ring => 'M' + ring.map(point => point.join(',')).join('L') + 'Z').join('');

function signedArea(ring) {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) sum += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return sum / 2;
}

/** Whether `point` lies inside `ring` (crossings of a ray to the right; a point on the ring's edge may go either way). */
function inside(ring, [x, y]) {
  let odd = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j], b = ring[i];
    if ((a[1] > y) !== (b[1] > y) && x < a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1])) odd = !odd;
  }
  return odd;
}

/** A part's box, its vertices, and the way its land winds: its outer ring's, the largest. */
function shapeOf(part) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, vertices = 0;
  for (const ring of part.rings) {
    vertices += ring.length;
    for (const [x, y] of ring) {
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  const areas = part.rings.map(signedArea);
  let outer = 0;
  for (let i = 1; i < areas.length; i++) if (Math.abs(areas[i]) > Math.abs(areas[outer])) outer = i;
  return { box: { x0, y0, x1, y1 }, vertices, areas, outer, sign: Math.sign(areas[outer]) || 1 };
}

/**
 * Whether a part's winding is its land's sign wherever it is not zero. The parts of the atlases are an outer ring and
 * the rings nested in it (makeCountry), and no ring crosses itself or another. The winding is then one sign when every
 * ring nested in an even number of the part's other rings turns the outer ring's way, and every ring nested in an odd
 * number turns the other way (a lake, an island in a lake).
 */
function oneSign({ rings }, { areas, outer, sign }) {
  return rings.every((ring, i) => {
    if (i === outer) return true;
    let depth = 0;
    for (let j = 0; j < rings.length; j++) if (j !== i && inside(rings[j], ring[0])) depth++;
    return Math.sign(areas[i]) === (depth % 2 ? -sign : sign);
  });
}

// Closed boxes: parts that only touch could both be around a point on their shared edge.
const boxesMeet = (a, b) => a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1;
const area = box => (box.x1 - box.x0) * (box.y1 - box.y0);
const unionBox = (a, b) => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) });

/**
 * The parts in groups small and compact enough to share a path (GROUP_VERTICES, SPREAD), the largest parts first:
 * → lists of indices, in parts order.
 */
function compactGroups(shapes) {
  const order = shapes.map((_, i) => i).sort((i, j) => area(shapes[j].box) - area(shapes[i].box) || i - j);
  const groups = [];
  for (const i of order) {
    const { box, vertices } = shapes[i], size = area(box);
    const group = groups.find(g => g.vertices + vertices <= GROUP_VERTICES && area(unionBox(g.box, box)) <= SPREAD * (g.size + size));
    if (group) { group.members.push(i); group.box = unionBox(group.box, box); group.size += size; group.vertices += vertices; }
    else groups.push({ members: [i], box, size, vertices });
  }
  return groups.map(g => g.members.sort((i, j) => i - j)).sort((a, b) => a[0] - b[0]);
}

/** Parts joined in one path, as the opening comment explains: → that path, plus one per part kept apart. */
function joinGroup(parts, shapes) {
  if (parts.length === 1) return [partPath(parts[0])];
  const meets = parts.map(() => false);
  for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) {
    if (boxesMeet(shapes[i].box, shapes[j].box)) meets[i] = meets[j] = true;
  }
  // The way the joined parts that meet others wind: the first such part's.
  let sign = 0;
  const joined = [], apart = [];
  parts.forEach((part, i) => {
    if (!meets[i] || (oneSign(part, shapes[i]) && (sign ||= shapes[i].sign) === shapes[i].sign)) joined.push(partPath(part));
    else apart.push(partPath(part));
  });
  return joined.length ? [joined.join(''), ...apart] : apart;
}

/** One territory's parts in a region as clip path data: one path per compact group of them. */
function joinParts(parts) {
  if (parts.length === 1) return [partPath(parts[0])];
  const shapes = parts.map(shapeOf);
  return compactGroups(shapes).flatMap(members => joinGroup(members.map(i => parts[i]), members.map(i => shapes[i])));
}

/**
 * A flag region's clip paths: `[{ countryId, d }]`, one per territory it covers and compact group of that territory's
 * parts (in the order its parts list them), plus one for each part that cannot join its group. Kept per region object.
 */
export function regionClips(region) {
  let clips = CLIPS.get(region);
  if (clips) return clips;
  const byTerritory = new Map();
  for (const part of region.parts) {
    const parts = byTerritory.get(part.countryId);
    if (parts) parts.push(part); else byTerritory.set(part.countryId, [part]);
  }
  clips = [];
  for (const [countryId, parts] of byTerritory) for (const d of joinParts(parts)) clips.push({ countryId, d });
  CLIPS.set(region, clips);
  return clips;
}
