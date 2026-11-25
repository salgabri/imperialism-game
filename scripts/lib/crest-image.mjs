// A crest as the game draws it, for scripts/sync-club-logos.mjs (today's crests) and scripts/sync-crest-eras.mjs (the
// period ones): cut out of the picture it was saved on, trimmed of its empty margin and fitting a 128x128 square, as WebP.
import sharp from 'sharp';
import { cutOut } from './crest-cutout.mjs';

/** The square a crest fits: twice the largest mark the game draws (60px). */
export const CREST_BOX = 128;

/**
 * A crest's WebP from an image's bytes. An SVG (`svg`) is first drawn with its shorter side at 512px or more. `cut`: what
 * of the picture is the paper it was saved on (cutOf in scripts/lib/crest-cutout.mjs), cleared to transparency; null for a
 * picture drawn whole.
 */
export async function crestWebp(bytes, { svg = false, cut = null } = {}) {
  let input = svg ? await drawSvg(bytes) : bytes;
  if (cut) {
    const { data, width, height } = cutOut(await pixelsOf(input), cut);
    input = await sharp(data, { raw: { width, height, channels: 4 } }).png().toBuffer();
  }
  const trimmed = await sharp(input).ensureAlpha().trim({ threshold: 8 }).toBuffer().catch(() => input);
  return sharp(trimmed).resize(CREST_BOX, CREST_BOX, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 86, alphaQuality: 100, effort: 6 }).toBuffer();
}

/** The pixels of a crest's picture as crestWebp draws and cuts it: { data (RGBA), width, height }. */
export async function crestPixels(bytes, { svg = false } = {}) {
  return pixelsOf(svg ? await drawSvg(bytes) : bytes);
}

async function drawSvg(bytes) {
  const { width = 100, height = 100 } = await sharp(bytes).metadata();
  const density = Math.min(2400, Math.max(72, Math.ceil(72 * 512 / Math.max(1, Math.min(width, height)))));
  return sharp(bytes, { density }).png().toBuffer();
}

async function pixelsOf(image) {
  const { data, info } = await sharp(image).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}
