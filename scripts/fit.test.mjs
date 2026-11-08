// Screens that fit (docs/design/compact-pass.md): the arithmetic of a flag wall, the pager, and the two hooks that measure
// a box and show one page of what fits in it. The hooks measure with a ResizeObserver, stubbed here, because jsdom has no
// layout: without one everything renders on a single page, which is what the rest of the suite reads.
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { bundleComponents, withDom } from './lib/app-harness.mjs';
import { fitWall } from '../src/hooks/useFit.js';

const { Pager, usePagedList, useFitWall, SetupOverlay, TargetPanel } = await bundleComponents({
  Pager: 'src/components/Pager.jsx',
  usePagedList: ['src/hooks/useFit.js', 'usePagedList'],
  useFitWall: ['src/hooks/useFit.js', 'useFitWall'],
  SetupOverlay: 'src/components/SetupOverlay.jsx',
  TargetPanel: 'src/screens/turns/TargetPanel.jsx',
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
