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
/** README: empire pastel fills, picked by hash of team id. */
export const EMPIRE_PASTELS = Object.freeze(['#cfe0d6', '#e6dcc7', '#d6dbe8', '#e9d6d9', '#d8e4c4', '#e3e0d0',
  '#cddfe2', '#e8d9c2', '#dcd3e6', '#d1d8cc', '#ebe2b9']);
export function empireFill(id) {
  let x = 0;
  for (const ch of String(id)) x = (x * 31 + ch.charCodeAt(0)) >>> 0;
  return EMPIRE_PASTELS[x % EMPIRE_PASTELS.length];
}
/** README rating tiers: 88+, 84–87, 80–83, 75–79, 70–74, <70. */
export const RATING_TIERS = Object.freeze([[88, '88', '#8a5a00'], [84, '84', '#0f7b4d'], [80, '80', '#138a4a'],
  [75, '75', '#5b7a12'], [70, '70', '#a15c07'], [-Infinity, 'low', '#c2352b']]);
export const ratingTierOf = r => RATING_TIERS.find(([min]) => r >= min)[1];
export const ratingTierColor = r => RATING_TIERS.find(([min]) => r >= min)[2];
export const WIN_TONE_COLORS = Object.freeze({ gain: '#138a4a', even: '#9a6700', loss: '#d1342f', muted: '#646a6e' });
