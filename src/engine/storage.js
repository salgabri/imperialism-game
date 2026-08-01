// Campaign autosave. Best-effort by design: a blocked or full localStorage must
// never interrupt a running war.

import { SAVE_KEY, SAVE_VERSION } from '../config.js';

const LOG_CAP = 140;

export function loadSave() {
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
  } catch {
    return null;
  }
  if (!saved || saved.v !== SAVE_VERSION || !saved.teams || !saved.aliveIds) return null;
  return saved;
}

export function writeSave(state) {
  if (!state.settings) return;
  const data = {
    v: SAVE_VERSION,
    settings: state.settings,
    round: state.round,
    matches: state.matches,
    own: state.own,
    aliveIds: state.aliveIds,
    fallen: state.fallen,
    stats: state.stats,
    teams: state.teams,
    queue: state.queue,
    batchTotal: state.batchTotal,
    log: state.log.slice(-LOG_CAP),
    // In-flight match/spinner state is deliberately dropped: a resumed campaign
    // restarts at the next action rather than mid-ticker.
    phase: state.phase === 'victory' ? 'victory' : 'playing',
  };
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  } catch {
    /* quota or private mode — the campaign continues unsaved */
  }
}

export function clearSave() {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    /* nothing to do */
  }
}
