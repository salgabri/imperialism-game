// Files on a CD image, read by byte range (docs/design/cm0102-format.md, "SI's CD databases"): the ISO 9660 volume
// descriptors, directories and file extents of an image with 2048-byte sectors (an .iso) or raw 2352-byte MODE1 sectors
// (a .bin, each sector's 2048 bytes of user data at byte 16, after the sync pattern and header). Every read goes through
// an injected `readRange(start, end)` that returns exactly the image's bytes [start, end): an HTTP Range request
// (scripts/sync-retro-cds.mjs) or a local file. Long names come from the Joliet supplementary descriptor where the image
// has one. Nothing here writes or runs a file, and an image that breaks an assumption stops the read.

/** User bytes per sector. */
export const USER_BYTES = 2048;
/** The two sector layouts read: a plain image and a raw MODE1 one. */
export const LAYOUTS = Object.freeze({
  iso: Object.freeze({ sector: 2048, dataOffset: 0 }),
  mode1: Object.freeze({ sector: 2352, dataOffset: 16 }),
});
const SYNC = [0x00, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x00];
// Volume descriptors start at sector 16; real images have three or four before the terminator.
const FIRST_DESCRIPTOR = 16;
const MAX_DESCRIPTORS = 16;
const DESCRIPTOR_BATCH = 4;
// Joliet's escape sequences for UCS-2 levels 1-3.
const JOLIET_ESCAPES = new Set(['%/@', '%/C', '%/E']);
// The most sectors one readRange call asks for (about 9.6 MB of a raw image).
const CHUNK_SECTORS = 4096;

/** The layout a manifest names, checked: one of LAYOUTS. */
export function checkLayout(layout) {
  const known = Object.values(LAYOUTS).find(l => l.sector === layout?.sector && l.dataOffset === layout?.dataOffset);
  if (!known) throw new Error(`Sector layout ${JSON.stringify(layout)} is neither 2048-byte sectors nor raw 2352-byte MODE1 sectors with data at byte 16`);
  return known;
}

/** Bytes as a Uint8Array view of exactly `length` bytes, or an error naming what came back. */
function exact(bytes, length, what) {
  if (!(bytes instanceof Uint8Array)) throw new Error(`${what}: readRange returned ${typeof bytes}, not bytes`);
  if (bytes.length !== length) throw new Error(`${what}: ${bytes.length} bytes read, ${length} asked for`);
  return bytes;
}

/**
 * User bytes [offset, offset + length) of the extent that starts at sector `lba`. A plain image's are contiguous; a raw
 * image's are read as whole sectors, each checked for MODE1's sync pattern and mode byte before its user bytes are kept.
 */
export async function readUserBytes(readRange, layout, lba, offset, length) {
  const { sector, dataOffset } = checkLayout(layout);
  if (![lba, offset, length].every(n => Number.isInteger(n) && n >= 0)) throw new Error(`Bad extent read: sector ${lba}, offset ${offset}, ${length} bytes`);
  const out = new Uint8Array(length);
  if (!length) return out;
  if (sector === USER_BYTES) {
    for (let done = 0; done < length;) {
      const take = Math.min(length - done, CHUNK_SECTORS * USER_BYTES);
      const start = lba * USER_BYTES + offset + done;
      out.set(exact(await readRange(start, start + take), take, `bytes ${start}-${start + take}`), done);
      done += take;
    }
    return out;
  }
  const first = lba + Math.floor(offset / USER_BYTES), last = lba + Math.floor((offset + length - 1) / USER_BYTES);
  for (let s = first; s <= last; s += CHUNK_SECTORS) {
    const e = Math.min(last, s + CHUNK_SECTORS - 1);
    const raw = exact(await readRange(s * sector, (e + 1) * sector), (e - s + 1) * sector, `sectors ${s}-${e}`);
    for (let k = s; k <= e; k++) {
      const at = (k - s) * sector;
      if (!SYNC.every((b, i) => raw[at + i] === b) || raw[at + 15] !== 1) {
        throw new Error(`Sector ${k} is not a MODE1 sector (no sync pattern or mode byte 1 at its start): not a raw MODE1/2352 image`);
      }
      const userStart = (k - lba) * USER_BYTES;
      const from = Math.max(offset, userStart), to = Math.min(offset + length, userStart + USER_BYTES);
      out.set(raw.subarray(at + dataOffset + (from - userStart), at + dataOffset + (to - userStart)), from - offset);
    }
  }
  return out;
}

const u16 = (b, at) => b[at] | (b[at + 1] << 8);
const u32 = (b, at) => (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;
const ascii = (b, from, to) => String.fromCharCode(...b.subarray(from, to));
function ucs2(b, from, to) {
  let out = '';
  for (let i = from; i + 1 < to; i += 2) out += String.fromCharCode((b[i] << 8) | b[i + 1]);
  return out;
}

/** A directory record's extent: where it starts, how long it is, and whether it is a directory. */
function recordAt(b, at) {
  return { lba: u32(b, at + 2), size: u32(b, at + 10), directory: !!(b[at + 25] & 0x02), multiExtent: !!(b[at + 25] & 0x80) };
}

/**
 * The image's volume descriptors from sector 16 to the terminator: `{ primary, joliet }`, each `{ volumeId, created,
 * sectors, root }` (`created`: the 16 digits YYYYMMDDHHMMSScc of the creation time, `root`: the root directory's
 * extent), `joliet` null when the image has no Joliet descriptor. Stops on an image with no primary volume descriptor.
 */
export async function readVolume(readRange, layout) {
  let bytes = new Uint8Array(0), primary = null, joliet = null, ended = false;
  for (let k = 0; k < MAX_DESCRIPTORS && !ended; k++) {
    // Four sectors a read: one request finds the descriptors of every disc seen so far.
    if (k * USER_BYTES >= bytes.length) {
      const more = await readUserBytes(readRange, layout, FIRST_DESCRIPTOR + k, 0, DESCRIPTOR_BATCH * USER_BYTES);
      const joined = new Uint8Array(bytes.length + more.length);
      joined.set(bytes);
      joined.set(more, bytes.length);
      bytes = joined;
    }
    const d = bytes.subarray(k * USER_BYTES, (k + 1) * USER_BYTES);
    if (ascii(d, 1, 6) !== 'CD001' || d[6] !== 1) {
      if (!k) throw new Error(`Sector ${FIRST_DESCRIPTOR} holds no ISO 9660 volume descriptor (CD001): not a CD image of this layout`);
      throw new Error(`Sector ${FIRST_DESCRIPTOR + k} breaks the volume descriptor set before its terminator`);
    }
    const type = d[0];
    if (type === 255) { ended = true; continue; }
    const isJoliet = type === 2 && JOLIET_ESCAPES.has(ascii(d, 88, 91));
    if ((type !== 1 || primary) && (!isJoliet || joliet)) continue;
    if (u16(d, 128) !== USER_BYTES) throw new Error(`The volume's logical block is ${u16(d, 128)} bytes, not ${USER_BYTES}`);
    const volume = {
      volumeId: (isJoliet ? ucs2(d, 40, 72) : ascii(d, 40, 72)).replace(/[\0 ]+$/, ''),
      created: ascii(d, 813, 829), sectors: u32(d, 80), root: recordAt(d, 156),
    };
    if (!volume.root.directory) throw new Error('The volume descriptor\'s root record is not a directory');
    if (isJoliet) joliet = volume; else primary = volume;
  }
  if (!ended) throw new Error(`No volume descriptor set terminator within ${MAX_DESCRIPTORS} sectors of sector ${FIRST_DESCRIPTOR}`);
  if (!primary) throw new Error('The image has no ISO 9660 primary volume descriptor');
  return { primary, joliet };
}

/**
 * One directory's entries, `[{ name, lba, size, directory, date }]`, without '.' and '..': ISO 9660 names lose their
 * ';1' version and a trailing dot, Joliet names are UCS-2. Records never cross a sector, and a zero length byte ends a
 * sector's records. Extents are not checked against the volume's size: copy-protected discs of the time list a dummy
 * file past it (CM 99/00's and CM 00/01's CONFIG.AFP), and a file read from beyond the image fails in `readRange`.
 */
export async function readDirectory(readRange, layout, extent, { joliet = false } = {}) {
  if (!extent.directory) throw new Error('Not a directory');
  const bytes = await readUserBytes(readRange, layout, extent.lba, 0, extent.size);
  const entries = [];
  for (let block = 0; block < bytes.length; block += USER_BYTES) {
    const end = Math.min(bytes.length, block + USER_BYTES);
    for (let at = block; at < end;) {
      const length = bytes[at];
      if (!length) break;
      if (length < 34 || at + length > end) throw new Error(`Directory at sector ${extent.lba}: a ${length}-byte record at byte ${at} crosses its sector`);
      const idLength = bytes[at + 32];
      if (33 + idLength > length) throw new Error(`Directory at sector ${extent.lba}: a name runs past its record at byte ${at}`);
      const record = recordAt(bytes, at);
      const id = bytes.subarray(at + 33, at + 33 + idLength);
      if (!(idLength === 1 && id[0] <= 1)) {
        if (record.multiExtent) throw new Error(`Directory at sector ${extent.lba}: a file in several extents, which this reader does not join`);
        const raw = joliet ? ucs2(id, 0, idLength) : ascii(id, 0, idLength);
        const name = record.directory ? raw : raw.replace(/;\d+$/, '').replace(/\.$/, '');
        const t = bytes.subarray(at + 18, at + 25);
        const date = `${1900 + t[0]}-${String(t[1]).padStart(2, '0')}-${String(t[2]).padStart(2, '0')}`;
        entries.push({ name, lba: record.lba, size: record.size, directory: record.directory, date });
      }
      at += length;
    }
  }
  return entries;
}

/** The entry at `path` ('DATA1.HDR', 'Software/CM4 Extras/...'), each part matched without regard to case; null when absent. */
export async function findEntry(readRange, layout, volume, path, { joliet = false } = {}) {
  let entry = { name: '', ...volume.root };
  for (const part of String(path).split('/').filter(Boolean)) {
    if (!entry.directory) return null;
    const entries = await readDirectory(readRange, layout, entry, { joliet });
    const matches = entries.filter(e => e.name.toLowerCase() === part.toLowerCase());
    if (matches.length > 1) throw new Error(`${path}: ${matches.length} entries are named ${part}`);
    if (!matches.length) return null;
    [entry] = matches;
  }
  return entry;
}

/** Every file under a directory entry, depth first: `[{ path, lba, size, date }]`. */
export async function listFiles(readRange, layout, volume, directory = volume.root, { joliet = false, prefix = '' } = {}) {
  const out = [];
  for (const entry of await readDirectory(readRange, layout, directory, { joliet })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.directory) out.push(...await listFiles(readRange, layout, volume, entry, { joliet, prefix: path }));
    else out.push({ path, lba: entry.lba, size: entry.size, date: entry.date });
  }
  return out;
}

/** A file's bytes [offset, offset + length), by its directory entry. */
export async function readEntry(readRange, layout, entry, offset = 0, length = entry.size - offset) {
  if (entry.directory) throw new Error(`${entry.name} is a directory`);
  if (offset < 0 || length < 0 || offset + length > entry.size) throw new Error(`${entry.name}: bytes ${offset}-${offset + length} are outside its ${entry.size}`);
  return readUserBytes(readRange, layout, entry.lba, offset, length);
}
