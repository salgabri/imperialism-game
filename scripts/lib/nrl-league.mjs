// Rugby league's scoring by era (docs/design/rugby-league.md, "Rules by era"): each built-in earlier season's tries,
// field goals and points a team a game, from the record its ratings were read from (the Rugby League Project's season
// lists before 1998, NRL.com's player stats its snapshot keeps from 1998; `leagueFigures`); how a season's clubs score in
// the match model (`leagueScoring`); and the scoring that brings them to their league's (`solveScoring`). Read by
// scripts/build-nrl-league.mjs, the realism harness and the tests.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { buildClub, hashStr, makeRng, teamEff } from '../../src/data/teams.js';
import { POINTS, RULES_TODAY, rugbyLeague, rugbyLeagueWith, rulesOf, SLICE_MODEL } from '../../src/sports/rugbyLeague.js';
import { KEPT, listPart } from './rugby-league-seasons.mjs';

const sha256 = text => createHash('sha256').update(text).digest('hex');
const round = (x, places) => Math.round(x * 10 ** places) / 10 ** places;

// ---------- the league's figures ----------

/**
 * A Rugby League Project season list's totals over every game of the season, its finals included: its players' tries,
 * goals (and, from 1986, the kicks they came from), field goals and points (`T`, `G`, `FG`, `Pts`; a goal cell reads
 * "69 / 102" where RLP knows the kicks).
 */
export function rlpListTotals(html) {
  const part = listPart(html);
  const cellsOf = row => row.split(/<t[dh]\b/).slice(1).map(cell => cell.replace(/^[^>]*>/, '').replace(/<[^>]+>/g, ' ')
    .replace(/&uarr;|&nbsp;/g, ' ').replace(/\s+/g, ' ').trim());
  const head = cellsOf(part.slice(part.indexOf('<thead>'), part.indexOf('</thead>')).split('<tr>').at(-1));
  const at = name => {
    const index = head.indexOf(name);
    if (index < 0) throw new Error(`RLP's players table has no ${name} column (it has ${head.join(', ')})`);
    return index;
  };
  const column = { tries: at('T'), goals: at('G'), fieldGoals: at('FG'), points: at('Pts') };
  const count = text => {
    if (text === '-' || text === '') return 0;
    const made = /^(\d+)(?:\s*\/\s*\d+)?$/.exec(text);
    if (!made) throw new Error(`RLP's ${JSON.stringify(text)} is no count`);
    return Number(made[1]);
  };
  const kicks = text => /^\d+\s*\/\s*(\d+)$/.exec(text)?.[1];
  const totals = { tries: 0, goals: 0, kicks: 0, fieldGoals: 0, points: 0 };
  let kicked = false;
  for (const row of part.slice(part.indexOf('</thead>')).split('<tr>').slice(1)) {
    if (!/^<td><a href="\/players\//.test(row)) continue;
    const cells = cellsOf(row);
    for (const key of ['tries', 'goals', 'fieldGoals', 'points']) totals[key] += count(cells[column[key]]);
    const taken = kicks(cells[column.goals]);
    if (taken !== undefined) { totals.kicks += Number(taken); kicked = true; }
  }
  return { ...totals, kicks: kicked ? totals.kicks : null };
}

/**
 * Season `snapshot`'s figures, a team a game: the regular season's points (`points`, as the realism measures it), and its
 * tries and field goals over the whole season's games, finals included, as its record counts them, at the regular
 * season's level (× its points over the whole season's: the finals scored a little differently). From RLP's list
 * (`listHtml`, a season before 1998) or the NRL.com stats the snapshot keeps (1998 on); 2008, rated by a game, keeps no
 * stats, so it has its points alone. `from`: 'rlp', 'nrlcom' or null.
 */
export function leagueFigures(snapshot, listHtml = null) {
  const points = snapshot.real.figures.pointsPerTeam, games = snapshot.source.games;
  let whole = null, from = null;
  if (snapshot.source.basis === 'selection') {
    if (!listHtml) throw new Error(`${snapshot.source.id}: a season before 1998 needs its RLP list`);
    const totals = rlpListTotals(listHtml);
    const tries = totals.tries / games / 2;
    // The list's tries are the ones the ratings read: the snapshot's try rate.
    if (round(tries, 4) !== snapshot.conversion.selection.tryRate) {
      throw new Error(`${snapshot.source.id}: RLP's list has ${round(tries, 4)} tries a team game, the snapshot ${snapshot.conversion.selection.tryRate}`);
    }
    whole = { tries, fieldGoals: totals.fieldGoals / games / 2, points: totals.points / games / 2 };
    from = 'rlp';
  } else if (snapshot.source.method === 'computed') {
    const at = name => KEPT.indexOf(name);
    const sums = { tries: 0, goals: 0, fieldGoals: 0 };
    for (const row of snapshot.players) for (const key of Object.keys(sums)) sums[key] += row[7][at(key)];
    const per = x => x / games / 2;
    whole = { tries: per(sums.tries), fieldGoals: per(sums.fieldGoals),
      points: per(POINTS.TRY * sums.tries + POINTS.PENALTY_GOAL * sums.goals + POINTS.FIELD_GOAL * sums.fieldGoals) };
    from = 'nrlcom';
  }
  if (!whole) return { points, from };
  const scale = points / whole.points;
  return { points, tries: round(whole.tries * scale, 3), fieldGoals: round(whole.fieldGoals * scale, 3), from };
}

/** RLP's list of a season before 1998 from the cache, checked against its pin; null when it is not on the computer. */
export function cachedList(root, slug, sources) {
  const file = `rlp/seasons/${slug}/players.html`;
  const full = path.join(root, 'data-src/rugby-league-seasons', file);
  if (!existsSync(full)) return null;
  const html = readFileSync(full, 'utf8');
  const entry = sources[file];
  if (!entry || entry.pin !== 'list') throw new Error(`${file} is not pinned as a players list in scripts/data/rugby-league-seasons-sources.json`);
  const hash = sha256(Buffer.from(listPart(html)));
  if (hash !== entry.sha256) throw new Error(`data-src/rugby-league-seasons/${file} is not the pinned list (SHA-256 ${hash}, pinned ${entry.sha256})`);
  return html;
}

// ---------- the model's ----------

/** A season's clubs as its season file holds them (public/rugby-league/<id>.json), built as a campaign builds them. */
export function seasonClubs(root, id) {
  const doc = JSON.parse(readFileSync(path.join(root, 'public/rugby-league', `${id}.json`), 'utf8'));
  return doc.clubs.map(club => buildClub(club, rugbyLeague));
}

/**
 * How `clubs` score under `sport`'s rules over every pairing, about `games` games at Balanced at a neutral venue, a
 * team a game, as the league counted them: at full time before golden point (a level game was a draw then), at its end
 * after. Also the share of games level at full time (`level`), settled by extra time's last field goal (`deciders`), and
 * the longest extra time in periods (`longest`).
 */
export function leagueScoring(sport, clubs, { games = 12000, seed = 'nrl' } = {}) {
  const { rules } = sport;
  const pairings = clubs.length * (clubs.length - 1);
  const draws = Math.max(1, Math.round(games / pairings));
  const eff = clubs.map(teamEff);
  let played = 0, points = 0, tries = 0, fieldGoals = 0, penalties = 0, level = 0, deciders = 0, longest = 0, margins = 0;
  for (let i = 0; i < clubs.length; i++) {
    for (let j = 0; j < clubs.length; j++) {
      if (i === j) continue;
      const prepared = sport.prepareMatch(clubs[i], clubs[j], eff[i], eff[j]);
      for (let k = 0; k < draws; k++) {
        const result = sport.sampleResult(makeRng(hashStr(`${seed}|${i}|${j}|${k}`)), prepared, 6);
        const counted = rules.golden ? result.scores : result.scores.filter(entry => entry.slice < SLICE_MODEL.SLICES);
        const [a, d] = rules.golden ? [result.ga, result.gd] : [result.regA, result.regD];
        played++;
        points += a + d;
        margins += Math.abs(a - d);
        for (const entry of counted) {
          if (entry.kind === 'try') tries++;
          else if (entry.kind === 'field') fieldGoals++;
          else penalties++;
        }
        if (result.tie) {
          level++;
          if (result.scores.some(entry => entry.decider)) deciders++;
          longest = Math.max(longest, result.tie.periods.length);
        }
      }
    }
  }
  const perTeam = x => x / (2 * played);
  return { games: played, points: perTeam(points), tries: perTeam(tries), fieldGoals: perTeam(fieldGoals), penalties: perTeam(penalties),
    marginMean: margins / played, level: level / played, deciders: deciders / played, longest };
}

/** The rules of season `id` ending in `year` at scoring level `scoring`: its points and extra time, then the level. */
export const rulesAt = (id, year, scoring) => Object.freeze({ ...RULES_TODAY, ...rulesOf(year), season: id, ...scoring });

/**
 * The scoring of season `id` ending in `year` that brings `clubs` to its league's figures (`target`: `points`, and
 * `tries` and `fieldGoals` where its record has them), to four decimals: the try rates scaled to its tries; its field
 * goals from the late game's chances (at most today's) and, beyond them, open play's; its penalty goals the points left.
 * A season with its points alone (2008) plays today's mix at them: tries and penalty goals scaled alike. Each round moves
 * each part by how far the last fell short.
 */
export function solveScoring(id, year, clubs, target, { games = 12000, rounds = 6 } = {}) {
  const { fieldGoalPoints } = rulesOf(year);
  let scoring = { tries: 1, penalties: RULES_TODAY.penalties, fieldGoals: 1, openFieldGoals: 0 };
  const measure = at => leagueScoring(rugbyLeagueWith(rulesAt(id, year, at)), clubs, { games, seed: id });
  for (let r = 0; r < rounds; r++) {
    const m = measure(scoring);
    if (target.tries == null) {
      const k = target.points / m.points;
      scoring = { ...scoring, tries: scoring.tries * k, penalties: scoring.penalties * k };
      continue;
    }
    const tries = scoring.tries * target.tries / m.tries;
    let { fieldGoals, openFieldGoals } = scoring;
    if (target.fieldGoals <= 0) [fieldGoals, openFieldGoals] = [0, 0];
    else if (openFieldGoals > 0 || (fieldGoals >= 1 && m.fieldGoals < target.fieldGoals)) {
      openFieldGoals = Math.max(0, openFieldGoals + target.fieldGoals - m.fieldGoals);
    } else fieldGoals = m.fieldGoals > 0 ? Math.min(1, fieldGoals * target.fieldGoals / m.fieldGoals) : 1;
    // The points the tries and field goals will bring at their new levels; penalty goals make up the rest.
    const fromTries = (m.points - POINTS.PENALTY_GOAL * m.penalties - fieldGoalPoints * m.fieldGoals) * target.tries / m.tries;
    const wanted = Math.max(0, (target.points - fromTries - fieldGoalPoints * target.fieldGoals) / POINTS.PENALTY_GOAL);
    const penalties = m.penalties > 0 ? scoring.penalties * wanted / m.penalties : wanted;
    scoring = { tries, penalties, fieldGoals, openFieldGoals };
  }
  return Object.fromEntries(Object.entries(scoring).map(([key, value]) => [key, round(value, 4)]));
}
