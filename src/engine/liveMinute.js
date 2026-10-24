// Owner: WP-MATCH (see PLAN.md §4). Live match minute store (DEC D7): kept outside React and outside the saved
// `state.match`, read by components through useSyncExternalStore (LiveMinute.jsx). Written real by WP-0 in W1.

/** → { get(), set(n), subscribe(fn) → unsubscribe }; subscribers run only when the value changes. */
export function createMinuteStore(initial = 0) {
  let value = Number.isFinite(Number(initial)) ? Number(initial) : 0;
  const listeners = new Set();
  return {
    get: () => value,
    set(next) {
      const n = Number(next);
      if (!Number.isFinite(n) || n === value) return;
      value = n;
      for (const listener of [...listeners]) listener();
    },
    subscribe(listener) {
      if (typeof listener !== 'function') return () => {};
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}
