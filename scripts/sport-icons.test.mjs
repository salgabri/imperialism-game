// The sport tiles' icons (src/components/Icon.jsx), drawn to one size as its comment sets out. Each sport's glyph is
// rendered by sharp at 20 px a unit of the 24 grid and its ink measured: the box of the pixels at least half inked; the
// convex hull of each row's inked ends, whose area stands for how far the glyph reaches; and its silhouette, the ink
// closed by half a unit and every hole in it filled, whose area stands for how much of that reach its outlines fill.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { build } from 'esbuild';
import sharp from 'sharp';
import { SPORT_LIST } from '../src/sports/index.js';

const compiled = await build({
  entryPoints: [fileURLToPath(new URL('../src/components/Icon.jsx', import.meta.url))],
  bundle: true, write: false, platform: 'node', format: 'cjs', external: ['react'], logLevel: 'silent',
});
const module = { exports: {} };
new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const Icon = module.exports.default;

const PX = 20;
const markup = name => renderToStaticMarkup(React.createElement(Icon, { name, size: 24 * PX }))
  .replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ');

/** The mask grown by a disc of radius r px. */
function dilate(mask, width, height, r) {
  const out = mask.slice(), disc = [];
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r) disc.push([dx, dy]);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x;
    if (!mask[i] || (x > 0 && x < width - 1 && y > 0 && y < height - 1 && mask[i - 1] && mask[i + 1] && mask[i - width] && mask[i + width])) continue;
    for (const [dx, dy] of disc) {
      const X = x + dx, Y = y + dy;
      if (X >= 0 && X < width && Y >= 0 && Y < height) out[Y * width + X] = 1;
    }
  }
  return out;
}

/** The glyph's ink in grid units: its box's size and centre, its convex hull's area and its filled silhouette's. */
async function measure(name) {
  const { data, info: { width, height } } = await sharp(Buffer.from(markup(name))).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const ink = new Uint8Array(width * height);
  for (let i = 0; i < ink.length; i++) ink[i] = data[i * 4 + 3] >= 128 ? 1 : 0;
  const points = [];
  let x0 = width, y0 = height, x1 = 0, y1 = 0;
  for (let y = 0; y < height; y++) {
    let left = -1, right = -1;
    for (let x = 0; x < width; x++) if (ink[y * width + x]) { if (left < 0) left = x; right = x + 1; }
    if (left < 0) continue;
    x0 = Math.min(x0, left); x1 = Math.max(x1, right); y0 = Math.min(y0, y); y1 = y + 1;
    points.push([left, y], [left, y + 1], [right, y], [right, y + 1]);
  }
  // Andrew's monotone chain, then the shoelace.
  points.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const chain = list => list.reduce((hull, p) => {
    while (hull.length >= 2 && cross(hull.at(-2), hull.at(-1), p) <= 0) hull.pop();
    hull.push(p);
    return hull;
  }, []);
  const hull = chain(points).slice(0, -1).concat(chain(points.slice().reverse()).slice(0, -1));
  const area = Math.abs(hull.reduce((sum, [ax, ay], i) => { const [bx, by] = hull[(i + 1) % hull.length]; return sum + ax * by - bx * ay; }, 0)) / 2;
  // Close the ink (grow it, then shrink it back, by half a unit) and flood the background in from the border: whatever
  // the flood can't reach is the silhouette.
  const r = PX / 2, invert = mask => mask.map(v => 1 - v);
  const closed = invert(dilate(invert(dilate(ink, width, height, r)), width, height, r));
  const outside = new Uint8Array(width * height), stack = [];
  for (let x = 0; x < width; x++) stack.push(x, (height - 1) * width + x);
  for (let y = 0; y < height; y++) stack.push(y * width, y * width + width - 1);
  while (stack.length) {
    const i = stack.pop();
    if (outside[i] || closed[i]) continue;
    outside[i] = 1;
    const x = i % width;
    if (x > 0) stack.push(i - 1);
    if (x < width - 1) stack.push(i + 1);
    if (i >= width) stack.push(i - width);
    if (i + width < width * height) stack.push(i + width);
  }
  const silhouette = outside.reduce((sum, v) => sum + 1 - v, 0);
  return { w: (x1 - x0) / PX, h: (y1 - y0) / PX, cx: (x0 + x1) / 2 / PX, cy: (y0 + y1) / 2 / PX, area: area / PX / PX, silhouette: silhouette / PX / PX };
}

test('every sport has a glyph of its own, not the globe Icon falls back to', () => {
  for (const sport of SPORT_LIST) assert.notEqual(markup(sport.id), markup('globe'), sport.id);
});

test("every sport's glyph is centred and fills the balls' square", async () => {
  const ball = await measure('football');
  assert.ok(Math.abs(ball.w - 19.6) < 0.1 && Math.abs(ball.h - 19.6) < 0.1, `the ball is ${ball.w}×${ball.h}`);
  for (const sport of SPORT_LIST) {
    const m = await measure(sport.id), reach = m.area / ball.area, fill = m.silhouette / ball.silhouette;
    const where = `${sport.id}: ${m.w.toFixed(2)}×${m.h.toFixed(2)} centred on ${m.cx.toFixed(2)},${m.cy.toFixed(2)}, `
      + `${(100 * reach).toFixed(1)}% of the ball's hull, ${(100 * fill).toFixed(1)}% of its silhouette`;
    assert.ok(Math.abs(m.cx - 12) <= 0.15 && Math.abs(m.cy - 12) <= 0.15, `${where}: off centre`);
    assert.ok(Math.max(m.w, m.h) <= 22.4, `${where}: wider than 22.4`);
    assert.ok(reach >= 0.95, `${where}: reaches less far than the balls`);
    assert.ok(reach <= 1.1, `${where}: reaches further than the balls`);
    // Open strokes (sticks, posts) fill under half of a ball; a glyph drawn as outlines fills at least three quarters.
    assert.ok(fill < 0.5 || fill >= 0.75, `${where}: its outlines leave its reach too empty`);
  }
});
