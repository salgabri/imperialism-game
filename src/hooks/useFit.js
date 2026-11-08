// Long lists never scroll (docs/design/compact-pass.md): they show what fits in their box and page through the rest.
// Both hooks measure with a ResizeObserver, guarded for jsdom and the server: without one nothing is measured and every
// item renders on one page, which is also what the automated tests read. No timers (PLAN §0.10).
import { useCallback, useEffect, useMemo, useState } from 'react';

const observerFor = element => {
  const view = element?.ownerDocument?.defaultView;
  return typeof view?.ResizeObserver === 'function' ? view.ResizeObserver : null;
};

/** The page holding `index` (clamped to the list), or `current` when there is no such index. */
function pageOf(index, size, current) {
  return index >= 0 && Number.isFinite(size) && size > 0 ? Math.floor(index / size) : current;
}

/**
 * One page of `items`, as many rows as fit in the box `boxRef` is attached to. The box needs a height of its own (a flex
 * or grid track with min-height:0): its content never decides it. `row` selects a row inside the box to measure, and
 * rows are assumed to be the same height. `focusIndex`, when it changes, brings its row's page into view: the player's
 * own team in the standings, the selected match in the history.
 * → { boxRef, page, pages, pageSize, shown, start, setPage }
 */
export function usePagedList(items, { row = '[data-row]', focusIndex = -1, minRows = 1 } = {}) {
  // A callback ref: the box can mount late (a list with no rows yet) and come and go with its state.
  const [box, boxRef] = useState(null);
  const [pageSize, setPageSize] = useState(Infinity);
  const [page, setPage] = useState(0);
  const pages = Number.isFinite(pageSize) ? Math.max(1, Math.ceil(items.length / pageSize)) : 1;
  const paged = pages > 1;

  useEffect(() => {
    const Observer = observerFor(box);
    if (!Observer) return undefined;
    const measure = () => {
      const rows = box.querySelectorAll(row);
      if (!rows.length || !box.clientHeight) return;
      const firstBox = rows[0].getBoundingClientRect();
      // Rows can differ by a rule (a first row has no top border): the tallest decides, so the last one always fits.
      const height = Math.max(...[rows[0], rows[1], rows[rows.length - 1]].filter(Boolean).map(element => element.getBoundingClientRect().height));
      if (!(height > 0)) return;
      const room = box.getBoundingClientRect().bottom - firstBox.top;
      setPageSize(current => {
        const next = Math.max(minRows, Math.floor((room + .5) / height));
        return next === current ? current : next;
      });
    };
    measure();
    const observer = new Observer(measure);
    observer.observe(box);
    return () => observer.disconnect();
    // Measured again when the list first gets rows (an empty list has none to measure), and when its pager comes or
    // goes: a pager inside the box moves the first row down without resizing the box.
  }, [box, row, minRows, items.length > 0, paged]);

  // Bring the focused row's page into view when the focus or the page size changes, not on every page turn.
  useEffect(() => {
    if (focusIndex >= 0) setPage(current => pageOf(focusIndex, pageSize, current));
  }, [focusIndex, pageSize]);
  const clamped = Math.min(page, pages - 1);
  const start = Number.isFinite(pageSize) ? clamped * pageSize : 0;
  const shown = useMemo(() => (Number.isFinite(pageSize) ? items.slice(start, start + pageSize) : items), [items, start, pageSize]);
  return { boxRef, page: clamped, pages, pageSize, shown, start, setPage };
}

/**
 * The largest cell that lets `count` cells of `ratio` (width / height) fill the box without scrolling; below `minCell`
 * the wall pages instead, with as many whole cells as fit at that size. `maxCell` keeps a small field from ballooning.
 * The arithmetic of useFitWall, pure and tested. → { cols, cell, pageSize } (pageSize Infinity: the whole field fits).
 */
export function fitWall(width, height, count, { ratio = 4 / 3, gap = 6, minCell = 28, maxCell = 96 } = {}) {
  const across = cols => (width - gap * (cols - 1)) / cols;
  const down = (rows, cell) => rows * (cell / ratio) + gap * (rows - 1);
  // The fewest columns that fit give the largest cells.
  for (let cols = 1; cols <= Math.max(1, count); cols += 1) {
    const cell = across(cols);
    if (cell < minCell) break;
    if (down(Math.ceil(count / cols), cell) > height) continue;
    // Held at maxCell the cells leave room across: more of them fill it (fewer rows, never more).
    if (cell > maxCell) return { cols: Math.max(cols, Math.floor((width + gap) / (maxCell + gap))), cell: maxCell, pageSize: Infinity };
    return { cols, cell, pageSize: Infinity };
  }
  const cols = Math.max(1, Math.floor((width + gap) / (minCell + gap)));
  const cell = Math.min(maxCell, across(cols));
  // The cells stretch to fill the row, so the rows are counted at the cell's real height, not at minCell's.
  const rows = Math.max(1, Math.floor((height + gap) / (cell / ratio + gap)));
  return { cols, cell, pageSize: cols * rows };
}

/** A phone or a touch screen: a wall's `touch` options apply, because a finger needs a bigger cell than a mouse pointer. */
function touchSized(element) {
  const view = element?.ownerDocument?.defaultView;
  return typeof view?.matchMedia === 'function' && !!view.matchMedia('(max-width:699.98px), (pointer:coarse)')?.matches;
}

/**
 * A wall of cells that fills its box: fitWall at the box's size, re-measured as it resizes. `options.touch` overrides the
 * rest on a phone or a touch screen. → { boxRef, element, style, page, pages, pageSize, start, setPage, pageFor, measured }.
 * `style` carries --wall-cols, --wall-cell and --wall-ratio; `boxRef` is a callback ref, because the wall mounts only once
 * its team list has loaded.
 */
export function useFitWall(count, options = {}) {
  const [element, boxRef] = useState(null);
  const [box, setBox] = useState(null);
  const [page, setPage] = useState(0);

  useEffect(() => {
    const Observer = observerFor(element);
    if (!Observer) return undefined;
    const measure = () => {
      const { clientWidth: width, clientHeight: height } = element;
      if (width > 0 && height > 0) setBox(current => (current?.width === width && current?.height === height ? current : { width, height }));
    };
    measure();
    const observer = new Observer(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);

  const settings = touchSized(element) ? { ...options, ...options.touch } : options;
  const wall = box ? fitWall(box.width, box.height, count, settings) : null;
  const pageSize = wall ? wall.pageSize : Infinity;
  const pages = Number.isFinite(pageSize) ? Math.max(1, Math.ceil(count / pageSize)) : 1;
  const clamped = Math.min(page, pages - 1);
  const pageFor = useCallback(index => pageOf(index, pageSize, 0), [pageSize]);
  const style = wall ? { '--wall-cols': wall.cols, '--wall-cell': `${wall.cell.toFixed(2)}px`, '--wall-ratio': settings.ratio ?? 4 / 3 } : undefined;
  return { boxRef, element, style, page: clamped, pages, pageSize, start: Number.isFinite(pageSize) ? clamped * pageSize : 0, setPage, pageFor, measured: !!wall };
}
