// Simulation tunables. These were the design's authored props; they are the knobs
// worth turning when the campaign feels too predictable or too random.

export const CONFIG = {
  /** Draw the top empires' codes and territory counts on the map. */
  showLabels: true,
  /** Effective-rating gap at which beating a favourite counts as a giant-killing (2–15). */
  upsetThreshold: 6,
  /** Std-dev of additional match-day variance; scoring and tie-break randomness remain at 0. */
  matchDrama: 6,
};

export const SAVE_KEY = 'football_imperialism_v1';
/**
 * v3 (DEC D8): turn order × targeting (`turnQueue`, `turnIndex`, `pendingTarget`, settings enums).
 * v4: a stored checkpoint keeps a bundled roster player's `sourceInfo` as its source id, rebuilt on load (a world
 * checkpoint shrinks from ~1.36M to ~0.6M characters). v1–v3 still load.
 * v5: the world map has the home nations, and 826 is England alone. An older world campaign's 826 was the whole
 * United Kingdom, so whoever held it also holds Scotland, Wales and Northern Ireland once loaded.
 */
export const SAVE_VERSION = 5;
