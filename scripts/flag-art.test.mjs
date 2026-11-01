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
  entryPoints: [fileURLToPath(new URL('../src/components/FlagArt.jsx', import.meta.url))],
  bundle: true, write: false, platform: 'node', format: 'cjs', external: ['react'],
  jsx: 'automatic', loader: { '.css': 'empty' }, logLevel: 'silent',
});
const module = { exports: {} };
new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const FlagArt = module.exports.default;
const dom = new JSDOM('<!doctype html><html><body></body></html>');
after(() => dom.window.close());

const box = element => Object.fromEntries([['x', 'x'], ['y', 'y'], ['w', 'width'], ['h', 'height']]
  .map(([key, attribute]) => [key, Number(element.getAttribute(attribute))]));
const approx = (actual, expected, message = '') => assert.ok(Math.abs(actual - expected) < 1e-8, `${message}: ${actual} ≠ ${expected}`);

function render(...flags) {
  const host = dom.window.document.createElement('div');
  host.innerHTML = renderToStaticMarkup(React.createElement('svg', { viewBox: '-50 -60 900 500' },
    React.createElement('defs', null, flags.map(flag => React.createElement(FlagArt, { key: flag.id, flag })))));
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

function assertMapSpace(banner, flag) {
  assert.equal(banner.localName, 'g', 'drawn artwork, never a <pattern> tile');
  assert.equal(banner.id, `fi-flag-${flag.id}`);
  assert.equal(banner.dataset.owner, flag.ownerId);
  assert.equal(banner.dataset.flagSource, flag.url, 'original flag provenance survives separation');
  assert.equal(banner.hasAttribute('viewBox'), false, 'no normalized parent can stretch the emblem non-uniformly');
  assert.equal(banner.hasAttribute('transform'), false);
  assert.equal(banner.querySelector('[viewBox], [transform], [style*="transform"]'), null);
  const fallback = banner.querySelector('rect');
  assert.deepEqual(box(fallback), flag.bbox, 'the field spans the geographic region in map coordinates');
  assert.equal(fallback.getAttribute('fill'), flag.color);
  assert.equal(banner.querySelectorAll('rect').length, 1, 'no outside badge or border background');
  assert.equal(banner.children.length, banner.querySelectorAll('image').length + 1, 'one field rect and only the specified artwork layers');
  assert.ok([...banner.children].every(node => ['rect', 'image'].includes(node.localName)));
  assert.equal(fallback.hasAttribute('stroke'), false);
}

test('a club crest is one undistorted emblem on the club colour, and small land keeps the plain colour', () => {
  const crest = nativeFlag({ id: 'f-arsenal-826', ownerId: 'f-arsenal', url: '/club-logos/f-arsenal.webp', crestUrl: '/club-logos/f-arsenal.webp',
    color: 'oklch(0.72 0.16 138)', symbolLayout: { field: { x: 120, y: -40, w: 270, h: 90 }, symbol: { x: 200, y: -25, w: 30, h: 30 } } });
  const banner = render(crest).querySelector('g');
  assertMapSpace(banner, crest);
  assert.equal(banner.dataset.flagLayout, 'crest');
  const images = banner.querySelectorAll('image');
  assert.equal(images.length, 1, 'the crest alone: no field artwork behind it');
  assert.equal(images[0].getAttribute('href'), crest.crestUrl);
  assert.equal(images[0].getAttribute('preserveAspectRatio'), 'xMidYMid meet');
  assert.deepEqual(box(images[0]), crest.symbolLayout.symbol, 'the crest sits where the layout placed it');

  const tiny = { ...crest, symbolLayout: null };
  const plain = render(tiny).querySelector('g');
  assertMapSpace(plain, tiny);
  assert.equal(plain.querySelectorAll('image').length, 0, 'no stretched crest on land too small for one');
});

test('native banners keep one original owner asset across the geographic region', () => {
  const flag = nativeFlag();
  const banner = render(flag).querySelector('g');
  assertMapSpace(banner, flag);
  assert.equal(banner.dataset.flagLayout, 'native');
  const images = [...banner.querySelectorAll('image')];
  assert.equal(images.length, 1);
  assert.equal(images[0].getAttribute('href'), flag.url);
  assert.equal(images[0].getAttribute('preserveAspectRatio'), 'none');
  assert.deepEqual(box(images[0]), flag.bbox);
  assert.equal(banner.querySelector('[data-flag-symbol], [data-flag-field]'), null);
});

test('symbol-aware banners contain exactly one stretched field and one undistorted emblem', () => {
  for (const code of Object.keys(FLAG_SYMBOLS)) {
    const flag = symbolFlag(code), banner = render(flag).querySelector('g');
    assertMapSpace(banner, flag);
    assert.equal(banner.dataset.flagLayout, 'symbol-aware');
    assert.equal(banner.querySelectorAll('image').length, 2);
    assert.equal(banner.querySelectorAll('[data-flag-field]').length, 1);
    assert.equal(banner.querySelectorAll('[data-flag-symbol]').length, 1);
    const field = banner.querySelector('[data-flag-field]'), symbol = banner.querySelector('[data-flag-symbol]');
    assert.equal(field.getAttribute('href'), `/${FLAG_SYMBOLS[code].fieldFile}`);
    assert.equal(symbol.getAttribute('href'), `/${FLAG_SYMBOLS[code].symbolFile}`);
    assert.equal(field.getAttribute('preserveAspectRatio'), 'none');
    assert.equal(symbol.getAttribute('preserveAspectRatio'), 'xMidYMid meet');
    assert.deepEqual(box(field), flag.symbolLayout.field);
    assert.deepEqual(box(symbol), flag.symbolLayout.symbol);
    assert.equal(banner.querySelector(`image[href="${flag.url}"]`), null, 'the emblem is not duplicated over the original flag');
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
    const banner = render(flag).querySelector('g');
    assertMapSpace(banner, flag);
    const actual = box(banner.querySelector('[data-flag-symbol]'));
    approx(actual.w / profile.bounds.w, actual.h / profile.bounds.h, `${code}: equal x/y map scale`);
    approx(actual.x + actual.w / 2, bbox.x + bbox.w / 2);
    approx(actual.y + actual.h / 2, bbox.y + bbox.h / 2);
  }
});

test('translated and negative map origins move every layer exactly once', () => {
  const original = symbolFlag('pt');
  const shift = (rectangle, dx, dy) => ({ ...rectangle, x: rectangle.x + dx, y: rectangle.y + dy });
  for (const [dx, dy] of [[1000, 2000], [-1000, -2000], [.125, -.5]]) {
    const shifted = { ...original, bbox: shift(original.bbox, dx, dy), symbolLayout: {
      field: shift(original.symbolLayout.field, dx, dy), symbol: shift(original.symbolLayout.symbol, dx, dy),
    } };
    const before = render(original).querySelector('g'), after = render(shifted).querySelector('g');
    const a = [...before.children].map(box), b = [...after.children].map(box);
    assert.equal(a.length, b.length);
    for (let i = 0; i < a.length; i++) {
      approx(b[i].x - a[i].x, dx, 'geographic translation moves each layer by the translation');
      approx(b[i].y - a[i].y, dy);
      approx(b[i].w, a[i].w, 'and never resizes it');
      approx(b[i].h, a[i].h);
    }
    const emblem = box(after.querySelector('[data-flag-symbol]'));
    approx(emblem.x, shifted.symbolLayout.symbol.x);
    approx(emblem.y, shifted.symbolLayout.symbol.y);
  }
});

test('missing or unavailable symbol layouts fall back to complete artwork without a partial banner', () => {
  for (const overrides of [{ symbolLayout: null }, { fieldUrl: null }, { symbolUrl: '' }]) {
    const flag = symbolFlag('pt', overrides), banner = render(flag).querySelector('g');
    assertMapSpace(banner, flag);
    assert.equal(banner.dataset.flagLayout, 'native');
    assert.equal(banner.querySelectorAll('image').length, 1);
    assert.equal(banner.querySelector('image').getAttribute('href'), '/flags/pt.svg');
    assert.equal(banner.querySelector('[data-flag-symbol], [data-flag-field]'), null);
  }
});

test('regional banners have unique identities and fly their current conqueror’s artwork', () => {
  const flags = [symbolFlag('ch', { id: '756-mainland', ownerId: '756' }),
    symbolFlag('ch', { id: '756-guiana', ownerId: '756' }),
    symbolFlag('pt', { id: '620-mainland', ownerId: '620' }), nativeFlag()];
  const svg = render(...flags), banners = [...svg.querySelectorAll('defs > g')];
  assert.equal(banners.length, flags.length);
  assert.equal(new Set([...svg.querySelectorAll('[id]')].map(node => node.id)).size, flags.length, 'no shared emblem marker IDs collide');
  banners.forEach((banner, index) => assertMapSpace(banner, flags[index]));
  assert.equal(banners[0].querySelector('[data-flag-symbol]').getAttribute('href'), banners[1].querySelector('[data-flag-symbol]').getAttribute('href'));
  assert.notEqual(banners[0].id, banners[1].id, 'overseas and mainland regions remain separate banners');
  const conquered = symbolFlag('pt', { id: '756-mainland', ownerId: '620' });
  const changed = render(conquered).querySelector('g');
  assert.equal(changed.dataset.owner, '620');
  assert.equal(changed.dataset.flagSource, '/flags/pt.svg');
  assert.equal(changed.querySelector('[data-flag-symbol]').getAttribute('href'), `/${FLAG_SYMBOLS.pt.symbolFile}`);
});

test('flag layers remain inert, unlabelled paint rather than blocking map interaction', () => {
  for (const flag of [nativeFlag(), symbolFlag()]) {
    const banner = render(flag).querySelector('g');
    assert.equal(banner.getAttribute('pointer-events'), 'none');
    assert.equal(banner.querySelector('[tabindex], [role], a, button, foreignObject'), null);
    assert.equal(banner.querySelector('[pointer-events]:not([pointer-events="none"])'), null);
    assert.equal(banner.querySelector('[stroke], [filter], mask, clipPath, use'), null, 'no extra outline, badge, shader or repeated symbol');
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
