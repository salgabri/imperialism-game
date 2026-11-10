// Synthetic CD images for tests (scripts/retro-cds.test.mjs), written byte by byte from the layouts docs/design/cm0102-format.md
// names: ISO 9660 with a Joliet tree, in 2048-byte or raw 2352-byte MODE1 sectors, and an InstallShield 5 header and
// cabinet. Nothing here uses the readers in scripts/lib/cd-image.mjs or scripts/lib/installshield5.mjs, and every file
// in these images is invented.
import { createHash } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';

const SECTOR = 2048;
const md5 = bytes => createHash('md5').update(bytes).digest('hex');
const ascii = text => Uint8Array.from(text, ch => ch.charCodeAt(0));
const ucs2 = text => Uint8Array.from([...text].flatMap(ch => [ch.charCodeAt(0) >> 8, ch.charCodeAt(0) & 0xff]));

function concat(parts) {
  const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}
const le16 = (b, at, v) => { b[at] = v & 0xff; b[at + 1] = (v >>> 8) & 0xff; };
const le32 = (b, at, v) => { for (let i = 0; i < 4; i++) b[at + i] = (v >>> (8 * i)) & 0xff; };
const be16 = (b, at, v) => { b[at] = (v >>> 8) & 0xff; b[at + 1] = v & 0xff; };
const be32 = (b, at, v) => { for (let i = 0; i < 4; i++) b[at + i] = (v >>> (8 * (3 - i))) & 0xff; };
const both16 = (b, at, v) => { le16(b, at, v); be16(b, at + 2, v); };
const both32 = (b, at, v) => { le32(b, at, v); be32(b, at + 4, v); };

// ---- InstallShield 5 ----

/**
 * An InstallShield 5 header and cabinet holding `files` [{ name, data, compressed = true, flags }]: `{ header, cabinet,
 * entries }`. Compressed data is cut into `chunk`-byte pieces, each a 16-bit length and a raw deflate stream. The
 * cabinet starts with a 512-byte volume header (left blank), and the header's file descriptors follow its file table.
 */
export function is5Cabinet(files, { chunk = 4096 } = {}) {
  const parts = [new Uint8Array(512)];
  let at = 512;
  const entries = files.map(file => {
    const compressed = file.compressed !== false;
    let body = file.data;
    if (compressed) {
      const chunks = [];
      for (let i = 0; i < file.data.length; i += chunk) {
        const deflated = deflateRawSync(file.data.subarray(i, i + chunk));
        const length = new Uint8Array(2);
        le16(length, 0, deflated.length);
        chunks.push(length, new Uint8Array(deflated));
      }
      body = concat(chunks);
    }
    const entry = { name: file.name, flags: file.flags ?? (compressed ? 4 : 0), expanded: file.data.length, compressed: body.length,
      dataOffset: at, md5: file.md5 ?? md5(file.data) };
    parts.push(body);
    at += body.length;
    return entry;
  });
  const directories = [''];
  // The file table: offsets of the directory names and the file descriptors, then the names, then the descriptors.
  const count = directories.length + entries.length;
  const names = [...directories, ...entries.map(e => e.name)].map(name => concat([ascii(name), new Uint8Array(1)]));
  const nameAt = [];
  let cursor = 4 * count;
  for (const name of names) { nameAt.push(cursor); cursor += name.length; }
  const descriptorAt = entries.map((_, i) => cursor + i * 0x3a);
  const table = new Uint8Array(cursor + entries.length * 0x3a);
  directories.forEach((_, i) => le32(table, 4 * i, nameAt[i]));
  entries.forEach((_, i) => le32(table, 4 * (directories.length + i), descriptorAt[i]));
  names.forEach((name, i) => table.set(name, nameAt[i]));
  entries.forEach((entry, i) => {
    const d = descriptorAt[i];
    le32(table, d, nameAt[directories.length + i]);
    le32(table, d + 4, 0);
    le16(table, d + 8, entry.flags);
    le32(table, d + 10, entry.expanded);
    le32(table, d + 14, entry.compressed);
    le32(table, d + 0x26, entry.dataOffset);
    table.set(Uint8Array.from(Buffer.from(entry.md5, 'hex')), d + 0x2a);
  });
  const DESCRIPTOR = 0x200, TABLE = 0x100;
  const header = new Uint8Array(DESCRIPTOR + TABLE + table.length);
  le32(header, 0, 0x28635349);
  le32(header, 4, 0x01005201);
  le32(header, 12, DESCRIPTOR);
  le32(header, 16, TABLE + table.length);
  le32(header, DESCRIPTOR + 0x0c, TABLE);
  le32(header, DESCRIPTOR + 0x14, table.length);
  le32(header, DESCRIPTOR + 0x18, table.length);
  le32(header, DESCRIPTOR + 0x1c, directories.length);
  le32(header, DESCRIPTOR + 0x28, entries.length);
  header.set(table, DESCRIPTOR + TABLE);
  return { header, cabinet: concat(parts), entries };
}

// ---- ISO 9660 ----

/** A directory record: its extent, size, flags and identifier, padded to an even length. */
function record(id, lba, size, directory) {
  const length = 33 + id.length + (id.length % 2 ? 0 : 1);
  const r = new Uint8Array(length);
  r[0] = length;
  both32(r, 2, lba);
  both32(r, 10, size);
  r.set([126, 11, 9, 12, 0, 0, 0], 18);
  r[25] = directory ? 2 : 0;
  both16(r, 28, 1);
  r[32] = id.length;
  r.set(id, 33);
  return r;
}

function descriptor(type, { volume, created, sectors, root, joliet }) {
  const d = new Uint8Array(SECTOR);
  d[0] = type;
  d.set(ascii('CD001'), 1);
  d[6] = 1;
  if (type === 255) return d;
  // Identifiers are padded with spaces: single bytes in the primary descriptor, UCS-2 ones in Joliet's.
  if (joliet) for (let i = 8; i < 72; i += 2) d.set([0x00, 0x20], i);
  else d.fill(0x20, 8, 72);
  d.set(joliet ? ucs2(volume) : ascii(volume), 40);
  both32(d, 80, sectors);
  if (joliet) d.set(ascii('%/E'), 88);
  both16(d, 120, 1);
  both16(d, 124, 1);
  both16(d, 128, SECTOR);
  d.set(record(new Uint8Array([0]), root.lba, root.size, true), 156);
  d.set(ascii(created), 813);
  d[881] = 1;
  return d;
}

/** The tree of `files` ({ 'Dir/Sub/name.ext': bytes }): `{ dirs: Map, files: Map }` nodes. */
function treeOf(files) {
  const root = { dirs: new Map(), files: new Map() };
  for (const [path, bytes] of Object.entries(files)) {
    const parts = path.split('/');
    let node = root;
    for (const part of parts.slice(0, -1)) {
      if (!node.dirs.has(part)) node.dirs.set(part, { dirs: new Map(), files: new Map() });
      node = node.dirs.get(part);
    }
    node.files.set(parts.at(-1), bytes);
  }
  return root;
}

/**
 * An image of `files` ({ 'Dir/name.ext': bytes }): a primary tree whose names are upper-cased with anything but A-Z,
 * 0-9, '_' and '.' made '_' (as a mastering tool's level-2 names), and unless `joliet` is false a Joliet tree with the
 * names as given. `ghost` adds a root entry whose extent lies past the image (a copy-protection dummy). `raw` writes
 * 2352-byte MODE1 sectors. Returns `{ image, sectors, lbaOf }`, `lbaOf(path)` a file's first sector.
 */
export function isoImage(files, { volume = 'FIXTURE_CD', created = '2026110912000000', joliet = true, raw = false, ghost = null } = {}) {
  const tree = treeOf(files);
  const primaryName = name => name.toUpperCase().replace(/[^A-Z0-9_.]/g, '_');
  // Sectors: 16 descriptors, then each tree's directories one a sector, then the files.
  let next = 16 + (joliet ? 3 : 2);
  const trees = [{ joliet: false }, ...(joliet ? [{ joliet: true }] : [])];
  const dirLba = new Map();
  for (const t of trees) {
    const walk = (node, key) => { dirLba.set(`${t.joliet}:${key}`, next++); for (const [name, child] of node.dirs) walk(child, `${key}/${name}`); };
    walk(tree, '');
  }
  const fileLba = new Map();
  const placeFiles = (node, key) => {
    for (const [name, bytes] of node.files) { fileLba.set(`${key}/${name}`, next); next += Math.max(1, Math.ceil(bytes.length / SECTOR)); }
    for (const [name, child] of node.dirs) placeFiles(child, `${key}/${name}`);
  };
  placeFiles(tree, '');
  const sectors = next;
  const user = new Uint8Array(sectors * SECTOR);
  const put = (lba, bytes) => user.set(bytes, lba * SECTOR);
  for (const t of trees) {
    const write = (node, key, parentKey) => {
      const own = dirLba.get(`${t.joliet}:${key}`), parent = dirLba.get(`${t.joliet}:${parentKey}`);
      const id = name => (t.joliet ? ucs2(name) : ascii(name));
      const children = [
        ...[...node.dirs.keys()].map(name => ({ name, directory: true, lba: dirLba.get(`${t.joliet}:${key}/${name}`), size: SECTOR })),
        ...[...node.files].map(([name, bytes]) => ({ name, directory: false, lba: fileLba.get(`${key}/${name}`), size: bytes.length })),
        ...(ghost && !key ? [{ name: ghost.name, directory: false, lba: ghost.lba, size: ghost.size }] : []),
      ].map(child => ({ ...child, id: t.joliet ? child.name + (child.directory ? '' : ';1') : primaryName(child.name) + (child.directory ? '' : ';1') }))
        .sort((a, b) => (a.id < b.id ? -1 : 1));
      const records = [record(new Uint8Array([0]), own, SECTOR, true), record(new Uint8Array([1]), parent, SECTOR, true),
        ...children.map(child => record(id(child.id), child.lba, child.size, child.directory))];
      const bytes = concat(records);
      if (bytes.length > SECTOR) throw new Error('A fixture directory must fit one sector');
      put(own, bytes);
      for (const [name, child] of node.dirs) write(child, `${key}/${name}`, key);
    };
    write(tree, '', '');
  }
  for (const [key, lba] of fileLba) {
    let node = tree;
    const parts = key.split('/').slice(1);
    for (const part of parts.slice(0, -1)) node = node.dirs.get(part);
    put(lba, node.files.get(parts.at(-1)));
  }
  const rootOf = isJoliet => ({ lba: dirLba.get(`${isJoliet}:`), size: SECTOR });
  put(16, descriptor(1, { volume, created, sectors, root: rootOf(false) }));
  if (joliet) put(17, descriptor(2, { volume, created, sectors, root: rootOf(true), joliet: true }));
  put(joliet ? 18 : 17, descriptor(255, {}));
  const lbaOf = path => fileLba.get(`/${path}`);
  if (!raw) return { image: user, sectors, lbaOf };
  // Raw MODE1: the sync pattern, the sector's address (minute, second, frame from 00:02:00, in BCD) and mode 1, the
  // user data, and 288 bytes of error correction (left blank: the reader does not check it).
  const image = new Uint8Array(sectors * 2352);
  const bcd = n => ((Math.floor(n / 10) << 4) | (n % 10));
  for (let k = 0; k < sectors; k++) {
    const at = k * 2352, frames = k + 150;
    image.set([0x00, ...new Array(10).fill(0xff), 0x00], at);
    image.set([bcd(Math.floor(frames / 4500)), bcd(Math.floor(frames / 75) % 60), bcd(frames % 75), 1], at + 12);
    image.set(user.subarray(k * SECTOR, (k + 1) * SECTOR), at + 16);
  }
  return { image, sectors, lbaOf };
}
