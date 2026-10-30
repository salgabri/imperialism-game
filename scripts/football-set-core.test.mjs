// The browser-safe core of the football data set builder (src/data/footballSetBuild.js): its
// SHA-256 (src/data/sha256.js) against node:crypto, and its import graph, which must stay
// inside src/ with no Node built-ins so the browser can build a season from a picked folder.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { sha256 } from '../src/data/sha256.js';
import { pickFootballSquad } from '../src/data/footballSquad.js';
import { pickFootballSquad as pickFromScripts } from './lib/football-data.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const node = input => createHash('sha256').update(input).digest('hex');

/** Deterministic pseudo-random bytes (xorshift32), so a failure reproduces. */
function noise(length, seed = 0x9e3779b9) {
  const bytes = new Uint8Array(length);
  let x = seed | 0;
  for (let i = 0; i < length; i++) {
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    bytes[i] = x & 0xff;
  }
  return bytes;
}

// ---- SHA-256 ----

test('sha256 gives the published digests', () => {
  assert.equal(sha256(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(sha256('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'), '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
  assert.equal(sha256(new Uint8Array(1_000_000).fill(0x61)), 'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0');
});

test('sha256 matches node:crypto on bytes at every padding boundary and beyond', () => {
  const lengths = [0, 1, 2, 3, 4, 5, 31, 32, 33, 55, 56, 57, 63, 64, 65, 111, 112, 119, 120, 121, 127, 128, 129, 191, 192, 255, 256, 1000, 4096, 65537];
  for (let n = 0; n <= 300; n++) lengths.push(n);
  for (const n of lengths) {
    const bytes = noise(n, n + 1);
    assert.equal(sha256(bytes), node(bytes), `${n} bytes`);
  }
  // Bytes of one value, which a byte-order mistake can hide behind.
  for (const fill of [0x00, 0x80, 0xff]) for (const n of [55, 56, 64]) assert.equal(sha256(new Uint8Array(n).fill(fill)), node(new Uint8Array(n).fill(fill)));
});

test('sha256 matches node:crypto on multi-MB buffers, views and Node Buffers', () => {
  for (const [n, seed] of [[3 * 1024 * 1024 + 1, 7], [5 * 1024 * 1024 + 63, 11], [8_000_000, 13]]) {
    const bytes = noise(n, seed);
    assert.equal(sha256(bytes), node(bytes), `${n} bytes`);
  }
  // A view into a larger buffer (as a file slice or a pooled Buffer is) hashes only its own bytes.
  const view = noise(10_000, 3).subarray(17, 17 + 4321);
  assert.equal(sha256(view), node(view));
  const buffer = Buffer.from('Fakežej Mockošek, Curaçao');
  assert.equal(sha256(buffer), node(buffer));
  assert.equal(sha256(buffer), sha256('Fakežej Mockošek, Curaçao'));
});

test('sha256 hashes strings as UTF-8, as node:crypto does', () => {
  const strings = [
    '', 'a', 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(63), 'x'.repeat(64), 'x'.repeat(65),
    'Fakežej Mockošek', 'Testène Françoisfake', 'São Tomé & Principe', 'Curaçao', 'CM 01/02 · Fixture', '€‚ƒ„…†‡ˆ‰Š‹ŒŽ',
    'Ελλάδα', 'Россия', '日本', '대한민국', '⚽🏆', 'é'.repeat(28), '🏆'.repeat(16), 'a\u0000b', '\ud800 lone surrogate', 'tail \udfff',
    JSON.stringify({ name: 'Fakežej Mockošek', nations: Array.from({ length: 5000 }, (_, i) => [i, `Testène ${i}`, '⚽']) }),
  ];
  for (const s of strings) assert.equal(sha256(s), node(s), JSON.stringify(s.slice(0, 40)));
});

test('sha256 refuses what is neither bytes nor a string', () => {
  for (const input of [new ArrayBuffer(4), [1, 2, 3], 12, null, undefined, new Uint16Array(2)]) {
    assert.throws(() => sha256(input), /takes a Uint8Array or a string/, String(input));
  }
});

// ---- The browser-safe import graph ----

// A static import or re-export: `import x from '...'`, `import { a, b } from '...'` (over several lines too),
// `import '...'`, `export * from '...'` and `export { a } from '...'`.
const STATIC_IMPORT = /^\s*(?:import|export)\s+(?:[\w$*{}\s,]+?\s+from\s+)?['"]([^'"]+)['"]/gm;
// Code that only runs in Node, or that would hide a module from the walk, looked for outside comments.
const NODE_ONLY = /\b(?:Buffer\s*\.|process\s*\.|require\s*\(|__dirname|__filename)|\bimport\s*\(/;
const withoutComments = source => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const SRC = path.join(root, 'src') + path.sep;
const shown = file => path.relative(root, file).replaceAll(path.sep, '/');

/** One module's static imports, resolved, and whatever in it breaks the rule: src/ only, no Node. */
function checkModule(file, source) {
  const problems = [], targets = [];
  const code = withoutComments(source);
  if (NODE_ONLY.test(code)) problems.push(`${shown(file)} uses ${code.match(NODE_ONLY)[0]}`);
  const specifiers = [...source.matchAll(STATIC_IMPORT)].map(m => m[1]);
  // Every import statement must be one the pattern read, so none is skipped unseen.
  const statements = (code.match(/^\s*import[\s{*'"]/gm) || []).length;
  if (statements > specifiers.length) problems.push(`${shown(file)} has ${statements} import statements, but only ${specifiers.length} were read`);
  for (const specifier of specifiers) {
    const target = path.resolve(path.dirname(file), specifier);
    if (specifier.startsWith('node:')) problems.push(`${shown(file)} imports the Node built-in ${specifier}`);
    else if (!specifier.startsWith('./') && !specifier.startsWith('../')) problems.push(`${shown(file)} imports the package ${specifier}, outside src/`);
    else if (!target.startsWith(SRC)) problems.push(`${shown(file)} imports ${specifier}, outside src/`);
    else if (!existsSync(target)) problems.push(`${shown(file)} imports ${specifier}, which does not exist (name the file in full)`);
    else targets.push(target);
  }
  return { targets, problems };
}

/** Every module the entry reaches by static imports, and every problem on the way. */
function importGraph(entry) {
  const reached = new Set(), problems = [];
  const queue = [entry];
  while (queue.length) {
    const file = queue.shift();
    if (reached.has(file)) continue;
    reached.add(file);
    const checked = checkModule(file, readFileSync(file, 'utf8'));
    problems.push(...checked.problems);
    queue.push(...checked.targets);
  }
  return { reached: [...reached].map(shown), problems };
}

test('the data set builder imports only src/ modules and no Node built-ins, at any depth', () => {
  const { reached, problems } = importGraph(path.join(root, 'src/data/footballSetBuild.js'));
  assert.deepEqual(problems, []);
  // The walk really follows the imports: the reader, the conversion, the squad pick, the hash and the manifests.
  for (const file of ['src/data/teams.js', 'src/data/cmPlayers.js', 'src/data/cm0102.js', 'src/data/footballSquad.js', 'src/data/sha256.js',
    'src/data/cm0102Releases.js', 'src/data/cm0102Nations.js', 'src/data/footballFederations.js']) assert.ok(reached.includes(file), file);
});

test('the import check catches a Node built-in, a package, a path outside src/ and Node-only code', () => {
  // Sources written here, as if they were src/data/example.js, so a check that matched nothing would fail.
  const example = path.join(root, 'src/data/example.js');
  const cases = [
    ["import { createHash } from 'node:crypto';", /imports the Node built-in node:crypto/],
    ["import {\n  gunzipSync,\n} from 'fflate';", /imports the package fflate, outside src\//],
    ["export { pickFootballSquad } from '../../scripts/lib/football-data.mjs';", /imports \.\.\/\.\.\/scripts\/lib\/football-data\.mjs, outside src\//],
    ["import '../../scripts/lib/cm0102-fixture.mjs';", /cm0102-fixture\.mjs, outside src\//],
    ["import { NATIONS } from './teams';", /\.\/teams, which does not exist/],
    ['const bytes = Buffer.from(text);', /uses Buffer\./],
    ["const teams = await import('./teams.js');", /uses import\(/],
  ];
  for (const [source, pattern] of cases) assert.match(checkModule(example, source).problems.join('; '), pattern, source);
  // Comments may name Node things; only code counts.
  const fine = checkModule(example, "// a Node Buffer is a Uint8Array\n/* process.env */\nimport { NATIONS } from './teams.js';\nexport * from './cm0102.js';");
  assert.deepEqual([fine.problems, fine.targets.map(shown)], [[], ['src/data/teams.js', 'src/data/cm0102.js']]);
});

// ---- The shared squad pick ----

test('the scripts and the data set builder share one squad pick', () => {
  assert.equal(pickFromScripts, pickFootballSquad);
});
