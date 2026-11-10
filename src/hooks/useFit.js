// Long lists never scroll (docs/design/compact-pass.md): they show what fits in their box and page through the rest.
// Both hooks measure with a ResizeObserver, guarded for jsdom and the server: without one nothing is measured and every
// item renders on one page, which is also what the automated tests read. No timers (PLAN §0.10).
// They measure from the box's callback ref, which React calls after it has written the screen and before the browser
// paints it: every list on a screen reads the one layout that paint needs anyway, and the page the measure decides is
// rendered before that paint, so the first frame shown is already paged. Server rendering (the setup tests' static
// markup) never calls a ref, so it measures nothing and, unlike a useLayoutEffect, prints no warning.
import { useCallback, useMemo, useRef, useState } from 'react';

const observerFor = element => {
  const view = element?.ownerDocument?.defaultView;
  return typeof view?.ResizeObserver === 'function' ? view.ResizeObserver : null;
};

/**
 * Shorter than any row a list paged through `shown` draws (the activity feed's 26px rows are the shortest). A list whose
 * rows are shorter only loses the saving: its window of rows then fits its box, and every row is rendered and measured
 * as before.
 */
export const MIN_ROW_PX = 24;

/**
 * How many rows a list renders before its box is first measured: more than any box on the screen can hold, so a box with
 * a height of its own still overflows and is measured exactly as with every row, and far fewer than a late campaign's
 * standings, which were laid out whole only to be cut to one page. The bound is the screen's longer side, which a page
 * reads without a layout (innerHeight lays the page out first on Android Chrome) and which holds any window on that
 * screen in either orientation. A window taller than it (one zoomed out) only loses the saving: its box fits the rows and
 * gets them all back. Infinity where nothing measures (jsdom, the server): every row, as the DOM contracts read them.
 */
function firstRows() {
  const view = typeof document === 'undefined' ? null : document.defaultView;
  const measures = typeof view?.ResizeObserver === 'function';
  const longest = Math.max(Number(view?.screen?.height) || 0, Number(view?.screen?.width) || 0);
  return measures && longest > 0 ? Math.ceil(longest / MIN_ROW_PX) + 1 : Infinity;
}

/** The page holding `index` (clamped to the list), or `current` when there is no such index. */
function pageOf(index, size, current) {
  return index >= 0 && Number.isFinite(size) && size > 0 ? Math.floor(index / size) : current;
}

/**
 * The page holding `focusIndex`, set in the render that changes the focus or the page size (`turn` turns to it), so a new
 * page size is never shown at another page first. A page turn changes neither, so it is never undone. Object.is, as the
 * effect deps it replaces compared: a NaN focus equals itself, rather than counting as new on every render.
 */
function useFocusPage(focusIndex, pageSize, turn) {
  const [anchor, setAnchor] = useState({ focusIndex, pageSize });
  if (!Object.is(anchor.focusIndex, focusIndex) || !Object.is(anchor.pageSize, pageSize)) {
    setAnchor({ focusIndex, pageSize });
    if (focusIndex >= 0) turn(focusIndex, pageSize);
  }
}

/**
 * One page of `items`, as many rows as fit in the box `boxRef` is attached to. To page, the box needs a height of its own
 * (a flex or grid track with min-height:0); a box its rows size never overflows, so it keeps every row. `row` selects a
 * row inside the box to measure, and rows are assumed to be the same height. `focusIndex`, when it changes, brings its
 * row's page into view: the player's own team in the standings, the selected match in the history. `measureKey`, when
 * it changes, measures the box again in that commit: a panel switch that shows a box hidden until then.
 * → { boxRef, page, pages, pageSize, shown, start, setPage }
 */
export function usePagedList(items, { row = '[data-row]', focusIndex = -1, minRows = 1, measureKey = null } = {}) {
  const [pageSize, setPageSize] = useState(Infinity);
  const [page, setPage] = useState(0);
  // The rows rendered until the first measure (firstRows); Infinity once nothing will measure the box, or once a
  // measure finds a box its rows size.
  const [limit, setLimit] = useState(firstRows);
  const measured = Number.isFinite(pageSize);
  const pages = measured ? Math.max(1, Math.ceil(items.length / pageSize)) : 1;
  const paged = pages > 1;
  // Not measured yet and longer than the limit: only a window of rows is rendered, from the focused one, so that row is
  // on show (and can keep the focus) from the first render.
  const held = !measured && items.length > limit;

  useFocusPage(focusIndex, pageSize, (index, size) => setPage(current => pageOf(index, size, current)));

  const observer = useRef(null);
  // The row height measured with more than one row on show, and the box width it was measured at (see `measure`).
  const rowHeight = useRef({ height: 0, width: 0 });
  // A callback ref: the box can mount late (a list with no rows yet) and come and go with its state. React calls the
  // old ref with null and the new one with the box whenever the deps change, so the box is measured again when the list
  // first gets rows (an empty list has none to measure), when its pager comes or goes (a pager inside the box moves the
  // first row down without resizing the box), when the window of rows gives way to the page, and when `measureKey`
  // changes. `measure` reads `held`, so it is a dep; a change to `limit` that left `held` true would have to be one too.
  const boxRef = useCallback(box => {
    observer.current?.disconnect();
    observer.current = null;
    if (!box) return;
    const Observer = observerFor(box);
    if (!Observer) {
      // Nothing will measure this box (a window without a ResizeObserver): every row on one page.
      setLimit(Infinity);
      return;
    }
    const measure = () => {
      const rows = box.querySelectorAll(row);
      if (!rows.length || !box.clientHeight) return;
      const fits = box.scrollHeight - box.clientHeight <= 1;
      // The window of rows fits: a box its rows size (a table in a column), which keeps every row. Render them all and
      // measure again. A box with a height of its own always overflows with the window, so it is measured below just
      // as it would be with every row: the same room above its bottom, and the same row height.
      if (held && fits) {
        setLimit(Infinity);
        return;
      }
      const firstBox = rows[0].getBoundingClientRect();
      // Rows can differ by a rule (a first row has no top border): the tallest decides, so the last one always fits.
      const tallest = Math.max(...[rows[0], rows[1], rows[rows.length - 1]].filter(Boolean).map(element => element.getBoundingClientRect().height));
      const width = box.clientWidth;
      if (rows.length > 1 && tallest > 0) rowHeight.current = { height: tallest, width };
      // A lone row on show (a last page of one, which the focus can open on) is the box's first, so it can be that rule
      // shorter than the rest: it keeps the height measured with more rows. Otherwise the page would grow by a row,
      // which no longer fits, and shrink back when that page is measured: at worst a measure that never settles.
      // That height holds at the width it was measured at, or while it is no more than a rule taller than this row: a
      // window resized across a breakpoint brings rows of another height, and the old, taller rows would otherwise
      // leave the page rows short of what fits until the next resize.
      const known = rowHeight.current;
      const kept = known.width === width || known.height - tallest <= 2 ? known.height : 0;
      const height = rows.length > 1 ? tallest : Math.max(tallest, kept);
      if (!(height > 0)) return;
      const room = box.getBoundingClientRect().bottom - firstBox.top;
      // Nothing overflowing means every row on show is whole: the page keeps at least those. Otherwise a box its own rows
      // size (a table in a column) would lose a row at each measure wherever one row is a rule taller than the rest.
      const whole = fits ? rows.length : 0;
      setPageSize(current => {
        const next = Math.max(minRows, whole, Math.floor((room + .5) / height));
        return next === current ? current : next;
      });
    };
    measure();
    observer.current = new Observer(measure);
    observer.current.observe(box);
  }, [row, minRows, items.length > 0, paged, held, measureKey]);

  const clamped = Math.min(page, pages - 1);
  // The window starts at the focused row, or as near it as still leaves a whole window of rows (the box must overflow).
  const start = measured ? clamped * pageSize : held && focusIndex >= 0 ? Math.min(focusIndex, items.length - limit) : 0;
  const count = measured ? pageSize : held ? limit : Infinity;
  const shown = useMemo(() => (Number.isFinite(count) ? items.slice(start, start + count) : items), [items, start, count]);
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
 * rest on a phone or a touch screen. `options.focusIndex` (the checked team) brings its cell's page into view, in the
 * render that changes it or the page size, as usePagedList's focus does; `options.measureKey`, when it changes, measures
 * the box again in that commit (a step or panel switch that shows it).
 * → { boxRef, element, style, page, pages, pageSize, start, setPage, pageFor, measured }.
 * `style` carries --wall-cols, --wall-cell and --wall-ratio; `boxRef` is a callback ref, because the wall mounts only once
 * its team list has loaded.
 */
export function useFitWall(count, options = {}) {
  const { focusIndex = -1, measureKey = null } = options;
  const [element, setElement] = useState(null);
  const [box, setBox] = useState(null);
  const [page, setPage] = useState(0);
  const observer = useRef(null);
  // Measured as the box is attached, before the first paint (see the head of this file). The box stays in state: the
  // touch options read its window, and SetupOverlay finds the checked flag in it.
  const boxRef = useCallback(next => {
    observer.current?.disconnect();
    observer.current = null;
    setElement(next);
    const Observer = observerFor(next);
    if (!Observer) return;
    const measure = () => {
      const { clientWidth: width, clientHeight: height } = next;
      if (width > 0 && height > 0) setBox(current => (current?.width === width && current?.height === height ? current : { width, height }));
    };
    measure();
    observer.current = new Observer(measure);
    observer.current.observe(next);
  }, [measureKey]);

  const settings = touchSized(element) ? { ...options, ...options.touch } : options;
  const wall = box ? fitWall(box.width, box.height, count, settings) : null;
  const pageSize = wall ? wall.pageSize : Infinity;
  // The focused cell's page, and the first one while the whole field fits.
  useFocusPage(focusIndex, pageSize, (index, size) => setPage(pageOf(index, size, 0)));
  const pages = Number.isFinite(pageSize) ? Math.max(1, Math.ceil(count / pageSize)) : 1;
  const clamped = Math.min(page, pages - 1);
  const pageFor = useCallback(index => pageOf(index, pageSize, 0), [pageSize]);
  const style = wall ? { '--wall-cols': wall.cols, '--wall-cell': `${wall.cell.toFixed(2)}px`, '--wall-ratio': settings.ratio ?? 4 / 3 } : undefined;
  return { boxRef, element, style, page: clamped, pages, pageSize, start: Number.isFinite(pageSize) ? clamped * pageSize : 0, setPage, pageFor, measured: !!wall };
}
