// Sport registry. A sport supplies its own squad shape, roster data, match model
// and vocabulary; everything else in the campaign — territory, targeting, the
// spinner, conquest, autosave — is sport-agnostic.

import { football } from './football.js';
import { womensFootball } from './womensFootball.js';
import { basketball, nbaBasketballIn } from './basketball.js';
import { americanFootball } from './americanFootball.js';
import { baseball } from './baseball.js';
import { hockey } from './hockey.js';
import { tennis } from './tennis.js';
import { rugbyLeague } from './rugbyLeague.js';

export const SPORTS = { football, 'womens-football': womensFootball, basketball, 'american-football': americanFootball, baseball, hockey, tennis,
  'rugby-league': rugbyLeague };
export const SPORT_LIST = [football, womensFootball, basketball, americanFootball, baseball, hockey, tennis, rugbyLeague];
export const DEFAULT_SPORT = 'football';

export const getSport = id => SPORTS[id] || SPORTS[DEFAULT_SPORT];

/**
 * The sport a campaign's matches are played under, from its settings or a setup (`sport`, `layer`, `dataSeason`).
 * Basketball's clubs are NBA franchises and play NBA rules at their season's pace; its nations play FIBA's. Every
 * other sport has one rulebook.
 */
export function matchSport(settings) {
  const sport = getSport(settings?.sport);
  return sport === basketball && settings?.layer === 'clubs' ? nbaBasketballIn(settings.dataSeason) : sport;
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

/** The overtime periods an `overtimeText` names ("after 2 overtime periods" → 2, baseball's "after 11 innings" → 2), or null. */
export function overtimePeriodsOf(sport, text) {
  const own = sportOf(sport)?.overtime?.periodsOf;
  if (typeof own === 'function') return own(String(text || ''));
  const periods = /after\s+(\d+)\s+overtime\s+period/i.exec(text || '')?.[1];
  return periods ? Number(periods) : null;
}
