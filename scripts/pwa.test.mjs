// The installable, offline game (README §Running it): the manifest and icons, what the service worker precaches and
// what it caches on first use, the crests and flags a campaign keeps for offline play, the update flow that never
// reloads a campaign on its own, and the persist() request that keeps saves through storage eviction.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, globSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import React, { act } from 'react';
import sharp from 'sharp';
import { APP_MANIFEST, FILE_NAVIGATION, PAGE_ICONS, PRECACHE, RUNTIME_CACHES, isRuntimeCached } from '../src/pwa.js';
import { hashedShell } from '../vite.config.js';
import { keepSaves, resetKeepSaves } from '../src/engine/persistence.js';
import { loadSave, writeSave } from '../src/engine/storage.js';
import { decodeDomestic } from '../src/engine/domestic.js';
import { fieldedNations } from '../src/engine/footballSets.js';
import { buildClub, buildTeam, makeRng } from '../src/data/teams.js';
import { getSport } from '../src/sports/index.js';
import { ROOT, bundleApp, bundleComponents, syncAppFixture, withDom } from './lib/app-harness.mjs';

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

test('the precache is the app shell only; seasons, country maps, flags and crests are cached the first time they are used', () => {
  // The build's index.html and assets/: the bundle, and the world maps and fonts under hashed names (hashedShell).
  // Nothing in public/ under its own name: the worker would download it past the cache the page had just filled.
  assert.deepEqual([...PRECACHE], ['index.html', 'assets/**/*']);
  assert.deepEqual(globSync([...PRECACHE], { cwd: PUBLIC }), []);

  const cacheOf = file => RUNTIME_CACHES.find(cache => cache.pattern.test(`https://imperialism.test/${file}`))?.cacheName ?? null;
  // Every file but the licences and source lists beside the data, which the game never loads.
  const files = folder => readdirSync(publicFile(folder)).filter(file => !/^(README\.md|LICENSE|SOURCES\.tsv|ATTRIBUTION[\w-]*\.txt)$/.test(file))
    .map(file => `${folder}/${file}`);
  // Every sport's season folder (a sport with no earlier seasons has none) and the maps.
  const dataFolders = ['football', 'womens-football', 'basketball', 'american-football', 'baseball', 'hockey', 'tennis', 'womens-tennis', 'rugby-league', 'domestic']
    .filter(folder => existsSync(publicFile(folder)));
  for (const folder of dataFolders) {
    for (const file of files(folder)) assert.equal(cacheOf(file), 'imperialism-data', file);
  }
  for (const folder of ['flags', 'flags-symbols', 'club-logos']) {
    for (const file of files(folder)) assert.equal(cacheOf(file), 'imperialism-images', file);
  }
  for (const cache of RUNTIME_CACHES) {
    const count = cache.cacheName === 'imperialism-data' ? dataFolders.flatMap(files).length
      : ['flags', 'flags-symbols', 'club-logos', 'textures'].flatMap(files).length;
    assert.ok(cache.maxEntries > count, `${cache.cacheName} holds all ${count} files`);
  }
  for (const file of ['index.html', 'assets/index-abc123.js', 'world-110m.v1.json', 'fonts/archivo-latin-variable.woff2', 'icon-512.png']) {
    assert.equal(isRuntimeCached(`https://imperialism.test/${file}`), false, file);
  }
  assert.equal(isRuntimeCached('https://imperialism.test/sub/domestic/826.json'), true, 'served from a subpath');
});

test('browsers keep flags, crests and icons a month, so a returning player asks the host for none of them', () => {
  // Each request counts against the host's allowance, a 304 too (README "Caching"): kept a day, the flags cost a
  // returning player about 185 requests a day on the Flags map. The worker still shows its copy at once, offline too,
  // and refreshes it in the background, which the browser answers from its own copy while that is under a month old.
  assert.equal(RUNTIME_CACHES.find(cache => cache.cacheName === 'imperialism-images').handler, 'StaleWhileRevalidate');
  const { headers } = JSON.parse(readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  const cacheControl = rule => rule?.headers.find(header => header.key === 'Cache-Control')?.value ?? '';
  const month = new RegExp(`\\bmax-age=${30 * 24 * 60 * 60}\\b`);
  for (const folder of ['flags', 'flags-symbols', 'club-logos']) {
    assert.match(cacheControl(headers.find(rule => rule.source === `/${folder}/(.*)`)), month, folder);
  }
  const icons = headers.find(rule => rule.source.startsWith('/:icon('));
  assert.match(cacheControl(icons), month, 'icons');
  for (const icon of [...PAGE_ICONS, ...APP_MANIFEST.icons.map(entry => entry.src)]) {
    assert.ok(icons.source.includes(icon.replaceAll('.', '\\.')), `${icon} is kept a month too`);
  }
});

test('a build serves the world maps and the fonts hashed in assets/, so a first visit downloads each once', () => {
  const plugin = hashedShell();
  assert.equal(plugin.apply, 'build', 'the dev server and the tests keep public/\'s names');
  // The maps: copies named by their content, which src/mapRequests.js learns from __HASHED_MAPS__.
  const names = JSON.parse(plugin.config({ root: ROOT }).define.__HASHED_MAPS__);
  assert.deepEqual(Object.keys(names), ['world-110m.v1.json', 'countries-50m.json']);
  const emitted = [];
  plugin.generateBundle.call({ emitFile: asset => emitted.push(asset) });
  for (const [file, name] of Object.entries(names)) {
    const bytes = readFileSync(publicFile(file));
    assert.equal(name, `assets/${file.replace(/\.json$/, '')}-${createHash('sha256').update(bytes).digest('hex').slice(0, 8)}.json`);
    const asset = emitted.find(entry => entry.fileName === name);
    assert.ok(asset && asset.type === 'asset' && Buffer.compare(asset.source, bytes) === 0, name);
  }
  assert.equal(emitted.length, 2);
  // The fonts: fonts.css names public/ files, which the build reaches by a path from the stylesheet so Vite hashes them.
  const [fonts] = plugin.config({ root: ROOT }).css.postcss.plugins;
  const cssFile = path.join(ROOT, 'src', 'fonts.css');
  const css = readFileSync(cssFile, 'utf8');
  const declaration = value => ({ value, source: { input: { file: cssFile } } });
  const declarations = [...css.matchAll(/src: ([^;]+);/g)].map(match => declaration(match[1]));
  const elsewhere = { ...declaration("url('/fonts/archivo-latin-variable.woff2')"), source: { input: { file: path.join(ROOT, 'src', 'styles', 'x.css') } } };
  const other = declaration("url('/flags/fr.svg')");
  fonts.Once({ walkDecls: visit => [...declarations, elsewhere, other].forEach(visit) });
  assert.ok(declarations.length >= 4, `${declarations.length} fonts`);
  for (const { value } of declarations) {
    const url = value.match(/^url\('([^']+)'\) format\('woff2'\)$/)?.[1];
    assert.match(url ?? value, /^\.\.\/public\/fonts\/archivo-[\w-]+\.woff2$/);
    assert.ok(existsSync(path.resolve(ROOT, 'src', url)), url);
  }
  assert.equal(elsewhere.value, "url('../../public/fonts/archivo-latin-variable.woff2')", 'from the stylesheet that names it');
  assert.equal(other.value, "url('/flags/fr.svg')", 'only fonts');
});

test('offline, every navigation in scope gets the game, but opening a data file directly does not', () => {
  for (const url of ['/', '/index.html', '/?playtest', '/sub/', '/sub/index.html?playtest']) assert.equal(FILE_NAVIGATION.test(url), false, url);
  for (const url of ['/football/ea-fc-26.json', '/club-logos/b-boston-celtics.webp', '/flags-symbols/README.md', '/sub/domestic/826.json']) {
    assert.equal(FILE_NAVIGATION.test(url), true, url);
  }
});

// ---------- updates ----------

const { ErrorBoundary, UpdatePrompt, registerServiceWorker, applyUpdate, resetServiceWorker, cacheForOffline,
  keepCampaignMarks, runsInstalled, teamMarkUrls } = await bundleComponents({
  ErrorBoundary: 'src/components/ErrorBoundary.jsx',
  UpdatePrompt: 'src/components/UpdatePrompt.jsx',
  registerServiceWorker: ['src/serviceWorker.js', 'registerServiceWorker'],
  applyUpdate: ['src/serviceWorker.js', 'applyUpdate'],
  resetServiceWorker: ['src/serviceWorker.js', 'resetServiceWorker'],
  cacheForOffline: ['src/serviceWorker.js', 'cacheForOffline'],
  keepCampaignMarks: ['src/serviceWorker.js', 'keepCampaignMarks'],
  runsInstalled: ['src/serviceWorker.js', 'runsInstalled'],
  teamMarkUrls: ['src/data/teamMarks.js', 'teamMarkUrls'],
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

test('a long session looks for new versions every six hours', async () => {
  resetServiceWorker();
  const { env, registration } = browser({ controller: new Worker('activated') });
  await registerServiceWorker('./sw.js', env);
  assert.deepEqual(env.intervals.map(([, ms]) => ms), [6 * 60 * 60 * 1000]);
  env.intervals[0][0]();
  await flush();
  assert.equal(registration.updates, 1);
  // Coming straight back to the tab does not check again.
  env.document.dispatch('visibilitychange');
  await flush();
  assert.equal(registration.updates, 1);
});

// ---------- when the page registers the worker ----------

// A copy of serviceWorker.js of its own: the first boot's signal settles once per module.
const later = await bundleComponents({
  registerAfterBoot: ['src/serviceWorker.js', 'registerAfterBoot'],
  firstBoot: ['src/serviceWorker.js', 'firstBoot'],
  settleFirstBoot: ['src/serviceWorker.js', 'settleFirstBoot'],
  applyUpdate: ['src/serviceWorker.js', 'applyUpdate'],
  resetServiceWorker: ['src/serviceWorker.js', 'resetServiceWorker'],
});

/** browser(), with its timers and idle callbacks run by hand. `idle: false` has no requestIdleCallback, as Safari. */
function clocked({ idle = true, ...options } = {}) {
  const page = browser(options);
  const { env } = page;
  env.timers = [];
  env.setTimeout = (fn, ms) => env.timers.push({ fn, ms, cleared: false });
  env.clearTimeout = id => { if (env.timers[id - 1]) env.timers[id - 1].cleared = true; };
  env.idles = [];
  if (idle) env.requestIdleCallback = (fn, idleOptions) => env.idles.push({ fn, options: idleOptions });
  return page;
}
const never = new Promise(() => {});
// setImmediate, not a timer: syncAppFixture runs the page's timers on a manual clock.
const settled = promise => Promise.race([promise.then(() => true), new Promise(resolve => setImmediate(resolve, false))]);

test('main.jsx registers the worker through registerAfterBoot, in production builds only', () => {
  const main = readFileSync(path.join(ROOT, 'src/main.jsx'), 'utf8');
  assert.match(main, /^if \(import\.meta\.env\.PROD\) registerAfterBoot\(\)\.catch\(/m);
  assert.doesNotMatch(main, /registerServiceWorker/, 'never straight away: a first visit waits for boot');
});

test('a page a worker controls registers at once, so the update prompt and the crash screen\'s Reload work from the start', async () => {
  later.resetServiceWorker();
  const waiting = new Worker('installed');
  const { env, container } = clocked({ controller: new Worker('activated'), waiting });
  const registration = later.registerAfterBoot('./sw.js', env, never);
  assert.deepEqual(container.registered, [['./sw.js', { scope: './' }]], 'before boot is over, without waiting');
  assert.ok(await registration);
  assert.deepEqual([env.timers.length, env.idles.length], [0, 0]);
  assert.equal(later.applyUpdate(), true, 'Reload hands the page to the waiting version');
  assert.deepEqual(waiting.messages, [{ type: 'SKIP_WAITING' }]);
});

test('a first visit registers once App\'s first boot is over and the page is idle, so the precache leaves boot\'s downloads alone', async () => {
  later.resetServiceWorker();
  const { env, container } = clocked();
  assert.equal(await settled(later.firstBoot), false);
  const registration = later.registerAfterBoot('./sw.js', env);
  await flush();
  assert.equal(container.registered.length, 0, 'not while boot downloads the maps');
  assert.deepEqual(env.timers.map(timer => timer.ms), [10_000], 'a fallback, in case boot never settles');
  later.settleFirstBoot();
  later.settleFirstBoot(); // Try again after a failed boot: nothing more happens
  assert.equal(await settled(later.firstBoot), true);
  assert.equal(container.registered.length, 0, 'not before the page is idle');
  assert.ok(env.timers[0].cleared, 'the fallback is cancelled');
  assert.deepEqual(env.idles.map(idle => idle.options), [{ timeout: 2000 }]);
  env.idles[0].fn();
  assert.ok(await registration);
  assert.deepEqual(container.registered, [['./sw.js', { scope: './' }]]);
  assert.equal(env.timers.length, 1);
});

test('a browser whose service worker API throws still starts the game: registerAfterBoot rejects into main.jsx\'s catch', async () => {
  later.resetServiceWorker();
  // Chromium throws a SecurityError reading navigator.serviceWorker in sandboxed and opaque-origin documents. A throw
  // from main.jsx's registerAfterBoot() call would stop it before createRoot renders the game.
  const env = { navigator: { get serviceWorker() { throw new DOMException('Access to service workers is denied', 'SecurityError'); } } };
  let registration;
  assert.doesNotThrow(() => { registration = later.registerAfterBoot('./sw.js', env); });
  await assert.rejects(registration, { name: 'SecurityError' });
});

test('a boot that never settles still installs the worker after 10 seconds; without requestIdleCallback a short timer stands in', async () => {
  later.resetServiceWorker();
  const { env, container } = clocked({ idle: false });
  const registration = later.registerAfterBoot('./sw.js', env, never);
  await flush();
  assert.equal(container.registered.length, 0);
  env.timers[0].fn();
  assert.deepEqual(env.timers.map(timer => timer.ms), [10_000, 200]);
  assert.equal(container.registered.length, 0, 'not in the same moment');
  env.timers[1].fn();
  assert.ok(await registration);
  assert.deepEqual(container.registered, [['./sw.js', { scope: './' }]]);
});

test('App\'s boot settles the first-boot signal once setup is up, and when the maps fail to load', async () => {
  const world = readFileSync(publicFile('world-110m.v1.json'), 'utf8');
  const priorFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
  for (const fails of [false, true]) {
    // A bundle each, for a fresh signal.
    const { App, firstBoot } = await bundleComponents({ App: 'src/App.jsx', firstBoot: ['src/serviceWorker.js', 'firstBoot'] },
      { jsx: 'automatic' });
    Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true, value: async url => {
      if (fails) throw new TypeError('Failed to fetch');
      return String(url).endsWith('/world-110m.v1.json') ? { ok: true, json: async () => JSON.parse(world) } : { ok: false, status: 404 };
    } });
    const f = syncAppFixture({ App, phase: 'loading' });
    try {
      assert.equal(await settled(firstBoot), false);
      await App.prototype.boot.call(f.app);
      await f.app.seasonIndex;
      assert.deepEqual([f.app.state.phase, !!f.app.state.err], fails ? ['loading', true] : ['setup', false]);
      assert.equal(await settled(firstBoot), true, fails ? 'boot failed' : 'setup is up');
    } finally {
      f.close();
      Object.defineProperty(globalThis, 'fetch', priorFetch);
    }
  }
});

// ---------- a campaign's crests and flags, kept for offline play ----------

const football = getSport('football');
const clubsOf = (rows, sport = football) => Object.fromEntries(rows.map(row => [row.id, buildClub(row, sport)]));
const montenegro = () => decodeDomestic(JSON.parse(readFileSync(publicFile('domestic/499.json'), 'utf8'))).clubs;

test('a campaign keeps each team\'s crest or flag once, with the field and emblem the map draws a flag from', () => {
  // Clubs: Arsenal and Real Madrid share their domestic twins' crests; Union Berlin has only its monogram.
  const clubs = clubsOf(['f-arsenal', 'f-real-madrid', 'f-1-fc-union-berlin'].map(id => football.clubs.find(club => club.id === id)));
  assert.deepEqual(teamMarkUrls(clubs), ['/club-logos/d826-602.webp', '/club-logos/d724-1736.webp']);
  assert.deepEqual(teamMarkUrls({ old: { ...clubs['f-arsenal'], id: 'old' } }), ['/club-logos/d826-602.webp'], 'found by its origin');
  // Nations: France's flag; Portugal's, which the map lays out from a field and an emblem.
  const rng = makeRng(20261101);
  const nations = Object.fromEntries(['250', '620'].map(id => [id, buildTeam(id, rng, football)]));
  assert.deepEqual(teamMarkUrls(nations), ['/flags/fr.svg', '/flags/pt.svg', '/flags-symbols/pt-field.svg', '/flags-symbols/pt-symbol.svg']);
  // A country: Montenegro's 16 clubs, one of them without a crest.
  const rows = montenegro();
  const crests = rows.filter(row => existsSync(publicFile(`club-logos/${row.id}.webp`))).map(row => `/club-logos/${row.id}.webp`);
  assert.equal(crests.length, rows.length - 1);
  assert.deepEqual(teamMarkUrls(clubsOf(rows)), crests);
});

test('every crest and flag a campaign can keep is in public/, and the worker caches it on first use', () => {
  const rng = makeRng(1);
  const world = Object.fromEntries(fieldedNations(football).map(id => [id, buildTeam(id, rng, football)]));
  const urls = [teamMarkUrls(world), teamMarkUrls(clubsOf(montenegro())),
    ...['football', 'womens-football', 'basketball', 'american-football', 'baseball', 'hockey', 'rugby-league'].map(id => teamMarkUrls(clubsOf(getSport(id).clubs, getSport(id))))].flat();
  assert.ok(urls.some(url => url.startsWith('/flags-symbols/')) && urls.length > 300, `${urls.length} files`);
  for (const url of urls) {
    assert.ok(existsSync(publicFile(url.slice(1))), url);
    assert.ok(isRuntimeCached(`https://imperialism.test${url}`), url);
  }
});

test('cacheForOffline fetches through the worker a few at a time, once each, only what it caches and lacks, past errors', async () => {
  resetServiceWorker();
  const site = 'http://imperialism.test/';
  const { env } = browser({ controller: new Worker('activated') });
  env.navigator.onLine = true;
  let open = 0, most = 0;
  env.fetch = url => {
    env.fetched.push(url);
    most = Math.max(most, ++open);
    return new Promise((resolve, reject) => setTimeout(() => {
      open--;
      if (url.endsWith('gone.webp')) reject(new TypeError('Failed to fetch')); else resolve({ ok: true });
    }, 1));
  };
  // Shown online already, so in the worker's cache.
  env.caches = { match: async url => (url === `${site}flags/fr.svg` ? { ok: true } : undefined) };
  const crests = Array.from({ length: 10 }, (_, i) => `${site}club-logos/d826-${600 + i}.webp`);
  const result = cacheForOffline([`${site}club-logos/gone.webp`, ...crests, `${site}flags/fr.svg`, `${site}flags/pt.svg`,
    `${site}flags/pt.svg`, `${site}assets/index-abc123.js`, `${site}world-110m.v1.json`], env);
  assert.equal(await result, undefined, 'resolves past the failed fetch');
  assert.deepEqual(env.fetched.sort(), [`${site}club-logos/gone.webp`, ...crests, `${site}flags/pt.svg`].sort());
  assert.ok(most > 1 && most <= 4, `${most} at once`);
});

test('cacheForOffline does nothing without a worker or offline; before the first worker takes over, it waits for it', async () => {
  resetServiceWorker();
  const urls = ['/club-logos/d826-602.webp', '/flags/pt.svg', '/flags-symbols/pt-field.svg'];
  const bare = { navigator: {}, fetched: [], fetch(url) { bare.fetched.push(url); return Promise.resolve({ ok: true }); } };
  await cacheForOffline(urls, bare);
  assert.deepEqual(bare.fetched, [], 'no service workers');
  const offline = browser({ controller: new Worker('activated') }).env;
  offline.navigator.onLine = false;
  await cacheForOffline(urls, offline);
  assert.deepEqual(offline.fetched, [], 'offline');
  // A first visit: the campaign starts before the first worker controls the page.
  const loaded = 'http://imperialism.test/flags/de.svg';
  const { env, container, registration } = browser({ resources: [loaded] });
  await registerServiceWorker('./sw.js', env);
  await cacheForOffline(urls, env);
  assert.deepEqual(env.fetched, []);
  const first = new Worker('installing');
  registration.install(first);
  first.become('activated');
  container.controller = first;
  container.dispatch('controllerchange');
  await flush();
  assert.deepEqual(env.fetched.sort(), [loaded, ...urls].sort(), 'with what the page loaded before it took over');
});

/** matchMedia as a browser answers it, in the installed app's window or in a tab. */
const mediaOf = installed => query => ({ matches: installed && query === '(display-mode: standalone)', media: query,
  addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });

test('the installed app is the page in a window of its own: display-mode standalone, or an iPhone Home Screen app', () => {
  assert.equal(runsInstalled({ matchMedia: mediaOf(true), navigator: {} }), true);
  assert.equal(runsInstalled({ matchMedia: mediaOf(false), navigator: { standalone: true } }), true, 'iOS');
  assert.equal(runsInstalled({ matchMedia: mediaOf(false), navigator: { standalone: false } }), false, 'a tab');
  assert.equal(runsInstalled({ navigator: {} }), false, 'no matchMedia');
  assert.equal(runsInstalled({ matchMedia() { throw new TypeError('blocked'); }, navigator: {} }), false, 'never throws');
});

test('only the installed app keeps a campaign\'s crests and flags ahead of time; a tab fetches each when the game shows it', async () => {
  const urls = ['http://imperialism.test/club-logos/d826-602.webp', 'http://imperialism.test/flags/pt.svg'];
  for (const installed of [false, true]) {
    resetServiceWorker();
    const { env } = browser({ controller: new Worker('activated') });
    Object.assign(env, { matchMedia: mediaOf(installed), caches: { match: async () => undefined } });
    env.navigator.onLine = true;
    assert.equal(await keepCampaignMarks(urls, env), undefined);
    assert.deepEqual(env.fetched.sort(), installed ? urls : [], installed ? 'installed' : 'tab');
  }
});

test('launching or resuming a campaign online keeps all of its crests and flags in the installed app, none in a tab', async () => {
  await bundleApp();
  const fetched = [];
  const priorFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
  const priorMedia = Object.getOwnPropertyDescriptor(globalThis, 'matchMedia');
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { controller: {} } });
  Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true,
    value: async url => { fetched.push(url); return { ok: true }; } });
  // The fixture runs the page's timers on a manual clock.
  const settle = () => new Promise(resolve => setImmediate(resolve));
  const marks = ['/flags/fr.svg', '/flags/pt.svg', '/flags-symbols/pt-field.svg', '/flags-symbols/pt-symbol.svg', '/flags/gb-eng.svg'];
  try {
    for (const installed of [false, true]) {
      Object.defineProperty(globalThis, 'matchMedia', { configurable: true, writable: true, value: mediaOf(installed) });
      const expected = installed ? marks.slice().sort() : [];
      const f = syncAppFixture({ ids: ['250', '620', '826'] });
      try {
        f.app.startCampaign();
        await settle();
        assert.deepEqual(fetched.sort(), expected, installed ? 'launched in the installed app' : 'launched in a tab');
        fetched.length = 0;
        f.app.saved = loadSave();
        f.app.resume();
        await settle();
        assert.deepEqual(fetched.sort(), expected, installed ? 'resumed in the installed app' : 'resumed in a tab');
        fetched.length = 0;
      } finally {
        f.close();
      }
    }
  } finally {
    delete navigator.serviceWorker;
    Object.defineProperty(globalThis, 'fetch', priorFetch);
    if (priorMedia) Object.defineProperty(globalThis, 'matchMedia', priorMedia); else delete globalThis.matchMedia;
  }
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
