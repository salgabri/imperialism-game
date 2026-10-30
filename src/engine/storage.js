import { SAVE_KEY, SAVE_VERSION } from '../config.js';
import { DOMESTIC_PREFIX, domesticScopeId, isDomesticScope } from './domestic.js';
import { expandSetPlayer, isDataYear, isEraMap, isFootballSetId, seasonMapOf, seasonOf, setKindOf, setSportOf } from './footballSets.js';
import { expandFmTuple, FM_ROLES } from '../data/fmPlayers.js';
import { CM_ROLES, CM_SOURCE, cmTupleOf } from '../data/cmPlayers.js';
import { EA_ROLES, EA_SOURCE, eaRosterOf, eaTupleOf } from '../data/eaPlayers.js';
import { getSport, SPORT_LIST } from '../sports/index.js';
import { HOME_NATIONS } from '../data/teams.js';

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

/** The state keys a checkpoint stores (plus `phase`, as playing or victory). */
export const CHECKPOINT_KEYS = Object.freeze(['settings', 'round', 'matches', 'own', 'aliveIds', 'fallen', 'stats', 'teams',
  'queue', 'batchTotal', 'log', 'match', 'spin', 'seed', 'rngState', 'history', 'series',
  'followedId', 'pauseFollow', 'choice', 'metrics', 'startedAt', 'completedAt', 'conquestIds',
  'campaignId', 'revision', 'campaignName', 'managedTeamId', 'managementEnded', 'managerElimination',
  'tacticalChoice', 'tactics', 'rules', 'historyFilter', 'selectedHistoryId', 'decisionLedger', 'initialSettings',
  'turnQueue', 'turnIndex', 'pendingTarget']);

export function campaignSnapshot(state) {
  return { v: SAVE_VERSION, savedAt: Date.now(), ...Object.fromEntries(CHECKPOINT_KEYS.map(key => [key, state[key]])),
    phase: state.phase === 'victory' ? 'victory' : 'playing' };
}

// A country campaign carries ~1,600 Football Manager players, and each full
// record is ~470 characters, mostly text every player shares (edition, URL,
// conversion) or repeats (id, positions). Its checkpoints store each player as
// [fmId, name, ability, positions, nationality, club index, extras?] under one
// `playerPack` header, and parseCampaign rebuilds the identical records. A
// player whose record would not rebuild exactly stays in full. World campaigns
// on the built-in data are written exactly as before.
const fmPlayer = (player, source) => record(player) && typeof player.name === 'string' && record(player.sourceInfo)
  && player.sourceInfo.source === 'football-manager' && /^fm:\d{1,15}$/.test(player.sourceInfo.id)
  && Array.isArray(player.sourceInfo.naturalPositions) && typeof player.sourceInfo.club === 'string'
  && (!source || ['edition', 'version', 'snapshotDate'].every(key => player.sourceInfo[key] === source[key]));

function unpackPlayer(packed, pack) {
  const [fmId, name, ability, positions, nationality, club, extras] = packed;
  const [, pos, rating, sourceInfo] = expandFmTuple([fmId, name, ability, positions, nationality || undefined], pack.source, pack.clubs[club]);
  return { name, pos, rating, gen: false, sourceInfo, id: sourceInfo.id, positions: [...sourceInfo.positions], ...extras };
}

/** Every place a checkpoint keeps whole player records, rewritten through `fn`. */
function mapPlayers(data, fn) {
  const swap = (object, keys) => {
    const copy = { ...object };
    for (const key of keys) if (copy[key] != null) copy[key] = fn(copy[key]);
    return copy;
  };
  const out = { ...data };
  if (record(data.teams)) out.teams = Object.fromEntries(Object.entries(data.teams).map(([id, team]) =>
    [id, record(team) && Array.isArray(team.squad) ? { ...team, squad: team.squad.map(fn) } : team]));
  if (Array.isArray(data.history)) out.history = data.history.map(entry => record(entry) && record(entry.result)
    ? { ...entry, result: swap(entry.result, ['player', 'replacedPlayer']) } : entry);
  if (record(data.match)) out.match = swap(data.match, ['playerTaken', 'replacedPlayer']);
  return out;
}

// Whether a player rebuilds exactly from its tuple depends on the record and the pack's source edition, not on its
// club's index in one checkpoint. Player records are replaced, never changed in place, so each is checked once.
// `unpack` is the pack's own rebuild: FM's for country campaigns, the CM one for data set campaigns.
const exactPacks = new WeakMap();

function packsExactly(player, tuple, pack, unpack = unpackPlayer) {
  const source = [pack.kind || 'fm', ...Object.values(pack.source)].join('\u0000');
  const known = exactPacks.get(player);
  if (known?.source === source) return known.exact;
  let exact;
  try { exact = JSON.stringify(unpack(tuple, pack)) === JSON.stringify(player); } catch { exact = false; }
  exactPacks.set(player, { source, exact });
  return exact;
}

function packCampaign(data) {
  // A basketball season's players are plain records, as the built-in clubs' are: nothing to pack.
  const kind = data.settings?.dataSet != null ? setKindOf(data.settings.dataSet) : null;
  if (kind != null && Object.hasOwn(SET_PACKS, kind)) return packSetCampaign(data, kind);
  if (!isDomesticScope(data.settings?.clubScope)) return data;
  const first = Object.values(data.teams || {}).flatMap(team => team?.squad || []).find(player => fmPlayer(player));
  if (!first) return data;
  const { edition, version, snapshotDate } = first.sourceInfo;
  const pack = { source: { edition, version, snapshotDate }, clubs: [] }, clubs = new Map();
  const packed = mapPlayers(data, player => {
    if (!fmPlayer(player, pack.source)) return player;
    const { name, pos, rating, gen, sourceInfo, id, positions, ...extras } = player;
    if (!clubs.has(sourceInfo.club)) clubs.set(sourceInfo.club, pack.clubs.push(sourceInfo.club) - 1);
    const tuple = [Number(sourceInfo.id.slice(3)), name, sourceInfo.rawRating, sourceInfo.naturalPositions.join(','),
      sourceInfo.nationality || 0, clubs.get(sourceInfo.club)];
    if (Object.keys(extras).length) tuple.push(extras);
    return packsExactly(player, tuple, pack) ? tuple : player;
  });
  return { ...packed, playerPack: pack };
}

function unpackCampaign(data, invalid) {
  const { playerPack: pack, ...rest } = data;
  if (record(pack) && Object.hasOwn(SET_PACKS, pack.kind ?? '')) return unpackSetCampaign(rest, pack, invalid);
  if (!record(pack) || pack.kind !== undefined || !record(pack.source) || !['version', 'snapshotDate'].every(key => typeof pack.source[key] === 'string')
      || (pack.source.edition != null && typeof pack.source.edition !== 'string')
      || !Array.isArray(pack.clubs) || pack.clubs.some(club => typeof club !== 'string')) invalid('Campaign squads are incomplete.');
  return mapPlayers(rest, value => {
    if (!Array.isArray(value)) return value;
    const [, , , positions, , club, extras] = value;
    // Own keys only: 'constructor' must not pass as a position.
    if (value.length < 6 || value.length > 7 || typeof positions !== 'string' || !positions.split(',').every(key => Object.hasOwn(FM_ROLES, key))
        || !Number.isInteger(club) || club < 0 || club >= pack.clubs.length || (value.length === 7 && !record(extras))) invalid('Campaign squads are incomplete.');
    try { return unpackPlayer(value, pack); } catch { return invalid('Campaign squads are incomplete.'); }
  });
}

// A data set campaign's players come from the set's own database (a CM 01/02 database, or one of EA's editions for
// the built-in earlier seasons) and match no bundled roster. Its checkpoints store each one as the set's own tuple
// (cmTupleOf's or eaTupleOf's, then extras?) under `playerPack: { kind, source }`, so a save resumes without the data
// set. A player whose record would not rebuild exactly stays in full. A pack without `kind` is the country campaigns'
// FM pack.
const optionalText = value => value === undefined || (typeof value === 'string' && value.trim().length > 0);
const text = value => typeof value === 'string';
// Per kind: the player source, the pack's source block taken from a player's record (null when it has none), the
// tuple and its length, and the position keys a tuple may hold.
const SET_PACKS = {
  // The database's provider, when its data set names one (expandSetPlayer credits each player with it).
  cm0102: {
    source: CM_SOURCE, size: 8, roles: CM_ROLES, tupleOf: cmTupleOf,
    sourceOf: info => (['edition', 'version', 'snapshotDate', 'url'].every(key => text(info[key])) && optionalText(info.provider)
      ? Object.fromEntries(['provider', 'edition', 'version', 'snapshotDate', 'url'].filter(key => info[key] !== undefined).map(key => [key, info[key]]))
      : null),
    valid: source => ['edition', 'version', 'snapshotDate', 'url'].every(key => text(source[key])) && optionalText(source.provider),
  },
  // EA's roster id lives in each player's SoFIFA link.
  ea: {
    source: EA_SOURCE, size: 9, roles: EA_ROLES, tupleOf: eaTupleOf,
    sourceOf: info => (text(info.edition) && Number.isInteger(info.update) && text(info.snapshotDate) && eaRosterOf(info.url)
      ? { edition: info.edition, update: info.update, snapshotDate: info.snapshotDate, roster: eaRosterOf(info.url) } : null),
    valid: source => text(source.edition) && Number.isInteger(source.update) && text(source.snapshotDate) && /^\d{6}$/.test(source.roster),
  },
};

/** Whether `player` is a record of this kind's database, from `source` when one is given. */
function setPlayer(player, kind, source) {
  if (!record(player) || typeof player.name !== 'string' || !record(player.sourceInfo) || player.sourceInfo.source !== SET_PACKS[kind].source) return false;
  const own = SET_PACKS[kind].sourceOf(player.sourceInfo);
  return !!own && (!source || JSON.stringify(own) === JSON.stringify(source));
}

function unpackSetPlayer(packed, pack) {
  const { size } = SET_PACKS[pack.kind];
  const [, pos, rating, sourceInfo] = expandSetPlayer(packed.slice(0, size), pack.source, pack.kind);
  return { name: packed[1], pos, rating, gen: false, sourceInfo, id: sourceInfo.id, positions: [...sourceInfo.positions], ...packed[size] };
}

function packSetCampaign(data, kind) {
  const first = Object.values(data.teams || {}).flatMap(team => team?.squad || []).find(player => setPlayer(player, kind));
  if (!first) return data;
  const pack = { kind, source: SET_PACKS[kind].sourceOf(first.sourceInfo) };
  const packed = mapPlayers(data, player => {
    if (!setPlayer(player, kind, pack.source)) return player;
    const { name, pos, rating, gen, sourceInfo, id, positions, ...extras } = player;
    const tuple = SET_PACKS[kind].tupleOf(name, sourceInfo);
    if (!tuple) return player;
    if (Object.keys(extras).length) tuple.push(extras);
    return packsExactly(player, tuple, pack, unpackSetPlayer) ? tuple : player;
  });
  return { ...packed, playerPack: pack };
}

function unpackSetCampaign(rest, pack, invalid) {
  const { size, roles, valid } = SET_PACKS[pack.kind];
  if (!record(pack.source) || !valid(pack.source)) invalid('Campaign squads are incomplete.');
  return mapPlayers(rest, value => {
    if (!Array.isArray(value)) return value;
    const positions = value[4];
    // Own keys only, as for FM: the tuple expansions alone would drop an unknown key instead of refusing it.
    if (value.length < size || value.length > size + 1 || typeof positions !== 'string'
        || !positions.split(',').every(key => Object.hasOwn(roles, key))
        || (value.length === size + 1 && !record(value[size]))) invalid('Campaign squads are incomplete.');
    try { return unpackSetPlayer(value, pack); } catch { return invalid('Campaign squads are incomplete.'); }
  });
}

/** The portable text of a checkpoint, used for exports (country campaigns pack their players). */
export function serializeCampaign(data, space) {
  return JSON.stringify(packCampaign(data), null, space);
}

// ---------- v4: bundled roster sources by id ----------
// A sourced roster player carries ~380 characters of `sourceInfo` (the database export's identity and rating
// evidence): three quarters of a world checkpoint, and every claimed or replaced player copies it into history. The
// bundled national rosters and clubs already hold it by id, so a stored checkpoint keeps `sourceInfo: '<id>'` for every
// copy that still equals its roster entry, and parseCampaign rebuilds it. Anything else (another roster snapshot's data,
// edited data, a country campaign's FM players) is stored as before. Exports keep sources inline: a file can outlive
// the bundle it was played with.
const rosterSources = new Map();

/** Source id → the bundled metadata JSON of one sport's national rosters and clubs (built once per sport). */
function sourceIndex(sportId) {
  const sport = getSport(sportId);
  let index = rosterSources.get(sport.id);
  if (!index) {
    index = new Map();
    const add = players => {
      for (const [, , , meta] of players || []) if (typeof meta?.id === 'string' && !index.has(meta.id)) index.set(meta.id, JSON.stringify(meta));
    };
    for (const roster of Object.values(sport.rosters || {})) add(roster?.[2]);
    for (const club of sport.clubs || []) add(club?.squad);
    rosterSources.set(sport.id, index);
  }
  return index;
}

/** Each `sourceInfo` object → its id when it equals the roster entry, else false (squads share these objects). */
const sourceRefs = new WeakMap();

function referenceSource(player, index) {
  const info = player?.sourceInfo;
  if (!record(info) || typeof info.id !== 'string') return player;
  let ref = sourceRefs.get(info);
  if (ref === undefined) {
    ref = index.get(info.id) === JSON.stringify(info) ? info.id : false;
    sourceRefs.set(info, ref);
  }
  return ref ? { ...player, sourceInfo: ref } : player;
}

/**
 * A referenced player gets a fresh copy of its roster entry in the same key position (squads are compared as JSON);
 * a source the bundle no longer has is left out.
 */
function rebuildSource(player, index) {
  if (typeof player?.sourceInfo !== 'string') return player;
  const json = index.get(player.sourceInfo);
  if (json) return { ...player, sourceInfo: JSON.parse(json) };
  const { sourceInfo: _missing, ...rest } = player;
  return rest;
}

/** The stored text of a checkpoint: the portable form with bundled roster sources as references. */
function checkpointText(data) {
  const packed = packCampaign(data), index = sourceIndex(data.settings?.sport);
  return JSON.stringify(index.size ? mapPlayers(packed, player => referenceSource(player, index)) : packed);
}

/** Validate every value used by resume before touching the current campaign. */
export function parseCampaign(text) {
  return validateCampaign(JSON.parse(text), true);
}

/**
 * parseCampaign's checks on a campaign object, optionally without rebuilding roster sources. A save checks the
 * snapshot it is about to write this way, as plain data: JSON keeps every value these checks read (a NaN or a
 * dropped undefined fails them either way), so parsing the text again would only rebuild the same campaign.
 */
function validateCampaign(input, rebuildSources) {
  let data = input;
  const invalid = message => { throw new Error(message); };
  if (record(data) && data.playerPack !== undefined) data = unpackCampaign(data, invalid);
  if (!record(data) || ![1, 2, 3, 4, 5].includes(data.v) || !record(data.teams)
      || !record(data.own) || !record(data.settings) || !Array.isArray(data.aliveIds)
      || data.aliveIds.length < 1 || data.aliveIds.length > 200) {
    invalid('This file is not a supported Imperialism campaign.');
  }
  const teams = Object.entries(data.teams), known = id => typeof id === 'string' && Object.hasOwn(data.teams, id);
  // Owners once, as sets: rebuilding Object.values(own) for every surviving team was most of a save's garbage.
  const owners = Object.values(data.own), holding = new Set(owners), alive = new Set(data.aliveIds);
  if (!teams.length || teams.length > 200 || teams.some(([id, team]) => !record(team)
      || (team.id != null && team.id !== id) || typeof team.name !== 'string' || !team.name.trim()
      || !Array.isArray(team.squad) || team.squad.length > 250
      || team.squad.some(p => !record(p) || typeof p.name !== 'string' || !p.name.trim()
        || !Number.isFinite(p.rating) || p.rating < 0 || p.rating > 120 || typeof p.pos !== 'string'
        || (p.positions != null && (!Array.isArray(p.positions) || p.positions.some(pos => typeof pos !== 'string')))))
      || data.aliveIds.some(id => !known(id)) || alive.size !== data.aliveIds.length
      || owners.some(id => !known(id) || !alive.has(id))) {
    invalid('Campaign teams or territory data are incomplete.');
  }
  if (!owners.length || data.aliveIds.some(id => !holding.has(id))) {
    invalid('Every surviving team must own territory.');
  }
  const settings = data.settings;
  const enums = { sport: SPORT_LIST.map(sport => sport.id), layer: ['nations', 'clubs'], pacing: ['duel', 'blitz', 'chaos'],
    resolution: ['ticker', 'instant'], role: ['spectator', 'manager'], uncertainty: ['predictable', 'balanced', 'wild'],
    finale: ['single', 'best-of-three'], acquisitionPolicy: ['best-fit', 'highest-rated'], rosterPreset: ['authentic', 'competitive'],
    turnOrder: ['round-robin', 'random'], targeting: ['player', 'compass'] };
  for (const configuration of [settings, data.initialSettings].filter(Boolean)) {
    for (const [key, values] of Object.entries(enums)) if (configuration[key] != null && !values.includes(configuration[key])) invalid(`Campaign ${key} setting is unsupported.`);
    if (configuration.managedTeamId != null && configuration.managedTeamId !== '' && !known(configuration.managedTeamId)) invalid('The managed team setting is unavailable.');
    // A country campaign names its map ('domestic:826') and the map build it was played on.
    const { clubScope, domesticVersion } = configuration;
    const domestic = isDomesticScope(clubScope);
    if (typeof clubScope === 'string' && clubScope.startsWith(DOMESTIC_PREFIX)
        && (!domestic || !/^[0-9A-Za-z]{1,12}$/.test(domesticScopeId(clubScope)))) invalid('Campaign country setting is unsupported.');
    if (domesticVersion != null && (typeof domesticVersion !== 'string' || !/^[0-9A-Za-z]{1,12}-[0-9a-f]{8}$/.test(domesticVersion)
        || (domestic && !domesticVersion.startsWith(`${domesticScopeId(clubScope)}-`)))) invalid('Campaign map version is invalid.');
    // A data set campaign names the set, the build it was played on and its season, or none of them. A set plays in its
    // own sport: a football one never on a country map (those use the built-in data), a basketball one with clubs on
    // its era's map, which no other campaign plays on.
    const { dataSet, dataVersion, dataYear, dataSeason } = configuration;
    const sport = getSport(configuration.sport).id;
    if (dataSet == null ? [dataVersion, dataYear, dataSeason].some(value => value != null) || (domestic && isEraMap(domesticScopeId(clubScope)))
      : !isFootballSetId(dataSet) || setSportOf(dataSet) !== sport
        || (sport === 'football' ? domestic : configuration.layer !== 'clubs' || !domestic || domesticScopeId(clubScope) !== seasonMapOf(dataSet))
        || typeof dataVersion !== 'string' || !new RegExp(`^${dataSet}-[0-9a-f]{8}$`).test(dataVersion)
        || !isDataYear(dataYear) || dataSeason !== seasonOf(dataYear)) invalid('Campaign data set is invalid.');
  }
  for (const key of ['round', 'matches', 'batchTotal', 'revision']) if (data[key] != null && !nonnegative(data[key])) invalid(`Campaign ${key} is invalid.`);
  for (const key of ['seed', 'rngState']) if (data[key] != null && !uint(data[key])) invalid('The saved random state is invalid.');
  if (data.v >= 2 && (!uint(data.seed) || !uint(data.rngState))) invalid('The saved random state is missing or invalid.');
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
        || [...m.allEv, ...m.shown].some(e => !record(e) || !Number.isFinite(e.m) || e.m < 0 || ![m.aId, m.dId].includes(e.tid))) invalid('The saved match is incomplete.');
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
    if (choice.selected != null && !choice.candidates.some(candidate => candidate.index === choice.selected)) invalid('The saved signing selection is unavailable.');
  }
  // Round robin (DEC D3): the cycle's order (eliminated entries are kept and skipped) and the next entry to play.
  const validTurn = (queue, index) => Array.isArray(queue) && queue.length <= 200 && queue.every(known)
    && Number.isInteger(index) && index >= 0 && index <= queue.length;
  if (data.turnQueue != null && (!Array.isArray(data.turnQueue) || data.turnQueue.length > 200 || !data.turnQueue.every(known))) invalid('The saved turn order references an unavailable team.');
  if (data.turnIndex != null && !validTurn(data.turnQueue ?? [], data.turnIndex)) invalid('The saved turn position is invalid.');
  if (data.pendingTarget != null) {
    const target = data.pendingTarget, alive = id => known(id) && data.aliveIds.includes(id);
    if (!record(target) || !alive(target.attackerId) || !Array.isArray(target.optionIds) || !target.optionIds.length
        || target.optionIds.length > 200 || new Set(target.optionIds).size !== target.optionIds.length
        || target.optionIds.some(id => !alive(id) || id === target.attackerId) || !target.optionIds.includes(target.selectedId)
        || !nonnegative(target.round)) invalid('The saved target choice references an unavailable team.');
    if ((target.openedAt != null && (!Number.isFinite(target.openedAt) || target.openedAt < 0))
        || (target.resumeAutoplay != null && typeof target.resumeAutoplay !== 'boolean')
        || (target.turn != null && (!record(target.turn) || !validTurn(target.turn.turnQueue, target.turn.turnIndex)
          || !nonnegative(target.turn.round) || typeof target.turn.newRound !== 'boolean'
          || (target.turn.attackerId != null && target.turn.attackerId !== target.attackerId)))) invalid('The saved target choice is incomplete.');
    if ((data.match && !data.match.applied) || data.spin || data.choice || data.tacticalChoice) invalid('The saved target choice overlaps another pending decision.');
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
  // Saves from before turn modes (v1/v2) played the original random draw with compass targets.
  const rules = configuration => configuration && { ...configuration,
    turnOrder: configuration.turnOrder ?? 'random', targeting: configuration.targeting ?? 'compass' };
  // v4 source references; v1–v3 saves hold every source inline and pass through unchanged.
  const index = rebuildSources ? sourceIndex(settings.sport) : null;
  const sourced = index?.size ? mapPlayers(data, player => rebuildSource(player, index)) : data;
  // Before v5 the world map's 826 was the whole United Kingdom: its holder keeps Scotland, Wales and Northern Ireland.
  // A country map's sections are never world shape ids.
  const ukHolder = data.v < 5 && data.own['826'];
  const own = ukHolder ? { ...data.own, ...Object.fromEntries(HOME_NATIONS.map(id => [id, ukHolder])) } : data.own;
  return { ...sourced, v: SAVE_VERSION, own, history: sourced.history || [], log: data.log || [],
    settings: rules(data.settings), ...(data.initialSettings ? { initialSettings: rules(data.initialSettings) } : {}),
    turnQueue: data.turnQueue || [], turnIndex: data.turnIndex || 0, pendingTarget: data.pendingTarget || null,
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
  const raw = localStorage.getItem(CAMPAIGN_INDEX_KEY);
  let parsed = null;
  try { parsed = JSON.parse(raw || '[]'); } catch { /* damaged: rebuilt below */ }
  if (Array.isArray(parsed)) return parsed.filter(item => record(item) && typeof item.id === 'string');
  // A damaged index is rebuilt from the slots themselves: it used to fail every autosave and hide every campaign.
  return storedSlotIds().map(id => tryParse(localStorage.getItem(campaignStorageKey(id))))
    .filter(Boolean).map(campaignMetadata);
}

/** Ids of the campaign slots in storage (not their backups). */
function storedSlotIds() {
  const prefix = campaignStorageKey(''), ids = [];
  for (let i = 0; i < (Number(localStorage.length) || 0); i++) {
    const key = localStorage.key?.(i);
    if (typeof key === 'string' && key.startsWith(prefix) && !key.endsWith(':backup')) ids.push(key.slice(prefix.length));
  }
  return ids;
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

// Quota errors by name or legacy code, plus any error naming the quota (older engines, test doubles).
const isQuotaError = error => ['QuotaExceededError', 'NS_ERROR_DOM_QUOTA_REACHED'].includes(error?.name)
  || /quota/i.test(`${error?.name} ${error?.message}`) || error?.code === 22 || error?.code === 1014;

const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Whether `data` continues the id-less (legacy) campaign in the resume pointer: resuming such a save gives the running
 * campaign a fresh id, and its first checkpoint must replace the singleton rather than migrate a frozen second copy
 * of the same campaign. Resume keeps the save's seed and start time (stamping one when the save has none); a new
 * campaign started over a legacy save has its own, and it lacks the legacy's played matches (or, before any match,
 * its squads), so it is always archived.
 */
function continuesLegacy(legacy, data) {
  if (!legacy || legacy.campaignId || data.seed !== legacy.seed || !Number.isFinite(data.startedAt)) return false;
  if (Number.isFinite(legacy.startedAt) && data.startedAt !== legacy.startedAt) return false;
  const teams = data.teams || {}, own = data.own || {}, alive = new Set(legacy.aliveIds);
  if (!Object.keys(legacy.teams).every(id => Object.hasOwn(teams, id)) || !Object.keys(legacy.own).every(cid => Object.hasOwn(own, cid))
      || !(data.aliveIds || []).every(id => alive.has(id))) return false;
  if (!(legacy.matches > 0)) return sameJson(teams, legacy.teams) && sameJson(own, legacy.own);
  if ((data.matches || 0) < legacy.matches) return false;
  // History ids (`match-N`) repeat across campaigns: the pairings and winners must match too.
  const history = new Map((data.history || []).map(entry => [entry?.id, entry]));
  return legacy.history.every(entry => {
    const mine = history.get(entry.id);
    return !!mine && mine.aId === entry.aId && (mine.dId ?? mine.bId) === (entry.dId ?? entry.bId) && mine.winnerId === entry.winnerId;
  });
}

/**
 * The checkpoint text this tab last wrote, with the campaign id and revision it holds. A save reads back the slot
 * and the resume pointer first; while one still holds exactly this text (nothing else wrote since, the usual
 * case), what parsing it would say is already known. Any other text is parsed as before.
 */
let lastWritten = null;
const writtenSummary = text => (text != null && text === lastWritten?.text ? lastWritten : null);

/** Compare-and-save prevents a stale tab from replacing a newer checkpoint. */
export function writeSave(state, { activate = true } = {}) {
  try {
    const data = campaignSnapshot(state);
    data.campaignId ||= createCampaignId();
    data.campaignName = cleanName(state.campaignName);
    const key = campaignStorageKey(data.campaignId), previous = localStorage.getItem(key);
    if (previous) {
      const known = writtenSummary(previous), remote = known ? null : parseCampaign(previous);
      if ((known || remote).revision !== (state.revision || 0)) return { ok: false, savedAt: null, conflict: remote || parseCampaign(previous),
        message: 'This campaign changed in another tab. Reload that checkpoint or fork your current progress.' };
    }
    data.revision = (state.revision || 0) + 1;
    validateCampaign(data, false);
    const text = checkpointText(data);
    const index = indexData().filter(item => item.id !== data.campaignId);
    index.unshift(campaignMetadata(data));
    const current = localStorage.getItem(SAVE_KEY);
    // A pointer holding this tab's last checkpoint is that campaign (never a legacy singleton: it has an id).
    const currentCampaign = writtenSummary(current) || tryParse(current);
    const updatePointer = activate || currentCampaign?.campaignId === data.campaignId;
    const kept = [];
    if (updatePointer && currentCampaign && !currentCampaign.campaignId && !continuesLegacy(currentCampaign, data)) {
      // A legacy singleton must remain reachable when a new campaign starts (not when it is the campaign being
      // saved: resuming it gave it a fresh id, and this checkpoint replaces it).
      const migrated = { ...currentCampaign, campaignId: createCampaignId(), revision: 1,
        campaignName: cleanName(currentCampaign.campaignName || `${currentCampaign.settings.sport || 'Football'} legacy campaign`) };
      kept.push([campaignStorageKey(migrated.campaignId), checkpointText(migrated)]);
      index.push(campaignMetadata(migrated));
    } else if (updatePointer && current && !currentCampaign) {
      // Retain damaged bytes even when the player chooses to start a fresh run.
      kept.push([CAMPAIGN_DAMAGED_KEY, current]);
    }
    // Recovery copies rotate first and the index precedes its slot. Each attempt
    // is all or nothing, so a failed save leaves no slot ahead of the app's
    // revision (a false "changed in another tab") and no index entry without a slot.
    const steps = (slotCopy, pointerCopy) => [...kept,
      ...(slotCopy && previous ? [[backupKey(data.campaignId), previous]] : []),
      ...(pointerCopy && currentCampaign && updatePointer ? [[CAMPAIGN_BACKUP_KEY, current]] : []),
      [CAMPAIGN_INDEX_KEY, JSON.stringify(index)], [key, text], ...(updatePointer ? [[SAVE_KEY, text]] : [])];
    const saved = message => {
      lastWritten = { text, campaignId: data.campaignId, revision: data.revision };
      return { ok: true, campaignId: data.campaignId, revision: data.revision, campaignName: data.campaignName,
        savedAt: data.savedAt, message };
    };
    try {
      // Both keys were just read: the first attempt need not read them again for its undo values.
      writeAll(steps(true, true), new Map([[key, previous], [SAVE_KEY, current]]));
      return saved('Progress saved');
    } catch (error) {
      if (!isQuotaError(error)) throw error;
    }
    // Storage is full: only this campaign's own recovery copies may go, one at a time (first the resume pointer's
    // copy, which duplicates the slot's, then the slot's). Every other campaign's copies, damaged or not, stay.
    const pointerCopy = tryParse(localStorage.getItem(CAMPAIGN_BACKUP_KEY))?.campaignId === data.campaignId
      ? [[CAMPAIGN_BACKUP_KEY, null]] : [];
    for (const [entries, message] of [
      [[...pointerCopy, ...steps(true, false)], 'Progress saved'],
      [[...pointerCopy, [backupKey(data.campaignId), null], ...steps(false, false)],
        `Progress saved without a recovery copy: browser storage is nearly full. ${FREE_SPACE}`],
    ]) {
      try {
        writeAll(entries);
        return saved(message);
      } catch (error) {
        if (!isQuotaError(error)) throw error;
      }
    }
    return { ok: false, quota: true, savedAt: null, message: `Progress could not be saved: browser storage is full. ${FREE_SPACE}` };
  } catch {
    return { ok: false, savedAt: null, message: 'Progress could not be saved. Export your campaign to keep it.' };
  }
}

const FREE_SPACE = 'Delete campaigns you no longer need in Saved campaigns, or export this one to keep it.';

/**
 * Apply writes in order (null removes); if any fails, put every key back as it was and rethrow. `stored` holds
 * values the caller has just read (key → text or null), so those keys are not read again for the undo.
 */
function writeAll(entries, stored) {
  const done = [];
  const values = new Map(stored);
  try {
    for (const [key, value] of entries) {
      const before = values.has(key) ? values.get(key) : localStorage.getItem(key);
      if (value == null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
      values.set(key, value ?? null);
      done.push([key, before]);
    }
  } catch (error) {
    // Undoing in reverse retraces sizes that already fitted, so it cannot hit the quota.
    for (const [key, before] of done.reverse()) {
      try { if (before == null) localStorage.removeItem(key); else localStorage.setItem(key, before); } catch { /* keep undoing */ }
    }
    throw error;
  }
}

/**
 * Delete a campaign for good: its checkpoint, recovery copy and list entry, and
 * the quick-resume pointer and its copy when they hold this campaign.
 */
export function deleteCampaign(id) {
  try {
    const holds = key => tryParse(localStorage.getItem(key))?.campaignId === id;
    writeAll([[CAMPAIGN_INDEX_KEY, JSON.stringify(indexData().filter(item => item.id !== id))],
      [campaignStorageKey(id), null], [backupKey(id), null],
      ...[SAVE_KEY, CAMPAIGN_BACKUP_KEY].filter(holds).map(key => [key, null])]);
    return { ok: true, message: 'Campaign deleted' };
  } catch {
    return { ok: false, message: 'The campaign could not be deleted. Browser storage is unavailable.' };
  }
}

export function renameCampaign(id, name) {
  const campaign = loadCampaign(id);
  return writeSave({ ...campaign, campaignName: cleanName(name) }, { activate: false });
}

export function exportCampaign(state) { return serializeCampaign(campaignSnapshot(state), 2); }

const sectionCount = (n, noun = 'section') => `${n} of its ${noun}s ${n === 1 ? 'is' : 'are'}`;

/**
 * Fit a country campaign to the loaded build of its map: `{ campaign }`, or
 * `{ error }` with the save left as it is. Section ids follow club rank, so a
 * rebuild can give an id to another club's land. A save from another build is
 * therefore moved club by club: a club's starting sections always share one
 * holder (a conquest takes everything), so all of its new starting sections go
 * to whoever held its old home section. It must have exactly the map's clubs.
 */
export function fitDomesticCampaign(campaign, { meta, clubs, sectionNames }) {
  const refuse = reason => ({ error: `This campaign no longer matches the map of ${meta.name}: ${reason}, so it cannot resume. The save is kept.` });
  const teams = Object.entries(campaign.teams || {});
  if (campaign.settings?.domesticVersion === meta.version) {
    const known = id => typeof id === 'string' && Object.hasOwn(sectionNames, id);
    const missing = new Set([...Object.keys(campaign.own || {}), ...teams.map(([, team]) => team?.home)].filter(id => !known(id)));
    return missing.size ? refuse(`${sectionCount(missing.size)} missing`) : { campaign };
  }
  const rowOf = new Map(clubs.map(club => [club.id, club]));
  const clubOf = ([id, team]) => team?.origin || id;
  const missing = teams.filter(entry => !rowOf.has(clubOf(entry)));
  if (missing.length) return refuse(`${sectionCount(missing.length, 'club')} not on the updated map`);
  const saved = new Set(teams.map(clubOf));
  const added = clubs.filter(club => !saved.has(club.id)).length;
  if (added) return refuse(`the updated map adds ${added} club${added === 1 ? '' : 's'} it never had`);
  // The old map's ids are <country>-001.. in club rank order, each club's
  // starting group running from its home, so a section belongs to the last home at or before it.
  const own = campaign.own || {}, ownEntries = Object.entries(own), prefix = `${domesticScopeId(campaign.settings?.clubScope)}-`;
  const rank = id => typeof id === 'string' && id.startsWith(prefix) && /^\d{3}$/.test(id.slice(prefix.length))
    ? Number(id.slice(prefix.length)) : NaN;
  const roots = teams.map(entry => [rank(entry[1]?.home), entry]).sort((a, b) => a[0] - b[0]);
  if (roots.some(([r], i) => !(r >= 1) || r === roots[i - 1]?.[0])) return refuse('its clubs do not each start on their own section');
  const groupOf = id => {
    const r = rank(id);
    let found = null;
    for (const [root, entry] of roots) {
      if (!(root <= r)) break;
      found = entry;
    }
    return found;
  };
  const strays = ownEntries.filter(([section]) => !(rank(section) <= ownEntries.length) || !groupOf(section)).length;
  if (strays) return refuse(`${sectionCount(strays)} not on the map it was played on`);
  const unheld = roots.filter(([, entry]) => !Object.hasOwn(own, entry[1].home)).length;
  if (unheld) return refuse(`${unheld} of its clubs' home sections ${unheld === 1 ? 'has' : 'have'} no holder`);
  if (ownEntries.some(([section, owner]) => own[groupOf(section)[1].home] !== owner)) return refuse("its holdings do not follow its clubs' starting sections");
  const startsOf = entry => { const row = rowOf.get(clubOf(entry)); return row.startSections || [row.homeSection]; };
  // An old section id -> every new starting section of the club that started there.
  const move = ids => Array.isArray(ids) ? [...new Set(ids.flatMap(id => groupOf(id) ? startsOf(groupOf(id)) : []))] : ids;
  const withTerritories = value => value && Array.isArray(value.territoryIds) ? { ...value, territoryIds: move(value.territoryIds) } : value;
  return { campaign: {
    ...campaign,
    own: Object.fromEntries(teams.flatMap(entry => startsOf(entry).map(section => [section, own[entry[1].home]]))),
    teams: Object.fromEntries(teams.map(entry => [entry[0], { ...entry[1], home: rowOf.get(clubOf(entry)).homeSection }])),
    conquestIds: move(campaign.conquestIds),
    match: withTerritories(campaign.match),
    history: (campaign.history || []).map(entry => entry?.result ? { ...entry, result: withTerritories(entry.result) } : entry),
  } };
}

/** Discard only the resume pointer; named campaigns and recovery copies stay intact. */
export function clearSave() {
  try { localStorage.removeItem(SAVE_KEY); return true; } catch { return false; }
}
