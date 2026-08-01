// World geometry: TopoJSON decoding, land adjacency, Robinson-style projection,
// and the SVG path/graticule/scale-bar bundle the map renders from.

const VIEW_W = 960;
const VIEW_H = 540;
const PAD = 16;

// Natural Earth ships three unclaimed shapes with id "-99". They arrive in a stable
// order, so name them rather than letting them collide on one key.
const UNCLAIMED_IDS = ['XCYN', 'KOS', 'XSOL'];

// Robinson-family forward projection (lon/lat degrees -> unit plane, y down).
export function projPt(lon, lat) {
  const la = (lon * Math.PI) / 180;
  const ph = (lat * Math.PI) / 180;
  const p2 = ph * ph;
  const p4 = p2 * p2;
  return [
    la * (0.8707 - 0.131979 * p2 + p4 * (-0.013791 + p4 * (0.003971 * p2 - 0.001529 * p4))),
    -ph * (1.007226 + p2 * (0.015085 + p4 * (-0.044475 + 0.028874 * p2 - 0.005916 * p4))),
  ];
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
    // so project every ring once and reuse it for each fitTo().
    this.projected = {};
    for (const c of this.countries) {
      this.projected[c.id] = c.polys.map(poly => poly.map(ring => ring.map(pt => projPt(pt[0], pt[1]))));
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
    // Ground distance covered by one SVG user unit, for the zoom-aware scale bar.
    this.kmPerUnit = 7320 / s;
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
      let bestA = -1;
      let cx = 0;
      let cy = 0;
      let bbox = null;
      for (const poly of this.projected[c.id]) {
        poly.forEach((ring, ri) => {
          const pts = ring.map(q => [q[0] * s + tx, q[1] * s + ty]);
          for (const seg of splitAtAntimeridian(pts)) {
            if (seg.length < 3) continue;
            d += 'M' + seg.map(q => q[0].toFixed(1) + ',' + q[1].toFixed(1)).join('L') + 'Z';
            if (ri !== 0) continue;
            // Track the largest outer ring. Its centroid anchors labels, capital
            // markers and attack arrows; its bounds size the flag fill, so a
            // country with distant islands still shows a flag scaled to its
            // mainland rather than stretched across the whole archipelago.
            const c2 = ringCentroid(seg);
            if (c2 && c2.area > bestA && c2.area > 0.01) {
              bestA = c2.area;
              cx = c2.cx;
              cy = c2.cy;
              bbox = ringBounds(seg);
            }
          }
        });
      }
      if (bestA < 0) {
        // Shapes too small to survive the antimeridian split still need an anchor.
        const fp = this.projected[c.id][0]?.[0]?.[0];
        if (fp) {
          cx = fp[0] * s + tx;
          cy = fp[1] * s + ty;
          bestA = 0.02;
        }
      }
      if (!bbox) bbox = { x: cx - 2, y: cy - 1.5, w: 4, h: 3 };

      // Prefer the capital as the country's anchor point; the centroid is only
      // a fallback for shapes with no capital of their own.
      const cap = this.capitals[c.id];
      if (cap) {
        const q = projPt(cap[0], cap[1]);
        cx = q[0] * s + tx;
        cy = q[1] * s + ty;
      }
      paths[c.id] = { d, cx, cy, area: bestA, bbox, hasCapital: !!cap };
    }
    return paths;
  }

  /** Inverse projection: SVG user units -> [lon, lat] degrees. */
  invert(px, py) {
    if (!this.fit) return null;
    const { s, tx, ty } = this.fit;
    const x = (px - tx) / s;
    const y = -((py - ty) / s);
    let ph = y / 1.007226;
    for (let i = 0; i < 6; i++) {
      const p2 = ph * ph;
      const p4 = p2 * p2;
      const f = ph * (1.007226 + p2 * (0.015085 + p4 * (-0.044475 + 0.028874 * p2 - 0.005916 * p4))) - y;
      const df =
        1.007226 + 0.045255 * p2 - 0.311325 * p2 * p4 + 0.259866 * p4 * p4 - 0.065076 * p2 * p4 * p4;
      ph -= f / df;
    }
    const p2 = ph * ph;
    const p4 = p2 * p2;
    const la = x / (0.8707 - 0.131979 * p2 + p4 * (-0.013791 + p4 * (0.003971 * p2 - 0.001529 * p4)));
    return [(la * 180) / Math.PI, (ph * 180) / Math.PI];
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
    let id = g.id;
    if (id === '-99') {
      id = UNCLAIMED_IDS[unclaimed] || 'X' + unclaimed;
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
    countries.push({ id, polys: polys.map(p => p.map(ringFrom)) });
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

// A ring that wraps past ±180° lands as a huge horizontal jump between consecutive
// projected points, which would otherwise paint a band straight across the map.
function splitAtAntimeridian(pts) {
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
