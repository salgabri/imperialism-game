// InstallShield 5 cabinets (docs/design/cm0102-format.md, "SI's CD databases"): the format SI's Championship Manager
// 99/00 and 00/01 CDs install their data from, a header file (data1.hdr) and the cabinet (data1.cab). The header holds
// a file table: each file's name, directory, flags, expanded and compressed size, its data's offset in the cabinet and
// the MD5 of its expanded bytes. A compressed file's data is a run of chunks, each a 16-bit little-endian length and a
// raw deflate stream (RFC 1951) of up to 64 KB. The layout is as the unshield project documents it for version 5,
// read for facts only (no code copied). Bytes in, bytes out: nothing here reads a file, and a header or chunk that breaks
// the layout, or a file whose MD5 is not the header's, stops the read.
import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';

/** 'ISc(' little-endian, the first word of every InstallShield cabinet header. */
export const IS5_SIGNATURE = 0x28635349;
/** File flags: stored across two volumes, obfuscated, compressed, or a dead entry. */
export const IS5_FLAGS = Object.freeze({ split: 1, obfuscated: 2, compressed: 4, invalid: 8 });
// Bytes of a version-5 file descriptor: name offset, directory, flags, the two sizes, 20 unread, data offset, MD5.
const DESCRIPTOR_BYTES = 0x3a;

const u16 = (b, at) => b[at] | (b[at + 1] << 8);
const u32 = (b, at) => (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;
const hex = bytes => Buffer.from(bytes).toString('hex');

/** The cabinet format's major version from the header's version word, as unshield reads it. */
export function is5Major(version) {
  const family = version >>> 24;
  if (family === 1) return (version >>> 12) & 0xf;
  if (family === 2 || family === 4) return Math.floor((version & 0xffff) / 100);
  return -1;
}

/**
 * A version-5 header's file table: `{ version, major, directories, files }`, each file `{ index, directory, name, flags,
 * expanded, compressed, dataOffset, md5 }` in the header's order (`md5` in hex). Stops on another signature or version,
 * or on an offset outside the header.
 */
export function readIs5Header(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 20) throw new Error('An InstallShield header is at least 20 bytes');
  if (u32(bytes, 0) !== IS5_SIGNATURE) throw new Error('Not an InstallShield cabinet header (no ISc( signature)');
  const version = u32(bytes, 4), major = is5Major(version);
  if (major !== 5) throw new Error(`InstallShield cabinet version ${version.toString(16)} is format ${major}, not 5`);
  const inside = (at, length, what) => {
    if (!Number.isInteger(at) || at < 0 || at + length > bytes.length) throw new Error(`InstallShield header: ${what} at byte ${at} is outside its ${bytes.length} bytes`);
    return at;
  };
  const descriptor = inside(u32(bytes, 12), 0x2c, 'the cabinet descriptor');
  const table = inside(descriptor + u32(bytes, descriptor + 0x0c), 0, 'the file table');
  const dirCount = u32(bytes, descriptor + 0x1c), fileCount = u32(bytes, descriptor + 0x28);
  inside(table, 4 * (dirCount + fileCount), `the file table's ${dirCount + fileCount} offsets`);
  const offsetOf = i => u32(bytes, table + 4 * i);
  const text = at => {
    let end = inside(at, 1, 'a name');
    while (end < bytes.length && bytes[end]) end++;
    if (end === bytes.length) throw new Error(`InstallShield header: the name at byte ${at} has no end`);
    return String.fromCharCode(...bytes.subarray(at, end));
  };
  const directories = Array.from({ length: dirCount }, (_, i) => text(table + offsetOf(i)));
  const files = Array.from({ length: fileCount }, (_, index) => {
    const at = inside(table + offsetOf(dirCount + index), DESCRIPTOR_BYTES, `file descriptor ${index}`);
    const dir = u32(bytes, at + 4);
    if (dir >= dirCount) throw new Error(`InstallShield header: file ${index} names directory ${dir} of ${dirCount}`);
    return {
      index, directory: directories[dir], name: text(table + u32(bytes, at)), flags: u16(bytes, at + 8),
      expanded: u32(bytes, at + 10), compressed: u32(bytes, at + 14), dataOffset: u32(bytes, at + 0x26),
      md5: hex(bytes.subarray(at + 0x2a, at + 0x3a)),
    };
  });
  return { version, major, directories, files };
}

/** The header's one file of this name (without regard to case) in `directory` (default: any), or an error. */
export function is5File(header, name, directory = null) {
  const matches = header.files.filter(f => f.name.toLowerCase() === name.toLowerCase() && (directory == null || f.directory === directory)
    && !(f.flags & IS5_FLAGS.invalid));
  if (matches.length !== 1) throw new Error(`The InstallShield header has ${matches.length} files named ${name}${directory == null ? '' : ` in "${directory}"`}, not one`);
  return matches[0];
}

/**
 * A file's expanded bytes from its compressed data (`raw`, exactly `file.compressed` bytes from `file.dataOffset` of the
 * cabinet): its chunks inflated one by one. The result must have the header's size and MD5.
 */
export function expandIs5File(file, raw) {
  const where = `${file.name} (cabinet file ${file.index})`;
  if (file.flags & IS5_FLAGS.invalid) throw new Error(`${where} is marked invalid in the header`);
  if (file.flags & IS5_FLAGS.split) throw new Error(`${where} is split across cabinet volumes, which this reader does not join`);
  if (file.flags & IS5_FLAGS.obfuscated) throw new Error(`${where} is obfuscated, which this reader does not undo`);
  if (raw.length !== file.compressed) throw new Error(`${where}: ${raw.length} bytes of data, the header says ${file.compressed}`);
  let data;
  if (file.flags & IS5_FLAGS.compressed) {
    const parts = [];
    let at = 0, total = 0;
    while (total < file.expanded) {
      if (at + 2 > raw.length) throw new Error(`${where}: the data ends after ${total} of ${file.expanded} bytes`);
      const length = u16(raw, at);
      at += 2;
      if (!length || at + length > raw.length) throw new Error(`${where}: a truncated ${length}-byte chunk at byte ${at - 2} of ${raw.length}`);
      let chunk;
      try {
        chunk = inflateRawSync(raw.subarray(at, at + length));
      } catch (error) {
        throw new Error(`${where}: the chunk at byte ${at - 2} does not inflate (${error.message})`);
      }
      parts.push(chunk);
      total += chunk.length;
      at += length;
    }
    if (at !== raw.length) throw new Error(`${where}: ${raw.length - at} bytes after its last chunk`);
    data = new Uint8Array(Buffer.concat(parts));
  } else {
    data = raw;
  }
  if (data.length !== file.expanded) throw new Error(`${where}: ${data.length} bytes expanded, the header says ${file.expanded}`);
  const md5 = createHash('md5').update(data).digest('hex');
  if (md5 !== file.md5) throw new Error(`${where}: MD5 ${md5}, the header says ${file.md5}`);
  return data;
}
