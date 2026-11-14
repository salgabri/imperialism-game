// Liquipedia's Rocket League wiki, read from an export saved by hand. No I/O, and nothing here or in the sync fetches:
// Liquipedia's robots.txt shuts Anthropic's crawlers out of the whole site (ClaudeBot, Claude-Web: "Disallow: /") and
// every bot out of api.php and index.php, and api.liquipedia.net's shuts out every bot, so the project's fetcher
// (scripts/lib/polite-fetch.mjs) refuses all of it. Instead someone saves the pages with the wiki's own Special:Export
// in their browser ("Save as file", the current revision only) into data-src/liquipedia/, and the sync reads that file
// (docs/design/rocket-league.md, "The Liquipedia export").
//
// What it reads, from each page's wikitext:
//   - the tournament (`Infobox league`): its name, tier, mode (3v3, 2v2, 1v1), dates, region and kind;
//   - its teams (`TeamCard`, or any template that names a team and numbered players `p1`, `p2`…): each player's name,
//     the page it links to and the flag it is filed under;
//   - its series (Match2's `Match` in brackets and match lists): the two teams, each game's goals, overtime, the
//     winner, the date and the format (`bestof`).
// Liquipedia's content is CC BY-SA 3.0: the game credits it wherever these ratings show (README, the setup's sources).

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** XML text with its entities decoded (`&amp;`, `&#039;`, `&#x2013;`). */
export function decodeXml(text) {
  return String(text).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code) => {
    if (code[0] === '#') {
      const value = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(value) ? String.fromCodePoint(value) : match;
    }
    return ENTITIES[code.toLowerCase()] ?? match;
  });
}

/**
 * A MediaWiki export (Special:Export's XML) → its pages, `{ title, ns, id, timestamp, text }`, in file order: the
 * current revision's wikitext of each (the last revision when the file holds more than one).
 */
export function readExport(xml) {
  const pages = [];
  for (const [, body] of String(xml).matchAll(/<page>([\s\S]*?)<\/page>/g)) {
    const title = /<title>([\s\S]*?)<\/title>/.exec(body)?.[1];
    if (title == null) continue;
    const revisions = [...body.matchAll(/<revision>([\s\S]*?)<\/revision>/g)].map(match => match[1]);
    const revision = revisions.at(-1) ?? '';
    const text = /<text\b[^>]*?(?:\/>|>([\s\S]*?)<\/text>)/.exec(revision)?.[1] ?? '';
    pages.push({
      title: decodeXml(title).trim(),
      ns: Number(/<ns>(-?\d+)<\/ns>/.exec(body)?.[1] ?? 0),
      id: Number(/<id>(\d+)<\/id>/.exec(body)?.[1] ?? 0),
      timestamp: /<timestamp>([^<]+)<\/timestamp>/.exec(revision)?.[1] ?? null,
      text: decodeXml(text),
    });
  }
  return pages;
}

/** A page title as MediaWiki compares them: underscores as spaces, single spaces, the first letter upper-cased. */
export function normalTitle(title) {
  const text = String(title ?? '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  return text ? text[0].toUpperCase() + text.slice(1) : '';
}

/** Wikitext without what never holds data: comments, references, `<nowiki>` and `noinclude` wrappers' tags. */
export function stripNoise(text) {
  return String(text ?? '')
    .replace(/<!--[\s\S]*?(?:-->|$)/g, '')
    .replace(/<ref\b[^>]*\/>/gi, '')
    .replace(/<ref\b[^>]*>[\s\S]*?<\/ref>/gi, '')
    .replace(/<\/?(?:nowiki|noinclude|includeonly|onlyinclude)\b[^>]*>/gi, '');
}

/**
 * The index just past the `}}` that closes the `{{` at `start`, or -1 when it never closes. Links (`[[…]]`) and
 * templates nest inside each other; a `]]` closes only a link, a `}}` only a template.
 */
function closeOf(text, start) {
  const stack = [];
  for (let i = start; i < text.length - 1; i++) {
    const pair = text[i] + text[i + 1];
    if (pair === '{{' || pair === '[[') { stack.push(pair); i++; continue; }
    if (pair === '}}' && stack.includes('{{')) {
      while (stack.length && stack.pop() !== '{{');
      i++;
      if (!stack.length) return i + 1;
      continue;
    }
    if (pair === ']]' && stack.at(-1) === '[[') { stack.pop(); i++; }
  }
  return -1;
}

/** `text` split at each `|` outside any nested template or link. */
function splitTop(text) {
  const parts = [];
  let depth = 0, from = 0;
  for (let i = 0; i < text.length; i++) {
    const pair = text[i] + (text[i + 1] ?? '');
    if (pair === '{{' || pair === '[[') { depth++; i++; continue; }
    if ((pair === '}}' || pair === ']]') && depth > 0) { depth--; i++; continue; }
    if (text[i] === '|' && depth === 0) { parts.push(text.slice(from, i)); from = i + 1; }
  }
  parts.push(text.slice(from));
  return parts;
}

/** The index of the first `=` outside any nested template or link, or -1. */
function equalsOf(text) {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const pair = text[i] + (text[i + 1] ?? '');
    if (pair === '{{' || pair === '[[') { depth++; i++; continue; }
    if ((pair === '}}' || pair === ']]') && depth > 0) { depth--; i++; continue; }
    if (text[i] === '=' && depth === 0) return i;
  }
  return -1;
}

/** A template's name as compared here: lower case, spaces for underscores, no "Template:" prefix. */
export const templateKey = name => String(name ?? '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim().replace(/^template:/i, '').toLowerCase();

/**
 * The templates in `text` at its top level, in order: `{ name, key, params, positional, start, end }`, `params` the
 * named parameters (trimmed, their nested templates left as text) and `positional` the unnamed ones. A template that
 * never closes ends the scan. Parser functions (`{{#if:…}}`) and magic words are kept like any other.
 */
export function parseTemplates(text) {
  const source = String(text ?? '');
  const found = [];
  let i = source.indexOf('{{');
  while (i >= 0) {
    // A template parameter of a template's own definition ({{{1}}}) is no template.
    if (source[i + 2] === '{' && source[i + 3] !== '{') {
      const close = source.indexOf('}}}', i + 3);
      i = close < 0 ? -1 : source.indexOf('{{', close + 3);
      continue;
    }
    const end = closeOf(source, i);
    if (end < 0) break;
    const [head, ...rest] = splitTop(source.slice(i + 2, end - 2));
    const params = {}, positional = [];
    for (const part of rest) {
      const at = equalsOf(part);
      if (at < 0) positional.push(part.trim());
      else params[part.slice(0, at).trim().toLowerCase()] = part.slice(at + 1).trim();
    }
    const name = head.trim();
    found.push({ name, key: templateKey(name), params, positional, start: i, end });
    i = source.indexOf('{{', end);
  }
  return found;
}

/** Every template in `text`, nested ones included (a parent before its children), each as parseTemplates gives it. */
export function allTemplates(text) {
  const out = [];
  const walk = (body, depth) => {
    if (depth > 12) return;
    for (const template of parseTemplates(body)) {
      out.push(template);
      for (const value of [...Object.values(template.params), ...template.positional]) if (value.includes('{{')) walk(value, depth + 1);
    }
  };
  walk(stripNoise(text), 0);
  return out;
}

/** The first top-level template in `value` (a parameter's text), or null. */
export const templateIn = value => parseTemplates(value ?? '')[0] ?? null;

/** A link's or a plain value's text: `[[Page|Shown]]` → "Shown", `[[Page]]` → "Page"; other markup dropped. */
export function plainText(value) {
  return String(value ?? '')
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/'''?/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Whether a wiki flag is set: anything but empty, 0, false, no or n. */
export const truthy = value => value != null && !/^\s*(?:|0|false|no|n)\s*$/i.test(String(value));

// ---------- tournaments ----------

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october',
  'november', 'december'];

/**
 * A wiki date → 'YYYY-MM-DD', or null: "2026-05-21 - 12:00 {{Abbr/CEST}}", "2026-05-21", "May 21, 2026 - 12:00",
 * "21 May 2026". A date whose day or month is unknown ("2026-05-??") keeps what it knows: "2026-05-01", "2026-01-01".
 */
export function wikiDate(value) {
  const text = plainText(String(value ?? '').replace(/\{\{[^}]*\}\}/g, ' '));
  const iso = /(\d{4})-(\d{1,2}|\?\?)-(\d{1,2}|\?\?)/.exec(text);
  const pad = n => String(n).padStart(2, '0');
  if (iso) {
    const month = iso[2] === '??' ? 1 : Number(iso[2]), day = iso[3] === '??' ? 1 : Number(iso[3]);
    return month >= 1 && month <= 12 && day >= 1 && day <= 31 ? `${iso[1]}-${pad(month)}-${pad(day)}` : null;
  }
  const lower = text.toLowerCase();
  const monthFirst = /([a-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/.exec(lower);
  const dayFirst = /(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)\.?,?\s+(\d{4})/.exec(lower);
  const [monthName, day, year] = monthFirst ? [monthFirst[1], monthFirst[2], monthFirst[3]]
    : dayFirst ? [dayFirst[2], dayFirst[1], dayFirst[3]] : [];
  const month = monthName ? MONTHS.findIndex(name => name.startsWith(monthName.slice(0, 3))) + 1 : 0;
  return month ? `${year}-${pad(month)}-${pad(Number(day))}` : null;
}

/** RLCS's regions as Liquipedia's pages name them, by the key the ratings use. */
export const REGIONS = Object.freeze({
  EU: ['europe', 'eu'],
  NA: ['north america', 'na'],
  SAM: ['south america', 'sam', 'sa'],
  MENA: ['middle east & north africa', 'middle east and north africa', 'mena', 'middle east'],
  OCE: ['oceania', 'oce'],
  APAC: ['asia-pacific', 'asia pacific', 'apac', 'asia', 'apac north', 'apac south'],
  SSA: ['sub-saharan africa', 'ssa', 'africa'],
});
const REGION_OF = new Map(Object.entries(REGIONS).flatMap(([key, names]) => names.map(name => [name, key])));

/**
 * A tournament's region: its infobox's `region`, else the region its title names ("…/2026/Europe/Open 1"), else null
 * (an international event: a major, the world championship, the Esports World Cup).
 */
export function regionOf(infobox, title) {
  const named = REGION_OF.get(plainText(infobox?.region ?? '').toLowerCase());
  if (named) return named;
  for (const segment of normalTitle(title).split('/')) {
    const key = REGION_OF.get(segment.toLowerCase());
    if (key) return key;
  }
  return null;
}

/**
 * The tournament an `Infobox league` describes → { name, tier, tierType, mode, start, end, region, type, country, city,
 * series }, or null for a page without one. `tier`: Liquipedia's `liquipediatier`, 1 (S-Tier) to 4 (C-Tier), or null;
 * `type` "Offline" for a LAN, held in `country` (as the infobox writes it: a name or a flag code).
 */
export function tournamentOf(page) {
  const infobox = parseTemplates(stripNoise(page.text)).find(template => template.key === 'infobox league');
  if (!infobox) return null;
  const p = infobox.params;
  const tier = Number(plainText(p.liquipediatier));
  return {
    name: plainText(p.name) || normalTitle(page.title),
    tier: Number.isInteger(tier) && tier > 0 ? tier : null,
    tierType: plainText(p.liquipediatiertype) || null,
    mode: (plainText(p.mode) || '3v3').toLowerCase(),
    start: wikiDate(p.sdate ?? p.date),
    end: wikiDate(p.edate ?? p.date ?? p.sdate),
    region: regionOf(p, page.title),
    type: plainText(p.type) || null,
    country: plainText(p.country) || null,
    city: plainText(p.city) || null,
    series: plainText(p.series) || null,
  };
}

// ---------- teams ----------

/** A team's name as rosters and series are matched: lower case, letters and digits only. */
export const teamKey = name => plainText(name).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, '');
/** The shorter keys a team may go by: without "team" in front, or "esports" / "gaming" / "club" behind. */
export function teamKeys(name) {
  const full = teamKey(name);
  const keys = new Set([full]);
  const bare = full.replace(/^team/, '').replace(/(?:esports?|gaming|club|gg)$/, '');
  if (bare.length >= 2) keys.add(bare);
  return [...keys].filter(Boolean);
}

// A team card's players, as Rocket League's wiki writes them (Liquipedia's Module:TeamCard/Legacy/Custom, read
// 2026-11-14 at github.com/Liquipedia/Lua-Modules): `p1` to `p3` start; `sub1` to `sub3` stand in for an empty starter's
// place; `sub4` to `sub12` are substitutes whose flag and link are `p4flag`, `p4link` and so on; `sN` are substitutes
// too; `ex`, `ex2`… are former players and `c`, `c2`… coaches, neither of whom plays. A flag is `pNflag_o` (an override)
// before `pNflag`; with neither, the wiki reads the player's own page, as the sync does (personOf).
const STARTERS = 3;
const MAX_PLACE = 12;
const BLANK = /^(?:tbd|tba|-+)$/i;
const named = template => !!template && /^(?:person|player)$/.test(template.key);

/** A card's player in `place` (`p2`, `sub5`, `s4`), or null: its name, link, flag and whether he sat out (`dnp`). */
function cardPlayer(p, place, sides = place) {
  const value = p[place];
  const inner = templateIn(value);
  const name = named(inner) ? plainText(inner.positional[0] ?? inner.params.name) : plainText(value);
  if (!name || BLANK.test(name)) return null;
  const own = suffix => p[`${sides}${suffix}`] ?? p[`${sides}_${suffix}`];
  const flag = own('flag_o') ?? own('flag') ?? (named(inner) ? inner.params.flag : undefined);
  return {
    name,
    link: plainText(own('link') ?? (named(inner) ? inner.params.link : undefined)) || null,
    flag: plainText(flag).toLowerCase() || null,
    ...(truthy(p[`${place}dnp`]) || truthy(p[`${place}_dnp`]) ? { dnp: true } : {}),
  };
}

/**
 * A legacy team card's players in order: its three places (a stand-in in an empty one counts as playing there), any
 * further `pN`, then its substitutes (`sub`); none who left (`pNleave`).
 */
function cardPlayers(p) {
  const players = [];
  for (let n = 1; n <= MAX_PLACE; n++) {
    if (truthy(p[`p${n}leave`])) continue;
    const player = cardPlayer(p, `p${n}`) ?? (n <= STARTERS ? cardPlayer(p, `sub${n}`, `p${n}`) : null);
    if (player) players.push({ ...player, sub: n > STARTERS });
  }
  for (let n = 1; n <= MAX_PLACE; n++) {
    const sub = (n > STARTERS ? cardPlayer(p, `sub${n}`, `p${n}`) : null) ?? cardPlayer(p, `s${n}`);
    if (sub) players.push({ ...sub, sub: true });
  }
  return players;
}

/** A participant's players in TeamParticipants' form: `players={{Persons|{{Person|Zen|flag=fr}}|…}}`, coaches left out. */
function personPlayers(value) {
  return allTemplates(value).filter(named).flatMap(person => {
    const name = plainText(person.positional[0] ?? person.params.name);
    const role = plainText(person.params.role ?? person.params.type).toLowerCase();
    if (!name || BLANK.test(name) || /coach|staff|manager|analyst/.test(role)) return [];
    return [{ name, link: plainText(person.params.link) || null, flag: plainText(person.params.flag).toLowerCase() || null,
      sub: /sub/.test(role) || /sub/.test(plainText(person.params.status).toLowerCase()),
      ...(person.params.played != null && !truthy(person.params.played) ? { dnp: true } : {}) }];
  });
}

/**
 * The teams a page lists → [{ team, keys, players: [{ name, link, flag, sub, dnp? }] }]: each legacy `TeamCard` (a
 * `team` and numbered players: cardPlayers) and each TeamParticipants participant (`{{Opponent|<team>|players=…}}`).
 */
export function rostersOf(text) {
  const rosters = [];
  for (const template of allTemplates(text)) {
    const p = template.params;
    let team = null, players = [];
    if (p.team && Object.keys(p).some(key => /^(?:p|s|sub)\d+$/.test(key))) {
      team = p.team;
      players = cardPlayers(p);
    } else if (p.players && (template.positional[0] || p.template || p.team)) {
      team = template.positional[0] || p.template || p.team;
      players = personPlayers(p.players);
    }
    if (!team || players.length < 2) continue;
    rosters.push({ team: plainText(team), keys: teamKeys(team), players });
  }
  return rosters;
}

/**
 * A player's own page (`Infobox player`) → { title, name, country }, or null: his in-game name (`id`) and the country
 * the wiki files him under (`country`, else `nationality`: a name or a flag code), the flag a team card without one
 * leaves to his page.
 */
export function personOf(page) {
  const infobox = parseTemplates(stripNoise(page.text)).find(template => template.key === 'infobox player');
  if (!infobox) return null;
  const p = infobox.params;
  return { title: normalTitle(page.title), name: plainText(p.id) || normalTitle(page.title),
    country: plainText(p.country ?? p.nationality ?? p.country1 ?? '').toLowerCase() || null };
}

// ---------- series ----------

/** An opponent of a series (`{{TeamOpponent|vitality|score=4}}`) → { kind, team, score }, or null for no opponent. */
export function opponentOf(value) {
  const template = templateIn(value);
  if (!template) {
    const text = plainText(value);
    return text ? { kind: 'literal', team: text, score: null } : null;
  }
  const kind = template.key.replace(/opponent$/, '') || 'team';
  const team = plainText(template.positional[0] ?? template.params.template ?? template.params.team ?? template.params.name ?? '');
  return { kind, team, score: template.params.score != null ? plainText(template.params.score) : null };
}

/** A game of a series (`{{Map|score1=3|score2=2|ot=true|winner=1}}`) → { goals: [a, b], winner: 1 | 2, ot }, or null. */
export function gameOf(value) {
  const template = templateIn(value);
  if (!template) return null;
  const p = template.params;
  const goals = [Number(plainText(p.score1)), Number(plainText(p.score2))];
  const scored = goals.every(n => Number.isInteger(n) && n >= 0);
  const named = Number(plainText(p.winner));
  const winner = named === 1 || named === 2 ? named : scored && goals[0] !== goals[1] ? (goals[0] > goals[1] ? 1 : 2) : null;
  if (!winner) return null;
  const ot = truthy(p.ot) || truthy(p.overtime) || !!plainText(p.otlength);
  return { goals: scored ? goals : null, winner, ot, ...(plainText(p.otlength) ? { otLength: plainText(p.otlength) } : {}) };
}

/**
 * Every series a page plays (Match2's `{{Match}}`) → [{ opponents: [a, b], games, winner, bestOf, date, walkover }]:
 * `games` each game played, in order; `winner` 1 or 2 (the games' or the match's own `winner`); `walkover` true for a
 * forfeit, whose games are none. A series with an opponent still to be decided, or neither games nor a result, is left out.
 */
export function seriesOf(text) {
  const out = [];
  for (const template of allTemplates(text)) {
    if (template.key !== 'match') continue;
    const p = template.params;
    const opponents = [opponentOf(p.opponent1), opponentOf(p.opponent2)];
    if (opponents.some(opponent => !opponent || !opponent.team)) continue;
    const games = [];
    for (let k = 1; k <= 15; k++) {
      const game = p[`map${k}`] ?? p[`game${k}`];
      if (game == null) continue;
      const played = gameOf(game);
      if (played) games.push(played);
    }
    const won = side => games.filter(game => game.winner === side).length;
    // A forfeit: an opponent scored W (the side that went through), FF, L or DQ, or the match names its `walkover` winner.
    const marks = opponents.map(opponent => String(opponent.score ?? '').trim().toUpperCase());
    const walkover = Number(plainText(p.walkover));
    const forfeit = marks.some(mark => ['W', 'FF', 'L', 'DQ', '-'].includes(mark)) || walkover === 1 || walkover === 2;
    const scores = opponents.map(opponent => (/^\d+$/.test(opponent.score ?? '') ? Number(opponent.score) : NaN));
    const named = Number(plainText(p.winner));
    const winner = named === 1 || named === 2 ? named
      : walkover === 1 || walkover === 2 ? walkover
        : marks.includes('W') ? marks.indexOf('W') + 1
          : forfeit && marks.some(mark => ['FF', 'L', 'DQ'].includes(mark)) ? (['FF', 'L', 'DQ'].includes(marks[0]) ? 2 : 1)
            : won(1) !== won(2) ? (won(1) > won(2) ? 1 : 2)
              : scores.every(Number.isInteger) && scores[0] !== scores[1] ? (scores[0] > scores[1] ? 1 : 2) : null;
    if (!winner) continue;
    const bestOf = Number(plainText(p.bestof));
    out.push({
      opponents: opponents.map(opponent => ({ kind: opponent.kind, team: opponent.team })),
      games: forfeit ? [] : games,
      winner,
      bestOf: Number.isInteger(bestOf) && bestOf > 0 ? bestOf : null,
      date: wikiDate(p.date),
      walkover: forfeit,
    });
  }
  return out;
}

// ---------- pages that hold a tournament's series ----------

// A tournament's subpages that hold no series of their own: standings, statistics, media and the like.
const NOT_A_STAGE = /\/(?:rankings|statistics|stats|additional content|points|qualification|participants|media|broadcasts?|teams?|players?|prize ?pool|schedule|transfers?|news|results overview|vods|patch|maps|history)(?:\/|$)/i;

/** Whether a subpage title may hold a stage's series (a group, the Swiss stage, the playoffs), not a page about the event. */
export const isStagePage = title => !NOT_A_STAGE.test(title);

/**
 * The subpages a tournament page links to (its stages: "…/Swiss Stage", "…/Playoffs"), by normalised title: every link or
 * tab target under the page's own title.
 */
export function subpagesOf(page) {
  const own = normalTitle(page.title);
  const found = new Set();
  const consider = target => {
    const title = normalTitle(String(target).split('#')[0]);
    if (title.startsWith(`${own}/`)) found.add(title);
    else if (title.startsWith('/') && title.length > 1) found.add(normalTitle(`${own}${title}`));
  };
  const text = stripNoise(page.text);
  for (const [, target] of text.matchAll(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)) consider(target);
  for (const template of allTemplates(text)) {
    if (!/^tabs/.test(template.key)) continue;
    for (const [key, value] of Object.entries(template.params)) if (/^link\d+$/.test(key)) consider(plainText(value));
  }
  return found;
}

/** The tournament page a page belongs to: the nearest page above it (or itself) with an infobox, among `byTitle`. */
export function rootOf(title, byTitle) {
  let at = normalTitle(title);
  for (;;) {
    const page = byTitle.get(at);
    if (page?.tournament) return page;
    const cut = at.lastIndexOf('/');
    if (cut < 0) return null;
    at = at.slice(0, cut);
  }
}
