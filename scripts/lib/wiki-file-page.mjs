// A Wikipedia file page (/wiki/File:…, which robots.txt allows), read for the facts the Wikipedia API's answers gave
// about a file, for scripts/sync-club-logos.mjs's "pages" crests: the address of the file's original on
// upload.wikimedia.org, the page's own address, and the licence its licence template states. English Wikipedia's by
// default; another language's (`wiki`, as 'it' or 'fr') where only that Wikipedia has a club's crest of today.

const unescapeHtml = text => text.replace(/&quot;/g, '"').replace(/&#0?39;/g, '\'').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
/** A file's name as Wikipedia shows it: no 'File:', spaces for underscores, no percent escapes. */
const fileName = name => decodeURIComponent(String(name)).replace(/^File:/, '').replace(/_/g, ' ');
const WIKI = /^[a-z]{2,3}$/;

/** The address of a file's page on a Wikipedia (`name` as Wikipedia shows it; `wiki` its language, English by default). */
export function filePageUrl(name, wiki = 'en') {
  if (!WIKI.test(wiki)) throw new Error(`not a Wikipedia language: ${wiki}`);
  return `https://${wiki}.wikipedia.org/wiki/${encodeURIComponent(`File:${name.replace(/ /g, '_')}`).replace(/%3A/g, ':')}`;
}

/**
 * What a file page's HTML says about the file `name`: { original, page, licence, nonFree }. `original` is the address of
 * the file's current version, the page's link to it on upload.wikimedia.org (that Wikipedia's own upload or Commons'),
 * without the tracking parameters (?utm_source=…) the page adds: never a thumbnail, an archived version or another
 * file. `page` is the page's canonical address. The licence is its template's licensetpl data, which the API's
 * extmetadata reads too (LicenseShortName; NonFree when licensetpl_nonfree says true). Throws unless the page links
 * exactly one original of that name and has a canonical link and a licence template.
 */
export function filePageFacts(html, name, wiki = 'en') {
  if (!WIKI.test(wiki)) throw new Error(`not a Wikipedia language: ${wiki}`);
  const own = new RegExp(`href="((?:https:)?//upload\\.wikimedia\\.org/wikipedia/(?:${wiki}|commons)/[0-9a-f]/[0-9a-f]{2}/([^"/?#]+))(?:\\?[^"#]*)?"`, 'g');
  const originals = new Set([...html.matchAll(own)]
    .filter(([, , file]) => fileName(file) === name).map(([, href]) => `https:${href.replace(/^https:/, '')}`));
  const page = /<link rel="canonical" href="([^"]+)"/.exec(html)?.[1];
  const licence = /class="licensetpl_short[^"]*"[^>]*>([^<]+)</.exec(html)?.[1]?.trim();
  if (originals.size !== 1) throw new Error(`${originals.size} links to the original of ${name}, not one`);
  if (!page) throw new Error(`no canonical link on ${name}'s file page`);
  if (!licence) throw new Error(`no licence template on ${name}'s file page`);
  return {
    original: [...originals][0],
    page: unescapeHtml(page),
    licence: unescapeHtml(licence),
    nonFree: /class="licensetpl_nonfree[^"]*"[^>]*>\s*true\s*</.test(html),
  };
}
