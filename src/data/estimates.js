// A rating the game estimated rather than read (scripts/lib/nhl.mjs): every place that shows one says so, in these words.
export const ESTIMATE_TITLE = "Estimated rating: EA publishes only NHL 27's top 300 players, so this one comes from ice time and scoring";

/** Whether a squad player's rating is an estimate. */
export const isEstimated = player => player?.sourceInfo?.source === 'estimate';
