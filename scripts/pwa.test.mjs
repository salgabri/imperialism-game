// The installable, offline game (README §Running it): the manifest and icons, what the service worker precaches and
// what it caches on first use, the update flow that never reloads a campaign on its own, and the persist() request
// that keeps saves through storage eviction.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, globSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import React, { act } from 'react';
import sharp from 'sharp';
import { APP_MANIFEST, FILE_NAVIGATION, PAGE_ICONS, PRECACHE, RUNTIME_CACHES, isRuntimeCached } from '../src/pwa.js';
import { keepSaves, resetKeepSaves } from '../src/engine/persistence.js';
import { writeSave } from '../src/engine/storage.js';
import { buildTeam, makeRng } from '../src/data/teams.js';
import { getSport } from '../src/sports/index.js';
import { ROOT, bundleComponents, withDom } from './lib/app-harness.mjs';

const PUBLIC = path.join(ROOT, 'public');
const publicFile = file => path.join(PUBLIC, file);
const slash = file => file.replaceAll('\\', '/');
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

function pngSize(file) {
  const bytes = readFileSync(file);
  assert.equal(bytes.subarray(1, 4).toString('latin1'), 'PNG', `${file} is a PNG`);
  return `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`;
}

test('the manifest makes the build installable: standalone, relative scope, 192 and 512 icons, one maskable', () => {
  assert.equal(APP_MANIFEST.display, 'standalone');
  assert.equal(APP_MANIFEST.start_url, './');
  assert.equal(APP_MANIFEST.scope, './', 'relative, like Vite\'s base, so dist/ installs from any subpath');
  assert.ok(APP_MANIFEST.name && APP_MANIFEST.short_name.length <= 12, 'a short name that fits under a Home Screen icon');
  for (const icon of APP_MANIFEST.icons) assert.equal(pngSize(publicFile(icon.src)), icon.sizes, icon.src);
  const any = APP_MANIFEST.icons.filter(icon => icon.purpose === 'any').map(icon => icon.sizes);
  assert.deepEqual(any, ['192x192', '512x512']);
  assert.deepEqual(APP_MANIFEST.icons.filter(icon => icon.purpose === 'maskable').map(icon => icon.sizes), ['512x512']);
});

test('the maskable icon keeps the needle inside the central circle every icon mask keeps', async () => {
  const icon = APP_MANIFEST.icons.find(entry => entry.purpose === 'maskable');
  const { data, info } = await sharp(publicFile(icon.src)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const at = (x, y) => Array.from(data.subarray((y * info.width + x) * 3, (y * info.width + x) * 3 + 3));
  const ground = at(0, 0), safe = 0.4 * info.width, centre = info.width / 2;
  let outside = 0;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (Math.hypot(x + 0.5 - centre, y + 0.5 - centre) <= safe) continue;
      outside++;
      assert.ok(at(x, y).every((channel, i) => Math.abs(channel - ground[i]) <= 2), `(${x}, ${y}) is outside the safe circle`);
    }
  }
  assert.ok(outside > 0.45 * info.width * info.height);
});

test('index.html links a favicon, the SVG icon, the Apple touch icon and the theme colour, all in public/', () => {
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const links = [...html.matchAll(/<link rel="(icon|apple-touch-icon)" href="\/([^"]+)"/g)].map(match => match[2]);
  assert.deepEqual(links.sort(), [...PAGE_ICONS].sort());
  for (const file of PAGE_ICONS) assert.ok(existsSync(publicFile(file)), file);
  assert.equal(pngSize(publicFile('apple-touch-icon.png')), '180x180');
  // An ICO of PNG images: 16, 32 and 48 px.
  const ico = readFileSync(publicFile('favicon.ico'));
  assert.deepEqual([ico.readUInt16LE(0), ico.readUInt16LE(2)], [0, 1]);
  assert.deepEqual(Array.from({ length: ico.readUInt16LE(4) }, (_, i) => ico[6 + 16 * i]), [16, 32, 48]);
  assert.match(html, new RegExp(`<meta name="theme-color" content="${APP_MANIFEST.theme_color}">`));
  assert.ok(html.includes(`<meta name="description" content="${APP_MANIFEST.description}">`), 'the manifest describes the game as the page does');
});

test('the precache is the app shell only; seasons, maps, flags and crests are cached the first time they are used', () => {
  // The public/ files the precache globs take (index.html and assets/ come from the build).
  const shell = globSync([...PRECACHE], { cwd: PUBLIC }).map(slash).sort();
  const bytes = shell.reduce((sum, file) => sum + statSync(publicFile(file)).size, 0);
  assert.ok(bytes < 1_500_000, `the public part of the shell is ${bytes} bytes`);
  assert.ok(shell.includes('world-110m.v1.json') && shell.includes('countries-50m.json'));
  assert.ok(!shell.some(file => /^(football|basketball|domestic|flags|flags-symbols|club-logos|textures)\//.test(file)), shell.join(', '));
  // Every font fonts.css loads is in it, and only those.
  const fonts = [...readFileSync(path.join(ROOT, 'src/fonts.css'), 'utf8').matchAll(/url\('\/(fonts\/[^']+)'\)/g)].map(match => match[1]);
  assert.deepEqual(shell.filter(file => file.startsWith('fonts/')), [...new Set(fonts)].sort());

  const cacheOf = file => RUNTIME_CACHES.find(cache => cache.pattern.test(`https://imperialism.test/${file}`))?.cacheName ?? null;
  // Every file but the licences and source lists beside the data, which the game never loads.
  const files = folder => readdirSync(publicFile(folder)).filter(file => !/^(README\.md|LICENSE|SOURCES\.tsv|ATTRIBUTION[\w-]*\.txt)$/.test(file))
    .map(file => `${folder}/${file}`);
  for (const folder of ['football', 'basketball', 'domestic']) {
    for (const file of files(folder)) assert.equal(cacheOf(file), 'imperialism-data', file);
  }
  for (const folder of ['flags', 'flags-symbols', 'club-logos']) {
    for (const file of files(folder)) assert.equal(cacheOf(file), 'imperialism-images', file);
  }
  for (const cache of RUNTIME_CACHES) {
    const count = cache.cacheName === 'imperialism-data' ? ['football', 'basketball', 'domestic'].flatMap(files).length
      : ['flags', 'flags-symbols', 'club-logos', 'textures'].flatMap(files).length;
    assert.ok(cache.maxEntries > count, `${cache.cacheName} holds all ${count} files`);
  }
  for (const file of ['index.html', 'assets/index-abc123.js', 'world-110m.v1.json', 'fonts/archivo-latin-variable.woff2', 'icon-512.png']) {
    assert.equal(isRuntimeCached(`https://imperialism.test/${file}`), false, file);
  }
  assert.equal(isRuntimeCached('https://imperialism.test/sub/domestic/826.json'), true, 'served from a subpath');
});

test('offline, every navigation in scope gets the game, but opening a data file directly does not', () => {
  for (const url of ['/', '/index.html', '/?playtest', '/sub/', '/sub/index.html?playtest']) assert.equal(FILE_NAVIGATION.test(url), false, url);
  for (const url of ['/football/ea-fc-26.json', '/club-logos/b-boston-celtics.webp', '/flags-symbols/README.md', '/sub/domestic/826.json']) {
    assert.equal(FILE_NAVIGATION.test(url), true, url);
  }
});

// ---------- updates ----------

const { ErrorBoundary, UpdatePrompt, registerServiceWorker, applyUpdate, resetServiceWorker } = await bundleComponents({
  ErrorBoundary: 'src/components/ErrorBoundary.jsx',
  UpdatePrompt: 'src/components/UpdatePrompt.jsx',
  registerServiceWorker: ['src/serviceWorker.js', 'registerServiceWorker'],
  applyUpdate: ['src/serviceWorker.js', 'applyUpdate'],
  resetServiceWorker: ['src/serviceWorker.js', 'resetServiceWorker'],
});

class Target {
  listeners = new Map();
  addEventListener(type, listener) { this.listeners.set(type, [...(this.listeners.get(type) || []), listener]); }
  dispatch(type) { for (const listener of this.listeners.get(type) || []) listener({ type }); }
}

class Worker extends Target {
  messages = [];
  constructor(state) { super(); this.state = state; }
  postMessage(message) { this.messages.push(message); }
  become(state) { this.state = state; this.dispatch('statechange'); }
}

/** navigator.serviceWorker, location, performance, fetch and timers, as registerServiceWorker uses them. */
function browser({ controller = null, waiting = null, installing = null, resources = [], refuse = false } = {}) {
  const registration = Object.assign(new Target(), {
    waiting, installing, updates: 0,
    update() { this.updates++; return Promise.resolve(); },
    /** A new version's worker installs while the page runs. */
    install(worker) { this.installing = worker; this.dispatch('updatefound'); worker.become('installed'); this.installing = null; this.waiting = worker; },
  });
  const container = Object.assign(new Target(), {
    controller, registered: [],
    async register(...args) { this.registered.push(args); if (refuse) throw new DOMException('refused', 'SecurityError'); return registration; },
  });
  const env = {
    navigator: { serviceWorker: container },
    location: { reloads: 0, reload() { this.reloads++; } },
    performance: { getEntriesByType: type => (type === 'resource' ? resources.map(name => ({ name })) : []) },
    fetched: [],
    fetch(url) { env.fetched.push(url); return Promise.resolve({ ok: true }); },
    intervals: [],
    setInterval(fn, ms) { env.intervals.push([fn, ms]); return env.intervals.length; },
    document: Object.assign(new Target(), { visibilityState: 'visible' }),
  };
  return { env, container, registration };
}

const button = (host, text) => [...host.querySelectorAll('button')].find(element => element.textContent === text);

test('a page without service workers, or one that refuses them, registers nothing and plays online', async () => {
  resetServiceWorker();
  assert.equal(await registerServiceWorker('./sw.js', { navigator: {} }), null);
  const { env, container } = browser({ refuse: true });
  assert.equal(await registerServiceWorker('./sw.js', env), null);
  assert.equal(container.registered.length, 1);
  assert.equal(applyUpdate(), false);
});

test('a waiting version shows the prompt; Reload hands it the page and reloads only once it has taken over', () => withDom(async ({ mount }) => {
  resetServiceWorker();
  const waiting = new Worker('installed');
  const { env, container } = browser({ controller: new Worker('activated'), waiting });
  await registerServiceWorker('./sw.js', env);
  assert.deepEqual(container.registered, [['./sw.js', { scope: './' }]]);
  const view = await mount(UpdatePrompt, { campaign: true });
  assert.match(view.host.textContent, /New version ready/);
  assert.match(view.host.textContent, /Your campaign is saved first, then resumes where it is/);
  await act(async () => button(view.host, 'Reload').click());
  assert.deepEqual(waiting.messages, [{ type: 'SKIP_WAITING' }]);
  assert.equal(env.location.reloads, 0, 'nothing reloads before the new worker controls the page');
  container.controller = waiting;
  container.dispatch('controllerchange');
  assert.equal(env.location.reloads, 1);
}));

test('a version the page load found, still installing when registration resolves, is offered too', async () => {
  resetServiceWorker();
  const installing = new Worker('installing');
  const { env } = browser({ controller: new Worker('activated'), installing });
  await registerServiceWorker('./sw.js', env);
  assert.equal(applyUpdate(), false, 'not before it has installed');
  installing.become('installed');
  assert.equal(applyUpdate(), true);
  assert.deepEqual(installing.messages, [{ type: 'SKIP_WAITING' }]);
});

test('a new version never reloads a tab whose player did not choose Reload', async () => {
  resetServiceWorker();
  const waiting = new Worker('installed');
  const { env, container, registration } = browser({ controller: new Worker('activated'), waiting });
  await registerServiceWorker('./sw.js', env);
  // Another tab's player chose Reload: the new worker activates and takes over this page too.
  waiting.become('activated');
  registration.waiting = null;
  container.controller = waiting;
  container.dispatch('controllerchange');
  assert.equal(env.location.reloads, 0);
  // This tab still runs the version it loaded; its own Reload now only reloads.
  assert.equal(applyUpdate(), true);
  assert.equal(env.location.reloads, 1);
  assert.deepEqual(waiting.messages, []);
});

test('a first visit gets no prompt, and the first worker caches what the page loaded before it took over', async () => {
  resetServiceWorker();
  const site = 'http://imperialism.test/';
  const data = ['domestic/826.json', 'football/ea-fc-26.json', 'club-logos/b-boston-celtics.webp', 'flags/fr.svg'].map(file => site + file);
  const resources = [`${site}world-110m.v1.json`, `${site}assets/index-abc123.js`, ...data, `${site}flags/fr.svg`];
  const { env, container, registration } = browser({ resources });
  await registerServiceWorker('./sw.js', env);
  const first = new Worker('installing');
  registration.install(first);
  assert.equal(applyUpdate(), false, 'a first install is not an update');
  first.become('activated');
  registration.waiting = null;
  container.controller = first;
  container.dispatch('controllerchange');
  await flush();
  assert.equal(env.location.reloads, 0);
  assert.deepEqual(env.fetched.sort(), data.sort(), 'each runtime-cached file once; the shell is precached');
  // A version deployed later waits for the player.
  const next = new Worker('installing');
  registration.install(next);
  assert.equal(applyUpdate(), true);
  assert.deepEqual(next.messages, [{ type: 'SKIP_WAITING' }]);
});

test('Later hides the prompt until a newer version arrives', () => withDom(async ({ mount }) => {
  resetServiceWorker();
  const { env, registration } = browser({ controller: new Worker('activated') });
  await registerServiceWorker('./sw.js', env);
  const view = await mount(UpdatePrompt);
  assert.equal(view.host.textContent, '');
  await act(async () => registration.install(new Worker('installing')));
  assert.match(view.host.textContent, /New version ready/);
  assert.doesNotMatch(view.host.textContent, /campaign/, 'setup has no campaign to mention');
  await act(async () => button(view.host, 'Later').click());
  assert.equal(view.host.textContent, '');
  await act(async () => registration.install(new Worker('installing')));
  assert.match(view.host.textContent, /New version ready/);
}));

test('the crash screen\'s Reload hands the page to a waiting version, since a plain reload opens the cached one', () => withDom(async ({ mount }) => {
  resetServiceWorker();
  const waiting = new Worker('installed');
  const { env, container } = browser({ controller: new Worker('activated'), waiting });
  await registerServiceWorker('./sw.js', env);
  const Crash = () => { throw new Error('render failed'); };
  const quiet = console.error;
  console.error = () => {};
  let view;
  try {
    view = await mount(React.createElement(ErrorBoundary, null, React.createElement(Crash)));
  } finally {
    console.error = quiet;
  }
  assert.match(view.host.textContent, /Something went wrong/);
  await act(async () => button(view.host, 'Reload').click());
  assert.deepEqual(waiting.messages, [{ type: 'SKIP_WAITING' }]);
  container.controller = waiting;
  container.dispatch('controllerchange');
  assert.equal(env.location.reloads, 1);
}));

test('a long session looks for new versions every hour', async () => {
  resetServiceWorker();
  const { env, registration } = browser({ controller: new Worker('activated') });
  await registerServiceWorker('./sw.js', env);
  assert.deepEqual(env.intervals.map(([, ms]) => ms), [60 * 60 * 1000]);
  env.intervals[0][0]();
  await flush();
  assert.equal(registration.updates, 1);
  // Coming straight back to the tab does not check again.
  env.document.dispatch('visibilitychange');
  await flush();
  assert.equal(registration.updates, 1);
});

// ---------- persistent storage ----------

test('keepSaves asks the browser once per page and never throws', async () => {
  resetKeepSaves();
  assert.equal(await keepSaves({}), false, 'no Storage API');
  resetKeepSaves();
  const calls = [];
  const manager = (persisted, granted) => ({
    async persisted() { calls.push('persisted'); return persisted; },
    async persist() { calls.push('persist'); return granted; },
  });
  assert.equal(await keepSaves(manager(false, true)), true);
  assert.equal(await keepSaves(manager(false, true)), true);
  assert.deepEqual(calls, ['persisted', 'persist'], 'later calls share the first answer');
  resetKeepSaves();
  calls.length = 0;
  assert.equal(await keepSaves(manager(true, false)), true);
  assert.deepEqual(calls, ['persisted'], 'already kept: no request');
  resetKeepSaves();
  assert.equal(await keepSaves(manager(false, false)), false, 'refused');
  resetKeepSaves();
  assert.equal(await keepSaves({ async persist() { throw new Error('blocked'); } }), false);
  resetKeepSaves();
});

function memoryStorage({ fail = false } = {}) {
  const items = new Map();
  return {
    get length() { return items.size; },
    key: index => [...items.keys()][index] ?? null,
    getItem: key => items.get(key) ?? null,
    setItem(key, value) { if (fail) throw new Error('storage is unavailable'); items.set(key, String(value)); },
    removeItem: key => { items.delete(key); },
  };
}

function smallCampaign() {
  const ids = ['250', '276'], rng = makeRng(20261101), sport = getSport('football');
  return { phase: 'playing', settings: { sport: 'football', layer: 'nations', scope: 'UEFA', pacing: 'duel', resolution: 'instant', role: 'spectator' },
    teams: Object.fromEntries(ids.map(id => [id, buildTeam(id, rng, sport)])), own: { 250: '250', 276: '276' },
    aliveIds: ids.slice(), fallen: [], stats: Object.fromEntries(ids.map(id => [id, { conq: 0, steals: [] }])),
    round: 1, matches: 0, queue: [], history: [], log: [], seed: 20261101, rngState: rng.getState(), revision: 0,
    campaignName: 'Persistence', metrics: { acquisitions: [], leaderChanges: 0 }, turnQueue: [], turnIndex: 0, pendingTarget: null };
}

async function withBrowserStorage(storage, manager, run) {
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  Object.defineProperty(navigator, 'storage', { configurable: true, value: manager });
  resetKeepSaves();
  try { return await run(); } finally {
    delete navigator.storage;
    if (prior) Object.defineProperty(globalThis, 'localStorage', prior); else delete globalThis.localStorage;
    resetKeepSaves();
  }
}

test('the first checkpoint a page writes asks to keep the saves; a failed save does not', async () => {
  const calls = [];
  const manager = { async persisted() { return false; }, async persist() { calls.push('persist'); return true; } };
  await withBrowserStorage(memoryStorage({ fail: true }), manager, async () => {
    assert.equal(writeSave(smallCampaign()).ok, false);
    await flush();
    assert.deepEqual(calls, []);
  });
  await withBrowserStorage(memoryStorage(), manager, async () => {
    const state = smallCampaign();
    const first = writeSave(state);
    assert.equal(first.ok, true);
    assert.equal(writeSave({ ...state, campaignId: first.campaignId, revision: first.revision, round: 2 }).ok, true);
    await flush();
    assert.deepEqual(calls, ['persist']);
  });
});

test('the browser bar takes the theme\'s ground: light and dark', () => withDom(async ({ window, document }) => {
  const meta = Object.assign(document.createElement('meta'), { name: 'theme-color', content: APP_MANIFEST.theme_color });
  document.head.append(meta);
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: window.localStorage });
  try {
    const { setTheme } = await import('../src/appearance.js');
    setTheme('dark');
    assert.equal(meta.content, '#121416');
    setTheme('light');
    assert.equal(meta.content, '#f5f5f2');
  } finally {
    if (prior) Object.defineProperty(globalThis, 'localStorage', prior); else delete globalThis.localStorage;
  }
}));
