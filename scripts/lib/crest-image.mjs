// A crest as the game draws it, for scripts/sync-club-logos.mjs (today's crests) and scripts/sync-crest-eras.mjs (the
// period ones): trimmed of its empty margin and fitting a 128x128 square, as WebP.
import sharp from 'sharp';

/** The square a crest fits: twice the largest mark the game draws (60px). */
export const CREST_BOX = 128;

/**
 * A crest's WebP from an image's bytes. An SVG (`svg`) is first drawn with its shorter side at 512px or more.
 * `background`: a crest saved on a solid box ('#ffffff'), as some archived pictures are: the box is cleared to
 * transparency, filling from the picture's edges through every pixel within `tolerance` of that colour, so the crest's
 * own areas of that colour inside its outline stay.
 */
export async function crestWebp(bytes, { svg = false, background = null, tolerance = 40 } = {}) {
  let input = bytes;
  if (svg) {
    const { width = 100, height = 100 } = await sharp(bytes).metadata();
    const density = Math.min(2400, Math.max(72, Math.ceil(72 * 512 / Math.max(1, Math.min(width, height)))));
    input = await sharp(bytes, { density }).png().toBuffer();
  }
  if (background) input = await clearBox(input, background, tolerance);
  const trimmed = await sharp(input).ensureAlpha().trim({ threshold: 8 }).toBuffer().catch(() => input);
  return sharp(trimmed).resize(CREST_BOX, CREST_BOX, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 86, alphaQuality: 100, effort: 6 }).toBuffer();
}

/** The picture with the box of colour `hex` around its crest made transparent (a fill from the edges). */
async function clearBox(input, hex, tolerance) {
  const [r0, g0, b0] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const near = p => {
    const i = p * 4;
    return data[i + 3] > 0 && Math.abs(data[i] - r0) <= tolerance && Math.abs(data[i + 1] - g0) <= tolerance
      && Math.abs(data[i + 2] - b0) <= tolerance;
  };
  const seen = new Uint8Array(width * height);
  const stack = [];
  for (let x = 0; x < width; x++) stack.push(x, (height - 1) * width + x);
  for (let y = 0; y < height; y++) stack.push(y * width, y * width + width - 1);
  while (stack.length) {
    const p = stack.pop();
    if (seen[p]) continue;
    seen[p] = 1;
    if (!near(p)) continue;
    data[p * 4 + 3] = 0;
    const x = p % width;
    if (x > 0) stack.push(p - 1);
    if (x < width - 1) stack.push(p + 1);
    if (p >= width) stack.push(p - width);
    if (p < (height - 1) * width) stack.push(p + width);
  }
  return sharp(data, { raw: { width, height, channels: 4 } }).png().toBuffer();
}
