// Owner: WP-0 (see PLAN.md §5.2; WP-INT in W3). Static contracts between work packages, read from the source with
// Babel (no execution) plus a runtime check of the FROZEN pure-module exports: App delegates, free identifiers,
// component timers, RNG access, export names and forms, and `import React` in every .jsx file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { ROOT } from './lib/app-harness.mjs';

const require = createRequire(import.meta.url);
const { parse } = require('@babel/parser');
const traverse = require('@babel/traverse').default;

const SRC = path.join(ROOT, 'src');
const rel = file => path.relative(ROOT, file).split(path.sep).join('/');
const abs = file => path.join(ROOT, ...file.split('/'));

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}
const SOURCES = walk(SRC).filter(file => /\.(m?js|jsx)$/.test(file));
const under = (...dirs) => SOURCES.filter(file => dirs.some(dir => rel(file).startsWith(`src/${dir}/`)));

const asts = new Map();
function ast(file) {
  if (!asts.has(file)) {
    asts.set(file, parse(readFileSync(file, 'utf8'), { sourceType: 'module', sourceFilename: rel(file),
      plugins: ['jsx', 'classProperties', 'classPrivateProperties', 'optionalChaining', 'nullishCoalescingOperator'] }));
  }
  return asts.get(file);
}

// ---------- (1) App delegates target exported functions of their method module ----------

/** PLAN §3.3 / §4.10: every delegate App keeps, by method module. */
const DELEGATES = {
  mapM: ['handleMapMove', 'mapFlags', 'mapCountries', 'mapLabels', 'mapHomes', 'tooltip', 'viewConquest', 'mapMeId',
    'mapOpponentId', 'mapOwnership', 'mapAttack', 'mapSpin', 'mapConquestIds', 'mapInitialFocus', 'mapNearFocus', 'mapProps'],
  colM: ['idleText', 'columnModel', 'mapOverlaysModel', 'tickerModel'],
  matchM: ['presentMatch', 'revealAll', 'matchCard', 'matchLiveModel', 'rescheduleForSpeed', 'startMinuteClock', 'stopMinuteClock',
    'liveMatchModel'],
  squadM: ['squadModel'],
  conqM: ['finishMatch', 'applyConquest', 'renderPopup', 'conquestPreview', 'conquestModel', 'eliminationModel', 'conquestAnchors',
    'conquestFocus'],
  turnM: ['beginDuel', 'animateDuel', 'lockDuel', 'selectCountry', 'launchRules', 'playerTargets', 'beginTurn', 'openTargetChoice',
    'selectTarget', 'confirmTarget', 'hoverTarget', 'turnStripModel', 'reachModel', 'targetPanelModel', 'spectatorPanelModel',
    'targetAnchors'],
  ledgerM: ['powerTable', 'victoryPanel', 'ledgerModel', 'chronicleModel', 'matchPreviewModel'],
};
/** Retired in W3 (PLAN §1.5, §4.12): App no longer carries these members. */
const RETIRED_APP_MEMBERS = ['warStage', 'legend', 'squadPanel'];
const MODULE_FILES = { mapM: 'src/app/mapMethods.jsx', colM: 'src/app/columnMethods.jsx', matchM: 'src/app/matchMethods.jsx',
  squadM: 'src/app/squadMethods.jsx', conqM: 'src/app/conquestMethods.jsx', turnM: 'src/app/turnMethods.jsx',
  ledgerM: 'src/app/ledgerMethods.jsx' };

/** Top-level exports of a module: `{ def: { kind, name } | null, named: Map(name → declaration type) }`. */
function exportsOf(file) {
  const named = new Map();
  let def = null;
  for (const node of ast(file).program.body) {
    if (node.type === 'ExportDefaultDeclaration') {
      const declaration = node.declaration;
      def = { kind: declaration.type, name: declaration.id?.name ?? (declaration.type === 'Identifier' ? declaration.name : null) };
    } else if (node.type === 'ExportNamedDeclaration') {
      const declaration = node.declaration;
      if (declaration?.type === 'VariableDeclaration') {
        for (const item of declaration.declarations) named.set(item.id.name, item.init?.type ?? 'VariableDeclarator');
      } else if (declaration) named.set(declaration.id.name, declaration.type);
      for (const specifier of node.specifiers) {
        const exported = specifier.exported.name ?? specifier.exported.value;
        const kind = node.source ? `re-export:${node.source.value}` : 'specifier';
        if (exported === 'default') def = { kind, name: specifier.local.name };
        else named.set(exported, kind);
      }
    } else if (node.type === 'ExportAllDeclaration') named.set(`*${node.source.value}`, 'export-all');
  }
  return { def, named };
}

function appNamespaces() {
  const spaces = new Map();
  for (const node of ast(abs('src/App.jsx')).program.body) {
    if (node.type !== 'ImportDeclaration') continue;
    for (const specifier of node.specifiers) {
      if (specifier.type === 'ImportNamespaceSpecifier') spaces.set(specifier.local.name, rel(path.resolve(SRC, node.source.value)));
    }
  }
  return spaces;
}

test('App imports each method module as a namespace (§0.7)', () => {
  const spaces = appNamespaces();
  for (const [name, file] of Object.entries(MODULE_FILES)) assert.equal(spaces.get(name), file, `import * as ${name} from './${file.slice(4)}'`);
});

test('every namespace member App uses is exported, and every delegate call targets an exported function declaration with this', () => {
  const spaces = appNamespaces();
  const problems = [];
  let calls = 0;
  traverse(ast(abs('src/App.jsx')), {
    MemberExpression(member) {
      const { object, property, computed } = member.node;
      if (object.type !== 'Identifier' || !spaces.has(object.name) || computed) return;
      const file = spaces.get(object.name);
      const kind = exportsOf(abs(file)).named.get(property.name);
      if (!kind) { problems.push(`${object.name}.${property.name}: not exported by ${file}`); return; }
      const parent = member.parentPath;
      const invoke = parent.isMemberExpression() && !parent.node.computed && ['apply', 'call'].includes(parent.node.property.name)
        && parent.parentPath.isCallExpression() && parent.parentPath.node.callee === parent.node ? parent.parentPath.node : null;
      if (!invoke) return;
      calls++;
      if (kind !== 'FunctionDeclaration') problems.push(`${object.name}.${property.name}: ${kind}, expected a function declaration (this-bound)`);
      if (invoke.arguments[0]?.type !== 'ThisExpression') problems.push(`${object.name}.${property.name}.${parent.node.property.name}: first argument is not this`);
    },
  });
  assert.deepEqual(problems, []);
  assert.ok(calls >= Object.values(DELEGATES).flat().length, `found ${calls} delegate calls`);
});

test('every §3.3 delegate is a one-line App member that forwards to its owner module', () => {
  const members = new Map();
  traverse(ast(abs('src/App.jsx')), {
    ClassDeclaration(cls) {
      if (cls.node.id?.name !== 'App') return;
      for (const member of cls.node.body.body) if (member.key?.name) members.set(member.key.name, member);
    },
  });
  const problems = [];
  for (const [space, names] of Object.entries(DELEGATES)) {
    for (const name of names) {
      const member = members.get(name);
      if (!member) { problems.push(`${name}: missing on App`); continue; }
      const fn = member.type === 'ClassMethod' ? member : member.value;
      const body = fn?.body?.type === 'BlockStatement' ? fn.body.body : fn?.body ? [{ type: 'ReturnStatement', argument: fn.body }] : [];
      const call = body.length === 1 && body[0].type === 'ReturnStatement' ? body[0].argument : null;
      const target = call?.type === 'CallExpression' && call.callee.type === 'MemberExpression' ? call.callee.object : null;
      if (!(target?.type === 'MemberExpression' && target.object.name === space && target.property.name === name
        && ['apply', 'call'].includes(call.callee.property.name))) problems.push(`${name}: expected \`return ${space}.${name}.apply(this, args)\``);
    }
  }
  assert.deepEqual(problems, []);
});

test('retired App members and legacy imports stay gone (PLAN §1.5, §4.12)', () => {
  const members = new Set();
  traverse(ast(abs('src/App.jsx')), {
    ClassDeclaration(cls) {
      if (cls.node.id?.name === 'App') for (const member of cls.node.body.body) if (member.key?.name) members.add(member.key.name);
    },
  });
  assert.deepEqual(RETIRED_APP_MEMBERS.filter(name => members.has(name)), [], 'dead App members are deleted');
  assert.ok(!readFileSync(abs('src/App.jsx'), 'utf8').includes('mobileView'), 'mobileView / data-mobile-view are retired (DEC D21)');
  const LEGACY = /(^|\/)(Sidebar|AcquisitionChoice)(\.jsx)?$|(^|\/)(results|polish|controls|strategy)\.css$/;
  const imports = SOURCES.flatMap(file => ast(file).program.body
    .filter(node => node.type === 'ImportDeclaration' && LEGACY.test(node.source.value))
    .map(node => `${rel(file)} imports ${node.source.value}`));
  assert.deepEqual(imports, [], 'nothing under src imports the retired Sidebar, AcquisitionChoice or legacy CSS');
});

// ---------- (2) no free identifiers ----------

const GLOBALS = new Set([
  // JavaScript
  'Array', 'ArrayBuffer', 'BigInt', 'Boolean', 'DataView', 'Date', 'Error', 'EvalError', 'Float32Array', 'Float64Array', 'Function',
  'Infinity', 'Int8Array', 'Int16Array', 'Int32Array', 'Intl', 'JSON', 'Map', 'Math', 'NaN', 'Number', 'Object', 'Promise', 'Proxy',
  'RangeError', 'ReferenceError', 'Reflect', 'RegExp', 'Set', 'String', 'Symbol', 'SyntaxError', 'TypeError', 'Uint8Array',
  'Uint8ClampedArray', 'Uint16Array', 'Uint32Array', 'URIError', 'WeakMap', 'WeakRef', 'WeakSet', 'arguments', 'console',
  'decodeURIComponent', 'encodeURIComponent', 'globalThis', 'isFinite', 'isNaN', 'parseFloat', 'parseInt', 'queueMicrotask',
  'structuredClone', 'undefined',
  // browser (render paths are additionally restricted by the purity checks below)
  'Blob', 'CSS', 'CustomEvent', 'DOMParser', 'Element', 'Event', 'File', 'FileReader', 'FocusEvent', 'HTMLElement', 'Image',
  'KeyboardEvent', 'MouseEvent', 'MutationObserver', 'Node', 'PointerEvent', 'ResizeObserver', 'SVGElement', 'TextDecoder',
  'TextEncoder', 'URL', 'URLSearchParams', 'cancelAnimationFrame', 'clearInterval', 'clearTimeout', 'document', 'fetch',
  'getComputedStyle', 'localStorage', 'location', 'matchMedia', 'navigator', 'performance', 'requestAnimationFrame', 'sessionStorage',
  'setInterval', 'setTimeout', 'window',
]);

function freeIdentifiers(file) {
  const free = new Set();
  traverse(ast(file), {
    ReferencedIdentifier(ref) {
      const name = ref.node.name;
      if (ref.isJSXIdentifier() && (/^[a-z]/.test(name) || ref.parentPath.isJSXMemberExpression())) return;
      if (!ref.scope.hasBinding(name) && !GLOBALS.has(name)) free.add(name);
    },
  });
  return [...free];
}

const SCOPED = [abs('src/App.jsx'), ...under('app', 'viewModels', 'screens', 'components', 'hooks')];

test('no free identifiers in App, method modules, view-models, screens, components and hooks', () => {
  const problems = SCOPED.map(file => [rel(file), freeIdentifiers(file)]).filter(([, names]) => names.length);
  assert.deepEqual(Object.fromEntries(problems), {});
});

// ---------- (3) no timers in components, hooks, screens or view-models (§0.10) ----------

const TIMERS = new Set(['setTimeout', 'setInterval', 'setImmediate', 'requestAnimationFrame']);
function timerUses(file) {
  const found = [];
  traverse(ast(file), {
    Identifier(id) {
      if (!TIMERS.has(id.node.name)) return;
      const parent = id.parentPath;
      // Object keys (`{ setTimeout: … }`) are not uses; `window.setTimeout` and bare calls are.
      if (parent.isObjectProperty() && parent.node.key === id.node && !parent.node.computed) return;
      found.push(`${id.node.name}:${id.node.loc.start.line}`);
    },
  });
  return found;
}

test('no setTimeout, setInterval or requestAnimationFrame in components, hooks, screens or view-models', () => {
  const files = under('components', 'hooks', 'screens', 'viewModels');
  assert.ok(files.length > 20);
  const problems = files.map(file => [rel(file), timerUses(file)]).filter(([, uses]) => uses.length);
  assert.deepEqual(Object.fromEntries(problems), {});
});

// ---------- (4) RNG access only where the campaign samples it (§0.11) ----------

function rngUses(file, { thisOnly = false } = {}) {
  const found = [];
  traverse(ast(file), {
    Identifier(id) {
      if (id.node.name !== 'rng') return;
      const parent = id.parentPath;
      const isProperty = parent.isMemberExpression() && parent.node.property === id.node && !parent.node.computed;
      if (thisOnly && !(isProperty && parent.node.object.type === 'ThisExpression')) return;
      found.push(`${isProperty && parent.node.object.type === 'ThisExpression' ? 'this.rng' : 'rng'}:${id.node.loc.start.line}`);
    },
  });
  return found;
}

test('view-models, screens and components never touch an RNG', () => {
  const problems = under('viewModels', 'screens', 'components').map(file => [rel(file), rngUses(file)]).filter(([, uses]) => uses.length);
  assert.deepEqual(Object.fromEntries(problems), {});
});

test('this.rng is used only by App and the WP-TURN draw (turnMethods)', () => {
  const allowed = new Set(['src/App.jsx', 'src/app/turnMethods.jsx']);
  const problems = under('app', 'viewModels', 'screens', 'components', 'hooks')
    .filter(file => !allowed.has(rel(file)))
    .map(file => [rel(file), rngUses(file, { thisOnly: true })]).filter(([, uses]) => uses.length);
  assert.deepEqual(Object.fromEntries(problems), {});
});

test('view-models stay pure: no window, document, matchMedia, storage or setState (§0.9)', () => {
  const banned = new Set(['window', 'document', 'matchMedia', 'localStorage', 'sessionStorage', 'navigator']);
  const problems = {};
  for (const file of under('viewModels')) {
    const found = [];
    traverse(ast(file), {
      ReferencedIdentifier(ref) { if (banned.has(ref.node.name) && !ref.scope.hasBinding(ref.node.name)) found.push(ref.node.name); },
      MemberExpression(member) { if (!member.node.computed && member.node.property.name === 'setState') found.push('setState'); },
    });
    if (found.length) problems[rel(file)] = [...new Set(found)];
  }
  assert.deepEqual(problems, {});
});

// ---------- (5) FROZEN exports (§3.8) and export forms (§1.4) ----------

/** file → { default?: true | 'Name' (a function declaration with that name), named: [...], noDefault?: true } */
const EXPORT_FORMS = {
  // `politicalColor` / `POLITICAL_*` were only required through W2 (PLAN §1.5); W3 may delete them once nothing imports them.
  'src/theme.js': { named: ['C', 'FONT', 'pad3', 'tint', 'ratingColor', 'V4', 'MAP', 'EMPIRE_PASTELS', 'empireFill',
    'RATING_TIERS', 'ratingTierOf', 'ratingTierColor', 'WIN_TONE_COLORS'] },
  'src/viewModels/format.js': { named: ['roman', 'historyRound', 'formatWinChance', 'winTone', 'signedDelta', 'ratingTier', 'territoryWord',
    'shortName', 'routeCopy', 'campaignTitle', 'displayRound', 'teamChip', 'memo'] },
  'src/viewModels/odds.js': { named: ['matchupOdds', 'winChanceFor'] },
  'src/viewModels/masthead.js': { named: ['buildMasthead'] },
  'src/viewModels/campaign.js': { named: ['buildColumn', 'buildFixture', 'buildFronts', 'buildLatestResults', 'buildTicker', 'buildMapOverlays'] },
  'src/viewModels/match.js': { named: ['buildLiveMatch', 'buildFeedRows', 'scorersLine'] },
  'src/viewModels/squad.js': { named: ['buildSquad', 'provenanceOf'] },
  'src/viewModels/conquest.js': { named: ['buildConquestPreview', 'buildConquest', 'buildElimination'] },
  'src/viewModels/turns.js': { named: ['buildTurnStrip', 'buildReach', 'buildTargetPanel', 'buildTargetCard', 'buildSpectatorPanel',
    'targetOptions', 'idleTurnCopy'] },
  'src/viewModels/ledger.js': { named: ['buildLedger', 'buildChronicle'] },
  'src/viewModels/map.js': { named: ['mapOpponentId', 'strengthFills', 'frontsFills', 'tooltipModel', 'nearFocus', 'strengthSteps'] },
  'src/engine/turns.js': { named: ['roundRobinOrder', 'nextTurn', 'reachableTargets', 'routeToTarget', 'createTargetedDraw'] },
  'src/engine/liveMinute.js': { named: ['createMinuteStore'] },
  'src/engine/winProbability.js': { named: ['liveModelFor', 'footballRate', 'footballWinProbability', 'basketballWinProbability',
    'winSeries', 'chartGeometry'] },
  // `domesticIdOf` (domestic campaigns): App, the method modules and the view-models name a country theatre with it.
  'src/app/shared.js': { named: ['DEFAULT_SETUP', 'LOG_CAP', 'FEED_CAP', 'BATTLE_SCARS', 'signed', 'domesticIdOf'] },
  'src/app/mapMethods.jsx': { named: ['DEFAULT_MAP_MODE'] },
  'src/components/LiveMinute.jsx': { default: 'LiveMinute', named: ['useLiveMinute'] },
  'src/components/MatchCard.jsx': { default: true, named: ['TeamMark'] },
  'src/components/TeamMark.jsx': { default: 'TeamMark' },
  'src/components/Flag.jsx': { default: true },
  'src/components/Icon.jsx': { default: true },
  'src/components/PlayerRow.jsx': { default: true },
  'src/components/Popups.jsx': { named: ['Toast', 'MatchupPopup', 'ResultPopup', 'StealPopup'] },
  'src/components/SetupOverlay.jsx': { default: true, named: ['PACING_OPTIONS', 'PACING_HELP', 'RESOLUTION_OPTIONS', 'campaignPreview'] },
  'src/components/CommandBar.jsx': { default: 'CommandBar', named: ['SettingsPanel'] },
  'src/components/PlaybackBar.jsx': { default: true },
  'src/components/CampaignStorageDialog.jsx': { default: 'CampaignStorageDialog' },
  'src/components/PhoneChrome.jsx': { named: ['PhoneBar', 'PhoneTabBar', 'PhoneMoreSheet'], noDefault: true },
  'src/components/WorldMap.jsx': { default: true },
  'src/components/VictoryOverlay.jsx': { default: true },
  'src/components/TacticalChoice.jsx': { default: true },
  'src/components/ManagerElimination.jsx': { default: true },
  'src/components/ExportCheckpoint.jsx': { default: true },
  'src/screens/campaign/CampaignColumn.jsx': { default: true },
  'src/screens/campaign/NextFixture.jsx': { default: true },
  'src/screens/campaign/FrontsTable.jsx': { default: true },
  'src/screens/campaign/LatestResults.jsx': { default: true },
  'src/screens/campaign/Ticker.jsx': { default: true },
  'src/screens/campaign/MapOverlays.jsx': { default: true },
  'src/screens/match/MatchScreen.jsx': { default: true },
  'src/screens/squad/SquadScreen.jsx': { default: true },
  'src/screens/conquest/ConquestScreen.jsx': { default: true },
  'src/screens/conquest/ConquestCallout.jsx': { default: true },
  'src/screens/turns/TurnStrip.jsx': { default: true },
  'src/screens/turns/TargetPanel.jsx': { default: true },
  'src/screens/turns/TargetCard.jsx': { default: true },
  'src/screens/turns/SpectatorPanel.jsx': { default: true },
  'src/screens/ledger/LedgerScreen.jsx': { default: true },
  'src/screens/ledger/ChronicleScreen.jsx': { default: true },
};

test('FROZEN cross-WP exports and the §1.4 export forms exist', () => {
  const problems = [];
  for (const [file, form] of Object.entries(EXPORT_FORMS)) {
    let found;
    try { found = exportsOf(abs(file)); } catch (error) { problems.push(`${file}: ${error.message}`); continue; }
    for (const name of form.named || []) if (!found.named.has(name)) problems.push(`${file}: missing named export ${name}`);
    if (form.default && !found.def) problems.push(`${file}: missing default export`);
    if (typeof form.default === 'string' && found.def && !(found.def.kind === 'FunctionDeclaration' && found.def.name === form.default)) {
      problems.push(`${file}: default export must be \`export default function ${form.default}\` (found ${found.def.kind} ${found.def.name})`);
    }
    if (form.noDefault && found.def) problems.push(`${file}: must not have a default export`);
  }
  assert.deepEqual(problems, []);
});

test('MatchCard re-exports TeamMark from TeamMark.jsx', () => {
  assert.equal(exportsOf(abs('src/components/MatchCard.jsx')).named.get('TeamMark'), 're-export:./TeamMark.jsx');
});

test('every method module export App delegates to is a function declaration', () => {
  const problems = [];
  for (const [space, names] of Object.entries(DELEGATES)) {
    const { named } = exportsOf(abs(MODULE_FILES[space]));
    for (const name of names) if (named.get(name) !== 'FunctionDeclaration') problems.push(`${MODULE_FILES[space]}: ${name} is ${named.get(name) || 'missing'}`);
  }
  assert.deepEqual(problems, []);
});

test('FROZEN pure-module exports are real values at runtime', async () => {
  const functions = {
    'src/viewModels/format.js': EXPORT_FORMS['src/viewModels/format.js'].named,
    'src/viewModels/odds.js': ['matchupOdds', 'winChanceFor'],
    'src/viewModels/masthead.js': ['buildMasthead'],
    'src/viewModels/turns.js': ['idleTurnCopy'],
    'src/viewModels/map.js': ['strengthSteps'],
    'src/viewModels/conquest.js': ['buildConquestPreview'],
    'src/engine/turns.js': EXPORT_FORMS['src/engine/turns.js'].named,
    'src/engine/liveMinute.js': ['createMinuteStore'],
    'src/app/shared.js': ['signed', 'domesticIdOf'],
    'src/theme.js': ['empireFill', 'ratingTierOf', 'ratingTierColor', 'ratingColor', 'tint', 'pad3'],
  };
  for (const [file, names] of Object.entries(functions)) {
    const mod = await import(pathToFileURL(abs(file)).href);
    for (const name of names) assert.equal(typeof mod[name], 'function', `${file} ${name}`);
  }
  const theme = await import(pathToFileURL(abs('src/theme.js')).href);
  for (const name of ['V4', 'MAP', 'EMPIRE_PASTELS', 'RATING_TIERS', 'WIN_TONE_COLORS']) assert.ok(Object.isFrozen(theme[name]), `theme ${name} frozen`);
  const shared = await import(pathToFileURL(abs('src/app/shared.js')).href);
  assert.equal(shared.DEFAULT_SETUP.turnOrder, 'random');
  assert.equal(shared.DEFAULT_SETUP.targeting, 'compass');
  for (const name of ['LOG_CAP', 'FEED_CAP', 'BATTLE_SCARS']) assert.equal(typeof shared[name], 'number', name);
  // A country theatre is football clubs on 'domestic:<id>'; anything else plays on the world map.
  assert.equal(shared.domesticIdOf({ layer: 'clubs', sport: 'football', clubScope: 'domestic:826' }), '826');
  assert.equal(shared.domesticIdOf({ layer: 'nations', sport: 'football', clubScope: 'domestic:826' }), null);
  assert.equal(shared.domesticIdOf({ layer: 'clubs', sport: 'basketball', clubScope: 'domestic:826' }), null);
  assert.equal(shared.domesticIdOf({ layer: 'clubs', sport: 'football', clubScope: 'all' }), null);
  assert.equal(shared.domesticIdOf(null), null);
});

// ---------- (6) JSX runtime (§0.8) ----------

test('every .jsx file under src imports React as its default import', () => {
  const missing = SOURCES.filter(file => file.endsWith('.jsx')).filter(file => !ast(file).program.body.some(node =>
    node.type === 'ImportDeclaration' && node.source.value === 'react'
    && node.specifiers.some(specifier => specifier.type === 'ImportDefaultSpecifier' && specifier.local.name === 'React')));
  assert.deepEqual(missing.map(rel), []);
});

test('EmpireLabels keeps the smoke-instrumented factory import and imports no CSS', () => {
  const source = readFileSync(abs('src/components/EmpireLabels.jsx'), 'utf8');
  assert.ok(source.includes('import { createEmpireLabelEngine }'), 'smoke.mjs instruments this exact import');
  assert.equal(ast(abs('src/components/EmpireLabels.jsx')).program.body.filter(node => node.type === 'ImportDeclaration'
    && /\.css$/.test(node.source.value)).length, 0);
});

test('App renders CommandBar and CampaignStorageDialog as literal elements of its root (findElement contract)', () => {
  const names = [];
  traverse(ast(abs('src/App.jsx')), {
    ClassMethod(method) {
      if (method.node.key.name !== 'render') return;
      method.traverse({
        ReturnStatement(ret) {
          if (ret.getFunctionParent() !== method || ret.node.argument?.type !== 'JSXElement') return;
          for (const child of ret.node.argument.children) {
            const element = child.type === 'JSXElement' ? child
              : child.type === 'JSXExpressionContainer' && child.expression.type === 'LogicalExpression' && child.expression.right.type === 'JSXElement'
                ? child.expression.right : null;
            if (element) names.push(element.openingElement.name.name);
          }
        },
      });
    },
  });
  assert.equal(names[0], 'CommandBar', 'CommandBar is the first root child');
  assert.ok(names.includes('CampaignStorageDialog'));
});

test('WorldMap is an unconditional child of the literal <main> in render (always mounted, DEC D12)', () => {
  let found = 0;
  traverse(ast(abs('src/App.jsx')), {
    ClassMethod(method) {
      if (method.node.key.name !== 'render') return;
      method.traverse({
        JSXElement(element) {
          if (element.node.openingElement.name.name !== 'WorldMap') return;
          const parent = element.parentPath;
          assert.ok(parent.isJSXElement() && parent.node.openingElement.name.name === 'main', 'WorldMap sits directly in <main>, never behind a condition');
          found++;
        },
      });
    },
  });
  assert.equal(found, 1);
});

// ---------- (7) font audit (PLAN §7.1 step 5; DEC misc: Archivo and Archivo Narrow only) ----------

const FONT_AUDIT = /georgia|times new roman|consolas|monospace|font-style:\s*italic|fontStyle:\s*['"]italic|alegreya|(^|[^-])serif/i;

test('font audit: no serif, monospace, italic or Alegreya font usage under src (fonts.css keeps no Alegreya @font-face)', () => {
  const files = walk(SRC).filter(file => /\.(m?js|jsx|css)$/.test(file))
    .filter(file => !rel(file).startsWith('src/data/') && rel(file) !== 'src/fonts.css');
  assert.ok(files.length > 50);
  const hits = files.flatMap(file => readFileSync(file, 'utf8').split(/\r?\n/)
    .map((line, index) => (FONT_AUDIT.test(line) ? `${rel(file)}:${index + 1}: ${line.trim()}` : null)).filter(Boolean));
  assert.deepEqual(hits, []);
  assert.ok(!/alegreya/i.test(readFileSync(abs('src/fonts.css'), 'utf8')), 'src/fonts.css: drop the Alegreya @font-face rules (the files may stay)');
});
