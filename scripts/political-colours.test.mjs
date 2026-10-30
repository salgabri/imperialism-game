// Political fills come from each empire's own colour (src/data/empireColours.js): a nation's colour chosen to fit it
// and stand apart from its neighbours (src/data/nationColours.js, `npm run build:nation-colours`), a club's crest
// colour (src/data/clubColours.js, `npm run build:club-colours`), as a pastel that keeps the colour's hue
// (theme.js empireFill) with its own dark-theme twin (themedPaint).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { EMPIRE_PASTELS, V4, empireFill, themedPaint } from '../src/theme.js';
import { empireColour, politicalFill } from '../src/data/empireColours.js';
import { NATION_COLOURS } from '../src/data/nationColours.js';
import { clubColour } from '../src/data/clubColours.js';
import { NATIONS, DEPENDENCIES } from '../src/data/teams.js';
import { CLUBS } from '../src/data/clubs.football.js';
import { CLUBS as NBA } from '../src/data/clubs.basketball.js';
import { WorldGeometry } from '../src/engine/geo.js';
import { toOklch } from '../src/engine/colour.js';

/** '#rrggbb' → { L, C, H } in OKLCH. */
const lch = hex => {
  const [L, C, H] = toOklch(hex);
  return { L, C, H };
};
const hueGap = (a, b) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
const darkTwin = fill => /^light-dark\(#[0-9a-f]{6}, (#[0-9a-f]{6})\)$/.exec(themedPaint(fill))?.[1];

test('a team colour gives a soft pastel of the same hue', () => {
  for (const colour of ['#F0483E', '#4A7DF0', '#FFD84D', '#178452', 'oklch(0.72 0.16 300)', '#a50044']) {
    const source = colour.startsWith('#') ? lch(colour) : { H: 300 };
    const fill = empireFill('x', colour);
    assert.match(fill, /^#[0-9a-f]{6}$/, colour);
    const pastel = lch(fill);
    assert.ok(hueGap(pastel.H, source.H) < 12, `${colour}: hue ${source.H.toFixed(0)} kept (${pastel.H.toFixed(0)})`);
    assert.ok(pastel.L > 0.77 && pastel.L < 0.92, `${colour}: light pastel (${pastel.L.toFixed(3)})`);
    assert.ok(pastel.C > 0.03 && pastel.C < 0.09, `${colour}: soft but coloured (${pastel.C.toFixed(3)})`);
  }
});

test('white, black and grey team colours give a grey a step darker than neutral land', () => {
  const land = lch(V4.landNeutral).L;
  for (const colour of ['#ffffff', '#000000', '#E8E8EC', '#808080']) {
    const grey = lch(empireFill('x', colour));
    assert.ok(grey.C < 0.005, `${colour} is grey`);
    assert.ok(grey.L < land - 0.03, `${colour} is darker than neutral land`);
  }
});

test('the lightness step follows the team id, so same-coloured neighbours still differ; no colour keeps the hash pastel', () => {
  const steps = new Set(['724', '620', '756', '040', '152', '604', '208'].map(id => empireFill(id, '#e8483e')));
  assert.ok(steps.size > 1, 'several reds take different steps');
  assert.equal(empireFill('724', '#e8483e'), empireFill('724', '#e8483e'), 'stable');
  for (const id of ['380', '688', 'c1']) {
    assert.ok(EMPIRE_PASTELS.includes(empireFill(id)), id);
    assert.equal(empireFill(id, 'not a colour'), empireFill(id));
  }
});

test('a team pastel paints through light-dark() with a dark twin of the same hue; palette and other colours are unchanged', () => {
  const fill = empireFill('724', '#F0483E');
  const dark = darkTwin(fill);
  assert.ok(dark, themedPaint(fill));
  assert.ok(lch(dark).L < 0.52 && hueGap(lch(dark).H, lch(fill).H) < 15, 'dark, same hue');
  const grey = empireFill('276', '#E8E8EC');
  assert.ok(lch(darkTwin(grey)).L > lch('#2a2e30').L + 0.08, 'a dark grey still stands off dark neutral land');
  assert.equal(themedPaint(EMPIRE_PASTELS[2]), `var(--empire-3, ${EMPIRE_PASTELS[2]})`);
  assert.equal(themedPaint('#ce2b37'), '#ce2b37', 'flag and club colours pass through');
  const css = readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8');
  assert.match(css, /:root \{\s*color-scheme: light;/, 'light-dark() reads the light theme');
  assert.match(css, /:root\[data-theme=dark\] \{\s*color-scheme: dark;/, 'and the dark one');
});

test('nations take a colour that fits them: their own, a shade of it, or one of their flag', () => {
  for (const id of Object.keys(NATIONS)) {
    const [colour, step] = NATION_COLOURS[id] ?? [];
    assert.ok(toOklch(colour ?? '') && [0, 1, 2].includes(step), `${NATIONS[id][0]} has a colour and a step`);
    assert.equal(empireColour(id), colour);
    assert.equal(politicalFill(id), empireFill(id, colour, step));
  }
  const near = (id, hue) => assert.ok(hueGap(lch(politicalFill(id)).H, hue) < 30, `${NATIONS[id][0]}: hue ${lch(politicalFill(id)).H.toFixed(0)}`);
  near('724', 25);   // Spain red
  near('643', 0);    // Russia red
  near('826', 25);   // England red (St George; the team plays in white)
  near('250', 265);  // France blue
  near('752', 90);   // Sweden yellow
  near('076', 90);   // Brazil yellow
  near('528', 60);   // Netherlands orange
  assert.ok(lch(politicalFill('276')).C < 0.005, 'Germany (white and black) is grey');
});

test('bordering nations stand apart in both themes', () => {
  // The solver's distance (scripts/build-nation-colours.mjs): OKLab with lightness at 0.4, the nearer theme.
  const lab = hex => {
    const { L, C, H } = lch(hex);
    return [L * 0.4, C * Math.cos(H * Math.PI / 180), C * Math.sin(H * Math.PI / 180)];
  };
  const twins = id => [politicalFill(id), darkTwin(politicalFill(id))].map(lab);
  const distance = (a, b) => Math.min(...twins(a).map((p, i) => Math.hypot(...p.map((v, k) => v - twins(b)[i][k]))));
  const geo = new WorldGeometry(JSON.parse(readFileSync(new URL('../public/world-110m.v1.json', import.meta.url), 'utf8')));
  const ownerOf = shape => (NATIONS[shape] ? shape : DEPENDENCIES[shape]?.of ?? null);
  const alike = [];
  for (const [shape, adjacent] of Object.entries(geo.adj)) {
    for (const other of adjacent) {
      const [a, b] = [ownerOf(shape), ownerOf(other)];
      if (a && b && a < b && distance(a, b) < 0.0325) alike.push(`${NATIONS[a][0]}–${NATIONS[b][0]}`);
    }
  }
  assert.deepEqual(alike, []);
});

test('the nation colour table is what build-nation-colours writes', () => {
  const script = fileURLToPath(new URL('./build-nation-colours.mjs', import.meta.url));
  const run = spawnSync(process.execPath, [script, '--check'], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr || run.stdout);
});

test('clubs use their crest colour, with corrections where the crest misleads', () => {
  const hue = id => lch(politicalFill(id)).H;
  assert.ok(hueGap(hue('f-liverpool'), 20) < 25, 'Liverpool red');
  assert.ok(hueGap(hue('f-chelsea'), 265) < 25, 'Chelsea blue');
  assert.ok(hueGap(hue('b-boston-celtics'), 150) < 25, 'Celtics green');
  assert.ok(hueGap(hue('f-fc-barcelona'), 0) < 25, 'Barcelona garnet, not its crest gold');
  assert.ok(lch(politicalFill('f-juventus')).C < 0.005, 'Juventus black and white');
  assert.equal(clubColour('f-fc-barcelona'), clubColour('d724-1708'), 'a league club and its domestic twin share the colour');
  assert.equal(clubColour('f-1-fc-union-berlin'), '#eb1923', 'a correction covers a club without a crest');
  assert.equal(clubColour('d999-1'), null);
  assert.equal(politicalFill('d999-1'), empireFill('d999-1'), 'a club with no colour keeps its hash pastel');
  const missing = [...CLUBS, ...NBA].filter(club => !clubColour(club.id)).map(club => club.id);
  assert.deepEqual(missing, [], 'every league club has a colour');
});

test('every correction names a club the game ships', () => {
  const { colours } = JSON.parse(readFileSync(new URL('./data/club-colours.json', import.meta.url), 'utf8'));
  const ids = new Set([...CLUBS, ...NBA].map(club => club.id));
  for (const [id, colour] of Object.entries(colours)) {
    assert.ok(ids.has(id) || /^d[0-9A-Za-z]+-\d+$/.test(id), id);
    assert.equal(clubColour(id), colour.toLowerCase(), `${id} applied`);
  }
});
