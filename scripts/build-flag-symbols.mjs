// Deterministically separates explicitly reviewed flag fields and emblems.
// No network, new dependencies, geometry redrawing, or runtime SVG injection.
// Usage: node scripts/build-flag-symbols.mjs [--check]
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { FLAG_SYMBOLS } from '../src/data/flagSymbols.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const destination = path.join(root, 'public', 'flags-symbols');
const reviewDestination = path.join(root, 'docs', 'design', 'flag-assets-review.html');
const check = process.argv.includes('--check');
assert(process.argv.slice(2).every(argument => argument === '--check'), 'Only --check is supported');

// Child indices count XML elements, not whitespace. Each SHA pins the complete
// reviewed source (with LF line endings); a sync-flags update must be audited instead of silently
// selecting a different path. Root/group transforms and defs remain intact.
const PROFILES = {
  al: { sha: '4ae4d2950f6a08528639700e48d19930b964478a2548cb9bf41b898c2b757b11', scope: [], field: [0], count: 3 },
  br: { sha: 'b0a912826c3ffd7287435ebed66e18fe058e992309c00dc10b430dd41a29ba91', scope: [0], field: [0], count: 17 },
  ca: { sha: '345ec9dac057e203f1331b2d3f9f473789864edaee1182a26bc261356bcf72f1', special: 'canada', count: 2 },
  ch: { sha: 'ac676cd39d7032988598ef2dd73f6bebcd767738e3e469705d6a437835ac485c', scope: [0], field: [0], count: 2 },
  es: { sha: 'f9cfaff858e95f830733ade9591037b5322dfb5827a53b70956a3d190bb49b9a', scope: [], field: [0, 1] },
  jp: { sha: 'bfea80baf9989383dc4bf7ca594ed95be0df0ff125bfc88d0bfa878eb0198022', scope: [1], field: [0], count: 2 },
  kz: { sha: '381b22e4c287b13e191c208bccfc2cfb9156cd657de248f033b920a0c713a1f3', special: 'kazakhstan', count: 2 },
  md: { sha: '987ca12a752ec2b3594c115923d50160343a7d30af8ea5e316ae04fb12b8e9dd', scope: [], field: [0] },
  me: { sha: 'd284332e23ef88ae4f1b957ce1c6d9b9f691f94e4726f15d1a4219840008387b', scope: [], field: [0, 1] },
  pt: { sha: 'a7a2cf0b44aaaaf4f3bdc0ee0fa308ec7085bdfedd3f72da1473d43fd2a569fb', scope: [], field: [0, 1], count: 4 },
  si: { sha: '3a5e0cac44baaea6b6d8e91054844b6ea72764f6dbe363c11ea11fd81203733a', scope: [1], field: [0, 1, 2], count: 9 },
  sk: { sha: '578d0693bc95214334248b47c5719dd01cfc9839bd909a726df045d499fabbb6', scope: [], field: [0, 1, 2], count: 7 },
  tr: { sha: '256a1d6afbedb9f731566982331a1cd1ad14aba211b8a61d338855879505e74f', scope: [0], field: [0], count: 4 },
  xk: { sha: '290d7f74bc73f362f9679a0bb09b7de0f679ab9aeaedf3952e40d79e0e3d25af', scope: [], field: [0], count: 3 },
};

const elements = node => Array.from(node.children);
const scopeAt = (svg, indices) => indices.reduce((node, index) => elements(node)[index], svg);
const svgHeader = '<!-- Derived from public/flags; flag-icons MIT license. See LICENSE. -->\n';
const cleanMarkup = markup => markup.replace(/\r\n/g, '\n').replace(/[\t ]+$/gm, '');
const serialize = svg => svgHeader + cleanMarkup(svg.outerHTML) + '\n';

function validateReferences(svg, label) {
  assert.equal(svg.namespaceURI, 'http://www.w3.org/2000/svg', label);
  const nodes = [svg, ...svg.querySelectorAll('*')];
  const ids = new Set();
  for (const node of nodes) {
    assert(!['script', 'foreignObject', 'image'].includes(node.localName), `${label}: unexpected active/external node`);
    const id = node.getAttribute('id');
    if (id) { assert(!ids.has(id), `${label}: duplicate id ${id}`); ids.add(id); }
    for (const attribute of node.attributes) assert(!attribute.name.toLowerCase().startsWith('on'), `${label}: event attribute`);
  }
  for (const node of nodes) for (const attribute of node.attributes) {
    if (attribute.localName === 'href') {
      assert(attribute.value.startsWith('#'), `${label}: non-local reference`);
      assert(ids.has(attribute.value.slice(1)), `${label}: missing ${attribute.value}`);
    }
    for (const match of attribute.value.matchAll(/url\(#([^)]+)\)/g)) assert(ids.has(match[1]), `${label}: missing ${match[1]}`);
  }
}

function splitArtwork(source, spec, code) {
  const field = source.cloneNode(true), symbol = source.cloneNode(true);
  if (spec.special === 'canada') {
    // This reviewed source combines both red side panels and the leaf in one
    // path. The leaf is a single independently closed final subpath, starting
    // at this exact absolute move; never split unknown artwork heuristically.
    assert.equal(elements(source).length, 2);
    const data = elements(source)[1].getAttribute('d');
    const start = data.indexOf('M201 232');
    assert(start > 0 && start === data.lastIndexOf('M201 232'), 'Canada leaf marker changed');
    const panels = data.slice(0, start), leaf = data.slice(start);
    assert.equal(panels, 'M-19.7 0h169.8v480H-19.7zm509.5 0h169.8v480H489.9z');
    assert(!/[Mm]/.test(leaf.slice(1)), 'Canada leaf gained additional subpaths');
    elements(field)[1].setAttribute('d', panels);
    elements(symbol)[0].remove();
    elements(symbol)[0].setAttribute('d', leaf);
  } else if (spec.special === 'kazakhstan') {
    // The sun and eagle move as one emblem; the original hoist ornament stays
    // in the field. All internal use references are scoped to their own group.
    assert.equal(elements(source).length, 2);
    assert.equal(elements(elements(source)[1]).length, 3);
    const fieldGold = elements(field)[1];
    elements(fieldGold).slice(0, 2).forEach(node => node.remove());
    elements(symbol)[0].remove();
    elements(elements(symbol)[0])[2].remove();
  } else {
    const originalScope = scopeAt(source, spec.scope);
    assert(originalScope, `${code}: missing reviewed group`);
    if (spec.count) assert.equal(elements(originalScope).length, spec.count, `${code}: child structure changed`);
    assert(spec.field.length < elements(originalScope).length, `${code}: empty symbol`);
    const fieldSet = new Set(spec.field);
    elements(scopeAt(field, spec.scope)).forEach((node, index) => { if (!fieldSet.has(index)) node.remove(); });
    elements(scopeAt(symbol, spec.scope)).forEach((node, index) => { if (fieldSet.has(index)) node.remove(); });
  }
  // The transparent emblem file keeps the exact original paths and transforms;
  // only the SVG viewport changes to the reviewed tight bounds.
  const { x, y, w, h } = FLAG_SYMBOLS[code].bounds;
  assert([x, y, w, h].every(Number.isFinite) && w > 0 && h > 0, `${code}: invalid bounds`);
  symbol.setAttribute('viewBox', `${x} ${y} ${w} ${h}`);
  symbol.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  field.setAttribute('preserveAspectRatio', 'none');
  field.setAttribute('id', `flag-field-${code}`);
  symbol.setAttribute('id', `flag-symbol-${code}`);
  validateReferences(field, `${code} field`);
  validateReferences(symbol, `${code} symbol`);
  return { field, symbol };
}

function reviewPage(layers) {
  // A visible native-SVG QA sheet, not app state instrumentation. This measures
  // the original-coordinate glyph bounds and compares the reassembly against
  // the unmodified source artwork. Tests inspect the same displayed report.
  const cards = layers.map(({ code, field, symbol }) => {
    const measured = symbol.cloneNode(true);
    measured.setAttribute('viewBox', '0 0 640 480');
    measured.setAttribute('width', '256'); measured.setAttribute('height', '192');
    const group = measured.ownerDocument.createElementNS(measured.namespaceURI, 'g');
    group.setAttribute('data-measure', code);
    for (const node of Array.from(measured.childNodes)) if (node.nodeType !== 1 || node.localName !== 'defs') group.appendChild(node);
    measured.appendChild(group);
    const combined = field.cloneNode(true);
    combined.setAttribute('width', '256'); combined.setAttribute('height', '192');
    // References are duplicated only on the QA sheet, never in app images.
    // Prefix all IDs in reassembled artwork to isolate them from measured SVGs.
    for (const node of elements(symbol)) if (node.localName !== 'defs') combined.appendChild(node.cloneNode(true));
    const markup = combined.outerHTML.replace(/id="([^"]+)"/g, 'id="review-$1"').replace(/(?:xlink:)?href="#([^"]+)"/g, 'href="#review-$1"').replace(/url\(#([^)]+)\)/g, 'url(#review-$1)');
    return `<article><h2>${code.toUpperCase()}</h2><div><img src="/flags/${code}.svg" width="256" height="192" alt="Original ${code} flag">${markup}${measured.outerHTML}</div></article>`;
  }).join('\n');
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>Flag symbol extraction review</title><style>body{font:15px system-ui;background:#e7e6dc;color:#28312d;margin:24px}article{border-top:1px solid #aaa;padding:8px 0}article>div{display:flex;gap:16px;align-items:center}img,svg{background:repeating-conic-gradient(#eee 0 25%,#ddd 0 50%) 0/16px 16px}pre{white-space:pre-wrap}h2{margin:8px 0}</style><h1>Flag symbol extraction review</h1><p>Original / reassembled / isolated emblem. Internal artwork is unchanged.</p><details><summary>Native SVG bounds</summary><pre id="bounds-report">Measuring…</pre></details>${cards}<script>requestAnimationFrame(()=>{const result=[...document.querySelectorAll('[data-measure]')].map(node=>{const b=node.getBBox();return {code:node.getAttribute('data-measure'),x:b.x,y:b.y,w:b.width,h:b.height}});document.querySelector('#bounds-report').textContent=JSON.stringify(result,null,2);});</script></html>\n`;
}

async function main() {
  assert.deepEqual(Object.keys(PROFILES).sort(), Object.keys(FLAG_SYMBOLS).sort());
  const output = new Map(), layers = [];
  for (const [code, spec] of Object.entries(PROFILES)) {
    const source = (await readFile(path.join(root, 'public', 'flags', `${code}.svg`), 'utf8')).replace(/\r\n/g, '\n');
    assert.equal(createHash('sha256').update(source).digest('hex'), spec.sha, `${code}: source changed; re-audit its layer profile`);
    const dom = new JSDOM(source, { contentType: 'image/svg+xml' });
    const svg = dom.window.document.documentElement;
    assert.equal(svg.getAttribute('viewBox'), '0 0 640 480', `${code}: source canvas changed`);
    validateReferences(svg, `${code} source`);
    const split = splitArtwork(svg, spec, code);
    output.set(`${code}-field.svg`, serialize(split.field));
    output.set(`${code}-symbol.svg`, serialize(split.symbol));
    layers.push({ code, ...split });
  }
  output.set('LICENSE', (await readFile(path.join(root, 'node_modules', 'flag-icons', 'LICENSE'), 'utf8')).replace(/\r\n/g, '\n'));
  output.set('README.md', '# Flag symbol layers\n\nGenerated by `node scripts/build-flag-symbols.mjs` from the vendored MIT-licensed flag-icons artwork in `public/flags`. Check with `node scripts/build-flag-symbols.mjs --check`. Do not edit the generated SVGs.\n\nFields retain their original colors, bands and structural ornaments. Emblems preserve original paths, internal references, inherited attributes and transforms, with a tight aspect-preserving viewport. The original flag assets and UI chips are unchanged. `docs/design/flag-assets-review.html` compares the source, reassembly and isolated emblem, and exposes native SVG bounds for visual QA without shipping a runtime review page.\n');
  if (!check) await mkdir(destination, { recursive: true });
  for (const [file, contents] of output) {
    const target = path.join(destination, file);
    if (check) assert.equal((await readFile(target, 'utf8')).replace(/\r\n/g, '\n'), contents, `${file}: generated asset differs`);
    else await writeFile(target, contents);
  }
  if (check) assert.deepEqual((await readdir(destination)).sort(), [...output.keys()].sort(), 'Unexpected generated files');
  if (check) assert.equal((await readFile(reviewDestination, 'utf8')).replace(/\r\n/g, '\n'), cleanMarkup(reviewPage(layers)), 'Generated review differs');
  else {
    await mkdir(path.dirname(reviewDestination), { recursive: true });
    await writeFile(reviewDestination, cleanMarkup(reviewPage(layers)));
  }
  console.log(`${check ? 'Verified' : 'Generated'} ${layers.length} reviewed field/symbol pairs (${output.size} files).`);
}

await main();
