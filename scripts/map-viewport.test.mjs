import assert from 'node:assert/strict';
import test from 'node:test';
import { computeRevealView, WORLD } from '../src/hooks/useMapViewport.js';

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
