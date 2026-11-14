// The facts a computed women's season is built from (docs/design/womens-football.md, "Computed seasons"). A women's World
// Cup reads the Fjelstul World Cup Database as the men's World Cup seasons do (scripts/lib/world-cup-facts.mjs
// worldCupFacts); an Olympic tournament, which the database does not hold, reads its squads from Wikipedia's squad pages
// and its line-ups from RSSSF's match details or Wikipedia's match pages (olympicFacts). Both rate the finalists from
// martj42's women's results through the men's Elo engine (scripts/lib/football-elo.mjs), and fifaCrossCheck sets that
// Elo against FIFA's women's ranking. Pure: scripts/sync-womens-tournament-seasons.mjs reads the files and writes one
// snapshot per season (scripts/data/womens-tournament-seasons/<id>.json), which scripts/build-womens-tournament-seasons.mjs
// turns into the season.

import { NATIONS } from '../../src/data/teams.js';
import { nationResolver } from '../../src/data/footballSetBuild.js';
import { dayAfter, yearsBefore } from './football-elo.mjs';
import { htmlText, wikiTitle } from './world-cup-facts.mjs';

/** The facts' licence line. */
export const FACTS_LICENCE = 'CC BY-SA 4.0: derived from the Fjelstul World Cup Database and, for the Olympic tournaments, Wikipedia and RSSSF '
  + '(public/womens-football/ATTRIBUTION-computed.txt)';

// ---------- the cross-check ----------

const mean = xs => xs.reduce((s, x) => s + x, 0) / xs.length;
const pearson = (a, b) => {
  const ma = mean(a), mb = mean(b);
  let c = 0, va = 0, vb = 0;
  for (let i = 0; i < a.length; i++) { c += (a[i] - ma) * (b[i] - mb); va += (a[i] - ma) ** 2; vb += (b[i] - mb) ** 2; }
  return c / Math.sqrt(va * vb);
};
const ranks = xs => {
  const order = xs.map((x, i) => [x, i]).sort((p, q) => q[0] - p[0] || p[1] - q[1]);
  const out = [];
  order.forEach(([, i], k) => { out[i] = k; });
  return out;
};
const spearman = (a, b) => pearson(ranks(a), ranks(b));
const round3 = x => Math.round(x * 1000) / 1000;

/**
 * The computed Elo against FIFA's women's ranking (cross-check only): for each release of `releases` (days), FIFA's
 * table (`ranking`, the CSV's rows) against the Elo of that day (`snapshots`, eloOn's), its names put to the results'
 * by `aliases`. Pearson over every team both have, Spearman over FIFA's top 48 and top 20 that the results have, and
 * the slope of the computed Elo on FIFA's points; then, for each season of `seasons` ({ id, day }), the first release
 * on or after its Elo's day and within a year of it (FIFA published none before July 2003), and the means over every
 * release. No FIFA figure is kept but these summaries.
 */
export function fifaCrossCheck({ ranking, releases, snapshots, aliases, seasons }) {
  const rows = releases.map(date => {
    const table = ranking.filter(row => row.ranking_date === date).sort((a, b) => Number(a.rank) - Number(b.rank));
    const ratings = snapshots[date]?.ratings;
    if (!table.length || !ratings) throw new Error(`No FIFA table or no Elo on ${date}`);
    const pairs = table.map(row => ({ name: aliases[row.country_name] ?? row.country_name, points: Number(row.points) }))
      .map(row => ({ ...row, elo: ratings.get(row.name) })).filter(row => row.elo != null);
    const theirs = pairs.map(p => p.points), ours = pairs.map(p => p.elo);
    const mx = mean(theirs), my = mean(ours);
    const slope = pairs.reduce((s, p) => s + (p.points - mx) * (p.elo - my), 0) / pairs.reduce((s, p) => s + (p.points - mx) ** 2, 0);
    const top = n => pairs.slice(0, n);
    return { date, published: table.length, matched: pairs.length, pearson: round3(pearson(theirs, ours)),
      spearmanTop48: round3(spearman(top(48).map(p => p.points), top(48).map(p => p.elo))),
      spearmanTop20: round3(spearman(top(20).map(p => p.points), top(20).map(p => p.elo))), slope: round3(slope),
      leaders: { fifa: pairs.slice(0, 5).map(p => p.name), computed: [...pairs].sort((a, b) => b.elo - a.elo).slice(0, 5).map(p => p.name) } };
  });
  const average = key => round3(mean(rows.map(row => row[key])));
  const bySeason = Object.fromEntries(seasons.flatMap(({ id, day }) => {
    const yearOn = `${Number(day.slice(0, 4)) + 1}${day.slice(4)}`;
    const row = rows.find(r => r.date >= day && r.date <= yearOn);
    return row ? [[id, { release: row.date, pearson: row.pearson, spearmanTop48: row.spearmanTop48, spearmanTop20: row.spearmanTop20 }]] : [];
  }));
  return {
    about: 'The computed Elo against FIFA\'s Women\'s World Ranking, release by release to the end of 2015: a cross-check only, never an input; '
      + 'no FIFA figure is kept here but these summaries (scripts/sync-womens-tournament-seasons.mjs). FIFA\'s ranking is a modified Elo over '
      + 'every women\'s full international since 1971, so it also measures how much the friendlies missing from the results matter.',
    seasons: bySeason,
    mean: { pearson: average('pearson'), spearmanTop48: average('spearmanTop48'), spearmanTop20: average('spearmanTop20'), slope: average('slope') },
    releases: rows,
  };
}

// ---------- the Olympic tournaments: Wikipedia's pages ----------

const POSITIONS = ['GK', 'DF', 'MF', 'FW'];
const rowsOf = html => [...html.matchAll(/<tr\b([^>]*)>([\s\S]*?)<\/tr>/g)].map(m => ({ attrs: m[1],
  cells: [...m[2].matchAll(/<t([dh])\b[^>]*>([\s\S]*?)<\/t\1>/g)].map(cell => cell[2]) }));
const firstLink = html => {
  const m = /<a\b[^>]*\bhref="([^"]*)"[^>]*>([\s\S]*?)<\/a>/.exec(html);
  return m ? { title: wikiTitle(m[1]), text: htmlText(m[2]) } : null;
};

/**
 * A Wikipedia "… Women's team squads" page: per team (each third-level heading), its players `{ shirt, position, name,
 * title, born, caps, goals, alternate }` in page order: the registered squad's table, then the unenrolled alternates'
 * (`alternate`). `title` is the player's article (null where she has none), `position` GK, DF, MF or FW (null where the
 * page gives none), `caps` and `goals` as the page gives them before the tournament (null where it gives none).
 */
export function olympicSquads(html) {
  const body = html.slice(html.indexOf('id="mw-content-text"'));
  const squads = [];
  for (const part of body.split(/<h3\b[^>]*>/).slice(1)) {
    const team = htmlText(part.slice(0, part.indexOf('</h3>')));
    const section = part.split(/<h2\b/)[0];
    const players = [];
    let tables = 0;
    for (const table of section.split(/<table\b/).slice(1)) {
      const rows = rowsOf(table).filter(row => /class="nat-fs-player"/.test(row.attrs));
      if (!rows.length) continue;
      tables++;
      for (const { cells } of rows) {
        if (cells.length < 6) throw new Error(`${team}: a squad row of ${cells.length} cells`);
        const shirt = Number(htmlText(cells[0]));
        const position = /(GK|DF|MF|FW)$/.exec(htmlText(cells[1]))?.[1] ?? null;
        const link = firstLink(cells[2]);
        const player = /^Captain \(/.test(link?.title ?? '') ? null : link;
        const name = (player?.text || htmlText(cells[2])).replace(/\s*\((?:captain|c)\)\s*$/i, '').trim();
        const born = /class="bday">(\d{4}-\d{2}-\d{2})</.exec(cells[3])?.[1] ?? '';
        const count = cell => (/^\d+$/.test(htmlText(cell)) ? Number(htmlText(cell)) : null);
        // An unenrolled alternate may have no number of her own ("19–21"): she never played (olympicFacts keeps only those
        // who did).
        const numbered = Number.isInteger(shirt) && shirt >= 1;
        if (!name || (!numbered && tables < 2)) throw new Error(`${team}: a squad row without a number or a name`);
        players.push({ shirt: numbered ? shirt : null, position, name, title: player?.title ?? null, born, caps: count(cells[4]), goals: count(cells[5]), alternate: tables > 1 });
      }
    }
    if (players.length) squads.push({ team, players });
  }
  if (!squads.length) throw new Error('The page lists no squads');
  return squads;
}

// A minute as the line-ups write it ("64'", "90+2", "105"): the regulation minute, stoppage time not counted, as the
// Fjelstul database's minute_regulation.
const minuteOf = text => {
  const m = /(\d{1,3})(?:\s*\+\s*\d{1,2})?/.exec(String(text));
  if (!m) throw new Error(`No minute in ${JSON.stringify(text)}`);
  return Number(m[1]);
};

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/**
 * A match box's day, however the page writes it: a microformat (`bday dtstart`), the time element's `datetime`, the
 * day's sort key, or its text ("28 July 1996").
 */
function boxDate(box) {
  const head = box.slice(0, box.indexOf('class="fevent"') > 0 ? box.indexOf('class="fevent"') : 2000);
  const iso = /class="bday dtstart[^"]*"[^>]*>(\d{4}-\d{2}-\d{2})</.exec(head)?.[1] ?? /datetime="(\d{4}-\d{2}-\d{2})/.exec(head)?.[1]
    ?? /data-sort-value="0*(\d{4}-\d{2}-\d{2})/.exec(head)?.[1];
  if (iso) return iso;
  const m = /class="fdate"[^>]*>([\s\S]*?)<\/div>/.exec(head);
  const text = m ? htmlText(m[1]) : '';
  const parts = /^(\d{1,2}) ([A-Z][a-z]+) (\d{4})/.exec(text);
  const month = parts ? MONTH_NAMES.indexOf(parts[2]) + 1 : 0;
  return month ? `${parts[3]}-${String(month).padStart(2, '0')}-${parts[1].padStart(2, '0')}` : null;
}

/** The footballboxes of a Wikipedia match page, each `{ date, home, away, score, html }`, the box and what follows it to the next. */
function footballBoxes(html) {
  const boxes = html.split(/(?=<div\b[^>]*class="footballbox")/).filter(part => /^<div\b[^>]*class="footballbox"/.test(part));
  if (!boxes.length) throw new Error('The page has no match boxes');
  return boxes.map((box, i) => {
    const date = boxDate(box);
    const side = cls => {
      const m = new RegExp(`<th\\b[^>]*class="${cls}"[^>]*>([\\s\\S]*?)</th>`).exec(box);
      return m ? firstLink(m[1])?.text ?? htmlText(m[1]) : null;
    };
    const home = side('fhome'), away = side('faway');
    const score = htmlText(/<th\b[^>]*class="fscore"[^>]*>([\s\S]*?)<\/th>/.exec(box)?.[1] ?? '');
    if (!date || !home || !away) throw new Error(`match box ${i + 1}: no day or teams`);
    return { date, home, away, score, html: box };
  });
}

/**
 * The goals of a Wikipedia tournament or match page: for each match box, each scorer's entry in its home (`fhgoal`) or
 * away (`fagoal`) cell, `{ date, team, title, name, goals, own }`: `goals` the minutes the entry gives (a golden goal's
 * too: "MacMillan 100'"), `own` an own goal (credited to no one).
 */
export function tournamentGoals(html) {
  const goals = [];
  for (const box of footballBoxes(html)) {
    for (const [cls, team] of [['fhgoal', box.home], ['fagoal', box.away]]) {
      const cell = new RegExp(`<td\\b[^>]*class="${cls}"[^>]*>([\\s\\S]*?)</td>`).exec(box.html)?.[1] ?? '';
      for (const entry of cell.split(/<br\s*\/?>/).filter(part => htmlText(part))) {
        const link = firstLink(entry);
        const marks = (htmlText(entry).match(/\d{1,3}(?:\+\d{1,2})?'/g) || []).length;
        if (!marks) throw new Error(`${box.date} ${box.home} v ${box.away}: a scorer's entry with no goal: ${htmlText(entry)}`);
        const own = /\bo\.\s?g\.|title="Own goal"/i.test(entry);
        goals.push({ date: box.date, team, title: link?.title ?? null, name: link?.text ?? htmlText(entry).replace(/\s*\d.*$/, ''), goals: marks, own });
      }
    }
  }
  return goals;
}

/**
 * The line-ups of a Wikipedia match page (the 2012 Olympic tournament's), each match box `{ date, aet, sides }`:
 * `aet` whether it went to extra time, each side `{ label, players }` (home first), a player `{ shirt, token, title,
 * started, on, off }`: her number, her name as the page writes it and her article, whether she started, and the
 * minutes she came on and went off (null: from the kick-off, or to the end).
 */
export function wikipediaLineups(html) {
  return footballBoxes(html).map(box => {
    const sides = box.html.split(/<table\b/).map(part => {
      const players = [];
      let subs = false;
      for (const { cells } of rowsOf(part)) {
        const text = cells.map(htmlText);
        if (text.some(t => /^Substitutions?:?$/i.test(t))) { subs = true; continue; }
        // A player's row: her position (GK, DF… or a finer one, RB, DM, CF), number and name.
        if (cells.length < 3 || !/^[A-Z]{1,3}$/.test(text[0]) || !/^\d{1,2}$/.test(text[1])) continue;
        const link = firstLink(cells[2]);
        const rest = cells.slice(3).join(' ');
        // A mark's minute: "64'", or "HT'" for a change at half-time (the 45th minute).
        const mark = title => {
          const at = rest.indexOf(`title="${title}"`);
          if (at < 0) return null;
          const m = /(\d{1,3}(?:\+\d{1,2})?|HT)'/.exec(htmlText(rest.slice(at).replace(/^[^>]*>/, '')));
          return m ? (m[1] === 'HT' ? 45 : minuteOf(m[1])) : null;
        };
        players.push({ shirt: Number(text[1]), token: link?.text || text[2].replace(/\s*\(c\)\s*$/, ''), title: link?.title ?? null,
          started: !subs, on: subs ? mark('Substituted on') : null, off: mark('Substituted off') ?? mark('Sent off') });
      }
      return players;
    }).filter(players => players.length);
    if (sides.length !== 2) throw new Error(`${box.date} ${box.home} v ${box.away}: ${sides.length} line-ups`);
    for (const side of sides) {
      const starters = side.filter(player => player.started).length;
      if (starters !== 11) throw new Error(`${box.date} ${box.home} v ${box.away}: a line-up of ${starters} starters`);
    }
    return { date: box.date, aet: /a\.?e\.?t\.?|after extra time/i.test(box.score), sides: [{ label: box.home, players: sides[0] }, { label: box.away, players: sides[1] }] };
  });
}

// ---------- the Olympic tournaments: RSSSF's match details ----------

/** An RSSSF page's text (windows-1252, as the site serves it): tags dropped, entities decoded. */
export function rsssfText(bytes) {
  const html = new TextDecoder('windows-1252').decode(bytes);
  return html.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\r\n?/g, '\n');
}

/** `text` split at any of `separators` outside parentheses. */
function splitTop(text, separators) {
  const parts = [];
  let depth = 0, current = '';
  for (const char of text) {
    if (char === '(') depth++;
    if (char === ')') depth = Math.max(0, depth - 1);
    if (!depth && separators.includes(char)) { parts.push(current.trim()); current = ''; } else current += char;
  }
  if (current.trim()) parts.push(current.trim());
  return parts.filter(Boolean);
}

/**
 * One RSSSF line-up item as players: the starter, then each substitute of the chain that replaced her,
 * `{ token, shirt, started, on, off }`. "HAMM Mia (O'REILLY Heather 67)" is two; "ROSANA (KELLY 72 (GRAZIELLE 84))"
 * three; "14-Melissa Tancredi (2-Jodi-Ann Robinson 42; 16-Jonelle Filigno 83)" three; "Hamm(Gabarra)" two, with no
 * minute. An item that is only a substitute ("(BACHOR Isabell 39)", which the page's commas cut from the starter she
 * replaced) comes as one, `lone`.
 */
function lineupItem(item, numbered) {
  const chain = [];
  const rest = item.trim().replace(/[.©�\s]+$/g, '').trim();
  const lone = rest.startsWith('(');
  const parse = (text, started) => {
    const open = text.indexOf('(');
    const close = text.lastIndexOf(')');
    const head = (open < 0 ? text : text.slice(0, open)).replace(/[©�]/g, '').trim();
    const inner = open < 0 ? '' : text.slice(open + 1, close > open ? close : text.length);
    // The minute may follow the name with no space ("OEQVIST Josefine71"): no name ends in a digit.
    const [, who, minute] = /^(.*?)(?:\s*(\d{1,3}(?:\+\d{1,2})?))?$/.exec(head);
    const shirt = numbered ? Number(/^(\d{1,2})\s*-/.exec(who)?.[1]) : null;
    const token = (numbered ? who.replace(/^\d{1,2}\s*-\s*/, '') : who).replace(/\s+/g, ' ').trim();
    if (!token) throw new Error(`An empty name in ${JSON.stringify(item)}`);
    if (numbered && !Number.isInteger(shirt)) throw new Error(`No number in ${JSON.stringify(item)}`);
    chain.push({ token, shirt, started, on: started || minute == null ? null : minuteOf(minute), off: null });
    if (inner.trim()) for (const sub of splitTop(inner, [';'])) parse(sub, false);
  };
  if (lone) parse(rest.slice(1, rest.lastIndexOf(')') > 0 ? rest.lastIndexOf(')') : rest.length), false);
  else parse(rest, true);
  // Each one of the chain went off when the next came on.
  for (let i = 0; i + 1 < chain.length; i++) chain[i].off = chain[i + 1].on;
  return { players: chain, lone };
}

const MONTHS = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
// Words that open a line like a line-up's but are not one.
const NOT_LINEUPS = /^(Att|Ref|REF|ATT|HT|Coach|Booked|GKS|DEF|MID|FOR|Top Scorers|Author|D\.T|FINAL|Captains?|GOALSCORERS)$/i;

/**
 * RSSSF's match details of an Olympic tournament as match boxes `{ date, aet, sides: [{ label, players }] }` (as
 * wikipediaLineups'), by the page's layout (`format`): 'surnames' (1996: "21 July 1996 Orlando, Florida", then
 * "USA: Scurry - Overbeck, …, Hamm(Gabarra)", no minutes), 'caps' (2004: a day "[Aug 11]", a score line
 * "USA 2-1aet Germany  Stadium: …", then "USA:   SCURRY Briana, …, HAMM Mia (O'REILLY Heather 67)") or 'numbered'
 * (2008: "In <city> …", the scores, "[After extra-time]", then "CAN: 18-Erin McLeod; 7-Rhian Wilkinson, …").
 * `year` is the tournament's. Each line-up must name eleven starters.
 */
export function rsssfLineups(text, format, year) {
  const lines = text.split('\n');
  const boxes = [];
  let date = null, box = null;
  const open = aet => { box = { date, aet, sides: [] }; boxes.push(box); };
  const LABEL = format === 'surnames' ? /^([A-Z][A-Za-z]+(?: [A-Z][a-z]+)?):\s*(.*)$/ : /^([A-Z]{3}):\s*(.*)$/;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let m;
    if (format === 'surnames' && (m = /^\s*(\d{1,2}) (July|August) (\d{4})\b/.exec(line))) {
      date = `${m[3]}-${MONTHS[m[2].slice(0, 3).toLowerCase()]}-${m[1].padStart(2, '0')}`;
      open(false);
      continue;
    }
    if (format !== 'surnames' && (m = /^\s*\[(Jul|Aug|Sep)[a-z]*\.? (\d{1,2})(?:, \d{4})?\]/i.exec(line))) {
      date = `${year}-${MONTHS[m[1].toLowerCase()]}-${m[2].padStart(2, '0')}`;
      continue;
    }
    if (format === 'caps' && (m = /^\s*\S.*?\s\d{1,2}-\d{1,2}(aet)?\s+\S.*?Stadium:/i.exec(line))) {
      open(!!m[1]);
      continue;
    }
    if (format === 'numbered' && /^In [A-Z]/.test(line)) {
      open(false);
      continue;
    }
    if (format === 'numbered' && /^\[After extra-time\]$/i.test(line.trim())) {
      if (!box) throw new Error('Extra time before any match');
      box.aet = true;
      continue;
    }
    if (!(m = LABEL.exec(line.trim())) || NOT_LINEUPS.test(m[1]) || /^\s/.test(line)) continue;
    if (!box) throw new Error(`A line-up before any match: ${line}`);
    // A group's squad lists follow its matches under labels of their own ('SWEDEN', 'GKS:'): only a match's two count.
    if (box.sides.length === 2) continue;
    // The line-up runs on over the indented lines that follow it.
    let content = m[2];
    while (i + 1 < lines.length && /^\s{3,}\S/.test(lines[i + 1])) content += ` ${lines[++i].trim()}`;
    const items = format === 'surnames' ? (() => {
      const dash = content.indexOf(' - ');
      if (dash < 0) throw new Error(`${box.date} ${m[1]}: no goalkeeper's dash in ${content}`);
      return [content.slice(0, dash), ...splitTop(content.slice(dash + 3), [','])];
    })() : splitTop(content, format === 'numbered' ? [',', ';'] : [',']);
    const players = [];
    for (const item of items) {
      if (!item.replace(/[.©�\s]/g, '')) continue;
      const { players: chain, lone } = lineupItem(item, format === 'numbered');
      if (lone) {
        const before = players.filter(p => p.started).at(-1);
        if (!before || before.off != null) throw new Error(`${box.date} ${m[1]}: ${item} replaced no one`);
        before.off = chain[0].on;
      }
      players.push(...chain);
    }
    const starters = players.filter(p => p.started).length;
    if (starters !== 11) throw new Error(`${box.date} ${m[1]}: ${starters} starters in ${content}`);
    box.sides.push({ label: m[1], players });
  }
  const full = boxes.filter(b => b.sides.length);
  for (const b of full) if (b.sides.length !== 2) throw new Error(`${b.date}: a match with ${b.sides.length} line-ups`);
  return full;
}

/** The line-ups of every source of an Olympic season (`sources`: `{ from, format, html }`, an RSSSF page's `bytes`). */
export function olympicLineups(sources, season) {
  return sources.flatMap(source => (source.from === 'wikipedia' ? wikipediaLineups(source.html)
    : rsssfLineups(rsssfText(source.bytes), source.format, season.tournamentYear)));
}

// ---------- names ----------

// Letters a page may spell out in ASCII: Aarønes as Aarones or Aaroenes, Sjöström as Sjoestroem, Müller as Mueller.
const SPELLED = [[/[øö]/g, 'oe'], [/[äæ]/g, 'ae'], [/ü/g, 'ue'], [/å/g, 'aa'], [/ß/g, 'ss']];
const PLAIN = [[/ø/g, 'o'], [/æ/g, 'ae'], [/ß/g, 'ss'], [/đ/g, 'd'], [/ł/g, 'l']];
const ascii = (text, table) => table.reduce((s, [from, to]) => s.replace(from, to), String(text).toLowerCase())
  .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
/** A name's spellings to compare: plain letters (ø as o), and spelt out (ø as oe). */
export const spellings = name => [...new Set([ascii(name, PLAIN), ascii(name, SPELLED)])];

/**
 * The squad player a line-up's name is, and by which rule: the one whose name has the same words, in any order
 * ('same': "JOENSSON Caroline" is Caroline Jönsson), else the one whose surname (last words) it is, with her given
 * name's initial where it gives one ('surname': "B.Madsen"; in a name whose surname is in capitals, "SANDOVAL Rubi",
 * those words are her surname, whatever her given name). Null unless exactly one player is.
 */
export function nameMatch(token, players) {
  const forms = spellings(token.replace(/\./g, '. ')).map(s => s.split(' '));
  const initial = /^([A-Za-z])\.\s*\S/.exec(token)?.[1]?.toLowerCase() ?? null;
  // "SANDOVAL Rubi", "DE VANNA Lisa": the words in capitals are the surname.
  const capitals = token.split(/\s+/).filter(word => /^[A-Z][A-Z'’-]+$/.test(word) && /[A-Z]{2}/.test(word));
  const caps = capitals.length && capitals.length < token.split(/\s+/).length ? spellings(capitals.join(' ')).map(s => s.split(' ')) : null;
  const same = (player, w) => spellings(player.name).some(s => { const p = s.split(' '); return p.length === w.length && w.every(x => p.includes(x)); });
  const ends = (p, tail) => tail.length && tail.length < p.length && p.slice(p.length - tail.length).every((x, k) => x === tail[k]);
  const surname = (player, w) => spellings(player.name).some(s => {
    const p = s.split(' ');
    if (caps) return caps.some(c => ends(p, c));
    const tail = initial ? w.slice(1) : w;
    if (initial) return ends(p, tail) && p[0].startsWith(initial);
    return tail.length < p.length && ends(p, tail);
  });
  for (const [rule, test] of [['same', same], ['surname', surname]]) {
    const found = players.filter(player => forms.some(w => test(player, w)));
    if (found.length) return found.length === 1 ? { player: found[0], rule } : null;
  }
  return null;
}

/** nameMatch's player alone (null for none). */
export const matchName = (token, players) => nameMatch(token, players)?.player ?? null;

/** Whether two names share a word of three letters or more, however spelt ("Maria Quinones", Florencia Quiñones). */
export function shareWord(a, b) {
  const words = name => new Set(spellings(name).flatMap(s => s.split(' ')).filter(w => w.length >= 3));
  const first = words(a);
  return [...words(b)].some(w => first.has(w));
}

// ---------- an Olympic tournament's facts ----------

/**
 * One Olympic tournament's facts, in the shape of a World Cup's (world-cup-facts.mjs worldCupFacts): each team's squad
 * (the squad page's, `squads`; an alternate only if she played), every player's starts, appearances (`apps`, where the
 * line-ups give no minutes) or minutes, and goals, and the teams' Elo the day after the final. `boxes` are the
 * line-ups (olympicLineups'), `goals` the scorers (tournamentGoals'), `matches` the results (resultRows'), `season` the
 * manifest's entry, `snapshot` the Elo on the day after the final, `names` the manifest's names: `labels` (a line-up's
 * or a goal's team label → the squad page's team), `results` (a team → its results name), `eloAs` (a team → the
 * results name whose Elo rates it: Great Britain's, which played only that tournament, England's), `codes` (a team →
 * the code of its players' ids, where the game nation's is not hers), `lineupSpellings` (the reviewed names no rule matches,
 * each `{ key, shirt }`) and `lineupErrors` (the reviewed slips of the pages, each `{ key, skip }`). A line-up name
 * neither rule nor review matches leaves the facts null and is listed in `unmatched`. The audit lists every reviewed
 * key used.
 */
export function olympicFacts({ squads, boxes, goals, season, matches, snapshot, elo, names }) {
  const year = season.tournamentYear;
  const date = dayAfter(season.final);
  if (!snapshot) throw new Error(`${season.id}: no Elo on ${date}`);
  const since = yearsBefore(date, elo.activeYears);
  const audit = { spellings: new Set(), errors: new Set(), loose: new Set() };
  const unmatched = [];
  const spelled = new Map((names.lineupSpellings ?? []).map(entry => [entry.key, entry]));
  const slips = new Map((names.lineupErrors ?? []).map(entry => [entry.key, entry]));
  const resolve = nationResolver(names.nations);

  // The tournament's matches in the results, which the line-ups must match one for one.
  const played = matches.filter(m => m.tournament === 'Olympic Games' && m.date.startsWith(String(year)));
  const teams = squads.map(squad => squad.team);
  const resultsOf = team => names.results?.[team] ?? team;
  const teamOf = label => names.labels?.[label] ?? (teams.includes(label) ? label : null);
  const squadOf = team => squads.find(squad => squad.team === team).players;
  const record = new Map(); // squad player → { minutes, starts, apps, goals }
  const own = player => record.get(player) || record.set(player, { minutes: 0, starts: 0, apps: 0, goals: 0 }).get(player);
  const used = new Set();
  for (const box of boxes) {
    const [home, away] = box.sides.map(side => teamOf(side.label));
    if (!home || !away) throw new Error(`${season.id} ${box.date}: no team for the line-up label ${box.sides.map(s => s.label).join(' or ')}`);
    const game = played.find(m => m.date === box.date && [m.home, m.away].sort().join() === [resultsOf(home), resultsOf(away)].sort().join());
    if (!game) throw new Error(`${season.id}: no result ${home} v ${away} on ${box.date}`);
    if (used.has(game)) throw new Error(`${season.id}: two line-ups of ${home} v ${away} on ${box.date}`);
    used.add(game);
    const end = box.aet ? season.regulation + season.extraTime : season.regulation;
    box.sides.forEach((side, s) => {
      const team = s ? away : home;
      const squad = squadOf(team);
      const on = new Set();
      for (const entry of side.players) {
        // A name in one match's line-up: its team, day, number (where the line-up gives one), name, and whether she started
        // or came on (and when), so a starter and a substitute of one name are told apart.
        const key = `${year}|${team}|${box.date}|${entry.shirt ?? ''}|${entry.token}|${entry.started ? 'start' : `on ${entry.on ?? '?'}`}`;
        if (slips.has(key)) {
          audit.errors.add(key);
          if (slips.get(key).skip) continue;
        }
        // A reviewed spelling is the name's in that team that year, whatever the match.
        const spelling = `${year}|${team}|${entry.shirt ?? ''}|${entry.token}`;
        let player = null, rule = null;
        if (spelled.has(spelling)) {
          audit.spellings.add(spelling);
          player = squad.find(p => p.shirt === spelled.get(spelling).shirt);
          if (!player) throw new Error(`${season.id} ${team}: the reviewed ${spelling} names number ${spelled.get(spelling).shirt}, which is no one's`);
          rule = 'reviewed';
        } else {
          // Her article, where the line-up links one (a redirect's title is not the squad's); else her number, where her
          // name has the squad's words, or shares one; else her name alone, a registered player before an unenrolled
          // alternate (who could play only in place of an injured player).
          const byNumber = entry.shirt != null ? squad.find(p => p.shirt === entry.shirt) : null;
          const byName = nameMatch(entry.token, squad.filter(p => !p.alternate)) ?? nameMatch(entry.token, squad.filter(p => p.alternate));
          if (entry.title && squad.some(p => p.title === entry.title)) [player, rule] = [squad.find(p => p.title === entry.title), 'article'];
          else if (byNumber && nameMatch(entry.token, [byNumber])?.rule === 'same') [player, rule] = [byNumber, 'same'];
          else if (byNumber && shareWord(entry.token, byNumber.name)) [player, rule] = [byNumber, 'number'];
          else if (byName) [player, rule] = [byName.player, entry.shirt != null && byName.player.shirt !== entry.shirt ? 'name, not number' : byName.rule];
        }
        if (!player) { unmatched.push(spelling); continue; }
        // Every match not by her article or the same words is listed for review (lineup-names.json).
        if (!['article', 'same'].includes(rule)) audit.loose.add(`${spelling} → ${player.shirt} ${player.name} (${rule})`);
        if (on.has(player)) throw new Error(`${season.id} ${team} ${box.date}: ${player.name} plays twice (${entry.token}); review it in names.lineupErrors (${key})`);
        on.add(player);
        const it = own(player);
        it.apps++;
        if (entry.started) it.starts++;
        if (season.minutes === 'lineups') {
          const from = entry.started ? 0 : entry.on;
          if (from == null) throw new Error(`${season.id} ${team} ${box.date}: ${entry.token} came on at no minute; review it in names.lineupErrors (${key})`);
          it.minutes += Math.max(0, Math.min(end, entry.off ?? end) - Math.min(end, from));
        }
      }
    });
  }
  if (unmatched.length) return { facts: null, audit, unmatched };
  if (used.size !== played.length) throw new Error(`${season.id}: line-ups for ${used.size} of its ${played.length} matches`);

  // Goals: by the scorer's article, else the link's title as her name (a redirect: "Guro Knutsen" for the article
  // Guro Knutsen Mienna), else the name the page writes, in her team's squad.
  for (const goal of goals) {
    if (goal.own) continue;
    const team = teamOf(goal.team);
    if (!team) throw new Error(`${season.id}: a goal for ${goal.team}, no team of the tournament`);
    const squad = squadOf(team);
    const player = (goal.title && (squad.find(p => p.title === goal.title) || matchName(goal.title.replace(/\s*\(.*\)$/, ''), squad)))
      || matchName(goal.name, squad);
    if (!player) throw new Error(`${season.id}: no ${team} player is the scorer ${goal.name}`);
    own(player).goals += goal.goals;
  }

  const active = [...snapshot.ratings].filter(([team]) => snapshot.last.get(team) >= since).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  const round1 = x => Math.round(x * 10) / 10;
  const nations = teams.slice().sort().map(team => {
    const results = names.eloAs?.[team] ?? resultsOf(team);
    const value = snapshot.ratings.get(results);
    if (value == null) throw new Error(`${season.id}: ${team} (${results} in the results) has no Elo on ${date}`);
    if (!(snapshot.last.get(results) >= since)) throw new Error(`${season.id}: ${team} played no match from ${since}`);
    const code = names.codes?.[team] ?? NATIONS[resolve(team)]?.[1];
    if (!code) throw new Error(`${season.id}: ${team} is no game nation`);
    const squad = squadOf(team).filter(player => !player.alternate || record.has(player)).map(player => {
      const it = record.get(player) || { minutes: 0, starts: 0, apps: 0, goals: 0 };
      if (!POSITIONS.includes(player.position)) throw new Error(`${season.id} ${team}: ${player.name} has no position`);
      return {
        id: `${year}-${code}-${player.shirt}`, name: player.name, shirt: player.shirt, position: player.position,
        ...(season.minutes === 'lineups' ? { minutes: it.minutes } : { apps: it.apps }), starts: it.starts, goals: it.goals, awards: [],
        born: player.born, wikipedia: player.title ? `https://en.wikipedia.org/wiki/${encodeURIComponent(player.title.replace(/ /g, '_')).replace(/%2F/g, '/')}` : '',
      };
    });
    return { team, results, elo: round1(value), rank: active.findIndex(([name]) => name === results) + 1, squad };
  });
  const facts = {
    id: season.id, year: season.year, licence: FACTS_LICENCE,
    tournament: { name: season.name, start: season.start, final: season.final, host: season.host, winner: season.winner },
    minutes: season.minutes, regulation: season.regulation, extraTime: season.extraTime,
    elo: { date, activeSince: since, active: active.length, best: { team: active[0][0], elo: round1(active[0][1]) } },
    nations,
  };
  return { facts, audit, unmatched };
}

