// Owner: WP-MATCH (see PLAN.md §4). Written real by WP-0 in W1; FROZEN API.
import React from 'react';
import './match-card.css';

// The live minute is read from a store outside React state (DEC D7): no App re-render per minute, no timers here.
const noSubscribe = () => () => {};

/** The store's current minute; `fallback` on the server and when no store is given. */
export function useLiveMinute(store, fallback = 0) {
  const subscribe = store?.subscribe || noSubscribe;
  const getSnapshot = store?.get || (() => fallback);
  return React.useSyncExternalStore(subscribe, getSnapshot, () => fallback);
}

export default function LiveMinute({ store, fallback = 0, suffix = "'" }) {
  const minute = useLiveMinute(store, fallback);
  return <span className="live-minute">{`${minute}${suffix}`}</span>;
}
