// Crests cut out of the pictures they were saved on (scripts/lib/crest-cutout.mjs; docs/design/period-marks.md,
// "Cutouts"): the paper round a crest and inside its letters is cleared, its own white stays, its edge keeps no fringe,
// and no crest the game ships stands on a white box.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { crestWebp } from './lib/crest-image.mjs';
import { cutOf, cutOut, enclosedAreas } from './lib/crest-cutout.mjs';

const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');

const INK = { '.': [255, 255, 255], '#': [0, 0, 160], '+': [128, 128, 208], g: [180, 180, 180], k: [0, 0, 0], r: [200, 0, 0], ' ': null };
/** A picture drawn in characters, `scale` pixels each ('.': white paper, '#': the crest's blue, '+': half blue, half
 * white, 'g': grey, 'k': black, 'r': red, ' ': transparent). */
function picture(rows, scale = 1) {
  const width = rows[0].length * scale, height = rows.length * scale;
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const colour = INK[rows[Math.floor(y / scale)][Math.floor(x / scale)]];
    if (colour) data.set([...colour, 255], (y * width + x) * 4);
  }
  return { data, width, height };
}
const alpha = ({ data, width }, x, y) => data[(y * width + x) * 4 + 3];
const colour = ({ data, width }, x, y) => [...data.subarray((y * width + x) * 4, (y * width + x) * 4 + 3)];

// An O and, below it, a shield with a white field: the same white means paper in one and the crest in the other.
const RING = picture([
  '............',
  '..#######...',
  '..#.....#...',
  '..#.....#...',
  '..#######...',
  '............',
  '..########..',
  '..#......#..',
  '..#......#..',
  '..########..',
  '............',
], 4);
const IN_O = [20, 12], IN_SHIELD = [22, 30], PAPER = [1, 1];

test('the box is cleared from the edges; what the crest encloses stays', () => {
  const out = cutOut(RING, { background: '#ffffff' });
  assert.equal(alpha(out, ...PAPER), 0, 'the paper round the crest');
  assert.equal(alpha(out, ...IN_O), 255);
  assert.equal(alpha(out, ...IN_SHIELD), 255);
  assert.equal(alpha(out, 9, 5), 255, 'the crest itself');
  assert.deepEqual([RING.data[3], RING.width], [255, 48], 'the picture given is left as it was');
});

test('a point clears the area it lies in, \'enclosed\' every one but those kept', () => {
  const one = cutOut(RING, { background: '#ffffff', clear: IN_O.join(',') });
  assert.equal(alpha(one, ...IN_O), 0, 'the O\'s counter');
  assert.equal(alpha(one, ...IN_SHIELD), 255, 'the shield\'s field');
  const all = cutOut(RING, { background: '#ffffff', clear: 'enclosed' });
  assert.deepEqual([alpha(all, ...IN_O), alpha(all, ...IN_SHIELD)], [0, 0]);
  const kept = cutOut(RING, { background: '#ffffff', clear: 'enclosed', keep: IN_SHIELD.join(',') });
  assert.deepEqual([alpha(kept, ...IN_O), alpha(kept, ...IN_SHIELD)], [0, 255]);
  assert.throws(() => cutOut(RING, { background: '#ffffff', clear: '500,2' }), /outside the 48x44 picture/);
});

test('a picture whose surround is transparent already is cut inside by points alone', () => {
  const clear = cutOut(picture([
    '            ',
    '  #######   ',
    '  #.....#   ',
    '  #.....#   ',
    '  #######   ',
    '            ',
  ], 4), { clear: '20,12' });
  assert.equal(alpha(clear, 20, 12), 0);
  assert.equal(alpha(clear, 9, 5), 255);
  // Its box clears through what is transparent, so a white rim left round the crest goes, and the counter stays.
  const rim = cutOut(picture([
    '            ',
    ' .........  ',
    ' .#######.  ',
    ' .#.....#.  ',
    ' .#.....#.  ',
    ' .#######.  ',
    ' .........  ',
    '            ',
  ], 4), { background: '#ffffff' });
  assert.equal(alpha(rim, 5, 5), 0, 'the rim');
  assert.equal(alpha(rim, 20, 16), 255, 'the counter');
});

test('an edge that mixed the paper with the crest becomes the crest\'s colour, part transparent', () => {
  const out = cutOut(picture([
    '..............',
    '..............',
    '..++++++++++..',
    '..+########+..',
    '..+########+..',
    '..+########+..',
    '..+########+..',
    '..+########+..',
    '..++++++++++..',
    '..............',
    '..............',
  ]), { background: '#ffffff' });
  const mixed = colour(out, 6, 2);
  assert.ok(alpha(out, 6, 2) > 100 && alpha(out, 6, 2) < 155, `half transparent (${alpha(out, 6, 2)})`);
  assert.ok(mixed[0] < 20 && mixed[1] < 20 && Math.abs(mixed[2] - 160) < 20, `the crest's blue, not a light fringe (${mixed})`);
  assert.deepEqual([alpha(out, 6, 5), colour(out, 6, 5)], [255, [0, 0, 160]], 'inside, nothing changes');
  // Beside the crest's own white the mix is with that white: it stays.
  const ball = cutOut(picture([
    '............',
    '.++++++++++.',
    '.+........+.',
    '.+........+.',
    '.+........+.',
    '.+........+.',
    '.++++++++++.',
    '............',
  ]), { background: '#ffffff' });
  assert.deepEqual([alpha(ball, 5, 1), colour(ball, 5, 1)], [255, [128, 128, 208]]);
  assert.equal(alpha(ball, 5, 3), 255, 'the ball\'s white');
});

test('a frame line at the picture\'s edge, a coloured box and a corner of another colour are paper too', () => {
  const framed = picture([
    'kkkkkkkkkkkk',
    '............',
    '..########..',
    '..########..',
    '..########..',
    '............',
    'rr..........',
    'rr..........',
  ], 4);
  assert.equal(alpha(cutOut(framed, { background: '#ffffff' }), 20, 1), 255, 'the line stays without an inset');
  const out = cutOut(framed, { background: '#ffffff', inset: '4 0 0 0', clear: '2,30' });
  assert.equal(alpha(out, 20, 1), 0, 'the frame line');
  assert.equal(alpha(out, 2, 30), 0, 'the red corner, cleared as its own colour');
  assert.equal(alpha(out, 20, 12), 255);
  const black = cutOut(picture(['kkkkkkkk', 'kk####kk', 'kk####kk', 'kkkkkkkk'], 4), { background: '#000000' });
  assert.deepEqual([alpha(black, 1, 1), alpha(black, 16, 8)], [0, 255]);
});

test('specks of the box beside the cut, and faint islands in it, go', () => {
  const noisy = picture(Array.from({ length: 120 }, () => '.'.repeat(120)));
  const put = (x, y, [r, g, b]) => noisy.data.set([r, g, b, 255], (y * 120 + x) * 4);
  for (let y = 20; y < 40; y++) for (let x = 20; x < 40; x++) put(x, y, [0, 0, 160]);
  put(5, 5, [200, 200, 200]); // a faint speck of noise
  for (const [x, y] of [[49, 9], [50, 9], [51, 9], [49, 10], [51, 10], [49, 11], [50, 11], [51, 11]]) put(x, y, [205, 205, 205]); // a faint ring round one white pixel
  put(50, 50, [160, 0, 0]); // a small mark of the crest's own
  const out = cutOut(noisy, { background: '#ffffff' });
  assert.equal(alpha(out, 5, 5), 0);
  assert.equal(alpha(out, 50, 10), 0);
  assert.equal(alpha(out, 50, 9), 0);
  assert.ok(alpha(out, 50, 50) > 200, 'strong marks stay, however small');
});

test('the areas a cut leaves are listed largest first, each with a point inside', () => {
  const areas = enclosedAreas(RING, { background: '#ffffff' });
  assert.equal(areas.length, 2);
  assert.ok(areas[0].size > areas[1].size);
  for (const area of areas) assert.deepEqual(colour(RING, ...area.at), [255, 255, 255]);
  assert.ok(areas[0].at[1] > 24 && areas[1].at[1] < 24, 'the shield\'s field, then the O\'s counter');
});

test('a record\'s cut is checked', () => {
  assert.equal(cutOf({ file: 'Crest.svg' }), null);
  assert.deepEqual(cutOf({ file: 'Crest.gif', background: '#ffffff', clear: '3,4 5,6' }), { background: '#ffffff', clear: '3,4 5,6' });
  for (const [record, message] of [
    [{ background: 'white' }, /#rrggbb/], [{ background: '#ffffff', tolerance: 0 }, /tolerance/], [{ background: '#ffffff', inset: '1 2' }, /inset/],
    [{ background: '#ffffff', clear: '3;4' }, /clear/], [{ background: '#ffffff', clear: '3,4', keep: '1,1' }, /keep/], [{ tolerance: 40 }, /background or areas/],
    [{ clear: 'enclosed' }, /need the box/],
  ]) assert.throws(() => cutOf(record, 'x'), message, JSON.stringify(record));
});

test('the drawn WebP is trimmed to what the cut leaves', async () => {
  const { data, width, height } = RING;
  const png = await sharp(data, { raw: { width, height, channels: 4 } }).png().toBuffer();
  const whole = await sharp(await crestWebp(png)).metadata();
  const cut = await sharp(await crestWebp(png, { cut: { background: '#ffffff' } })).metadata();
  assert.ok(cut.width < width && cut.height < height && cut.hasAlpha, `${cut.width}x${cut.height}`);
  assert.deepEqual([whole.hasAlpha ?? false, cut.width, cut.height], [whole.hasAlpha ?? false, 32, 36]);
});

// ---------- the crests the game ships ----------

const { crests } = JSON.parse(read('scripts/data/crest-eras.json'));
const { pages, cuts = {} } = JSON.parse(read('scripts/data/club-logos.json'));

test('every cut in the manifests is sound, and a "cuts" record is of a crest of today the full sync drew', () => {
  for (const [key, record] of Object.entries(crests)) cutOf(record, key);
  for (const [id, record] of Object.entries(pages)) cutOf(record, id);
  const rows = read('public/club-logos/SOURCES.tsv').split('\n').filter(line => line && !line.startsWith('#')).slice(1).map(line => line.split('\t'));
  const own = new Set(rows.filter(row => row[2] === `${row[0]}.webp`).map(row => row[0]));
  for (const [id, record] of Object.entries(cuts)) {
    assert.ok(cutOf(record, id), `${id}: cuts nothing`);
    assert.ok(own.has(id), `${id}: wears a crest file of its own`);
    assert.ok(!Object.hasOwn(pages, id), `${id}: its "pages" record names its cut`);
    assert.match(record.image, /^https:\/\/upload\.wikimedia\.org\/wikipedia\/[^?#]+$/, id);
    assert.match(record.sha256, /^[0-9a-f]{64}$/, id);
  }
});

// Crests whose picture fills its corners with white by design.
const WHITE_CORNERS = {
  'd191-129887': 'NK Mladost Ždralovi: a rectangle of its own, its white panels running to the corners',
};

test('no crest the game ships stands on a white box: its corners are see-through or its own', async () => {
  const names = readdirSync(new URL('public/club-logos/', root)).filter(name => name.endsWith('.webp'));
  assert.ok(names.length > 7000, `${names.length} crests`);
  const boxed = [];
  let next = 0;
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (next < names.length) {
      const name = names[next++];
      const { data, info: { width, height } } = await sharp(fileURLToPath(new URL(`public/club-logos/${name}`, root))).ensureAlpha().raw()
        .toBuffer({ resolveWithObject: true });
      // A corner of paper: opaque and near white.
      const paper = (x, y) => { const i = (y * width + x) * 4; return data[i + 3] > 200 && Math.min(data[i], data[i + 1], data[i + 2]) > 235; };
      const corners = [[0, 0], [width - 1, 0], [0, height - 1], [width - 1, height - 1]].filter(([x, y]) => paper(x, y)).length;
      if (corners >= 3) boxed.push(name.slice(0, -'.webp'.length));
    }
  }));
  assert.deepEqual(boxed.filter(key => !(key in WHITE_CORNERS)).sort(), [], 'crests on a white box (a record\'s `background` clears it)');
  assert.deepEqual(Object.keys(WHITE_CORNERS).filter(key => !boxed.includes(key)), [], 'listed crests whose corners are no longer white');
});
