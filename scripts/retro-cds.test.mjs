// The football seasons read from CD images (docs/design/football-years.md, "SI's CM 99/00 and CM 00/01, read from their
// CDs"): scripts/lib/cd-image.mjs (ISO 9660 and Joliet in 2048-byte or raw MODE1 sectors), scripts/lib/installshield5.mjs
// (the cabinet the CDs install from) and scripts/sync-retro-cds.mjs, on synthetic images of invented files
// (scripts/lib/retro-cd-fixture.mjs). No network: the sync reads a local image, as its --image option does.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { LAYOUTS, checkLayout, findEntry, listFiles, readDirectory, readEntry, readUserBytes, readVolume } from './lib/cd-image.mjs';
import { IS5_FLAGS, expandIs5File, is5File, is5Major, readIs5Header } from './lib/installshield5.mjs';
import { is5Cabinet, isoImage } from './lib/retro-cd-fixture.mjs';
import { syncSeason } from './sync-retro-cds.mjs';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const md5 = bytes => createHash('md5').update(bytes).digest('hex');
// Invented tables: text that compresses, and random bytes that do not.
const text = (word, n) => new Uint8Array(Buffer.from(Array.from({ length: n }, (_, i) => `${word} row ${i};`).join('\n')));
const FILES = [
  { name: 'fixture_people.dat', data: text('fakeperson', 9000) },
  { name: 'fixture_index.dat', data: text('fakeindex', 3) },
  { name: 'fixture_noise.dat', data: new Uint8Array(randomBytes(70000)) },
  { name: 'fixture_plain.cfg', data: text('stored', 50), compressed: false },
];
const reader = image => async (start, end) => image.subarray(start, end);

function cdOf({ raw = false, cabinetFiles = FILES, extra = {}, ...options } = {}) {
  const cab = is5Cabinet(cabinetFiles, { chunk: 8192 });
  const built = isoImage({ 'DATA1.HDR': cab.header, 'DATA1.CAB': cab.cabinet, 'SETUP.EXE': text('not run', 10), ...extra },
    { raw, ghost: { name: 'CONFIG.AFP', lba: 900000, size: 40960117 }, ...options });
  return { ...built, cab };
}

test('a cabinet\'s files come out of a 2048-byte image and a raw MODE1 image alike, each its MD5', async () => {
  for (const raw of [false, true]) {
    const { image, sectors, lbaOf, cab } = cdOf({ raw });
    const layout = raw ? LAYOUTS.mode1 : LAYOUTS.iso;
    assert.equal(image.length, sectors * layout.sector);
    const readRange = reader(image);
    const { primary, joliet } = await readVolume(readRange, layout);
    assert.deepEqual([primary.volumeId, primary.created, primary.sectors], ['FIXTURE_CD', '2026110912000000', sectors]);
    assert.equal(joliet.volumeId, 'FIXTURE_CD');
    const root = await readDirectory(readRange, layout, primary.root);
    // A copy-protection dummy past the volume's end is listed, not refused.
    assert.deepEqual(root.map(entry => entry.name), ['CONFIG.AFP', 'DATA1.CAB', 'DATA1.HDR', 'SETUP.EXE']);
    const headerEntry = await findEntry(readRange, layout, primary, 'data1.hdr');
    const cabinetEntry = await findEntry(readRange, layout, primary, 'DATA1.CAB');
    assert.deepEqual([headerEntry.lba, cabinetEntry.lba], [lbaOf('DATA1.HDR'), lbaOf('DATA1.CAB')]);
    assert.deepEqual(await readEntry(readRange, layout, headerEntry), cab.header);
    const header = readIs5Header(await readEntry(readRange, layout, headerEntry));
    assert.deepEqual([header.major, header.directories, header.files.map(f => f.name)], [5, [''], FILES.map(f => f.name)]);
    for (const file of FILES) {
      const entry = is5File(header, file.name.toUpperCase());
      assert.deepEqual([entry.expanded, entry.md5, !!(entry.flags & IS5_FLAGS.compressed)], [file.data.length, md5(file.data), file.compressed !== false]);
      const data = expandIs5File(entry, await readEntry(readRange, layout, cabinetEntry, entry.dataOffset, entry.compressed));
      assert.equal(sha256(data), sha256(file.data), file.name);
    }
    assert.ok(header.files[0].compressed < FILES[0].data.length / 4, 'text is stored deflated, in chunks');
  }
});

test('user bytes are mapped across sectors, and the wrong layout is refused', async () => {
  const data = new Uint8Array(randomBytes(9000));
  const iso = isoImage({ 'BLOB.BIN': data }), raw = isoImage({ 'BLOB.BIN': data }, { raw: true });
  const lba = iso.lbaOf('BLOB.BIN');
  for (const [offset, length] of [[0, 9000], [1500, 3000], [2047, 2], [8999, 1], [4096, 0]]) {
    const want = data.subarray(offset, offset + length);
    assert.deepEqual(await readUserBytes(reader(iso.image), LAYOUTS.iso, lba, offset, length), want);
    assert.deepEqual(await readUserBytes(reader(raw.image), LAYOUTS.mode1, lba, offset, length), want);
  }
  await assert.rejects(readUserBytes(reader(iso.image), LAYOUTS.mode1, 16, 0, 10), /not a MODE1 sector/);
  await assert.rejects(readVolume(reader(raw.image), LAYOUTS.iso), /holds no ISO 9660 volume descriptor/);
  await assert.rejects(readVolume(reader(new Uint8Array(40 * 2048)), LAYOUTS.iso), /holds no ISO 9660 volume descriptor/);
  await assert.rejects(readUserBytes(reader(iso.image), LAYOUTS.iso, iso.sectors - 1, 0, 4096), /bytes read, 4096 asked for/);
  assert.throws(() => checkLayout({ sector: 2352, dataOffset: 24 }), /neither 2048-byte sectors nor raw 2352-byte MODE1/);
});

test('Joliet names reach folders whose names the primary tree mangles', async () => {
  const files = { 'Software/CM Extras/Fake Update 01-02/Data/fake_table.dat': text('joliet', 400), 'README.TXT': text('readme', 5) };
  const { image } = isoImage(files);
  const readRange = reader(image);
  const { primary, joliet } = await readVolume(readRange, LAYOUTS.iso);
  const folder = await findEntry(readRange, LAYOUTS.iso, joliet, 'software/cm extras/Fake Update 01-02/Data', { joliet: true });
  assert.equal(folder.directory, true);
  const [entry] = await readDirectory(readRange, LAYOUTS.iso, folder, { joliet: true });
  assert.equal(entry.name, 'fake_table.dat');
  assert.deepEqual(await readEntry(readRange, LAYOUTS.iso, entry), files['Software/CM Extras/Fake Update 01-02/Data/fake_table.dat']);
  assert.equal(await findEntry(readRange, LAYOUTS.iso, primary, 'Software/CM Extras'), null, 'the primary tree has only the mangled CM_EXTRAS');
  assert.ok(await findEntry(readRange, LAYOUTS.iso, primary, 'SOFTWARE/CM_EXTRAS'));
  assert.deepEqual((await listFiles(readRange, LAYOUTS.iso, joliet, joliet.root, { joliet: true })).map(f => f.path),
    ['README.TXT', 'Software/CM Extras/Fake Update 01-02/Data/fake_table.dat']);
});

test('the cabinet reader stops on a wrong MD5, a truncated chunk, a split or obfuscated file, or another format', () => {
  const { header, cabinet } = is5Cabinet(FILES, { chunk: 8192 });
  const table = readIs5Header(header);
  const people = is5File(table, 'fixture_people.dat');
  const dataOf = entry => cabinet.subarray(entry.dataOffset, entry.dataOffset + entry.compressed);
  assert.throws(() => expandIs5File({ ...people, md5: '0'.repeat(32) }, dataOf(people)), /MD5 [0-9a-f]{32}, the header says 0{32}/);
  // A chunk whose length runs past the file's data.
  const cut = dataOf(people).slice();
  cut[0] = 0xff;
  cut[1] = 0xff;
  assert.throws(() => expandIs5File(people, cut), /truncated 65535-byte chunk at byte 0/);
  assert.throws(() => expandIs5File(people, dataOf(people).subarray(0, people.compressed - 10)), /bytes of data, the header says/);
  assert.throws(() => expandIs5File({ ...people, compressed: people.compressed - 10 }, dataOf(people).subarray(0, people.compressed - 10)),
    /truncated|ends after|does not inflate/);
  assert.throws(() => expandIs5File({ ...people, flags: IS5_FLAGS.compressed | IS5_FLAGS.split }, dataOf(people)), /split across cabinet volumes/);
  assert.throws(() => expandIs5File({ ...people, flags: IS5_FLAGS.compressed | IS5_FLAGS.obfuscated }, dataOf(people)), /obfuscated/);
  assert.throws(() => expandIs5File({ ...people, expanded: people.expanded + 1 }, dataOf(people)), /ends after|bytes expanded/);
  const garbled = dataOf(people).slice();
  garbled.fill(0xff, 2, 40);
  assert.throws(() => expandIs5File(people, garbled), /does not inflate|MD5|ends after|truncated/);
  assert.throws(() => readIs5Header(new Uint8Array(64)), /no ISc\( signature/);
  const v6 = header.slice();
  v6[4] = 0x58; v6[5] = 0x02; v6[6] = 0x00; v6[7] = 0x04;
  assert.equal(is5Major(0x04000258), 6);
  assert.throws(() => readIs5Header(v6), /is format 6, not 5/);
  assert.throws(() => is5File(table, 'missing.dat'), /has 0 files named missing\.dat, not one/);
});

/** A manifest season of the synthetic CD, its files pinned as the real ones are. */
function seasonOf(cd, { headerLba, cabinetLba, header }, picks = FILES.slice(0, 3)) {
  return {
    id: 'cm-fixture', cd: { item: 'fixture', image: 'FIXTURE.bin', imageBytes: 0, volume: 'FIXTURE_CD', created: '2026110912000000', ...cd,
      cabinet: { header: 'DATA1.HDR', headerLba, headerSha256: sha256(header), cabinet: 'DATA1.CAB', cabinetLba, ...cd.cabinet } },
    files: picks.map(file => ({ folder: 'fixture-cd', name: file.name, bytes: file.data.length, sha256: sha256(file.data), md5: md5(file.data) })),
  };
}

test('the sync takes a season\'s pinned tables from a local image, and stops on any other CD or file', async t => {
  const dir = mkdtempSync(path.join(tmpdir(), 'retro-cds-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const lines = [];
  const log = line => lines.push(line);
  for (const raw of [true, false]) {
    const { image, lbaOf, cab } = cdOf({ raw });
    const imageFile = path.join(dir, raw ? 'fixture.bin' : 'fixture.iso');
    writeFileSync(imageFile, image);
    const pins = { headerLba: lbaOf('DATA1.HDR'), cabinetLba: lbaOf('DATA1.CAB'), header: cab.header };
    const data = path.join(dir, `data-${raw}`);
    await syncSeason(seasonOf({}, pins), data, imageFile, log);
    for (const file of FILES.slice(0, 3)) assert.deepEqual(new Uint8Array(readFileSync(path.join(data, 'fixture-cd', file.name))), file.data);
    assert.deepEqual(readdirSync(path.join(data, 'fixture-cd')).sort(), FILES.slice(0, 3).map(f => f.name).sort(), 'only the pinned tables');
    lines.length = 0;
    await syncSeason(seasonOf({}, pins), data, imageFile, log);
    assert.match(lines[0], /all 3 files present/, 'nothing is read again');
    // Another CD, another header or another table: the sync stops before writing it.
    let n = 0;
    const refused = async (season, pattern) => {
      const fresh = path.join(dir, `fresh-${raw}-${n++}`);
      await assert.rejects(syncSeason(season, fresh, imageFile, log), pattern);
      return path.join(fresh, 'fixture-cd');
    };
    for (const [season, pattern] of [
      [seasonOf({ volume: 'OTHER_CD' }, pins), /not the pinned OTHER_CD/],
      [seasonOf({ created: '1999111615412400' }, pins), /not the pinned FIXTURE_CD of 1999111615412400/],
      [seasonOf({}, { ...pins, header: new Uint8Array(4) }), /DATA1\.HDR has SHA-256 .*not the pinned/],
      [seasonOf({}, { ...pins, cabinetLba: pins.cabinetLba + 1 }), /start at sectors \d+ and \d+, not the pinned/],
    ]) assert.ok(!existsSync(await refused(season, pattern)), 'nothing written');
    // A table the header records otherwise stops the sync before any data is read.
    const mislisted = seasonOf({}, pins);
    mislisted.files[2] = { ...mislisted.files[2], md5: '0'.repeat(32) };
    assert.ok(!existsSync(await refused(mislisted, /gives fixture_noise\.dat \d+ bytes, MD5 [0-9a-f]+; the manifest pins/)));
    // A table whose bytes are not the pinned ones is not written; the ones before it were checked and stay.
    const wrong = seasonOf({}, pins);
    wrong.files[1] = { ...wrong.files[1], sha256: '0'.repeat(64) };
    const folder = await refused(wrong, /fixture_index\.dat read as \d+ bytes, SHA-256 [0-9a-f]+: not the pinned/);
    assert.deepEqual(readdirSync(folder), ['fixture_people.dat']);
  }
  // A season whose tables sit in a folder of the CD, by its Joliet names (the magazine CD's Sawczuk update).
  const table = text('folder table', 300);
  const { image } = isoImage({ 'Software/Fake Update 01-02/Data/fake_table.dat': table });
  const imageFile = path.join(dir, 'folder.iso');
  writeFileSync(imageFile, image);
  const season = { id: 'cm0102-fixture', cd: { volume: 'FIXTURE_CD', created: '2026110912000000', joliet: true, folder: 'Software/Fake Update 01-02/Data' },
    files: [{ folder: 'fixture-folder', name: 'fake_table.dat', bytes: table.length, sha256: sha256(table) }] };
  await syncSeason(season, path.join(dir, 'folder-data'), imageFile, log);
  assert.deepEqual(new Uint8Array(readFileSync(path.join(dir, 'folder-data', 'fixture-folder', 'fake_table.dat'))), table);
  await assert.rejects(syncSeason({ ...season, cd: { ...season.cd, folder: 'Software/Missing' } }, path.join(dir, 'folder-missing'), imageFile, log),
    /The CD has no folder Software\/Missing/);
});
