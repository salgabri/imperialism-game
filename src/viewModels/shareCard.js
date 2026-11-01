// The results' share image as data (README §Share image): the final map, framed as the campaign's opening camera
// framed its theatre, the champion's land in the colour the map gave it, and below the map the champion with one line
// of stats. Pure (PLAN §0.9): engine/shareImage.js draws it on a canvas.
import { V4 } from '../theme.js';

/** The card in CSS pixels (the Open Graph 1.91:1 shape), the text band under the map and the map's margin. */
export const SHARE_CARD = Object.freeze({ width: 1200, height: 630, band: 156, pad: 28 });

/** The box around the territories' mainland bounds (`bbox`), or null when none has one. */
function boundsOf(shapes, ids) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const shape of shapes) {
    const b = shape.bbox;
    if (!ids.has(shape.id) || !b || !(b.w >= 0 && b.h >= 0)) continue;
    x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h);
  }
  return Number.isFinite(x0) && x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

/** "Germany_FC" → "germany-fc": the image's file name. */
const slug = text => String(text || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'champion';

/**
 * The share card. `shapes` is the map's land as drawn ([{ id, d, bbox }]: WorldMap's country paths); `backdrop` a
 * country map's neighbouring land ([{ d }]); `own` territory → holder at the end; `fill` the champion's map colour.
 * The map frames `frame` (the campaign's opening camera, App's `viewFocus`) when given, else the land the campaign was
 * fought over (every held territory's mainland), else the whole chart.
 * → { width, height, band, map, sea, transform: { scale, tx, ty }, backdrop: [d], land: [{ d, fill }], border,
 *     kicker, title, line, site, mark, filename }
 */
export function buildShareCard({
  shapes = [], backdrop = [], own = {}, championId = null, championName = '', fill = V4.landNeutral, frame = null,
  kicker = '', line = '', site = '', mark = null, seed = null,
} = {}) {
  const { width, height, band, pad } = SHARE_CARD;
  const map = { x: 0, y: 0, w: width, h: height - band };
  const held = new Set(Object.keys(own || {}).filter(id => own[id]));
  const box = frame && frame.w > 0 && frame.h > 0 ? frame : boundsOf(shapes, held) || { x: 0, y: 0, w: 960, h: 540 };
  const scale = Math.min((map.w - pad * 2) / box.w, (map.h - pad * 2) / box.h);
  const transform = { scale, tx: map.x + (map.w - box.w * scale) / 2 - box.x * scale, ty: map.y + (map.h - box.h * scale) / 2 - box.y * scale };
  const land = shapes.filter(shape => shape?.d).map(shape => Object.freeze({
    d: shape.d, fill: championId != null && own?.[shape.id] === championId ? fill : V4.landNeutral,
  }));
  return Object.freeze({
    width, height, band, map, transform, sea: V4.sea, neutral: V4.landNeutral,
    backdrop: Object.freeze((backdrop || []).filter(shape => shape?.d).map(shape => shape.d)),
    land: Object.freeze(land),
    // Borders a constant 0.9 card pixels wide, whatever the frame's scale.
    border: Object.freeze({ color: '#ffffff', width: 0.9 / scale }),
    kicker: String(kicker || ''), title: String(championName || '').toUpperCase(), line: String(line || ''), site: String(site || ''),
    mark, filename: `imperialism-${slug(championName)}${seed != null && seed !== '' ? `-${seed}` : ''}.png`,
  });
}

/** The one line of stats under the champion: "has conquered Europe in 45 battles · 12 conquests · 9 players claimed". */
export function shareLine({ subtitle = '', conquests = 0, steals = 0 } = {}) {
  const count = (n, one, many) => `${n} ${Number(n) === 1 ? one : many}`;
  return [subtitle, count(conquests, 'conquest', 'conquests'), count(steals, 'player claimed', 'players claimed')]
    .filter(Boolean).join(' · ');
}
