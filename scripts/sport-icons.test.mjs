// The sport tiles' icons (src/components/Icon.jsx), drawn to one size as its comment sets out. Each sport's glyph is
// rendered by sharp at 20 px a unit of the 24 grid and its ink measured: the box of the pixels at least half inked, and
// the convex hull of each row's inked ends, whose area stands for how big the glyph looks.
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

/** The glyph's ink in grid units: its box's size and centre, and its convex hull's area. */
async function measure(name) {
  const { data, info: { width, height } } = await sharp(Buffer.from(markup(name))).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const points = [];
  let x0 = width, y0 = height, x1 = 0, y1 = 0;
  for (let y = 0; y < height; y++) {
    let left = -1, right = -1;
    for (let x = 0; x < width; x++) if (data[(y * width + x) * 4 + 3] >= 128) { if (left < 0) left = x; right = x + 1; }
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
  const lower = chain(points), upper = chain(points.slice().reverse());
  const hull = lower.slice(0, -1).concat(upper.slice(0, -1));
  const area = Math.abs(hull.reduce((sum, [ax, ay], i) => { const [bx, by] = hull[(i + 1) % hull.length]; return sum + ax * by - bx * ay; }, 0)) / 2;
  return { w: (x1 - x0) / PX, h: (y1 - y0) / PX, cx: (x0 + x1) / 2 / PX, cy: (y0 + y1) / 2 / PX, area: area / PX / PX };
}

test('every sport has a glyph of its own, not the globe Icon falls back to', () => {
  for (const sport of SPORT_LIST) assert.notEqual(markup(sport.id), markup('globe'), sport.id);
});

test("every sport's glyph is centred and as big as the balls, within the cap", async () => {
  const ball = await measure('football');
  assert.ok(Math.abs(ball.w - 19.6) < 0.1 && Math.abs(ball.h - 19.6) < 0.1, `the ball is ${ball.w}×${ball.h}`);
  for (const sport of SPORT_LIST) {
    const m = await measure(sport.id), span = Math.max(m.w, m.h), share = m.area / ball.area;
    const where = `${sport.id}: ${m.w.toFixed(2)}×${m.h.toFixed(2)} centred on ${m.cx.toFixed(2)},${m.cy.toFixed(2)}, ${(100 * share).toFixed(1)}% of the ball's area`;
    assert.ok(Math.abs(m.cx - 12) <= 0.15 && Math.abs(m.cy - 12) <= 0.15, `${where}: off centre`);
    assert.ok(span <= 21.7, `${where}: past the cap`);
    assert.ok(share <= 1.03, `${where}: bigger than the balls`);
    // A shape that can't cover the ball's area within the cap still spans at least 20 (the ball spans 19.6).
    assert.ok(share >= 0.97 || span >= 20, `${where}: smaller than the balls`);
  }
});
