// The flags of nations and federations of another day (Soviet Union, SFR Yugoslavia, FR Yugoslavia, Zaire, the CIS's
// Euro 1992 flag, East Germany, South Vietnam, the United Arab Republic), which flag-icons does not have: public-domain Wikimedia Commons SVGs, pinned in
// scripts/data/historic-flags.json and committed under scripts/data/historic-flags/, redrawn on flag-icons' 4:3
// canvas (640 x 480) into public/flags/<file>.svg. No network. Each recipe keeps the original's paths and their
// transforms; only the canvas changes: the flag is scaled by its height to 480 and cut to 640 wide (at the fly when
// the emblem sits in the canton, evenly when it is centred), and a plain field becomes rectangles of the new size.
// It also measures each emblem (src/data/flagSymbols.js bounds: the drawn extent, stroke and mitred tips included,
// rounded outward with a one-unit margin) and checks the reviewed profiles against it.
// The flags of the day (src/data/flagsOfTheDay.js: Spain's eagle, Canada's Red Ensign, Rhodesia's) need no recipe: each
// is the original whole inside a 640 x 480 viewport (`fit`), drawn into a WebP bitmap when that passes 40 KB. Their
// sources, licences and authors go to public/flags/SOURCES-historic.tsv.
// Usage: node scripts/build-historic-flags.mjs [--check]
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import sharp from 'sharp';
import { FLAG_CODES } from '../src/data/flags.js';
import { FLAG_SYMBOLS } from '../src/data/flagSymbols.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const check = process.argv.includes('--check');
assert(process.argv.slice(2).every(argument => argument === '--check'), 'Only --check is supported');
const manifest = JSON.parse(await readFile(path.join(root, 'scripts/data/historic-flags.json'), 'utf8'));

const sha256 = text => createHash('sha256').update(text).digest('hex');
const squash = d => d.replace(/\s+/g, ' ').trim();
const FIELD = (fill, y = 0, h = 480) => `<path fill="${fill}" d="M0 ${y}h640v${h}H0z"/>`;

// ---- emblem measurement: affine matrices [a, b, c, d, e, f] as in SVG ----
const IDENTITY = [1, 0, 0, 1, 0, 0];
const multiply = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
const apply = (m, [x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
function parseTransform(text = '') {
  let m = IDENTITY;
  for (const [, name, args] of text.matchAll(/(matrix|translate|scale)\s*\(([^)]*)\)/g)) {
    const v = args.trim().split(/[\s,]+/).map(Number);
    const t = name === 'matrix' ? v : name === 'translate' ? [1, 0, 0, 1, v[0], v[1] ?? 0] : [v[0], 0, 0, v[1] ?? v[0], 0, 0];
    assert(t.length === 6 && t.every(Number.isFinite), `transform ${text}`);
    m = multiply(m, t);
  }
  assert(!/rotate|skew/.test(text), `unsupported transform ${text}`);
  return m;
}

/** A path's segments as polylines and Bézier curves in absolute coordinates: [{ kind, points }]. */
function segments(d) {
  const tokens = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g);
  const out = [];
  let i = 0, command = null, x = 0, y = 0, sx = 0, sy = 0, lastControl = null;
  const number = () => Number(tokens[i++]);
  while (i < tokens.length) {
    if (/^[a-zA-Z]$/.test(tokens[i])) command = tokens[i++];
    assert(command, `path ${d.slice(0, 40)}`);
    const rel = command === command.toLowerCase(), C = command.toUpperCase();
    const at = (dx, dy) => (rel ? [x + dx, y + dy] : [dx, dy]);
    if (C === 'Z') { out.push({ kind: 'line', points: [[x, y], [sx, sy]], close: true }); x = sx; y = sy; lastControl = null; command = null; continue; }
    if (C === 'M') { [x, y] = at(number(), number()); sx = x; sy = y; out.push({ kind: 'move', points: [[x, y]] }); command = rel ? 'l' : 'L'; lastControl = null; continue; }
    if (C === 'L') { const p = at(number(), number()); out.push({ kind: 'line', points: [[x, y], p] }); [x, y] = p; lastControl = null; continue; }
    if (C === 'H') { const p = [rel ? x + number() : number(), y]; out.push({ kind: 'line', points: [[x, y], p] }); [x, y] = p; lastControl = null; continue; }
    if (C === 'V') { const p = [x, rel ? y + number() : number()]; out.push({ kind: 'line', points: [[x, y], p] }); [x, y] = p; lastControl = null; continue; }
    if (C === 'C' || C === 'S') {
      const c1 = C === 'C' ? at(number(), number()) : lastControl ? [2 * x - lastControl[0], 2 * y - lastControl[1]] : [x, y];
      const c2 = at(number(), number()), p = at(number(), number());
      out.push({ kind: 'cubic', points: [[x, y], c1, c2, p] });
      lastControl = c2; [x, y] = p; continue;
    }
    if (C === 'Q') { const c1 = at(number(), number()), p = at(number(), number()); out.push({ kind: 'quad', points: [[x, y], c1, p] }); [x, y] = p; lastControl = null; continue; }
    if (C === 'A') {
      const rx = Math.abs(number()), ry = Math.abs(number()), rotation = number(), large = number(), sweep = number(), p = at(number(), number());
      out.push({ kind: 'arc', points: arcPoints([x, y], p, rx, ry, rotation, large, sweep) });
      [x, y] = p; lastControl = null; continue;
    }
    throw new Error(`unsupported path command ${command}`);
  }
  return out;
}

/**
 * Points along an elliptical arc from `p0` to `p1` (SVG's endpoint form, converted to its centre as the SVG
 * specification's implementation notes F.6.5 do), every 2°: enough for its drawn extent.
 */
function arcPoints(p0, p1, rx, ry, rotation, large, sweep) {
  if (!rx || !ry) return [p0, p1];
  const phi = rotation * Math.PI / 180, cos = Math.cos(phi), sin = Math.sin(phi);
  const dx = (p0[0] - p1[0]) / 2, dy = (p0[1] - p1[1]) / 2;
  const x1 = cos * dx + sin * dy, y1 = -sin * dx + cos * dy;
  const grow = Math.max(1, Math.sqrt(x1 * x1 / (rx * rx) + y1 * y1 / (ry * ry)));
  rx *= grow; ry *= grow;
  const sign = large === sweep ? -1 : 1;
  const k = sign * Math.sqrt(Math.max(0, (rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1) / (rx * rx * y1 * y1 + ry * ry * x1 * x1)));
  const cx1 = k * rx * y1 / ry, cy1 = -k * ry * x1 / rx;
  const cx = cos * cx1 - sin * cy1 + (p0[0] + p1[0]) / 2, cy = sin * cx1 + cos * cy1 + (p0[1] + p1[1]) / 2;
  const angle = (ux, uy) => Math.atan2(uy, ux);
  const start = angle((x1 - cx1) / rx, (y1 - cy1) / ry);
  let delta = angle((-x1 - cx1) / rx, (-y1 - cy1) / ry) - start;
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  if (sweep && delta < 0) delta += 2 * Math.PI;
  const steps = Math.max(2, Math.ceil(Math.abs(delta) / (Math.PI / 90)));
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = start + delta * i / steps;
    return [cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin, cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos];
  });
}

// The extremes of a Bézier coordinate: its end points and where its derivative is zero.
function cubicExtremes(p0, p1, p2, p3) {
  const a = -p0 + 3 * p1 - 3 * p2 + p3, b = 2 * (p0 - 2 * p1 + p2), c = p1 - p0;
  const ts = [0, 1];
  if (Math.abs(a) < 1e-12) { if (Math.abs(b) > 1e-12) ts.push(-c / b); }
  else { const disc = b * b - 4 * a * c; if (disc >= 0) ts.push((-b + Math.sqrt(disc)) / (2 * a), (-b - Math.sqrt(disc)) / (2 * a)); }
  return ts.filter(t => t >= 0 && t <= 1).map(t => (1 - t) ** 3 * p0 + 3 * (1 - t) ** 2 * t * p1 + 3 * (1 - t) * t * t * p2 + t ** 3 * p3);
}

/** The drawn extent of an element tree under `matrix`: fill geometry, plus half the stroke, plus mitred corners. */
function measure(node, matrix, box, inherited = {}) {
  const style = { ...inherited };
  for (const key of ['stroke', 'stroke-width', 'stroke-miterlimit', 'stroke-linejoin']) if (node.getAttribute?.(key) != null) style[key] = node.getAttribute(key);
  const m = multiply(matrix, parseTransform(node.getAttribute?.('transform') || ''));
  const scale = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
  const stroked = style.stroke && style.stroke !== 'none' ? Number(style['stroke-width'] ?? 1) * scale / 2 : 0;
  const add = ([px, py], pad = stroked) => {
    box.x0 = Math.min(box.x0, px - pad); box.y0 = Math.min(box.y0, py - pad);
    box.x1 = Math.max(box.x1, px + pad); box.y1 = Math.max(box.y1, py + pad);
  };
  if (node.localName === 'path') {
    const segs = segments(node.getAttribute('d')).map(seg => ({ ...seg, points: seg.points.map(p => apply(m, p)) }));
    for (const seg of segs) {
      if (seg.kind === 'cubic') {
        // The curve's own extent (its end points and turning points), with the stroke around it.
        const [p0, p1, p2, p3] = seg.points;
        const xs = cubicExtremes(p0[0], p1[0], p2[0], p3[0]), ys = cubicExtremes(p0[1], p1[1], p2[1], p3[1]);
        add([Math.min(...xs), Math.min(...ys)]); add([Math.max(...xs), Math.max(...ys)]);
      } else {
        // A line's end points; a quadratic's control point too, which can only widen the box.
        for (const p of seg.points) add(p);
      }
    }
    // A mitred corner reaches past its vertex: (w / 2) / sin(θ / 2) along the bisector, within the miter limit.
    if (stroked && (style['stroke-linejoin'] ?? 'miter') === 'miter') {
      const limit = Number(style['stroke-miterlimit'] ?? 4);
      const lines = segs.filter(seg => seg.kind === 'line');
      for (let k = 0; k < lines.length; k++) {
        const [a, v] = lines[k].points, next = lines[(k + 1) % lines.length].points;
        if (next[0][0] !== v[0] || next[0][1] !== v[1]) continue;
        const u1 = [a[0] - v[0], a[1] - v[1]], u2 = [next[1][0] - v[0], next[1][1] - v[1]];
        const l1 = Math.hypot(...u1), l2 = Math.hypot(...u2);
        if (!l1 || !l2) continue;
        const cos = (u1[0] * u2[0] + u1[1] * u2[1]) / (l1 * l2), theta = Math.acos(Math.max(-1, Math.min(1, cos)));
        const ratio = 1 / Math.sin(theta / 2);
        if (!Number.isFinite(ratio) || ratio > limit) continue;
        const bisector = [-(u1[0] / l1 + u2[0] / l2), -(u1[1] / l1 + u2[1] / l2)], len = Math.hypot(...bisector);
        if (!len) continue;
        add([v[0] + bisector[0] / len * stroked * ratio, v[1] + bisector[1] / len * stroked * ratio], 0);
      }
    }
  } else if (node.localName === 'rect') {
    // Its corners under the matrix (rounded corners only ever draw inside them).
    const x = Number(node.getAttribute('x') || 0), y = Number(node.getAttribute('y') || 0);
    const w = Number(node.getAttribute('width')), h = Number(node.getAttribute('height'));
    for (const corner of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]) add(apply(m, corner));
  } else if (node.localName === 'ellipse' || node.localName === 'circle') {
    assert(m[1] === 0 && m[2] === 0, 'an ellipse is measured without rotation');
    const cx = Number(node.getAttribute('cx')), cy = Number(node.getAttribute('cy'));
    const rx = Number(node.getAttribute(node.localName === 'circle' ? 'r' : 'rx')), ry = Number(node.getAttribute(node.localName === 'circle' ? 'r' : 'ry'));
    add(apply(m, [cx - rx, cy - ry])); add(apply(m, [cx + rx, cy + ry]));
  }
  for (const child of node.children || []) measure(child, m, box, style);
  return box;
}

/** Bounds as src/data/flagSymbols.js keeps them: rounded outward, with a one-unit margin. */
function boundsOf(markup) {
  const svg = new JSDOM(`<svg xmlns="http://www.w3.org/2000/svg">${markup}</svg>`, { contentType: 'image/svg+xml' }).window.document.documentElement;
  const box = measure(svg, IDENTITY, { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
  const x = Math.floor(box.x0) - 1, y = Math.floor(box.y0) - 1;
  return { x, y, w: Math.ceil(box.x1) + 1 - x, h: Math.ceil(box.y1) + 1 - y, exact: box };
}

// ---- recipes: the original's elements, on the 640 x 480 canvas ----

/** An element and its subtree as markup, with the class styles of `classes` set as attributes, whitespace squashed. */
function markup(node, classes = {}) {
  const attributes = [];
  for (const attribute of node.attributes) {
    if (['id', 'style', 'class'].includes(attribute.name)) continue;
    attributes.push([attribute.name, attribute.name === 'd' ? squash(attribute.value) : attribute.value]);
  }
  for (const name of (node.getAttribute('class') || '').split(/\s+/).filter(Boolean)) {
    assert(classes[name], `no style for class ${name}`);
    for (const [key, value] of classes[name]) if (!attributes.some(([existing]) => existing === key)) attributes.push([key, value]);
  }
  const inner = [...node.children].map(child => markup(child, classes)).join('');
  const open = `<${node.localName}${attributes.map(([key, value]) => ` ${key}="${value}"`).join('')}`;
  return inner ? `${open}>${inner}</${node.localName}>` : `${open}/>`;
}

// `.st0{fill:#6ABD51;...}` rules → { st0: [[property, value], ...] } (only the properties SVG has as attributes).
function classStyles(svg) {
  const css = [...svg.querySelectorAll('style')].map(style => style.textContent).join('\n');
  const out = {};
  for (const [, name, body] of css.matchAll(/\.([\w-]+)\s*\{([^}]*)\}/g)) {
    out[name] = body.split(';').map(rule => rule.split(':').map(part => part.trim())).filter(([key, value]) => key && value)
      .filter(([key]) => ['fill', 'fill-rule', 'clip-rule', 'stroke', 'stroke-width', 'stroke-miterlimit', 'stroke-linejoin', 'stroke-linecap'].includes(key))
      .map(([key, value]) => [key, /^#[0-9A-F]+$/i.test(value) ? value.toLowerCase() : value]);
  }
  return out;
}

/**
 * Each `<use>` in `svg` replaced by a group of its own transform holding a copy of what it names (ids dropped), so
 * the flag draws without references, as markup() writes it.
 */
function inlineUses(svg) {
  for (let use = svg.querySelector('use'); use; use = svg.querySelector('use')) {
    const href = use.getAttribute('xlink:href') ?? use.getAttribute('href');
    const target = href?.startsWith('#') ? svg.querySelector(`[id="${href.slice(1)}"]`) : null;
    assert(target, `use ${href} names nothing`);
    assert(!use.getAttribute('x') && !use.getAttribute('y'), 'a use with x or y');
    const group = svg.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'g');
    if (use.getAttribute('transform')) group.setAttribute('transform', use.getAttribute('transform'));
    const copy = target.cloneNode(true);
    for (const node of [copy, ...copy.querySelectorAll('[id]')]) node.removeAttribute('id');
    group.appendChild(copy);
    use.replaceWith(group);
  }
}

const RECIPES = {
  // 1200 x 600, red, the gold star and hammer and sickle in the canton: x 0.8 by height, the fly cut at 640. The field's
  // own colour is its style's, #cc0000 (the fill attribute under it, #bc0000, is overridden).
  su(svg) {
    const [field, star, emblem] = [...svg.children].filter(node => ['path', 'g'].includes(node.localName));
    assert.equal(field.getAttribute('d'), 'M0 0h1200v600H0z');
    assert.match(field.getAttribute('style'), /fill:#cc0000/);
    return { field: FIELD('#c00'),
      emblem: `<g fill="#ffd700" transform="scale(.8)"><path d="${squash(star.getAttribute('d'))}"/><g transform="${emblem.getAttribute('transform')}">${
        [...emblem.children].map(path => `<path d="${squash(path.getAttribute('d'))}"/>`).join('')}</g></g>` };
  },
  // 1000 x 500, blue, white and red thirds, the red star edged in gold at the centre: x 0.96 by height, 160 cut from
  // each side. The thirds become 160 high.
  yu(svg) {
    const [blue, white, group] = [...svg.children];
    const [red, star] = [...group.children];
    assert.deepEqual([blue.getAttribute('d'), white.getAttribute('d'), red.getAttribute('d')],
      ['M0 0h1000v500H0z', 'M0 166.667h1000V500H0z', 'M0 333.333h1000V500H0z']);
    const fill = group.getAttribute('fill');
    return { field: FIELD(blue.getAttribute('fill')) + FIELD(white.getAttribute('fill'), 160, 320) + FIELD(fill, 320, 160),
      emblem: `<path fill="${fill}" fill-rule="${star.getAttribute('fill-rule')}" stroke="${star.getAttribute('stroke')}" stroke-width="${
        star.getAttribute('stroke-width')}" transform="matrix(.96 0 0 .96 -160 0)" d="${squash(star.getAttribute('d'))}"/>` };
  },
  // 1200 x 600, blue, white and red thirds (drawn red, white over two thirds, blue over one): the same thirds, 160 high.
  'yu-1992'(svg) {
    const [red, white, blue] = [...svg.children];
    assert.deepEqual([red.getAttribute('d'), white.getAttribute('d'), blue.getAttribute('d')], ['M0 0h1200v600H0', 'M0 0h1200v400H0', 'M0 0h1200v200H0']);
    return { field: FIELD(red.getAttribute('fill')) + FIELD(white.getAttribute('fill'), 0, 320) + FIELD(blue.getAttribute('fill'), 0, 160), emblem: '' };
  },
  // 900 x 600 (viewBox), green, the yellow disc with the arm and flaming torch at the centre: x 0.8 by height, 40 cut
  // from each side. Its stylesheet classes become attributes.
  zr(svg) {
    const classes = classStyles(svg);
    const outer = [...svg.children].find(node => node.localName === 'g');
    const [field, inner] = [...outer.children];
    assert.equal(squash(field.getAttribute('d')), 'M-164-385.4h900v600h-900L-164-385.4z');
    return { field: FIELD(Object.fromEntries(classes[field.getAttribute('class')]).fill),
      emblem: `<g transform="matrix(.8 0 0 .8 -40 0)"><g transform="${outer.getAttribute('transform')}">${markup(inner, classes)}</g></g>` };
  },
  // 1000 x 600, black, red and gold thirds, the hammer and compass in their wreath at the centre: x 0.8 by height, 80 cut
  // from each side. The thirds become 160 high; the emblem's references are drawn out (inlineUses).
  dd(svg) {
    const [black, red, gold, emblem] = [...svg.children];
    assert.deepEqual([black.getAttribute('d'), red.getAttribute('d'), gold.getAttribute('d')],
      ['m0 0h1000v600h-1000z', 'm0 200h1000v400h-1000z', 'm0 400h1000v200h-1000z']);
    assert.equal(emblem.localName, 'g');
    inlineUses(svg);
    return { field: FIELD('#000') + FIELD(red.getAttribute('fill'), 160, 320) + FIELD(gold.getAttribute('fill'), 320, 160),
      emblem: `<g transform="matrix(.8 0 0 .8 -80 0)">${markup(emblem)}</g>` };
  },
  // 900 x 600, yellow, three red stripes (one stroke 40 wide at 220, 300 and 380): x 0.8 by height, 40 cut from each side.
  // The stripes become 32 high from 160, 224 and 288.
  rvn(svg) {
    const [field, stripes] = [...svg.children];
    assert.equal(field.getAttribute('fill'), '#ff0');
    assert.deepEqual([squash(stripes.getAttribute('d')), stripes.getAttribute('stroke-width')], ['m 0,220 h 900 m 0,80 H 0 m 0,80 h 900', '40']);
    const red = stripes.getAttribute('stroke');
    return { field: FIELD('#ff0') + FIELD(red, 160, 32) + FIELD(red, 224, 32) + FIELD(red, 288, 32), emblem: '' };
  },
  // 900 x 600, red, white and black thirds, the two green stars in the white: x 0.8 by height, 40 cut from each side.
  uar(svg) {
    const [black, white, red, stars] = [...svg.children];
    assert.deepEqual([black.getAttribute('d'), white.getAttribute('d'), red.getAttribute('d')], ['M0 0h900v600H0z', 'M0 0h900v400H0z', 'M0 0h900v200H0z']);
    return { field: FIELD('#000') + FIELD(white.getAttribute('fill'), 0, 320) + FIELD(red.getAttribute('fill'), 0, 160),
      emblem: `<path fill="${stars.getAttribute('fill')}" transform="matrix(.8 0 0 .8 -40 0)" d="${squash(stars.getAttribute('d'))}"/>` };
  },
  // 900 x 600, white, the blue letters C.I.S.: x 0.8 by height, 40 cut from each side.
  'cis-1992'(svg) {
    const [field, letters] = [...svg.children];
    assert.equal(field.getAttribute('fill'), '#fff');
    return { field: FIELD('#fff'),
      emblem: `<g fill="${letters.getAttribute('fill')}" transform="matrix(.8 0 0 .8 -40 0)"><g transform="${letters.getAttribute('transform')}">${
        [...letters.children].map(path => `<path d="${squash(path.getAttribute('d'))}"/>`).join('')}</g></g>` };
  },
};

// ---- the flags of the day (src/data/flagsOfTheDay.js): the original whole, inside a 640 x 480 viewport ----

// A flag is always its own document (an <img>, an <image>, or src/engine/flagRaster.js's blob), so its stylesheet,
// classes and ids stay with it.
const DROP_ELEMENTS = new Set(['metadata', 'title', 'desc', 'script', 'foreignObject']);
const EDITOR_NAMESPACES = /^(sodipodi|inkscape|rdf|dc|cc|sketch|serif|i|x|graph|a)$/;
// How the original's own aspect meets 4:3 (`fit` in scripts/data/historic-flags.json): 'slice' cuts evenly from both
// sides (a centred emblem keeps its shape), 'slice-hoist' cuts at the fly (an emblem in the canton), 'stretch' scales
// each axis on its own (bands, stars spread across the field, where cutting would lose part of the design).
const FITS = { slice: 'xMidYMid slice', 'slice-hoist': 'xMinYMid slice', stretch: 'none' };

/**
 * The original's elements, cleaned of editor data, comments and anything active, nested in a viewport that fills the
 * 640 x 480 canvas as `fit` says. Every id stays as it was: each flag is a document of its own (an <img> or <image>).
 */
function nestedFlag(svg, fit) {
  assert(FITS[fit], `fit ${fit}`);
  const document = svg.ownerDocument;
  const walker = [...svg.querySelectorAll('*')];
  for (const node of walker) {
    if (!node.isConnected) continue;
    if (DROP_ELEMENTS.has(node.localName) || (node.prefix && EDITOR_NAMESPACES.test(node.prefix))) {
      node.remove();
      continue;
    }
    if (node.localName === 'style') assert(!/@import|url\(\s*['"]?(?!#)/.test(node.textContent), 'a stylesheet that loads something');
    for (const attribute of [...node.attributes]) {
      const name = attribute.name;
      if (/^on/i.test(name) || (attribute.prefix && EDITOR_NAMESPACES.test(attribute.prefix)) || name === 'xml:space') node.removeAttribute(name);
      else if (/(^|:)href$/.test(name)) assert(attribute.value.startsWith('#'), `an external reference ${attribute.value}`);
    }
  }
  const comments = document.createTreeWalker(svg, 128 /* NodeFilter.SHOW_COMMENT */);
  const dead = [];
  while (comments.nextNode()) dead.push(comments.currentNode);
  for (const comment of dead) comment.remove();
  let viewBox = svg.getAttribute('viewBox');
  if (!viewBox) {
    const width = parseFloat(svg.getAttribute('width')), height = parseFloat(svg.getAttribute('height'));
    assert(width > 0 && height > 0, 'a flag needs a viewBox or a size');
    viewBox = `0 0 ${width} ${height}`;
  }
  viewBox = viewBox.trim().split(/[\s,]+/).map(Number).join(' ');
  const serializer = new (svg.ownerDocument.defaultView.XMLSerializer)();
  const inner = [...svg.children].map(node => serializer.serializeToString(node)
    .replace(/ xmlns="http:\/\/www\.w3\.org\/2000\/svg"/g, '')).join('').replace(/>\s+</g, '><');
  const xlink = /xlink:href/.test(inner) ? ' xmlns:xlink="http://www.w3.org/1999/xlink"' : '';
  return { field: `<svg${xlink} width="640" height="480" viewBox="${viewBox}" preserveAspectRatio="${FITS[fit]}">${inner.replace(/ xmlns:xlink="http:\/\/www\.w3\.org\/1999\/xlink"/g, '')}</svg>`, emblem: '' };
}

// ---- big drawings, drawn once into a bitmap ----

// A flag whose drawing, nested as above, passes this size (an eagle, a wreath, a coat of arms in hundreds of paths) is
// drawn once at 640 x 480 and shipped as that bitmap, a WebP inside the same 4:3 SVG: a few kilobytes instead of
// hundreds, which a chip and the map's Flags mode (src/engine/flagRaster.js) draw far sooner. Smaller ones stay vector.
const RASTER_OVER = 40 * 1024;
const rasterOf = async markup => sharp(Buffer.from(markup), { density: 72 }).resize(640, 480, { fit: 'fill' })
  .webp({ quality: 90, alphaQuality: 100, effort: 6 }).toBuffer();
const bitmapFlag = (file, webp) => `<svg xmlns="http://www.w3.org/2000/svg" id="flag-historic-${file}" viewBox="0 0 640 480">`
  + `<image width="640" height="480" preserveAspectRatio="none" href="data:image/webp;base64,${webp.toString('base64')}"/></svg>\n`;
/** The mean difference of two images' pixels (0-255 per channel): libvips can draw an SVG a shade apart on another system. */
async function pixelDistance(a, b) {
  const [x, y] = await Promise.all([a, b].map(input => sharp(input).ensureAlpha().raw().toBuffer()));
  assert.equal(x.length, y.length, 'the same size');
  let sum = 0;
  for (let i = 0; i < x.length; i++) sum += Math.abs(x[i] - y[i]);
  return sum / x.length;
}

// A flag pinned as Wikimedia's 1280px PNG of its drawing (when the server refused the original SVG to bulk downloads,
// asking for its standard thumbnails instead): fitted to 640 x 480 as `fit` says, a WebP inside the SVG like the rest.
const SHARP_FITS = { stretch: { fit: 'fill' }, slice: { fit: 'cover', position: 'centre' }, 'slice-hoist': { fit: 'cover', position: 'left' } };

let built = 0;
const report = [];
const attribution = [];
for (const flag of manifest.flags) {
  if (/\.png$/i.test(flag.source)) {
    const bytes = await readFile(path.join(root, flag.source));
    assert.equal(sha256(bytes), flag.sha256, `${flag.source}: not the pinned thumbnail`);
    assert.equal(FLAG_CODES[flag.flagId], flag.file, `src/data/flags.js must map ${flag.flagId} to ${flag.file}`);
    assert(SHARP_FITS[flag.fit], `${flag.file}: fit ${flag.fit}`);
    assert(!FLAG_SYMBOLS[flag.file], `${flag.file}: a bitmap flag has no emblem profile`);
    const webp = await sharp(bytes).resize(640, 480, SHARP_FITS[flag.fit]).webp({ quality: 90, alphaQuality: 100, effort: 6 }).toBuffer();
    const target = path.join(root, 'public', 'flags', `${flag.file}.svg`);
    if (check) {
      const embedded = /href="data:image\/webp;base64,([^"]+)"/.exec((await readFile(target, 'utf8')))?.[1];
      assert(embedded, `${flag.file}.svg: not the bitmap flag it should be`);
      const distance = await pixelDistance(Buffer.from(embedded, 'base64'), webp);
      assert(distance < 1.5, `${flag.file}.svg: its bitmap differs (mean ${distance.toFixed(2)} per channel)`);
    } else await writeFile(target, bitmapFlag(flag.file, webp));
    attribution.push([`${flag.file}.svg`, flag.name, flag.flies, flag.commons.title.replace(/^File:/, ''), flag.licence.replace(/\s+/g, ' '), flag.commons.page].join('\t'));
    built++;
    continue;
  }
  const raw = await readFile(path.join(root, flag.source));
  const text = raw.toString('utf8').replace(/\r\n/g, '\n');
  assert.equal(sha256(text), flag.lfSha256, `${flag.source}: not the pinned snapshot`);
  assert.equal(FLAG_CODES[flag.flagId], flag.file, `src/data/flags.js must map ${flag.flagId} to ${flag.file}`);
  const svg = new JSDOM(text, { contentType: 'image/svg+xml' }).window.document.documentElement;
  const { field, emblem } = RECIPES[flag.file] ? RECIPES[flag.file](svg) : nestedFlag(svg, flag.fit);
  let out = `<svg xmlns="http://www.w3.org/2000/svg" id="flag-historic-${flag.file}" viewBox="0 0 640 480">${field}${emblem}</svg>\n`;
  const target = path.join(root, 'public', 'flags', `${flag.file}.svg`);
  if (!RECIPES[flag.file] && out.length > RASTER_OVER) {
    // A bitmap: checked by its pixels, which another system's libvips may draw a shade apart.
    const webp = await rasterOf(out);
    out = bitmapFlag(flag.file, webp);
    if (check) {
      const shipped = (await readFile(target, 'utf8')).replace(/\r\n/g, '\n');
      const embedded = /href="data:image\/webp;base64,([^"]+)"/.exec(shipped)?.[1];
      assert(embedded, `${flag.file}.svg: not the bitmap flag it should be`);
      const distance = await pixelDistance(Buffer.from(embedded, 'base64'), webp);
      assert(distance < 1.5, `${flag.file}.svg: its bitmap differs (mean ${distance.toFixed(2)} per channel)`);
    } else await writeFile(target, out);
  } else if (check) assert.equal((await readFile(target, 'utf8')).replace(/\r\n/g, '\n'), out, `${flag.file}.svg: generated flag differs`);
  else await writeFile(target, out);
  attribution.push([`${flag.file}.svg`, flag.name, flag.flies, flag.commons.title.replace(/^File:/, ''), flag.licence.replace(/\s+/g, ' '), flag.commons.page].join('\t'));
  const profile = FLAG_SYMBOLS[flag.file];
  if (emblem) {
    const { exact, ...bounds } = boundsOf(emblem);
    report.push(`${flag.file}: emblem bounds ${JSON.stringify(bounds)} (drawn ${exact.x0.toFixed(2)}, ${exact.y0.toFixed(2)} to ${exact.x1.toFixed(2)}, ${exact.y1.toFixed(2)})`);
    if (profile) assert.deepEqual({ ...profile.bounds }, bounds, `${flag.file}: src/data/flagSymbols.js bounds are not the measured ones`);
  } else {
    assert(!profile, `${flag.file}: a plain field has no emblem profile`);
  }
  built++;
}
// Every historic flag's source, licence and page beside the flags (CC BY-SA drawings need their credit where they ship).
const sources = [
  '# Historic flags in this folder: GENERATED by scripts/build-historic-flags.mjs from scripts/data/historic-flags.json.',
  '# Each is a Wikimedia Commons SVG redrawn on the 640 x 480 canvas (or drawn into a bitmap there, when big). Most are in',
  '# the public domain; a drawing under CC BY-SA keeps that licence in its 4:3 version, credited to its author here.',
  ['image', 'flag', 'flown', 'Commons file', 'licence', 'file page'].join('\t'),
  ...attribution,
].join('\n') + '\n';
const sourcesFile = path.join(root, 'public', 'flags', 'SOURCES-historic.tsv');
if (check) assert.equal((await readFile(sourcesFile, 'utf8')).replace(/\r\n/g, '\n'), sources, 'public/flags/SOURCES-historic.tsv differs');
else await writeFile(sourcesFile, sources);
console.log(report.join('\n'));
console.log(`${check ? 'Verified' : 'Generated'} ${built} historic flags in public/flags.`);
