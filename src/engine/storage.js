import { SAVE_KEY, SAVE_VERSION } from '../config.js';

export const CAMPAIGN_INDEX_KEY = `${SAVE_KEY}:campaigns`;
export const CAMPAIGN_BACKUP_KEY = `${SAVE_KEY}:backup`;
export const CAMPAIGN_DAMAGED_KEY = `${SAVE_KEY}:damaged`;
export const campaignStorageKey = id => `${SAVE_KEY}:slot:${id}`;
const backupKey = id => `${campaignStorageKey(id)}:backup`;
const record = value => !!value && typeof value === 'object' && !Array.isArray(value);
const uint = value => Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
const nonnegative = value => Number.isInteger(value) && value >= 0 && value <= 1_000_000;
const cleanName = name => String(name || 'Untitled campaign').trim().slice(0, 80) || 'Untitled campaign';

export function createCampaignId() {
  return globalThis.crypto?.randomUUID?.() || `campaign-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function campaignSnapshot(state) {
  const keys = ['settings', 'round', 'matches', 'own', 'aliveIds', 'fallen', 'stats', 'teams',
    'queue', 'batchTotal', 'log', 'match', 'spin', 'seed', 'rngState', 'history', 'series',
    'followedId', 'pauseFollow', 'choice', 'metrics', 'startedAt', 'completedAt', 'conquestIds',
    'campaignId', 'revision', 'campaignName', 'managedTeamId', 'managementEnded', 'managerElimination',
    'tacticalChoice', 'tactics', 'rules', 'historyFilter', 'selectedHistoryId', 'decisionLedger', 'initialSettings'];
  return { v: SAVE_VERSION, savedAt: Date.now(), ...Object.fromEntries(keys.map(key => [key, state[key]])),
    phase: state.phase === 'victory' ? 'victory' : 'playing' };
}

/** Validate every value used by resume before touching the current campaign. */
export function parseCampaign(text) {
  const data = JSON.parse(text);
  const invalid = message => { throw new Error(message); };
  if (!record(data) || ![1, SAVE_VERSION].includes(data.v) || !record(data.teams)
      || !record(data.own) || !record(data.settings) || !Array.isArray(data.aliveIds)
      || data.aliveIds.length < 1 || data.aliveIds.length > 200) {
    invalid('This file is not a supported Imperialism campaign.');
  }
  const teams = Object.entries(data.teams), known = id => typeof id === 'string' && Object.hasOwn(data.teams, id);
  if (!teams.length || teams.length > 200 || teams.some(([id, team]) => !record(team)
      || (team.id != null && team.id !== id) || typeof team.name !== 'string' || !team.name.trim()
      || !Array.isArray(team.squad) || team.squad.length > 250
      || team.squad.some(p => !record(p) || typeof p.name !== 'string' || !p.name.trim()
        || !Number.isFinite(p.rating) || p.rating < 0 || p.rating > 120 || typeof p.pos !== 'string'))
      || data.aliveIds.some(id => !known(id)) || new Set(data.aliveIds).size !== data.aliveIds.length
      || Object.values(data.own).some(id => !known(id) || !data.aliveIds.includes(id))) {
    invalid('Campaign teams or territory data are incomplete.');
  }
  if (!Object.keys(data.own).length || data.aliveIds.some(id => !Object.values(data.own).includes(id))) {
    invalid('Every surviving team must own territory.');
  }
  const settings = data.settings;
  const enums = { sport: ['football', 'basketball'], layer: ['nations', 'clubs'], pacing: ['duel', 'blitz', 'chaos'],
    resolution: ['ticker', 'instant'], role: ['spectator', 'manager'], uncertainty: ['predictable', 'balanced', 'wild'],
    finale: ['single', 'best-of-three'], acquisitionPolicy: ['best-fit', 'highest-rated'], rosterPreset: ['authentic', 'competitive'] };
  for (const configuration of [settings, data.initialSettings].filter(Boolean)) {
    for (const [key, values] of Object.entries(enums)) if (configuration[key] != null && !values.includes(configuration[key])) invalid(`Campaign ${key} setting is unsupported.`);
    if (configuration.managedTeamId != null && configuration.managedTeamId !== '' && !known(configuration.managedTeamId)) invalid('The managed team setting is unavailable.');
  }
  for (const key of ['round', 'matches', 'batchTotal', 'revision']) if (data[key] != null && !nonnegative(data[key])) invalid(`Campaign ${key} is invalid.`);
  for (const key of ['seed', 'rngState']) if (data[key] != null && !uint(data[key])) invalid('The saved random state is invalid.');
  if (data.v === SAVE_VERSION && (!uint(data.seed) || !uint(data.rngState))) invalid('The saved random state is missing or invalid.');
  if (data.campaignId != null && (typeof data.campaignId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(data.campaignId))) invalid('Campaign identity is invalid.');
  if (data.campaignName != null && (typeof data.campaignName !== 'string' || data.campaignName.length > 80)) invalid('Campaign name is invalid.');
  if (data.phase != null && !['playing', 'victory'].includes(data.phase)) invalid('Campaign phase is invalid.');
  if (data.phase === 'victory' && data.aliveIds.length !== 1) invalid('A completed campaign must have one champion.');
  for (const key of ['savedAt', 'startedAt', 'completedAt']) if (data[key] != null && (!Number.isFinite(data[key]) || data[key] < 0)) invalid('Campaign timestamp is invalid.');
  for (const key of ['queue', 'history', 'log', 'fallen', 'conquestIds', 'decisionLedger']) if (data[key] != null && !Array.isArray(data[key])) invalid(`Campaign ${key} must be a list.`);
  if ((data.history?.length || 0) > 1000 || (data.log?.length || 0) > 1000 || (data.queue?.length || 0) > 200) invalid('Campaign lists exceed supported limits.');
  if (data.queue?.some(pair => !Array.isArray(pair) || pair.length !== 2 || pair[0] === pair[1]
      || pair.some(id => !known(id) || !data.aliveIds.includes(id)))) invalid('The saved fixture queue references an unavailable team.');
  for (const key of ['followedId', 'managedTeamId']) if (data[key] != null && !known(data[key])) invalid('The followed or managed team is missing.');
  for (const key of ['stats', 'metrics', 'initialSettings', 'rules']) if (data[key] != null && !record(data[key])) invalid(`Campaign ${key} is invalid.`);
  if (data.stats && Object.entries(data.stats).some(([id, stat]) => !known(id) || !record(stat)
      || !nonnegative(stat.conq) || !Array.isArray(stat.steals) || stat.steals.some(name => typeof name !== 'string'))) invalid('Campaign team statistics are incomplete.');
  if (data.metrics?.acquisitions != null && (!Array.isArray(data.metrics.acquisitions)
      || data.metrics.acquisitions.some(gain => !Number.isFinite(gain)))) invalid('Campaign acquisition metrics are invalid.');
  if (data.metrics?.engagement != null && (!record(data.metrics.engagement)
      || Object.values(data.metrics.engagement).some(value => value != null && (!Number.isFinite(value) || value < 0)))) invalid('Campaign engagement metrics are invalid.');
  if (data.metrics?.leaderChanges != null && !nonnegative(data.metrics.leaderChanges)) invalid('Campaign leadership metrics are invalid.');
  if (data.fallen?.some(entry => !record(entry) || !known(entry.id) || !nonnegative(entry.r))) invalid('Campaign elimination history is incomplete.');
  const textValue = value => value == null || typeof value === 'string' || typeof value === 'number';
  const displayTeam = team => record(team) && typeof team.name === 'string' && textValue(team.score)
    && ['eff', 'code', 'color', 'id'].every(key => textValue(team[key]));
  const displayResult = result => result == null || (record(result)
    && ['title', 'text', 'winnerName', 'loserName', 'tieText'].every(key => textValue(result[key]))
    && (result.player == null || (record(result.player) && typeof result.player.name === 'string'
      && typeof result.player.pos === 'string' && Number.isFinite(result.player.rating)))
    && (result.territoryNames == null || (Array.isArray(result.territoryNames) && result.territoryNames.every(name => typeof name === 'string')))
    && (result.strengthGain == null || [result.strengthGain, result.strengthBefore, result.strengthAfter].every(Number.isFinite)));
  if (data.history?.some(entry => !record(entry) || typeof entry.id !== 'string' || !known(entry.aId)
      || !known(entry.dId || entry.bId) || (entry.winnerId != null && !known(entry.winnerId))
      || !displayTeam(entry.a) || !displayTeam(entry.b) || !Array.isArray(entry.events)
      || entry.events.some(event => !record(event) || !['when', 'text', 'color'].every(key => textValue(event[key])))
      || !displayResult(entry.result) || (entry.kicks != null && (!record(entry.kicks)
        || ['a', 'b'].some(key => !Array.isArray(entry.kicks[key])
          || entry.kicks[key].some(kick => typeof kick !== 'boolean' && kick !== 0 && kick !== 1)))))) invalid('Campaign match history is incomplete.');
  if (data.log?.some(entry => !record(entry) || typeof entry.txt !== 'string')) invalid('Campaign event log is incomplete.');
  if (data.decisionLedger?.some(entry => !record(entry))) invalid('Campaign decisions are incomplete.');
  const pending = (value, aKey, dKey, label) => {
    if (!record(value) || !known(value[aKey]) || !known(value[dKey]) || value[aKey] === value[dKey]
        || !data.aliveIds.includes(value[aKey]) || !data.aliveIds.includes(value[dKey])) invalid(`The saved ${label} references an unavailable team.`);
  };
  if (data.spin != null) {
    pending(data.spin, 'attackerId', 'targetId', 'draw');
    for (const key of ['rotation', 'x', 'y', 'targetX', 'targetY', 'spinMs', 'holdMs']) {
      if (!Number.isFinite(data.spin[key]) || (['spinMs', 'holdMs'].includes(key) && data.spin[key] < 0)) invalid('The saved draw geometry or timing is incomplete.');
    }
  }
  if (data.tacticalChoice != null) {
    pending(data.tacticalChoice, 'aId', 'dId', 'tactical decision');
    const choice = data.tacticalChoice;
    if (data.match || data.choice || data.spin || !Array.isArray(choice.options) || choice.options.length !== 3
        || new Set(choice.options.map(option => option?.id)).size !== 3
        || choice.options.some(option => !record(option) || !['attack', 'balanced', 'defend'].includes(option.id)
          || typeof option.label !== 'string' || typeof option.description !== 'string'
          || !['strength', 'bonus', 'support', 'drama', 'baseDrama'].every(key => Number.isFinite(option[key]))
          || (option.winProbability != null && (!Number.isFinite(option.winProbability) || option.winProbability < 0 || option.winProbability > 1)))) invalid('The saved tactical options are incomplete.');
    if (typeof choice.managerName !== 'string' || typeof choice.opponentName !== 'string') invalid('The saved tactical decision is incomplete.');
  }
  if (data.match != null) {
    const m = data.match;
    if (!record(m) || !known(m.aId) || !known(m.dId) || m.aId === m.dId || ![m.aId, m.dId].includes(m.winner)
        || ![m.finalGa, m.finalGd, m.effA, m.effD].every(Number.isFinite)
        || m.finalGa < 0 || m.finalGd < 0 || !Array.isArray(m.allEv)
        || !Array.isArray(m.shown) || m.shown.length > m.allEv.length || m.allEv.length > 2000
        || m.allEv.some(e => !record(e) || !Number.isFinite(e.m) || e.m < 0 || ![m.aId, m.dId].includes(e.tid))) invalid('The saved match is incomplete.');
    if (!m.applied && (!data.aliveIds.includes(m.aId) || !data.aliveIds.includes(m.dId))) invalid('The pending match includes an eliminated team.');
    if (m.tie != null && (!record(m.tie) || ![m.tie.ga, m.tie.gd].every(Number.isFinite))) invalid('The saved tie-break is incomplete.');
  }
  if (data.choice != null) {
    const choice = data.choice, m = data.match;
    if (!record(choice) || !m || m.applied || !Array.isArray(choice.candidates) || !choice.candidates.length || choice.candidates.length > 3) invalid('The saved signing decision is incomplete.');
    const loser = data.teams[m.winner === m.aId ? m.dId : m.aId];
    if (choice.candidates.some(candidate => !record(candidate) || !Number.isInteger(candidate.index)
        || candidate.index < 0 || !loser.squad[candidate.index] || typeof candidate.name !== 'string'
        || !Number.isFinite(candidate.rating) || !Number.isFinite(candidate.gain))) invalid('A saved signing candidate is unavailable.');
  }
  if (data.series != null) {
    const s = data.series;
    if (!record(s) || !Array.isArray(s.teamIds) || s.teamIds.length !== 2 || s.teamIds[0] === s.teamIds[1]
        || s.teamIds.some(id => !known(id)) || !record(s.wins) || !nonnegative(s.games) || s.games > 3
        || s.teamIds.some(id => !Number.isInteger(s.wins[id]) || s.wins[id] < 0 || s.wins[id] > 2)
        || s.teamIds.reduce((sum, id) => sum + s.wins[id], 0) !== s.games) invalid('The saved final series is incomplete.');
  }
  if (data.managerElimination != null && (!record(data.managerElimination)
      || !known(data.managerElimination.teamId) || !known(data.managerElimination.opponentId)
      || !['teamName', 'opponentName', 'score'].every(key => typeof data.managerElimination[key] === 'string')
      || !['placement', 'conquests', 'signings'].every(key => nonnegative(data.managerElimination[key])))) invalid('The saved manager result is incomplete.');
  return { ...data, v: SAVE_VERSION, history: data.history || [], log: data.log || [],
    queue: data.queue || [], matches: data.matches || 0, round: data.round || 0,
    seed: data.seed ?? 1, rngState: data.rngState ?? data.seed ?? 1, legacy: data.v === 1,
    revision: data.revision || 0, decisionLedger: data.decisionLedger || [],
    managedTeamId: data.managedTeamId ?? (data.settings.role === 'manager' && !data.managementEnded ? data.followedId || null : null) };
}

function tryParse(text) { try { return text ? parseCampaign(text) : null; } catch { return null; } }

/** Raw damaged data remains available, even when a previous checkpoint can recover it. */
export function inspectSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return { state: 'missing', campaign: null };
    try { return { state: 'ready', campaign: parseCampaign(raw) }; }
    catch (error) {
      const backup = tryParse(localStorage.getItem(CAMPAIGN_BACKUP_KEY));
      return { state: 'recovery', campaign: null, raw, backup,
        message: `The latest checkpoint could not be read. ${error.message}${backup ? ' A previous checkpoint is available.' : ' Export the damaged file to keep a copy.'}` };
    }
  } catch { return { state: 'unavailable', campaign: null, message: 'Saved campaigns could not be read. Browser storage is unavailable.' }; }
}

export function loadSave() { return inspectSave().campaign; }

function indexData() {
  const parsed = JSON.parse(localStorage.getItem(CAMPAIGN_INDEX_KEY) || '[]');
  if (!Array.isArray(parsed)) throw new Error('Campaign index is damaged.');
  return parsed.filter(item => record(item) && typeof item.id === 'string');
}

export function campaignMetadata(data) {
  return { id: data.campaignId, name: cleanName(data.campaignName), revision: data.revision || 0,
    savedAt: data.savedAt, round: data.round || 0, matches: data.matches || 0,
    alive: data.aliveIds?.length || 0, settings: data.settings, seed: data.seed, phase: data.phase,
    managedTeamName: data.teams?.[data.managedTeamId]?.name || null };
}

export function listCampaigns() {
  try {
    const listed = indexData().map(item => {
      const saved = tryParse(localStorage.getItem(campaignStorageKey(item.id)));
      return saved ? campaignMetadata(saved) : { ...item, damaged: true };
    });
    const current = loadSave();
    if (current?.campaignId && !listed.some(item => item.id === current.campaignId)) listed.push(campaignMetadata(current));
    return listed.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
  } catch { return []; }
}

export function loadCampaign(id) {
  const raw = localStorage.getItem(campaignStorageKey(id));
  if (!raw) throw new Error('This campaign checkpoint is no longer available.');
  return parseCampaign(raw);
}

export function inspectCampaign(id) {
  try {
    const raw = localStorage.getItem(campaignStorageKey(id));
    if (!raw) return { state: 'missing', campaign: null, message: 'This campaign checkpoint is no longer available.' };
    const campaign = tryParse(raw);
    if (campaign) return { state: 'ready', campaign };
    const backup = tryParse(localStorage.getItem(backupKey(id)));
    return { state: 'recovery', campaign: null, raw, backup,
      message: `This campaign checkpoint is damaged.${backup ? ' A previous checkpoint is available.' : ' Export the damaged file to keep a copy.'}` };
  } catch { return { state: 'unavailable', campaign: null, message: 'Saved campaigns could not be read. Browser storage is unavailable.' }; }
}

export function forkCampaign(state, name = `${state.campaignName || 'Campaign'} copy`) {
  return { ...campaignSnapshot(state), campaignId: createCampaignId(), revision: 0, campaignName: cleanName(name) };
}

export function detectSaveConflict(state) {
  if (!state.campaignId) return null;
  try {
    const remote = loadCampaign(state.campaignId);
    return remote.revision !== (state.revision || 0) ? remote : null;
  } catch { return null; }
}

export function isCampaignStorageEvent(event, id) {
  return !!id && (event.key === campaignStorageKey(id) || event.key === null);
}

/** Compare-and-save prevents a stale tab from replacing a newer checkpoint. */
export function writeSave(state, { activate = true } = {}) {
  try {
    const data = campaignSnapshot(state);
    data.campaignId ||= createCampaignId();
    data.campaignName = cleanName(state.campaignName);
    const key = campaignStorageKey(data.campaignId), previous = localStorage.getItem(key);
    if (previous) {
      const remote = parseCampaign(previous);
      if (remote.revision !== (state.revision || 0)) return { ok: false, savedAt: null, conflict: remote,
        message: 'This campaign changed in another tab. Reload that checkpoint or fork your current progress.' };
    }
    data.revision = (state.revision || 0) + 1;
    const text = JSON.stringify(data);
    parseCampaign(text);
    const index = indexData().filter(item => item.id !== data.campaignId);
    index.unshift(campaignMetadata(data));
    const current = localStorage.getItem(SAVE_KEY);
    const currentCampaign = tryParse(current);
    // A legacy singleton must remain reachable when a new campaign starts.
    if (currentCampaign && !currentCampaign.campaignId) {
      const migrated = { ...currentCampaign, campaignId: createCampaignId(), revision: 1,
        campaignName: cleanName(currentCampaign.campaignName || `${currentCampaign.settings.sport || 'Football'} legacy campaign`) };
      localStorage.setItem(campaignStorageKey(migrated.campaignId), JSON.stringify(migrated));
      index.push(campaignMetadata(migrated));
    } else if (current && !currentCampaign) {
      // Retain damaged bytes even when the player chooses to start a fresh run.
      localStorage.setItem(CAMPAIGN_DAMAGED_KEY, current);
    }
    if (previous && tryParse(previous)) localStorage.setItem(backupKey(data.campaignId), previous);
    const updatePointer = activate || currentCampaign?.campaignId === data.campaignId;
    if (currentCampaign && updatePointer) localStorage.setItem(CAMPAIGN_BACKUP_KEY, current);
    localStorage.setItem(CAMPAIGN_INDEX_KEY, JSON.stringify(index));
    localStorage.setItem(key, text);
    if (updatePointer) localStorage.setItem(SAVE_KEY, text);
    return { ok: true, campaignId: data.campaignId, revision: data.revision, campaignName: data.campaignName,
      savedAt: data.savedAt, message: 'Progress saved' };
  } catch {
    return { ok: false, savedAt: null, message: 'Progress could not be saved. Export your campaign to keep it.' };
  }
}

export function renameCampaign(id, name) {
  const campaign = loadCampaign(id);
  return writeSave({ ...campaign, campaignName: cleanName(name) }, { activate: false });
}

export function exportCampaign(state) { return JSON.stringify(campaignSnapshot(state), null, 2); }

/** Discard only the resume pointer; named campaigns and recovery copies stay intact. */
export function clearSave() {
  try { localStorage.removeItem(SAVE_KEY); return true; } catch { return false; }
}
