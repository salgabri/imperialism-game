// Writing a domestic map file (docs/design/domestic-campaigns.md, "Output"): club
// colours that differ from their neighbours', the content-hash version and the
// one-line-per-geometry layout. Shared by scripts/build-domestic.mjs and
// scripts/build-nba-map.mjs.
import { createHash } from 'node:crypto';

// Two lightness levels over a 24-step hue wheel; greedy over the section graph so
// neighbours (and, where possible, neighbours of neighbours) differ clearly.
const PALETTE = [0.74, 0.6].flatMap(l => Array.from({ length: 24 }, (_, i) => ({ l, c: 0.15, h: i * 15 })));
const lab = ({ l, c, h }) => [l, c * Math.cos(h * Math.PI / 180), c * Math.sin(h * Math.PI / 180)];
const deltaE = (a, b) => { const p = lab(a), q = lab(b); return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); };
const colourText = ({ l, c, h }) => `oklch(${l.toFixed(2)} ${c.toFixed(2)} ${h})`;

/** One OKLCH colour per club, greedily in rank order over `adjacency` (club index -> neighbouring club indices). */
export function colourSections(adjacency) {
  const chosen = new Array(adjacency.length).fill(-1);
  const used = new Array(PALETTE.length).fill(0);
  for (let i = 0; i < adjacency.length; i++) {
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
  return chosen.map(k => colourText(PALETTE[k]));
}

/** Version hash: sha256 of the document without its version field, as compact JSON. */
export function contentHash(doc) {
  const { version, ...rest } = doc;
  return createHash('sha256').update(JSON.stringify(rest)).digest('hex').slice(0, 8);
}

/** One top-level field per line; arcs, geometries and clubs one per line for readable diffs. */
export function serialize(doc) {
  const { topology: t, clubs, ...head } = doc;
  const lines = Object.entries(head).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`);
  const { arcs, objects, ...topoHead } = t;
  const sections = objects.sections;
  const topo = `{${Object.entries(topoHead).map(([k, v]) => `${JSON.stringify(k)}:${JSON.stringify(v)}`).join(',')},`
    + `"objects":{"sections":{"type":${JSON.stringify(sections.type)},"geometries":[\n${sections.geometries.map(g => JSON.stringify(g)).join(',\n')}\n]}},`
    + `"arcs":[\n${arcs.map(a => JSON.stringify(a)).join(',\n')}\n]}`;
  lines.push(`"topology": ${topo}`);
  lines.push(`"clubs": [\n${clubs.map(c => JSON.stringify(c)).join(',\n')}\n]`);
  const text = `{\n${lines.join(',\n')}\n}\n`;
  // The layout must round-trip to the hashed document exactly.
  if (JSON.stringify(JSON.parse(text)) !== JSON.stringify(doc)) throw new Error('serialize does not round-trip');
  return text;
}
