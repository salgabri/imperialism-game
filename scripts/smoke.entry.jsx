// Bundled by scripts/smoke.mjs and executed under jsdom. Runs the real controls
// and component tree; accelerated playback and a seeded simulation stay here.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { unstable_batchedUpdates } from 'react-dom';
import App from '../src/App.jsx';
import { FLAG_CODES } from '../src/data/flags.js';
import { FLAG_SYMBOLS } from '../src/data/flagSymbols.js';
import { DEPENDENCIES, NATIONS, buildClub, makeRng, teamEff } from '../src/data/teams.js';
import { SAVE_KEY } from '../src/config.js';
import { campaignStorageKey, exportCampaign, listCampaigns, writeSave } from '../src/engine/storage.js';
import { CLUB_SCOPES } from '../src/data/scopes.js';
import { DOMESTIC } from '../src/data/domestic.js';
import { domesticLabel } from '../src/data/domesticScope.js';
// Same module instance as the bundled App, so clearing it really empties the app's cache.
import { clearDomesticCache, decodeDomestic, domesticScope, domesticScopeId } from '../src/engine/domestic.js';
import { getSport } from '../src/sports/index.js';
import { createEmpireLabelEngine as createLabelValidator } from '../src/engine/empireLabels.js';

const SPEED = 80;
// The label engine marks a footprint coastal only above this clipping residue.
const COASTAL_ZERO_TOLERANCE = 1e-8;
const DOMESTIC_SCALE_TITLE = "Distance at the map's centre";
const text = () => document.getElementById('root').textContent;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const countryPaths = () => [...document.querySelectorAll('[data-testid="world-map"] path[data-country]')];
const countryFlagParts = id => [...document.querySelectorAll('path[data-flag-country]')]
  .filter(part => id == null || part.dataset.flagCountry === id);
const setState = (app, state) => new Promise(resolve => app.setState(state, resolve));
const roundedGain = (after, before) => Math.round((after - before) * 10) / 10;
const buttonNamed = label => [...document.querySelectorAll('button')].find(el => el.textContent.trim() === label);

/** Poll without throwing, for states that should appear but are reported as checks. */
async function waitFor(predicate, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return true;
    await sleep(10);
  }
  return predicate();
}

// The country a domestic scenario plays on, decoded here independently of the
// app so every check compares the rendered map against the shipped file.
let domesticReference = null;

async function loadReference(id) {
  if (domesticReference?.id === id) return domesticReference;
  const response = await fetch(`/domestic/${id}.json`);
  if (!response.ok) throw new Error(`reference map ${id}: HTTP ${response.status}`);
  const decoded = decodeDomestic(await response.json(), id);
  const byId = new Map(decoded.clubs.map(club => [club.id, club]));
  domesticReference = {
    id, entry: DOMESTIC.find(item => item.id === id), scope: domesticScope(id), label: domesticLabel(domesticScope(id)),
    meta: decoded.meta, sectionNames: decoded.sectionNames, sectionIds: new Set(Object.keys(decoded.sectionNames)),
    // Every section names the club starting on it: one per club on a 100-club map, a group each otherwise.
    clubs: decoded.clubs, startOwners: decoded.startOwners,
    clubBySection: Object.fromEntries(Object.entries(decoded.startOwners).map(([section, club]) => [section, byId.get(club)])),
  };
  return domesticReference;
}

/** A conquest takes everything, so each club's starting group always has one holder. */
const wholeGroups = (own, reference) => reference.clubs.every(club => club.startSections.every(section => own[section] === own[club.homeSection]));

/** The footnote names the largest empire once one outgrows every starting group, and never before. */
function legendFits(app, reference) {
  const { own, aliveIds } = app.state;
  const best = Math.max(...aliveIds.map(id => Object.values(own).filter(owner => owner === id).length));
  const start = Math.max(...reference.clubs.map(club => club.startSections.length));
  const note = document.querySelector('.map-footnote span')?.textContent || '';
  return aliveIds.length > 1 && best > start ? note.startsWith('Largest empire: ') && note.endsWith(`· ${best} territories`)
    : !note.includes('Largest empire');
}

/** The reference map when the app's campaign (or setup choice) is that country. */
function domesticOf(app) {
  const playing = app.state.phase === 'playing' || app.state.phase === 'victory';
  const settings = playing ? app.state.settings : app.state.setup;
  const id = settings?.layer === 'clubs' && settings.sport === 'football' ? domesticScopeId(settings.clubScope) : null;
  return id && domesticReference?.id === id ? domesticReference : null;
}

/** Neighbouring land: drawn beneath the sections, muted, inert and never a territory. */
function backdropSnapshot(app) {
  const svg = document.querySelector('[data-testid="world-map"]');
  const group = svg?.querySelector('g.map-backdrop');
  if (!group) return { present: false };
  const shapes = svg.querySelector('g.country-shapes');
  const paths = [...group.querySelectorAll('path')];
  const ownerColours = new Set(Object.values(app.state.teams).map(team => team.col));
  const noPointer = el => el.getAttribute('pointer-events') === 'none' || el.style?.pointerEvents === 'none';
  const fillOf = el => el.getAttribute('fill') || el.style?.fill || '';
  return {
    present: true,
    paths: paths.length,
    drawn: paths.length > 0 && paths.every(path => (path.getAttribute('d') || '').length > 2),
    ariaHidden: group.getAttribute('aria-hidden') === 'true',
    beneath: !!shapes && !group.contains(shapes) && !shapes.contains(group)
      && !!(group.compareDocumentPosition(shapes) & Node.DOCUMENT_POSITION_FOLLOWING),
    inert: (noPointer(group) || paths.every(noPointer)) && !group.querySelector('a, button, [tabindex], [role]')
      && !['tabindex', 'role'].some(name => group.hasAttribute(name)),
    notTerritory: paths.every(path => !path.hasAttribute('data-country') && !path.hasAttribute('data-owner') && !path.closest('g.country-shapes')),
    muted: paths.every(path => {
      const fill = fillOf(path) || fillOf(group);
      return !!fill && !/^(none|transparent|url\()/i.test(fill) && !ownerColours.has(fill);
    }),
  };
}

function flagPattern(path) {
  const id = path.getAttribute('fill').match(/^url\(#(fi-flag-[^)]+)\)$/)?.[1];
  return id ? document.getElementById(id) : null;
}

/** Exact provenance and one-banner semantics, for native and separated emblems. */
function flagAssetsMatch(pattern, code) {
  if (!pattern || !code || pattern.dataset.flagSource !== `/flags/${code}.svg`
    || pattern.getAttribute('patternUnits') !== 'userSpaceOnUse'
    || pattern.getAttribute('patternContentUnits') !== 'userSpaceOnUse'
    || pattern.hasAttribute('viewBox') || pattern.hasAttribute('patternTransform')
    || pattern.getAttribute('pointer-events') !== 'none') return false;
  const images = [...pattern.querySelectorAll('image')];
  if (pattern.children.length !== images.length + 1 || [...pattern.children].some(node => !['rect', 'image'].includes(node.localName))) return false;
  const field = pattern.querySelector('[data-flag-field]');
  const symbol = pattern.querySelector('[data-flag-symbol]');
  const numericBox = node => ['x', 'y', 'width', 'height'].map(name => Number(node.getAttribute(name)));
  const validBox = node => numericBox(node).every(Number.isFinite) && numericBox(node).slice(2).every(n => n > 0);
  const localTile = [0, 0, ...numericBox(pattern).slice(2)];
  const fallback = pattern.querySelector('rect');
  if (pattern.querySelectorAll('rect').length !== 1 || !fallback
    || JSON.stringify(numericBox(fallback)) !== JSON.stringify(localTile)
    || fallback.hasAttribute('stroke') || pattern.querySelector('[transform], [style*="transform"], [tabindex], a, use, foreignObject')) return false;
  if (!field && !symbol) return pattern.dataset.flagLayout === 'native' && images.length === 1
    && images[0].getAttribute('href') === `/flags/${code}.svg`
    && images[0].getAttribute('preserveAspectRatio') === 'none'
    && JSON.stringify(numericBox(images[0])) === JSON.stringify(localTile);
  const profile = FLAG_SYMBOLS[code];
  if (!profile || !field || !symbol || images.length !== 2
    || pattern.querySelectorAll('[data-flag-field]').length !== 1 || pattern.querySelectorAll('[data-flag-symbol]').length !== 1
    || pattern.dataset.flagLayout !== 'symbol-aware'
    || field.getAttribute('href') !== `/${profile.fieldFile}` || symbol.getAttribute('href') !== `/${profile.symbolFile}`
    || field.getAttribute('preserveAspectRatio') !== 'none' || symbol.getAttribute('preserveAspectRatio') !== 'xMidYMid meet'
    || !validBox(field) || !validBox(symbol)) return false;
  const [sx, sy, sw, sh] = numericBox(symbol);
  const [fx, fy, fw, fh] = numericBox(field);
  const [px, py, pw, ph] = localTile;
  const eps = 1e-6;
  return Math.abs(sw / sh - profile.bounds.w / profile.bounds.h) < eps
    && fx <= px + eps && fy <= py + eps && fx + fw >= px + pw - eps && fy + fh >= py + ph - eps
    && sx >= px - eps && sy >= py - eps && sx + sw <= px + pw + eps && sy + sh <= py + ph + eps;
}

/** Validate the actual multipart fills, leaving logical hit/stroke paths intact. */
function expectedFlagsShown(app) {
  const playing = app.state.phase === 'playing' || app.state.phase === 'victory';
  const paths = countryPaths();
  const domestic = domesticOf(app);
  if (domestic) {
    // A country map is exactly its sections, painted in club colours: no flags.
    const ids = paths.map(path => path.dataset.country);
    if (app.state.mapMode !== 'flags' || ids.length !== domestic.sectionIds.size || !ids.every(id => domestic.sectionIds.has(id))
      || countryFlagParts().length || document.querySelector('pattern[id^="fi-flag-"]')) return false;
    return !playing || paths.every(path => {
      const owner = app.state.teams[app.state.own[path.dataset.country]];
      return owner?.kind === 'club' && path.getAttribute('fill') === owner.col && !flagPattern(path);
    });
  }
  const nationPaths = paths.filter(path => NATIONS[path.dataset.country]);
  if (app.state.mapMode !== 'flags' || nationPaths.length !== Object.keys(NATIONS).length) return false;
  return paths.every(path => {
    const id = path.dataset.country;
    const owner = playing ? app.state.teams[app.state.own[id]] : null;
    const flagId = playing ? owner?.flagId : FLAG_CODES[id] ? id : DEPENDENCIES[id]?.of;
    const parts = countryFlagParts(id);
    if (owner?.kind === 'club') return parts.length === 0 && !flagPattern(path) && path.getAttribute('fill') === owner.col;
    if (!FLAG_CODES[flagId]) return parts.length === 0 && !flagPattern(path);
    if (filledRings(path.getAttribute('d')).length === 0) return parts.length === 0;
    return parts.length > 0 && path.getAttribute('fill') === 'transparent'
      && JSON.stringify(filledRings(path.getAttribute('d'))) === JSON.stringify(filledRings(parts.map(part => part.getAttribute('d')).join('')))
      && parts.every(part => {
        const pattern = flagPattern(part);
        return pattern?.id === `fi-flag-${part.dataset.flagComponent}`
          && flagAssetsMatch(pattern, FLAG_CODES[flagId]);
      });
  });
}

const patternBounds = pattern => Object.fromEntries([['x', 'x'], ['y', 'y'], ['w', 'width'], ['h', 'height']]
  .map(([key, attr]) => [key, Number(pattern.getAttribute(attr))]));
const pathPoints = path => [...path.getAttribute('d').matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)]
  .map(match => [Number(match[1]), Number(match[2])]);
const insideBounds = ([x, y], bounds, tolerance = .000001) => x >= bounds.x - tolerance && y >= bounds.y - tolerance
  && x <= bounds.x + bounds.w + tolerance && y <= bounds.y + bounds.h + tolerance;

function filledRings(d) {
  return (d.match(/M[^M]+/g) || []).flatMap(ring => {
    const points = [...ring.matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)].map(([, x, y]) => [Number(x), Number(y)]);
    const twiceArea = points.reduce((area, [x, y], i) => {
      const next = points[(i + 1) % points.length];
      return area + x * next[1] - next[0] * y;
    }, 0);
    // Fully collapsed rings do not paint pixels and may be dropped by grouping.
    return Math.abs(twiceArea) > .0000002 ? [JSON.stringify(points)] : [];
  }).sort();
}

/** Nearby owned land shares a regional tile; remote possessions stay separate. */
function empireFlagsSnapshot(app) {
  const groups = new Map();
  const owners = new Set();
  const parts = countryFlagParts();
  for (const part of parts) {
    const ownerId = app.state.own[part.dataset.flagCountry];
    owners.add(ownerId);
    if (!groups.has(part.dataset.flagComponent)) groups.set(part.dataset.flagComponent, []);
    groups.get(part.dataset.flagComponent).push(part);
  }
  const patterns = [...document.querySelectorAll('pattern[id^="fi-flag-"]')];
  let sharedReferences = true;
  let localBounds = true;
  let coversEveryPolygon = true;
  let correctOwner = true;
  for (const [componentId, componentParts] of groups) {
    const pattern = document.getElementById(`fi-flag-${componentId}`);
    sharedReferences &&= !!pattern && componentParts.every(part => flagPattern(part) === pattern);
    if (!pattern) { localBounds = false; coversEveryPolygon = false; correctOwner = false; continue; }
    correctOwner &&= componentParts.every(part => {
      const ownerId = app.state.own[part.dataset.flagCountry];
      return pattern.dataset.owner === ownerId
        && flagAssetsMatch(pattern, FLAG_CODES[app.state.teams[ownerId]?.flagId]);
    });
    const bounds = patternBounds(pattern);
    const points = componentParts.flatMap(pathPoints);
    const minX = Math.min(...points.map(([x]) => x)), maxX = Math.max(...points.map(([x]) => x));
    const minY = Math.min(...points.map(([, y]) => y)), maxY = Math.max(...points.map(([, y]) => y));
    // Extents must be local to the painted region, not the owner's global
    // empire. The 0.1 padding prevents rounded SVG coordinates crossing a tile.
    localBounds &&= Math.abs(bounds.x - (minX - .1)) < .000001 && Math.abs(bounds.y - (minY - .1)) < .000001
      && Math.abs(bounds.w - (maxX - minX + .2)) < .000001 && Math.abs(bounds.h - (maxY - minY + .2)) < .000001;
    coversEveryPolygon &&= points.every(point => insideBounds(point, bounds));
  }
  const exactCountryCoverage = countryPaths().every(path => {
    const heldParts = parts.filter(part => part.dataset.flagCountry === path.dataset.country);
    const owner = app.state.teams[app.state.own[path.dataset.country]];
    if (!FLAG_CODES[owner?.flagId]) return heldParts.length === 0;
    return JSON.stringify(filledRings(path.getAttribute('d'))) === JSON.stringify(filledRings(heldParts.map(part => part.getAttribute('d')).join('')));
  });
  const unpaintedOwners = app.state.aliveIds.filter(id => FLAG_CODES[app.state.teams[id]?.flagId] && !owners.has(id));
  return {
    ownerCount: owners.size,
    componentCount: groups.size,
    patternCount: patterns.length,
    unpaintedOwners,
    unpaintedOwnersHaveNoFillArea: unpaintedOwners.every(id => countryPaths()
      .filter(path => app.state.own[path.dataset.country] === id).every(path => filledRings(path.getAttribute('d')).length === 0)),
    onePatternPerComponent: patterns.length === groups.size && new Set(patterns.map(pattern => pattern.id)).size === groups.size,
    oneBannerPerPattern: patterns.every(pattern => flagAssetsMatch(pattern, FLAG_CODES[app.state.teams[pattern.dataset.owner]?.flagId])),
    sharedReferences, localBounds, coversEveryPolygon, correctOwner, exactCountryCoverage,
    signature: JSON.stringify(patterns.map(pattern => ({ id: pattern.id, bounds: patternBounds(pattern), source: pattern.dataset.flagSource,
      layers: [...pattern.querySelectorAll('image')].map(image => ({ url: image.getAttribute('href'), bounds: patternBounds(image), fit: image.getAttribute('preserveAspectRatio') }))
    })).sort((a, b) => a.id.localeCompare(b.id))),
  };
}

/** Locate a real island in rendered geometry, not through component internals. */
function flagPartAtCountryLocation(app, countryId, longitude, latitude) {
  const [px, py] = app.geo.project(longitude, latitude);
  const { s, tx, ty } = app.geo.fit;
  const x = px * s + tx, y = py * s + ty;
  return countryFlagParts(countryId).find(part => {
    let winding = 0;
    for (const ring of filledRings(part.getAttribute('d')).map(JSON.parse)) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const a = ring[j], b = ring[i];
        const cross = (b[0] - a[0]) * (y - a[1]) - (x - a[0]) * (b[1] - a[1]);
        if (a[1] <= y && b[1] > y && cross > 0) winding++;
        else if (a[1] > y && b[1] <= y && cross < 0) winding--;
      }
    }
    return winding !== 0;
  });
}

/** The screenshot regression: no miniature Swiss crosses on nearby islands. */
export async function runSwissFlagRegionCheck() {
  const mounted = mount();
  try {
    await launch(mounted, { scope: 'UEFA' });
    const app = mounted.app;
    const ownershipBefore = { ...app.state.own };
    const fielded = app.state.aliveIds.length;
    const squadSizeBefore = app.state.teams['756'].squad.length;
    for (const loserId of ['250', '380']) {
      await setState(app, { round: app.state.round + 1, match: {
        aId: '756', dId: loserId, effA: teamEff(app.state.teams['756']), effD: teamEff(app.state.teams[loserId]),
        ga: 2, gd: 0, shown: [], allEv: [], tie: null, tieShown: null, winner: '756',
        finalGa: 2, finalGd: 0, status: app.sport().labels.end, applied: false, done: true,
      } });
      app.finishMatch();
      await until('Swiss regional flag conquest applied', () => app.state.match.applied);
      app.clearTimers();
    }
    const locations = {
      Switzerland: ['756', 8.2, 46.8], France: ['250', 2.5, 46.5], Italy: ['380', 12.5, 43.2],
      Corsica: ['250', 9.1, 42.2], Sardinia: ['380', 9, 40.1], Sicily: ['380', 14, 37.6],
      Guiana: ['250', -53.1, 4.1],
    };
    const located = Object.fromEntries(Object.entries(locations).map(([name, args]) => [name, flagPartAtCountryLocation(app, ...args)]));
    const mainlandPattern = located.Switzerland && flagPattern(located.Switzerland);
    const isMainland = name => !!mainlandPattern && !!located[name] && flagPattern(located[name])?.id === mainlandPattern.id;
    const afterConquests = empireFlagsSnapshot(app);
    const rulesBeforeModes = ownershipSnapshot(app);
    button('Political').click();
    await until('Swiss regional political mode', () => app.state.mapMode === 'political');
    const politicalHasNoFlags = countryFlagParts().length === 0 && !document.querySelector('pattern[id^="fi-flag-"]');
    button('Flags').click();
    await until('Swiss regional flags restored', () => app.state.mapMode === 'flags');
    const restored = empireFlagsSnapshot(app);
    return {
      afterConquests, restored, located: Object.fromEntries(Object.entries(located).map(([name, part]) => [name, !!part])),
      mainlandShared: ['France', 'Italy'].every(isMainland),
      corsicaShared: isMainland('Corsica'), sardiniaShared: isMainland('Sardinia'), sicilyShared: isMainland('Sicily'),
      swissAsset: flagAssetsMatch(mainlandPattern, 'ch'),
      guianaSeparate: !!located.Guiana && flagPattern(located.Guiana)?.id !== mainlandPattern?.id
        && flagAssetsMatch(flagPattern(located.Guiana), 'ch'),
      onlyIntendedConquests: app.state.matches === 2 && app.state.aliveIds.length === fielded - 2
        && app.state.teams['756'].squad.length === squadSizeBefore + 2
        && Object.keys(app.state.own).length === Object.keys(ownershipBefore).length
        && Object.entries(ownershipBefore).every(([id, owner]) => app.state.own[id] === (['250', '380'].includes(owner) ? '756' : owner)),
      politicalHasNoFlags, modesPreserveRegions: restored.signature === afterConquests.signature,
      modesPreserveRules: JSON.stringify(ownershipSnapshot(app)) === JSON.stringify(rulesBeforeModes),
    };
  } finally {
    mounted.unmount();
  }
}

/** Flags follow campaign ownership, never geography or the surviving id list. */
function regionalFlagsSnapshot(app) {
  const paths = countryPaths();
  const neutral = paths.filter(path => !app.state.own[path.dataset.country]);
  const domestic = domesticOf(app);
  if (domestic) return {
    domestic: true,
    correct: expectedFlagsShown(app),
    sections: paths.filter(path => domestic.sectionIds.has(path.dataset.country)).length,
    expectedSections: domestic.sectionIds.size,
    neutralCount: neutral.length,
    flagParts: countryFlagParts().length,
    flagPatterns: document.querySelectorAll('pattern[id^="fi-flag-"]').length,
    empireFlags: empireFlagsSnapshot(app),
    backdrop: backdropSnapshot(app),
  };
  const conquered = paths.filter(path => {
    const id = path.dataset.country;
    const owner = app.state.teams[app.state.own[id]];
    return NATIONS[id] && owner?.kind !== 'club' && owner && owner.id !== id;
  });
  const ownerFlagMatches = path => {
    const owner = app.state.teams[app.state.own[path.dataset.country]];
    const parts = countryFlagParts(path.dataset.country);
    if (filledRings(path.getAttribute('d')).length === 0) return parts.length === 0;
    return parts.length > 0 && parts.every(part => flagAssetsMatch(flagPattern(part), FLAG_CODES[owner?.flagId]));
  };
  const neutralMatches = path => !path.getAttribute('fill').startsWith('url(')
    && countryFlagParts(path.dataset.country).length === 0;
  return {
    correct: expectedFlagsShown(app),
    neutralCount: neutral.length,
    inactiveNations: neutral.filter(path => NATIONS[path.dataset.country]).length,
    neutralHasNoFlags: neutral.every(neutralMatches),
    conqueredCount: conquered.length,
    conqueredKeepOwnerFlags: conquered.every(ownerFlagMatches),
    empireFlags: empireFlagsSnapshot(app),
    dependenciesCorrect: paths.filter(path => DEPENDENCIES[path.dataset.country]).every(path => {
      const owner = app.state.teams[app.state.own[path.dataset.country]];
      return owner?.kind !== 'club' && owner ? ownerFlagMatches(path) : neutralMatches(path);
    }),
  };
}

const labelGeographyCaches = new WeakMap();

function labelGeographySnapshot(app, placements, unitsPerPixel) {
  let cache = labelGeographyCaches.get(app.labelGeometry);
  if (!cache) {
    const rings = app.labelGeometry.map(shape => ({ id: shape.id, rings: shape.rings.filter(points => Math.abs(points.reduce((area, [x, y], i) => {
      const next = points[(i + 1) % points.length];
      return area + x * next[1] - next[0] * y;
    }, 0)) > .0000002).map(points => {
      const xs = points.map(([x]) => x), ys = points.map(([, y]) => y);
      return { points, bbox: { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) } };
    }) }));
    cache = { rings, validator: createLabelValidator(app.labelGeometry) };
    labelGeographyCaches.set(app.labelGeometry, cache);
  }
  const ringHit = (ring, [x, y]) => {
    if (!insideBounds([x, y], ring.bbox)) return { winding: 0, boundary: false };
    let winding = 0;
    for (let i = 0, j = ring.points.length - 1; i < ring.points.length; j = i++) {
      const a = ring.points[j], b = ring.points[i], dx = b[0] - a[0], dy = b[1] - a[1];
      if (dx === 0 && dy === 0) continue;
      const cross = dx * (y - a[1]) - (x - a[0]) * dy;
      if (Math.abs(cross) <= .000001 * Math.max(1, Math.abs(dx), Math.abs(dy))
        && x >= Math.min(a[0], b[0]) - .000001 && x <= Math.max(a[0], b[0]) + .000001
        && y >= Math.min(a[1], b[1]) - .000001 && y <= Math.max(a[1], b[1]) + .000001) return { winding: 0, boundary: true };
      if (a[1] <= y && b[1] > y && cross > 0) winding++;
      else if (a[1] > y && b[1] <= y && cross < 0) winding--;
    }
    return { winding, boundary: false };
  };
  const contains = (shape, point) => {
    const hits = shape.rings.map(ring => ringHit(ring, point));
    return hits.some(hit => hit.boundary) || hits.reduce((sum, hit) => sum + hit.winding, 0) !== 0;
  };
  const pointSegmentDistance = ([x, y], a, b) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / lengthSquared)) : 0;
    return Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy);
  };
  const errors = [];
  for (const placement of placements) {
    if (!placement) { errors.push('missing placement'); continue; }
    const owned = cache.rings.filter(shape => app.state.own[shape.id] === placement.id);
    const foreign = cache.rings.filter(shape => app.state.own[shape.id] !== placement.id);
    if (!owned.some(shape => contains(shape, [placement.tx, placement.ty]))) errors.push(`${placement.id}: anchor is not owned land`);
    const allowance = placement.coastal ? 10 * unitsPerPixel : 0;
    if (!cache.validator.validateFootprint(app.state.own, placement.id, placement.corners, {
      unitsPerPixel, coastalAllowancePx: placement.coastal ? 10 : 0, maxSeaFraction: .22,
    })) errors.push(`${placement.id}: curved envelope fails geographic policy`);
    const [a, b, , d] = placement.corners;
    const probes = [...placement.corners];
    for (let row = 0; row < 5; row++) for (let col = 0; col < 9; col++) {
      const u = (col + .5) / 9, v = (row + .5) / 5;
      probes.push([a[0] + u * (b[0] - a[0]) + v * (d[0] - a[0]), a[1] + u * (b[1] - a[1]) + v * (d[1] - a[1])]);
    }
    for (const point of probes) {
      if (owned.some(shape => contains(shape, point))) continue;
      if (foreign.some(shape => contains(shape, point))) { errors.push(`${placement.id}: envelope crosses foreign land`); break; }
      let distance = Infinity;
      for (const shape of owned) for (const ring of shape.rings) {
        if (!insideBounds(point, ring.bbox, allowance + .000001)) continue;
        for (let i = 0, j = ring.points.length - 1; i < ring.points.length; j = i++) distance = Math.min(distance, pointSegmentDistance(point, ring.points[j], ring.points[i]));
      }
      if (distance > allowance + .000001) { errors.push(`${placement.id}: sea spill exceeds ${placement.coastal ? 10 : 0}px`); break; }
    }
  }
  return { valid: errors.length === 0, errors };
}

/** Read label placement from the SVG, not the solver's private result objects. */
function empireLabelsSnapshot(app, { geography = false } = {}) {
  const svg = document.querySelector('[data-testid="world-map"]');
  const [x, y, w, h] = svg.getAttribute('viewBox').split(/\s+/).map(Number);
  const rect = svg.getBoundingClientRect();
  const unitsPerPixel = w / (rect.width || 960);
  const owned = new Set(Object.values(app.state.own));
  const labels = [...svg.querySelectorAll('text[data-empire-label]')];
  const ids = labels.map(label => label.dataset.empireLabel);
  const expectedText = id => (app.state.teams[id]?.kind === 'club' ? app.state.teams[id].code : app.state.teams[id]?.name)?.toUpperCase();
  const metadata = app.mapLabels(true);
  const placements = labels.map(label => {
    const transform = label.getAttribute('transform')?.match(/^translate\(([-\d.e+]+)[ ,]+([-\d.e+]+)\) rotate\(([-\d.e+]+)\)$/i);
    if (!transform) return null;
    const [, tx, ty, degrees] = transform.map(Number);
    const fontSize = Number(label.getAttribute('font-size'));
    const width = Number(label.getAttribute('textLength'));
    const rise = Number(label.dataset.curveRise);
    const seaFraction = Number(label.dataset.seaFraction);
    const textPath = label.querySelector('textPath');
    const reference = textPath?.getAttribute('href');
    const baseline = reference?.startsWith('#') ? document.getElementById(reference.slice(1)) : null;
    const curve = baseline?.getAttribute('d')?.match(/^M\s*([-\d.e+]+)[,\s]+([-\d.e+]+)\s*Q\s*([-\d.e+]+)[,\s]+([-\d.e+]+)[,\s]+([-\d.e+]+)[,\s]+([-\d.e+]+)$/i);
    const expectedCurve = [-width / 2, rise / 2, 0, -1.5 * rise, width / 2, rise / 2];
    const angle = degrees * Math.PI / 180;
    // Conservative envelope includes the arch and the glyph rotation at its
    // steepest tangent, not merely the old straight centerline rectangle.
    const halfWidth = width / 2 + .16 * fontSize + .75 * fontSize * Math.sin(Math.atan(4 * Math.abs(rise) / width));
    const halfHeight = .75 * fontSize + Math.abs(rise) / 2;
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => {
      const dx = sx * halfWidth, dy = sy * halfHeight;
      return [tx + dx * Math.cos(angle) - dy * Math.sin(angle), ty + dx * Math.sin(angle) + dy * Math.cos(angle)];
    });
    return { id: label.dataset.empireLabel, tx, ty, fontSize, rise, seaFraction, coastal: label.dataset.coastal === 'true',
      fontPx: fontSize / unitsPerPixel, width, degrees, corners, reference,
      validReference: label.querySelectorAll('textPath').length === 1 && !!baseline && baseline.tagName.toLowerCase() === 'path'
        && baseline.closest('svg') === svg && !!baseline.closest('defs') && textPath.getAttribute('startOffset') === '50%'
        && textPath.textContent.trim() === expectedText(label.dataset.empireLabel),
      validCurve: !!curve && curve.slice(1).map(Number).every((value, i) => Math.abs(value - expectedCurve[i]) < .000001),
    };
  });
  const references = placements.map(placement => placement?.reference);
  const labelPaths = [...svg.querySelectorAll('.territory-labels defs path[id]')];
  const policy = globalThis.__smokeEmpireLabelWork.policy;
  return {
    count: labels.length, ids,
    onePerOwner: new Set(ids).size === ids.length,
    onlyCurrentOwners: ids.every(id => owned.has(id) && app.state.aliveIds.includes(id)),
    correctText: labels.every(label => label.textContent.trim() === expectedText(label.dataset.empireLabel)),
    currentMetadata: metadata.length === app.state.aliveIds.length
      && metadata.every(label => app.state.aliveIds.includes(label.id) && label.text === expectedText(label.id)),
    fontSizes: placements.every(placement => placement && Number.isFinite(placement.fontPx) && placement.fontPx >= 11 - .001 && placement.fontPx <= 32 + .001),
    textPathsValid: placements.every(placement => placement?.validReference && placement.validCurve)
      && new Set(references).size === labels.length && labelPaths.length === labels.length
      && new Set(labelPaths.map(path => path.id)).size === labelPaths.length,
    gentleArches: placements.every(placement => placement && Number.isFinite(placement.rise) && placement.rise > 0 && placement.rise <= placement.width * .1),
    coastalPolicyValid: placements.every(placement => placement && Number.isFinite(placement.seaFraction) && placement.seaFraction >= 0
      && placement.seaFraction <= .22 + .000001 && (placement.coastal || placement.seaFraction <= COASTAL_ZERO_TOLERANCE)),
    coastalPolicyFailures: placements.filter(placement => !placement || !Number.isFinite(placement.seaFraction)
      || placement.seaFraction < 0 || placement.seaFraction > .22 + .000001 || (!placement.coastal && placement.seaFraction > COASTAL_ZERO_TOLERANCE))
      .map(placement => placement && ({ id: placement.id, seaFraction: placement.seaFraction, coastal: placement.coastal })),
    uiPolicyEnabled: !!policy && policy.curveRatio > 0 && policy.curveRatio <= .1
      && policy.coastalAllowancePx >= 8 && policy.coastalAllowancePx <= 10 && policy.maxSeaFraction === .22,
    coastalCount: placements.filter(placement => placement?.coastal).length,
    geography: geography ? labelGeographySnapshot(app, placements, unitsPerPixel) : null,
    references: JSON.stringify(labels.map((label, i) => [label.dataset.empireLabel, references[i]])),
    withinViewport: placements.every(placement => placement && placement.width > 0 && Number.isFinite(placement.degrees)
      && placement.corners.every(point => insideBounds(point, { x, y, w, h }, .001))),
    signature: JSON.stringify(labels.map(label => ({ id: label.dataset.empireLabel, text: label.textContent,
      transform: label.getAttribute('transform'), size: label.getAttribute('font-size'), width: label.getAttribute('textLength'),
      curve: label.dataset.curveRise, coastal: label.dataset.coastal, seaFraction: label.dataset.seaFraction }))),
  };
}

/** Nation and club campaigns exercise the same owner-wide label wiring. */
export async function runEmpireLabelCheck(scenario) {
  const mounted = mount();
  let resumed = null;
  try {
    await launch(mounted, scenario);
    const app = mounted.app;
    await sleep(20); // Allow the theatre camera's initial effect to settle.
    const kickoff = empireLabelsSnapshot(app, { geography: true });
    const initialViewBox = document.querySelector('[data-testid="world-map"]').getAttribute('viewBox');
    const stableGeometry = app.labelGeometry;
    const geometryMatchesMap = stableGeometry.length === countryPaths().length && countryPaths().every(path => {
      const geometry = stableGeometry.find(shape => shape.id === path.dataset.country);
      const rendered = new Set(pathPoints(path).map(point => point.join(',')));
      const supplied = new Set(geometry?.rings.flat().map(point => point.join(',')));
      return geometry?.rings === (app.displayGeo?.paths[path.dataset.country] || app.geo.paths[path.dataset.country]).labelRings
        && supplied.size === rendered.size && [...supplied].every(point => rendered.has(point));
    });
    const winnerId = kickoff.ids[0] || app.state.aliveIds[0];
    const loserId = kickoff.ids.find(id => id !== winnerId) || app.state.aliveIds.find(id => id !== winnerId);
    const rulesBefore = ownershipSnapshot(app);
    const workBefore = { ...globalThis.__smokeEmpireLabelWork };
    const path = countryPaths().find(path => path.dataset.owner === winnerId);
    path.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    await until('label hover committed', () => app.state.hoverCid === path.dataset.country);
    const hoverCached = globalThis.__smokeEmpireLabelWork.layouts === workBefore.layouts;
    const hoverReferencesStable = empireLabelsSnapshot(app).references === kickoff.references;

    // Use the real kickoff and ticker update, but hold simulation timers while
    // checking that these visual-only changes do not repeat geographic work.
    // At 80x, an instant game can finish before until's 20ms polling interval.
    // Freeze the production clock before kickoff so React's commit callback
    // cannot arm a conquest while this cache-only probe waits for its match.
    app.clock.pause();
    app.startMatch(winnerId, loserId);
    await until('label regression match starts', () => !!app.state.match && !app.state.match.applied);
    app.clearTimers();
    app.patchMatch({ ga: 1, shown: app.state.match.allEv.slice(0, 1) });
    await until('label regression ticker advances', () => app.state.match.ga === 1);
    const tickerCached = globalThis.__smokeEmpireLabelWork.layouts === workBefore.layouts;
    const tickerReferencesStable = empireLabelsSnapshot(app).references === kickoff.references;
    const workBeforeStyle = globalThis.__smokeEmpireLabelWork.layouts;
    button('Political').click();
    await until('label regression political styling', () => app.state.mapMode === 'political');
    const styleCached = globalThis.__smokeEmpireLabelWork.layouts === workBeforeStyle;
    const political = empireLabelsSnapshot(app, { geography: true });
    const styleReferencesStable = political.references === kickoff.references;
    const zoomed = [];
    const svg = document.querySelector('[data-testid="world-map"]');
    const cameraWidth = () => Number(svg.getAttribute('viewBox').split(/\s+/)[2]);
    let zoomDirection = 'in';
    for (let i = 0; i < 4; i++) {
      const priorWidth = cameraWidth();
      document.querySelector(`button[aria-label="Zoom ${zoomDirection}"]`).click();
      // A theatre may start close to the camera's upper zoom limit. Let React
      // settle before treating an unchanged camera as a clamp, not a timeout.
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      if (Math.abs(cameraWidth() - priorWidth) < 1e-9) {
        if (zoomDirection !== 'in') throw new Error('owner label zoom-out unexpectedly stopped changing the camera');
        document.querySelector('button[aria-label="Zoom out"]').click();
        await until('owner label zoom backs off the upper clamp', () => cameraWidth() > priorWidth);
        document.querySelector('button[aria-label="Zoom in"]').click();
        await until('owner label zoom returns to the upper clamp', () => Math.abs(cameraWidth() - priorWidth) < 1e-9);
        // The back-off/return check proves Zoom in still works; simply accepting
        // a no-op could hide a broken control. Sample outward from this boundary
        // without assuming a projection-specific initial zoom or a fixed limit.
        zoomDirection = 'out';
        document.querySelector('button[aria-label="Zoom out"]').click();
      }
      await until('owner label zoom commits', () => Math.abs(cameraWidth() - priorWidth) > 1e-9);
      if (!(zoomDirection === 'in' ? cameraWidth() < priorWidth : cameraWidth() > priorWidth)) {
        throw new Error(`owner label zoom-${zoomDirection} moved in the wrong direction`);
      }
      zoomed.push(empireLabelsSnapshot(app, { geography: true }));
    }
    document.querySelector('button[aria-label="Reset view"]').click();
    await sleep(20);
    const reset = empireLabelsSnapshot(app, { geography: true });
    const resetRestoresCamera = svg.getAttribute('viewBox') === initialViewBox;
    const nonRuleInteractionsUnchanged = JSON.stringify(ownershipSnapshot(app)) === JSON.stringify(rulesBefore);
    const cameraReusesGeometry = app.labelGeometry === stableGeometry && globalThis.__smokeEmpireLabelWork.engines === workBefore.engines;

    await setState(app, { match: { ...app.state.match, winner: winnerId, finalGa: 1, finalGd: 0, ga: 1, gd: 0, tie: null, tieShown: null } });
    app.finishMatch();
    await until('owner label conquest applied', () => app.state.match.applied);
    app.clearTimers();
    const conquered = empireLabelsSnapshot(app, { geography: true });
    const ownerPaths = new Map();
    const ownerReferencesStable = [kickoff, political, ...zoomed, reset, conquered].every(snapshot => JSON.parse(snapshot.references).every(([id, reference]) => {
      if (ownerPaths.has(id)) return ownerPaths.get(id) === reference;
      ownerPaths.set(id, reference);
      return true;
    }));
    const conqueredMetadata = JSON.stringify(app.mapLabels(true));
    const rulesAfterConquest = ownershipSnapshot(app);
    const lostTerritories = Object.entries(JSON.parse(rulesBefore.ownership)).filter(([, owner]) => owner === loserId).map(([id]) => id);
    const conquestOwnershipUpdated = lostTerritories.length > 0 && lostTerritories.every(id => app.state.own[id] === winnerId)
      && !app.state.aliveIds.includes(loserId) && !conquered.ids.includes(loserId)
      && !app.mapLabels(true).some(label => label.id === loserId);
    const conquestKeepsGeometryCache = app.labelGeometry === stableGeometry && globalThis.__smokeEmpireLabelWork.engines === workBefore.engines;
    mounted.unmount();
    resumed = mount();
    await until('owner label save offered', () => text().includes('Launch campaign') && resumed.app.state.hasSave);
    button('Resume', document.querySelector('.setup-save')).click();
    await until('owner label campaign resumed', () => resumed.app.state.phase === 'playing');
    await sleep(20);
    const restored = empireLabelsSnapshot(resumed.app, { geography: true });
    const resumedRules = ownershipSnapshot(resumed.app);
    return {
      kickoff, political, zoomed, reset, conquered, restored, geometryMatchesMap,
      hoverCached, tickerCached, styleCached, hoverReferencesStable, tickerReferencesStable, styleReferencesStable,
      ownerReferencesStable, cameraReusesGeometry, conquestKeepsGeometryCache, nonRuleInteractionsUnchanged,
      zoomChangesPlacement: zoomed.some(snapshot => snapshot.signature !== kickoff.signature),
      resetRestoresCamera,
      conquestOwnershipUpdated,
      restoreLabels: JSON.stringify(resumed.app.mapLabels(true)) === conqueredMetadata && restored.currentMetadata && restored.correctText,
      restoreRules: resumedRules.ownership === rulesAfterConquest.ownership && resumedRules.squads === rulesAfterConquest.squads
        && resumedRules.standings === rulesAfterConquest.standings && resumedRules.strengthGains === rulesAfterConquest.strengthGains,
      neutralTerritories: countryPaths().filter(path => !path.dataset.owner).length,
      domestic: !!domesticOf(resumed.app),
      usesClubCodes: scenario.layer !== 'clubs' || restored.ids.every(id => resumed.app.state.teams[id].kind === 'club'
        && document.querySelector(`text[data-empire-label="${id}"]`).textContent === resumed.app.state.teams[id].code.toUpperCase()),
    };
  } finally {
    mounted.unmount();
    resumed?.unmount();
  }
}

async function until(label, predicate, timeoutMs = 60000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return;
    await sleep(20);
  }
  throw new Error(`timed out waiting for: ${label}`);
}

function button(label, within = document) {
  const found = [...within.querySelectorAll('button')].find(el => el.textContent.trim() === label);
  if (!found) throw new Error(`button not found: ${label}`);
  if (found.disabled) throw new Error(`button disabled: ${label}`);
  return found;
}

function mount() {
  let app = null;
  let mounted = true;
  const root = createRoot(document.getElementById('root'));
  root.render(<App ref={el => { app = el; }} />);
  return {
    get app() { return app; },
    unmount() { if (mounted) { root.unmount(); mounted = false; } },
  };
}

async function select(id, value) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`select not found: ${id}`);
  el.value = value;
  el.dispatchEvent(new Event('change', { bubbles: true }));
  await sleep(20);
  if (el.value !== value) throw new Error(`select rejected ${value}: ${id}`);
}

/** Theatre choices as rendered, grouped as the setup screen groups them. */
function theatreSnapshot(sport) {
  const theatre = document.getElementById('setup-theatre');
  const option = node => ({ value: node.value, text: node.textContent.trim() });
  return {
    groups: [...theatre.querySelectorAll('optgroup')].map(group => ({ label: group.getAttribute('label'),
      options: [...group.querySelectorAll('option')].map(option) })),
    options: [...theatre.querySelectorAll('option')].map(option),
    clubScopes: CLUB_SCOPES(getSport(sport)).map(scope => scope.id),
  };
}

/**
 * Choose a country through the real Theatre select and wait for its map. The
 * static server delays the file so the loading state is observable; with
 * `setupChecks` the first request also fails, to exercise the error and Retry.
 */
async function chooseDomestic(app, id, { setupChecks = false } = {}) {
  const entry = DOMESTIC.find(item => item.id === id);
  if (!entry) throw new Error(`no shipped domestic map for ${id}`);
  const file = `domestic/${id}.json`, plan = globalThis.__smokeFetch;
  const sectionPattern = new RegExp(`^${id}-\\d{3}$`);
  // Format-1 index entries have no `sections`: one per club.
  const sections = entry.sections ?? entry.clubs;
  const launchButton = () => buttonNamed('Launch campaign');
  const loading = () => text().includes(`Loading the map of ${entry.name}`) && !!launchButton()?.disabled;
  const ready = () => {
    const ids = countryPaths().map(path => path.dataset.country);
    return !!launchButton() && !launchButton().disabled && ids.length === sections && ids.every(cid => sectionPattern.test(cid));
  };
  const result = { lazy: !plan.requests.includes(file) };
  plan.delays[file] = 150;
  if (setupChecks) plan.failures.add(file);
  await select('setup-theatre', domesticScope(id));
  result.sawLoading = await waitFor(loading, 3000);
  if (setupChecks) {
    result.errorShown = await waitFor(() => !!buttonNamed('Retry') && !!launchButton()?.disabled
      && /could not|fail|error|unable/i.test(text()), 5000);
    buttonNamed('Retry')?.click();
    result.retryLoaded = await waitFor(ready, 30000);
  }
  await until(`the map of ${entry.name} on the setup screen`, ready, 30000);
  delete plan.delays[file];
  const reference = await loadReference(id);
  const shown = countryPaths().map(path => path.dataset.country);
  result.sectionsShown = shown.length === reference.sectionIds.size && shown.every(cid => reference.sectionIds.has(cid));
  result.setupColours = countryPaths().every(path => path.getAttribute('fill') === reference.clubBySection[path.dataset.country]?.col);
  result.previewCount = !!document.querySelector('.setup-session-preview')?.textContent.includes(`${entry.clubs} clubs`);
  const page = text();
  result.description = entry.top.every(name => page.includes(name)) && page.includes(`${entry.clubs} clubs fighting over ${entry.name}`)
    && page.includes(`${sections} sections`)
    && (sections === entry.clubs || page.includes(`each club starts with ${Math.floor(sections / entry.clubs)}`));
  // Hovering the preview names the club starting there: its home town's section, or another of its group.
  const tip = async section => {
    countryPaths().find(path => path.dataset.country === section)?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    await waitFor(() => app.state.hoverCid === section, 2000);
    await sleep(20);
    return (document.querySelector('.map-tooltip')?.textContent || '').toLocaleLowerCase();
  };
  const lower = club => club.name.toLocaleLowerCase();
  const top = reference.clubs[0], grouped = reference.clubs.find(club => club.startSections.length > 1);
  result.setupTooltips = (await tip(top.homeSection)).includes(`home of ${lower(top)}`)
    && (!grouped || (await tip(grouped.startSections.at(-1))).includes(`${lower(grouped)} starts here`));
  result.groupedPreview = !!grouped === (sections > entry.clubs);
  await setState(app, { hoverCid: null });
  result.backdrop = backdropSnapshot(app);
  if (setupChecks) {
    // As the managed club's country: a session preset keeps both the country and the club.
    button('Manager').click();
    await sleep(30);
    const club = reference.clubs[1].id;
    await select('setup-managed-team', club);
    button('Standard').click();
    await sleep(30);
    result.presetKeepsCountry = app.state.setup.clubScope === domesticScope(id)
      && document.getElementById('setup-theatre').value === domesticScope(id);
    result.presetKeepsClub = app.state.setup.managedTeamId === club && document.getElementById('setup-managed-team').value === club
      && !buttonNamed('Launch campaign')?.disabled;
    button('Spectator').click();
    await sleep(30);
    button('Basketball').click();
    await waitFor(() => app.state.setup.clubScope === 'all', 2000);
    result.basketballResets = app.state.setup.clubScope === 'all'
      && !theatreSnapshot('basketball').options.some(item => item.value.startsWith('domestic:'));
    button('Football').click();
    await sleep(20);
    await select('setup-theatre', domesticScope(id));
    await until(`the map of ${entry.name} after switching sport back`, ready, 30000);
  }
  return result;
}

/** The started country campaign, read from rendered output and the rule view. */
function domesticCampaignSnapshot(app, reference) {
  const { settings, own, teams, aliveIds } = app.state;
  const routing = Object.keys(app.board().routingPaths || {});
  const homes = app.mapHomes(true);
  const circles = [...document.querySelectorAll('[data-testid="world-map"] circle')];
  const scale = document.querySelector('.map-distance');
  return {
    scope: settings.layer === 'clubs' && settings.clubScope === reference.scope,
    version: settings.domesticVersion === reference.meta.version,
    fielded: aliveIds.length === reference.entry.clubs,
    everySectionHeld: Object.keys(own).length === reference.sectionIds.size && [...reference.sectionIds].every(id => aliveIds.includes(own[id])),
    // At kickoff: each club holds exactly its starting sections, its home among them.
    startGroups: Object.entries(reference.startOwners).every(([section, club]) => own[section] === club)
      && reference.clubs.every(club => teams[club.id]?.home === club.homeSection && club.startSections[0] === club.homeSection),
    wholeGroups: wholeGroups(own, reference),
    routingIsSections: routing.length === reference.sectionIds.size && routing.every(id => reference.sectionIds.has(id)),
    // Neighbouring land blocks routes but is never a section; the same array every time keeps the route index cached.
    obstacles: app.board().borderRoutes === true && app.board().obstacles?.length > 0
      && app.board().obstacles.every(shape => !reference.sectionIds.has(shape.id)) && app.board().obstacles === app.board().obstacles,
    theatreLabel: document.querySelector('.command-theatre')?.textContent.trim() === reference.label,
    mapTitle: !!document.querySelector('.map-heading h1')?.textContent.includes(reference.entry.name),
    scaleTitle: (scale?.getAttribute('title') || '').replace(/[’‘]/g, "'") === DOMESTIC_SCALE_TITLE,
    homesShown: homes.length === aliveIds.length && homes.every(home => circles.some(circle =>
      Number(circle.getAttribute('cx')) === home.x && Number(circle.getAttribute('cy')) === home.y)),
  };
}

async function launch(mounted, { sport = 'football', layer = 'nations', scope = 'world', clubScope = 'all', pacing = 'blitz', resolution = 'instant', seed = 20260910, setupChecks = false }) {
  await until('map + setup screen', () => text().includes('Launch campaign'));
  const setupFlags = expectedFlagsShown(mounted.app);
  button(sport === 'basketball' ? 'Basketball' : 'Football').click();
  await sleep(20);
  button(layer === 'clubs' ? 'Clubs' : 'Nations').click();
  await sleep(20);
  const theatre = theatreSnapshot(sport);
  const domesticId = layer === 'clubs' ? domesticScopeId(clubScope) : null;
  const domesticSetup = domesticId ? await chooseDomestic(mounted.app, domesticId, { setupChecks }) : null;
  if (!domesticId) await select('setup-theatre', layer === 'clubs' ? clubScope : scope);
  document.querySelector('.setup-advanced').open = true;
  await select('setup-pacing', pacing);
  await select('setup-resolution', resolution);
  // Intercept only startCampaign's RNG assignment to seed generated roster
  // gaps too. The one-shot setter immediately becomes a normal writable field;
  // clocks, timer implementations and production source remain untouched.
  Object.defineProperty(mounted.app, 'rng', {
    configurable: true,
    set() {
      Object.defineProperty(this, 'rng', { configurable: true, writable: true, value: makeRng(seed) });
    },
  });
  button('Launch campaign').click();
  await until('campaign running', () => mounted.app.state.phase === 'playing');
  mounted.app.rng = makeRng(seed);
  await setState(mounted.app, { speed: SPEED });
  const reference = domesticOf(mounted.app);
  return { setupFlags, theatre, domesticSetup, kickoffFlags: expectedFlagsShown(mounted.app), kickoffFlagScope: regionalFlagsSnapshot(mounted.app),
    domesticKickoff: reference ? { ...domesticCampaignSnapshot(mounted.app, reference),
      footnote: document.querySelector('.map-footnote span')?.textContent || '' } : null };
}

/** Hovering a section names it and its holder; the backdrop ignores the pointer. */
async function domesticPointerSnapshot(app, reference) {
  const path = countryPaths().find(candidate => candidate.dataset.owner);
  const id = path.dataset.country;
  path.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  await until('section hover committed', () => app.state.hoverCid === id);
  await sleep(20);
  const tip = document.querySelector('.map-tooltip');
  const lower = value => String(value || '').toLocaleLowerCase();
  const tooltip = tip?.style.display !== 'none' && lower(tip?.querySelector('strong')?.textContent) === lower(reference.sectionNames[id])
    && lower(tip.textContent).includes(lower(app.state.teams[app.state.own[id]].name));
  const backdropPath = document.querySelector('g.map-backdrop path');
  const before = { selected: app.state.selected, hoverCid: app.state.hoverCid, own: JSON.stringify(app.state.own) };
  backdropPath?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  backdropPath?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await sleep(30);
  const backdropIgnored = !!backdropPath && app.state.selected === before.selected && app.state.hoverCid === before.hoverCid
    && JSON.stringify(app.state.own) === before.own;
  return { tooltip, tooltipText: tip?.textContent, section: reference.sectionNames[id], backdropIgnored };
}

const saveStatusText = () => document.querySelector('.save-status')?.textContent || '';

/**
 * Country saves restore only onto their map. On the setup screen, before the real
 * resume: a save naming a section the map lacks is refused in place, and a map
 * that cannot load blocks the resume with a message rather than a broken campaign.
 */
async function refusedCountryRestores(app, reference) {
  const saved = app.saved, name = reference.entry.name;
  const file = `domestic/${reference.id}.json`, plan = globalThis.__smokeFetch;
  const broken = JSON.parse(JSON.stringify(saved));
  const moved = Object.keys(broken.own)[0];
  broken.own[`${reference.id}-999`] = broken.own[moved];
  delete broken.own[moved];
  app.continueSaved(broken);
  const mismatchRefused = await waitFor(() => saveStatusText().includes(`no longer matches the map of ${name}`), 3000)
    && app.state.phase === 'setup' && app.saved === saved;
  clearDomesticCache(reference.id);
  plan.failures.add(file);
  button('Resume', document.querySelector('.setup-save')).click();
  const loadFailureRefused = await waitFor(() => saveStatusText().includes(`map of ${name} could not be loaded, so the campaign cannot resume`), 5000)
    && app.state.phase === 'setup' && app.saved === saved;
  plan.failures.delete(file);
  return { mismatchRefused, loadFailureRefused };
}

/**
 * A save from an earlier build of the same map resumes (as a copy, so it cannot
 * clash with the live slot), is re-stamped with the loaded version, says so, and
 * never replays its stale draw. The earlier build is the one-section-per-club
 * layout (format 1): club k's only section was <id>-k, held by whoever holds
 * its whole group now, and every group must come back to that holder.
 */
async function restoreOnUpdatedMap(app, reference, saved) {
  const [attackerId, targetId] = saved.aliveIds;
  const oldHome = new Map(reference.clubs.map((club, rank) => [club.id, `${reference.id}-${String(rank + 1).padStart(3, '0')}`]));
  const teams = Object.fromEntries(Object.entries(saved.teams).map(([id, team]) => [id, { ...team, home: oldHome.get(id) }]));
  const own = Object.fromEntries(reference.clubs.map(club => [oldHome.get(club.id), saved.own[club.homeSection]]));
  const stale = { ...saved, teams, own, settings: { ...saved.settings, domesticVersion: `${reference.id}-00000000` },
    match: null, conquestIds: [], spin: { attackerId, targetId, key: 1, stage: 'locked', x: 0, y: 0, targetX: 1, targetY: 1 } };
  app.continueSaved(stale, true, 'Older map copy');
  await until('campaign restored on the updated map', () => app.state.phase === 'playing' && app.state.campaignId !== saved.campaignId
    && app.state.settings.domesticVersion === reference.meta.version, 10000);
  await sleep(50);
  const restored = app.state.own;
  return {
    restamped: app.state.settings.domesticVersion === reference.meta.version && app.saved?.settings.domesticVersion === reference.meta.version,
    // The campaign's save status sits in the closed settings menu, so read the state it shows.
    told: !!app.state.saveStatus?.message?.includes(`updated map of ${reference.entry.name}. The interrupted draw starts again.`),
    staleDrawDropped: app.state.spin === null && app.state.match === null && app.state.matches === saved.matches,
    ownershipKept: Object.keys(restored).length === reference.sectionIds.size
      && Object.entries(saved.own).every(([section, owner]) => restored[section] === owner)
      && reference.clubs.every(club => app.state.teams[club.id].home === club.homeSection),
    status: app.state.saveStatus?.message,
  };
}

/** Adjacent conquests merge flags; overseas conquests cannot distort them. */
export async function runEmpireFlagCheck() {
  const previousObserver = Object.getOwnPropertyDescriptor(globalThis, 'ResizeObserver');
  const previousRect = Object.getOwnPropertyDescriptor(SVGElement.prototype, 'getBoundingClientRect');
  const inheritedRect = SVGElement.prototype.getBoundingClientRect;
  const observers = new Set();
  let viewport = { width: 960, height: 540 };
  Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, writable: true, value: class {
    constructor(callback) { this.callback = callback; }
    observe() { observers.add(this); }
    disconnect() { observers.delete(this); }
  } });
  Object.defineProperty(SVGElement.prototype, 'getBoundingClientRect', { configurable: true, value() {
    if (this.dataset.testid !== 'world-map') return inheritedRect.call(this);
    return { x: 0, y: 0, top: 0, left: 0, right: viewport.width, bottom: viewport.height, ...viewport };
  } });
  const mounted = mount();
  let resumed = null;
  try {
    await launch(mounted, { scope: 'world' });
    const app = mounted.app;
    const kickoff = empireFlagsSnapshot(app);
    const largestPart = id => countryFlagParts(id).sort((a, b) => {
      const area = part => {
        const points = pathPoints(part);
        const xs = points.map(([x]) => x), ys = points.map(([, y]) => y);
        return (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
      };
      return area(b) - area(a);
    })[0];
    const mainlandPattern = () => flagPattern(largestPart('276'));
    const germanyBefore = patternBounds(mainlandPattern());
    const franceAtKickoffDetached = new Set(countryFlagParts('250').map(part => part.dataset.flagComponent)).size > 1;
    async function acquire(loserId) {
      await setState(app, { round: app.state.round + 1, match: {
        aId: '276', dId: loserId, effA: teamEff(app.state.teams['276']), effD: teamEff(app.state.teams[loserId]),
        ga: 2, gd: 0, shown: [], allEv: [], tie: null, tieShown: null, winner: '276',
        finalGa: 2, finalGd: 0, status: app.sport().labels.end, applied: false, done: true,
      } });
      app.finishMatch();
      await until('empire flag conquest applied', () => app.state.match.applied);
      app.clearTimers();
    }
    await acquire('208'); // Danish Jutland joins Germany; Greenland must not.
    const firstConquest = empireFlagsSnapshot(app);
    const denmarkConnected = flagPattern(largestPart('208')) === mainlandPattern();
    const greenlandDetached = countryFlagParts('304').length > 0 && countryFlagParts('304').every(part => flagPattern(part) !== mainlandPattern());
    const germanAssetAfterDenmark = flagAssetsMatch(mainlandPattern(), 'de');
    const germanyAfterDenmark = patternBounds(mainlandPattern());
    await acquire('250'); // Continental France joins Germany, not its colonies.
    const neighboring = empireFlagsSnapshot(app);
    const franceConnected = flagPattern(largestPart('250')) === mainlandPattern();
    const franceOffshoreDetached = countryFlagParts('250').some(part => flagPattern(part) !== mainlandPattern());
    const mainlandAfterNeighbors = mainlandPattern().outerHTML;
    await acquire('392'); // Japan is disjoint from Europe and contains many islands.
    const disjoint = empireFlagsSnapshot(app);
    const japanDetached = countryFlagParts('392').length > 0 && countryFlagParts('392').every(part => flagPattern(part) !== mainlandPattern());
    const mainlandUnchangedByJapan = mainlandPattern().outerHTML === mainlandAfterNeighbors;
    await acquire('242'); // Fiji exercises islands on both sides of the date line.
    const archipelago = empireFlagsSnapshot(app);
    const islandPath = document.querySelector('path[data-country="242"]');
    const islandGeometry = app.displayGeo?.paths['242'] || app.geo.paths['242'];
    const islandsBeyondMainland = pathPoints(islandPath).some(point => !insideBounds(point, islandGeometry.bbox));
    const islandDetached = countryFlagParts('242').length > 1 && countryFlagParts('242').every(part => flagPattern(part) !== mainlandPattern());
    const mainlandUnchangedByFiji = mainlandPattern().outerHTML === mainlandAfterNeighbors;
    const grewWithNeighbor = germanyAfterDenmark.w * germanyAfterDenmark.h > germanyBefore.w * germanyBefore.h;

    const svg = document.querySelector('[data-testid="world-map"]');
    const initialView = svg.getAttribute('viewBox');
    document.querySelector('button[aria-label="Zoom in"]').click();
    await until('shared flag zoom applies', () => svg.getAttribute('viewBox') !== initialView);
    const zoomed = empireFlagsSnapshot(app);
    const zoomedView = svg.getAttribute('viewBox');
    viewport = { width: 390, height: 700 };
    observers.forEach(observer => observer.callback([]));
    await until('shared flag resize applies', () => svg.getAttribute('viewBox') !== zoomedView);
    const resized = empireFlagsSnapshot(app);
    const stateBeforeReload = ownershipSnapshot(app);
    mounted.unmount();
    resumed = mount();
    await until('empire flag save offered', () => text().includes('Launch campaign') && resumed.app.state.hasSave);
    button('Resume', document.querySelector('.setup-save')).click();
    await until('empire flag saved state restored', () => resumed.app.state.phase === 'playing');
    const restored = empireFlagsSnapshot(resumed.app);
    return {
      kickoff, firstConquest, neighboring, disjoint, archipelago, zoomed, resized, restored,
      franceAtKickoffDetached, denmarkConnected, greenlandDetached, germanAssetAfterDenmark, franceConnected, franceOffshoreDetached,
      japanDetached, islandDetached, islandsBeyondMainland, grewWithNeighbor, mainlandUnchangedByJapan, mainlandUnchangedByFiji,
      zoomPreservesPattern: zoomed.signature === archipelago.signature,
      resizePreservesPattern: resized.signature === archipelago.signature,
      reloadPreservesPattern: restored.signature === archipelago.signature,
      reloadPreservesOwnership: ownershipSnapshot(resumed.app).ownership === stateBeforeReload.ownership,
    };
  } finally {
    mounted.unmount();
    resumed?.unmount();
    if (previousObserver) Object.defineProperty(globalThis, 'ResizeObserver', previousObserver);
    else delete globalThis.ResizeObserver;
    if (previousRect) Object.defineProperty(SVGElement.prototype, 'getBoundingClientRect', previousRect);
    else delete SVGElement.prototype.getBoundingClientRect;
  }
}

function ownershipSnapshot(app) {
  const state = app.state;
  return {
    round: state.round,
    alive: state.aliveIds.length,
    matches: state.matches,
    firstAlive: state.aliveIds[0],
    ownedByFirstAlive: Object.values(state.own).filter(owner => owner === state.aliveIds[0]).length,
    ownership: JSON.stringify(state.own),
    settings: JSON.stringify(state.settings),
    squads: JSON.stringify(Object.fromEntries(Object.entries(state.teams).map(([id, team]) => [id, team.squad]))),
    queue: JSON.stringify(state.queue),
    standings: JSON.stringify(app.powerTable(true).map(({ tid, rank, eff }) => ({ tid, rank, eff }))),
    strengthGains: JSON.stringify(app.powerTable(true).map(({ tid }) => ({ tid,
      base: state.teams[tid].baseEff,
      gain: roundedGain(teamEff(state.teams[tid]), state.teams[tid].baseEff ?? teamEff(state.teams[tid])),
    }))),
  };
}

/** Read the real table against current squads, independently of its view model. */
function standingsSnapshot(app) {
  const { aliveIds, teams } = app.state;
  const expected = aliveIds.slice().sort((a, b) => teamEff(teams[b]) - teamEff(teams[a])
    || teams[a].name.localeCompare(teams[b].name) || a.localeCompare(b));
  const rows = [...document.querySelectorAll('.fi-standings tbody tr')];
  const model = app.powerTable(true);
  return {
    sorted: model.length === expected.length && model.every((row, i) => row.tid === expected[i])
      && rows.length === expected.length && rows.every((row, i) => row.cells[1].querySelector('.fi-standing-team > span[title]')?.textContent.trim() === teams[expected[i]].name
        && row.cells[3].querySelector('.fi-standing-eff')?.textContent.trim() === teamEff(teams[expected[i]]).toFixed(1)),
    ranks: model.every((row, i) => row.rank === i + 1)
      && rows.every((row, i) => row.cells[0].textContent.trim() === String(i + 1)),
    announced: document.querySelector('.fi-standings th[aria-sort="descending"]')?.textContent.trim() === 'Strength',
    gainsCorrect: rows.length === expected.length && rows.every((row, i) => {
      const team = teams[expected[i]];
      const gain = roundedGain(teamEff(team), team.baseEff ?? teamEff(team));
      const badge = row.cells[3].querySelector('[data-testid="standing-strength-gain"]');
      return gain > 0
        ? !!badge && badge.classList.contains('fi-strength-gain') && badge.textContent.trim() === `+${gain.toFixed(1)}`
        : !badge;
    }),
    gains: rows.map(row => row.cells[3].querySelector('[data-testid="standing-strength-gain"]')?.textContent.trim() || null),
    count: rows.length,
  };
}

/** Verify the earned rating comes from the squad, not territory or score. */
function resultStrengthSnapshot(app, before, after) {
  const match = app.state.match;
  const gain = roundedGain(after, before);
  const result = app.matchCard().result;
  const reward = document.querySelector('[data-testid="match-strength-gain"]');
  const badge = reward?.querySelector('strong');
  return {
    accurate: match.strengthBefore === before && match.strengthAfter === after && match.strengthGained === gain
      && result.strengthBefore === before && result.strengthAfter === after && result.strengthGain === gain,
    visible: !!badge && badge.textContent.trim() === (gain > 0 ? `+${gain.toFixed(1)}` : 'No change')
      && reward.textContent.includes(`${before.toFixed(1)} to ${after.toFixed(1)}`),
    positive: gain > 0 && !!badge?.classList.contains('fi-strength-gain'),
    neutral: gain === 0 && !badge?.classList.contains('fi-strength-gain'),
    gain,
  };
}

/** Land never outranks strength; a real player acquisition reranks immediately. */
export async function runStrengthStandingsCheck() {
  const mounted = mount();
  let resumed = null;
  try {
    await launch(mounted, { scope: 'world' });
    const app = mounted.app;
    const world = standingsSnapshot(app);
    const ids = app.state.aliveIds.slice(0, 6);
    const [largeId, strongId, challengerId, donorId, twinId, equalId] = ids;
    const definitions = [
      ['Zulu large empire', 70, 70, 6],
      ['Alpha small team', 80, 80, 1],
      ['Beta challenger', 79, 79, 1],
      ['Twin donor', 10, 99, 1],
      ['Twin donor', 10, 99, 2],
      ['Alpha equal strength', 70, 70, 1],
    ];
    const teams = Object.fromEntries(ids.map((id, i) => {
      const [name, str, rating] = definitions[i];
      const squad = app.sport().positionPlan.map((pos, index) => ({ name: `${name} player ${index}`, pos,
        rating: i === 3 || i === 4 ? 10 : rating, gen: false }));
      if (i === 3 || i === 4) squad.find(player => player.pos === (i === 3 ? 'FW' : 'DF')).rating = 99;
      const team = { ...app.state.teams[id], name, str, squad };
      team.baseEff = teamEff(team);
      return [id, team];
    }));
    const shapes = Object.keys(app.state.own);
    let shapeIndex = 0;
    const own = {};
    ids.forEach((id, i) => {
      for (let count = 0; count < definitions[i][3]; count++) own[shapes[shapeIndex++]] = id;
    });
    // Keep inactive teams as historical identities, as a real campaign does.
    // The save validator also resolves existing settings/statistics against them.
    await setState(app, { teams: { ...app.state.teams, ...teams }, own, aliveIds: ids.slice().reverse(), tab: 'power' });
    const before = app.powerTable(true);
    const fixture = standingsSnapshot(app);
    const position = id => before.findIndex(row => row.tid === id);
    const weakerEmpireBelow = position(largeId) > position(strongId)
      && Number(before[position(largeId)].territories) > Number(before[position(strongId)].territories);
    const alphabeticalTie = teamEff(teams[equalId]) === teamEff(teams[largeId]) && position(equalId) < position(largeId);
    const tiedIds = [donorId, twinId].sort((a, b) => a.localeCompare(b));
    const stableIdTie = position(tiedIds[0]) < position(tiedIds[1]);

    // Use the production consequence handler, not a fabricated stronger squad.
    async function acquire(loserId) {
      const strengthBefore = teamEff(app.state.teams[challengerId]);
      await setState(app, { round: app.state.round + 1, match: {
        aId: challengerId, dId: loserId, effA: strengthBefore, effD: teamEff(app.state.teams[loserId]),
        ga: 1, gd: 0, shown: [], allEv: [], tie: null, tieShown: null, winner: challengerId,
        finalGa: 1, finalGd: 0, status: app.sport().labels.end, applied: false, done: true,
      } });
      app.finishMatch();
      await until('strength regression acquisition applied', () => app.state.match.applied);
      app.clearTimers();
      return resultStrengthSnapshot(app, strengthBefore, teamEff(app.state.teams[challengerId]));
    }
    const firstGain = await acquire(donorId);
    const after = app.powerTable(true);
    const firstStandings = standingsSnapshot(app);
    const acquired = app.state.teams[challengerId].squad.length === teams[challengerId].squad.length + 1;
    const eliminatedRemoved = !after.some(row => row.tid === donorId);
    const firstSnapshot = ownershipSnapshot(app);
    app.finishMatch();
    await sleep(30);
    const noDoubleApply = JSON.stringify(ownershipSnapshot(app)) === JSON.stringify(firstSnapshot);

    // The second win annexes two territories, but earns only its actual +1.8
    // squad improvement. The leaderboard shows the cumulative +3.6 instead.
    const secondGain = await acquire(twinId);
    const cumulativeStandings = standingsSnapshot(app);
    const cumulativeGain = roundedGain(teamEff(app.state.teams[challengerId]), teams[challengerId].baseEff);
    const gainAfterTwo = cumulativeStandings.gains[0];
    const twoTerritories = app.state.match.territoriesGained === 2;

    // A weaker new player does not enter the best legal lineup.
    const lowPlayerGain = await acquire(largeId);
    const zeroStandings = standingsSnapshot(app);
    const sixTerritories = app.state.match.territoriesGained === 6;
    const noTerritoryBonus = cumulativeGain === roundedGain(teamEff(app.state.teams[challengerId]), teams[challengerId].baseEff)
      && gainAfterTwo === zeroStandings.gains[0];
    const persisted = ownershipSnapshot(app);
    mounted.unmount();
    resumed = mount();
    await until('strength fixture save offered', () => text().includes('Launch campaign') && resumed.app.state.hasSave);
    button('Resume', document.querySelector('.setup-save')).click();
    await until('strength fixture resumed', () => resumed.app.state.phase === 'playing');
    const restoredStandings = standingsSnapshot(resumed.app);
    return {
      world, fixture, weakerEmpireBelow, alphabeticalTie, stableIdTie, acquired,
      rerankedAfterAcquisition: before[0].tid === strongId && after[0].tid === challengerId
        && Number(after[0].eff) > Number(before.find(row => row.tid === challengerId).eff),
      eliminatedRemoved,
      after: firstStandings,
      firstGain, secondGain, lowPlayerGain, noDoubleApply, twoTerritories, sixTerritories, noTerritoryBonus,
      cumulativeCorrect: cumulativeStandings.gainsCorrect && cumulativeGain === 3.6 && gainAfterTwo === '+3.6',
      zeroDoesNotAddGain: zeroStandings.gainsCorrect && noTerritoryBonus,
      gainedStrengthRestored: ownershipSnapshot(resumed.app).strengthGains === persisted.strengthGains
        && restoredStandings.gainsCorrect && JSON.stringify(restoredStandings.gains) === JSON.stringify(zeroStandings.gains),
    };
  } finally {
    mounted.unmount();
    resumed?.unmount();
  }
}

/** A late animation frame must not resurrect a spinner cleared by startMatch. */
export async function runDuelFrameRace() {
  const mounted = mount();
  const realFrame = globalThis.requestAnimationFrame;
  const realCancelFrame = globalThis.cancelAnimationFrame;
  const pendingFrames = [];
  let frameId = 0;
  try {
    await launch(mounted, { scope: 'CONMEBOL', pacing: 'duel', resolution: 'ticker', seed: 20260910 });
    globalThis.requestAnimationFrame = callback => { pendingFrames.push(callback); return ++frameId; };
    globalThis.cancelAnimationFrame = () => {};
    mounted.app.beginDuel();
    await until('regression spinner committed', () => !!mounted.app.state.spin);
    pendingFrames.shift()(0); // The first frame schedules the second frame.
    const delayedFrame = pendingFrames.shift();
    const attacker = mounted.app.state.spin.tid;
    const defender = mounted.app.state.aliveIds.find(id => id !== attacker);
    // Capture the second frame before cancellation invalidates the first one.
    // Invoke it even after cancellation to model an already-delivered callback.
    mounted.app.clearTimers();
    // React has not committed startMatch's spin:null when the old frame runs.
    // An object update based on this.state will restore the obsolete spinner.
    unstable_batchedUpdates(() => {
      mounted.app.startMatch(attacker, defender);
      delayedFrame(0);
    });
    await until('regression match committed', () => !!mounted.app.state.match);
    return { spinnerCleared: mounted.app.state.spin === null, matchStarted: !!mounted.app.state.match };
  } finally {
    globalThis.requestAnimationFrame = realFrame;
    globalThis.cancelAnimationFrame = realCancelFrame;
    mounted.unmount();
  }
}

/** An England checkpoint as an earlier visit would have left it in storage. */
async function storeEnglandCampaign(campaignId) {
  const reference = await loadReference('826'), sport = getSport('football');
  const teams = Object.fromEntries(reference.clubs.map(club => [club.id, buildClub(club, sport)]));
  const own = { ...reference.startOwners };
  const settings = { sport: 'football', layer: 'clubs', scope: 'UEFA', clubScope: reference.scope, domesticVersion: reference.meta.version,
    pacing: 'duel', resolution: 'instant', preset: 'custom', role: 'spectator', managedTeamId: '' };
  const campaign = { phase: 'playing', settings, initialSettings: settings, teams, own, aliveIds: Object.keys(teams), stats: {}, fallen: [],
    round: 0, matches: 0, queue: [], log: [], history: [], seed: 5, rngState: 5, campaignId, revision: 0,
    campaignName: `Football · ${reference.label}` };
  const saved = writeSave(campaign);
  if (!saved.ok) throw new Error(`could not store the England campaign: ${saved.message}`);
  return { reference, campaign: { ...campaign, revision: saved.revision } };
}

const dialogText = () => document.querySelector('[aria-labelledby="campaign-storage-title"]')?.textContent || '';

/**
 * A country restore waits for its map. Clear quick resume, Close, Escape and
 * Cancel import must each stop it, and the dialog says it is loading meanwhile.
 * A saved campaign can be deleted from Saved campaigns.
 */
export async function runRestoreRaceCheck() {
  const plan = globalThis.__smokeFetch, file = 'domestic/826.json';
  const { reference, campaign: england } = await storeEnglandCampaign('smoke-england');
  const mounted = mount();
  const app = () => mounted.app;
  const slow = () => { clearDomesticCache('826'); plan.delays[file] = 400; };
  const result = {};
  try {
    await until('setup with a saved England campaign', () => text().includes('Launch campaign') && app().state.hasSave);
    // Resume, then Clear quick resume while the map loads.
    slow();
    button('Resume', document.querySelector('.setup-save')).click();
    result.setupLoading = await waitFor(() => saveStatusText().includes('Loading the map of England'), 2000)
      && !!buttonNamed('Resume')?.disabled;
    button('Clear quick resume').click();
    await until('discard confirmation', () => !!document.querySelector('.setup-confirmation'));
    button('Clear quick resume', document.querySelector('.setup-confirmation')).click();
    await sleep(900);
    result.discardStops = app().state.phase === 'setup' && !app().state.hasSave && localStorage.getItem(SAVE_KEY) === null
      && !saveStatusText().includes('Loading the map');

    // A world campaign is playing; importing England is cancelled while its map loads.
    button('Launch campaign').click();
    await until('world campaign running', () => app().state.phase === 'playing');
    const world = { id: app().state.campaignId, name: app().state.campaignName };
    const slots = listCampaigns().length;
    await app().importProgress(new File([exportCampaign(england)], 'england.json', { type: 'application/json' }));
    await until('import preview', () => dialogText().includes('Preview imported campaign'));
    slow();
    button('Import as new campaign').click();
    result.dialogLoading = await waitFor(() => dialogText().includes('Loading the map of England')
      && !!buttonNamed('Loading the map…')?.disabled, 2000);
    button('Cancel import').click();
    await sleep(900);
    const unchanged = () => app().state.campaignId === world.id && app().state.campaignName === world.name
      && app().state.settings.layer === 'nations' && !app().state.storageDialog && !app().state.restoring;
    result.cancelImportStops = unchanged() && listCampaigns().length === slots;

    // Resume the England slot from Saved campaigns, then Escape.
    app().openStorageDialog('slots');
    await until('saved campaigns', () => dialogText().includes('Saved campaigns'));
    slow();
    button(`Resume ${england.campaignName}`).click();
    result.slotLoading = await waitFor(() => dialogText().includes('Loading the map of England'), 2000)
      && !!buttonNamed(`Resume ${england.campaignName}`)?.disabled;
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await sleep(900);
    result.escapeStops = unchanged();
    delete plan.delays[file];

    // Delete: the campaign in play offers none; another asks first, then goes.
    app().openStorageDialog('slots');
    await until('saved campaigns again', () => dialogText().includes('Saved campaigns'));
    result.liveNotDeletable = !buttonNamed(`Delete ${world.name}`) && dialogText().includes('This campaign is open');
    button(`Delete ${england.campaignName}`).click();
    await until('delete confirmation', () => !!buttonNamed('Delete permanently'));
    const asked =dialogText().includes(`Delete ${england.campaignName}? `) && listCampaigns().some(item => item.id === england.campaignId);
    button('Delete permanently').click();
    await sleep(50);
    result.deleted = asked && !listCampaigns().some(item => item.id === england.campaignId)
      && localStorage.getItem(campaignStorageKey(england.campaignId)) === null && dialogText().includes('Campaign deleted');
    document.querySelector('button[aria-label="Close saved campaigns"]').click();
    await sleep(30);
    result.stillPlaying = app().state.phase === 'playing' && app().state.campaignId === world.id;

    // The atlas gives Australia and the Ashmore islets one id: Indonesia's backdrop draws Australia once, whole.
    const indonesia = decodeDomestic(await (await fetch('/domestic/360.json')).json(), '360');
    const shapes = app().surroundings(indonesia).shapes, australia = shapes.filter(shape => shape.id === '036');
    result.backdropIds = new Set(shapes.map(shape => shape.id)).size === shapes.length
      && australia.length === 1 && australia[0].rings.length > 1 && australia[0].d.length > 2000;
    return result;
  } finally {
    delete plan.delays[file];
    mounted.unmount();
  }
}

/** An unfinished campaign reloaded through the saved-campaign controls. */
export async function runResumeCheck(scenario = {}) {
  const first = mount();
  let second = null;
  try {
    const { kickoffFlagScope } = await launch(first, scenario);
    const fielded = first.app.state.aliveIds.length;
    const greenlandAtKickoff = first.app.state.own['304'];

    // Identify the actual map independently of whether flags are displayed.
    const svg = document.querySelector('[data-testid="world-map"]');
    const viewBoxAtRest = svg.getAttribute('viewBox');
    document.querySelector('button[aria-label="Zoom in"]').click();
    await sleep(30);
    const viewBoxZoomed = svg.getAttribute('viewBox');
    for (let i = 0; i < 12; i++) {
      document.querySelector('button[aria-label="Zoom out"]').click();
      await sleep(10);
    }
    const viewBoxClamped = svg.getAttribute('viewBox');

    button('Play campaign').click();
    const wholeWorld = (scenario.layer || 'nations') === 'nations' && (scenario.scope || 'world') === 'world';
    await until('campaign progressed before reload', () => wholeWorld
      ? first.app.state.round >= 3 && first.app.state.matches >= 40
      : first.app.state.matches >= 2, 180000);
    button('Pause').click();
    await until('paused match frozen', () => !first.app.state.autoplay && first.app.state.paused);
    const before = ownershipSnapshot(first.app);
    const standingsBefore = standingsSnapshot(first.app);
    const labelsBefore = empireLabelsSnapshot(first.app);
    const flagScopeBefore = regionalFlagsSnapshot(first.app);
    first.unmount();

    // A fresh component tree sees the same localStorage, just like a reload.
    second = mount();
    await until('setup screen again', () => text().includes('Launch campaign'));
    const savedStrip = document.querySelector('.setup-save');
    const offeredResume = !!second.app.state.hasSave && !!savedStrip && savedStrip.textContent.includes('Continue your campaign');
    let domesticSaved = null;
    const reference = domesticReference?.scope === scenario.clubScope ? domesticReference : null;
    if (reference) {
      // The quick-resume strip and the saved-campaign list both name the country.
      const savedText = savedStrip?.textContent || '';
      button('Saved campaigns').click();
      await until('saved campaigns dialog', () => !!document.querySelector('[aria-labelledby="campaign-storage-title"]'));
      const listed = [...document.querySelectorAll('.campaign-storage-preview')].map(preview => preview.textContent);
      document.querySelector('button[aria-label="Close saved campaigns"]').click();
      await until('saved campaigns dialog closed', () => !document.querySelector('[aria-labelledby="campaign-storage-title"]'));
      domesticSaved = { stripNamesCountry: savedText.includes(reference.label), dialogNamesCountry: listed.some(item => item.includes(reference.label)) };
    }
    let domesticRestore = null, savedBefore = null;
    const mapFile = reference && `domestic/${reference.id}.json`, plan = globalThis.__smokeFetch;
    if (reference) {
      savedBefore = JSON.parse(JSON.stringify(second.app.saved));
      domesticRestore = await refusedCountryRestores(second.app, reference);
      // A cold cache: the resume itself must fetch the map and say it is waiting.
      clearDomesticCache(reference.id);
      plan.delays[mapFile] = 150;
      domesticRestore.fetchesBefore = plan.requests.filter(request => request === mapFile).length;
    }
    button('Resume', document.querySelector('.setup-save')).click();
    if (reference) domesticRestore.coldLoading = await waitFor(() => saveStatusText().includes(`Loading the map of ${reference.entry.name}`), 3000);
    await until('resumed', () => second.app.state.phase === 'playing');
    if (reference) {
      delete plan.delays[mapFile];
      domesticRestore.coldFetched = plan.requests.filter(request => request === mapFile).length > domesticRestore.fetchesBefore;
    }
    const after = ownershipSnapshot(second.app);
    const standingsAfter = standingsSnapshot(second.app);
    const labelsAfter = empireLabelsSnapshot(second.app);
    after.ownedByFirstAlive = Object.values(second.app.state.own).filter(owner => owner === before.firstAlive).length;
    const restoredMap = countryPaths().filter(path => path.dataset.owner).every(path => path.dataset.owner === second.app.state.own[path.dataset.country]);
    const restoredFlags = expectedFlagsShown(second.app);
    const flagScopeAfter = regionalFlagsSnapshot(second.app);
    const domesticResumed = reference ? domesticCampaignSnapshot(second.app, reference) : null;

    second.app.rng = makeRng((scenario.seed || 20260910) + 1);
    await setState(second.app, { speed: SPEED });
    button(second.app.state.match && !second.app.state.match.applied ? 'Finish match' : 'Next match').click();
    await until('resumed campaign finishes another match', () => second.app.state.matches > after.matches, 60000);
    const flagScopeAfterMatch = regionalFlagsSnapshot(second.app);
    const standingsAfterMatch = standingsSnapshot(second.app);
    const labelsAfterMatch = empireLabelsSnapshot(second.app);
    let finished = null;
    if (scenario.finish) {
      // Play the reloaded campaign out: the restored map must carry it to a champion.
      button('Play campaign').click();
      await until('resumed campaign reaches a champion', () => second.app.state.phase === 'victory', Math.max(120000, fielded * 3000));
      const state = second.app.state, championId = state.aliveIds[0];
      finished = {
        alive: state.aliveIds.length, matches: state.matches, fallen: state.fallen.length,
        championHoldsAll: Object.keys(state.own).length === Object.keys(JSON.parse(before.ownership)).length
          && Object.values(state.own).every(owner => owner === championId),
        mapShowsChampion: countryPaths().every(path => path.dataset.owner === championId),
      };
    }
    const playableAfterResume = second.app.state.matches > after.matches;
    // Last, as it replaces the campaign on screen with an older copy.
    if (reference) domesticRestore.updatedMap = await restoreOnUpdatedMap(second.app, reference, savedBefore);
    return {
      fielded, offeredResume, before, after, restoredMap, restoredFlags, domesticSaved, domesticResumed, domesticRestore, finished,
      kickoffFlagScope, flagScopeBefore, flagScopeAfter, flagScopeAfterMatch,
      standingsBefore, standingsAfter, standingsAfterMatch,
      labelsBefore, labelsAfter, labelsAfterMatch,
      playableAfterResume,
      greenlandStartsDanish: greenlandAtKickoff === '208',
      greenlandAlwaysHeld: !!greenlandAtKickoff,
      viewBoxAtRest, viewBoxZoomed, viewBoxClamped,
    };
  } finally {
    first.unmount();
    second?.unmount();
  }
}

export async function run(scenario) {
  const { layer = 'nations' } = scenario;
  const seen = new Set();
  const mounted = mount();
  let sampler;
  try {
    const { setupFlags, kickoffFlags, kickoffFlagScope, theatre, domesticSetup, domesticKickoff } = await launch(mounted, scenario);
    const app = mounted.app;
    const reference = domesticOf(app);
    const initialSquads = Object.fromEntries(Object.entries(app.state.teams).map(([id, team]) => [id, team.squad.length]));
    const domesticPointer = reference ? await domesticPointerSnapshot(app, reference) : null;
    // At normal speed there is an 80ms opening callback: pausing before it
    // fires must cancel its effect, including a duel's otherwise visible spin.
    await setState(app, { speed: 1 });
    button('Play campaign').click();
    await until('autoplay enabled for rapid pause check', () => app.state.autoplay);
    button('Pause').click();
    await until('autoplay paused immediately', () => !app.state.autoplay);
    await sleep(120);
    const rapidPauseHeld = app.state.round === 0 && app.state.matches === 0 && !app.state.spin && !app.state.match;
    await setState(app, { speed: SPEED });
    const nations = app.geo.countries.length;
    const fielded = app.state.aliveIds.length;
    const standingsAtKickoff = standingsSnapshot(app);
    let standingsStayedSorted = standingsAtKickoff.sorted;
    let standingsRanksStayedSequential = standingsAtKickoff.ranks;
    let standingsGainsStayedCorrect = standingsAtKickoff.gainsCorrect;
    const labelsAtKickoff = empireLabelsSnapshot(app);
    let labelsStayedValid = true;
    const labelFailures = [];
    let standingsSamples = 0;
    let sampledMatches = -1;
    let groupsStayedWhole = !reference || wholeGroups(app.state.own, reference);
    let legendStayedRight = !reference || legendFits(app, reference);
    // Flags are the default; exercise Political explicitly before sampling its
    // unchanged colour/conquest guarantees throughout a complete campaign.
    button('Political').click();
    await until('political map selected', () => app.state.mapMode === 'political');
    const initialHeld = countryPaths().filter(path => path.dataset.owner);
    const kickoffColors = Object.fromEntries(initialHeld.map(path => [path.dataset.owner, path.getAttribute('fill')]));
    const politicalAtStart = app.state.mapMode === 'political'
      && initialHeld.length === Object.keys(app.state.own).length
      && initialHeld.every(path => path.dataset.owner === app.state.own[path.dataset.country] && !path.getAttribute('fill').startsWith('url('))
      && !document.querySelector('pattern[id^="fi-flag-"]');

    // Sample actual rendered cards as the real simulation runs.
    let lastProgress = Date.now();
    sampler = setInterval(() => {
      if (app.state.matches !== sampledMatches) {
        sampledMatches = app.state.matches;
        const standings = standingsSnapshot(app);
        standingsStayedSorted &&= standings.sorted;
        standingsRanksStayedSequential &&= standings.ranks;
        standingsGainsStayedCorrect &&= standings.gainsCorrect;
        const labels = empireLabelsSnapshot(app);
        const failed = ['onePerOwner', 'onlyCurrentOwners', 'correctText', 'currentMetadata', 'fontSizes',
          'withinViewport', 'textPathsValid', 'gentleArches', 'coastalPolicyValid', 'uiPolicyEnabled']
          .filter(key => !labels[key]);
        if (failed.length) labelFailures.push({ matches: app.state.matches, failed, coastal: labels.coastalPolicyFailures,
          ids: labels.ids, alive: app.state.aliveIds });
        labelsStayedValid &&= failed.length === 0;
        if (reference) {
          groupsStayedWhole &&= wholeGroups(app.state.own, reference);
          legendStayedRight &&= legendFits(app, reference);
        }
        standingsSamples++;
      }
      if (document.querySelector('[data-testid="match-card"]')) seen.add('match-card');
      if (document.querySelector('.fi-match-result')) seen.add('result-consequences');
      if (document.querySelector('.fi-match-events')) seen.add('match-events');
      if (app.state.spin) seen.add('spinner');
      if (app.state.atk) seen.add('attack-vector');
      if (Date.now() - lastProgress >= 10000) {
        lastProgress = Date.now();
        console.log(`    progress: ${JSON.stringify({ phase: app.state.phase, round: app.state.round, matches: app.state.matches, alive: app.state.aliveIds.length, autoplay: app.state.autoplay, speed: app.state.speed, spin: !!app.state.spin, match: app.state.match && { applied: app.state.match.applied, status: app.state.match.status }, timers: app.timers.size })}`);
      }
    }, 10);
    // Resolve one real match in flag mode before the full political campaign.
    // Fallen nations must keep their conqueror's flag, not turn neutral simply
    // because their original team has left aliveIds.
    button('Flags').click();
    await until('flags selected for conquest check', () => app.state.mapMode === 'flags');
    // End the isolated rapid-pause check before testing manual stepping.
    app.clock.resume();
    await setState(app, { paused: false });
    button('Next match').click();
    await until('first conquest settled', () => app.state.matches >= 1 && app.state.match?.applied);
    const firstConquestFlagScope = regionalFlagsSnapshot(app);
    button('Political').click();
    await until('political campaign restored', () => app.state.mapMode === 'political');
    button('Play campaign').click();
    await until('a champion', () => app.state.phase === 'victory', Math.max(120000, fielded * 3000));
    clearInterval(sampler);
    const champion = app.state.teams[app.state.aliveIds[0]];
    const owned = Object.values(app.state.own).filter(owner => owner === champion.id).length;
    const victoryDialog = document.querySelector('[role="dialog"][aria-labelledby="victory-title"]');
    const victoryScreen = !!victoryDialog && victoryDialog.textContent.includes('Campaign complete')
      && document.getElementById('victory-title').textContent === champion.name.toUpperCase();
    const startOf = new Map(reference ? reference.clubs.map(club => [club.id, club.startSections]) : []);
    const domestic = reference && {
      id: reference.id, name: reference.entry.name, sections: reference.sectionIds.size, clubs: reference.clubs.length, label: reference.label,
      victoryNamesCountry: victoryDialog.textContent.includes(reference.entry.name),
      // Conquest summaries name sections, never raw ids.
      resultsNameSections: app.state.history.length === app.state.matches && app.state.history.every(entry =>
        (entry.result?.territoryIds || []).length > 0 && entry.result.territoryIds.every((id, i) => entry.result.territoryNames[i] === reference.sectionNames[id])),
      groupsStayedWhole, legendStayedRight,
      // The first conquest takes exactly the loser's starting group, and the result counts all of it.
      firstConquestTakesGroup: (() => {
        const first = app.state.history[0]?.result, taken = startOf.get(first?.loserId) || [];
        return !!first && first.territories === taken.length && JSON.stringify([...first.territoryIds].sort()) === JSON.stringify([...taken].sort());
      })(),
    };
    await setState(app, { mapMode: 'flags' });
    const victoryFlagScope = regionalFlagsSnapshot(app);
    button('View map', victoryDialog).click();
    await until('victory dialog closes to map', () => !document.querySelector('[role="dialog"][aria-labelledby="victory-title"]'));

    const result = app.state.match;
    const resultElement = document.querySelector('.fi-match-result');
    const structuredConsequences = result.winnerName === champion.name
      && typeof result.loserName === 'string' && result.loserName.length > 0
      && result.territoriesGained > 0 && !!result.playerTaken?.name
      && result.playerTaken.rating >= 1 && result.playerTaken.rating <= 99
      && resultElement?.textContent.includes(`${result.winnerName} takes ${result.loserName}`)
      && resultElement.textContent.includes(`+${result.territoriesGained} territor`)
      && resultElement.textContent.includes(`${result.playerTaken.name} joins ${result.winnerName}`);
    button('Political').click();
    await until('champion political map selected', () => app.state.mapMode === 'political');
    const politicalConquest = countryPaths().filter(path => path.dataset.owner).every(path =>
      path.dataset.owner === champion.id && path.getAttribute('fill') === kickoffColors[champion.id]);

    // Return to Flags: only owned territory receives the current owner's flag.
    button('Flags').click();
    await until('flag map selected', () => app.state.mapMode === 'flags');
    const heldPaths = countryPaths().filter(path => path.dataset.owner);
    const patterns = [...new Set(countryFlagParts().map(flagPattern).filter(Boolean))];
    const championFlag = patterns.filter(pattern => flagAssetsMatch(pattern, FLAG_CODES[champion.flagId]));
    const flagFills = heldPaths.filter(path => countryFlagParts(path.dataset.country).length > 0).length;
    const paintableTerritories = heldPaths.filter(path => filledRings(path.getAttribute('d')).length > 0).length;
    const uniqueHeldPatterns = new Set(patterns.map(pattern => pattern.id)).size;
    const finalFlags = expectedFlagsShown(app);
    const finalFlagScope = regionalFlagsSnapshot(app);
    const championFill = heldPaths.filter(path => path.getAttribute('fill') === champion.col).length;
    const championConquests = app.state.stats[champion.id].conq;
    const stealsAllTeams = Object.values(app.state.stats).reduce((n, stats) => n + stats.steals.length, 0);
    const conquestsAllTeams = Object.values(app.state.stats).reduce((n, stats) => n + stats.conq, 0);

    // Select through the map, then exercise every actual sidebar tab and panel.
    heldPaths[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await until('map opens the champion squad', () => app.state.selected === champion.id && app.state.tab === 'squad');
    const tabs = {};
    for (const [tab, label] of [['feed', 'Activity'], ['power', 'Standings'], ['squad', 'Squad']]) {
      button(label).click();
      await until(`${label} panel`, () => document.querySelector(`#intel-tab-${tab}[aria-selected="true"]`) && document.getElementById(`intel-panel-${tab}`));
      tabs[tab] = document.getElementById(`intel-panel-${tab}`).textContent.length;
    }

    return {
      nations, fielded, layer, rapidPauseHeld, setupFlags, kickoffFlags, politicalAtStart, politicalConquest, structuredConsequences, finalFlags,
      theatre, domesticSetup, domesticKickoff, domesticPointer, domestic, championInitialSquad: initialSquads[champion.id],
      kickoffFlagScope, firstConquestFlagScope, victoryFlagScope, finalFlagScope,
      standingsAtKickoff, standingsStayedSorted, standingsRanksStayedSequential, standingsGainsStayedCorrect, standingsSamples,
      labelsAtKickoff, labelsStayedValid, labelFailures, labelsAtFinish: empireLabelsSnapshot(app),
      rounds: app.state.round,
      matches: app.state.matches,
      fallen: app.state.fallen.length,
      champion: champion.name,
      championSquad: champion.squad.length,
      squadSize: app.sport().squadSize,
      championConquests,
      stolenPlayers: champion.squad.filter(player => player.from).length,
      stealsAllTeams, conquestsAllTeams,
      territoriesHeld: owned,
      totalTerritories: Object.keys(app.state.own).length,
      flagPatterns: patterns.length,
      uniqueHeldPatterns,
      championFill, flagFills, paintableTerritories,
      patternsFlyingChampionFlag: championFlag.length,
      logEntries: app.state.log.length,
      victoryScreen,
      campaignIdle: app.state.spin === null && app.timers.size === 0,
      saveWritten: !!localStorage.getItem('football_imperialism_v1'),
      seen: [...seen].sort(),
      tabs,
    };
  } finally {
    clearInterval(sampler);
    mounted.unmount();
  }
}
