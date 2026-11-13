// The Latin Extended + Vietnamese webfonts (scripts/build-fonts.mjs, public/fonts/README.md): one file per family
// where Google Fonts serves two. The stylesheet checks always run; the rebuild from the pinned sources runs where
// data-src/fonts/ holds them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { CACHE, FONT_BUILDS, ROOT, buildFont, sourceFont, unicodeRangeOf } from './build-fonts.mjs';

// Google Fonts' unicode-range for the two subsets each merged file replaces (its css2 API: Archivo v25, Archivo
// Narrow v35, the versions public/fonts/README.md lists).
const GOOGLE = {
  'latin-ext': 'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, '
    + 'U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF',
  vietnamese: 'U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+0300-0301, U+0303-0304, '
    + 'U+0308-0309, U+0323, U+0329, U+1EA0-1EF9, U+20AB',
};
const codepoints = range => unicodeRangeOf('x', `@font-face { src: url('/fonts/x'); unicode-range: ${range}; }`);
const CSS = readFileSync(path.join(ROOT, 'src', 'fonts.css'), 'utf8');

test('each family loads Google\'s Latin file and one file for Latin Extended and Vietnamese together', () => {
  const sources = [...CSS.matchAll(/url\('\/fonts\/([^']+)'\)/g)].map(match => match[1]);
  assert.deepEqual([...sources].sort(), ['archivo-latin-ext-vietnamese-variable.woff2', 'archivo-latin-variable.woff2',
    'archivo-narrow-latin-ext-vietnamese-variable.woff2', 'archivo-narrow-latin-variable.woff2']);
  const google = new Set([...codepoints(GOOGLE['latin-ext']), ...codepoints(GOOGLE.vietnamese)]);
  for (const { file } of FONT_BUILDS) {
    assert.deepEqual(unicodeRangeOf(file, CSS), google, `${file} covers what Google's two subsets did, no more`);
    // Where the ranges overlap, the face declared last is tried first: Latin, as in Google's own stylesheet.
    const latin = file.replace('latin-ext-vietnamese', 'latin');
    assert.ok(sources.indexOf(latin) > sources.indexOf(file), `${latin} is declared after ${file}`);
  }
});

const cached = FONT_BUILDS.every(build => existsSync(path.join(CACHE, build.source.name)));
test('the merged files rebuild byte for byte from the pinned sources', {
  skip: !cached && 'the pinned font sources (data-src/fonts/) are not on this computer',
}, async () => {
  for (const build of FONT_BUILDS) {
    const font = await buildFont(build, await sourceFont(build.source, { fetch: false }), CSS);
    const shipped = readFileSync(path.join(ROOT, 'public', 'fonts', build.file));
    assert.equal(Buffer.compare(font, shipped), 0, `public/fonts/${build.file} is what npm run build:fonts makes`);
  }
});
