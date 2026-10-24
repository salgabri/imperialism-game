// Owner: WP-SQUAD (see PLAN.md §4). Squad view method bodies.
// Plain function declarations called as `fn.apply(this, args)` from App's one-line delegates (§1.1, §3.3).
// HEAD bodies were moved verbatim from App.jsx in W1 (§4.10); call other App methods through `this.x()`.
import React from 'react';
import * as squadVM from '../viewModels/squad.js';

// ---------- v4 Squad view (PLAN §3.3 / §3.5 / §4.5) ----------
// `squadBack` lives in App's router block and returns to `st.squadReturn`.

/** Empty-state Back copy; matches the labels `buildSquad` puts on `back` for a real team. */
const EMPTY_BACK_LABELS = { map: 'Back to map', ledger: 'Back to standings', chronicle: 'Back to history', match: 'Back to match' };

/**
 * The team the Squad view shows: the selected team (map click, standings row, "Your squad"), else the managed team,
 * else the followed team (PLAN §3.3). Stale ids (a team missing from `st.teams`) fall through to the next candidate.
 * Pure helper (no `this`), exported for tests.
 */
export function squadTeamId(st, ctx = null) {
  const teams = st?.teams || {};
  const candidates = [st?.selected, ctx?.managedId, ctx?.followedId];
  for (const id of candidates) if (id != null && teams[id]) return id;
  return null;
}

/**
 * SquadScreen model (§3.5, C§16): `buildSquad(st, ctx, teamId)` spread by render next to the FROZEN onFollow / onBack /
 * onSelectTeam. Called from render only while playing and on the squad view; pure (no DOM, timers, RNG or setState).
 * Claimed-player provenance (DEC D8) is read inside `buildSquad`/`provenanceOf`: the `fromId`/`joined`/`claimGain`
 * fields applyConquest stores, falling back to the matching `history` entry for older saves.
 * With no team to show it returns only the Back copy, so the screen's empty state still offers a way back.
 */
export function squadModel() {
  const st = this.state;
  if (st.phase !== 'playing' && st.phase !== 'victory') return {};
  const ctx = this.viewContext(st);
  const teamId = squadTeamId(st, ctx);
  const model = teamId != null ? squadVM.buildSquad(st, ctx, teamId) : null;
  if (model) return model;
  const label = EMPTY_BACK_LABELS[st.squadReturn];
  return label ? { back: { label } } : {};
}
