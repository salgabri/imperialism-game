// Writing a domestic map file (docs/design/domestic-campaigns.md, "Output"): club
// colours that differ from their neighbours', the content-hash version and the
// one-line-per-geometry layout. Shared by scripts/build-domestic.mjs and
// scripts/build-nba-map.mjs.
import { createHash } from 'node:crypto';

// The club colours are the game's own (src/engine/colour.js): the browser cuts a map to fewer clubs with them too.
export { colourSections } from '../../src/engine/colour.js';

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
  // Every object (the sections, and the NBA map's empty land), one geometry per line.
  const objectText = Object.entries(objects).map(([name, o]) => `${JSON.stringify(name)}:{"type":${JSON.stringify(o.type)},"geometries":[\n`
    + `${o.geometries.map(g => JSON.stringify(g)).join(',\n')}\n]}`).join(',');
  const topo = `{${Object.entries(topoHead).map(([k, v]) => `${JSON.stringify(k)}:${JSON.stringify(v)}`).join(',')},`
    + `"objects":{${objectText}},`
    + `"arcs":[\n${arcs.map(a => JSON.stringify(a)).join(',\n')}\n]}`;
  lines.push(`"topology": ${topo}`);
  lines.push(`"clubs": [\n${clubs.map(c => JSON.stringify(c)).join(',\n')}\n]`);
  const text = `{\n${lines.join(',\n')}\n}\n`;
  // The layout must round-trip to the hashed document exactly.
  if (JSON.stringify(JSON.parse(text)) !== JSON.stringify(doc)) throw new Error('serialize does not round-trip');
  return text;
}
