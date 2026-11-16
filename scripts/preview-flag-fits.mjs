// Visual check of whole-flag fitting (src/engine/flagFit.js) with the production renderer (FlagArt, clipped to the
// land as on the map), on real geography: each flag as it was (stretched over its region's box) and as it is fitted.
// Run after build-flag-fits; open /docs/design/flag-fit-review.html in Vite (npm run dev).
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { build } from 'esbuild';
import { WorldGeometry, mergeSharedIds } from '../src/engine/geo.js';
import { createFlagRegionIndex, FLAG_REGION_GAP_KM } from '../src/engine/flagRegions.js';
import { BANNER_PAD, flagFit, layoutFlagFit } from '../src/engine/flagFit.js';
import { NATIONS } from '../src/data/teams.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const bundled = await build({ entryPoints: [path.join(root, 'src/components/FlagArt.jsx')],
  bundle: true, write: false, format: 'cjs', platform: 'node', external: ['react'], jsx: 'automatic', logLevel: 'silent' });
const module = { exports: {} };
new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const FlagArt = module.exports.default;
// As the app draws the world: the rules map's fit, the 50m atlas's outlines in it.
const load = async name => JSON.parse(await readFile(path.join(root, 'public', name), 'utf8'));
const rules = new WorldGeometry(await load('world-110m.v1.json')).fitTo(Object.keys(NATIONS));
const { s, tx, ty } = rules.fit, paths = new WorldGeometry(mergeSharedIds(await load('countries-50m.json'))).buildPaths(s, tx, ty);
const pathOf = id => paths[id] || rules.paths[id];
const shapes = rules.countries.filter(c => pathOf(c.id)?.labelRings?.length).map(c => ({ id: c.id, rings: pathOf(c.id).labelRings }));
const index = createFlagRegionIndex(shapes, { maxGap: FLAG_REGION_GAP_KM / rules.kmPerUnit });

// [title, flag code, the shapes its owner holds]; the largest region they make is shown.
const fixtures = [
  ['Norway', 'no', ['578']], ['Sweden', 'se', ['752']], ['Finland', 'fi', ['246']], ['Denmark', 'dk', ['208']],
  ['Iceland', 'is', ['352']], ['Greece', 'gr', ['300']], ['England', 'gb-eng', ['826']], ['Croatia', 'hr', ['191']],
  ['Spain, 1945–77', 'es-1945', ['724']], ['Italy', 'it', ['380']], ['Germany', 'de', ['276']], ['France', 'fr', ['250']],
  ['Russia', 'ru', ['643']], ['Bosnia and Herzegovina', 'ba', ['070']], ['Serbia', 'rs', ['688']],
  ['Bulgaria, 1971–90', 'bg-1971', ['100']], ['Czechoslovakia', 'cz', ['203', '703']], ['Chile', 'cl', ['152']],
  ['Argentina', 'ar', ['032']], ['United States', 'us', ['840']], ['Mexico', 'mx', ['484']], ['Vietnam', 'vn', ['704']],
  ['Indonesia', 'id', ['360']], ['Philippines', 'ph', ['608']], ['Malaysia', 'my', ['458']], ['Australia', 'au', ['036']],
  ['New Zealand', 'nz', ['554']], ['China', 'cn', ['156']], ['India', 'in', ['356']], ['Tanzania', 'tz', ['834']],
  ['Nepal', 'np', ['524']], ['Panama', 'pa', ['591']],
  ['German empire', 'de', ['276', '616', '203', '703', '040', '208']],
  ['Swedish empire', 'se', ['752', '578', '246', '208', '233', '428', '440']],
  ['Croatian empire', 'hr', ['191', '070', '688', '499', 'KOS', '807', '008', '705']],
];

// About the width of a card's map in device pixels: the lip over an SVG's edge is sized by it (FlagArt's scale).
const CARD_PX = 520;
const cards = [];
for (const [title, code, held] of fixtures) {
  const regions = index.components(Object.fromEntries(held.map(id => [id, code])));
  const region = regions.slice().sort((a, b) => b.bbox.w * b.bbox.h - a.bbox.w * a.bbox.h)[0];
  if (!region) { console.warn(`${title}: no region`); continue; }
  const b = region.bbox, fit = flagFit(code);
  const flag = { id: `fit-${cards.length}`, ownerId: code, color: '#819084', url: `/flags/${code}.svg`,
    bbox: { x: b.x - BANNER_PAD, y: b.y - BANNER_PAD, w: b.w + 2 * BANNER_PAD, h: b.h + 2 * BANNER_PAD } };
  const d = region.parts.flatMap(p => p.rings).map(r => 'M' + r.map(p => p.join(',')).join('L') + 'Z').join('');
  const pad = Math.max(b.w, b.h) * .06;
  const view = { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 };
  // The neighbours are context only: the rules map's coarser outlines. Each card draws its land and its neighbours once,
  // in its first panel's defs, and both panels use them.
  const near = rules.countries.map(c => rules.paths[c.id]).filter(p => p?.bbox && p.bbox.x < view.x + view.w
    && p.bbox.x + p.bbox.w > view.x && p.bbox.y < view.y + view.h && p.bbox.y + p.bbox.h > view.y).map(p => p.d).join('');
  // vector-effect is not inherited: it goes on the drawn paths themselves, and the uses' strokes stay hairlines.
  const shared = `<path id="${flag.id}-land" d="${d}" vector-effect="non-scaling-stroke"/><path id="${flag.id}-near" d="${near}" vector-effect="non-scaling-stroke"/>`;
  const render = (mode, layout) => {
    const id = flag.id + mode;
    // Rendered inside an <svg>, as on the map, then unwrapped.
    const art = renderToStaticMarkup(React.createElement('svg', null, React.createElement(FlagArt, { flag: { ...flag, id, fitLayout: layout }, scale: CARD_PX / view.w })))
      .replace(/^<svg>|<\/svg>$/g, '');
    return `<div><span>${mode}${layout ? ` · ${layout.kind}` : ''}</span><svg viewBox="${view.x} ${view.y} ${view.w} ${view.h}" aria-label="${title} ${mode}"><defs>${layout ? '' : shared}${art}<clipPath id="clip-${id}"><use href="#${flag.id}-land"/></clipPath></defs><use href="#${flag.id}-near" fill="#d9ddd3" stroke="#b9c0b2" stroke-width=".5"/><use href="#fi-flag-${id}" clip-path="url(#clip-${id})"/><use href="#${flag.id}-land" fill="none" stroke="#445" stroke-width=".7"/></svg></div>`;
  };
  cards.push(`<article><h2>${title} <small>${code}</small></h2><section>${render('Before', null)}${render('After', layoutFlagFit(region, fit))}</section></article>`);
}
const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Flag fitting checks</title>
<style>body{margin:0;padding:28px;background:#172d34;color:#e7e6dc;font:15px Arial,sans-serif}h1{font-size:25px}p{color:#b0c1bf}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(520px,1fr));gap:24px}article{border-top:1px solid #61756e}h2{font-size:17px}small{color:#b0c1bf;font-weight:400}section{display:flex;gap:16px}section>div{flex:1;min-width:0}span{font-size:12px;color:#b0c1bf}svg{display:block;width:100%;height:300px;background:#a9c4cf} @media(max-width:550px){body{padding:16px}main{grid-template-columns:1fr}svg{height:220px}}</style>
<h1>Territory flags: whole-flag fitting</h1><p>Production renderer and real map geometry. Before: each flag stretched over its region's box. After: the flag on its region's main body, stretched only as far as its artwork allows, its edges carried on over the rest.</p><main>${cards.join('\n')}</main>`;
await writeFile(path.join(root, 'docs/design/flag-fit-review.html'), html);
console.log(`Wrote ${cards.length} real-geography comparisons to docs/design/flag-fit-review.html`);
