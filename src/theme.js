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
  map: "'Alegreya', Georgia, 'Times New Roman', serif",
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

// Muted political colors make empires legible; full flag mode is still available.
const POLITICAL_PALETTE = ['#87999D', '#849077', '#B59872', '#9C8277', '#8194A3', '#A0A291', '#8C839A', '#779997'];
const POLITICAL_COLORS = {
  '250': '#6486B0', '724': '#AB6C5F', '276': '#849A70', '380': '#C2A057',
  '826': '#85979D', '620': '#8D9984', '528': '#B2906F', '056': '#B4A990',
  '756': '#A87C78', '040': '#A4A194', '616': '#A5A59C', '804': '#8196A7',
  '643': '#798889', '752': '#8A9CAA', '578': '#A1AFAB', '246': '#B2AE99',
  '208': '#A79B86', '300': '#95A4AA', '792': '#A39C8A', '372': '#8D9D8A',
  '840': '#A4A087', '124': '#8E9C9B', '076': '#8B9A70', '032': '#91A9B1',
  '156': '#B09B7E', '356': '#A9AB90', '036': '#B5A578', '392': '#AC827B',
};
export function politicalColor(id) {
  if (POLITICAL_COLORS[id]) return POLITICAL_COLORS[id];
  let hash = 0;
  for (const c of String(id)) hash = ((hash * 31) + c.charCodeAt(0)) >>> 0;
  return POLITICAL_PALETTE[hash % POLITICAL_PALETTE.length];
}
