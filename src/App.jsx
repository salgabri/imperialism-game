import React from 'react';
import { CONFIG } from './config.js';
import { C } from './theme.js';
import { DEPENDENCIES, NATIONS, SCOPES, buildClub, buildTeam, makeRng, hashStr, selectLineup, squadAverage, teamEff } from './data/teams.js';
import { CLUB_SCOPES } from './data/scopes.js';
import { CAPITALS } from './data/capitals.js';
import { WorldGeometry, projPt } from './engine/geo.js';
import { createFlagRegionIndex, FLAG_REGION_GAP_KM } from './engine/flagRegions.js';
import { getSport } from './sports/index.js';
import { drawBlitzPairs, drawChaosPairs, empireNeighbors, seedClubs } from './engine/campaign.js';
import { clearSave, loadSave, writeSave, parseCampaign, exportCampaign, inspectSave, listCampaigns,
  inspectCampaign, renameCampaign, forkCampaign, createCampaignId, detectSaveConflict, isCampaignStorageEvent } from './engine/storage.js';
import { PlaybackClock } from './engine/playbackClock.js';
import { tacticalMatchParameters, tacticalOptions, competitiveBasketballTeams } from './engine/managerStrategy.js';
import { SessionEngagement, engagementMode } from './engine/sessionEngagement.js';
import { estimateWinProbability, UNCERTAINTY_PRESETS } from './engine/odds.js';
import { createMinuteStore } from './engine/liveMinute.js';
import { displayRound, plainScopeName, roman, signedDelta } from './viewModels/format.js';
import { buildMasthead } from './viewModels/masthead.js';
import { DEFAULT_SETUP, LOG_CAP } from './app/shared.js';
import * as mapM from './app/mapMethods.jsx';
import * as colM from './app/columnMethods.jsx';
import * as matchM from './app/matchMethods.jsx';
import * as squadM from './app/squadMethods.jsx';
import * as conqM from './app/conquestMethods.jsx';
import * as turnM from './app/turnMethods.jsx';
import * as ledgerM from './app/ledgerMethods.jsx';
import TacticalChoice from './components/TacticalChoice.jsx';
import ManagerElimination from './components/ManagerElimination.jsx';
import CampaignStorageDialog from './components/CampaignStorageDialog.jsx';
import ExportCheckpoint from './components/ExportCheckpoint.jsx';
import CommandBar, { SettingsPanel } from './components/CommandBar.jsx';
import PlaybackBar from './components/PlaybackBar.jsx';
import WorldMap from './components/WorldMap.jsx';
import MatchCard from './components/MatchCard.jsx';
import SetupOverlay from './components/SetupOverlay.jsx';
import VictoryOverlay from './components/VictoryOverlay.jsx';
import { Toast } from './components/Popups.jsx';
import { PhoneBar, PhoneTabBar, PhoneMoreSheet } from './components/PhoneChrome.jsx';
import TurnStrip from './screens/turns/TurnStrip.jsx';
import TargetPanel from './screens/turns/TargetPanel.jsx';
import SpectatorPanel from './screens/turns/SpectatorPanel.jsx';
import CampaignColumn from './screens/campaign/CampaignColumn.jsx';
import MapOverlays from './screens/campaign/MapOverlays.jsx';
import Ticker from './screens/campaign/Ticker.jsx';
import ConquestScreen from './screens/conquest/ConquestScreen.jsx';
import SquadScreen from './screens/squad/SquadScreen.jsx';
import MatchScreen from './screens/match/MatchScreen.jsx';
import LedgerScreen from './screens/ledger/LedgerScreen.jsx';
import ChronicleScreen from './screens/ledger/ChronicleScreen.jsx';

const MAP_URL = `${import.meta.env.BASE_URL}world-110m.v1.json`;
const ATLAS_URL = `${import.meta.env.BASE_URL}countries-50m.json`;
/** True unless `a` and `b` are the same value or objects with the same keys holding identical values. */
function contentChanged(a, b) {
  if (a === b) return false;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return true;
  const keys = Object.keys(a);
  return keys.length !== Object.keys(b).length || keys.some(key => !Object.prototype.hasOwnProperty.call(b, key) || a[key] !== b[key]);
}

/** Screens the masthead nav and the phone tab bar can choose (DEC D11). */
const VIEWS = ['map', 'squad', 'match', 'ledger', 'chronicle'];
/**
 * Focus targets that keep their own Space behaviour (A-8). The phone More sheet takes focus when it opens: Space
 * there scrolls the sheet instead of advancing the campaign out of sight behind it.
 */
const SPACE_IGNORE = 'input, select, textarea, summary, a, button, [contenteditable], [role=button], [role=tab], [role=radio], '
  + '[role=switch], [role=dialog], [role=menu], .more-sheet';

export default class App extends React.Component {
  state = {
    phase: 'loading',
    err: null,
    setup: { ...DEFAULT_SETUP },
    settings: { ...DEFAULT_SETUP },
    teams: {},
    own: {},
    aliveIds: [],
    fallen: [],
    stats: {},
    round: 0,
    matches: 0,
    log: [],
    match: null,
    spin: null,
    atk: null,
    queue: [],
    batchTotal: 0,
    autoplay: false,
    speed: 1,
    tab: 'power',
    mapMode: mapM.DEFAULT_MAP_MODE,
    selected: null,
    hoverCid: null,
    flash: {},
    confirmNew: false,
    hasSave: false,
    savedMeta: null,
    pu: null,
    toast: null,
    battles: [],
    paused: false, followedId: null, pauseFollow: false, history: [], selectedHistoryId: null,
    choice: null, series: null, seed: null, rngState: null, saveStatus: null, exportText: null, exportFilename: null,
    conquestIds: [], focusBounds: null, focusKey: 0, startedAt: null, completedAt: null,
    metrics: { leaderChanges: 0, acquisitions: [], previousLeader: null },
    managedTeamId: null, managementEnded: false, managerElimination: null, tacticalChoice: null,
    historyFilter: '', decisionLedger: [], initialSettings: null,
    campaignId: null, revision: 0, campaignName: '', storageDialog: null, storageConflict: false,
    // Saved turn-mode state (DEC D3, D8; WP-TURN adds it to campaignSnapshot and validation).
    turnQueue: [], turnIndex: 0, pendingTarget: null,
    // UI-only state (never saved, PLAN §3.1).
    view: 'map', viewSource: 'user', squadReturn: null, tacticalPreview: false, phoneSheet: 'collapsed',
    phoneMore: false, wholeMap: false, focusLayout: null, targetHoverId: null,
  };

  engagement = new SessionEngagement();
  openingSeed = Date.now() >>> 0;
  away = false;
  updateEngagement = () => this.engagement.switchMode(engagementMode(this.state,
    this.away || (typeof document !== 'undefined' && document.hidden)));
  handleVisibility = () => this.updateEngagement();
  handleFocus = () => { this.away = false; this.updateEngagement(); };
  handleBlur = () => { this.away = true; this.updateEngagement(); };
  handleStorage = event => {
    if (!isCampaignStorageEvent(event, this.state.campaignId)) return;
    const remote = detectSaveConflict(this.state);
    if (remote) this.openStorageDialog('conflict', { campaign: remote, message: 'This campaign advanced in another tab. Reload its checkpoint or keep your branch in a new slot.' });
  };

  /** Every pending simulation timeout, so a reset or unmount can cancel the war. */
  clock = new PlaybackClock();
  timers = this.clock.tasks;
  drawTimers = new Set();
  drawFrames = new Set();
  activeDrawKey = null;
  startedDrawKey = null;
  lockedDrawKey = null;
  confirmTimer = null;

  mapRef = React.createRef();
  svgRef = React.createRef();
  tipRef = React.createRef();
  coordRef = React.createRef();
  eventsRef = React.createRef();

  /** One memo cache shared by every view-model builder (keys carry the owner prefix, PLAN §0.16). */
  vmCache = new Map();
  /** The live match minute lives outside React state (DEC D7); read through `useLiveMinute`. */
  minuteStore = createMinuteStore();
  minuteToken = null;
  /** Clock tokens of the events, whistle and kicks the current match scheduled (WP-MATCH, A-12). */
  matchTasks = new Set();

  componentDidMount() {
    window.addEventListener('storage', this.handleStorage);
    window.addEventListener('focus', this.handleFocus);
    window.addEventListener('blur', this.handleBlur);
    window.addEventListener('keydown', this.handleKeyDown);
    document.addEventListener('visibilitychange', this.handleVisibility);
    this.boot();
  }

  componentWillUnmount() {
    this.clearTimers();
    clearTimeout(this.confirmTimer);
    if (typeof window !== 'undefined') {
      window.removeEventListener('storage', this.handleStorage);
      window.removeEventListener('focus', this.handleFocus);
      window.removeEventListener('blur', this.handleBlur);
      window.removeEventListener('keydown', this.handleKeyDown);
      document.removeEventListener('visibilitychange', this.handleVisibility);
    }
  }

  componentDidUpdate(_props, previous) {
    this.updateEngagement();
    const el = this.eventsRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    // Save when the match or spin CONTENT changed. Identity alone looped: when a click's sync update (revealAll's
    // patchMatch) is queued behind a timer's not-yet-rendered default-priority update, every sync re-render rebases
    // and re-runs the updater, minting an equal-but-new match; persist's own setState is such a re-render, so an
    // identity test re-saved on every pass until React threw "Maximum update depth exceeded" (smoke, under load).
    if (previous && this.state.phase !== 'setup' && this.state.phase !== 'loading'
        && (contentChanged(previous.match, this.state.match) || contentChanged(previous.spin, this.state.spin))) this.persist();
    // The signing screen and the target panel hold focus while they show; confirming unmounts them.
    if (previous && ((previous.choice && !this.state.choice) || (previous.pendingTarget && !this.state.pendingTarget))) this.focusRescue = true;
    if (this.focusRescue) this.rescueFocus();
  }

  /**
   * After a decision screen unmounts with focus inside it, focus lands on the primary action (masthead or phone bar,
   * whichever is rendered) instead of <body>. A disabled primary (the locked draw after an attack) is retried on later
   * updates until one is enabled; any focus the user moves in the meantime cancels the rescue. DOM only, no timers.
   */
  rescueFocus() {
    if (typeof document === 'undefined' || this.state.phase !== 'playing') { this.focusRescue = false; return; }
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected) { this.focusRescue = false; return; }
    for (const button of document.querySelectorAll('[data-primary]')) {
      if (button.disabled) continue;
      button.focus?.({ preventScroll: true });
      // A primary hidden by CSS (the masthead's on phone, the phone bar's on desktop) does not take focus.
      if (document.activeElement === button) { this.focusRescue = false; return; }
    }
  }

  // ---------- timing ----------

  /** Schedule simulation work, scaled by the speed control and cancellable. */
  after(ms, fn, speed = this.state.speed || 1) {
    return this.clock.after(ms / speed, fn);
  }

  clearTimers() {
    this.clearDraw();
    this.clock.clear();
    this.matchTasks?.clear();
    this.minuteToken = null;
  }

  /** Draw work has its own owner: reset, kickoff and unmount invalidate it. */
  clearDraw() {
    this.activeDrawKey = null;
    this.startedDrawKey = null;
    this.lockedDrawKey = null;
    for (const id of this.drawFrames) cancelAnimationFrame(id);
    for (const id of this.drawTimers) this.clock.remove(id);
    this.drawFrames.clear();
    this.drawTimers.clear();
  }

  drawAfter(ms, key, fn) {
    if (this.activeDrawKey !== key) return null;
    const id = this.after(ms, () => {
      this.drawTimers.delete(id);
      if (this.activeDrawKey === key && this.state.spin?.key === key) fn();
    }, 1); // Durations are already scaled by the draw's captured speed.
    this.drawTimers.add(id);
    return id;
  }

  drawFrame(key, fn) {
    if (this.activeDrawKey !== key) return;
    const id = requestAnimationFrame(() => {
      this.drawFrames.delete(id);
      if (this.activeDrawKey === key && !this.state.paused) fn();
    });
    this.drawFrames.add(id);
  }

  // ---------- boot ----------

  async boot() {
    try {
      const [res, atlas] = await Promise.all([
        fetch(MAP_URL),
        fetch(ATLAS_URL).then(r => r.ok ? r.json() : null).catch(() => null),
      ]);
      if (!res.ok) throw new Error('map fetch ' + res.status);
      this.geo = new WorldGeometry(await res.json(), CAPITALS);
      // Display-only detail keeps targeting, club seeding and existing saves
      // on the original topology. A missing visual atlas falls back gracefully.
      this.displayGeo = atlas ? new WorldGeometry(atlas, CAPITALS) : null;
      this.rng = makeRng((Date.now() % 1000000007) >>> 0);

      const inspection = inspectSave();
      const saved = inspection.campaign || loadSave();
      if (saved) {
        this.saved = saved;
        this.setState({
          hasSave: true,
          savedMeta: { round: saved.round, alive: saved.aliveIds.length, settings: saved.settings },
          saveStatus: { ok: true, savedAt: saved.savedAt, message: 'Saved campaign available' },
        });
      }
      if (inspection.state === 'recovery' || inspection.state === 'unavailable') {
        this.setState({ saveStatus: { ok: false, message: inspection.message },
          ...(inspection.state === 'recovery' ? { storageDialog: { mode: 'recovery', ...inspection } } : {}) });
      }
      this.fitMap(Object.keys(NATIONS));
      this.setState({ phase: 'setup' });
    } catch (e) {
      this.setState({ err: 'MAP DATA FAILED TO LOAD — ' + String((e && e.message) || e) });
    }
  }

  /** The read-only view the campaign rules operate on. */
  board(state = this.state) {
    return { geo: this.geo, routingPaths: this.displayGeo?.paths || this.geo.paths,
      own: state.own, aliveIds: state.aliveIds };
  }

  /**
   * Reframe the map on a set of nations. Bumping the key drops any zoom and pan
   * the player had applied, which would otherwise point at the old theatre.
   */
  fitMap(ids, settings) {
    this.geo.fitTo(ids);
    if (this.displayGeo) {
      const { s, tx, ty } = this.geo.fit;
      this.displayGeo.paths = this.displayGeo.buildPaths(s, tx, ty);
    }
    // Stable display-only geometry lets the label engine cache shape work
    // through ticker updates, hover, selection and camera movements.
    this.labelGeometry = this.geo.countries.map(country => ({
      id: country.id,
      rings: (this.displayGeo?.paths[country.id] || this.geo.paths[country.id]).labelRings,
    }));
    this.flagComponents = createFlagRegionIndex(this.labelGeometry, {
      maxGap: FLAG_REGION_GAP_KM / this.geo.kmPerUnit,
    });
    this.setupFlagOwnership = Object.fromEntries(this.geo.countries
      .filter(country => NATIONS[country.id] || DEPENDENCIES[country.id])
      .map(country => [country.id, country.id]));
    this.flagLayoutCache = null;
    this.viewFocus = null;
    // Russia and overseas islands remain playable, but the European opening
    // camera should show the continent. Zooming out always restores all land.
    if (settings?.scope === 'UEFA' && settings.layer !== 'clubs') {
      const { s, tx, ty } = this.geo.fit;
      const points = [[-15, 34], [44, 34], [-15, 71], [44, 71]].map(([lon, lat]) => {
        const [x, y] = projPt(lon, lat);
        return [x * s + tx, y * s + ty];
      });
      const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
      this.viewFocus = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
    }
    this.viewResetKey = (this.viewResetKey || 0) + 1;
  }

  /** The theatre's display name. The data's trailing "*" footnote marker ("Asia & Oceania*") is a setup-only device. */
  scopeName(settings = this.state.settings) {
    if (settings?.layer === 'clubs') {
      const scopes = CLUB_SCOPES(getSport(settings.sport));
      return plainScopeName((scopes.find(x => x.id === settings.clubScope) || scopes[0]).name);
    }
    return plainScopeName(SCOPES.find(x => x.id === settings?.scope)?.name || 'World War');
  }

  // ---------- campaign lifecycle ----------

  persist() {
    if (!Object.keys(this.state.teams).length || this.saving || this.state.storageConflict) return;
    this.saving = true;
    const rngState = this.rng?.getState?.() ?? this.state.rngState;
    const snapshot = { ...this.state, rngState,
      ...(this.saved?.campaignId === this.state.campaignId ? { revision: this.saved.revision } : {}),
      metrics: { ...this.state.metrics, engagement: this.engagement.snapshot() } };
    const saveStatus = writeSave(snapshot);
    this.saving = false;
    if (saveStatus.conflict) {
      this.setState({ saveStatus }, () => this.openStorageDialog('conflict', { campaign: saveStatus.conflict,
        message: 'A newer checkpoint exists in another tab. Choose which branch to continue.' }));
      return;
    }
    this.saved = { ...snapshot, ...(saveStatus.ok ? { campaignId: saveStatus.campaignId, revision: saveStatus.revision, campaignName: saveStatus.campaignName } : {}) };
    this.setState({ rngState, saveStatus, hasSave: true,
      metrics: snapshot.metrics,
      ...(saveStatus.ok ? { campaignId: saveStatus.campaignId, revision: saveStatus.revision, campaignName: saveStatus.campaignName } : {}),
      savedMeta: { round: snapshot.round, alive: snapshot.aliveIds.length, settings: snapshot.settings } });
  }

  pickSetup(key, value) {
    this.setState(state => {
      const setup = { ...state.setup, [key]: value };
      if (key === 'preset') {
        setup.scope = value === 'short' ? 'elite' : value === 'world' ? 'world' : 'UEFA';
        setup.clubScope = value === 'short' ? 'elite' : value === 'world' ? 'all' : CLUB_SCOPES(getSport(setup.sport))[2]?.id || 'all';
      } else if (['scope', 'clubScope'].includes(key)) setup.preset = 'custom';
      if (key === 'sport' && !CLUB_SCOPES(getSport(value)).some(s => s.id === setup.clubScope)) setup.clubScope = 'all';
      if (['sport', 'layer', 'scope', 'clubScope', 'preset'].includes(key)) setup.managedTeamId = '';
      return { setup };
    });
  }

  exportProgress() {
    const data = this.state.phase === 'setup' && this.saved ? this.saved
      : { ...this.state, rngState: this.rng?.getState?.() ?? this.state.rngState,
        metrics: { ...this.state.metrics, engagement: this.engagement.snapshot() } };
    const st = this.state;
    // A decision gate (signing, approach, target, elimination) already holds the campaign with no timers armed, and
    // the decision writes `paused: false` without touching the clock: pausing here would leave the clock frozen.
    const gated = !!(st.choice || st.tacticalChoice || st.pendingTarget || st.managerElimination);
    const pending = !gated && (st.autoplay || !!st.spin || (st.match && !st.match.done));
    if (pending) this.clock.pause();
    this.setState({ exportText: exportCampaign(data), exportFilename: `imperialism-${data.seed ?? 'campaign'}-match-${data.matches}.json`,
      ...(pending ? { autoplay: false, paused: true } : {}) });
  }

  downloadProgress() {
    const blob = new Blob([this.state.exportText], { type: 'application/json' });
    const url = URL.createObjectURL(blob), anchor = document.createElement('a');
    anchor.href = url; anchor.download = this.state.exportFilename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    // Let the browser begin reading the blob before releasing its URL.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async importProgress(file) {
    if (!file) return;
    try {
      if (file.size > 5_000_000) throw new Error('Choose a campaign file smaller than 5 MB.');
      const saved = parseCampaign(await file.text());
      this.openStorageDialog('import', { campaign: saved });
    } catch (error) {
      this.setState({ saveStatus: { ok: false, message: error.message || 'Campaign import failed.' } });
    }
  }

  openStorageDialog(mode, extras = {}) {
    if (!this.state.storageDialog) this.storageReturn = { autoplay: this.state.autoplay, paused: this.state.paused };
    this.clock.pause();
    this.setState({ storageDialog: { mode, ...extras }, autoplay: false, paused: this.state.phase === 'playing',
      ...(mode === 'conflict' ? { storageConflict: true } : {}) });
  }

  closeStorageDialog() {
    if (this.state.storageConflict) return;
    const previous = this.storageReturn || { autoplay: false, paused: false };
    this.setState({ storageDialog: null, ...previous }, () => {
      if (!previous.paused) this.clock.resume();
      this.updateEngagement();
    });
  }

  continueSaved(campaign, fork = false, name) {
    if (!campaign) return;
    this.saved = fork ? forkCampaign(campaign, name) : campaign;
    this.setState({ storageDialog: null, storageConflict: false }, () => this.resume());
  }

  /**
   * The wizard's team list (`managerTeams`): `{ id, name, rating, players, neighbours? }` sorted by name. `players` are
   * the five best lineup starters of the built squad (so "Best players" matches the opening ratings, competitive
   * presets included); `neighbours` are the land neighbours on the opening board, overseas territory included as at
   * launch (board 03 "Fronts"). Uses its own seeded RNG, never `this.rng`; cached per setup key.
   */
  setupTeams(setup = this.state.setup) {
    const key = JSON.stringify([setup.sport, setup.layer, setup.scope, setup.clubScope, setup.seed, setup.rosterPreset, !!this.geo]);
    if (this.setupTeamsCache?.key === key) return this.setupTeamsCache.teams;
    const { included, own } = this.opening(setup, makeRng(this.setupSeed(setup)));
    let board = null;
    if (this.geo?.adj) {
      const ids = new Set(included.map(team => team.id));
      const opening = { ...own };
      if (setup.layer !== 'clubs') {
        for (const [shapeId, dep] of Object.entries(DEPENDENCIES)) if (ids.has(dep.of)) opening[shapeId] = dep.of;
      }
      board = { geo: this.geo, own: opening };
    }
    const teams = included.map(team => ({ id: team.id, name: team.name, rating: teamEff(team),
      players: selectLineup(team).starters.filter(player => Number.isFinite(player?.rating))
        .sort((a, b) => b.rating - a.rating || String(a.name).localeCompare(String(b.name))).slice(0, 5)
        .map(player => ({ pos: player.pos, name: player.name, rating: player.rating })),
      ...(board ? { neighbours: [...empireNeighbors(board, team.id)] } : {}) }))
      .sort((a, b) => a.name.localeCompare(b.name));
    this.setupTeamsCache = { key, teams };
    return teams;
  }

  setupSeed(setup = this.state.setup) {
    const entered = String(setup.seed || '').trim();
    return entered ? (/^\d+$/.test(entered) ? Number(entered) >>> 0 : hashStr(entered)) : this.openingSeed;
  }

  opening(su, rng) {
    const sport = getSport(su.sport), clubLayer = su.layer === 'clubs';
    let included, own = {}, scopeName;
    if (clubLayer) {
      const scope = CLUB_SCOPES(sport).find(x => x.id === su.clubScope) || CLUB_SCOPES(sport)[0];
      included = sport.clubs.filter(scope.filter).map(c => buildClub(c, sport));
      scopeName = plainScopeName(scope.name);
      if (this.geo) {
        own = seedClubs(this.geo, included);
        included = included.filter(c => Object.values(own).includes(c.id));
      }
    } else {
      const all = Object.keys(NATIONS).map(id => buildTeam(id, rng, sport));
      const scope = SCOPES.find(x => x.id === su.scope) || SCOPES[0];
      included = su.scope === 'world' ? all : su.scope === 'elite'
        ? all.slice().sort((a, b) => b.str - a.str || teamEff(b) - teamEff(a)).slice(0, 32) : all.filter(scope.filter);
      for (const team of included) own[team.id] = team.id;
      scopeName = plainScopeName(scope.name);
    }
    if (sport.id === 'basketball' && su.rosterPreset === 'competitive')
      included = Object.values(competitiveBasketballTeams(Object.fromEntries(included.map(team => [team.id, team])), 'competitive'));
    return { included, own, scopeName };
  }

  startCampaign() {
    const su = this.state.setup;
    const seed = this.setupSeed(su);
    this.rng = makeRng(seed);
    const clubLayer = su.layer === 'clubs';
    const { included, own, scopeName } = this.opening(su, this.rng);
    if (su.role === 'manager' && !included.some(team => team.id === su.managedTeamId)) {
      this.setState({ saveStatus: { ok: false, message: 'Choose the team you will manage before launching.' } });
      return;
    }
    this.clearTimers();
    this.engagement = new SessionEngagement();

    const teams = {};
    const stats = {};
    for (const t of included) {
      teams[t.id] = t;
      stats[t.id] = { conq: 0, steals: [] };
      // Squad quality at kick-off, so acquisitions can be measured against it.
      t.baseEff = teamEff(t);
      t.baseAvg = squadAverage(t);
    }
    if (!clubLayer) {
      // Overseas territory comes with its parent nation, if that nation is playing.
      for (const [shapeId, dep] of Object.entries(DEPENDENCIES)) {
        if (teams[dep.of]) own[shapeId] = dep.of;
      }
    }
    this.fitMap(Object.keys(own), su);
    this.setState(
      {
        phase: 'playing',
        settings: { ...DEFAULT_SETUP, ...su, ...this.launchRules(su), seed: String(seed) },
        initialSettings: { ...DEFAULT_SETUP, ...su, ...this.launchRules(su), seed: String(seed) },
        turnQueue: [], turnIndex: 0, pendingTarget: null, view: 'map', viewSource: 'user', tacticalPreview: false,
        phoneMore: false, focusLayout: null, targetHoverId: null,
        managedTeamId: su.role === 'manager' ? su.managedTeamId : null, managementEnded: false,
        managerElimination: null, tacticalChoice: null, decisionLedger: [], historyFilter: '',
        campaignId: createCampaignId(), revision: 0,
        campaignName: `${getSport(su.sport).name} · ${scopeName}${su.role === 'manager' ? ' · ' + included.find(team => team.id === su.managedTeamId).name : ''}`,
        storageDialog: null, storageConflict: false,
        // clearTimers() above dropped the tasks that would clear a previous campaign's notice and goal toast.
        pu: null, toast: null,
        teams,
        own,
        aliveIds: included.map(t => t.id),
        fallen: [],
        stats,
        round: 0,
        matches: 0,
        match: null,
        spin: null,
        atk: null,
        queue: [],
        batchTotal: 0,
        autoplay: false,
        selected: null,
        flash: {},
        tab: 'power',
        confirmNew: false,
        battles: [],
        paused: false, history: [], selectedHistoryId: null, choice: null, series: null, exportText: null,
        followedId: su.role === 'manager' ? su.managedTeamId : null,
        pauseFollow: false, seed, rngState: this.rng.getState(), conquestIds: [], focusBounds: null,
        startedAt: Date.now(), completedAt: null, metrics: { leaderChanges: 0, acquisitions: [], previousLeader: null },
        log: [
          {
            t: 'sys',
            r: 0,
            txt: 'CAMPAIGN START — ' + included.length + (clubLayer ? ' CLUBS' : ' NATIONS') + ' · THEATRE: ' + scopeName.toUpperCase(),
            chip: C.textMute,
          },
        ],
      },
      () => this.persist(),
    );
  }

  resume() {
    const s = this.saved;
    if (!s) return;
    this.clearTimers();
    this.engagement = new SessionEngagement(s.metrics?.engagement);
    this.rng = makeRng(s.seed ?? 1);
    this.rng.setState(s.rngState ?? s.seed ?? 1);
    this.fitMap(Object.keys(s.own), s.settings);
    const restored = {
      phase: s.phase === 'victory' ? 'victory' : 'playing',
      settings: { ...DEFAULT_SETUP, ...s.settings },
      initialSettings: s.initialSettings || { ...DEFAULT_SETUP, ...s.settings },
      managedTeamId: s.managedTeamId || (s.settings.role === 'manager' && !s.managementEnded ? s.followedId : null),
      managementEnded: !!s.managementEnded, managerElimination: s.managerElimination || null,
      tacticalChoice: s.tacticalChoice || null, decisionLedger: s.decisionLedger || [],
      historyFilter: s.historyFilter || '', selectedHistoryId: s.selectedHistoryId || null,
      campaignId: s.campaignId || createCampaignId(), revision: s.revision || 0, campaignName: s.campaignName || `${getSport(s.settings.sport).name} · ${this.scopeName(s.settings)}`,
      storageDialog: null, storageConflict: false,
      // clearTimers() above dropped the tasks that would clear the outgoing campaign's notice and goal toast.
      pu: null, toast: null,
      teams: s.teams,
      own: s.own,
      aliveIds: s.aliveIds,
      fallen: s.fallen || [],
      stats: s.stats || {},
      log: s.log || [],
      round: s.round || 0,
      matches: s.matches || 0,
      queue: s.queue || [],
      batchTotal: s.batchTotal || 0,
      match: s.match || null,
      spin: null,
      atk: null,
      autoplay: false,
      selected: null,
      flash: {},
      battles: [],
      tab: 'power',
      paused: false, seed: s.seed ?? 1, rngState: s.rngState ?? 1, history: s.history || [], exportText: null,
      series: s.series || null, followedId: s.followedId || null, pauseFollow: !!s.pauseFollow,
      choice: s.choice || null, conquestIds: s.conquestIds || [],
      startedAt: s.startedAt || Date.now(), completedAt: s.completedAt || (s.aliveIds.length === 1 ? s.savedAt : null),
      metrics: s.metrics || { leaderChanges: 0, acquisitions: [], previousLeader: null },
      saveStatus: s.legacy ? { ok: true, message: 'Legacy campaign restored. Future matches use the saved seed.' } : { ok: true, message: 'Campaign restored' },
      turnQueue: s.turnQueue || [], turnIndex: s.turnIndex || 0, pendingTarget: s.pendingTarget || null,
      view: 'map', viewSource: 'user', tacticalPreview: false, phoneMore: false, focusLayout: null, targetHoverId: null,
    };
    const gated = s.choice || s.tacticalChoice || s.managerElimination || s.pendingTarget;
    // A restored unapplied match is presented again: the same auto-switch rule as a kickoff (DEC D11).
    const autoView = !gated && s.match && !s.match.applied
      ? this.autoMatchView({ ...this.state, ...restored }, s.match.aId, s.match.dId, { express: !!s.match.express, instant: !!s.match.instant }) : {};
    // A reloaded signing is framed like a live one (A-2): the taken land beside the article (pure, no RNG).
    const signingFocus = s.choice ? this.conquestFocus({ ...this.state, ...restored }) : {};
    this.setState({ ...restored, ...autoView, ...signingFocus }, () => {
      if (gated) { this.persist(); return; }
      if (s.match && !s.match.applied) this.presentMatch();
      else if (s.spin) this.startMatch(s.spin.attackerId, s.spin.targetId, s.spin);
      this.persist();
    });
  }

  discardSave() {
    clearSave(this.state.campaignId || this.saved?.campaignId);
    this.saved = null;
    this.setState({ hasSave: false, savedMeta: null });
  }

  /** Keep the previous campaign until a replacement is actually launched. */
  newCampaign() {
    if (!this.state.confirmNew) {
      this.setState({ confirmNew: true });
      return;
    }
    this.clearTimers();
    this.openingSeed = Date.now() >>> 0;
    this.setupTeamsCache = null;
    this.fitMap(Object.keys(NATIONS));
    this.setState({
      phase: 'setup',
      confirmNew: false,
      autoplay: false,
      match: null,
      spin: null,
      atk: null,
      queue: [],
      pu: null,
      toast: null,
      paused: false,
      tacticalChoice: null, choice: null, managerElimination: null,
      turnQueue: [], turnIndex: 0, pendingTarget: null, view: 'map', viewSource: 'user', tacticalPreview: false,
      phoneMore: false, focusLayout: null, targetHoverId: null,
    });
  }

  managedId(state = this.state) {
    // Adopt the identity once when migrating an older manager checkpoint.
    return state.managementEnded ? null : state.managedTeamId || (state.settings.role === 'manager' ? state.followedId : null);
  }

  continueAsSpectator() {
    this.clock.resume();
    // The elimination cleared every timer, including the ones that would clear the final match's goal toast.
    this.setState({ managerElimination: null, managementEnded: true, autoplay: false, paused: false, pu: null, toast: null,
      phase: this.state.aliveIds.length === 1 ? 'victory' : 'playing' }, () => this.persist());
  }

  retryManager() {
    this.clearTimers();
    const setup = { ...DEFAULT_SETUP, ...(this.state.initialSettings || this.state.settings), seed: String(this.state.seed), managedTeamId: this.state.managedTeamId };
    this.setState({ setup, managerElimination: null }, () => this.startCampaign());
  }

  // ---------- transient overlays ----------

  /** Show a centre-screen popup, replaced rather than stacked if another arrives. */
  showPopup(data, duration) {
    const k = (this.popupKey = (this.popupKey || 0) + 1);
    this.setState({ pu: { ...data, k } });
    this.after(duration, () => {
      if (this.state.pu && this.state.pu.k === k) this.setState({ pu: null });
    });
  }

  showToast(data, duration) {
    const k = (this.toastKey = (this.toastKey || 0) + 1);
    this.setState({ toast: { ...data, k } });
    this.after(duration, () => {
      if (this.state.toast && this.state.toast.k === k) this.setState({ toast: null });
    });
  }

  // ---------- match flow ----------

  nextAction() {
    const st = this.state;
    if (st.phase !== 'playing' || st.aliveIds.length <= 1 || st.paused || st.choice || st.tacticalChoice || st.managerElimination || st.storageDialog || st.storageConflict || st.pendingTarget) return;
    if (st.match && !st.match.applied) return;
    if (st.spin) return;
    // A view switched automatically for the last match returns to the map at the next turn (DEC D11). No timers.
    if (st.viewSource === 'auto') this.setState({ view: 'map', viewSource: 'user' });
    if (st.series && st.aliveIds.length === 2) {
      const [a, b] = st.series.teamIds;
      this.setState({ round: st.round + 1, queue: [], turnQueue: [], turnIndex: 0 }, () => this.startMatch(a, b));
      return;
    }

    if (st.queue.length) {
      const queue = st.queue.slice();
      const next = queue.shift();
      this.setState({ queue }, () => this.startMatch(next[0], next[1]));
      return;
    }
    if (st.settings.pacing === 'duel') this.beginTurn();
    else if (st.settings.pacing === 'blitz') this.beginBlitz();
    else this.beginChaos();
  }

  beginDuel(...args) { return turnM.beginDuel.apply(this, args); }

  animateDuel(...args) { return turnM.animateDuel.apply(this, args); }

  lockDuel(...args) { return turnM.lockDuel.apply(this, args); }

  beginBlitz() {
    const st = this.state;
    const { pairs, bye } = drawBlitzPairs(this.rng, this.board());
    if (!pairs.length) return;

    const log = st.log.slice();
    log.push({ t: 'sys', r: st.round + 1, txt: 'BLITZ ROUND — ' + pairs.length + ' MATCHES, FIELD HALVES', chip: C.textMute });
    if (bye) log.push({ t: 'sys', r: st.round + 1, txt: 'BYE — ' + st.teams[bye].name.toUpperCase() + ' SITS OUT', chip: C.textMute });

    this.startBatch(pairs, log);
  }

  beginChaos() {
    const st = this.state;
    const pairs = drawChaosPairs(this.rng, this.board());
    const log = st.log.slice();
    log.push({
      t: 'sys',
      r: st.round + 1,
      txt: 'CHAOS DRAW — ' + pairs.length + ' MATCH(ES) DRAWN BEFORE A NAME REPEATED',
      chip: C.textMute,
    });
    this.startBatch(pairs, log);
  }

  startBatch(pairs, log) {
    const [first, ...rest] = pairs;
    this.setState(
      {
        round: this.state.round + 1,
        queue: rest,
        batchTotal: pairs.length,
        log: log.slice(-LOG_CAP),
        match: null,
        spin: null,
        atk: null,
        pu: null,
        toast: null,
      },
      () => this.startMatch(first[0], first[1]),
    );
  }

  startMatch(attackerId, defenderId, route = {}, tactic, options = {}) {
    const st = this.state;
    const a = st.teams[attackerId];
    const d = st.teams[defenderId];
    if (!a || !d) return;
    this.clearDraw();

    const sport = this.sport();
    const managedId = this.managedId(st);
    const baseDrama = UNCERTAINTY_PRESETS[st.settings.uncertainty]?.drama ?? Number(CONFIG.matchDrama);
    if ([attackerId, defenderId].includes(managedId) && !tactic) {
      if (st.tacticalChoice) return;
      this.clearTimers();
      const manager = st.teams[managedId], opponent = managedId === attackerId ? d : a;
      const options = tacticalOptions(manager, opponent, baseDrama).map(option => {
        const params = tacticalMatchParameters({ attacker: a, defender: d, managedId, tactic: option.id, drama: baseDrama });
        const odds = estimateWinProbability({ sport, attacker: a, defender: d, ...params, samples: 512 });
        return { ...option, winProbability: managedId === attackerId ? odds.attacker : odds.defender };
      });
      this.setState({ managedTeamId: managedId, tacticalChoice: { aId: attackerId, dId: defenderId, route,
        managerName: manager.name, opponentName: opponent.name, options, resumeAutoplay: st.autoplay, openedAt: Date.now() },
        // clearTimers() above also dropped applyConquest's hatch reset: clear the flash with the notice and toast.
        match: null, spin: null, pu: null, toast: null, flash: {}, autoplay: false, paused: false, tacticalPreview: false }, () => this.persist());
      return;
    }
    const params = tacticalMatchParameters({ attacker: a, defender: d, managedId, tactic, drama: baseDrama });
    const { effA, effD, drama } = params;
    const sim = sport.simulate(this.rng, a, d, drama, effA, effD);
    const probabilities = estimateWinProbability({ sport, attacker: a, defender: d, drama, effA, effD, samples: 512 });
    const important = [attackerId, defenderId].includes(st.followedId) || [attackerId, defenderId].includes(managedId) || st.aliveIds.length === 2
      || (sim.winner === attackerId ? effA + CONFIG.upsetThreshold <= effD : effD + CONFIG.upsetThreshold <= effA);
    const series = st.aliveIds.length === 2 && st.settings.finale === 'best-of-three'
      ? st.series || { teamIds: [attackerId, defenderId], wins: { [attackerId]: 0, [defenderId]: 0 }, games: 0 } : null;
    this.setState({
      series,
      match: {
        aId: attackerId,
        dId: defenderId,
        effA,
        effD,
        ga: 0,
        gd: 0,
        shown: [],
        allEv: sim.ev,
        tie: sim.tie,
        tieShown: null,
        winner: sim.winner,
        finalGa: sim.ga,
        finalGd: sim.gd,
        status: sport.labels.live,
        applied: false,
        done: false,
        odds: { a: probabilities.attacker, b: probabilities.defender },
        series: series ? { aWins: series.wins[attackerId], bWins: series.wins[defenderId], bestOf: 3 } : null,
        routeLabel: route.routeLabel || '', routeKind: route.routeKind || 'straight',
        tactic: [attackerId, defenderId].includes(managedId) ? params.tactic : null,
        tacticalBonus: params.bonus, matchDrama: drama,
        express: !!st.settings.express && !important,
        instant: !!options.instant,
        live: this.matchLiveModel(sport, a, d, effA, effD, drama),
      },
      spin: null,
      ...this.autoMatchView(st, attackerId, defenderId, { express: !!st.settings.express && !important, instant: !!options.instant }),
    }, () => {
      this.presentMatch();
      if (this.state.autoplay && this.state.pauseFollow && [attackerId, defenderId].includes(this.state.followedId)) this.pausePlayback();
    });
  }

  chooseTactic(id, options = {}) {
    const choice = this.state.tacticalChoice;
    const option = choice?.options.find(item => item.id === id);
    if (!option) return;
    this.engagement.count('decisions');
    const entry = { type: 'tactic', match: this.state.matches + 1, teamId: this.managedId(), opponentId: choice.aId === this.managedId() ? choice.dId : choice.aId,
      choice: id, expectedStrength: option.strength, variation: option.drama, options: choice.options.map(item => item.id),
      decisionMs: Math.max(0, Date.now() - choice.openedAt) };
    this.setState({ tacticalChoice: null, tacticalPreview: false, autoplay: choice.resumeAutoplay,
      decisionLedger: [...this.state.decisionLedger, entry] }, () => this.startMatch(choice.aId, choice.dId, choice.route, id, options));
  }

  presentMatch(...args) { return matchM.presentMatch.apply(this, args); }

  /** The sport this campaign is being played in. */
  sport() {
    return getSport(this.state.settings.sport);
  }

  /** Patch the live (unapplied) match on the latest queued state; a settled match is never patched back to unapplied. */
  patchMatch(patch) {
    this.setState(state => (state.match && !state.match.applied ? { match: { ...state.match, ...patch } } : null));
  }

  pushEvent(e) {
    const m = this.state.match;
    if (!m || m.applied) return;
    // Several basketball runs can arrive on the same tick. React may batch
    // their callbacks, so every update must use the preceding queued score.
    this.setState(state => {
      const match = state.match;
      if (!match || match.applied || (e.tid !== match.aId && e.tid !== match.dId)) return null;
      return { match: { ...match,
        shown: match.shown.concat([e]),
        ga: match.ga + (e.tid === match.aId ? e.pts : 0),
        gd: match.gd + (e.tid === match.dId ? e.pts : 0),
      } };
    });
    const t = this.state.teams[e.tid] || {};
    this.showToast({ code: t.code || '—', txt: this.sport().formatToast(e), col: t.col || C.gold }, 1150);
  }

  /** Reveal one more penalty in a shootout. */
  pushKick(side) {
    this.setState(state => {
      const m = state.match;
      if (!m || !m.tieShown || m.applied || !['A', 'D'].includes(side)) return null;
      const kicks = m.tie?.[side];
      if (!kicks || m.tieShown[side].length >= kicks.length) return null;
      const shown = { A: m.tieShown.A.slice(), D: m.tieShown.D.slice() };
      shown[side].push(kicks[shown[side].length]);
      return { match: { ...m, tieShown: shown } };
    });
  }

  revealAll(...args) { return matchM.revealAll.apply(this, args); }

  fastForward() {
    this.engagement.count('skips');
    this.clearTimers();
    this.setState({ paused: false });
    this.revealAll();
  }

  finishMatch(...args) { return conqM.finishMatch.apply(this, args); }

  chooseAcquisition(index) {
    const choice = this.state.choice;
    if (!choice || !choice.candidates.some(candidate => candidate.index === index)) return;
    const candidate = choice.candidates.find(item => item.index === index);
    this.engagement.count('decisions');
    const entry = { type: 'signing', match: this.state.matches + 1, teamId: this.managedId(), choice: index,
      player: candidate.name, strengthGain: candidate.gain, attackGain: candidate.attackGain || 0, defendGain: candidate.defendGain || 0,
      optionCount: choice.candidates.length, chosenIndex: choice.candidates.indexOf(candidate),
      decisionMs: Math.max(0, Date.now() - (choice.openedAt || Date.now())) };
    // applyConquest writes `paused: false` for the winner; the clock must agree or every task it schedules would
    // sit unarmed (no-op when the clock already runs, as it does after finishMatch cleared it). A storage dialog keeps
    // its own pause and restores the clock when it closes.
    if (!this.state.storageDialog && !this.state.storageConflict) this.clock.resume();
    this.setState({ choice: null, decisionLedger: [...this.state.decisionLedger, entry], autoplay: choice.resumeAutoplay && !this.state.pauseFollow,
      view: 'map', viewSource: 'user' }, () => this.applyConquest(index));
  }

  /** The highlighted signing (DEC D15): `choice.selected`, else the best lineup fit. */
  selectedCandidate(choice = this.state.choice) {
    if (!choice?.candidates?.length) return null;
    return choice.candidates.find(candidate => candidate.index === choice.selected) || choice.candidates[0];
  }

  selectAcquisition(index) {
    const choice = this.state.choice;
    if (!choice?.candidates?.some(candidate => candidate.index === index)) return;
    this.setState({ choice: { ...choice, selected: index } }, () => this.persist());
  }

  applyConquest(...args) { return conqM.applyConquest.apply(this, args); }

  // ---------- controls ----------

  step() {
    const st = this.state;
    if (st.phase !== 'playing' || st.choice || st.tacticalChoice || st.managerElimination || st.storageDialog || st.storageConflict || st.paused || st.pendingTarget) return;
    if (st.match && !st.match.applied) {
      this.fastForward();
      return;
    }
    if (st.spin) return;
    this.nextAction();
  }

  togglePlay() {
    if (this.state.choice || this.state.tacticalChoice || this.state.managerElimination || this.state.storageDialog || this.state.storageConflict || this.state.pendingTarget) return;
    if (this.state.autoplay) { this.pausePlayback(); return; }
    this.clock.resume();
    this.setState({ autoplay: true, paused: false }, () => {
      const st = this.state;
      if ((!st.match || st.match.applied) && !st.spin) this.after(80, () => {
        if (this.state.autoplay) this.nextAction();
      });
    });
  }

  pausePlayback() {
    if (this.state.choice || this.state.tacticalChoice || this.state.managerElimination || this.state.storageDialog || this.state.storageConflict || this.state.pendingTarget) return;
    if (this.state.paused) {
      this.clock.resume();
      this.setState({ paused: false }, () => this.persist());
      return;
    }
    this.clock.pause();
    this.setState({ paused: true, autoplay: false }, () => this.persist());
  }

  followTeam(id) {
    if (id && !this.state.teams[id]) return;
    this.setState({ managedTeamId: this.managedId(), followedId: id || null, selected: id || this.state.selected }, () => this.persist());
  }

  viewConquest(...args) { return mapM.viewConquest.apply(this, args); }

  /** Speed 1×/2×/4× (DEC D14). A live ticker match is rescheduled at the new rate (A-12, WP-MATCH hook). */
  setSpeed(n) {
    const previous = this.state.speed;
    if (![1, 2, 4].includes(n) || n === previous) return;
    this.setState({ speed: n }, () => this.rescheduleForSpeed(previous));
  }

  cycleSpeed() {
    const s = this.state.speed;
    this.setSpeed(s === 1 ? 2 : s === 2 ? 4 : 1);
  }

  setSetting(key, value) {
    if (this.state.phase !== 'playing') return;
    if (!['resolution', 'express'].includes(key)) return;
    if (key === 'resolution' && (this.state.spin || (this.state.match && !this.state.match.applied))) return;
    this.setState(state => ({ settings: { ...state.settings, [key]: value } }), () => this.persist());
  }

  selectCountry(...args) { return turnM.selectCountry.apply(this, args); }

  /** Clicking land or a team row opens that team's Squad view (DEC D11); `tab` stays for smoke compatibility. */
  selectTeam(tid) {
    if (!this.state.teams[tid]) return;
    const origin = this.navView(this.currentView());
    // While a signing or target choice holds the screen (A-13) only the selection changes.
    const locked = !!(this.state.choice || this.state.pendingTarget);
    this.setState({ selected: tid, tab: 'squad', ...(locked ? {} : { view: 'squad', viewSource: 'user', phoneMore: false,
      ...(origin && origin !== 'squad' ? { squadReturn: origin } : {}) }) }, () => {
      if (typeof document === 'undefined') return;
      const panel = document.getElementById('view-panel-squad');
      panel?.focus?.({ preventScroll: true });
      panel?.scrollIntoView?.({ block: 'start' });
    });
  }

  showDetails() {
    this.setView('map', () => {
      if (typeof document !== 'undefined') document.getElementById('campaign-details')?.focus?.({ preventScroll: true });
    });
  }

  // ---------- v4 view router ----------

  /** Plain, render-safe context shared by every view-model builder (PLAN §3.3). Never touches the DOM or `this.rng`. */
  viewContext(st = this.state) {
    const managedId = st.settings ? this.managedId(st) : null;
    const followedId = st.teams?.[st.followedId] ? st.followedId : null;
    return {
      board: this.geo ? this.board(st) : null, geo: this.geo || null, displayGeo: this.displayGeo || null,
      sport: getSport(st.settings?.sport), managedId: managedId || null, followedId,
      perspectiveId: managedId || followedId || null,
      drama: UNCERTAINTY_PRESETS[st.settings?.uncertainty]?.drama ?? Number(CONFIG.matchDrama),
      displayRound: displayRound(st), totalTeams: Object.keys(st.teams || {}).length,
      labelGeometry: this.labelGeometry || [], viewFocus: this.viewFocus || null, cache: this.vmCache,
    };
  }

  /** The effective view (DEC D11): setup, the signing screen and the target choice override the chosen view. */
  currentView(st = this.state) {
    if (st.phase === 'loading' || st.phase === 'setup') return 'setup';
    if (st.choice) return 'conquest';
    if (st.pendingTarget) return 'map';
    return VIEWS.includes(st.view) ? st.view : 'map';
  }

  /** The nav entry a view highlights: the conquest screen belongs to Map; setup has none. */
  navView(view) {
    if (view === 'conquest') return 'map';
    if (view === 'setup') return null;
    return view;
  }

  setView(view, callback) {
    const st = this.state;
    if (!VIEWS.includes(view)) return;
    if ((st.choice || st.pendingTarget) && view !== 'map') return; // A-13: the decision holds the screen.
    // Board C1: a Squad opened from the nav has no origin to go back to (re-selecting Squad keeps the current one).
    this.setState({ view, viewSource: 'user', phoneMore: false,
      ...(view === 'squad' && st.view !== 'squad' ? { squadReturn: null } : {}) }, callback);
  }

  /** Back from a squad to the screen that opened it, with focus on that team's row (or the Chronicle's history row). */
  squadBack() {
    const origin = this.state.squadReturn || 'map';
    const selected = this.state.selected;
    this.setView(origin, () => {
      if (typeof document === 'undefined') return;
      const escaped = String(selected ?? '').replace(/["\\]/g, '\\$&');
      const row = selected != null ? document.querySelector(`#view-panel-${origin} [data-team-id="${escaped}"]`) : null;
      // The Chronicle has no team-row hook: return to the selected history entry instead of the panel.
      const historyRow = !row && origin === 'chronicle'
        ? document.querySelector('#view-panel-chronicle .fi-history-list [aria-pressed="true"]') : null;
      (row || historyRow || document.getElementById(origin === 'map' ? 'campaign-details' : `view-panel-${origin}`))?.focus?.({ preventScroll: true });
    });
  }

  /** The one primary action (DEC D13) shown by the masthead and the phone bar and run by Space. Pure. */
  primaryAction(st = this.state) {
    if (st.phase !== 'playing' || st.storageDialog || st.storageConflict || st.exportText || st.managerElimination) return null;
    if (st.aliveIds.length <= 1) return { id: 'results', label: 'Results', run: () => this.setState({ phase: 'victory' }) };
    if (st.pendingTarget) {
      const target = st.teams[st.pendingTarget.selectedId];
      return { id: 'attack', label: `Attack ${target?.name || 'target'}`, disabled: !target, run: () => this.confirmTarget() };
    }
    if (st.choice) {
      const candidate = this.selectedCandidate(st.choice);
      return { id: 'sign', label: `Sign ${candidate?.name || 'player'}`, mastLabel: 'Sign player', disabled: !candidate,
        run: () => this.chooseAcquisition(this.selectedCandidate()?.index) };
    }
    if (st.tacticalChoice) return { id: 'kickoff', label: 'Continue', run: () => this.chooseTactic('balanced') };
    if (st.autoplay) return { id: 'pause', label: 'Pause', run: () => this.togglePlay() };
    // DEC D13: a spectator's primary is Pause / Play campaign. Play also resumes a paused clock (togglePlay), so
    // Pause then Play keeps the campaign running; a bare Resume would unpause with autoplay off and stop after this match.
    if (!this.managedId(st)) return { id: 'play', label: 'Play campaign', run: () => this.togglePlay() };
    if (st.paused) return { id: 'resume', label: 'Resume', run: () => this.pausePlayback() };
    if (st.spin) return { id: 'drawing', label: 'Continue', disabled: true, run: () => {} };
    if (st.match && !st.match.applied) return { id: 'finish', label: 'Finish match', run: () => this.step() };
    return { id: 'continue', label: 'Continue', run: () => this.step() };
  }

  runPrimary() {
    const action = this.primaryAction();
    if (action && !action.disabled) action.run();
  }

  /** Space runs the primary action (A-8); focused controls keep their native Space. */
  handleKeyDown = event => {
    if (event.key !== ' ' || event.repeat || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    if (typeof document !== 'undefined' && document.querySelector('[aria-modal="true"]')) return;
    const target = event.target;
    const closest = selector => (typeof target?.closest === 'function' ? target.closest(selector) : null);
    if (!closest('[data-space-primary] [role=radio]') && closest(SPACE_IGNORE)) return;
    const action = this.primaryAction();
    if (!action || action.disabled) return;
    event.preventDefault();
    action.run();
  };

  /** Phone primary bar right text (RM §2.9): the round, the live minute or the selected signing's gain. */
  phoneBarModel() {
    const st = this.state;
    if (st.choice) {
      const candidate = this.selectedCandidate(st.choice);
      return { right: candidate ? signedDelta(candidate.gain).text : null, rightKind: candidate ? 'gain' : null, minuteFallback: 0 };
    }
    const m = st.match;
    // The bar floors the live minute at the last revealed event, as the Match view and the compact card do.
    if (m && !m.done && !m.applied) {
      return { right: null, rightKind: 'minute', minuteFallback: (m.shown || []).reduce((most, e) => Math.max(most, Number(e?.m) || 0), 0) };
    }
    const round = roman(displayRound(st));
    return { right: round ? `Round ${round}` : null, rightKind: round ? 'round' : null, minuteFallback: 0 };
  }

  setPauseFollow(value) {
    this.setState({ pauseFollow: !!value }, () => this.persist());
  }

  togglePhoneSheet() {
    this.setState(state => ({ phoneSheet: state.phoneSheet === 'expanded' ? 'collapsed' : 'expanded' }));
  }

  togglePhoneMore() {
    this.setState(state => ({ phoneMore: !state.phoneMore }));
  }

  /**
   * DEC D11: a ticker kickoff involving the managed team (or the followed team while spectating) switches the Map to
   * the Match view; returns the fields for the same setState. Never for express or "simulate the result" (instant).
   */
  autoMatchView(st, attackerId, defenderId, { express = false, instant = false } = {}) {
    if (st.settings?.resolution !== 'ticker' || express || instant || st.view !== 'map') return {};
    const managedId = this.managedId(st);
    const ids = [attackerId, defenderId];
    if (managedId ? ids.includes(managedId) : !!st.followedId && ids.includes(st.followedId)) return { view: 'match', viewSource: 'auto' };
    return {};
  }

  /** DEC D10: the tactical gate no longer opens its dialog by itself; "Match preview" opens it. */
  openMatchPreview() {
    if (this.state.tacticalChoice) this.setState({ tacticalPreview: true });
  }

  closeMatchPreview() {
    if (this.state.tacticalPreview) this.setState({ tacticalPreview: false });
  }

  /** "or simulate the result": kick off with the default approach and reveal this match instantly. */
  simulateResult() {
    if (this.state.tacticalChoice) this.chooseTactic('balanced', { instant: true });
  }

  mastheadModel() {
    return buildMasthead(this.state, this.viewContext());
  }

  mapAnchors() {
    return [...(this.targetAnchors() || []), ...(this.conquestAnchors() || [])];
  }

  // ---------- module delegates (bodies in src/app/*Methods.jsx; owners per PLAN §4.10) ----------

  // map (WP-MAP)
  mapMeId(...args) { return mapM.mapMeId.apply(this, args); }
  mapOpponentId(...args) { return mapM.mapOpponentId.apply(this, args); }
  mapOwnership(...args) { return mapM.mapOwnership.apply(this, args); }
  mapAttack(...args) { return mapM.mapAttack.apply(this, args); }
  mapSpin(...args) { return mapM.mapSpin.apply(this, args); }
  mapConquestIds(...args) { return mapM.mapConquestIds.apply(this, args); }
  mapInitialFocus(...args) { return mapM.mapInitialFocus.apply(this, args); }
  mapNearFocus(...args) { return mapM.mapNearFocus.apply(this, args); }
  mapProps(...args) { return mapM.mapProps.apply(this, args); }

  // column (WP-COL)
  columnModel(...args) { return colM.columnModel.apply(this, args); }
  mapOverlaysModel(...args) { return colM.mapOverlaysModel.apply(this, args); }
  tickerModel(...args) { return colM.tickerModel.apply(this, args); }

  // match (WP-MATCH)
  matchLiveModel(...args) { return matchM.matchLiveModel.apply(this, args); }
  rescheduleForSpeed(...args) { return matchM.rescheduleForSpeed.apply(this, args); }
  startMinuteClock(...args) { return matchM.startMinuteClock.apply(this, args); }
  stopMinuteClock(...args) { return matchM.stopMinuteClock.apply(this, args); }
  liveMatchModel(...args) { return matchM.liveMatchModel.apply(this, args); }

  // squad (WP-SQUAD)
  squadModel(...args) { return squadM.squadModel.apply(this, args); }

  // conquest (WP-CONQ)
  conquestPreview(...args) { return conqM.conquestPreview.apply(this, args); }
  conquestModel(...args) { return conqM.conquestModel.apply(this, args); }
  eliminationModel(...args) { return conqM.eliminationModel.apply(this, args); }
  conquestAnchors(...args) { return conqM.conquestAnchors.apply(this, args); }
  conquestFocus(...args) { return conqM.conquestFocus.apply(this, args); }

  // turns (WP-TURN)
  launchRules(...args) { return turnM.launchRules.apply(this, args); }
  playerTargets(...args) { return turnM.playerTargets.apply(this, args); }
  beginTurn(...args) { return turnM.beginTurn.apply(this, args); }
  openTargetChoice(...args) { return turnM.openTargetChoice.apply(this, args); }
  selectTarget(...args) { return turnM.selectTarget.apply(this, args); }
  hoverTarget(...args) { return turnM.hoverTarget.apply(this, args); }
  confirmTarget(...args) { return turnM.confirmTarget.apply(this, args); }
  turnStripModel(...args) { return turnM.turnStripModel.apply(this, args); }
  reachModel(...args) { return turnM.reachModel.apply(this, args); }
  targetPanelModel(...args) { return turnM.targetPanelModel.apply(this, args); }
  spectatorPanelModel(...args) { return turnM.spectatorPanelModel.apply(this, args); }
  targetAnchors(...args) { return turnM.targetAnchors.apply(this, args); }

  // ledger (WP-LEDGER)
  ledgerModel(...args) { return ledgerM.ledgerModel.apply(this, args); }
  chronicleModel(...args) { return ledgerM.chronicleModel.apply(this, args); }
  matchPreviewModel(...args) { return ledgerM.matchPreviewModel.apply(this, args); }

  // ---------- pointer readouts ----------

  handleMapMove = event => mapM.handleMapMove.call(this, event);

  // ---------- derived view models ----------

  mapFlags(...args) { return mapM.mapFlags.apply(this, args); }

  mapCountries(...args) { return mapM.mapCountries.apply(this, args); }

  mapLabels(...args) { return mapM.mapLabels.apply(this, args); }

  mapHomes(...args) { return mapM.mapHomes.apply(this, args); }

  tooltip(...args) { return mapM.tooltip.apply(this, args); }

  matchCard(...args) { return matchM.matchCard.apply(this, args); }

  idleText(...args) { return colM.idleText.apply(this, args); }

  powerTable(...args) { return ledgerM.powerTable.apply(this, args); }

  victoryPanel(...args) { return ledgerM.victoryPanel.apply(this, args); }

  renderPopup(...args) { return conqM.renderPopup.apply(this, args); }

  render() {
    const st = this.state;
    const playing = st.phase === 'playing' || st.phase === 'victory';
    const ctx = this.viewContext();
    const view = this.currentView();                     // 'setup'|'map'|'conquest'|'squad'|'match'|'ledger'|'chronicle'
    const primary = this.primaryAction();                // {id,label,mastLabel?,disabled?,run}|null — pure
    const scopeName = this.scopeName();
    const sport = getSport(playing ? st.settings.sport : st.setup.sport);
    const victory = st.phase === 'victory' ? this.victoryPanel() : null;
    const { countries, flagPatterns } = this.mapCountries();
    const completed = playing && st.aliveIds.length <= 1;
    const liveMatch = !!st.match && !st.match.applied;
    const mapVisible = view === 'setup' || view === 'map' || view === 'conquest';
    const playbackState = completed ? 'Completed' : st.pendingTarget ? 'Choose a target'
      : st.tacticalChoice ? 'Choose an approach' : st.choice ? 'Choose a signing' : st.managerElimination ? 'Your campaign ended'
      : st.paused ? st.spin ? 'Draw paused' : liveMatch ? 'Match paused' : 'Paused'
      : st.spin ? 'Drawing' : st.match && !st.match.done ? 'Live' : st.match?.done ? 'Full time' : 'Ready';
    const currentCard = this.matchCard();
    const oceanLabels = !playing && this.geo ? [
      ['Pacific Ocean', -135, -5], ['Atlantic Ocean', -30, 0], ['Indian Ocean', 76, -25],
    ].map(([text, lon, lat]) => {
      const [x, y] = projPt(lon, lat);
      const { s, tx, ty } = this.geo.fit;
      return { text, x: x * s + tx, y: y * s + ty };
    }) : [];
    const playback = { speed: st.speed, autoplay: st.autoplay, completed, paused: st.paused, live: liveMatch || !!st.spin,
      busy: !!st.spin || !!st.choice || !!st.tacticalChoice || !!st.managerElimination || !!st.storageDialog || !!st.pendingTarget,
      stepLabel: st.spin ? 'Drawing match…' : liveMatch ? 'Finish match' : 'Next match', stateLabel: playbackState,
      summary: currentCard ? { text: `${currentCard.a.code} ${currentCard.a.score}–${currentCard.b.score} ${currentCard.b.code}`,
        label: `${currentCard.a.name} ${currentCard.a.score}, ${currentCard.b.name} ${currentCard.b.score}` } : null,
      onSpeed: () => this.cycleSpeed(), onStep: () => this.step(), onPlay: () => this.togglePlay(), onPause: () => this.pausePlayback() };
    const settingsProps = {                              // shared by the masthead popover and the phone More sheet (A-10)
      pacing: st.settings.pacing, resolution: st.settings.resolution, confirmNew: st.confirmNew,
      busy: liveMatch || !!st.spin || !!st.tacticalChoice || !!st.choice || !!st.pendingTarget, completed,
      onPacing: p => this.setSetting('pacing', p), onResolution: r => this.setSetting('resolution', r),
      onNew: () => this.newCampaign(), onCancelNew: () => this.setState({ confirmNew: false }),
      saveStatus: st.saveStatus, onExport: () => this.exportProgress(), onImport: file => this.importProgress(file),
      onResults: () => this.setState({ phase: 'victory' }), seed: st.seed, settings: st.settings,
      onSetting: (key, value) => this.setSetting(key, value), managementEnded: st.managementEnded,
      onManageSaves: () => this.openStorageDialog('slots') };
    const matchCardNode = currentCard ? <MatchCard {...currentCard} variant="compact" minuteStore={this.minuteStore}
      eventsRef={this.eventsRef} onViewConquest={result => this.viewConquest(result)} onSelectTeam={id => this.selectTeam(id)} /> : null;
    return (
      <div className={`app-shell${playing ? ' has-campaign' : ''}`} data-view={view} data-role={ctx.managedId ? 'manager' : 'spectator'}>
        <CommandBar
          show={playing} sportName={sport.name} layerName={st.settings.layer === 'clubs' ? 'Clubs' : 'Nations'}
          scopeName={scopeName} round={st.round} alive={st.aliveIds.length} {...settingsProps}
          view={this.navView(view)} navLocked={!!st.choice || !!st.pendingTarget} onView={v => this.setView(v)}
          primary={primary} onPrimary={() => this.runPrimary()}
          masthead={playing ? this.mastheadModel() : null}
          playback={playing ? <PlaybackBar variant="masthead" showStep={!ctx.managedId} {...playback} /> : null}
        />
        {playing && <TurnStrip {...this.turnStripModel()} />}
        {/* Behind the opaque setup wizard the map stays mounted but out of the tab order and the accessibility tree.
            React 18 has no boolean `inert` prop, so the attribute is passed as an empty string. */}
        <main className="campaign-layout" data-view={view} {...(view === 'setup' ? { inert: '' } : {})}>
          <WorldMap
            countries={countries} flagPatterns={flagPatterns}
            graticule={this.geo ? this.geo.graticule : { d: '', labels: [] }}
            homes={this.mapHomes(playing)} battleMarks={[]}
            labels={this.mapLabels(playing)} labelGeometry={this.labelGeometry} ownership={this.mapOwnership()}
            oceanLabels={oceanLabels} attack={this.mapAttack()} spin={this.mapSpin()}
            conquestIds={this.mapConquestIds()} followedId={st.followedId} paused={st.paused} selectedId={st.selected}
            onShowDetails={() => this.showDetails()} focusBounds={st.focusBounds} focusKey={st.focusKey} focusLayout={st.focusLayout}
            tooltip={this.tooltip(playing)} kmPerUnit={0} legend={null} title={null}
            viewResetKey={this.viewResetKey} initialFocus={this.mapInitialFocus()} nearFocus={this.mapNearFocus()}
            playing={playing} mapMode={st.mapMode} onMapMode={mapMode => this.setState({ mapMode })}
            meId={this.mapMeId()} opponentId={this.mapOpponentId()} reach={this.reachModel()}
            hidden={!mapVisible} wholeMap={st.wholeMap} onWholeMap={() => this.setState({ wholeMap: !st.wholeMap })}
            anchors={playing ? this.mapAnchors() : []}
            mapRef={this.mapRef} svgRef={this.svgRef} tipRef={this.tipRef} coordRef={this.coordRef}
            onPointerMove={this.handleMapMove} onPointerLeave={() => this.setState({ hoverCid: null })}
            {...this.mapProps()}
          >
            {playing && <MapOverlays {...this.mapOverlaysModel()} />}
            {st.toast && <Toast code={st.toast.code} text={st.toast.txt} color={st.toast.col} />}
            {this.renderPopup()}
          </WorldMap>
          {playing && view === 'map' && <CampaignColumn
            {...this.columnModel()}
            matchCard={matchCardNode}
            targetPanel={st.pendingTarget ? <TargetPanel {...this.targetPanelModel()} onSelect={id => this.selectTarget(id)}
              onHover={id => this.hoverTarget(id)} onConfirm={() => this.confirmTarget()} /> : null}
            spectatorPanel={!ctx.managedId ? <SpectatorPanel {...this.spectatorPanelModel()} matchCard={matchCardNode}
              onFollow={id => this.followTeam(id)} onPauseFollow={value => this.setPauseFollow(value)}
              onToggleAutoplay={() => this.togglePlay()} onSpeed={n => this.setSpeed(n)} /> : null}
            onPreview={() => this.openMatchPreview()} onSimulate={() => this.simulateResult()}
            onToggleSheet={() => this.togglePhoneSheet()} onOpenChronicle={() => this.setView('chronicle')}
            onSelectTeam={id => this.selectTeam(id)} />}
          {playing && view === 'conquest' && <ConquestScreen {...this.conquestModel()}
            onSelect={index => this.selectAcquisition(index)}
            onConfirm={() => this.chooseAcquisition(this.selectedCandidate(st.choice)?.index)} />}
          {playing && view === 'squad' && <SquadScreen {...this.squadModel()}
            onFollow={id => this.followTeam(id)} onBack={() => this.squadBack()} onSelectTeam={id => this.selectTeam(id)} />}
          {playing && view === 'match' && <MatchScreen {...this.liveMatchModel()} minuteStore={this.minuteStore}
            speed={st.speed} paused={st.paused} onSpeed={n => this.setSpeed(n)} onPause={() => this.pausePlayback()}
            onSelectTeam={id => this.selectTeam(id)} />}
          {playing && view === 'ledger' && <LedgerScreen {...this.ledgerModel()} selectedTeamId={st.selected}
            onSelectTeam={id => this.selectTeam(id)} />}
          {playing && view === 'chronicle' && <ChronicleScreen {...this.chronicleModel()}
            selectedHistory={st.history.find(entry => entry.id === st.selectedHistoryId)} historyFilter={st.historyFilter}
            onHistorySelect={id => this.setState({ selectedHistoryId: id }, () => this.persist())}
            onHistoryFilter={value => this.setState({ historyFilter: value }, () => this.persist())}
            onViewConquest={result => this.viewConquest(result)} onSelectTeam={id => this.selectTeam(id)} />}
          {playing && view === 'map' && <Ticker {...this.tickerModel()} />}
        </main>
        {playing && <PhoneBar primary={primary} {...this.phoneBarModel()} minuteStore={this.minuteStore} onPrimary={() => this.runPrimary()} />}
        {playing && <PhoneTabBar active={this.navView(view)} hidden={view === 'conquest'} locked={!!st.choice || !!st.pendingTarget}
          moreOpen={st.phoneMore} onView={v => this.setView(v)} onMore={() => this.togglePhoneMore()} />}
        {playing && st.phoneMore && <PhoneMoreSheet onClose={() => this.togglePhoneMore()} locked={!!st.choice || !!st.pendingTarget}
          onChronicle={() => this.setView('chronicle', () => {
            if (typeof document !== 'undefined') document.getElementById('view-panel-chronicle')?.focus?.({ preventScroll: true });
          })}
          settings={<SettingsPanel {...settingsProps} idPrefix="sheet-" />}
          playback={<PlaybackBar variant="sheet" id="campaign-playback-sheet" showStep={!ctx.managedId} {...playback} />} />}
        {st.phase === 'setup' && <SetupOverlay
          setup={st.setup} hasSave={st.hasSave} managerTeams={this.setupTeams()}
          savedText={st.savedMeta ? 'Round ' + st.savedMeta.round + ' · ' + st.savedMeta.alive + ' ' +
            (st.savedMeta.settings?.layer === 'clubs' ? 'clubs' : 'nations') + ' remaining · ' + this.scopeName(st.savedMeta.settings) : ''}
          onResume={() => this.resume()} onDiscard={() => this.discardSave()}
          onPick={(key, value) => this.pickSetup(key, value)}
          onStart={() => this.startCampaign()}
          saveStatus={st.saveStatus} onExport={() => this.exportProgress()} onImport={file => this.importProgress(file)}
          onManageSaves={() => this.openStorageDialog('slots')}
          onCancel={st.hasSave ? () => this.resume() : undefined}
        />}
        {victory && !st.storageDialog && !st.exportText && !st.managerElimination && <VictoryOverlay {...victory} positionColors={sport.positionColors}
          onClose={() => this.setState({ phase: 'playing' })}
          onNew={() => {
            this.clearTimers(); this.fitMap(Object.keys(NATIONS));
            this.setState({ phase: 'setup', match: null, queue: [], pu: null, toast: null, autoplay: false });
          }}
        />}
        {st.tacticalChoice && st.tacticalPreview && !st.storageDialog && !st.exportText && <TacticalChoice choice={st.tacticalChoice}
          preview={this.matchPreviewModel()} onSimulate={() => this.simulateResult()}
          onChoose={id => this.chooseTactic(id)} onClose={() => this.closeMatchPreview()} />}
        {st.managerElimination && !st.storageDialog && !st.exportText && <ManagerElimination result={st.managerElimination}
          model={this.eliminationModel()} onSpectate={() => this.continueAsSpectator()} onRetry={() => this.retryManager()} />}
        {st.storageDialog && !st.exportText && <CampaignStorageDialog key={st.storageDialog.mode} {...st.storageDialog}
          activeId={st.campaignId} campaigns={listCampaigns()} onClose={() => this.closeStorageDialog()}
          onConfirmImport={name => this.continueSaved(st.storageDialog.campaign, true, name)}
          onExportCurrent={st.hasSave ? () => this.exportProgress() : undefined}
          onLoad={id => {
            try {
              const inspection = inspectCampaign(id);
              if (inspection.state === 'ready') this.continueSaved(inspection.campaign);
              else this.setState({ storageDialog: { mode: 'recovery', ...inspection } });
            }
            catch (error) { this.setState({ storageDialog: { ...st.storageDialog, error: error.message } }); }
          }}
          onRename={(id, name) => {
            const result = renameCampaign(id, name);
            if (result.ok && id === st.campaignId) {
              this.saved = { ...this.saved, revision: result.revision, campaignName: result.campaignName };
              this.setState({ revision: result.revision, campaignName: result.campaignName });
            }
            this.setState({ storageDialog: { ...st.storageDialog, error: result.ok ? null : result.message } });
          }}
          onFork={Object.keys(st.teams).length || this.saved ? name => this.continueSaved(st.phase === 'setup' ? this.saved
            : { ...st, rngState: this.rng.getState(), metrics: { ...st.metrics, engagement: this.engagement.snapshot() } }, true, name) : undefined}
          onReload={() => this.continueSaved(st.storageDialog.campaign)}
          onRestoreBackup={() => this.continueSaved(st.storageDialog.backup, true, `${st.storageDialog.backup.campaignName || 'Campaign'} recovered`)}
          onExportRaw={st.storageDialog.raw ? () => this.setState({ exportText: st.storageDialog.raw, exportFilename: 'imperialism-damaged-save.json' }) : undefined}
        />}
        {st.exportText && <ExportCheckpoint text={st.exportText} filename={st.exportFilename}
          onDownload={() => this.downloadProgress()} onClose={() => this.setState({ exportText: null })} />}
        {st.phase === 'loading' && <div className="loading-screen" role={st.err ? 'alert' : 'status'}>
          <span>{st.err || 'Opening the atlas…'}</span>
          {st.err && <button className="button" onClick={() => { this.setState({ err: null }); this.boot(); }}>Try again</button>}
        </div>}
      </div>
    );
  }
}
