// Render the site icons from public/favicon.svg (the draw compass's needle on the clay accent):
// public/favicon.ico (16, 32 and 48 px PNGs in one ICO, for browsers and crawlers that ask for /favicon.ico),
// public/apple-touch-icon.png (180 px, opaque, for iOS home screens) and the web app manifest's icons (src/pwa.js):
// icon-192.png and icon-512.png, plus icon-maskable-512.png with the needle inside the central circle every icon mask
// keeps. Run after editing favicon.svg.
import { readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';

const PUBLIC = new URL('../public/', import.meta.url);
const svg = await readFile(new URL('favicon.svg', PUBLIC));

/** The 64-unit SVG rasterised well above the target size, then scaled down. */
const png = size => sharp(svg, { density: 72 * 8 }).resize(size, size).png({ compressionLevel: 9 }).toBuffer();

/**
 * A maskable icon: a mask may keep only the central circle of 80% of its width, so the art is drawn at 80% and
 * framed in its own corner colour (the needle's tip then sits at 35% of the width from the centre, inside 40%).
 */
async function maskable(size) {
  const inner = Math.round(size * 0.8), before = Math.floor((size - inner) / 2), after = size - inner - before;
  const art = await png(inner);
  const [r, g, b] = await sharp(art).raw().toBuffer();
  return sharp(art).extend({ top: before, bottom: after, left: before, right: after, background: { r, g, b, alpha: 1 } })
    .png({ compressionLevel: 9 }).toBuffer();
}

/** An ICO holding PNG images, which every current browser reads. */
function ico(images) {
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, data }, i) => {
    const entry = 6 + 16 * i;
    header.writeUInt8(size % 256, entry); header.writeUInt8(size % 256, entry + 1);
    header.writeUInt16LE(1, entry + 4); header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(data.length, entry + 8); header.writeUInt32LE(offset, entry + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...images.map(image => image.data)]);
}

const sizes = [16, 32, 48];
const images = await Promise.all(sizes.map(async size => ({ size, data: await png(size) })));
await writeFile(new URL('favicon.ico', PUBLIC), ico(images));
await writeFile(new URL('apple-touch-icon.png', PUBLIC), await png(180));
await writeFile(new URL('icon-192.png', PUBLIC), await png(192));
await writeFile(new URL('icon-512.png', PUBLIC), await png(512));
await writeFile(new URL('icon-maskable-512.png', PUBLIC), await maskable(512));
console.log(`favicon.ico (${sizes.join(', ')} px), apple-touch-icon.png (180 px) and the app icons icon-192.png, icon-512.png `
  + 'and icon-maskable-512.png written to public/');
