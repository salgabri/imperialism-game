// Owner: WP-MATCH (see PLAN.md §4). The minute a Match view part should show (DEC D7).
// Live: the minute store (never below the last revealed event); otherwise the model's fixed minute. No timers.
import { useLiveMinute } from '../../components/LiveMinute.jsx';

export function useMatchMinute({ live = false, minuteStore = null, minuteFallback = 0, minuteFloor = 0 } = {}) {
  const value = useLiveMinute(live ? minuteStore : null, minuteFallback);
  if (!live) return Number(minuteFallback) || 0;
  return Math.max(Number(value) || 0, Number(minuteFloor) || 0);
}

export default useMatchMinute;
