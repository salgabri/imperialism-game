// The map's colours keep bordering empires apart (src/engine/mapPalette.js). The user, 21 November 2026, of two clubs
// around Moscow in all but the same mauve: "never put this close colors next to each other". On every board the map
// can show, at kick-off and as a campaign redraws it, no two bordering empires come within CLOSE of each other in
// Political mode, in either theme, nor within FLAGS_CLOSE in Flags mode; an empire keeps its own colour unless that
// rule needs another, and keeps the colour it started in unless a conquest brings it a look-alike.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { APART, CLOSE, FLAGS_CLOSE, clubRanks, empireNeighbours, empirePalette, ownColour, separate } from '../src/engine/mapPalette.js';
import { WorldGeometry } from '../src/engine/geo.js';
import { decodeDomestic } from '../src/engine/domestic.js';
import { rememberTwins } from '../src/data/crests.js';
import { DEPENDENCIES, NATIONS, makeRng } from '../src/data/teams.js';
import { clubColour } from '../src/data/clubColours.js';
import { politicalFill } from '../src/data/empireColours.js';
import { DARK_TOKENS, V4, darkFill, empireFill, empireFillPair, themedPaint } from '../src/theme.js';
import { toOklch } from '../src/engine/colour.js';

const lab = (colour, lWeight) => {
  const [L, C, H] = toOklch(colour);
  return [L * lWeight, C * Math.cos(H * Math.PI / 180), C * Math.sin(H * Math.PI / 180)];
};
const gap = (a, b, lWeight) => Math.hypot(...lab(a, lWeight).map((v, k) => v - lab(b, lWeight)[k]));
/** Two political fills as the map paints them: light, and the dark theme's twin; the nearer of the two. */
const politicalGap = (a, b) => Math.min(gap(a, b, 0.4), gap(darkFill(a), darkFill(b), 0.4));

/** Bordering empires on board `own` that the palette paints alike: ['a|b political 0.0412', …]. */
function lookAlikes(own, adj, palette) {
  const out = [];
  for (const [a, neighbours] of empireNeighbours(own, adj)) {
    for (const b of neighbours) {
      if (a > b) continue;
      const near = politicalGap(palette.political.get(a), palette.political.get(b));
      if (!(near >= CLOSE)) out.push(`${a}|${b} political ${near.toFixed(4)}`);
      const [fa, fb] = [palette.flags.get(a), palette.flags.get(b)];
      if (fa && fb && !(gap(fa, fb, 1) >= FLAGS_CLOSE)) out.push(`${a}|${b} flags ${gap(fa, fb, 1).toFixed(4)}`);
    }
  }
  return out;
}

/**
 * A shipped country map as the palette reads it: its starting board, borders, land and clubs, each with the twin its
 * map gives it (null for none).
 */
function countryMap(file) {
  const data = JSON.parse(readFileSync(new URL(`../public/domestic/${file}`, import.meta.url), 'utf8'));
  // As engine/domestic.js decodes it, without fitting paths the palette does not read.
  const geo = new WorldGeometry(data.topology, {}, { object: 'sections', projection: data.projection, borderLengths: false });
  const clubs = data.clubs.map(club => ({ ...club, twin: club.twin ?? null }));
  const home = Object.freeze(Object.fromEntries(clubs.flatMap(club => (club.sections || [club.section]).map(section => [section, club.id]))));
  const teams = Object.fromEntries(clubs.map(club => [club.id, { ...club, kind: 'club' }]));
  return { id: data.id, home, adj: geo.adj, areaOf: id => geo.surfaceOf(id).area, ranks: clubRanks(clubs), teams };
}
const paletteOf = (map, own = map.home, managedId = null) =>
  empirePalette({ own, adj: map.adj, home: map.home, areaOf: map.areaOf, ranks: map.ranks, teams: map.teams, managedId });

/** A campaign in miniature: a random empire takes a random neighbour's whole land, `steps` times (or down to two). */
function* conquests(map, seed, steps = Infinity) {
  const rng = makeRng(seed);
  const own = { ...map.home };
  for (let step = 0; step < steps; step++) {
    const neighbours = empireNeighbours(own, map.adj);
    const empires = [...neighbours.keys()].filter(id => neighbours.get(id).size).sort();
    if (empires.length <= 2) return;
    const winner = empires[Math.floor(rng() * empires.length)];
    const near = [...neighbours.get(winner)].sort();
    const loser = near[Math.floor(rng() * near.length)];
    for (const territory of Object.keys(own)) if (own[territory] === loser) own[territory] = winner;
    yield { own: { ...own }, winner, loser };
  }
}

// ---- The choice ----

test('separate: the first to choose keeps its colour, a look-alike neighbour moves, and a fixed choice never moves', () => {
  // Colours on a line, 0–10; nearer than 2 is alike.
  const line = new Map(Object.entries({ a: [3, 4, 9], b: [3, 6, 0], c: [3, 8], d: [4, 3] })
    .map(([id, points]) => [id, points.map(point => ({ point }))]));
  const neighbours = { a: ['b'], b: ['a', 'c'], c: ['b'], d: [] };
  const distance = (p, q) => Math.abs(p.point - q.point);
  const chosen = separate(['a', 'b', 'c', 'd'], id => neighbours[id], id => line.get(id), distance, 2);
  assert.deepEqual(['a', 'b', 'c', 'd'].map(id => chosen.get(id).point), [3, 6, 3, 4],
    'a keeps 3; b moves off it to its next colour; c keeps 3 (it borders b, not a); d borders nobody');
  const fixed = separate(['a', 'b', 'c'], id => neighbours[id], id => line.get(id), distance, 2, new Map([['b', { point: 3 }]]));
  assert.deepEqual(['a', 'b', 'c'].map(id => fixed.get(id).point), [9, 3, 8], 'a fixed b keeps 3: a and c make room');
});

test('a club ringed by neighbours in every colour still finds one: a neighbour moves to free it', () => {
  // Hub h borders five clubs that chose first, in each of the five colours there are; two of them could share one.
  const colours = [0, 2, 4, 6, 8].map(point => ({ point }));
  const ring = ['r0', 'r1', 'r2', 'r3', 'r4'];
  const neighbours = { h: ring, r0: ['h'], r1: ['h'], r2: ['h'], r3: ['h'], r4: ['h'] };
  const choices = id => (id === 'h' ? colours : [...colours.slice(ring.indexOf(id)), ...colours.slice(0, ring.indexOf(id))]);
  const chosen = separate([...ring, 'h'], id => neighbours[id], choices, (p, q) => Math.abs(p.point - q.point), 2);
  for (const id of ring) assert.ok(Math.abs(chosen.get(id).point - chosen.get('h').point) >= 2, `${id} apart from the hub`);
});

test('the stronger of two red clubs keeps red and the weaker moves; a red club the first does not border keeps red', () => {
  const own = { t1: 'x-strong', t2: 'x-middle', t3: 'x-weak' };
  const adj = { t1: new Set(['t2']), t2: new Set(['t1', 't3']), t3: new Set(['t2']) };
  const club = (id, str) => ({ id, str, col: '#d01020', kind: 'club' });
  const teams = { 'x-strong': club('x-strong', 80), 'x-middle': club('x-middle', 70), 'x-weak': club('x-weak', 60) };
  const { political } = empirePalette({ own, adj, ranks: clubRanks(Object.values(teams)), teams });
  const red = id => empireFill(id, '#d01020');
  assert.equal(political.get('x-strong'), red('x-strong'));
  assert.notEqual(political.get('x-middle'), red('x-middle'));
  assert.ok(politicalGap(political.get('x-strong'), political.get('x-middle')) >= CLOSE);
  assert.ok(politicalGap(political.get('x-middle'), political.get('x-weak')) >= CLOSE);
  // Reordered by strength, the other end keeps red instead.
  const flipped = empirePalette({ own, adj, ranks: new Map([['x-weak', 0], ['x-middle', 1], ['x-strong', 2]]), teams }).political;
  assert.equal(flipped.get('x-weak'), red('x-weak'));
});

test('the managed empire keeps clay and its neighbours keep clear of it; its own colour shows where clay does not', () => {
  const own = { t1: 'x-you', t2: 'x-them' };
  const adj = { t1: new Set(['t2']), t2: new Set(['t1']) };
  // A terracotta crest: its own pastel is all but clay.
  const teams = { 'x-you': { id: 'x-you', col: '#2a60c0', kind: 'club' }, 'x-them': { id: 'x-them', col: '#b5654a', kind: 'club' } };
  const free = empirePalette({ own, adj, teams }).political;
  assert.ok(politicalGap(free.get('x-them'), V4.youFill) < CLOSE, 'unmanaged, it would look like clay');
  const managed = empirePalette({ own, adj, teams, managedId: 'x-you' }).political;
  assert.ok(politicalGap(managed.get('x-them'), V4.youFill) >= CLOSE, 'beside your clay it takes another colour');
  assert.equal(managed.get('x-you'), empireFill('x-you', '#2a60c0'), 'yours stays its own pastel, under the clay');
});

test('a club takes its crest colour, an earlier season’s club its twin’s, and a club with none its map colour', () => {
  assert.equal(ownColour('d643-1525').colour, '#cf191e', 'Lokomotiv Moscow’s crest red');
  rememberTwins([{ id: 'f-lokomotiv-moskva', twin: 'd643-1525' }]);
  assert.equal(ownColour('f-lokomotiv-moskva').colour, '#cf191e', 'the crest it wears in an earlier season');
  assert.equal(ownColour('x-none', { col: 'oklch(0.74 0.15 0)' }).colour, 'oklch(0.74 0.15 0)');
  assert.equal(ownColour('x-none').colour, null, 'none: its hash pastel');
  assert.deepEqual(ownColour('643').fits.every(colour => toOklch(colour)), true, 'a nation’s flag colours to fall back on');
});

test('a season club takes its own map’s twin’s colour, never that of a namesake from another country decoded since', () => {
  // A season's `f-<name>` id can name clubs of two countries in other seasons (src/data/crests.js). Peru's León of
  // 1995/96 is León de Huánuco, Mexico's of 2015/16 Club León: a player who opens Mexico's map and comes back gets
  // Peru's from the map loader's cache, not decoded again. Venezuela's Valencia of 1995/96 has no twin on today's map of
  // Venezuela; Spain's of 2014/15 is Valencia CF.
  const decode = id => decodeDomestic(JSON.parse(readFileSync(new URL(`../public/domestic/${id}.json`, import.meta.url), 'utf8')), id);
  const clubOf = (map, id) => map.clubs.find(club => club.id === id);
  // A map's colours at kick-off, as the setup card and the map paint its decoded clubs: each time on a board of its own,
  // as the kick-off is kept per starting board.
  const kickoff = map => empirePalette({ own: { ...map.startOwners }, adj: map.geo.adj, areaOf: id => map.geo.surfaceOf(id).area,
    ranks: clubRanks(map.clubs), teams: Object.fromEntries(map.clubs.map(club => [club.id, club])) }).political;
  const peru = decode('604y1996'), venezuela = decode('862y1996');
  const before = [kickoff(peru), kickoff(venezuela)];
  const mexico = decode('484y2016'), spain = decode('724y2015');
  assert.deepEqual([clubOf(peru, 'f-leon').twin, clubOf(mexico, 'f-leon').twin], ['d604-5290586', 'd484-1259']);
  assert.deepEqual([clubOf(venezuela, 'f-valencia').twin, clubOf(spain, 'f-valencia').twin], [null, 'd724-1775']);
  const leon = clubOf(peru, 'f-leon'), valencia = clubOf(venezuela, 'f-valencia');
  assert.equal(ownColour('f-leon', leon).colour, clubColour('d604-5290586'), 'León de Huánuco’s crest colour, not Club León’s');
  assert.equal(ownColour('f-valencia', valencia).colour, valencia.col, 'its map colour, not Valencia CF’s crest colour');
  assert.deepEqual([kickoff(peru), kickoff(venezuela)], before, 'Peru’s and Venezuela’s colours, whatever maps were decoded since');
});

// ---- Every board ----

test('every shipped country map at kick-off: no two bordering clubs alike, in Political (either theme) or Flags', () => {
  const files = readdirSync(new URL('../public/domestic/', import.meta.url)).filter(name => name.endsWith('.json')).sort();
  assert.ok(files.length > 2000);
  const alike = [];
  let clubs = 0, own = 0;
  for (const file of files) {
    const map = countryMap(file);
    const palette = paletteOf(map);
    alike.push(...lookAlikes(map.home, map.adj, palette).map(pair => `${file} ${pair}`));
    for (const [id, team] of Object.entries(map.teams)) {
      clubs++;
      const { colour, step } = ownColour(id, team);
      if (palette.political.get(id) === (colour ? empireFill(id, colour, step) : empireFill(id))) own++;
    }
  }
  assert.deepEqual(alike, []);
  assert.ok(own / clubs > 0.6, `most clubs keep their own colour (${own} of ${clubs})`);
});

test('the clubs people know keep their own colours at kick-off', () => {
  const england = countryMap('826.json'), spain = countryMap('724.json'), russia = countryMap('643.json');
  const keeps = (map, id) => {
    const { colour, step } = ownColour(id, map.teams[id]);
    assert.equal(paletteOf(map).political.get(id), empireFill(id, colour, step), `${map.teams[id].name} keeps its colour`);
  };
  for (const name of ['Liverpool', 'Arsenal', 'Chelsea', 'Manchester United', 'Manchester City']) {
    keeps(england, Object.values(england.teams).find(team => team.name === name).id);
  }
  for (const name of ['FC Barcelona', 'Real Madrid', 'Atlético de Madrid']) keeps(spain, Object.values(spain.teams).find(team => team.name === name).id);
  for (const name of ['CSKA Moscow', 'Spartak Moscow', 'Lokomotiv Moscow', 'Dinamo Moscow']) {
    keeps(russia, Object.values(russia.teams).find(team => team.name === name).id);
  }
});

test('the world map at kick-off paints every nation in its table colour, no two land neighbours alike', () => {
  const geo = new WorldGeometry(JSON.parse(readFileSync(new URL('../public/world-110m.v1.json', import.meta.url), 'utf8')));
  const ownerOf = id => (NATIONS[id] ? id : DEPENDENCIES[id]?.of ?? null);
  const home = Object.fromEntries(geo.countries.map(country => [country.id, ownerOf(country.id)]).filter(([, owner]) => owner));
  const palette = empirePalette({ own: home, adj: geo.adj, areaOf: id => geo.surfaceOf(id).area });
  for (const [id, fill] of palette.political) assert.equal(fill, politicalFill(id), `${NATIONS[id][0]}: nationColours.js`);
  assert.deepEqual(lookAlikes(home, geo.adj, palette), []);
  // Grown empires: Spain takes Portugal and France, then France's neighbours meet its colour.
  const grown = Object.fromEntries(Object.entries(home).map(([shape, owner]) => [shape, ['620', '250'].includes(owner) ? '724' : owner]));
  assert.deepEqual(lookAlikes(grown, geo.adj, empirePalette({ own: grown, adj: geo.adj, home, areaOf: id => geo.surfaceOf(id).area })), []);
});

test('a campaign keeps bordering empires apart as they grow, and a conquest changes few colours', () => {
  const maps = ['826.json', '643y2017.json', '724y2004.json', 'eu124e2013.json', '242.json'].map(countryMap);
  let steps = 0, changed = 0;
  for (const map of maps) {
    for (const seed of [1, 2]) {
      let before = paletteOf(map);
      for (const { own } of conquests(map, seed)) {
        const palette = paletteOf(map, own);
        assert.deepEqual(lookAlikes(own, map.adj, palette), [], `${map.id}, seed ${seed}, after ${steps} conquests`);
        for (const [id, fill] of palette.political) if (before.political.has(id) && before.political.get(id) !== fill) changed++;
        steps++;
        before = palette;
      }
    }
  }
  assert.ok(steps > 300);
  assert.ok(changed / steps < 1.5, `about one colour or none changes a conquest (${(changed / steps).toFixed(2)})`);
});

test('a managed club’s neighbours stay clear of its clay all campaign long', () => {
  const map = countryMap('826.json');
  const managedId = Object.values(map.teams).find(team => team.name === 'Arsenal').id;
  for (const { own } of conquests(map, 7, 40)) {
    const palette = paletteOf(map, own, own[map.teams[managedId].section] === managedId ? managedId : null);
    const near = empireNeighbours(own, map.adj).get(managedId);
    if (!near) break;
    for (const other of near) assert.ok(politicalGap(palette.political.get(other), V4.youFill) >= CLOSE, `${other} beside your clay`);
  }
});

// ---- Paint ----

test('a fill paints in the dark theme with the twin the palette measured; DARK_TOKENS are tokens.css’s dark values', () => {
  const css = readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8');
  const dark = css.slice(css.indexOf(':root[data-theme=dark]'));
  for (const [token, value] of Object.entries(DARK_TOKENS)) {
    assert.equal(new RegExp(`${token}:\\s*(#[0-9a-f]{6})`).exec(dark)?.[1], value, `${token} in the dark theme`);
  }
  assert.equal(darkFill(V4.youFill), DARK_TOKENS['--you-fill']);
  const { light, dark: twin } = empireFillPair('x', '#d01020', 1);
  assert.equal(light, empireFill('x', '#d01020', 1));
  assert.equal(themedPaint(light), `light-dark(${light}, ${twin})`);
  assert.ok(APART > CLOSE && APART - CLOSE < 0.005, 'a hair over CLOSE, for twins a unit apart');
});
