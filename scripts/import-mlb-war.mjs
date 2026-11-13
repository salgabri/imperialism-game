// Import the baseball seasons no game rated, 1960 to 2017, from the players' WAR (docs/design/baseball.md, "Seasons
// before 2018: computed from WAR").
//
//   npm run import:mlb-war             writes scripts/data/mlb-war-seasons/<year>.json and scripts/data/mlb-war-reference.json
//   npm run import:mlb-war -- --check  rebuilds both from the caches and compares them byte for byte, writes nothing
//
// It never fetches. Its sources (scripts/data/mlb-war-seasons.json `sources`) are cached in the ignored data-src/mlb-war/
// and pinned by SHA-256: JEFFBAGWELL's WAR by player, season and stint (Neil Paine, MIT; the average of Baseball-Reference's
// and FanGraphs' WAR) and the Chadwick Baseball Bureau's Baseball Databank at the latest commit its surviving forks hold
// (CC BY-SA 3.0; seasons to 2022) for each player's name and birthplace, each club's code, record and ballpark. Each
// season's snapshot holds every player who played in it: his club (that of his last stint), his role and positions, his
// score and the inputs it was computed from, and his birth country (the Databank's, but where the manifest's
// `birthCountries` corrects it from a pinned source). The reference holds MLB The Show 18 to 24's overalls of the players
// matched to that season's WAR, by derived role, strongest first: the scale the scores are mapped onto
// (scripts/lib/mlb-war.mjs `rateByRank`), with the calibration that left one season out at a time. It also sums the
// Databank's Teams.csv into each season's league totals and stops on any that src/data/mlbLeagueAverages.js gives
// otherwise: baseball plays each season at its league's runs a game (docs/design/baseball.md, "Rules by era").
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { MLB_LEAGUE_TOTALS } from '../src/data/mlbLeagueAverages.js';
import { editionOf, nameKey, rosterOf } from './lib/mlb.mjs';
import { FIELD_POSITIONS, WAR_ROLES, aliasesOf, displayNameOf, rateByRank, roundTo, warScoreOf } from './lib/mlb-war.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const manifestFile = path.join(root, 'scripts/data/mlb-war-seasons.json');
const snapshotDir = path.join(root, 'scripts/data/mlb-war-seasons');
const referenceFile = path.join(root, 'scripts/data/mlb-war-reference.json');

// ---------- reading the sources ----------

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function csvObjects(text) {
  const [head, ...rows] = parseCsv(text.replace(/^﻿/, ''));
  return rows.filter(row => row.length > 1).map(row => Object.fromEntries(head.map((key, i) => [key, row[i]])));
}

/** A CSV's rows as `get(row, column)` reads them, without building an object a row (the WAR file has 78 columns). */
function csvRows(text) {
  const [head, ...rows] = parseCsv(text.replace(/^﻿/, ''));
  const at = Object.fromEntries(head.map((key, i) => [key, i]));
  return rows.filter(row => row.length > 1).map(row => new Proxy(row, { get: (target, key) => (Object.hasOwn(at, key) ? target[at[key]] : target[key]) }));
}

/**
 * A cached source file, checked against its pins: its SHA-256 and, where the manifest names it (`blobs`), the git blob
 * its source's pinned commit holds, so the file is that commit's whichever copy it was read from. → its text.
 */
async function pinned(source, file) {
  const at = path.join(root, source.cache, file);
  if (!existsSync(at)) throw new Error(`${source.cache}/${file} is not on this computer (see scripts/data/mlb-war-seasons.json \`sources\`)`);
  const bytes = await readFile(at);
  const sha = createHash('sha256').update(bytes).digest('hex');
  if (sha !== source.sha256[file]) throw new Error(`${source.cache}/${file} is not the pinned file (SHA-256 ${sha})`);
  const blob = source.blobs?.[file];
  if (blob && createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex') !== blob) {
    throw new Error(`${source.cache}/${file} is not the blob ${blob} of commit ${source.commit}`);
  }
  return bytes.toString('utf8');
}

const number = value => (value === '' || value === 'NA' || value == null ? 0 : Number(value));

/**
 * Each season's league totals from 1960, summed from the Databank's Teams.csv (G, R, IPouts and SHO of every American and
 * National League club), must be src/data/mlbLeagueAverages.js's: its figures for the Databank's seasons are these sums.
 * → the seasons checked.
 */
function checkLeagueTotals(teams) {
  const sums = new Map();
  for (const team of teams) {
    const year = Number(team.yearID);
    if (year < 1960 || (team.lgID !== 'AL' && team.lgID !== 'NL')) continue;
    const sum = sums.get(year) ?? { games: 0, runs: 0, outs: 0, shutouts: 0 };
    sum.games += Number(team.G);
    sum.runs += Number(team.R);
    sum.outs += Number(team.IPouts);
    sum.shutouts += Number(team.SHO);
    sums.set(year, sum);
  }
  for (const [year, sum] of sums) {
    const listed = Object.hasOwn(MLB_LEAGUE_TOTALS, year) ? MLB_LEAGUE_TOTALS[year] : null;
    if (!listed || Object.keys(sum).some(key => listed[key] !== sum[key])) {
      throw new Error(`${year}: src/data/mlbLeagueAverages.js has ${JSON.stringify(listed)}, the Databank's Teams.csv sums to ${JSON.stringify(sum)}`);
    }
  }
  return [...sums.keys()].sort((a, b) => a - b);
}

/**
 * The Databank's People by Baseball-Reference id. It files each player of the 58 seasons once; should an id be filed
 * twice, a major leaguer beside another man with no major-league debut, the player is the one with a debut, else the one
 * whose own Databank id is the Baseball-Reference id; an id neither tells apart throws once a season asks for it.
 */
function peopleByBbref(rows) {
  const filed = new Map();
  for (const person of rows) {
    if (!person.bbrefID) continue;
    if (!filed.has(person.bbrefID)) filed.set(person.bbrefID, []);
    filed.get(person.bbrefID).push(person);
  }
  const people = new Map();
  for (const [id, list] of filed) {
    const found = list.length === 1 ? list : [p => Boolean(p.debut), p => p.playerID === id]
      .map(test => list.filter(test)).find(picked => picked.length === 1) ?? list;
    people.set(id, found.length === 1 ? found[0] : { ambiguous: list.map(p => p.playerID) });
  }
  return people;
}

// ---------- player-seasons ----------

const GAMES = { C: 'gms_C', '1B': 'gms_1B', '2B': 'gms_2B', '3B': 'gms_3B', SS: 'gms_SS', LF: 'gms_LF', CF: 'gms_CF', RF: 'gms_RF' };

/**
 * Every player-season of the WAR file, its stints summed: `{ id, name, year, club, bwar, pwar, pa, ip, gs, gp, gbat, li,
 * games }`. A stint's WAR is its WAR per 162 team games times its club's scheduled games over 162. `club` is the last
 * stint's, `li` the season's average leverage index weighted by innings (null without innings).
 */
function playerSeasons(rows) {
  const seasons = new Map();
  for (const r of rows) {
    const key = `${r.key_bbref}|${r.year_ID}`;
    let s = seasons.get(key);
    if (!s) {
      s = { id: r.key_bbref, name: r.player_name, year: Number(r.year_ID), stints: [], bwar: 0, pwar: 0, pa: 0, ip: 0, gs: 0, gp: 0, gbat: 0,
        leverage: 0, leverageIp: 0, games: Object.fromEntries(FIELD_POSITIONS.map(pos => [pos, 0])) };
      seasons.set(key, s);
    }
    const share = (number(r.sched) || 162) / 162;
    s.stints.push({ stint: number(r.stint_ID), club: r.team_ID });
    s.bwar += number(r.bwar162) * share;
    s.pwar += number(r.pwar162) * share;
    s.pa += number(r.pa);
    s.ip += number(r.innings);
    s.gs += number(r.starts);
    s.gp += number(r.g_pitch);
    s.gbat += number(r.g_bat);
    if (number(r.innings) && r.avg_LI !== 'NA' && r.avg_LI !== '') { s.leverage += Number(r.avg_LI) * number(r.innings); s.leverageIp += number(r.innings); }
    for (const [pos, column] of Object.entries(GAMES)) s.games[pos] += number(r[column]);
  }
  for (const s of seasons.values()) {
    s.stints.sort((a, b) => a.stint - b.stint);
    s.club = s.stints.at(-1).club;
    s.li = s.leverageIp ? s.leverage / s.leverageIp : null;
  }
  return seasons;
}

/** Whether a player-season is a pitcher's (manifest `method.pitcher`). */
const pitches = (s, rule) => s.ip * rule.inningsPerPa > s.pa || (s.gp > 0 && s.gp >= s.gbat * rule.gamesShare && s.pa < rule.maxPa);

/**
 * A player-season's role and positions, and its score's inputs (rounded as the snapshot keeps them) and score:
 * `{ role, positions, war, use, li, score }`.
 */
function rateInputs(s, get, method) {
  const back = [1, 2].map(k => get(s.id, s.year - k));
  const seasons = [s, ...back].slice(0, method.seasonsBack);
  let role, positions;
  if (pitches(s, method.pitcher)) {
    let gs = s.gs, gp = s.gp;
    if (back[0]) { gs += back[0].gs; gp += back[0].gp; }
    role = gp && gs / gp >= method.starterShare ? 'SP' : 'RP';
    positions = [role];
  } else {
    role = 'H';
    const total = Object.fromEntries(FIELD_POSITIONS.map(pos => [pos, seasons.reduce((sum, x) => sum + (x ? x.games[pos] : 0), 0)]));
    const order = FIELD_POSITIONS.slice().sort((a, b) => s.games[b] - s.games[a] || total[b] - total[a]);
    const primary = s.games[order[0]] > 0 || total[order[0]] > 0 ? order[0] : 'DH';
    positions = [primary, ...FIELD_POSITIONS.filter(pos => pos !== primary && total[pos] >= method.secondaryGames)];
  }
  const war = seasons.map(x => (x ? roundTo(role === 'H' ? x.bwar : x.pwar, 3) : null));
  const use = seasons.map(x => (x ? (role === 'H' ? x.pa : roundTo(x.ip, 3)) : null));
  const li = role === 'RP' && s.li != null ? roundTo(s.li, 4) : null;
  return { role, positions, war, use, li, score: warScoreOf({ role, war, use, li }, method) };
}

/** Every player who played in `year` (one with no plate appearance, inning or game is no player), rated inputs. */
function seasonPool(seasons, year, get, method) {
  return [...seasons.values()].filter(s => s.year === year && (s.pa || s.ip || s.gbat || s.gp))
    .map(s => ({ ...s, ...rateInputs(s, get, method) }));
}

// ---------- calibration ----------

// MLB The Show's club codes where Baseball-Reference's differ.
const SHOW_TO_WAR = { CWS: 'CHW', KC: 'KCR', SD: 'SDP', SF: 'SFG', TB: 'TBR', WAS: 'WSN' };
// The game's own club codes (public/baseball/mlb-the-show-<nn>.json) where Baseball-Reference's differ.
const CODE_TO_WAR = { CWS: 'CHW', WSH: 'WSN', ATH: 'OAK' };

/**
 * MLB The Show cards of `year` matched to that season's WAR: by name, then (among namesakes) by role, then by club.
 * → [{ card, overall, season }]; a card with no single match is left out.
 */
function matchShow(snapshot, year, byName, method) {
  const isPitcherCard = position => ['SP', 'RP', 'CP'].includes(position);
  const twoWay = s => s.ip >= method.calibration.twoWay.innings && s.pa >= method.calibration.twoWay.pa;
  const matched = [];
  for (const card of snapshot.players) {
    const [, name, team, position, , overall] = card;
    let found = byName.get(`${year}|${nameKey(name)}`) || [];
    if (found.length > 1) {
      const role = found.filter(s => pitches(s, method.pitcher) === isPitcherCard(position) || twoWay(s));
      if (role.length) found = role;
    }
    if (found.length > 1 && team !== 'FA') {
      const club = SHOW_TO_WAR[team] || team;
      const own = found.filter(s => s.stints.some(st => st.club === club));
      if (own.length) found = own;
    }
    if (found.length === 1) matched.push({ card, overall, season: found[0] });
  }
  return matched;
}

const mean = xs => xs.reduce((s, v) => s + v, 0) / xs.length;
function pearson(xs, ys) {
  const mx = mean(xs), my = mean(ys);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < xs.length; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
  return sxy / Math.sqrt(sxx * syy);
}
function ranks(values) {
  const order = values.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const out = new Array(values.length);
  for (let i = 0; i < order.length;) {
    let j = i;
    while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++;
    for (let k = i; k <= j; k++) out[order[k][1]] = (i + j) / 2;
    i = j + 1;
  }
  return out;
}
const spearman = (xs, ys) => pearson(ranks(xs), ranks(ys));
const r3 = v => roundTo(v, 3);

/** The reference overalls of `matches` by derived role, strongest first. */
function referenceOf(matches) {
  const reference = Object.fromEntries(WAR_ROLES.map(role => [role, []]));
  for (const m of matches) reference[m.role].push(m.overall);
  for (const role of WAR_ROLES) reference[role].sort((a, b) => b - a);
  return reference;
}

/** A season's clubs built from `pool` with the game's own lineup (rosterOf): club code → strength. */
function clubStrengths(pool, ratings) {
  const clubs = new Map();
  for (const p of pool) {
    if (!clubs.has(p.club)) clubs.set(p.club, []);
    clubs.get(p.club).push({ name: p.id, pos: p.positions[0], positions: p.positions, rating: ratings.get(p.id), score: p.score, id: p.id });
  }
  const strengths = new Map();
  for (const [club, list] of clubs) {
    list.sort((a, b) => b.rating - a.rating || b.score - a.score || (a.id < b.id ? -1 : 1));
    strengths.set(club, rosterOf(list).lineup.rating);
  }
  return strengths;
}

/**
 * Leave one season out: each calibration season rated against the other six's reference, against MLB The Show's own
 * overalls (players) and its own clubs (public/baseball/mlb-the-show-<nn>.json), and both against the real records
 * where the Databank has them (to 2022; a later season's `winShare` is null).
 */
function leaveOneOut(calibration, records) {
  const errors = [], byRole = Object.fromEntries(WAR_ROLES.map(role => [role, { e: [], p: [], a: [] }]));
  const clubPairs = [], seasonsOut = [];
  for (const { year, pool, matches, showClubs } of calibration) {
    const others = calibration.filter(c => c.year !== year);
    const reference = referenceOf(others.flatMap(c => c.matches));
    const ratings = rateByRank(pool, reference, 30, 30 * others.length);
    const predicted = [], actual = [];
    for (const m of matches) {
      const rating = ratings.get(m.season.id);
      predicted.push(rating); actual.push(m.overall);
      errors.push(Math.abs(rating - m.overall));
      byRole[m.role].e.push(Math.abs(rating - m.overall)); byRole[m.role].p.push(rating); byRole[m.role].a.push(m.overall);
    }
    const strengths = clubStrengths(pool, ratings);
    const ours = [], theirs = [], wins = [];
    for (const [code, str] of showClubs) {
      const club = CODE_TO_WAR[code] || code;
      if (!strengths.has(club)) throw new Error(`${year}: no computed club ${club}`);
      ours.push(strengths.get(club)); theirs.push(str);
      const record = records.get(`${year}|${club}`);
      if (record) wins.push(record.w / (record.w + record.l));
      clubPairs.push([strengths.get(club), str]);
    }
    // A season has every club's record or none (the Databank ends with 2022).
    if (wins.length && wins.length !== ours.length) throw new Error(`${year}: the Databank has the records of ${wins.length} of ${ours.length} clubs`);
    seasonsOut.push({ year, cards: matches.length,
      players: { mae: r3(mean(predicted.map((p, i) => Math.abs(p - actual[i])))), pearson: r3(pearson(predicted, actual)), spearman: r3(spearman(predicted, actual)) },
      clubs: { pearson: r3(pearson(ours, theirs)), mae: r3(mean(ours.map((o, i) => Math.abs(o - theirs[i])))) },
      winShare: wins.length ? { computed: r3(pearson(ours, wins)), show: r3(pearson(theirs, wins)) } : null });
  }
  const within = (list, d) => r3(list.filter(e => e <= d).length / list.length);
  return {
    players: { mae: r3(mean(errors)), within3: within(errors, 3), within5: within(errors, 5) },
    roles: Object.fromEntries(WAR_ROLES.map(role => {
      const { e, p, a } = byRole[role];
      return [role, { cards: e.length, mae: r3(mean(e)), pearson: r3(pearson(p, a)), spearman: r3(spearman(p, a)), within3: within(e, 3) }];
    })),
    clubs: { pearson: r3(pearson(clubPairs.map(c => c[0]), clubPairs.map(c => c[1]))), mae: r3(mean(clubPairs.map(([o, t]) => Math.abs(o - t)))),
      bias: r3(mean(clubPairs.map(([o, t]) => o - t))) },
    seasons: seasonsOut,
  };
}

// ---------- the snapshots ----------

const SUFFIX = / (Jr\.|Sr\.|II|III|IV)$/;

function snapshotText(doc) {
  const { players, teams, ...head } = doc;
  const lines = Object.entries(head).map(([key, value]) => `  ${JSON.stringify(key)}: ${JSON.stringify(value)}`);
  lines.push(`  "teams": {\n${Object.entries(teams).map(([code, team]) => `    ${JSON.stringify(code)}: ${JSON.stringify(team)}`).join(',\n')}\n  }`);
  lines.push(`  "players": [\n${players.map(row => `    ${JSON.stringify(row)}`).join(',\n')}\n  ]`);
  return `{\n${lines.join(',\n')}\n}\n`;
}

function referenceText(doc) {
  const { reference, ...rest } = doc;
  const text = JSON.stringify(rest, null, 2).replace(/\[\s+([^\[\]{}]*?)\s+\]/g, (m, inner) => `[${inner.split(/,\s*/).join(', ')}]`);
  const body = text.slice(0, -2);
  return `${body},\n  "reference": {\n${WAR_ROLES.map(role => `    "${role}": ${JSON.stringify(reference[role])}`).join(',\n')}\n  }\n}\n`;
}

async function main() {
  const check = process.argv.includes('--check');
  const unknown = process.argv.slice(2).filter(arg => arg !== '--check');
  if (unknown.length) throw new Error(`Unknown option ${unknown[0]}`);
  const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
  const { method, sources } = manifest;
  const { from, to } = manifest.seasons;

  for (const file of Object.keys(sources.war.sha256).filter(file => file !== sources.war.file)) await pinned(sources.war, file);
  // The licence the season files' attribution repeats is the file's own.
  if ((await pinned(sources.war, 'LICENSE.txt')) !== sources.war.licenceText) throw new Error('sources.war.licenceText is not the WAR file\'s LICENSE.txt');
  const war = csvRows(await pinned(sources.war, sources.war.file));
  const { databank } = sources;
  // The licence and the Retrosheet notice the attribution repeats are the Databank's README's own words.
  const readme = await pinned(databank, 'README.md');
  for (const key of ['licenceText', 'retrosheetText']) if (!readme.includes(databank[key])) throw new Error(`sources.databank.${key} is not in the Databank's README.md`);
  const people = peopleByBbref(csvObjects(await pinned(databank, 'People.csv')));
  const databankTeams = csvObjects(await pinned(databank, 'Teams.csv'));
  const totalled = checkLeagueTotals(databankTeams);
  console.log(`League totals: ${totalled[0]} to ${totalled.at(-1)} are src/data/mlbLeagueAverages.js's`);
  // HomeGames names its columns year.key, team.key, park.key, games, ... (Retrosheet's game logs, by club and ballpark).
  const homeGames = csvObjects(await pinned(databank, 'HomeGames.csv'))
    .map(h => ({ year: h['year.key'], team: h['team.key'], park: h['park.key'], games: Number(h.games) }));
  // A birth country the Databank gets wrong takes the one its pinned source gives (manifest `birthCountries`).
  const corrections = manifest.birthCountries || {};
  for (const [id, fix] of Object.entries(corrections)) {
    if (fix.source !== 'wikipedia' || !sources.wikipedia.articles[fix.article]) throw new Error(`birthCountries.${id}: its source is no pinned Wikipedia article`);
    const person = people.get(id);
    if (!person || person.birthCountry !== fix.databank) throw new Error(`birthCountries.${id}: the Databank files ${JSON.stringify(person?.birthCountry)}, not ${JSON.stringify(fix.databank)}`);
  }
  const birthCountryOf = (id, person) => (Object.hasOwn(corrections, id) ? corrections[id].country : person.birthCountry);

  const seasons = playerSeasons(war);
  const get = (id, year) => seasons.get(`${id}|${year}`);
  const records = new Map(databankTeams.map(t => [`${t.yearID}|${t.teamIDBR}`, { w: Number(t.W), l: Number(t.L) }]));

  // Calibration: MLB The Show 18 to 24 matched to their seasons' WAR.
  const byName = new Map();
  for (const s of seasons.values()) {
    const key = `${s.year}|${nameKey(s.name)}`;
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(s);
  }
  const calibration = [];
  for (const year of method.calibration.years) {
    const snapshot = JSON.parse(await readFile(path.join(root, `scripts/data/mlb-the-show-${editionOf(year)}.json`), 'utf8'));
    const pool = seasonPool(seasons, year, get, method);
    const roleOf = new Map(pool.map(p => [p.id, p.role]));
    const matches = matchShow(snapshot, year, byName, method).map(m => ({ ...m, role: roleOf.get(m.season.id) }));
    const missing = matches.filter(m => !m.role);
    if (missing.length) throw new Error(`${year}: matched cards with no player-season of that year: ${missing.map(m => m.card[1]).join(', ')}`);
    const show = JSON.parse(await readFile(path.join(root, `public/baseball/mlb-the-show-${editionOf(year)}.json`), 'utf8'));
    calibration.push({ year, pool, matches, showClubs: new Map(show.clubs.map(c => [c.code, c.str])) });
  }
  const reference = referenceOf(calibration.flatMap(c => c.matches));
  const teamSeasons = method.calibration.clubs * calibration.length;
  const loso = leaveOneOut(calibration, records);
  const referenceDoc = {
    note: 'The scale the computed seasons\' scores are mapped onto (npm run import:mlb-war; docs/design/baseball.md, "Seasons before 2018: computed from WAR"): the overalls of MLB The Show 18 to 24\'s Live cards matched to their season\'s WAR (by name, then role, then club), grouped by the role the WAR file gives the player, strongest first. `teamSeasons` is the club-seasons they come from. `leaveOneOut` rates each calibration season against the other six seasons\' reference and compares it with MLB The Show\'s own overalls, its own clubs (lineups built by the game\'s rule) and the real records (`winShare`, from the Baseball Databank, whose seasons end with 2022: null for 2023 and 2024).',
    years: method.calibration.years, teamSeasons,
    cards: Object.fromEntries(calibration.map(c => [c.year, c.matches.length])),
    byRole: Object.fromEntries(WAR_ROLES.map(role => [role, { cards: reference[role].length, top: reference[role][0], floor: reference[role].at(-1) }])),
    leaveOneOut: loso,
    reference,
  };

  // The computed seasons.
  const outputs = [[referenceFile, referenceText(referenceDoc)]];
  for (let year = from; year <= to; year++) {
    const pool = seasonPool(seasons, year, get, method);
    const unknownPeople = pool.filter(p => !people.has(p.id));
    if (unknownPeople.length) throw new Error(`${year}: the Databank has no person for ${unknownPeople.map(p => p.id).join(', ')}`);
    const ambiguous = pool.filter(p => people.get(p.id).ambiguous);
    if (ambiguous.length) throw new Error(`${year}: the Databank files more than one person under ${ambiguous.map(p => `${p.id} (${people.get(p.id).ambiguous.join(', ')})`).join(', ')}`);
    const players = pool.map(p => {
      const person = people.get(p.id);
      const suffix = p.name.match(SUFFIX)?.[1] ?? null;
      // The Databank spells initials "A. J."; the seasons write "A.J.", as MLB The Show does.
      const first = person.nameFirst.replace(/\b([A-Z])\. (?=[A-Z]\.)/g, '$1.');
      return { ...p, first, last: person.nameLast, suffix, given: person.nameGiven, born: person.birthYear, country: birthCountryOf(p.id, person),
        display: displayNameOf({ first, last: person.nameLast, suffix }) };
    });
    // Namesakes of one season get a name each that tells them apart; the season builder uses it where they share a squad.
    const byDisplay = new Map();
    for (const p of players) {
      if (!byDisplay.has(p.display)) byDisplay.set(p.display, []);
      byDisplay.get(p.display).push(p);
    }
    const alias = new Map();
    for (const group of byDisplay.values()) if (group.length > 1) for (const [id, name] of aliasesOf(group)) alias.set(id, name);
    const teams = {};
    for (const t of databankTeams.filter(t => Number(t.yearID) === year && (t.lgID === 'AL' || t.lgID === 'NL'))
      .sort((a, b) => (a.teamIDBR < b.teamIDBR ? -1 : 1))) {
      const games = homeGames.filter(h => h.year === t.yearID && h.team === t.teamID).sort((a, b) => b.games - a.games);
      if (!games.length) throw new Error(`${year}: the Databank has no home games of ${t.teamIDBR}`);
      if (games.length > 1 && games[1].games === games[0].games) throw new Error(`${year}: ${t.teamIDBR} played as many home games at ${games[0].park} as at ${games[1].park}`);
      teams[t.teamIDBR] = { name: t.name, league: t.lgID, w: Number(t.W), l: Number(t.L), park: games[0].park, homeGames: games[0].games };
    }
    const strays = players.filter(p => !teams[p.club]);
    if (strays.length) throw new Error(`${year}: clubs ${[...new Set(strays.map(p => p.club))].join(', ')} are not the Databank's`);
    const roleOrder = role => WAR_ROLES.indexOf(role);
    players.sort((a, b) => (a.club < b.club ? -1 : a.club > b.club ? 1 : 0) || roleOrder(a.role) - roleOrder(b.role) || b.score - a.score || (a.id < b.id ? -1 : 1));
    const doc = {
      note: `Every player of the ${year} MLB season with his score's inputs (npm run import:mlb-war; docs/design/baseball.md, "Seasons before 2018: computed from WAR"). Each player: [Baseball-Reference id, name, the name that tells him apart from a namesake of the season (else null), club (his last stint's), role (H, SP or RP), positions (the primary first), score, WAR of the season and the two before it (batting for a hitter, pitching for a pitcher; null where he did not play), plate appearances or innings of those seasons, average leverage index (relievers), birth country (the Databank's, or the one scripts/data/mlb-war-seasons.json \`birthCountries\` gives where it corrects the Databank)]. WAR: JEFFBAGWELL (Neil Paine, MIT), the average of Baseball-Reference's and FanGraphs' WAR. Names, birthplaces, clubs' records and ballparks: the Baseball Databank (Chadwick Baseball Bureau, CC BY-SA 3.0; its home games from Retrosheet). Each club: its name, league, won-lost record and the Databank's key (Retrosheet's park code) of the ballpark it played most of its home games in, with the number of home games it played there.`,
      season: year,
      clubs: Object.keys(teams).length,
      teams,
      players: players.map(p => [p.id, p.display, alias.get(p.id) ?? null, p.club, p.role, p.positions.join('/'), p.score, p.war, p.use, p.li, p.country]),
    };
    outputs.push([path.join(snapshotDir, `${year}.json`), snapshotText(doc)]);
  }

  const { players, roles, clubs } = loso;
  console.log(`Reference: ${Object.values(referenceDoc.cards).join(' / ')} cards (${WAR_ROLES.map(r => `${r} ${reference[r].length}`).join(', ')}) over ${teamSeasons} club-seasons`);
  console.log(`Leave one season out: MAE ${players.mae} (${WAR_ROLES.map(r => `${r} ${roles[r].mae}, rho ${roles[r].spearman}`).join('; ')}); clubs r ${clubs.pearson}, MAE ${clubs.mae}, bias ${clubs.bias}`);
  if (check) {
    const differs = [];
    for (const [file, text] of outputs) {
      const current = existsSync(file) ? (await readFile(file, 'utf8')).replace(/\r\n/g, '\n') : null;
      if (current !== text) differs.push(path.relative(root, file));
    }
    if (differs.length) throw new Error(`differs: ${differs.join(', ')}`);
    console.log(`Verified the ${to - from + 1} snapshots and the reference byte for byte.`);
    return;
  }
  await mkdir(snapshotDir, { recursive: true });
  for (const [file, text] of outputs) await writeFile(file, text);
  console.log(`Wrote ${to - from + 1} snapshots to scripts/data/mlb-war-seasons/ and scripts/data/mlb-war-reference.json`);
}

main().catch(error => {
  console.error(`import-mlb-war: ${error.message}`);
  process.exitCode = 1;
});
