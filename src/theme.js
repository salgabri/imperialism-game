// Design tokens for the match-ledger / campaign-atlas shell. Nation colours come from the data set;
// everything structural comes from here.

export const C = {
  // surfaces
  deep: '#10191F',
  panel: '#162128',
  card: '#19262D',
  cardHi: '#223139',
  cardPick: '#2A3940',
  ocean: '#1D323B',
  ink: '#10191F',
  shadow: '#091217',
  landA: '#515D59',
  landB: '#59635F',

  // lines
  line: '#34424A',
  lineSoft: '#2B383F',
  lineCard: '#45545A',
  lineInner: '#303E45',
  lineCtl: '#56666D',
  lineCorner: '#697A80',
  lineHover: '#73838A',

  // type
  text: '#ECE9DF',
  textHi: '#F3F0E8',
  textMax: '#FAF8F2',
  textList: '#DFE4DF',
  textSoft: '#AFBCC0',
  textMute: '#95A3A8',
  textDim: '#95A3A8',
  textFaint: '#8D9CA2',
  textFaded: '#8A9A9F',
  textCoord: '#ADBDC3',
  textChip: '#D3DDDD',
  textEvent: '#DBE2DF',

  // signals
  gold: '#C6AC78',
  goldHi: '#DCC18A',
  goldSoft: '#EAD7AE',
  goldEdge: '#746647',
  goldOutline: '#F5E9CE',
  green: '#84C5A0',
  red: '#DF8B80',
  redEdge: '#7A3C44',
  cyan: '#8EBCC9',
  cyanEdge: '#3E6E84',
  cyanPanel: '#2D4356',
};

export const FONT = {
  head: "'Archivo Narrow', 'Arial Narrow', sans-serif",
  body: "'Archivo', 'Segoe UI', sans-serif",
  mono: "'Archivo Narrow', 'Arial Narrow', sans-serif",
  map: "'Archivo Narrow', 'Arial Narrow', sans-serif",   // DEC D19 / misc: Archivo + Archivo Narrow only
};

/** Rating tiers: world class, solid, filler. */
export function ratingColor(r) {
  return r >= 85 ? C.gold : r >= 75 ? C.textHi : C.textSoft;
}

/** Translate a nation colour into a low-alpha wash for result panels. */
export function tint(hex, alpha) {
  if (hex && hex[0] === '#' && hex.length === 7) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }
  return `rgba(229,168,59,${alpha})`;
}

export const pad3 = n => String(n).padStart(3, '0');

// The legacy political palette (`politicalColor`, POLITICAL_PALETTE / POLITICAL_COLORS) was retired in W3: the map
// fills empires with `empireFill` below (PLAN §1.5).

// ---------- v4 (WP-0, PLAN §2.4). Appended after the legacy exports above. ----------

/** v4 design tokens (README §Design tokens). Mirrors src/styles/tokens.css for SVG/inline use. */
export const V4 = Object.freeze({
  surface: '#f5f5f2', panel: '#ffffff', surface2: '#ebece7', ink: '#111417', text2: '#3a4045', muted: '#646a6e',
  rule: '#dcded8', rowRule: '#e3e5df', controlLine: '#c6cbcd',
  you: '#9c5a43', youText: '#8c4a35', youFill: '#c4917c', youSoft: '#f3ebe7', youOnDark: '#d9a48e',
  opponent: '#2f54eb', opponentFill: '#c3cfff', claimed: '#0f7b83',
  gain: '#138a4a', loss: '#d1342f', even: '#9a6700',
  sea: '#dfe7eb', landNeutral: '#e8e9e4', flagBg: '#d9dcd6',
});
/** Map-only values from README §Map rendering and DEC D18/D21. The veil is CSS-only (--map-veil, A-9). */
export const MAP = Object.freeze({
  coast: '#9aa7ae', capital: '#30363b', label: '#2c3236', labelOpacity: .72,
  hatch: 'rgba(255,255,255,.6)', oddsTrack: '#dfe2dc', grab: '#d4d7d1',
  // DEC D18 Strength mode: 5-step neutral→ink-grey ramp (#e8e9e4 → #8a9297), linear in sRGB [derived steps]
  strengthRamp: ['#e8e9e4', '#d1d3d1', '#b9bebe', '#a2a8aa', '#8a9297'],
  // DEC D18 Fronts mode: gain/even/loss mixed 35% colour + 65% white [derived]
  frontsTint: { gain: '#acd6c0', even: '#dccaa6', loss: '#efb8b6' },
});
/** README: empire pastel fills, picked by hash of team id, for an empire without a colour of its own. */
export const EMPIRE_PASTELS = Object.freeze(['#cfe0d6', '#e6dcc7', '#d6dbe8', '#e9d6d9', '#d8e4c4', '#e3e0d0',
  '#cddfe2', '#e8d9c2', '#dcd3e6', '#d1d8cc', '#ebe2b9']);
/**
 * A pastel of an empire's own colour (src/data/empireColours.js): its OKLCH hue, a share of its chroma within the
 * pastel band, and one of three lightness steps by hash of team id so same-coloured neighbours still differ. A
 * white, black or grey colour gives a grey a step darker than neutral land. Each theme has its own band.
 */
const TEAM_PASTEL = Object.freeze({
  light: Object.freeze({ L: [0.845, 0.875, 0.905], greyL: [0.83, 0.855, 0.88], share: 0.45, min: 0.03, max: 0.055 }),
  dark: Object.freeze({ L: [0.37, 0.4, 0.43], greyL: [0.43, 0.46, 0.49], share: 0.35, min: 0.025, max: 0.055 }),
});
const GREY_CHROMA = 0.04;
const teamPastels = new Map();   // `${colour}|${step}` → light fill
const teamPastelsDark = new Map(); // light fill → its dark-theme twin (themedPaint)

const toLinear = c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toSrgb = c => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
/** '#rgb', '#rrggbb' or 'oklch(L C H)' → [L, C, H] (OKLCH), else null. */
function toOklch(colour) {
  const text = String(colour).trim().toLowerCase();
  const lch = /^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)(?:deg)?\s*\)$/.exec(text);
  if (lch) return [Number(lch[1]) / (lch[2] ? 100 : 1), Number(lch[3]), Number(lch[4])];
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(text)?.[1];
  if (!hex) return null;
  const full = hex.length === 3 ? [...hex].map(c => c + c).join('') : hex;
  const [r, g, b] = [0, 2, 4].map(i => toLinear(parseInt(full.slice(i, i + 2), 16) / 255));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const A = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
  return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, Math.hypot(A, B), (Math.atan2(B, A) * 180 / Math.PI + 360) % 360];
}
/** OKLCH → '#rrggbb', the chroma lowered until the colour is inside sRGB. */
function oklchHex(L, C, H) {
  const cos = Math.cos(H * Math.PI / 180), sin = Math.sin(H * Math.PI / 180);
  for (let c = C; ; c = Math.max(0, c - 0.002)) {
    const l = (L + 0.3963377774 * c * cos + 0.2158037573 * c * sin) ** 3;
    const m = (L - 0.1055613458 * c * cos - 0.0638541728 * c * sin) ** 3;
    const s = (L - 0.0894841775 * c * cos - 1.2914855480 * c * sin) ** 3;
    const rgb = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s];
    if (c === 0 || rgb.every(v => v >= 0 && v <= 1)) {
      return `#${rgb.map(v => Math.round(toSrgb(Math.min(1, Math.max(0, v))) * 255).toString(16).padStart(2, '0')).join('')}`;
    }
  }
}
function teamPastel([, C, H], step, band) {
  if (C < GREY_CHROMA) return oklchHex(band.greyL[step], 0, 0);
  return oklchHex(band.L[step], Math.min(band.max, Math.max(band.min, C * band.share)), H);
}

/** An empire's political fill: a pastel of its own `colour` when it has one, else a pastel picked by hash of id. */
export function empireFill(id, colour = null) {
  let x = 0;
  for (const ch of String(id)) x = (x * 31 + ch.charCodeAt(0)) >>> 0;
  const lch = colour ? toOklch(colour) : null;
  if (!lch) return EMPIRE_PASTELS[x % EMPIRE_PASTELS.length];
  const key = `${colour}|${x % 3}`;
  let fill = teamPastels.get(key);
  if (!fill) {
    fill = teamPastel(lch, x % 3, TEAM_PASTEL.light);
    teamPastels.set(key, fill);
    if (!teamPastelsDark.has(fill)) teamPastelsDark.set(fill, teamPastel(lch, x % 3, TEAM_PASTEL.dark));
  }
  return fill;
}
/** README rating tiers: 88+, 84–87, 80–83, 75–79, 70–74, <70. */
export const RATING_TIERS = Object.freeze([[88, '88', '#8a5a00'], [84, '84', '#0f7b4d'], [80, '80', '#138a4a'],
  [75, '75', '#5b7a12'], [70, '70', '#a15c07'], [-Infinity, 'low', '#c2352b']]);
export const ratingTierOf = r => RATING_TIERS.find(([min]) => r >= min)[1];
export const ratingTierColor = r => RATING_TIERS.find(([min]) => r >= min)[2];
export const WIN_TONE_COLORS = Object.freeze({ gain: '#138a4a', even: '#9a6700', loss: '#d1342f', muted: '#646a6e' });

/**
 * Map paint follows the theme: view models keep the light literals above (tests and attributes read them), and the
 * renderer paints `themedPaint(fill)`: the tokens.css custom property holding that colour in the active theme, with
 * the literal as fallback. A pastel of an empire's own colour (empireFill) has no token: it paints as light-dark() of
 * its two theme twins (tokens.css sets color-scheme per theme). Other colours (nation and club colours, flag
 * patterns) pass through.
 */
const PAINT_TOKENS = new Map([
  [V4.landNeutral, '--land-neutral'], [V4.youFill, '--you-fill'], [V4.opponentFill, '--opponent-fill'], [V4.flagBg, '--flag-bg'],
  ...EMPIRE_PASTELS.map((hex, i) => [hex, `--empire-${i + 1}`]),
  ...MAP.strengthRamp.slice(1).map((hex, i) => [hex, `--strength-${i + 2}`]),
  ...Object.entries(MAP.frontsTint).map(([tone, hex]) => [hex, `--fronts-${tone}`]),
]);
export function themedPaint(fill) {
  if (typeof fill !== 'string') return fill;
  const token = PAINT_TOKENS.get(fill.toLowerCase());
  if (token) return `var(${token}, ${fill})`;
  const dark = teamPastelsDark.get(fill);
  return dark ? `light-dark(${fill}, ${dark})` : fill;
}
