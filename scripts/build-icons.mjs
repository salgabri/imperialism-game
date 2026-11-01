// Render the site icons from public/favicon.svg (the draw compass's needle on the clay accent):
// public/favicon.ico (16, 32 and 48 px PNGs in one ICO, for browsers and crawlers that ask for /favicon.ico) and
// public/apple-touch-icon.png (180 px, opaque, for iOS home screens). Run after editing favicon.svg.
import { readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';

const PUBLIC = new URL('../public/', import.meta.url);
const svg = await readFile(new URL('favicon.svg', PUBLIC));

/** The 64-unit SVG rasterised well above the target size, then scaled down. */
const png = size => sharp(svg, { density: 72 * 8 }).resize(size, size).png({ compressionLevel: 9 }).toBuffer();

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
console.log(`favicon.ico (${sizes.join(', ')} px) and apple-touch-icon.png (180 px) written to public/`);
