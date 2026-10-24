import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';

// Compile the real JSX in memory: no server, test-only source substitutions or
// generated files. jsdom inspects SVG/CSS contracts; browser QA owns raster QA.
const sourceUrl = new URL('../src/components/DrawCompass.jsx', import.meta.url);
const css = await readFile(new URL('../src/components/draw-compass.css', import.meta.url), 'utf8');
const compiled = await build({
  entryPoints: [fileURLToPath(sourceUrl)], bundle: true, write: false,
  platform: 'node', format: 'cjs', external: ['react'],
  loader: { '.css': 'empty' }, logLevel: 'silent',
});
const module = { exports: {} };
new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(
  createRequire(import.meta.url), module, module.exports,
);
const { default: DrawCompass, AttackVector } = module.exports;
const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>');
const { document } = dom.window;
const style = document.createElement('style');
style.textContent = css;
document.head.append(style);
after(() => dom.window.close());

const numeric = /[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:e[-+]?\d+)?/gi;
const numbers = text => (text.match(numeric) || []).map(Number);
const approx = (actual, expected, message = '') => {
  assert.ok(Math.abs(actual - expected) < 1e-8, `${message}: ${actual} ≠ ${expected}`);
};
const rule = selector => [...style.sheet.cssRules].find(item => item.selectorText === selector);

function render(Component, props) {
  const host = document.createElement('div');
  host.innerHTML = renderToStaticMarkup(React.createElement('svg', null, React.createElement(Component, props)));
  return host.querySelector('svg');
}

function cssRotation(needle) {
  const match = /^rotate\(([-+\d.e]+)deg\)$/.exec(needle.style.transform);
  assert.ok(match, 'needle exposes an explicit degree rotation');
  return Number(match[1]);
}

// Independent application of the rendered SVG transform list, right to left.
function transformPoint(text, point) {
  const transforms = [...text.matchAll(/(translate|rotate|scale)\(([^)]*)\)/g)];
  let [x, y] = point;
  for (const [, kind, args] of transforms.reverse()) {
    const [a, b] = numbers(args);
    if (kind === 'translate') { x += a; y += b || 0; }
    else if (kind === 'scale') { x *= a; y *= b ?? a; }
    else {
      const radians = a * Math.PI / 180;
      [x, y] = [x * Math.cos(radians) - y * Math.sin(radians), x * Math.sin(radians) + y * Math.cos(radians)];
    }
  }
  return [x, y];
}

test('the real needle points east at zero, south at 90°, and preserves complete turns', () => {
  assert.equal(rule('.draw-compass-needle').style.getPropertyValue('transform-origin'), '0 0');
  for (const [angle, direction] of [[0, [1, 0]], [90, [0, 1]], [180, [-1, 0]],
    [270, [0, -1]], [720, [1, 0]], [810, [0, 1]], [-90, [0, -1]]]) {
    const svg = render(DrawCompass, { x: 123, y: 234, angle, stage: 'locked', k: .3 });
    const compass = svg.querySelector('[data-testid="draw-compass"]');
    const needle = svg.querySelector('[data-testid="draw-compass-needle"]');
    assert.equal(Number(compass.dataset.angle), angle);
    assert.equal(cssRotation(needle), angle);
    const tip = numbers(svg.querySelector('.draw-compass-tip').getAttribute('d')).slice(0, 2);
    assert.ok(tip[0] > 0 && tip[1] === 0, 'unrotated paper point, not tail, faces east');
    const actual = transformPoint(`rotate(${cssRotation(needle)})`, tip);
    approx(actual[0] / tip[0], direction[0], `angle ${angle}, x`);
    approx(actual[1] / tip[0], direction[1], `angle ${angle}, y`);
  }
});

test('parent stages control duration exactly; ready and locked never continue spinning', () => {
  for (const stage of ['ready', 'spinning', 'locked']) {
    for (const durationMs of [460, 1050, 2100]) {
      const svg = render(DrawCompass, { x: 0, y: 0, stage, angle: 1073, durationMs });
      const root = svg.querySelector('[data-testid="draw-compass"]');
      const needle = svg.querySelector('[data-testid="draw-compass-needle"]');
      assert.equal(root.dataset.stage, stage);
      assert.equal(needle.style.transition, stage === 'spinning'
        ? `transform ${durationMs}ms cubic-bezier(.12,.64,.16,1)` : 'none');
      assert.equal(Boolean(svg.querySelector('.draw-compass-inner')), stage !== 'locked');
      assert.equal(svg.querySelectorAll('.draw-compass-ticks line').length, stage === 'locked' ? 0 : 12);
      assert.equal(Boolean(svg.querySelector('.draw-compass-north')), stage !== 'locked');
      assert.equal(Number(svg.querySelector('.draw-compass-instrument').dataset.scale) === 1, stage !== 'locked');
      assert.equal(needle.style.animation, '');
    }
  }
  for (const invalid of [-100, NaN, Infinity]) {
    const svg = render(DrawCompass, { x: 0, y: 0, stage: 'spinning', durationMs: invalid, angle: NaN });
    const needle = svg.querySelector('.draw-compass-needle');
    assert.equal(cssRotation(needle), 0);
    assert.equal(needle.style.transition, 'transform 0ms cubic-bezier(.12,.64,.16,1)');
  }
});

test('reduced motion disables rotation and route entry, including the system media override', () => {
  for (const stage of ['ready', 'spinning', 'locked']) {
    const svg = render(DrawCompass, { x: 0, y: 0, stage, angle: 930, durationMs: 2000, reducedMotion: true });
    assert.equal(svg.querySelector('.draw-compass-needle').style.transition, 'none');
    assert.equal(cssRotation(svg.querySelector('.draw-compass-needle')), 930);
  }
  const route = render(AttackVector, { x1: 0, y1: 0, x2: 120, y2: 80, reducedMotion: true });
  assert.equal(route.querySelector('.draw-route').style.animation, 'none');
  const media = [...style.sheet.cssRules].find(item => item.conditionText === '(prefers-reduced-motion: reduce)');
  assert.ok(media, 'system preference remains effective if it changes mid-draw');
  const reducedNeedle = [...media.cssRules].find(item => item.selectorText === '.draw-compass-needle');
  const reducedRoute = [...media.cssRules].find(item => item.selectorText === '.draw-route');
  assert.equal(reducedNeedle.style.getPropertyValue('transition'), 'none');
  assert.equal(reducedNeedle.style.getPropertyPriority('transition'), 'important');
  assert.equal(reducedRoute.style.getPropertyValue('animation'), 'none');
  assert.equal(reducedRoute.style.getPropertyPriority('animation'), 'important');
  assert.ok(!/infinite|fiMarch|fiPulse/.test(css), 'no perpetual route ribbon or locked pulse');
});

test('ready and spinning use the exact 64px disk at every zoom', () => {
  for (const [k, stage] of [.05, .25, 1, 4, 16].flatMap(k => ['ready', 'spinning'].map(stage => [k, stage]))) {
    const svg = render(DrawCompass, { x: 173, y: 216, stage, k });
    const root = svg.querySelector('.draw-compass');
    const diskRadius = Number(svg.querySelector('.draw-compass-disk').getAttribute('r'));
    assert.equal(diskRadius, 32, 'fixed production disk size, not an old 30px snapshot');
    assert.equal(Number(svg.querySelector('.draw-compass-instrument').dataset.scale), 1);
    const center = transformPoint(root.getAttribute('transform'), [0, 0]);
    const rim = transformPoint(root.getAttribute('transform'), [diskRadius, 0]);
    approx(center[0], 173); approx(center[1], 216);
    approx((rim[0] - center[0]) / k * 2, 64, 'screen-space diameter');
    const outline = Number(rule('.draw-compass-disk').style.getPropertyValue('stroke-width'));
    assert.ok(diskRadius * 2 + outline <= 72);
    assert.equal(svg.querySelectorAll('.draw-compass-ticks line').length, 12);
  }
  for (const k of [0, -2, NaN, Infinity]) {
    assert.match(render(DrawCompass, { x: 0, y: 0, k }).querySelector('.draw-compass').getAttribute('transform'), /scale\(1\)/);
  }
});

test('lock turns the dial into a legible 13px source pointer that never hides the destination on a short route', () => {
  // ~25 screen px is the real Bosnia→Montenegro regression: the original 64px opaque disk covered the entire route
  // and opponent marker after locking. A pointer that shrank to .42d instead was 2–5px wide on a zoomed-out phone or
  // tablet map, so the pointer keeps 13px and slides back from the origin, away from the target, on short routes.
  const close = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 2e-3, `${message}: ${actual} ≠ ${expected}`);
  for (const distance of [1, 3, 6, 10, 25, 30, 31, 80, 300]) {
    for (const k of [.1, .4, 1, 5]) {
      for (const [ux, uy] of [[0, 1], [1, 0], [-.6, -.8], [.8, -.6]]) {
        const origin = [130, 200];
        const target = [origin[0] + ux * distance * k, origin[1] + uy * distance * k];
        const svg = render(DrawCompass, { x: origin[0], y: origin[1], targetX: target[0], targetY: target[1],
          angle: 810, stage: 'locked', k });
        const root = svg.querySelector('.draw-compass');
        const instrument = svg.querySelector('.draw-compass-instrument');
        const radius = Number(svg.querySelector('.draw-compass-disk').getAttribute('r'));
        const outline = Number(rule('.draw-compass-disk').style.getPropertyValue('stroke-width'));
        const transform = `${root.getAttribute('transform')} ${instrument.getAttribute('transform')}`;
        const center = transformPoint(transform, [0, 0]);
        const outerEdge = transformPoint(transform, [radius + outline / 2, 0]);
        const outerRadiusPx = Math.hypot(outerEdge[0] - center[0], outerEdge[1] - center[1]) / k;
        const label = `${distance}px, k=${k}, (${ux}, ${uy})`;
        close(outerRadiusPx, 13, `${label}: the locked pointer keeps its 13px radius`);
        assert.ok(outerRadiusPx < 32, 'locked dial is always smaller than the draw disk');
        // Its front edge along the route stops at 42% of the drawn arrow; on a long route it sits on the origin. The
        // arrow is never drawn shorter than 28px (DEC D20, deliberate): a shorter route starts behind the origin, so
        // the 42% is measured from that start (distance − 28).
        const along = ((center[0] - origin[0]) * ux + (center[1] - origin[1]) * uy) / k;
        const front = distance - Math.max(distance, 28) * .58;
        assert.ok(along + outerRadiusPx <= Math.max(13, front) + 2e-3, `${label}: front edge ${along + outerRadiusPx}`);
        if (front >= 13) close(Math.hypot(center[0] - origin[0], center[1] - origin[1]), 0, `${label}: centred on the origin`);
        else close(along, front - 13, `${label}: slid straight back from the target`);
        assert.equal(cssRotation(svg.querySelector('.draw-compass-needle')), 810, 'locking does not change bearing');
        assert.equal(svg.querySelector('.draw-compass-needle').style.transition, 'none');
        assert.equal(svg.querySelectorAll('.draw-compass-north, .draw-compass-ticks, .draw-compass-inner').length, 0);
        // v4 (DEC D20): the arrow head replaces the old target reticle. Every head vertex lies outside the locked
        // pointer, so the head is never covered.
        const route = render(AttackVector, { x1: origin[0], y1: origin[1], x2: target[0], y2: target[1], k });
        const routeTransform = route.querySelector('.draw-route').getAttribute('transform');
        const head = numbers(route.querySelector('.draw-route-arrow').getAttribute('d'));
        for (const i of [0, 2, 4]) {
          const vertex = transformPoint(routeTransform, [head[i], head[i + 1]]);
          const gap = Math.hypot(vertex[0] - center[0], vertex[1] - center[1]) / k;
          assert.ok(gap > outerRadiusPx, `${label}: arrow head vertex ${i / 2} stays exposed (${gap} > ${outerRadiusPx})`);
        }
        assert.equal(route.querySelector('.draw-route-target'), null, 'v4 draws no target reticle');
        assert.ok(!/NaN|Infinity|undefined/.test(svg.outerHTML));
      }
    }
  }
  for (const target of [{ targetX: NaN, targetY: 20 }, { targetX: 20, targetY: Infinity }, {}]) {
    const svg = render(DrawCompass, { x: 0, y: 0, stage: 'locked', ...target });
    const scale = Number(svg.querySelector('.draw-compass-instrument').dataset.scale);
    assert.ok(Number.isFinite(scale) && scale > 0 && scale < 1, 'unknown target gets a calm bounded pointer');
    approx(scale * 32.55, 13);
    assert.equal(svg.querySelector('.draw-compass-instrument').getAttribute('transform'), `scale(${scale})`, 'on the origin');
    assert.ok(!/NaN|Infinity|undefined/.test(svg.outerHTML));
  }
  // A coincident target keeps a visible pointer, slid back along the needle's bearing (90° = south → it sits north).
  const coincident = render(DrawCompass, { x: 1, y: 2, targetX: 1, targetY: 2, angle: 450, stage: 'locked' });
  const coincidentInstrument = coincident.querySelector('.draw-compass-instrument');
  approx(Number(coincidentInstrument.dataset.scale) * 32.55, 13);
  assert.deepEqual(numbers(coincidentInstrument.getAttribute('transform')).slice(0, 2), [0, -13]);
  assert.ok(!/NaN|Infinity|undefined/.test(coincident.outerHTML));
});

// v4 line of attack (README §Map rendering, DEC D20): in the local frame the origin is (0,0) and the target is
// (d,0) in screen px; the shaft is a quadratic bent 22% of d to the right of travel and ends at the head base.
function headGeometry(svg) {
  const [tipX, tipY, ax, ay, bx, by] = numbers(svg.querySelector('.draw-route-arrow').getAttribute('d'));
  const base = [(ax + bx) / 2, (ay + by) / 2];
  return { tip: [tipX, tipY], corners: [[ax, ay], [bx, by]], base,
    length: Math.hypot(tipX - base[0], tipY - base[1]), halfWidth: Math.hypot(ax - bx, ay - by) / 2 };
}

test('route transform lands precisely on the requested destination in every direction and zoom', () => {
  for (const k of [.2, .75, 2.5]) {
    for (const [x2, y2] of [[380, 120], [80, 420], [-220, 120], [80, -180], [333, 307]]) {
      const svg = render(AttackVector, { x1: 80, y1: 120, x2, y2, k });
      const root = svg.querySelector('.draw-route');
      const distance = Math.hypot(x2 - 80, y2 - 120) / k;
      approx(Number(root.dataset.distancePx), distance);
      const head = headGeometry(svg);
      approx(head.tip[0], distance, 'head tip is the local target'); approx(head.tip[1], 0, 'head tip on the axis');
      const worldTip = transformPoint(root.getAttribute('transform'), head.tip);
      approx(worldTip[0], x2, 'target x'); approx(worldTip[1], y2, 'target y');
      approx(head.length, Math.min(distance * .4, 18), 'head length min(.4d, 18px)');
      approx(head.halfWidth, Math.min(distance * .24, 10), 'head half-width min(.24d, 10px)');
      const shaft = numbers(svg.querySelector('.draw-route-line').getAttribute('d'));
      assert.deepEqual(shaft.slice(0, 2), [0, 0], 'shaft starts at the origin');
      approx(shaft[2], distance / 2, 'control point at the midpoint'); approx(shaft[3], distance * .22, 'bent 22% of the length');
      approx(shaft[4], head.base[0], 'shaft ends at the head base x'); approx(shaft[5], head.base[1], 'shaft ends at the head base y');
      assert.equal(svg.querySelector('.draw-route-casing').getAttribute('d'), svg.querySelector('.draw-route-line').getAttribute('d'));
      assert.equal(Number(svg.querySelector('.draw-route-casing').getAttribute('stroke-width')), 7, 'white halo 7px');
      assert.equal(Number(svg.querySelector('.draw-route-line').getAttribute('stroke-width')), 3.2, 'ink shaft 3.2px');
      assert.equal(Number(svg.querySelector('.draw-route-arrow').getAttribute('stroke-width')), 1.2, 'head edge 1.2px');
      assert.equal(Number(svg.querySelector('.draw-route-origin').getAttribute('r')), 3.4, 'origin r 3.4');
      assert.equal(Number(svg.querySelector('.draw-route-origin').getAttribute('stroke-width')), 1.8, 'origin ring 1.8');
      assert.equal(svg.querySelector('.draw-route-target'), null);
      assert.equal(svg.querySelector('.draw-route-line').hasAttribute('stroke-dasharray'), false, 'a locked draw is solid');
    }
  }
  // Paint order: halo, shaft, head, origin; the curve bends to the right-hand side of travel (local +y).
  const order = [...render(AttackVector, { x1: 0, y1: 0, x2: 200, y2: 0 }).querySelector('.draw-route').children].map(node => node.getAttribute('class'));
  assert.deepEqual(order, ['draw-route-casing', 'draw-route-line', 'draw-route-arrow', 'draw-route-origin']);
});

test('the your-turn preview dashes only the ink shaft, straight or routed', () => {
  const straight = render(AttackVector, { x1: 0, y1: 0, x2: 150, y2: 40, k: .5, dashed: true });
  assert.equal(straight.querySelector('.draw-route-line').getAttribute('stroke-dasharray'), '7 5');
  assert.equal(straight.querySelector('.draw-route-casing').hasAttribute('stroke-dasharray'), false, 'the halo stays solid');
  assert.equal(straight.querySelector('.draw-route').dataset.dashed, 'true');
  // Routed (k 2): 100 map units = 50px; the head reaches 18px (36 units) back, so the shaft stops at 64.
  const routeD = 'M0 0 L40 30 L90 30';
  const routed = render(AttackVector, { x1: 0, y1: 0, x2: 90, y2: 30, k: 2, routeD, routeKind: 'sea', dashed: true,
    routePoints: [[0, 0], [40, 30], [90, 30]] });
  const line = routed.querySelector('.draw-route-line');
  assert.equal(line.getAttribute('d'), routeD, 'the engine route is kept verbatim');
  assert.equal(line.getAttribute('pathLength'), '100');
  assert.equal(line.getAttribute('stroke-dasharray'), '14 10 14 10 14 110',
    'screen-px 7/5 dashes × k up to the head base, then one gap past the end');
  assert.equal(routed.querySelector('.draw-route-casing').getAttribute('stroke-dasharray'), '64 101', 'the halo stays solid to the head base');
  const solid = render(AttackVector, { x1: 0, y1: 0, x2: 90, y2: 30, k: 2, routeD, routeKind: 'sea', routePoints: [[0, 0], [40, 30], [90, 30]] });
  assert.equal(solid.querySelector('.draw-route-line').getAttribute('stroke-dasharray'), '64 101',
    'sea routes are solid (one dash that ends at the head base) unless previewed');
  assert.equal(Number(solid.querySelector('.draw-route-line').getAttribute('stroke-width')), 6.4, '3.2px × k');
  const head = numbers(solid.querySelector('.draw-route-arrow').getAttribute('d'));
  assert.deepEqual(head.slice(0, 2), [0, 0], 'routed head tip sits on the route end');
  const group = solid.querySelector('.draw-route-arrow').parentNode;
  const tip = transformPoint(group.getAttribute('transform'), [0, 0]);
  approx(tip[0], 90); approx(tip[1], 30);
});

test('a routed head is sized from the whole route and the shaft stops at its base, even after a short last leg', () => {
  // A sea route whose last leg (sea node → shore) is only 5px: the head must still out-size the halo and shaft.
  const close = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 2e-3, `${message}: ${actual} ≠ ${expected}`);
  for (const k of [.5, 1, 3]) {
    const points = [[0, 0], [120, 0], [120, 80], [124, 83]].map(([x, y]) => [x * k, y * k]);
    const routeD = points.map(([x, y], i) => `${i ? 'L' : 'M'}${x},${y}`).join('');
    const svg = render(AttackVector, { x1: 0, y1: 0, x2: points[3][0], y2: points[3][1], k, routeD, routeKind: 'sea', routePoints: points });
    const [tipX, tipY, backX, upperY, , lowerY] = numbers(svg.querySelector('.draw-route-arrow').getAttribute('d'));
    assert.deepEqual([tipX, tipY], [0, 0]);
    const headHalfWidth = (lowerY - upperY) / 2;
    const shaftHalf = Number(svg.querySelector('.draw-route-line').getAttribute('stroke-width')) / k / 2;
    const haloHalf = Number(svg.querySelector('.draw-route-casing').getAttribute('stroke-width')) / k / 2;
    assert.equal(headHalfWidth, 10, 'full 10px half-width from the 205px route, not .24 × the 5px leg');
    assert.ok(headHalfWidth >= shaftHalf && headHalfWidth >= haloHalf, 'the head is wider than the halo and the shaft');
    // The head runs from the point 18px back along the route (on the 80px leg) to the end.
    const group = svg.querySelector('.draw-route-arrow').parentNode.getAttribute('transform');
    const tip = transformPoint(group, [0, 0]);
    close(tip[0], 124 * k, 'tip x'); close(tip[1], 83 * k, 'tip y');
    const base = transformPoint(group, [backX, 0]);
    close(base[0], 120 * k, 'base x on the route'); close(base[1], 67 * k, 'base y 18px back along the route');
    close(-backX, Math.hypot(4, 16), 'head length = the chord from its base to the tip');
    // Halo and shaft end exactly at that base: one dash of (205 − 18) px × k over pathLength 205 px × k.
    for (const selector of ['.draw-route-casing', '.draw-route-line']) {
      const path = svg.querySelector(selector);
      assert.equal(path.getAttribute('d'), routeD, `${selector} keeps the engine route`);
      close(Number(path.getAttribute('pathLength')), 205 * k, `${selector} pathLength`);
      const [dash, gap] = numbers(path.getAttribute('stroke-dasharray'));
      close(dash, 187 * k, `${selector} stops at the head base`);
      assert.ok(gap > 18 * k, `${selector} draws nothing under the head`);
    }
  }
  // A route given only as routeD (no points) still gets a finite head and dash from the chord.
  const bare = render(AttackVector, { x1: 0, y1: 0, x2: 100, y2: 0, routeD: 'M0,0L50,20L100,0', routeKind: 'sea' });
  assert.ok(!/NaN|Infinity|undefined/.test(bare.outerHTML));
  assert.equal(numbers(bare.querySelector('.draw-route-line').getAttribute('stroke-dasharray'))[0], 82);
});

// Deliberate change (DEC D20 allows it): a route shorter than 28px no longer shrinks to a dot. The arrow keeps a 28px
// minimum on screen, starts behind the attacker's capital (local x = d − 28) and its tip stays exactly on the target.
test('short routes keep a 28px minimum arrow whose tip stays on the target', () => {
  for (const distance of [.5, 1, 3, 5, 12, 23.99, 24, 27.99, 28, 96, 96.01, 300]) {
    for (const k of [.2, 1, 4]) {
      const svg = render(AttackVector, { x1: 0, y1: 0, x2: distance * k, y2: 0, k });
      const root = svg.querySelector('.draw-route');
      assert.ok(root, `${distance}px is a drawable route`);
      const shown = Math.max(distance, 28), start = distance - shown;
      const origin = svg.querySelector('.draw-route-origin');
      const sourceRadius = Number(origin.getAttribute('r'));
      const head = headGeometry(svg);
      approx(head.tip[0], distance); approx(head.tip[1], 0);
      approx(head.length, Math.min(shown * .4, 18), 'head length min(.4 × shown, 18px)');
      approx(head.halfWidth, Math.min(shown * .24, 10), 'head half-width min(.24 × shown, 10px)');
      const shaft = numbers(svg.querySelector('.draw-route-line').getAttribute('d'));
      approx(shaft[0], start, 'the shaft starts 28px before the tip on a short route'); approx(shaft[1], 0);
      approx(Number(origin.getAttribute('cx') || 0), start, 'the origin ring sits at the arrow start');
      assert.ok(head.corners.every(([x]) => x > start && x < distance), 'the head base lies between the arrow start and tip');
      assert.ok(sourceRadius <= 3.4 + 1e-9 && start + sourceRadius < head.base[0], 'origin ring never reaches the head');
      approx(sourceRadius, 3.4, 'a 28px arrow keeps the full origin ring');
      approx(Number(svg.querySelector('.draw-route-line').getAttribute('stroke-width')), 3.2, 'and the full shaft');
      assert.equal(svg.querySelector('.draw-route-target'), null);
      assert.equal(svg.querySelector('.draw-route-line').hasAttribute('stroke-dasharray'), false, 'only the preview is dashed');
      for (const node of svg.querySelectorAll('[d], [transform], [r], [stroke-width]')) {
        for (const attr of ['d', 'transform', 'r', 'stroke-width']) {
          const value = node.getAttribute(attr);
          if (value == null) continue;
          assert.ok(!/NaN|Infinity|undefined/.test(value), `${attr} is finite: ${value}`);
          assert.ok(numbers(value).every(Number.isFinite));
        }
      }
    }
  }
});

test('coincident, subpixel and invalid endpoints do not create invalid arrow geometry', () => {
  for (const props of [
    { x1: 0, y1: 0, x2: 0, y2: 0 },
    { x1: 0, y1: 0, x2: .49, y2: 0 },
    { x1: NaN, y1: 0, x2: 40, y2: 20 },
    { x1: 0, y1: 0, x2: Infinity, y2: 20 },
    { x1: 0, y1: undefined, x2: 40, y2: 20 },
    { x1: '0', y1: 0, x2: 40, y2: 20 },
  ]) assert.equal(render(AttackVector, props).querySelector('.draw-route'), null);
  for (const k of [0, -1, NaN, Infinity]) {
    const svg = render(AttackVector, { x1: 0, y1: 0, x2: 100, y2: 0, k });
    assert.equal(svg.querySelector('.draw-route').dataset.distancePx, '100');
  }
});

test('multiple instruments have no shared marker IDs, focus targets or pointer interception', () => {
  const host = document.createElement('div');
  host.innerHTML = renderToStaticMarkup(React.createElement('svg', null,
    ...[0, 1, 2].flatMap(index => [
      React.createElement(DrawCompass, { key: `compass-${index}`, x: index * 20, y: 0,
        stage: 'locked', attackerName: 'Portugal', targetName: 'Spain', targetX: 80, targetY: 20 }),
      React.createElement(AttackVector, { key: `route-${index}`, x1: 0, y1: index, x2: 80, y2: 20 }),
    ]),
  ));
  assert.equal(host.querySelectorAll('[data-testid="draw-compass"]').length, 3);
  assert.equal(host.querySelectorAll('[data-testid="attack-vector"]').length, 3);
  assert.equal(host.querySelectorAll('[id], marker, [marker-end], [marker-start], button, a, [tabindex], [role="button"]').length, 0);
  assert.ok(!host.innerHTML.includes('url(#'));
  for (const root of host.querySelectorAll('.draw-compass, .draw-route')) {
    assert.equal(root.getAttribute('pointer-events'), 'none');
  }
  assert.equal(rule('.draw-compass, .draw-route').style.getPropertyValue('pointer-events'), 'none');
  for (const compass of host.querySelectorAll('.draw-compass')) {
    assert.equal(compass.getAttribute('role'), 'img');
    assert.equal(compass.getAttribute('aria-label'), 'Portugal locked on Spain');
    assert.equal(compass.querySelector('title').textContent, 'Portugal locked on Spain');
    assert.equal(compass.dataset.targetX, '80');
    assert.equal(compass.dataset.targetY, '20');
  }
});

test('v4 paint: white disk, ink needle with a clay tip, white halo, ink shaft and head, white origin ring', () => {
  const value = (selector, property) => rule(selector).style.getPropertyValue(property).trim();
  // The halo is the --map-halo token: white in the light theme (its fallback), the page ground in dark.
  const WHITE = /^(#ffffff|#fff|rgb\(255, 255, 255\)|var\(--map-halo, #ffffff\))$/i;
  assert.match(value('.draw-compass-disk', 'fill'), /--panel|#fff/i);
  assert.match(value('.draw-compass-disk', 'stroke'), /--ink|#111417/i);
  assert.match(value('.draw-compass-tail', 'fill'), /--ink|#111417/i);
  assert.match(value('.draw-compass-tip', 'fill'), /--you\b|#9c5a43/i);
  assert.match(value('.draw-compass-north', 'fill'), /--you-text|#8c4a35/i);
  assert.match(value('.draw-route-casing', 'stroke'), WHITE);
  assert.equal(Number(value('.draw-route-casing', 'stroke-opacity')), .9);
  assert.match(value('.draw-route-line', 'stroke'), /--ink|#111417/i);
  assert.equal(value('.draw-route-line', 'stroke-linecap'), 'round');
  assert.match(value('.draw-route-arrow', 'fill'), /--ink|#111417/i);
  assert.match(value('.draw-route-arrow', 'stroke'), WHITE);
  assert.match(value('.draw-route-origin', 'fill'), WHITE);
  assert.ok(!/#202b28|#e7e6dc|#18241e|#f0eee4/i.test(css), 'no legacy dark-theme colours remain');
});
