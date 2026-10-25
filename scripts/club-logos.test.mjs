// Club crests (README "Club crests"): the generated list, the vendored files and their sources agree, and a club's
// mark shows its crest where it has one and its monogram where it has none.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { CLUBS as FOOTBALL_CLUBS } from '../src/data/clubs.football.js';
import { CLUBS as BASKETBALL_CLUBS } from '../src/data/clubs.basketball.js';
import { DOMESTIC } from '../src/data/domestic.js';

const root = new URL('../', import.meta.url);
const compiled = await build({
  stdin: {
    contents: `export { default as TeamMark } from './src/components/TeamMark.jsx';
      export { default as SquadFlag } from './src/screens/squad/SquadFlag.jsx';
      export { clubLogoFile, clubLogoUrl } from './src/data/clubLogos.js';`,
    resolveDir: fileURLToPath(root), loader: 'jsx',
  },
  bundle: true, write: false, platform: 'node', format: 'cjs', external: ['react'], jsx: 'automatic',
  loader: { '.css': 'empty' }, define: { 'import.meta.env.BASE_URL': '"/"' }, logLevel: 'silent',
});
const module = { exports: {} };
new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { TeamMark, SquadFlag, clubLogoFile, clubLogoUrl } = module.exports;
const dom = new JSDOM('<!doctype html><html><body></body></html>');
after(() => dom.window.close());

const render = element => {
  const host = dom.window.document.createElement('div');
  host.innerHTML = renderToStaticMarkup(element);
  return host;
};

const files = new Set(readdirSync(new URL('public/club-logos/', root)).filter(name => name.endsWith('.webp')));
const sources = readFileSync(new URL('public/club-logos/SOURCES.tsv', root), 'utf8').split('\n')
  .filter(line => line && !line.startsWith('#')).slice(1).map(line => line.split('\t'));
const domesticIds = DOMESTIC.flatMap(entry => JSON.parse(readFileSync(new URL(`public/domestic/${entry.id}.json`, root), 'utf8')).clubs.map(club => club.id));
const allClubIds = [...FOOTBALL_CLUBS, ...BASKETBALL_CLUBS].map(club => club.id).concat(domesticIds);
const withCrest = allClubIds.filter(id => clubLogoFile(id));

test('every club the list gives a crest has its file, a source row, and nothing else ships', () => {
  assert.ok(withCrest.length > 1000, `crests for ${withCrest.length} clubs`);
  for (const id of withCrest) assert.ok(files.has(`${clubLogoFile(id)}.webp`), `${id}: ${clubLogoFile(id)}.webp is vendored`);
  const used = new Set(withCrest.map(id => `${clubLogoFile(id)}.webp`));
  assert.deepEqual([...files].filter(name => !used.has(name)), [], 'no orphan crest files');
  const rows = new Map(sources.map(row => [row[0], row]));
  assert.deepEqual(withCrest.filter(id => !rows.has(id)), [], 'every crest has a SOURCES.tsv row');
  assert.deepEqual([...rows.keys()].filter(id => !clubLogoFile(id)), [], 'no source row without a crest');
  for (const [id, row] of rows) {
    assert.equal(row.length, 7, `${id}: club, name, image, file, licence, non-free, file page`);
    assert.equal(row[2], `${clubLogoFile(id)}.webp`);
    assert.match(row[6], /^https:\/\/(en\.wikipedia|commons\.wikimedia)\.org\/wiki\/File:/, `${id}: links its file page`);
  }
});

test('the big clubs carry crests, and an all-leagues club shares its domestic twin\'s file', () => {
  for (const id of ['f-real-madrid', 'f-liverpool', 'f-manchester-city', 'f-arsenal', 'f-fc-barcelona', 'f-fc-bayern-munchen', 'f-inter',
    'b-boston-celtics', 'b-los-angeles-lakers']) assert.ok(clubLogoFile(id), `${id} has a crest`);
  const madrid = clubLogoFile('f-real-madrid');
  assert.match(madrid, /^d724-\d+$/, 'Real Madrid uses its La Liga twin\'s file');
  assert.equal(clubLogoUrl('f-real-madrid'), `/club-logos/${madrid}.webp`);
  assert.equal(clubLogoFile('f-not-a-club'), null);
  assert.equal(clubLogoFile('d999-1'), null);
  assert.equal(clubLogoFile(null), null);
});

test('a club mark is its crest in the monogram box, a club without one keeps its monogram, a nation its flag', () => {
  const crest = render(React.createElement(TeamMark, { id: null, teamId: 'f-arsenal', code: 'ARS', isClub: true, width: 24, height: 18 }));
  const box = crest.querySelector('.fi-team-monogram.fi-team-monogram--logo');
  assert.ok(box, 'the crest sits in the box containers size for a monogram');
  assert.equal(box.getAttribute('aria-hidden'), 'true');
  assert.equal(box.hasAttribute('title'), false, 'smoke reads span[title] as the team name');
  assert.equal(box.textContent, '', 'no monogram letters behind the crest');
  assert.equal(box.querySelector('img').getAttribute('src'), clubLogoUrl('f-arsenal'));
  assert.equal(box.querySelector('img').getAttribute('alt'), '');

  // Setup passes a club's team id as `id`.
  const setup = render(React.createElement(TeamMark, { id: 'f-arsenal', code: 'ARS', isClub: true, width: 24 }));
  assert.equal(setup.querySelector('img').getAttribute('src'), clubLogoUrl('f-arsenal'));

  const monogram = render(React.createElement(TeamMark, { teamId: 'f-not-a-club', code: 'NAC', isClub: true, width: 24 }));
  assert.equal(monogram.querySelector('.fi-team-monogram').textContent, 'NAC');
  assert.equal(monogram.querySelector('img'), null);

  const flag = render(React.createElement(TeamMark, { id: '826', teamId: '826', code: 'ENG', isClub: false, width: 24 }));
  assert.ok(flag.querySelector('img.flag-chip'));
});

test('a claimed player\'s former club shows its crest in the squad tables', () => {
  const club = render(React.createElement(SquadFlag, { teamId: 'f-arsenal', isClub: true, width: 16, height: 12 }));
  assert.ok(club.querySelector('.squad-flag.squad-flag--logo'));
  assert.equal(club.querySelector('img').getAttribute('src'), clubLogoUrl('f-arsenal'));
  const plain = render(React.createElement(SquadFlag, { teamId: 'f-not-a-club', isClub: true, width: 16, height: 12 }));
  assert.equal(plain.querySelector('img'), null, 'a club without a crest keeps the plain block');
  assert.ok(!plain.querySelector('.squad-flag--logo'));
});
