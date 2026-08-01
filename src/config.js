// Simulation tunables. These were the design's authored props; they are the knobs
// worth turning when the campaign feels too predictable or too random.

export const CONFIG = {
  /** Draw the top empires' codes and territory counts on the map. */
  showLabels: true,
  /** Effective-rating gap at which beating a favourite counts as a giant-killing (2–15). */
  upsetThreshold: 6,
  /** Std-dev of match-day variance in rating points; 0 makes the better side always win (0–12). */
  matchDrama: 6,
};

export const SAVE_KEY = 'football_imperialism_v1';
export const SAVE_VERSION = 1;
