// FIBA's men's national-team results, 2023–2026, from English Wikipedia's article pages (scripts/sync-fiba-results.mjs),
// and what basketball's national fives read off them (scripts/build-basketball.mjs; docs/design/euroleague.md, "The
// nations' level"). No I/O here.
//
// - `gamesOfPage`: a saved article page → every game its game boxes show as played: the date, the two sides as the page
//   names them, the score, overtimes, the venue and which side, if either, was at home.
// - `resultsStrength`: the games → each side's Simple Rating System, each game weighed as its caller says (by its year:
//   scripts/lib/fiba-nations.mjs), the home edge fitted.

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—' };
const decode = s => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => (e[0] === '#'
  ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTITIES[e] ?? m));
/**
 * A cell's text: footnote markers and hidden spans out (Template:0's invisible figure that pads a score, "76–80 0(OT)"),
 * tags out, entities decoded, white space collapsed.
 */
const textOf = html => decode(html.replace(/<sup\b[\s\S]*?<\/sup>/g, '')
  .replace(/<span\b[^>]*(?:visibility:hidden|display:\s*none)[^>]*>[^<]*<\/span>/g, '').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
const cellsOf = row => [...row.matchAll(/<t([dh])\b[^>]*>([\s\S]*?)<\/t\1>/g)].map(m => m[2]);

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** '25 August 2023' → '2023-08-25'. */
export function isoDate(text) {
  const m = /^(\d{1,2}) ([A-Z][a-z]+) (\d{4})$/.exec(String(text).trim());
  const month = m ? MONTHS.indexOf(m[2]) : -1;
  if (month < 0) throw new Error(`Not a date: ${JSON.stringify(text)}`);
  return `${m[3]}-${String(month + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

/** A saved Wikipedia article page's own name and revision, and the title it was asked for when it redirected there. */
export function pageOf(html) {
  const revision = Number(/"wgRevisionId":(\d+)/.exec(html)?.[1]);
  const name = /"wgPageName":"((?:[^"\\]|\\.)*)"/.exec(html)?.[1];
  if (!Number.isInteger(revision) || revision <= 0 || !name) throw new Error('The page names no revision: is it a saved Wikipedia article?');
  const from = /"wgRedirectedFrom":"((?:[^"\\]|\\.)*)"/.exec(html)?.[1];
  const title = text => JSON.parse(`"${text}"`).replace(/_/g, ' ');
  return { page: title(name), revision, redirectedFrom: from ? title(from) : null };
}

/**
 * A game box's score text → `{ a, b, overtimes }`, or null when it shows none (a game not yet played: "vs."). Overtime
 * shows as "(OT)" or "(2OT)" after it, a two-legged tie's aggregate as "(161–150 agg.)", neither part of the game's score.
 */
export function scoreOf(text) {
  const m = /^(\d+)\s*–\s*(\d+)\s*(?:\((\d*)OT\)|\(\d+\s*–\s*\d+ agg\.\))?$/.exec(String(text).trim());
  if (!m) {
    if (/^vs\.?$/.test(String(text).trim()) || !String(text).trim()) return null;
    throw new Error(`Not a score: ${JSON.stringify(text)}`);
  }
  return { a: Number(m[1]), b: Number(m[2]), overtimes: m[3] === undefined ? 0 : Number(m[3] || 1) };
}

/**
 * The game boxes a page shows, in page order, as `{ date, a, b, score, venue }` texts. Two layouts: Template:Basketballbox's
 * (a date table, a report link, the teams and score, the venue: tournaments' pages), and Template:Basketballbox
 * collapsible's (one row of date, team, score, team and venue: the qualifiers' pages).
 */
export function boxesOf(html) {
  const boxes = [];
  const starts = [...html.matchAll(/<table style="[^"]*float:left; width:14%[^"]*"/g)].map(m => m.index);
  starts.forEach((start, i) => {
    const box = html.slice(start, starts[i + 1] ?? start + 40000);
    const date = /<div style="text-align:center">([\s\S]*?)(?:<br|<\/div>)/.exec(box)?.[1];
    const table = /<table style="[^"]*float:left; width:54%[^"]*">([\s\S]*?)<\/table>/.exec(box)?.[1];
    const row = table && /<tr\b[^>]*>([\s\S]*?)<\/tr>/.exec(table)?.[1];
    const venue = /<table style="[^"]*float:right; width:24%[^"]*">[\s\S]*?<div style="font-size:85%">([\s\S]*?)(?:<br|<\/div>)/.exec(box)?.[1];
    const cells = row ? cellsOf(row) : [];
    if (date == null || cells.length !== 3 || venue == null) throw new Error(`A game box at ${start} does not read: date, teams and score, venue`);
    boxes.push({ at: start, date: textOf(date), a: textOf(cells[0]), score: textOf(cells[1]), b: textOf(cells[2]), venue: textOf(venue) });
  });
  for (const m of html.matchAll(/<table\b[^>]*class="mw-collapsible mw-collapsed"[^>]*>\s*<tbody>\s*<tr>([\s\S]*?)<\/tr>/g)) {
    const cells = cellsOf(m[1]);
    if (cells.length !== 5) throw new Error(`A collapsible game box at ${m.index} has ${cells.length} cells, not 5`);
    boxes.push({ at: m.index, date: textOf(cells[0]), a: textOf(cells[1]), score: textOf(cells[2]), b: textOf(cells[3]), venue: textOf(cells[4]) });
  }
  return boxes.sort((x, y) => x.at - y.at).map(({ at, ...box }) => box);
}

/** The names a page gives one side that the facts keep as one: Wikipedia's flag templates call Czechia both. */
export const TEAM_ALIASES = Object.freeze({ 'Czech Republic': 'Czechia' });
const teamOf = name => TEAM_ALIASES[name] ?? name;

/**
 * Which side played at home: 'A', 'B', or 'N' (neutral). A tournament's page names the arena and its city, and `hosts`
 * gives the host cities' countries: a host nation plays at home there. A qualifiers' page names the city alone where the
 * first-named side plays at home, and the city and its country elsewhere (`countries`: the sides the page names): the
 * side of that country is at home, any other game neutral (a side's home game played abroad, or a window's games at one
 * host). A city whose name has a comma but no country after it ("Washington, D.C.") is a city alone.
 */
export function homeOf({ a, b, venue }, { kind, hosts = {} }, countries = new Set()) {
  const parts = venue.split(',').map(part => part.trim());
  if (kind === 'tournament') {
    const country = hosts[parts.at(-1)];
    if (!country) throw new Error(`${venue}: a host city the competition does not list`);
    return country === a ? 'A' : country === b ? 'B' : 'N';
  }
  if (kind !== 'qualifiers') throw new Error(`Unknown competition kind ${kind}`);
  const country = parts.length > 1 ? teamOf(parts.at(-1)) : null;
  if (!country || !countries.has(country)) return 'A';
  return country === a ? 'A' : country === b ? 'B' : 'N';
}

/**
 * Every game a saved page shows as played → `[date, competition, a, b, scoreA, scoreB, overtimes, home, venue]`, the facts'
 * rows (scripts/data/fiba-results.json). `competition` is `{ id, kind, hosts }` from the sources' list.
 */
export function gamesOfPage(html, competition) {
  const boxes = boxesOf(html).map(box => ({ ...box, a: teamOf(box.a), b: teamOf(box.b) }));
  const countries = new Set(boxes.flatMap(box => [box.a, box.b]));
  const games = [];
  for (const box of boxes) {
    const score = scoreOf(box.score);
    if (!score) continue;
    if (!box.a || !box.b || box.a === box.b) throw new Error(`${box.date}: a game box with sides ${JSON.stringify([box.a, box.b])}`);
    games.push([isoDate(box.date), competition.id, box.a, box.b, score.a, score.b, score.overtimes, homeOf(box, competition, countries), box.venue]);
  }
  return games;
}

/** The facts file's text: its head, then one game a line. */
export function factsText({ games, ...head }) {
  const json = JSON.stringify(head, null, 1).slice(0, -2);
  return `${json},\n "games": [\n${games.map(game => `  ${JSON.stringify(game)}`).join(',\n')}\n ]\n}\n`;
}

// ---------- the results' strength ----------

/**
 * The Simple Rating System of `games` (`[{ a, b, scoreA, scoreB, home: 'A' | 'B' | 'N', weight }]`): each side's rating and
 * one home edge that fit every margin, each game's squared miss weighed by its `weight`, the ratings summing to zero (as
 * computed-ratings.mjs's srsOf, weighted). Also `sigma`, a unit weight's margin spread about the fit, and `reliability`,
 * the share of the ratings' variance that is not their error's (at least 0). `homeEdge` given, it is used, not fitted.
 * → `{ ratings, homeEdge, sigma, reliability }`.
 */
export function resultsStrength(games, { homeEdge: fixedEdge = null } = {}) {
  const sides = [...new Set(games.flatMap(game => [game.a, game.b]))].sort();
  const n = sides.length, at = new Map(sides.map((side, i) => [side, i]));
  const total = games.reduce((sum, game) => sum + game.weight, 0);
  const norm = games.length / total; // weights to a mean of one, so that σ² is a unit weight's
  const size = n + 2;
  const m = Array.from({ length: size }, () => new Array(size).fill(0));
  const rhs = new Array(size).fill(0);
  // A home edge given is taken off each home margin, not fitted: the games of a tournament whose hosts never play away
  // cannot tell their ratings from it.
  const hasHome = fixedEdge == null && games.some(game => game.home !== 'N');
  for (const game of games) {
    const w = game.weight * norm;
    const row = new Array(n + 1).fill(0);
    row[at.get(game.a)] += 1;
    row[at.get(game.b)] -= 1;
    const sign = game.home === 'A' ? 1 : game.home === 'B' ? -1 : 0;
    row[n] = hasHome ? sign : 0;
    const margin = game.scoreA - game.scoreB - (fixedEdge ?? 0) * sign;
    for (let i = 0; i <= n; i++) {
      if (!row[i]) continue;
      for (let j = 0; j <= n; j++) m[i][j] += w * row[i] * row[j];
      rhs[i] += w * row[i] * margin;
    }
  }
  if (!hasHome) m[n][n] = 1;
  for (let i = 0; i < n; i++) { m[i][n + 1] = 1; m[n + 1][i] = 1; }
  const a = m.map((row, i) => [...row, ...Array.from({ length: size }, (_, j) => (i === j ? 1 : 0))]);
  for (let col = 0; col < size; col++) {
    let pivot = col;
    for (let r = col + 1; r < size; r++) if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r;
    if (Math.abs(a[pivot][col]) < 1e-12) throw new Error('The games do not rate every side: they are not all connected');
    [a[col], a[pivot]] = [a[pivot], a[col]];
    const lead = a[col][col];
    for (let c = 0; c < 2 * size; c++) a[col][c] /= lead;
    for (let r = 0; r < size; r++) {
      if (r === col || !a[r][col]) continue;
      const factor = a[r][col];
      for (let c = 0; c < 2 * size; c++) a[r][c] -= factor * a[col][c];
    }
  }
  const inverse = a.map(row => row.slice(size));
  const solution = inverse.map(row => row.reduce((sum, x, j) => sum + x * rhs[j], 0));
  const rating = sides.map((side, i) => solution[i]), edge = hasHome ? solution[n] : (fixedEdge ?? 0);
  let squares = 0;
  for (const game of games) {
    const fit = rating[at.get(game.a)] - rating[at.get(game.b)] + (game.home === 'A' ? edge : game.home === 'B' ? -edge : 0);
    squares += game.weight * norm * (game.scoreA - game.scoreB - fit) ** 2;
  }
  const sigma2 = squares / Math.max(1, games.length - (n + (hasHome ? 1 : 0) - 1));
  const error = sigma2 * sides.reduce((sum, side, i) => sum + inverse[i][i], 0) / n;
  const spread = rating.reduce((sum, r) => sum + r * r, 0) / n;
  return {
    ratings: Object.fromEntries(sides.map((side, i) => [side, rating[i]])),
    homeEdge: edge, sigma: Math.sqrt(sigma2), reliability: spread > 0 ? Math.max(0, 1 - error / spread) : 0,
  };
}

/** The sides `games` connect to `side` (a rating needs them joined): a Set of names. */
export function connectedSides(games, side) {
  const links = new Map();
  for (const game of games) {
    for (const [x, y] of [[game.a, game.b], [game.b, game.a]]) {
      if (!links.has(x)) links.set(x, new Set());
      links.get(x).add(y);
    }
  }
  const seen = new Set(links.has(side) ? [side] : []);
  for (const stack = [...seen]; stack.length;) for (const next of links.get(stack.pop()) ?? []) if (!seen.has(next)) { seen.add(next); stack.push(next); }
  return seen;
}
