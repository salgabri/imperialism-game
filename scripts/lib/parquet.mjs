// A small reader for flat Parquet files, enough for the college football seasons' sources (sportsdataverse's
// cfbfastR-cfb-data tables, which Polars writes): the file's Thrift metadata (compact protocol), its row groups, and
// each column chunk's dictionary and data pages (versions 1 and 2) with PLAIN and dictionary (RLE_DICTIONARY,
// PLAIN_DICTIONARY) values and RLE / bit-packed definition levels; pages uncompressed, gzip or zstd (node:zlib). Types:
// BOOLEAN, INT32, INT64, FLOAT, DOUBLE and BYTE_ARRAY (UTF8 text). Nested or repeated columns, other encodings and
// codecs are refused, never guessed. No I/O here: `readParquet` takes the file's bytes.
import zlib from 'node:zlib';

const MAGIC = 'PAR1';
// Thrift compact protocol type ids.
const T = { STOP: 0, TRUE: 1, FALSE: 2, BYTE: 3, I16: 4, I32: 5, I64: 6, DOUBLE: 7, BINARY: 8, LIST: 9, SET: 10, MAP: 11, STRUCT: 12 };
// Parquet's enums (parquet.thrift).
const TYPE = ['BOOLEAN', 'INT32', 'INT64', 'INT96', 'FLOAT', 'DOUBLE', 'BYTE_ARRAY', 'FIXED_LEN_BYTE_ARRAY'];
const REPETITION = ['REQUIRED', 'OPTIONAL', 'REPEATED'];
const CODEC = ['UNCOMPRESSED', 'SNAPPY', 'GZIP', 'LZO', 'BROTLI', 'LZ4', 'ZSTD', 'LZ4_RAW'];
const PAGE = ['DATA_PAGE', 'INDEX_PAGE', 'DICTIONARY_PAGE', 'DATA_PAGE_V2'];
const ENCODING = { PLAIN: 0, PLAIN_DICTIONARY: 2, RLE: 3, RLE_DICTIONARY: 8 };
const UTF8 = 0; // converted_type UTF8

/** A cursor over a Uint8Array. */
class Reader {
  constructor(bytes, offset = 0) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.offset = offset;
  }
  byte() {
    if (this.offset >= this.bytes.length) throw new Error('Parquet: read past the end of the data');
    return this.bytes[this.offset++];
  }
  /** An unsigned LEB128 varint, as a Number (up to 2^53) or, with `big`, a BigInt. */
  varint(big = false) {
    let result = 0n, shift = 0n;
    for (;;) {
      const b = this.byte();
      result |= BigInt(b & 0x7f) << shift;
      if (!(b & 0x80)) break;
      shift += 7n;
      if (shift > 70n) throw new Error('Parquet: a varint longer than ten bytes');
    }
    return big ? result : Number(result);
  }
  zigzag() {
    const n = this.varint(true);
    const value = (n >> 1n) ^ -(n & 1n);
    return Number(value);
  }
  take(length) {
    if (length < 0 || this.offset + length > this.bytes.length) throw new Error('Parquet: a field runs past the end of the data');
    const out = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return out;
  }
}

/** One Thrift compact value of type `type`. Structs come back as `{ [fieldId]: value }`. */
function thriftValue(r, type) {
  switch (type) {
    case T.TRUE: return true;
    case T.FALSE: return false;
    case T.BYTE: return (r.byte() << 24) >> 24;
    case T.I16: case T.I32: case T.I64: return r.zigzag();
    case T.DOUBLE: { const v = r.view.getFloat64(r.offset, true); r.offset += 8; return v; }
    case T.BINARY: return r.take(r.varint());
    case T.LIST: case T.SET: {
      const head = r.byte();
      const size = (head >> 4) === 15 ? r.varint() : head >> 4;
      const element = head & 0x0f;
      const out = [];
      for (let i = 0; i < size; i++) {
        // Booleans in a collection are one byte each.
        out.push(element === T.TRUE || element === T.FALSE ? r.byte() === 1 : thriftValue(r, element));
      }
      return out;
    }
    case T.MAP: {
      const size = r.varint();
      if (!size) return new Map();
      const kinds = r.byte();
      const out = new Map();
      for (let i = 0; i < size; i++) out.set(thriftValue(r, kinds >> 4), thriftValue(r, kinds & 0x0f));
      return out;
    }
    case T.STRUCT: return thriftStruct(r);
    default: throw new Error(`Parquet: unknown Thrift type ${type}`);
  }
}

function thriftStruct(r) {
  const out = {};
  let id = 0;
  for (;;) {
    const head = r.byte();
    const type = head & 0x0f;
    if (type === T.STOP) return out;
    const delta = head >> 4;
    id = delta ? id + delta : r.zigzag();
    out[id] = thriftValue(r, type);
  }
}

const text = bytes => (bytes == null ? undefined : new TextDecoder().decode(bytes));

/** The file's metadata: `{ version, rows, createdBy, columns: [{ name, type, optional, utf8 }], rowGroups }`. */
export function parquetMetadata(bytes) {
  if (text(bytes.subarray(0, 4)) !== MAGIC || text(bytes.subarray(bytes.length - 4)) !== MAGIC) throw new Error('Parquet: not a Parquet file');
  const length = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(bytes.length - 8, true);
  const footer = new Reader(bytes.subarray(bytes.length - 8 - length, bytes.length - 8));
  const meta = thriftStruct(footer);
  const [root, ...schema] = meta[2];
  if (schema.some(element => element[5] > 0)) throw new Error('Parquet: nested columns are not read');
  if (root[5] !== schema.length) throw new Error('Parquet: the schema root does not count its columns');
  const columns = schema.map(element => {
    const repetition = REPETITION[element[3] ?? 0];
    if (repetition === 'REPEATED') throw new Error(`Parquet: column ${text(element[4])} is repeated`);
    return { name: text(element[4]), type: TYPE[element[1]], optional: repetition === 'OPTIONAL', utf8: element[6] === UTF8 };
  });
  const rowGroups = (meta[4] || []).map(group => ({
    rows: group[3],
    chunks: group[1].map(chunk => {
      const m = chunk[3];
      if (!m) throw new Error('Parquet: a column chunk without its metadata');
      return { path: m[3].map(text).join('.'), type: TYPE[m[1]], codec: CODEC[m[4]], values: m[5],
        dataOffset: m[9], dictionaryOffset: m[11] ?? null, compressedSize: m[7] };
    }),
  }));
  return { version: meta[1], rows: meta[3], createdBy: text(meta[6]) ?? null, columns, rowGroups };
}

function decompress(codec, data, size) {
  if (codec === 'UNCOMPRESSED') return data;
  const out = codec === 'ZSTD' ? zlib.zstdDecompressSync(data) : codec === 'GZIP' ? zlib.gunzipSync(data) : null;
  if (!out) throw new Error(`Parquet: pages compressed with ${codec} are not read`);
  if (out.length !== size) throw new Error(`Parquet: a page decompressed to ${out.length} bytes, its header says ${size}`);
  return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
}

/** `count` values of the RLE / bit-packed hybrid encoding at `bitWidth` bits from `r`, up to `end`. */
function hybrid(r, bitWidth, count, end) {
  const out = new Array(count);
  const width = Math.ceil(bitWidth / 8);
  let n = 0;
  while (n < count) {
    if (r.offset >= end) throw new Error('Parquet: an RLE run ends before its values');
    const header = r.varint();
    if (header & 1) {
      // Bit-packed: groups of eight values, least significant bit first.
      const values = (header >> 1) * 8;
      const bytes = r.take(Math.ceil(values * bitWidth / 8));
      for (let i = 0; i < values && n < count; i++) {
        let v = 0;
        for (let b = 0; b < bitWidth; b++) {
          const bit = i * bitWidth + b;
          if (bytes[bit >> 3] & (1 << (bit & 7))) v |= 1 << b;
        }
        out[n++] = v;
      }
    } else {
      const run = header >> 1;
      let v = 0;
      for (let b = 0; b < width; b++) v |= r.byte() << (8 * b);
      for (let i = 0; i < run && n < count; i++) out[n++] = v;
    }
  }
  return out;
}

/** `count` PLAIN values of `type` from `r`. */
function plain(r, type, count, utf8) {
  const out = new Array(count);
  switch (type) {
    case 'BOOLEAN': {
      const bytes = r.take(Math.ceil(count / 8));
      for (let i = 0; i < count; i++) out[i] = !!(bytes[i >> 3] & (1 << (i & 7)));
      return out;
    }
    case 'INT32': for (let i = 0; i < count; i++) { out[i] = r.view.getInt32(r.offset, true); r.offset += 4; } return out;
    case 'INT64': for (let i = 0; i < count; i++) {
      const v = r.view.getBigInt64(r.offset, true);
      r.offset += 8;
      // An id beyond 2^53 (ESPN's play ids) stays exact as its decimal text.
      out[i] = v > BigInt(Number.MAX_SAFE_INTEGER) || v < BigInt(Number.MIN_SAFE_INTEGER) ? v.toString() : Number(v);
    } return out;
    case 'FLOAT': for (let i = 0; i < count; i++) { out[i] = r.view.getFloat32(r.offset, true); r.offset += 4; } return out;
    case 'DOUBLE': for (let i = 0; i < count; i++) { out[i] = r.view.getFloat64(r.offset, true); r.offset += 8; } return out;
    case 'BYTE_ARRAY': {
      const decoder = new TextDecoder();
      for (let i = 0; i < count; i++) {
        const length = r.view.getUint32(r.offset, true);
        r.offset += 4;
        const bytes = r.take(length);
        out[i] = utf8 ? decoder.decode(bytes) : bytes.slice();
      }
      return out;
    }
    default: throw new Error(`Parquet: ${type} values are not read`);
  }
}

/** One column chunk's values, nulls where the definition levels say so. */
function readChunk(bytes, chunk, column) {
  const out = [];
  let dictionary = null;
  const r = new Reader(bytes, chunk.dictionaryOffset ?? chunk.dataOffset);
  while (out.length < chunk.values) {
    const header = thriftStruct(r);
    const kind = PAGE[header[1]];
    const size = header[2], compressedSize = header[3];
    const body = bytes.subarray(r.offset, r.offset + compressedSize);
    r.offset += compressedSize;
    if (kind === 'DICTIONARY_PAGE') {
      const page = header[7];
      if (![ENCODING.PLAIN, ENCODING.PLAIN_DICTIONARY].includes(page[2] ?? 0)) throw new Error('Parquet: a dictionary that is not PLAIN');
      dictionary = plain(new Reader(decompress(chunk.codec, body, size)), column.type, page[1], column.utf8);
      continue;
    }
    if (kind !== 'DATA_PAGE' && kind !== 'DATA_PAGE_V2') throw new Error(`Parquet: ${kind} pages are not read`);
    let count, encoding, levels, values;
    if (kind === 'DATA_PAGE') {
      const page = header[5];
      count = page[1];
      encoding = page[2];
      const data = new Reader(decompress(chunk.codec, body, size));
      if (column.optional) {
        if ((page[3] ?? ENCODING.RLE) !== ENCODING.RLE) throw new Error('Parquet: definition levels that are not RLE');
        const length = data.view.getUint32(data.offset, true);
        data.offset += 4;
        const end = data.offset + length;
        levels = hybrid(data, 1, count, end);
        data.offset = end;
      }
      values = data;
    } else {
      const page = header[8];
      count = page[1];
      encoding = page[4];
      const defLength = page[5] ?? 0, repLength = page[6] ?? 0;
      if (repLength) throw new Error('Parquet: repetition levels in a flat column');
      const raw = new Reader(body);
      if (column.optional) levels = hybrid(raw, 1, count, defLength);
      const rest = body.subarray(defLength);
      values = new Reader(page[7] === false ? rest : decompress(chunk.codec, rest, size - defLength));
    }
    const present = levels ? levels.reduce((n, level) => n + level, 0) : count;
    let decoded;
    if (encoding === ENCODING.PLAIN) decoded = plain(values, column.type, present, column.utf8);
    else if (encoding === ENCODING.RLE_DICTIONARY || encoding === ENCODING.PLAIN_DICTIONARY) {
      if (!dictionary) throw new Error('Parquet: dictionary-encoded values before any dictionary page');
      const width = values.byte();
      const indices = present ? hybrid(values, width, present, values.bytes.length) : [];
      decoded = indices.map(i => {
        if (i >= dictionary.length) throw new Error('Parquet: a dictionary index past the dictionary');
        return dictionary[i];
      });
    } else throw new Error(`Parquet: values encoded ${encoding} are not read`);
    let k = 0;
    for (let i = 0; i < count; i++) out.push(!levels || levels[i] ? decoded[k++] : null);
  }
  if (out.length !== chunk.values) throw new Error(`Parquet: column ${column.name} holds ${out.length} values, its metadata ${chunk.values}`);
  return out;
}

/**
 * A flat Parquet file's rows, each `{ column: value }` (null for a null), in the file's order: text columns as
 * strings, integers as Numbers (an INT64 beyond 2^53 as its exact decimal text), doubles, booleans. `bytes`: the whole
 * file; `columns`: the names of the columns to read (all if omitted; a name the file lacks is refused), the others'
 * pages never decoded.
 */
export function readParquet(bytes, { columns: wanted = null } = {}) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const meta = parquetMetadata(data);
  const missing = (wanted ?? []).filter(name => !meta.columns.some(column => column.name === name));
  if (missing.length) throw new Error(`Parquet: no column ${missing.join(', ')}`);
  const read = meta.columns.map((column, i) => [column, i]).filter(([column]) => !wanted || wanted.includes(column.name));
  const rows = [];
  for (const group of meta.rowGroups) {
    if (group.chunks.length !== meta.columns.length) throw new Error('Parquet: a row group without every column');
    const columns = read.map(([column, i]) => {
      const chunk = group.chunks[i];
      if (chunk.path !== column.name || chunk.type !== column.type) throw new Error(`Parquet: chunk ${chunk.path} is not column ${column.name}`);
      return readChunk(data, chunk, column);
    });
    for (let row = 0; row < group.rows; row++) {
      const out = {};
      read.forEach(([column], k) => { out[column.name] = columns[k][row]; });
      rows.push(out);
    }
  }
  if (rows.length !== meta.rows) throw new Error(`Parquet: read ${rows.length} rows, the file says ${meta.rows}`);
  return rows;
}
