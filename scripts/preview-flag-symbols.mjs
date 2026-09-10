// Local visual regression sheet using the production SVG pattern renderer.
// Run after build-flag-symbols; open /docs/design/flag-symbols-review.html in Vite.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { build } from 'esbuild';
import { WorldGeometry } from '../src/engine/geo.js';
import { createFlagRegionIndex, FLAG_REGION_GAP_KM } from '../src/engine/flagRegions.js';
import { layoutFlagSymbol } from '../src/engine/flagSymbolLayout.js';
import { FLAG_SYMBOLS } from '../src/data/flagSymbols.js';
import { NATIONS } from '../src/data/teams.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const bundled = await build({ entryPoints: [path.join(root, 'src/components/FlagPattern.jsx')],
  bundle: true, write: false, format: 'cjs', platform: 'node', external: ['react'], jsx: 'automatic' });
const module = { exports: {} };
new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const FlagPattern = module.exports.default;
const geometry = new WorldGeometry(JSON.parse(await readFile(path.join(root, 'public/countries-50m.json'), 'utf8')))
  .fitTo(Object.keys(NATIONS));
const fixtures = [
  ['Swiss expansion', 'ch', ['756', '250', '380']],
  ['Portugal', 'pt', ['620']], ['Iberian empire', 'pt', ['620', '724']],
  ['Spain', 'es', ['724']], ['Turkey', 'tr', ['792']], ['Japan', 'jp', ['392']],
  ['Canada', 'ca', ['124']], ['Brazil', 'br', ['076']], ['Albania', 'al', ['008']],
  ['Montenegro', 'me', ['499']], ['Slovakia', 'sk', ['703']], ['Slovenia', 'si', ['705']],
  ['Moldova', 'md', ['498']], ['Kosovo', 'xk', ['KOS']], ['Kazakhstan', 'kz', ['398']],
];
const cards = [];
for (const [title, code, countries] of fixtures) {
  const shapes = countries.map(id => ({ id, rings: geometry.paths[id].labelRings }));
  const regions = createFlagRegionIndex(shapes, { maxGap: FLAG_REGION_GAP_KM / geometry.kmPerUnit })
    .components(Object.fromEntries(countries.map(id => [id, code])));
  const region = regions.slice().sort((a, b) => b.bbox.w * b.bbox.h - a.bbox.w * a.bbox.h)[0];
  // Swiss France includes remote Guiana; prefer the European region for this sheet.
  const component = code === 'ch' ? regions.find(r => r.parts.some(p => p.countryId === '756')) : region;
  const profile = FLAG_SYMBOLS[code], b = component.bbox;
  const symbolLayout = layoutFlagSymbol(component, profile);
  const flag = { id: `review-${cards.length}`, ownerId: code, color: '#819084', url: `/flags/${code}.svg`,
    bbox: { x: b.x - .1, y: b.y - .1, w: b.w + .2, h: b.h + .2 }, symbolProfile: profile, symbolLayout,
    fieldUrl: `/${profile.fieldFile}`, symbolUrl: `/${profile.symbolFile}` };
  const d = component.parts.flatMap(p => p.rings).map(r => 'M' + r.map(p => p.join(',')).join('L') + 'Z').join('');
  const pad = Math.max(b.w, b.h) * .045;
  const render = (mode, before) => {
    const id = flag.id + mode;
    const pattern = renderToStaticMarkup(React.createElement(FlagPattern, { flag: { ...flag, id, ...(before ? { symbolLayout: null } : {}) } }));
    return `<div><span>${mode}</span><svg viewBox="${b.x - pad} ${b.y - pad} ${b.w + pad * 2} ${b.h + pad * 2}" aria-label="${title} ${mode}"><defs>${pattern}</defs><path d="${d}" fill="url(#fi-flag-${id})" stroke="#c0c7b2" stroke-width=".6" vector-effect="non-scaling-stroke"/></svg></div>`;
  };
  cards.push(`<article><h2>${title}</h2><section>${render('Before', true)}${render('After', false)}</section></article>`);
}
const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Flag symbol fitting — visual checks</title>
<style>body{margin:0;padding:28px;background:#172d34;color:#e7e6dc;font:15px Arial,sans-serif}h1{font-size:25px}p{color:#b0c1bf}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(460px,1fr));gap:24px}article{border-top:1px solid #61756e}h2{font-size:17px}section{display:flex;gap:16px}section>div{flex:1;min-width:0}span{font-size:12px;color:#b0c1bf}svg{display:block;width:100%;height:280px} @media(max-width:550px){body{padding:16px}main{grid-template-columns:1fr}svg{height:220px}}</style>
<h1>Territory flags: symbol-aware fitting</h1><p>Production renderer and real map geometry. One continuous banner per region; no symbol stretching or extra island repeats.</p><main>${cards.join('\n')}</main>`;
await mkdir(path.join(root, 'docs/design'), { recursive: true });
await writeFile(path.join(root, 'docs/design/flag-symbols-review.html'), html);
console.log(`Wrote ${fixtures.length} real-geography visual comparisons to docs/design/flag-symbols-review.html`);
