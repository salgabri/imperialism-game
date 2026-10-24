// Dark mode: tokens.css defines a dark value for every colour token, the light map tokens mirror theme.js, and
// themedPaint() routes palette fills (and only those) through the theme tokens.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EMPIRE_PASTELS, MAP, V4, themedPaint } from '../src/theme.js';

const css = readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8');
const block = selector => {
  const start = css.indexOf(`${selector} {`);
  assert.ok(start >= 0, `${selector} block`);
  return css.slice(start, css.indexOf('\n}', start));
};
const tokens = body => Object.fromEntries([...body.matchAll(/(--[a-z0-9-]+):([^;]+);/g)].map(([, name, value]) => [name, value.trim()]));
const light = tokens(block(':root'));
const dark = tokens(block(':root[data-theme=dark]'));
const isColour = value => /^(#|rgba?\(|var\(--)/.test(value) || /rgba?\(/.test(value);

test('every light colour token has a dark value', () => {
  const missing = Object.entries(light).filter(([name, value]) => isColour(value) && !(name in dark)
    && !['--key-hint-border'].includes(name)).map(([name]) => name);
  assert.deepEqual(missing, [], 'colour tokens without a dark value');
  assert.match(block(':root[data-theme=dark]'), /color-scheme: dark;/);
});

test('light map tokens mirror the theme.js palette', () => {
  EMPIRE_PASTELS.forEach((hex, i) => assert.equal(light[`--empire-${i + 1}`], hex, `--empire-${i + 1}`));
  MAP.strengthRamp.forEach((hex, i) => assert.equal(light[`--strength-${i + 1}`], hex, `--strength-${i + 1}`));
  for (const [tone, hex] of Object.entries(MAP.frontsTint)) assert.equal(light[`--fronts-${tone}`], hex, tone);
  assert.equal(light['--land-neutral'], V4.landNeutral);
  assert.equal(light['--you-fill'], V4.youFill);
  assert.equal(light['--opponent-fill'], V4.opponentFill);
});

test('themedPaint routes palette fills through tokens and leaves other colours alone', () => {
  assert.equal(themedPaint(EMPIRE_PASTELS[0]), `var(--empire-1, ${EMPIRE_PASTELS[0]})`);
  assert.equal(themedPaint(V4.youFill), `var(--you-fill, ${V4.youFill})`);
  assert.equal(themedPaint(MAP.strengthRamp[0]), `var(--land-neutral, ${MAP.strengthRamp[0]})`, 'the first step is neutral land');
  assert.equal(themedPaint(MAP.strengthRamp[4]), `var(--strength-5, ${MAP.strengthRamp[4]})`);
  assert.equal(themedPaint(MAP.frontsTint.loss), `var(--fronts-loss, ${MAP.frontsTint.loss})`);
  for (const other of ['#ce2b37', 'transparent', 'url(#flag-380)', null, undefined]) assert.equal(themedPaint(other), other);
});
