import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';

const compiled = await build({ entryPoints: [fileURLToPath(new URL('../src/components/CampaignStorageDialog.jsx', import.meta.url))],
  bundle: true, write: false, platform: 'node', format: 'cjs', external: ['react'], loader: { '.css': 'empty' }, logLevel: 'silent' });
const module = { exports: {} };
new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const CampaignStorageDialog = module.exports.default;
const dom = new JSDOM('<!doctype html><html><body><button id="opener">Saved campaigns</button></body></html>', { url: 'http://localhost' });
globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import('react-dom/client');
after(() => dom.window.close());
const campaign = { campaignName: 'France campaign', round: 4, matches: 3, seed: 42,
  aliveIds: ['a', 'b'], settings: { sport: 'football', layer: 'nations', scope: 'elite' } };
async function mount(props) {
  document.querySelector('#opener').focus();
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  await act(async () => root.render(React.createElement(CampaignStorageDialog, props)));
  return { host, async close() { await act(async () => root.unmount()); host.remove(); } };
}

test('import preview describes the checkpoint without replacing it until explicit confirmation', async () => {
  const imports = [], exports = [], closes = [];
  const view = await mount({ mode: 'import', campaign, onConfirmImport: name => imports.push(name),
    onExportCurrent: () => exports.push('export'), onClose: () => closes.push('close') });
  assert.equal(view.host.querySelector('[role=dialog]').getAttribute('aria-modal'), 'true');
  assert.match(view.host.textContent, /Round 4 · 3 matches · 2 remaining/);
  assert.match(view.host.textContent, /existing campaigns remain available/);
  assert.deepEqual(imports, []);
  const buttons = [...view.host.querySelectorAll('button')];
  await act(async () => buttons.find(button => /Export current/.test(button.textContent)).click());
  assert.deepEqual(exports, ['export']); assert.deepEqual(imports, []);
  await act(async () => buttons.find(button => /Import as new/.test(button.textContent)).click());
  assert.deepEqual(imports, ['France campaign']);
  await act(async () => document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  assert.deepEqual(closes, ['close']);
  await view.close(); assert.equal(document.activeElement.id, 'opener');
});

test('conflict recovery exposes both reload and a fork without forcing progress replacement', async () => {
  const choices = [];
  const view = await mount({ mode: 'conflict', campaign, onReload: () => choices.push('reload'), onFork: name => choices.push(name) });
  assert.match(view.host.textContent, /another tab saved/);
  assert.equal(document.activeElement.getAttribute('aria-label'), 'Close saved campaigns');
  const buttons = [...view.host.querySelectorAll('button')];
  await act(async () => buttons.find(button => /Fork current/.test(button.textContent)).click());
  assert.deepEqual(choices, ['France campaign']);
  await act(async () => buttons.find(button => /Reload newer/.test(button.textContent)).click());
  assert.deepEqual(choices, ['France campaign', 'reload']);
  const last = buttons.at(-1); last.focus();
  await act(async () => document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })));
  assert.equal(document.activeElement.getAttribute('aria-label'), 'Close saved campaigns');
  await view.close();
});

test('damaged slot opens recovery and raw file is exportable when no backup exists', async () => {
  const selected = [], exported = [];
  const slots = await mount({ mode: 'slots', campaigns: [{ id: 'a', name: 'My campaign', damaged: true, ...campaign }], onLoad: id => selected.push(id) });
  const recover = [...slots.host.querySelectorAll('button')].find(button => /Recover My campaign/.test(button.textContent));
  assert.equal(recover.disabled, false); await act(async () => recover.click()); assert.deepEqual(selected, ['a']); await slots.close();
  const recovery = await mount({ mode: 'recovery', onExportRaw: () => exported.push('raw') });
  assert.equal([...recovery.host.querySelectorAll('button')].some(button => /Restore previous/.test(button.textContent)), false);
  await act(async () => [...recovery.host.querySelectorAll('button')].find(button => /Export damaged/.test(button.textContent)).click());
  assert.deepEqual(exported, ['raw']); await recovery.close();
});
