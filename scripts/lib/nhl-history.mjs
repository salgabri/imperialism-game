// The snapshots of ice hockey's computed and converted seasons (docs/design/hockey.md, "Computed seasons", "NHL 08 and
// NHL 09"), and the calibration fixture: assembled from the pinned downloads that scripts/sync-nhl-seasons.mjs reads
// (`io.text(file)`, `io.buffer(file)`). No other I/O here.
import { strFromU8, unzipSync } from 'fflate';
import { attributeMean, clubOfStints, groupOf, lagWindowOf, windowOf } from './nhl-computed.mjs';
import { COUNTRY_CODE, IGN08_POSITION, findPlayer, norm, parseIgnAttributes, teamsOf } from './nhl-seasons.mjs';
import {
  hdbBirthCountry, hdbName, hdbPosition, hdbSeason, hdbTeamRecords, hockeyDatabank, moneypuckGameScores, moneypuckLookup,
  moneypuckSeason, moneypuckStints, plainCsvColumns, seasonPlayers,
} from './nhl-stats.mjs';

const memo = new Map();
const once = (key, make) => {
  if (!memo.has(key)) memo.set(key, make());
  return memo.get(key);
};

/** The Hockey Databank's tables (scripts/data/nhl-seasons-sources.json `hockey-databank/*`). */
const databank = io => once('hdb', async () => hockeyDatabank({
  master: await io.text('hockey-databank/Master.csv'), scoring: await io.text('hockey-databank/Scoring.csv'),
  goalies: await io.text('hockey-databank/Goalies.csv'),
}));
/** MoneyPuck's season ending in `year` (its files name the year it starts). */
const moneypuck = (io, year) => once(`mp-${year}`, async () => moneypuckSeason(await io.text(`moneypuck/${year - 1}-skaters.csv`),
  await io.text(`moneypuck/${year - 1}-goalies.csv`), year));
const lookup = io => once('mp-lookup', async () => moneypuckLookup(await io.text('moneypuck/allPlayersLookup.csv')));

/**
 * MoneyPuck's game-by-game files of the season ending in `year`: each player's games per club (`stints`), and every game's
 * score from its skaters' goals (`scores`, moneypuckGameScores).
 */
async function moneypuckGames(io, year) {
  const rows = [], skaterRows = [];
  for (const kind of ['skaters', 'goalies']) {
    const files = unzipSync(new Uint8Array(await io.buffer(`moneypuck-games/${kind}-${year - 1}.zip`)));
    const names = Object.keys(files).filter(name => name.endsWith('.csv'));
    if (names.length !== 1) throw new Error(`moneypuck-games/${kind}-${year - 1}.zip holds ${names.length} CSV files`);
    const columns = ['playerId', 'gameId', 'gameDate', 'playerTeam', 'situation', ...(kind === 'skaters' ? ['opposingTeam', 'home_or_away', 'I_F_goals'] : [])];
    for (const row of plainCsvColumns(strFromU8(files[names[0]]), columns)) {
      if (row.situation !== 'all') continue;
      rows.push(row);
      if (kind === 'skaters') skaterRows.push(row);
    }
  }
  return { stints: moneypuckStints(rows, year), scores: moneypuckGameScores(skaterRows, year) };
}

/** The Hockey Databank's Teams.csv, as text (read once). */
const databankTeams = io => once('hdb-teams', () => io.text('hockey-databank/Teams.csv'));

/**
 * Two players of a season who share a name are told apart by their birth year, or their birth date where that is shared
 * too (else the source's key), as a squad may not name one player twice. `birthOf(key)` is 'YYYY-MM-DD' or null.
 */
function namesApart(players, birthOf) {
  const byName = new Map();
  for (const p of players) byName.set(p[1], [...(byName.get(p[1]) ?? []), p]);
  const renamed = [];
  for (const [name, list] of byName) {
    if (list.length < 2) continue;
    const years = list.map(p => birthOf(p[0])?.slice(0, 4) ?? null);
    const yearsApart = years.every(y => y) && new Set(years).size === years.length;
    list.forEach((p, i) => {
      const date = birthOf(p[0]);
      const tag = yearsApart ? years[i] : date ?? String(p[0]);
      p[1] = `${name} (${tag})`;
      renamed.push(`${name} (${p[2]}, ${p[3]}) as ${p[1]}`);
    });
  }
  const names = players.map(p => p[1]);
  if (new Set(names).size !== names.length) throw new Error('Two players share a name and a birth date');
  return renamed;
}
const isoDate = (year, month, day) => (year && month && day ? `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` : null);

/** Whether `short` is `long` with letters taken out (and nothing else changed). */
function lettersTakenOut(short, long) {
  let i = 0;
  for (const ch of long) {
    if (ch === short[i]) i++;
    else if (!/\p{L}/u.test(ch)) return false;
  }
  return i === short.length;
}

/**
 * A MoneyPuck player's name. MoneyPuck's files from its 2022/23 season on drop every letter of a name that is not plain
 * ASCII ('Tim Sttzle', 'Matj  Blmel'): a player scripts/data/nhl-seasons.json `computed.moneypuckNames` lists takes the
 * name it gives him, which must be MoneyPuck's with only letters put back. Any other name with a run of spaces is a
 * dropped letter the list does not know yet.
 */
function moneypuckName(key, raw, listed) {
  const name = raw.replace(/\s+/g, ' ');
  const fixed = listed[key];
  if (fixed == null) {
    if (name !== raw) throw new Error(`MoneyPuck names ${key} ${JSON.stringify(raw)}: a dropped letter? List him in computed.moneypuckNames`);
    return raw;
  }
  if (!lettersTakenOut(name, fixed)) {
    throw new Error(`computed.moneypuckNames names ${key} ${JSON.stringify(fixed)}, not MoneyPuck's ${JSON.stringify(raw)} with its letters put back`);
  }
  return fixed;
}

/**
 * A computed season's snapshot parts: `{ form, leagues, results, players, left, notes }` from the Hockey Databank
 * (`source.kind` 'hdb': no time on ice; goalies by save percentage once every season of the window kept shots against,
 * else by goals against) or MoneyPuck ('moneypuck': minutes and points a game, goalies by save percentage). `results`, the
 * season's real results its clubs are reconciled with (docs/design/computed-ratings.md, step 5): every club's record and
 * goals from the databank's Teams.csv (`clubs`, hdbTeamRecords), or every game's score from MoneyPuck's game files
 * (`games`, moneypuckGameScores).
 */
export async function assembleComputed(season, io, manifest) {
  const { year } = season;
  const seasons = new Map();
  let parts;
  if (season.source.kind === 'hdb') {
    // The databank's terms, from its readme: the attribution statement it asks for, word for word.
    await once('hdb-terms', async () => {
      const flat = s => s.replace(/\s+/g, ' ').trim();
      const statement = manifest.computed.sources.hdb.attribution;
      if (!flat(await io.text('hockey-databank/readme.txt')).includes(`"${flat(statement)}"`)) {
        throw new Error("The Hockey Databank's readme no longer asks for the attribution statement scripts/data/nhl-seasons.json gives");
      }
    });
    const db = await databank(io);
    for (const y of windowOf(year)) seasons.set(y, hdbSeason(db, y));
    const master = key => {
      const row = db.master.get(key);
      if (!row) throw new Error(`The Hockey Databank's Master table has no ${key}`);
      return row;
    };
    parts = seasonPlayers(year, seasons, {
      nameOf: key => hdbName(master(key)), bornOf: key => hdbBirthCountry(master(key)), clubOf: (key, e) => clubOfStints(e.stints),
      posOf: e => e.pos ?? hdbPosition(master(e.id).pos), timeOnIce: false,
    });
    parts.notes = { renamed: namesApart(parts.players, key => isoDate(master(key).birthYear, master(key).birthMon, master(key).birthDay)) };
    parts.form = { skaters: 'points', goalies: windowOf(year).every(y => seasons.get(y).league.savePct != null) ? 'saves' : 'goals' };
    parts.results = { source: "the Hockey Databank's Teams.csv", clubs: hdbTeamRecords(await databankTeams(io), year) };
  } else if (season.source.kind === 'moneypuck') {
    for (const y of windowOf(year)) seasons.set(y, await moneypuck(io, y));
    const played = await moneypuckGames(io, year);
    const clubs = played.stints;
    const people = await lookup(io);
    const fromSummary = [], fromDatabank = [], restored = [];
    // A name MoneyPuck dropped letters from, put back (moneypuckName).
    const listed = manifest.computed.moneypuckNames?.players ?? {};
    const nameOf = (key, e) => moneypuckName(key, e.name, listed);
    // A player MoneyPuck's lookup gives no nationality: the Hockey Databank's birth country, where exactly one of its
    // players of 2008/09 to 2017/18 has his name.
    const db = await databank(io);
    const namesake = await once('hdb-recent-names', async () => {
      const ids = new Set([...db.scoring, ...db.goalies].filter(row => Number(row.year) >= 2008).map(row => row.playerID));
      const byName = new Map();
      for (const id of ids) {
        const key = norm(hdbName(db.master.get(id)));
        byName.set(key, [...(byName.get(key) ?? []), id]);
      }
      return byName;
    });
    const bornOf = (key, e) => {
      const nationality = people.get(key)?.nationality;
      if (nationality) return nationality;
      const ids = namesake.get(norm(nameOf(key, e))) ?? [];
      if (ids.length !== 1) return null;
      const born = hdbBirthCountry(db.master.get(ids[0]));
      if (born) fromDatabank.push(`${nameOf(key, e)}: ${born}`);
      return born;
    };
    parts = seasonPlayers(year, seasons, {
      nameOf: (key, e) => {
        const name = nameOf(key, e);
        if (name !== e.name) restored.push(`${e.name} as ${name}`);
        return name;
      },
      bornOf,
      clubOf: (key, e) => {
        const stints = clubs.get(key);
        if (stints) return clubOfStints(stints);
        fromSummary.push(`${nameOf(key, e)} (${e.team})`);
        return e.team;
      },
      timeOnIce: true,
    });
    parts.notes = { renamed: namesApart(parts.players, key => people.get(key)?.birthDate || null),
      clubFromSummary: fromSummary, birthFromDatabank: fromDatabank, noNationality: parts.players.filter(p => p[4] == null).map(p => `${p[1]} (${p[2]})`),
      ...(restored.length ? { lettersPutBack: restored } : {}) };
    parts.form = { skaters: 'minutes', goalies: 'saves' };
    const { games, homeMended, oneSided } = played.scores;
    parts.results = { source: "MoneyPuck.com's game-by-game skater files", homeMended, oneSided, games };
  } else throw new Error(`${season.id}: no statistics source ${season.source.kind}`);
  const codes = new Set(teamsOf(manifest, year).map(team => team.code));
  const strays = [...new Set(parts.players.map(p => p[2]))].filter(code => !codes.has(code));
  if (strays.length) throw new Error(`${season.id}: players of clubs the season does not have: ${strays.join(', ')}`);
  // Every club of the season has its results, and no other club does.
  const { clubs: records, games } = parts.results;
  const resulted = records ? records.map(row => row[0]) : games.flatMap(game => [game[1], game[2]]);
  const unlike = [...codes].filter(code => !resulted.includes(code)).concat([...new Set(resulted)].filter(code => !codes.has(code)));
  if (unlike.length || (records && records.length !== codes.size)) {
    throw new Error(`${season.id}: the results' clubs are not the season's (${unlike.join(', ') || 'a club twice'})`);
  }
  return parts;
}

/**
 * A computed season's snapshot text: one line per player, its club's players together in the season's club order; one
 * line per club record, in that order, or per game.
 */
export function computedSnapshotText(season, manifest, { form, leagues, results, players, left, notes }) {
  const order = teamsOf(manifest, season.year).map(team => team.code);
  const sorted = players.slice().sort((a, b) => order.indexOf(a[2]) - order.indexOf(b[2]) || a[1].localeCompare(b[1]) || String(a[0]).localeCompare(String(b[0])));
  const leftSorted = left.slice().sort((a, b) => a[1].localeCompare(b[1]) || a[0].localeCompare(b[0]));
  const source = { id: season.id, method: 'computed', kind: season.source.kind, retrieved: season.retrieved };
  const key = results.clubs ? 'clubs' : 'games';
  const rows = results.clubs ? results.clubs.slice().sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0])) : results.games;
  const head = Object.entries(results).filter(([name]) => name !== key).map(([name, value]) => `${JSON.stringify(name)}: ${JSON.stringify(value)}, `).join('');
  return `{\n"source": ${JSON.stringify(source)},\n"form": ${JSON.stringify(form)},\n"leagues": ${JSON.stringify(leagues)},\n`
    + `"results": {${head}"${key}": [\n${rows.map(row => JSON.stringify(row)).join(',\n')}\n]},\n"notes": ${JSON.stringify(notes)},\n`
    + `"left": [\n${leftSorted.map(row => JSON.stringify(row)).join(',\n')}\n],\n"players": [\n${sorted.map(row => JSON.stringify(row)).join(',\n')}\n]\n}\n`;
}

// ---------- NHL 08 and NHL 09 ----------

/** IGN's NHL 08 pages and their pinned country names: a row's EA country as ISO 3166 alpha-3, or null (with why). */
function eaCountry(row, notes) {
  const country = row.fields.Country;
  const code = COUNTRY_CODE[country];
  if (code) return code;
  notes.push(`${row.name}: EA's Country reads ${JSON.stringify(country)}`);
  return null;
}

/**
 * A converted season's snapshot parts from IGN's team pages (`season.files.teams`, code → page) of NHL 08 (positions and
 * EA's country on the page) or NHL 09 (attributes only: positions from the Hockey Databank's 2008/09 season, else NHL 08's
 * page; countries from NHL 08's pages, else the Hockey Databank's birth country). Each player `[name, club, pos, born,
 * values]`, `values` his skill attributes in `season.source.attributes` order; a row with a value outside 0–99 is left out.
 */
export async function assembleConverted(season, io) {
  const { attributes, kind } = season.source;
  const players = [], left = [], notes = { country: [], position: [] };
  const rows = [];
  for (const [code, file] of Object.entries(season.files.teams)) {
    for (const row of parseIgnAttributes(await io.text(file, 'latin1'))) rows.push({ ...row, team: code });
  }
  let nhl08 = null, db = null, hdb2009 = null;
  if (kind === 'nhl09') {
    nhl08 = [];
    for (const file of season.files.positions) for (const row of parseIgnAttributes(await io.text(file, 'latin1'))) nhl08.push(row);
    db = await databank(io);
    hdb2009 = hdbSeason(db, 2009);
  }
  // The NHL 09 players the Hockey Databank names in 2008/09 (else in the seasons beside it), found as the earlier seasons
  // find the NHL's (scripts/lib/nhl-seasons.mjs findPlayer): his club first, a namesake never taken twice.
  const league = kind === 'nhl09' ? hdbLeague(db, hdb2009) : null;
  const found = new Map();
  if (league) {
    const taken = new Set();
    for (const onTeamOnly of [true, false]) {
      for (const row of rows) {
        if (found.has(row)) continue;
        const hit = findPlayer(league, { name: row.name, team: row.team, group: row.table === 'goalie' ? 'G' : undefined }, season.source.aliases ?? {}, { taken, onTeamOnly });
        if (hit) { found.set(row, hit); taken.add(hit.player.id); }
      }
    }
  }
  for (const row of rows) {
    const list = attributes[row.table];
    const missing = list.filter(name => !(name in row.fields));
    if (missing.length) throw new Error(`${row.name} (${row.team}): IGN's page has no ${missing.join(', ')}`);
    const values = list.map(name => Number(row.fields[name]));
    if (attributeMean(values) === null) {
      left.push([row.name, row.team, `an attribute outside 0-99 (${list.filter((name, i) => !(values[i] >= 0 && values[i] <= 99)).map(name => `${name} ${row.fields[name]}`).join(', ')})`]);
      continue;
    }
    let pos, born;
    if (kind === 'nhl08') {
      pos = IGN08_POSITION[row.fields.Position];
      if (!pos) throw new Error(`${row.name}: IGN's position ${row.fields.Position}`);
      born = eaCountry(row, notes.country);
      if (!born) {
        const hit = hdbPerson(db ?? (db = await databank(io)), row.name);
        born = hit ? hdbBirthCountry(hit) : null;
        notes.country.push(`${row.name}: the Hockey Databank's birth country ${born}`);
      }
    } else {
      const hit = found.get(row) ?? null;
      const ea = nhl08.filter(r => norm(r.name) === norm(row.name) && (r.table === 'goalie') === (row.table === 'goalie'));
      const eaRow = ea.length === 1 ? ea[0] : null;
      pos = row.table === 'goalie' ? 'G' : hit?.player.pos ?? (eaRow ? IGN08_POSITION[eaRow.fields.Position] : null);
      if (row.table !== 'goalie' && !hit && eaRow) notes.position.push(`${row.name} (${row.team}): NHL 08's position ${pos}`);
      if (!pos || (row.table !== 'goalie' && pos === 'G')) { left.push([row.name, row.team, 'no position: on no Hockey Databank roster of 2007/08 to 2009/10 and not in NHL 08']); continue; }
      born = eaRow ? eaCountry(eaRow, notes.country) : null;
      if (!born && hit) born = hdbBirthCountry(db.master.get(hit.player.id));
      if (!born) notes.country.push(`${row.name} (${row.team}): no country`);
      if (hit && hit.how !== 'name') notes.position.push(`${row.name} (${row.team}) = ${hit.player.name}: ${hit.how}`);
    }
    players.push([row.name, row.team, pos, born, values]);
  }
  return { players, left, notes };
}

/** The Hockey Databank's players of 2008/09, then of 2007/08 and 2009/10, as findPlayer's league: `{ id, name, last, pos, team }`. */
function hdbLeague(db, current) {
  const out = [];
  const add = (season, label) => {
    for (const [id, e] of season.skaters) {
      const m = db.master.get(id);
      out.push({ id, name: hdbName(m), last: m.lastName, pos: e.pos ?? hdbPosition(m.pos), team: clubOfStints(e.stints), season: label });
    }
    for (const [id, e] of season.goalies) {
      const m = db.master.get(id);
      out.push({ id, name: hdbName(m), last: m.lastName, pos: 'G', team: clubOfStints(e.stints), season: label });
    }
  };
  add(current, 2009);
  const ids = new Set(out.map(p => p.id));
  for (const year of [2008, 2010]) {
    const before = out.length;
    add(hdbSeason(db, year), year);
    // Only players not already there: a player's 2008/09 line comes first.
    for (let i = out.length - 1; i >= before; i--) if (ids.has(out[i].id)) out.splice(i, 1);
    for (const p of out.slice(before)) ids.add(p.id);
  }
  return out;
}

/** The Hockey Databank's one player of a name, or null. */
function hdbPerson(db, name) {
  const hits = [...db.master.values()].filter(m => norm(hdbName(m)) === norm(name) && Number(m.lastNHL) >= 2005);
  return hits.length === 1 ? hits[0] : null;
}

/** A converted season's snapshot text. */
export function convertedSnapshotText(season, manifest, { players, left, notes }) {
  const order = teamsOf(manifest, season.year).map(team => team.code);
  const sorted = players.slice().sort((a, b) => order.indexOf(a[1]) - order.indexOf(b[1]) || a[0].localeCompare(b[0]));
  const leftSorted = left.slice().sort((a, b) => a[1].localeCompare(b[1]) || a[0].localeCompare(b[0]));
  const source = { id: season.id, method: 'converted', edition: season.edition, retrieved: season.retrieved };
  return `{\n"source": ${JSON.stringify(source)},\n"attributes": ${JSON.stringify(season.source.attributes)},\n"notes": ${JSON.stringify(notes)},\n`
    + `"left": [\n${leftSorted.map(row => JSON.stringify(row)).join(',\n')}\n],\n"players": [\n${sorted.map(row => JSON.stringify(row)).join(',\n')}\n]\n}\n`;
}

// ---------- the calibration fixture ----------

/**
 * The five full editions' players (their committed snapshots) with their stat lines from the permitted sources, for the
 * computed rule's calibration: NHLPA 93, NHL 94, NHL 95 and NHL 07 from the Hockey Databank (joined by name on the
 * edition's club, then anywhere in the window), NHL 22 from MoneyPuck (by NHL id). Each edition `{ id, year, form,
 * leagues, players: [[name, team, pos, overall, lines]], unmatched }`. A player's lines cover the season's window and the
 * window of the season before (`lagWindowOf`): an edition comes out before its season, so EA rated what the seasons before
 * it showed. `unmatched`: the players with no line in the season's own window.
 */
export async function assembleCalibration(editions, io, snapshotOf) {
  const out = [];
  for (const { id, year, kind } of editions) {
    const snapshot = await snapshotOf(id);
    const seasons = new Map();
    // The seasons a player's lines cover: the season's window, then the one season more that the window before adds.
    const covered = [...new Set([...windowOf(year), ...lagWindowOf(year)])].sort((a, b) => b - a);
    let lineOf, unmatched = [], form;
    if (kind === 'hdb') {
      const db = await databank(io);
      for (const y of windowOf(year)) seasons.set(y, hdbSeason(db, y));
      seasons.set(year + 1, hdbSeason(db, year + 1));
      const league = [];
      for (const [y, s] of seasons) {
        for (const [key, e] of s.skaters) league.push({ id: `${key}|S`, key, name: hdbName(db.master.get(key)), last: db.master.get(key).lastName, pos: e.pos ?? 'C', team: y === year ? clubOfStints(e.stints) : `${y}:${clubOfStints(e.stints)}` });
        for (const [key, e] of s.goalies) league.push({ id: `${key}|G`, key, name: hdbName(db.master.get(key)), last: db.master.get(key).lastName, pos: 'G', team: y === year ? clubOfStints(e.stints) : `${y}:${clubOfStints(e.stints)}` });
      }
      // One entry per player and role: his own season's first.
      const unique = [];
      const seen = new Set();
      for (const p of league) if (!seen.has(p.id)) { seen.add(p.id); unique.push(p); }
      const taken = new Set();
      const keyOf = new Map();
      for (const onTeamOnly of [true, false]) {
        for (const row of snapshot.players) {
          if (keyOf.has(row)) continue;
          const hit = findPlayer(unique, { name: row[0], team: row[1], group: groupOf(row[2]) }, {}, { taken, onTeamOnly });
          if (hit) { keyOf.set(row, hit.player.key); taken.add(hit.player.id); }
        }
      }
      lineOf = row => keyOf.get(row) ?? null;
      form = { skaters: 'points', goalies: windowOf(year).every(y => seasons.get(y).league.savePct != null) ? 'saves' : 'goals' };
      // The lag window's earliest season is read for lines only: the players are matched on the seasons above.
      for (const y of covered) if (!seasons.has(y)) seasons.set(y, hdbSeason(db, y));
    } else {
      for (const y of covered) seasons.set(y, await moneypuck(io, y));
      lineOf = row => row[5];
      form = { skaters: 'minutes', goalies: 'saves' };
    }
    const players = [];
    for (const row of snapshot.players) {
      const key = lineOf(row);
      const goalie = row[2] === 'G';
      const lines = key == null ? [] : covered.map(y => {
        const e = (goalie ? seasons.get(y).goalies : seasons.get(y).skaters).get(key);
        if (!e || e.games === 0) return null;
        return goalie ? [y, e.games, e.seconds, e.goals, e.shots] : [y, e.games, e.points, kind === 'hdb' ? null : e.seconds];
      }).filter(Boolean);
      if (!lines.some(line => windowOf(year).includes(line[0]))) unmatched.push(`${row[0]} (${row[1]})`);
      players.push([row[0], row[1], row[2], row[3], lines]);
    }
    const leagues = Object.fromEntries(covered.map(y => [y, seasons.get(y).league]));
    out.push({ id, year, kind, form, leagues, players, unmatched });
  }
  return out;
}

/** The calibration fixture's text. */
export function calibrationText(editions) {
  return `{\n"note": "The full EA editions' players with their stat lines from the permitted sources (the Hockey Databank; MoneyPuck for NHL 22), for the computed rule's calibration (docs/design/hockey.md, \\"Computed seasons\\"): the lines of the edition's season's window and of the window before it, which EA saw. Written by node scripts/sync-nhl-seasons.mjs.",\n"editions": [\n`
    + editions.map(e => `{"id": ${JSON.stringify(e.id)}, "year": ${e.year}, "kind": ${JSON.stringify(e.kind)}, "form": ${JSON.stringify(e.form)}, "leagues": ${JSON.stringify(e.leagues)}, "unmatched": ${JSON.stringify(e.unmatched)},\n"players": [\n${e.players.map(p => JSON.stringify(p)).join(',\n')}\n]}`).join(',\n')
    + '\n]\n}\n';
}
