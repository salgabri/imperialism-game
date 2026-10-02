import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';
import { tacticalOptions } from '../src/engine/managerStrategy.js';
import { acquisitionOptions } from '../src/engine/campaignExperience.js';
import { getSport } from '../src/sports/index.js';

const bundled = await build({ stdin: { contents: `
  export {default as TacticalChoice} from './src/components/TacticalChoice.jsx';
  export {default as AcquisitionChoice} from './src/components/AcquisitionChoice.jsx';
`, resolveDir: fileURLToPath(new URL('../', import.meta.url)), loader: 'jsx' },
  bundle: true, write: false, platform: 'node', format: 'cjs', external: ['react'], loader: { '.css': 'empty' }, logLevel: 'silent' });
const module = { exports: {} };
new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { TacticalChoice, AcquisitionChoice } = module.exports;
const dom = new JSDOM('<html><body><button id="prior">Prior focus</button></body></html>');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import('react-dom/client');
after(() => dom.window.close());

async function mount(Component, props) {
  document.querySelector('#prior').focus();
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(React.createElement(Component, props)));
  return { host, async close() { await act(async () => root.unmount()); host.remove(); } };
}
const squad = rating => ({ id: String(rating), sport: 'football', squad: getSport('football').positionPlan.map((pos, index) => ({ name: `Player ${index}`, pos, rating })) });

test('tactical decision explains risk, commits the chosen ID and restores focus', async () => {
  const choices = [];
  const view = await mount(TacticalChoice, { choice: { managerName: 'Alfa', opponentName: 'Beta', options: tacticalOptions(squad(75), squad(85), 6) }, onChoose: value => choices.push(value) });
  assert.match(view.host.textContent, /You are the underdog/);
  assert.match(view.host.textContent, /Matchday variation 11.0/);
  assert.match(view.host.textContent, /Scoring luck remains/);
  assert.equal(document.activeElement.dataset.tactic, 'balanced');
  await act(async () => view.host.querySelector('[data-tactic="attack"]').click());
  assert.deepEqual(choices, ['attack']);
  await view.close();
  assert.equal(document.activeElement.id, 'prior');
});

test('signing comparisons are accessible outside their claim buttons and inside the focus trap', async () => {
  const winner = squad(80), loser = { ...squad(70), squad: [{ name: 'New defender', pos: 'DF', rating: 85 }] };
  const view = await mount(AcquisitionChoice, { choice: { winnerName: 'Alfa', loserName: 'Beta', candidates: acquisitionOptions(winner, loser) }, onChoose() {} });
  const summary = view.host.querySelector('summary');
  assert.ok(summary);
  assert.equal(view.host.querySelector('button summary'), null);
  assert.equal(view.host.querySelectorAll('tbody tr').length, 11);
  assert.match(view.host.querySelector('caption').textContent, /before and after signing New defender/);
  assert.ok(view.host.querySelector('.is-changed'));
  summary.focus();
  await act(async () => summary.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })));
  assert.equal(document.activeElement, view.host.querySelector('button'));
  await act(async () => document.activeElement.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })));
  assert.equal(document.activeElement, summary);
  await view.close();
});
