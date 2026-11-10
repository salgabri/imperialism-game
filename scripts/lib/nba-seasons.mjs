// The built-in earlier basketball seasons (docs/design/football-years.md): one NBA 2K edition's ratings, as compiled by
// 2K Archive, become that season's NBA clubs, each with its best five, in the data set format the game loads
// (src/engine/footballSets.js, kind 'nba2k'). Clubs only: no source rates the national teams' other players. The
// built-in season's clubs (scripts/build-clubs.mjs) and its national fives' NBA ratings (scripts/build-basketball.mjs)
// come from the same page. The seasons before NBA 2K come from other sources, each a season of the manifest's `extra`
// with a `format`: NBA 2K27's MyNBA Eras leagues as 2kratings.com lists them, and NBA Live 99's own roster files, each
// player checked against Basketball-Reference's seasons (realPlayers). The seasons no game rated (the manifest's
// `computed`, 1960/61 to 1997/98 but 1983/84 and 1991/92) are computed from Basketball-Reference's player seasons: one
// score fitted to NBA 2K's overalls, then each season ranked onto NBA 2K27's ratings (readComputedSources). Only
// readArchive, readSeasonSources and readComputedSources do I/O: scripts/build-nba-seasons.mjs writes the files,
// scripts/build-club-maps.mjs takes each era's teams and arenas from `teamsOf`, and tests build seasons from invented
// players. Every rating is 2K's, unchanged, but NBA Live 99's, which one documented straight line puts on NBA 2K's
// scale (liveScale), and the computed seasons', which say how they were computed.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { selectLineup } from '../../src/data/teams.js';
import { colourFor, contentHash, makeCode, serializeFootballSet } from '../../src/data/footballSetBuild.js';

export const POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C'];
export const SET_ID = /^nba-2k\d{2}$/;
const FIVE = 5;

const seasonOf = year => `${year - 1}/${String(year % 100).padStart(2, '0')}`;
/** 2000 → 'NBA 2K', 2008 → 'NBA 2K8': the edition named for the season ending that year. */
export const editionOf = year => `NBA 2K${year === 2000 ? '' : year - 2000}`;
export const seasonIdOf = year => `nba-2k${String(year - 2000).padStart(2, '0')}`;
/** Whether the season ending `year` is one no game rated, computed from the players' statistics (`nba-stats-1975`). */
export const isComputed = (manifest, year) => !!manifest?.computed?.seasons?.includes(Number(year));
/**
 * The id of the season ending `year`: its `extra` source's (`nba-eras-1984`), a computed season's (`nba-stats-1975`),
 * else its NBA 2K edition's (`nba-2k08`).
 */
export const setIdOf = (manifest, year) => manifest?.extra?.[String(year)]?.id
  ?? (isComputed(manifest, year) ? `nba-stats-${year}` : seasonIdOf(year));
/** The name the season ending `year` goes by: its `extra` source's label, a computed season's, else its NBA 2K edition. */
export const labelOf = (manifest, year) => manifest?.extra?.[String(year)]?.label
  ?? (isComputed(manifest, year) ? manifest.computed.label : editionOf(year));

/**
 * The page's ratings: `const YEARS = { "2000": [{ n, o, p, t, ... }], ... }`, read as data. The object literal is cut
 * out by matching braces outside strings and parsed as JSON; nothing on the page runs.
 */
export function extractYears(html) {
  const at = html.indexOf('const YEARS =');
  if (at < 0) throw new Error('The 2K Archive page has no YEARS table');
  const start = html.indexOf('{', at);
  let depth = 0, quoted = false;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (quoted) {
      if (c === '\\') i++;
      else if (c === '"') quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return JSON.parse(html.slice(start, i + 1));
  }
  throw new Error('The YEARS table on the 2K Archive page never closes');
}

const POSITION_HEADINGS = { 'POINT GUARD': 'PG', 'SHOOTING GUARD': 'SG', 'SMALL FORWARD': 'SF', 'POWER FORWARD': 'PF', CENTER: 'C' };
const FREE_AGENTS = 'FREE AGENT';

/** A page's text, one line per line break, with its tags dropped and its character references decoded. */
function pageLines(html) {
  const named = { amp: '&', nbsp: ' ', quot: '"', apos: "'", lt: '<', gt: '>' };
  return html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(?:p|div|li|h\d)>/gi, '\n').replace(/<[^>]*>/g, '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (entity, name) => named[name.toLowerCase()] ?? entity)
    .split('\n').map(line => line.replace(/\s+/g, ' ').trim());
}

/**
 * The NBA 2K12 launch ratings as The Real 2K Insider listed them on 27 September 2011, transcribed from 2K's ratings
 * video, read as data: under each team's nickname (`nicknames` maps it to the manifest's code) and position heading,
 * one line per player, "<2K12 overall> – <name> (<2K11 final>/<2K11 default>)". Returns the YEARS shape
 * `[{ n, o, p, t }]`, the free agents with `t: 'FA'`. Throws on a line it cannot read inside the list.
 */
export function parseInsiderRatings(html, nicknames) {
  const lines = pageLines(html);
  const first = lines.findIndex(line => /^2K12 rating - Player/.test(line));
  const last = lines.findIndex((line, i) => i > first && /^TOP 10 NBA 2K12/.test(line));
  if (first < 0 || last < 0) throw new Error('The 2K12 page has no ratings list');
  const players = [];
  let team = null, position = null;
  for (const line of lines.slice(first + 1, last)) {
    if (!line) continue;
    if (line === FREE_AGENTS || Object.hasOwn(nicknames, line)) { team = line === FREE_AGENTS ? 'FA' : nicknames[line]; position = null; continue; }
    if (Object.hasOwn(POSITION_HEADINGS, line)) { position = POSITION_HEADINGS[line]; continue; }
    // A player the video did not rate ("X - Chris Johnson (MISSING since April...)") is left out.
    if (/^X\s*[-–]/.test(line)) continue;
    // "47 – Tony Battie (C) (57/57)": a letter in brackets after the name is the blog's note, not the name. The 2K11
    // ratings in brackets may be NA, missing or mistyped ("(57/)", "(65/6500)"), or a rookie has none ("(ROOKIE)"); only
    // the 2K12 overall is read.
    const row = /^(\d{1,2})\s*[-–]\s*(.+?)(?: \([A-Z]\))? \((?:[\dNA]*\/[\dNA]*|ROOKIE)\)$/.exec(line);
    if (!row || !team || !position) throw new Error(`The 2K12 list has a line it cannot read: ${JSON.stringify(line)}`);
    players.push({ n: row[2], o: Number(row[1]), p: position, t: team });
  }
  const teams = new Set(players.map(p => p.t));
  const missing = Object.values(nicknames).filter(code => !teams.has(code));
  if (missing.length) throw new Error(`The 2K12 list has no players for ${missing.join(', ')}`);
  return players;
}

// ---------- the seasons before NBA 2K ----------

/** A name as two lists may spell it: no accents, case, dots or apostrophes, no closing Jr. or III; hyphens as spaces. */
export const nameKey = name => String(name).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[.'’]/g, '').replace(/-/g, ' ').replace(/\s+/g, ' ').trim().replace(/ (?:jr|sr|ii|iii|iv)$/, '');

const decodeEntities = text => text.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&(amp|quot|apos|lt|gt|nbsp);/g, (_, name) => ({ amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' })[name]);

/**
 * A 2kratings.com MyNBA Eras page (https://www.2kratings.com/mynba-eras/<era>), read as data: under each team card's
 * title, one table row per player with his name, 2K's position and 2K's overall. `teams` maps each card's team name to
 * the manifest's code. Returns the YEARS shape `[{ n, o, p, t }]`; throws on a team it does not know, a card without
 * players or an overall that is not a whole number 1-99.
 */
export function parseErasPage(html, teams) {
  const cards = [...html.matchAll(/<span class="h5 card-title">([^<]*)<\/span>/g)].map(m => ({ team: decodeEntities(m[1]).trim(), at: m.index }));
  if (!cards.length) throw new Error('The 2kratings page has no team cards');
  const players = [];
  cards.forEach((card, i) => {
    if (!Object.hasOwn(teams, card.team)) throw new Error(`The 2kratings page has a team the manifest does not know: ${card.team}`);
    const body = html.slice(card.at, i + 1 < cards.length ? cards[i + 1].at : html.length);
    const rows = [...body.matchAll(/<span class="entry-font entry-font-narrow">([^<]*)<small class="entry-pos">([^<]*)<\/small><\/span><\/div><\/td><td>\s*<span data-order="([\d.]+)"[^>]*>(\d+)<\/span>/g)];
    if (!rows.length) throw new Error(`The 2kratings page lists no players for ${card.team}`);
    for (const [, name, position, order, shown] of rows) {
      const o = Number(shown);
      if (!Number.isInteger(o) || o < 1 || o > 99 || Number(order) !== o) throw new Error(`${card.team}: ${name} has overall ${order}`);
      players.push({ n: decodeEntities(name).replace(/\s+/g, ' ').trim(), o, p: position.trim(), t: teams[card.team] });
    }
  });
  const missing = [...new Set(Object.values(teams))].filter(code => !players.some(p => p.t === code));
  if (missing.length) throw new Error(`The 2kratings page has no card for ${missing.join(', ')}`);
  return players;
}

/**
 * A dBase III table (NBA Live 99's PLAYERS.DBF and TEAMS.DBF), read as data: its `fields` and `rows`, each row an
 * object of the fields' text, trimmed, rows marked deleted left out. Throws on anything but a dBase III file.
 */
export function readDbf(buffer) {
  if (buffer.length < 33 || buffer[0] !== 0x03) throw new Error('Not a dBase III table');
  const count = buffer.readUInt32LE(4), headerLength = buffer.readUInt16LE(8), recordLength = buffer.readUInt16LE(10);
  const fields = [];
  let offset = 1;
  for (let at = 32; buffer[at] !== 0x0d; at += 32) {
    if (at + 32 > headerLength) throw new Error('The dBase table\'s field list never ends');
    const length = buffer[at + 16];
    fields.push({ name: buffer.toString('latin1', at, at + 11).replace(/\0[\s\S]*$/, ''), type: String.fromCharCode(buffer[at + 11]), length, offset });
    offset += length;
  }
  if (offset !== recordLength || headerLength + count * recordLength > buffer.length) throw new Error('The dBase table\'s records do not fit its header');
  const rows = [];
  for (let r = 0; r < count; r++) {
    const start = headerLength + r * recordLength;
    if (buffer[start] === 0x2a) continue;
    rows.push(Object.fromEntries(fields.map(f => [f.name, buffer.toString('latin1', start + f.offset, start + f.offset + f.length).trim()])));
  }
  return { fields, rows };
}

// NBA Live 99's POSITION and POSITION2 codes; POSITION2 -1 is none.
const LIVE_POSITIONS = ['C', 'PF', 'SF', 'SG', 'PG'];

/**
 * NBA Live 99's players, read from its roster files (PLAYERS.DBF and TEAMS.DBF, readDbf's rows): each player's name
 * (FNAME NAME), EA's computed overall (OVERALLRTG, `raw`), position (POSITION/POSITION2) and team. `teams` maps each
 * TEAMS.DBF ABBREV to the manifest's code; `others` lists the teams that are no NBA club (free agents, All-Stars), whose
 * players are left out. Returns `[{ n, raw, p, t }]`; throws on a team or position it does not know.
 */
export function parseLive99(players, teams, { codes, others = [] }) {
  const teamOf = new Map();
  for (const team of teams) {
    if (Object.hasOwn(codes, team.ABBREV)) teamOf.set(team.TEAMNUM, codes[team.ABBREV]);
    else if (!others.includes(team.ABBREV)) throw new Error(`NBA Live 99 has a team the manifest does not know: ${team.ABBREV} (${team.CITYNAME} ${team.TEAMNAME})`);
  }
  const missing = Object.values(codes).filter(code => ![...teamOf.values()].includes(code));
  if (missing.length) throw new Error(`NBA Live 99 has no team for ${missing.join(', ')}`);
  const out = [];
  for (const row of players) {
    if (!teamOf.has(row.TEAM)) {
      if (!teams.some(team => team.TEAMNUM === row.TEAM)) throw new Error(`NBA Live 99: ${row.FNAME} ${row.NAME} plays for team ${row.TEAM}, which TEAMS.DBF does not list`);
      continue;
    }
    const first = LIVE_POSITIONS[Number(row.POSITION)], second = Number(row.POSITION2) < 0 ? null : LIVE_POSITIONS[Number(row.POSITION2)];
    const raw = Number(row.OVERALLRTG);
    if (!first || (second === undefined) || !/^-?\d+$/.test(row.POSITION2)) throw new Error(`NBA Live 99: ${row.FNAME} ${row.NAME} has position ${row.POSITION}/${row.POSITION2}`);
    if (!Number.isInteger(raw) || raw < 1 || raw > 99) throw new Error(`NBA Live 99: ${row.FNAME} ${row.NAME} has overall ${row.OVERALLRTG}`);
    out.push({ n: `${row.FNAME} ${row.NAME}`.replace(/\s+/g, ' ').trim(), raw, p: second ? `${first}/${second}` : first, t: teamOf.get(row.TEAM) });
  }
  return out;
}

/** A CSV file's rows, as arrays of fields; quoted fields may hold commas, quotes ("") and line breaks. */
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c !== '"') field += c;
      else if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/**
 * Basketball-Reference's player seasons, from Sumitro Datta's 'Player Totals.csv' (one row per player, season and team,
 * plus his total over several teams, team '2TM', '3TM'...): `[{ season, league, name, team, games, minutes }]`,
 * `season` the year it ends.
 */
export function readPlayerSeasons(csv) {
  const [head, ...rows] = parseCsv(csv);
  const at = Object.fromEntries(head.map((name, i) => [name, i]));
  for (const name of ['season', 'lg', 'player', 'team', 'g', 'mp']) if (!(name in at)) throw new Error(`Player Totals.csv has no ${name} column`);
  return rows.filter(row => row.length === head.length).map(row => ({ season: Number(row[at.season]), league: row[at.lg],
    name: row[at.player], team: row[at.team], games: Number(row[at.g]), minutes: Number(row[at.mp]) }));
}

const isTotal = team => /^(?:TOT|\dTM)$/.test(team);

/**
 * The real players of a source's rosters, by Basketball-Reference's seasons (`playerSeasons`, readPlayerSeasons' rows).
 * `rule: 'club'`: a player stays if he played for his own club in season `season` (`codes` maps a manifest code to
 * Basketball-Reference's where they differ), under his own name or the spelling `aliases` gives it (by name). `roster`
 * names, by '<code> <listed name>', the players a source lists by an initial ('M. Johnson'): each entry's `name` is the
 * real player the game shows, `bref` his name there if it differs; one who did not play for the club that season stays
 * only with the manifest's `note` saying he was on its roster, and only if Basketball-Reference has him in the NBA the
 * season before or after. `rule: 'league'`: a player stays if he played in the NBA in any season. Everyone else, a
 * made-up bench filler or a player who was not on that club, is left out. Returns `{ kept, leftOut, named }`, `kept`
 * with each player's real name; throws on an alias or roster entry that names no listed player or does not hold.
 */
export function realPlayers(players, playerSeasons, { season, rule, codes = {}, aliases = {}, roster = {} }) {
  if (!['club', 'league'].includes(rule)) throw new Error(`Unknown rule ${rule}`);
  const rows = playerSeasons.filter(row => row.league === 'NBA' && row.games > 0);
  const onClub = new Set(rows.filter(row => row.season === season && !isTotal(row.team)).map(row => `${nameKey(row.name)}|${row.team}`));
  const inLeague = new Set(rows.map(row => nameKey(row.name)));
  const near = new Set(rows.filter(row => Math.abs(row.season - season) === 1).map(row => nameKey(row.name)));
  for (const name of Object.keys(aliases)) {
    const listed = players.filter(p => p.n === name).length;
    if (listed !== 1) throw new Error(`The alias of ${name} matches ${listed} players`);
  }
  for (const key of Object.keys(roster)) if (!players.some(p => `${p.t} ${p.n}` === key)) throw new Error(`The roster entry ${key} names no listed player`);
  const kept = [], leftOut = [], named = [];
  for (const p of players) {
    const entry = roster[`${p.t} ${p.n}`];
    const real = entry ? entry.bref ?? entry.name : aliases[p.n] ?? p.n;
    const club = `${nameKey(real)}|${codes[p.t] ?? p.t}`;
    if (entry) {
      if (rule !== 'club') throw new Error(`${p.n}: roster entries are for rule 'club'`);
      const played = onClub.has(club);
      if (!played && !(entry.note && near.has(nameKey(real)))) {
        throw new Error(`${p.n} (${p.t}) is not ${real}: he did not play for the club in ${seasonOf(season)}, and the manifest shows no roster place or NBA seasons around it`);
      }
      kept.push({ ...p, n: entry.name });
      named.push(`${p.n} (${p.t}) is ${entry.name}${entry.bref ? ` (Basketball-Reference's ${entry.bref})` : ''}${played ? '' : `: did not play for the club in ${seasonOf(season)}; ${entry.note}`}`);
    } else if (rule === 'club' ? onClub.has(club) : inLeague.has(nameKey(real))) {
      kept.push(p);
      if (Object.hasOwn(aliases, p.n)) named.push(`${p.n} (${p.t}) is Basketball-Reference's ${aliases[p.n]}`);
    } else leftOut.push(p);
  }
  return { kept, leftOut, named };
}

/**
 * Why each left-out player is: a player Basketball-Reference has in the NBA that season under his initial and surname
 * (any club), or none, as `'R. Adams (ATL, PF 66)'`, `'C. Johnson (LAL, SG 70): Clay Johnson played for SEA'`.
 */
export function leftOutNotes(leftOut, playerSeasons, season, codes = {}) {
  const rows = playerSeasons.filter(row => row.league === 'NBA' && row.season === season && row.games > 0 && !isTotal(row.team));
  const back = Object.fromEntries(Object.entries(codes).map(([ours, theirs]) => [theirs, ours]));
  return leftOut.map(p => {
    const rating = p.raw ?? p.o;
    const [, initial, surname] = /^([A-Z])[A-Z.]*\.? (.+)$/.exec(p.n) ?? [];
    const same = rows.filter(row => (initial ? nameKey(row.name).startsWith(initial.toLowerCase()) && nameKey(row.name).endsWith(` ${nameKey(surname)}`)
      : nameKey(row.name) === nameKey(p.n)));
    const elsewhere = [...new Set(same.map(row => `${row.name} played for ${back[row.team] ?? row.team}`))];
    return `${p.n} (${p.t}, ${p.p} ${rating})${elsewhere.length ? `: ${elsewhere.join('; ')}` : ''}`;
  });
}

/**
 * The real players Basketball-Reference has playing at least `minutes` for a club in `season` whom a source does not
 * list at all (2K's eras leave out the players it has no licence for, and list opening night's rosters): `'PHI Andrew
 * Toney (2556 min)'`, by club and name.
 */
export function notListed(players, playerSeasons, season, { codes = {}, minutes = 1000, aliases = {}, roster = {} } = {}) {
  const listed = new Set(players.map(p => nameKey(roster[`${p.t} ${p.n}`]?.bref ?? roster[`${p.t} ${p.n}`]?.name ?? aliases[p.n] ?? p.n)));
  const back = Object.fromEntries(Object.entries(codes).map(([ours, theirs]) => [theirs, ours]));
  return playerSeasons.filter(row => row.league === 'NBA' && row.season === season && !isTotal(row.team) && row.minutes >= minutes
    && !listed.has(nameKey(row.name)))
    .map(row => ({ team: back[row.team] ?? row.team, name: row.name, minutes: row.minutes }))
    .sort((a, b) => a.team.localeCompare(b.team) || a.name.localeCompare(b.name))
    .map(row => `${row.team} ${row.name} (${row.minutes} min)`);
}

/** How far `map(raw)` falls from the other scale on `pairs`: mean absolute and root mean square error, and mean bias. */
export function scaleError(pairs, map) {
  const errors = pairs.map(([raw, other]) => map(raw) - other);
  const mean = values => values.reduce((sum, v) => sum + v, 0) / values.length;
  const two = v => Math.round(v * 100) / 100;
  return { players: pairs.length, meanAbsolute: two(mean(errors.map(Math.abs))), rootMeanSquare: two(Math.sqrt(mean(errors.map(e => e * e)))),
    bias: two(mean(errors)) };
}

/** The least-squares line through `pairs` ([x, y]): `{ intercept, slope, correlation }`. */
export function fitLine(pairs) {
  if (pairs.length < 2) throw new Error('A line needs at least two players');
  const xs = pairs.map(([x]) => x), ys = pairs.map(([, y]) => y);
  const mean = values => values.reduce((sum, v) => sum + v, 0) / values.length;
  const mx = mean(xs), my = mean(ys);
  const sxy = xs.reduce((sum, x, i) => sum + (x - mx) * (ys[i] - my), 0), sxx = xs.reduce((sum, x) => sum + (x - mx) ** 2, 0);
  const syy = ys.reduce((sum, y) => sum + (y - my) ** 2, 0);
  if (!(sxx > 0) || !(syy > 0)) throw new Error('A line needs players rated differently');
  const slope = sxy / sxx;
  return { intercept: my - slope * mx, slope, correlation: sxy / Math.sqrt(sxx * syy) };
}

/**
 * A raw overall on the game's scale by the manifest's line, `{ intercept, slope }`: round(intercept + slope × raw),
 * worked in thousandths so that no float decides a rounding.
 */
export const onLine = ({ intercept, slope }) => raw => Math.round((Math.round(intercept * 1000) + Math.round(slope * 1000) * raw) / 1000);

/**
 * NBA Live 99's overalls on NBA 2K's scale: the players both NBA Live 99 (`players`, raw overalls) and NBA 2K (`others`,
 * 2K Archive's edition `scale.year`) rate, matched by name or the alias the season gives, each once, are fitted with one
 * straight line by least squares, and the manifest's `scale` must be that line (intercept to 0.01, slope to 0.001).
 * Every rating is then onLine(scale)(raw): one line, so no player passes another. Returns `{ map, table, check }`: the
 * map, every raw overall the rosters hold with its rating, and how the line does on the common players, beside the line
 * fitted on each half of them alone (checked on the other) and the raw overall plus 30.
 */
export function liveScale(players, others, scale, aliases = {}) {
  const count = list => list.reduce((map, key) => map.set(key, (map.get(key) ?? 0) + 1), new Map());
  const ours = count(players.map(p => nameKey(aliases[p.n] ?? p.n))), theirs = count(others.map(p => nameKey(p.n)));
  const rating = new Map(others.map(p => [nameKey(p.n), p.o]));
  const pairs = players.map(p => [nameKey(aliases[p.n] ?? p.n), p]).filter(([key]) => ours.get(key) === 1 && theirs.get(key) === 1)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([key, p]) => [p.raw, rating.get(key)]);
  const fit = fitLine(pairs);
  const shown = { intercept: Math.round(fit.intercept * 100) / 100, slope: Math.round(fit.slope * 1000) / 1000 };
  if (shown.intercept !== scale.intercept || shown.slope !== scale.slope) {
    throw new Error(`The line through the ${pairs.length} players both editions rate is ${shown.intercept} + ${shown.slope} × raw, not the manifest's ${scale.intercept} + ${scale.slope} × raw`);
  }
  if (!(scale.slope > 0)) throw new Error('The line must keep every player\'s order');
  const map = onLine(scale);
  const halves = [pairs.filter((_, i) => i % 2 === 0), pairs.filter((_, i) => i % 2 === 1)];
  const half = list => { const line = fitLine(list); return onLine(line); };
  const raws = [...new Set(players.map(p => p.raw))].sort((a, b) => a - b);
  return {
    map,
    table: Object.fromEntries(raws.map(raw => [raw, map(raw)])),
    check: {
      common: pairs.length,
      correlation: Math.round(fit.correlation * 1000) / 1000,
      line: scaleError(pairs, map),
      splitHalves: [scaleError(halves[1], half(halves[0])), scaleError(halves[0], half(halves[1]))],
      rawPlus30: { ...scaleError(pairs, raw => raw + 30), above99: raws.filter(raw => raw + 30 > 99).length },
    },
  };
}

/**
 * The manifest (scripts/data/nba-seasons.json), the arenas (scripts/data/nba-arenas.json) and the pinned page's whole
 * table, read from data-src/bball-2karchive/ (ignored) after checking it is the pinned copy. A season of the manifest's
 * `extra` without a `format` (NBA 2K12) comes from its own pinned page instead, in data-src/<folder>/; those with a
 * `format` are readSeasonSources'.
 */
export async function readArchive(root) {
  const manifest = JSON.parse(await readFile(path.join(root, 'scripts/data/nba-seasons.json'), 'utf8'));
  const arenas = JSON.parse(await readFile(path.join(root, 'scripts/data/nba-arenas.json'), 'utf8')).clubs;
  const years = extractYears((await pinnedFile(root, 'bball-2karchive', manifest.source)).toString('utf8'));
  const archived = {};
  for (const [year, source] of Object.entries(manifest.extra || {})) {
    if (source.format) continue;
    archived[year] = years[year] ?? [];
    years[year] = parseInsiderRatings((await pinnedFile(root, source.folder, source)).toString('utf8'), source.nicknames);
  }
  return { manifest, arenas, years, archived };
}

/** data-src/<folder>/<file>, after checking it is the copy `sha256` pins. */
async function pinnedFile(root, folder, source, file = source.file, sha256 = source.sha256) {
  const bytes = await readFile(path.join(root, 'data-src', folder, file));
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== sha256) throw new Error(`data-src/${folder}/${file} is not the pinned copy (SHA-256 ${actual}); save ${source.capture ?? source.url} there`);
  return bytes;
}

/**
 * The players of each season of the manifest's `extra` with a `format`, read from its pinned sources in data-src/:
 * `{ [year]: { players, rows, leftOut, named, notListed?, scale? } }`, `players` in the YEARS shape. 'mynba-eras' is a
 * 2kratings MyNBA Eras page (parseErasPage), checked club by club (realPlayers' rule 'club'), with the real players it
 * does not list (notListed); 'nba-live-dbf' NBA Live 99's PLAYERS.DBF and TEAMS.DBF (parseLive99), checked for real NBA
 * players (rule 'league'), its overalls put on NBA 2K's scale by the manifest's line (liveScale) against 2K Archive's
 * `years`. Basketball-Reference's seasons are the manifest's pinned `check`.
 */
export async function readSeasonSources(root, manifest, years) {
  const sources = {};
  let playerSeasons = null;
  for (const [year, source] of Object.entries(manifest.extra || {})) {
    if (!source.format) continue;
    playerSeasons ??= readPlayerSeasons((await pinnedFile(root, manifest.check.folder, manifest.check)).toString('utf8'));
    const options = { season: Number(year), rule: source.rule, codes: manifest.check.codes, aliases: source.aliases, roster: source.roster };
    if (source.format === 'mynba-eras') {
      const rows = parseErasPage((await pinnedFile(root, source.folder, source)).toString('utf8'), source.teams);
      const { kept, leftOut, named } = realPlayers(rows, playerSeasons, options);
      sources[year] = { players: kept, rows: rows.length, named, leftOut: leftOutNotes(leftOut, playerSeasons, Number(year), manifest.check.codes),
        notListed: notListed(rows, playerSeasons, Number(year), { ...options, minutes: manifest.check.rotation }) };
    } else if (source.format === 'nba-live-dbf') {
      for (const [file, sha256] of Object.entries(source.archive ?? {})) await pinnedFile(root, source.folder, source, file, sha256);
      const table = async name => readDbf(await pinnedFile(root, source.folder, source, source.files[name].file, source.files[name].sha256)).rows;
      const rows = parseLive99(await table('players'), await table('teams'), { codes: source.teams, others: source.others });
      const { kept, leftOut, named } = realPlayers(rows, playerSeasons, options);
      const scale = liveScale(kept, (years[String(source.scale.year)] || []).filter(p => p.t !== 'FA'), source.scale, source.aliases);
      sources[year] = { players: kept.map(p => ({ n: p.n, o: scale.map(p.raw), p: p.p, t: p.t, raw: p.raw })), rows: rows.length, named,
        leftOut: leftOut.map(p => `${p.n} (${p.t}, ${p.p} ${p.raw})`), scale };
    } else throw new Error(`Unknown source format ${source.format} for ${year}`);
  }
  return sources;
}

/** How many of a season's players another list rates the same, on the same team: `{ shared, same, differ: [...] }`. */
export function agreement(players, others) {
  const byName = new Map(others.map(p => [`${p.t} ${p.n}`, p]));
  const differ = [];
  let shared = 0;
  for (const p of players) {
    const other = byName.get(`${p.t} ${p.n}`);
    if (!other) continue;
    shared++;
    if (other.o !== p.o) differ.push(`${p.n} (${p.t}) ${p.o}, 2K Archive ${other.o}`);
  }
  return { shared, same: shared - differ.length, differ };
}

/**
 * The teams of season `year` from the manifest (scripts/data/nba-seasons.json), as `{ code, id, name, city, arena,
 * home }`. A team that kept its name and city takes its city and arena from `arenas` (scripts/data/nba-arenas.json,
 * by club id); one that has moved since names its own.
 */
export function teamsOf(manifest, year, arenas) {
  const teams = [];
  for (const [code, eras] of Object.entries(manifest.teams)) {
    const era = eras.find(e => (e.from ?? -Infinity) <= year && year <= (e.to ?? Infinity));
    if (!era) continue;
    const here = era.home ? era : arenas[era.id];
    if (!here) throw new Error(`No arena for ${era.name} in ${year}`);
    teams.push({ code, id: era.id, name: era.name, city: here.city, arena: here.arena, home: here.home });
  }
  return teams;
}

/** The era map season `year` plays on. */
export function mapOf(manifest, year) {
  const map = manifest.maps.find(m => m.seasons.includes(year));
  if (!map) throw new Error(`No map for the season ending ${year}`);
  return map.id;
}

/** 'SF/PF' → ['SF', 'PF']; a second position that is not the first's neighbour is dropped, as the game allows. */
export function positionsOf(listed) {
  const [first, second] = String(listed).split('/');
  if (!POSITIONS.includes(first)) return null;
  if (second == null || !POSITIONS.includes(second) || Math.abs(POSITIONS.indexOf(first) - POSITIONS.indexOf(second)) !== 1) return [first];
  return [first, second];
}

/**
 * A pool's best five, the strongest lineup its positions allow (build-clubs' startingFive), and any of them the lineup
 * plays out of position, as 'Clark Kellogg (SF) at PF'.
 */
function startingFive(pool) {
  const byRating = pool.slice().sort((a, b) => b.rating - a.rating || a.name.localeCompare(b.name));
  const { starters } = selectLineup({ sport: 'basketball', squad: byRating });
  return {
    five: starters.map(starter => byRating[starter.originalIndex]).sort((a, b) => b.rating - a.rating || a.name.localeCompare(b.name)),
    offPosition: starters.filter(starter => starter.outOfPosition)
      .map(starter => `${byRating[starter.originalIndex].name} (${byRating[starter.originalIndex].positions.join('/')}) at ${starter.assignedPos}`),
  };
}

/**
 * The clubs of season `year`, strongest first, each with its best five as `[name, 'PG/SG', rating]`, as both the
 * season files and the built-in clubs (scripts/build-clubs.mjs) hold them. `years` is the page's whole table (a player
 * whose position is blank takes the one 2K gave him in the nearest edition, earlier first); `builtIn` are the game's
 * NBA clubs, whose codes and colours a club that kept its id keeps. Returns `{ clubs, rows, filled, dropped, narrowed,
 * outOfPosition, warnings }`; throws when the edition's teams are not the manifest's.
 */
export function nbaSeasonClubs(years, year, manifest, { arenas, builtIn = [] }) {
  const warnings = [];
  const players = years[String(year)];
  const label = labelOf(manifest, year);
  if (!Array.isArray(players)) throw new Error(`2K Archive has no ${label}`);
  const teams = teamsOf(manifest, year, arenas);
  const byCode = new Map(teams.map(team => [team.code, team]));
  const codes = new Set(players.map(p => p.t).filter(code => code !== 'FA'));
  const unknown = [...codes].filter(code => !byCode.has(code));
  const absent = teams.filter(team => !codes.has(team.code)).map(team => team.code);
  if (unknown.length || absent.length) throw new Error(`${label}: teams ${unknown.join(', ') || 'none'} are not the manifest's; missing ${absent.join(', ') || 'none'}`);

  // A blank position takes the player's own from the nearest edition that lists him.
  const nearest = name => {
    for (let d = 1; d <= 30; d++) {
      for (const other of [year - d, year + d]) {
        const listed = (years[String(other)] || []).find(p => p.n === name && positionsOf(p.p));
        if (listed) return { positions: positionsOf(listed.p), from: other };
      }
    }
    return null;
  };
  const filled = [], dropped = [], narrowed = [];
  const pools = new Map(teams.map(team => [team.code, []]));
  for (const p of players) {
    if (p.t === 'FA') continue;
    if (!Number.isInteger(p.o) || p.o < 1 || p.o > 99 || typeof p.n !== 'string' || !p.n.trim()) {
      throw new Error(`${label}: player ${JSON.stringify(p)} has no name or a rating outside 1-99`);
    }
    let positions = positionsOf(p.p);
    if (!positions && p.p) throw new Error(`${label}: ${p.n} has position ${JSON.stringify(p.p)}`);
    if (!positions) {
      const near = nearest(p.n);
      if (!near) { dropped.push(p.n); continue; }
      positions = near.positions;
      filled.push(`${p.n} ${positions.join('/')} (${editionOf(near.from)})`);
    } else if (String(p.p).includes('/') && positions.length === 1) narrowed.push(`${p.n} ${p.p}`);
    pools.get(p.t).push({ name: p.n.trim(), pos: positions[0], positions, rating: p.o });
  }

  const known = new Map(builtIn.map(club => [club.id, club]));
  const taken = new Set(teams.filter(team => known.has(team.id)).map(team => known.get(team.id).code));
  const outOfPosition = [];
  const clubs = teams.map(team => {
    const { five: squad, offPosition } = startingFive(pools.get(team.code));
    if (squad.length < FIVE) throw new Error(`${label}: ${team.name} has ${squad.length} players`);
    outOfPosition.push(...offPosition.map(note => `${team.name}: ${note}`));
    const club = known.get(team.id);
    return { id: team.id, name: team.name, code: club ? club.code : makeCode(team.name, taken), league: 'NBA', country: '840',
      col: club ? club.col : colourFor(team.id), str: Math.round(squad.reduce((sum, p) => sum + p.rating, 0) / squad.length),
      squad: squad.map(p => [p.name, p.positions.join('/'), p.rating]) };
  }).sort((a, b) => b.str - a.str || a.name.localeCompare(b.name));
  if (dropped.length) warnings.push(`${dropped.length} players with no position in any edition were left out`);
  return { clubs, rows: players.length, filled, dropped, narrowed, outOfPosition: outOfPosition.sort(), warnings };
}

/**
 * Build season `year` (nbaSeasonClubs' clubs, in the data set format). A season of the manifest's `extra` takes its
 * id, label, edition, provider and compiler from there; `source` is readSeasonSources' account of it, for the audit
 * (rows read, players left out and named, real players its rosters lack, NBA Live 99's line). Returns
 * `{ doc, text, audit, warnings }`.
 */
export function buildNbaSeason(years, year, manifest, { arenas, builtIn = [], archived = {}, source = null }) {
  const { clubs, rows, filled, dropped, narrowed, outOfPosition, warnings } = nbaSeasonClubs(years, year, manifest, { arenas, builtIn });
  // A season of the manifest's `extra` credits its own compiler (NBA 2K12: The Real 2K Insider), and one from another
  // game names its own id, label, edition and maker. A computed season credits Basketball-Reference and the copy of its
  // tables it was computed from.
  const extra = manifest.extra?.[String(year)];
  const computed = !extra && isComputed(manifest, year) ? manifest.computed : null;
  const compiled = extra ?? computed ?? manifest.source;
  const edition = extra?.edition ?? (computed ? `${seasonOf(year)} NBA regular season` : editionOf(year));
  // Another game's overalls put on NBA 2K's scale (NBA Live 99's) say so, with the line; a computed season says how.
  const scale = extra?.scale;
  const conversion = scale ? { conversion: `round(${scale.intercept} + ${scale.slope} * raw): the least-squares line of ${scale.edition}'s overall `
    + `(${seasonOf(scale.year)}) on ${edition}'s, through the players both rate` }
    : computed ? { method: 'computed', conversion: computedConversion(computed) } : {};
  const doc = { format: 1, kind: 'nba2k', id: setIdOf(manifest, year), version: '', year, season: seasonOf(year), label: labelOf(manifest, year), local: false,
    source: { provider: extra?.provider ?? computed?.provider ?? '2K Sports', edition, compiler: compiled.name, url: compiled.url, rawScale: 99, ...conversion },
    map: mapOf(manifest, year), clubs, coverage: { players: clubs.length * FIVE, clubs: clubs.length } };
  doc.version = `${doc.id}-${contentHash(doc)}`;
  const checked = archived[String(year)] ? { checkedAgainst2KArchive: agreement(years[String(year)], archived[String(year)]) } : {};
  const teams = teamsOf(manifest, year, arenas);
  const told = !source ? {} : source.computed ? computedAudit(source, clubs, doc, teams) : sourceAudit(source, clubs, doc, teams);
  const audit = { id: doc.id, version: doc.version, edition, rows, map: doc.map, clubs: clubs.length,
    filledPositions: filled, droppedNoPosition: dropped, narrowedPositions: narrowed.length, ...checked,
    ...(outOfPosition.length ? { outOfPosition } : {}), ...told, warnings };
  return { doc, text: serializeFootballSet(doc), audit, warnings };
}

/**
 * What the audit says of a season from another source: its rows, the players it names, leaves out or lacks, and for
 * NBA Live 99 its line, with each five's raw overalls beside their ratings.
 */
function sourceAudit(source, clubs, doc, teams) {
  const codeOf = new Map(teams.map(team => [team.id, team.code]));
  const raw = new Map(source.players.filter(p => p.raw != null).map(p => [`${p.t}|${p.n}`, p.raw]));
  const rawOf = (club, name) => {
    const value = raw.get(`${codeOf.get(club.id)}|${name}`);
    if (value == null) throw new Error(`${club.name}: no raw overall for ${name}`);
    return value;
  };
  return {
    label: doc.label,
    sourceRows: source.rows,
    kept: source.players.length,
    named: source.named,
    leftOut: source.leftOut,
    ...(source.notListed ? { notListed: source.notListed } : {}),
    ...(source.scale ? {
      scale: { table: source.scale.table, check: source.scale.check,
        fives: clubs.map(club => `${club.name}: ${club.squad.map(([name, , rating]) => `${name} ${rawOf(club, name)}→${rating}`).join(', ')}`) },
    } : {}),
  };
}

// ---------- the seasons no game rated: computed from Basketball-Reference's player seasons ----------

/** The score's inputs, in the order of the manifest's coefficients. */
export const SCORE_INPUTS = Object.freeze(['per', 'ws48', 'mpg', 'mpg2', 'ppg', 'rpg', 'apg', 'allStar', 'allNba', 'dws']);
const INPUT_NAMES = { per: 'PER', ws48: 'WS/48', mpg: 'MPG', mpg2: 'MPG^2', ppg: 'PPG', rpg: 'RPG', apg: 'APG', allStar: 'All-Star',
  allNba: 'All-NBA', dws: 'DWS' };
const number = value => (value === '' || value === 'NA' || value == null ? null : Number(value));
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const average = values => values.reduce((sum, v) => sum + v, 0) / values.length;

/** A CSV table's rows as objects by its header (parseCsv), after checking it has every column of `required`. */
export function readTable(text, required = [], name = 'The table') {
  const [head = [], ...rows] = parseCsv(text);
  const missing = required.filter(column => !head.includes(column));
  if (missing.length) throw new Error(`${name} has no ${missing.join(', ')} column`);
  return rows.filter(row => row.length === head.length).map(row => Object.fromEntries(head.map((column, i) => [column, row[i]])));
}

/**
 * Basketball-Reference's NBA player seasons, read as data from Sumitro Datta's tables (`advanced`: Advanced.csv,
 * `totals`: Player Totals.csv, `allStar`: All-Star Selections.csv, `endOfSeason`: End of Season Teams.csv): one record
 * per player and season, in the tables' order (newest season first). A player who played for several clubs has a row
 * per club and a total row ('2TM', '3TM'...): his record is the total, `stints` each club in the order he played for
 * it, and `team` the club he played the most minutes for (then the most games, then the earlier). `allStar` is 1 if
 * he was picked for the All-Star Game, `allNba` the points `allNbaPoints` gives his All-NBA team ({ '1st': 3, ... }).
 */
export function brefPlayerSeasons({ advanced, totals, allStar, endOfSeason }, allNbaPoints) {
  const rows = readTable(advanced, ['season', 'lg', 'player', 'player_id', 'team', 'pos', 'g', 'mp', 'per', 'dws', 'ws_48'], 'Advanced.csv')
    .filter(row => row.lg === 'NBA');
  const lines = new Map(readTable(totals, ['season', 'lg', 'player_id', 'team', 'pts', 'trb', 'ast'], 'Player Totals.csv')
    .filter(row => row.lg === 'NBA').map(row => [`${row.season}|${row.player_id}|${row.team}`, row]));
  const stars = new Set(readTable(allStar, ['season', 'lg', 'player_id'], 'All-Star Selections.csv')
    .filter(row => row.lg === 'NBA').map(row => `${row.season}|${row.player_id}`));
  const allNba = new Map();
  for (const row of readTable(endOfSeason, ['season', 'lg', 'type', 'number_tm', 'player_id'], 'End of Season Teams.csv')) {
    if (row.lg !== 'NBA' || row.type !== 'All-NBA') continue;
    if (!Object.hasOwn(allNbaPoints, row.number_tm)) throw new Error(`End of Season Teams.csv: an All-NBA team "${row.number_tm}"`);
    const key = `${row.season}|${row.player_id}`;
    allNba.set(key, Math.max(allNba.get(key) ?? 0, allNbaPoints[row.number_tm]));
  }
  const groups = new Map();
  for (const row of rows) {
    const key = `${row.season}|${row.player_id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups].map(([key, list]) => {
    const totalRows = list.filter(row => isTotal(row.team));
    if (totalRows.length > 1 || (list.length > 1 && totalRows.length !== 1)) throw new Error(`Advanced.csv: ${key} has ${totalRows.length} total rows`);
    const whole = totalRows[0] ?? list[0];
    const stints = list.filter(row => !isTotal(row.team)).map(row => ({ team: row.team, minutes: number(row.mp) ?? 0, games: number(row.g) ?? 0 }));
    const main = stints.reduce((best, s) => (!best || s.minutes > best.minutes || (s.minutes === best.minutes && s.games > best.games) ? s : best), null);
    const line = lines.get(`${whole.season}|${whole.player_id}|${whole.team}`);
    return { season: Number(whole.season), id: whole.player_id, name: whole.player.trim(), pos: POSITIONS.includes(whole.pos) ? whole.pos : null,
      team: main.team, stints, games: number(whole.g), minutes: number(whole.mp), per: number(whole.per), ws48: number(whole.ws_48),
      dws: number(whole.dws), points: line ? number(line.pts) : null, rebounds: line ? number(line.trb) : null, assists: line ? number(line.ast) : null,
      allStar: stars.has(key) ? 1 : 0, allNba: allNba.get(key) ?? 0 };
  });
}

/**
 * The score's inputs for one player season (a brefPlayerSeasons record), by the manifest's `score.shrink`: PER and
 * WS/48 shrunk toward a bench player's by `minutes` minutes of his (a few good minutes count for little), minutes a
 * game and its square, points, rebounds and assists a game, All-Star, All-NBA and defensive win shares. Null when the
 * season lacks one of them.
 */
export function scoreInputs(record, { shrink }) {
  const { games, minutes } = record;
  const facts = [record.per, record.ws48, record.dws, record.points, record.rebounds, record.assists];
  if (!(games > 0) || !(minutes >= 0) || facts.some(value => value == null || !Number.isFinite(value))) return null;
  const k = shrink.minutes, mpg = minutes / games;
  return { per: (record.per * minutes + shrink.per * k) / (minutes + k), ws48: (record.ws48 * minutes + shrink.ws48 * k) / (minutes + k),
    mpg, mpg2: mpg * mpg, ppg: record.points / games, rpg: record.rebounds / games, apg: record.assists / games,
    allStar: record.allStar, allNba: record.allNba, dws: record.dws };
}

/** The manifest's score (`{ intercept, coefficients }`) of a player's inputs, summed in SCORE_INPUTS' order. */
export const scoreOf = ({ intercept, coefficients }) => inputs => SCORE_INPUTS.reduce((sum, name) => sum + coefficients[name] * inputs[name], intercept);

/**
 * The least-squares coefficients of `targets` on `rows` (each row starting with 1 for the intercept): the normal
 * equations, solved by Gauss-Jordan elimination with partial pivoting, every sum in the rows' order.
 */
export function leastSquares(rows, targets) {
  if (!rows.length || rows.length !== targets.length) throw new Error('Least squares needs one target per row');
  const p = rows[0].length;
  const A = Array.from({ length: p }, () => new Array(p).fill(0)), b = new Array(p).fill(0);
  for (let i = 0; i < rows.length; i++) {
    for (let j = 0; j < p; j++) {
      b[j] += rows[i][j] * targets[i];
      for (let k = 0; k < p; k++) A[j][k] += rows[i][j] * rows[i][k];
    }
  }
  for (let c = 0; c < p; c++) {
    let pivot = c;
    for (let r = c + 1; r < p; r++) if (Math.abs(A[r][c]) > Math.abs(A[pivot][c])) pivot = r;
    [A[c], A[pivot]] = [A[pivot], A[c]];
    [b[c], b[pivot]] = [b[pivot], b[c]];
    if (!(Math.abs(A[c][c]) > 0)) throw new Error('Least squares: the inputs are not independent');
    for (let r = 0; r < p; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k < p; k++) A[r][k] -= f * A[c][k];
      b[r] -= f * b[c];
    }
  }
  return b.map((v, j) => v / A[j][j]);
}

/**
 * The pairs the score is fitted on: every player an NBA 2K edition of `editions` ([first, last], from 2K Archive's
 * whole table `years`) rates, his overall as a z-score within the edition (the sample's mean and standard deviation),
 * beside his Basketball-Reference season `lag` seasons before: 2K rates a season's players from the season before. He
 * is matched by name in that season, and by club too where two players share his name; one who is not matched, or
 * whose season lacks an input (`inputsOf` null), is left out. Pairs run edition by edition, in the table's order.
 */
export function trainingPairs(years, records, { editions: [first, last], lag }, inputsOf) {
  const bySeason = new Map();
  for (const record of records) {
    if (!bySeason.has(record.season)) bySeason.set(record.season, new Map());
    const names = bySeason.get(record.season), key = nameKey(record.name);
    if (!names.has(key)) names.set(key, []);
    names.get(key).push(record);
  }
  const pairs = [];
  for (let edition = first; edition <= last; edition++) {
    const list = (years[String(edition)] || []).filter(p => Number.isInteger(p.o));
    if (list.length < 2) throw new Error(`2K Archive has no ${editionOf(edition)} to fit the score on`);
    const mean = average(list.map(p => p.o));
    const sd = Math.sqrt(list.reduce((sum, p) => sum + (p.o - mean) ** 2, 0) / (list.length - 1));
    const names = bySeason.get(edition - lag) ?? new Map();
    for (const p of list) {
      const candidates = names.get(nameKey(p.n)) ?? [];
      const record = candidates.length === 1 ? candidates[0] : candidates.find(r => r.stints.some(s => s.team === p.t));
      const inputs = record && inputsOf(record);
      if (inputs) pairs.push({ edition, rating: p.o, z: (p.o - mean) / sd, inputs, record });
    }
  }
  return pairs;
}

/** Ranks from 1, lowest first, tied values sharing their mean rank. */
function meanRanks(values) {
  const order = values.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const ranks = new Array(values.length);
  for (let i = 0; i < order.length;) {
    let j = i;
    while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++;
    for (let k = i; k <= j; k++) ranks[order[k][1]] = (i + j) / 2 + 1;
    i = j + 1;
  }
  return ranks;
}
/** Pearson's correlation of two lists. */
export function correlation(xs, ys) {
  const mx = average(xs), my = average(ys);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < xs.length; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  return sxy / Math.sqrt(sxx * syy);
}
/** Spearman's rank correlation of two lists. */
export const rankCorrelation = (xs, ys) => correlation(meanRanks(xs), meanRanks(ys));
const two = v => Math.round(v * 100) / 100;
const three = v => Math.round(v * 1000) / 1000;

/**
 * Fit the score again on the training pairs and check it is the manifest's `score`, every coefficient to six
 * significant figures, as NBA Live 99's line is checked (liveScale): the ratings use the manifest's coefficients, so a
 * later copy of a source cannot move them unseen. Returns how the fit does on its pairs.
 */
export function checkScore(pairs, score) {
  const names = Object.keys(score.coefficients);
  if (names.join() !== SCORE_INPUTS.join()) throw new Error(`The score's inputs must be ${SCORE_INPUTS.join(', ')}, in that order`);
  const beta = leastSquares(pairs.map(pair => [1, ...SCORE_INPUTS.map(name => pair.inputs[name])]), pairs.map(pair => pair.z));
  const fitted = [['intercept', beta[0], score.intercept], ...SCORE_INPUTS.map((name, i) => [name, beta[i + 1], score.coefficients[name]])];
  const differ = fitted.filter(([, value, fixed]) => Number(value.toPrecision(6)) !== fixed);
  if (differ.length) {
    throw new Error(`The score fitted on the ${pairs.length} pairs is not the manifest's: ${differ.map(([name, value, fixed]) => `${name} ${Number(value.toPrecision(6))}, not ${fixed}`).join('; ')}`);
  }
  const predicted = pairs.map(pair => scoreOf(score)(pair.inputs)), z = pairs.map(pair => pair.z);
  return { pairs: pairs.length, editions: new Set(pairs.map(pair => pair.edition)).size,
    coefficients: Object.fromEntries(fitted.map(([name, value]) => [name, Number(value.toPrecision(6))])),
    correlation: three(correlation(predicted, z)), rankCorrelation: three(rankCorrelation(predicted, z)) };
}

/** The ratings a computed season goes onto: an edition's ratings of each club's `perClub` best (free agents aside), lowest first. */
export function ratingSpread(players, perClub) {
  const byTeam = new Map();
  for (const p of players) {
    if (p.t === 'FA' || !Number.isInteger(p.o)) continue;
    if (!byTeam.has(p.t)) byTeam.set(p.t, []);
    byTeam.get(p.t).push(p.o);
  }
  const spread = [...byTeam.keys()].sort().flatMap(team => byTeam.get(team).sort((a, b) => b - a).slice(0, perClub)).sort((a, b) => a - b);
  if (!spread.length) throw new Error('The spread has no ratings');
  return spread;
}

/**
 * Check a spread against the manifest's `counts` (how many of its ratings are each rating), as the score is checked:
 * a later copy of the page whose ratings moved stops the build rather than moving every computed season.
 */
export function checkSpread(spread, counts) {
  const found = {};
  for (const rating of spread) found[rating] = (found[rating] ?? 0) + 1;
  const ratings = [...new Set([...Object.keys(found), ...Object.keys(counts ?? {})])].sort((a, b) => a - b);
  const differ = ratings.filter(rating => (found[rating] ?? 0) !== (counts?.[rating] ?? 0));
  if (differ.length) {
    throw new Error(`The spread's ratings are not the manifest's: ${differ.map(rating => `${found[rating] ?? 0} rated ${rating}, not ${counts?.[rating] ?? 0}`).join('; ')}`);
  }
  return spread;
}

/** A spread's ratings at quantiles 0, 5%, 25%, 50%, 75%, 95% and 1. */
export const spreadQuantiles = spread => Object.fromEntries([0, 0.05, 0.25, 0.5, 0.75, 0.95, 1]
  .map(q => [q, spread[Math.min(spread.length - 1, Math.floor(q * spread.length))]]));

/**
 * A computed season's ratings. Each club's `roster` players with the most minutes are its own (a traded player counts
 * once, for his `team`; equal minutes go by player id), each is scored (`inputsOf`, `scoreFor`), and the league is
 * ranked by score, lowest first, scores worked in millionths and ties going by player id. The player at rank quantile
 * q = (rank - 0.5) / N takes the `spread`'s rating at q (spread[floor(q × length)]): no player passes another, and the
 * season has the spread's shape. A player whose season lacks an input is left out (`unscored`). Returns
 * `{ rated: [{ record, inputs, score, rating }], unscored }`, rated in club and minutes order.
 */
export function rateComputedSeason(records, season, { roster, inputsOf, scoreFor, spread }) {
  const clubs = new Map();
  for (const record of records) {
    if (record.season !== season) continue;
    if (!clubs.has(record.team)) clubs.set(record.team, []);
    clubs.get(record.team).push(record);
  }
  const population = [...clubs.keys()].sort().flatMap(team => clubs.get(team).slice()
    .sort((a, b) => b.minutes - a.minutes || byText(a.id, b.id)).slice(0, roster));
  const rated = [], unscored = [];
  for (const record of population) {
    const inputs = inputsOf(record);
    if (inputs) rated.push({ record, inputs, score: scoreFor(inputs), rating: null });
    else unscored.push(record);
  }
  const micro = entry => Math.round(entry.score * 1e6);
  rated.slice().sort((a, b) => micro(a) - micro(b) || byText(a.record.id, b.record.id)).forEach((entry, i, order) => {
    entry.rating = spread[Math.floor(((2 * i + 1) * spread.length) / (2 * order.length))];
  });
  return { rated, unscored };
}

/** Every player's listed positions over his NBA seasons: id → Map of position → { minutes, latest season }. */
export function listedPositions(records) {
  const listed = new Map();
  for (const record of records) {
    if (!record.pos) continue;
    if (!listed.has(record.id)) listed.set(record.id, new Map());
    const at = listed.get(record.id).get(record.pos) ?? { minutes: 0, latest: record.season };
    listed.get(record.id).set(record.pos, { minutes: at.minutes + (record.minutes ?? 0), latest: Math.max(at.latest, record.season) });
  }
  return listed;
}

/**
 * A computed player's positions: the season's (Basketball-Reference lists PG, SG, SF, PF or C), else the first his
 * career position implies (`careerPositions`: G is PG/SG, F-C is PF/C...). The second is the neighbouring position he
 * was listed at in other seasons, the one with the most minutes there (then the latest), else the neighbour his career
 * position implies. Null when he has none: he is left out, as a 2K player with no position is.
 */
export function brefPositions(record, listed, careerPosition, careerPositions) {
  const implied = careerPositions[careerPosition] ?? [];
  const first = record.pos ?? implied[0];
  if (!POSITIONS.includes(first)) return null;
  const neighbours = POSITIONS.filter(p => Math.abs(POSITIONS.indexOf(p) - POSITIONS.indexOf(first)) === 1);
  const seen = [...(listed.get(record.id) ?? new Map())].filter(([p]) => neighbours.includes(p))
    .sort(([a, x], [b, y]) => y.minutes - x.minutes || y.latest - x.latest || POSITIONS.indexOf(a) - POSITIONS.indexOf(b));
  const second = seen[0]?.[0] ?? neighbours.find(p => implied.includes(p));
  return second ? [first, second] : [first];
}

/**
 * A computed season's players in the shape of 2K Archive's table, `[{ n, o, p, t }]` with `t` the manifest's code
 * (`codes` maps the manifest's codes to Basketball-Reference's where they differ), so nbaSeasonClubs fields each club's
 * five as it does an edition's. `rated` runs club by club, most minutes first. A five names its players by name alone,
 * so of two teammates with one name the one with fewer minutes is left out (`namesakes`). Returns `{ players,
 * noPosition, namesakes, traded, scores }`: the players left out, every traded player with the club he plays for, and
 * each player's score by '<code>|<name>'.
 */
export function computedSeasonPlayers(rated, { listed, career, careerPositions, codes = {} }) {
  const back = Object.fromEntries(Object.entries(codes).map(([ours, theirs]) => [theirs, ours]));
  const codeOf = team => back[team] ?? team;
  const players = [], noPosition = [], namesakes = [], traded = [], scores = new Map();
  for (const { record, score, rating } of rated) {
    const t = codeOf(record.team);
    if (record.stints.length > 1) {
      traded.push(`${record.name} (${record.stints.map(s => `${codeOf(s.team)} ${s.minutes} min`).join(', ')}): ${t}`);
    }
    const positions = brefPositions(record, listed, career.get(record.id), careerPositions);
    if (!positions) {
      noPosition.push(`${record.name} (${t}, ${rating})`);
      continue;
    }
    if (scores.has(`${t}|${record.name}`)) {
      namesakes.push(`${record.name} (${t}, ${rating}, ${record.minutes} min; Basketball-Reference's ${record.id})`);
      continue;
    }
    scores.set(`${t}|${record.name}`, score);
    players.push({ n: record.name, o: rating, p: positions.join('/'), t });
  }
  return { players, noPosition, namesakes, traded, scores };
}

/**
 * What a computed season's source says of how its ratings were made: the score, how it was fitted, and the rule that
 * puts it on NBA 2K's scale.
 */
export function computedConversion({ score, roster, spread }) {
  const c = score.coefficients, s = score.shrink, points = Object.entries(score.allNba);
  const terms = SCORE_INPUTS.map(name => `${c[name] < 0 ? '-' : '+'} ${Math.abs(c[name])} * ${INPUT_NAMES[name]}`).join(' ');
  return `computed: score = ${score.intercept} ${terms}, PER and WS/48 shrunk toward ${s.per} and ${s.ws48} by ${s.minutes} minutes, `
    + `All-NBA ${points.map(([, value]) => value).join(', ')} for the ${points.map(([team]) => team).join(', ')} team; fitted by least squares on `
    + `NBA 2K's overall (a z-score within each edition, ${editionOf(score.training.editions[0])} to ${editionOf(score.training.editions[1])}, 2K Archive) `
    + `against each player's season before; each club's ${roster} players with the most minutes ranked by score and given `
    + `${editionOf(spread.edition)}'s ratings of each club's ${spread.perClub} best, rank for rank`;
}

/**
 * The seasons of the manifest's `computed`, read from its pinned copy of Basketball-Reference's tables in
 * data-src/<folder>/: the score is fitted again on 2K Archive's whole table (`years`, NBA 2K12 its own) and checked
 * against the manifest's (checkScore), and so is the spread (checkSpread); each season is rated onto the spread
 * (rateComputedSeason) and its players put in the table's shape (computedSeasonPlayers). Each season's franchises must have Basketball-Reference's names for its
 * teams, and src/data/nbaLeagueAverages.js (`leagueAverages`) its league averages. The audit's checks rate the MyNBA
 * Eras seasons the same way and compare with 2K's own ratings (`sources`, readSeasonSources'). Returns
 * `{ seasons: { [year]: source }, summary }`, or null without a `computed`.
 */
export async function readComputedSources(root, manifest, years, { arenas = {}, sources = {}, leagueAverages = {} } = {}) {
  const computed = manifest.computed;
  if (!computed) return null;
  const text = async name => (await pinnedFile(root, computed.folder, computed, computed.files[name].file, computed.files[name].sha256)).toString('utf8');
  const records = brefPlayerSeasons({ advanced: await text('advanced'), totals: await text('totals'), allStar: await text('allStar'),
    endOfSeason: await text('endOfSeason') }, computed.score.allNba);
  const career = new Map(readTable(await text('career'), ['player_id', 'pos'], 'Player Career Info.csv').map(row => [row.player_id, row.pos]));
  const summaries = readTable(await text('summaries'), ['season', 'lg', 'team', 'abbreviation', 'srs', 'pace', 'o_rtg'], 'Team Summaries.csv')
    .filter(row => row.lg === 'NBA');
  const perGame = readTable(await text('perGame'), ['season', 'lg', 'team', 'pts_per_game'], 'Team Stats Per Game.csv').filter(row => row.lg === 'NBA');
  const inputsOf = record => scoreInputs(record, computed.score);
  const scoreFor = scoreOf(computed.score);
  const fit = checkScore(trainingPairs(years, records, computed.score.training, inputsOf), computed.score);
  const spread = checkSpread(ratingSpread(years[String(computed.spread.edition)] || [], computed.spread.perClub), computed.spread.counts);
  const listed = listedPositions(records);
  const options = { roster: computed.roster, inputsOf, scoreFor, spread };
  const codes = manifest.check?.codes ?? {};
  const back = Object.fromEntries(Object.entries(codes).map(([ours, theirs]) => [theirs, ours]));

  const seasons = {};
  for (const year of computed.seasons) {
    const label = seasonOf(year);
    // The franchises of the season are Basketball-Reference's teams, by name.
    const teams = summaries.filter(row => Number(row.season) === year && row.team !== 'League Average');
    const ours = new Map(teamsOf(manifest, year, arenas).map(team => [team.code, team.name]));
    const named = teams.map(row => [back[row.abbreviation] ?? row.abbreviation, row.team]);
    const differ = named.filter(([code, name]) => ours.get(code) !== name);
    if (differ.length || named.length !== ours.size) {
      throw new Error(`${label}: Basketball-Reference's teams (${named.map(([code, name]) => `${code} ${name}`).join(', ')}) are not the manifest's`);
    }
    // Its league averages are the game's.
    const league = summaries.find(row => Number(row.season) === year && row.team === 'League Average');
    const points = perGame.find(row => Number(row.season) === year && row.team === 'League Average');
    const averages = league && points && { pace: Number(league.pace), rating: Number(league.o_rtg), points: Number(points.pts_per_game) };
    const game = leagueAverages[label];
    if (!averages || !game || ['pace', 'rating', 'points'].some(key => game[key] !== averages[key])) {
      throw new Error(`${label}: src/data/nbaLeagueAverages.js has ${JSON.stringify(game ?? null)}, Basketball-Reference ${JSON.stringify(averages ?? null)}`);
    }
    const { rated, unscored } = rateComputedSeason(records, year, options);
    const { players, noPosition, namesakes, traded, scores } = computedSeasonPlayers(rated, { listed, career, careerPositions: computed.positions, codes });
    seasons[year] = { computed: true, players, rows: rated.length + unscored.length, rated: rated.length,
      unscored: unscored.map(record => `${record.name} (${back[record.team] ?? record.team})`), noPosition, namesakes, traded, scores,
      srs: new Map(teams.map(row => [back[row.abbreviation] ?? row.abbreviation, Number(row.srs)])), averages };
  }

  // The same rule on the seasons NBA 2K27's MyNBA Eras rate, against 2K's own ratings of them.
  const checks = {};
  for (const [year, source] of Object.entries(manifest.extra || {})) {
    if (source.format !== 'mynba-eras' || !sources[year]) continue;
    const { rated } = rateComputedSeason(records, Number(year), options);
    const byName = new Map();
    for (const entry of rated) {
      const key = nameKey(entry.record.name);
      if (!byName.has(key)) byName.set(key, []);
      byName.get(key).push(entry);
    }
    const brefName = p => {
      const entry = Object.entries(source.roster ?? {}).find(([key, value]) => key.startsWith(`${p.t} `) && value.name === p.n)?.[1];
      return entry ? entry.bref ?? entry.name : source.aliases?.[p.n] ?? p.n;
    };
    const hits = [];
    for (const p of sources[year].players) {
      const candidates = byName.get(nameKey(brefName(p))) ?? [];
      const hit = candidates.length === 1 ? candidates[0] : candidates.find(entry => entry.record.stints.some(s => s.team === (codes[p.t] ?? p.t)));
      if (hit) hits.push([hit, p.o]);
    }
    const errors = hits.map(([hit, theirs]) => hit.rating - theirs);
    checks[source.id] = { label: source.label, players: sources[year].players.length, matched: hits.length,
      rankCorrelation: two(rankCorrelation(hits.map(([hit]) => hit.score), hits.map(([, theirs]) => theirs))),
      meanError: two(average(errors.map(Math.abs))), bias: two(average(errors)) };
  }
  return {
    seasons,
    summary: { fit, spreadRatings: { edition: editionOf(computed.spread.edition), ratings: spread.length, quantiles: spreadQuantiles(spread) }, checks },
  };
}

/**
 * What the audit says of a computed season: its population and who was left out, every traded player and the club he
 * plays for, each five with each player's score, and how the clubs' strengths follow the season's real results
 * (Basketball-Reference's SRS), which the ratings never use.
 */
function computedAudit(source, clubs, doc, teams) {
  const codeOf = new Map(teams.map(team => [team.id, team.code]));
  const scoreText = (club, name) => {
    const value = source.scores.get(`${codeOf.get(club.id)}|${name}`);
    if (value == null) throw new Error(`${club.name}: no score for ${name}`);
    return value.toFixed(3);
  };
  return {
    label: doc.label,
    population: source.rows,
    rated: source.rated,
    unscored: source.unscored,
    noPosition: source.noPosition,
    ...(source.namesakes.length ? { namesakes: source.namesakes } : {}),
    traded: source.traded,
    leagueAverages: source.averages,
    clubsAgainstSRS: two(correlation(clubs.map(club => club.str), clubs.map(club => source.srs.get(codeOf.get(club.id))))),
    fives: clubs.map(club => `${club.name} ${club.str}: ${club.squad.map(([name, positions, rating]) => `${name} ${positions} ${rating} (${scoreText(club, name)})`).join(', ')}`),
  };
}
