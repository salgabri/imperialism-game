// World geometry: TopoJSON decoding, land adjacency, flat cylindrical projection,
// and the SVG path/graticule/scale-bar bundle the map renders from. The same class
// draws one country's club sections with its own central meridian and parallel.

const VIEW_W = 960;
const VIEW_H = 540;
const PAD = 16;
export const EARTH_RADIUS_KM = 6371.0088;
export const PROJECTION_X_SCALE = Math.cos(Math.PI / 6);
export const DEFAULT_PROJECTION = Object.freeze({ lon0: 0, lat0: 30 });
const GRATICULE_STEPS = [0.5, 1, 2, 5, 10, 20];

// Natural Earth ships three unclaimed shapes with id "-99". They arrive in a stable
// order, so name them rather than letting them collide on one key.
const UNCLAIMED_IDS = ['XCYN', 'KOS', 'XSOL'];

// Equirectangular, standard parallel 30° (degrees -> unit plane, y down).
// A fixed horizontal scale keeps both meridians and parallels straight, without
// globe-like tapering or infinite poles. All rendered and rule geometry shares
// this plane; the 30° parallel balances the world's width against its height.
// This is the world chart; WorldGeometry#project serves any chart.
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

function wrapLongitude(lon) {
  return lon < -180 || lon > 180 ? ((lon + 180) % 360 + 360) % 360 - 180 : lon;
}

export class WorldGeometry {
  /**
   * `anchors` maps a shape id to a [lon, lat] marker point (a capital, a club's
   * home town). `options.object` names the topology object (else its first
   * GeometryCollection); `options.projection = { lon0, lat0 }` sets the central
   * meridian and standard parallel. The defaults are the historical world chart.
   * `options.keepPolys = false` releases each country's lon/lat `polys` once they
   * are projected, for an atlas that is only ever drawn (fitted with buildPaths).
   */
  constructor(topo, anchors = {}, options = {}) {
    const { lon0 = DEFAULT_PROJECTION.lon0, lat0 = DEFAULT_PROJECTION.lat0 } = options.projection || {};
    if (!Number.isFinite(lon0) || !Number.isFinite(lat0) || Math.abs(lat0) > 85) {
      throw new Error(`Invalid map projection ${JSON.stringify(options.projection)}`);
    }
    this.projection = { lon0, lat0 };
    // The default world chart keeps every historical formula bit for bit: saved
    // campaigns, club seeding and pinned tests depend on its exact output.
    this.legacy = lon0 === DEFAULT_PROJECTION.lon0 && lat0 === DEFAULT_PROJECTION.lat0;
    this.xScale = lat0 === DEFAULT_PROJECTION.lat0 ? PROJECTION_X_SCALE : Math.cos(lat0 * Math.PI / 180);

    const { countries, adjacency } = decodeTopo(topo, options.object || 'countries');
    this.countries = countries;
    /** country id -> Set of ids sharing a land border */
    this.adj = adjacency;

    // Lon/lat -> plane is fixed; only the fit transform changes between theatres,
    // so project every ring once and reuse it for each fitTo(). Keep this original
    // cache for fit/rule compatibility; repaired display geometry is separate.
    // A custom central meridian rotates longitudes first, so the seam split
    // happens opposite the country instead of through it.
    this.projected = {};
    this.displayProjected = {};
    const plane = this.legacy ? projPt : (lon, lat) => [(lon * Math.PI / 180) * this.xScale, -lat * Math.PI / 180];
    const rotate = this.legacy ? ring => ring : ring => ring.map(([lon, lat]) => [wrapLongitude(lon - lon0), lat]);
    for (const c of this.countries) {
      const projected = [], display = [];
      for (const poly of c.polys) {
        const projectedPoly = [], displayPoly = [];
        for (const ring of poly) {
          const rotated = rotate(ring), atPlace = new Map();
          projectedPoly.push(rotated.map(pt => {
            const point = plane(pt[0], pt[1]);
            if (!atPlace.has(pt[0])) atPlace.set(pt[0], []);
            atPlace.get(pt[0]).push(pt[0], pt[1], point);
            return point;
          }));
          // A display point at exactly a source point's lon/lat (every point of a ring that never meets the seam)
          // projects to the same coordinates: it shares that array instead of holding a second copy. Object.is
          // keeps -0 and 0 apart, which the map's keys would not.
          const shared = ([lon, lat]) => {
            const candidates = atPlace.get(lon) || [];
            for (let i = 0; i < candidates.length; i += 3) {
              if (Object.is(candidates[i], lon) && Object.is(candidates[i + 1], lat)) return candidates[i + 2];
            }
            return null;
          };
          displayPoly.push(splitAtAntimeridian(rotated).map(part => part.map(pt => shared(pt) || plane(pt[0], pt[1]))));
        }
        projected.push(projectedPoly);
        display.push(displayPoly);
      }
      this.projected[c.id] = projected;
      this.displayProjected[c.id] = display;
    }

    // Plane-space point-on-surface and area per shape (custom projections only).
    this.surface = {};
    this.capitals = {};
    for (const c of this.countries) {
      const pt = anchors[c.id];
      if (pt) {
        const anchored = this.legacy ? anchorInside(pt, c.polys) : this.anchorInPlane(c.id, pt);
        if (anchored) this.capitals[c.id] = anchored;
      }
    }
    // Projection and anchors were the polygons' last use here.
    if (options.keepPolys === false) for (const c of this.countries) c.polys = null;

    this.fit = null;
    this.paths = {};
    this.graticule = { d: '', labels: [] };
    this.kmPerUnit = 0;
  }

  /** Lon/lat -> unfitted projection plane (identical to projPt on the world chart). */
  project(lon, lat) {
    if (this.legacy) return projPt(lon, lat);
    return [(wrapLongitude(lon - this.projection.lon0) * Math.PI / 180) * this.xScale, -lat * Math.PI / 180];
  }

  /** Fitted SVG box { x, y, w, h } around a [west, south, east, north] lon/lat box. */
  focusView([west, south, east, north]) {
    if (!this.fit) return null;
    const { s, tx, ty } = this.fit;
    const [x0, y0] = this.project(west, north), [x1, y1] = this.project(east, south);
    return { x: Math.min(x0, x1) * s + tx, y: Math.min(y0, y1) * s + ty, w: Math.abs(x1 - x0) * s, h: Math.abs(y1 - y0) * s };
  }

  surfaceOf(id) {
    return this.surface[id] || (this.surface[id] = surfaceMetrics(this.displayProjected[id] || []));
  }

  /**
   * Custom-projection anchor: keep the point when it lies on the shape (holes
   * excluded), nudge a fractionally-outside point toward the point-on-surface,
   * else give up so the caller uses the point-on-surface. Never returns a point
   * outside the shape. Works in the rotated plane, so shifted longitudes (182°)
   * and wrapped ones (-178°) agree.
   */
  anchorInPlane(id, point) {
    const polys = this.displayProjected[id];
    if (!polys || !Number.isFinite(point?.[0]) || !Number.isFinite(point?.[1])) return null;
    const q = this.project(point[0], point[1]);
    if (insidePolygons(q, polys)) return [point[0], point[1]];
    const target = this.surfaceOf(id);
    if (!target.point) return null;
    for (const t of [0.03, 0.07, 0.12, 0.2, 0.3]) {
      const nudged = [q[0] + (target.point[0] - q[0]) * t, q[1] + (target.point[1] - q[1]) * t];
      if (insidePolygons(nudged, polys)) {
        return [nudged[0] / (this.xScale * Math.PI / 180) + this.projection.lon0, -nudged[1] * 180 / Math.PI];
      }
    }
    return null;
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

    this.graticule = this.buildGraticule(s, tx, ty, { minX, minY, maxX, maxY });
    // World: equatorial horizontal reference, not geodesic distance at every
    // latitude. Also keeps regional flag grouping in fixed map units, independent
    // of zoom. A country chart is true scale along meridians and its parallel.
    this.kmPerUnit = this.legacy ? EARTH_RADIUS_KM / (s * PROJECTION_X_SCALE) : EARTH_RADIUS_KM / s;
    this.paths = this.buildPaths(s, tx, ty);
    return this;
  }

  buildGraticule(s, tx, ty, bounds) {
    if (!this.legacy) return this.buildLocalGraticule(s, tx, ty, bounds);
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

  /**
   * Country-scale graticule: a round step (0.5°–20°) giving a handful of lines
   * over the fitted extent, drawn only over that extent plus one step and
   * inside the frame. Meridians and parallels are straight, so two points each.
   */
  buildLocalGraticule(s, tx, ty, bounds) {
    if (!Number.isFinite(s) || s <= 0) return { d: '', labels: [] };
    const k = Math.PI / 180, kx = k * this.xScale;
    const b = bounds && Number.isFinite(bounds.minX) && bounds.maxX >= bounds.minX
      ? bounds : { minX: -tx / s, maxX: (VIEW_W - tx) / s, minY: -ty / s, maxY: (VIEW_H - ty) / s };
    const span = Math.max((b.maxX - b.minX) / kx, (b.maxY - b.minY) / k);
    // Five spans plus the end and margin lines keep it to roughly 4-8 lines.
    const step = GRATICULE_STEPS.find(st => span / st <= 5) || GRATICULE_STEPS[GRATICULE_STEPS.length - 1];
    // Rotated longitudes and latitudes of the drawable window.
    const lonMin = Math.max(-180, b.minX / kx - step, -tx / s / kx);
    const lonMax = Math.min(180, b.maxX / kx + step, (VIEW_W - tx) / s / kx);
    const latMin = Math.max(-90, -b.maxY / k - step, -(VIEW_H - ty) / s / k);
    const latMax = Math.min(90, -b.minY / k + step, ty / s / k);
    const at = (lon, lat) => (lon * kx * s + tx).toFixed(1) + ',' + (-lat * k * s + ty).toFixed(1);
    const { lon0 } = this.projection;
    const eps = 1e-9;
    let d = '';
    for (let i = Math.ceil((lonMin + lon0) / step - eps); i * step <= lonMax + lon0 + eps; i++) {
      const lon = i * step - lon0;
      d += 'M' + at(lon, latMin) + 'L' + at(lon, latMax);
    }
    const labels = [];
    for (let i = Math.ceil(latMin / step - eps); i * step <= latMax + eps; i++) {
      const lat = i * step;
      d += 'M' + at(lonMin, lat) + 'L' + at(lonMax, lat);
      const y = -lat * k * s + ty;
      if (y > 14 && y < VIEW_H - 12) {
        const deg = Math.abs(lat).toFixed(step < 1 ? 1 : 0);
        labels.push({ y: y.toFixed(0), text: lat === 0 ? '0°' : deg + '°' + (lat > 0 ? 'N' : 'S') });
      }
    }
    return { d, labels };
  }

  buildPaths(s, tx, ty) {
    const paths = {};
    for (const c of this.countries) {
      let d = '';
      const labelRings = [];
      // World: historical source-ring centroid. Country charts: a point on the
      // largest polygon's surface (inside even for C-shaped or holed sections).
      let cx, cy, bestA, largest = -1;
      const largestRings = [];
      if (this.legacy) {
        const legacy = legacyAnchorMetrics(this.projected[c.id], s, tx, ty);
        cx = legacy.cx;
        cy = legacy.cy;
        bestA = legacy.area;
      } else {
        const surface = this.surfaceOf(c.id);
        const point = surface.point || this.projected[c.id][0]?.[0]?.[0] || [0, 0];
        cx = point[0] * s + tx;
        cy = point[1] * s + ty;
        bestA = surface.area > 0 ? surface.area * s * s : 0.02;
        largest = surface.index;
      }
      let largestPaintedArea = -1;
      let bbox = null;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      this.displayProjected[c.id].forEach((poly, pi) => {
        poly.forEach((parts, ri) => {
          for (const part of parts) {
            const seg = part.map(q => [q[0] * s + tx, q[1] * s + ty]);
            if (seg.length < 3) continue;
            d += 'M' + seg.map(q => q[0].toFixed(1) + ',' + q[1].toFixed(1)).join('L') + 'Z';
            // Label containment must use the same split, rounded land that the
            // SVG paints, including holes and disconnected date-line segments.
            labelRings.push(seg.map(([x, y]) => [Number(x.toFixed(1)), Number(y.toFixed(1))]));
            if (pi === largest) largestRings.push(labelRings[labelRings.length - 1]);
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
      });
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
      let home = null;
      if (cap) {
        const q = this.project(cap[0], cap[1]);
        cx = q[0] * s + tx;
        cy = q[1] * s + ty;
        if (!this.legacy) {
          // Routes start at cx/cy, so test the painted (rounded) rings they use.
          const rings = largestRings.length ? largestRings : labelRings;
          if (insideRings([cx, cy], labelRings)) home = [cx, cy];
          [cx, cy] = routingAnchor([cx, cy], [labelX, labelY], rings);
        }
      }
      paths[c.id] = { d, cx, cy, labelX, labelY, area: bestA, bbox, fullBounds, labelRings, hasCapital: !!cap };
      // The home town marker, where it is on the painted section; else the anchor.
      if (!this.legacy) Object.assign(paths[c.id], { homeX: home ? home[0] : cx, homeY: home ? home[1] : cy });
    }
    return paths;
  }

  /**
   * Inverse projection: SVG user units -> [lon, lat] degrees, longitude wrapped
   * to ±180 (a shifted 182° source longitude comes back as -178°).
   */
  invert(px, py) {
    if (!this.fit) return null;
    const { s, tx, ty } = this.fit;
    const lon = (px - tx) / (s * this.xScale) * 180 / Math.PI;
    const lat = (ty - py) / s * 180 / Math.PI;
    // Empty space around the rectangular world isn't another geographic point.
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lon) > 180 + 1e-9 || Math.abs(lat) > 90 + 1e-9) return null;
    const clamped = Math.max(-180, Math.min(180, lon));
    return [this.legacy ? clamped : wrapLongitude(clamped + this.projection.lon0), Math.max(-90, Math.min(90, lat))];
  }
}

function decodeTopo(topo, objectName = 'countries') {
  const objects = topo?.objects || {};
  const collection = objects[objectName]?.type === 'GeometryCollection' ? objects[objectName]
    : Object.values(objects).find(object => object?.type === 'GeometryCollection');
  if (!collection || !Array.isArray(topo.arcs)) {
    throw new Error(`Topology has no "${objectName}" GeometryCollection`);
  }
  // Quantized topologies delta-encode arcs; an unquantized one is absolute.
  const tr = topo.transform;
  const arcs = topo.arcs.map(arc => {
    if (!tr) return arc.map(p => [p[0], p[1]]);
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
  for (const g of collection.geometries || []) {
    // Null geometries (and any non-area type) carry no land.
    if (g?.type !== 'Polygon' && g?.type !== 'MultiPolygon') continue;
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

// Historical source-ring chunks are retained ONLY for the world chart's campaign
// metadata. Club assignment, target selection and empireCenter weights use this
// calculation, reprojected alongside the rest of the map. These chunks are never
// painted: d, labelRings and visible bounds exclusively use splitAtAntimeridian
// above. The 300-unit jump is a world-scale date-line guess that cuts any wide
// country-scale shape, so custom projections use surfaceMetrics instead.
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

function ringArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return Math.abs(a) / 2;
}

/** Even-odd test over every ring and seam part of each polygon, so holes count. */
function insidePolygons(point, polys) {
  return polys.some(poly => {
    let inside = false;
    for (const parts of poly) for (const part of parts) if (pointInRing(point, part)) inside = !inside;
    return inside;
  });
}

function segmentDistance2([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
  const ex = ax + t * dx - px, ey = ay + t * dy - py;
  return ex * ex + ey * ey;
}

/**
 * Area (outer minus holes) of the largest polygon and a point on its surface.
 * Candidates are midpoints of the inside spans of horizontal scanlines, which
 * lie inside by construction; the one farthest from any edge wins, so a C-shaped
 * or holed shape gets a central interior point rather than an outside centroid.
 * Input is display-projected plane geometry: polygons -> rings -> seam parts.
 */
function surfaceMetrics(polys) {
  let best = null;
  polys.forEach((poly, index) => {
    if (!poly[0]?.length) return;
    let area = 0;
    poly.forEach((parts, ri) => { for (const part of parts) area += (ri ? -1 : 1) * ringArea(part); });
    if (!best || area > best.area) best = { area, rings: poly.flat(), index };
  });
  if (!best) return { area: 0, point: null, index: -1 };
  let minY = Infinity, maxY = -Infinity;
  for (const ring of best.rings) for (const [, y] of ring) { minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  let point = null, clearance = -1;
  const lines = 24;
  for (let k = 0; k < lines && maxY > minY; k++) {
    const y = minY + (maxY - minY) * (k + 0.5) / lines;
    const xs = [];
    for (const ring of best.rings) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i], [xj, yj] = ring[j];
        if (yi > y !== yj > y) xs.push(xi + (y - yi) * (xj - xi) / (yj - yi));
      }
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      if (!(xs[i + 1] > xs[i])) continue;
      const candidate = [(xs[i] + xs[i + 1]) / 2, y];
      let d2 = Infinity;
      for (const ring of best.rings) for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) d2 = Math.min(d2, segmentDistance2(candidate, ring[b], ring[a]));
      if (d2 > clearance) { clearance = d2; point = candidate; }
    }
  }
  return { area: Math.max(0, best.area), point, index: best.index };
}

// A country chart's routing anchor keeps at least this share of its polygon's
// best clearance from the painted edge. Routes start there, so a home town on
// a border (or outside it once paths are rounded to 0.1 units) would let one
// neighbour's corner capture every arrow; a town comfortably inside stays put.
const ANCHOR_CLEARANCE = 0.35;
const ANCHOR_STEPS = 16;

function edgeClearance(point, rings) {
  let d2 = Infinity;
  for (const ring of rings) for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) d2 = Math.min(d2, segmentDistance2(point, ring[b], ring[a]));
  return Math.sqrt(d2);
}

const insideRings = (point, rings) => rings.reduce((inside, ring) => pointInRing(point, ring) ? !inside : inside, false);

/**
 * Walk from `home` toward `pole` (the polygon's interior point) and keep the first
 * point inside the painted `rings` with enough clearance. Without a usable pole
 * (a section smaller than the rounding) the pole is the best available answer.
 */
function routingAnchor(home, pole, rings) {
  const need = ANCHOR_CLEARANCE * edgeClearance(pole, rings);
  if (!(need > 0) || !insideRings(pole, rings)) return pole;
  for (let k = 0; k < ANCHOR_STEPS; k++) {
    const t = k / ANCHOR_STEPS;
    const point = k ? [home[0] + (pole[0] - home[0]) * t, home[1] + (pole[1] - home[1]) * t] : home;
    if (insideRings(point, rings) && edgeClearance(point, rings) >= need) return point;
  }
  return pole;
}

/**
 * Place a capital inside its own country's outline, in lon/lat.
 *
 * Coastline generalisation at 110m leaves a lot of real capitals fractionally
 * offshore — Montevideo, Tripoli, Freetown — so a point that misses is walked
 * toward the country's centre until it lands. Genuinely off-shape capitals
 * (Malabo on Bioko, Nassau on New Providence) never land and return null, and
 * the caller falls back to the centroid rather than stranding a marker at sea.
 * World chart only: it tests outer rings, and the pinned world capitals depend
 * on that (Canberra lies in a 50m hole). Country charts use anchorInPlane.
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

const NICE_DISTANCES = [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, 2000, 4000, 8000];

/** Largest round distance that fits within `maxKm`, for scale-bar labelling. */
export function niceDistance(maxKm) {
  let best = NICE_DISTANCES[0];
  for (const km of NICE_DISTANCES) if (km <= maxKm) best = km;
  return best;
}
