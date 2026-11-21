// Scores entered by you (README §Scores entered by you; Show matches' fourth mode, the `results` setting): a campaign
// whose matches are played somewhere else, in another game or for real, and whose scores the player types in. The
// sport's model plays none of them: a typed score settles the match (a level football score with its penalty
// shoot-out's), and the campaign goes on from there as after any match: the conquest, a manager's signing, the next
// draw. Pure: no window or document, and nothing here draws from a campaign's random stream.

/** Whether a campaign's (or a setup's) matches wait for a result typed in by the player. */
export const entersResults = settings => settings?.results === 'entered';

/** A blank draft: the typed scores as text, the attacker's first, and the shoot-out's (`pa`, `pb`). */
export const EMPTY_DRAFT = Object.freeze({ a: '', b: '', pa: '', pb: '' });

/** The draft fields, in the order the form shows them. */
export const DRAFT_KEYS = Object.freeze(['a', 'b', 'pa', 'pb']);

/**
 * What a score field keeps of what was typed: its digits, at most three (basketball and rugby league scores pass 99),
 * without leading zeros ('07' → '7').
 */
export function scoreText(value) {
  return String(value ?? '').replace(/\D+/g, '').slice(0, 3).replace(/^0+(?=\d)/, '');
}

const scoreOf = text => {
  const digits = scoreText(text);
  return digits === '' ? null : Number(digits);
};

/**
 * Whether a level score is settled by a shoot-out the form asks for: football and women's football (`tieBreak`
 * 'shootout'). Every other sport plays a level game on until one side wins (overtime, extra innings, golden point), and
 * a tennis tie or a Rocket League series cannot end level, so their final scores always have a winner.
 */
export const levelNeedsShootout = sport => sport?.tieBreak === 'shootout';

// The finals a best-of-five shoot-out can end on inside its five rounds by more than one (it stops as soon as one side
// cannot catch up: 3–0 is over after three kicks each, so 4–0 never happens), winner first. Sudden death, and every
// round before it, ends one apart.
const CLEAR_SHOOTOUT_FINALS = new Set(['2-0', '3-0', '3-1', '4-1', '4-2', '5-3']);

/** Whether a penalty shoot-out can end `p`–`q`. */
export function possibleShootout(p, q) {
  const [w, l] = p > q ? [p, q] : [q, p];
  return w !== l && (w - l === 1 || CLEAR_SHOOTOUT_FINALS.has(`${w}-${l}`));
}

/**
 * The result a draft reads as, for the match `aId` v `dId` under `sport`'s rules (matchSport) →
 * { state, ga, gd, tie, winner, shootout }:
 * - 'incomplete': a score is missing (its ga or gd is null);
 * - 'level': the score is level and nothing settles it yet: in football the shoot-out's score is missing, level or one
 *   no shoot-out ends on (`shootout` true; `impossible` for the last), in every other sport a level final score is not a
 *   result;
 * - 'ready': ga, gd, tie and winner as a sport's `simulate` returns them, without events. A level football score
 *   carries its shoot-out as football's tie ({ by: 'penalties', ga, gd }, attacker first), with no kicks: only the
 *   shoot-out's score is known, not who scored or missed.
 */
export function readResult(sport, draft = EMPTY_DRAFT, aId = 'a', dId = 'd') {
  const ga = scoreOf(draft?.a), gd = scoreOf(draft?.b);
  const shootout = levelNeedsShootout(sport);
  if (ga == null || gd == null) return { state: 'incomplete', ga, gd, tie: null, winner: null, shootout: false };
  if (ga !== gd) return { state: 'ready', ga, gd, tie: null, winner: ga > gd ? aId : dId, shootout: false };
  if (!shootout) return { state: 'level', ga, gd, tie: null, winner: null, shootout: false };
  const pa = scoreOf(draft?.pa), pd = scoreOf(draft?.pb);
  if (pa == null || pd == null || pa === pd) return { state: 'level', ga, gd, tie: null, winner: null, shootout: true };
  if (!possibleShootout(pa, pd)) return { state: 'level', ga, gd, tie: null, winner: null, shootout: true, impossible: true };
  return { state: 'ready', ga, gd, tie: { by: 'penalties', periods: [], A: [], D: [], ga: pa, gd: pd },
    winner: pa > pd ? aId : dId, shootout: true };
}
