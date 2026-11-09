// The statistics behind ice hockey's computed seasons (docs/design/hockey.md, "Computed seasons"): the Hockey Databank
// (1909/10–2017/18, its own terms: free use with its attribution statement) and MoneyPuck.com's season and game data
// (2008/09 on, free for non-commercial use with credit). Parsers, each season's players and their lines, and the league
// figures the rule compares them with. No I/O here: scripts/sync-nhl-seasons.mjs reads the pinned downloads.
import { parseCsv } from './football-data.mjs';
import { clubOfStints, windowOf } from './nhl-computed.mjs';

/** A CSV with a header row as objects, every value a string (the project's parser: quoted fields allowed). */
export function csvRecords(text) {
  const [head, ...rows] = parseCsv(text);
  const names = head.map(h => h.trim());
  return rows.filter(row => row.length > 1 || row[0]).map(row => Object.fromEntries(names.map((name, i) => [name, row[i] ?? ''])));
}

/** A plain CSV (no quoted fields: MoneyPuck's game-by-game files) as objects of `columns` only, quickly. */
export function plainCsvColumns(text, columns) {
  if (text.includes('"')) return csvRecords(text).map(row => Object.fromEntries(columns.map(c => [c, row[c]])));
  const lines = text.split('\n');
  const head = lines[0].replace(/\r$/, '').split(',');
  const at = columns.map(c => {
    const i = head.indexOf(c);
    if (i < 0) throw new Error(`The CSV has no column ${c}`);
    return i;
  });
  const out = [];
  for (let k = 1; k < lines.length; k++) {
    const line = lines[k].replace(/\r$/, '');
    if (!line) continue;
    const cells = line.split(',');
    out.push(Object.fromEntries(columns.map((c, j) => [c, cells[at[j]]])));
  }
  return out;
}

const int = (value, where) => {
  const n = Number(value);
  if (value === '' || value == null || !Number.isFinite(n)) throw new Error(`${where}: ${JSON.stringify(value)} is not a number`);
  return n;
};

// ---------- the Hockey Databank ----------

/**
 * The Hockey Databank's team ids that differ from the NHL codes the earlier seasons use (scripts/data/nhl-seasons.json
 * `teams`), and the old clubs' codes from Wikipedia's list of NHL team abbreviations (WikiProject Ice Hockey).
 */
export const HDB_CODES = Object.freeze({
  AND: 'ANA', ATF: 'AFM', CAL: 'CGY', CBS: 'CBJ', CLF: 'CGS', COR: 'CLR', FLO: 'FLA', HAR: 'HFD', NAS: 'NSH', PHO: 'PHX',
  VEG: 'VGK', WAS: 'WSH',
});
const hdbCode = tmID => HDB_CODES[tmID] ?? tmID;
const HDB_POSITION = { C: 'C', L: 'LW', R: 'RW', D: 'D', G: 'G', F: 'C', W: 'LW' };
/** A Hockey Databank position ('C', 'L/C', 'D'…) as the game's: its first letter's. */
export const hdbPosition = pos => HDB_POSITION[String(pos).trim()[0]] ?? null;

/**
 * The Hockey Databank's birth countries as ISO 3166 alpha-3. A birth in the USSR, Czechoslovakia or Yugoslavia counts for
 * the country its birth city is in today (HDB_BIRTH_CITIES), as the earlier seasons count the NHL's birth countries.
 */
export const HDB_COUNTRIES = Object.freeze({
  Austria: 'AUT', Belarus: 'BLR', Belgium: 'BEL', Brazil: 'BRA', 'Brunei Darussalam': 'BRN', Bulgaria: 'BGR', Canada: 'CAN',
  Croatia: 'HRV', 'Czech Republic': 'CZE', Denmark: 'DNK', England: 'GBR', Finland: 'FIN', France: 'FRA', Germany: 'DEU',
  Haiti: 'HTI', Indonesia: 'IDN', Ireland: 'IRL', Italy: 'ITA', Jamaica: 'JAM', Japan: 'JPN', Kazakhstan: 'KAZ', Korea: 'KOR',
  Latvia: 'LVA', Lebanon: 'LBN', Lithuania: 'LTU', Netherlands: 'NLD', Nigeria: 'NGA', Norway: 'NOR', Paraguay: 'PRY',
  Poland: 'POL', Russia: 'RUS', 'Russian Federation': 'RUS', Scotland: 'GBR', Slovakia: 'SVK', Slovenia: 'SVN',
  'South Africa': 'ZAF', 'South Korea': 'KOR', Sweden: 'SWE', Switzerland: 'CHE', Taiwan: 'TWN', Tanzania: 'TZA', Ukraine: 'UKR',
  'United Kingdom': 'GBR', USA: 'USA', Venezuela: 'VEN', Wales: 'GBR',
});
/** The birth cities of the Hockey Databank's USSR, Czechoslovakia and Yugoslavia births, by the country they are in today. */
export const HDB_BIRTH_CITIES = Object.freeze({
  USSR: { Angarsk: 'RUS', Chelyabinsk: 'RUS', Cherepovets: 'RUS', Gorky: 'RUS', Kharkov: 'UKR', Komsomolsk: 'RUS', Korkino: 'RUS',
    Moscow: 'RUS', Murmansk: 'RUS', Narva: 'EST', Novokuznetsk: 'RUS', Omsk: 'RUS', Riga: 'LVA', Ryazan: 'RUS', Saratov: 'RUS',
    Togliatti: 'RUS', Tomsk: 'RUS', Voskresensk: 'RUS', Yaroslavl: 'RUS' },
  Czechoslovakia: { Budejovice: 'CZE', 'Frydek-Mistek': 'CZE', Hodonin: 'CZE', Jihlava: 'CZE', Kosice: 'SVK', Martin: 'SVK',
    Ostrava: 'CZE', Pardubice: 'CZE', Pilsen: 'CZE', Pisek: 'CZE', Plzen: 'CZE', Praha: 'CZE', Prague: 'CZE', Prerov: 'CZE',
    Topolcany: 'SVK', Zilina: 'SVK', Zlin: 'CZE' },
  Yugoslavia: { Maribor: 'SVN', Zranjanin: 'SRB' },
});
/**
 * The birth cities the Hockey Databank files under a country they are not in today, by that country: Slovak cities under
 * the Czech Republic and Czech ones under Slovakia, Sverdlovsk (Yekaterinburg) under Ukraine, Kharkiv, Pavlodar and Vost
 * under Russia, Naliboki under Poland. The city decides, as for the dissolved states.
 */
export const HDB_MISFILED_CITIES = Object.freeze({
  'Czech Republic': { 'Banska Bystrica': 'SVK', Bratislava: 'SVK', Bystrica: 'SVK', Ilava: 'SVK', 'Liptovsky Mikulas': 'SVK', Martin: 'SVK',
    Michalovce: 'SVK', Poprad: 'SVK', Sokolce: 'SVK', Topolcany: 'SVK', Trencin: 'SVK', Zvolen: 'SVK' },
  Slovakia: { 'Ceske Budejovice': 'CZE', 'Havlickuv Brod': 'CZE' },
  Ukraine: { Sverdlovsk: 'RUS' },
  Russia: { Kharkov: 'UKR', Pavlodor: 'KAZ', Vost: 'KAZ' },
  Poland: { Naliboki: 'BLR' },
});
/** A Hockey Databank Master row's birth country as ISO 3166 alpha-3, or null where it gives none. */
export function hdbBirthCountry(master) {
  const country = master.birthCountry;
  if (!country) return null;
  if (HDB_BIRTH_CITIES[country]) {
    const code = HDB_BIRTH_CITIES[country][master.birthCity];
    if (!code) throw new Error(`No country today for ${master.firstName} ${master.lastName}'s birth city ${master.birthCity} (${country})`);
    return code;
  }
  const moved = HDB_MISFILED_CITIES[country]?.[master.birthCity];
  if (moved) return moved;
  const code = HDB_COUNTRIES[country];
  if (!code) throw new Error(`No code for the Hockey Databank's birth country ${JSON.stringify(country)} (${master.playerID})`);
  return code;
}

/** The tables the seasons read: `{ master: Map id → row, scoring: rows, goalies: rows }`, the NHL's rows only. */
export function hockeyDatabank({ master, scoring, goalies }) {
  return {
    master: new Map(csvRecords(master).map(row => [row.playerID, row])),
    scoring: csvRecords(scoring).filter(row => row.lgID === 'NHL'),
    goalies: csvRecords(goalies).filter(row => row.lgID === 'NHL'),
  };
}

/**
 * One Hockey Databank season, by the year it ends: `{ skaters, goalies, league }`. A skater `{ id, games, points, stints,
 * pos }` (stints `[code, games]` in his order of appearance; pos the position of his longest stint), a goalie `{ id, games,
 * seconds, goals, shots, stints }` (shots null where any of his stints has none); the league `{ savePct, gaa, maxGames }`:
 * save percentage over the stints with shots against (null before 1982/83, when none were kept), goals against per 60
 * minutes, and the most games any skater played.
 */
export function hdbSeason(db, year) {
  const hdbYear = String(year - 1);
  const skaters = new Map(), goalies = new Map();
  const ordered = rows => rows.filter(row => row.year === hdbYear).sort((a, b) => Number(a.stint) - Number(b.stint));
  for (const row of ordered(db.scoring)) {
    if (row.pos === 'G' || row.GP === '') continue;
    const where = `Scoring ${row.playerID} ${row.year}`;
    const e = skaters.get(row.playerID) ?? { id: row.playerID, games: 0, points: 0, stints: [], positions: [] };
    e.games += int(row.GP, where);
    e.points += int(row.Pts, where);
    e.stints.push([hdbCode(row.tmID), int(row.GP, where)]);
    e.positions.push([hdbPosition(row.pos), int(row.GP, where)]);
    skaters.set(row.playerID, e);
  }
  let shots = 0, saved = 0, goals = 0, seconds = 0;
  for (const row of ordered(db.goalies)) {
    const where = `Goalies ${row.playerID} ${row.year}`;
    const e = goalies.get(row.playerID) ?? { id: row.playerID, games: 0, seconds: 0, goals: 0, shots: 0, stints: [], noShots: false };
    const gp = row.GP === '' ? 0 : int(row.GP, where);
    e.games += gp;
    e.seconds += int(row.Min || '0', where) * 60;
    e.goals += int(row.GA || '0', where);
    if (row.SA === '') e.noShots = true;
    else { e.shots += int(row.SA, where); shots += int(row.SA, where); saved += int(row.SA, where) - int(row.GA || '0', where); }
    e.stints.push([hdbCode(row.tmID), gp]);
    goalies.set(row.playerID, e);
    goals += int(row.GA || '0', where);
    seconds += int(row.Min || '0', where) * 60;
  }
  for (const e of skaters.values()) {
    // His position: that of the stint he played most games in (the first such).
    e.pos = e.positions.reduce((best, p) => (!best || p[1] > best[1] ? p : best), null)[0];
    delete e.positions;
  }
  for (const e of goalies.values()) { if (e.noShots) e.shots = null; delete e.noShots; }
  const maxGames = Math.max(...[...skaters.values()].map(e => e.games));
  const league = { savePct: shots ? saved / shots : null, gaa: goals / seconds * 3600, maxGames };
  return { skaters, goalies, league };
}

// ---------- MoneyPuck ----------

/** MoneyPuck's team codes that differ from the NHL's; it codes the Phoenix Coyotes (to 2013/14) as the Arizona Coyotes. */
export const MONEYPUCK_CODES = Object.freeze({ 'L.A': 'LAK', 'N.J': 'NJD', 'S.J': 'SJS', 'T.B': 'TBL' });
const mpCode = (team, year) => (team === 'ARI' && year <= 2014 ? 'PHX' : MONEYPUCK_CODES[team] ?? team);
const MP_POSITION = { C: 'C', L: 'LW', R: 'RW', D: 'D', G: 'G' };
/** The nationality codes MoneyPuck's lookup writes the IOC's way, as ISO 3166 alpha-3. */
export const MONEYPUCK_NATIONALITIES = Object.freeze({ DEN: 'DNK', GER: 'DEU', LAT: 'LVA', NED: 'NLD', RSA: 'ZAF', SLO: 'SVN', SUI: 'CHE' });

/**
 * One MoneyPuck season ending in `year`, from its season summaries (situation 'all'): `{ skaters, goalies, league }`.
 * A skater `{ id, name, pos, games, points, seconds, team }`, a goalie `{ id, name, pos, games, seconds, goals, shots,
 * team }` (shots: shots on goal faced; team: the last he played for); the league `{ savePct, gaa, maxGames }`.
 */
export function moneypuckSeason(skatersCsv, goaliesCsv, year) {
  const skaters = new Map(), goalies = new Map();
  for (const row of csvRecords(skatersCsv)) {
    if (row.situation !== 'all') continue;
    const where = `MoneyPuck skater ${row.playerId} ${row.season}`;
    const pos = MP_POSITION[row.position];
    if (!pos || pos === 'G') throw new Error(`${where}: position ${row.position}`);
    skaters.set(Number(row.playerId), { id: Number(row.playerId), name: row.name.trim(), pos, games: int(row.games_played, where),
      points: int(row.I_F_points, where), seconds: Math.round(int(row.icetime, where)), team: mpCode(row.team, year) });
  }
  let shots = 0, goals = 0, seconds = 0;
  for (const row of csvRecords(goaliesCsv)) {
    if (row.situation !== 'all') continue;
    const where = `MoneyPuck goalie ${row.playerId} ${row.season}`;
    const e = { id: Number(row.playerId), name: row.name.trim(), pos: 'G', games: int(row.games_played, where), seconds: Math.round(int(row.icetime, where)),
      goals: int(row.goals, where), shots: int(row.ongoal, where), team: mpCode(row.team, year) };
    goalies.set(e.id, e);
    shots += e.shots; goals += e.goals; seconds += e.seconds;
  }
  const maxGames = Math.max(...[...skaters.values()].map(e => e.games));
  return { skaters, goalies, league: { savePct: (shots - goals) / shots, gaa: goals / seconds * 3600, maxGames } };
}

/**
 * Each player's regular-season games per club from MoneyPuck's game-by-game rows of the season ending in `year` (situation 'all'; a regular-season game
 * id has 02 after the year): Map id → stints `[code, games]` in the order he first played for each club.
 */
export function moneypuckStints(rows, year) {
  const games = new Map();
  const sorted = rows.filter(row => row.situation === 'all' && /^\d{4}02\d{4}$/.test(row.gameId))
    .sort((a, b) => Number(a.gameDate) - Number(b.gameDate) || Number(a.gameId) - Number(b.gameId));
  for (const row of sorted) {
    const id = Number(row.playerId);
    if (!games.has(id)) games.set(id, new Map());
    const byClub = games.get(id), code = mpCode(row.playerTeam, year);
    byClub.set(code, (byClub.get(code) ?? 0) + 1);
  }
  return new Map([...games].map(([id, byClub]) => [id, [...byClub]]));
}

/** MoneyPuck's player lookup: Map NHL id → `{ name, nationality (ISO 3166 alpha-3) or null, birthDate }`. */
export function moneypuckLookup(text) {
  return new Map(csvRecords(text).map(row => {
    const code = row.nationality.trim();
    return [Number(row.playerId), { name: row.name.trim(), nationality: code ? (MONEYPUCK_NATIONALITIES[code] ?? code) : null, birthDate: row.birthDate || null }];
  }));
}

// ---------- a season's players ----------

/**
 * The players of the computed season ending in `year`, from `seasons` (Map year → the source's season for each year of
 * its window, as hdbSeason or moneypuckSeason returns them): everyone who played in it, each `[key, name, club, pos,
 * born, lines]` — his club the one he played most games for (`clubOf(player)`), his lines `[season, games, points,
 * seconds|null]` (a skater) or `[season, games, seconds, goals, shots|null]` (a goalie) for the window's seasons he
 * played. Also returns the window's league figures and the players left out, with why.
 */
export function seasonPlayers(year, seasons, { nameOf, bornOf, clubOf, posOf = p => p.pos, timeOnIce }) {
  const window = windowOf(year);
  const current = seasons.get(year);
  const players = [], left = [];
  const lineOf = (season, key, goalie) => {
    const e = (goalie ? seasons.get(season).goalies : seasons.get(season).skaters).get(key);
    if (!e || e.games === 0) return null;
    return goalie ? [season, e.games, e.seconds, e.goals, e.shots] : [season, e.games, e.points, timeOnIce ? e.seconds : null];
  };
  for (const goalie of [false, true]) {
    for (const [key, e] of goalie ? current.goalies : current.skaters) {
      if (e.games === 0) continue;
      // A skater who also kept goal that season is a goalie (and the other way round): the role of more games.
      const other = (goalie ? current.skaters : current.goalies).get(key);
      if (other && other.games > e.games) continue;
      if (other && other.games === e.games && goalie) continue;
      const pos = goalie ? 'G' : posOf(e);
      const name = nameOf(key, e);
      const club = clubOf(key, e);
      if (!pos) { left.push([name, club ?? '', 'no position']); continue; }
      if (!club) { left.push([name, '', 'no club']); continue; }
      const lines = window.map(season => lineOf(season, key, goalie)).filter(Boolean);
      players.push([key, name, club, pos, bornOf(key, e), lines]);
    }
  }
  const leagues = Object.fromEntries(window.map(season => [season, seasons.get(season).league]));
  return { players, left, leagues };
}

/** The Hockey Databank's name of a player: first and last name as its Master table gives them. */
export const hdbName = master => `${master.firstName} ${master.lastName}`.trim();

/** clubOfStints, for the sources' stints. */
export { clubOfStints };
