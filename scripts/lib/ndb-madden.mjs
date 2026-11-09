// NFL Draft Buzz's copy of EA's Madden NFL 99, 2000 and 2001 data (docs/design/american-football.md, "Madden NFL 99 to
// 2001"): reading its team pages and position lists, its positions as the game's, and the overall Madden NFL 99 and
// 2000 never recorded. scripts/sync-madden-early.mjs runs it over the pinned pages. No I/O here.
//
// The ratings are EA SPORTS'; the compilation, and the names its matcher gave the players, are NFL Draft Buzz's. Where an
// edition recorded no overall, the site shows a synthetic one marked OVR* (its two best attributes averaged): it is the
// site's, not EA's, and is never read.

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', eacute: 'é' };
/** HTML text as plain text: entities decoded, runs of white space as one. */
export const decodeHtml = text => String(text ?? '').replace(/&(?:#x([0-9a-f]+)|#(\d+)|([a-z]+));/gi, (whole, hex, dec, name) => (hex
  ? String.fromCodePoint(parseInt(hex, 16)) : dec ? String.fromCodePoint(Number(dec)) : ENTITIES[name.toLowerCase()] ?? whole))
  .replace(/\s+/g, ' ').trim();

/** The editions read here, by the year in NFL Draft Buzz's URLs (Madden NFL 99 is 1999): the NFL season each rates. */
export const EDITIONS = {
  1999: { edition: 'Madden NFL 99', season: 1998, overall: false },
  2000: { edition: 'Madden NFL 2000', season: 1999, overall: false },
  2001: { edition: 'Madden NFL 2001', season: 2000, overall: true },
};
/** The position lists, one page per group of positions. */
export const LIST_GROUPS = ['qb', 'rb', 'wr', 'te', 'ol', 'dl', 'lb', 'db', 'st'];

// The franchises by the nicknames NFL Draft Buzz's team pages go by (today's: the Commanders, the Titans), and by the
// team codes its position lists give.
export const FRANCHISE_OF_SLUG = {
  Cardinals: 'nfl-arizona-cardinals', Falcons: 'nfl-atlanta-falcons', Ravens: 'nfl-baltimore-ravens', Bills: 'nfl-buffalo-bills',
  Panthers: 'nfl-carolina-panthers', Bears: 'nfl-chicago-bears', Bengals: 'nfl-cincinnati-bengals', Browns: 'nfl-cleveland-browns',
  Cowboys: 'nfl-dallas-cowboys', Broncos: 'nfl-denver-broncos', Lions: 'nfl-detroit-lions', Packers: 'nfl-green-bay-packers',
  Texans: 'nfl-houston-texans', Colts: 'nfl-indianapolis-colts', Jaguars: 'nfl-jacksonville-jaguars', Chiefs: 'nfl-kansas-city-chiefs',
  Raiders: 'nfl-las-vegas-raiders', Chargers: 'nfl-los-angeles-chargers', Rams: 'nfl-los-angeles-rams', Dolphins: 'nfl-miami-dolphins',
  Vikings: 'nfl-minnesota-vikings', Patriots: 'nfl-new-england-patriots', Saints: 'nfl-new-orleans-saints', Giants: 'nfl-new-york-giants',
  Jets: 'nfl-new-york-jets', Eagles: 'nfl-philadelphia-eagles', Steelers: 'nfl-pittsburgh-steelers', '49ers': 'nfl-san-francisco-49ers',
  Seahawks: 'nfl-seattle-seahawks', Buccaneers: 'nfl-tampa-bay-buccaneers', Titans: 'nfl-tennessee-titans', Commanders: 'nfl-washington-commanders',
};
export const FRANCHISE_OF_CODE = {
  ARI: 'nfl-arizona-cardinals', ATL: 'nfl-atlanta-falcons', BAL: 'nfl-baltimore-ravens', BUF: 'nfl-buffalo-bills', CAR: 'nfl-carolina-panthers',
  CHI: 'nfl-chicago-bears', CIN: 'nfl-cincinnati-bengals', CLE: 'nfl-cleveland-browns', DAL: 'nfl-dallas-cowboys', DEN: 'nfl-denver-broncos',
  DET: 'nfl-detroit-lions', GB: 'nfl-green-bay-packers', HOU: 'nfl-houston-texans', IND: 'nfl-indianapolis-colts', JAX: 'nfl-jacksonville-jaguars',
  KC: 'nfl-kansas-city-chiefs', OAK: 'nfl-las-vegas-raiders', SD: 'nfl-los-angeles-chargers', STL: 'nfl-los-angeles-rams', MIA: 'nfl-miami-dolphins',
  MIN: 'nfl-minnesota-vikings', NE: 'nfl-new-england-patriots', NO: 'nfl-new-orleans-saints', NYG: 'nfl-new-york-giants', NYJ: 'nfl-new-york-jets',
  PHI: 'nfl-philadelphia-eagles', PIT: 'nfl-pittsburgh-steelers', SF: 'nfl-san-francisco-49ers', SEA: 'nfl-seattle-seahawks',
  TB: 'nfl-tampa-bay-buccaneers', TEN: 'nfl-tennessee-titans', WSH: 'nfl-washington-commanders', WAS: 'nfl-washington-commanders',
};
/** The franchises whose team pages are empty for these editions (they have moved since): their players come from the lists. */
export const LIST_ONLY = new Set(['nfl-las-vegas-raiders', 'nfl-los-angeles-chargers', 'nfl-los-angeles-rams']);

// ---------- reading the pages ----------

const cellsOf = row => [...row.matchAll(/<td\b([^>]*)>([\s\S]*?)<\/td>/g)].map(m => ({ attrs: m[1], html: m[2] }));
const nameOf = html => decodeHtml(`${/<span class="firstName">([\s\S]*?)<br \/><\/span>/.exec(html)?.[1] ?? ''} ${/<span class="lastName">([\s\S]*?)<\/span>/.exec(html)?.[1] ?? ''}`);
const hrefOf = html => /href="(\/madden\/player\/[^"]+)"/.exec(html)?.[1] ?? null;

/**
 * A team page (/madden/team/<nickname>/<edition>): `{ team, edition, season, rows }`, each row `{ name, href, listed,
 * no, attributes, overall? }`, `listed` the page's position ('LLB', 'LT/RT'), `no` the jersey (null without one),
 * `attributes` by the page's abbreviations (a value the edition did not track is absent) and `overall` EA's, where the
 * edition recorded one (a column headed OVR). A column headed OVR* (the site's own) is never read.
 */
export function parseTeamPage(html) {
  const title = decodeHtml(/<title>([\s\S]*?)<\/title>/.exec(html)?.[1]);
  const m = /^(.+?) Madden NFL (\d{4}) Player Ratings.* - (\d{4}) Roster$/.exec(title);
  if (!m) throw new Error(`Not a team page: ${title}`);
  const rows = [];
  for (const [, table] of html.matchAll(/<table class="mt-table">([\s\S]*?)<\/table>/g)) {
    const heads = [...(/<thead>([\s\S]*?)<\/thead>/.exec(table)?.[1] ?? '').matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/g)].map(h => decodeHtml(h[1]));
    if (heads.slice(0, 3).join('|') !== 'Player|Pos|#') throw new Error(`${title}: a table headed ${heads.slice(0, 3).join(', ')}`);
    for (const [, row] of (/<tbody>([\s\S]*?)<\/tbody>/.exec(table)?.[1] ?? '').matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
      const cells = cellsOf(row);
      if (cells.length !== heads.length) throw new Error(`${title}: a row of ${cells.length} cells under ${heads.length} headings`);
      const attributes = {};
      let overall;
      heads.slice(3).forEach((head, i) => {
        const badge = /title="([^"]*)"[^>]*>([^<]*)</.exec(cells[i + 3].html);
        if (!badge) throw new Error(`${title}: an empty ${head} cell`);
        if (/^Not tracked/.test(badge[1])) return;
        const value = Number(badge[2]);
        if (badge[1] !== `${head}: ${badge[2]}` || !Number.isInteger(value)) throw new Error(`${title}: ${head} reads "${badge[1]}"`);
        if (head === 'OVR') overall = value;
        else if (!head.endsWith('*')) attributes[head] = value;
      });
      const no = /#?(\d+)/.exec(decodeHtml(cells[2].html))?.[1];
      rows.push({ name: nameOf(cells[0].html), href: hrefOf(cells[0].html), listed: decodeHtml(cells[1].html), no: no ? Number(no) : null,
        attributes, ...(overall !== undefined ? { overall } : {}) });
    }
  }
  return { team: m[1], edition: Number(m[2]), season: Number(m[3]), rows };
}

/**
 * A position list (/madden/year/<edition>/<group>): `{ edition, rows }`, each row `{ name, href, listed, code,
 * attributes, overall? }`, `code` the team's ('OAK'). The list shows a few attributes per group; `overall` is EA's only
 * under a column headed OVR, and the site's OVR* is never read.
 */
export function parseList(html) {
  const title = decodeHtml(/<title>([\s\S]*?)<\/title>/.exec(html)?.[1]);
  const edition = Number(/Madden NFL (\d{4})/.exec(title)?.[1] ?? /Madden (\d{2})\b/.exec(title)?.[1]);
  const rows = [];
  for (const [table] of html.matchAll(/<table class="my-table[\s\S]*?<\/table>/g)) {
    const heads = [...table.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/g)].map(h => decodeHtml(h[1]));
    if (heads.slice(0, 3).join('|') !== '#|Player|Team') throw new Error(`${title}: a list headed ${heads.slice(0, 3).join(', ')}`);
    for (const [, row] of table.matchAll(/<tr>\s*(<td class="my-rk">[\s\S]*?)<\/tr>/g)) {
      const cells = cellsOf(row);
      if (cells.length !== heads.length) throw new Error(`${title}: a row of ${cells.length} cells under ${heads.length} headings`);
      const attributes = {};
      let overall;
      heads.slice(3).forEach((head, i) => {
        const value = /data-sortval="([^"]*)"/.exec(cells[i + 3].attrs)?.[1];
        if (value === undefined || value === '') return;
        if (!/^\d+$/.test(value)) throw new Error(`${title}: ${head} reads "${value}"`);
        if (head === 'OVR') overall = Number(value);
        else if (!head.endsWith('*')) attributes[head] = Number(value);
      });
      rows.push({ name: decodeHtml(/data-sortval="([^"]*)"/.exec(cells[1].attrs)?.[1]), href: hrefOf(cells[1].html),
        listed: decodeHtml(/<div class="lastName"[^>]*>([^<]*)<\/div>/.exec(cells[1].html)?.[1]),
        code: /data-sortval="([^"]*)"/.exec(cells[2].attrs)?.[1] ?? '', attributes, ...(overall !== undefined ? { overall } : {}) });
    }
  }
  return { title, edition, rows };
}

/**
 * A player page (/madden/player/<id>-<slug>): his attributes in one edition, `{ name, listed, team, attributes, overall? }`,
 * or null when the page has no row for it. Read only for the few players whose values the conversion needs and neither
 * the team page nor the position list shows (a kicker's power and accuracy on a club with no team page; the blocking or
 * catching of a player a team page lists under two positions).
 */
export function parsePlayerEdition(html, edition) {
  const name = decodeHtml(/<title>([^<(]*?)(?: \([^)<]*\))? Madden (?:Career )?Ratings/.exec(html)?.[1]);
  for (const [, table] of html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/g)) {
    const heads = [...table.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/g)].map(h => decodeHtml(h[1].replace(/<[^>]+>/g, ' ')));
    if (heads.slice(0, 4).join('|') !== 'Madden|Team|Pos|OVR') continue;
    for (const [, row] of table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)) {
      const cells = cellsOf(row);
      if (cells.length !== heads.length) continue;
      if (/\/madden\/year\/(\d{4})"/.exec(cells[0].html)?.[1] !== String(edition)) continue;
      const attributes = {};
      let overall;
      heads.slice(3).forEach((head, i) => {
        const badge = /<span class="rtg-badge([^"]*)"[^>]*>(\d+)/.exec(cells[i + 3].html);
        if (!badge) return;
        // The site's own overall, where EA published none, is marked rtg-syn: never read.
        if (head === 'OVR') { if (!/rtg-syn/.test(badge[1])) overall = Number(badge[2]); return; }
        attributes[head === 'Speed' ? 'SPD' : head] = Number(badge[2]);
      });
      return { name, listed: decodeHtml(cells[2].html), team: /\/madden\/team\/([^/"]+)\//.exec(cells[1].html)?.[1] ?? null,
        attributes, ...(overall !== undefined ? { overall } : {}) };
    }
  }
  return null;
}

// ---------- positions ----------

/** NFL Draft Buzz's position labels as the game's ten, and P and LS (no place in the lineup). 'DB' is left to `dbPosition`. */
export const POSITION_OF = {
  QB: 'QB', HB: 'RB', RB: 'RB', FB: 'RB', WR: 'WR', TE: 'TE',
  LT: 'OL', LG: 'OL', C: 'OL', RG: 'OL', RT: 'OL', T: 'OL', G: 'OL', OT: 'OL', OG: 'OL',
  DE: 'DL', DT: 'DL', NT: 'DL', LE: 'DL', RE: 'DL', LDE: 'DL', RDE: 'DL', LDT: 'DL', RDT: 'DL',
  LB: 'LB', MLB: 'LB', ILB: 'LB', OLB: 'LB', LLB: 'LB', RLB: 'LB', LOLB: 'LB', ROLB: 'LB', LILB: 'LB', RILB: 'LB',
  CB: 'CB', LCB: 'CB', RCB: 'CB', FS: 'S', SS: 'S', S: 'S', K: 'K', P: 'P', LS: 'LS',
};
/** The groups the conversion's weights are fitted for: the game's positions, with the line split into tackles, guards and centres. */
export const GROUP_OF = { LT: 'OT', RT: 'OT', T: 'OT', OT: 'OT', LG: 'OG', RG: 'OG', G: 'OG', OG: 'OG', C: 'C' };
/** A label's first position ('LT/RT' → 'LT'). */
export const firstLabel = listed => String(listed).split('/')[0].trim();
/**
 * The game position of a player the site lists at `listed`: the first of its positions, mapped (null for 'DB', a generic
 * defensive back, whom `dbPosition` places). Throws on a label it does not know.
 */
export function positionOf(listed) {
  const first = firstLabel(listed);
  if (first === 'DB') return null;
  const position = POSITION_OF[first];
  if (!position) throw new Error(`Unknown position ${listed}`);
  return position;
}
/** The fit group of a player at game position `position`, listed `listed`. */
export const groupOf = (position, listed) => (position === 'OL' ? GROUP_OF[firstLabel(listed)] ?? 'OG' : position);

// ---------- the overall: weighted attributes ----------

/**
 * The attributes each group is scored by: those the team pages and the position lists of Madden NFL 99 and 2000 both
 * show for it (the lists show fewer), so every player of a season is scored alike. Kickers by their power and accuracy,
 * which only the team pages (and the player pages) show.
 */
export const ATTRIBUTES = {
  QB: ['THP', 'THA', 'AWR', 'SPD', 'AGI', 'ACC'],
  RB: ['SPD', 'ACC', 'AGI', 'AWR', 'STR', 'CAR'],
  WR: ['SPD', 'ACC', 'AGI', 'AWR', 'CTH'],
  TE: ['SPD', 'ACC', 'AGI', 'AWR', 'STR', 'CTH'],
  OT: ['AWR', 'STR', 'AGI', 'PBK', 'RBK'], OG: ['AWR', 'STR', 'AGI', 'PBK', 'RBK'], C: ['AWR', 'STR', 'AGI', 'PBK', 'RBK'],
  DL: ['STR', 'SPD', 'ACC', 'AGI', 'AWR', 'TAK'],
  LB: ['SPD', 'ACC', 'AGI', 'AWR', 'STR', 'TAK'],
  CB: ['SPD', 'ACC', 'AGI', 'AWR', 'TAK', 'CTH'], S: ['SPD', 'ACC', 'AGI', 'AWR', 'TAK', 'CTH'],
  K: ['AWR', 'KPW', 'KAC'],
};
/** The lists call tackling TKL, the team pages TAK. */
export const normaliseAttributes = attributes => Object.fromEntries(Object.entries(attributes).map(([k, v]) => [k === 'TKL' ? 'TAK' : k, v]));

/** Least squares with an intercept: `[b0, b1 …]` for rows `x` and targets `y` (normal equations, partial pivoting). */
export function leastSquares(x, y) {
  const k = x[0].length + 1;
  const a = Array.from({ length: k }, () => Array(k).fill(0)), b = Array(k).fill(0);
  x.forEach((row, i) => {
    const r = [1, ...row];
    for (let p = 0; p < k; p++) { b[p] += r[p] * y[i]; for (let q = 0; q < k; q++) a[p][q] += r[p] * r[q]; }
  });
  for (let c = 0; c < k; c++) {
    let pivot = c;
    for (let r = c + 1; r < k; r++) if (Math.abs(a[r][c]) > Math.abs(a[pivot][c])) pivot = r;
    if (Math.abs(a[pivot][c]) < 1e-12) throw new Error('The attributes do not determine the overall (a singular fit)');
    [a[c], a[pivot]] = [a[pivot], a[c]];
    [b[c], b[pivot]] = [b[pivot], b[c]];
    for (let r = 0; r < k; r++) {
      if (r === c) continue;
      const f = a[r][c] / a[c][c];
      for (let q = c; q < k; q++) a[r][q] -= f * a[c][q];
      b[r] -= f * b[c];
    }
  }
  return b.map((v, i) => v / a[i][i]);
}
/** Weights rounded to six decimals, as the snapshot stores and the builder applies them. */
export const roundWeights = weights => weights.map(w => Math.round(w * 1e6) / 1e6);
/** A player's score: the intercept plus each attribute times its weight (six decimals). */
export function scoreOf(group, weights, attributes) {
  const w = weights[group];
  if (!w) throw new Error(`No weights for ${group}`);
  let total = w[0];
  ATTRIBUTES[group].forEach((name, i) => {
    if (!Number.isFinite(attributes[name])) throw new Error(`No ${name} for a ${group} (${JSON.stringify(attributes)})`);
    total += w[i + 1] * attributes[name];
  });
  return Math.round(total * 1e6) / 1e6;
}

// ---------- statistics ----------

/** Mid-ranks (ties share one). */
export function ranks(values) {
  const order = values.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const out = Array(values.length);
  for (let i = 0; i < order.length;) {
    let j = i;
    while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++;
    for (let q = i; q <= j; q++) out[order[q][1]] = (i + j) / 2;
    i = j + 1;
  }
  return out;
}
const pearson = (x, y) => {
  const n = x.length, mx = x.reduce((a, b) => a + b, 0) / n, my = y.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; }
  return sxy / Math.sqrt(sxx * syy);
};
/** Spearman's rank correlation, to three decimals. */
export const spearman = (x, y) => Math.round(pearson(ranks(x), ranks(y)) * 1000) / 1000;
