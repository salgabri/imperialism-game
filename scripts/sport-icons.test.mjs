// The sport tiles' icons (src/components/Icon.jsx), drawn to one size as its comment sets out: every glyph fills the
// balls' square. Each sport's glyph is rendered by sharp at 20 px a unit of the 24 grid and the box of its pixels at
// least half inked is measured, in grid units.
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

/** The box of the glyph's ink in grid units: its width, height and centre. */
async function measure(name) {
  const { data, info: { width, height } } = await sharp(Buffer.from(markup(name))).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let x0 = width, y0 = height, x1 = 0, y1 = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (data[(y * width + x) * 4 + 3] < 128) continue;
    x0 = Math.min(x0, x); x1 = Math.max(x1, x + 1); y0 = Math.min(y0, y); y1 = Math.max(y1, y + 1);
  }
  return { w: (x1 - x0) / PX, h: (y1 - y0) / PX, cx: (x0 + x1) / 2 / PX, cy: (y0 + y1) / 2 / PX };
}

test('every sport has a glyph of its own, not the globe Icon falls back to', () => {
  for (const sport of SPORT_LIST) assert.notEqual(markup(sport.id), markup('globe'), sport.id);
});

test("every sport's glyph fills the balls' square: as wide, as tall and centred", async () => {
  const ball = await measure('football');
  assert.ok(Math.abs(ball.w - 19.6) < 0.1 && Math.abs(ball.h - 19.6) < 0.1, `the ball is ${ball.w}×${ball.h}`);
  for (const sport of SPORT_LIST) {
    const m = await measure(sport.id);
    const where = `${sport.id}: ${m.w.toFixed(2)}×${m.h.toFixed(2)} centred on ${m.cx.toFixed(2)},${m.cy.toFixed(2)}, the ball ${ball.w}×${ball.h}`;
    assert.ok(Math.abs(m.w - ball.w) <= 0.15, `${where}: not as wide as the ball`);
    assert.ok(Math.abs(m.h - ball.h) <= 0.15, `${where}: not as tall as the ball`);
    assert.ok(Math.abs(m.cx - 12) <= 0.15 && Math.abs(m.cy - 12) <= 0.15, `${where}: off centre`);
  }
});
