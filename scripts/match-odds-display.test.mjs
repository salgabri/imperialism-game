import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';

const bundled = await build({
  entryPoints: [fileURLToPath(new URL('../src/components/MatchCard.jsx', import.meta.url))],
  bundle: true, write: false, platform: 'node', format: 'cjs', external: ['react'],
  loader: { '.css': 'empty' }, define: { 'import.meta.env.BASE_URL': '"/"' }, logLevel: 'silent',
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const MatchCard = module.exports.default;
const teams = {
  a: { id: 'A', name: 'Alfa', code: 'ALF', score: 0, eff: 75, isClub: true },
  b: { id: 'B', name: 'Beta', code: 'BET', score: 0, eff: 75, isClub: true },
};

function displayedOdds(odds) {
  const markup = renderToStaticMarkup(React.createElement(MatchCard, { ...teams, round: 1, status: 'Ready', odds }));
  const dom = new JSDOM(markup);
  try {
    const row = dom.window.document.querySelector('.fi-match-odds');
    return row ? [...row.querySelectorAll('span')].map(span => span.textContent) : null;
  } finally { dom.window.close(); }
}

test('extreme sampled estimates communicate a small upset chance rather than certainty', () => {
  for (const a of [0, .0001, .004, .0099]) {
    assert.deepEqual(displayedOdds({ a, b: 1 - a }), ['ALF <1%', 'Estimated win chance', 'BET >99%']);
    assert.deepEqual(displayedOdds({ a: 1 - a, b: a }), ['ALF >99%', 'Estimated win chance', 'BET <1%']);
  }
});

test('numeric odds include zero estimates and infer the opponent chance', () => {
  assert.deepEqual(displayedOdds(0), ['ALF <1%', 'Estimated win chance', 'BET >99%']);
  assert.deepEqual(displayedOdds(1), ['ALF >99%', 'Estimated win chance', 'BET <1%']);
  assert.deepEqual(displayedOdds(.997), ['ALF >99%', 'Estimated win chance', 'BET <1%']);
  assert.deepEqual(displayedOdds({ a: .003 }), ['ALF <1%', 'Estimated win chance', 'BET >99%']);
});

test('ordinary estimates retain whole percentages and the existing match presentation', () => {
  assert.deepEqual(displayedOdds({ a: .5, b: .5 }), ['ALF 50%', 'Estimated win chance', 'BET 50%']);
  assert.deepEqual(displayedOdds({ a: .673, b: .327 }), ['ALF 67%', 'Estimated win chance', 'BET 33%']);
  assert.deepEqual(displayedOdds({ a: .01, b: .99 }), ['ALF 1%', 'Estimated win chance', 'BET 99%']);
  assert.deepEqual(displayedOdds({ a: .99, b: .01 }), ['ALF 99%', 'Estimated win chance', 'BET 1%']);
  const markup = renderToStaticMarkup(React.createElement(MatchCard, { ...teams, round: 1, status: 'Ready', odds: .5 }));
  assert.match(markup, /Pre-match estimate including match-day uncertainty and tie-breaks/);
  assert.match(markup, /class="fi-scoreboard"/);
});

test('a match without an estimate has no odds row', () => {
  assert.equal(displayedOdds(undefined), null);
  assert.equal(displayedOdds(null), null);
});
