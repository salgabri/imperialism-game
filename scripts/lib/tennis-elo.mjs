// Tennis Elo computed from Jeff Sackmann's match results by Tennis Abstract's published method: the men's from his ATP
// files (docs/design/tennis.md, "Earlier seasons"), the women's from his WTA files (docs/design/womens-tennis.md). No
// I/O: scripts/sync-tennis-seasons.mjs reads the pinned files and passes their text in.
//
// The method, as Jeff Sackmann describes it (and sources in scripts/data/tennis-seasons.json `method`):
// - a match's expected score is 1 / (1 + 10^((opponent − player) / 400));
// - K = 250 / (n + 6)^0.4, n the counted matches the player has already played; no bonus for the majors;
// - counted: tour-level main draws with the Davis Cup, tour-level qualifying and challengers' main draws (not their
//   qualifying), never a walkover, a retirement, a default or an abandoned match; the women's, tour-level main draws
//   with the Fed Cup, tour-level qualifying and the main draws of WTA 125s and ITF events of $50K or more
//   (`wtaLevelOf`);
// - a new player starts by the level of her or his first counted match (tour level, or a challenger, ITF or
//   qualifying round);
// - a layoff of eight weeks or more (the offseason not counted) costs a player rated 1900 or more 100 points, rising to
//   150 for a year, charged when he returns; K is then 1.5 times as large, back to 1 over twenty matches, and a second
//   layoff within two years of the last comeback is charged the difference. A list shows a player still away with the
//   penalty he would be charged on its date;
// - a season ends after its last event, as the match files group them: the Masters played in January belongs to the
//   year before, an event starting on 29 December to the year after.
//
// The men's seasons before 1973 come from a second run (docs/design/tennis.md, "Before 1973"): Sackmann's amateur file
// (the majors and the Davis Cup, 1877-1967) as a warm-up before the open era's files, its newcomers at their own start
// (`earlyLevelOf`), its layoffs charged only from `layoff.amateurWeeks`, and its duplicate ids merged (`applyAliases`).

/**
 * Round order within an event, qualifying first (the WTA's files have a fifth qualifying round; the amateur file a
 * preliminary round before the first full one, and the challenge round of Wimbledon and the US Championships after the
 * final).
 */
export const ROUND_ORDER = Object.freeze({ Q1: 1, Q2: 2, Q3: 3, Q4: 4, Q5: 4.5, ER: 5, PR: 9, R128: 10, R64: 11, R32: 12, R16: 13, RR: 14, QF: 15, SF: 16, BR: 17, F: 18, CR: 19 });

// A score that shows a match was not played out: a walkover, a retirement, a default, an abandoned or unfinished one.
const NOT_PLAYED = /W\/O|walkover|\bRET\b|\bRet\b|\bRE\b|\bDEF\b|\bDef\b|default|\bABD\b|\bABN\b|abandoned|unfinished|\bUNP\b/i;

/** Why a match is not counted, or null when it is: 'unplayed' (walkover, retirement…) or 'no score'. */
export function notCounted(score) {
  const text = String(score || '');
  if (NOT_PLAYED.test(text)) return 'unplayed';
  if (!/\d+-\d+/.test(text)) return 'no score';
  return null;
}

/** A placeholder opponent of the match files ("U Unknown"): such a match rates nobody. */
export const isPlaceholder = name => /(^|\s)Unknown$/.test(String(name).trim());

/** The two nations of a Davis Cup tie from its event name ("Davis Cup WG F: USA vs AUS"), or null. */
export function tieSides(eventName) {
  const match = String(eventName).match(/:\s*([A-Z]{3})\s+vs\s+([A-Z]{3})\s*$/);
  return match ? [match[1], match[2]] : null;
}

/**
 * One match file's rows as matches: `{ season, date, event, eventName, level, round, num, file, row, winner, loser,
 * winnerName, loserName, winnerIoc, loserIoc, surface, why }`, `why` null for a counted match. `file` is 0 for the
 * tour-level file, 1 for the challenger and qualifying one and 2 for the amateur file; `row` keeps the file's own order.
 * A file of many years (the amateur file) has no `season`: each row's is the year of its date. `pad` restores the
 * empty cells the amateur file leaves off the end of its rows (40 of the header's 49).
 */
export function parseMatchFile(text, { season = null, file, pad = false }) {
  const what = season == null ? 'The amateur match file' : `The match file of ${season}`;
  const lines = String(text).replace(/\r/g, '').split('\n');
  const head = lines[0].split(',');
  const at = name => {
    const i = head.indexOf(name);
    if (i < 0) throw new Error(`${what} has no ${name} column`);
    return i;
  };
  const I = { event: at('tourney_id'), eventName: at('tourney_name'), surface: at('surface'), level: at('tourney_level'), date: at('tourney_date'),
    num: at('match_num'), winner: at('winner_id'), winnerName: at('winner_name'), winnerIoc: at('winner_ioc'), loser: at('loser_id'),
    loserName: at('loser_name'), loserIoc: at('loser_ioc'), score: at('score'), round: at('round') };
  const matches = [];
  for (let row = 1; row < lines.length; row++) {
    const line = lines[row];
    if (!line) continue;
    const c = line.split(',');
    if (pad && c.length < head.length) c.push(...Array(head.length - c.length).fill(''));
    if (c.length !== head.length) throw new Error(`${what}, row ${row}: ${c.length} cells, not ${head.length}`);
    // One WTA row writes its final "f".
    const round = ROUND_ORDER[c[I.round]] ?? ROUND_ORDER[c[I.round].toUpperCase()];
    if (round == null) throw new Error(`${what}, row ${row}: unknown round ${c[I.round]}`);
    const date = Number(c[I.date]);
    // The amateur file starts with the first Wimbledon, in 1877.
    if (!Number.isInteger(date) || date < 18770101) throw new Error(`${what}, row ${row}: bad date ${c[I.date]}`);
    const why = isPlaceholder(c[I.winnerName]) || isPlaceholder(c[I.loserName]) ? 'placeholder' : notCounted(c[I.score]);
    matches.push({ season: season ?? Math.floor(date / 10000), date, event: c[I.event], eventName: c[I.eventName], level: c[I.level], round,
      num: Number(c[I.num]) || 0, file, row,
      winner: c[I.winner], loser: c[I.loser], winnerName: c[I.winnerName], loserName: c[I.loserName], winnerIoc: c[I.winnerIoc],
      loserIoc: c[I.loserIoc], surface: c[I.surface], why });
  }
  return matches;
}

const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** Matches in the order they are rated: by season, then date, event, round, match number and file order. */
export function orderMatches(matches) {
  return matches.slice().sort((a, b) => a.season - b.season || a.date - b.date || byText(a.event, b.event) || a.round - b.round
    || a.num - b.num || a.file - b.file || a.row - b.row);
}

const utcDay = yyyymmdd => Date.UTC(Math.floor(yyyymmdd / 10000), Math.floor(yyyymmdd / 100) % 100 - 1, yyyymmdd % 100) / 864e5;
/** Days from one yyyymmdd date to another. */
export const daysBetween = (a, b) => utcDay(b) - utcDay(a);

/** The days of [a, b] inside an offseason window (`from`–`to` as mmdd, the window crossing the new year). */
function offseasonDays(a, b, [from, to]) {
  let days = 0;
  for (let year = Math.floor(a / 10000) - 1; year <= Math.floor(b / 10000); year++) {
    const start = Math.max(utcDay(a), utcDay(year * 10000 + from)), end = Math.min(utcDay(b), utcDay((year + 1) * 10000 + to));
    if (end > start) days += end - start;
  }
  return days;
}

/** The weeks of a layoff from one match date to the next, the offseason not counted. */
export function layoffWeeks(last, next, offseason) {
  const days = daysBetween(last, next);
  if (days <= 0) return 0;
  return (days - offseasonDays(last, next, offseason)) / 7;
}

/** The penalty for a layoff of `weeks`: 0 under the threshold, then `min` rising linearly to `max` at `maxWeeks`. */
export function layoffPenalty(weeks, layoff) {
  if (weeks < layoff.weeks) return 0;
  return Math.min(layoff.max, layoff.min + (layoff.max - layoff.min) * (weeks - layoff.weeks) / (layoff.maxWeeks - layoff.weeks));
}

const expected = (rating, opponent) => 1 / (1 + Math.pow(10, (opponent - rating) / 400));
const round1 = x => Math.round(x * 10) / 10;

/**
 * The men's rule, by Tennis Abstract's report ("tour-level, tour-level qualifying, men's challenger"): the tour-level
 * file's matches (`file` 0) are tour level; the other file holds the challengers, whose main draws count and whose
 * qualifying does not (unless `method.challengerQualifying`), and the tour-level qualifying.
 * → 'tour' | 'challenger' | 'qualifying', the start a new player gets, or null for a match that is not counted.
 */
export function atpLevelOf(m, method) {
  if (m.file === 0) return 'tour';
  if (m.level === 'C') return m.round < ROUND_ORDER.ER && !method.challengerQualifying ? null : 'challenger';
  return 'qualifying';
}

/**
 * The men's rule of the run before 1973: the amateur file's matches (`file` 2, the majors and the Davis Cup) are all
 * counted, and start a new player at `method.start.amateur`; the open era's as `atpLevelOf`.
 */
export const earlyLevelOf = (m, method) => (m.file === 2 ? 'amateur' : atpLevelOf(m, method));

/**
 * Matches with each duplicate id replaced by the id of the same man it joins (`aliasOf`, a Map). A match that would set
 * a man against himself is a wrong merge, and throws.
 */
export function applyAliases(matches, aliasOf) {
  return matches.map(m => {
    if (!aliasOf.has(m.winner) && !aliasOf.has(m.loser)) return m;
    const merged = { ...m, winner: aliasOf.get(m.winner) ?? m.winner, loser: aliasOf.get(m.loser) ?? m.loser };
    if (merged.winner === merged.loser) throw new Error(`An alias sets ${m.winnerName} against ${m.loserName} (${m.event})`);
    return merged;
  });
}

// The WTA files' tour levels: W (the tour to 1999, the Finals of 2015, the 250s of 2021), the majors, the Fed Cup and
// the Billie Jean King Cup (D), the Olympics, the Finals, the Tiers of 2000-2008, and Premier and International.
const WTA_TOUR = new Set(['W', 'G', 'D', 'O', 'F', 'T1', 'T2', 'T3', 'T4', 'T5', 'PM', 'P', 'I']);
// An ITF event's prize level, which the files name from 1994 ("50", "100", the "50+H" of 2025), else null.
const itfPrize = level => (/^\d+(\+H)?$/.test(level) ? Number(level.replace('+H', '')) : null);

/**
 * The women's rule, by Tennis Abstract's report ("tour-level, tour-level qualifying ... or ITF $50K+ matches"): the
 * tour-level file's tour events (not its exhibitions, junior events or ITF circuits under $50K); in the other file the
 * qualifying of tour events, and the main draws of the WTA 125s (level C from 2012) and of ITF events of $50K or more.
 * Before 1994 the files name no ITF event's prize, so none is counted; nor is the qualifying of a 125 or an ITF event.
 * A WTA 125 or an ITF event starts a new player as a men's challenger does. → as `atpLevelOf`.
 */
export function wtaLevelOf(m) {
  const prize = itfPrize(m.level);
  if (m.file === 0) {
    if (m.level === 'W' && /\b125K?\b/.test(m.eventName)) return 'challenger';
    if (WTA_TOUR.has(m.level)) return 'tour';
    return prize != null && prize >= 50 ? 'challenger' : null;
  }
  const qualifying = m.round < ROUND_ORDER.ER;
  if (WTA_TOUR.has(m.level)) return qualifying ? 'qualifying' : 'tour';
  if (qualifying) return null;
  if (m.level === 'C') return m.season >= 2012 ? 'challenger' : null;
  return prize != null && prize >= 50 ? 'challenger' : null;
}

/**
 * Rate every match in order (orderMatches) by `method` (scripts/data/tennis-seasons.json `method`): `{ k: { numerator,
 * offset, exponent }, start: { tour, challenger, qualifying, amateur? }, layoff: { weeks, min, max, maxWeeks, kBoost, kMatches,
 * repeatDays, threshold, offseason: [mmdd, mmdd], from?, amateurWeeks? } | null, files: 'tour' | 'all' }`. A layoff with
 * `from` (yyyymmdd, the open era's start) charges a gap that begins before it only when the gap also ends before it and
 * lasts `amateurWeeks` or more: the amateur file holds only the majors and the Davis Cup, and a gap across the start
 * (a professional coming back in 1968) is never charged. Options: `seasons`, the seasons to snapshot at
 * their end; `asOf`, a list's date by season (yyyymmdd; default 31 December, never before the season's last event);
 * `yElo`, also each season's yElo (every player restarting at 1500 against his opponents' real Elo); `levelOf`, which
 * matches count and at what start (`atpLevelOf`, the default, or `wtaLevelOf`); `before(m, winner, loser)`, called with
 * each counted match and its two players' ratings and counted matches before it ({ elo, n }), layoffs charged.
 * Returns `{ snapshots: { [season]: { last, date, players } }, peaks, yElo, counts }`, each snapshot player `{ id,
 * name, elo, n, season: counted matches that season, last, absent? }` for everyone who played a counted match that
 * season, `absent` the layoff penalty his listed Elo already shows.
 */
export function rateMatches(matches, method, { seasons = [], yElo = false, asOf = null, levelOf = atpLevelOf, before = null } = {}) {
  const wanted = new Set(seasons);
  const players = new Map();
  const counts = { counted: 0, unplayed: 0, 'no score': 0, placeholder: 0, skipped: 0 };
  const snapshots = {};
  const yEloSeasons = {};
  const { k, start, layoff } = method;
  const kOf = player => {
    let factor = k.numerator / Math.pow(player.n + k.offset, k.exponent);
    if (player.boost > 0) factor *= 1 + (layoff.kBoost - 1) * player.boost / layoff.kMatches;
    return factor;
  };
  // A new player's rating by the level of the first counted match: tour level (the Davis Cup or Fed Cup included), a
  // challenger (a WTA 125 or an ITF event), or the qualifying of a tour-level event.
  const playerOf = (id, name, level) => {
    let player = players.get(id);
    if (!player) {
      player = { id, name, r: start[level], n: 0, last: 0, boost: 0, comeback: 0, prior: 0, peak: -Infinity, peakDate: 0,
        season: 0, seasonCount: 0, yYear: 0, yR: 0, yN: 0, yW: 0, yL: 0 };
      players.set(id, player);
    }
    return player;
  };
  // A gap that begins before `layoff.from` is not charged, unless it also ends before it and lasts `amateurWeeks`.
  const exempt = (p, date) => layoff.from != null && p.last < layoff.from
    && !(layoff.amateurWeeks != null && date < layoff.from && layoffWeeks(p.last, date, layoff.offseason) >= layoff.amateurWeeks);
  // A list shows a player who is in the middle of a layoff with the penalty he would be charged were he to return on
  // its date, as Tennis Abstract's report does; his rating itself is charged only when he returns.
  const pendingPenalty = (p, date) => {
    if (!layoff || !p.last) return 0;
    if (exempt(p, date)) return 0;
    if (layoff.threshold != null && p.r < layoff.threshold) return 0;
    const weeks = layoffWeeks(p.last, date, layoff.offseason);
    if (weeks < layoff.weeks) return 0;
    if (p.comeback && daysBetween(p.comeback, date) < layoff.repeatDays && p.prior) {
      return Math.max(0, layoffPenalty(weeks + p.prior, layoff) - layoffPenalty(p.prior, layoff));
    }
    return layoffPenalty(weeks, layoff);
  };
  const takeSnapshot = (season, last) => {
    // The list's date: the later of 31 December and the season's last event (the Masters of January 1978–1986).
    const date = Math.max(asOf?.[season] ?? season * 10000 + 1231, last);
    const list = [];
    for (const p of players.values()) {
      if (p.season !== season || !p.seasonCount) continue;
      const penalty = pendingPenalty(p, date);
      list.push({ id: p.id, name: p.name, elo: round1(p.r - penalty), n: p.n, season: p.seasonCount, last: p.last, ...(penalty ? { absent: round1(penalty) } : {}) });
    }
    list.sort((a, b) => b.elo - a.elo || byText(a.id, b.id));
    snapshots[season] = { last, date, players: list };
  };
  const closeYElo = p => {
    if (!p.yYear) return;
    (yEloSeasons[p.yYear] ||= []).push({ id: p.id, name: p.name, yElo: round1(p.yR), won: p.yW, lost: p.yL });
  };
  // A comeback after a layoff: the penalty, the larger K, and a second layoff charged only the difference.
  const comeback = (p, date) => {
    if (!layoff || !p.last) return;
    if (exempt(p, date)) return;
    if (layoff.threshold != null && p.r < layoff.threshold) return;
    const weeks = layoffWeeks(p.last, date, layoff.offseason);
    if (weeks < layoff.weeks) return;
    let penalty;
    if (p.comeback && daysBetween(p.comeback, date) < layoff.repeatDays && p.prior) {
      penalty = Math.max(0, layoffPenalty(weeks + p.prior, layoff) - layoffPenalty(p.prior, layoff));
      p.prior += weeks;
    } else {
      penalty = layoffPenalty(weeks, layoff);
      p.prior = weeks;
    }
    p.r -= penalty;
    p.boost = layoff.kMatches;
    p.comeback = date;
  };

  let season = null, lastDate = 0;
  for (const m of matches) {
    if (m.season !== season) {
      if (season != null && wanted.has(season)) takeSnapshot(season, lastDate);
      season = m.season;
    }
    if (m.why) { counts[m.why]++; continue; }
    // A match of no counted level (a men's challenger's qualifying, a women's exhibition or small ITF event), or of
    // anything but tour level under a method of tour-level matches only.
    const level = levelOf(m, method);
    if (level == null || (method.files === 'tour' && level !== 'tour')) { counts.skipped++; continue; }
    counts.counted++;
    lastDate = Math.max(lastDate, m.date);
    const w = playerOf(m.winner, m.winnerName, level), l = playerOf(m.loser, m.loserName, level);
    comeback(w, m.date);
    comeback(l, m.date);
    if (before) before(m, { elo: w.r, n: w.n }, { elo: l.r, n: l.n });
    if (yElo) {
      for (const p of [w, l]) {
        if (p.yYear !== m.season) {
          closeYElo(p);
          Object.assign(p, { yYear: m.season, yR: 1500, yN: 0, yW: 0, yL: 0 });
        }
      }
      const kw = k.numerator / Math.pow(w.yN + k.offset, k.exponent), kl = k.numerator / Math.pow(l.yN + k.offset, k.exponent);
      const ew = expected(w.yR, l.r), el = expected(l.yR, w.r);
      w.yR += kw * (1 - ew);
      l.yR -= kl * el;
      w.yN++; l.yN++; w.yW++; l.yL++;
    }
    const e = expected(w.r, l.r);
    const kw = kOf(w), kl = kOf(l);
    w.r += kw * (1 - e);
    l.r -= kl * (1 - e);
    for (const p of [w, l]) {
      p.n++;
      if (p.boost > 0) p.boost--;
      p.last = Math.max(p.last, m.date);
      if (p.season !== m.season) { p.season = m.season; p.seasonCount = 0; }
      p.seasonCount++;
      if (p.r > p.peak) { p.peak = p.r; p.peakDate = m.date; }
    }
  }
  if (season != null && wanted.has(season)) takeSnapshot(season, lastDate);
  if (yElo) for (const p of players.values()) closeYElo(p);
  const peaks = [...players.values()].map(p => ({ id: p.id, name: p.name, peak: round1(p.peak), date: p.peakDate }))
    .sort((a, b) => b.peak - a.peak || byText(a.id, b.id));
  for (const list of Object.values(yEloSeasons)) list.sort((a, b) => b.yElo - a.yElo || byText(a.id, b.id));
  return { snapshots, peaks, yElo: yEloSeasons, counts };
}

/**
 * The Davis Cup nations each player played for, from the ties' names: `Map(id → Map(season → Map(code → rubbers)))`.
 * A rubber's two sides are told apart by the players' own codes (`codeOf(ioc, season)`, the code of the day of the
 * player file's country), the other side by elimination; a rubber neither player's code places is left unresolved.
 */
export function davisCupNations(matches, codeOf) {
  const nations = new Map();
  let unresolved = 0;
  const add = (id, season, code) => {
    if (!nations.has(id)) nations.set(id, new Map());
    const seasons = nations.get(id);
    if (!seasons.has(season)) seasons.set(season, new Map());
    const codes = seasons.get(season);
    codes.set(code, (codes.get(code) || 0) + 1);
  };
  for (const m of matches) {
    if (m.level !== 'D' || m.why === 'placeholder') continue;
    const sides = tieSides(m.eventName);
    if (!sides) { unresolved++; continue; }
    const wc = codeOf(m.winnerIoc, m.season), lc = codeOf(m.loserIoc, m.season);
    let ws = sides.includes(wc) ? wc : null, ls = sides.includes(lc) ? lc : null;
    if (ws && ws === ls) { ws = null; ls = null; }
    if (!ws && ls) ws = sides.find(side => side !== ls);
    if (!ls && ws) ls = sides.find(side => side !== ws);
    if (!ws || !ls) { unresolved++; continue; }
    add(m.winner, m.season, ws);
    add(m.loser, m.season, ls);
  }
  return { nations, unresolved };
}

/** Pearson's r, the least-squares slope of `ys` on `xs`, the mean difference (y − x) and the mean absolute difference. */
export function agreement(xs, ys) {
  const n = xs.length;
  if (!n) return null;
  const mx = xs.reduce((s, x) => s + x, 0) / n, my = ys.reduce((s, y) => s + y, 0) / n;
  let sxy = 0, sxx = 0, syy = 0, diff = 0, abs = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
    diff += ys[i] - xs[i];
    abs += Math.abs(ys[i] - xs[i]);
  }
  return { n, r: sxy / Math.sqrt(sxx * syy), slope: sxy / sxx, meanDiff: diff / n, meanAbsDiff: abs / n };
}
