// Design tokens for the war-room shell. Nation colours come from the data set;
// everything structural comes from here.

export const C = {
  // surfaces
  deep: '#26364B',
  panel: '#2A3C54',
  card: '#2D4059',
  cardHi: '#33475F',
  cardPick: '#3C4E63',
  ocean: '#31465F',
  ink: '#14202E',
  shadow: '#0B1622',
  landA: '#3B5069',
  landB: '#42576F',

  // lines
  line: '#445C7A',
  lineSoft: '#3A4F6B',
  lineCard: '#4A6480',
  lineInner: '#40566F',
  lineCtl: '#52698A',
  lineCorner: '#5E7794',
  lineHover: '#3A5A7C',

  // type
  text: '#C9D7E6',
  textHi: '#E9F2FA',
  textMax: '#F2F6FA',
  textList: '#DCE7F2',
  textSoft: '#A9BDD1',
  textMute: '#90A6BC',
  textDim: '#8CA2B8',
  textFaint: '#7E94AB',
  textFaded: '#7288A0',
  textCoord: '#AEC1D4',
  textChip: '#C4D5E6',
  textEvent: '#CCDAE8',

  // signals
  gold: '#E5A83B',
  goldHi: '#F2C230',
  goldSoft: '#FFE9C2',
  goldEdge: '#6E5A2E',
  goldOutline: '#F5E9CE',
  green: '#57C48B',
  red: '#E5484D',
  redEdge: '#7A3C44',
  cyan: '#4FB8D8',
  cyanEdge: '#3E6E84',
  cyanPanel: '#2D4356',
};

export const FONT = {
  head: "'Big Shoulders Display', sans-serif",
  body: "'Barlow Condensed', sans-serif",
  mono: "'IBM Plex Mono', monospace",
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
