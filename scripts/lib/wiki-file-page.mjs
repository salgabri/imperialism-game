// A Wikipedia file page (/wiki/File:…, which robots.txt allows), read for the facts the Wikipedia API's answers gave
// about a file, for scripts/sync-club-logos.mjs's "pages" crests: the address of the file's original on
// upload.wikimedia.org, the page's own address, and the licence its licence template states. English Wikipedia's by
// default; another language's (`wiki`, as 'it' or 'fr') where only that Wikipedia has a club's crest of today.

const unescapeHtml = text => text.replace(/&quot;/g, '"').replace(/&#0?39;/g, '\'').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
/** A file's name as Wikipedia shows it: no 'File:', spaces for underscores, no percent escapes. */
const fileName = name => decodeURIComponent(String(name)).replace(/^File:/, '').replace(/_/g, ' ');
const WIKI = /^[a-z]{2,3}$/;

const licenceKey = licence => String(licence).normalize('NFC').toLowerCase().replace(/[\s_-]+/g, ' ').trim();
// The licence names that say a file is not free, as the crests' file pages give them (licensetpl_short). Most
// Wikipedias' non-free templates also mark it in their licensetpl data (licensetpl_nonfree), but some carry no such
// marker: the fair-use templates of Lithuanian, Hebrew, Ukrainian, Greek, Portuguese, Moroccan Arabic, Finnish and
// Latvian Wikipedia, and the templates Italian ("Marchio", "Copyrighted") and French ("marque déposée") Wikipedia use
// for the logos they keep under their exemption doctrine, whose pages file them among the non-free images. German
// Wikipedia's "Logo" is free: a logo below the threshold of originality, which only trademark law protects.
const NON_FREE_LICENCES = new Set([
  'Fair use', // English, Arabic and Finnish Wikipedia (fair use), Latvian (Fair-use)
  'Sąžiningo naudojimo', // Lithuanian
  'שימוש הוגן בסמליל', // Hebrew: fair use of a logo
  'Добропорядне використання', // Ukrainian
  'Добрасумленнае выкарыстанне', // Belarusian
  'Добросовестное использование', // Russian
  'Εύλογη χρήση', // Greek
  'Conteúdo restrito', // Portuguese
  'Utilizare cinstită', // Romanian (its marker says "yes")
  'تخدام مقبول', // Moroccan Arabic, as its template shows it
  'استعمال عادل', // Arabic
  'استفادهٔ منصفانه', // Persian
  'Adil kullanım', // Turkish
  'Insofli foydalanish', // Uzbek
  'Penggunaan wajar', // Indonesian
  'Kegunaan wajar', // Malay
  'Poštena upotreba', // Serbian
  'Vörumerki, engin markaðsnotkun', // Icelandic
  'Marchio', // Italian
  'Copyrighted', // Italian: permission for Wikipedia only
  'marque déposée', // French
].map(licenceKey));

/** Whether a licence name (a licence template's licensetpl_short) says the file is not free. */
export const nonFreeLicence = licence => NON_FREE_LICENCES.has(licenceKey(licence));

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
 * extmetadata reads too (LicenseShortName; NonFree when licensetpl_nonfree says true). The file is non-free when that
 * marker says so (true, or Romanian Wikipedia's yes) or its licence's name does (NON_FREE_LICENCES above), since several
 * Wikipedias' fair-use templates have no marker. Throws unless the page links exactly one original of that name and has
 * a canonical link and a licence template.
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
  const marked = /class="licensetpl_nonfree[^"]*"[^>]*>\s*(?:true|yes)\s*</i.test(html);
  return {
    original: [...originals][0],
    page: unescapeHtml(page),
    licence: unescapeHtml(licence),
    nonFree: marked || nonFreeLicence(unescapeHtml(licence)),
  };
}
