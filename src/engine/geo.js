// World geometry: TopoJSON decoding, land adjacency, flat cylindrical projection,
// and the SVG path/graticule/scale-bar bundle the map renders from.

const VIEW_W = 960;
const VIEW_H = 540;
const PAD = 16;
export const EARTH_RADIUS_KM = 6371.0088;
export const PROJECTION_X_SCALE = Math.cos(Math.PI / 6);

// Natural Earth ships three unclaimed shapes with id "-99". They arrive in a stable
// order, so name them rather than letting them collide on one key.
const UNCLAIMED_IDS = ['XCYN', 'KOS', 'XSOL'];

// Equirectangular, standard parallel 30° (degrees -> unit plane, y down).
// A fixed horizontal scale keeps both meridians and parallels straight, without
// globe-like tapering or infinite poles. All rendered and rule geometry shares
// this plane; the 30° parallel balances the world's width against its height.
export function projPt(lon, lat) {
  return [(lon * Math.PI / 180) * PROJECTION_X_SCALE, -lat * Math.PI / 180];
}

export function closestPair(aPts, bPts) {
  let best = null;
  let bd = 1e18;
  for (const a of aPts) {
    for (const b of bPts) {
      const d2 = (a[0] - b[0]) * (a[0] - b[0]) + (a[1] - b[1]) * (a[1] - b[1]);
      if (d2 < bd) {
        bd = d2;
        best = { dist: Math.sqrt(d2), ax: a[0], ay: a[1], bx: b[0], by: b[1] };
      }
    }
  }
  return best;
}

export class WorldGeometry {
  constructor(topo, capitals = {}) {
    const { countries, adjacency } = decodeTopo(topo);
    this.countries = countries;
    /** country id -> Set of ids sharing a land border */
    this.adj = adjacency;

    this.capitals = {};
    for (const c of this.countries) {
      const pt = capitals[c.id];
      if (pt) {
        const anchored = anchorInside(pt, c.polys);
        if (anchored) this.capitals[c.id] = anchored;
      }
    }

    // Lon/lat -> plane is fixed; only the fit transform changes between theatres,
    // so project every ring once and reuse it for each fitTo(). Keep this original
    // cache for fit/rule compatibility; repaired display geometry is separate.
    this.projected = {};
    this.displayProjected = {};
    for (const c of this.countries) {
      this.projected[c.id] = c.polys.map(poly => poly.map(ring => ring.map(pt => projPt(pt[0], pt[1]))));
      this.displayProjected[c.id] = c.polys.map(poly => poly.map(ring =>
        splitAtAntimeridian(ring).map(part => part.map(pt => projPt(pt[0], pt[1])))));
    }

    this.fit = null;
    this.paths = {};
    this.graticule = { d: '', labels: [] };
    this.kmPerUnit = 0;
  }

  /**
   * Frame the map on `fitIds` and rebuild every derived path. Countries outside
   * the set are still drawn — they just do not influence the viewport.
   */
  fitTo(fitIds) {
    const fit = new Set(fitIds);
    let minX = 1e9;
    let minY = 1e9;
    let maxX = -1e9;
    let maxY = -1e9;
    for (const c of this.countries) {
      if (!fit.has(c.id)) continue;
      for (const poly of this.projected[c.id]) {
        for (const ring of poly) {
          for (const q of ring) {
            if (q[0] < minX) minX = q[0];
            if (q[0] > maxX) maxX = q[0];
            if (q[1] < minY) minY = q[1];
            if (q[1] > maxY) maxY = q[1];
          }
        }
      }
    }
    const s = Math.min((VIEW_W - PAD * 2) / (maxX - minX), (VIEW_H - PAD * 2) / (maxY - minY));
    const tx = (VIEW_W - (maxX - minX) * s) / 2 - minX * s;
    const ty = (VIEW_H - (maxY - minY) * s) / 2 - minY * s;
    this.fit = { s, tx, ty };

    this.graticule = this.buildGraticule(s, tx, ty);
    // Equatorial horizontal reference, not geodesic distance at every latitude.
    // Also keeps regional flag grouping in fixed map units, independent of zoom.
    this.kmPerUnit = EARTH_RADIUS_KM / (s * PROJECTION_X_SCALE);
    this.paths = this.buildPaths(s, tx, ty);
    return this;
  }

  buildGraticule(s, tx, ty) {
    const at = (lon, lat) => {
      const q = projPt(lon, lat);
      return (q[0] * s + tx).toFixed(1) + ',' + (q[1] * s + ty).toFixed(1);
    };
    let d = '';
    for (let lon = -180; lon <= 180; lon += 20) {
      const pts = [];
      for (let lat = -85; lat <= 85; lat += 5) pts.push(at(lon, lat));
      d += 'M' + pts.join('L');
    }
    for (let lat = -80; lat <= 80; lat += 20) {
      const pts = [];
      for (let lon = -180; lon <= 180; lon += 5) pts.push(at(lon, lat));
      d += 'M' + pts.join('L');
    }
    const labels = [];
    for (let lat = -60; lat <= 80; lat += 20) {
      const y = projPt(0, lat)[1] * s + ty;
      if (y > 14 && y < VIEW_H - 12) {
        labels.push({ y: y.toFixed(0), text: lat === 0 ? '0°' : Math.abs(lat) + '°' + (lat > 0 ? 'N' : 'S') });
      }
    }
    return { d, labels };
  }

  buildPaths(s, tx, ty) {
    const paths = {};
    for (const c of this.countries) {
      let d = '';
      const labelRings = [];
      const legacy = legacyAnchorMetrics(this.projected[c.id], s, tx, ty);
      let cx = legacy.cx;
      let cy = legacy.cy;
      const bestA = legacy.area;
      let largestPaintedArea = -1;
      let bbox = null;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const poly of this.displayProjected[c.id]) {
        poly.forEach((parts, ri) => {
          for (const part of parts) {
            const seg = part.map(q => [q[0] * s + tx, q[1] * s + ty]);
            if (seg.length < 3) continue;
            d += 'M' + seg.map(q => q[0].toFixed(1) + ',' + q[1].toFixed(1)).join('L') + 'Z';
            // Label containment must use the same split, rounded land that the
            // SVG paints, including holes and disconnected date-line segments.
            labelRings.push(seg.map(([x, y]) => [Number(x.toFixed(1)), Number(y.toFixed(1))]));
            // Include every rendered island/segment in an empire's flag canvas.
            for (const [x, y] of seg) {
              minX = Math.min(minX, x);
              minY = Math.min(minY, y);
              maxX = Math.max(maxX, x);
              maxY = Math.max(maxY, y);
            }
            if (ri !== 0) continue;
            // The visible mainland bounds follow the repaired outer ring. Rule
            // anchors/area below retain the original source-ring calculation.
            const c2 = ringCentroid(seg);
            if (c2 && c2.area > largestPaintedArea && c2.area > 0.01) {
              largestPaintedArea = c2.area;
              bbox = ringBounds(seg);
            }
          }
        });
      }
      if (!bbox) bbox = { x: cx - 2, y: cy - 1.5, w: 4, h: 3 };
      // Small padding around the land covers path coordinates rounded to 0.1,
      // keeping every fill inside one SVG pattern tile (never a repeated flag).
      const fullBounds = Number.isFinite(minX)
        ? { x: minX - 0.1, y: minY - 0.1, w: maxX - minX + 0.2, h: maxY - minY + 0.2 }
        : { ...bbox };

      // Prefer the capital as the country's anchor point; the centroid is only
      // a fallback for shapes with no capital of their own.
      const labelX = cx;
      const labelY = cy;
      const cap = this.capitals[c.id];
      if (cap) {
        const q = projPt(cap[0], cap[1]);
        cx = q[0] * s + tx;
        cy = q[1] * s + ty;
      }
      paths[c.id] = { d, cx, cy, labelX, labelY, area: bestA, bbox, fullBounds, labelRings, hasCapital: !!cap };
    }
    return paths;
  }

  /** Inverse projection: SVG user units -> [lon, lat] degrees. */
  invert(px, py) {
    if (!this.fit) return null;
    const { s, tx, ty } = this.fit;
    const lon = (px - tx) / (s * PROJECTION_X_SCALE) * 180 / Math.PI;
    const lat = (ty - py) / s * 180 / Math.PI;
    // Empty space around the rectangular world isn't another geographic point.
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lon) > 180 + 1e-9 || Math.abs(lat) > 90 + 1e-9) return null;
    return [Math.max(-180, Math.min(180, lon)), Math.max(-90, Math.min(90, lat))];
  }
}

function decodeTopo(topo) {
  const tr = topo.transform;
  const arcs = topo.arcs.map(arc => {
    let x = 0;
    let y = 0;
    return arc.map(p => {
      x += p[0];
      y += p[1];
      return [x * tr.scale[0] + tr.translate[0], y * tr.scale[1] + tr.translate[1]];
    });
  });
  const ringFrom = idxs => {
    let pts = [];
    idxs.forEach((i, k) => {
      let a = i < 0 ? arcs[~i].slice().reverse() : arcs[i];
      if (k > 0) a = a.slice(1); // the shared endpoint is already in pts
      pts = pts.concat(a);
    });
    return pts;
  };

  let unclaimed = 0;
  const countries = [];
  const arcOwners = {};
  for (const g of topo.objects.countries.geometries) {
    let id = g.id == null ? null : String(g.id);
    if (id == null || id === '-99') {
      const names = { 'Kosovo': 'KOS', 'N. Cyprus': 'XCYN', 'Somaliland': 'XSOL' };
      id = names[g.properties?.name] || (g.id == null ? 'X-' + g.properties?.name : UNCLAIMED_IDS[unclaimed] || 'X' + unclaimed);
      unclaimed++;
    }
    const polys = g.type === 'Polygon' ? [g.arcs] : g.arcs;
    for (const p of polys) {
      for (const ring of p) {
        for (const i of ring) {
          const ai = i < 0 ? ~i : i;
          (arcOwners[ai] = arcOwners[ai] || []).push(id);
        }
      }
    }
    countries.push({ id, name: g.properties?.name, polys: polys.map(p => p.map(ringFrom)) });
  }

  // Two countries that reference the same topology arc are separated by that arc,
  // which is exactly a shared land border.
  const adjacency = {};
  for (const ai in arcOwners) {
    const list = arcOwners[ai];
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (list[i] === list[j]) continue;
        (adjacency[list[i]] = adjacency[list[i]] || new Set()).add(list[j]);
        (adjacency[list[j]] = adjacency[list[j]] || new Set()).add(list[i]);
      }
    }
  }
  return { countries, adjacency };
}

const SEAM_EPSILON = 1e-8;
const SEAM_LATITUDE_STEP = 0.5;

function sameGeographicPoint(a, b) {
  const dx = Math.abs(a[0] - b[0]);
  return Math.abs(a[1] - b[1]) <= SEAM_EPSILON && (dx <= SEAM_EPSILON || Math.abs(dx - 360) <= SEAM_EPSILON);
}

function normalizedRing(ring) {
  const points = [];
  for (const point of ring || []) {
    let lon = Number(point[0]), lat = Number(point[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    if (Math.abs(lon - 180) <= SEAM_EPSILON) lon = 180;
    else if (Math.abs(lon + 180) <= SEAM_EPSILON) lon = -180;
    else if (lon < -180 || lon > 180) lon = ((lon + 180) % 360 + 360) % 360 - 180;
    lat = Math.max(-90, Math.min(90, lat));
    const p = [lon, lat];
    if (!points.length || !sameGeographicPoint(points[points.length - 1], p)) points.push(p);
  }
  if (points.length > 1 && sameGeographicPoint(points[0], points[points.length - 1])) points.pop();
  return points;
}

function unwrapRing(points) {
  const result = [[...points[0]]];
  // Include the closing edge. A closed geographic ring can wind once around a
  // pole; its unwrapped last longitude then differs from its first by 360°.
  for (let i = 1; i <= points.length; i++) {
    const point = points[i % points.length];
    let lon = point[0];
    const previous = result[result.length - 1][0];
    while (lon - previous > 180) lon -= 360;
    while (lon - previous < -180) lon += 360;
    result.push([lon, point[1]]);
  }
  return result;
}

function startPolarRingAtSeam(points, direction) {
  const startLon = direction > 0 ? -180 : 180;
  for (let i = 0; i < points.length; i++) {
    if (Math.abs(Math.abs(points[i][0]) - 180) <= SEAM_EPSILON) {
      return [[startLon, points[i][1]], ...points.slice(i + 1), ...points.slice(0, i)];
    }
  }
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    if (Math.abs(b[0] - a[0]) <= 180) continue;
    const endLon = b[0] + (b[0] < a[0] ? 360 : -360);
    const seam = a[0] > 0 ? 180 : -180;
    const lat = a[1] + (seam - a[0]) / (endLon - a[0]) * (b[1] - a[1]);
    return [[startLon, lat], ...points.slice(i + 1), ...points.slice(0, i + 1)];
  }
  return points;
}

function clipLongitude(points, boundary, keepGreater) {
  const result = [];
  const inside = p => keepGreater ? p[0] >= boundary - SEAM_EPSILON : p[0] <= boundary + SEAM_EPSILON;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[j], b = points[i];
    const aInside = inside(a), bInside = inside(b);
    if (aInside !== bInside) {
      const t = (boundary - a[0]) / (b[0] - a[0]);
      result.push([boundary, a[1] + t * (b[1] - a[1])]);
    }
    if (bInside) result.push([...b]);
  }
  return result;
}

function closeAndDensifySeam(points) {
  const clean = [];
  for (const p of points) {
    const previous = clean[clean.length - 1];
    if (!previous || Math.abs(p[0] - previous[0]) > SEAM_EPSILON || Math.abs(p[1] - previous[1]) > SEAM_EPSILON) clean.push(p);
  }
  if (clean.length > 1 && Math.abs(clean[0][0] - clean[clean.length - 1][0]) <= SEAM_EPSILON && Math.abs(clean[0][1] - clean[clean.length - 1][1]) <= SEAM_EPSILON) clean.pop();
  if (clean.length < 3) return null;
  let twiceArea = 0;
  for (let i = 0, j = clean.length - 1; i < clean.length; j = i++) twiceArea += clean[j][0] * clean[i][1] - clean[i][0] * clean[j][1];
  if (Math.abs(twiceArea) < 1e-12) return null;
  const result = [];
  for (let i = 0; i < clean.length; i++) {
    const a = clean[i], b = clean[(i + 1) % clean.length];
    result.push([...a]);
    if (Math.abs(a[0] - b[0]) <= SEAM_EPSILON && Math.abs(Math.abs(a[0]) - 180) <= SEAM_EPSILON) {
      // Keep geographic seam sampling independent of projection and map fit.
      // Every inserted point remains exactly on the straight ±180° map edge.
      const count = Math.ceil(Math.abs(b[1] - a[1]) / SEAM_LATITUDE_STEP);
      for (let j = 1; j < count; j++) result.push([a[0], a[1] + (b[1] - a[1]) * j / count]);
    }
  }
  result.push([...result[0]]);
  return result;
}

/**
 * Cut a closed lon/lat ring at the geographic ±180° seam before projection.
 *
 * Unwrapping and clipping the complete cyclic polygon naturally reconnects its
 * first/last coastline fragments. All introduced closures follow a map seam;
 * no fragment is independently Z-closed back to a distant arbitrary start.
 * Winding is preserved, so outer rings and holes keep SVG nonzero semantics.
 * Returned rings are closed, normalized and seam-densified in geographic space.
 * Polar winding loops (including Natural Earth's Antarctic outer/hole pair)
 * close via their pole, beginning at the seam rather than an interior meridian.
 * The source topology is never modified and the cut is independent of map fit.
 */
export function splitAtAntimeridian(ring) {
  let points = normalizedRing(ring);
  if (points.length < 3) return [];
  let unwrapped = unwrapRing(points);
  const turns = Math.round((unwrapped[unwrapped.length - 1][0] - unwrapped[0][0]) / 360);
  if (turns) {
    points = startPolarRingAtSeam(points, turns);
    unwrapped = unwrapRing(points);
    const pole = points.reduce((sum, point) => sum + point[1], 0) < 0 ? -90 : 90;
    unwrapped.push([unwrapped[unwrapped.length - 1][0], pole], [unwrapped[0][0], pole]);
  } else unwrapped.pop();
  let minLon = Infinity, maxLon = -Infinity;
  for (const point of unwrapped) { minLon = Math.min(minLon, point[0]); maxLon = Math.max(maxLon, point[0]); }
  const firstStrip = Math.floor((minLon + 180) / 360), lastStrip = Math.floor((maxLon + 180) / 360);
  const result = [];
  for (let strip = firstStrip; strip <= lastStrip; strip++) {
    const left = -180 + strip * 360, right = 180 + strip * 360;
    let clipped = unwrapped;
    if (minLon < left - SEAM_EPSILON) clipped = clipLongitude(clipped, left, true);
    if (maxLon > right + SEAM_EPSILON) clipped = clipLongitude(clipped, right, false);
    const shifted = clipped.map(([lon, lat]) => [Math.max(-180, Math.min(180, lon - strip * 360)), lat]);
    const closed = closeAndDensifySeam(shifted);
    if (closed) result.push(closed);
  }
  return result;
}

// Historical source-ring chunks are retained ONLY for campaign metadata. Club
// assignment, target selection and empireCenter weights use this calculation,
// reprojected alongside the rest of the map. These chunks are never painted:
// d, labelRings and visible bounds exclusively use splitAtAntimeridian above.
function legacyProjectedChunks(pts) {
  const segs = [];
  let cur = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    if (Math.abs(pts[i][0] - pts[i - 1][0]) > 300) {
      segs.push(cur);
      cur = [];
    }
    cur.push(pts[i]);
  }
  segs.push(cur);
  return segs;
}

function legacyAnchorMetrics(projected, s, tx, ty) {
  let area = -1, cx = 0, cy = 0;
  for (const poly of projected) {
    const points = poly[0].map(q => [q[0] * s + tx, q[1] * s + ty]);
    for (const part of legacyProjectedChunks(points)) {
      if (part.length < 3) continue;
      const center = ringCentroid(part);
      if (center && center.area > area && center.area > 0.01) {
        area = center.area; cx = center.cx; cy = center.cy;
      }
    }
  }
  if (area < 0) {
    const first = projected[0]?.[0]?.[0];
    if (first) { cx = first[0] * s + tx; cy = first[1] * s + ty; area = 0.02; }
  }
  return { area, cx, cy };
}

function ringCentroid(ring) {
  let a = 0;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    const cr = x1 * y2 - x2 * y1;
    a += cr;
    sx += (x1 + x2) * cr;
    sy += (y1 + y2) * cr;
  }
  a = a / 2;
  if (a === 0) return null;
  return { area: Math.abs(a), cx: sx / (6 * a), cy: sy / (6 * a) };
}

/**
 * Place a capital inside its own country's outline, in lon/lat.
 *
 * Coastline generalisation at 110m leaves a lot of real capitals fractionally
 * offshore — Montevideo, Tripoli, Freetown — so a point that misses is walked
 * toward the country's centre until it lands. Genuinely off-shape capitals
 * (Malabo on Bioko, Nassau on New Providence) never land and return null, and
 * the caller falls back to the centroid rather than stranding a marker at sea.
 */
function anchorInside(point, polys) {
  const rings = polys.map(p => p[0]);
  const hit = pt => rings.some(ring => pointInRing(pt, ring));
  if (hit(point)) return point;

  const target = ringCenter(largestRing(rings));
  if (!target) return null;
  for (const t of [0.03, 0.07, 0.12, 0.2, 0.3]) {
    const nudged = [point[0] + (target[0] - point[0]) * t, point[1] + (target[1] - point[1]) * t];
    if (hit(nudged)) return nudged;
  }
  return null;
}

function largestRing(rings) {
  let best = null;
  let bestArea = -1;
  for (const ring of rings) {
    const c = ringCentroid(ring);
    if (c && c.area > bestArea) {
      bestArea = c.area;
      best = ring;
    }
  }
  return best;
}

function ringCenter(ring) {
  if (!ring) return null;
  const c = ringCentroid(ring);
  return c ? [c.cx, c.cy] : null;
}

/** Even-odd point-in-polygon test, used to validate a capital against its country. */
function pointInRing([px, py], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Axis-aligned bounds of a ring, floored so a sliver still gets a usable tile. */
function ringBounds(ring) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of ring) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { x: minX, y: minY, w: Math.max(3, maxX - minX), h: Math.max(2.5, maxY - minY) };
}

const NICE_DISTANCES = [10, 25, 50, 100, 250, 500, 1000, 2000, 4000, 8000];

/** Largest round distance that fits within `maxKm`, for scale-bar labelling. */
export function niceDistance(maxKm) {
  let best = NICE_DISTANCES[0];
  for (const km of NICE_DISTANCES) if (km <= maxKm) best = km;
  return best;
}
