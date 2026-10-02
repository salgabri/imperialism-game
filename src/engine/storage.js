import { SAVE_KEY, SAVE_VERSION } from '../config.js';

export function campaignSnapshot(state) {
  const keys = ['settings', 'round', 'matches', 'own', 'aliveIds', 'fallen', 'stats', 'teams',
    'queue', 'batchTotal', 'log', 'match', 'spin', 'seed', 'rngState', 'history', 'series',
    'followedId', 'pauseFollow', 'choice', 'metrics', 'startedAt', 'completedAt', 'conquestIds'];
  return { v: SAVE_VERSION, savedAt: Date.now(), ...Object.fromEntries(keys.map(key => [key, state[key]])),
    phase: state.phase === 'victory' ? 'victory' : 'playing' };
}

export function parseCampaign(text) {
  const data = JSON.parse(text);
  if (![1, SAVE_VERSION].includes(data?.v) || !data.teams || !data.own || !data.settings
      || !Array.isArray(data.aliveIds) || data.aliveIds.length < 1 || data.aliveIds.length > 200) {
    throw new Error('This file is not a supported Imperialism campaign.');
  }
  const teams = Object.values(data.teams);
  if (!teams.length || teams.length > 200 || teams.some(team => !team || typeof team.name !== 'string'
      || !Array.isArray(team.squad) || team.squad.length > 250
      || team.squad.some(p => typeof p.name !== 'string' || !Number.isFinite(p.rating) || typeof p.pos !== 'string'))
      || data.aliveIds.some(id => !data.teams[id]) || Object.values(data.own).some(id => !data.teams[id])) {
    throw new Error('Campaign teams or territory data are incomplete.');
  }
  if (data.match && (!data.teams[data.match.aId] || !data.teams[data.match.dId]
      || !Array.isArray(data.match.allEv) || !Number.isFinite(data.match.finalGa) || !Number.isFinite(data.match.finalGd))) {
    throw new Error('The saved match is incomplete.');
  }
  return { ...data, v: SAVE_VERSION, history: data.history || [], log: data.log || [],
    queue: data.queue || [], matches: data.matches || 0, round: data.round || 0,
    seed: data.seed ?? 1, rngState: data.rngState ?? data.seed ?? 1, legacy: data.v === 1 };
}

export function loadSave() {
  try {
    const text = localStorage.getItem(SAVE_KEY);
    return text ? parseCampaign(text) : null;
  } catch { return null; }
}

export function writeSave(state) {
  try {
    const data = campaignSnapshot(state);
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    return { ok: true, savedAt: data.savedAt, message: 'Progress saved' };
  } catch {
    return { ok: false, savedAt: null, message: 'Progress could not be saved. Export your campaign to keep it.' };
  }
}

export function exportCampaign(state) { return JSON.stringify(campaignSnapshot(state), null, 2); }

export function clearSave() {
  try { localStorage.removeItem(SAVE_KEY); return true; } catch { return false; }
}
