// Compile the real renderer in memory and inspect its SVG coordinate contract.
// These tests catch distortion caused by a normalized parent viewBox even when
// the child emblem image itself claims preserveAspectRatio="meet".
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { FLAG_SYMBOLS } from '../src/data/flagSymbols.js';

const compiled = await build({
  entryPoints: [fileURLToPath(new URL('../src/components/FlagPattern.jsx', import.meta.url))],
  bundle: true, write: false, platform: 'node', format: 'cjs', external: ['react'],
  jsx: 'automatic', loader: { '.css': 'empty' }, logLevel: 'silent',
});
const module = { exports: {} };
new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const FlagPattern = module.exports.default;
const dom = new JSDOM('<!doctype html><html><body></body></html>');
after(() => dom.window.close());

const box = element => Object.fromEntries([['x', 'x'], ['y', 'y'], ['w', 'width'], ['h', 'height']]
  .map(([key, attribute]) => [key, Number(element.getAttribute(attribute))]));
const worldBox = (element, pattern) => {
  const local = box(element), origin = box(pattern);
  return { ...local, x: local.x + origin.x, y: local.y + origin.y };
};
const approx = (actual, expected, message = '') => assert.ok(Math.abs(actual - expected) < 1e-8, `${message}: ${actual} ≠ ${expected}`);

function render(...flags) {
  const host = dom.window.document.createElement('div');
  host.innerHTML = renderToStaticMarkup(React.createElement('svg', { viewBox: '-50 -60 900 500' },
    React.createElement('defs', null, flags.map(flag => React.createElement(FlagPattern, { key: flag.id, flag })))));
  return host.querySelector('svg');
}

function nativeFlag(overrides = {}) {
  return { id: '276-mainland', ownerId: '276', url: '/flags/de.svg', color: '#3c493a',
    bbox: { x: 123.4, y: -32.6, w: 250.2, h: 57.8 }, symbolLayout: null, ...overrides };
}

function symbolFlag(code = 'ch', overrides = {}) {
  const profile = FLAG_SYMBOLS[code];
  const scale = .075;
  return nativeFlag({ id: `${code}-mainland`, ownerId: code, url: `/flags/${code}.svg`,
    symbolProfile: profile, fieldUrl: `/${profile.fieldFile}`, symbolUrl: `/${profile.symbolFile}`,
    symbolLayout: {
      field: { x: 120, y: -40, w: 270, h: 90 },
      symbol: { x: 194, y: -22, w: profile.bounds.w * scale, h: profile.bounds.h * scale },
    }, ...overrides });
}

function assertUserSpace(pattern, flag) {
  assert.equal(pattern.id, `fi-flag-${flag.id}`);
  assert.equal(pattern.dataset.owner, flag.ownerId);
  assert.equal(pattern.dataset.flagSource, flag.url, 'original flag provenance survives separation');
  assert.equal(pattern.getAttribute('patternUnits'), 'userSpaceOnUse');
  assert.equal(pattern.getAttribute('patternContentUnits'), 'userSpaceOnUse');
  assert.equal(pattern.hasAttribute('viewBox'), false, 'no normalized parent can stretch the emblem non-uniformly');
  assert.equal(pattern.hasAttribute('patternTransform'), false);
  assert.equal(pattern.querySelector('[viewBox], [transform], [style*="transform"]'), null);
  assert.deepEqual(box(pattern), flag.bbox);
  const fallback = pattern.querySelector('rect');
  assert.deepEqual(box(fallback), { x: 0, y: 0, w: flag.bbox.w, h: flag.bbox.h },
    'the pattern origin positions its local contents exactly once');
  assert.deepEqual(worldBox(fallback, pattern), flag.bbox, 'local field maps to the geographic region');
  assert.equal(fallback.getAttribute('fill'), flag.color);
  assert.equal(pattern.querySelectorAll('rect').length, 1, 'no outside badge or border background');
  assert.equal(pattern.children.length, pattern.querySelectorAll('image').length + 1, 'one field rect and only the specified artwork layers');
  assert.ok([...pattern.children].every(node => ['rect', 'image'].includes(node.localName)));
  assert.equal(fallback.hasAttribute('stroke'), false);
}

test('native banners keep one original owner asset at the geographic pattern origin', () => {
  const flag = nativeFlag();
  const pattern = render(flag).querySelector('pattern');
  assertUserSpace(pattern, flag);
  assert.equal(pattern.dataset.flagLayout, 'native');
  const images = [...pattern.querySelectorAll('image')];
  assert.equal(images.length, 1);
  assert.equal(images[0].getAttribute('href'), flag.url);
  assert.equal(images[0].getAttribute('preserveAspectRatio'), 'none');
  assert.deepEqual(box(images[0]), { x: 0, y: 0, w: flag.bbox.w, h: flag.bbox.h });
  assert.deepEqual(worldBox(images[0], pattern), flag.bbox);
  assert.equal(pattern.querySelector('[data-flag-symbol], [data-flag-field]'), null);
});

test('symbol-aware banners contain exactly one stretched field and one undistorted emblem', () => {
  for (const code of Object.keys(FLAG_SYMBOLS)) {
    const flag = symbolFlag(code), pattern = render(flag).querySelector('pattern');
    assertUserSpace(pattern, flag);
    assert.equal(pattern.dataset.flagLayout, 'symbol-aware');
    assert.equal(pattern.querySelectorAll('image').length, 2);
    assert.equal(pattern.querySelectorAll('[data-flag-field]').length, 1);
    assert.equal(pattern.querySelectorAll('[data-flag-symbol]').length, 1);
    const field = pattern.querySelector('[data-flag-field]'), symbol = pattern.querySelector('[data-flag-symbol]');
    assert.equal(field.getAttribute('href'), `/${FLAG_SYMBOLS[code].fieldFile}`);
    assert.equal(symbol.getAttribute('href'), `/${FLAG_SYMBOLS[code].symbolFile}`);
    assert.equal(field.getAttribute('preserveAspectRatio'), 'none');
    assert.equal(symbol.getAttribute('preserveAspectRatio'), 'xMidYMid meet');
    assert.deepEqual(worldBox(field, pattern), flag.symbolLayout.field);
    assert.deepEqual(worldBox(symbol, pattern), flag.symbolLayout.symbol);
    assert.equal(pattern.querySelector(`image[href="${flag.url}"]`), null, 'the emblem is not duplicated over the original flag');
    approx(box(symbol).w / box(symbol).h, flag.symbolProfile.bounds.w / flag.symbolProfile.bounds.h, `${code} retains its native symbol proportions`);
  }
});

test('circle and cross proportions survive wide, narrow, translated and fractional map regions', () => {
  for (const code of ['jp', 'ch', 'pt', 'kz']) for (const bbox of [
    { x: -900, y: 35, w: 500, h: 30 }, { x: 11, y: -712, w: 21, h: 560 },
    { x: .03125, y: -.0625, w: 2.5, h: .125 }, { x: 900, y: 1400, w: 600, h: 700 },
  ]) {
    const profile = FLAG_SYMBOLS[code];
    const scale = Math.min(bbox.w / profile.bounds.w, bbox.h / profile.bounds.h) * .8;
    const symbol = { x: bbox.x + (bbox.w - profile.bounds.w * scale) / 2,
      y: bbox.y + (bbox.h - profile.bounds.h * scale) / 2, w: profile.bounds.w * scale, h: profile.bounds.h * scale };
    const flag = symbolFlag(code, { bbox, symbolLayout: { field: { ...bbox }, symbol } });
    const pattern = render(flag).querySelector('pattern');
    assertUserSpace(pattern, flag);
    const actual = worldBox(pattern.querySelector('[data-flag-symbol]'), pattern);
    approx(actual.w / profile.bounds.w, actual.h / profile.bounds.h, `${code}: equal x/y map scale`);
    approx(actual.x + actual.w / 2, bbox.x + bbox.w / 2);
    approx(actual.y + actual.h / 2, bbox.y + bbox.h / 2);
  }
});

test('translated and negative map origins never double-offset flag contents', () => {
  const original = symbolFlag('pt');
  const shift = (rectangle, dx, dy) => ({ ...rectangle, x: rectangle.x + dx, y: rectangle.y + dy });
  for (const [dx, dy] of [[1000, 2000], [-1000, -2000], [.125, -.5]]) {
    const shifted = { ...original, bbox: shift(original.bbox, dx, dy), symbolLayout: {
      field: shift(original.symbolLayout.field, dx, dy), symbol: shift(original.symbolLayout.symbol, dx, dy),
    } };
    const before = render(original).querySelector('pattern'), after = render(shifted).querySelector('pattern');
    const a = [...before.children].map(box), b = [...after.children].map(box);
    for (let i = 0; i < a.length; i++) for (const key of ['x', 'y', 'w', 'h']) approx(a[i][key], b[i][key],
      'geographic translation changes only the tile origin, never local artwork');
    approx(box(after).x - box(before).x, dx);
    approx(box(after).y - box(before).y, dy);
    const emblem = worldBox(after.querySelector('[data-flag-symbol]'), after);
    approx(emblem.x, shifted.symbolLayout.symbol.x);
    approx(emblem.y, shifted.symbolLayout.symbol.y);
  }
});

test('missing or unavailable symbol layouts fall back to complete artwork without a partial banner', () => {
  for (const overrides of [{ symbolLayout: null }, { fieldUrl: null }, { symbolUrl: '' }]) {
    const flag = symbolFlag('pt', overrides), pattern = render(flag).querySelector('pattern');
    assertUserSpace(pattern, flag);
    assert.equal(pattern.dataset.flagLayout, 'native');
    assert.equal(pattern.querySelectorAll('image').length, 1);
    assert.equal(pattern.querySelector('image').getAttribute('href'), '/flags/pt.svg');
    assert.equal(pattern.querySelector('[data-flag-symbol], [data-flag-field]'), null);
  }
});

test('regional patterns have unique identities and fly their current conqueror’s artwork', () => {
  const flags = [symbolFlag('ch', { id: '756-mainland', ownerId: '756' }),
    symbolFlag('ch', { id: '756-guiana', ownerId: '756' }),
    symbolFlag('pt', { id: '620-mainland', ownerId: '620' }), nativeFlag()];
  const svg = render(...flags), patterns = [...svg.querySelectorAll('pattern')];
  assert.equal(patterns.length, flags.length);
  assert.equal(new Set([...svg.querySelectorAll('[id]')].map(node => node.id)).size, flags.length, 'no shared emblem marker IDs collide');
  patterns.forEach((pattern, index) => assertUserSpace(pattern, flags[index]));
  assert.equal(patterns[0].querySelector('[data-flag-symbol]').getAttribute('href'), patterns[1].querySelector('[data-flag-symbol]').getAttribute('href'));
  assert.notEqual(patterns[0].id, patterns[1].id, 'overseas and mainland regions remain separate banners');
  const conquered = symbolFlag('pt', { id: '756-mainland', ownerId: '620' });
  const changed = render(conquered).querySelector('pattern');
  assert.equal(changed.dataset.owner, '620');
  assert.equal(changed.dataset.flagSource, '/flags/pt.svg');
  assert.equal(changed.querySelector('[data-flag-symbol]').getAttribute('href'), `/${FLAG_SYMBOLS.pt.symbolFile}`);
});

test('flag layers remain inert, unlabelled paint rather than blocking map interaction', () => {
  for (const flag of [nativeFlag(), symbolFlag()]) {
    const pattern = render(flag).querySelector('pattern');
    assert.equal(pattern.getAttribute('pointer-events'), 'none');
    assert.equal(pattern.querySelector('[tabindex], [role], a, button, foreignObject'), null);
    assert.equal(pattern.querySelector('[pointer-events]:not([pointer-events="none"])'), null);
    assert.equal(pattern.querySelector('[stroke], [filter], mask, clipPath, use'), null, 'no extra outline, badge, shader or repeated symbol');
  }
});

test('every declared layer resolves to a vendored SVG with matching original coordinate bounds', async () => {
  for (const [code, profile] of Object.entries(FLAG_SYMBOLS)) {
    assert.equal(profile.fieldFile, `flags-symbols/${code}-field.svg`);
    assert.equal(profile.symbolFile, `flags-symbols/${code}-symbol.svg`);
    for (const [kind, file] of [['field', profile.fieldFile], ['symbol', profile.symbolFile]]) {
      const content = await readFile(new URL(`../public/${file}`, import.meta.url), 'utf8');
      const asset = new JSDOM(content, { contentType: 'image/svg+xml' });
      try {
        const root = asset.window.document.documentElement;
        assert.equal(root.localName, 'svg');
        const actual = root.getAttribute('viewBox').trim().split(/[\s,]+/).map(Number);
        assert.deepEqual(actual, kind === 'field' ? [0, 0, profile.sourceWidth, profile.sourceHeight]
          : [profile.bounds.x, profile.bounds.y, profile.bounds.w, profile.bounds.h], `${code} ${kind} bounds match metadata`);
        assert.equal(root.getAttribute('preserveAspectRatio'), kind === 'field' ? 'none' : 'xMidYMid meet');
        assert.equal(root.querySelector('script, foreignObject, image[href^="http"]'), null, 'layers are self-contained local SVG artwork');
      } finally { asset.window.close(); }
    }
  }
});
