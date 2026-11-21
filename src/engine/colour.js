// OKLab / OKLCH colour maths (Björn Ottosson's matrices) for the political map's team colours. Pure.

const toLinear = c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toSrgb = c => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

/** sRGB channels 0–255 → [L, a, b] (OKLab). */
export function rgbToOklab(r, g, b) {
  [r, g, b] = [r, g, b].map(c => toLinear(c / 255));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s];
}

/** '#rgb', '#rrggbb' or 'oklch(L C H)' → [L, C, H] (OKLCH), else null. */
export function toOklch(colour) {
  const text = String(colour).trim().toLowerCase();
  const lch = /^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)(?:deg)?\s*\)$/.exec(text);
  if (lch) return [Number(lch[1]) / (lch[2] ? 100 : 1), Number(lch[3]), Number(lch[4])];
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(text)?.[1];
  if (!hex) return null;
  const full = hex.length === 3 ? [...hex].map(c => c + c).join('') : hex;
  const [L, a, b] = rgbToOklab(...[0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16)));
  return [L, Math.hypot(a, b), (Math.atan2(b, a) * 180 / Math.PI + 360) % 360];
}

/** OKLCH → '#rrggbb', the chroma lowered until the colour is inside sRGB. */
export function oklchHex(L, C, H) {
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

/** Euclidean OKLab distance between two colours (toOklch inputs); Infinity when either does not parse. */
export function colourDistance(a, b) {
  const p = toOklch(a), q = toOklch(b);
  if (!p || !q) return Infinity;
  const [pa, pb] = [p[1] * Math.cos(p[2] * Math.PI / 180), p[1] * Math.sin(p[2] * Math.PI / 180)];
  const [qa, qb] = [q[1] * Math.cos(q[2] * Math.PI / 180), q[1] * Math.sin(q[2] * Math.PI / 180)];
  return Math.hypot(p[0] - q[0], pa - qa, pb - qb);
}

// The country maps' club colours (docs/design/domestic-campaigns.md, "Output"): written by the map builds
// (scripts/lib/domestic-output.mjs) and by a map cut to fewer clubs (engine/clubSplit.js).
// Two lightness levels over a 24-step hue wheel; greedy over the section graph so
// neighbours (and, where possible, neighbours of neighbours) differ clearly.
const PALETTE = [0.74, 0.6].flatMap(l => Array.from({ length: 24 }, (_, i) => ({ l, c: 0.15, h: i * 15 })));
const lab = ({ l, c, h }) => [l, c * Math.cos(h * Math.PI / 180), c * Math.sin(h * Math.PI / 180)];
const deltaE = (a, b) => { const p = lab(a), q = lab(b); return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); };
const colourText = ({ l, c, h }) => `oklch(${l.toFixed(2)} ${c.toFixed(2)} ${h})`;

/**
 * One OKLCH colour per club, greedily in rank order over `adjacency` (club index -> neighbouring club indices). With
 * `crowdedFirst` (the country maps), the clubs with the most neighbours choose first, and a club left too close to a
 * neighbour then takes the colour farthest from all its neighbours: the palette holds about 16 colours that all differ
 * clearly, and a club bordering 18 (Proxy Work, across Egypt's desert) choosing last finds none of them free.
 */
export function colourSections(adjacency, { crowdedFirst = false } = {}) {
  const chosen = new Array(adjacency.length).fill(-1);
  const used = new Array(PALETTE.length).fill(0);
  const order = adjacency.map((_, i) => i);
  if (crowdedFirst) order.sort((a, b) => adjacency[b].length - adjacency[a].length || a - b);
  for (const i of order) {
    const near = adjacency[i].filter(j => chosen[j] >= 0).map(j => PALETTE[chosen[j]]);
    const second = [...new Set(adjacency[i].flatMap(j => adjacency[j]))]
      .filter(j => j !== i && !adjacency[i].includes(j) && chosen[j] >= 0).map(j => PALETTE[chosen[j]]);
    let best = -1, bestKey = null;
    PALETTE.forEach((colour, k) => {
      const d1 = near.length ? Math.min(...near.map(o => deltaE(colour, o))) : 1;
      const d2 = second.length ? Math.min(...second.map(o => deltaE(colour, o))) : 1;
      // Neighbours dominate (capped: any clear difference is enough), then second
      // neighbours, then the least-used colour; ties keep the lower palette index.
      const key = [Math.min(d1, 0.12), Math.min(d2, 0.08), -used[k], d1];
      const at = bestKey ? key.findIndex((v, idx) => v !== bestKey[idx]) : 0;
      if (!bestKey || (at >= 0 && key[at] > bestKey[at])) { best = k; bestKey = key; }
    });
    chosen[i] = best;
    used[best]++;
  }
  for (let pass = 0; crowdedFirst && pass < 3; pass++) {
    let changed = false;
    for (const i of order) {
      const gap = k => (adjacency[i].length ? Math.min(...adjacency[i].map(j => deltaE(PALETTE[k], PALETTE[chosen[j]]))) : 1);
      if (gap(chosen[i]) >= 0.1) continue;
      let best = chosen[i];
      PALETTE.forEach((_, k) => { if (gap(k) > gap(best)) best = k; });
      if (best !== chosen[i]) { used[chosen[i]]--; used[best]++; chosen[i] = best; changed = true; }
    }
    if (!changed) break;
  }
  return chosen.map(k => colourText(PALETTE[k]));
}
