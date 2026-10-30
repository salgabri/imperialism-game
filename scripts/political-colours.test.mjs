// Political fills come from each empire's own colour (src/data/empireColours.js): a nation's colour, a club's crest
// colour (src/data/clubColours.js, `npm run build:club-colours`), as a pastel that keeps the colour's hue
// (theme.js empireFill) with its own dark-theme twin (themedPaint).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EMPIRE_PASTELS, V4, empireFill, themedPaint } from '../src/theme.js';
import { empireColour, politicalFill } from '../src/data/empireColours.js';
import { clubColour } from '../src/data/clubColours.js';
import { NATIONS } from '../src/data/teams.js';
import { CLUBS } from '../src/data/clubs.football.js';
import { CLUBS as NBA } from '../src/data/clubs.basketball.js';

const toLinear = c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
/** '#rrggbb' → { L, C, H } in OKLCH. */
function lch(hex) {
  const [r, g, b] = [1, 3, 5].map(i => toLinear(parseInt(hex.slice(i, i + 2), 16) / 255));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const A = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
  return { L: 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, C: Math.hypot(A, B), H: (Math.atan2(B, A) * 180 / Math.PI + 360) % 360 };
}
const hueGap = (a, b) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
const darkTwin = fill => /^light-dark\(#[0-9a-f]{6}, (#[0-9a-f]{6})\)$/.exec(themedPaint(fill))?.[1];

test('a team colour gives a soft pastel of the same hue', () => {
  for (const colour of ['#F0483E', '#4A7DF0', '#FFD84D', '#178452', 'oklch(0.72 0.16 300)', '#a50044']) {
    const source = colour.startsWith('#') ? lch(colour) : { H: 300 };
    const fill = empireFill('x', colour);
    assert.match(fill, /^#[0-9a-f]{6}$/, colour);
    const pastel = lch(fill);
    assert.ok(hueGap(pastel.H, source.H) < 12, `${colour}: hue ${source.H.toFixed(0)} kept (${pastel.H.toFixed(0)})`);
    assert.ok(pastel.L > 0.82 && pastel.L < 0.92, `${colour}: light pastel (${pastel.L.toFixed(3)})`);
    assert.ok(pastel.C > 0.02 && pastel.C < 0.06, `${colour}: soft but coloured (${pastel.C.toFixed(3)})`);
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
  assert.ok(lch(dark).L < 0.5 && hueGap(lch(dark).H, lch(fill).H) < 15, 'dark, same hue');
  const grey = empireFill('276', '#E8E8EC');
  assert.ok(lch(darkTwin(grey)).L > lch('#2a2e30').L + 0.08, 'a dark grey still stands off dark neutral land');
  assert.equal(themedPaint(EMPIRE_PASTELS[2]), `var(--empire-3, ${EMPIRE_PASTELS[2]})`);
  assert.equal(themedPaint('#ce2b37'), '#ce2b37', 'flag and club colours pass through');
  const css = readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8');
  assert.match(css, /:root \{\s*color-scheme: light;/, 'light-dark() reads the light theme');
  assert.match(css, /:root\[data-theme=dark\] \{\s*color-scheme: dark;/, 'and the dark one');
});

test('nations use their own colour; England, Poland and Finland (white kits) take their flag colour', () => {
  const near = (id, hue) => assert.ok(hueGap(lch(politicalFill(id)).H, hue) < 25, `${NATIONS[id][0]}: hue ${lch(politicalFill(id)).H.toFixed(0)}`);
  near('724', 25);   // Spain red
  near('826', 25);   // England red (St George)
  near('616', 20);   // Poland red
  near('250', 265);  // France blue
  near('246', 260);  // Finland blue
  near('076', 95);   // Brazil yellow
  near('528', 55);   // Netherlands orange
  assert.ok(lch(politicalFill('276')).C < 0.005, 'Germany (white and black) is grey');
  for (const id of Object.keys(NATIONS)) assert.ok(empireColour(id), `${id} has a colour`);
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
