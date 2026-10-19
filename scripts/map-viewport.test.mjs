import assert from 'node:assert/strict';
import test from 'node:test';
import { computeFitView, computeRevealView, WORLD } from '../src/hooks/useMapViewport.js';
import { viewportClass, conquestLayout, THEATRE_LAYOUT, NEAR_LAYOUT, MAP_INSET, LABEL_MAX_PX } from '../src/hooks/useMapViewport.js';

const desktop = { width: 960, height: 540 };
const zoomed = { x: 200, y: 100, w: 320, h: 180 };
const screenPoint = (point, view, size) => ({
  x: (point.x - view.x) * size.width / view.w,
  y: (point.y - view.y) * size.height / view.h,
});

function assertVisible(points, view, size, inset = { left: 0, right: 0, top: 0, bottom: 0 }) {
  for (const point of points) {
    const screen = screenPoint(point, view, size);
    assert.ok(screen.x >= inset.left - 1e-7 && screen.x <= size.width - inset.right + 1e-7,
      `x=${screen.x} must be visible in ${JSON.stringify(view)}`);
    assert.ok(screen.y >= inset.top - 1e-7 && screen.y <= size.height - inset.bottom + 1e-7,
      `y=${screen.y} must be visible in ${JSON.stringify(view)}`);
  }
}

function assertFramed(view, size) {
  const aspect = size.height / size.width;
  const baseWidth = Math.max(WORLD.w, WORLD.h / aspect);
  assert.ok(view.w >= baseWidth / 16 && view.w <= baseWidth);
  assert.ok(Math.abs(view.h - view.w * aspect) < 1e-7);
  if (view.w > WORLD.w) assert.equal(view.x, (WORLD.w - view.w) / 2);
  else assert.ok(view.x >= 0 && view.x + view.w <= WORLD.w + 1e-7);
  if (view.h > WORLD.h) assert.equal(view.y, (WORLD.h - view.h) / 2);
  else assert.ok(view.y >= 0 && view.y + view.h <= WORLD.h + 1e-7);
}

const desktopInset = { left: 72, right: 72, top: 90, bottom: 110 };

test('explicit conquest inspection zooms into a small territory with HUD padding', () => {
  const bounds = { x: 440, y: 260, w: 40, h: 20 };
  const view = computeFitView(bounds, desktop);
  assert.ok(view.w < WORLD.w / 4, 'An explicit conquest view must zoom in from the world view');
  assertVisible([{ x: 440, y: 260 }, { x: 480, y: 280 }], view, desktop, desktopInset);
  assertFramed(view, desktop);
});

test('conquest fitting handles phones, world edges, zero-sized land and invalid bounds', () => {
  for (const size of [desktop, { width: 390, height: 700 }, { width: 240, height: 100 }]) {
    for (const bounds of [{ x: 0, y: 0, w: 30, h: 20 }, { x: 900, y: 490, width: 60, height: 50 }, WORLD, { x: 430, y: 240, w: 0, h: 0 }]) {
      const view = computeFitView(bounds, size);
      assertFramed(view, size);
      assertVisible([{ x: bounds.x, y: bounds.y }, { x: bounds.x + (bounds.width ?? bounds.w), y: bounds.y + (bounds.height ?? bounds.h) }], view, size);
    }
  }
  for (const bounds of [null, {}, { x: 2, y: 3, w: -1, h: 5 }, { x: NaN, y: 3, w: 5, h: 5 }]) assert.equal(computeFitView(bounds, desktop), null);
  assert.equal(computeFitView(WORLD, { width: 0, height: 0 }), null);
});

test('already-safe routes preserve the exact view object and zoom', () => {
  assert.equal(computeRevealView(zoomed, [{ x: 250, y: 160 }, { x: 400, y: 210 }], desktop), zoomed);
});

test('offscreen marker uses only the minimum required pan', () => {
  const points = [{ x: 580, y: 220 }];
  const revealed = computeRevealView(zoomed, points, desktop);
  assert.equal(revealed.w, zoomed.w);
  assert.equal(revealed.h, zoomed.h);
  assert.equal(revealed.x, 284);
  assert.equal(revealed.y, zoomed.y);
  assertVisible(points, revealed, desktop, desktopInset);
  assertFramed(revealed, desktop);
});

test('widely separated endpoints zoom out just enough to show both safely', () => {
  const points = [{ x: 140, y: 200 }, { x: 760, y: 300 }];
  const revealed = computeRevealView(zoomed, points, desktop);
  assert.ok(revealed.w > zoomed.w && revealed.w < WORLD.w);
  assert.ok(Math.abs(revealed.w - 620 / .85) < 1e-7);
  assertVisible(points, revealed, desktop, desktopInset);
  assertFramed(revealed, desktop);
  assert.equal(computeRevealView(revealed, points, desktop), revealed);
});

test('vertical routes honor asymmetric HUD insets without zooming in', () => {
  const points = [{ x: 480, y: 100 }, { x: 480, y: 420 }];
  const revealed = computeRevealView(zoomed, points, desktop);
  assert.ok(revealed.w > zoomed.w);
  assertVisible(points, revealed, desktop, desktopInset);
  assertFramed(revealed, desktop);
});

test('phone padding contracts while world-edge framing keeps endpoints visible', () => {
  const phone = { width: 240, height: 320 };
  const current = { x: 350, y: 100, w: 120, h: 160 };
  const points = [{ x: 3, y: 5 }, { x: 945, y: 530 }];
  const revealed = computeRevealView(current, points, phone);
  assert.ok(revealed.w >= current.w);
  assertVisible(points, revealed, phone);
  assertFramed(revealed, phone);
});

test('tiny landscape canvases keep usable screen space and respect world clamps', () => {
  const small = { width: 240, height: 100 };
  const current = { x: 250, y: 150, w: 240, h: 100 };
  const points = [{ x: 300, y: 180 }, { x: 500, y: 230 }];
  const revealed = computeRevealView(current, points, small);
  assertVisible(points, revealed, small, { left: 48, right: 48, top: 18, bottom: 22 });
  assertFramed(revealed, small);
});

test('edge markers do not force pointless zooming merely to obtain impossible padding', () => {
  const current = { x: 0, y: 0, w: 320, h: 180 };
  assert.equal(computeRevealView(current, [{ x: 0, y: 0 }], desktop), current);
});

test('empty or invalid targets and unavailable dimensions leave the camera untouched', () => {
  for (const targets of [null, undefined, [], [null, {}, { x: NaN, y: 2 }, { x: 2, y: Infinity }, { x: '2', y: 3 }]]) {
    assert.equal(computeRevealView(zoomed, targets, desktop), zoomed);
  }
  assert.equal(computeRevealView(zoomed, [{ x: 500, y: 300 }], { width: 0, height: 0 }), zoomed);
  assert.equal(computeRevealView(zoomed, [{ x: 500, y: 300 }], { width: NaN, height: 540 }), zoomed);
  assert.deepEqual(computeRevealView(zoomed, [null, { x: 580, y: 220 }, { x: Infinity, y: 4 }], desktop),
    computeRevealView(zoomed, [{ x: 580, y: 220 }], desktop));
});

test('world-wide routes stop at the existing minimum zoom', () => {
  const points = [{ x: 0, y: 0 }, { x: WORLD.w, y: WORLD.h }];
  const revealed = computeRevealView(zoomed, points, desktop);
  assert.deepEqual(revealed, WORLD);
  assertVisible(points, revealed, desktop);
});

test('varied route directions and canvas shapes remain visible, framed, and stable', () => {
  let seed = 4271;
  const random = () => ((seed = Math.imul(seed, 1664525) + 1013904223 >>> 0) / 4294967296);
  for (const size of [desktop, { width: 1920, height: 600 }, { width: 390, height: 700 }, { width: 80, height: 60 }]) {
    const aspect = size.height / size.width;
    const baseWidth = Math.max(WORLD.w, WORLD.h / aspect);
    for (let i = 0; i < 100; i++) {
      const w = baseWidth / (1 + random() * 15), h = w * aspect;
      const current = { w, h,
        x: w > WORLD.w ? (WORLD.w - w) / 2 : random() * (WORLD.w - w),
        y: h > WORLD.h ? (WORLD.h - h) / 2 : random() * (WORLD.h - h) };
      const points = Array.from({ length: 3 }, () => ({ x: random() * WORLD.w, y: random() * WORLD.h }));
      const revealed = computeRevealView(current, points, size);
      assert.ok(revealed.w >= current.w);
      assertVisible(points, revealed, size);
      assertFramed(revealed, size);
      assert.equal(computeRevealView(revealed, points, size), revealed);
    }
  }
});

// ---- v4 framing (WP-MAP, PLAN §3.7, A-2, A-6): the design's fit() window as an optional fourth argument ----

const screenOf = (point, view, size) => screenPoint(point, view, size);

test('a layout window centres the bounds in its [l..r]×[t..b] fraction (D1 conquest framing)', () => {
  const size = { width: 1440, height: 824 };
  const bounds = { x: 430, y: 240, w: 20, h: 15 };
  const layout = { l: .03, r: .5, t: .12, b: .88, pad: 2.6 };
  const view = computeFitView(bounds, size, undefined, layout);
  assertFramed(view, size);
  const centre = screenOf({ x: 440, y: 247.5 }, view, size);
  assert.ok(Math.abs(centre.x - 381.6) < 1e-6, `centre x ${centre.x} = .265 × 1440`);
  assert.ok(Math.abs(centre.y - 412) < 1e-6, `centre y ${centre.y} = .5 × 824`);
  const aspect = size.height / size.width;
  const expected = Math.max(20 / .47, 15 / .76 / aspect) * 2.6;
  assert.ok(Math.abs(view.w - expected) < 1e-9, 'w = max(b.w/(r−l), (b.h/(b−t))/a) · pad');
  // pad 2.6: the taken land occupies at most 1/2.6 of the window, well left of a 650px article.
  assertVisible([{ x: 430, y: 240 }, { x: 450, y: 255 }], view, size, { left: 43, right: 720, top: 99, bottom: 99 });
});

test('theatre windows keep the theatre clear of the title card and bottom chrome at each width', () => {
  const theatre = { x: 360, y: 60, w: 260, h: 190 };
  for (const [breakpoint, size] of [['wide', { width: 1420, height: 952 }], ['std', { width: 1006, height: 662 }],
    ['tablet', { width: 820, height: 560 }], ['phone', { width: 390, height: 330 }]]) {
    const layout = THEATRE_LAYOUT[breakpoint];
    const view = computeFitView(theatre, size, undefined, layout);
    assertFramed(view, size);
    const slack = layout.pad < 1 ? (1 - layout.pad) * size.width : 0; // the tablet frame crops by 2%
    assertVisible([{ x: theatre.x, y: theatre.y }, { x: theatre.x + theatre.w, y: theatre.y + theatre.h }], view, size, {
      left: layout.l * size.width - slack, right: (1 - layout.r) * size.width - slack,
      top: layout.t * size.height - slack, bottom: (1 - layout.b) * size.height - slack });
  }
  assert.deepEqual(NEAR_LAYOUT, { l: 0, r: 1, t: 0, b: 1, pad: 1.55 });
});

test('invalid or degenerate windows fall back to the whole canvas; the 3-argument form is unchanged', () => {
  const bounds = { x: 440, y: 260, w: 40, h: 20 };
  assert.deepEqual(computeFitView(bounds, desktop, undefined, { l: .6, r: .4, t: .9, b: .1, pad: 1 }),
    computeFitView(bounds, desktop, undefined, { l: 0, r: 1, t: 0, b: 1, pad: 1 }));
  assert.deepEqual(computeFitView(bounds, desktop, undefined, null), computeFitView(bounds, desktop));
  const point = computeFitView({ x: 430, y: 240, w: 0, h: 0 }, desktop, undefined, NEAR_LAYOUT);
  assertFramed(point, desktop);
  assert.ok(Math.abs(point.w - WORLD.w / 16) < 1e-9, 'a single point frames at the maximum zoom');
  assert.equal(computeFitView(null, desktop, undefined, NEAR_LAYOUT), null);
});

test('viewport classes, insets, label tiers and conquest windows follow the README breakpoints', () => {
  for (const [width, expected] of [[1920, 'wide'], [1600, 'wide'], [1599.98, 'std'], [1440, 'std'], [1200, 'std'],
    [1199.98, 'tablet'], [1024, 'tablet'], [820, 'tablet'], [700, 'tablet'], [699.98, 'phone'], [390, 'phone'], [NaN, 'std'], [undefined, 'std']]) {
    assert.equal(viewportClass(width), expected, `${width}px`);
  }
  assert.deepEqual(MAP_INSET, { wide: 30, std: 20, tablet: 18, phone: 12 });
  assert.deepEqual(LABEL_MAX_PX, { wide: 30, std: 22, tablet: 20, phone: 18 });
  assert.deepEqual(conquestLayout('std', 1440), { l: .03, r: .5, t: .12, b: .88, pad: 2.6 });
  assert.deepEqual(conquestLayout('wide', 1920), { l: .03, r: .5, t: .12, b: .88, pad: 2.6 });
  const narrow = conquestLayout('std', 1200);
  assert.ok(Math.abs(narrow.r - (1200 - 650 - 40) / 1200) < 1e-12, 'r stops 40px short of the 650px article');
  assert.deepEqual(conquestLayout('tablet', 820), { l: 0, r: 1, t: .12, b: .88, pad: 2.6 });
  assert.deepEqual(conquestLayout('phone', 390), { l: 0, r: 1, t: 0, b: 1, pad: 2.8 });
});
