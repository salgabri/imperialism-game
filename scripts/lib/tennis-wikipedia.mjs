// The women's game before the open era, from English Wikipedia's article pages (docs/design/womens-tennis.md,
// "1963–1967"): the four majors' women's singles draws and the Federation Cup's ties. Wikipedia serves an article as
// Parsoid HTML, where each bracket and each tie is a template whose wikitext sits in a `data-mw` attribute, so the
// draws are read from the templates' own parameters, not from the rendered table. No I/O:
// scripts/sync-tennis-seasons.mjs reads the pinned pages and passes their text in.

const ENTITIES = { quot: '"', lt: '<', gt: '>', apos: "'", amp: '&', nbsp: ' ' };
const decode = text => String(text).replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (match, name) => {
  if (name[0] === '#') return String.fromCodePoint(name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : Number(name.slice(1)));
  return ENTITIES[name.toLowerCase()] ?? match;
});

/** The article a page shows: its title (spaces, not underscores), revision, and the title it was reached by when that redirects. */
export function pageOf(html) {
  const revision = Number(/"wgRevisionId":(\d+)/.exec(html)?.[1]);
  const name = /"wgPageName":"((?:[^"\\]|\\.)*)"/.exec(html)?.[1];
  if (!Number.isInteger(revision) || revision <= 0 || name == null) throw new Error('The page names no revision: is it a saved Wikipedia article?');
  const from = /"wgRedirectedFrom":"((?:[^"\\]|\\.)*)"/.exec(html)?.[1];
  const title = raw => JSON.parse(`"${raw}"`).replace(/_/g, ' ');
  return { title: title(name), revision, redirectedFrom: from == null ? null : title(from) };
}

/** Every template of the page's `data-mw` attributes, in page order: `{ name, params }`, each parameter its wikitext. */
export function templatesOf(html) {
  const out = [];
  for (const match of String(html).matchAll(/data-mw='([^']*)'/g)) {
    let json;
    try { json = JSON.parse(decode(match[1])); } catch { continue; }
    for (const part of json.parts || []) {
      if (!part.template) continue;
      out.push({ name: part.template.target.wt.trim(), params: Object.fromEntries(Object.entries(part.template.params || {}).map(([key, value]) => [key, value.wt])) });
    }
  }
  return out;
}

/** A name for comparing: letters only, lower case, without diacritics, single spaces. */
export const plainName = text => String(text ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/\([^)]*\)/g, ' ').replace(/[^a-z\s'-]/g, ' ').replace(/['-]/g, ' ').replace(/\s+/g, ' ').trim();

/** A link target as Wikipedia files it: underscores as spaces, single spaces, the first letter upper case. */
export const titleOf = text => {
  const t = decode(String(text)).replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
};

/**
 * What each linked title of the page is, from its rendered links: 'article', 'redirect' (`mw-redirect`) or 'missing' (a
 * red link, "… (page does not exist)") → Map(title → kind).
 */
export function linkKinds(html) {
  const kinds = new Map();
  for (const match of String(html).matchAll(/<a [^>]*rel="mw:WikiLink"[^>]*>/g)) {
    const tag = match[0];
    const classes = /class="([^"]*)"/.exec(tag)?.[1] ?? '';
    const raw = /title="([^"]*)"/.exec(tag)?.[1];
    if (raw == null || /\bmw-selflink\b/.test(classes)) continue;
    const missing = /\bnew\b/.test(classes);
    const title = titleOf(missing ? decode(raw).replace(/ \(page does not exist\)$/, '') : raw);
    kinds.set(title, missing ? 'missing' : /\bmw-redirect\b/.test(classes) ? 'redirect' : 'article');
  }
  return kinds;
}

const stripMarkup = text => decode(String(text ?? ''))
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/<ref\b[^>]*\/>|<ref\b[\s\S]*?<\/ref>/gi, '');

/**
 * A draw's or a tie's player cell (wikitext) → `{ flag, link, name, bold }`, or null for an empty slot (a bye). `flag`
 * is the flag template's first parameter (an IOC-like code or a country's name), `link` the linked article's title
 * (null for a name written without a link), `name` the name as the cell shows it, `bold` whether the cell marks the
 * winner.
 */
export function playerCell(wikitext) {
  let text = stripMarkup(wikitext).trim();
  if (!text) return null;
  const bold = /'''/.test(text);
  const flag = /\{\{\s*(?:flagicon|flagathlete|flag|flagcountry)\s*\|\s*([^|}]+)/i.exec(text)?.[1]?.trim() ?? null;
  text = text.replace(/\{\{[^{}]*\}\}/g, ' ').replace(/'''|''/g, '').replace(/<[^>]+>/g, ' ');
  const link = /\[\[([^\]|]+)(?:\|([^\]]*))?\]\]([^\s[\]]*)/.exec(text);
  let name;
  if (link) name = `${(link[2] ?? link[1]).trim()}${link[3] ?? ''}`;
  else name = text;
  name = name.replace(/\[\[|\]\]/g, '').replace(/\s*\((?:Q|LL|WC|PR|SE|A)\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
  if (!name || /^bye$/i.test(name)) return null;
  return { flag, link: link ? titleOf(link[1]) : null, name, bold };
}

const scoreText = wikitext => stripMarkup(wikitext).replace(/'''|''/g, '').replace(/<sup>\s*r(?:et)?\.?\s*<\/sup>/gi, ' ret')
  .replace(/<[^>]+>/g, ' ').replace(/\{\{[^{}]*\}\}/g, ' ').replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1').replace(/\s+/g, ' ').trim();

// A score that shows the match was not played out: a walkover, a retirement, a default, an abandoned match.
const UNPLAYED = /\bw\/?o\b|walk-?over|\bret(?:ired|\.)?(?![a-z])|\bdef(?:ault)?\b|\bn\/?p\b|\babd\b|unfinished|\bscr(?:atched)?\b/i;
// The round a bracket's round is, by the players it starts with.
const CODE_OF_PLAYERS = { 128: 'R128', 64: 'R64', 32: 'R32', 16: 'R16', 8: 'QF', 4: 'SF', 2: 'F' };
const PLAYERS_OF_LABEL = [[/^quarter-?finals?$/i, 8], [/^semi-?finals?$/i, 4], [/^finals?$/i, 2]];

/** Sets won by each side of a score's cells: `[a, b]`, a set counted where one side's games are more. */
function setsWon(a, b) {
  let wa = 0, wb = 0;
  a.forEach((x, k) => {
    const ga = parseInt(x, 10), gb = parseInt(b[k], 10);
    if (Number.isFinite(ga) && Number.isFinite(gb)) { if (ga > gb) wa++; else if (gb > ga) wb++; }
  });
  return [wa, wb];
}

/**
 * A draw page's singles matches, from its bracket templates (`<N>TeamBracket…`): the finals bracket (8 lines:
 * quarter-finals, semi-finals, final) and the sections of the draw. A section's rounds are numbered back from its last:
 * a "Quarterfinals" or "Semifinals" label says which it is, and a last round of another name ("Fourth round") is the
 * one before the finals bracket's quarter-finals. A match a section and the finals bracket both show is kept once.
 * → `[{ round, a, b, winner: 0 | 1, score, unplayed, slot }]` in page order, `round` 'R128' … 'F'.
 */
export function drawMatches(html) {
  const brackets = templatesOf(html).filter(t => /^\d+TeamBracket/i.test(t.name));
  const matches = [], seen = new Map();
  // One match of one round between two surnames: the finals bracket may link a woman otherwise than her section does.
  const surname = cell => plainName(cell.name).split(' ').at(-1);
  const key = (round, a, b) => `${round}|${[surname(a), surname(b)].sort().join('|')}`;
  for (const t of brackets) {
    const size = Number(/^(\d+)TeamBracket/i.exec(t.name)[1]);
    const rounds = Math.round(Math.log2(size));
    const label = r => scoreText(t.params[`RD${r}`] ?? '').replace(/<br\s*\/?>.*$/i, '').trim();
    const finals = size === 8 && rounds === 3;
    // The players the bracket's last round starts with.
    const lastLabel = label(rounds);
    const lastPlayers = finals ? 2 : PLAYERS_OF_LABEL.find(([re]) => re.test(lastLabel))?.[1] ?? 16;
    for (let r = 1; r <= rounds; r++) {
      const players = lastPlayers * 2 ** (rounds - r);
      const round = CODE_OF_PLAYERS[players];
      if (!round) throw new Error(`${t.name}: round ${r} would start with ${players} players`);
      const slots = size / 2 ** (r - 1);
      const slotKey = i => [String(i).padStart(2, '0'), String(i)].find(pad => `RD${r}-team${pad}` in t.params) ?? null;
      for (let i = 1; i <= slots; i += 2) {
        const ka = slotKey(i), kb = slotKey(i + 1);
        if (!ka || !kb) continue;
        const a = playerCell(t.params[`RD${r}-team${ka}`]), b = playerCell(t.params[`RD${r}-team${kb}`]);
        if (!a || !b) continue;
        const sa = [1, 2, 3, 4, 5].map(s => scoreText(t.params[`RD${r}-score${ka}-${s}`])).filter(Boolean);
        const sb = [1, 2, 3, 4, 5].map(s => scoreText(t.params[`RD${r}-score${kb}-${s}`])).filter(Boolean);
        const score = sa.map((x, k) => `${x}-${sb[k] ?? ''}`).join(' ');
        const cells = `${t.params[`RD${r}-team${ka}`]} ${t.params[`RD${r}-team${kb}`]}`;
        const unplayed = UNPLAYED.test(`${sa.join(' ')} ${sb.join(' ')}`) || /\(\s*w\/?o\s*\)|\bw\/o\b|\bwalkover\b/i.test(stripMarkup(cells)) || !/\d/.test(score);
        let winner = a.bold && !b.bold ? 0 : b.bold && !a.bold ? 1 : null;
        if (winner == null) {
          const [wa, wb] = setsWon(sa, sb);
          if (wa !== wb) winner = wa > wb ? 0 : 1;
        }
        const id = key(round, a, b);
        const shown = seen.get(id);
        if (shown) {
          // The same match shown twice must agree on who won it.
          const sameWinner = surname([shown.a, shown.b][shown.winner] ?? {}) === surname([a, b][winner] ?? {});
          if (shown.unplayed !== unplayed || !sameWinner) throw new Error(`${round} ${a.name} v ${b.name}: shown twice with different results`);
          continue;
        }
        const match = { round, a, b, winner, score, unplayed, slot: `${t.name} RD${r}-${ka}` };
        seen.set(id, match);
        matches.push(match);
      }
    }
  }
  return matches;
}

/** A TennisMatch template's wikitext → `{ t1, t2, s1, s2 }`: each side's players (cells) and set scores. */
export function tennisMatch(wikitext) {
  const body = /\{\{\s*TennisMatch\d*\s*\|([\s\S]*)\}\}\s*$/i.exec(String(wikitext ?? '').trim())?.[1];
  if (!body) return null;
  // The parameters, split on the bars outside [[links]] and {{templates}}.
  const parts = [];
  let depth = 0, current = '';
  for (let i = 0; i < body.length; i++) {
    const two = body.slice(i, i + 2);
    if (two === '[[' || two === '{{') { depth++; current += two; i++; continue; }
    if (two === ']]' || two === '}}') { depth--; current += two; i++; continue; }
    if (body[i] === '|' && depth === 0) { parts.push(current); current = ''; continue; }
    current += body[i];
  }
  parts.push(current);
  const t1 = [], t2 = [], s1 = [], s2 = [];
  let side = 0;
  for (const raw of parts.map(part => part.trim())) {
    const named = /^T([12])P(\d)\s*=\s*([\s\S]*)$/.exec(raw);
    if (named) { side = Number(named[1]); (side === 1 ? t1 : t2).push(playerCell(named[3])); continue; }
    if (side === 1) s1.push(scoreText(raw)); else if (side === 2) s2.push(scoreText(raw));
  }
  return { t1: t1.filter(Boolean), t2: t2.filter(Boolean), s1: s1.filter(Boolean), s2: s2.filter(Boolean) };
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/**
 * A date as a page writes it ("17 June 1963", "June 17, 1963", "17–20 June 1963": the first day) → yyyymmdd, or null.
 * `year` fills in a date written without one.
 */
export function dateOf(text, year = null) {
  const t = scoreText(text).toLowerCase();
  // The month the text names first.
  const month = MONTHS.map((m, i) => [new RegExp(`\\b${m}\\b`).exec(t)?.index ?? Infinity, i]).sort((a, b) => a[0] - b[0])[0];
  if (month[0] === Infinity) return null;
  return dayOf(t, month[1], year);
}

function dayOf(t, month, year) {
  const y = Number(/\b(1[89]\d\d|20\d\d)\b/.exec(t)?.[1] ?? year);
  const before = new RegExp(`\\b(\\d{1,2})(?:\\s*[–-]\\s*\\d{1,2})?\\s+${MONTHS[month]}\\b`).exec(t);
  const after = new RegExp(`\\b${MONTHS[month]}\\s+(\\d{1,2})\\b`).exec(t);
  const day = Number(before?.[1] ?? after?.[1]);
  if (!y || !day) return null;
  return y * 10000 + (month + 1) * 100 + day;
}

/**
 * A tournament article's first day of its women's singles (yyyymmdd), from its infobox's date (`TennisEventInfo`, or
 * Wimbledon's `Infobox tennis tournament year`): where the field gives the doubles' and the singles' weeks apart (the
 * U.S. Championships of 1960), the part its note says is the singles'.
 */
export function eventStart(html, year) {
  const box = templatesOf(html).find(t => /^(TennisEventInfo|Infobox tennis tournament year)$/i.test(t.name));
  if (!box?.params.date) return null;
  const parts = box.params.date.split(/<br\s*\/?>/i);
  const singles = parts.find(part => /\{\{efn[^}]*singles/i.test(part)) ?? parts[0];
  return dateOf(singles.replace(/\{\{efn[^}]*\}\}/gi, ' '), year);
}

/**
 * A Federation Cup page's ties (`FedCupbox` templates), in page order → `[{ team1, team2, date, rubbers }]`, each rubber
 * `{ no, doubles, t1, t2, winner: 0 | 1 | null, score, unplayed }` (rubbers 1 and 2 the singles, 3 the doubles).
 */
export function cupTies(html, year) {
  return templatesOf(html).filter(t => /^FedCupbox/i.test(t.name)).map(t => {
    const rubbers = [];
    for (const no of [1, 2, 3, 4, 5]) {
      const m = tennisMatch(t.params[`R${no}`]);
      if (!m || !m.t1.length || !m.t2.length) continue;
      const [w1, w2] = setsWon(m.s1, m.s2);
      const unplayed = UNPLAYED.test(`${m.s1.join(' ')} ${m.s2.join(' ')}`) || (!w1 && !w2);
      rubbers.push({ no, doubles: m.t1.length > 1 || m.t2.length > 1, t1: m.t1, t2: m.t2, winner: w1 > w2 ? 0 : w2 > w1 ? 1 : null,
        score: m.s1.map((x, k) => `${x}-${m.s2[k] ?? ''}`).join(' '), unplayed });
    }
    return { team1: scoreText(t.params.team1), team2: scoreText(t.params.team2), date: dateOf(t.params.date ?? '', year), rubbers };
  });
}

// ---------- the women of the pages, and their matches ----------

const ROUND_CODES = ['R128', 'R64', 'R32', 'R16', 'QF', 'SF', 'F'];

/**
 * The matches of the pinned pages as `parseMatchFile` rows of a file of their own (`file` 2, `round` a ROUND_ORDER
 * number), and the women who played them.
 *
 * `draws`: `[{ title, html, start, event }]`, a major's women's singles page, the first day of its singles (yyyymmdd)
 * and the event's id; `cups`: `[{ title, html, year, event }]`, a Federation Cup's page; `redirects`: Map(title →
 * article); `qids`: Map(article → Wikidata item); `people`: the player file, Map(id → { name, ioc, born, wikidata });
 * `rules`: `{ flags, teams, aliases, joins }`, the manifest's codes of the pages' flags and cup teams and its reviewed
 * identity rows; `roundOrder`: ROUND_ORDER. A woman is a linked article (a redirect followed), a red link's title, or a
 * name written without a link and its flag (`Name|CODE`). A reviewed `aliases` row ([merged key, kept key, rule, why])
 * joins two keys of one woman. She is the player file's, under its id, so that she carries on into the open era's
 * files, when her article's Wikidata item is a player's `wikidata_id` or a reviewed `joins` row ([key, id, rule, why])
 * says so; anyone else is `wp:<key>`.
 *
 * → `{ matches, women: Map(id → { name, ioc, born, keys }), cupSingles: Map(season → Set(id)), flags: Map(id →
 * Map(season → Map(code → cells))), unplayed }`, `flags` the codes of her draws' flags (not her cup team's).
 */
export function wikipediaMatches({ draws, cups, redirects, qids, people, rules, roundOrder }) {
  const codeOfFlag = flag => (flag == null ? null : rules.flags[flag] ?? flag);
  const codeOfTeam = team => {
    const code = rules.teams[team];
    if (!code) throw new Error(`No code for the cup team ${team}`);
    return code;
  };
  const sources = [
    ...draws.map(draw => ({ ...draw, season: Math.floor(draw.start / 10000), kind: 'draw', kinds: linkKinds(draw.html), matches: drawMatches(draw.html) })),
    ...cups.map(cup => ({ ...cup, season: cup.year, kind: 'cup', kinds: linkKinds(cup.html), ties: cupTies(cup.html, cup.year) })),
  ];
  // A cell's key: its article (a redirect followed), its red link's title, or its name and flag.
  const articles = new Set();
  const keyOf = (source, cell, code) => {
    if (!cell.link) return `${cell.name}|${code ?? '?'}`;
    const kind = source.kinds.get(cell.link);
    if (kind === 'redirect') {
      const article = redirects.get(cell.link);
      if (!article) throw new Error(`${source.title}: ${cell.link} redirects, but no pinned page says where`);
      articles.add(article);
      return article;
    }
    if (kind !== 'article' && kind !== 'missing') throw new Error(`${source.title}: no rendered link for ${cell.link}`);
    if (kind === 'article') articles.add(cell.link);
    return cell.link;
  };
  // A reviewed row of rule 'name' is checked here; any other rule says why it holds.
  const alias = new Map();
  for (const [from, to, rule, why] of rules.aliases) {
    if (alias.has(from) || from === to || !rule || (rule !== 'name' && !why)) throw new Error(`The alias ${from} → ${to} is repeated, circular or unexplained`);
    alias.set(from, to);
  }
  for (const to of alias.values()) if (alias.has(to)) throw new Error(`The alias to ${to} names a key itself merged`);
  const byItem = new Map();
  for (const [id, person] of people) if (person.wikidata) byItem.set(person.wikidata, id);
  const joined = new Map();
  for (const [key, id, rule, why] of rules.joins) {
    if (joined.has(key) || !people.has(id) || !rule || (rule !== 'name' && !why)) throw new Error(`The join of ${key} to ${id} is repeated, not in the player file or unexplained`);
    joined.set(key, id);
  }
  if (new Set(joined.values()).size !== joined.size) throw new Error('Two keys are joined to one player: alias them instead');
  const idOf = key => {
    const viaItem = qids.has(key) ? byItem.get(qids.get(key)) : null;
    const viaJoin = joined.get(key);
    if (viaItem && viaJoin) throw new Error(`${key}: joined by Wikidata (${viaItem}) and by the review (${viaJoin})`);
    return viaItem ?? viaJoin ?? `wp:${key}`;
  };
  const keys = new Map(); // key → Map(code → cells)
  const shown = new Map(); // key before its alias → { names: Set, codes: Set }
  const flags = new Map(), cupSingles = new Map();
  const count = (map, key, by = 1) => map.set(key, (map.get(key) || 0) + by);
  // A side of a match: the woman's key and id, her cell and her code (her flag's in a draw, her team's in a tie).
  const sideOf = (source, cell, code, flagged) => {
    const raw = keyOf(source, cell, code);
    if (!shown.has(raw)) shown.set(raw, { names: new Set(), codes: new Set() });
    shown.get(raw).names.add(cell.name);
    if (code) shown.get(raw).codes.add(code);
    const key = alias.get(raw) ?? raw;
    if (!keys.has(key)) keys.set(key, new Map());
    if (code) count(keys.get(key), code);
    const id = idOf(key);
    if (flagged && code) {
      if (!flags.has(id)) flags.set(id, new Map());
      if (!flags.get(id).has(source.season)) flags.get(id).set(source.season, new Map());
      count(flags.get(id).get(source.season), code);
    }
    return { key, id, cell, code };
  };
  const matches = [];
  let unplayed = 0;
  const add = (source, a, b, result, fields) => {
    if (a.id === b.id) throw new Error(`${source.title}: ${a.cell.name} and ${b.cell.name} are one woman (${a.id})`);
    if (result.winner == null && !result.unplayed) throw new Error(`${source.title}: no winner of ${a.cell.name} v ${b.cell.name}`);
    if (result.unplayed) unplayed++;
    // An unplayed match with no winner marked is still a match of the draw: it rates nobody.
    const [w, l] = result.winner === 1 ? [b, a] : [a, b];
    matches.push({ season: source.season, ...fields, winner: w.id, loser: l.id, winnerName: w.cell.name, loserName: l.cell.name,
      winnerIoc: w.code ?? '', loserIoc: l.code ?? '', surface: '', file: 2, row: matches.length, why: result.unplayed ? 'unplayed' : null });
  };
  for (const source of sources) {
    if (source.kind === 'draw') {
      source.matches.forEach((match, num) => {
        const [a, b] = [match.a, match.b].map(cell => sideOf(source, cell, codeOfFlag(cell.flag), true));
        add(source, a, b, match, { date: source.start, event: source.event, eventName: source.title.replace(/ – Women's singles$/, ''),
          level: 'G', round: roundOrder[match.round], num });
      });
      continue;
    }
    // The cup's rounds by its days: the last day's ties are the final.
    const days = [...new Set(source.ties.map(tie => tie.date))].sort((x, y) => x - y);
    if (days.some(day => day == null)) throw new Error(`${source.title}: a tie without a date`);
    source.ties.forEach((tie, t) => {
      const codes = [codeOfTeam(tie.team1), codeOfTeam(tie.team2)];
      const round = ROUND_CODES[ROUND_CODES.length - days.length + days.indexOf(tie.date)];
      for (const rubber of tie.rubbers) {
        const [one, two] = [rubber.t1, rubber.t2].map((cells, s) => cells.map(cell => sideOf(source, cell, codes[s], false)));
        // Two women of one side of a doubles are two women.
        for (const pair of [one, two]) if (pair.length === 2 && pair[0].id === pair[1].id) throw new Error(`${source.title}: a doubles pair is one woman (${pair[0].id})`);
        if (rubber.doubles) continue;
        add(source, one[0], two[0], rubber, { date: tie.date, event: `${source.event}-${String(t + 1).padStart(2, '0')}`,
          eventName: `Federation Cup ${round}: ${codes[0]} vs ${codes[1]}`, level: 'D', round: roundOrder[round], num: rubber.no });
        if (!rubber.unplayed) {
          if (!cupSingles.has(source.season)) cupSingles.set(source.season, new Set());
          for (const side of [one[0], two[0]]) cupSingles.get(source.season).add(side.id);
        }
      }
    });
  }
  // Every reviewed row names women of the pages, and a row of rule 'name' holds: one plain name, one country.
  const nameOfKey = key => (key.includes('|') ? key.slice(0, key.indexOf('|')) : key.replace(/ \([^)]*\)$/, ''));
  const same = code => rules.sameCodes?.[code] ?? code;
  const names = keyList => new Set(keyList.flatMap(key => [nameOfKey(key), ...(shown.get(key)?.names ?? [])]).map(plainName));
  const codesOf = keyList => new Set(keyList.flatMap(key => [...(shown.get(key)?.codes ?? [])]).map(same));
  const agree = (a, b) => !a.size || !b.size || [...a].some(code => b.has(code));
  for (const [from, to, rule] of rules.aliases) {
    if (!shown.has(from) || !shown.has(to)) throw new Error(`The alias ${from} → ${to} names a key no page has`);
    if (rule === 'name' && (plainName(nameOfKey(from)) !== plainName(nameOfKey(to)) || !agree(codesOf([from]), codesOf([to])))) {
      throw new Error(`The alias ${from} → ${to} is not one name in one country: give its rule and why`);
    }
  }
  for (const [key, id, rule] of rules.joins) {
    if (!keys.has(key)) throw new Error(`The join of ${key} names no woman of the pages`);
    const all = [key, ...[...alias].filter(([, to]) => to === key).map(([from]) => from)];
    const person = people.get(id);
    if (rule === 'name' && (!names(all).has(plainName(person.name)) || !agree(codesOf(all), new Set([same(person.ioc)])))) {
      throw new Error(`The join of ${key} to ${id} (${person.name}, ${person.ioc}) is not one name in one country: give its rule and why`);
    }
  }
  // Each woman: the player file's record, else her key's name (an article's title without its qualifier) and the code
  // she most often plays under.
  const women = new Map();
  for (const [key, codes] of keys) {
    const id = idOf(key);
    const person = people.get(id);
    const code = [...codes].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1))[0]?.[0] ?? null;
    const name = key.includes('|') ? key.slice(0, key.indexOf('|')) : key.replace(/ \([^)]*\)$/, '');
    if (!women.has(id)) women.set(id, { name: person?.name ?? name, ioc: person?.ioc ?? code, born: person?.born ?? null, keys: [] });
    women.get(id).keys.push(key);
  }
  return { matches, women, cupSingles, flags, unplayed, articles };
}

/** A pinned page's cache file: its title made safe, `~` and the first 8 hex digits of the title's SHA-1 (case kept apart). */
export const wikiFile = (title, sha1) => `${title.replace(/[^\p{L}\p{N}.'()–-]+/gu, '_')}~${sha1(title).slice(0, 8)}.html`;
const MAJOR_OF = [['Australian Championships', 'AO'], ['French Championships', 'RG'], ['Wimbledon Championships', 'W'], ['U.S. National Championships', 'US']];

/**
 * The manifest's pinned pages (`wikipedia`: its draws, cups and redirects), each read by `read(title, sha256)` (→ its
 * text, checked against its pin) and checked to show its pinned revision of its article, the right size, and its
 * redirect where it has one → `{ draws, cups, redirects }` as wikipediaMatches takes them, each draw dated by its
 * tournament article's first day of the women's singles.
 */
export async function pinnedPages(W, read) {
  const page = async (title, shown, revision, sha, bytes) => {
    const html = await read(title, sha);
    const at = pageOf(html);
    if (at.title !== shown || at.revision !== revision || at.redirectedFrom !== (shown === title ? null : title) || Buffer.byteLength(html) !== bytes) {
      throw new Error(`${title} shows ${at.title} revision ${at.revision}${at.redirectedFrom ? ` (from ${at.redirectedFrom})` : ''}, not ${shown} revision ${revision}`);
    }
    return html;
  };
  const redirects = new Map();
  for (const [title, article, revision, sha, bytes] of W.redirects.items) {
    await page(title, article, revision, sha, bytes);
    redirects.set(title, article);
  }
  const draws = [];
  for (const [title, revision, sha, bytes, eventTitle, eventArticle, eventRevision, eventSha, eventBytes] of W.draws) {
    const html = await page(title, title, revision, sha, bytes);
    const year = Number(title.slice(0, 4));
    const start = eventStart(await page(eventTitle, eventArticle, eventRevision, eventSha, eventBytes), year);
    if (!start || Math.floor(start / 10000) !== year) throw new Error(`${eventArticle} gives no first day of its women's singles in ${year}`);
    const major = MAJOR_OF.find(([name]) => title.includes(name));
    if (!major) throw new Error(`${title} is not a major's`);
    draws.push({ title, html, start, event: `wp-${year}-${major[1]}` });
  }
  const cups = [];
  for (const [title, revision, sha, bytes] of W.cups) {
    const year = Number(title.slice(0, 4));
    cups.push({ title, html: await page(title, title, revision, sha, bytes), year, event: `wp-${year}-FC` });
  }
  return { draws, cups, redirects };
}

/** The query that asks Wikidata for the items of `articles` (English Wikipedia titles), in QLever's order of the titles. */
export const articlesQuery = articles => `SELECT ?title ?item WHERE {\n  VALUES ?title { ${articles.map(title => `${JSON.stringify(title)}@en`).join(' ')} }\n`
  + '  ?article schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> ; schema:name ?title .\n}\nORDER BY ?title';
