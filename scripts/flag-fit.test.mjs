// Whole-flag fitting (src/engine/flagFit.js): each flag's fit as scripts/build-flag-fits.mjs read it, and where a flag
// goes on synthetic shapes and on the real map, where the old layout (the flag stretched over its region's box) sent
// Norway's cross to Sweden and Croatia's shield to Bosnia.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { BANNER_PAD, BODY_LAND, FIT_GRID, FLAG_HEIGHT, FLAG_WIDTH, GRID_STRETCH, flagFit, flagLip, layoutFlagFit } from '../src/engine/flagFit.js';
import { FLAG_FITS } from '../src/data/flagFits.js';
import { FLAG_CODES } from '../src/data/flags.js';
import { createFlagRegionIndex, FLAG_REGION_GAP_KM } from '../src/engine/flagRegions.js';
import { WorldGeometry, mergeSharedIds } from '../src/engine/geo.js';
import { NATIONS } from '../src/data/teams.js';
import { flagSources, recordedDigest, sourcesDigest } from './build-flag-fits.mjs';

const ASPECT = FLAG_WIDTH / FLAG_HEIGHT;
const rect = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]];
const part = (countryId, ...rings) => ({ countryId, rings });
function component(...parts) {
  const points = parts.flatMap(p => p.rings.flat());
  const x = Math.min(...points.map(p => p[0])), y = Math.min(...points.map(p => p[1]));
  return { key: 'test', bbox: { x, y, w: Math.max(...points.map(p => p[0])) - x, h: Math.max(...points.map(p => p[1])) - y }, parts };
}
/** The side of a land-grid cell for a region of this size: a body is measured to within half of one. */
const cellOf = (w, h) => Math.max(w / FIT_GRID.maxSide, h / FIT_GRID.maxSide, Math.sqrt(w * h / FIT_GRID.maxCells));
const regionBox = ({ bbox: b }) => ({ x: b.x - BANNER_PAD, y: b.y - BANNER_PAD, w: b.w + 2 * BANNER_PAD, h: b.h + 2 * BANNER_PAD });
const approx = (a, b, message, tolerance = 1e-9) => assert.ok(Math.abs(a - b) <= tolerance * Math.max(1, Math.abs(a), Math.abs(b)), `${message || ''} ${a} ~= ${b}`);
/** Whether (x, y) is a region's land: any country's nonzero winding. */
function inside(region, x, y) {
  const countries = new Map();
  for (const p of region.parts) {
    if (!countries.has(p.countryId)) countries.set(p.countryId, []);
    countries.get(p.countryId).push(...p.rings);
  }
  for (const rings of countries.values()) {
    let winding = 0;
    for (const ring of rings) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[j], b = ring[i];
      const cross = (b[0] - a[0]) * (y - a[1]) - (x - a[0]) * (b[1] - a[1]);
      if (a[1] <= y && b[1] > y && cross > 0) winding++;
      else if (a[1] > y && b[1] <= y && cross < 0) winding--;
    }
    if (winding) return true;
  }
  return false;
}
const within = (box, [x, y], eps = 1e-7) => x >= box.x - eps && y >= box.y - eps && x <= box.x + box.w + eps && y <= box.y + box.h + eps;

/** What every layout promises: the flag's own proportions as its kind allows, and the region's box painted throughout. */
function validate(region, fit, layout) {
  assert.ok(layout, 'land gets a layout');
  const { flag } = layout, box = regionBox(region), eps = 1e-7 * Math.max(box.w, box.h);
  assert.equal(layout.kind, fit.kind);
  for (const value of Object.values(flag)) assert.ok(Number.isFinite(value));
  const ratio = flag.w / flag.h / ASPECT;
  if (fit.kind === 'free') approx(ratio, 1, 'a free flag keeps its proportions');
  if (fit.kind === 'grid') assert.ok(ratio >= 1 / GRID_STRETCH - 1e-9 && ratio <= GRID_STRETCH + 1e-9, `a grid flag stretches at most ${GRID_STRETCH}: ${ratio}`);
  if (fit.kind === 'rows') { approx(flag.x, box.x, 'row stripes run the region'); approx(flag.w, box.w); }
  if (fit.kind === 'cols') { approx(flag.y, box.y, 'column stripes run the region'); approx(flag.h, box.h); }
  for (const strip of layout.strips) {
    assert.ok(within(box, [strip.x, strip.y], eps) && within(box, [strip.x + strip.w, strip.y + strip.h], eps), `${strip.side} strip stays in the region`);
    assert.ok(strip.color || strip.stops?.length >= 3, 'a strip has paint');
    assert.equal(strip.from, strip.axis === 'y' ? flag.y : flag.x);
    assert.equal(strip.to, strip.axis === 'y' ? flag.y + flag.h : flag.x + flag.w);
  }
  // Every point of the region's box is the flag's or a strip's (where the flag's edge has a colour to carry on).
  const painted = [flag, ...layout.strips];
  const edgesSeeThrough = Object.values(fit.edges).some(runs => runs?.some(run => !run.color));
  for (let i = 0; i <= 24; i++) for (let j = 0; j <= 24; j++) {
    const point = [box.x + box.w * i / 24, box.y + box.h * j / 24];
    if (!edgesSeeThrough) assert.ok(painted.some(paintBox => within(paintBox, point, eps)), `region point ${point} is painted`);
  }
}

test('every flag on the map has a fit, read from the flags in public/flags as they are', async () => {
  const files = readdirSync(new URL('../public/flags/', import.meta.url)).filter(name => name.endsWith('.svg')).map(name => name.slice(0, -4)).sort();
  assert.deepEqual(Object.keys(FLAG_FITS).sort(), files);
  const written = readFileSync(new URL('../src/data/flagFits.js', import.meta.url), 'utf8');
  assert.equal(recordedDigest(written), await sourcesDigest(await flagSources()),
    'public/flags changed since src/data/flagFits.js was written: run npm run build:flag-fits');
  for (const code of new Set(Object.values(FLAG_CODES))) assert.ok(flagFit(code), `${code} has a fit`);
  assert.equal(flagFit('no-such-flag'), null);
  assert.equal(flagFit(null), null);
  assert.equal(flagFit('constructor'), null, 'only the data\'s own keys');
  assert.strictEqual(flagFit('no'), flagFit('no'), 'decoded once');
});

test('kinds come from the artwork: stripes stretch along themselves, crosses a little, emblems never', () => {
  const kinds = Object.fromEntries(['de', 'ru', 'nl', 'fr', 'it', 'ie', 'no', 'se', 'fi', 'dk', 'is', 'gr', 'gb-eng', 'us', 'hr', 'es-1945', 'ar', 'cz', 'ly-1977']
    .map(code => [code, flagFit(code).kind]));
  assert.deepEqual(kinds, { de: 'rows', ru: 'rows', nl: 'rows', fr: 'cols', it: 'cols', ie: 'cols', no: 'grid', se: 'grid', fi: 'grid',
    dk: 'grid', is: 'grid', gr: 'grid', 'gb-eng': 'grid', us: 'free', hr: 'free', 'es-1945': 'free', ar: 'free', cz: 'free', 'ly-1977': 'plain' });
  assert.deepEqual(flagFit('no').edges.left.map(run => [run.start, run.color]),
    [[0, '#ed2939'], [180, '#fff'], [210, '#002664'], [270, '#fff'], [300, '#ed2939']], 'Norway\'s left edge: red, white, blue, white, red');
  assert.equal(flagFit('de').edges.left, null, 'a row flag spans its region\'s width: no side strips');
  assert.deepEqual(flagFit('de').edges.top, [{ start: 0, color: '#000001' }]);
  // A free flag's margins: Argentina is only stripe either side of its sun; the canton's stars start near the corner.
  assert.ok(flagFit('ar').margins.left >= 240 && flagFit('ar').margins.right >= 240);
  assert.ok(flagFit('us').margins.left <= 20 && flagFit('us').margins.top <= 15);
  assert.equal(flagFit('no').margins, null);
  assert.ok(flagFit('np').edges.right.every(run => run.color === null), 'Nepal\'s fly is see-through');
});

test('stripes span the body, whatever its shape; the region\'s small islands take the outer stripes', () => {
  const body = rect(0, 0, 30, 100), islet = rect(60, 120, 2, 2);
  const region = component(part('a', body), part('a', islet));
  const cell = cellOf(62, 122);
  const rows = layoutFlagFit(region, flagFit('de'));
  validate(region, flagFit('de'), rows);
  assert.ok(Math.abs(rows.flag.y) <= cell, 'the stripes start at the body\'s top');
  assert.ok(Math.abs(rows.flag.y + rows.flag.h - 100) <= cell, 'and end at its bottom');
  assert.deepEqual(rows.strips.map(strip => [strip.side, strip.color]), [['top', '#000001'], ['bottom', '#fc0']],
    'the islet below takes the gold stripe');
  assert.ok(rows.strips[1].y + rows.strips[1].h >= 122, 'down to the islet');
  const cols = layoutFlagFit(region, flagFit('fr'));
  validate(region, flagFit('fr'), cols);
  assert.ok(Math.abs(cols.flag.x) <= cell && Math.abs(cols.flag.x + cols.flag.w - 30) <= cell);
  assert.deepEqual(cols.strips.map(strip => [strip.side, strip.color]), [['left', '#000091'], ['right', '#e1000f']],
    'the islet takes the red stripe');
});

test('a free flag keeps its shape in its body\'s box, centred, and grows only as far as its sides are stripe', () => {
  // A wide country: the flag is as tall as it and grows wider, losing height, where the canton's stars allow almost none.
  const wide = component(part('a', rect(0, 0, 160, 80)));
  const us = layoutFlagFit(wide, flagFit('us'));
  validate(wide, flagFit('us'), us);
  const margins = flagFit('us').margins, unit = us.flag.h / FLAG_HEIGHT, cell = cellOf(160, 80);
  assert.ok(us.flag.y >= -margins.top * unit - cell, 'never past its top margin');
  assert.ok(us.flag.y + us.flag.h <= 80 + margins.bottom * unit + cell, 'nor its bottom one');
  assert.ok(us.flag.h > 80 + cell, 'it grows a little');
  assert.ok(us.flag.w < 140, 'but stays well short of the country\'s width');
  // Argentina in a tall country covers it: its sides are stripe far into the flag.
  const tall = component(part('a', rect(0, 0, 30, 100)));
  const ar = layoutFlagFit(tall, flagFit('ar'));
  validate(tall, flagFit('ar'), ar);
  assert.ok(ar.flag.h >= 98, `Argentina grows to the country's height: ${ar.flag.h}`);
  const arCell = cellOf(30, 100);
  assert.ok(Math.abs(ar.flag.x + ar.flag.w / 2 - 15) <= arCell / 2, 'centred across');
  const lost = (ar.flag.w - 30 - arCell) / 2 / (ar.flag.w / FLAG_WIDTH);
  assert.ok(lost <= flagFit('ar').margins.left, 'losing only stripe either side of the sun');
  // The Philippines' triangle may lose nothing at the hoist: it grows to the right only.
  const ph = layoutFlagFit(tall, flagFit('ph'));
  validate(tall, flagFit('ph'), ph);
  assert.ok(ph.flag.x >= -1e-9 && ph.flag.x <= 1, 'the hoist stays at the body\'s edge');
  assert.ok(ph.flag.w > 30, 'and the fly grows past it');
});

test('a grid flag stretches only a little; a cross keeps its arms on the body', () => {
  const tall = component(part('a', rect(0, 0, 20, 100)));
  const se = layoutFlagFit(tall, flagFit('se'));
  validate(tall, flagFit('se'), se);
  approx(se.flag.w / se.flag.h, ASPECT / GRID_STRETCH, 'as narrow as a grid flag may get');
  assert.ok(Math.abs(se.flag.y + se.flag.h / 2 - 50) <= cellOf(20, 100), 'centred on the body');
  assert.ok(['top', 'bottom'].every(side => se.strips.some(strip => strip.side === side)), 'the cross runs on up and down');
});

test('a body whose middle is not its own gets its flag on its largest solid block (Norway, Croatia)', () => {
  // An L: a fat foot and a long thin arm up the right, so the middle of its box is sea.
  const shape = [[0, 60], [40, 60], [40, 0], [100, 0], [100, 8], [48, 8], [48, 100], [0, 100], [0, 60]];
  const region = component(part('a', shape));
  const box = region.bbox;
  assert.equal(inside(region, box.x + box.w / 2, box.y + box.h / 2), false, 'the box\'s middle is off the land');
  for (const code of ['no', 'hr']) {
    const fit = flagFit(code), layout = layoutFlagFit(region, fit);
    validate(region, fit, layout);
    const { flag } = layout;
    assert.ok(inside(region, flag.x + flag.w / 2, flag.y + flag.h / 2), `${code}: the flag's middle is on the land`);
    assert.ok(flag.y + flag.h / 2 > 60, `${code}: on the fat foot`);
    let land = 0;
    for (let i = 0; i < 20; i++) for (let j = 0; j < 20; j++) land += inside(region, flag.x + flag.w * (i + .5) / 20, flag.y + flag.h * (j + .5) / 20);
    assert.ok(land / 400 >= BODY_LAND - .1, `${code}: the flag lies mostly on the land (${land / 400})`);
  }
});

test('an archipelago keeps one flag across its large islands', () => {
  const region = component(part('a', rect(0, 0, 40, 30)), part('a', rect(0, 50, 40, 30)), part('a', rect(100, 100, 1, 1)));
  const layout = layoutFlagFit(region, flagFit('hr'));
  validate(region, flagFit('hr'), layout);
  const cell = cellOf(101, 101);
  assert.ok(Math.abs(layout.flag.x + layout.flag.w / 2 - 20) <= cell, 'centred on the two islands');
  assert.ok(Math.abs(layout.flag.y + layout.flag.h / 2 - 40) <= cell);
  assert.ok(layout.flag.h > 60, 'across both');
});

test('strips reach under the flag, lips straddle its edge, sized by the camera only as far as the underlap', () => {
  const region = component(part('a', rect(0, 0, 200, 50)));
  const layout = layoutFlagFit(region, flagFit('hr'));
  const { flag } = layout;
  const left = layout.strips.find(strip => strip.side === 'left');
  assert.ok(left.x + left.w > flag.x, 'the left strip reaches under the flag');
  assert.ok(left.x + left.w <= flag.x + .04 * Math.min(flag.w, flag.h) + 1e-9);
  const unit = flag.w / FLAG_WIDTH;
  const lip = flagLip(flag, 'left');
  approx(lip.x + lip.w / 2, flag.x, 'a lip straddles the edge');
  approx(lip.w, 2 * unit, 'one unit each way without a camera');
  approx(flagLip(flag, 'left', 1 / unit).w, 2 * 1.5 * unit, 'a pixel and a half each way at a unit a pixel');
  approx(flagLip(flag, 'left', 1e-6).w, 2 * .04 * Math.min(flag.w, flag.h), 'no wider than the underlap');
  const bottom = flagLip(flag, 'bottom', 0);
  approx(bottom.y + bottom.h / 2, flag.y + flag.h);
  approx(bottom.w, flag.w);
});

test('layouts are kept per region and fit, and bad input fails closed', () => {
  const region = component(part('a', rect(0, 0, 50, 40)));
  const fit = flagFit('fr');
  assert.strictEqual(layoutFlagFit(region, fit), layoutFlagFit(region, fit));
  assert.notStrictEqual(layoutFlagFit(region, flagFit('de')), layoutFlagFit(region, fit));
  const twin = component(part('a', rect(0, 0, 50, 40)));
  assert.deepEqual(layoutFlagFit(twin, fit), layoutFlagFit(region, fit), 'the same land, the same layout');
  assert.ok(Object.isFrozen(layoutFlagFit(region, fit)) && Object.isFrozen(layoutFlagFit(region, fit).flag));
  assert.equal(layoutFlagFit(null, fit), null);
  assert.equal(layoutFlagFit(region, null), null);
  assert.equal(layoutFlagFit({ ...region, bbox: { x: 0, y: 0, w: 0, h: 10 } }, fit), null);
  assert.equal(layoutFlagFit(component(part('a', [[0, 0], [10, 0], [0, 0]])), flagFit('hr')), null, 'no land, no layout');
});

test('on the real map: Norway\'s cross on Norway, Croatia\'s shield on Croatia, every region painted', () => {
  const load = name => JSON.parse(readFileSync(new URL(`../public/${name}`, import.meta.url), 'utf8'));
  const rules = new WorldGeometry(load('world-110m.v1.json')).fitTo(Object.keys(NATIONS));
  const { s, tx, ty } = rules.fit, paths = new WorldGeometry(mergeSharedIds(load('countries-50m.json'))).buildPaths(s, tx, ty);
  const shapes = rules.countries.map(c => ({ id: c.id, rings: (paths[c.id] || rules.paths[c.id]).labelRings }));
  const index = createFlagRegionIndex(shapes, { maxGap: FLAG_REGION_GAP_KM / rules.kmPerUnit });
  const regions = index.components(Object.fromEntries(shapes.map(shape => [shape.id, shape.id])));
  const mainland = id => regions.filter(region => region.ownerId === id).sort((a, b) => b.bbox.w * b.bbox.h - a.bbox.w * a.bbox.h)[0];
  const middle = ({ bbox: b }) => [b.x + b.w / 2, b.y + b.h / 2];

  const norway = mainland('578'), no = layoutFlagFit(norway, flagFit('no'));
  validate(norway, flagFit('no'), no);
  assert.equal(inside(norway, ...middle(norway)), false, 'the middle of Norway\'s box is not Norway');
  // The cross's centre, where flag-icons draws it: 240 of 640 across, 240 of 480 down.
  const cross = [no.flag.x + no.flag.w * 240 / 640, no.flag.y + no.flag.h / 2];
  assert.ok(inside(norway, ...cross), 'the cross is on Norway');
  assert.ok(cross[1] > norway.bbox.y + norway.bbox.h / 2, 'in the south, where Norway is widest');

  const croatia = mainland('191'), hr = layoutFlagFit(croatia, flagFit('hr'));
  validate(croatia, flagFit('hr'), hr);
  assert.equal(inside(croatia, ...middle(croatia)), false, 'the middle of Croatia\'s box is Bosnia\'s');
  assert.ok(inside(croatia, hr.flag.x + hr.flag.w / 2, hr.flag.y + hr.flag.h / 2), 'the shield is on Croatia');

  const sweden = mainland('752'), se = layoutFlagFit(sweden, flagFit('se'));
  validate(sweden, flagFit('se'), se);
  assert.ok(inside(sweden, se.flag.x + se.flag.w * 224 / 640, se.flag.y + se.flag.h / 2), 'Sweden\'s cross is on Sweden');

  const germany = mainland('276'), de = layoutFlagFit(germany, flagFit('de'));
  validate(germany, flagFit('de'), de);
  assert.ok(Math.abs(de.flag.h - germany.bbox.h) < germany.bbox.h * .03, 'Germany\'s stripes share its height');

  const argentina = mainland('032'), ar = layoutFlagFit(argentina, flagFit('ar'));
  validate(argentina, flagFit('ar'), ar);
  assert.ok(ar.flag.h > argentina.bbox.h * .9, 'Argentina\'s stripes span the country');
  assert.ok(inside(argentina, ar.flag.x + ar.flag.w / 2, ar.flag.y + ar.flag.h / 2), 'and its sun is on it');

  // Every nation's own flag on its own land, and one owner holding the world: painted throughout, in bounded time.
  const started = performance.now();
  let laid = 0;
  for (const region of regions) {
    const fit = flagFit(FLAG_CODES[region.ownerId]);
    if (!fit) continue;
    const layout = layoutFlagFit(region, fit);
    if (!layout) continue;
    validate(region, fit, layout);
    laid++;
  }
  assert.ok(laid > 200, `${laid} regions laid out`);
  for (const region of index.components(Object.fromEntries(shapes.map(shape => [shape.id, 'winner'])))) {
    for (const code of ['de', 'no', 'hr']) validate(region, flagFit(code), layoutFlagFit(region, flagFit(code)));
  }
  assert.ok(performance.now() - started < 15000, 'the world lays out within a bounded one-time budget');
});
