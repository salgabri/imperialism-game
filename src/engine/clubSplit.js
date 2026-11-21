// A country map with fewer clubs (docs/design/domestic-campaigns.md, "Choosing the number of clubs"). The build shares a
// country's 100 sections among its top clubs (up to 100 of them); a player who wants fewer, say Spain's 20, gets a map
// worked out here when it loads, from the same file: the first 20 of its clubs in the map's own order, each starting on
// the land it holds on the full map plus a share of the land of the clubs left out, the sections shared as evenly as
// the land allows. The result is a map file like the build's (format 2, its own id, version, section ids and colours),
// so the loader, the campaign and saves treat it as any other. Pure and deterministic: the same file and count give the
// same map in every browser.

import { EARTH_RADIUS_KM, arcBorders, topologyArcs } from './geo.js';
import { colourSections } from './colour.js';

/** The fewest clubs a map may be cut to: a campaign needs two. */
export const SPLIT_MIN_CLUBS = 2;
// The rules' version, part of every cut map's version: a change here moves saved campaigns club by club, as a rebuilt
// map does (engine/storage.js fitDomesticCampaign).
export const SPLIT_RULES = 1;

// A country map's id (today's '724', an earlier season's '724y2016') and the count: '724c20', '724y2016c20'.
const SPLIT_ID = /^([0-9A-Z]{3}(?:y\d{4})?)c([1-9]\d?)$/;

/** A cut map's id → `{ base, clubs }` ('724c20' → { base: '724', clubs: 20 }), else null. */
export function parseSplitId(id) {
  const match = SPLIT_ID.exec(String(id ?? ''));
  return match ? { base: match[1], clubs: Number(match[2]) } : null;
}

/** The id of a country map (`base`) cut to `clubs` clubs. */
export const splitMapId = (base, clubs) => `${base}c${clubs}`;

/** The map file a map id reads: a cut map's base ('724c20' → '724'), else the id itself. */
export const mapFileId = id => parseSplitId(id)?.base ?? id;

const KM_PER_DEGREE = EARTH_RADIUS_KM * Math.PI / 180;
const wrap = lon => ((lon + 180) % 360 + 360) % 360 - 180;
// How far a club may reach for a section, as a multiple of the distance from the nearest kept club's own land (grow).
const REACH = 1.5;
// How many points of each section's coast measure the distances between landmasses.
const COAST_SAMPLES = 48;
// Plane coordinates are kept to a metre, so the last bit of a float cannot change a choice between browsers.
const metre = v => Math.round(v * 1000) / 1000;

/**
 * Cut a country map's file (`raw`, format 2) to its first `clubs` clubs, as the map `id` ('724c20'). → a new file of the
 * same shape: the kept clubs, their groups renumbered `<id>-001` … in club order (each club's home section first, then
 * the others outward from its home), new colours and a version of its own. Throws when the count is out of range.
 */
export function splitDomestic(raw, clubs, id = splitMapId(raw?.id, clubs)) {
  const total = raw?.clubs?.length ?? 0;
  if (!Number.isInteger(clubs) || clubs < SPLIT_MIN_CLUBS || clubs >= total) {
    throw new Error(`Domestic map ${id}: ${raw?.name ?? raw?.id} has ${total} clubs, so it cannot be cut to ${clubs}`);
  }
  const graph = sectionGraph(raw);
  const kept = raw.clubs.slice(0, clubs);
  const groups = shareSections(graph, kept.map(club => graph.groupOf(club)));
  // Each group from its home outward, as the build orders them.
  const ordered = groups.map((group, c) => {
    const [hx, hy] = graph.pointOf(kept[c]);
    const away = s => Math.hypot(graph.cx[s] - hx, graph.cy[s] - hy);
    const [home, ...rest] = group;
    return [home, ...rest.sort((a, b) => away(a) - away(b) || a - b)];
  });
  const order = ordered.flat();
  const newId = new Map(order.map((section, k) => [section, `${id}-${String(k + 1).padStart(3, '0')}`]));
  const colours = colourSections(clubNeighbours(graph, ordered), { crowdedFirst: true });
  const { topology, clubs: _all, version: baseVersion, ...meta } = raw;
  const geometries = topology.objects.sections.geometries;
  const doc = {
    ...meta, id, version: '',
    // The file the map is cut from, its build and how many clubs it holds.
    base: raw.id, baseVersion, baseClubs: total,
    topology: { ...topology, objects: { ...topology.objects, sections: { ...topology.objects.sections,
      geometries: order.map(section => ({ ...geometries[section], id: newId.get(section) })) } } },
    clubs: kept.map((club, c) => ({ ...club, col: colours[c], section: newId.get(ordered[c][0]),
      sections: ordered[c].map(section => newId.get(section)) })),
  };
  doc.version = `${id}-${hash8(JSON.stringify([baseVersion, clubs, SPLIT_RULES, ordered]))}`;
  return doc;
}

/** FNV-1a, 32 bits, as eight hex digits. */
function hash8(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * A map file's sections as a graph, in a plane true to scale (km): each section's area and centroid, its land borders
 * (shared arcs, with their lengths), its landmass (sections joined by land) and its coast (its arcs no other section
 * uses), and the clubs' groups and home points by section index.
 */
function sectionGraph(raw) {
  const topo = raw.topology;
  const geometries = topo.objects.sections.geometries;
  const n = geometries.length;
  const index = new Map(geometries.map((g, i) => [g.id, i]));
  const arcs = topologyArcs(topo);
  const { lon0, lat0 } = raw.projection;
  const kx = Math.round(Math.cos(lat0 * Math.PI / 180) * 1e9) / 1e9 * KM_PER_DEGREE;
  const plane = ([lon, lat]) => [wrap(lon - lon0) * kx, -lat * KM_PER_DEGREE];
  const planeArcs = arcs.map(arc => arc.map(plane));
  const ringOf = indices => {
    const points = [];
    indices.forEach((i, k) => {
      const arc = planeArcs[i < 0 ? ~i : i];
      const skip = k > 0 ? 1 : 0;
      if (i < 0) for (let p = arc.length - 1 - skip; p >= 0; p--) points.push(arc[p]);
      else for (let p = skip; p < arc.length; p++) points.push(arc[p]);
    });
    return points;
  };
  const area = new Float64Array(n), cx = new Float64Array(n), cy = new Float64Array(n);
  const owners = {};
  geometries.forEach((g, s) => {
    const polygons = g.type === 'Polygon' ? [g.arcs] : g.arcs;
    let total = 0, mx = 0, my = 0;
    for (const polygon of polygons) {
      polygon.forEach((ring, r) => {
        for (const i of ring) (owners[i < 0 ? ~i : i] ||= []).push(s);
        const { a, x, y } = ringMoments(ringOf(ring));
        // The first ring is the outline, the others holes.
        const sign = r === 0 ? 1 : -1;
        total += sign * a;
        mx += sign * a * x;
        my += sign * a * y;
      });
    }
    const [fx, fy] = ringOf(polygons[0][0])[0];
    area[s] = metre(Math.max(total, 0));
    cx[s] = metre(total > 0 ? mx / total : fx);
    cy[s] = metre(total > 0 ? my / total : fy);
  });
  // Land borders: arcs two sections share. Lengths in km (geo.js lineLength measures degrees of latitude).
  const { borders } = arcBorders(arcs, owners);
  const adj = Array.from({ length: n }, () => new Map());
  for (const [s, row] of Object.entries(borders)) {
    for (const [t, length] of row) if (length > 0) adj[Number(s)].set(Number(t), length * KM_PER_DEGREE);
  }
  const landmass = components(n, s => adj[s].keys());
  // Coast: the arcs only one section uses (the sea, or the edge of the map's land), each a run of points.
  const coast = Array.from({ length: n }, () => []);
  for (const [ai, list] of Object.entries(owners)) if (list.length === 1) coast[list[0]].push(planeArcs[ai]);
  const groupOf = club => (club.sections || [club.section]).map(id => index.get(id));
  const pointOf = club => (club.home ? plane(club.home).map(metre) : [cx[index.get(club.section)], cy[index.get(club.section)]]);
  return { n, area, cx, cy, adj, landmass, coast, groupOf, pointOf, focus: raw.focus, plane };
}

/** A ring's unsigned area and centroid (shoelace, about its first point for precision). */
function ringMoments(points) {
  const [ox, oy] = points[0] || [0, 0];
  let a = 0, x = 0, y = 0;
  for (let i = 0; i < points.length; i++) {
    const [x0, y0] = points[i], [x1, y1] = points[(i + 1) % points.length];
    const px = x0 - ox, py = y0 - oy, qx = x1 - ox, qy = y1 - oy;
    const cross = px * qy - qx * py;
    a += cross;
    x += (px + qx) * cross;
    y += (py + qy) * cross;
  }
  if (a === 0) return { a: 0, x: ox, y: oy };
  return { a: Math.abs(a) / 2, x: ox + x / (3 * a), y: oy + y / (3 * a) };
}

/** Connected components of `n` nodes over `next` (node → neighbours): a component index per node. */
function components(n, next) {
  const of = new Int32Array(n).fill(-1);
  let count = 0;
  for (let s = 0; s < n; s++) {
    if (of[s] >= 0) continue;
    const stack = [s];
    of[s] = count;
    while (stack.length) {
      const t = stack.pop();
      for (const u of next(t)) if (of[u] < 0) { of[u] = count; stack.push(u); }
    }
    count++;
  }
  return of;
}

/**
 * Share every section among the kept clubs (`pinned`: each one's group on the full map, home first) → each club's
 * sections, home first. Land is shared as the build shares it ("Balanced land"), with the sections as the pieces:
 *
 * 1. Regions. A landmass with a kept club is a region (with any other landmass the club's group reaches); one with none
 *    joins the nearest landmass across the water, by a link between their nearest sections.
 * 2. Targets. Each club's natural land V (every section to the club whose own land is nearest, grown so each club's land
 *    is one piece) and its fair share F of its region's land give its target, F^0.7 · V^0.3 scaled to the region, never
 *    less than the land it holds already: cities stay cities, a club in a crowd taking less than an even share.
 * 3. Growth. Each club keeps its own land and grows from it towards its target, in rounds: in each, every club short of
 *    its target takes one section it borders, those with the fewest to choose from first (so a club its neighbours
 *    could shut in takes its way out first), the nearest within its reach. Land no club with room reaches goes to
 *    the nearest club bordering it.
 * 4. Passes. Neighbours hand land over (a section on their border, with any land it alone joins to the giver's) wherever
 *    that brings both nearer their targets, then trade sections wherever both lands get more compact without either
 *    straying further from its target.
 */
function shareSections(graph, pinned) {
  const { n, area, cx, cy } = graph;
  const clubs = pinned.length;
  const owner = new Int32Array(n).fill(-1);
  const fixed = new Uint8Array(n);
  pinned.forEach((group, c) => { for (const s of group) { owner[s] = c; fixed[s] = 1; } });
  const centre = pinned.map(group => {
    let a = 0, x = 0, y = 0;
    for (const s of group) { const w = Math.max(area[s], 1e-3); a += w; x += w * cx[s]; y += w * cy[s]; }
    return [x / a, y / a];
  });
  const away = (s, c) => (cx[s] - centre[c][0]) ** 2 + (cy[s] - centre[c][1]) ** 2;
  const cost = (s, c) => area[s] * away(s, c);
  const { region, links } = regionsOf(graph, pinned);
  // Neighbours by land, and across the water where a landmass with no club joins its region.
  const near = graph.adj.map((row, s) => [...row.keys(), ...(links.get(s) || [])].sort((a, b) => a - b));
  const land = new Float64Array(clubs);
  for (let s = 0; s < n; s++) if (owner[s] >= 0) land[owner[s]] += area[s];
  const ctx = { n, area, near, owner, fixed, cost, land };

  // Natural land: each section to the nearest club's own land, grown so each club's land is one piece.
  const natural = Int32Array.from(owner);
  grow(ctx, natural, (s, c) => away(s, c), () => true);
  const targets = new Float64Array(clubs);
  for (const r of [...new Set(region)].sort((a, b) => a - b)) {
    const members = [];
    for (let c = 0; c < clubs; c++) if (region[pinned[c][0]] === r) members.push(c);
    if (!members.length) continue;
    let total = 0;
    for (let s = 0; s < n; s++) if (region[s] === r) total += area[s];
    const v = new Float64Array(clubs);
    for (let s = 0; s < n; s++) if (natural[s] >= 0 && region[s] === r) v[natural[s]] += area[s];
    const fair = total / members.length;
    // F^0.7 · V^0.3, scaled to the region's land; a club already holding more keeps it, the others scaled down.
    let raw = 0;
    for (const c of members) { targets[c] = fair ** 0.7 * Math.max(v[c], 1e-6) ** 0.3; raw += targets[c]; }
    for (const c of members) targets[c] *= total / raw;
    for (let guard = 0; guard < members.length; guard++) {
      const held = members.filter(c => land[c] >= targets[c]);
      const heldLand = held.reduce((sum, c) => sum + land[c], 0);
      const rest = members.filter(c => land[c] < targets[c]);
      const restTarget = rest.reduce((sum, c) => sum + targets[c], 0);
      held.forEach(c => { targets[c] = land[c]; });
      if (!rest.length || restTarget <= 0) break;
      const scale = (total - heldLand) / restTarget;
      rest.forEach(c => { targets[c] *= scale; });
      if (rest.every(c => land[c] < targets[c])) break;
    }
  }
  ctx.targets = targets;

  // Growth towards the targets, then whatever is left to the nearest club bordering it.
  grow(ctx, owner, (s, c) => away(s, c), (s, c) => land[c] + area[s] / 2 <= targets[c], true);
  grow(ctx, owner, (s, c) => away(s, c), () => true);
  handOverLand(ctx);
  polish(ctx);
  const groups = pinned.map(group => [group[0]]);
  for (let s = 0; s < n; s++) if (owner[s] >= 0 && s !== pinned[owner[s]][0]) groups[owner[s]].push(s);
  return groups;
}

/**
 * Grow clubs' land (`owner`, updated, with `ctx.land` when it is the campaign's) over free sections (owner -1), in
 * rounds: in each, every club that may take a section it borders (`may(s, c)`) takes one, the clubs with the fewest
 * such sections first, then the furthest from their targets, then the strongest, each the nearest (`distance`) within
 * reach (REACH times as far as from the nearest club's own land, both padded by a typical section's width), else the
 * least stretched. Without `rounds`, simply the nearest section to the nearest club, one at a time (natural land).
 */
function grow(ctx, owner, distance, may, rounds = false) {
  const { n, near, area, targets } = ctx;
  const counted = owner === ctx.owner;
  const clubs = Math.max(...owner) + 1;
  if (!rounds) {
    for (;;) {
      let best = null;
      for (let s = 0; s < n; s++) {
        if (owner[s] >= 0) continue;
        for (const t of near[s]) {
          const c = owner[t];
          if (c < 0 || !may(s, c)) continue;
          const d = distance(s, c);
          if (!best || d < best[0] || (d === best[0] && (s < best[1] || (s === best[1] && c < best[2])))) best = [d, s, c];
        }
      }
      if (!best) return;
      owner[best[1]] = best[2];
      if (counted) ctx.land[best[2]] += area[best[1]];
    }
  }
  const sorted = [...area].sort((a, b) => a - b);
  const pad = Math.sqrt(sorted[n >> 1] || 0);
  const nearest = Float64Array.from({ length: n }, (_, s) => {
    let d = Infinity;
    for (let c = 0; c < clubs; c++) d = Math.min(d, distance(s, c));
    return Math.sqrt(d);
  });
  const stretch = (s, c) => (Math.sqrt(distance(s, c)) + pad) / (nearest[s] + pad);
  const options = c => {
    const out = new Set();
    for (let s = 0; s < n; s++) if (owner[s] === c) for (const t of near[s]) if (owner[t] < 0 && may(t, c)) out.add(t);
    const all = [...out].sort((a, b) => a - b);
    return { all, within: all.filter(s => stretch(s, c) <= REACH) };
  };
  for (let round = 0; round < n; round++) {
    const turns = [];
    for (let c = 0; c < clubs; c++) {
      const { within, all } = options(c);
      if (all.length) turns.push([within.length ? 0 : 1, within.length || all.length, ctx.land[c] / Math.max(targets[c], 1e-9), c]);
    }
    if (!turns.length) return;
    turns.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2] || a[3] - b[3]);
    for (const [, , , c] of turns) {
      const { within, all } = options(c);
      if (!all.length) continue;
      const pick = within.length
        ? within.reduce((a, b) => (distance(b, c) < distance(a, c) ? b : a))
        : all.reduce((a, b) => (stretch(b, c) < stretch(a, c) ? b : a));
      owner[pick] = c;
      ctx.land[c] += area[pick];
    }
  }
}

/**
 * Regions: landmasses joined where a kept club's group spans several (each of its sections there linked to its home),
 * then each landmass with no kept club joined to the nearest landmass across the water (nearest pairs first, linked by
 * their nearest sections), until every region holds a club. The links join landmasses as a tree does, never two ways
 * round, so land joined by land and links lies in one piece on each landmass. → `{ region }`, a region per section,
 * and `links`, section → the sections across the water it is linked to.
 */
function regionsOf(graph, pinned) {
  const { n, landmass } = graph;
  const masses = Math.max(...landmass) + 1;
  const parent = Int32Array.from({ length: masses }, (_, i) => i);
  const find = i => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const held = new Uint8Array(masses);
  const join = (a, b) => {
    a = find(a); b = find(b);
    if (a === b) return;
    const [keep, drop] = a < b ? [a, b] : [b, a];
    parent[drop] = keep;
    held[keep] = held[keep] || held[drop];
  };
  const links = new Map();
  const link = (s, t) => {
    if (!links.has(s)) links.set(s, []);
    if (!links.has(t)) links.set(t, []);
    links.get(s).push(t);
    links.get(t).push(s);
  };
  for (const group of pinned) {
    held[find(landmass[group[0]])] = 1;
    for (const s of group) {
      if (find(landmass[s]) === find(landmass[group[0]])) continue;
      join(landmass[s], landmass[group[0]]);
      link(s, group[0]);
    }
  }
  if ([...Array(masses).keys()].some(m => !held[find(m)])) {
    for (const [, a, b, s, t] of massDistances(graph, masses)) {
      const ra = find(a), rb = find(b);
      if (ra === rb || (held[ra] && held[rb])) continue;
      join(ra, rb);
      link(s, t);
    }
  }
  return { region: Int32Array.from({ length: n }, (_, s) => find(landmass[s])), links };
}

/**
 * The distance between every two landmasses, across the water: their nearest coast points, each section's coast taken
 * at up to COAST_SAMPLES points (enough to tell which shore is nearest). → [[km, a, b, s, t] …] (landmasses a < b,
 * through their sections s and t), nearest first. Sections' boxes rule out most pairs first.
 */
function massDistances(graph, masses) {
  const { n, coast, cx, cy, landmass } = graph;
  const points = Array.from({ length: n }, (_, s) => {
    const all = coast[s].flat();
    if (!all.length) return [[cx[s], cy[s]]];
    const step = Math.max(1, Math.ceil(all.length / COAST_SAMPLES));
    return all.filter((_, i) => i % step === 0);
  });
  const boxes = points.map(list => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of list) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    return [x0, y0, x1, y1];
  });
  const gap = (p, q) => Math.hypot(Math.max(0, p[0] - q[2], q[0] - p[2]), Math.max(0, p[1] - q[3], q[1] - p[3]));
  const pairs = [];
  for (let s = 0; s < n; s++) for (let t = s + 1; t < n; t++) if (landmass[s] !== landmass[t]) pairs.push([gap(boxes[s], boxes[t]), s, t]);
  pairs.sort((p, q) => p[0] - q[0] || p[1] - q[1] || p[2] - q[2]);
  const best = new Map();
  for (const [lower, s, t] of pairs) {
    const [a, b, sa, sb] = landmass[s] < landmass[t] ? [landmass[s], landmass[t], s, t] : [landmass[t], landmass[s], t, s];
    const key = a * masses + b;
    if (best.has(key) && lower >= best.get(key)[0]) continue;
    let d = Infinity;
    for (const [x, y] of points[s]) for (const [u, v] of points[t]) d = Math.min(d, Math.hypot(x - u, y - v));
    if (!best.has(key) || d < best.get(key)[0]) best.set(key, [metre(d), a, b, sa, sb]);
  }
  return [...best.values()].sort((p, q) => p[0] - q[0] || p[1] - q[1] || p[2] - q[2]);
}

/** Whether a club's land (`owner`) is in one piece, joined by land and by the links across the water. */
function whole(ctx, club, owner = ctx.owner) {
  const { n, near } = ctx;
  let first = -1, count = 0;
  for (let s = 0; s < n; s++) if (owner[s] === club) { count++; if (first < 0) first = s; }
  if (count < 2) return true;
  const seen = new Uint8Array(n), stack = [first];
  seen[first] = 1;
  let reached = 1;
  while (stack.length) {
    const t = stack.pop();
    for (const u of near[t]) if (!seen[u] && owner[u] === club) { seen[u] = 1; reached++; stack.push(u); }
  }
  return reached === count;
}

/**
 * What a club hands over with section `s`: `s` itself and any of its land that `s` alone joins to the land it keeps
 * (the piece holding the sections it started on, else its largest), so both clubs' land stays in one piece.
 * → [section …], or null when `s` is a section its club started on.
 */
function handOver(ctx, s) {
  const { n, near, owner, fixed, area } = ctx;
  const club = owner[s];
  if (club < 0 || fixed[s]) return null;
  const seen = new Uint8Array(n), pieces = [];
  seen[s] = 1;
  for (const start of near[s]) {
    if (seen[start] || owner[start] !== club) continue;
    const piece = [start], stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const u = stack.pop();
      for (const v of near[u]) if (!seen[v] && owner[v] === club) { seen[v] = 1; piece.push(v); stack.push(v); }
    }
    pieces.push(piece);
  }
  if (pieces.length < 2) return [s];
  const weight = piece => piece.reduce((sum, t) => sum + area[t], 0);
  const keep = pieces.find(piece => piece.some(t => fixed[t])) || pieces.reduce((a, b) => (weight(b) > weight(a) ? b : a));
  return [s, ...pieces.filter(piece => piece !== keep).flat()];
}

/** How far a club's land is from its target, as the square of the difference over the target. */
const strain = (ctx, c, land) => (land - ctx.targets[c]) ** 2 / Math.max(ctx.targets[c], 1e-9);

/**
 * Land handed between neighbours wherever that brings both nearer their targets: a section on their border, with any
 * land that section alone joins to the giver's (handOver), the move that helps most first (the two clubs' strain falls
 * most), and of equals the one costing least compactness.
 */
function handOverLand(ctx) {
  const { n, near, owner, cost, area, land, targets } = ctx;
  for (let guard = 0; guard < 4 * n; guard++) {
    let best = null;
    for (let s = 0; s < n; s++) {
      const g = owner[s];
      if (g < 0) continue;
      const receivers = [...new Set(near[s].map(t => owner[t]).filter(r => r >= 0 && r !== g))].sort((x, y) => x - y);
      if (!receivers.length) continue;
      const list = handOver(ctx, s);
      if (!list) continue;
      const moved = list.reduce((sum, t) => sum + area[t], 0);
      for (const r of receivers) {
        const gain = strain(ctx, g, land[g]) + strain(ctx, r, land[r]) - strain(ctx, g, land[g] - moved) - strain(ctx, r, land[r] + moved);
        if (!(gain > 1e-6 * (targets[g] + targets[r]))) continue;
        const worse = list.reduce((sum, t) => sum + cost(t, r) - cost(t, g), 0);
        if (!best || gain > best.gain || (gain === best.gain && worse < best.worse)) best = { gain, worse, list, g, r, moved };
      }
    }
    if (!best) return;
    for (const t of best.list) owner[t] = best.r;
    land[best.g] -= best.moved;
    land[best.r] += best.moved;
  }
}

/**
 * More compact land: a section moves to a neighbouring club, or two neighbours trade a section each, wherever the two
 * lands get more compact together (each section's area times its squared distance from its club's own land, summed,
 * falls by more than a thousandth), both stay in one piece and neither strays further from its target than it was, or
 * than a sixth of it. The change that helps most first, a few passes, until nothing helps.
 */
function polish(ctx) {
  const { n, near, owner, fixed, cost, area, land, targets } = ctx;
  const off = (c, value) => Math.abs(value - targets[c]) / Math.max(targets[c], 1e-9);
  const fits = (c, value) => off(c, value) <= Math.max(off(c, land[c]), 1 / 6) + 1e-12;
  const holds = (changes, a, b) => {
    const old = changes.map(([s]) => owner[s]);
    for (const [s, c] of changes) owner[s] = c;
    const ok = whole(ctx, a) && whole(ctx, b);
    changes.forEach(([s], i) => { owner[s] = old[i]; });
    return ok;
  };
  for (let pass = 0; pass < 8; pass++) {
    let better = false;
    for (let s = 0; s < n; s++) {
      const a = owner[s];
      if (a < 0 || fixed[s]) continue;
      const others = [...new Set(near[s].map(t => owner[t]).filter(b => b >= 0 && b !== a))].sort((x, y) => x - y);
      for (const b of others) {
        const options = [];
        const moveGain = cost(s, a) - cost(s, b);
        if (moveGain > 1e-3 * cost(s, a) && fits(a, land[a] - area[s]) && fits(b, land[b] + area[s])) options.push({ gain: moveGain, u: -1 });
        // Trades: s for a section u of b's that borders a's land.
        const seen = new Set();
        for (let x = 0; x < n; x++) {
          if (owner[x] !== a || x === s) continue;
          for (const u of near[x]) {
            if (owner[u] !== b || fixed[u] || seen.has(u)) continue;
            seen.add(u);
            const gain = cost(s, a) + cost(u, b) - cost(s, b) - cost(u, a);
            const change = area[u] - area[s];
            if (gain > 1e-3 * (cost(s, a) + cost(u, b)) && fits(a, land[a] + change) && fits(b, land[b] - change)) options.push({ gain, u });
          }
        }
        options.sort((x, y) => y.gain - x.gain || x.u - y.u);
        const chosen = options.find(option => holds(option.u < 0 ? [[s, b]] : [[s, b], [option.u, a]], a, b));
        if (!chosen) continue;
        owner[s] = b;
        land[a] -= area[s];
        land[b] += area[s];
        if (chosen.u >= 0) {
          owner[chosen.u] = a;
          land[b] -= area[chosen.u];
          land[a] += area[chosen.u];
        }
        better = true;
        break;
      }
    }
    if (!better) return;
  }
}

/**
 * Club neighbours for the colours: clubs whose groups share a border, or face each other across water (coasts within
 * about 3 px of the opening frame, at least 1 km). → club index → sorted neighbour indices.
 */
function clubNeighbours(graph, groups) {
  const { n, adj, coast, focus, plane } = graph;
  const clubOf = new Int32Array(n).fill(-1);
  groups.forEach((group, c) => { for (const s of group) clubOf[s] = c; });
  const near = groups.map(() => new Set());
  const link = (a, b) => { if (a !== b && a >= 0 && b >= 0) { near[a].add(b); near[b].add(a); } };
  for (let s = 0; s < n; s++) for (const t of adj[s].keys()) link(clubOf[s], clubOf[t]);
  // The opening frame's scale: 960 × 540 px around the focus.
  const [x0, y0] = plane([focus[0], focus[3]]), [x1, y1] = plane([focus[2], focus[1]]);
  const pxPerKm = Math.min(960 / Math.max(Math.abs(x1 - x0), 1e-6), 540 / Math.max(Math.abs(y1 - y0), 1e-6));
  const reach = Math.max(1, 3 / pxPerKm);
  const cells = new Map();
  const cellOf = (x, y) => `${Math.floor(x / reach)},${Math.floor(y / reach)}`;
  for (let s = 0; s < n; s++) {
    for (const run of coast[s]) {
      for (const [x, y] of densify(run, reach / 2)) {
        const key = cellOf(x, y);
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push([x, y, s]);
      }
    }
  }
  for (const [key, points] of cells) {
    const [i, j] = key.split(',').map(Number);
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
      const other = cells.get(`${i + di},${j + dj}`);
      if (!other) continue;
      for (const [x, y, s] of points) for (const [u, v, t] of other) {
        if (s < t && clubOf[s] !== clubOf[t] && !adj[s].has(t) && Math.hypot(x - u, y - v) <= reach) link(clubOf[s], clubOf[t]);
      }
    }
  }
  return near.map(set => [...set].sort((a, b) => a - b));
}

/** A run of points with more between them, so no two in a row are farther apart than `step` (km). */
function densify(points, step) {
  const out = [];
  for (let i = 0; i < points.length; i++) {
    out.push(points[i]);
    const next = points[i + 1];
    if (!next) continue;
    const d = Math.hypot(next[0] - points[i][0], next[1] - points[i][1]);
    for (let k = 1; k * step < d; k++) {
      out.push([points[i][0] + (next[0] - points[i][0]) * k * step / d, points[i][1] + (next[1] - points[i][1]) * k * step / d]);
    }
  }
  return out;
}
