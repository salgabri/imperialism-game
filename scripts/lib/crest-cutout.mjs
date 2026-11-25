// A crest cut out of the picture it was saved on (docs/design/period-marks.md, "Cutouts"), for
// scripts/lib/crest-image.mjs. Many of the pictures the crests come from have no transparency, or only outside the crest:
// an old GIF or JPEG on white paper, a PNG whose white was cleared round the crest but not inside its letters. Drawn on a
// club's land, the paper shows as white. A crest's record says what of its picture is paper:
//
//   background   '#rrggbb', the colour of the box the crest was saved on. It is cleared from the picture's edges (and
//                from what is transparent already) inwards, through every pixel within `tolerance` of that colour, so the
//                crest's own areas of the colour inside its outline stay
//   tolerance    how far from that colour a pixel may be, per channel, and still be box (40; a JPEG's noisy box or a grey
//                drop shadow takes more, a pale crest less)
//   inset        the pixels along the picture's edges that are a frame, not crest: one number, or 'top right bottom left'
//   clear        areas inside the crest that are paper too: 'enclosed' for every one the box leaves (a wordmark's
//                counters), or 'x,y x,y …', a point of the original in each
//   keep         with clear 'enclosed', the areas that are the crest's own white: 'x,y x,y …'
//
// Points are pixels of the original (an SVG's as crestWebp draws it). What is cleared keeps a clean edge: a pixel beside
// it that mixes the paper's colour with the crest's becomes the crest's colour, as transparent as the mix was pale, so no
// light fringe shows on a dark land.
import assert from 'node:assert/strict';

const TOLERANCE = 40;
const CLEAR = 16; // an alpha below this is transparent
const FAINT = 110; // a pixel this near the box's colour, per channel, is no more than a trace of the crest
const HEX = /^#[0-9a-f]{6}$/;
const POINTS = /^\d+,\d+(?: \d+,\d+)*$/;
const RINGS = 3; // how far from what is cleared a pixel may still mix its colour
const FIELDS = ['background', 'tolerance', 'inset', 'clear', 'keep'];

const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const points = text => text.split(' ').map(point => point.split(',').map(Number));
const byte = value => Math.max(0, Math.min(255, Math.round(value)));

/** The cut a crest's record asks for (the fields above), checked, or null for a picture drawn whole. */
export function cutOf(record, label = 'crest') {
  const cut = {};
  for (const field of FIELDS) if (record?.[field] !== undefined) cut[field] = record[field];
  if (!Object.keys(cut).length) return null;
  const { background, tolerance, inset, clear, keep } = cut;
  assert(background === undefined || HEX.test(background), `${label}: background is a #rrggbb colour`);
  assert(tolerance === undefined || (Number.isInteger(tolerance) && tolerance > 0 && tolerance < 256), `${label}: tolerance is 1 to 255`);
  assert(inset === undefined || Number.isInteger(inset) || /^\d+ \d+ \d+ \d+$/.test(inset), `${label}: inset is a number of pixels, or 'top right bottom left'`);
  assert(clear === undefined || clear === 'enclosed' || POINTS.test(clear), `${label}: clear is 'enclosed' or points 'x,y x,y'`);
  assert(keep === undefined || (clear === 'enclosed' && POINTS.test(keep)), `${label}: keep is points 'x,y x,y', with clear 'enclosed'`);
  assert(background !== undefined || clear !== undefined, `${label}: a cut names a background or areas to clear`);
  assert(background !== undefined || (inset === undefined && clear !== 'enclosed'), `${label}: inset and clear 'enclosed' need the box's colour (background)`);
  return cut;
}

/** An RGBA picture ({ data, width, height }) cut as `cut` (cutOf) says: the same size, its paper transparent. */
export function cutOut(picture, cut) {
  const { width, height } = picture;
  const N = width * height;
  const tolerance = cut.tolerance ?? TOLERANCE;
  const box = cut.background ? rgb(cut.background) : null;
  const data = Buffer.from(picture.data);
  if (cut.inset !== undefined) paintFrame(data, width, height, box, cut.inset);
  const image = { data, width, height, tolerance };
  // 0: the crest; else the colour the pixel was cleared as, by its place in `papers`.
  const cleared = new Uint8Array(N);
  const papers = [null, box ?? [255, 255, 255]];
  if (box) {
    const edges = [];
    for (let x = 0; x < width; x++) edges.push(x, (height - 1) * width + x);
    for (let y = 0; y < height; y++) edges.push(y * width, y * width + width - 1);
    flood(image, cleared, edges, 1, p => data[p * 4 + 3] < CLEAR || isNear(image, p, box));
    clearPockets(image, cleared, box);
  }
  if (cut.clear === 'enclosed') {
    const kept = new Set((cut.keep ? points(cut.keep) : []).map(([x, y]) => y * width + x));
    for (const area of areasOf(image, cleared, box)) {
      if (area.length >= 3 && !area.some(p => kept.has(p))) for (const p of area) cleared[p] = 1;
    }
    clearPockets(image, cleared, box);
  } else if (cut.clear) {
    for (const [x, y] of points(cut.clear)) {
      const p = y * width + x;
      assert(x < width && y < height, `point ${x},${y} is outside the ${width}x${height} picture`);
      if (cleared[p]) continue;
      // A point on the box's colour (white, with no box) clears as that colour; any other, as its own.
      const paper = isNear(image, p, papers[1]) ? papers[1] : [data[p * 4], data[p * 4 + 1], data[p * 4 + 2]];
      if (paper !== papers[1]) papers.push(paper);
      flood(image, cleared, [p], papers.lastIndexOf(paper), q => data[q * 4 + 3] >= CLEAR && isNear(image, q, paper));
    }
    if (box) clearPockets(image, cleared, box);
  }
  const out = softenEdges(image, cleared, papers);
  if (box) dropCrumbs(out, width, height, box);
  return { data: out, width, height };
}

/** The areas of colour `hex` inside a crest that the box's clearing leaves, as `clear` and `keep` name them, the largest
 * first: { size, at: [x, y] (its innermost pixel), box: [left, top, right, bottom], touches (the clear outside) }. */
export function enclosedAreas(picture, cut) {
  const { width, height } = picture;
  const tolerance = cut.tolerance ?? TOLERANCE, box = rgb(cut.background ?? '#ffffff');
  const data = Buffer.from(picture.data);
  if (cut.inset !== undefined) paintFrame(data, width, height, box, cut.inset);
  const image = { data, width, height, tolerance };
  const cleared = new Uint8Array(width * height);
  if (cut.background) {
    const edges = [];
    for (let x = 0; x < width; x++) edges.push(x, (height - 1) * width + x);
    for (let y = 0; y < height; y++) edges.push(y * width, y * width + width - 1);
    flood(image, cleared, edges, 1, p => data[p * 4 + 3] < CLEAR || isNear(image, p, box));
    clearPockets(image, cleared, box);
  }
  return areasOf(image, cleared, box).map(pixels => {
    const area = { size: pixels.length, pixels, box: boxOf(pixels, width), touches: pixels.some(p => besideClear(image, cleared, p, box)) };
    area.at = innermost(area, width);
    return area;
  }).sort((a, b) => b.size - a.size);
}

const isNear = ({ data, tolerance }, p, [r, g, b]) => {
  const i = p * 4;
  return Math.abs(data[i] - r) <= tolerance && Math.abs(data[i + 1] - g) <= tolerance && Math.abs(data[i + 2] - b) <= tolerance;
};

/** Each of pixel p's eight neighbours, as fn(q). */
function around(p, width, height, fn) {
  const x = p % width, y = (p - x) / width;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const nx = x + dx, ny = y + dy;
    if ((dx || dy) && nx >= 0 && ny >= 0 && nx < width && ny < height) fn(ny * width + nx);
  }
}

/** Clears, as `value`, every pixel reached from `starts` side by side through those `passes` lets by. */
function flood({ width, height }, cleared, starts, value, passes) {
  const stack = [];
  const reach = p => { if (!cleared[p] && passes(p)) { cleared[p] = value; stack.push(p); } };
  for (const p of starts) reach(p);
  while (stack.length) {
    const p = stack.pop(), x = p % width;
    if (x > 0) reach(p - 1);
    if (x < width - 1) reach(p + 1);
    if (p >= width) reach(p - width);
    if (p < (height - 1) * width) reach(p + width);
  }
}

/** The areas (lists of pixels joined side by side) of colour `box` not cleared. */
function areasOf(image, cleared, box) {
  const { data, width, height } = image;
  const seen = new Uint8Array(width * height);
  const areas = [];
  for (let start = 0; start < seen.length; start++) {
    if (seen[start] || cleared[start] || data[start * 4 + 3] < 128 || !isNear(image, start, box)) continue;
    const area = [start];
    seen[start] = 1;
    for (let k = 0; k < area.length; k++) {
      const p = area[k], x = p % width;
      for (const q of [x > 0 ? p - 1 : -1, x < width - 1 ? p + 1 : -1, p - width, p + width]) {
        if (q < 0 || q >= seen.length || seen[q] || cleared[q] || data[q * 4 + 3] < 128 || !isNear(image, q, box)) continue;
        seen[q] = 1;
        area.push(q);
      }
    }
    areas.push(area);
  }
  return areas;
}

/** Whether what is cleared lies beside p, or past one faint pixel (one near the box's colour) beside p. */
function besideClear(image, cleared, p, box) {
  const { data, width, height } = image;
  let beside = false;
  around(p, width, height, q => {
    if (cleared[q]) beside = true;
    else if (!beside && data[q * 4 + 3] >= CLEAR && isNear({ data, tolerance: FAINT }, q, box)) around(q, width, height, r => { if (cleared[r]) beside = true; });
  });
  return beside;
}

/** Tiny areas of the box's colour with no more than a faint pixel between them and what is cleared (a JPEG's speckle, a
 * notch in a blurred edge) go with it. */
function clearPockets(image, cleared, box) {
  const limit = Math.max(4, cleared.length * 0.0002);
  for (const area of areasOf(image, cleared, box)) {
    if (area.length <= limit && area.some(p => besideClear(image, cleared, p, box))) for (const p of area) cleared[p] = 1;
  }
}

/** The frame along the picture's edges painted in the box's colour. */
function paintFrame(data, width, height, box, inset) {
  const [top, right, bottom, left] = Number.isInteger(inset) ? [inset, inset, inset, inset] : inset.split(' ').map(Number);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (y >= top && y < height - bottom && x >= left && x < width - right) continue;
    data.set([...box, 255], (y * width + x) * 4);
  }
}

/**
 * The picture's pixels with the cleared ones transparent, and those at their edge that mix the paper's colour with the
 * crest's un-mixed: the crest's colour there is that of a pixel further in, of the same hue and further from the paper;
 * the mixed pixel takes it, as transparent as it was pale. A pixel beside the crest's own white (an area of the paper's
 * colour that is not cleared) stays as it is: its mix is with that.
 */
function softenEdges({ data, width, height, tolerance }, cleared, papers) {
  const N = width * height;
  const out = Buffer.from(data);
  const ring = new Uint8Array(N).fill(99);
  const paper = new Uint8Array(N); // which paper lies beside a pixel near what is cleared
  let front = [];
  for (let p = 0; p < N; p++) if (cleared[p]) { ring[p] = 0; paper[p] = cleared[p]; out[p * 4 + 3] = 0; front.push(p); }
  const rings = [];
  for (let k = 1; k <= RINGS; k++) {
    const next = [];
    for (const p of front) around(p, width, height, q => { if (ring[q] === 99) { ring[q] = k; paper[q] = paper[p]; next.push(q); } });
    rings.push(next);
    front = next;
  }
  const from = (p, [r, g, b]) => [data[p * 4] - r, data[p * 4 + 1] - g, data[p * 4 + 2] - b];
  const own = (p, colour) => !cleared[p] && data[p * 4 + 3] >= 128 && from(p, colour).every(d => Math.abs(d) <= tolerance);
  for (let k = 1; k <= RINGS; k++) for (const p of rings[k - 1]) {
    const i = p * 4;
    if (data[i + 3] < CLEAR) continue;
    const colour = papers[paper[p]];
    const mix = from(p, colour), length = Math.hypot(...mix);
    if (length < 1 || (k > 1 && length > 240)) continue;
    let beside = own(p, colour);
    if (!beside) around(p, width, height, q => { if (own(q, colour)) beside = true; });
    if (beside) continue;
    const x = p % width, y = (p - x) / width;
    let best = null, bestScore = -Infinity;
    for (let ny = Math.max(0, y - 3); ny <= Math.min(height - 1, y + 3); ny++) for (let nx = Math.max(0, x - 3); nx <= Math.min(width - 1, x + 3); nx++) {
      const q = ny * width + nx;
      if (q === p || cleared[q] || data[q * 4 + 3] < 128) continue;
      const reach = Math.max(Math.abs(nx - x), Math.abs(ny - y));
      if (ring[q] <= k && (k > 1 || reach > 2)) continue;
      const full = from(q, colour), strength = Math.hypot(...full);
      if (strength <= length * 1.04) continue; // no further from the paper than the pixel itself
      if ((mix[0] * full[0] + mix[1] * full[1] + mix[2] * full[2]) / (length * strength) < 0.93) continue; // another hue
      const score = Math.min(ring[q], 4) * 40 - reach * 25 + strength / 8; // further in, then nearer, then stronger
      if (score > bestScore) { bestScore = score; best = strength; }
    }
    if (best === null) continue;
    const share = length / best;
    if (share > 0.96) continue;
    for (let c = 0; c < 3; c++) out[i + c] = byte(colour[c] + mix[c] / share);
    out[i + 3] = Math.round(data[i + 3] * share);
  }
  return out;
}

/** Faint specks left alone in what is cleared go too: small islands never far from the box's colour. */
function dropCrumbs(data, width, height, box) {
  const N = width * height;
  const limit = Math.max(6, N * 0.0006);
  const seen = new Uint8Array(N);
  for (let start = 0; start < N; start++) {
    if (seen[start] || data[start * 4 + 3] < 8) continue;
    const island = [start];
    let strongest = 0;
    seen[start] = 1;
    for (let k = 0; k < island.length; k++) {
      const i = island[k] * 4, alpha = data[i + 3] / 255;
      for (let c = 0; c < 3; c++) strongest = Math.max(strongest, alpha * Math.abs(data[i + c] - box[c]));
      around(island[k], width, height, q => { if (!seen[q] && data[q * 4 + 3] >= 8) { seen[q] = 1; island.push(q); } });
    }
    if (island.length <= limit && strongest < FAINT) for (const p of island) data[p * 4 + 3] = 0;
  }
}

function boxOf(pixels, width) {
  let left = Infinity, top = Infinity, right = 0, bottom = 0;
  for (const p of pixels) {
    const x = p % width, y = (p - x) / width;
    left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
  }
  return [left, top, right, bottom];
}

/** An area's pixel furthest from its border (a chessboard distance over its box), as [x, y]. */
function innermost({ pixels, box: [left, top, right, bottom] }, width) {
  const w = right - left + 3, h = bottom - top + 3;
  const depth = new Uint16Array(w * h);
  for (const p of pixels) depth[((p - p % width) / width - top + 1) * w + (p % width - left + 1)] = 60000;
  for (let i = w + 1; i < w * (h - 1) - 1; i++) if (depth[i]) depth[i] = Math.min(depth[i], depth[i - 1] + 1, depth[i - w] + 1, depth[i - w - 1] + 1, depth[i - w + 1] + 1);
  let best = -1, at = 0;
  for (let i = w * (h - 1) - 2; i > w; i--) if (depth[i]) {
    depth[i] = Math.min(depth[i], depth[i + 1] + 1, depth[i + w] + 1, depth[i + w + 1] + 1, depth[i + w - 1] + 1);
    if (depth[i] > best) { best = depth[i]; at = i; }
  }
  return [at % w - 1 + left, Math.floor(at / w) - 1 + top];
}
