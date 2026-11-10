// The facts a computed World Cup season is built from (docs/design/football-years.md, "Computed World Cup seasons"), read
// from pinned sources: the Fjelstul World Cup Database's CSV tables (squads, appearances, substitutions, sendings-off,
// goals, awards), martj42's results through the Elo engine (scripts/lib/football-elo.mjs), Wikipedia's Ballon d'Or voting
// tables and, for 1962 and 1966 (no substitutes, and no appearances in the database before 1970), the starting line-ups
// on Wikipedia's match pages. Pure: scripts/sync-world-cup-seasons.mjs reads the files and writes one snapshot per season
// (scripts/data/world-cup-seasons/<id>.json), which scripts/build-world-cup-seasons.mjs turns into the season.
import { parseCsv } from './football-data.mjs';
import { dayAfter, yearsBefore } from './football-elo.mjs';

// ---------- text ----------

/** CSV text → rows keyed by its header. */
export function csvRows(text) {
  const [head, ...body] = parseCsv(text.replace(/^﻿/, ''));
  return body.filter(row => row.length > 1).map((row, i) => {
    if (row.length !== head.length) throw new Error(`CSV row ${i + 2} has ${row.length} fields, not ${head.length}`);
    return Object.fromEntries(head.map((key, j) => [key, row[j]]));
  });
}

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'', nbsp: ' ', ndash: '–', mdash: '—' };
/** An HTML fragment's text: styles, references and tags dropped, entities decoded, spaces collapsed. */
export function htmlText(fragment) {
  return String(fragment)
    .replace(/<style[\s\S]*?<\/style>/g, '').replace(/<sup[\s\S]*?<\/sup>/g, '').replace(/<[^>]+>/g, '')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (whole, name) => NAMED[name.toLowerCase()] ?? whole)
    .replace(/[\s ]+/g, ' ').trim();
}

/**
 * An English Wikipedia article title from a link (`https://en.wikipedia.org/wiki/Gerd_M%C3%BCller`, `/wiki/Gerd_Müller`,
 * `./Gerd_Müller`), as the page names it with spaces; null for anything else (a missing article's edit link, another site).
 */
export function wikiTitle(href) {
  if (typeof href !== 'string') return null;
  const decoded = href.replace(/&amp;/g, '&');
  const m = /^(?:https?:\/\/en\.wikipedia\.org)?(?:\/wiki\/|\.\/)([^?#]+)(?:#.*)?$/.exec(decoded);
  if (!m) return null;
  let title;
  try { title = decodeURIComponent(m[1]); } catch { return null; }
  return title.replace(/_/g, ' ').normalize('NFC');
}

/** The revision a saved article page shows (`wgRevisionId`) and its page name. */
export function pageRevision(html) {
  const revision = Number(/"wgRevisionId":(\d+)/.exec(html)?.[1]);
  const page = /"wgPageName":"((?:[^"\\]|\\.)*)"/.exec(html)?.[1];
  if (!Number.isInteger(revision) || revision <= 0 || !page) throw new Error('The page names no revision: is it a saved Wikipedia article?');
  return { revision, page: JSON.parse(`"${page}"`).replace(/_/g, ' ') };
}

// Table rows: each <tr>, its cells with their attributes and HTML.
const rowsOf = html => [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].map(m => [...m[1].matchAll(/<t([dh])\b([^>]*)>([\s\S]*?)<\/t\1>/g)]
  .map(cell => ({ head: cell[1] === 'h', attrs: cell[2], html: cell[3] })));
const firstLink = html => {
  const m = /<a\b[^>]*\bhref="([^"]*)"[^>]*>([\s\S]*?)<\/a>/.exec(html);
  return m ? { title: wikiTitle(m[1]), text: htmlText(m[2]) } : null;
};

// ---------- Ballon d'Or ----------

/**
 * The voting table of a '<year> Ballon d'Or' article: `[{ rank, name, title, nationality, points }]`, a row whose cells
 * span several rows (tied ranks) copied into each. `title` is the player's article.
 */
export function ballonDorVotes(html) {
  const tables = [...html.matchAll(/<table\b[^>]*class="wikitable[^"]*"[^>]*>([\s\S]*?)<\/table>/g)].map(m => m[1]);
  const table = tables.filter(t => /Points/.test(t) && /Rank/.test(t));
  if (table.length !== 1) throw new Error(`Expected one voting table, found ${table.length}`);
  const [header, ...body] = rowsOf(table[0]);
  const columns = header.map(cell => htmlText(cell.html).toLowerCase());
  const col = name => columns.findIndex(text => text.startsWith(name));
  const at = { rank: col('rank'), name: col('name') >= 0 ? col('name') : col('player'), nationality: col('nation'), points: col('points') };
  if (Object.values(at).some(i => i < 0)) throw new Error(`The voting table has columns ${columns.join(', ')}`);
  const carried = new Map();
  const votes = [];
  for (const cells of body) {
    const row = [];
    let c = 0;
    const fill = () => {
      while (carried.get(c)?.left > 0) {
        const span = carried.get(c);
        row[c] = span.cell;
        if (!--span.left) carried.delete(c);
        c++;
      }
    };
    for (const cell of cells) {
      fill();
      row[c] = cell;
      const span = Number(/rowspan="?(\d+)/.exec(cell.attrs)?.[1] ?? 1);
      if (span > 1) carried.set(c, { cell, left: span - 1 });
      c++;
    }
    fill();
    if (row.length < columns.length || !row[at.name] || !row[at.points]) continue;
    const points = Number(htmlText(row[at.points].html).replace(/[^\d.]/g, ''));
    const link = firstLink(row[at.name].html);
    const name = htmlText(row[at.name].html);
    if (!name || !Number.isFinite(points)) continue;
    votes.push({ rank: htmlText(row[at.rank].html), name, title: link?.title ?? null, nationality: htmlText(row[at.nationality].html), points });
  }
  if (!votes.length) throw new Error('The voting table has no votes');
  return votes;
}

// ---------- line-ups (1962, 1966) ----------

const LINEUP_ROW = /^[A-Z]{2,3}$/;
/**
 * The starting line-ups of a World Cup match page (a group, or the knockout stage): per match box in page order, its
 * day, its two teams as the box names them, and the eleven of each `{ position, shirt, name, title }`, the home side's
 * table first. Throws unless each box is followed by exactly two tables of eleven.
 */
export function worldCupLineups(html) {
  const boxes = html.split(/(?=<div\b[^>]*class="footballbox")/).filter(part => /^<div\b[^>]*class="footballbox"/.test(part));
  if (!boxes.length) throw new Error('The page has no match boxes');
  return boxes.map((box, i) => {
    const at = `match box ${i + 1}`;
    const date = /class="bday dtstart[^"]*"[^>]*>(\d{4}-\d{2}-\d{2})</.exec(box)?.[1];
    const side = cls => {
      const m = new RegExp(`<th\\b[^>]*class="${cls}"[^>]*>([\\s\\S]*?)</th>`).exec(box);
      return m ? firstLink(m[1]) : null;
    };
    const home = side('fhome'), away = side('faway');
    const score = htmlText(/<th\b[^>]*class="fscore"[^>]*>([\s\S]*?)<\/th>/.exec(box)?.[1] ?? '');
    if (!date || !home || !away) throw new Error(`${at}: no day or teams`);
    // Each line-up is a table of its own: the rows between one <table and the next.
    const lineups = box.split(/<table\b/).map(part => rowsOf(part)
      .filter(cells => cells.length >= 3 && LINEUP_ROW.test(htmlText(cells[0].html)) && /^\d{1,2}$/.test(htmlText(cells[1].html)))
      .map(cells => {
        const link = firstLink(cells[2].html);
        return { position: htmlText(cells[0].html), shirt: Number(htmlText(cells[1].html)),
          name: link?.text || htmlText(cells[2].html).replace(/\s*\(c\)\s*$/, ''), title: link?.title ?? null };
      })).filter(rows => rows.length);
    if (lineups.length !== 2 || lineups.some(rows => rows.length !== 11)) {
      throw new Error(`${at} (${home.text} v ${away.text}, ${date}): line-ups of ${lineups.map(rows => rows.length).join(' and ') || 'none'}`);
    }
    return { date, home: home.text, away: away.text, score, lineups };
  });
}

// ---------- the season's facts ----------

/** The World Cup awards the database lists, in the order a player's are written. */
export const AWARDS = ['Golden Ball', 'Silver Ball', 'Bronze Ball', 'Golden Boot', 'Silver Boot', 'Bronze Boot', 'Golden Glove', 'Best Young Player'];
export const fold = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const round1 = x => Math.round(x * 10) / 10;

/**
 * One World Cup's facts: each finalist's squad with every player's minutes, starts, goals, awards, Ballon d'Or points of
 * the two calendar years the season spans, date of birth and Wikipedia article, and the teams' Elo the day after the
 * final. `wc` holds the Fjelstul tables by file name (rows); `lineups` the parsed line-up pages of a season before 1970
 * (worldCupLineups' boxes); `votes` `{ [year]: ballonDorVotes }`; `season` the manifest's entry; `elo` the manifest's
 * Elo block and `snapshot` the Elo on the day after the final (eloOn's); `names` the manifest's names. Returns
 * `{ facts, audit }`: the audit lists the line-up names that differ from the database's (`spellings`), which pinned
 * Ballon d'Or names were used (`pinned`), and every vote matched to no squad player (`unmatched`).
 */
export function worldCupFacts({ wc, lineups = null, votes, season, elo, snapshot, names }) {
  const tid = season.tournament;
  const tournament = wc.tournaments.find(t => t.tournament_id === tid);
  if (!tournament) throw new Error(`${tid} is not in tournaments.csv`);
  if (Number(tournament.year) !== season.year) throw new Error(`${tid} is the ${tournament.year} World Cup, not ${season.year}'s`);
  const date = dayAfter(tournament.end_date);
  if (!snapshot) throw new Error(`${tid}: no Elo on ${date}`);
  const since = yearsBefore(date, elo.activeYears);
  const people = new Map(wc.players.map(p => [p.player_id, p]));
  const games = wc.matches.filter(m => m.tournament_id === tid);
  const gameOf = new Map(games.map(m => [m.match_id, m]));
  const squadRows = wc.squads.filter(r => r.tournament_id === tid);
  const teams = [...new Set(squadRows.map(r => r.team_name))].sort();
  const audit = { spellings: [], pinned: [], unmatched: [] };

  // Minutes and starts: from the appearances from 1970, else from the line-ups (no substitutes then, so every starter
  // plays the whole match, 120 minutes with extra time).
  const minutes = new Map(), starts = new Map();
  const add = (player, mins, started) => {
    minutes.set(player, (minutes.get(player) || 0) + mins);
    if (started) starts.set(player, (starts.get(player) || 0) + 1);
  };
  if (season.minutes === 'appearances') {
    const apps = wc.player_appearances.filter(r => r.tournament_id === tid);
    if (!apps.length) throw new Error(`${tid} has no appearances in the database`);
    const subs = wc.substitutions.filter(r => r.tournament_id === tid);
    const offs = wc.bookings.filter(r => r.tournament_id === tid && r.sending_off === '1');
    const minuteOf = row => {
      const minute = Number(row.minute_regulation);
      if (!Number.isInteger(minute) || minute < 0) throw new Error(`${tid}: minute ${row.minute_regulation} for ${row.family_name}`);
      return Math.min(120, minute);
    };
    const key = row => `${row.match_id}|${row.player_id}`;
    const once = (rows, what) => {
      const map = new Map();
      for (const row of rows) {
        if (map.has(key(row))) throw new Error(`${tid}: ${row.family_name} ${what} twice in ${row.match_name}`);
        map.set(key(row), row);
      }
      return map;
    };
    const cameOn = once(subs.filter(r => r.coming_on === '1'), 'came on'), wentOff = once(subs.filter(r => r.going_off === '1'), 'went off');
    const sentOff = once(offs, 'was sent off');
    for (const app of apps) {
      const game = gameOf.get(app.match_id);
      if (!game) throw new Error(`Appearance ${app.key_id} is in no ${tid} match`);
      const end = game.extra_time === '1' ? 120 : 90;
      const on = app.starter === '1' ? 0 : cameOn.has(key(app)) ? minuteOf(cameOn.get(key(app))) : end;
      let off = end;
      if (wentOff.has(key(app))) off = minuteOf(wentOff.get(key(app)));
      if (sentOff.has(key(app))) off = Math.min(off, minuteOf(sentOff.get(key(app))));
      add(app.player_id, Math.max(0, off - on), app.starter === '1');
    }
  } else if (season.minutes === 'lineups') {
    if (!lineups) throw new Error(`${tid} needs its line-up pages`);
    const used = new Set();
    for (const box of lineups) {
      const game = games.find(m => m.match_date === box.date && m.home_team_name === box.home && m.away_team_name === box.away);
      if (!game) throw new Error(`${tid}: no match ${box.home} v ${box.away} on ${box.date}`);
      if (used.has(game.match_id)) throw new Error(`${tid}: ${game.match_name} has two line-up boxes`);
      used.add(game.match_id);
      const end = game.extra_time === '1' ? 120 : 90;
      box.lineups.forEach((eleven, side) => {
        const team = side ? box.away : box.home;
        const shirts = new Set();
        for (const starter of eleven) {
          if (shirts.has(starter.shirt)) throw new Error(`${tid} ${game.match_name}: ${team} lists number ${starter.shirt} twice`);
          shirts.add(starter.shirt);
          const row = squadRows.find(r => r.team_name === team && Number(r.shirt_number) === starter.shirt);
          if (!row) throw new Error(`${tid} ${game.match_name}: ${team} has no number ${starter.shirt} (${starter.name})`);
          // The page and the database must name the same man: by his article, or his surname.
          const sameArticle = starter.title && wikiTitle(people.get(row.player_id)?.player_wikipedia_link) === starter.title;
          const sameName = fold(starter.name).split(' ').pop() === fold(row.family_name).split(' ').pop();
          if (!sameArticle && !sameName) {
            const spelling = { year: season.year, team, shirt: starter.shirt, wikipedia: starter.name,
              database: `${row.given_name === 'not applicable' ? '' : `${row.given_name} `}${row.family_name}` };
            if (!audit.spellings.some(s => s.team === team && s.shirt === starter.shirt)) audit.spellings.push(spelling);
          }
          add(row.player_id, end, true);
        }
      });
    }
    if (used.size !== games.length) throw new Error(`${tid}: line-ups for ${used.size} of its ${games.length} matches`);
  } else {
    throw new Error(`${season.id}: minutes must come from "appearances" or "lineups"`);
  }

  const goals = new Map();
  for (const g of wc.goals) if (g.tournament_id === tid && g.own_goal === '0') goals.set(g.player_id, (goals.get(g.player_id) || 0) + 1);
  const awards = new Map();
  for (const a of wc.award_winners) {
    if (a.tournament_id !== tid) continue;
    if (!AWARDS.includes(a.award_name)) throw new Error(`${tid}: unknown award ${a.award_name}`);
    (awards.get(a.player_id) || awards.set(a.player_id, []).get(a.player_id)).push(a.award_name);
  }

  // Ballon d'Or points: by the player's article, else by his name and nation, else by a name the manifest pins to him.
  const squadIds = new Set(squadRows.map(r => r.player_id));
  // A given name that already ends with the family name is the whole name: the database's 1994 Moroccan "El Arbi
  // Hababi" (given) "Hababi" (family) is El Arbi Hababi, not El Arbi Hababi Hababi.
  const nameOf = r => (r.given_name === 'not applicable' ? r.family_name
    : r.given_name.endsWith(` ${r.family_name}`) ? r.given_name : `${r.given_name} ${r.family_name}`);
  const byTitle = new Map(), byName = new Map();
  for (const r of squadRows) {
    const title = wikiTitle(people.get(r.player_id)?.player_wikipedia_link);
    if (title) byTitle.set(title, r.player_id);
    byName.set(`${fold(nameOf(r))}|${r.team_name}`, r.player_id);
  }
  const pins = new Map((names.ballonDorPlayers || []).filter(pin => squadIds.has(pin.player)).map(pin => [pin.name, pin.player]));
  const ballonDor = new Map();
  for (const year of season.ballonDor) {
    if (!votes[year]) throw new Error(`${tid}: no Ballon d'Or votes of ${year}`);
    for (const vote of votes[year]) {
      const team = names.ballonDorNationalities?.[vote.nationality] ?? vote.nationality;
      let player = (vote.title && byTitle.get(vote.title)) || byName.get(`${fold(vote.name)}|${team}`);
      if (!player && pins.has(vote.name)) {
        player = pins.get(vote.name);
        audit.pinned.push(vote.name);
      }
      if (!player) {
        audit.unmatched.push({ year, name: vote.name, nationality: vote.nationality, points: vote.points });
        continue;
      }
      const own = ballonDor.get(player) || ballonDor.set(player, {}).get(player);
      own[year] = (own[year] || 0) + vote.points;
    }
  }

  const active = [...snapshot.ratings].filter(([team]) => snapshot.last.get(team) >= since).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  const nations = teams.map(team => {
    const results = names.results?.[team] ?? team;
    const value = snapshot.ratings.get(results);
    if (value == null) throw new Error(`${tid}: ${team} (${results} in the results) has no Elo on ${date}`);
    if (!(snapshot.last.get(results) >= since)) throw new Error(`${tid}: ${team} played no match from ${since}`);
    const squad = squadRows.filter(r => r.team_name === team)
      .sort((a, b) => Number(a.shirt_number) - Number(b.shirt_number) || (a.player_id < b.player_id ? -1 : 1))
      .map(r => {
        const person = people.get(r.player_id);
        if (!person) throw new Error(`${tid} ${team}: player ${r.player_id} is not in players.csv`);
        if (!['GK', 'DF', 'MF', 'FW'].includes(r.position_code)) throw new Error(`${tid} ${team}: ${r.family_name} has position ${r.position_code}`);
        return {
          id: r.player_id, name: nameOf(r), shirt: Number(r.shirt_number), position: r.position_code,
          minutes: minutes.get(r.player_id) || 0, starts: starts.get(r.player_id) || 0, goals: goals.get(r.player_id) || 0,
          awards: (awards.get(r.player_id) || []).slice().sort((a, b) => AWARDS.indexOf(a) - AWARDS.indexOf(b)),
          ballonDor: Object.fromEntries(Object.entries(ballonDor.get(r.player_id) || {}).sort()),
          born: /^\d{4}-\d{2}-\d{2}$/.test(person.birth_date) ? person.birth_date : '',
          wikipedia: /^https:\/\/en\.wikipedia\.org\/wiki\/\S+$/.test(person.player_wikipedia_link) ? person.player_wikipedia_link : '',
        };
      });
    return { team, results, elo: round1(value), rank: active.findIndex(([name]) => name === results) + 1, squad };
  });
  for (const id of [...minutes.keys(), ...goals.keys(), ...awards.keys()]) if (!squadIds.has(id)) throw new Error(`${tid}: player ${id} is in no squad`);

  const facts = {
    id: season.id, year: season.year,
    licence: 'CC BY-SA 4.0: derived from the Fjelstul World Cup Database and Wikipedia (public/football/ATTRIBUTION-world-cup.txt)',
    tournament: { id: tid, name: tournament.tournament_name, start: tournament.start_date, final: tournament.end_date, host: tournament.host_country, winner: tournament.winner },
    minutes: season.minutes, ballonDor: season.ballonDor,
    elo: { date, activeSince: since, active: active.length, best: { team: active[0][0], elo: round1(active[0][1]) } },
    unmatchedVotes: audit.unmatched,
    nations,
  };
  return { facts, audit };
}

/** A season's facts as committed: a field a line, a list of records one record a line, and each nation's squad one player a line. */
export function factsText(facts) {
  const { nations, ...head } = facts;
  const value = v => (Array.isArray(v) && v.some(item => item && typeof item === 'object')
    ? `[\n${v.map(item => `    ${JSON.stringify(item)}`).join(',\n')}\n  ]` : JSON.stringify(v));
  const fields = Object.entries(head).map(([key, v]) => `  ${JSON.stringify(key)}: ${value(v)}`);
  const nationText = nations.map(({ squad, ...nation }) => `    ${JSON.stringify(nation).replace(/}$/, '')},"squad":[\n${
    squad.map(player => `      ${JSON.stringify(player)}`).join(',\n')}\n    ]}`).join(',\n');
  return `{\n${fields.join(',\n')},\n  "nations": [\n${nationText}\n  ]\n}\n`;
}

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
const round3 = x => Math.round(x * 1000) / 1000;

/**
 * The computed year-end Elo against eloratings.net's published table of the same year (cross-check only): `table` its
 * rows `[marker, rank, code, elo, …]`, `codes` code → its English name, `ratings` the computed Elo on 1 January of
 * the next year, `aliases` its names → the results'. Pearson over every team both have, Spearman over its top 48
 * that the results have, and the slope of the computed Elo on the published.
 */
export function eloCrossCheck({ year, table, codes, ratings, aliases }) {
  const published = table.map(cells => ({ name: codes[cells[2]] ?? cells[2], elo: Number(cells[3]) }));
  const pairs = published.map(p => ({ ...p, ours: ratings.get(aliases[p.name] ?? p.name) })).filter(p => p.ours != null);
  const top = pairs.slice(0, 48);
  const theirs = pairs.map(p => p.elo), ours = pairs.map(p => p.ours);
  const mx = mean(theirs), my = mean(ours);
  const slope = pairs.reduce((s, p) => s + (p.elo - mx) * (p.ours - my), 0) / pairs.reduce((s, p) => s + (p.elo - mx) ** 2, 0);
  return { year, published: published.length, matched: pairs.length, pearson: round3(pearson(theirs, ours)),
    spearmanTop48: round3(pearson(ranks(top.map(p => p.elo)), ranks(top.map(p => p.ours)))), slope: round3(slope),
    leaders: { published: published.slice(0, 5).map(p => p.name), computed: [...ratings].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name]) => name) } };
}
