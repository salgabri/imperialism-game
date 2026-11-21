// The earlier college football seasons' facts and ratings (docs/design/college-football.md, "Earlier seasons"): the FBS
// seasons 2004 to 2025, which no game rated, computed from the facts sportsdataverse publishes. No I/O here: the sync
// (scripts/sync-cfb-seasons.mjs) reads the files and hands their rows in.
//
// Sources (sportsdataverse, https://github.com/sportsdataverse):
//   - cfbfastR-data's season rosters (rosters/csv/cfb_rosters_<year>.csv, CollegeFootballData.com's): every rostered
//     player of a school with his ESPN athlete id, position, weight and, from about 2017, his class (in full from 2009);
//   - cfbfastR-cfb-data's tables (ESPN-derived Parquet, scripts/lib/parquet.mjs): every game's schedule row
//     (cfb_schedules), every player's box score from 2004 (player_box: passing, rushing, receiving, interceptions,
//     kicking; the defence's tackles only from 2023), each play's participants from 2014 (play_participants: tacklers,
//     sacks, passes defended, fumbles forced), and the 247Sports composite of every recruiting class from 2002
//     (cfb_recruits).
//
// A player's season is his school's (the roster's), his position the roster's (a generic "DB" a corner or a safety by his
// recruiting position, else by weight), his value a weighted sum of standardised signals of his position (his share of
// his school's passes, carries and catches, his yards, tackles, sacks, passes defended and interceptions, his field
// goals; his recruiting grade and his years in college), pooled over the season and the two before it 3:2:1. The
// weights were fitted once, by least squares, to College Football 27's launch ratings of the players of 2025 who
// returned in 2026 (VALUE_WEIGHTS; scripts/sync-cfb-seasons.mjs --tune), and are frozen; the seasons before 2014, which
// have no play participants, use weights fitted without them. The seasons before 2009, which no roster lists in full,
// play rosters rebuilt from the box scores and the recruiting classes (rebuiltRoster).

export const FIRST_SEASON = 2004;
export const LAST_SEASON = 2025;
/** The first season CollegeFootballData.com's rosters list in full (about 100 a school, with positions); before it, rebuiltRoster. */
export const ROSTERS_FROM = 2009;
/** The first season of ESPN's box scores (player_box). */
export const FIRST_BOX = 2004;
/** The first season whose plays name their tacklers, pass rushers and pass defenders (play_participants). */
export const PARTICIPANTS_FROM = 2014;
/** The window's weights: the season itself, the one before, the one before that (docs/design/computed-ratings.md). */
export const WINDOW = Object.freeze([3, 2, 1]);
/** The first recruiting class the sources list (247Sports' composite; cfbfastR-cfb-data has none for 2000 or 2001). */
export const FIRST_CLASS = 2002;
/** The seasons a recruiting class can play after its first: four, a redshirt year included (classes s − 4 to s play in s). */
export const CLASS_SPAN = 4;

/** The game's positions (scripts/lib/nfl.mjs), the order squads list them in. */
export const POSITIONS = Object.freeze(['QB', 'RB', 'WR', 'TE', 'OL', 'DL', 'LB', 'CB', 'S', 'K']);

/**
 * The rosters' positions as the game's. A generic defensive back ('DB') is resolved per player (positionOf); a punter,
 * long snapper, returner or athlete has no place of his own, and an unknown one ('?', 'NA') is resolved from his other
 * seasons or his recruiting.
 */
export const ROSTER_POSITION = Object.freeze({
  QB: 'QB', RB: 'RB', FB: 'RB', WR: 'WR', TE: 'TE',
  OL: 'OL', OT: 'OL', G: 'OL', C: 'OL',
  DL: 'DL', DE: 'DL', DT: 'DL', NT: 'DL', EDGE: 'DL',
  LB: 'LB', OLB: 'LB', ILB: 'LB',
  CB: 'CB', S: 'S', DB: 'DB', PK: 'K',
});
/** The roster positions that have no place in the lineup. */
export const LEFT_OUT = new Set(['P', 'LS', 'PR', 'KR']);
/** 247Sports' recruiting positions as the game's (an athlete, 'ATH', none). */
export const RECRUIT_POSITION = Object.freeze({
  'PRO': 'QB', 'DUAL': 'QB', QB: 'QB', RB: 'RB', APB: 'RB', FB: 'RB', WR: 'WR', TE: 'TE',
  OT: 'OL', IOL: 'OL', OG: 'OL', OC: 'OL', OL: 'OL',
  DT: 'DL', SDE: 'DL', WDE: 'DL', DE: 'DL', EDGE: 'DL', DL: 'DL',
  ILB: 'LB', OLB: 'LB', LB: 'LB', CB: 'CB', S: 'S', K: 'K',
});
/** A defensive back this heavy or heavier, whose recruiting names no position of his, plays safety (2025: 68% agree with EA). */
export const SAFETY_WEIGHT = 195;

/**
 * The rosters' names of the schools whose CollegeFootballData.com name is not the game's label (scripts/data/cfb-teams.json)
 * or a school the game's built-in season lacks (scripts/data/cfb-seasons.json `schools`).
 */
export const SOURCE_NAMES = Object.freeze({ 'UConn': 'cfb-connecticut', 'Miami (OH)': 'cfb-miami-ohio', 'Middle Tennessee': 'cfb-middle-tennessee-state',
  'San José State': 'cfb-san-jose-state', 'California': 'cfb-cal', "Hawai'i": 'cfb-hawaii', 'South Florida': 'cfb-usf', 'Florida Atlantic': 'cfb-fau',
  'Florida International': 'cfb-fiu', 'Massachusetts': 'cfb-umass', 'App State': 'cfb-appalachian-state', 'Idaho': 'cfb-idaho' });

/**
 * A name as the sources are matched on: no accents, case, punctuation, generational suffix or bracketed tag (the
 * recruiting classes' "Joe (player) Cox", the box scores' "Omowale (Wally) Dada").
 */
export const plain = text => String(text ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
  .replace(/\([^)]*\)/g, '').replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, '').replace(/[^a-z]/g, '');

/** A CSV text's rows (RFC 4180 quoting), the header first. */
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; } else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; } else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const NA = value => value == null || value === '' || value === 'NA';
const number = value => (NA(value) || value === '--' ? 0 : Number(value) || 0);
const pair = value => { const m = /^(\d+)\/(\d+)$/.exec(String(value ?? '')); return m ? [Number(m[1]), Number(m[2])] : [0, 0]; };

/**
 * A season's roster (cfbfastR-data's CSV) as `[{ id, name, school, position, weight, height, classYear }]`, each row's
 * school a game id by `schoolOf(the source's name)` (rows of schools the game does not know are skipped): the athlete's
 * ESPN id, his name, the roster's position code, weight (lb) and height (in), and his class (1–4) where the roster gives
 * one (from about 2017; earlier rosters hold the season there instead, and it is dropped).
 */
export function rosterOf(text, schoolOf) {
  const [head, ...rows] = parseCsv(text);
  const ix = Object.fromEntries(head.map((key, i) => [key, i]));
  for (const key of ['athlete_id', 'first_name', 'last_name', 'team', 'position', 'weight', 'height', 'year']) {
    if (!(key in ix)) throw new Error(`The roster has no ${key} column`);
  }
  const out = [], seen = new Set(), byName = new Map();
  for (const r of rows) {
    if (r.length < head.length) continue;
    const school = schoolOf(r[ix.team]);
    if (!school) continue;
    const id = Number(r[ix.athlete_id]);
    if (!Number.isInteger(id)) throw new Error(`A roster row without an athlete id: ${r.join(',')}`);
    if (seen.has(`${id}|${school}`)) continue;
    seen.add(`${id}|${school}`);
    const name = cleanName([r[ix.first_name], r[ix.last_name]].map(part => String(part ?? '').trim()).filter(part => part && part !== 'NA').join(' '));
    if (!name) continue;
    const classYear = /^[1-5]$/.test(r[ix.year]) ? Number(r[ix.year]) : null;
    const entry = { id, name, school, position: NA(r[ix.position]) ? null : r[ix.position], weight: NA(r[ix.weight]) ? null : Number(r[ix.weight]),
      height: NA(r[ix.height]) ? null : Number(r[ix.height]), classYear };
    // One player listed twice by one school (CollegeFootballData.com gives some two ids): the entry with an ESPN id (the
    // box scores' key), then a position, then a weight, is kept.
    const key = `${school}|${plain(name)}`;
    const prev = byName.get(key);
    const rank = e => (e.id > 0 ? 4 : 0) + (e.position ? 2 : 0) + (e.weight != null ? 1 : 0);
    if (prev && rank(prev) >= rank(entry)) continue;
    if (prev) out.splice(out.indexOf(prev), 1);
    byName.set(key, entry);
    out.push(entry);
  }
  return out;
}

/**
 * A roster name as the game shows it: a generational suffix without the comma the source puts before it ("Dante Fowler
 * Jr.", "Vernon Hargreaves III"), Jr. and Sr. with their full stop, a backtick or opening quote standing for an
 * apostrophe or a Hawaiian ʻokina a plain apostrophe, single spaces.
 */
export function cleanName(text) {
  return String(text ?? '')
    .replace(/\([^)]*\)/g, ' ').replace(/_/g, ' ')
    .replace(/[`‘ʻ]/g, "'")
    .replace(/\s*,\s*(jr|sr|ii|iii|iv|v)\.?$/i, (_, suffix) => ` ${suffix.length === 2 && /^[js]r$/i.test(suffix) ? `${suffix[0].toUpperCase()}r.` : suffix.toUpperCase()}`)
    .replace(/ ([JS])r$/, ' $1r.')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The box-score categories every season from 2004 has. */
export const BOX_CATEGORIES = new Set(['passing', 'rushing', 'receiving', 'interceptions', 'kickReturns', 'puntReturns', 'kicking', 'punting']);
const blankBox = () => ({ games: new Set(), passAtt: 0, passCmp: 0, passYds: 0, passTd: 0, passInt: 0, rushAtt: 0, rushYds: 0, rushTd: 0,
  rec: 0, recYds: 0, recTd: 0, int: 0, fgm: 0, fga: 0, xpm: 0, xpa: 0, returns: 0, names: new Set() });

/**
 * A season's box scores (player_box rows) of the games `games` keeps (a Set of game ids; all if null) and `drop` does
 * not (a Set of game ids: the schedule's twins, scheduleOf) as Map athlete id → `{ team, games, passAtt, passCmp,
 * passYds, passTd, passInt, rushAtt, rushYds, rushTd, rec, recYds, recTd, int, fgm, fga, xpm, xpa, returns, names }`, its
 * team the ESPN team he played most of those games for. Only the categories every season's box scores have are read
 * (BOX_CATEGORIES): the defence's own rows (tackles, sacks), which exist only from 2023, and the fumbles', from 2016, are
 * not, so every season is measured alike.
 */
export function boxOf(rows, games = null, drop = null) {
  const out = new Map();
  const teamGames = new Map();
  for (const r of rows) {
    if (games && !games.has(r.game_id)) continue;
    if (drop?.has(r.game_id)) continue;
    if (!BOX_CATEGORIES.has(r.category)) continue;
    const id = r.athlete_id;
    if (!Number.isInteger(id)) continue;
    if (!out.has(id)) out.set(id, blankBox());
    const p = out.get(id);
    p.games.add(r.game_id);
    if (r.athlete_name) p.names.add(r.athlete_name);
    const key = `${id}|${r.team_id}`;
    if (!teamGames.has(key)) teamGames.set(key, new Set());
    teamGames.get(key).add(r.game_id);
    switch (r.category) {
      case 'passing': {
        const [made, tried] = pair(r['completions/passingAttempts']);
        p.passCmp += made; p.passAtt += tried; p.passYds += number(r.passingYards); p.passTd += number(r.passingTouchdowns); p.passInt += number(r.interceptions);
        break;
      }
      case 'rushing': p.rushAtt += number(r.rushingAttempts); p.rushYds += number(r.rushingYards); p.rushTd += number(r.rushingTouchdowns); break;
      case 'receiving': p.rec += number(r.receptions); p.recYds += number(r.receivingYards); p.recTd += number(r.receivingTouchdowns); break;
      case 'interceptions': p.int += number(r.interceptions); break;
      case 'kicking': {
        const [fgm, fga] = pair(r['fieldGoalsMade/fieldGoalAttempts']);
        const [xpm, xpa] = pair(r['extraPointsMade/extraPointAttempts']);
        p.fgm += fgm; p.fga += fga; p.xpm += xpm; p.xpa += xpa;
        break;
      }
      case 'kickReturns': p.returns += number(r.kickReturns); break;
      case 'puntReturns': p.returns += number(r.puntReturns); break;
      default: break;
    }
  }
  for (const [key, set] of teamGames) {
    const [id, team] = key.split('|').map(Number);
    const p = out.get(id);
    if (p.team === undefined || set.size > p.teamGames || (set.size === p.teamGames && team < p.team)) { p.team = team; p.teamGames = set.size; }
  }
  for (const p of out.values()) delete p.teamGames;
  return out;
}

// The play participants' roles the defence's value reads: tackles (the tackler and an assisting tackler each), sacks,
// passes defended, fumbles forced.
const ROLES = Object.freeze([['tackler_player_id', 'tackles'], ['assisted_by_player_id', 'tackles'], ['sacked_by_player_id', 'sacks'],
  ['pass_defender_player_id', 'passesDefended'], ['forced_by_player_id', 'forced']]);

/**
 * A season's play participants (play_participants rows, from 2014) of the games `games` keeps as Map athlete id →
 * `{ games, tackles, sacks, passesDefended, forced }`.
 */
export function participantsOf(rows, games = null) {
  const out = new Map();
  for (const r of rows) {
    if (games && !games.has(r.game_id)) continue;
    for (const [column, field] of ROLES) {
      const value = r[column];
      if (value == null) continue;
      const id = Number(value);
      if (!Number.isInteger(id)) continue;
      if (!out.has(id)) out.set(id, { games: new Set(), tackles: 0, sacks: 0, passesDefended: 0, forced: 0 });
      const p = out.get(id);
      p[field]++;
      p.games.add(r.game_id);
    }
  }
  return out;
}

/**
 * A season's schedule (cfb_schedules rows) → `{ fbs: Set of ESPN team ids, conference: Map id → the source's name,
 * games: [{ id, home, away, homeScore, awayScore, neutral, postseason }], schools: Set of ESPN team ids }`: the FBS
 * schools (any played as one), their conference (the regular season's), every completed game between two of them, and
 * the season's schools: those of them that played at least one such game (New Mexico State of 2020 played none).
 */
export function scheduleOf(rows) {
  const fbs = new Set(), conference = new Map(), all = [];
  for (const g of rows) {
    for (const side of ['home', 'away']) {
      if (g[`${side}_division`] !== 'fbs') continue;
      fbs.add(g[`${side}_id`]);
      if (g.season_type === 'regular' && g[`${side}_conference`]) conference.set(g[`${side}_id`], g[`${side}_conference`]);
    }
  }
  for (const g of rows) {
    if (!fbs.has(g.home_id) || !fbs.has(g.away_id) || g.home_points == null || g.away_points == null) continue;
    if (g.completed === false) continue;
    all.push({ id: g.game_id, home: g.home_id, away: g.away_id, homeScore: g.home_points, awayScore: g.away_points,
      neutral: !!g.neutral_site, postseason: g.season_type !== 'regular', day: dayOf(g.start_date), week: g.week ?? null });
  }
  for (const id of fbs) if (!conference.has(id)) {
    const any = rows.find(g => (g.home_id === id && g.home_conference) || (g.away_id === id && g.away_conference));
    if (any) conference.set(id, any.home_id === id ? any.home_conference : any.away_conference);
  }
  all.sort((a, b) => a.id - b.id);
  // ESPN lists a few games twice under two ids (2004's Florida Atlantic at Florida A&M, two of 2008's, seven of 2012's,
  // two of 2013's bowls): the same two schools with the same points on the same day (or the next, a late kick-off's
  // date in UTC). The first id is kept; its twin is dropped (`twins`), and the box scores drop its rows (boxOf).
  const games = [], twins = new Set(), byResult = new Map();
  for (const g of all) {
    const [low, high] = g.home < g.away ? [g.home, g.away] : [g.away, g.home];
    const key = [low, high, g.home === low ? g.homeScore : g.awayScore, g.home === low ? g.awayScore : g.homeScore].join('|');
    const twin = (byResult.get(key) ?? []).some(e => (e.day != null && g.day != null ? Math.abs(e.day - g.day) <= 1 : e.week != null && e.week === g.week));
    if (twin) { twins.add(g.id); continue; }
    if (!byResult.has(key)) byResult.set(key, []);
    byResult.get(key).push(g);
    games.push(g);
  }
  for (const g of games) { delete g.day; delete g.week; }
  const schools = new Set(games.flatMap(g => [g.home, g.away]));
  return { fbs, conference, games, schools, twins };
}
/** A schedule's start date (an ISO date-time) as a day number, or null. */
const dayOf = value => { const t = Date.parse(value ?? ''); return Number.isFinite(t) ? Math.floor(t / 86400000) : null; };

/** The recruiting classes' team names the source files under no team in any class, as the game's schools. */
export const RECRUIT_TEAM_NAMES = Object.freeze({ 'Hawaii Rainbow Warriors': 'cfb-hawaii' });

/**
 * The recruiting classes (Map class → cfb_recruits rows) with each row's team id repaired: the source files some rows
 * under team id 0 (Hawaii's in every class; UAB's of 2015 and 2016, UConn's and Old Dominion's of 2020, South Alabama's
 * and Georgia State's of 2009 and 2010, Kennesaw State's of 2014, Charlotte's of 2011 and 2012, and FCS and lower schools'),
 * so such a row takes the id the other classes give its team's name most often, else RECRUIT_TEAM_NAMES' school's
 * (`espnOf`: school → ESPN id). → a new Map of new rows; a row the repair cannot place keeps id 0.
 */
export function repairedClasses(classes, espnOf) {
  const usual = new Map();
  for (const rows of classes.values()) {
    for (const r of rows) {
      const id = Number(r.team_id);
      if (!id || !r.team) continue;
      if (!usual.has(r.team)) usual.set(r.team, new Map());
      usual.get(r.team).set(id, (usual.get(r.team).get(id) ?? 0) + 1);
    }
  }
  const idOf = new Map([...usual].map(([team, ids]) => [team, [...ids].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0]]));
  for (const [team, school] of Object.entries(RECRUIT_TEAM_NAMES)) {
    if (espnOf[school] == null) throw new Error(`No ESPN id for ${school}`);
    if (!idOf.has(team)) idOf.set(team, espnOf[school]);
  }
  return new Map([...classes].map(([c, rows]) => [c, rows.map(r => (Number(r.team_id) || !idOf.has(r.team) ? r : { ...r, team_id: String(idOf.get(r.team)) }))]));
}

/**
 * The recruiting classes' players (cfb_recruits rows, each class's) → `{ byTeam: Map 'plain name|ESPN team id' →
 * recruit, byName: Map plain name → recruit (null where two share it), all: Map plain name → every recruit of it }`, a
 * recruit `{ name, grade, stars, class, position, team }` (the game's position, or null).
 */
export function recruitsOf(classes) {
  const byTeam = new Map(), byName = new Map(), all = new Map();
  for (const [year, rows] of classes) {
    for (const r of rows) {
      const key = plain(r.player_name);
      if (!key) continue;
      const recruit = { name: r.player_name, grade: Number.isFinite(r.grade) ? r.grade : null, stars: r.stars ?? null, class: year,
        position: RECRUIT_POSITION[r.position] ?? null, team: Number(r.team_id) };
      const teamKey = `${key}|${recruit.team}`;
      // A player listed in two classes (a reclassified one) keeps the later, as he arrived then.
      if (!byTeam.has(teamKey) || byTeam.get(teamKey).class < year) byTeam.set(teamKey, recruit);
      // A name two recruits share names neither (unless it is one recruit listed twice by the same school).
      const known = byName.get(key);
      byName.set(key, !byName.has(key) ? recruit : known && known.team === recruit.team ? (known.class < year ? recruit : known) : null);
      if (!all.has(key)) all.set(key, []);
      all.get(key).push(recruit);
    }
  }
  return { byTeam, byName, all };
}

const sameGroup = (a, b) => a === b || ((a === 'CB' || a === 'S') && (b === 'CB' || b === 'S'));

/**
 * A rostered player's recruiting record: the class his school signed him in (`team`, its ESPN id); else, a transfer's,
 * the one a school he played for before signed him in (`before`, ESPN ids newest first); else the one recruit of his name
 * whose class could still be in college in `season` (MAX_EXPERIENCE), or of those the one recruited at his position
 * (`position`, a corner and a safety alike). Null when none or several fit.
 */
export function recruitOf(recruits, { name, team, before = [], season, position = null }) {
  const key = plain(name);
  const fits = r => r && r.class <= season && r.class > season - MAX_EXPERIENCE;
  for (const school of [team, ...before]) {
    const r = recruits.byTeam.get(`${key}|${school}`);
    if (fits(r)) return r;
  }
  const candidates = (recruits.all?.get(key) ?? []).filter(fits);
  const distinct = [...new Map(candidates.map(r => [`${r.team}|${r.class}`, r])).values()];
  if (distinct.length === 1) return distinct[0];
  const atPosition = distinct.filter(r => r.position == null || position == null || sameGroup(r.position, position));
  return atPosition.length === 1 ? atPosition[0] : null;
}

// ---------- a season's players ----------

/**
 * Each team's totals in a season's box scores (boxOf): `Map ESPN team id → { games, passAtt, rushAtt, rec, recYds }`,
 * `games` the games any of its players has a box-score line in.
 */
export function teamTotalsOf(box) {
  const out = new Map();
  for (const p of box.values()) {
    if (!out.has(p.team)) out.set(p.team, { games: new Set(), passAtt: 0, rushAtt: 0, rec: 0, recYds: 0 });
    const t = out.get(p.team);
    t.passAtt += p.passAtt; t.rushAtt += p.rushAtt; t.rec += p.rec; t.recYds += p.recYds;
    for (const g of p.games) t.games.add(g);
  }
  return out;
}

/**
 * A player's game position: the roster's, else the nearest season's roster that names a specific one (`others`, the
 * codes of his other seasons nearest first), else his recruiting position, else his box score's kind (a passer a
 * quarterback, a kicker a kicker); a generic defensive back is a corner or a safety by his recruiting position, else by
 * his weight (SAFETY_WEIGHT). Null for a punter, long snapper or returner, or a player nothing places.
 */
export function positionOf({ code, others = [], recruit = null, box = null, weight = null }) {
  if (LEFT_OUT.has(code)) return null;
  let pos = ROSTER_POSITION[code] ?? null;
  if (!pos || pos === 'DB') {
    // An unplaced player takes his nearest other season's position; a generic defensive back only a corner's or a safety's.
    const other = others.map(c => ROSTER_POSITION[c]).find(p => p && p !== 'DB' && (pos !== 'DB' || p === 'CB' || p === 'S'));
    if (other) pos = other;
    else if (!pos && others.some(c => ROSTER_POSITION[c] === 'DB')) pos = 'DB';
  }
  if (!pos && recruit?.position) pos = recruit.position;
  if (!pos && box) {
    if (box.passAtt >= 10) pos = 'QB';
    else if (box.fga > 0 || box.xpa > 0) pos = 'K';
    else if (box.rushAtt >= 10 && box.rushAtt >= box.rec) pos = 'RB';
    else if (box.rec >= 5) pos = 'WR';
  }
  if (pos === 'DB') {
    if (recruit?.position === 'CB' || recruit?.position === 'S') return recruit.position;
    return weight != null && weight >= SAFETY_WEIGHT ? 'S' : 'CB';
  }
  return pos;
}


// ---------- a player's season: his signals ----------

/** Priors, in units of exposure, that shrink an efficiency toward replacement: passing yards a try, yards a carry, kicks made. */
export const PRIORS = Object.freeze({ anya: 150, ypc: 60, fgPct: 12 });
/** A passer's adjusted yards a try: yards, 20 a touchdown, less 45 an interception. */
const anyaEvents = s => s.passYds + 20 * s.passTd - 45 * s.passInt;

/**
 * The signals each position's value is read from (`full`: seasons from 2014, whose plays name their tacklers, pass
 * rushers and pass defenders; `early`: 2009–2013, without them). Shares are of the player's school's passes, carries
 * and catches; per-game figures are per game his school played; efficiencies are shrunk toward replacement (PRIORS).
 */
export const SIGNALS = Object.freeze({
  full: Object.freeze({
    QB: ['passShare', 'passYdsPG', 'anya', 'rushYdsPG', 'grade', 'exp'],
    RB: ['rushShare', 'rushYdsPG', 'ypc', 'recYdsPG', 'grade', 'exp'],
    WR: ['recShare', 'recYdsPG', 'recTdPG', 'grade', 'exp'],
    TE: ['recShare', 'recYdsPG', 'grade', 'exp', 'weight'],
    OL: ['grade', 'exp', 'weight', 'appearShare'],
    DL: ['tacklesPG', 'sacksPG', 'pdPG', 'appearShare', 'grade', 'exp', 'weight'],
    LB: ['tacklesPG', 'sacksPG', 'pdPG', 'intPG', 'appearShare', 'grade', 'exp'],
    CB: ['pdPG', 'tacklesPG', 'intPG', 'appearShare', 'grade', 'exp'],
    S: ['tacklesPG', 'pdPG', 'intPG', 'appearShare', 'grade', 'exp'],
    K: ['fgmPG', 'fgPct', 'xpaPG', 'grade', 'exp'],
  }),
  early: Object.freeze({
    QB: ['passShare', 'passYdsPG', 'anya', 'rushYdsPG', 'grade', 'exp'],
    RB: ['rushShare', 'rushYdsPG', 'ypc', 'recYdsPG', 'grade', 'exp'],
    WR: ['recShare', 'recYdsPG', 'recTdPG', 'grade', 'exp'],
    TE: ['recShare', 'recYdsPG', 'grade', 'exp', 'weight'],
    OL: ['grade', 'exp', 'weight', 'boxAppearShare'],
    DL: ['boxAppearShare', 'grade', 'exp', 'weight'],
    LB: ['intPG', 'boxAppearShare', 'grade', 'exp'],
    CB: ['intPG', 'boxAppearShare', 'grade', 'exp'],
    S: ['intPG', 'boxAppearShare', 'grade', 'exp'],
    K: ['fgmPG', 'fgPct', 'xpaPG', 'grade', 'exp'],
  }),
});
/** The regime of a season's signals. */
export const regimeOf = season => (season >= PARTICIPANTS_FROM ? 'full' : 'early');

const EVENT_KEYS = ['passAtt', 'passYds', 'passTd', 'passInt', 'rushAtt', 'rushYds', 'rushTd', 'rec', 'recYds', 'recTd', 'int', 'fgm', 'fga', 'xpa'];

/**
 * A player's window (WINDOW: the season 3, the one before 2, the one before that 1), pooled by exposure: each season he
 * was on an FBS school's roster or box score counts with his school's games as its exposure. `seasons`: newest first,
 * each `{ games, team, box, part, participants }` (null for a season he was on no FBS school: it adds nothing), `games`
 * his school's games that season, `team` its totals (teamTotalsOf), `box` his box record (or null), `part` his play
 * participations (or null), `participants` whether that season's plays name them at all. → the pooled sums.
 */
export function pooledWindow(seasons, weights = WINDOW) {
  const sum = { G: 0, partG: 0, teamPassAtt: 0, teamRushAtt: 0, teamRec: 0, boxAppear: 0, partAppear: 0, tackles: 0, sacks: 0, passesDefended: 0 };
  for (const key of EVENT_KEYS) sum[key] = 0;
  seasons.forEach((season, i) => {
    if (!season || !season.games) return;
    const w = weights[i] ?? 0;
    sum.G += w * season.games;
    sum.teamPassAtt += w * season.team.passAtt;
    sum.teamRushAtt += w * season.team.rushAtt;
    sum.teamRec += w * season.team.rec;
    const games = new Set(season.box?.games ?? []);
    sum.boxAppear += w * Math.min(games.size, season.games);
    for (const key of EVENT_KEYS) sum[key] += w * (season.box?.[key] ?? 0);
    if (season.participants) {
      sum.partG += w * season.games;
      for (const g of season.part?.games ?? []) games.add(g);
      sum.tackles += w * (season.part?.tackles ?? 0);
      sum.sacks += w * (season.part?.sacks ?? 0);
      sum.passesDefended += w * (season.part?.passesDefended ?? 0);
      sum.partAppear += w * Math.min(games.size, season.games);
    }
  });
  return sum;
}

const ratio = (x, n) => (n > 0 ? x / n : 0);

/**
 * A player's raw signals from his pooled window (pooledWindow), his recruiting grade (and whether a class lists him at
 * all, `recruited`), years in college and weight. The efficiencies come back as `{ x, n }` (events, exposure), to be
 * shrunk toward the season's replacement once every player's are known (shrinkSignals). The participants' signals are
 * null where his window has no season that names them.
 */
export function rawSignals(sum, { grade = null, recruited = grade != null, exp = null, weight = null } = {}) {
  const part = sum.partG > 0;
  return {
    passShare: ratio(sum.passAtt, sum.teamPassAtt), passYdsPG: ratio(sum.passYds, sum.G), rushYdsPG: ratio(sum.rushYds, sum.G),
    rushShare: ratio(sum.rushAtt, sum.teamRushAtt), recShare: ratio(sum.rec, sum.teamRec), recYdsPG: ratio(sum.recYds, sum.G),
    recTdPG: ratio(sum.recTd, sum.G), intPG: ratio(sum.int, sum.G), fgmPG: ratio(sum.fgm, sum.G), xpaPG: ratio(sum.xpa, sum.G),
    // The share of his school's games he has a line in: in the box score or, where they are named, the plays; the
    // early seasons' (no named plays) the box score's alone.
    appearShare: part ? ratio(sum.partAppear, sum.partG) : ratio(sum.boxAppear, sum.G),
    boxAppearShare: ratio(sum.boxAppear, sum.G),
    tacklesPG: part ? ratio(sum.tackles, sum.partG) : null, sacksPG: part ? ratio(sum.sacks, sum.partG) : null,
    pdPG: part ? ratio(sum.passesDefended, sum.partG) : null,
    anya: { x: anyaEvents(sum), n: sum.passAtt }, ypc: { x: sum.rushYds, n: sum.rushAtt }, fgPct: { x: sum.fgm, n: sum.fga },
    grade, recruited, exp, weight,
  };
}

/**
 * Each efficiency `{ x, n }` of `players` (one position's, `{ signals }`) shrunk toward replacement: the pooled rate of
 * the quarter of those with any exposure that has the least (docs/design/computed-ratings.md, step 3), by the prior
 * PRIORS[signal]. → the replacement rates, `{ anya, ypc, fgPct }`. Mutates each player's signals in place.
 */
export function shrinkSignals(players) {
  const replacement = {};
  for (const key of Object.keys(PRIORS)) {
    const exposed = players.map(p => p.signals[key]).filter(s => s && s.n > 0).sort((a, b) => a.n - b.n);
    const quarter = exposed.slice(0, Math.max(1, Math.ceil(exposed.length / 4)));
    const n = quarter.reduce((t, s) => t + s.n, 0), x = quarter.reduce((t, s) => t + s.x, 0);
    const r0 = n > 0 ? x / n : 0;
    replacement[key] = r0;
    for (const p of players) {
      const s = p.signals[key];
      if (s && typeof s === 'object') p.signals[key] = (s.x + PRIORS[key] * r0) / (s.n + PRIORS[key]);
    }
  }
  return replacement;
}

// ---------- value ----------

const quantile = (sorted, q) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))] : 0);
/** A recruit-less player's grade: the position's tenth percentile of graded players (walk-ons play, on the evidence, below recruits). */
export const UNGRADED_QUANTILE = 0.1;
/**
 * The grade of a recruit the source lists without one (13–26% of the classes from 2016, many of them later transfers):
 * the graded players' first quartile. Against College Football 27's launch ratings the walk-on's tenth percentile fits a
 * little better (mean held-out Spearman 0.7750 against 0.7743), the median a little worse (0.7704); a signed recruit is
 * not a walk-on, so the quartile.
 */
export const RECRUIT_UNGRADED_QUANTILE = 0.25;

/**
 * One position's players' signals standardised over them (z-scores, the population's SD), each missing value first
 * filled: the grade of a player no class lists with the graded players' UNGRADED_QUANTILE, that of a recruit the source
 * lists without one with their RECRUIT_UNGRADED_QUANTILE; a weight or years in college with their median. → `{ columns: { signal: number[] }, fill: { signal: value } }`, each column in
 * `players`' order; `fill.grade` the walk-on's, `fill.recruitGrade` the ungraded recruit's.
 */
export function standardise(players, signals) {
  const columns = {}, fill = {};
  for (const signal of signals) {
    const raw = players.map(p => p.signals[signal]);
    const known = raw.filter(v => v != null && Number.isFinite(v)).sort((a, b) => a - b);
    fill[signal] = signal === 'grade' ? quantile(known, UNGRADED_QUANTILE) : quantile(known, 0.5);
    if (signal === 'grade') fill.recruitGrade = quantile(known, RECRUIT_UNGRADED_QUANTILE);
    const values = raw.map((v, i) => (v != null && Number.isFinite(v) ? v
      : signal === 'grade' && players[i].signals.recruited ? fill.recruitGrade : fill[signal]));
    const mean = values.reduce((t, v) => t + v, 0) / (values.length || 1);
    const sd = Math.sqrt(values.reduce((t, v) => t + (v - mean) ** 2, 0) / (values.length || 1));
    columns[signal] = values.map(v => (sd > 0 ? (v - mean) / sd : 0));
  }
  return { columns, fill };
}

/** Each player's value: Σ weight × z over `weights`' signals (standardise's columns). */
export function valuesOf(columns, weights, count) {
  const out = new Array(count).fill(0);
  for (const [signal, w] of Object.entries(weights)) {
    const column = columns[signal];
    if (!column) throw new Error(`No signal ${signal}`);
    for (let i = 0; i < count; i++) out[i] += w * column[i];
  }
  return out.map(v => Math.round(v * 1e6) / 1e6);
}

/** Solves A x = b (A square) by Gaussian elimination with partial pivoting. */
function solve(A, b) {
  const n = b.length, M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    if (Math.abs(M[c][c]) < 1e-12) throw new Error('A singular fit');
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

/**
 * Non-negative least squares by elimination: regress `y` on the columns `X` (`{ signal: number[] }`) with an intercept,
 * drop the signal with the most negative weight and refit, until every weight is positive. → `{ weights }` normalised to
 * sum to 1 (only their proportions order players), rounded to three decimals.
 */
export function fitWeights(X, y) {
  let signals = Object.keys(X);
  for (;;) {
    if (!signals.length) throw new Error('No signal fits');
    const k = signals.length + 1, n = y.length;
    const row = i => [1, ...signals.map(s => X[s][i])];
    const A = Array.from({ length: k }, () => new Array(k).fill(0)), b = new Array(k).fill(0);
    for (let i = 0; i < n; i++) {
      const r = row(i);
      for (let a = 0; a < k; a++) { b[a] += r[a] * y[i]; for (let c = 0; c < k; c++) A[a][c] += r[a] * r[c]; }
    }
    const beta = solve(A, b).slice(1);
    const worst = beta.reduce((m, v, i) => (v < (m?.v ?? 0) ? { v, i } : m), null);
    if (worst) { signals = signals.filter((_, i) => i !== worst.i); continue; }
    const total = beta.reduce((t, v) => t + v, 0);
    const weights = {};
    signals.forEach((s, i) => { weights[s] = Math.round(beta[i] / total * 1000) / 1000; });
    return { weights };
  }
}

// ---------- a season ----------

/** Years in college are counted 1 (a freshman) to this. */
export const MAX_EXPERIENCE = 6;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * Every rostered player of season `data.season`'s FBS schools, with his position, years in college, recruiting grade,
 * weight and raw signals. `data`: `{ season, espnOf: { school: ESPN id }, rosters: Map year → rosterOf, boxes: Map year →
 * boxOf, participants: Map year → participantsOf (from PARTICIPANTS_FROM), totals: Map year → teamTotalsOf, fbs: Map
 * year → Set of FBS ESPN ids, recruits: recruitsOf, firstSeen: Map athlete id → first year seen, rebuilt: whether the
 * season's roster is rebuiltRoster's, classFrom: the first recruiting class `recruits` holds, boxFrom: the first season of
 * `boxes` }`. A player on two schools' rosters counts for the one he has more box-score games with (then the first
 * listed). Players nothing places (positionOf) and punters, long snappers and returners are left out. → `{ players, left }`,
 * `left` counting those left out.
 *
 * A rebuilt season whose oldest class predates the first the sources list (2004 and 2005, whose seniors signed in 2000
 * and 2001) knows less of a player no class lists: he may be a recruit of an unlisted class, so he is graded as a recruit
 * the source lists without a grade (RECRUIT_UNGRADED_QUANTILE), and, first seen in the first box-score season, he may have
 * been in college before it, so his years in college are unknown (the position's median). Rebuilding 2010 and 2012 as
 * 2004 would have to be (as scripts/sync-cfb-seasons.mjs --validate does), this brought the schools' order 0.01–0.03 of
 * Spearman closer to their real rosters' order.
 */
export function seasonPlayers(data) {
  const { season: s, espnOf, rosters, boxes, participants, totals, fbs, recruits, firstSeen } = data;
  const roster = rosters.get(s);
  if (!roster) throw new Error(`No roster for ${s}`);
  // The season's own schools are those that played an FBS school (scheduleOf `schools`); a window's earlier season
  // counts any FBS school's.
  const fbsNow = data.schools ?? fbs.get(s);
  const boxNow = boxes.get(s) ?? new Map();
  // Each athlete's roster code by year, and the year's roster entry.
  const codesOf = new Map();
  for (const [year, entries] of rosters) for (const e of entries) {
    if (!codesOf.has(e.id)) codesOf.set(e.id, new Map());
    codesOf.get(e.id).set(year, e.position);
  }
  const entryOf = new Map();
  for (const [year, entries] of rosters) {
    const byId = new Map();
    for (const e of entries) {
      const prev = byId.get(e.id);
      const games = school => boxes.get(year)?.get(e.id)?.team === espnOf[school] ? boxes.get(year).get(e.id).games.size : 0;
      if (!prev || games(e.school) > games(prev.school)) byId.set(e.id, e);
    }
    entryOf.set(year, byId);
  }
  const players = [], left = { position: 0, punters: 0 };
  for (const e of entryOf.get(s).values()) {
    const espn = espnOf[e.school];
    if (espn == null || !fbsNow.has(espn)) continue;
    // His recruiting: at this school, else at a school he played for before (a transfer), else the one recruit of his name
    // and position who could still be in college (recruitOf).
    const before = [...new Set((data.history?.get(e.id) ?? []).filter(([year]) => year < s).sort((a, b) => b[0] - a[0]).map(([, team]) => team))]
      .filter(team => team !== espn);
    const listed = ROSTER_POSITION[e.position];
    const recruit = recruitOf(recruits, { name: e.name, team: espn, before, season: s, position: listed === 'DB' ? 'CB' : listed ?? null });
    const others = [...(codesOf.get(e.id) ?? new Map())].filter(([year]) => year !== s)
      .sort((a, b) => Math.abs(a[0] - s) - Math.abs(b[0] - s) || b[0] - a[0]).map(([, code]) => code);
    if (LEFT_OUT.has(e.position)) { left.punters++; continue; }
    const position = positionOf({ code: e.position, others, recruit, box: boxNow.get(e.id) ?? null, weight: e.weight });
    if (!position) { left.position++; continue; }
    const window = WINDOW.map((_, i) => {
      const year = s - i;
      const box = boxes.get(year)?.get(e.id) ?? null;
      const team = i === 0 ? espn : box?.team ?? (entryOf.get(year)?.get(e.id) ? espnOf[entryOf.get(year).get(e.id).school] : null);
      if (team == null || !fbs.get(year)?.has(team)) return null;
      const teamTotals = totals.get(year)?.get(team);
      if (!teamTotals) return null;
      const named = participants.has(year);
      return { games: teamTotals.games.size, team: teamTotals, box: box?.team === team ? box : null,
        part: named ? participants.get(year).get(e.id) ?? null : null, participants: named };
    });
    const exp = recruit ? clamp(s - recruit.class + 1, 1, MAX_EXPERIENCE) : clamp(s - (firstSeen.get(e.id) ?? s) + 1, 1, MAX_EXPERIENCE);
    const unlisted = !recruit && data.rebuilt && s - CLASS_SPAN < data.classFrom;
    const signals = rawSignals(pooledWindow(window), { grade: recruit?.grade ?? null, recruited: !!recruit || unlisted,
      exp: unlisted && (firstSeen.get(e.id) ?? s) <= data.boxFrom ? null : exp, weight: e.weight });
    players.push({ id: e.id, name: e.name, school: e.school, position, exp, grade: recruit?.grade ?? null, recruitClass: recruit?.class ?? null,
      weight: e.weight, signals, box: boxNow.get(e.id) ?? null, rebuilt: e.rebuilt ?? null });
  }
  return { players, left };
}

// ---------- a season no roster lists ----------

/**
 * Season `season`'s roster rebuilt where no roster lists its players in full (the seasons before ROSTERS_FROM), as
 * rosterOf's entries `{ id, name, school, position: null, weight, height, classYear: null, rebuilt }`, `rebuilt` saying how
 * the player was placed. `sources`: `{ boxes: Map year → boxOf, rosters: Map year → rosterOf, classes: Map class →
 * cfb_recruits rows, espnOf: { school: ESPN id }, schools: Set of the season's FBS ESPN ids, needs: the lineup's places
 * by position }`; the evidence is whatever those maps hold. A school's players:
 *   - 'box': every player with a box-score line for it in the season (the school he played most of its games for);
 *   - 'confirmed': a recruit it signed in the season's class or the CLASS_SPAN before it whom a later season places at the
 *     school again (a box-score line, a roster);
 *   - 'signed': a recruit of the season's class or the one before whom no record places elsewhere by the season (another
 *     school's box score or roster, another school's later class) and who has no earlier record at the school (one with a
 *     line there before and none since has left);
 *   - 'filled': while the school is still short of a place of `needs`, its other recruits of those classes at the place's
 *     position (their recruiting's) that no record places elsewhere and that have no earlier record at the school, the
 *     latest class first, then the best graded.
 * A recruit's id is the ESPN athlete id his records at the school carry, else his recruiting id negated; a player's
 * weight and height are those of the nearest roster that lists his id.
 */
export function rebuiltRoster(season, { boxes, rosters, classes, espnOf, schools, needs }) {
  const s = season;
  const schoolOfEspn = new Map(Object.entries(espnOf).map(([school, espn]) => [espn, school]));
  // Every record of a name: its box-score lines and roster entries, by ESPN team, year and athlete id.
  const records = new Map();
  const note = (name, team, year, id) => {
    const key = plain(name);
    if (!key || team == null) return;
    if (!records.has(key)) records.set(key, []);
    records.get(key).push({ team, year, id });
  };
  for (const [year, box] of boxes) for (const [id, p] of box) for (const name of p.names) note(name, p.team, year, id);
  for (const [year, roster] of rosters) for (const e of roster) note(e.name, espnOf[e.school], year, e.id);
  // Each athlete's nearest roster entry and his roster codes, nearest season first.
  const nearest = new Map(), codes = new Map();
  for (const year of [...rosters.keys()].sort((a, b) => Math.abs(a - s) - Math.abs(b - s) || a - b)) {
    for (const e of rosters.get(year)) {
      if (!nearest.has(e.id)) nearest.set(e.id, e);
      if (!codes.has(e.id)) codes.set(e.id, []);
      codes.get(e.id).push(e.position);
    }
  }
  // The classes' signings: every school's of each name (to find a recruit another school signed later), and the season's
  // schools' of its window, the latest class first, then the best graded.
  const signedBy = new Map(), window = [];
  for (const [c, rows] of classes) {
    for (const r of rows) {
      const key = plain(r.player_name), team = Number(r.team_id);
      if (!key) continue;
      if (!signedBy.has(key)) signedBy.set(key, []);
      signedBy.get(key).push({ class: c, team });
      if (c < s - CLASS_SPAN || c > s || !schools.has(team) || !schoolOfEspn.has(team)) continue;
      const recruitId = Number(r.recruit_id);
      if (!Number.isInteger(recruitId) || recruitId <= 0) throw new Error(`${c}: a recruit without a recruiting id: ${r.player_name}`);
      window.push({ key, team, class: c, name: r.player_name, grade: Number.isFinite(r.grade) ? r.grade : null, recruitId,
        position: RECRUIT_POSITION[r.position] ?? null });
    }
  }
  window.sort((a, b) => b.class - a.class || (b.grade ?? -1) - (a.grade ?? -1) || a.recruitId - b.recruitId);
  const signingOf = new Map();
  for (const g of window) if (!signingOf.has(`${g.key}|${g.team}`)) signingOf.set(`${g.key}|${g.team}`, g);

  const out = [], placed = new Set(), ids = new Set();
  const add = (entry, keys) => { out.push(entry); ids.add(entry.id); for (const key of keys) placed.add(key); };
  const physique = id => ({ weight: nearest.get(id)?.weight ?? null, height: nearest.get(id)?.height ?? null });
  // A name ESPN lists under two athlete ids at one school (Navy's Blake Carter of 2008) is one player, as rosterOf keeps
  // one: the id with more of the season's games, then the lower.
  const lines = [...(boxes.get(s) ?? new Map())].filter(([, p]) => schools.has(p.team) && schoolOfEspn.has(p.team) && cleanName([...p.names][0]))
    .sort((a, b) => b[1].games.size - a[1].games.size || a[0] - b[0]);
  for (const [id, p] of lines) {
    const name = cleanName([...p.names][0]);
    if (placed.has(`${plain(name)}|${p.team}`)) continue;
    add({ id, name, school: schoolOfEspn.get(p.team), position: null, ...physique(id), classYear: null, rebuilt: 'box' },
      [...p.names].map(n => `${plain(n)}|${p.team}`));
  }
  const candidates = [];
  for (const g of window) {
    const at = `${g.key}|${g.team}`;
    if (placed.has(at)) continue;
    const seen = records.get(g.key) ?? [];
    const here = seen.filter(e => e.team === g.team);
    const later = here.some(e => e.year > s), before = here.some(e => e.year < s);
    const away = seen.some(e => e.team !== g.team && e.year <= s)
      || (signedBy.get(g.key) ?? []).some(e => e.class > g.class && e.class <= s && e.team !== g.team);
    const how = later ? 'confirmed' : away || before ? null : s - g.class <= 1 ? 'signed' : 'candidate';
    if (!how) continue;
    if (how === 'candidate') { candidates.push(g); continue; }
    // His id: the one his records at the school carry most often (the lowest of equals), else his recruiting id negated.
    const counts = new Map();
    for (const e of here) if (e.id != null) counts.set(e.id, (counts.get(e.id) ?? 0) + 1);
    const id = [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? -g.recruitId;
    if (ids.has(id)) continue;
    add({ id, name: cleanName(g.name), school: schoolOfEspn.get(g.team), position: null, ...physique(id), classYear: null, rebuilt: how }, [at]);
  }
  // The places each school is still short of, by the positions seasonPlayers will give its players.
  const count = new Map();
  for (const e of out) {
    const team = espnOf[e.school];
    const signing = signingOf.get(`${plain(e.name)}|${team}`);
    const position = positionOf({ code: null, others: codes.get(e.id) ?? [], recruit: signing ? { position: signing.position } : null,
      box: boxes.get(s)?.get(e.id) ?? null, weight: e.weight });
    if (!position) continue;
    if (!count.has(e.school)) count.set(e.school, {});
    count.get(e.school)[position] = (count.get(e.school)[position] ?? 0) + 1;
  }
  for (const g of candidates) {
    const school = schoolOfEspn.get(g.team);
    const at = `${g.key}|${g.team}`;
    if (!g.position || !count.has(school) || placed.has(at)) continue;
    const have = count.get(school);
    if ((have[g.position] ?? 0) >= (needs[g.position] ?? 0)) continue;
    have[g.position] = (have[g.position] ?? 0) + 1;
    add({ id: -g.recruitId, name: cleanName(g.name), school, position: null, weight: null, height: null, classYear: null, rebuilt: 'filled' }, [at]);
  }
  return out;
}

/** EA's players per school at each position in College Football 27 (Week 10 Ratings), rounded: each school's population. */
export const DEPTH = Object.freeze({ QB: 4, RB: 5, WR: 10, TE: 6, OL: 13, DL: 14, LB: 8, CB: 8, S: 8, K: 2 });

/**
 * Each position's values (standardise, valuesOf) by the weights of the season's regime, `weights[regime][position]`;
 * the replacement rates of the efficiencies are shrunk toward first (shrinkSignals). Mutates each player (`value`,
 * `z`: his standardised signals). → `{ replacement, fill }` by position.
 */
export function valueSeason(players, weights, regime) {
  const out = { replacement: {}, fill: {} };
  for (const position of POSITIONS) {
    const at = players.filter(p => p.position === position);
    if (!at.length) continue;
    out.replacement[position] = shrinkSignals(at);
    const signals = Object.keys(weights[regime][position]);
    const { columns, fill } = standardise(at, SIGNALS[regime][position]);
    out.fill[position] = fill;
    const values = valuesOf(columns, weights[regime][position], at.length);
    at.forEach((p, i) => {
      p.value = values[i];
      p.z = Object.fromEntries(signals.map(signal => [signal, Math.round(columns[signal][i] * 1000) / 1000]));
    });
  }
  return out;
}

/** A position's players best first: by value, then years in college, grade and name. */
const bestFirst = (a, b) => b.value - a.value || b.exp - a.exp || (b.grade ?? 0) - (a.grade ?? 0) || a.name.localeCompare(b.name) || a.id - b.id;

/**
 * Each school's DEPTH best players at each position by value, ranked across the season's schools and read off the
 * reference (`reference[position]`: College Football 27's ratings at that position, each school's best DEPTH, ascending;
 * computed-ratings.mjs referenceOf) by their mid-rank (ratingsOf). With `schools` (a rebuilt season's: the number of its
 * FBS schools) each position is read as if every school carried DEPTH players there, those the rebuild cannot name
 * ranking below all it can: a rebuilt roster lacks most of a school's walk-ons and backups (in 2004 it fills about half
 * of the line's and the secondary's places, against 75–99% from a 2009 roster), and read among themselves its players
 * would rate as far below their peers of other seasons as their depth is thinner. → the rated players (`rating`, `rank`
 * 1 = the best), each school's in best-first order, and the population size at each position.
 */
export function rateSeason(players, reference, ratingsOf, { schools = null } = {}) {
  const rated = [], population = {};
  for (const position of POSITIONS) {
    const bySchool = new Map();
    for (const p of players.filter(q => q.position === position)) {
      if (!bySchool.has(p.school)) bySchool.set(p.school, []);
      bySchool.get(p.school).push(p);
    }
    const chosen = [...bySchool.values()].flatMap(list => list.sort(bestFirst).slice(0, DEPTH[position]));
    population[position] = chosen.length;
    if (!chosen.length) continue;
    const ratings = ratingsOf(chosen.map(p => p.value), reference[position],
      schools == null ? {} : { population: Math.max(chosen.length, schools * DEPTH[position]) });
    const order = chosen.slice().sort(bestFirst);
    order.forEach((p, i) => { p.rank = i + 1; p.rating = ratings.get(p.value); });
    rated.push(...chosen);
  }
  return { rated, population };
}

// ---------- conferences the season's games leave loose ----------

/**
 * How far, in points², a conference's true level strays from the mean of its levels in the seasons either side: the
 * mean square of each conference's SRS level less the mean of its two neighbours', 9.75 over the 173 conference-seasons
 * of 2005–2024 that have both neighbours (2019–2021 left out), less the 7.25 the levels' own errors give it (their SEs
 * from each season's SRS: SE² + (SE₋² + SE₊²)/4). Measured 2026-11-21 (docs/design/college-football.md, "Conferences
 * the games leave loose"); scripts/cfb-seasons.test.mjs measures it again from the snapshots' games.
 */
export const CONFERENCE_DRIFT = 2.5;

/**
 * The conferences a season's games leave loose: those whose schools met another conference's (or an independent) fewer
 * times than the conference has schools, so that most of them never did and its level against the rest of the FBS rests
 * on a few games. 2020 alone: the SEC, the Big Ten and the MAC played their conferences only until the bowls. `games`:
 * `[{ home, away }]` (every game between FBS schools the SRS reads); `conferenceOf(school)`: its conference that season.
 * Independents are no conference. → `[{ conference, schools, games }]`, sorted by conference.
 */
export function looseConferences(games, conferenceOf) {
  const schools = new Map(), out = new Map();
  for (const g of games) {
    const a = conferenceOf(g.home), b = conferenceOf(g.away);
    for (const [school, own] of [[g.home, a], [g.away, b]]) {
      if (!own || own === 'Independent') continue;
      if (!schools.has(own)) schools.set(own, new Set());
      schools.get(own).add(school);
    }
    if (a === b && a !== 'Independent') continue;
    for (const own of new Set([a, b])) if (own && own !== 'Independent') out.set(own, (out.get(own) ?? 0) + 1);
  }
  return [...schools].map(([conference, set]) => ({ conference, schools: [...set].sort(), games: out.get(conference) ?? 0 }))
    .filter(entry => entry.games < entry.schools.length).sort((a, b) => (a.conference < b.conference ? -1 : 1));
}

/**
 * The Simple Rating System of computed-ratings.mjs srsOf (every margin by least squares, one home edge, the ratings summing
 * to nought), with `priors`, `[{ members, level, weight }]`: each adds weight × (its members' mean rating − level)² to the
 * squares, one more observation of a group's level, as precise as `weight` games. `sigma2`, the margins' variance about
 * the fit, sets the error the reliability counts; by default the fit's own residuals'. Without priors the ratings, edge,
 * sigma and reliability are srsOf's. → `{ ratings, homeEdge, sigma, reliability, levelOf(members) → { level, se } }`, a
 * group's mean rating and its standard error.
 */
export function srsWithPriors(games, priors = [], { sigma2: fixed = null } = {}) {
  const clubs = [...new Set(games.flatMap(game => [game.home, game.away]))].sort();
  const n = clubs.length, at = new Map(clubs.map((club, i) => [club, i]));
  const hasHome = games.some(game => !game.neutral);
  const size = n + 2;
  const m = Array.from({ length: size }, () => new Array(size).fill(0));
  const rhs = new Array(size).fill(0);
  for (const game of games) {
    const row = new Array(n + 1).fill(0);
    row[at.get(game.home)] += 1;
    row[at.get(game.away)] -= 1;
    row[n] = game.neutral ? 0 : 1;
    const margin = game.homeScore - game.awayScore;
    for (let i = 0; i <= n; i++) {
      if (!row[i]) continue;
      for (let j = 0; j <= n; j++) m[i][j] += row[i] * row[j];
      rhs[i] += row[i] * margin;
    }
  }
  for (const prior of priors) {
    const index = prior.members.map(club => at.get(club));
    if (index.some(i => i == null)) throw new Error('A prior names a club with no game');
    const k = index.length;
    for (const i of index) {
      for (const j of index) m[i][j] += prior.weight / (k * k);
      rhs[i] += prior.weight * prior.level / k;
    }
  }
  if (!hasHome) m[n][n] = 1;
  for (let i = 0; i < n; i++) { m[i][n + 1] = 1; m[n + 1][i] = 1; }
  const a = m.map((row, i) => [...row, ...Array.from({ length: size }, (_, j) => (i === j ? 1 : 0))]);
  for (let col = 0; col < size; col++) {
    let pivot = col;
    for (let r = col + 1; r < size; r++) if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r;
    if (Math.abs(a[pivot][col]) < 1e-12) throw new Error('The games do not rate every club');
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
  const rating = clubs.map((club, i) => solution[i]), edge = hasHome ? solution[n] : 0;
  const residuals = games.map(game => game.homeScore - game.awayScore
    - (rating[at.get(game.home)] - rating[at.get(game.away)] + (game.neutral ? 0 : edge)));
  const fitted = n + (hasHome ? 1 : 0) - 1;
  const sigma2 = fixed ?? residuals.reduce((sum, r) => sum + r * r, 0) / Math.max(1, games.length - fitted);
  const error = sigma2 * clubs.reduce((sum, club, i) => sum + inverse[i][i], 0) / n;
  const spread = rating.reduce((sum, r) => sum + r * r, 0) / n;
  const levelOf = members => {
    const index = members.map(club => at.get(club)).filter(i => i != null);
    if (!index.length) throw new Error('A group with no rated club');
    let cov = 0;
    for (const i of index) for (const j of index) cov += inverse[i][j];
    return { level: index.reduce((sum, i) => sum + rating[i], 0) / index.length, se: Math.sqrt(sigma2 * cov / index.length ** 2) };
  };
  return {
    ratings: Object.fromEntries(clubs.map((club, i) => [club, rating[i]])),
    homeEdge: edge, sigma: Math.sqrt(sigma2), reliability: spread > 0 ? Math.max(0, 1 - error / spread) : 0, levelOf,
  };
}

/**
 * A season's SRS where its games leave conferences loose (looseConferences): each such conference's level held toward
 * its level in the seasons either side, as one more observation of it (srsWithPriors): their mean, with the variance
 * CONFERENCE_DRIFT + (SE₋² + SE₊²)/4, as precise as the season's margins' variance ÷ that variance games. Every other
 * school's rating comes from the games alone, as srsOf's would. `games` the season's, `conferenceOf` its; `neighbours`:
 * `[{ games, conferenceOf }]` of the season before and the one after. Throws for a loose conference either neighbour
 * lacks: nothing would place it. → `{ srs, loose: [{ conference, schools, games, alone: { level, se }, neighbours: { level,
 * se }, weight, held: { level, se } }] }`, `srs` as srsWithPriors gives it, its sigma the games' own without priors.
 */
export function srsHoldingLooseConferences(games, conferenceOf, neighbours) {
  const loose = looseConferences(games, conferenceOf);
  const alone = srsWithPriors(games);
  if (!loose.length) return { srs: alone, loose: [] };
  if (neighbours.length !== 2) throw new Error(`${loose.map(entry => entry.conference).join(', ')}: a loose conference needs a season either side`);
  const sigma2 = alone.sigma ** 2;
  const fits = neighbours.map(nb => ({ fit: srsWithPriors(nb.games), conferenceOf: nb.conferenceOf,
    clubs: [...new Set(nb.games.flatMap(game => [game.home, game.away]))] }));
  const priors = loose.map(entry => {
    const levels = fits.map(nb => {
      const members = nb.clubs.filter(club => nb.conferenceOf(club) === entry.conference);
      if (!members.length) throw new Error(`The ${entry.conference} met other conferences ${entry.games} times and a season either side has no ${entry.conference} to place it by`);
      return nb.fit.levelOf(members);
    });
    const level = (levels[0].level + levels[1].level) / 2, variance = CONFERENCE_DRIFT + (levels[0].se ** 2 + levels[1].se ** 2) / 4;
    return { entry, members: entry.schools, level, weight: sigma2 / variance, neighbours: { level, se: Math.sqrt(variance) } };
  });
  const srs = srsWithPriors(games, priors, { sigma2 });
  return {
    srs,
    loose: priors.map(p => ({ conference: p.entry.conference, schools: p.entry.schools.length, games: p.entry.games, alone: alone.levelOf(p.members),
      neighbours: p.neighbours, weight: p.weight, held: srs.levelOf(p.members) })),
  };
}
