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

test('lock shrinks into a source pointer and never hides the destination on a short route', () => {
  // ~25 screen px is the real Bosnia→Montenegro regression: the original 64px
  // opaque disk covered the entire route and opponent marker after locking.
  for (const distance of [1, 3, 10, 25, 30, 80, 300]) {
    for (const k of [.1, .4, 1, 5]) {
      const origin = [130, 200];
      const target = [origin[0], origin[1] + distance * k];
      const svg = render(DrawCompass, { x: origin[0], y: origin[1], targetX: target[0], targetY: target[1],
        angle: 810, stage: 'locked', k });
      const root = svg.querySelector('.draw-compass');
      const instrument = svg.querySelector('.draw-compass-instrument');
      const radius = Number(svg.querySelector('.draw-compass-disk').getAttribute('r'));
      const outline = Number(rule('.draw-compass-disk').style.getPropertyValue('stroke-width'));
      const transform = `${root.getAttribute('transform')} ${instrument.getAttribute('transform')}`;
      const center = transformPoint(transform, [0, 0]);
      const outerEdge = transformPoint(transform, [radius + outline / 2, 0]);
      const outerRadiusPx = (outerEdge[0] - center[0]) / k;
      assert.ok(outerRadiusPx <= Math.min(13, distance * .45) + 1e-8);
      assert.ok(outerRadiusPx < 32, 'locked dial is always smaller than the draw disk');
      assert.equal(cssRotation(svg.querySelector('.draw-compass-needle')), 810, 'shrinking does not change bearing');
      assert.equal(svg.querySelector('.draw-compass-needle').style.transition, 'none');
      assert.equal(svg.querySelectorAll('.draw-compass-north, .draw-compass-ticks, .draw-compass-inner').length, 0);
      const route = render(AttackVector, { x1: origin[0], y1: origin[1], x2: target[0], y2: target[1], k });
      const reticle = route.querySelector('.draw-route-target circle');
      const targetNearEdge = distance - Number(reticle.getAttribute('r')) - Number(reticle.getAttribute('stroke-width')) / 2;
      assert.ok(outerRadiusPx < targetNearEdge, `target reticle remains exposed at ${distance}px, k=${k}`);
    }
  }
  for (const target of [{ targetX: NaN, targetY: 20 }, { targetX: 20, targetY: Infinity }, {}]) {
    const svg = render(DrawCompass, { x: 0, y: 0, stage: 'locked', ...target });
    const scale = Number(svg.querySelector('.draw-compass-instrument').dataset.scale);
    assert.ok(Number.isFinite(scale) && scale > 0 && scale < 1, 'unknown target gets a calm bounded pointer');
    approx(scale * 32.55, 13);
    assert.ok(!/NaN|Infinity|undefined/.test(svg.outerHTML));
  }
  const coincident = render(DrawCompass, { x: 1, y: 2, targetX: 1, targetY: 2, stage: 'locked' });
  assert.equal(Number(coincident.querySelector('.draw-compass-instrument').dataset.scale), 0);
});

test('route transform lands precisely on the requested destination in every direction and zoom', () => {
  for (const k of [.2, .75, 2.5]) {
    for (const [x2, y2] of [[380, 120], [80, 420], [-220, 120], [80, -180], [333, 307]]) {
      const svg = render(AttackVector, { x1: 80, y1: 120, x2, y2, k });
      const root = svg.querySelector('.draw-route');
      const target = svg.querySelector('.draw-route-target');
      const localTarget = transformPoint(target.getAttribute('transform'), [0, 0]);
      const worldTarget = transformPoint(root.getAttribute('transform'), localTarget);
      approx(worldTarget[0], x2, 'target x'); approx(worldTarget[1], y2, 'target y');
      approx(Number(root.dataset.distancePx), Math.hypot(x2 - 80, y2 - 120) / k);
      assert.equal(Number(target.querySelector('circle').getAttribute('r')), 4.5);
      const head = numbers(svg.querySelector('.draw-route-arrow').getAttribute('d'));
      approx(head[0] - head[2], 8, 'screen-constant head length');
      approx(head[5] - head[3], 7, 'screen-constant head width');
    }
  }
});

test('short routes shrink their head and reticle without crossing the origin or engulfing the route', () => {
  for (const distance of [.5, 1, 3, 5, 12, 23.99, 24, 96, 96.01, 300]) {
    for (const k of [.2, 1, 4]) {
      const svg = render(AttackVector, { x1: 0, y1: 0, x2: distance * k, y2: 0, k });
      const root = svg.querySelector('.draw-route');
      assert.ok(root, `${distance}px is a drawable route`);
      const radius = Number(svg.querySelector('.draw-route-target circle').getAttribute('r'));
      const sourceRadius = Number(svg.querySelector('.draw-route-origin').getAttribute('r'));
      const head = numbers(svg.querySelector('.draw-route-arrow').getAttribute('d'));
      const [tipX, tipY, backX, lowY, secondBackX, highY] = head;
      assert.equal(tipY, 0); assert.equal(secondBackX, backX);
      assert.ok(sourceRadius < backX && backX < tipX && tipX < distance - radius);
      assert.ok(lowY < 0 && highY > 0 && highY === -lowY);
      assert.ok(radius * 2 <= Math.min(9, distance * .25) + 1e-9, 'reticle cannot dwarf a short route');
      assert.equal(Boolean(svg.querySelector('.draw-route-target path')), distance >= 24);
      // At fractional zoom, the nominal 96px boundary may be 96 + 1e-14.
      // Check the exact switch at k=1 and both sides at every other zoom.
      if (distance !== 96 || k === 1) {
        assert.equal(Boolean(svg.querySelector('.draw-route-line')?.hasAttribute('stroke-dasharray')), distance > 96);
      }
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
