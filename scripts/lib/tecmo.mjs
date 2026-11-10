// The NFL seasons the Tecmo Super Bowl games rate, 1990 and 1992 to 1995 (docs/design/american-football.md, "Tecmo
// seasons (data)"): reading the games' roster dumps, naming their players, mapping their slots onto the game's ten
// positions and turning their attributes into an overall. scripts/sync-tecmo.mjs runs it over the pinned inputs and
// writes scripts/data/tecmo/<season>.json. No I/O here.
//
// The Tecmo games rate players by attributes on a 16-step scale (6, 13 ... 100) and give no overall. Each edition's
// overall is ours: one documented position score per edition (Tecmo Geek's for NES Tecmo Super Bowl, the same weights
// for SNES Tecmo Super Bowl, the NFTGL league's weighting for Tecmo Super Bowl III and, without Agility, for II), then
// each game position's scores mapped by percentile onto Madden NFL 2002's overalls at that position.
import { strFromU8, unzipSync } from 'fflate';

/** The 16 values a Tecmo attribute takes. */
export const SCALE = [6, 13, 19, 25, 31, 38, 44, 50, 56, 63, 69, 75, 81, 88, 94, 100];
/** The game's ten positions, offence first (punters have no place: they are left out, as scripts/build-nfl.mjs does). */
export const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'OL', 'DL', 'LB', 'CB', 'S', 'K'];
/** The game's starting lineup by position (src/data/teams.js, LINEUP_PLANS['american-football']). */
export const LINEUP = { QB: 1, RB: 1, WR: 3, TE: 1, OL: 5, DL: 4, LB: 2, CB: 3, S: 2, K: 1 };

// ---------- the editions ----------

// Every attribute by the name the game's own screens use: running speed, rushing power, maximum speed, hitting power,
// body balance, agility, passing speed, pass control, passing accuracy, avoid rush (Tecmo Geek: avoid pass block),
// coolness, ball control, receptions, pass interceptions, quickness, kicking power, kicking ability (accuracy) and
// avoid kick block.
export const ATTRIBUTES = ['RS', 'RP', 'MS', 'HP', 'BB', 'AG', 'PS', 'PC', 'PA', 'AR', 'CO', 'BC', 'REC', 'PI', 'QU', 'KP', 'KA', 'AKB'];
// The order a dump lists each kind of player's values in. TSBTool Supreme's NES and SNES dumps follow the screen (RS
// before RP; its SNES key prints RP first, but the values are in the NES order, as the GameFAQs roster FAQ reads the
// screen). TSBTool2's TSB II and III dumps follow TSBM 2000, which lists RP before RS: the two trade places here.
const NES_LAYOUT = {
  QB: ['RS', 'RP', 'MS', 'HP', 'PS', 'PC', 'PA', 'AR'], SKILL: ['RS', 'RP', 'MS', 'HP', 'BC', 'REC'], OL: ['RS', 'RP', 'MS', 'HP'],
  DEF: ['RS', 'RP', 'MS', 'HP', 'PI', 'QU'], K: ['RS', 'RP', 'MS', 'HP', 'KA', 'AKB'], P: ['RS', 'RP', 'MS', 'HP', 'KA', 'AKB'],
};
const tsbmLayout = extra => ({
  QB: ['RP', 'RS', 'MS', 'HP', ...extra, 'PS', 'PC', 'PA', 'AR', 'CO'], SKILL: ['RP', 'RS', 'MS', 'HP', ...extra, 'BC', 'REC'],
  OL: ['RP', 'RS', 'MS', 'HP', ...extra], DEF: ['RP', 'RS', 'MS', 'HP', ...extra, 'PI', 'QU'],
  K: ['RP', 'RS', 'MS', 'HP', ...extra, 'KP', 'KA', 'AKB'], P: ['RP', 'RS', 'MS', 'HP', ...extra, 'KP', 'AKB'],
});

/**
 * The editions, each with its dump layout, its scoring formula and where its generic defensive backs (DB1–DB3, the
 * nickel and dime slots) play: the slot most of their occupants held in the NFL (nflverse's CB, S, FS or SS).
 */
export const EDITIONS = {
  nes: { game: 'Tecmo Super Bowl', platform: 'NES', released: '1991-12', layout: NES_LAYOUT, formula: 'tecmogeek', db: {} },
  snes: { game: 'Tecmo Super Bowl', platform: 'SNES', released: '1993-12', layout: NES_LAYOUT, formula: 'tecmogeek', db: { DB1: 'CB', DB2: 'S' } },
  tsb2: { game: 'Tecmo Super Bowl II: Special Edition', platform: 'SNES', released: '1994', layout: tsbmLayout(['BB']), formula: 'nftgl',
    db: { DB1: 'CB', DB2: 'CB', DB3: 'S' } },
  tsb3: { game: 'Tecmo Super Bowl III: Final Edition', platform: 'SNES', released: '1995', layout: tsbmLayout(['BB', 'AG']), formula: 'nftgl',
    db: { DB1: 'CB', DB2: 'CB', DB3: 'S' } },
};

// A slot without its depth number ('RB3' → 'RB', 'RE2' → 'RE', 'LB5' → 'LB'), its kind of attributes and its position.
const slotBase = slot => slot.replace(/\d+$/, '');
const KIND = {
  QB: 'QB', RB: 'SKILL', WR: 'SKILL', TE: 'SKILL', C: 'OL', LG: 'OL', RG: 'OL', LT: 'OL', RT: 'OL', RE: 'DEF', NT: 'DEF', LE: 'DEF',
  ROLB: 'DEF', RILB: 'DEF', LILB: 'DEF', LOLB: 'DEF', LB: 'DEF', RCB: 'DEF', LCB: 'DEF', FS: 'DEF', SS: 'DEF', DB: 'DEF', K: 'K', P: 'P',
};
const SLOT_POSITION = {
  QB: 'QB', RB: 'RB', WR: 'WR', TE: 'TE', C: 'OL', LG: 'OL', RG: 'OL', LT: 'OL', RT: 'OL', RE: 'DL', NT: 'DL', LE: 'DL',
  ROLB: 'LB', RILB: 'LB', LILB: 'LB', LOLB: 'LB', LB: 'LB', RCB: 'CB', LCB: 'CB', FS: 'S', SS: 'S', K: 'K', P: 'P',
};
export const kindOf = slot => KIND[slotBase(slot)] ?? null;
/** The game position a slot of `edition` plays: a punter 'P' (left out), a generic defensive back as the edition places him. */
export function slotPosition(edition, slot) {
  const base = slotBase(slot);
  if (base === 'DB') {
    const position = EDITIONS[edition].db[slot];
    if (!position) throw new Error(`${edition} has no slot ${slot}`);
    return position;
  }
  const position = SLOT_POSITION[base];
  if (!position) throw new Error(`Unknown Tecmo slot ${slot}`);
  return position;
}

// ---------- reading a dump ----------

/**
 * The players of a TSBTool dump (Supreme's NES and SNES text, TSBTool2's TSB II and III text): `[{ block, team, slot,
 * rom, number, values }]`, `block` the dump's SEASON number (1 when it has none), `rom` the name as the game spells
 * it ('jim KELLY'), `values` the attributes in the dump's order. The simulation values in brackets are not read.
 */
export function parseDump(text) {
  let block = 1, team = null;
  const players = [];
  for (const line of (text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text).split(/\r?\n/)) {
    let m;
    if ((m = /^SEASON (\d+)/.exec(line))) { block = Number(m[1]); continue; }
    if ((m = /^TEAM\s*=\s*([^,\s]+)/.exec(line))) { team = m[1]; continue; }
    m = /^([A-Z]+\d?),\s*([^,]+?),\s*Face=0x[0-9a-fA-F]+,\s*#(\d+),([^[]*)/.exec(line);
    if (!m) continue;
    if (!team) throw new Error(`A player before any team: ${line}`);
    const values = m[4].split(',').map(s => s.trim()).filter(Boolean).map(Number);
    players.push({ block, team, slot: m[1], rom: m[2].trim(), number: Number(m[3]), values });
  }
  return players;
}

/** A player's attributes by screen name, in screen order; throws on a count the layout does not have or an off-scale value. */
export function attributesOf(edition, slot, values) {
  const kind = kindOf(slot);
  const layout = EDITIONS[edition].layout[kind];
  if (!layout) throw new Error(`${edition}: no layout for slot ${slot}`);
  if (values.length !== layout.length) throw new Error(`${edition} ${slot}: ${values.length} values, the layout has ${layout.length}`);
  const byName = Object.fromEntries(layout.map((name, i) => [name, values[i]]));
  for (const [name, value] of Object.entries(byName)) {
    if (!SCALE.includes(value)) throw new Error(`${edition} ${slot}: ${name} ${value} is not on the 16-step scale`);
  }
  return Object.fromEntries(ATTRIBUTES.filter(name => name in byName).map(name => [name, byName[name]]));
}

// ---------- names ----------

/** 'jim KELLY' → { first: 'jim', last: 'KELLY' }: the last name is the trailing words without a lower-case letter. */
export function splitName(rom) {
  const words = rom.trim().split(/\s+/);
  let i = words.length;
  while (i > 1 && !/[a-z]/.test(words[i - 1])) i--;
  return { first: words.slice(0, i).join(' '), last: words.slice(i).join(' ') };
}
const capital = word => word.toLowerCase().replace(/(^|[\s.'-])([a-z])/g, (whole, mark, letter) => mark + letter.toUpperCase())
  .replace(/\bMc([a-z])/g, (whole, letter) => `Mc${letter.toUpperCase()}`);
/** The game's spelling in ordinary capitals ('keith MCKELLER' → 'Keith McKeller'), for a player nflverse does not name. */
export const casedName = rom => { const { first, last } = splitName(rom); return [capital(first), capital(last)].filter(Boolean).join(' '); };

/** A name reduced to its letters: no accents, case, spaces or punctuation. */
export const plain = text => String(text ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z]/g, '');
/** Optimal string alignment distance: insertions, deletions, substitutions and swaps of neighbours. */
export function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}
// Short forms of a given name, both ways.
const NICKNAMES = [
  ['al', 'albert', 'alan', 'allen', 'alfred'], ['bill', 'billy', 'william', 'will', 'willie'], ['bob', 'bobby', 'rob', 'robert', 'robbie'],
  ['chris', 'christopher'], ['dan', 'danny', 'daniel'], ['dave', 'david'], ['don', 'donnie', 'donald'], ['doug', 'douglas'],
  ['ed', 'eddie', 'edward', 'ted'], ['fred', 'freddie', 'frederick'], ['gene', 'eugene'], ['greg', 'gregory'], ['jeff', 'jeffrey'],
  ['jerry', 'gerald', 'jerome'], ['jim', 'jimmy', 'jimmie', 'james'], ['joe', 'joey', 'joseph'], ['john', 'johnny', 'jack', 'jon'],
  ['ken', 'kenny', 'kenneth'], ['larry', 'lawrence'], ['matt', 'matthew'], ['mike', 'michael', 'mick'], ['nick', 'nicholas'],
  ['pat', 'patrick'], ['phil', 'phillip', 'philip'], ['rick', 'ricky', 'rich', 'richard', 'dick', 'richie'], ['ron', 'ronnie', 'ronald'],
  ['sam', 'samuel'], ['steve', 'steven', 'stephen'], ['tim', 'timothy'], ['tom', 'tommy', 'thomas'], ['tony', 'anthony'],
  ['vince', 'vincent'], ['walt', 'walter'], ['terry', 'terrence', 'terence'], ['andy', 'andrew'], ['charlie', 'charles', 'chuck'],
  ['herb', 'herbert'], ['ray', 'raymond'], ['reggie', 'reginald'], ['mo', 'maurice'], ['kim', 'kimble'], ['les', 'lester'],
];
const nicknames = new Map();
for (const group of NICKNAMES) for (const name of group) nicknames.set(name, new Set([...(nicknames.get(name) || []), ...group]));

/**
 * How the game's first name `first` fits an nflverse player's: 'exact' (the name he went by), 'legal' (his given
 * name, which nflverse keeps apart: Rafael Robinson's is Eugene), 'initial', 'nickname', 'edit' or null.
 */
function firstFit(first, row) {
  const known = plain(row.full_name.split(' ')[0]), legal = plain(row.first_name);
  const given = [known, legal].filter(Boolean);
  const f = plain(first);
  if (!f) return null;
  // Initials: 'c.', 'a.j.', 'j.'; a given name with an initial ('billy.j.', 'ivory.l') is read by its given name.
  if (/^([a-z]\.)+$/.test(first.trim().toLowerCase())) return known[0] === f[0] ? 'initial' : legal[0] === f[0] ? 'legal' : null;
  const head = plain(first.split(/[.\s]/)[0]);
  if (known === f || known === head || plain(row.full_name).startsWith(f)) return 'exact';
  if (legal === f || legal === head) return 'legal';
  if (given.some(g => nicknames.get(g)?.has(f) || nicknames.get(f)?.has(g) || nicknames.get(head)?.has(g))) return 'nickname';
  if (given.some(g => editDistance(g, head) <= (head.length >= 6 ? 2 : 1) && head.length >= 4)) return 'edit';
  return null;
}
/**
 * How the game's last name `last` fits an nflverse player's: 'exact', 'cut' (the game ran out of room), 'edit' (a
 * letter apart; two in a name of eight letters or more) or null.
 */
function lastFit(last, row) {
  const l = plain(last);
  const surnames = [row.last_name, row.full_name.split(' ').slice(1).join(' '), row.full_name.split(' ').at(-1)].map(plain).filter(Boolean);
  if (surnames.includes(l)) return 'exact';
  if (l.length >= 6 && surnames.some(s => s.startsWith(l))) return 'cut';
  if (l.length >= 5 && surnames.some(s => editDistance(s, l) <= (l.length >= 8 ? 2 : 1))) return 'edit';
  return null;
}
const FIT_COST = { exact: 0, initial: 1, nickname: 1, cut: 1, legal: 1.5, edit: 2 };
// A first name that fits closely enough to stand beside an approximate last name.
const FIRM_FIRST = new Set(['exact', 'legal', 'initial', 'nickname']);
/**
 * One person across nflverse's seasons and clubs: his date of birth and surname (nflverse has no gsis id for a fifth
 * of its 1990 entries, Bo Jackson's among them), else his gsis id or name.
 */
export const personOf = row => (row.birth_date ? `${row.birth_date}|${plain(row.last_name)}` : row.gsis_id || plain(row.full_name));

/**
 * The nflverse player the game's `rom` name is, among `rows` (one team's roster in one season): last names equal, cut
 * short or one letter apart, first names equal, an initial, a short form or a letter or two apart, never both names
 * approximate. The closest fit wins; a tie or no fit names nobody (null).
 */
export function identify(rom, rows) {
  const { first, last } = splitName(rom);
  const fits = [];
  for (const row of rows) {
    const l = lastFit(last, row), f = l && firstFit(first, row);
    if (!l || !f || (l !== 'exact' && !FIRM_FIRST.has(f))) continue;
    fits.push({ row, cost: FIT_COST[l] + FIT_COST[f] });
  }
  const unique = [...new Map(fits.sort((a, b) => a.cost - b.cost).reverse().map(fit => [personOf(fit.row), fit])).values()]
    .sort((a, b) => a.cost - b.cost);
  if (!unique.length || (unique.length > 1 && unique[1].cost === unique[0].cost)) return null;
  return unique[0].row;
}

// ---------- the games' generic players ----------

// The unlicensed stars the games list by position and team ('qb BILLS', 'de EAGLES'): the prefix is their position.
const PREFIX_GROUPS = {
  qb: ['QB'], hb: ['RB'], rb: ['RB'], fb: ['RB'], wr: ['WR'], te: ['TE'], ot: ['OL'], og: ['OL'], t: ['OL'], g: ['OL'], c: ['OL'], ol: ['OL'],
  de: ['DL', 'LB'], dt: ['DL'], dl: ['DL', 'LB'], nt: ['DL'], lb: ['LB', 'DL'], olb: ['LB', 'DL'], ilb: ['LB'], mlb: ['LB'],
  cb: ['DB'], s: ['DB'], fs: ['DB'], ss: ['DB'], db: ['DB'], k: ['K'], p: ['P'],
};
// The names the games give a club in its generic players besides its own ('wr NINERS' for the 49ers in TSB III).
const TEAM_WORDS = { '49ers': ['niners'] };
/** The position group of a generic player ('hb BILLS' on the Bills → ['RB']), or null for a named one. */
export function genericGroups(rom, team) {
  const m = /^([a-z]+)\s+([A-Z0-9]+)$/.exec(rom.trim());
  const word = m?.[2].toLowerCase();
  if (!m || (word !== team.toLowerCase() && !TEAM_WORDS[team]?.includes(word))) return null;
  const groups = PREFIX_GROUPS[m[1]];
  if (!groups) throw new Error(`Unknown generic position ${m[1]} (${rom})`);
  return groups;
}
/** An nflverse row's position group: QB RB WR TE OL DL LB DB, or K / P for a specialist. */
export const groupOf = row => (row.position === 'SPEC' ? row.depth_chart_position : row.position);

/**
 * Who a generic player is, from his season's nflverse roster: `{ named: row|null, rule, candidates, evidence }`.
 * - `candidates`: his team's players that season in his position group whom the game does not already name.
 * - With a jersey number, the one candidate a source shows in that number for that franchise (`numbers(row)`: where
 *   each candidate wore it), unless his season's own nflverse entry gives him another.
 * - Without one (#0), the only candidate left; failing that, the one another edition rating the same season
 *   (`sameSeason(slot)`, an nflverse row or null) puts in the same slot of the same team.
 * Anything else leaves him out.
 */
export function identifyGeneric({ groups, number, slot, rows, named, numbers, sameSeason }) {
  const candidates = [...new Map(rows.filter(row => groups.includes(groupOf(row)) && !named.has(personOf(row)))
    .map(row => [personOf(row), row])).values()].sort((a, b) => a.full_name.localeCompare(b.full_name));
  const list = candidates.map(row => row.full_name);
  if (number > 0) {
    const shown = candidates.map(row => ({ row, sources: numbers(row) }))
      .filter(({ row, sources }) => sources.length && !(Number(row.jersey_number) > 0 && Number(row.jersey_number) !== number));
    if (shown.length === 1) return { named: shown[0].row, rule: 'number', candidates: list, evidence: shown[0].sources };
    return { named: null, rule: shown.length ? 'number shared' : 'number unknown', candidates: list,
      evidence: shown.map(({ row, sources }) => `${row.full_name}: ${sources.join(', ')}`) };
  }
  if (candidates.length === 1) return { named: candidates[0], rule: 'only candidate', candidates: list, evidence: [] };
  const other = sameSeason?.(slot);
  if (other && candidates.some(row => personOf(row) === personOf(other.row))) {
    return { named: other.row, rule: 'same season', candidates: list, evidence: [other.source] };
  }
  return { named: null, rule: 'not certain', candidates: list, evidence: [] };
}

// ---------- the position scores ----------

// Tecmo Geek's player ratings for NES Tecmo Super Bowl (tecmogeek.com/about/ratings/): per position, each attribute
// scored against the best at the position (hitting power by bands), weighted to 100. Backs are rated as rushers,
// receivers and tight ends as receivers; corners and safeties share one rating.
export const TECMO_GEEK = {
  weights: {
    QB: { MS: 25, PS: 20, PC: 50, AR: 5 },
    RB: { RS: 10, MS: 70, HP: 10, BC: 5, REC: 5 },
    WR: { RS: 10, MS: 45, HP: 5, BC: 5, REC: 35 },
    TE: { RS: 10, MS: 45, HP: 5, BC: 5, REC: 35 },
    OL: { MS: 20, HP: 80 },
    DL: { RS: 10, RP: 35, MS: 10, HP: 40, PI: 5 },
    LB: { RS: 10, RP: 35, MS: 10, HP: 30, PI: 15 },
    CB: { RS: 10, RP: 35, MS: 10, HP: 5, PI: 40 },
    S: { RS: 10, RP: 35, MS: 10, HP: 5, PI: 40 },
    K: { KA: 100 },
  },
  // Hitting power's score (per cent) from each band's lowest value; below the first band it scores 0.
  bands: {
    skill: [[75, 5], [81, 25], [88, 60], [94, 100]],
    OL: [[31, 0], [38, 15], [44, 30], [50, 45], [56, 55], [63, 65], [69, 80], [75, 90], [81, 100]],
    defence: [[19, 0], [25, 7], [31, 16], [38, 23], [44, 30], [50, 36], [56, 45], [63, 59], [69, 78], [75, 100]],
  },
  // The players each attribute is scored against: backs, receivers and tight ends together, corners with safeties.
  groups: { QB: 'QB', RB: 'skill', WR: 'skill', TE: 'skill', OL: 'OL', DL: 'DL', LB: 'LB', CB: 'DB', S: 'DB', K: 'K' },
};
const BAND_OF = { skill: 'skill', OL: 'OL', DL: 'defence', LB: 'defence', DB: 'defence' };
const band = (table, value) => table.reduce((score, [from, points]) => (value >= from ? points : score), 0);

/** Each Tecmo Geek group's best value of each attribute among `players` (`[{ position, attributes }]`). */
export function tecmoGeekMaxima(players) {
  const maxima = {};
  for (const { position, attributes } of players) {
    const group = TECMO_GEEK.groups[position];
    if (!group) continue;
    const best = (maxima[group] ||= {});
    for (const name of Object.keys(TECMO_GEEK.weights[position])) best[name] = Math.max(best[name] ?? 0, attributes[name]);
  }
  return maxima;
}
/** Tecmo Geek's rating of a player at game position `position`, in per cent (six decimals). */
export function tecmoGeekScore(position, attributes, maxima) {
  const group = TECMO_GEEK.groups[position];
  let total = 0;
  for (const [name, weight] of Object.entries(TECMO_GEEK.weights[position])) {
    const value = attributes[name];
    if (value === undefined) throw new Error(`No ${name} for a ${position}`);
    const score = name === 'HP' && BAND_OF[group] ? band(TECMO_GEEK.bands[BAND_OF[group]], value) / 100 : value / maxima[group][name];
    total += weight * score;
  }
  return Math.round(total * 1e6) / 1e6;
}

// The NFTGL's weighting (No Frills Tough Guy League; "The Book of Armaments", 2017 update, its Weighting sheet): per
// position, the sum of each attribute times its weight, the sheet's "Man Pt Value". Its bonus terms (+50 or +100 for
// speed, rushing power, interceptions or hitting power over a threshold) are not part of that value and are not used.
export const NFTGL_WEIGHTS = {
  QB: { RS: 5, RP: 4, MS: 5, HP: 2.5, BB: 1, AG: 3, PS: 8, PC: 8.5, PA: 8.5, AR: 2, CO: 2.5 },
  RB: { RS: 5, RP: 4, MS: 12, HP: 12, BB: 6, AG: 3, BC: 6, REC: 2 },
  WR: { RS: 5, RP: 4, MS: 11, HP: 5, BB: 5, AG: 4, BC: 4, REC: 12 },
  TE: { RS: 5, RP: 5, MS: 6, HP: 9, BB: 4, AG: 5, BC: 5, REC: 12 },
  OL: { RS: 4, RP: 7, MS: 4, HP: 30, BB: 1, AG: 4 },
  K: { RS: 7, RP: 4, MS: 8, HP: 4, BB: 2, AG: 4, KP: 8, KA: 8, AKB: 5 },
  P: { RS: 7, RP: 5, MS: 10, HP: 5, BB: 2, AG: 5, KP: 10, AKB: 6 },
  DL: { RS: 4, RP: 8, MS: 6, HP: 25, BB: 1, AG: 4, PI: 1, QU: 1 },
  LB: { RS: 4, RP: 8, MS: 6, HP: 17, BB: 3, AG: 5, PI: 3, QU: 3 },
  CB: { RS: 4.5, RP: 5, MS: 5.5, HP: 10, BB: 3, AG: 5, PI: 14, QU: 3 },
  S: { RS: 4.5, RP: 5, MS: 5.5, HP: 10, BB: 3, AG: 5, PI: 14, QU: 3 },
};
/**
 * The NFTGL score of a player at game position `position`: each attribute he has times its weight, by the screen's
 * names (TSB II has no agility: its weight drops out).
 */
export function nftglScore(position, attributes) {
  let total = 0;
  for (const [name, weight] of Object.entries(NFTGL_WEIGHTS[position])) {
    if (attributes[name] === undefined) {
      if (name === 'AG') continue;
      throw new Error(`No ${name} for a ${position}`);
    }
    total += weight * attributes[name];
  }
  return total;
}

// ---------- the overall: position percentiles on Madden NFL 2002 ----------

// The mapping onto Madden NFL 2002 is shared with the other seasons no game rated with an overall (scripts/lib/nfl-reference.mjs).
export { MADDEN_POSITION, overallsOf, referenceOf } from './nfl-reference.mjs';

// ---------- the clubs ----------

/** The dumps' team keys as today's franchises (scripts/data/nfl-teams.json). */
export const FRANCHISE_OF = {
  bills: 'nfl-buffalo-bills', colts: 'nfl-indianapolis-colts', dolphins: 'nfl-miami-dolphins', patriots: 'nfl-new-england-patriots',
  jets: 'nfl-new-york-jets', bengals: 'nfl-cincinnati-bengals', browns: 'nfl-cleveland-browns', oilers: 'nfl-tennessee-titans',
  steelers: 'nfl-pittsburgh-steelers', jaguars: 'nfl-jacksonville-jaguars', broncos: 'nfl-denver-broncos', chiefs: 'nfl-kansas-city-chiefs',
  raiders: 'nfl-las-vegas-raiders', chargers: 'nfl-los-angeles-chargers', seahawks: 'nfl-seattle-seahawks',
  redskins: 'nfl-washington-commanders', giants: 'nfl-new-york-giants', eagles: 'nfl-philadelphia-eagles',
  cardinals: 'nfl-arizona-cardinals', cowboys: 'nfl-dallas-cowboys', bears: 'nfl-chicago-bears', lions: 'nfl-detroit-lions',
  packers: 'nfl-green-bay-packers', vikings: 'nfl-minnesota-vikings', buccaneers: 'nfl-tampa-bay-buccaneers',
  '49ers': 'nfl-san-francisco-49ers', rams: 'nfl-los-angeles-rams', saints: 'nfl-new-orleans-saints', falcons: 'nfl-atlanta-falcons',
  panthers: 'nfl-carolina-panthers',
};
/** Teams a dump carries that are no club of the season: TSB III's free agents and all-time team. */
export const NOT_CLUBS = new Set(['freeAgents', 'allTime']);

// Each franchise as data-src/research/eras/nfl.json names it in 1990–1995: today's id, name and code unless an era
// names its own. Washington's club before 2020 is named Washington, as the game names it (scripts/data/nfl-seasons.json);
// the eras file has it as the Washington Redskins (nfl-washington-redskins).
const TODAY = {
  'nfl-arizona-cardinals': ['Arizona Cardinals', 'ARI'], 'nfl-atlanta-falcons': ['Atlanta Falcons', 'ATL'],
  'nfl-buffalo-bills': ['Buffalo Bills', 'BUF'], 'nfl-carolina-panthers': ['Carolina Panthers', 'CAR'],
  'nfl-chicago-bears': ['Chicago Bears', 'CHI'], 'nfl-cincinnati-bengals': ['Cincinnati Bengals', 'CIN'],
  'nfl-cleveland-browns': ['Cleveland Browns', 'CLE'], 'nfl-dallas-cowboys': ['Dallas Cowboys', 'DAL'],
  'nfl-denver-broncos': ['Denver Broncos', 'DEN'], 'nfl-detroit-lions': ['Detroit Lions', 'DET'],
  'nfl-green-bay-packers': ['Green Bay Packers', 'GBP'], 'nfl-indianapolis-colts': ['Indianapolis Colts', 'IND'],
  'nfl-jacksonville-jaguars': ['Jacksonville Jaguars', 'JAX'], 'nfl-kansas-city-chiefs': ['Kansas City Chiefs', 'KCC'],
  'nfl-las-vegas-raiders': ['Las Vegas Raiders', 'LVR'], 'nfl-los-angeles-chargers': ['Los Angeles Chargers', 'LAC'],
  'nfl-los-angeles-rams': ['Los Angeles Rams', 'LAR'], 'nfl-miami-dolphins': ['Miami Dolphins', 'MIA'],
  'nfl-minnesota-vikings': ['Minnesota Vikings', 'MIN'], 'nfl-new-england-patriots': ['New England Patriots', 'NEP'],
  'nfl-new-orleans-saints': ['New Orleans Saints', 'NOS'], 'nfl-new-york-giants': ['New York Giants', 'NYG'],
  'nfl-new-york-jets': ['New York Jets', 'NYJ'], 'nfl-philadelphia-eagles': ['Philadelphia Eagles', 'PHI'],
  'nfl-pittsburgh-steelers': ['Pittsburgh Steelers', 'PIT'], 'nfl-san-francisco-49ers': ['San Francisco 49ers', 'SFO'],
  'nfl-seattle-seahawks': ['Seattle Seahawks', 'SEA'], 'nfl-tampa-bay-buccaneers': ['Tampa Bay Buccaneers', 'TBB'],
  'nfl-tennessee-titans': ['Tennessee Titans', 'TEN'], 'nfl-washington-commanders': ['Washington Commanders', 'WAS'],
};
const ERAS = {
  'nfl-arizona-cardinals': [{ to: 1993, id: 'nfl-phoenix-cardinals', name: 'Phoenix Cardinals', code: 'PHO' }],
  'nfl-las-vegas-raiders': [{ to: 1994, id: 'nfl-los-angeles-raiders', name: 'Los Angeles Raiders', code: 'RAI' },
    { from: 1995, id: 'nfl-oakland-raiders', name: 'Oakland Raiders', code: 'OAK' }],
  'nfl-los-angeles-chargers': [{ id: 'nfl-san-diego-chargers', name: 'San Diego Chargers', code: 'SDC' }],
  'nfl-los-angeles-rams': [{ from: 1995, id: 'nfl-st-louis-rams', name: 'St. Louis Rams', code: 'STL' }],
  'nfl-tennessee-titans': [{ id: 'nfl-houston-oilers', name: 'Houston Oilers', code: 'HOU' }],
  'nfl-washington-commanders': [{ id: 'nfl-washington', name: 'Washington', code: 'WAS' }],
};
/** A franchise in season `year` (1990–1995): `{ era, name, code }`, `era` its id that season. */
export function eraOf(franchise, year) {
  const today = TODAY[franchise];
  if (!today) throw new Error(`Unknown franchise ${franchise}`);
  const era = ERAS[franchise]?.find(e => (e.from ?? -Infinity) <= year && year <= (e.to ?? Infinity));
  return era ? { era: era.id, name: era.name, code: era.code } : { era: franchise, name: today[0], code: today[1] };
}
/** The era table, for the check against data-src/research/eras/nfl.json. */
export const ERA_EXCEPTIONS = { 'nfl-washington-commanders': { id: 'nfl-washington-redskins', name: 'Washington Redskins' } };

// nflverse's team codes, by season, as today's franchises (1980–2000).
const NFLVERSE_CODES = {
  ATL: 'nfl-atlanta-falcons', BUF: 'nfl-buffalo-bills', CHI: 'nfl-chicago-bears', CIN: 'nfl-cincinnati-bengals', DAL: 'nfl-dallas-cowboys',
  DEN: 'nfl-denver-broncos', DET: 'nfl-detroit-lions', GB: 'nfl-green-bay-packers', KC: 'nfl-kansas-city-chiefs', MIA: 'nfl-miami-dolphins',
  MIN: 'nfl-minnesota-vikings', NE: 'nfl-new-england-patriots', NO: 'nfl-new-orleans-saints', NYG: 'nfl-new-york-giants',
  NYJ: 'nfl-new-york-jets', PHI: 'nfl-philadelphia-eagles', PIT: 'nfl-pittsburgh-steelers', SD: 'nfl-los-angeles-chargers',
  SEA: 'nfl-seattle-seahawks', SF: 'nfl-san-francisco-49ers', TB: 'nfl-tampa-bay-buccaneers', WAS: 'nfl-washington-commanders',
  IND: 'nfl-indianapolis-colts', PHO: 'nfl-arizona-cardinals', ARI: 'nfl-arizona-cardinals', RAI: 'nfl-las-vegas-raiders',
  OAK: 'nfl-las-vegas-raiders', RAM: 'nfl-los-angeles-rams', LA: 'nfl-los-angeles-rams', CAR: 'nfl-carolina-panthers',
  JAX: 'nfl-jacksonville-jaguars', HOU: 'nfl-tennessee-titans', TEN: 'nfl-tennessee-titans', CLE: 'nfl-cleveland-browns',
};
/** The franchise of an nflverse team code in season `year` (null for the Ravens, whom no Tecmo season has). */
export function franchiseOfCode(code, year) {
  if (code === 'BAL') return year <= 1983 ? 'nfl-indianapolis-colts' : null;
  if (code === 'STL') return year <= 1987 ? 'nfl-arizona-cardinals' : 'nfl-los-angeles-rams';
  const franchise = NFLVERSE_CODES[code];
  if (!franchise) throw new Error(`Unknown nflverse team ${code} (${year})`);
  return franchise;
}

// ---------- the seasons ----------

/**
 * The Tecmo seasons, each from one edition (the block of a three-season dump), the independent copy it is checked
 * against, its notes and the places its clubs leave empty in the game's lineup, by franchise (`all` for every club):
 * - NES Tecmo Super Bowl fields a 3-4 defence with two corners: every club is a lineman and a corner short.
 * - SNES Tecmo Super Bowl lists three linemen: every club is a lineman short.
 * - The run-and-shoot clubs carry receivers in both tight-end slots: no tight end (Atlanta, Detroit and Houston in
 *   1990, Atlanta and Houston in 1992 and 1993, Atlanta in 1994).
 * - An unlicensed lineman nobody can name with certainty leaves his line a man short (Washington 1992, Carolina 1995).
 */
export const SEASONS = [
  { season: 1990, edition: 'nes', block: 1, check: 'tecmogeek',
    gaps: { all: { DL: 1, CB: 1 }, 'nfl-atlanta-falcons': { TE: 1 }, 'nfl-detroit-lions': { TE: 1 }, 'nfl-tennessee-titans': { TE: 1 } },
    notes: ['John Taylor (San Francisco, WR1) has receptions 69 in the dump and 63 at Tecmo Geek. Nothing settles which the cartridge holds; the dump\'s 69 is kept.',
      'NES Tecmo Super Bowl has only eleven defenders a club, two of them corners, and three linemen in its 3-4: the game\'s nickel lineup is a corner and a lineman short, and fills them out of position. No player is added.'] },
  { season: 1992, edition: 'tsb2', block: 1, check: 'tsb2-copy',
    gaps: { 'nfl-atlanta-falcons': { TE: 1 }, 'nfl-tennessee-titans': { TE: 1 }, 'nfl-washington-commanders': { OL: 1 } } },
  { season: 1993, edition: 'snes', block: 1, check: 'gamefaqs',
    gaps: { all: { DL: 1 }, 'nfl-atlanta-falcons': { TE: 1 }, 'nfl-tennessee-titans': { TE: 1 } },
    notes: ['Rated by SNES Tecmo Super Bowl, whose GameFAQs transcription confirms it. Tecmo Super Bowl II\'s 1993 season (cartridge season 2) is read only as evidence of who wore which number and who filled a slot; the Genesis cartridge, whose rosters differ and nothing confirms, is not read.',
      'SNES Tecmo Super Bowl lists three linemen a club (its 3-4): the game\'s lineup is a lineman short and fills him out of position. No player is added.'] },
  { season: 1994, edition: 'tsb2', block: 3, check: 'tsb2-copy', gaps: { 'nfl-atlanta-falcons': { TE: 1 } } },
  { season: 1995, edition: 'tsb3', block: 1, check: 'armaments', gaps: { 'nfl-carolina-panthers': { OL: 1 } } },
];
/** The positions a club of `season` is short of in the game's lineup, as SEASONS documents them. */
export function documentedGaps(season, franchise) {
  const { gaps } = SEASONS.find(s => s.season === season);
  const out = { ...(gaps.all || {}) };
  for (const [position, count] of Object.entries(gaps[franchise] || {})) out[position] = (out[position] || 0) + count;
  return out;
}
/** The positions `players` (game positions) leave short of the game's lineup: `{ DL: 1 }`. */
export function lineupGaps(positions) {
  const count = {};
  for (const position of positions) count[position] = (count[position] || 0) + 1;
  return Object.fromEntries(Object.entries(LINEUP).filter(([position, need]) => (count[position] || 0) < need)
    .map(([position, need]) => [position, need - (count[position] || 0)]));
}

// ---------- workbooks and comma-separated text ----------

const XML_ENTITIES = { lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' };
const unescapeXml = text => text.replace(/&(?:#x([0-9a-f]+)|#(\d+)|([a-z]+));/gi, (whole, hex, dec, name) => (hex ? String.fromCodePoint(parseInt(hex, 16))
  : dec ? String.fromCodePoint(Number(dec)) : XML_ENTITIES[name] ?? whole));
const textRuns = xml => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(m => unescapeXml(m[1])).join('');
const attr = (tag, name) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];
const columnOf = ref => [.../^[A-Z]+/.exec(ref)[0]].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

/** An .xlsx workbook's sheets by name: `{ name: [[cell text]] }` (cached formula results; styles ignored). */
export function readXlsx(bytes) {
  const zip = unzipSync(bytes);
  const part = name => { if (!zip[name]) throw new Error(`The workbook has no ${name}`); return strFromU8(zip[name]); };
  const shared = zip['xl/sharedStrings.xml'] ? [...part('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => textRuns(m[1])) : [];
  const targets = new Map([...part('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\b[^>]*>/g)].map(([tag]) => [attr(tag, 'Id'), attr(tag, 'Target')]));
  const sheets = {};
  for (const [tag] of part('xl/workbook.xml').matchAll(/<sheet\b[^>]*>/g)) {
    const target = targets.get(attr(tag, 'r:id'));
    const xml = part(target.startsWith('/') ? target.slice(1) : `xl/${target}`);
    const rows = [];
    for (const row of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const cells = [];
      for (const cell of (row[2] || '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = attr(cell[1], 'r'), type = attr(cell[1], 't'), inner = cell[2] || '';
        const raw = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
        cells[ref ? columnOf(ref) : cells.length] = type === 's' ? shared[Number(raw)] : type === 'inlineStr' ? textRuns(inner) : raw == null ? '' : unescapeXml(raw);
      }
      rows[Number(attr(row[1], 'r')) - 1] = Array.from(cells, value => value ?? '');
    }
    sheets[unescapeXml(attr(tag, 'name'))] = Array.from(rows, row => row ?? []);
  }
  return sheets;
}

/** Comma-separated text as rows of fields (quotes, doubled quotes and line breaks in quotes understood). */
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.length > 1 || r[0] !== '');
}
