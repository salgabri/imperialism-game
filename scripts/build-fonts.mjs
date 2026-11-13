// The Latin Extended + Vietnamese webfonts (public/fonts/README.md): one file per family where Google Fonts serves
// two, so a first visit's offline worker, which precaches every font file, asks the host for two fewer (README
// "Caching"). The Latin files, the only ones a first visit's page loads, stay Google's own.
//
// Each is cut from its family's variable font in Google Fonts' repository, at the commit that added the version
// Google Fonts serves (the version the Latin files carry): the characters src/fonts.css's unicode-range sends to the
// file, with Archivo's width axis pinned at 100% as in Google's files. Glyph shapes and advances match Google's own
// subsets (README there).
//
// Usage: node scripts/build-fonts.mjs [--check]
//   The sources are read from data-src/fonts/ (git ignores it), fetched there through polite-fetch when missing, and
//   must have their pinned SHA-256. --check writes nothing and fails unless the result matches public/fonts/ byte
//   for byte.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const CACHE = path.join(ROOT, 'data-src', 'fonts');
const FONTS = path.join(ROOT, 'public', 'fonts');
const CSS = path.join(ROOT, 'src', 'fonts.css');
const REPO = 'https://raw.githubusercontent.com/google/fonts';

export const FONT_BUILDS = Object.freeze([
  Object.freeze({
    family: 'Archivo', file: 'archivo-latin-ext-vietnamese-variable.woff2', axes: { wdth: 100 },
    source: Object.freeze({ name: 'Archivo[wdth,wght].ttf', bytes: 658596,
      sha256: '0e094a7d3c7c4c25cf1310c4b30014f1dae9332220b1c2c88f4fa996f0b05053',
      url: `${REPO}/6c70c829f09ea345d3590406693220ea35c6553f/ofl/archivo/Archivo%5Bwdth,wght%5D.ttf` }),
  }),
  Object.freeze({
    family: 'Archivo Narrow', file: 'archivo-narrow-latin-ext-vietnamese-variable.woff2',
    source: Object.freeze({ name: 'ArchivoNarrow[wght].ttf', bytes: 93304,
      sha256: 'adbe027f625c8393ae0f6e174e32e233dda485bc3eda5153ce428275394ef97f',
      url: `${REPO}/58d0496254609d7ed6d25d80bd08d36d1e3e9db4/ofl/archivonarrow/ArchivoNarrow%5Bwght%5D.ttf` }),
  }),
]);

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

/** The codepoints of the unicode-range on src/fonts.css's @font-face that loads `file`. */
export function unicodeRangeOf(file, css = readFileSync(CSS, 'utf8')) {
  const face = css.match(/@font-face\s*{[^}]*}/g)?.find(block => block.includes(`/fonts/${file}'`));
  const range = face?.match(/unicode-range:\s*([^;]+);/)?.[1];
  if (!range) throw new Error(`src/fonts.css has no @font-face with a unicode-range for ${file}`);
  const codepoints = new Set();
  for (const part of range.split(',')) {
    const [from, to = from] = part.trim().replace(/^U\+/i, '').split('-').map(hex => parseInt(hex, 16));
    for (let c = from; c <= to; c++) codepoints.add(c);
  }
  return codepoints;
}

/** A source font's bytes: from data-src/fonts/, or fetched there; refused unless it has its pinned SHA-256. */
export async function sourceFont({ name, url, sha256: pinned, bytes: size }, { fetch = true } = {}) {
  const cached = path.join(CACHE, name);
  let bytes = existsSync(cached) ? readFileSync(cached) : null;
  if (!bytes) {
    if (!fetch) return null;
    const { fetchFile } = await import('./lib/polite-fetch.mjs');
    bytes = await fetchFile(url);
    if (sha256(bytes) !== pinned) throw new Error(`${url}: SHA-256 ${sha256(bytes)}, not the pinned ${pinned}`);
    mkdirSync(CACHE, { recursive: true });
    writeFileSync(cached, bytes);
  }
  if (bytes.length !== size || sha256(bytes) !== pinned) {
    throw new Error(`data-src/fonts/${name}: ${bytes.length} bytes, SHA-256 ${sha256(bytes)}; pinned ${size} bytes, ${pinned}`);
  }
  return bytes;
}

/** One family's webfont from its source: the codepoints its @font-face covers, as WOFF2. */
export async function buildFont({ file, axes }, source, css) {
  const { default: subsetFont } = await import('subset-font');
  const text = String.fromCodePoint(...unicodeRangeOf(file, css));
  return subsetFont(source, text, { targetFormat: 'woff2', variationAxes: axes });
}

async function main() {
  const check = process.argv.includes('--check');
  const css = readFileSync(CSS, 'utf8');
  let stale = 0;
  for (const build of FONT_BUILDS) {
    const font = await buildFont(build, await sourceFont(build.source), css);
    const target = path.join(FONTS, build.file);
    const same = existsSync(target) && Buffer.compare(readFileSync(target), font) === 0;
    if (check) {
      if (!same) stale++;
      console.log(`${same ? 'ok' : 'DIFFERS'}  public/fonts/${build.file} (${font.length} bytes built)`);
    } else {
      writeFileSync(target, font);
      console.log(`${same ? 'unchanged' : 'wrote'}  public/fonts/${build.file} (${font.length} bytes)`);
    }
  }
  if (stale) {
    console.error(`${stale} font file(s) differ from what npm run build:fonts makes.`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
