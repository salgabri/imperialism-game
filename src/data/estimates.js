// A rating the game estimated rather than read: every place that shows one says so, in its league's words. Hockey's
// (scripts/lib/nhl.mjs) fill in below EA's top 300; the EuroLeague's (scripts/lib/euroleague.mjs) are all estimates.
const REASONS = Object.freeze({
  NHL: Object.freeze({ reason: "EA publishes only NHL 27's top 300 players", basis: 'ice time and scoring' }),
  EuroLeague: Object.freeze({ reason: 'no game rates EuroLeague players', basis: 'his EuroLeague box scores (PIR a game)' }),
});
const reasonOf = player => REASONS[player?.sourceInfo?.league] || REASONS.NHL;

/** Hockey's words, which a player whose estimate names no league (an NHL player) takes. */
export const ESTIMATE_TITLE = `Estimated rating: ${REASONS.NHL.reason}, so this one comes from ${REASONS.NHL.basis}`;

/** Whether a squad player's rating is an estimate. */
export const isEstimated = player => player?.sourceInfo?.source === 'estimate';

/** Why a player's rating is an estimate, and from what: his league's words. */
export const estimateTitle = player => {
  const { reason, basis } = reasonOf(player);
  return `Estimated rating: ${reason}, so this one comes from ${basis}`;
};

/** The short reason, for a note under a squad ("…, each marked: no game rates EuroLeague players."). */
export const estimateReason = player => reasonOf(player).reason;
