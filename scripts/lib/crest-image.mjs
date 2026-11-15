// A crest as the game draws it, for scripts/sync-club-logos.mjs (today's crests) and scripts/sync-crest-eras.mjs (the
// period ones): trimmed of its empty margin and fitting a 128x128 square, as WebP.
import sharp from 'sharp';

/** The square a crest fits: twice the largest mark the game draws (60px). */
export const CREST_BOX = 128;

/** A crest's WebP from an image's bytes. An SVG (`svg`) is first drawn with its shorter side at 512px or more. */
export async function crestWebp(bytes, { svg = false } = {}) {
  let input = bytes;
  if (svg) {
    const { width = 100, height = 100 } = await sharp(bytes).metadata();
    const density = Math.min(2400, Math.max(72, Math.ceil(72 * 512 / Math.max(1, Math.min(width, height)))));
    input = await sharp(bytes, { density }).png().toBuffer();
  }
  const trimmed = await sharp(input).ensureAlpha().trim({ threshold: 8 }).toBuffer().catch(() => input);
  return sharp(trimmed).resize(CREST_BOX, CREST_BOX, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 86, alphaQuality: 100, effort: 6 }).toBuffer();
}
