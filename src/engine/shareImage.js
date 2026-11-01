// Draws the results' share image (viewModels/shareCard.js) on a canvas and hands it over (README §Share image): on
// phones as a file through the Web Share API, elsewhere as a download. Browser only: canvas, Path2D and the page's
// own fonts. A test DOM without them gets null and draws nothing.
import { FONT, V4 } from '../theme.js';

// Canvas pixels per card pixel, so text stays sharp on a phone's screen.
const DENSITY = 2;
const MARGIN = 40;

/** Whether this browser can draw the share image (jsdom has no Path2D, and its canvas is a stub). */
export function canDrawShareImage(win = globalThis) {
  return typeof win?.Path2D === 'function' && typeof win?.document?.createElement === 'function';
}

/** An image of the same origin, or null if it cannot load. */
function loadImage(url, win) {
  if (!url) return Promise.resolve(null);
  return new Promise(resolve => {
    const image = new win.Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = url;
  });
}

/** The largest size from `size` down to `min` at which `text` fits `width`, in `font(size)`. */
function fitText(ctx, text, font, width, size, min) {
  for (let px = size; px > min; px -= 1) {
    ctx.font = font(px);
    if (ctx.measureText(text).width <= width) return px;
  }
  ctx.font = font(min);
  return min;
}

/** `text` cut with an ellipsis to fit `width` in the context's current font. */
function clip(ctx, text, width) {
  if (ctx.measureText(text).width <= width) return text;
  let cut = text;
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > width) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}

/** The champion's flag or crest, contained in its box; a club without a crest gets its code on its colour. */
function drawMark(ctx, mark, image, box) {
  if (image) {
    const ratio = Math.min(box.w / (image.naturalWidth || box.w), box.h / (image.naturalHeight || box.h));
    const w = mark.kind === 'flag' ? box.w : (image.naturalWidth || box.w) * ratio;
    const h = mark.kind === 'flag' ? box.h : (image.naturalHeight || box.h) * ratio;
    try {
      ctx.drawImage(image, box.x + (box.w - w) / 2, box.y + (box.h - h) / 2, w, h);
      if (mark.kind === 'flag') { ctx.strokeStyle = 'rgba(17,20,23,.14)'; ctx.lineWidth = 1; ctx.strokeRect(box.x + 0.5, box.y + 0.5, w - 1, h - 1); }
      return true;
    } catch { /* an SVG without its own size (Firefox): fall through to the code chip */ }
  }
  if (!mark.code) return false;
  ctx.fillStyle = mark.color || V4.ink;
  ctx.fillRect(box.x, box.y, box.w, box.h);
  ctx.fillStyle = V4.panel;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  fitText(ctx, mark.code, px => `700 ${px}px ${FONT.head}`, box.w - 12, 28, 12);
  ctx.fillText(mark.code, box.x + box.w / 2, box.y + box.h / 2 + 1);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  return true;
}

/**
 * The card as a PNG Blob, or null where the browser cannot draw it. Waits for the page's fonts and the champion's
 * mark; the map is plain paths, so nothing else loads.
 */
export async function drawShareCard(card, { window: win = globalThis } = {}) {
  if (!card || !canDrawShareImage(win)) return null;
  const doc = win.document;
  await Promise.all([`700 52px ${FONT.head}`, `400 20px ${FONT.body}`, `700 14px ${FONT.head}`]
    .map(font => doc.fonts?.load?.(font).catch(() => null)));
  const image = await loadImage(card.mark?.url, win);
  const canvas = doc.createElement('canvas');
  canvas.width = card.width * DENSITY;
  canvas.height = card.height * DENSITY;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.scale(DENSITY, DENSITY);

  // The map: sea, the neighbouring land of a country map, then every territory with its borders.
  const { map, transform } = card;
  ctx.fillStyle = card.sea;
  ctx.fillRect(map.x, map.y, map.w, map.h);
  ctx.save();
  ctx.beginPath();
  ctx.rect(map.x, map.y, map.w, map.h);
  ctx.clip();
  ctx.transform(transform.scale, 0, 0, transform.scale, transform.tx, transform.ty);
  ctx.lineJoin = 'round';
  ctx.fillStyle = card.neutral;
  for (const d of card.backdrop) ctx.fill(new win.Path2D(d));
  const paths = card.land.map(shape => new win.Path2D(shape.d));
  card.land.forEach((shape, i) => { ctx.fillStyle = shape.fill; ctx.fill(paths[i]); });
  ctx.strokeStyle = card.border.color;
  ctx.lineWidth = card.border.width;
  for (const path of paths) ctx.stroke(path);
  ctx.restore();

  // The band: the champion's mark, the kicker, the champion and one line of stats; the game and its address.
  const top = map.y + map.h;
  ctx.fillStyle = V4.panel;
  ctx.fillRect(0, top, card.width, card.band);
  ctx.fillStyle = V4.rule;
  ctx.fillRect(0, top, card.width, 1);
  const markBox = { x: MARGIN, y: top + 36, w: 96, h: 72 };
  const marked = card.mark ? drawMark(ctx, card.mark, image, markBox) : false;
  const left = marked ? markBox.x + markBox.w + 24 : MARGIN;
  ctx.textAlign = 'right';
  ctx.fillStyle = V4.ink;
  ctx.font = `700 24px ${FONT.head}`;
  const wordmark = ctx.measureText('IMPERIALISM').width;
  ctx.fillText('IMPERIALISM', card.width - MARGIN, top + 62);
  ctx.fillStyle = V4.muted;
  ctx.font = `400 15px ${FONT.body}`;
  const brand = Math.max(wordmark, card.site ? ctx.measureText(card.site).width : 0);
  if (card.site) ctx.fillText(card.site, card.width - MARGIN, top + 88);
  ctx.textAlign = 'left';
  const width = card.width - MARGIN - brand - 40 - left;
  ctx.fillStyle = V4.youText;
  ctx.font = `700 14px ${FONT.head}`;
  ctx.fillText(clip(ctx, card.kicker.toUpperCase(), width), left, top + 46);
  ctx.fillStyle = V4.ink;
  fitText(ctx, card.title, px => `700 ${px}px ${FONT.head}`, width, 52, 28);
  ctx.fillText(clip(ctx, card.title, width), left, top + 96);
  ctx.fillStyle = V4.text2;
  fitText(ctx, card.line, px => `400 ${px}px ${FONT.body}`, width, 20, 15);
  ctx.fillText(clip(ctx, card.line, width), left, top + 128);

  return new Promise(resolve => canvas.toBlob(blob => resolve(blob || null), 'image/png'));
}

/**
 * Hands the image over: on a phone whose browser can share files, through the share sheet (`text` carries the
 * challenge link); otherwise, or if sharing fails, as a download. → 'shared' | 'cancelled' | 'downloaded'
 */
export async function deliverShareImage(file, { title = '', text = '', phone = false, window: win = globalThis } = {}) {
  const nav = win.navigator;
  if (phone && nav?.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title, text });
      return 'shared';
    } catch (error) {
      if (error?.name === 'AbortError') return 'cancelled';
    }
  }
  const doc = win.document, url = win.URL.createObjectURL(file), anchor = doc.createElement('a');
  anchor.href = url;
  anchor.download = file.name;
  doc.body.append(anchor);
  anchor.click();
  anchor.remove();
  // Let the browser begin reading the file before releasing its URL.
  win.setTimeout(() => win.URL.revokeObjectURL(url), 1000);
  return 'downloaded';
}
