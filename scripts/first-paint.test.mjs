// The first paint (index.html): App's loading screen as static markup in #root, so the page paints when the stylesheet
// arrives instead of after the bundle has run; an inline script that sets the theme first, so a dark-mode player never
// sees a light page; and the guard that keeps the static copy hidden under the dev server until its styles apply.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transform } from 'esbuild';
import { JSDOM } from 'jsdom';
import { ROOT, bundleApp, syncAppFixture } from './lib/app-harness.mjs';

const HTML = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
// The page's one inline script (the bundle's own <script> has a src).
const THEME_SCRIPT = HTML.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? '';
const THEME_COLOURS = { light: '#f5f5f2', dark: '#121416' };

/** Run `fn` with these globals defined (property descriptors: { value } or { get }), then put the previous ones back. */
async function withGlobals(descriptors, fn) {
  const prior = new Map(Object.keys(descriptors).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, descriptor] of Object.entries(descriptors)) Object.defineProperty(globalThis, key, { configurable: true, ...descriptor });
  try { return await fn(); } finally {
    for (const [key, descriptor] of prior) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  }
}

/** #root's markup in index.html, as a browser parses it. */
const pageRoot = () => new JSDOM(HTML).window.document.getElementById('root').innerHTML;

/** What React renders into #root, less the theme toggle (inert until React mounts) and the map under the loading screen. */
function staticShell(markup) {
  const { document } = new JSDOM(`<!doctype html><body><div id="root">${markup}</div></body>`).window;
  for (const node of document.querySelectorAll('#root main, #root .theme-toggle')) node.remove();
  return document.getElementById('root').innerHTML;
}

test('index.html paints App\'s loading screen: #root holds what App first renders, less the theme toggle and the map', async () => {
  const App = await bundleApp();
  const fixture = syncAppFixture({ phase: 'loading' });
  let harness;
  try { harness = renderToStaticMarkup(fixture.app.render()); } finally { fixture.close(); }
  // A fresh App, as main.jsx mounts it: its own initial state, nothing the fixture sets. React's first commit clears
  // the static copy and inserts this tree in the same task, so the page never shows an empty #root in between.
  const storage = { getItem: () => null, setItem() {}, removeItem() {} };
  const fresh = await withGlobals({ localStorage: { value: storage } }, () => renderToStaticMarkup(React.createElement(App)));
  assert.ok(harness.includes('theme-toggle') && harness.includes('<main'), 'React renders the toggle and the map the page leaves out');
  const page = pageRoot();
  assert.match(page, /^<div class="app-shell" data-view="setup" data-role="spectator">.*Opening the atlas…/);
  assert.equal(staticShell(harness), page, 'the harness App in phase loading');
  assert.equal(staticShell(fresh), page, 'a freshly constructed App');
});

/**
 * data-theme and the browser bar's colour after `run` (the page's inline script, or appearance.js's initTheme) on a
 * fresh parse of index.html. `saved`: what localStorage holds ('blocked' throws, as blocked site data does). `system`:
 * the colour scheme the system asks for ('none': no matchMedia at all).
 */
async function themeAfter(run, { saved, system }) {
  const { window } = new JSDOM(HTML, { url: 'https://imperialism.test/', runScripts: 'outside-only' });
  if (saved === 'blocked') {
    Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new window.DOMException('blocked', 'SecurityError'); } });
  } else if (saved !== 'none') window.localStorage.setItem('fi-theme', saved);
  if (system !== 'none') {
    window.matchMedia = query => ({ media: query, matches: system === 'dark' && query === '(prefers-color-scheme: dark)',
      addEventListener() {}, removeEventListener() {} });
  }
  await run(window);
  const meta = window.document.querySelector('meta[name="theme-color"]');
  return { theme: window.document.documentElement.getAttribute('data-theme'), colour: meta.getAttribute('content') };
}

test('the inline script sets the theme and the browser bar exactly as appearance.js does, before any stylesheet', async () => {
  const { initTheme } = await import('../src/appearance.js');
  const inline = window => window.eval(THEME_SCRIPT);
  // appearance.js reads the page's window, document and localStorage as globals.
  const bundle = window => withGlobals({ window: { value: window }, document: { value: window.document },
    localStorage: { get: () => window.localStorage } }, () => initTheme());
  let cases = 0;
  for (const saved of ['light', 'dark', 'none', 'blue', 'blocked']) {
    for (const system of ['light', 'dark', 'none']) {
      const label = `saved ${saved}, system ${system}`;
      const expected = saved === 'light' || saved === 'dark' ? saved : system === 'dark' ? 'dark' : 'light';
      const page = await themeAfter(inline, { saved, system });
      assert.deepEqual(page, { theme: expected, colour: THEME_COLOURS[expected] }, `inline script: ${label}`);
      assert.deepEqual(await themeAfter(bundle, { saved, system }), page, `appearance.js: ${label}`);
      cases++;
    }
  }
  assert.equal(cases, 15);
  // It runs from the head: after the theme-color meta it updates, before anything that could paint.
  const at = text => HTML.indexOf(text);
  assert.ok(at('<meta name="theme-color"') < at('<script>') && at('<script>') < at('</head>'));
  assert.equal(at('rel="stylesheet"'), -1, 'the build adds its stylesheet at the end of the head, after the script');
});

test('the inline script is plain ES5 and survives a page without a theme-color meta', async () => {
  // Built for an ES5 browser, esbuild refuses or rewrites any newer syntax.
  const es5 = await transform(THEME_SCRIPT, { loader: 'js', target: 'es5' });
  const esnext = await transform(THEME_SCRIPT, { loader: 'js', target: 'esnext' });
  assert.equal(es5.code, esnext.code, 'nothing in it needs rewriting for ES5');
  const { window } = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'https://imperialism.test/', runScripts: 'outside-only' });
  window.eval(THEME_SCRIPT);
  assert.equal(window.document.documentElement.getAttribute('data-theme'), 'light');
});

test('the dev server\'s guard hides the static loading screen until shell.css shows it, whichever applies last', () => {
  const guard = HTML.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? '';
  assert.match(guard, /^\s*#root > \.app-shell \{ visibility: hidden; \}\s*$/);
  const shell = readFileSync(path.join(ROOT, 'src/styles/shell.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const reveal = [...shell.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(([, , body]) => /visibility\s*:\s*visible/.test(body))
    .map(([, selector]) => selector.trim());
  assert.deepEqual(reveal, ['html #root > .app-shell']);
  // The two rules select the same element, and the reveal wins on specificity, not on the order of the stylesheets
  // (the dev server injects its styles after the page's own <style>; a build links them after it too).
  const { document } = new JSDOM(HTML).window;
  assert.equal(document.querySelectorAll('#root > .app-shell').length, 1);
  assert.ok(document.querySelector('#root > .app-shell').matches(reveal[0]));
  const specificity = selector => [/#[\w-]+/g, /\.[\w-]+|\[[^\]]*\]/g, /(?:^|[\s>+~])[a-z][\w-]*/gi]
    .map(pattern => (selector.match(pattern) || []).length);
  assert.deepEqual([specificity(reveal[0]), specificity('#root > .app-shell')], [[1, 1, 1], [1, 1, 0]]);
});
