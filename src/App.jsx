import React from 'react';
import { CONFIG } from './config.js';
import { C } from './theme.js';
import { DEPENDENCIES, NATIONS, SCOPES, buildClub, buildTeam, makeRng, hashStr, selectLineup, squadAverage, teamEff } from './data/teams.js';
import { CLUB_SCOPES } from './data/scopes.js';
import { CAPITALS } from './data/capitals.js';
import { WorldGeometry, drawnPaths, mergeSharedIds, projPt } from './engine/geo.js';
import { clearDomesticCache, domesticSurroundings, getLoadedDomestic, isDomesticScope, loadDomestic,
  retainDomestic } from './engine/domestic.js';
import { clubMapScope, domesticEntry, domesticLabel } from './data/domesticScope.js';
import { BUILT_IN_SETS, clearFootballSetCache, fieldedNations, footballSport, getLoadedFootballSet, heldShapes, loadFootballSet,
  loadFootballSetIndex, retainFootballSets, sportOf } from './engine/footballSets.js';
import { createFlagRegionIndex, FLAG_REGION_GAP_KM } from './engine/flagRegions.js';
import { getSport } from './sports/index.js';
import { drawBlitzPairs, drawChaosPairs, empireNeighbors, seedClubs } from './engine/campaign.js';
import { clearSave, loadSave, writeSave, parseCampaign, exportCampaign, inspectSave, listCampaigns, deleteCampaign,
  inspectCampaign, renameCampaign, forkCampaign, createCampaignId, detectSaveConflict, isCampaignStorageEvent,
  fitDomesticCampaign, CHECKPOINT_KEYS } from './engine/storage.js';
import { PlaybackClock } from './engine/playbackClock.js';
import { tacticalMatchParameters, tacticalOptions, competitiveBasketballTeams } from './engine/managerStrategy.js';
import { SessionEngagement, engagementMode } from './engine/sessionEngagement.js';
import { estimateWinProbability, UNCERTAINTY_PRESETS } from './engine/odds.js';
import { createMinuteStore } from './engine/liveMinute.js';
import { displayRound, plainScopeName, roman, signedDelta } from './viewModels/format.js';
import { buildMasthead } from './viewModels/masthead.js';
import { countryMapPreview, theatreMapPreview } from './screens/setup/setupModel.js';
import { DEFAULT_SETUP, LOG_CAP, dataSetOf, domesticIdOf } from './app/shared.js';
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
// Neighbouring land is drawn this far (SVG units) beyond the 960×540 frame: a
// fully zoomed-out camera shows up to ~420 units beside it on ultra-wide screens
// and ~770 above and below on a phone.
const BACKDROP_MARGIN = { x: 480, y: 800 };
const SETUP_LOAD_DELAY_MS = 120;

/** The page's fetch; tests and Node have only the global one. */
const pageFetch = () => (typeof window !== 'undefined' && window.fetch ? window.fetch.bind(window) : globalThis.fetch);

/** "Football · Europe"; a data set campaign names its season ("Football 2001/02 · Europe"). */
const campaignLabel = (settings, scopeName) => `${getSport(settings.sport).name}${settings.dataSeason ? ` ${settings.dataSeason}` : ''} · ${scopeName}`;

/**
 * The setup's club theatre. A sport with its own map plays only there (basketball: the NBA's USA and Canada), and
 * another sport's map falls back to every club. A data set brings its own clubs, so the theatre must be one of them: a
 * country map (built from the built-in data) and a league the set leaves out fall back to every club. Kept as it is
 * while the set loads.
 */
function setClubScope(setup) {
  const own = clubMapScope(getSport(setup.sport).id);
  if (own) return own;
  if (domesticEntry(setup.clubScope)?.sport) return 'all';
  if (setup.dataSet == null || getSport(setup.sport).id !== 'football') return setup.clubScope;
  if (isDomesticScope(setup.clubScope)) return 'all';
  const sport = sportOf(setup);
  return !sport || CLUB_SCOPES(sport).some(scope => scope.id === setup.clubScope) ? setup.clubScope : 'all';
}

/**
 * Live presentation of an outcome already decided and saved at kickoff: the events and kicks revealed so far, and
 * the draw compass's stage. A reload re-presents them from the last checkpoint with the same result.
 */
const MATCH_PROGRESS = new Set(['shown', 'ga', 'gd', 'tieShown']);
const SPIN_PROGRESS = new Set(['stage', 'ang']);

/**
 * How `b` differs from `a`: null when they are the same value or objects with the same keys holding identical
 * values, 'progress' when only `progress` keys changed, else 'checkpoint'.
 */
function contentChange(a, b, progress) {
  if (a === b) return null;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return 'checkpoint';
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return 'checkpoint';
  let change = null;
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(b, key)) return 'checkpoint';
    if (a[key] === b[key]) continue;
    if (!progress.has(key)) return 'checkpoint';
    change = 'progress';
  }
  return change;
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
    // The setup's chosen country map, a restore waiting for its country map ({ message, status }) and a country
    // launch being prepared (UI-only: campaignSnapshot whitelists its keys, so none of these reach a save).
    domesticLoad: { id: null, state: 'idle', message: null },
    restoring: null, launching: false,
    // The football seasons on offer (the built-in earlier ones, then any CM 01/02 sets built on this computer) and the
    // setup's chosen one loading (UI-only, like the country map's), and Retry this setup loading a season campaign's
    // set: { elimination, state: 'loading' | 'error', message }.
    footballSets: BUILT_IN_SETS, footballSetLoad: { id: null, state: 'idle', message: null }, retrySetup: null,
  };

  engagement = new SessionEngagement();
  /** Loaded country whose sections this.geo currently holds (null: the world map). */
  domesticId = null;
  /** Country whose map a pending restore is waiting for. */
  pendingDomesticId = null;
  backdrop = [];
  // Async map loads compare these so a result the player has moved on from is dropped.
  setupMapToken = 0;
  setupSetToken = 0;
  flowToken = 0;
  openingSeed = Date.now() >>> 0;
  away = false;
  updateEngagement = () => this.engagement.switchMode(engagementMode(this.state,
    this.away || (typeof document !== 'undefined' && document.hidden)));
  handleVisibility = () => {
    this.updateEngagement();
    if (typeof document !== 'undefined' && document.hidden) this.flushProgress();
  };
  // The tab is closing or reloading: keep the live match where it was.
  handlePageHide = () => this.flushProgress();
  handleFocus = () => { this.away = false; this.updateEngagement(); };
  handleBlur = () => { this.away = true; this.updateEngagement(); };
  handleStorage = event => {
    // Only an open campaign can conflict. In setup the outgoing campaign's id lingers, and another tab resuming it
    // trapped the setup screen in a conflict dialog it could not close; resuming the stale copy still checks.
    if (this.state.phase !== 'playing' && this.state.phase !== 'victory') return;
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
    window.addEventListener('pagehide', this.handlePageHide);
    document.addEventListener('visibilitychange', this.handleVisibility);
    this.boot();
  }

  componentWillUnmount() {
    this.clearTimers();
    clearTimeout(this.confirmTimer);
    clearTimeout(this.setupLoadTimer);
    clearTimeout(this.setupSetTimer);
    if (typeof window !== 'undefined') {
      window.removeEventListener('storage', this.handleStorage);
      window.removeEventListener('focus', this.handleFocus);
      window.removeEventListener('blur', this.handleBlur);
      window.removeEventListener('keydown', this.handleKeyDown);
      window.removeEventListener('pagehide', this.handlePageHide);
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
    // Revealing a match decided at kickoff, or turning the compass, is only presentation: it is written with the
    // next checkpoint, or when the page is hidden or closed (a whole save per goal, kick and compass stage was
    // most of the campaign's work).
    if (previous && this.state.phase !== 'setup' && this.state.phase !== 'loading') {
      const match = contentChange(previous.match, this.state.match, MATCH_PROGRESS);
      const spin = contentChange(previous.spin, this.state.spin, SPIN_PROGRESS);
      if (match === 'checkpoint' || spin === 'checkpoint') this.persist();
      else if (match || spin) this.unsavedProgress = true;
    }
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
      // The atlas also draws a country map's neighbours in that map's projection.
      this.atlas = atlas ? mergeSharedIds(atlas) : null;
      // Only the display atlas's fitted paths are ever read, so its lon/lat polygons go once projected.
      this.displayGeo = this.atlas ? new WorldGeometry(this.atlas, CAPITALS, { keepPolys: false }) : null;
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
      this.requestSeasons();
    } catch (e) {
      this.setState({ err: 'MAP DATA FAILED TO LOAD — ' + String((e && e.message) || e) });
    }
  }

  /**
   * The read-only view the campaign rules operate on. A country map adds the
   * neighbouring land as obstacles (never territory) and lets routes aim across
   * shared borders; the world board is unchanged.
   */
  board(state = this.state) {
    const routingPaths = this.displayGeo ? drawnPaths(this.displayGeo.paths, this.geo.countries) : this.geo.paths;
    const board = { geo: this.geo, routingPaths, own: state.own, aliveIds: state.aliveIds };
    const domestic = this.domesticMap();
    return domestic ? { ...board, obstacles: this.surroundings(domestic).obstacles, borderRoutes: true } : board;
  }

  /** Neighbouring land of a country map, built once per map and fit (and freed with the map). */
  surroundings(domestic) {
    return domesticSurroundings(this.atlas, domestic, BACKDROP_MARGIN);
  }

  /** Keep the maps in use decoded: the one on screen and the one a restore waits for. */
  retainMaps() {
    retainDomestic([this.domesticId, this.pendingDomesticId]);
  }

  /** Lon/lat on the current chart's unfitted plane (duck-typed test atlases have no project). */
  planePoint(lon, lat) {
    return this.geo.project ? this.geo.project(lon, lat) : projPt(lon, lat);
  }

  /** The loaded country this.geo is showing, or null on the world map. */
  domesticMap() {
    return this.domesticId ? getLoadedDomestic(this.domesticId) : null;
  }

  loadCountry(id) {
    return loadDomestic(id, { baseUrl: import.meta.env.BASE_URL, fetch: pageFetch() });
  }

  loadSet(id) {
    return loadFootballSet(id, { baseUrl: import.meta.env.BASE_URL, fetch: pageFetch() });
  }

  /**
   * Rules and display run on one geometry: the world (id null) or a loaded
   * country's sections. Sections are their own routing paths, so there is no
   * display atlas; the world pair is kept for the way back.
   */
  useGeometry(id) {
    if (id) {
      const loaded = getLoadedDomestic(id);
      if (!loaded) throw new Error(`The map for country ${id} has not loaded.`);
      if (!this.domesticId) {
        this.worldGeo = this.geo;
        this.worldDisplayGeo = this.displayGeo;
      }
      this.geo = loaded.geo;
      this.displayGeo = null;
      this.domesticId = id;
    } else if (this.domesticId) {
      this.geo = this.worldGeo;
      this.displayGeo = this.worldDisplayGeo;
      this.domesticId = null;
      this.backdrop = [];
    }
    this.retainMaps();
  }

  /**
   * Reframe the map on a set of nations. Bumping the key drops any zoom and pan
   * the player had applied, which would otherwise point at the old theatre.
   * A country map always frames all of its sections, so its camera and backdrop
   * never depend on who holds what.
   */
  fitMap(ids, settings) {
    const domestic = this.domesticMap();
    // Launching the country the setup screen already frames keeps its paths,
    // label geometry and backdrop, and so every cache built on them; only the
    // camera resets.
    if (domestic && this.fittedDomestic === domestic && this.geo === domestic.geo) {
      this.viewResetKey = (this.viewResetKey || 0) + 1;
      return;
    }
    this.fittedDomestic = domestic;
    this.geo.fitTo(domestic ? Object.keys(domestic.sectionNames) : ids);
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
    this.flagLayoutCache = null;
    this.viewFocus = null;
    // Flags mode: one banner (or club crest) per owner's land, joining pieces that lie close together.
    this.flagComponents = createFlagRegionIndex(this.labelGeometry, {
      maxGap: FLAG_REGION_GAP_KM / this.geo.kmPerUnit,
    });
    if (domestic) {
      // Setup shows no flags on a country map (its clubs carry crests, not flags). The opening camera leaves out far outliers.
      this.setupFlagOwnership = {};
      this.backdrop = this.domesticBackdrop(domestic);
      this.viewFocus = this.geo.focusView(domestic.focus);
      this.viewResetKey = (this.viewResetKey || 0) + 1;
      return;
    }
    this.backdrop = [];
    this.setupFlagOwnership = Object.fromEntries(this.geo.countries
      .filter(country => NATIONS[country.id] || DEPENDENCIES[country.id])
      .map(country => [country.id, country.id]));
    // Russia and overseas islands remain playable, but the European opening
    // camera should show the continent. Zooming out always restores all land.
    if (settings?.scope === 'UEFA' && settings.layer !== 'clubs') this.viewFocus = this.europeFocus();
    this.viewResetKey = (this.viewResetKey || 0) + 1;
  }

  /** The continent box the European opening camera frames, in the world chart's current fit. */
  europeFocus() {
    const { s, tx, ty } = this.geo.fit;
    const points = [[-15, 34], [44, 34], [-15, 71], [44, 71]].map(([lon, lat]) => {
      const [x, y] = this.planePoint(lon, lat);
      return [x * s + tx, y * s + ty];
    });
    const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
    return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  }

  /**
   * Neighbouring land beneath a country map, in its projection and fit. It is
   * drawn and blocks routes, but is never territory, labels or adjacency. The
   * host's own world shape is drawn only where the sections cover part of it
   * (England keeps the UK beneath, so Wales and Scotland read as land).
   */
  domesticBackdrop(domestic) {
    return this.surroundings(domestic).shapes;
  }

  /**
   * Show the chosen theatre on the setup map: the world, or a country's sections
   * in their clubs' colours. A country that has not loaded yet loads here while
   * the world stays on screen; a result the player has since moved away from is
   * ignored. `refit` reframes even when the geometry does not change.
   */
  showSetupMap(setup = this.state.setup, refit = false) {
    const id = domesticIdOf(setup), token = ++this.setupMapToken;
    const loaded = id ? getLoadedDomestic(id) : null;
    const shown = loaded ? id : null;
    if (refit || shown !== this.domesticId) {
      this.useGeometry(shown);
      this.fitMap(Object.keys(NATIONS));
    }
    const domesticLoad = { id, state: !id ? 'idle' : loaded ? 'ready' : 'loading', message: null };
    const previous = this.state.domesticLoad;
    if (refit || previous?.id !== id || previous?.state !== domesticLoad.state) this.setState({ domesticLoad });
    clearTimeout(this.setupLoadTimer);
    if (!id || loaded) return;
    const current = () => token === this.setupMapToken && this.state.phase === 'setup';
    // Arrow keys on the Theatre list step through countries: fetch and decode
    // only the one the player stays on.
    this.setupLoadTimer = setTimeout(() => current() && this.loadCountry(id).then(() => { if (current()) this.showSetupMap(); }, error => {
      if (!current()) return;
      const name = domesticEntry(setup.clubScope)?.name || 'this country';
      this.setState({ domesticLoad: { id, state: 'error', message: `The map of ${name} could not be loaded. ${error.message || error}` } });
    }), SETUP_LOAD_DELAY_MS);
  }

  retryDomestic() {
    const id = domesticIdOf(this.state.setup);
    if (!id) return;
    clearDomesticCache(id);
    this.showSetupMap();
  }

  /**
   * What the setup screen shows for its chosen country: idle, loading, ready or error. Once the country is on the
   * (inert) map behind the wizard, `preview` is its static step-1 card data (UI-10.6). Render-safe: no setState.
   */
  domesticStatus(setup = this.state.setup) {
    const id = domesticIdOf(setup), load = this.state.domesticLoad;
    const loaded = id ? getLoadedDomestic(id) : null;
    const state = !id ? 'idle' : loaded ? 'ready' : load?.id === id ? load.state : 'loading';
    const preview = loaded && this.fittedDomestic === loaded && this.geo === loaded.geo
      ? countryMapPreview(loaded, this.backdrop) : null;
    return { state, message: state === 'error' ? load.message : null, preview, onRetry: () => this.retryDomestic() };
  }

  /**
   * Football setups offer the built-in earlier seasons and any CM 01/02 sets built on this computer
   * (docs/design/football-years.md). The local index is read once, in the background; without one the built-in
   * seasons stand alone. Resolves when the read is done.
   */
  requestSeasons() {
    if (getSport(this.state.setup.sport).id !== 'football') return null;
    this.seasonIndex ||= loadFootballSetIndex({ baseUrl: import.meta.env.BASE_URL, fetch: pageFetch() })
      .then(sets => { if (sets !== this.state.footballSets) this.setState({ footballSets: sets }); });
    return this.seasonIndex;
  }

  /** A season's name for messages: its listed label ("FIFA 18", "CM 01/02 · May 2026"), else its id. */
  setName(id) {
    return this.state.footballSets.find(set => set.id === id)?.label || getLoadedFootballSet(id)?.meta.label || id;
  }

  /**
   * Load the setup's chosen data set (loading, then ready or error), as the setup loads a country map. A failed load
   * stays failed until Retry, and a result the player has since moved away from is ignored.
   */
  showSetupSet(setup = this.state.setup, retry = false) {
    const id = dataSetOf(setup), loaded = id ? getLoadedFootballSet(id) : null, previous = this.state.footballSetLoad;
    const token = ++this.setupSetToken;
    retainFootballSets([id]);
    clearTimeout(this.setupSetTimer);
    if (id && !loaded && !retry && previous?.id === id && previous.state === 'error') return;
    const footballSetLoad = { id, state: !id ? 'idle' : loaded ? 'ready' : 'loading', message: null };
    if (previous?.id !== id || previous.state !== footballSetLoad.state) this.setState({ footballSetLoad });
    if (!id || loaded) return;
    const current = () => token === this.setupSetToken && this.state.phase === 'setup';
    // Arrow keys on the Season list step through the sets, as on the Theatre list: fetch and decode only the one the
    // player stays on.
    this.setupSetTimer = setTimeout(() => current() && this.loadSet(id).then(() => {
      if (!current()) return;
      this.setState(state => {
        const clubScope = setClubScope(state.setup);
        return { footballSetLoad: { id, state: 'ready', message: null },
          ...(clubScope !== state.setup.clubScope ? { setup: { ...state.setup, clubScope, managedTeamId: '' } } : {}) };
      });
    }, error => {
      if (current()) this.setState({ footballSetLoad: { id, state: 'error', message: `The ${this.setName(id)} season could not be loaded. ${error.message || error}` } });
    }), SETUP_LOAD_DELAY_MS);
  }

  retrySet() {
    const id = dataSetOf(this.state.setup);
    if (!id) return;
    clearFootballSetCache(id);
    this.showSetupSet(this.state.setup, true);
  }

  /**
   * What the setup's Season choice shows: the listed data sets, and the chosen one's state (idle, loading, ready or
   * error) with its season-bound sport once loaded. Render-safe: no setState.
   */
  seasonStatus(setup = this.state.setup) {
    const id = dataSetOf(setup), load = this.state.footballSetLoad;
    const loaded = id ? getLoadedFootballSet(id) : null;
    const failed = !loaded && load?.id === id && load.state === 'error';
    return { sets: this.state.footballSets, state: !id ? 'idle' : loaded ? 'ready' : failed ? 'error' : 'loading',
      message: failed ? load.message : null, sport: loaded ? footballSport(loaded) : null, onRetry: () => this.retrySet() };
  }

  /** Display name of a territory: a country map's section, else a nation or dependency. */
  territoryName(cid) {
    return this.domesticMap()?.sectionNames[cid] || NATIONS[cid]?.[0] || DEPENDENCIES[cid]?.name || cid;
  }

  /** The theatre's display name. The data's trailing "*" footnote marker ("Asia & Oceania*") is a setup-only device. */
  scopeName(settings = this.state.settings) {
    if (domesticIdOf(settings)) return domesticLabel(settings.clubScope);
    if (settings?.layer === 'clubs') {
      const scopes = CLUB_SCOPES(getSport(settings.sport));
      return plainScopeName((scopes.find(x => x.id === settings.clubScope) || scopes[0]).name);
    }
    return plainScopeName(SCOPES.find(x => x.id === settings?.scope)?.name || 'World War');
  }

  /** Quick-resume progress: "12 nations remaining", or "Campaign complete" once one team holds the map. */
  savedProgress(meta) {
    const alive = Number(meta?.alive) || 0;
    if (alive <= 1) return 'Campaign complete';
    return `${alive} ${meta.settings?.layer === 'clubs' ? 'clubs' : 'nations'} remaining`;
  }

  // ---------- campaign lifecycle ----------

  /**
   * The saved state as persist would write it, minus what persist stamps on (the revision, the engagement clock),
   * for an identity comparison with the last checkpoint.
   */
  checkpointSource(rngState) {
    const st = this.state;
    const { engagement: _clock, ...metrics } = st.metrics || {};
    return { ...Object.fromEntries(CHECKPOINT_KEYS.map(key => [key, st[key]])), rngState, revision: null, metrics: null,
      ...Object.fromEntries(Object.entries(metrics).map(([key, value]) => [`metrics.${key}`, value])), phase: st.phase === 'victory' };
  }

  persist() {
    if (!Object.keys(this.state.teams).length || this.saving || this.state.storageConflict) return;
    const rngState = this.rng?.getState?.() ?? this.state.rngState;
    // Unchanged since the last checkpoint (a decision both changes the match and saves in its callback): no write.
    const source = this.checkpointSource(rngState), last = this.lastCheckpoint;
    if (last && this.saved?.campaignId === this.state.campaignId && Object.keys(source).length === Object.keys(last).length
        && Object.keys(source).every(key => source[key] === last[key])) {
      this.unsavedProgress = false;
      return;
    }
    this.saving = true;
    const snapshot = { ...this.state, rngState,
      ...(this.saved?.campaignId === this.state.campaignId ? { revision: this.saved.revision } : {}),
      metrics: { ...this.state.metrics, engagement: this.engagement.snapshot() } };
    const saveStatus = writeSave(snapshot);
    this.saving = false;
    this.unsavedProgress = false;
    this.lastCheckpoint = saveStatus.ok ? { ...source, campaignId: saveStatus.campaignId, campaignName: saveStatus.campaignName } : null;
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

  /** Write live presentation no checkpoint has saved yet (the page is hidden or closing). */
  flushProgress() {
    if (!this.unsavedProgress || (this.state.phase !== 'playing' && this.state.phase !== 'victory')) return;
    this.persist();
  }

  pickSetup(key, value) {
    this.setState(state => {
      const setup = { ...state.setup, [key]: value };
      const domestic = isDomesticScope(setup.clubScope);
      if (key === 'preset') {
        setup.scope = value === 'short' ? 'elite' : value === 'world' ? 'world' : 'UEFA';
        // A chosen country is its own theatre; a session length does not replace it.
        if (!domestic) setup.clubScope = value === 'short' ? 'elite' : value === 'world' ? 'all'
          : CLUB_SCOPES(sportOf(setup) || getSport(setup.sport))[2]?.id || 'all';
      } else if (['scope', 'clubScope'].includes(key)) setup.preset = 'custom';
      // Country maps come with football data only (basketball clubs take the NBA's map below, in setClubScope).
      if (key === 'sport' && (domestic ? getSport(value).id !== 'football'
        : !CLUB_SCOPES(getSport(value)).some(s => s.id === setup.clubScope))) setup.clubScope = 'all';
      // So do data sets, and they bring their own clubs.
      if (setup.dataSet != null && getSport(setup.sport).id !== 'football') setup.dataSet = null;
      const clubScope = setClubScope(setup);
      if (clubScope !== setup.clubScope) setup.clubScope = clubScope;
      // The field changes with the theatre, so the managed team goes too, but a
      // preset leaves a chosen country's club theatre (and its clubs) as it was.
      const sameField = key === 'preset' && domestic && setup.layer === 'clubs';
      if (['sport', 'layer', 'scope', 'clubScope', 'preset', 'dataSet'].includes(key) && !sameField) setup.managedTeamId = '';
      return { setup };
    }, () => {
      if (this.state.phase !== 'setup') return;
      this.showSetupMap();
      this.showSetupSet();
      this.requestSeasons();
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
    // Close, Escape and Cancel import also mean "not that campaign" for a restore still loading its map.
    this.cancelRestore();
    const previous = this.storageReturn || { autoplay: false, paused: false };
    this.setState({ storageDialog: null, ...previous }, () => {
      if (!previous.paused) this.clock.resume();
      this.updateEngagement();
    });
  }

  continueSaved(campaign, fork = false, name) {
    if (!campaign || this.pendingDomesticId != null) return;
    // A country campaign is checked against its map before it replaces anything.
    return this.withCampaignMap(campaign, (_loaded, fitted) => {
      this.saved = fork ? forkCampaign(fitted, name) : fitted;
      this.setState({ storageDialog: null, storageConflict: false }, () => this.resume());
    });
  }

  /**
   * Restoring a country campaign needs its map first. Runs `then(loaded, fitted)`
   * once the map has loaded and the save fits it (synchronously when nothing has
   * to load); `fitted` is the save moved onto this build of the map. Otherwise
   * refuses with a clear message. World campaigns run at once, as saved.
   */
  withCampaignMap(campaign, then) {
    const id = domesticIdOf(campaign?.settings);
    if (!id) return then(null, campaign);
    const loaded = getLoadedDomestic(id);
    if (loaded) {
      const fitted = fitDomesticCampaign(campaign, loaded);
      if (fitted.error) {
        this.refuseRestore(fitted.error);
        return false;
      }
      return then(loaded, fitted.campaign);
    }
    const token = ++this.flowToken;
    const name = domesticEntry(campaign.settings.clubScope)?.name || 'this country';
    const message = `Loading the map of ${name}…`;
    this.pendingDomesticId = id;
    this.retainMaps();
    this.setState(state => ({ restoring: { message, status: state.restoring?.status ?? state.saveStatus }, saveStatus: { ok: true, message } }));
    const current = () => {
      if (token !== this.flowToken) return false;
      this.endRestore();
      return true;
    };
    return this.loadCountry(id).then(() => current() && this.withCampaignMap(campaign, then), error => {
      if (current()) this.refuseRestore(`The map of ${name} could not be loaded, so the campaign cannot resume. ${error.message || error}`);
      return false;
    });
  }

  /** The pending restore is over (it ran, failed or was replaced). */
  endRestore() {
    this.pendingDomesticId = null;
    this.retainMaps();
    this.setState(state => state.restoring ? { restoring: null } : null);
  }

  /** Drop a restore still waiting for its map: its campaign must not replace anything later. */
  cancelRestore() {
    if (this.pendingDomesticId == null) return;
    this.flowToken++;
    this.pendingDomesticId = null;
    this.retainMaps();
    this.setState(state => state.restoring ? { restoring: null, saveStatus: state.restoring.status ?? null } : null);
  }

  refuseRestore(message) {
    this.setState(state => ({ saveStatus: { ok: false, message },
      ...(state.storageDialog ? { storageDialog: { ...state.storageDialog, error: message } } : {}) }));
  }

  /**
   * The wizard's team list (`managerTeams`): `{ id, name, rating, players, neighbours? }` sorted by name. `players` are
   * the five best lineup starters of the built squad (so "Best players" matches the opening ratings, competitive
   * presets included); `neighbours` are the land neighbours on the opening board, overseas territory included as at
   * launch (board 03 "Fronts"). Uses its own seeded RNG, never `this.rng`; cached per setup key. A country theatre
   * waits for its map (an empty list while it loads) and lists its clubs with their own codes and home sections.
   */
  setupTeams(setup = this.state.setup) {
    const domesticId = domesticIdOf(setup);
    const loaded = domesticId ? getLoadedDomestic(domesticId) : null;
    const sport = sportOf(setup);
    const key = JSON.stringify([setup.sport, setup.layer, setup.scope, setup.clubScope, setup.seed, setup.rosterPreset, !!this.geo,
      domesticId ? loaded?.meta.version || 'loading' : null, dataSetOf(setup) ? sport?.dataVersion || 'loading' : null]);
    if (this.setupTeamsCache?.key === key) return this.setupTeamsCache.teams;
    const { included, own } = this.opening(setup, makeRng(this.setupSeed(setup)));
    const ids = new Set(included.map(team => team.id));
    const opening = { ...own };
    if (setup.layer !== 'clubs') {
      for (const [shapeId, holder] of heldShapes(sport)) if (ids.has(holder)) opening[shapeId] = holder;
    }
    // Fronts on the board the campaign opens on: the country's sections, else the world (never a previewed country,
    // which this.geo may still show between a theatre pick and its showSetupMap callback).
    const geo = domesticId ? loaded?.geo : this.domesticId ? this.worldGeo : this.geo;
    const board = geo?.adj ? { geo, own: opening } : null;
    // Country clubs (ids like "d826-679") are unknown to the sport's club list: pass their own code and kind.
    const teams = included.map(team => ({ id: team.id, name: team.name, code: team.code, isClub: team.kind === 'club',
      rating: teamEff(team),
      ...(loaded ? { meta: [team.conf, loaded.sectionNames[team.home]].filter(Boolean).join(' · ') } : {}),
      players: selectLineup(team).starters.filter(player => Number.isFinite(player?.rating))
        .sort((a, b) => b.rating - a.rating || String(a.name).localeCompare(String(b.name))).slice(0, 5)
        .map(player => ({ pos: player.pos, name: player.name, rating: player.rating })),
      ...(board ? { neighbours: [...empireNeighbors(board, team.id)] } : {}) }))
      .sort((a, b) => a.name.localeCompare(b.name));
    this.setupTeamsCache = { key, teams, opening, homes: Object.keys(own) };
    return teams;
  }

  /**
   * Step 1's map of a world theatre: the board it opens on, framed as the campaign's opening camera frames it (Europe
   * for the UEFA nations, else the teams' starting land). A country theatre has its own card (`domesticStatus`), and
   * so does the moment a previewed country still holds this.geo after the theatre changed. Render-safe: no setState.
   */
  setupMapPreview(setup = this.state.setup) {
    if (!this.geo || this.domesticId || domesticIdOf(setup)) return null;
    this.setupTeams(setup);
    const { opening, homes } = this.setupTeamsCache;
    const focus = setup.layer !== 'clubs' && setup.scope === 'UEFA' ? this.europeFocus() : null;
    return theatreMapPreview({ countries: this.geo.countries, paths: this.displayGeo?.paths, basePaths: this.geo.paths,
      own: opening, frameIds: homes, focus });
  }

  setupSeed(setup = this.state.setup) {
    const entered = String(setup.seed || '').trim();
    return entered ? (/^\d+$/.test(entered) ? Number(entered) >>> 0 : hashStr(entered)) : this.openingSeed;
  }

  opening(su, rng) {
    const sport = sportOf(su), clubLayer = su.layer === 'clubs';
    // Nobody plays until a chosen data set has loaded, as with a country map.
    if (!sport) return { included: [], own: {}, scopeName: this.scopeName(su) };
    let included, own = {}, scopeName;
    const domesticId = domesticIdOf(su);
    if (domesticId) {
      // Each club starts on its group of sections (just its home on a 100-club
      // map). Nobody plays until the map has loaded.
      const loaded = getLoadedDomestic(domesticId);
      included = loaded ? loaded.clubs.map(row => buildClub(row, sport)) : [];
      if (loaded) own = { ...loaded.startOwners };
      scopeName = domesticLabel(su.clubScope);
    } else if (clubLayer) {
      const scope = CLUB_SCOPES(sport).find(x => x.id === su.clubScope) || CLUB_SCOPES(sport)[0];
      included = sport.clubs.filter(scope.filter).map(c => buildClub(c, sport));
      scopeName = plainScopeName(scope.name);
      // World clubs always seed on the world map, even while a country preview is shown.
      const world = this.domesticId ? this.worldGeo : this.geo;
      if (world) {
        own = seedClubs(world, included);
        included = included.filter(c => Object.values(own).includes(c.id));
      }
    } else {
      const all = fieldedNations(sport).map(id => buildTeam(id, rng, sport));
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

  /**
   * The setup screen's Launch. Setting up a country map takes a moment, so the
   * button first shows that it is preparing and the work starts after that
   * paint. World theatres launch at once, as before.
   */
  launchCampaign() {
    if (!domesticIdOf(this.state.setup)) return this.startCampaign();
    if (this.state.launching) return;
    let started = false, frame = null, timer = null;
    const start = () => {
      if (started) return;
      started = true;
      // Whichever of the frame and the fallback timer loses is cancelled, so nothing stays pending after kickoff.
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      // After the frame that shows the busy button (a hidden tab paints nothing, so a timer stands in).
      setTimeout(() => {
        const done = () => this.setState({ launching: false });
        if (this.state.phase !== 'setup') return done();
        Promise.resolve(this.startCampaign()).finally(done);
      }, 0);
    };
    this.setState({ launching: true }, () => {
      frame = requestAnimationFrame(start);
      timer = setTimeout(start, 100);
    });
  }

  startCampaign() {
    this.cancelRestore();
    // No setup-screen map or data set load outlives the setup screen.
    clearTimeout(this.setupLoadTimer);
    clearTimeout(this.setupSetTimer);
    const su = this.state.setup;
    const domesticId = domesticIdOf(su), dataSet = dataSetOf(su);
    const token = ++this.flowToken;
    if (domesticId && !getLoadedDomestic(domesticId)) {
      // The setup screen waits for the map, but a retry or test may arrive first.
      const name = domesticEntry(su.clubScope)?.name || 'this country';
      return this.loadCountry(domesticId).then(() => token === this.flowToken && this.startCampaign(), error => {
        if (token === this.flowToken) this.setState({ saveStatus: { ok: false, message: `The map of ${name} could not be loaded. ${error.message || error}` } });
      });
    }
    if (dataSet && !getLoadedFootballSet(dataSet)) {
      // As with a country map: the setup screen waits for the data set, a retried setup loads it first.
      const name = this.setName(dataSet);
      return this.loadSet(dataSet).then(() => token === this.flowToken && this.startCampaign(), error => {
        if (token === this.flowToken) this.setState({ saveStatus: { ok: false, message: `The ${name} season could not be loaded, so this setup cannot start. ${error.message || error}` } });
      });
    }
    const seed = this.setupSeed(su);
    this.rng = makeRng(seed);
    const clubLayer = su.layer === 'clubs';
    const sport = sportOf(su);
    const { included, own, scopeName } = this.opening(su, this.rng);
    if (su.role === 'manager' && !included.some(team => team.id === su.managedTeamId)) {
      this.setState({ saveStatus: { ok: false, message: 'Choose the team you will manage before launching.' } });
      return;
    }
    this.clearTimers();
    this.engagement = new SessionEngagement();
    // Stale stamps from a retried campaign never outlive their map or data set.
    const { domesticVersion: _previousMap, dataVersion: _previousSet, dataYear: _year, dataSeason: _season, ...chosen } = su;
    const settings = { ...DEFAULT_SETUP, ...chosen, ...this.launchRules(su), seed: String(seed),
      ...(domesticId ? { domesticVersion: getLoadedDomestic(domesticId).meta.version } : {}),
      dataSet, ...(dataSet ? { dataVersion: sport.dataVersion, dataYear: sport.dataYear, dataSeason: sport.dataSeason } : {}) };

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
      // Overseas territory, and a data set's merged federations, come with their holder if it is playing.
      for (const [shapeId, holder] of heldShapes(sport)) {
        if (teams[holder]) own[shapeId] = holder;
      }
    }
    this.useGeometry(domesticId);
    this.fitMap(Object.keys(own), su);
    this.setState(
      {
        phase: 'playing',
        settings,
        initialSettings: { ...settings },
        turnQueue: [], turnIndex: 0, pendingTarget: null, view: 'map', viewSource: 'user', tacticalPreview: false,
        phoneMore: false, focusLayout: null, targetHoverId: null,
        managedTeamId: su.role === 'manager' ? su.managedTeamId : null, managementEnded: false,
        managerElimination: null, tacticalChoice: null, decisionLedger: [], historyFilter: '',
        campaignId: createCampaignId(), revision: 0,
        campaignName: `${campaignLabel(settings, scopeName)}${su.role === 'manager' ? ' · ' + included.find(team => team.id === su.managedTeamId).name : ''}`,
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
    // A country campaign waits for its map; world campaigns restore synchronously.
    return this.withCampaignMap(s, (loaded, fitted) => this.restoreCampaign(fitted, loaded));
  }

  restoreCampaign(s, loaded) {
    this.flowToken++;
    this.endRestore();
    this.clearTimers();
    this.engagement = new SessionEngagement(s.metrics?.engagement);
    this.rng = makeRng(s.seed ?? 1);
    this.rng.setState(s.rngState ?? s.seed ?? 1);
    this.useGeometry(loaded ? loaded.meta.id : null);
    this.fitMap(Object.keys(s.own), s.settings);
    // A save from another build was moved club by club onto this map; its saved draw is stale.
    const remapped = !!loaded && s.settings.domesticVersion !== loaded.meta.version;
    const message = s.legacy ? 'Legacy campaign restored. Future matches use the saved seed.'
      : remapped ? `Campaign restored on an updated map of ${loaded.meta.name}.${s.spin ? ' The interrupted draw starts again.' : ''}`
        : 'Campaign restored';
    // The dropped draw's round-robin turn was committed with it: step back so the same attacker draws again
    // (nextTurn keeps the round when it finds that entry). Random order needs nothing.
    const redraw = remapped && !!s.spin && { ...DEFAULT_SETUP, ...s.settings }.turnOrder === 'round-robin';
    const restored = {
      phase: s.phase === 'victory' ? 'victory' : 'playing',
      settings: { ...DEFAULT_SETUP, ...s.settings, ...(loaded ? { domesticVersion: loaded.meta.version } : {}) },
      initialSettings: s.initialSettings || { ...DEFAULT_SETUP, ...s.settings },
      managedTeamId: s.managedTeamId || (s.settings.role === 'manager' && !s.managementEnded ? s.followedId : null),
      managementEnded: !!s.managementEnded, managerElimination: s.managerElimination || null,
      tacticalChoice: s.tacticalChoice || null, decisionLedger: s.decisionLedger || [],
      historyFilter: s.historyFilter || '', selectedHistoryId: s.selectedHistoryId || null,
      campaignId: s.campaignId || createCampaignId(), revision: s.revision || 0, campaignName: s.campaignName || campaignLabel(s.settings, this.scopeName(s.settings)),
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
      saveStatus: { ok: true, message },
      turnQueue: s.turnQueue || [], turnIndex: redraw ? Math.max(0, (s.turnIndex || 0) - 1) : s.turnIndex || 0,
      pendingTarget: s.pendingTarget || null,
      view: 'map', viewSource: 'user', tacticalPreview: false, phoneMore: false, focusLayout: null, targetHoverId: null,
    };
    const gated = s.choice || s.tacticalChoice || s.managerElimination || s.pendingTarget;
    // A restored unapplied match is presented again: the same auto-switch rule as a kickoff (DEC D11).
    const autoView = !gated && s.match && !s.match.applied
      ? this.autoMatchView({ ...this.state, ...restored }, s.match.aId, s.match.dId, { express: !!s.match.express, instant: !!s.match.instant }) : {};
    // A reloaded signing is framed like a live one (A-2): the taken land beside the article (pure, no RNG).
    const signingFocus = s.choice ? this.conquestFocus({ ...this.state, ...restored }) : {};
    this.setState({ ...restored, ...autoView, ...signingFocus }, () => {
      // A decision gate holds the campaign: nothing is presented or redrawn until it is answered.
      if (!gated && s.match && !s.match.applied) this.presentMatch();
      else if (!gated && s.spin && !remapped) this.startMatch(s.spin.attackerId, s.spin.targetId, s.spin);
      this.persist();
      // The checkpoint re-stamps the map version; keep telling the player why the draw restarts.
      if (remapped) this.setState(state => state.saveStatus?.ok && !state.storageConflict ? { saveStatus: { ...state.saveStatus, message } } : null);
    });
  }

  discardSave() {
    this.cancelRestore();
    clearSave(this.state.campaignId || this.saved?.campaignId);
    this.saved = null;
    this.setState({ hasSave: false, savedMeta: null });
  }

  /** Delete a saved campaign slot for good (from Saved campaigns, after confirmation). */
  deleteSavedCampaign(id) {
    const st = this.state, playing = st.phase === 'playing' || st.phase === 'victory';
    if (playing && id === st.campaignId) return;
    const result = deleteCampaign(id);
    if (result.ok && this.saved?.campaignId === id) {
      this.saved = null;
      this.setState({ hasSave: false, savedMeta: null });
    }
    if (result.ok && !playing && st.campaignId === id) this.setState({ campaignId: null, revision: 0 });
    this.setState(state => ({ storageDialog: state.storageDialog && { ...state.storageDialog, error: result.ok ? null : result.message,
      notice: result.ok ? 'Campaign deleted from this browser.' : null } }),
    // A campaign that could not be saved for lack of space saves now.
    () => { if (result.ok && playing && this.state.saveStatus?.quota) this.persist(); });
  }

  /** Keep the previous campaign until a replacement is actually launched. */
  newCampaign() {
    if (!this.state.confirmNew) {
      this.setState({ confirmNew: true });
      return;
    }
    this.openSetup();
  }

  /** Back to setup with a fresh opening seed (a blank seed field means a new draw), from the masthead or the results. */
  openSetup() {
    this.clearTimers();
    this.cancelRestore();
    this.flowToken++;
    this.openingSeed = Date.now() >>> 0;
    this.setupTeamsCache = null;
    this.showSetupMap(this.state.setup, true);
    this.showSetupSet();
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
    this.setState({ managerElimination: null, retrySetup: null, managementEnded: true, autoplay: false, paused: false, pu: null, toast: null,
      phase: this.state.aliveIds.length === 1 ? 'victory' : 'playing' }, () => this.persist());
  }

  retryManager() {
    const setup = { ...DEFAULT_SETUP, ...(this.state.initialSettings || this.state.settings), seed: String(this.state.seed), managedTeamId: this.state.managedTeamId };
    // The save holds a data set campaign's players, but playing its setup again needs the set itself. The dialog
    // reports the load, not the save status: the checkpoint was saved whatever happens to the set.
    const dataSet = dataSetOf(setup), elimination = this.state.managerElimination;
    if (dataSet && !getLoadedFootballSet(dataSet)) {
      const token = ++this.flowToken, name = this.setName(dataSet);
      // Gone once the player has followed the remaining teams instead, or another campaign has opened.
      const current = () => token === this.flowToken && this.state.managerElimination === elimination;
      this.setState({ retrySetup: { elimination, state: 'loading', message: `Loading the ${name} season…` } });
      return this.loadSet(dataSet).then(() => current() && this.retryManager(), error => {
        if (current()) this.setState({ retrySetup: { elimination, state: 'error',
          message: `This setup needs the ${name} season, which could not be loaded. ${error.message || error}` } });
      });
    }
    this.clearTimers();
    this.setState({ setup, managerElimination: null, retrySetup: null }, () => this.startCampaign());
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
    // clearTimers() also dropped the tasks that would clear the kickoff popup and the last goal toast.
    this.setState({ paused: false, pu: null, toast: null });
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
    // managedId() is null once management ends; the eliminated team stays on record ("Your managed team", the save).
    const managedTeamId = this.state.managementEnded ? this.state.managedTeamId : this.managedId();
    this.setState({ managedTeamId, followedId: id || null, selected: id || this.state.selected }, () => this.persist());
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
      displayRound: displayRound(st), totalTeams: this.teamCount(st.teams),
      labelGeometry: this.labelGeometry || [], viewFocus: this.viewFocus || null, cache: this.vmCache,
      // A country map's section names (null on the world map), so pure view-models name sections without the loader.
      sectionNames: this.domesticMap()?.sectionNames || null,
    };
  }

  /** How many teams `teams` holds, counted once per teams object (every view-model builder asks, every render). */
  teamCount(teams) {
    if (this.countedTeams !== teams) {
      this.countedTeams = teams;
      this.teamTotal = Object.keys(teams || {}).length;
    }
    return this.teamTotal;
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
    // A country map (setup preview or campaign) has no world oceans to name.
    const domesticMap = !!this.domesticId;
    const oceanLabels = !playing && this.geo && !domesticMap ? [
      ['Pacific Ocean', -135, -5], ['Atlantic Ocean', -30, 0], ['Indian Ocean', 76, -25],
    ].map(([text, lon, lat]) => {
      const [x, y] = this.planePoint(lon, lat);
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
      confirmNew: st.confirmNew, completed,
      // Exactly when setSetting refuses a `resolution` change: a draw in progress or an unapplied match.
      busy: liveMatch || !!st.spin,
      onNew: () => this.newCampaign(), onCancelNew: () => this.setState({ confirmNew: false }),
      saveStatus: st.saveStatus, onExport: () => this.exportProgress(), onImport: file => this.importProgress(file),
      onResults: () => this.setState({ phase: 'victory' }), seed: st.seed, settings: st.settings,
      onSetting: (key, value) => this.setSetting(key, value), managementEnded: st.managementEnded,
      managedName: st.teams?.[st.managedTeamId]?.name || null,
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
            backdrop={this.backdrop} showAllHomes={domesticMap}
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
            onToggleSheet={() => this.togglePhoneSheet()} onOpenChronicle={st.choice || st.pendingTarget ? undefined : () => this.setView('chronicle')}
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
          setup={st.setup} hasSave={st.hasSave} managerTeams={this.setupTeams()} domestic={this.domesticStatus()}
          theatreMap={this.setupMapPreview()}
          season={this.seasonStatus()}
          savedText={st.savedMeta ? 'Round ' + st.savedMeta.round + ' · ' + this.savedProgress(st.savedMeta) + ' · ' + this.scopeName(st.savedMeta.settings)
            + (st.savedMeta.settings?.dataSeason ? ' · ' + st.savedMeta.settings.dataSeason : '') : ''}
          onResume={() => this.resume()} onDiscard={() => this.discardSave()}
          onPick={(key, value) => this.pickSetup(key, value)}
          onStart={() => this.launchCampaign()} launching={st.launching} restoring={!!st.restoring}
          saveStatus={st.saveStatus} onExport={() => this.exportProgress()} onImport={file => this.importProgress(file)}
          onManageSaves={() => this.openStorageDialog('slots')}
          onCancel={st.hasSave ? () => this.resume() : undefined}
        />}
        {victory && !st.storageDialog && !st.exportText && !st.managerElimination && <VictoryOverlay {...victory} positionColors={sport.positionColors}
          // "View map" (and close): the final's automatic switch to the Match view is otherwise never undone.
          onClose={() => this.setState({ phase: 'playing', view: 'map', viewSource: 'user' })}
          onNew={() => this.openSetup()}
        />}
        {st.tacticalChoice && st.tacticalPreview && !st.storageDialog && !st.exportText && <TacticalChoice choice={st.tacticalChoice}
          preview={this.matchPreviewModel()} onSimulate={() => this.simulateResult()}
          onChoose={id => this.chooseTactic(id)} onClose={() => this.closeMatchPreview()} />}
        {st.managerElimination && !st.storageDialog && !st.exportText && <ManagerElimination result={st.managerElimination}
          model={this.eliminationModel()} onSpectate={() => this.continueAsSpectator()} onRetry={() => this.retryManager()} />}
        {st.storageDialog && !st.exportText && <CampaignStorageDialog key={st.storageDialog.mode} {...st.storageDialog}
          activeId={st.campaignId} campaigns={listCampaigns()} onClose={() => this.closeStorageDialog()}
          busy={st.restoring?.message || null} lockedId={playing ? st.campaignId : null}
          onDelete={id => this.deleteSavedCampaign(id)}
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
            let result;
            // A slot deleted in another tab while the dialog was open cannot be renamed: say so rather than throw.
            try { result = renameCampaign(id, name); } catch (error) { result = { ok: false, message: error.message }; }
            // The quick-resume copy (no campaign open yet after a reload) takes the new revision too, or resuming
            // it reads as a change made in another tab.
            if (result.ok && this.saved?.campaignId === id) {
              this.saved = { ...this.saved, revision: result.revision, campaignName: result.campaignName };
            }
            if (result.ok && id === st.campaignId) this.setState({ revision: result.revision, campaignName: result.campaignName });
            this.setState({ storageDialog: { ...st.storageDialog, error: result.ok ? null : result.message, notice: null } });
          }}
          // In setup the fork copies the quick-resume save; the outgoing campaign's teams may outlive a cleared one.
          onFork={(st.phase === 'setup' ? this.saved : Object.keys(st.teams).length) ? name => this.continueSaved(st.phase === 'setup' ? this.saved
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
