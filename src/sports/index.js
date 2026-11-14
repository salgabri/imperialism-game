// Sport registry. A sport supplies its own squad shape, roster data, match model
// and vocabulary; everything else in the campaign — territory, targeting, the
// spinner, conquest, autosave — is sport-agnostic.

import { football } from './football.js';
import { womensFootball } from './womensFootball.js';
import { basketball } from './basketball.js';
import { americanFootball } from './americanFootball.js';
import { baseball } from './baseball.js';
import { hockey } from './hockey.js';
import { tennis } from './tennis.js';
import { womensTennis } from './womensTennis.js';
import { rugbyLeague } from './rugbyLeague.js';
import { rocketLeague } from './rocketLeague.js';

export const SPORTS = { football, 'womens-football': womensFootball, basketball, 'american-football': americanFootball, baseball, hockey, tennis,
  'womens-tennis': womensTennis, 'rugby-league': rugbyLeague, 'rocket-league': rocketLeague };
export const SPORT_LIST = [football, womensFootball, basketball, americanFootball, baseball, hockey, tennis, womensTennis, rugbyLeague,
  rocketLeague];
export const DEFAULT_SPORT = 'football';

export const getSport = id => SPORTS[id] || SPORTS[DEFAULT_SPORT];

/**
 * The sport a campaign's matches are played under, from its settings or a setup (`sport`, `layer`, `clubScope`,
 * `dataSet`, `dataYear`, `dataSeason`): the rules of its season's day (eras.js). A sport whose rules changed over the
 * years gives them by season (`rulesFor(settings)`, one object per set of rules); the built-in current season plays
 * today's. Basketball's NBA franchises play NBA rules at their season's pace, its EuroLeague clubs (on the EuroLeague's
 * map) FIBA's at the EuroLeague's, and its nations FIBA's. Football settles a level game by its season's knockout rules:
 * extra time, then the drawing of lots, the golden or silver goal, or penalties.
 */
export function matchSport(settings) {
  const sport = getSport(settings?.sport);
  return typeof sport.rulesFor === 'function' ? sport.rulesFor(settings ?? {}) : sport;
}

const sportOf = sport => (sport && typeof sport === 'object' ? sport : getSport(sport));

/**
 * The match clock as a sport shows it: a minute ("38'") in football, basketball and American football, the half-inning
 * ("T5", "B9") in baseball, whose clock counts outs (`formatClock`). `sport` is a sport object or id.
 */
export function clockLabel(sport, minute) {
  const m = Math.max(0, Math.floor(Number(minute) || 0));
  const format = sportOf(sport)?.formatClock;
  return typeof format === 'function' ? format(m) : `${m}'`;
}

/** The win chart's axis label at clock `t`: the minute ("45'"), or a sport's own (`formatTick`: baseball's innings). */
export function clockTick(sport, t) {
  const format = sportOf(sport)?.formatTick;
  return typeof format === 'function' ? format(t) : `${t}'`;
}

/**
 * The tie-break of a level game decided in overtime, from the periods played: "after 2 overtime periods", or a
 * sport's own (`overtime.text`: baseball's "after 11 innings"). Lower case, to follow a score.
 */
export function overtimeText(sport, periods) {
  const n = Math.max(1, Number(periods) || 1);
  const own = sportOf(sport)?.overtime?.text;
  return typeof own === 'function' ? own(n) : `after ${n} overtime period${n === 1 ? '' : 's'}`;
}

/**
 * The clock at the end of the last overtime period played (basketball's five minutes, baseball's extra innings), or 0
 * when there is none to reach: no overtime, a shoot-out, or American football's, which ends at its deciding score
 * (`clock.sudden`), the last event.
 */
export function overtimeEnd(sport, periods) {
  const model = sportOf(sport), n = Number(periods) || 0;
  if (model?.tieBreak !== 'overtime' || model.clock?.sudden || n <= 0) return 0;
  return (Number(model.clock?.length) || 0) + n * (Number(model.clock?.ot) || 5);
}

/** The short tie-break beside a level score: "OT", "2OT", or a sport's own (`overtime.short`: baseball's "F/11"). */
export function overtimeShort(sport, periods) {
  const n = Math.max(1, Number(periods) || 1);
  const model = sportOf(sport);
  return typeof model?.overtime?.short === 'function' ? model.overtime.short(n) : `${n > 1 ? n : ''}${model?.labels?.tieShort || 'OT'}`;
}

/**
 * A level game's shoot-out, when one settled it: the tie itself ({ A, D, ga, gd, first }, its kicks). Football's level
 * games go to extra time first, and a tie it settled, or the drawing of lots, has no kicks (`tie.by`); a tie saved
 * before extra time came in always went to penalties. Null for every other sport and for no tie.
 */
export function shootoutOf(sport, tie) {
  return tie && sportOf(sport)?.tieBreak === 'shootout' && (tie.by ?? 'penalties') === 'penalties' ? tie : null;
}

/**
 * The status a finished match shows (labels): FULL TIME (`end`); PENALTIES after a shoot-out (`tie`); an overtime sport's
 * OVERTIME or FINAL after its tie-break (`tie`). A football game settled in extra time or by lots is at full time.
 */
export function finishLabel(sport, tie) {
  const model = sportOf(sport);
  return tie && (model?.tieBreak !== 'shootout' || shootoutOf(model, tie)) ? model?.labels?.tie : model?.labels?.end;
}

/**
 * How a level game was settled, to follow its score (lower case): a sport's own (`settled.text`: football's "after
 * extra time", "4–3 on penalties"), a shoot-out's kicks, or the overtime periods ("after 2 overtime periods").
 */
export function settledText(sport, tie) {
  const model = sportOf(sport);
  if (typeof model?.settled?.text === 'function') return model.settled.text(tie);
  if (model?.tieBreak === 'shootout') return `${tie.ga}–${tie.gd} on penalties`;
  return overtimeText(model, Array.isArray(tie?.periods) && tie.periods.length ? tie.periods.length : 1);
}

/**
 * The tie-break beside a level score: a sport's own (`settled.short`: football's "AET", "GOLDEN GOAL", "4–2 PENS"), a
 * shoot-out's kicks, or the overtime periods ("OT", "2OT", baseball's "F/11").
 */
export function settledShort(sport, tie) {
  const model = sportOf(sport);
  if (typeof model?.settled?.short === 'function') return model.settled.short(tie);
  if (model?.tieBreak === 'shootout') return `${tie.ga}–${tie.gd} ${model.labels.tieShort}`;
  return overtimeShort(model, Array.isArray(tie?.periods) ? tie.periods.length : 1);
}

/** The overtime periods an `overtimeText` names ("after 2 overtime periods" → 2, baseball's "after 11 innings" → 2), or null. */
export function overtimePeriodsOf(sport, text) {
  const own = sportOf(sport)?.overtime?.periodsOf;
  if (typeof own === 'function') return own(String(text || ''));
  const periods = /after\s+(\d+)\s+overtime\s+period/i.exec(text || '')?.[1];
  return periods ? Number(periods) : null;
}
