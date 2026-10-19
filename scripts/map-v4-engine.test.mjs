// v4 map label engine options (README "Map rendering", DEC D19, PLAN A-6).
// Opt-in only: the pre-v4 defaults stay byte-identical (empire-labels.test.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createEmpireLabelEngine, V4_LABEL_POLICY, LABEL_SIZE_TIERS, labelMaxFontPx, v4LabelOptions, estimateLabelWidthEm,
} from '../src/engine/empireLabels.js';
import { WorldGeometry, projPt } from '../src/engine/geo.js';
import { NATIONS } from '../src/data/teams.js';

const WORLD = { x: 0, y: 0, w: 960, h: 540 };
const rect = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]];
const shape = (id, ...rings) => ({ id, rings });
const name = (id = 'A', text = 'EMPIRE', widthEm = 4.5, extra = {}) => ({ id, text, widthEm, ...extra });
const base = (ownership, labels, extra = {}) => ({
  ownership, labels, viewBox: WORLD, unitsPerPixel: 1, minFontPx: 11, maxFontPx: 32, ...extra,
});
const close = (actual, expected, message, tolerance = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)), `${message}: ${actual} != ${expected}`);
// 400×14 ribbons: the widest legible EMPIRE fits at about 7.6px with v4 tracking.
const ribbon = (id, y) => shape(id, rect(100, y, 400, 14));

test('omitting trackingEm keeps the pre-v4 .085em tracking exactly', () => {
  const shapes = [shape('a', rect(20, 20, 300, 150))], ownership = { a: 'A' };
  const implicit = createEmpireLabelEngine(shapes).layout(base(ownership, [name()]));
  const explicit = createEmpireLabelEngine(shapes).layout(base(ownership, [name()], { trackingEm: 0.085 }));
  assert.equal(implicit.length, 1);
  assert.deepEqual(implicit, explicit);
  close(implicit[0].letterSpacing / implicit[0].fontSize, 0.085, 'default tracking');
  for (const invalid of [NaN, Infinity, undefined, null, '0.14']) {
    const label = createEmpireLabelEngine(shapes).layout(base(ownership, [name()], { trackingEm: invalid }))[0];
    assert.deepEqual(label, implicit[0], `non-finite trackingEm ${String(invalid)} falls back to the default`);
  }
});

test('v4 tracking .14em is part of the measured width, letter-spacing and arc', () => {
  const shapes = [shape('a', rect(100, 100, 300, 40))], ownership = { a: 'A' };
  const engine = createEmpireLabelEngine(shapes);
  const old = engine.layout(base(ownership, [name()], { minFontPx: 9, maxFontPx: 30, curveRatio: 0.05 }))[0];
  const v4 = engine.layout(base(ownership, [name()], { minFontPx: 9, maxFontPx: 30, curveRatio: 0.05, trackingEm: 0.14 }))[0];
  close(v4.letterSpacing / v4.fontSize, 0.14, 'letter-spacing is .14em of the placed size');
  close(v4.width, (4.5 + 0.14 * 5) * v4.fontSize, 'textLength includes tracking between six letters');
  close(v4.curveRise, v4.width * 0.05, 'the arc rises 5% of the label width');
  assert.ok(v4.fontSize < old.fontSize, 'wider tracking leaves a width-limited name less room');
  const single = engine.layout(base(ownership, [name('A', 'X', 0.6)], { trackingEm: 0.14 }))[0];
  assert.equal(single.letterSpacing, 0, 'a single character has no tracking');
  close(single.width, 0.6 * single.fontSize, 'single-character width');
  const clamped = engine.layout(base(ownership, [name()], { trackingEm: 2 }))[0];
  close(clamped.letterSpacing / clamped.fontSize, 0.3, 'tracking is clamped to .3em');
  const none = engine.layout(base(ownership, [name()], { trackingEm: -1 }))[0];
  assert.equal(none.letterSpacing, 0, 'negative tracking is clamped to zero');
});

test('per-label minFontPx lets your own label go down to 6.5px while others hide below 9px', () => {
  const shapes = [ribbon('mine', 100), ribbon('theirs', 200)];
  const ownership = { mine: 'ME', theirs: 'THEM' };
  const engine = createEmpireLabelEngine(shapes);
  const shared = { minFontPx: 9, maxFontPx: 30, curveRatio: 0.05, trackingEm: 0.14 };
  assert.deepEqual(engine.layout(base(ownership, [name('ME'), name('THEM')], shared)), [], 'both hide at the 9px floor');
  const placed = engine.layout(base(ownership, [name('ME', 'EMPIRE', 4.5, { minFontPx: 6.5 }), name('THEM')], shared));
  assert.deepEqual(placed.map(label => label.id), ['ME'], 'only the label with its own lower floor is shown');
  assert.ok(placed[0].fontSize >= 6.5 && placed[0].fontSize < 9, `own label ${placed[0].fontSize}px`);
  close(placed[0].letterSpacing / placed[0].fontSize, 0.14, 'own label tracking');
  const raised = engine.layout(base({ a: 'A' }, [name('A', 'EMPIRE', 4.5, { minFontPx: 12 })], { minFontPx: 9, maxFontPx: 30 }));
  assert.deepEqual(raised, [], 'a per-label floor may also be stricter than the shared one');
});

test('per-label minFontPx participates in the cache key and is clamped to the size range', () => {
  const shapes = [ribbon('mine', 100)], ownership = { mine: 'ME' };
  const engine = createEmpireLabelEngine(shapes);
  const shared = { minFontPx: 9, maxFontPx: 30, curveRatio: 0.05, trackingEm: 0.14 };
  const hidden = engine.layout(base(ownership, [name('ME')], shared));
  assert.deepEqual(hidden, []);
  const own = engine.layout(base(ownership, [name('ME', 'EMPIRE', 4.5, { minFontPx: 6.5 })], shared));
  assert.equal(own.length, 1, 'changing only the per-label floor relays the labels');
  assert.strictEqual(engine.layout(base(ownership, [name('ME', 'EMPIRE', 4.5, { minFontPx: 6.5 })], shared)), own);
  for (const invalid of [0, -3, NaN, 'small']) {
    assert.deepEqual(engine.layout(base(ownership, [name('ME', 'EMPIRE', 4.5, { minFontPx: invalid })], shared)), [],
      `invalid per-label floor ${String(invalid)} uses the shared floor`);
  }
  const roomy = createEmpireLabelEngine([shape('a', rect(20, 20, 600, 300))]);
  const capped = roomy.layout(base({ a: 'A' }, [name('A', 'EMPIRE', 4.5, { minFontPx: 80 })], { minFontPx: 9, maxFontPx: 20 }));
  assert.equal(capped.length, 1, 'a floor above the maximum is clamped to the maximum');
  close(capped[0].fontSize, 20, 'clamped size', 1e-6);
});

test('label size tiers follow the viewport width class', () => {
  assert.deepEqual(LABEL_SIZE_TIERS.map(tier => [tier.minWidth, tier.maxFontPx]), [[1600, 30], [1200, 22], [700, 20], [0, 18]]);
  assert.ok(Object.isFrozen(LABEL_SIZE_TIERS) && LABEL_SIZE_TIERS.every(Object.isFrozen));
  for (const [width, max] of [[2560, 30], [1920, 30], [1600, 30], [1599, 22], [1440, 22], [1366, 22], [1200, 22],
    [1199, 20], [1024, 20], [820, 20], [700, 20], [699, 18], [390, 18], [0, 18], [-5, 18]]) {
    assert.equal(labelMaxFontPx(width), max, `${width}px`);
  }
  for (const unknown of [undefined, null, NaN, '1440']) assert.equal(labelMaxFontPx(unknown), 20, `unknown ${String(unknown)}`);
});

test('v4LabelOptions builds the layout input with your 6.5px floor and the tier maximum', () => {
  assert.deepEqual({ ...V4_LABEL_POLICY }, {
    trackingEm: 0.14, curveRatio: 0.05, minFontPx: 9, ownMinFontPx: 6.5, coastalAllowancePx: 10, maxSeaFraction: 0.22,
  });
  assert.ok(Object.isFrozen(V4_LABEL_POLICY));
  const labels = [{ id: 276, text: 'GERMANY', widthEm: 4 }, { id: '250', text: 'FRANCE', widthEm: 3.6 }];
  const built = v4LabelOptions({ viewportWidth: 1440, meId: '276', labels });
  assert.deepEqual(built, {
    labels: [{ id: 276, text: 'GERMANY', widthEm: 4, minFontPx: 6.5 }, labels[1]],
    minFontPx: 9, maxFontPx: 22, curveRatio: 0.05, coastalAllowancePx: 10, maxSeaFraction: 0.22, trackingEm: 0.14,
  });
  assert.strictEqual(built.labels[1], labels[1], 'other label objects pass through unchanged');
  assert.equal(labels[0].minFontPx, undefined, 'input labels are not mutated');
  assert.equal(v4LabelOptions({ viewportWidth: 1920, maxFontPx: 18, labels }).maxFontPx, 18, 'explicit maximum wins');
  assert.equal(v4LabelOptions({ viewportWidth: 390 }).maxFontPx, 18);
  assert.equal(v4LabelOptions().maxFontPx, 20, 'no width uses the jsdom-class tier');
  assert.deepEqual(v4LabelOptions({ meId: null, labels }).labels, labels, 'no managed or followed empire, no override');
  assert.deepEqual(v4LabelOptions({ meId: '', labels }).labels, labels);
  // The policy keeps inside the smoke envelope (curve ≤ .1, coastal 8–10px, sea .22).
  assert.ok(built.curveRatio > 0 && built.curveRatio <= 0.1);
  assert.ok(built.coastalAllowancePx >= 8 && built.coastalAllowancePx <= 10 && built.maxSeaFraction === 0.22);
});

test('the deterministic width estimate needs no DOM and tracks narrow-font proportions', () => {
  assert.equal(typeof globalThis.document, 'undefined', 'runs without a DOM or canvas');
  assert.equal(estimateLabelWidthEm(''), 0);
  assert.equal(estimateLabelWidthEm(null), 0);
  assert.equal(estimateLabelWidthEm('GERMANY'), estimateLabelWidthEm('GERMANY'), 'deterministic');
  assert.equal(estimateLabelWidthEm('germany'), estimateLabelWidthEm('GERMANY'), 'measured as the uppercase label');
  assert.equal(estimateLabelWidthEm('CÔTE D’IVOIRE'), estimateLabelWidthEm('COTE D’IVOIRE'), 'accents measure as their base letter');
  assert.equal(estimateLabelWidthEm('TÜRKİYE'), estimateLabelWidthEm('TURKIYE'));
  assert.ok(estimateLabelWidthEm('W') > estimateLabelWidthEm('M') && estimateLabelWidthEm('M') > estimateLabelWidthEm('I'));
  assert.ok(estimateLabelWidthEm('GERMANY', 700) > estimateLabelWidthEm('GERMANY', 600), 'your 700 label is wider');
  assert.ok(estimateLabelWidthEm('GERMANY', 600) > estimateLabelWidthEm('GERMANY', 400));
  assert.equal(estimateLabelWidthEm('GERMANY', 900), estimateLabelWidthEm('GERMANY', 700), 'boldness saturates at 700');
  const germany = estimateLabelWidthEm('GERMANY');
  assert.ok(germany > 3.5 && germany < 4.8, `GERMANY ≈ ${germany}em in a narrow face`);
  assert.ok(estimateLabelWidthEm('2B') > 0 && estimateLabelWidthEm('Æ') > 0, 'digits and unknown glyphs still have width');
  for (const [id, nation] of Object.entries(NATIONS)) {
    const width = estimateLabelWidthEm(nation[0]);
    assert.ok(Number.isFinite(width) && width > 0, `${id} ${nation[0]}`);
  }
});

test('real European theatre: the v4 policy keeps every label inside its size floor and tier', () => {
  const load = file => JSON.parse(readFileSync(new URL(`../public/${file}`, import.meta.url), 'utf8'));
  const theatre = Object.entries(NATIONS).filter(([, nation]) => nation[2] === 'UEFA').map(([id]) => id);
  const rules = new WorldGeometry(load('world-110m.v1.json')).fitTo(theatre);
  const held = theatre.filter(id => rules.paths[id]);
  const shapes = held.map(id => ({ id, rings: rules.paths[id].labelRings }));
  const ownership = Object.fromEntries(held.map(id => [id, id]));
  const meId = '276';
  // The App's UEFA focus (lon −15…44, lat 34…71) in the A2 map cell (1006×662 at 1366).
  const { s, tx, ty } = rules.fit;
  const corners = [[-15, 71], [44, 71], [-15, 34], [44, 34]].map(([lon, lat]) => projPt(lon, lat)).map(([x, y]) => [x * s + tx, y * s + ty]);
  const xs = corners.map(p => p[0]), ys = corners.map(p => p[1]);
  const box = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  const canvas = { width: 1006, height: 662 };
  const w = Math.max(box.w, box.h * canvas.width / canvas.height);
  const viewBox = { x: box.x + (box.w - w) / 2, y: box.y + (box.h - w * canvas.height / canvas.width) / 2, w, h: w * canvas.height / canvas.width };
  const unitsPerPixel = viewBox.w / canvas.width;
  const labels = held.map(id => ({ id, text: NATIONS[id][0].toUpperCase(), widthEm: estimateLabelWidthEm(NATIONS[id][0], id === meId ? 700 : 600) }));
  const input = { ownership, viewBox, unitsPerPixel, ...v4LabelOptions({ viewportWidth: 1366, meId, labels }) };
  const engine = createEmpireLabelEngine(shapes);
  const placed = engine.layout(input);
  assert.ok(placed.length >= 10, `${placed.length} European labels placed`);
  assert.ok(placed.some(label => label.id === meId), 'your empire is named');
  for (const label of placed) {
    const px = label.fontSize / unitsPerPixel;
    const floor = label.id === meId ? 6.5 : 9;
    assert.ok(px >= floor - 1e-6 && px <= 22 + 1e-6, `${label.text} ${px.toFixed(2)}px within ${floor}–22`);
    close(label.letterSpacing / label.fontSize, 0.14, `${label.text} tracking`, 1e-6);
    const arc = label.curveRise / label.width;
    assert.ok(Math.abs(arc - 0.05) < 1e-9 || Math.abs(arc - 0.025) < 1e-9, `${label.text} arcs 5% (2.5% gentle fallback)`);
    assert.ok(label.seaFraction >= 0 && label.seaFraction <= 0.22 + 1e-6);
  }
  assert.strictEqual(engine.layout(input), placed, 'an unchanged frame reuses the layout');
  // Slovakia is too small for 9px at 1366 but stays named when it is yours.
  assert.ok(!placed.some(label => label.id === '703'), 'Slovakia hides at the shared 9px floor');
  const mine = engine.layout({ ...input, ...v4LabelOptions({ viewportWidth: 1366, meId: '703', labels }) })
    .find(label => label.id === '703');
  assert.ok(mine, 'your own Slovakia is named');
  const minePx = mine.fontSize / unitsPerPixel;
  assert.ok(minePx >= 6.5 - 1e-6 && minePx < 9, `own Slovakia at ${minePx.toFixed(2)}px`);
});
