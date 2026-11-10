// Wikidata's facts by SPARQL, from QLever's Wikidata endpoint (https://qlever.dev/api/wikidata: the University of
// Freiburg's engine over the whole Wikidata dump, refreshed from Wikidata's own dumps; qlever.dev has no robots.txt).
// The Wikidata Query Service, query.wikidata.org/sparql, is disallowed for every agent by its robots.txt, and so is
// Wikidata's own API under www.wikidata.org/w/ (both read 2026-11-10).
//
// The scripts still write each query as the Query Service took it, and that text still keys their caches, so a cache
// filled from the Query Service stays valid. QLever is sent the same query (forQlever) with the Query Service's
// prefixes declared, Blazegraph's query hints dropped, and the patterns before a top-level UNION moved into each of
// its branches: the same answers, but QLever evaluates a UNION's branches before joining them to anything, so a branch
// such as `?p rdfs:label ?name` would otherwise read every label in Wikidata and time out (QLever answers a timeout
// with HTTP 429).
import { politeFetch } from './polite-fetch.mjs';

export const WIKIDATA_SPARQL = 'https://qlever.dev/api/wikidata';

// The prefixes the Query Service declares for every query; QLever needs them written out.
const PREFIXES = {
  wd: 'http://www.wikidata.org/entity/',
  wdt: 'http://www.wikidata.org/prop/direct/',
  wikibase: 'http://wikiba.se/ontology#',
  p: 'http://www.wikidata.org/prop/',
  ps: 'http://www.wikidata.org/prop/statement/',
  psv: 'http://www.wikidata.org/prop/statement/value/',
  pq: 'http://www.wikidata.org/prop/qualifier/',
  rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
  rdfs: 'http://www.w3.org/2000/01/rdf-schema#',
  skos: 'http://www.w3.org/2004/02/skos/core#',
  schema: 'http://schema.org/',
  xsd: 'http://www.w3.org/2001/XMLSchema#',
};
const PROLOGUE = Object.entries(PREFIXES).map(([prefix, iri]) => `PREFIX ${prefix}: <${iri}>\n`).join('');
// Blazegraph's query hints, such as `hint:Query hint:optimizer "None" .`: no other engine reads them.
const HINT = /hint:\w+\s+hint:\w+\s+(?:"[^"]*"|[^\s.]+)\s*\.\s*/g;

/** The index of the quote closing the string literal that opens at `start`. */
function endOfString(text, start) {
  const quote = text[start];
  for (let i = start + 1; i < text.length; i++) {
    if (text[i] === '\\') i++;
    else if (text[i] === quote) return i;
  }
  return text.length;
}

/** The index of the brace closing the one at `open` (string literals skipped), or -1. */
function closing(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const char = text[i];
    if (char === '"' || char === "'") i = endOfString(text, i);
    else if (char === '{') depth++;
    else if (char === '}' && --depth === 0) return i;
  }
  return -1;
}

/**
 * `WHERE { HEAD { A } UNION { B } … TAIL }`, where HEAD is only VALUES blocks and triple patterns, as
 * `WHERE { { HEAD A } UNION { HEAD B } … TAIL }`: the same solutions, since a join distributes over a union. Any
 * other query comes back as it is.
 */
export function spreadHead(query) {
  const where = /\bWHERE\s*\{/i.exec(query);
  if (!where) return query;
  const open = where.index + where[0].length - 1;
  const close = closing(query, open);
  if (close < 0) return query;
  const inner = query.slice(open + 1, close);
  const blocks = []; // the group's top-level { … } blocks, each marked when it is a VALUES block's
  for (let i = 0; i < inner.length; i++) {
    const char = inner[i];
    if (char === '"' || char === "'") { i = endOfString(inner, i); continue; }
    if (char !== '{') continue;
    const end = closing(inner, i);
    if (end < 0) return query;
    blocks.push({ start: i, end, values: /\bVALUES\s+(?:\?\w+|\([^)]*\))\s*$/i.test(inner.slice(0, i)) });
    i = end;
  }
  const first = blocks.findIndex(block => !block.values);
  if (first < 0) return query;
  const chain = [blocks[first]];
  for (let k = first + 1; k < blocks.length && /^\s*UNION\s*$/i.test(inner.slice(chain.at(-1).end + 1, blocks[k].start)); k++) chain.push(blocks[k]);
  const head = inner.slice(0, chain[0].start).trim();
  const unsafe = /\b(?:FILTER|OPTIONAL|BIND|MINUS|SERVICE|GRAPH|UNION|SELECT)\b/i;
  if (chain.length < 2 || !head || unsafe.test(head.replace(/\bVALUES\s+[^{]*\{[^}]*\}/gi, ''))) return query;
  const joined = /[.}]$/.test(head) ? head : `${head} .`;
  const branches = chain.map(block => `{ ${joined} ${inner.slice(block.start + 1, block.end).trim()} }`);
  return `${query.slice(0, open + 1)}\n  ${branches.join(' UNION ')}${inner.slice(chain.at(-1).end + 1)}${query.slice(close)}`;
}

/** A query written for the Query Service, as QLever is sent it (see the top of this file). */
export const forQlever = query => PROLOGUE + spreadHead(query.replace(HINT, ''));

/** The fetch options that ask QLever `query` (a Query Service text) for SPARQL JSON results. */
export const sparqlRequest = query => ({
  method: 'POST',
  headers: { accept: 'application/sparql-results+json', 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ query: forQlever(query) }).toString(),
});

/** One query's SPARQL JSON results (`{ head, results }`); a non-2xx answer throws with `status` set. */
export async function askWikidata(query, { signal } = {}) {
  const response = await politeFetch(WIKIDATA_SPARQL, { ...sparqlRequest(query), signal });
  const text = await response.text();
  if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status} from ${WIKIDATA_SPARQL}: ${text.slice(0, 200)}`), { status: response.status });
  return JSON.parse(text);
}
