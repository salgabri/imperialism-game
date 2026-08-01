import React from 'react';
import { CONFIG } from './config.js';
import { C, FONT, pad3, tint } from './theme.js';
import { NATIONS, SCOPES, buildTeam, makeRng, teamEff } from './data/teams.js';
import { flagUrl } from './data/flags.js';
import { WorldGeometry } from './engine/geo.js';
import { simulateMatch } from './engine/match.js';
import {
  drawBlitzPairs,
  drawChaosPairs,
  empireCenter,
  pickTarget,
  territories,
} from './engine/campaign.js';
import { clearSave, loadSave, writeSave } from './engine/storage.js';
import CommandBar from './components/CommandBar.jsx';
import WorldMap from './components/WorldMap.jsx';
import Sidebar from './components/Sidebar.jsx';
import SetupOverlay from './components/SetupOverlay.jsx';
import VictoryOverlay from './components/VictoryOverlay.jsx';
import { MatchupPopup, ResultPopup, StealPopup, Toast } from './components/Popups.jsx';

const MAP_URL = `${import.meta.env.BASE_URL}world-110m.v1.json`;
const LOG_CAP = 220;
const FEED_CAP = 90;
const BATTLE_SCARS = 7;
const MS_PER_MINUTE = 46; // ticker pace: a 90-minute match in ~4.2s at 1×
const DEFAULT_SETUP = { scope: 'world', pacing: 'duel', resolution: 'ticker' };

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
    tab: 'feed',
    selected: null,
    hoverCid: null,
    flash: {},
    confirmNew: false,
    hasSave: false,
    savedMeta: null,
    pu: null,
    toast: null,
    battles: [],
  };

  /** Every pending simulation timeout, so a reset or unmount can cancel the war. */
  timers = new Set();
  confirmTimer = null;

  mapRef = React.createRef();
  svgRef = React.createRef();
  tipRef = React.createRef();
  coordRef = React.createRef();
  eventsRef = React.createRef();

  componentDidMount() {
    this.boot();
  }

  componentWillUnmount() {
    this.clearTimers();
    clearTimeout(this.confirmTimer);
  }

  componentDidUpdate() {
    const el = this.eventsRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }

  // ---------- timing ----------

  /** Schedule simulation work, scaled by the speed control and cancellable. */
  after(ms, fn) {
    const id = setTimeout(() => {
      this.timers.delete(id);
      fn();
    }, ms / (this.state.speed || 1));
    this.timers.add(id);
    return id;
  }

  clearTimers() {
    for (const id of this.timers) clearTimeout(id);
    this.timers.clear();
  }

  // ---------- boot ----------

  async boot() {
    try {
      const res = await fetch(MAP_URL);
      if (!res.ok) throw new Error('map fetch ' + res.status);
      this.geo = new WorldGeometry(await res.json());
      this.rng = makeRng((Date.now() % 1000000007) >>> 0);

      const saved = loadSave();
      if (saved) {
        this.saved = saved;
        this.setState({
          hasSave: true,
          savedMeta: { round: saved.round, alive: saved.aliveIds.length, scope: saved.settings.scope },
        });
      }
      this.geo.fitTo(Object.keys(NATIONS));
      this.setState({ phase: 'setup' });
    } catch (e) {
      this.setState({ err: 'MAP DATA FAILED TO LOAD — ' + String((e && e.message) || e) });
    }
  }

  /** The read-only view the campaign rules operate on. */
  board(state = this.state) {
    return { geo: this.geo, own: state.own, aliveIds: state.aliveIds };
  }

  // ---------- campaign lifecycle ----------

  startCampaign() {
    this.clearTimers();
    const su = this.state.setup;
    this.rng = makeRng((Date.now() % 1000000007) >>> 0);

    const all = Object.keys(NATIONS).map(id => buildTeam(id, this.rng));
    let included;
    if (su.scope === 'world') {
      included = all;
    } else if (su.scope === 'elite') {
      included = all.slice().sort((a, b) => b.str - a.str || teamEff(b) - teamEff(a)).slice(0, 32);
    } else {
      included = all.filter(SCOPES.find(x => x.id === su.scope).filter);
    }

    const teams = {};
    const own = {};
    const stats = {};
    for (const t of included) {
      teams[t.id] = t;
      own[t.id] = t.id; // everyone starts holding exactly their homeland
      stats[t.id] = { conq: 0, steals: [] };
    }
    this.geo.fitTo(included.map(t => t.id));

    const scopeName = SCOPES.find(x => x.id === su.scope).name;
    this.setState(
      {
        phase: 'playing',
        settings: { ...su },
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
        tab: 'feed',
        confirmNew: false,
        battles: [],
        log: [
          {
            t: 'sys',
            r: 0,
            txt: 'CAMPAIGN START — ' + included.length + ' NATIONS · THEATRE: ' + scopeName.toUpperCase(),
            chip: C.textMute,
          },
        ],
      },
      () => writeSave(this.state),
    );
  }

  resume() {
    const s = this.saved;
    if (!s) return;
    this.geo.fitTo(Object.keys(s.teams));
    this.setState({
      phase: s.phase === 'victory' ? 'victory' : 'playing',
      settings: s.settings,
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
      match: null,
      spin: null,
      atk: null,
      autoplay: false,
      selected: null,
      flash: {},
      battles: [],
    });
  }

  discardSave() {
    clearSave();
    this.saved = null;
    this.setState({ hasSave: false, savedMeta: null });
  }

  /** Two-step so a stray click cannot wipe a long campaign. */
  newCampaign() {
    if (!this.state.confirmNew) {
      this.setState({ confirmNew: true });
      clearTimeout(this.confirmTimer);
      this.confirmTimer = setTimeout(() => this.setState({ confirmNew: false }), 2600);
      return;
    }
    this.clearTimers();
    this.discardSave();
    this.geo.fitTo(Object.keys(NATIONS));
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
    });
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
    if (st.phase !== 'playing' || st.aliveIds.length <= 1) return;
    if (st.match && !st.match.applied) return;
    if (st.spin) return;

    if (st.queue.length) {
      const queue = st.queue.slice();
      const next = queue.shift();
      this.setState({ queue }, () => this.startMatch(next[0], next[1]));
      return;
    }
    if (st.settings.pacing === 'duel') this.beginDuel();
    else if (st.settings.pacing === 'blitz') this.beginBlitz();
    else this.beginChaos();
  }

  beginDuel() {
    const st = this.state;
    const attackerId = st.aliveIds[Math.floor(this.rng() * st.aliveIds.length)];
    const center = empireCenter(this.board(), attackerId);
    const finalAngle = this.rng() * 360;
    const spins = 720 + Math.floor(this.rng() * 360);

    this.setState({
      round: st.round + 1,
      spin: { tid: attackerId, x: center.x, y: center.y, ang: 0 },
      atk: null,
      match: null,
      pu: null,
      toast: null,
    });
    // Two frames: the needle must paint at 0° before the CSS transition to the
    // final angle can animate.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (this.state.spin) this.setState({ spin: { ...this.state.spin, ang: spins + finalAngle } });
      }),
    );

    this.after(2350, () => {
      if (!this.state.spin) return;
      const target = pickTarget(this.board(), attackerId, (spins + finalAngle) % 360);
      if (!target) {
        this.setState({ spin: null });
        return;
      }
      const cp = target.cp;
      this.setState({
        atk: { x1: cp.ax, y1: cp.ay, x2: cp.bx, y2: cp.by, col: this.state.teams[attackerId].col },
      });
      this.after(720, () => this.startMatch(attackerId, target.tid));
    });
  }

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

  startMatch(attackerId, defenderId) {
    const st = this.state;
    const a = st.teams[attackerId];
    const d = st.teams[defenderId];
    if (!a || !d) return;

    const sim = simulateMatch(this.rng, a, d, Number(CONFIG.matchDrama));
    this.setState({
      match: {
        aId: attackerId,
        dId: defenderId,
        effA: sim.effA,
        effD: sim.effD,
        ga: 0,
        gd: 0,
        shown: [],
        allEv: sim.ev,
        pens: sim.pens,
        pensShown: null,
        winner: sim.winner,
        finalGa: sim.ga,
        finalGd: sim.gd,
        status: 'LIVE',
        applied: false,
        done: false,
      },
      spin: null,
    });

    const instant = st.settings.resolution === 'instant';
    this.showPopup(
      {
        kind: 'vs',
        label: 'ROUND ' + st.round + ' — ' + a.name.toUpperCase() + ' ATTACKS ' + d.name.toUpperCase(),
        aId: a.id,
        bId: d.id,
        aCode: a.code,
        aCol: a.col,
        aName: a.name,
        aEff: sim.effA.toFixed(1),
        bCode: d.code,
        bCol: d.col,
        bName: d.name,
        bEff: sim.effD.toFixed(1),
      },
      instant ? 950 : 1650,
    );

    if (instant) {
      this.after(380, () => this.revealAll());
      return;
    }

    for (const e of sim.ev) this.after(450 + e.m * MS_PER_MINUTE, () => this.pushEvent(e));
    this.after(450 + 91 * MS_PER_MINUTE, () => {
      const m = this.state.match;
      if (!m || m.applied) return;
      if (!m.pens) {
        this.patchMatch({ status: 'FULL TIME' });
        this.after(420, () => this.finishMatch());
        return;
      }
      this.patchMatch({ status: 'PENALTIES', pensShown: { A: [], D: [] } });
      const n = Math.max(m.pens.A.length, m.pens.D.length);
      for (let i = 0; i < n; i++) {
        if (i < m.pens.A.length) this.after(350 + i * 500, () => this.pushPen('A'));
        if (i < m.pens.D.length) this.after(600 + i * 500, () => this.pushPen('D'));
      }
      this.after(350 + n * 500 + 650, () => this.finishMatch());
    });
  }

  patchMatch(patch) {
    if (this.state.match) this.setState({ match: { ...this.state.match, ...patch } });
  }

  pushEvent(e) {
    const m = this.state.match;
    if (!m || m.applied) return;
    this.patchMatch({
      shown: m.shown.concat([e]),
      ga: m.ga + (e.tid === m.aId ? 1 : 0),
      gd: m.gd + (e.tid === m.dId ? 1 : 0),
    });
    const t = this.state.teams[e.tid] || {};
    this.showToast({ code: t.code || 'GOL', txt: e.m + "' GOAL — " + e.name.toUpperCase(), col: t.col || C.gold }, 1150);
  }

  pushPen(side) {
    const m = this.state.match;
    if (!m || !m.pensShown || m.applied) return;
    const shown = { A: m.pensShown.A.slice(), D: m.pensShown.D.slice() };
    if (side === 'A') shown.A.push(m.pens.A[shown.A.length]);
    else shown.D.push(m.pens.D[shown.D.length]);
    this.patchMatch({ pensShown: shown });
  }

  /** Jump straight to full time — used by INSTANT resolution and by STEP mid-match. */
  revealAll() {
    const m = this.state.match;
    if (!m || m.applied) return;
    this.patchMatch({
      shown: m.allEv,
      ga: m.finalGa,
      gd: m.finalGd,
      pensShown: m.pens ? { A: m.pens.A, D: m.pens.D } : null,
      status: m.pens ? 'PENALTIES' : 'FULL TIME',
    });
    this.after(500, () => this.finishMatch());
  }

  fastForward() {
    this.clearTimers();
    this.revealAll();
  }

  /**
   * Apply the result: the loser is eliminated, every territory it held passes to
   * the winner, and its best player switches allegiance.
   */
  finishMatch() {
    const st = this.state;
    const m = st.match;
    if (!m || m.applied) return;

    const winnerId = m.winner;
    const loserId = winnerId === m.aId ? m.dId : m.aId;
    const battleAt = empireCenter(this.board(), loserId);

    const teams = { ...st.teams };
    const W = { ...teams[winnerId], squad: teams[winnerId].squad.slice() };
    const L = { ...teams[loserId], squad: teams[loserId].squad.slice() };
    const stolen = L.squad.slice().sort((x, y) => y.rating - x.rating)[0];
    if (stolen) {
      W.squad.push({ ...stolen, from: L.code });
      L.squad = L.squad.filter(p => p !== stolen);
    }
    teams[winnerId] = W;
    teams[loserId] = L;

    const own = { ...st.own };
    const taken = [];
    for (const cid in own) {
      if (own[cid] === loserId) {
        own[cid] = winnerId;
        taken.push(cid);
      }
    }
    const aliveIds = st.aliveIds.filter(t => t !== loserId);

    const stats = { ...st.stats };
    const ws = { ...(stats[winnerId] || { conq: 0, steals: [] }) };
    ws.conq += 1;
    if (stolen) ws.steals = ws.steals.concat([stolen.name]);
    stats[winnerId] = ws;

    const effW = winnerId === m.aId ? m.effA : m.effD;
    const effL = winnerId === m.aId ? m.effD : m.effA;
    const isUpset = effW + Number(CONFIG.upsetThreshold) <= effL;
    const pensTxt = m.pens ? ' (' + m.pens.ga + '–' + m.pens.gd + ' PENS)' : '';
    const A = teams[m.aId];
    const B = teams[m.dId];
    const terrWord = 'TERRITOR' + (taken.length === 1 ? 'Y' : 'IES');

    const entries = [
      { t: 'match', r: st.round, txt: A.code + ' ' + m.finalGa + '–' + m.finalGd + ' ' + B.code + pensTxt, chip: W.col, col: C.textSoft },
    ];
    if (isUpset) {
      entries.push({
        t: 'upset',
        r: st.round,
        txt: 'GIANT-KILLING — ' + W.name.toUpperCase() + ' (' + effW.toFixed(0) + ') TOPPLES ' + L.name.toUpperCase() + ' (' + effL.toFixed(0) + ')',
        chip: C.gold,
        col: C.gold,
      });
    }
    entries.push({
      t: 'elim',
      r: st.round,
      txt: L.name.toUpperCase() + ' FALLS — ' + taken.length + ' ' + terrWord + ' ANNEXED BY ' + W.name.toUpperCase(),
      chip: C.red,
      col: C.text,
    });
    if (stolen) {
      entries.push({
        t: 'steal',
        r: st.round,
        txt: W.code + ' CLAIMS ' + stolen.name.toUpperCase() + ' (' + stolen.rating + ' ' + stolen.pos + ') FROM ' + L.code,
        chip: C.cyan,
        col: C.cyan,
      });
    }
    if (aliveIds.length === 1) {
      entries.push({ t: 'champ', r: st.round, txt: W.name.toUpperCase() + ' RULES THE MAP — TOTAL CONQUEST', chip: W.col, col: C.gold });
    }

    const flash = {};
    for (const cid of taken) flash[cid] = true;
    const stealTxt = stolen ? ' · steals ' + stolen.name + ' (' + stolen.rating + ' ' + stolen.pos + ')' : '';

    this.setState(
      {
        teams,
        own,
        aliveIds,
        stats,
        fallen: st.fallen.concat([{ id: loserId, r: st.round }]),
        flash,
        atk: null,
        battles: (st.battles || []).concat([{ x: battleAt.x, y: battleAt.y }]).slice(-BATTLE_SCARS),
        matches: st.matches + 1,
        log: st.log.concat(entries).slice(-LOG_CAP),
        match: {
          ...m,
          applied: true,
          done: true,
          status: 'FULL TIME',
          isUpset,
          resText: '+' + taken.length + ' territories' + stealTxt,
          resTitle: W.name.toUpperCase() + ' ANNEXES ' + L.name.toUpperCase(),
          wCol: W.col,
        },
      },
      () => {
        writeSave(this.state);
        this.after(1500, () => this.setState({ flash: {} }));

        this.showPopup(
          {
            kind: 'result',
            label: (m.pens ? 'PENALTIES' : 'FULL TIME') + ' — ROUND ' + st.round,
            score: A.code + ' ' + m.finalGa + '–' + m.finalGd + ' ' + B.code + (m.pens ? '  ·  ' + m.pens.ga + '–' + m.pens.gd + 'P' : ''),
            title: W.name.toUpperCase() + ' ANNEXES ' + L.name.toUpperCase(),
            sub: '+' + taken.length + ' ' + terrWord,
            upset: isUpset,
            col: W.col,
          },
          1750,
        );
        if (stolen) {
          this.after(1820, () =>
            this.showPopup(
              {
                kind: 'steal',
                sName: stolen.name,
                sMeta: 'RATING ' + stolen.rating + ' · ' + stolen.pos,
                sFrom: L.code,
                sFromId: L.id,
                sFromCol: L.col,
                sTo: W.code,
                sToId: W.id,
                sToCol: W.col,
                sSub: 'JOINS ' + W.name.toUpperCase(),
              },
              1900,
            ),
          );
        }

        const doneAt = stolen ? 3900 : 1950;
        if (aliveIds.length === 1) {
          this.after(doneAt + 250, () => this.setState({ phase: 'victory', autoplay: false }, () => writeSave(this.state)));
        } else if (this.state.autoplay) {
          // Mid-batch runs back-to-back; a fresh round gets a beat of breathing room.
          this.after(this.state.queue.length ? doneAt : doneAt + 120, () => this.nextAction());
        }
        // Paused mid-batch: the next match waits for STEP.
      },
    );
  }

  // ---------- controls ----------

  step() {
    const st = this.state;
    if (st.phase !== 'playing') return;
    if (st.match && !st.match.applied) {
      this.fastForward();
      return;
    }
    if (st.spin) return;
    this.nextAction();
  }

  togglePlay() {
    const on = !this.state.autoplay;
    this.setState({ autoplay: on }, () => {
      const st = this.state;
      if (on && (!st.match || st.match.applied) && !st.spin) this.after(80, () => this.nextAction());
    });
  }

  cycleSpeed() {
    const s = this.state.speed;
    this.setState({ speed: s === 1 ? 2 : s === 2 ? 4 : 1 });
  }

  setSetting(key, value) {
    if (this.state.phase !== 'playing') return;
    this.setState({ settings: { ...this.state.settings, [key]: value } }, () => writeSave(this.state));
  }

  selectCountry(cid) {
    const tid = this.state.own[cid];
    if (tid) this.setState({ selected: tid, tab: 'squad' });
  }

  // ---------- pointer readouts ----------

  handleMapMove = e => {
    const tip = this.tipRef.current;
    const map = this.mapRef.current;
    if (tip && map) {
      const b = map.getBoundingClientRect();
      tip.style.left = Math.min(e.clientX - b.left + 14, b.width - 200) + 'px';
      tip.style.top = e.clientY - b.top + 12 + 'px';
    }
    const svg = this.svgRef.current;
    const coord = this.coordRef.current;
    if (coord && svg && svg.getScreenCTM) {
      try {
        const pt = svg.createSVGPoint();
        pt.x = e.clientX;
        pt.y = e.clientY;
        const sp = pt.matrixTransform(svg.getScreenCTM().inverse());
        const ll = this.geo && this.geo.invert(sp.x, sp.y);
        if (ll) {
          const lat = Math.max(-90, Math.min(90, ll[1]));
          const lon = Math.max(-180, Math.min(180, ll[0]));
          coord.textContent =
            'LAT ' + Math.abs(lat).toFixed(1) + (lat >= 0 ? '°N' : '°S') +
            ' · LON ' + Math.abs(lon).toFixed(1) + (lon >= 0 ? '°E' : '°W');
        }
      } catch {
        /* the pointer left the SVG mid-measurement */
      }
    }
  };

  // ---------- derived view models ----------

  /**
   * Every map shape, plus the flag patterns held territory is filled with.
   * A country flies its *owner's* flag, so an empire reads as one banner
   * spreading across the map.
   */
  mapCountries() {
    const { own, teams, selected, flash } = this.state;
    if (!this.geo) return { countries: [], flagPatterns: [] };

    const countries = [];
    const flagPatterns = [];
    for (const c of this.geo.countries) {
      const p = this.geo.paths[c.id];
      if (!p) continue;
      const ownerId = own[c.id];
      const owner = ownerId ? teams[ownerId] : null;
      const isSelected = owner && selected === ownerId;
      const flag = owner ? flagUrl(owner.id) : null;
      if (flag) flagPatterns.push({ id: c.id, url: flag, color: owner.col, bbox: p.bbox });

      const unclaimedShade = (parseInt(c.id, 10) || c.id.charCodeAt(0)) % 2 ? C.landA : C.landB;
      countries.push({
        id: c.id,
        d: p.d,
        fill: flag ? `url(#fi-flag-${c.id})` : owner ? owner.col : unclaimedShade,
        stroke: isSelected ? C.goldOutline : C.ink,
        strokeWidth: isSelected ? 1.1 : 0.55,
        cursor: owner ? 'pointer' : 'default',
        animation: flash[c.id] ? 'fiFlash 0.9s ease-out' : 'none',
        onClick: () => this.selectCountry(c.id),
        onEnter: () => this.setState({ hoverCid: c.id }),
      });
    }
    return { countries, flagPatterns };
  }

  mapLabels(playing) {
    const { aliveIds, teams } = this.state;
    if (!playing || !CONFIG.showLabels || !this.geo) return [];
    const board = this.board();
    return aliveIds
      .map(tid => ({ tid, n: territories(board, tid).length }))
      .sort((a, b) => b.n - a.n)
      .slice(0, 8)
      .filter(r => r.n >= 2)
      .map(r => {
        const c = empireCenter(board, r.tid);
        return { key: r.tid, x: c.x.toFixed(0), y: c.y.toFixed(0), text: teams[r.tid].code + ' ' + r.n };
      });
  }

  /** A diamond on every empire that still holds its own homeland. */
  mapHomes(playing) {
    const { aliveIds, own, teams } = this.state;
    if (!playing || !this.geo) return [];
    const out = [];
    for (const tid of aliveIds) {
      if (own[tid] !== tid) continue;
      const p = this.geo.paths[tid];
      if (!p) continue;
      const { cx: x, cy: y } = p;
      out.push({
        id: tid,
        d: `M${x.toFixed(1)},${(y - 3.6).toFixed(1)}L${(x + 3.6).toFixed(1)},${y.toFixed(1)}L${x.toFixed(1)},${(y + 3.6).toFixed(1)}L${(x - 3.6).toFixed(1)},${y.toFixed(1)}Z`,
        color: teams[tid] ? teams[tid].col : C.gold,
      });
    }
    return out;
  }

  tooltip(playing) {
    const { hoverCid, own, teams } = this.state;
    const rec = hoverCid && NATIONS[hoverCid];
    if (!rec) return { visible: false, name: '', sub: '' };
    const ownerId = own[hoverCid];
    let sub;
    if (ownerId && ownerId !== hoverCid) {
      sub = 'HELD BY ' + (teams[ownerId] ? teams[ownerId].name.toUpperCase() : '?');
    } else if (ownerId) {
      sub =
        'EFF ' + (teams[ownerId] ? teamEff(teams[ownerId]).toFixed(1) : '—') +
        ' · ' + territories(this.board(), ownerId).length + ' TERR';
    } else {
      sub = playing ? 'NOT IN THIS THEATRE' : 'AWAITING CAMPAIGN';
    }
    return { visible: true, name: rec[0].toUpperCase(), sub };
  }

  /** Largest empire callout — the thing to watch on a crowded map. */
  legend(playing) {
    const { aliveIds, teams } = this.state;
    if (!playing || aliveIds.length <= 1) return null;
    const board = this.board();
    let biggest = null;
    let best = -1;
    for (const tid of aliveIds) {
      const n = territories(board, tid).length;
      if (n > best) {
        best = n;
        biggest = tid;
      }
    }
    if (!biggest || best <= 1) return null;
    return {
      text: 'LARGEST EMPIRE — ' + teams[biggest].name.toUpperCase() + ' · ' + best + ' TERRITORIES',
      color: teams[biggest].col,
    };
  }

  matchCard() {
    const { match: m, teams, round, settings } = this.state;
    if (!m) return null;
    const A = teams[m.aId];
    const B = teams[m.dId];
    return {
      round: pad3(round),
      mode: settings.pacing.toUpperCase(),
      status: m.status,
      statusColor: m.done ? C.textMute : m.status === 'PENALTIES' ? C.gold : C.green,
      statusLive: !m.done,
      a: { id: A.id, code: A.code, color: A.col, name: A.name, eff: m.effA.toFixed(1), goals: m.ga },
      b: { id: B.id, code: B.code, color: B.col, name: B.name, eff: m.effD.toFixed(1), goals: m.gd },
      pens: m.pensShown ? { a: m.pensShown.A, b: m.pensShown.D } : null,
      events: m.shown.map(e => ({
        minute: e.m + "'",
        color: teams[e.tid] ? teams[e.tid].col : '#fff',
        text: 'GOAL — ' + e.name + ' (' + (teams[e.tid] ? teams[e.tid].code : '') + ')',
      })),
      noEvents: m.shown.length === 0 && !m.done,
      result: m.done
        ? { title: m.resTitle || '', text: m.resText || '', upset: !!m.isUpset, background: tint(m.wCol || C.gold, 0.1) }
        : null,
    };
  }

  idleText() {
    const { phase, match, spin, queue, settings } = this.state;
    if (phase !== 'playing' || match || spin) return null;
    if (queue.length) return 'BATCH PAUSED — PRESS STEP FOR THE NEXT MATCH, OR PLAY TO RUN THE REST.';
    if (settings.pacing === 'duel') {
      return 'AWAITING ORDERS. STEP SPINS FOR AN ATTACKER AND A DIRECTION — PLAY RUNS THE WAR AUTOMATICALLY.';
    }
    if (settings.pacing === 'blitz') {
      return 'AWAITING ORDERS. STEP LAUNCHES A BLITZ ROUND — EVERY NATION FIGHTS, THE FIELD HALVES.';
    }
    return 'AWAITING ORDERS. STEP DRAWS RANDOM MATCHUPS UNTIL A NAME REPEATS, THEN RESOLVES THEM.';
  }

  powerTable(playing) {
    const { aliveIds, teams } = this.state;
    if (!playing) return [];
    const board = this.board();
    return aliveIds
      .map(tid => ({ tid, eff: teamEff(teams[tid]), terr: territories(board, tid).length }))
      .sort((a, b) => b.eff - a.eff)
      .map((r, i) => ({
        tid: r.tid,
        rank: pad3(i + 1).slice(-2),
        code: teams[r.tid].code,
        color: teams[r.tid].col,
        name: teams[r.tid].name,
        territories: 'T' + r.terr,
        eff: r.eff.toFixed(1),
      }));
  }

  squadPanel() {
    const { selected, teams, aliveIds, fallen, stats } = this.state;
    const team = selected && teams[selected] ? teams[selected] : null;
    if (!team) return null;
    const alive = aliveIds.includes(team.id);
    const fell = fallen.find(f => f.id === team.id);
    const s = stats[team.id] || { conq: 0, steals: [] };
    return {
      id: team.id,
      color: team.col,
      code: team.code,
      name: team.name,
      meta: team.conf + ' · BASE STR ' + team.str,
      eff: teamEff(team).toFixed(1),
      territories: String(territories(this.board(), team.id).length),
      conquests: String(s.conq || 0),
      stolen: String((s.steals || []).length),
      status: alive ? 'ALIVE' : 'FALLEN R' + (fell ? fell.r : '?'),
      statusColor: alive ? C.green : C.red,
      players: team.squad.slice().sort((a, b) => b.rating - a.rating),
    };
  }

  warStage() {
    const { phase, teams, fallen } = this.state;
    if (phase === 'victory') return { text: 'CONQUEST COMPLETE', pulsing: false };
    const total = Object.keys(teams).length;
    const down = fallen.length;
    const pct = total ? down / total : 0;
    const text =
      down === 0 ? 'COLD WAR' : pct < 0.25 ? 'ESCALATION' : pct < 0.6 ? 'TOTAL WAR' : pct < 0.9 ? 'ENDGAME' : 'LAST STAND';
    return { text, pulsing: pct >= 0.25 };
  }

  victoryPanel() {
    const { aliveIds, teams, stats, settings, round, matches } = this.state;
    const champ = aliveIds.length ? teams[aliveIds[0]] : null;
    if (!champ) return null;
    const s = stats[champ.id] || { conq: 0, steals: [] };
    const scope = SCOPES.find(x => x.id === settings.scope);
    return {
      id: champ.id,
      round: pad3(round),
      name: champ.name.toUpperCase(),
      color: champ.col,
      subtitle:
        'has conquered ' + (settings.scope === 'world' ? 'the world' : scope ? scope.name : 'the theatre') +
        ' in ' + matches + ' battles',
      conquests: String(s.conq || 0),
      steals: String((s.steals || []).length),
      territories: String(territories(this.board(), champ.id).length),
      squad: champ.squad.slice().sort((a, b) => b.rating - a.rating).slice(0, 11),
    };
  }

  renderPopup() {
    const pu = this.state.pu;
    if (!pu) return null;
    if (pu.kind === 'vs') {
      return (
        <MatchupPopup
          label={pu.label}
          a={{ id: pu.aId, code: pu.aCode, color: pu.aCol, name: pu.aName, eff: pu.aEff }}
          b={{ id: pu.bId, code: pu.bCode, color: pu.bCol, name: pu.bName, eff: pu.bEff }}
        />
      );
    }
    if (pu.kind === 'result') {
      return <ResultPopup label={pu.label} score={pu.score} title={pu.title} sub={pu.sub} upset={pu.upset} color={pu.col} />;
    }
    return (
      <StealPopup
        name={pu.sName}
        meta={pu.sMeta}
        from={pu.sFrom}
        fromId={pu.sFromId}
        fromColor={pu.sFromCol}
        to={pu.sTo}
        toId={pu.sToId}
        toColor={pu.sToCol}
        sub={pu.sSub}
      />
    );
  }

  render() {
    const st = this.state;
    const playing = st.phase === 'playing' || st.phase === 'victory';
    const scope = SCOPES.find(x => x.id === st.settings.scope);
    const stage = this.warStage();
    const victory = st.phase === 'victory' ? this.victoryPanel() : null;
    const { countries, flagPatterns } = this.mapCountries();

    return (
      <div
        style={{
          height: '100vh',
          display: 'flex',
          flexDirection: 'column',
          background: C.deep,
          color: C.text,
          position: 'relative',
          overflow: 'hidden',
          fontFamily: FONT.body,
        }}
      >
        <CommandBar
          show={playing}
          scopeName={scope ? scope.name.toUpperCase() : ''}
          round={st.round}
          alive={st.aliveIds.length}
          fallen={st.fallen.length}
          warStage={stage.text}
          warPulsing={stage.pulsing}
          pacing={st.settings.pacing}
          resolution={st.settings.resolution}
          speed={st.speed}
          autoplay={st.autoplay}
          confirmNew={st.confirmNew}
          onPacing={p => this.setSetting('pacing', p)}
          onResolution={r => this.setSetting('resolution', r)}
          onSpeed={() => this.cycleSpeed()}
          onStep={() => this.step()}
          onPlay={() => this.togglePlay()}
          onNew={() => this.newCampaign()}
        />

        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
          <WorldMap
            countries={countries}
            flagPatterns={flagPatterns}
            graticule={this.geo ? this.geo.graticule : { d: '', labels: [] }}
            homes={this.mapHomes(playing)}
            battleMarks={(st.battles || []).map((b, i, arr) => ({
              x1: (b.x - 4).toFixed(1),
              y1: (b.y - 4).toFixed(1),
              x2: (b.x + 4).toFixed(1),
              y2: (b.y + 4).toFixed(1),
              op: (0.25 + 0.65 * ((i + 1) / arr.length)).toFixed(2),
            }))}
            labels={this.mapLabels(playing)}
            attack={st.atk ? { x1: st.atk.x1, y1: st.atk.y1, x2: st.atk.x2, y2: st.atk.y2, color: st.atk.col } : null}
            spin={st.spin ? { x: st.spin.x, y: st.spin.y, angle: st.spin.ang, color: st.teams[st.spin.tid] ? st.teams[st.spin.tid].col : C.gold } : null}
            tooltip={this.tooltip(playing)}
            scaleBar={this.geo ? this.geo.scaleBar : { px: 0, label: '' }}
            legend={this.legend(playing)}
            mapRef={this.mapRef}
            svgRef={this.svgRef}
            tipRef={this.tipRef}
            coordRef={this.coordRef}
            onPointerMove={this.handleMapMove}
            onPointerLeave={() => this.setState({ hoverCid: null })}
          >
            {st.toast && <Toast code={st.toast.code} text={st.toast.txt} color={st.toast.col} />}
            {this.renderPopup()}
          </WorldMap>

          <Sidebar
            match={this.matchCard()}
            idleText={this.idleText()}
            queueLeft={st.queue.length}
            tab={st.tab}
            onTab={tab => this.setState({ tab })}
            feed={st.log
              .slice()
              .reverse()
              .slice(0, FEED_CAP)
              .map(f => ({ round: 'R' + pad3(f.r), chip: f.chip || C.textMute, color: f.col || C.textSoft, text: f.txt }))}
            power={this.powerTable(playing)}
            squad={this.squadPanel()}
            onSelectTeam={tid => this.setState({ selected: tid, tab: 'squad' })}
            eventsRef={this.eventsRef}
          />
        </div>

        {st.phase === 'setup' && (
          <SetupOverlay
            setup={st.setup}
            hasSave={st.hasSave}
            savedText={
              st.savedMeta
                ? 'ROUND ' + st.savedMeta.round + ' · ' + st.savedMeta.alive + ' NATIONS ALIVE · ' + String(st.savedMeta.scope).toUpperCase()
                : ''
            }
            onResume={() => this.resume()}
            onDiscard={() => this.discardSave()}
            onPick={(key, value) => this.setState({ setup: { ...st.setup, [key]: value } })}
            onStart={() => this.startCampaign()}
          />
        )}

        {victory && (
          <VictoryOverlay
            {...victory}
            onClose={() => this.setState({ phase: 'playing' })}
            onNew={() => {
              this.clearTimers();
              this.discardSave();
              this.geo.fitTo(Object.keys(NATIONS));
              this.setState({ phase: 'setup', match: null, queue: [], pu: null, toast: null });
            }}
          />
        )}

        {st.phase === 'loading' && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 60,
              background: C.deep,
            }}
          >
            <span
              style={{
                fontFamily: FONT.mono,
                fontSize: 11,
                letterSpacing: 2,
                color: st.err ? C.red : C.textMute,
                animation: 'fiBlink 1.4s ease-in-out infinite',
              }}
            >
              {st.err || 'ACQUIRING SATELLITE MAP ▮▮▮'}
            </span>
          </div>
        )}
      </div>
    );
  }
}
