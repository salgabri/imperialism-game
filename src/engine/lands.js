// A country map's lands: the pieces its map draws. The map is cut into sections along its administrative divisions
// (100 on a format-2 map) and each club starts on a group of them. A conquest takes all of the loser's land, and an older
// save is fitted the same way (storage.js fitDomesticCampaign), so a club's starting sections never part: the map draws
// each group as one land, its outline alone, never a line between its own sections. The sections stay the game's
// working units (neighbours, routes, saves, names); they only decide where a land's outline runs.

/**
 * The outline of sections drawn as one: every edge of their rings but those two of them share (one ring runs each way
 * along a shared edge), chained into closed rings. Each edge keeps the way its ring ran, so the outline winds as the
 * sections do, with their land on the same side of every edge: a fill by either rule covers exactly their land, and a
 * stroke draws no line inside it. Where the outline meets itself at a point (two of its sections touching only there),
 * the chain turns as tightly as it can towards the land, so each loop comes out a ring of its own.
 * `ringLists`: each section's rings ([[x, y], …], the closing edge implied), on one grid: points are the same exactly
 * when their "x,y" texts are, as the painted rings are rounded. → [[[x, y], …], …]
 */
export function outlineRings(ringLists) {
  const points = [], ids = new Map();
  const idOf = point => {
    const key = `${point[0]},${point[1]}`;
    let id = ids.get(key);
    if (id === undefined) { id = points.length; points.push(point); ids.set(key, id); }
    return id;
  };
  // Directed edges "from>to" → how many run that way, less those a run the other way cancelled. The sum of the rings'
  // signed areas says which side of their edges the land lies on.
  const edges = new Map();
  let twiceArea = 0;
  for (const rings of ringLists) for (const ring of rings || []) {
    if (!ring || ring.length < 2) continue;
    const ringIds = ring.map(idOf);
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      twiceArea += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
      const from = ringIds[j], to = ringIds[i];
      if (from === to) continue;
      const back = `${to}>${from}`, against = edges.get(back);
      if (against) edges.set(back, against - 1);
      else edges.set(`${from}>${to}`, (edges.get(`${from}>${to}`) || 0) + 1);
    }
  }
  const exits = new Map();
  for (const [key, count] of edges) {
    if (!count) continue;
    const cut = key.indexOf('>'), from = Number(key.slice(0, cut)), to = Number(key.slice(cut + 1));
    let list = exits.get(from);
    if (!list) exits.set(from, list = []);
    for (let k = 0; k < count; k++) list.push(to);
  }
  // Land on the right of every edge (a negative area, as the shipped maps wind) is hugged by the sharpest right turn.
  const hug = twiceArea < 0 ? 1 : -1;
  const turn = (from, at, to) => {
    const a = points[from], b = points[at], c = points[to];
    const dx = b[0] - a[0], dy = b[1] - a[1], ex = c[0] - b[0], ey = c[1] - b[1];
    return hug * Math.atan2(dx * ey - dy * ex, dx * ex + dy * ey);
  };
  const rings = [];
  for (const [start, leaving] of exits) {
    while (leaving.length) {
      const ring = [start];
      let previous = start, at = leaving.shift();
      while (at !== start) {
        ring.push(at);
        const options = exits.get(at);
        // Only broken input (rings that do not wind alike) leaves a run open; it is kept as it is.
        if (!options?.length) break;
        let pick = 0;
        for (let k = 1; k < options.length; k++) if (turn(previous, at, options[k]) < turn(previous, at, options[pick])) pick = k;
        [previous, at] = [at, options.splice(pick, 1)[0]];
      }
      rings.push(ring.map(id => points[id]));
    }
  }
  return rings;
}

/** Rings as SVG path data, as the map's sections are drawn. */
export const ringsPath = rings => rings.map(ring => `M${ring.map(point => `${point[0]},${point[1]}`).join('L')}Z`).join('');

function unionBox(boxes) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const box of boxes) {
    if (!box) continue;
    x0 = Math.min(x0, box.x); y0 = Math.min(y0, box.y);
    x1 = Math.max(x1, box.x + box.w); y1 = Math.max(y1, box.y + box.h);
  }
  return Number.isFinite(x0) ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

/**
 * A map's lands in the order `ids` (its sections) first reaches each: every group of sections in `groups` is one land,
 * named by its first section (a club's starting group lists its home first), and every other section is a land of its
 * own. `paths`: the fitted sections' paths ({ d, labelRings, bbox }); a section with none is left out. A land of one
 * section is that section's rings, path and box; a group's rings are its outline (outlineRings) and its box covers its
 * sections' boxes. → frozen [{ id, sections, rings, d, bbox }]
 */
export function mapLands(ids, paths, groups = []) {
  const groupOf = new Map();
  for (const group of groups) {
    const members = (group || []).filter(id => paths[id] && !groupOf.has(id));
    for (const id of members) groupOf.set(id, members);
  }
  const lands = [], placed = new Set();
  for (const id of ids) {
    const path = paths[id];
    if (!path || placed.has(id)) continue;
    const members = groupOf.get(id) || [id];
    for (const member of members) placed.add(member);
    if (members.length === 1) {
      lands.push(Object.freeze({ id, sections: Object.freeze([id]), rings: path.labelRings || [], d: path.d, bbox: path.bbox }));
      continue;
    }
    const rings = outlineRings(members.map(member => paths[member].labelRings));
    lands.push(Object.freeze({ id: members[0], sections: Object.freeze(members), rings, d: ringsPath(rings),
      bbox: unionBox(members.map(member => paths[member].bbox)) }));
  }
  return Object.freeze(lands);
}
