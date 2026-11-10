// Screens that fit (docs/design/compact-pass.md): the arithmetic of a flag wall, the pager, and the two hooks that measure
// a box and show one page of what fits in it. The hooks measure with a ResizeObserver, stubbed here, because jsdom has no
// layout: without one everything renders on a single page, which is what the rest of the suite reads.
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { bundleComponents, withDom } from './lib/app-harness.mjs';
import { fitWall, MIN_ROW_PX } from '../src/hooks/useFit.js';

const { createRoot } = await import('react-dom/client');
const { flushSync } = await import('react-dom');

const { Pager, usePagedList, useFitWall, SetupOverlay, TargetPanel, LedgerScreen, ChronicleScreen } = await bundleComponents({
  Pager: 'src/components/Pager.jsx',
  usePagedList: ['src/hooks/useFit.js', 'usePagedList'],
  useFitWall: ['src/hooks/useFit.js', 'useFitWall'],
  SetupOverlay: 'src/components/SetupOverlay.jsx',
  TargetPanel: 'src/screens/turns/TargetPanel.jsx',
  LedgerScreen: 'src/screens/ledger/LedgerScreen.jsx',
  ChronicleScreen: 'src/screens/ledger/ChronicleScreen.jsx',
});

const click = async element => { await act(async () => { element.click(); }); };

// ---------- fitWall ----------

/** Does the wall stay inside its box? A page of `pageSize` (or the whole field) laid out in `cols`, cells `cell` wide. */
function assertFits({ cols, cell, pageSize }, width, height, count, { ratio, gap }) {
  const shown = Number.isFinite(pageSize) ? Math.min(pageSize, count) : count;
  const rows = Math.ceil(shown / cols);
  const at = `${width}×${height}, ${count} cells: ${cols} cols of ${cell}`;
  assert.ok(cols * cell + gap * (cols - 1) <= width + 1e-6, `fits across (${at})`);
  // A page taller than the box is allowed only as a single row: a box too short for one row still shows something.
  if (rows > 1) assert.ok(rows * (cell / ratio) + gap * (rows - 1) <= height + 1e-6, `fits down (${at})`);
}

test('fitWall: never overflows, across every box and field size', () => {
  const walls = [{ ratio: 4 / 3, gap: 6, minCell: 34, maxCell: 104 }, { ratio: 1, gap: 6, minCell: 44, maxCell: 104 }, { ratio: 4 / 3, gap: 6, minCell: 32, maxCell: 56 }];
  for (const options of walls) {
    for (const width of [180, 320, 366, 391, 744, 1000, 1007, 1304]) {
      for (const height of [60, 140, 233, 400, 611, 900]) {
        for (const count of [1, 2, 7, 20, 32, 48, 173, 211]) {
          const wall = fitWall(width, height, count, options);
          assertFits(wall, width, height, count, options);
          assert.ok(wall.cell <= options.maxCell + 1e-9, 'held at maxCell');
          assert.ok(Number.isFinite(wall.pageSize) ? wall.pageSize >= 1 : true);
        }
      }
    }
  }
});

test('fitWall: the whole field fits when it can, at the largest cell that does', () => {
  const options = { ratio: 4 / 3, gap: 6, minCell: 34, maxCell: 200 };
  const wall = fitWall(1000, 600, 48, options);
  assert.equal(wall.pageSize, Infinity);
  assert.equal(wall.cols, 8);
  // One column fewer would not fit: the next larger cell overflows the height.
  const cell = (1000 - 6 * (wall.cols - 2)) / (wall.cols - 1);
  assert.ok(Math.ceil(48 / (wall.cols - 1)) * (cell / options.ratio) + 6 * (Math.ceil(48 / (wall.cols - 1)) - 1) > 600);
  assert.equal(wall.cell, (1000 - 6 * (wall.cols - 1)) / wall.cols, 'the cells fill the row');
});

test('fitWall: below minCell it pages at whole rows of cells', () => {
  const options = { ratio: 1, gap: 6, minCell: 44, maxCell: 104 };
  const wall = fitWall(366, 400, 211, options);
  assert.equal(wall.cols, 7);
  assert.ok(wall.cell >= 44, 'a touch target');
  assert.equal(wall.cell / options.ratio, wall.cell, 'and square, so it is one in both directions');
  // The rows come from the stretched cell, not from minCell: at 44 there would be 8 rows and the eighth would be clipped.
  const rows = Math.floor((400 + 6) / (wall.cell + 6));
  assert.equal(wall.pageSize, 7 * rows);
  assertFits(wall, 366, 400, 211, options);
});

test('fitWall: a small field stops growing at maxCell and spreads across the row instead', () => {
  const wall = fitWall(1000, 600, 4, { ratio: 4 / 3, gap: 6, minCell: 34, maxCell: 104 });
  assert.equal(wall.cell, 104);
  assert.equal(wall.pageSize, Infinity);
  assert.equal(wall.cols, 9, 'as many as fit across: the grid leaves the rest of the row empty');
});

test('fitWall: an unmeasurable box still pages rather than dividing by nothing', () => {
  const wall = fitWall(40, 10, 30, { ratio: 4 / 3, gap: 6, minCell: 34, maxCell: 104 });
  assert.equal(wall.cols, 1);
  assert.equal(wall.pageSize, 1);
});

// ---------- Pager ----------

test('Pager renders nothing for one page; its end buttons stay focusable and do nothing', async () => {
  await withDom(async ({ mount }) => {
    const turned = [];
    const view = await mount(Pager, { page: 0, pages: 1, onPage: page => turned.push(page), label: 'Nations pages' });
    assert.ok(!view.host.querySelector('.pager'));

    await view.render({ page: 0, pages: 3, onPage: page => turned.push(page), label: 'Nations pages' });
    const pager = view.host.querySelector('.pager');
    assert.equal(pager.getAttribute('role'), 'group');
    assert.equal(pager.getAttribute('aria-label'), 'Nations pages');
    assert.equal(pager.querySelector('.pager__pos').textContent, 'Page 1 /  of 3');
    const [previous, next] = pager.querySelectorAll('button');
    assert.equal(previous.getAttribute('aria-disabled'), 'true');
    assert.equal(previous.disabled, false, 'aria-disabled keeps the focus where a keyboard player left it');
    await click(previous);
    assert.deepEqual(turned, []);
    await click(next);
    assert.deepEqual(turned, [1]);

    await view.render({ page: 2, pages: 3, onPage: page => turned.push(page), label: 'Nations pages' });
    const last = view.host.querySelectorAll('.pager button');
    assert.equal(last[1].getAttribute('aria-disabled'), 'true');
    await click(last[1]);
    assert.deepEqual(turned, [1]);
    await click(last[0]);
    assert.deepEqual(turned, [1, 1]);
  });
});

// ---------- the hooks, with a stubbed ResizeObserver ----------

/** A ResizeObserver the test fires by hand, installed on the window the hooks read it from. */
function installObserver(window) {
  const observers = new Set();
  window.ResizeObserver = class {
    constructor(callback) { this.callback = callback; }
    observe() { observers.add(this); }
    disconnect() { observers.delete(this); }
  };
  return {
    observers,
    fire: () => act(async () => { for (const observer of observers) observer.callback([]); }),
  };
}

/** jsdom has no layout: give an element the box a browser would. */
function layOut(element, { width = 0, height = 0, top = 0, scrollHeight = height }) {
  Object.defineProperties(element, {
    clientWidth: { configurable: true, value: width },
    clientHeight: { configurable: true, value: height },
    // What the content would need: more than the box when it overflows.
    scrollHeight: { configurable: true, value: scrollHeight },
  });
  element.getBoundingClientRect = () => ({ width, height, top, bottom: top + height, left: 0, right: width });
}

const NAMES = Array.from({ length: 25 }, (_, i) => `Row ${i + 1}`);

function PagedList({ items, focusIndex = -1, minRows }) {
  const list = usePagedList(items, { row: 'li', focusIndex, minRows });
  return React.createElement(React.Fragment, null,
    React.createElement('ol', { ref: list.boxRef, className: 'box' },
      list.shown.map(item => React.createElement('li', { key: item }, item))),
    React.createElement('output', { className: 'meta' }, JSON.stringify({ page: list.page, pages: list.pages, pageSize: list.pageSize, start: list.start })),
    React.createElement('button', { type: 'button', className: 'turn', onClick: () => list.setPage(list.page + 1) }, 'next'),
  );
}

/** Lay the box out, with every row 30px tall and the first 10px below the box's top, then measure. */
async function measureList(view, stub, height) {
  const box = view.host.querySelector('.box');
  layOut(box, { width: 300, height, top: 0, scrollHeight: 10 + 30 * view.host.querySelectorAll('li').length });
  view.host.querySelectorAll('li').forEach(row => layOut(row, { width: 300, height: 30, top: 10 }));
  await stub.fire();
}

test('usePagedList: everything on one page until a box is measured, then as many rows as fit', async () => {
  await withDom(async ({ mount, window }) => {
    const unmeasured = await mount(PagedList, { items: NAMES });
    assert.equal(unmeasured.host.querySelectorAll('li').length, 25, 'no ResizeObserver: the whole list, as the DOM contracts read it');
    assert.deepEqual(JSON.parse(unmeasured.host.querySelector('.meta').textContent), { page: 0, pages: 1, pageSize: null, start: 0 });

    const stub = installObserver(window);
    const view = await mount(PagedList, { items: NAMES });
    await measureList(view, stub, 310);
    assert.equal(view.host.querySelectorAll('li').length, 10, '(310 − 10) / 30');
    assert.deepEqual(JSON.parse(view.host.querySelector('.meta').textContent), { page: 0, pages: 3, pageSize: 10, start: 0 });

    await click(view.host.querySelector('.turn'));
    assert.equal(view.host.querySelector('li').textContent, 'Row 11');
    // A window that grows shows more rows and clamps the page into the shorter list of pages.
    await click(view.host.querySelector('.turn'));
    await measureList(view, stub, 790);
    assert.deepEqual(JSON.parse(view.host.querySelector('.meta').textContent), { page: 0, pages: 1, pageSize: 26, start: 0 });
    assert.equal(view.host.querySelectorAll('li').length, 25);
  });
});

test('usePagedList: the focused row’s page comes into view, and turning the page afterwards is not undone', async () => {
  await withDom(async ({ mount, window }) => {
    const stub = installObserver(window);
    const view = await mount(PagedList, { items: NAMES, focusIndex: 14 });
    await measureList(view, stub, 310);
    assert.equal(JSON.parse(view.host.querySelector('.meta').textContent).page, 1, 'row 15 is on the second page of ten');
    assert.equal(view.host.querySelector('li').textContent, 'Row 11');
    await click(view.host.querySelector('.turn'));
    assert.equal(JSON.parse(view.host.querySelector('.meta').textContent).page, 2, 'the player can leave it');
    await view.render({ items: NAMES, focusIndex: 3 });
    assert.equal(JSON.parse(view.host.querySelector('.meta').textContent).page, 0, 'a new focus brings its page back');
  });
});

test('usePagedList: a list with no rows yet is measured when they arrive; minRows is a floor', async () => {
  await withDom(async ({ mount, window }) => {
    const stub = installObserver(window);
    const view = await mount(PagedList, { items: [], minRows: 3 });
    await measureList(view, stub, 40);
    assert.deepEqual(JSON.parse(view.host.querySelector('.meta').textContent).pageSize, null, 'no rows to measure');
    await view.render({ items: NAMES, minRows: 3 });
    await measureList(view, stub, 40);
    assert.equal(JSON.parse(view.host.querySelector('.meta').textContent).pageSize, 3, 'room for one, but never fewer than minRows');
  });
});

test('usePagedList: a box its own rows size keeps every row, even with one row a rule taller than the rest', async () => {
  await withDom(async ({ mount, window }) => {
    const stub = installObserver(window);
    const view = await mount(PagedList, { items: NAMES.slice(0, 5) });
    // A table in a column ("Your fronts"): the first row 30px, the rest 31 with their top rule, and the box exactly as
    // tall as they are, so nothing overflows.
    view.host.querySelectorAll('li').forEach((row, i) => layOut(row, { width: 300, height: i ? 31 : 30, top: i ? 30 + (i - 1) * 31 : 0 }));
    layOut(view.host.querySelector('.box'), { width: 300, height: 154, top: 0 });
    await stub.fire();
    await stub.fire();
    assert.equal(view.host.querySelectorAll('li').length, 5, 'not floor(154.5 / 31) = 4, then 3, a row at each measure');
    assert.equal(JSON.parse(view.host.querySelector('.meta').textContent).pages, 1);
  });
});

/** A list whose pager sits inside its box, above the rows (the match lineups): it pushes the rows down. */
function PagedWithPager({ items }) {
  const list = usePagedList(items, { row: 'li' });
  return React.createElement('div', { ref: list.boxRef, className: 'box' },
    list.pages > 1 ? React.createElement('p', { className: 'in-box-pager' }, `${list.page + 1} / ${list.pages}`) : null,
    React.createElement('ol', null, list.shown.map(item => React.createElement('li', { key: item }, item))),
    React.createElement('output', { className: 'meta' }, JSON.stringify({ pages: list.pages, pageSize: list.pageSize })));
}

test('usePagedList: a pager that appears inside the box is measured around, so the last row is never cut off', async () => {
  await withDom(async ({ mount, window }) => {
    const stub = installObserver(window);
    // Rows are 30px; the first sits 10px down, or 54px once the pager takes its row. The box never changes size.
    window.HTMLLIElement.prototype.getBoundingClientRect = function () {
      const top = this.closest('.box')?.querySelector('.in-box-pager') ? 54 : 10;
      return { top, height: 30, bottom: top + 30, width: 300, left: 0, right: 300 };
    };
    const view = await mount(PagedWithPager, { items: NAMES });
    layOut(view.host.querySelector('.box'), { width: 300, height: 310, top: 0, scrollHeight: 10 + 30 * NAMES.length });
    await stub.fire();
    assert.deepEqual(JSON.parse(view.host.querySelector('.meta').textContent), { pages: 4, pageSize: 8 }, '(310 − 54) / 30, not (310 − 10) / 30');
    assert.equal(view.host.querySelector('.in-box-pager').textContent, '1 / 4');
    delete window.HTMLLIElement.prototype.getBoundingClientRect;
  });
});

function Wall({ count, options }) {
  const wall = useFitWall(count, options);
  return React.createElement('div', { ref: wall.boxRef, className: 'wall', style: wall.style, 'data-measured': wall.measured || undefined },
    React.createElement('output', { className: 'meta' }, JSON.stringify({ page: wall.page, pages: wall.pages, pageSize: wall.pageSize, start: wall.start, pageFor: wall.pageFor(count - 1) })));
}

test('useFitWall: measures its box, publishes the cell and uses the touch options under a finger', async () => {
  await withDom(async ({ mount, window }) => {
    const stub = installObserver(window);
    const options = { ratio: 4 / 3, gap: 6, minCell: 34, maxCell: 104, touch: { ratio: 1, minCell: 44 } };
    const view = await mount(Wall, { count: 211, options });
    const wall = view.host.querySelector('.wall');
    assert.equal(wall.getAttribute('data-measured'), null);
    layOut(wall, { width: 366, height: 400 });
    await stub.fire();
    assert.equal(wall.getAttribute('data-measured'), 'true');
    assert.equal(wall.style.getPropertyValue('--wall-cols'), '9');
    assert.equal(Number(wall.style.getPropertyValue('--wall-ratio')), 4 / 3);
    const fine = JSON.parse(view.host.querySelector('.meta').textContent);
    assert.equal(fine.pageFor, Math.floor(210 / fine.pageSize), 'pageFor finds the last team');

    window.matchMedia = query => ({ matches: /pointer:coarse/.test(query) });
    const touch = await mount(Wall, { count: 211, options });
    const touchWall = touch.host.querySelector('.wall');
    layOut(touchWall, { width: 366, height: 400 });
    await stub.fire();
    assert.equal(touchWall.style.getPropertyValue('--wall-cols'), '7');
    assert.equal(Number(touchWall.style.getPropertyValue('--wall-ratio')), 1);
    assert.ok(parseFloat(touchWall.style.getPropertyValue('--wall-cell')) >= 44, 'a 44px square target');
    delete window.matchMedia;
  });
});

// ---------- the team wall ----------

const SETUP = {
  sport: 'football', layer: 'nations', scope: 'UEFA', clubScope: 'all', pacing: 'duel', resolution: 'ticker', preset: 'standard',
  seed: '', uncertainty: 'balanced', express: false, finale: 'single', role: 'manager', acquisitionPolicy: 'highest-rated',
  rosterPreset: 'authentic', turnOrder: 'random', targeting: 'compass', dataSet: null,
};
// Strongest first, the order the wall reads.
const TEAMS = Array.from({ length: 30 }, (_, i) => ({ id: `t${i}`, name: i === 22 ? 'Malta' : `Team ${String.fromCharCode(65 + i % 26)}${i}`, rating: 90 - i * .5 }));

test('the team wall pages, and the keyboard walks it across its pages', async () => {
  await withDom(async ({ mount, window }) => {
    const stub = installObserver(window);
    const picks = [];
    const props = managedTeamId => ({
      setup: { ...SETUP, managedTeamId }, managerTeams: TEAMS, initialStep: 3,
      onPick: (key, value) => { if (key === 'managedTeamId') picks.push(value); },
    });
    const view = await mount(SetupOverlay, props('t0'));
    const box = view.host.querySelector('.setup-teams');
    assert.equal(box.querySelectorAll('.setup-team').length, 30, 'not measured yet: the whole field');
    // 342 × 100: eight cells across and three rows, so 24 of the 30 on the first page.
    layOut(box, { width: 342, height: 100 });
    await stub.fire();
    const flags = () => [...box.querySelectorAll('.setup-team')];
    const pos = () => view.host.querySelector('.setup-teams__pager .pager__pos').textContent;
    assert.equal(box.getAttribute('data-measured'), 'true');
    assert.equal(flags().length, 24);
    assert.equal(pos(), 'Page 1 /  of 2');
    assert.equal(flags()[0].getAttribute('aria-checked'), 'true');
    assert.equal(flags().filter(flag => flag.tabIndex === 0).length, 1, 'one tab stop');

    // End goes to the last team, on the last page, and the wall follows with the focus.
    const press = key => act(async () => {
      document.activeElement.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    });
    flags()[0].focus();
    await press('End');
    assert.deepEqual(picks, ['t29']);
    await view.render(props('t29'));
    assert.equal(pos(), 'Page 2 /  of 2');
    assert.equal(document.activeElement.dataset.name, TEAMS[29].name, 'focus moved to the new team’s flag');

    // Arrows wrap around the whole field, not the page.
    await press('ArrowRight');
    assert.equal(picks.at(-1), 't0');
    await view.render(props('t0'));
    assert.equal(pos(), 'Page 1 /  of 2');
    assert.equal(document.activeElement.dataset.name, TEAMS[0].name);
    await press('ArrowLeft');
    assert.equal(picks.at(-1), 't29');
    await view.render(props('t29'));
    await press('Home');
    assert.equal(picks.at(-1), 't0');
    await view.render(props('t0'));

    // Type-ahead finds a team on a page that is not showing.
    await press('m');
    assert.equal(picks.at(-1), 't22');
    await view.render(props('t22'));
    assert.equal(document.activeElement.dataset.name, 'Malta');

    // The pager only turns the pages: the checked team stays checked, and no flag takes a second tab stop.
    const next = view.host.querySelector('.setup-teams__pager [aria-label="Next page"]');
    const before = picks.length;
    await click(next);
    assert.equal(picks.length, before);
    assert.equal(pos(), 'Page 2 /  of 2');
    assert.equal(flags().filter(flag => flag.tabIndex === 0).length, 1, 'the checked team is off this page, so the first flag is the tab stop');
  });
});

// ---------- the target list ----------

const TARGETS = Array.from({ length: 6 }, (_, i) => ({
  teamId: `t${i}`, name: `Target ${i}`, eff: '70.0', spoils: '+1', win: `${90 - i}%`, tone: 'win', flagId: null, code: `T${i}`,
  color: '#888888', isClub: false,
}));

test('the target list pages what the column cannot hold, and the keyboard walks it across its pages', async () => {
  await withDom(async ({ mount, window }) => {
    const stub = installObserver(window);
    const selects = [];
    const props = selectedId => ({ count: '6 neighbours in reach', rows: TARGETS, selectedId, onSelect: id => selects.push(id) });
    const view = await mount(TargetPanel, props('t0'));
    const panel = view.host.querySelector('.target-panel');
    const radios = () => [...panel.querySelectorAll('[role="radio"]')];
    assert.equal(radios().length, 6, 'not measured yet: every target');
    assert.ok(!panel.querySelector('.pager'), 'and no pager');
    // 44px rows, the first 10px down a 150px box: three to a page.
    layOut(panel.querySelector('.target-panel__rows'), { width: 320, height: 150, top: 0, scrollHeight: 10 + 44 * TARGETS.length });
    radios().forEach(row => layOut(row, { width: 320, height: 44, top: 10 }));
    await stub.fire();
    const pos = () => panel.querySelector('.target-panel__pager .pager__pos').textContent;
    assert.deepEqual(radios().map(row => row.dataset.teamId), ['t0', 't1', 't2']);
    assert.equal(pos(), 'Page 1 /  of 2');
    assert.ok(!!panel.querySelector('.target-panel__head > .target-panel__pager'), 'the pager sits in the head row');
    assert.deepEqual(radios().map(row => [row.getAttribute('aria-posinset'), row.getAttribute('aria-setsize')]), [['1', '6'], ['2', '6'], ['3', '6']]);
    assert.deepEqual(radios().map(row => row.tabIndex), [0, -1, -1]);

    const press = key => act(async () => {
      document.activeElement.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    });
    radios()[0].focus();
    // End selects the last target; once App selects it, its page shows and it has the focus.
    await press('End');
    assert.deepEqual(selects, ['t5']);
    await view.render(props('t5'));
    assert.equal(pos(), 'Page 2 /  of 2');
    assert.deepEqual(radios().map(row => row.dataset.teamId), ['t3', 't4', 't5']);
    assert.equal(document.activeElement.dataset.teamId, 't5');
    // The arrows wrap around the whole list, not the page.
    await press('ArrowDown');
    assert.equal(selects.at(-1), 't0');
    await view.render(props('t0'));
    assert.equal(pos(), 'Page 1 /  of 2');
    assert.equal(document.activeElement.dataset.teamId, 't0');
    await press('ArrowUp');
    assert.equal(selects.at(-1), 't5');
    await view.render(props('t5'));
    assert.equal(document.activeElement.dataset.teamId, 't5');
    // A target picked on the map brings its page into view.
    await view.render(props('t1'));
    assert.equal(pos(), 'Page 1 /  of 2');
    assert.equal(radios().find(row => row.getAttribute('aria-checked') === 'true')?.dataset.teamId, 't1');

    // The pager only turns the pages: the selection stays, and the first row shown keeps the group's one tab stop.
    const before = selects.length;
    await click(panel.querySelector('.target-panel__pager [aria-label="Next page"]'));
    assert.equal(selects.length, before);
    assert.equal(pos(), 'Page 2 /  of 2');
    assert.ok(!radios().some(row => row.getAttribute('aria-checked') === 'true'), 'the selected target is on the other page');
    assert.deepEqual(radios().map(row => row.tabIndex), [0, -1, -1]);
  });
});

// ---------- before the first measure: a window of rows ----------

/** A screen of `width` × `height` CSS px, the bound of the rows a list renders before it has measured its box. */
function screenOf(window, { width, height }) {
  Object.defineProperty(window.screen, 'width', { configurable: true, value: width });
  Object.defineProperty(window.screen, 'height', { configurable: true, value: height });
}

const MANY = Array.from({ length: 191 }, (_, i) => `Team ${i + 1}`);
const rowTexts = view => [...view.host.querySelectorAll('li')].map(li => li.textContent);
const metaOf = view => JSON.parse(view.host.querySelector('.meta').textContent);

/** A box with a height of its own (`room` px), rows 30px from 10px down: with every row it would overflow too. */
async function measureOwnBox(view, stub, room) {
  const rendered = view.host.querySelectorAll('li').length;
  layOut(view.host.querySelector('.box'), { width: 300, height: room, top: 0, scrollHeight: Math.max(room, 10 + 30 * rendered) });
  view.host.querySelectorAll('li').forEach(row => layOut(row, { width: 300, height: 30, top: 10 }));
  await stub.fire();
}

test('held back: a list longer than the screen renders a window of rows first, and pages exactly as with every row', async () => {
  await withDom(async ({ mount, window }) => {
    const stub = installObserver(window);
    // The screen's longer side bounds the window: 600 / 24 + 1 = 26 rows, whichever way the screen is turned.
    assert.equal(MIN_ROW_PX, 24);
    screenOf(window, { width: 400, height: 600 });
    const view = await mount(PagedList, { items: MANY });
    assert.equal(view.host.querySelectorAll('li').length, 26, '26 of 191 rows before the box is measured');
    assert.deepEqual(metaOf(view), { page: 0, pages: 1, pageSize: null, start: 0 }, 'the page size is not measured yet');
    await measureOwnBox(view, stub, 500);
    assert.deepEqual(metaOf(view), { page: 0, pages: 12, pageSize: 16, start: 0 }, '(500 − 10) / 30 = 16, as with all 191 rows');
    assert.equal(view.host.querySelectorAll('li').length, 16);
    assert.equal(rowTexts(view)[0], 'Team 1');

    screenOf(window, { width: 600, height: 400 });
    const turned = await mount(PagedList, { items: MANY });
    assert.equal(turned.host.querySelectorAll('li').length, 26, 'a landscape screen: its width is the longer side');
  });
});

test('held back: the focused row is in the first render and its page is the first one shown', async () => {
  await withDom(async ({ mount, window }) => {
    const stub = installObserver(window);
    screenOf(window, { width: 400, height: 600 });
    const view = await mount(PagedList, { items: MANY, focusIndex: 150 });
    const first = rowTexts(view);
    assert.equal(first.length, 26);
    assert.ok(first.includes('Team 151'), 'your row is rendered before the measure, so it can hold the focus');
    await measureOwnBox(view, stub, 500);
    assert.deepEqual(metaOf(view), { page: 9, pages: 12, pageSize: 16, start: 144 }, 'page 10 holds row 151');
    assert.ok(rowTexts(view).includes('Team 151'));
  });
});

test('held back near the end: the window still holds a whole window of rows, so the box overflows', async () => {
  await withDom(async ({ mount, window }) => {
    const stub = installObserver(window);
    screenOf(window, { width: 400, height: 600 });
    const view = await mount(PagedList, { items: MANY, focusIndex: 189 });
    const first = rowTexts(view);
    assert.equal(first.length, 26, 'rows 166–191, not the 2 from 190 on');
    assert.equal(first[0], 'Team 166');
    await measureOwnBox(view, stub, 500);
    assert.deepEqual(metaOf(view), { page: 11, pages: 12, pageSize: 16, start: 176 });
  });
});

test('held back in a box its rows size: every row is rendered and kept, as before', async () => {
  await withDom(async ({ mount, window }) => {
    const stub = installObserver(window);
    screenOf(window, { width: 200, height: 300 }); // 300 / 24 → 13, + 1: 14 rows held back
    const view = await mount(PagedList, { items: NAMES });
    assert.equal(view.host.querySelectorAll('li').length, 14);
    // The box wraps its rows: as tall as they are, never overflowing.
    const wrap = async () => {
      const rows = view.host.querySelectorAll('li');
      layOut(view.host.querySelector('.box'), { width: 300, height: 10 + 30 * rows.length, top: 0 });
      rows.forEach(row => layOut(row, { width: 300, height: 30, top: 10 }));
      await stub.fire();
    };
    await wrap();
    assert.equal(view.host.querySelectorAll('li').length, 25, 'nothing overflowed: a box its rows size gets them all');
    await wrap();
    assert.deepEqual(metaOf(view), { page: 0, pages: 1, pageSize: 25, start: 0 });
  });
});

test('held back without anything to measure: every row on one page', async () => {
  await withDom(async ({ mount, window }) => {
    screenOf(window, { width: 200, height: 300 });
    // A ResizeObserver when the first render sizes its window of rows, and none by the time the box would be measured.
    let reads = 0;
    Object.defineProperty(window, 'ResizeObserver', { configurable: true, get: () => (reads++ === 0 ? class { observe() {} disconnect() {} } : undefined) });
    const view = await mount(PagedList, { items: NAMES });
    assert.equal(view.host.querySelectorAll('li').length, 25, 'nothing will measure the box: the window of rows is lifted');
    assert.ok(reads >= 2, 'the attach looked for an observer again');
    delete window.ResizeObserver;
  });
});

test('a NaN focus is no focus: no render loop, and the window starts at the first row', async () => {
  await withDom(async ({ mount, window }) => {
    const stub = installObserver(window);
    const view = await mount(PagedList, { items: NAMES, focusIndex: NaN });
    assert.equal(view.host.querySelectorAll('li').length, 25);
    await measureList(view, stub, 310);
    assert.deepEqual(metaOf(view), { page: 0, pages: 3, pageSize: 10, start: 0 });
    await view.render({ items: NAMES, focusIndex: NaN });
    assert.equal(metaOf(view).page, 0);

    screenOf(window, { width: 400, height: 600 });
    const held = await mount(PagedList, { items: MANY, focusIndex: NaN });
    assert.equal(rowTexts(held).length, 26);
    assert.equal(rowTexts(held)[0], 'Team 1');
  });
});

test('a focused last page of one row keeps the page size measured with more rows: no row clipped, no measure loop', async () => {
  await withDom(async ({ mount, window }) => {
    const stub = installObserver(window);
    // A 640px box of 26px rows, the first a rule shorter (no top border), as the standings' are: 24 to a page, so the
    // 25th row, the focused one, is alone on page 2. Measured alone, that 25px row would make room for 25, which do not fit.
    const restore = stubLayout(window, [
      { selector: '.box', clientHeight: () => 640, scrollHeight: el => 10 + 26 * el.children.length,
        rect: () => ({ top: 0, bottom: 640, height: 640, left: 0, right: 300, width: 300 }) },
      { selector: 'li', rect: el => {
        const index = [...el.parentNode.children].indexOf(el);
        const top = 10 + index * 26 - (index ? 1 : 0), height = index ? 26 : 25;
        return { top, bottom: top + height, height, left: 0, right: 300, width: 300 };
      } },
    ]);
    // Every page size the list renders with, in order: a 25 would be a frame with the last row cut off.
    const sizes = [];
    function Logged(props) {
      const list = usePagedList(props.items, { row: 'li', focusIndex: props.focusIndex });
      sizes.push(list.pageSize);
      return React.createElement(React.Fragment, null,
        React.createElement('ol', { ref: list.boxRef, className: 'box' }, list.shown.map(item => React.createElement('li', { key: item }, item))),
        React.createElement('output', { className: 'meta' }, JSON.stringify({ page: list.page, pages: list.pages, pageSize: list.pageSize, start: list.start })));
    }
    try {
      const view = await mount(Logged, { items: NAMES, focusIndex: 24 });
      assert.deepEqual(metaOf(view), { page: 1, pages: 2, pageSize: 24, start: 24 });
      assert.deepEqual(rowTexts(view), ['Row 25']);
      // The observer reports after each new observe() (its first notification) and on every resize.
      await stub.fire();
      await stub.fire();
      assert.deepEqual(metaOf(view), { page: 1, pages: 2, pageSize: 24, start: 24 });
      assert.deepEqual([...new Set(sizes)], [Infinity, 24], 'never a page of 25, never a measure that flips back and forth');
    } finally {
      restore();
    }
  });
});

test('a lone row resized across a breakpoint is paged by the new width’s rows, not by the old, taller ones', async () => {
  await withDom(async ({ mount, window }) => {
    const stub = installObserver(window);
    // A phone's 44px rows in a 150px box, the first a rule shorter: three to a page, so the 25th row, the focused one, is
    // alone on page 9. The window then widens past the breakpoint: a 360px box 195px tall, of 30px rows.
    let row = 44, room = 150, width = 300;
    const restore = stubLayout(window, [
      { selector: '.box', clientWidth: () => width, clientHeight: () => room, scrollHeight: el => 10 + row * el.children.length,
        rect: () => ({ top: 0, bottom: room, height: room, left: 0, right: width, width }) },
      { selector: 'li', rect: el => {
        const index = [...el.parentNode.children].indexOf(el);
        const top = 10 + index * row - (index ? 1 : 0), height = index ? row : row - 1;
        return { top, bottom: top + height, height, left: 0, right: width, width };
      } },
    ]);
    try {
      const view = await mount(PagedList, { items: NAMES, focusIndex: 24 });
      assert.deepEqual(metaOf(view), { page: 8, pages: 9, pageSize: 3, start: 24 });
      assert.deepEqual(rowTexts(view), ['Row 25']);
      row = 30; room = 195; width = 360;
      await stub.fire();
      // (195 − 10) / 30: six to a page, as with the rows the new width draws; the old 44px rows would have left four.
      assert.deepEqual(metaOf(view), { page: 4, pages: 5, pageSize: 6, start: 24 });
      assert.deepEqual(rowTexts(view), ['Row 25']);
    } finally {
      restore();
    }
  });
});

// ---------- measured before the browser paints ----------

/**
 * Layout a browser would give, installed on the prototypes before the first commit, since the hooks now measure inside
 * it: `boxes` = [{ selector, clientWidth?, clientHeight?, scrollHeight?, rect? }], each a function of the element.
 * Elements matching none measure 0. → restore()
 */
function stubLayout(window, boxes) {
  const proto = window.HTMLElement.prototype;
  const pick = element => boxes.find(entry => element.matches?.(entry.selector));
  const keys = ['clientWidth', 'clientHeight', 'scrollHeight'];
  const saved = keys.map(key => [key, Object.getOwnPropertyDescriptor(proto, key)]);
  for (const key of keys) {
    Object.defineProperty(proto, key, { configurable: true, get() { return pick(this)?.[key]?.(this) ?? 0; } });
  }
  proto.getBoundingClientRect = function () {
    return pick(this)?.rect?.(this) ?? { top: 0, bottom: 0, height: 0, width: 0, left: 0, right: 0 };
  };
  return () => {
    for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(proto, key, descriptor); else delete proto[key]; }
    delete proto.getBoundingClientRect;
  };
}

/**
 * Render `element` the way a click's update is rendered: synchronously, with no act() to flush what it leaves for later.
 * `look()` reads the screen when the synchronous render returns (what the browser paints first) and again once every
 * task the render scheduled has run. → { first, settled }
 */
async function renderSynchronously(document, element, look) {
  const acting = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = false;
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    flushSync(() => root.render(element));
    const first = look(host);
    await new Promise(resolve => { setTimeout(resolve, 60); });
    return { first, settled: look(host) };
  } finally {
    flushSync(() => root.unmount());
    host.remove();
    globalThis.IS_REACT_ACT_ENVIRONMENT = acting;
  }
}

test('usePagedList: a list laid out when it mounts is paged before the synchronous render returns', async () => {
  await withDom(async ({ window, document }) => {
    window.ResizeObserver = class { observe() {} disconnect() {} };
    // A 310px box, rows 30px tall from 10px down: (310 − 10) / 30 = 10 rows.
    const restore = stubLayout(window, [
      { selector: '.box', clientHeight: () => 310, scrollHeight: el => 10 + 30 * el.children.length,
        rect: () => ({ top: 0, bottom: 310, height: 310, left: 0, right: 300, width: 300 }) },
      { selector: 'li', clientHeight: () => 30, rect: () => ({ top: 10, bottom: 40, height: 30, left: 0, right: 300, width: 300 }) },
    ]);
    try {
      const { first, settled } = await renderSynchronously(document, React.createElement(PagedList, { items: NAMES }),
        host => `${host.querySelectorAll('li').length} rows · ${host.querySelector('.meta').textContent}`);
      assert.equal(first, '10 rows · {"page":0,"pages":3,"pageSize":10,"start":0}', 'no frame of every row before the page');
      assert.equal(settled, first);
    } finally {
      restore();
    }
  });
});

test('a preselected target on page 2 is on show from the first frame and keeps the focus TargetPanel gives it', async () => {
  await withDom(async ({ window, document }) => {
    window.ResizeObserver = class { observe() {} disconnect() {} };
    // 44px rows, the first 10px down a 150px box: three to a page, so t5 is on page 2.
    const restore = stubLayout(window, [
      { selector: '.target-panel__rows', clientWidth: () => 320, clientHeight: () => 150, scrollHeight: el => 10 + 44 * el.children.length,
        rect: () => ({ top: 0, bottom: 150, height: 150, width: 320, left: 0, right: 320 }) },
      { selector: '.target-panel__row', clientWidth: () => 320, clientHeight: () => 44, scrollHeight: () => 44,
        rect: () => ({ top: 10, bottom: 54, height: 44, width: 320, left: 0, right: 320 }) },
    ]);
    try {
      const props = { count: '6 neighbours in reach', rows: TARGETS, selectedId: 't5', onSelect: () => {} };
      const look = host => {
        const shown = [...host.querySelectorAll('[role="radio"]')].map(row => row.dataset.teamId).join(',');
        return `${shown} · focus ${document.activeElement?.dataset?.teamId || document.activeElement?.tagName}`;
      };
      const { first, settled } = await renderSynchronously(document, React.createElement(TargetPanel, props), look);
      assert.equal(first, 't3,t4,t5 · focus t5', 'its page first, and the row the panel focused on mount is still the one shown');
      assert.equal(settled, 't3,t4,t5 · focus t5', 'never unmounted by a page 1 shown in between');
    } finally {
      restore();
    }
  });
});

test('the team wall opens on the checked team’s page in the first frame', async () => {
  await withDom(async ({ window, document }) => {
    window.ResizeObserver = class { observe() {} disconnect() {} };
    // 342 × 100: eight cells across and three rows, 24 to a page, so the 30th team is on page 2.
    const restore = stubLayout(window, [{ selector: '.setup-teams', clientWidth: () => 342, clientHeight: () => 100, scrollHeight: () => 100 }]);
    try {
      const props = { setup: { ...SETUP, managedTeamId: 't29' }, managerTeams: TEAMS, initialStep: 3, onPick: () => {} };
      const look = host => {
        const pos = host.querySelector('.setup-teams__pager .pager__pos')?.textContent || 'no pager';
        return `${pos} · ${host.querySelectorAll('.setup-team').length} cells · ${host.querySelector('.setup-team[aria-checked="true"]')?.dataset.name}`;
      };
      const { first, settled } = await renderSynchronously(document, React.createElement(SetupOverlay, props), look);
      assert.equal(first, `Page 2 /  of 2 · 6 cells · ${TEAMS[29].name}`, 'no frame of the whole field, nor of page 1');
      assert.equal(settled, first);
    } finally {
      restore();
    }
  });
});

test('the team wall follows a new page size back to the checked team, and a page turn alone is not undone', async () => {
  await withDom(async ({ mount, window }) => {
    const stub = installObserver(window);
    const props = { setup: { ...SETUP, managedTeamId: 't29' }, managerTeams: TEAMS, initialStep: 3, onPick: () => {} };
    const view = await mount(SetupOverlay, props);
    const box = view.host.querySelector('.setup-teams');
    const pos = () => view.host.querySelector('.setup-teams__pager .pager__pos').textContent;
    layOut(box, { width: 342, height: 100 });
    await stub.fire();
    assert.equal(pos(), 'Page 2 /  of 2');
    await click(view.host.querySelector('.setup-teams__pager [aria-label="Previous page"]'));
    assert.equal(pos(), 'Page 1 /  of 2');
    await view.render({ ...props });
    assert.equal(pos(), 'Page 1 /  of 2', 'a render with the same checked team keeps the page the player turned to');
    // A shorter box: one row of eight a page, and the checked team's page again.
    layOut(box, { width: 342, height: 60 });
    await stub.fire();
    assert.equal(pos(), 'Page 4 /  of 4');
    assert.equal(box.querySelector('.setup-team[aria-checked="true"]')?.dataset.name, TEAMS[29].name);
  });
});

// ---------- measureKey: a box shown by a switch is measured in that commit ----------

function KeyedList({ items, measureKey }) {
  const list = usePagedList(items, { row: 'li', measureKey });
  return React.createElement(React.Fragment, null,
    React.createElement('ol', { ref: list.boxRef, className: 'box' }, list.shown.map(item => React.createElement('li', { key: item }, item))),
    React.createElement('output', { className: 'meta' }, JSON.stringify({ page: list.page, pages: list.pages, pageSize: list.pageSize, start: list.start })));
}

test('usePagedList and useFitWall: a new measureKey measures a box the switch shows, before its observer reports', async () => {
  await withDom(async ({ mount, window }) => {
    installObserver(window);
    // Hidden when it mounts (display:none measures 0), so nothing is measured.
    const list = await mount(KeyedList, { items: NAMES, measureKey: 'hidden' });
    assert.equal(list.host.querySelectorAll('li').length, 25);
    // The switch shows it: the browser lays it out in the commit that changes the key. The observer never reports here.
    layOut(list.host.querySelector('.box'), { width: 300, height: 310, top: 0, scrollHeight: 10 + 30 * NAMES.length });
    list.host.querySelectorAll('li').forEach(row => layOut(row, { width: 300, height: 30, top: 10 }));
    await list.render({ items: NAMES, measureKey: 'shown' });
    assert.deepEqual(metaOf(list), { page: 0, pages: 3, pageSize: 10, start: 0 });
    assert.equal(list.host.querySelectorAll('li').length, 10);

    const options = { ratio: 4 / 3, gap: 6, minCell: 34, maxCell: 104 };
    const wall = await mount(Wall, { count: 211, options: { ...options, measureKey: 'hidden' } });
    const box = wall.host.querySelector('.wall');
    assert.equal(box.getAttribute('data-measured'), null);
    layOut(box, { width: 366, height: 400 });
    await wall.render({ count: 211, options: { ...options, measureKey: 'shown' } });
    assert.equal(box.getAttribute('data-measured'), 'true');
    assert.equal(box.style.getPropertyValue('--wall-cols'), '9');
  });
});

test('setup step 3 measures its wall in the commit that shows it, on the checked team’s page', async () => {
  await withDom(async ({ mount, window }) => {
    installObserver(window);
    const props = { setup: { ...SETUP, managedTeamId: 't29' }, managerTeams: TEAMS, initialStep: 2, onPick: () => {} };
    const view = await mount(SetupOverlay, props);
    const box = view.host.querySelector('.setup-teams');
    assert.equal(box.querySelectorAll('.setup-team').length, 30, 'hidden on step 2: not measured, the whole field');
    layOut(box, { width: 342, height: 100 });
    await click(view.host.querySelector('.setup-rail__step[aria-controls="setup-step-role"]'));
    assert.equal(box.getAttribute('data-measured'), 'true');
    assert.equal(view.host.querySelector('.setup-teams__pager .pager__pos').textContent, 'Page 2 /  of 2');
    assert.equal(box.querySelectorAll('.setup-team').length, 6);
  });
});

test('the Ledger’s Fallen panel and the Chronicle’s Story panel measure their lists in the commit that shows them', async () => {
  await withDom(async ({ mount, window }) => {
    installObserver(window);
    const panel = (view, label) => [...view.host.querySelectorAll('.ledger-panels button')].find(button => button.textContent === label);

    const fallen = Array.from({ length: 30 }, (_, i) => ({ key: `f${i}`, teamId: `x${i}`, flagId: null, isClub: true, code: `X${i}`,
      name: `Fallen ${i}`, line: '' }));
    const ledger = await mount(LedgerScreen, { rows: [], fallen, header: { kicker: 'K', title: 'Ledger', stats: [] }, onSelectTeam() {} });
    const wall = ledger.host.querySelector('.ledger-fallen__list');
    assert.equal(wall.getAttribute('data-measured'), null, 'hidden behind the Standings panel: not measured');
    // 200 × 100: five 35.2px cells across, three rows, 15 to a page.
    layOut(wall, { width: 200, height: 100 });
    await click(panel(ledger, 'Fallen'));
    assert.equal(wall.getAttribute('data-measured'), 'true');
    assert.equal(ledger.host.querySelector('.ledger-fallen .pager__pos').textContent, 'Page 1 /  of 2');
    assert.equal(wall.querySelectorAll('.ledger-fallen__row').length, 15);

    const feed = Array.from({ length: 40 }, (_, i) => ({ round: `R${40 - i}`, kind: 'match', text: `Entry ${i}` }));
    const chronicle = await mount(ChronicleScreen, { history: [], feed, header: { kicker: 'K', title: 'Chronicle', stats: [] } });
    const activity = chronicle.host.querySelector('.fi-activity-box');
    assert.equal(activity.querySelectorAll('.fi-activity-item').length, 40);
    // 200px for 26px rows: seven to a page.
    layOut(activity, { width: 300, height: 200, top: 0, scrollHeight: 26 * 40 });
    activity.querySelectorAll('.fi-activity-item').forEach(row => layOut(row, { width: 300, height: 26, top: 0 }));
    await click(panel(chronicle, 'Story'));
    assert.equal(activity.querySelectorAll('.fi-activity-item').length, 7);
    assert.equal(chronicle.host.querySelector('.fi-activity .pager__pos').textContent, 'Page 1 /  of 6');
  });
});
