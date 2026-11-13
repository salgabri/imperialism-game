// Pro Football Archives' team-season pages (docs/design/american-football.md, "Computed seasons"): reading a page, its
// positions as the game's, and the value each player's season is worth, from which the computed NFL and AFL seasons
// rank their players. scripts/sync-pfa.mjs runs it over the pinned pages. No I/O here. Facts only are read: who played,
// at which position, in how many games and starts, and the season's box-score totals.

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = text => String(text ?? '').replace(/<[^>]+>/g, ' ').replace(/&(?:#x([0-9a-f]+)|#(\d+)|([a-z]+));/gi, (whole, hex, dec, name) => (hex
  ? String.fromCodePoint(parseInt(hex, 16)) : dec ? String.fromCodePoint(Number(dec)) : ENTITIES[name.toLowerCase()] ?? whole))
  .replace(/\s+/g, ' ').trim();

/**
 * A count as a page shows it: its leading number ('13' of '13TOM MOORE', a slip of the site's), 0 when empty. A
 * decimal (half a sack) stays one.
 */
export const countOf = text => {
  const m = /^-?\d+(?:\.\d+)?/.exec(String(text ?? '').trim());
  return m ? Number(m[0]) : 0;
};

/**
 * One team-season page (/<year><league><team>.html, the regular season): `{ year, team, league, games, roster, stats,
 * totals, notes }`.
 * - `games`: the regular season's, `{ date, site: 'H' | 'A' | 'N', opponent, for, against, venue, location }` (exhibition and
 *   playoff games left out).
 * - `roster`: `{ id, name, no, positions: ['RLB', 'MLB'], gp, gs }`, `id` the site's player page.
 * - `stats`: each table by its title (RUSHING, PASSING …), each player's row by his id: `{ column: number }`.
 * - `totals`: each table's Team Totals and Opponents Totals rows.
 * - `notes`: the slips read past (a count with text after it).
 * The draft list and the coaches are not read.
 */
export function parseTeamSeason(html) {
  const title = decode(/<title>([\s\S]*?)<\/title>/.exec(html)?.[1]);
  const m = /^(\d{4}) (.+?) \((NFL|AFL)\)/.exec(title);
  if (!m) throw new Error(`Not a team-season page: ${title}`);
  const page = { year: Number(m[1]), team: m[2], league: m[3], games: [], roster: [], stats: {}, totals: {}, notes: [] };
  for (const [, table] of html.matchAll(/<table>([\s\S]*?)<\/table>/g)) {
    // A row ends at its </tr>, or where the next begins: the 2024 Eagles' page leaves Kelee Ringo's scoring row unclosed,
    // which would otherwise take the Team Totals row into it.
    const rows = [...table.matchAll(/<tr([^>]*)>([\s\S]*?)(?:<\/tr>|(?=<tr[\s>]))/g)].map(([, attrs, inner]) => ({
      kind: /class="([^"]*)"/.exec(attrs)?.[1] ?? '',
      heads: [...inner.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/g)].map(c => decode(c[1])),
      cells: [...inner.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map(c => c[1]),
    }));
    if (!rows.length || !rows[0].heads.length) continue;
    // A titled table (SCORES, ROSTER, DRAFT LIST) has its title row above its column headings; a stat table's title is
    // its first heading.
    const titled = rows[0].heads.length === 1 && rows[1]?.heads.length > 1;
    const name = rows[0].heads[0];
    const heads = titled ? rows[1].heads : rows[0].heads.slice(1);
    const body = rows.slice(titled ? 2 : 1).filter(row => row.cells.length);
    if (name === 'SCORES') {
      for (const row of body) {
        if (row.kind === 'exh' || row.kind === 'playoff' || row.cells.length < 11) continue;
        const [, day, site, opponent, pf, pa, , , location, venue] = row.cells.map(decode);
        // A game the strikes of 1982 and 1987 cancelled is listed without a score.
        if (!/^\d+$/.test(pf) || !/^\d+$/.test(pa)) continue;
        const [month, date, year] = day.split('/');
        page.games.push({ date: `${year}-${month.padStart(2, '0')}-${date.padStart(2, '0')}`, site, opponent, for: countOf(pf), against: countOf(pa), location, venue });
      }
    } else if (name === 'ROSTER') {
      const col = key => heads.indexOf(key);
      for (const row of body) {
        const id = /href="\/players\/([^"]+)\.html"/.exec(row.cells[0])?.[1];
        if (!id) continue;
        const cell = key => decode(row.cells[col(key)]);
        for (const key of ['GP', 'GS']) if (/^\d+\D/.test(cell(key))) page.notes.push(`${decode(row.cells[0])}: ${key} reads "${cell(key)}"`);
        page.roster.push({ id, name: decode(row.cells[0]), no: cell('No'), positions: cell('Pos').split('-').map(p => p.trim()).filter(Boolean),
          gp: countOf(cell('GP')), gs: countOf(cell('GS')) });
      }
    } else if (!titled && /^[A-Z][A-Z &]+$/.test(name)) {
      const table = (page.stats[name] ??= {});
      for (const row of body) {
        const label = decode(row.cells[0]);
        const values = Object.fromEntries(heads.map((head, i) => [head, countOf(decode(row.cells[i + 1]))]));
        if (row.kind === 'career' || /^(Team|Opponents) Totals$/.test(label) || /^(OWN|OPP)$/.test(label)) {
          (page.totals[name] ??= {})[/^(Opponents|OPP)/.test(label) ? 'opponents' : 'team'] = values;
          continue;
        }
        const id = /href="\/players\/([^"]+)\.html"/.exec(row.cells[0])?.[1];
        if (id) table[id] = values;
      }
    }
  }
  return page;
}

/** A league index (/<year><league>.html): its club pages, in its order, each once. */
export function clubPagesOf(html, year, league) {
  const pattern = new RegExp(`^/?(${year}${league}[a-z]+)\\.html$`);
  const out = [];
  for (const [, href] of html.matchAll(/href="([^"]+)"/g)) {
    const m = pattern.exec(href);
    // The draft pages (/1965afldraft.html, the common draft's /1967aflnfldraft.html) are no club's.
    if (!m || m[1].endsWith('draft') || out.includes(`${m[1]}.html`)) continue;
    out.push(`${m[1]}.html`);
  }
  return out;
}

// ---------- positions ----------

/**
 * The site's position codes as the game's ten, and P, LONG and KR (punters, long snappers and kick returners: no place in
 * the lineup). Its pre-merger codes have sides (LOT, RDE, LLB, LCB) and its safeties are LS and RS (left and right: LONG
 * is its long snapper); flankers, split ends and offensive ends are receivers, halfbacks and fullbacks backs, nose guards
 * linemen, an H-back or U-back a tight end, a generic DB a corner. The site's slips are read as meant (SLIPS).
 */
export const POSITION_OF = {
  QB: 'QB', QBB: 'QB',
  HB: 'RB', FB: 'RB', RB: 'RB', TB: 'RB', OHB: 'RB', WB: 'RB', LHB: 'RB', RHB: 'RB',
  FL: 'WR', SE: 'WR', OE: 'WR', WR: 'WR', E: 'WR', SB: 'WR',
  TE: 'TE', HBK: 'TE', UBK: 'TE',
  LOT: 'OL', ROT: 'OL', OT: 'OL', T: 'OL', LOG: 'OL', ROG: 'OL', OG: 'OL', G: 'OL', C: 'OL', OL: 'OL',
  LDE: 'DL', RDE: 'DL', DE: 'DL', LDT: 'DL', RDT: 'DL', DT: 'DL', NT: 'DL', MG: 'DL', UT: 'DL', DRE: 'DL', SDE: 'DL', WDE: 'DL', '4DE': 'DL', DL: 'DL', NG: 'DL',
  LLB: 'LB', MLB: 'LB', RLB: 'LB', LB: 'LB', OLB: 'LB', ILB: 'LB', LILB: 'LB', RILB: 'LB', LOLB: 'LB', ROLB: 'LB', SLB: 'LB', WLB: 'LB',
  BLB: 'LB', JLB: 'LB', LMLB: 'LB', OLLB: 'LB', SILB: 'LB', WILB: 'LB', SOLB: 'LB', WOLB: 'LB',
  LCB: 'CB', RCB: 'CB', CB: 'CB', DB: 'CB', LC: 'CB', LSCB: 'CB', NB: 'CB', RXB: 'CB', CLB: 'CB', LBC: 'CB',
  LS: 'S', RS: 'S', FS: 'S', SS: 'S', S: 'S', TS: 'S', WS: 'S',
  K: 'K', P: 'P', LONG: 'LONG', KR: 'KR',
};
/** The site's slips, read as meant: a code mistyped or two run together (the first kept). */
export const SLIPS = { 'RCB=LCB': 'RCB', 'L,DT': 'DT', LAOT: 'LOT', RRLB: 'RLB', RDTLDE: 'RDT', LLS: 'LS', RRS: 'RS', RROT: 'ROT', RSL: 'RS', RO0: 'ROT',
  RBC: 'RCB', RIOLB: 'ROLB', LWB: 'WLB', LOR: 'LOT', SF: 'SE', LKB: 'LLB', RTS: 'RS', LLLB: 'LLB', 'RS FS?': 'RS', RIOG: 'ROG', LLIB: 'LILB', TRCB: 'RCB', LILBB: 'LILB', MMLB: 'MLB', LILBLOLB: 'LILB', RL: 'RLB', D: 'DE',
  // 1998–2000, each as the player's other seasons on the site have him: a linebacker (FLB), defensive ends (RE), nose
  // tackles (N T, TN), an H-back (HB K), a back (RB FB?).
  FLB: 'LB', RE: 'RDE', 'N T': 'NT', TN: 'NT', 'HB K': 'HBK', 'RB FB?': 'RB' };
/** A code as the site means it ('Fl' FL, 'mLB' MLB, 'lCB' LCB, 'RDTLDE' RDT), a 0 typed for a hyphen read as one (ROG0LOT ROG). */
const codeOf = code => {
  const upper = String(code).trim().toUpperCase().replace(/^[^A-Z0-9]+/, '').replace(/[^A-Z0-9,=? ].*$/, '');
  return SLIPS[upper] ?? /^([A-Z]+)0[A-Z]*$/.exec(upper)?.[1] ?? upper;
};
/** The game position of the site's code (P and LONG for those it leaves out); throws on a code it does not know. */
export function positionOfCode(code) {
  const position = POSITION_OF[codeOf(code)];
  if (!position) throw new Error(`Unknown position ${code}`);
  return position;
}

// ---------- the season value ----------

/**
 * The value rule's weights, tuned once (npm run sync:pfa -- --tune) on the 2001 to 2005 seasons against the next
 * season's Madden launch ratings (Madden NFL 2003 to 07: the overall each player carried into the next season), by the
 * mean of the ten positions' rank correlations, then frozen. Only facts every season since 1960 records are used:
 * starts, rushing, receiving and passing yards and touchdowns, interceptions, opponents' fumbles recovered, return
 * touchdowns, field goals and extra points; sacks where the site records them.
 * - `pass`, `td`, `int`: a passing yard's worth beside a rushing or receiving yard, a touchdown's, an interception's.
 * - `start`: a back's, receiver's or quarterback's credit for each game started, beside his share of the production;
 *   `teStart` a tight end's more (he blocks).
 * - `sack`, `pick`, `recovery`, `returnTd`: a defensive play's worth; `starts` the share of a defence's credit its
 *   starts take (the rest by plays).
 * - `extraPoint`, `accuracy`: a kicker's extra point beside a field goal, and his field goals beyond the league's rate.
 * - `team`: the power of a club's points per game against the league's that is its credit. 1 would give a dominant
 *   club's every starter a top place at his position; it was chosen after the rest, among 1 to 0.1, as the one whose
 *   computed 2001 season spreads its clubs' strengths as widely as Madden NFL 2002, the reference, spreads 2001's.
 */
export const VALUE_WEIGHTS = Object.freeze({ pass: 0.2, td: 40, int: 60, start: 0.15, teStart: 0.15, sack: 2, pick: 1.5, recovery: 1,
  returnTd: 1, starts: 2 / 3, extraPoint: 0.3, accuracy: 3, team: 0.25 });

const SKILL = new Set(['QB', 'RB', 'WR', 'TE']);
const DEFENCE = new Set(['DL', 'LB', 'CB', 'S']);
const sum = (list, f) => list.reduce((total, item) => total + f(item), 0);

/**
 * A club's players at their game position, from its page (`page`, parsed): `[{ id, name, no, codes, position, kicks, gp,
 * gs }]`, players who played no game left out. A player plays his first listed position; one who tried a field goal
 * (`kicks`) is also a kicker, and a punter who did is one (P-K). Punters and long snappers otherwise keep P and LONG (no
 * place in the lineup). Which of his two places a kicker who also played a position takes, settleKickers decides.
 */
export function placePlayers(page) {
  const attempts = id => page.stats['FIELD GOALS']?.[id]?.ATT ?? 0;
  return page.roster.filter(r => r.gp > 0).map(r => {
    const first = positionOfCode(r.positions[0]), kicks = attempts(r.id) > 0;
    return { id: r.id, name: r.name, no: r.no, codes: r.positions, position: kicks && first === 'P' ? 'K' : first, kicks, gp: r.gp, gs: r.gs };
  });
}

/**
 * A kicker who also played a position (Lou Groza, George Blanda, Gino Cappelletti) is listed once, at his larger share:
 * where his value stands higher among the league-season's players at that place (mid-rank percentile, every player who
 * could be there counted), K on a tie lost to his own position. `players`: one row each, `{ position, value, kickValue? }`
 * (kickValue for a kicker listed at another position). Sets `position` and `value`, and `played` to the place he left.
 */
export function settleKickers(players) {
  const dual = players.filter(p => p.kickValue !== undefined && p.position !== 'K');
  const pool = position => [...players.filter(p => p.position === position).map(p => p.value),
    ...(position === 'K' ? dual.map(p => p.kickValue) : [])];
  const percentile = (values, value) => (values.filter(v => v < value).length + (values.filter(v => v === value).length - 1) / 2 + 0.5) / values.length;
  const kicking = pool('K');
  const pools = new Map();
  for (const p of dual) {
    if (!pools.has(p.position)) pools.set(p.position, pool(p.position));
    if (percentile(kicking, p.kickValue) > percentile(pools.get(p.position), p.value)) {
      Object.assign(p, { played: p.position, position: 'K', value: p.kickValue });
    }
  }
  for (const p of players) delete p.kickValue;
  return players;
}

/**
 * The season value of every player of one league-season (`pages`: its clubs' parsed pages), by `weights`:
 * `[{ club (the page's index), id, name, no, codes, position, gp, gs, value, kickValue? }]`. Each club's points against
 * the league's, offence and defence apart, are shared out: the line by starts; quarterbacks, backs, receivers and tight
 * ends by production (yards and touchdowns, interceptions thrown) and starts; defenders by starts and plays; the kicker by
 * his kicks against the league's rate (and a player who kicked besides his position has his kicks valued too,
 * `kickValue`, for settleKickers). A player of two clubs has a row for each.
 */
export function seasonValues(pages, weights = VALUE_WEIGHTS) {
  const teamGames = sum(pages, p => p.games.length);
  const leaguePoints = sum(pages, p => sum(p.games, g => g.for)) / teamGames;
  const fieldGoals = sum(pages, p => p.totals['FIELD GOALS']?.team?.MADE ?? 0), tries = sum(pages, p => p.totals['FIELD GOALS']?.team?.ATT ?? 0);
  const leagueRate = tries ? fieldGoals / tries : 0;
  const out = [];
  pages.forEach((page, club) => {
    const games = page.games.length;
    if (!games) throw new Error(`${page.year} ${page.team}: no regular-season games`);
    const offence = 100 * ((sum(page.games, g => g.for) / games) / leaguePoints) ** weights.team;
    const defence = 100 * (leaguePoints / Math.max(sum(page.games, g => g.against) / games, 1)) ** weights.team;
    const stat = (p, table, key) => page.stats[table]?.[p.id]?.[key] ?? 0;
    const players = placePlayers(page);
    const production = p => Math.max(0, stat(p, 'RUSHING', 'YDS') + stat(p, 'RECEIVING', 'YDS') + weights.pass * stat(p, 'PASSING', 'YDS')
      + weights.td * (stat(p, 'RUSHING', 'TD') + stat(p, 'RECEIVING', 'TD') + stat(p, 'PASSING', 'TD')) - weights.int * stat(p, 'PASSING', 'INT'));
    const plays = p => weights.sack * stat(p, 'SACKS', 'NO') + weights.pick * stat(p, 'INTERCEPTIONS', 'INT')
      + weights.recovery * stat(p, 'FUMBLES', 'OPP') + weights.returnTd * (stat(p, 'INTERCEPTIONS', 'TD') + stat(p, 'FUMBLES', 'TD'));
    const totalProduction = sum(players.filter(p => SKILL.has(p.position)), production) || 1;
    const totalPlays = sum(players.filter(p => DEFENCE.has(p.position)), plays) || 1;
    const kicking = p => {
      const made = page.stats['FIELD GOALS']?.[p.id]?.MADE ?? 0, tried = page.stats['FIELD GOALS']?.[p.id]?.ATT ?? 0;
      return made + weights.extraPoint * stat(p, 'SCORING', 'X1') + weights.accuracy * (made - leagueRate * tried);
    };
    const round = v => Math.round(v * 1e6) / 1e6;
    for (const p of players) {
      let value;
      if (SKILL.has(p.position)) {
        value = offence * (production(p) / totalProduction + (weights.start + (p.position === 'TE' ? weights.teStart : 0)) * p.gs / games);
      } else if (p.position === 'OL') value = offence * p.gs / (5 * games);
      else if (DEFENCE.has(p.position)) value = defence * (weights.starts * p.gs / (11 * games) + (1 - weights.starts) * plays(p) / totalPlays);
      else if (p.position === 'K') value = kicking(p);
      else continue;
      out.push({ club, id: p.id, name: p.name, no: p.no, codes: p.codes, position: p.position, gp: p.gp, gs: p.gs, value: round(value),
        ...(p.kicks && p.position !== 'K' ? { kickValue: round(kicking(p)) } : {}) });
    }
  });
  return out;
}

// ---------- the strike of 1987 ----------

/** The players a box score names (its links to their pages), each once: `['k/kell00800', …]`. */
export const playersOfBoxScore = html => [...new Set([...html.matchAll(/href="\/players\/([a-z]\/[a-z0-9]+)\.html"/g)].map(m => m[1]))];

/**
 * The replacement players of a season of strike games (`players`, `{ id, gp }`, a player's games summed over his clubs):
 * those every game of whose was a strike game, by the box scores of those games (`boxScores`, each the player ids it
 * names: the starters and every player with a statistic), a player named in as many of them as he played games; and,
 * as a box score names no substitute without a statistic, those who played no more games than the strike had
 * (`strikeGames`) and for no club in the seasons either side (`around`, the ids of their rosters). → Set of ids.
 */
export function replacementPlayers(players, boxScores, { strikeGames, around }) {
  const appearances = new Map();
  for (const ids of boxScores) for (const id of ids) appearances.set(id, (appearances.get(id) ?? 0) + 1);
  return new Set(players.filter(p => p.gp > 0 && ((appearances.get(p.id) ?? 0) >= p.gp || (p.gp <= strikeGames && !around.has(p.id))))
    .map(p => p.id));
}

// ---------- the calibration's statistics ----------

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
