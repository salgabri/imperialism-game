// Read the spreadsheets the earlier Madden NFL seasons come from (scripts/sync-madden-seasons.mjs): Office Open XML
// workbooks (.xlsx, a zip of XML parts, unzipped with fflate) and the legacy binary ones (.xls: BIFF8 records inside
// a compound file). Only what a ratings table needs is read: every sheet's cells as text, row by row. Formulas are
// read as their cached results; styles, dates and anything else are not interpreted. No I/O here: callers pass bytes.
import { strFromU8, unzipSync } from 'fflate';

const XML_ENTITIES = { lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' };
const unescapeXml = text => text.replace(/&(?:#x([0-9a-f]+)|#(\d+)|([a-z]+));/gi, (whole, hex, dec, name) => (hex ? String.fromCodePoint(parseInt(hex, 16))
  : dec ? String.fromCodePoint(Number(dec)) : XML_ENTITIES[name] ?? whole));
/** The text runs of a shared or inline string, joined (rich text keeps its words, loses its formatting). */
const runsOf = xml => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(m => unescapeXml(m[1])).join('');
/** 'AB12' → 27, the zero-based column. */
function columnOf(ref) {
  let n = 0;
  for (const ch of /^[A-Z]+/.exec(ref)[0]) n = n * 26 + ch.charCodeAt(0) - 64;
  return n - 1;
}
const attr = (tag, name) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];

/** An .xlsx workbook's sheets, in workbook order: `[{ name, rows: [[cell text]] }]`. */
export function readXlsx(bytes) {
  const zip = unzipSync(bytes);
  const part = name => {
    const data = zip[name];
    if (!data) throw new Error(`The workbook has no ${name}`);
    return strFromU8(data);
  };
  const shared = zip['xl/sharedStrings.xml'] ? [...part('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => runsOf(m[1])) : [];
  const targets = new Map([...part('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\b[^>]*>/g)]
    .map(([tag]) => [attr(tag, 'Id'), attr(tag, 'Target')]));
  return [...part('xl/workbook.xml').matchAll(/<sheet\b[^>]*>/g)].map(([tag]) => {
    const target = targets.get(attr(tag, 'r:id'));
    if (!target) throw new Error(`The workbook's sheet ${attr(tag, 'name')} has no part`);
    const xml = part(target.startsWith('/') ? target.slice(1) : `xl/${target}`);
    const rows = [];
    for (const row of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const cells = [];
      for (const cell of (row[2] || '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = attr(cell[1], 'r'), type = attr(cell[1], 't'), inner = cell[2] || '';
        const raw = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
        const value = type === 's' ? shared[Number(raw)] : type === 'inlineStr' ? runsOf(inner) : raw == null ? '' : unescapeXml(raw);
        cells[ref ? columnOf(ref) : cells.length] = value ?? '';
      }
      // A row's own number places it: a gap between rows stays a gap.
      const at = Number(attr(row[1], 'r')) - 1;
      rows[Number.isInteger(at) && at >= 0 ? at : rows.length] = Array.from(cells, value => value ?? '');
    }
    return { name: unescapeXml(attr(tag, 'name') ?? ''), rows: Array.from(rows, row => row ?? []) };
  });
}

// ---------- .xls: a BIFF8 workbook in a compound file ----------

const END_OF_CHAIN = 0xFFFFFFFE;

/** The named stream of a compound file (the OLE2 container of a legacy Office document). */
function compoundStream(buf, names) {
  if (buf.length < 512 || buf.readUInt32LE(0) !== 0xE011CFD0 || buf.readUInt32LE(4) !== 0xE11AB1A1) throw new Error('not a compound file');
  const sectorSize = 1 << buf.readUInt16LE(30), miniSize = 1 << buf.readUInt16LE(32);
  const fatCount = buf.readUInt32LE(44), dirStart = buf.readUInt32LE(48), miniCutoff = buf.readUInt32LE(56);
  const miniFatStart = buf.readUInt32LE(60);
  let difat = buf.readUInt32LE(68);
  const sector = s => buf.subarray(512 + s * sectorSize, 512 + (s + 1) * sectorSize);
  const fatSectors = [];
  for (let i = 0; i < 109 && fatSectors.length < fatCount; i++) fatSectors.push(buf.readUInt32LE(76 + 4 * i));
  for (let guard = 0; fatSectors.length < fatCount && difat < END_OF_CHAIN; guard++) {
    if (guard > 1e5) throw new Error('the compound file\'s sector table loops');
    const block = sector(difat);
    for (let i = 0; i < sectorSize / 4 - 1 && fatSectors.length < fatCount; i++) fatSectors.push(block.readUInt32LE(4 * i));
    difat = block.readUInt32LE(sectorSize - 4);
  }
  const fat = [];
  for (const s of fatSectors) { const block = sector(s); for (let i = 0; i < sectorSize / 4; i++) fat.push(block.readUInt32LE(4 * i)); }
  const chain = (start, table, read) => {
    const parts = [];
    for (let s = start; s < END_OF_CHAIN; s = table[s]) {
      if (parts.length > table.length) throw new Error('a compound file chain loops');
      parts.push(read(s));
    }
    return Buffer.concat(parts);
  };
  const dir = chain(dirStart, fat, sector);
  const entries = [];
  for (let at = 0; at + 128 <= dir.length; at += 128) {
    const nameBytes = dir.readUInt16LE(at + 64);
    entries.push({ name: dir.subarray(at, at + Math.max(0, nameBytes - 2)).toString('utf16le'), type: dir[at + 66],
      start: dir.readUInt32LE(at + 116), size: dir.readUInt32LE(at + 120) });
  }
  const entry = entries.find(e => e.type === 2 && names.includes(e.name));
  if (!entry) throw new Error(`no ${names.join(' or ')} stream`);
  if (entry.size >= miniCutoff) return chain(entry.start, fat, sector).subarray(0, entry.size);
  const ministream = chain(entries[0].start, fat, sector);
  const miniFat = chain(miniFatStart, fat, sector);
  const miniTable = Array.from({ length: miniFat.length / 4 }, (_, i) => miniFat.readUInt32LE(4 * i));
  return chain(entry.start, miniTable, s => ministream.subarray(s * miniSize, (s + 1) * miniSize)).subarray(0, entry.size);
}

/** An RK number: a 30-bit integer or the top of a double, either perhaps divided by 100. */
function rkValue(rk) {
  let n;
  if (rk & 2) n = rk >> 2;
  else {
    const b = Buffer.alloc(8);
    b.writeUInt32LE((rk & 0xFFFFFFFC) >>> 0, 4);
    n = b.readDoubleLE(0);
  }
  return rk & 1 ? n / 100 : n;
}
const numberText = n => (Number.isInteger(n) ? String(n) : String(Number(n.toPrecision(15))));

/**
 * The shared string table: each string a character count, flags, optional rich-text and phonetic sizes, then its
 * characters; a string may run on into a CONTINUE record, which repeats the flags byte for the characters left.
 */
function sharedStrings(segments) {
  const strings = [];
  let k = 0, seg = segments[0], at = 8;
  const total = seg.readUInt32LE(4);
  const next = () => { k++; seg = segments[k]; at = 0; if (!seg) throw new Error('the shared strings run past their records'); };
  for (let n = 0; n < total; n++) {
    if (at >= seg.length) next();
    const count = seg.readUInt16LE(at);
    let flags = seg[at + 2];
    at += 3;
    let rich = 0, phonetic = 0;
    if (flags & 8) { rich = seg.readUInt16LE(at); at += 2; }
    if (flags & 4) { phonetic = seg.readUInt32LE(at); at += 4; }
    let text = '', left = count;
    while (left > 0) {
      if (at >= seg.length) { next(); flags = seg[at]; at += 1; }
      const wide = flags & 1, room = Math.floor((seg.length - at) / (wide ? 2 : 1)), take = Math.min(left, room);
      text += wide ? seg.subarray(at, at + 2 * take).toString('utf16le') : seg.subarray(at, at + take).toString('latin1');
      at += take * (wide ? 2 : 1);
      left -= take;
    }
    for (let skip = rich * 4 + phonetic; skip > 0;) {
      if (at >= seg.length) next();
      const step = Math.min(skip, seg.length - at);
      at += step;
      skip -= step;
    }
    strings.push(text);
  }
  return strings;
}

/** A BIFF8 string: a 16-bit character count, a flags byte, then the characters (8-bit or UTF-16). */
function unicodeString(data, at) {
  const count = data.readUInt16LE(at), flags = data[at + 2];
  return flags & 1 ? data.subarray(at + 3, at + 3 + 2 * count).toString('utf16le') : data.subarray(at + 3, at + 3 + count).toString('latin1');
}

/** An .xls (BIFF8) workbook's worksheets, in order: `[{ name, rows: [[cell text]] }]`. */
export function readXls(bytes) {
  const stream = compoundStream(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), ['Workbook', 'Book']);
  const records = [];
  for (let at = 0; at + 4 <= stream.length;) {
    const type = stream.readUInt16LE(at), size = stream.readUInt16LE(at + 2);
    const data = stream.subarray(at + 4, at + 4 + size);
    at += 4 + size;
    // CONTINUE (0x3C) extends the record before it.
    if (type === 0x003C && records.length) records.at(-1).segments.push(data);
    else records.push({ type, segments: [data] });
  }
  if (records[0]?.type !== 0x0809 || records[0].segments[0].readUInt16LE(0) !== 0x0600) throw new Error('not a BIFF8 workbook');
  const sst = records.find(r => r.type === 0x00FC);
  const strings = sst ? sharedStrings(sst.segments) : [];
  // BOUNDSHEET: each sheet's name and kind (0: worksheet), in the order the sheets follow.
  const declared = records.filter(r => r.type === 0x0085).map(({ segments: [d] }) => {
    const count = d[6], wide = d[7] & 1;
    return { kind: d[5], name: wide ? d.subarray(8, 8 + 2 * count).toString('utf16le') : d.subarray(8, 8 + count).toString('latin1') };
  });
  const sheets = [];
  let current = null, substreams = 0, pendingFormula = null;
  for (const record of records) {
    const d = record.segments.length > 1 ? Buffer.concat(record.segments) : record.segments[0];
    if (record.type === 0x0809) {
      // BOF: the workbook globals first, then one substream per sheet.
      if (substreams++ > 0) current = { name: declared[substreams - 2]?.name ?? `Sheet${substreams - 1}`, worksheet: d.readUInt16LE(2) === 0x0010, cells: [] };
      continue;
    }
    if (record.type === 0x000A) {
      if (current) sheets.push(current);
      current = null;
      continue;
    }
    if (!current) continue;
    const put = (row, col, value) => { (current.cells[row] ||= [])[col] = value; };
    switch (record.type) {
      case 0x00FD: put(d.readUInt16LE(0), d.readUInt16LE(2), strings[d.readUInt32LE(6)] ?? ''); break; // LABELSST
      case 0x0204: put(d.readUInt16LE(0), d.readUInt16LE(2), unicodeString(d, 6)); break; // LABEL
      case 0x0203: put(d.readUInt16LE(0), d.readUInt16LE(2), numberText(d.readDoubleLE(6))); break; // NUMBER
      case 0x027E: put(d.readUInt16LE(0), d.readUInt16LE(2), numberText(rkValue(d.readInt32LE(6)))); break; // RK
      case 0x00BD: { // MULRK: a run of RK cells
        const row = d.readUInt16LE(0), first = d.readUInt16LE(2);
        for (let i = 0; i < (d.length - 6) / 6; i++) put(row, first + i, numberText(rkValue(d.readInt32LE(4 + 6 * i + 2))));
        break;
      }
      case 0x0006: { // FORMULA: its cached result; a string result follows in a STRING record
        const row = d.readUInt16LE(0), col = d.readUInt16LE(2);
        if (d.readUInt16LE(12) !== 0xFFFF) put(row, col, numberText(d.readDoubleLE(6)));
        else if (d[6] === 0) pendingFormula = { row, col };
        else if (d[6] === 1) put(row, col, d[8] ? 'TRUE' : 'FALSE');
        break;
      }
      case 0x0207: if (pendingFormula) { put(pendingFormula.row, pendingFormula.col, unicodeString(d, 0)); pendingFormula = null; } break; // STRING
      default: break;
    }
  }
  return sheets.filter(sheet => sheet.worksheet)
    .map(sheet => ({ name: sheet.name, rows: Array.from(sheet.cells, row => Array.from(row || [], value => value ?? '')) }));
}

/** A workbook by its contents: an .xlsx is a zip ('PK'), an .xls a compound file. */
export function readWorkbook(bytes) {
  if (bytes[0] === 0x50 && bytes[1] === 0x4B) return readXlsx(bytes);
  if (bytes[0] === 0xD0 && bytes[1] === 0xCF) return readXls(bytes);
  throw new Error('neither an .xlsx nor an .xls workbook');
}
