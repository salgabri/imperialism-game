// A nation's whole flag on the land it flies over, in Flags mode (README §Flags, docs/design/flag-fit.md).
// Stretched over its region's box, a flag lost its shapes (a coat of arms, a star) and could miss its own land: the
// middle of Norway's box lies in Sweden, so its cross flew there, and Croatia's chequy shield flew over Bosnia. Here
// the flag is drawn once, over its region's body, and only as far out of its proportions as its artwork allows
// (src/data/flagFits.js, read from the flags' pixels by scripts/build-flag-fits.mjs):
// - rows (horizontal stripes): the stripes span the body's height, and the whole region's width;
// - cols (vertical stripes): the stripes span the body's width, and the whole region's height;
// - grid (straight-edged blocks: a Nordic cross, Greece): at most GRID_STRETCH out of its proportions;
// - free (an emblem, a star, a diagonal): in its own proportions, never stretched;
// - plain (one colour): the region's box.
// The body is the region's land in pieces at least BODY_SHARE the size of its largest (Luzon and Mindanao, not the
// Visayas; mainland Greece, not Crete). A grid or free flag fills the body's box as far as its proportions let it,
// centred, when the middle of that box is on the body or the body is in pieces (an archipelago); a free flag then grows
// towards covering the body's box as far as its sides are only stripe (its margins: Argentina's sun stays whole, the
// United States' canton keeps its stars). A body of one piece whose middle is not its own (Norway's lies in Sweden,
// Croatia's in Bosnia) gets the largest box around a point of the body that is mostly the body (BODY_LAND): Norway's
// south, Croatia's north. Past the flag, the colours along its edges carry on to the region's box (islands, a long
// coast): each strip is one colour or the colours of the edge it continues, and the corners take the corner's colour.
// All coordinates are projected map units; nothing depends on the camera.
// A flag with a separated emblem (src/data/flagSymbols.js) and a club's crest are fitted by flagSymbolLayout.js.
import { FLAG_FITS } from '../data/flagFits.js';
import { makeRaster, regionCountries } from './landRaster.js';

/** The flags' canvas: flag-icons' 4:3, which the historic flags are redrawn on. */
export const FLAG_WIDTH = 640;
export const FLAG_HEIGHT = 480;
const ASPECT = FLAG_WIDTH / FLAG_HEIGHT;
/** The margin around a region's box that its banner covers (app/mapMethods.jsx layoutBanners). */
export const BANNER_PAD = 0.1;
/** How far a grid flag may leave its proportions either way: a Nordic cross's arms then differ by a quarter at most. */
export const GRID_STRETCH = 1.25;
/** A piece of land belongs to the body when it is at least this share of the largest piece's size. */
export const BODY_SHARE = 0.25;
/** The least share of a body box that is the body, when the middle of the body's own box is not. */
export const BODY_LAND = 0.6;
/**
 * The land grid the body is read from: coarser than the emblem fitter's (landRaster.js), as a flag's box needs no finer
 * than about a 64th of its region, and a world board's first Flags view lays out every region at once.
 */
export const FIT_GRID = Object.freeze({ maxSide: 64, maxCells: 3000 });
/**
 * Seams where the flag meets its strips. A strip reaches UNDERLAP of the flag's shorter side under the flag, so the
 * flag's soft edge blends into its own colours, never into the banner's colour beneath. Drawn as an SVG, a flag's layers
 * each blend their own edge pixel too (the field's, then a stripe's over it), a seam; a lip in the strip's colours over
 * the flag's edge hides it (flagLip): LIP_PX device pixels wide, at least LIP_UNITS of the flag's units, at most the
 * underlap, clear of anything the flag holds further in (a canton's stars). A bitmap is one layer and needs no lip.
 */
const UNDERLAP = 0.04;
const LIP_UNITS = 1;
const LIP_PX = 1.5;
const KINDS = Object.freeze({ p: 'plain', r: 'rows', c: 'cols', g: 'grid', f: 'free' });
const SIDES = ['left', 'right', 'top', 'bottom'];
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const finiteBox = b => !!b && [b.x, b.y, b.w, b.h].every(Number.isFinite) && b.w > 0 && b.h > 0;

const FITS = new Map(); // flag code → its fit, decoded once (or null: no fit known)
/**
 * A flag's fit (src/data/flagFits.js): `{ code, kind, margins, edges: { left, right, top, bottom } }`. Each edge is its
 * colour runs `[{ start, color }]` (start in the flag's units, color '#rrggbb' or null where the flag is see-through), or
 * null for an edge its kind never extends; `margins` (a free flag's) how many units deep each side is only its edge
 * drawn out, else null. → null for a flag without one (drawn over its region's box as it was).
 */
export function flagFit(code) {
  if (!code) return null;
  if (FITS.has(code)) return FITS.get(code);
  const text = Object.prototype.hasOwnProperty.call(FLAG_FITS, code) ? FLAG_FITS[code] : null;
  const head = typeof text === 'string' ? /^([prcgf])(?:(\d+),(\d+),(\d+),(\d+))?(?:\||$)/.exec(text) : null;
  let fit = null;
  if (head) {
    const fields = text.split('|');
    const runs = field => (field ? Object.freeze(field.split(' ').map((run, i) => {
      const [start, color] = i ? run.split(':') : ['0', run];
      return Object.freeze({ start: Number(start), color: color === '-' ? null : `#${color}` });
    })) : null);
    fit = Object.freeze({ code, kind: KINDS[head[1]],
      margins: head[2] ? Object.freeze(Object.fromEntries(SIDES.map((side, i) => [side, Number(head[i + 2])]))) : null,
      edges: Object.freeze(Object.fromEntries(SIDES.map((side, i) => [side, runs(fields[i + 1])]))) });
  }
  FITS.set(code, fit);
  return fit;
}

/**
 * The region's body in the raster's cells: `{ mask, pieces, box, meanX, meanY }`, mask its cells, pieces how many,
 * box its bounds in map units (within half a cell of its land each way), meanX/meanY its centre of mass in cells.
 */
function bodyOf(r) {
  const label = new Int32Array(r.mask.length).fill(-1);
  const sizes = [];
  for (let start = 0; start < r.mask.length; start++) {
    if (!r.mask[start] || label[start] >= 0) continue;
    const id = sizes.length, stack = [start];
    let size = 0;
    label[start] = id;
    while (stack.length) {
      const i = stack.pop();
      size++;
      // The raster keeps a cell of sea all round, so a land cell's four neighbours are always in it.
      for (const next of [i - 1, i + 1, i - r.nx, i + r.nx]) {
        if (r.mask[next] && label[next] < 0) { label[next] = id; stack.push(next); }
      }
    }
    sizes.push(size);
  }
  const largest = Math.max(...sizes);
  const kept = sizes.map(size => size >= BODY_SHARE * largest);
  const mask = new Uint8Array(r.mask.length);
  let c0 = Infinity, c1 = -Infinity, r0 = Infinity, r1 = -Infinity, sumX = 0, sumY = 0, cells = 0;
  for (let i = 0; i < mask.length; i++) {
    if (label[i] < 0 || !kept[label[i]]) continue;
    mask[i] = 1;
    const col = i % r.nx, row = (i - col) / r.nx;
    if (col < c0) c0 = col; if (col > c1) c1 = col;
    if (row < r0) r0 = row; if (row > r1) r1 = row;
    sumX += col; sumY += row; cells++;
  }
  return { mask, pieces: kept.filter(Boolean).length, meanX: sumX / cells + 0.5, meanY: sumY / cells + 0.5,
    box: { x: r.x0 + c0 * r.cell, y: r.y0 + r0 * r.cell, w: (c1 - c0 + 1) * r.cell, h: (r1 - r0 + 1) * r.cell } };
}

const onBody = (r, body, x, y) => {
  const col = Math.floor((x - r.x0) / r.cell), row = Math.floor((y - r.y0) / r.cell);
  return col >= 0 && row >= 0 && col < r.nx && row < r.ny && body.mask[row * r.nx + col] === 1;
};

/** The largest box with proportions in [low, high] that fits in `box`, centred in it. */
function contain(box, low, high) {
  const aspect = box.w / box.h, target = clamp(aspect, low, high);
  const w = target >= aspect ? box.w : box.h * target, h = target >= aspect ? box.w / target : box.h;
  return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h };
}

/**
 * A free flag contained in `box` (`flag`), grown towards covering it: past the box only by its margins (a share of its
 * own size on each side), and centred as far as they allow.
 */
function grow(flag, box, margins) {
  if (!margins) return flag;
  // As wide as the box and short of its height, it grows taller, and wider than the box, losing width at its left and
  // right; as tall as the box, it grows wider, and taller than the box, losing height at its top and bottom.
  const fullWidth = flag.w >= box.w * (1 - 1e-9);
  const [nearShare, farShare] = fullWidth ? [margins.left / FLAG_WIDTH, margins.right / FLAG_WIDTH]
    : [margins.top / FLAG_HEIGHT, margins.bottom / FLAG_HEIGHT];
  const across = fullWidth ? box.w : box.h, along = fullWidth ? box.h : box.w;
  const ratio = fullWidth ? flag.w / flag.h : flag.h / flag.w;
  // Its size across the box: enough to cover the box along it, or as much as its margins can lose.
  const size = Math.min(along * ratio, across / Math.max(1e-9, 1 - nearShare - farShare));
  if (!(size > across)) return flag;
  const excess = size - across;
  const near = clamp(excess / 2, excess - farShare * size, nearShare * size);
  const length = size / ratio;
  return fullWidth ? { x: box.x - near, y: box.y + (box.h - length) / 2, w: size, h: length }
    : { x: box.x + (box.w - length) / 2, y: box.y - near, w: length, h: size };
}

/**
 * The largest box with proportions in [low, high], centred on a cell of the body, of which at least BODY_LAND is the
 * body (counting cells by their centres); the most central of equals. → map units, or null.
 */
function landBox(r, body, low, high) {
  const stride = r.nx + 1;
  const prefix = new Uint32Array(stride * (r.ny + 1));
  for (let y = 0; y < r.ny; y++) for (let x = 0; x < r.nx; x++) {
    const p = (y + 1) * stride + x + 1;
    prefix[p] = body.mask[y * r.nx + x] + prefix[p - 1] + prefix[p - stride] - prefix[p - stride - 1];
  }
  // Body cells whose centres lie in a box centred on (cx, cy), w by h, all in cells.
  const count = (cx, cy, w, h) => {
    const left = clamp(Math.ceil(cx - w / 2 - 0.5), 0, r.nx), right = clamp(Math.floor(cx + w / 2 - 0.5) + 1, 0, r.nx);
    const top = clamp(Math.ceil(cy - h / 2 - 0.5), 0, r.ny), bottom = clamp(Math.floor(cy + h / 2 - 0.5) + 1, 0, r.ny);
    if (right <= left || bottom <= top) return 0;
    return prefix[bottom * stride + right] - prefix[top * stride + right] - prefix[bottom * stride + left] + prefix[top * stride + left];
  };
  const aspects = low === high ? [low] : Array.from({ length: 5 }, (_, i) => low * (high / low) ** (i / 4));
  const limit = 2 * Math.max(r.nx, r.ny);
  let cells = 0;
  for (let i = 0; i < body.mask.length; i++) cells += body.mask[i];
  // Every cell of a small body; on a large one a sample, then every cell around the best of the sample.
  const step = Math.max(1, Math.floor(Math.sqrt(cells / 1500)));
  let best = null;
  const tryAt = (cx, cy) => {
    for (const aspect of aspects) {
      let lo = 0, hi = limit;
      for (let k = 0; k < 14; k++) {
        const mid = (lo + hi) / 2;
        if (count(cx, cy, mid * aspect, mid) >= BODY_LAND * mid * mid * aspect) lo = mid; else hi = mid;
      }
      const area = lo * lo * aspect;
      if (area <= 0) continue;
      const centrality = Math.hypot(cx - body.meanX, cy - body.meanY);
      if (!best || area > best.area * (1 + 1e-9) || (area >= best.area * (1 - 1e-9) && centrality < best.centrality)) {
        best = { cx, cy, w: lo * aspect, h: lo, area, centrality };
      }
    }
  };
  for (let i = 0; i < body.mask.length; i++) {
    if (!body.mask[i]) continue;
    const col = i % r.nx, row = (i - col) / r.nx;
    if (col % step === 0 && row % step === 0) tryAt(col + 0.5, row + 0.5);
  }
  if (best && step > 1) {
    const around = best;
    for (let row = Math.floor(around.cy) - step; row <= Math.floor(around.cy) + step; row++) {
      for (let col = Math.floor(around.cx) - step; col <= Math.floor(around.cx) + step; col++) {
        if (col >= 0 && row >= 0 && col < r.nx && row < r.ny && body.mask[row * r.nx + col]) tryAt(col + 0.5, row + 0.5);
      }
    }
  }
  if (!best) return null;
  return { x: r.x0 + (best.cx - best.w / 2) * r.cell, y: r.y0 + (best.cy - best.h / 2) * r.cell, w: best.w * r.cell, h: best.h * r.cell };
}

/** Where a region's flag goes (its kind's rule above), in map units; null without land. */
function flagBox(component, fit) {
  const b = component.bbox, kind = fit.kind;
  const region = { x: b.x - BANNER_PAD, y: b.y - BANNER_PAD, w: b.w + 2 * BANNER_PAD, h: b.h + 2 * BANNER_PAD };
  if (kind === 'plain') return region;
  const raster = makeRaster({ countries: regionCountries(component).countries, bbox: b }, FIT_GRID);
  if (!raster) return null;
  const body = bodyOf(raster), box = body.box;
  if (kind === 'rows') return { x: region.x, y: box.y, w: region.w, h: box.h };
  if (kind === 'cols') return { x: box.x, y: region.y, w: box.w, h: region.h };
  const low = kind === 'grid' ? ASPECT / GRID_STRETCH : ASPECT, high = kind === 'grid' ? ASPECT * GRID_STRETCH : ASPECT;
  if (body.pieces > 1 || onBody(raster, body, box.x + box.w / 2, box.y + box.h / 2)) {
    const flag = contain(box, low, high);
    return kind === 'free' ? grow(flag, box, fit.margins) : flag;
  }
  return landBox(raster, body, low, high) || contain(box, low, high);
}

/**
 * An edge's runs as a strip's paint: one colour (or null: nothing, the banner's own colour shows), or the stops of a
 * gradient along the strip's `axis` from `from` to `to` (the flag's own extent that way), hard-edged, padding past it.
 */
function paint(runs, length) {
  if (!runs?.length) return null;
  if (runs.length === 1) return runs[0].color;
  const stops = [{ offset: 0, color: runs[0].color }];
  for (let i = 1; i < runs.length; i++) {
    const offset = clamp(runs[i].start / length, 0, 1);
    stops.push({ offset, color: runs[i - 1].color }, { offset, color: runs[i].color });
  }
  return { stops: stops.map(stop => Object.freeze({ offset: stop.offset, color: stop.color || '#000', opacity: stop.color ? 1 : 0 })) };
}

/**
 * The strips that carry the flag's edges on over the rest of the region's box: `{ side, x, y, w, h }` reaching UNDERLAP
 * under the flag, and the strip's paint along `axis` from `from` to `to`.
 */
function strips(region, flag, fit) {
  const under = UNDERLAP * Math.min(flag.w, flag.h);
  const right = flag.x + flag.w, bottom = flag.y + flag.h;
  const regionRight = region.x + region.w, regionBottom = region.y + region.h;
  const out = [];
  const add = (side, x, y, w, h, axis) => {
    const fill = paint(fit.edges[side], axis === 'y' ? FLAG_HEIGHT : FLAG_WIDTH);
    if (fill === null || !(w > 0 && h > 0)) return;
    out.push(Object.freeze({ side, x, y, w, h, axis, from: axis === 'y' ? flag.y : flag.x, to: axis === 'y' ? bottom : right,
      ...(typeof fill === 'string' ? { color: fill } : { stops: Object.freeze(fill.stops) }) }));
  };
  // The side strips run the region's whole height, their corners in the corner's colour; the top and bottom strips
  // lie between them.
  if (flag.x > region.x) add('left', region.x, region.y, flag.x - region.x + under, region.h, 'y');
  if (right < regionRight) add('right', right - under, region.y, regionRight - right + under, region.h, 'y');
  const x0 = Math.max(region.x, flag.x), x1 = Math.min(regionRight, right);
  if (flag.y > region.y) add('top', x0, region.y, x1 - x0, flag.y - region.y + under, 'x');
  if (bottom < regionBottom) add('bottom', x0, bottom - under, x1 - x0, regionBottom - bottom + under, 'x');
  return Object.freeze(out);
}

/**
 * The lip over a flag's edge on a strip's `side` (see UNDERLAP), drawn at `scale` device px per map unit (0: unknown):
 * it straddles the edge, so it covers the whole of every pixel the edge crosses. → { x, y, w, h } in map units.
 */
export function flagLip(flag, side, scale = 0) {
  const cap = UNDERLAP * Math.min(flag.w, flag.h), px = scale > 0 ? LIP_PX / scale : 0;
  const across = Math.min(cap, Math.max(px, LIP_UNITS * (side === 'left' || side === 'right' ? flag.w / FLAG_WIDTH : flag.h / FLAG_HEIGHT)));
  if (side === 'left') return { x: flag.x - across, y: flag.y, w: 2 * across, h: flag.h };
  if (side === 'right') return { x: flag.x + flag.w - across, y: flag.y, w: 2 * across, h: flag.h };
  if (side === 'top') return { x: flag.x, y: flag.y - across, w: flag.w, h: 2 * across };
  return { x: flag.x, y: flag.y + flag.h - across, w: flag.w, h: 2 * across };
}

const LAYOUTS = new WeakMap(); // region → Map(fit → layout)
/**
 * A region's whole-flag layout for a flag's fit: `{ kind, flag: { x, y, w, h }, strips: [{ side, x, y, w, h, axis,
 * from, to, color | stops }] }`, flag the box the artwork fills (its own proportions unless its kind may stretch) and
 * strips the rest of the region's box (BANNER_PAD around it), reaching under the flag's edge (an SVG's also gets a lip
 * over it, flagLip). Kept per region object and fit. → null without a fit or land (the flag then fills its region's box).
 */
export function layoutFlagFit(component, fit) {
  if (!component || typeof component !== 'object' || !finiteBox(component.bbox) || !fit || !Object.values(KINDS).includes(fit.kind)) return null;
  let layouts = LAYOUTS.get(component);
  if (!layouts) LAYOUTS.set(component, layouts = new Map());
  if (!layouts.has(fit)) {
    const flag = flagBox(component, fit);
    const b = component.bbox;
    const region = { x: b.x - BANNER_PAD, y: b.y - BANNER_PAD, w: b.w + 2 * BANNER_PAD, h: b.h + 2 * BANNER_PAD };
    layouts.set(fit, finiteBox(flag) ? Object.freeze({ kind: fit.kind, flag: Object.freeze(flag), strips: strips(region, flag, fit) }) : null);
  }
  return layouts.get(fit);
}
