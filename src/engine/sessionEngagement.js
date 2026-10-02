/** Local-only playtest timing. No data is sent anywhere. */
export class SessionEngagement {
  constructor(saved = {}, now = Date.now()) {
    this.totals = { viewingMs: 0, decisionMs: 0, pausedMs: 0, awayMs: 0,
      skips: 0, compressedMatches: 0, decisions: 0, firstDecisionActiveMs: null,
      ...saved };
    this.mode = 'away';
    this.since = now;
  }
  settle(now = Date.now()) {
    const key = { viewing: 'viewingMs', decision: 'decisionMs', paused: 'pausedMs', away: 'awayMs' }[this.mode];
    if (key) this.totals[key] += Math.max(0, now - this.since);
    this.since = now;
    return this.totals;
  }
  switchMode(mode, now = Date.now()) {
    this.settle(now);
    if (mode === 'decision' && this.totals.firstDecisionActiveMs == null)
      this.totals.firstDecisionActiveMs = this.totals.viewingMs;
    this.mode = mode;
  }
  count(key) { this.totals[key] = (this.totals[key] || 0) + 1; }
  snapshot(now = Date.now()) { return { ...this.settle(now) }; }
}

export function engagementMode(state, away = false) {
  if (away || state.phase !== 'playing' || state.aliveIds.length <= 1) return 'away';
  if (state.tacticalChoice || state.choice) return 'decision';
  if (state.paused || state.managerElimination || state.storageDialog) return 'paused';
  return 'viewing';
}
