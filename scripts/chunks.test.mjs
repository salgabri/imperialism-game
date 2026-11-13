// The build's chunks (vite.config.js chunkOf, README "Caching"): React and football's built-in players sit in a
// 'stable' chunk and the seven smaller sports' players in one 'sports' chunk, and neither may import the first chunk,
// which changes with every release, or every release would change them too and re-send them to every returning
// player. Static: esbuild's import graph of the browser build, as Rollup sees it; no Vite build runs.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { build } from 'esbuild';
import { chunkOf } from '../vite.config.js';
import { ROOT } from './lib/app-harness.mjs';

const { metafile } = await build({
  entryPoints: [path.join(ROOT, 'src/main.jsx')], absWorkingDir: ROOT, bundle: true, write: false, metafile: true,
  format: 'esm', splitting: true, outdir: path.join(ROOT, 'dist-chunks-test'), platform: 'browser', jsx: 'automatic',
  loader: { '.css': 'empty' }, logLevel: 'silent',
});
const MAIN = 'src/main.jsx';
const absolute = input => path.resolve(ROOT, input).replaceAll('\\', '/');
const chunk = input => chunkOf(absolute(input));
const repo = input => path.relative(ROOT, path.resolve(ROOT, input)).replaceAll('\\', '/');
// A module's static imports: an import statement, or a require inside React's CommonJS. Dynamic imports start chunks.
const staticImports = input => (metafile.inputs[input]?.imports ?? [])
  .filter(i => i.kind === 'import-statement' || i.kind === 'require-call').map(i => i.path);
function closure(start) {
  const seen = new Set();
  const visit = input => { if (seen.has(input)) return; seen.add(input); staticImports(input).forEach(visit); };
  visit(start);
  return seen;
}
const firstDownload = closure(MAIN);
const inputs = Object.keys(metafile.inputs);
const lazyStarts = inputs.filter(input => repo(input).startsWith('src/data/players/'));

test('React and football\'s built-in players and clubs are the stable chunk, loaded with the game', () => {
  const stable = inputs.filter(input => chunk(input) === 'stable');
  assert.deepEqual(stable.filter(input => repo(input).startsWith('src/')).map(repo).sort(),
    ['src/data/clubs.football.js', 'src/data/rosters.js', 'src/data/sourceTable.js']);
  assert.ok(stable.some(input => /node_modules\/react-dom\//.test(absolute(input))), 'react-dom');
  for (const input of stable) assert.ok(firstDownload.has(input), `${repo(input)} is part of the first download`);
});

test('the stable chunk imports nothing outside itself', () => {
  for (const input of inputs.filter(input => chunk(input) === 'stable')) {
    for (const imported of staticImports(input)) {
      assert.equal(chunk(imported), 'stable', `${repo(input)} imports ${repo(imported)}, which would make the stable chunk import the first one`);
    }
  }
});

test('every sport but football loads later: the seven smaller ones in one chunk, women\'s football in its own', () => {
  assert.deepEqual(lazyStarts.map(input => [path.basename(input), chunk(input) ?? 'own chunk']).sort(), [
    ['american-football.js', 'sports'], ['baseball.js', 'sports'], ['basketball.js', 'sports'], ['hockey.js', 'sports'],
    ['rugby-league.js', 'sports'], ['tennis.js', 'sports'], ['womens-football.js', 'own chunk'], ['womens-tennis.js', 'sports'],
  ]);
  // Their players load only on demand (src/sports/sportData.lazy.js), never with the first download.
  for (const input of lazyStarts) assert.ok(!firstDownload.has(input), `${repo(input)} is in the first download`);
});

test('a later sport\'s chunk shares nothing with the first download but the stable chunk', () => {
  // Rollup puts a manual chunk's dependencies in it: one the first download also needs would pull the sports chunk into
  // every first visit. Anything else shared would make the later chunk import the first one.
  for (const start of lazyStarts) {
    for (const input of closure(start)) {
      if (firstDownload.has(input)) assert.equal(chunk(input), 'stable', `${repo(start)} needs ${repo(input)}, which the first download holds`);
    }
  }
});
