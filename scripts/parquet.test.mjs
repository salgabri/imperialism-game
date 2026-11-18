// The small Parquet reader (scripts/lib/parquet.mjs) the college football seasons' sources are read with: files written
// here by a minimal writer in the same layout Polars writes (Thrift compact metadata, dictionary and data pages of
// versions 1 and 2, PLAIN and dictionary values, RLE / bit-packed definition levels, gzip and zstd pages), read back
// value for value, and the reader's refusals.
import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { parquetMetadata, readParquet } from './lib/parquet.mjs';

// ---------- a minimal writer ----------

const T = { TRUE: 1, FALSE: 2, I32: 5, I64: 6, DOUBLE: 7, BINARY: 8, LIST: 9, STRUCT: 12 };
const varint = n => {
  let v = BigInt(n);
  const out = [];
  do { let b = Number(v & 0x7fn); v >>= 7n; if (v) b |= 0x80; out.push(b); } while (v);
  return out;
};
const zigzag = n => { const v = BigInt(n); return (v << 1n) ^ (v >> 63n); };
/** A Thrift compact struct from `[id, type, value]` fields in increasing id order (value a byte array for nested ones). */
function struct(fields) {
  const out = [];
  let last = 0;
  for (const [id, type, value] of fields) {
    if (value === undefined) continue;
    const t = type === 'bool' ? (value ? T.TRUE : T.FALSE) : type;
    if (id - last > 0 && id - last <= 15) out.push(((id - last) << 4) | t); else out.push(t, ...varint(zigzag(id)));
    last = id;
    if (type === 'bool') continue;
    if (t === T.I32 || t === T.I64) out.push(...varint(zigzag(value)));
    else if (t === T.BINARY) { const b = typeof value === 'string' ? [...Buffer.from(value)] : [...value]; out.push(...varint(b.length), ...b); }
    else if (t === T.STRUCT || t === T.LIST) out.push(...value);
  }
  out.push(0);
  return out;
}
const list = (type, items) => [...(items.length < 15 ? [(items.length << 4) | type] : [0xf0 | type, ...varint(items.length)]),
  ...items.flatMap(item => (type === T.STRUCT ? item : type === T.BINARY ? [...varint(Buffer.byteLength(item)), ...Buffer.from(item)] : varint(zigzag(item))))];
/** RLE / bit-packed hybrid, all bit-packed. */
function bitPacked(values, width) {
  const groups = Math.ceil(values.length / 8);
  const bytes = new Uint8Array(Math.ceil(groups * 8 * width / 8));
  values.forEach((v, i) => { for (let b = 0; b < width; b++) if (v & (1 << b)) { const bit = i * width + b; bytes[bit >> 3] |= 1 << (bit & 7); } });
  return [...varint((groups << 1) | 1), ...bytes];
}
const TYPE = { BOOLEAN: 0, INT64: 2, DOUBLE: 5, BYTE_ARRAY: 6 };
function plainBytes(type, values) {
  if (type === 'BOOLEAN') { const b = new Uint8Array(Math.ceil(values.length / 8)); values.forEach((v, i) => { if (v) b[i >> 3] |= 1 << (i & 7); }); return [...b]; }
  if (type === 'INT64') return values.flatMap(v => { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(v)); return [...b]; });
  if (type === 'DOUBLE') return values.flatMap(v => { const b = Buffer.alloc(8); b.writeDoubleLE(v); return [...b]; });
  return values.flatMap(v => { const s = Buffer.from(v); const n = Buffer.alloc(4); n.writeUInt32LE(s.length); return [...n, ...s]; });
}
const CODEC = { UNCOMPRESSED: 0, GZIP: 2, ZSTD: 6 };
const compress = (codec, bytes) => [...(codec === 'GZIP' ? zlib.gzipSync(Buffer.from(bytes)) : codec === 'ZSTD' ? zlib.zstdCompressSync(Buffer.from(bytes)) : Buffer.from(bytes))];

/**
 * A Parquet file of `rows` (each `{ column: value }`) by `columns` (`[{ name, type, optional, utf8, dictionary, v2,
 * codec }]`), one row group, or two when `split` names a row count.
 */
function writeParquet(rows, columns, { split = null } = {}) {
  const bytes = [...Buffer.from('PAR1')];
  const groups = split ? [rows.slice(0, split), rows.slice(split)] : [rows];
  const rowGroups = groups.map(group => {
    const chunks = columns.map(column => {
      const values = group.map(r => r[column.name]);
      const present = values.filter(v => v != null);
      const levels = column.optional ? values.map(v => (v == null ? 0 : 1)) : null;
      const start = bytes.length;
      let dictOffset;
      let valueBytes, encoding;
      if (column.dictionary) {
        const dict = [...new Set(present)];
        const page = plainBytes(column.type, dict);
        const body = compress(column.codec, page);
        dictOffset = bytes.length;
        bytes.push(...struct([[1, T.I32, 2], [2, T.I32, page.length], [3, T.I32, body.length], [7, T.STRUCT, struct([[1, T.I32, dict.length], [2, T.I32, 0]])]]), ...body);
        const width = Math.max(1, Math.ceil(Math.log2(Math.max(2, dict.length))));
        valueBytes = [width, ...bitPacked(present.map(v => dict.indexOf(v)), width)];
        encoding = 8;
      } else { valueBytes = plainBytes(column.type, present); encoding = 0; }
      const dataOffset = bytes.length;
      if (column.v2) {
        const defs = levels ? bitPacked(levels, 1) : [];
        const body = [...defs, ...compress(column.codec, valueBytes)];
        bytes.push(...struct([[1, T.I32, 3], [2, T.I32, defs.length + valueBytes.length], [3, T.I32, body.length],
          [8, T.STRUCT, struct([[1, T.I32, values.length], [2, T.I32, values.length - present.length], [3, T.I32, values.length], [4, T.I32, encoding],
            [5, T.I32, defs.length], [6, T.I32, 0], [7, 'bool', column.codec !== 'UNCOMPRESSED']])]]), ...body);
      } else {
        const defs = levels ? (() => { const d = bitPacked(levels, 1); const n = Buffer.alloc(4); n.writeUInt32LE(d.length); return [...n, ...d]; })() : [];
        const page = [...defs, ...valueBytes];
        const body = compress(column.codec, page);
        bytes.push(...struct([[1, T.I32, 0], [2, T.I32, page.length], [3, T.I32, body.length],
          [5, T.STRUCT, struct([[1, T.I32, values.length], [2, T.I32, encoding], [3, T.I32, 3], [4, T.I32, 3]])]]), ...body);
      }
      return struct([[2, T.I64, start], [3, T.STRUCT, struct([[1, T.I32, TYPE[column.type]], [2, T.LIST, list(T.I32, column.dictionary ? [0, 3, 8] : [0, 3])],
        [3, T.LIST, list(T.BINARY, [column.name])], [4, T.I32, CODEC[column.codec]], [5, T.I64, values.length], [6, T.I64, 0], [7, T.I64, bytes.length - start],
        [9, T.I64, dataOffset], [11, T.I64, dictOffset]])]]);
    });
    return struct([[1, T.LIST, list(T.STRUCT, chunks)], [2, T.I64, 0], [3, T.I64, group.length]]);
  });
  const schema = [struct([[4, T.BINARY, 'schema'], [5, T.I32, columns.length]]),
    ...columns.map(c => struct([[1, T.I32, TYPE[c.type]], [3, T.I32, c.optional ? 1 : 0], [4, T.BINARY, c.name], [6, T.I32, c.utf8 ? 0 : undefined]]))];
  const footer = struct([[1, T.I32, 1], [2, T.LIST, list(T.STRUCT, schema)], [3, T.I64, rows.length], [4, T.LIST, list(T.STRUCT, rowGroups)], [6, T.BINARY, 'test writer']]);
  const length = Buffer.alloc(4);
  length.writeUInt32LE(footer.length);
  return new Uint8Array([...bytes, ...footer, ...length, ...Buffer.from('PAR1')]);
}

// ---------- the reader ----------

const ROWS = Array.from({ length: 21 }, (_, i) => ({
  id: i % 5 === 3 ? null : 401000000 + i,
  play: i % 7 === 0 ? null : (BigInt('400869446101855401') + BigInt(i)).toString(),
  name: i % 4 === 2 ? null : ['Deshaun Watson', 'Wayne Gallman', 'Mike Williams', 'Ray-Ray McCloud'][i % 4],
  grade: 80 + i / 4,
  flag: i % 3 === 0 ? null : i % 2 === 0,
}));
const COLUMNS = [
  { name: 'id', type: 'INT64', optional: true, codec: 'ZSTD' },
  { name: 'play', type: 'INT64', optional: true, codec: 'GZIP', v2: true },
  { name: 'name', type: 'BYTE_ARRAY', optional: true, utf8: true, dictionary: true, codec: 'ZSTD' },
  { name: 'grade', type: 'DOUBLE', optional: false, codec: 'UNCOMPRESSED', v2: true },
  { name: 'flag', type: 'BOOLEAN', optional: true, codec: 'UNCOMPRESSED' },
];

test('a flat file reads back value for value: nulls, dictionaries, both page versions, gzip and zstd', () => {
  const file = writeParquet(ROWS, COLUMNS);
  const meta = parquetMetadata(file);
  assert.equal(meta.rows, ROWS.length);
  assert.equal(meta.createdBy, 'test writer');
  assert.deepEqual(meta.columns.map(c => [c.name, c.type, c.optional, c.utf8]),
    [['id', 'INT64', true, false], ['play', 'INT64', true, false], ['name', 'BYTE_ARRAY', true, true], ['grade', 'DOUBLE', false, false], ['flag', 'BOOLEAN', true, false]]);
  assert.deepEqual(readParquet(file), ROWS, 'every value, an INT64 beyond 2^53 as its exact decimal text');
});

test('two row groups follow each other; a column subset decodes only those columns', () => {
  const file = writeParquet(ROWS, COLUMNS, { split: 8 });
  assert.equal(parquetMetadata(file).rowGroups.length, 2);
  assert.deepEqual(readParquet(file), ROWS);
  assert.deepEqual(readParquet(file, { columns: ['name', 'id'] }), ROWS.map(({ id, name }) => ({ id, name })));
  assert.throws(() => readParquet(file, { columns: ['tackles'] }), /no column tackles/);
});

test('what the reader does not read it refuses, never guesses', () => {
  assert.throws(() => readParquet(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])), /not a Parquet file/);
  const snappy = writeParquet(ROWS.slice(0, 4), [{ name: 'grade', type: 'DOUBLE', optional: false, codec: 'UNCOMPRESSED' }]);
  // The same file, its column chunk claiming snappy pages (codec 1): the metadata's codec byte is the varint after field 4.
  const text = Buffer.from(snappy);
  const at = text.lastIndexOf(Buffer.from([0x15, 0x00])); // field 4 (delta 1 from 3), i32 0 (UNCOMPRESSED)
  assert.ok(at > 0);
  text[at + 1] = 0x02; // zigzag(1)
  assert.throws(() => readParquet(new Uint8Array(text)), /SNAPPY are not read/);
});
