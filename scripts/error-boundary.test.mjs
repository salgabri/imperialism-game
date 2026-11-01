// The crash screen (src/components/ErrorBoundary.jsx, around the App in main.jsx): an error while rendering shows a
// recoverable screen instead of a blank page, and Export campaign downloads the stored checkpoint unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { bundleComponents, mount, withDom } from './lib/app-harness.mjs';
import { SAVE_KEY } from '../src/config.js';

const { ErrorBoundary } = await bundleComponents({ ErrorBoundary: 'src/components/ErrorBoundary.jsx' });
const MESSAGE = "Cannot read properties of undefined (reading 'squad')";

function Screen({ crash }) {
  if (crash) throw new TypeError(MESSAGE);
  return React.createElement('p', null, 'Campaign running');
}
const tree = crash => React.createElement(ErrorBoundary, null, React.createElement(Screen, { crash }));

/** Run `fn` with `localStorage` holding `entries`, and React's and jsdom's reports of the thrown error silenced. */
async function withCrashEnvironment(entries, fn) {
  return withDom(async dom => {
    const prior = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    const storage = dom.window.localStorage;
    for (const [key, value] of Object.entries(entries)) storage.setItem(key, value);
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
    const error = console.error;
    console.error = () => {};
    try { return await fn(dom); } finally {
      console.error = error;
      if (prior) Object.defineProperty(globalThis, 'localStorage', prior); else delete globalThis.localStorage;
    }
  });
}

test('main.jsx mounts the App inside the error boundary', () => {
  const main = readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
  assert.match(main, /import ErrorBoundary from '\.\/components\/ErrorBoundary\.jsx'/);
  assert.match(main, /\.render\(<ErrorBoundary><App \/><\/ErrorBoundary>\)/);
});

test('an error while rendering shows the crash screen instead of a blank page', async () => {
  await withCrashEnvironment({}, async ({ document }) => {
    const view = await mount(tree(false));
    assert.match(view.host.textContent, /Campaign running/);
    await view.root.render(tree(true));
    await act(async () => {});
    const heading = view.host.querySelector('h1');
    assert.equal(heading?.textContent, 'Something went wrong');
    assert.equal(document.activeElement?.id, 'crash-title', 'focus moves to the heading');
    assert.match(view.host.textContent, /Reload to start again/);
    const buttons = [...view.host.querySelectorAll('button')].map(button => button.textContent);
    assert.deepEqual(buttons, ['Reload'], 'no Export campaign without a stored checkpoint');
    assert.match(view.host.querySelector('.crash-screen__error').textContent, new RegExp(`^TypeError: ${MESSAGE.replace(/[()]/g, '\\$&')}`));
    const report = new URL(view.host.querySelector('a').href);
    assert.equal(`${report.origin}${report.pathname}`, 'https://github.com/salgabri/imperialism-game/issues/new');
    assert.equal(report.searchParams.get('title'), `Crash: TypeError: ${MESSAGE}`);
    assert.match(report.searchParams.get('body'), /What were you doing/);
  });
});

test('Export campaign downloads the stored checkpoint unchanged, named as exports are', async () => {
  const checkpoint = JSON.stringify({ v: 5, seed: 728491, matches: 12, settings: { sport: 'football' } });
  await withCrashEnvironment({ [SAVE_KEY]: checkpoint }, async ({ window }) => {
    const blobs = [], clicks = [];
    const createObjectURL = URL.createObjectURL, click = window.HTMLAnchorElement.prototype.click;
    URL.createObjectURL = blob => { blobs.push(blob); return 'blob:checkpoint'; };
    window.HTMLAnchorElement.prototype.click = function recordClick() { clicks.push({ href: this.href, download: this.download }); };
    try {
      const view = await mount(tree(true));
      assert.match(view.host.textContent, /Your campaign is saved up to its last checkpoint/);
      const exportButton = [...view.host.querySelectorAll('button')].find(button => button.textContent === 'Export campaign');
      assert.ok(exportButton, 'Export campaign is offered when a checkpoint is stored');
      await act(async () => exportButton.click());
      assert.deepEqual(clicks, [{ href: 'blob:checkpoint', download: 'imperialism-728491-match-12.json' }]);
      assert.equal(blobs.length, 1);
      assert.equal(await blobs[0].text(), checkpoint);
    } finally {
      URL.createObjectURL = createObjectURL;
      window.HTMLAnchorElement.prototype.click = click;
    }
  });
});
