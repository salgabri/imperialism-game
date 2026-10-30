// How many top clubs each country map takes, and the order the setup screen lists them in
// (docs/design/domestic-campaigns.md). Every game nation sits in one tier: the bigger leagues
// take their top 100 clubs, smaller leagues and smaller nations fewer, and a map takes
// N = min(tier, viable clubs) (scripts/sync-domestic-clubs.mjs). Each tier lists its nations
// in priority order, by confederation (UEFA, CONMEBOL, CONCACAF, CAF, AFC, OFC) and then
// standing; the country list and the European leagues follow that order.

export const DOMESTIC_TIERS = Object.freeze([
  // The biggest leagues, three or four professional divisions deep.
  { clubs: 100, ids: ['826', '724', '276', '380', '250', '792', '076', '032', '484', '840'] },
  // Strong leagues and large football nations: about three divisions.
  { clubs: 60, ids: ['620', '528', '056', '643', '616', '392', '682', '156'] },
  // Established leagues: about two divisions.
  { clubs: 40, ids: [
    '040', '756', 'SCO', '203', '208', '578', '300', '752', '191', '688', '804', '642', '348', '100', '376',
    '170', '858', '152', '218', '600', '604',
    '818', '504', '012', '788', '710', '566',
    '410', '036', '364', '784', '634', '860', '368', '764', '360', '356',
  ] },
  // Smaller leagues: the top flight and the best of the second.
  { clubs: 24, ids: [
    '703', '705', '196', '070', '398', '031', '352', '246', '372', '268', '112', '051', '008', '807',
    '862', '068',
    '124', '188', '340', '591', '388', '320', '222',
    '384', '686', '120', '288', '466', '854', '270', '180', '024', '834', '434', '894', '404', '800', '716', '231', '729', '324',
    '400', '760', '414', '512', '422', '704', '458', '417', '762',
    '554',
  ] },
  // The smallest nations: about one top flight.
  { clubs: 16, ids: [
    '442', 'NIR', 'WAL', '233', '440', '428', '499', 'KOS', '498',
    '780', '332', '214', '558', '630', '740', '328', '084', '192', '044',
    '646', '072', '748', '508', '768', '204', '266', '178', '478', '624', '562', '454', '148', '108', '262',
    '430', '728', '706', '226', '140', '450', '426', '516', '694', '232',
    '795', '408', '275', '104', '050', '116', '418', '608', '158', '096', '496', '064', '524', '626', '586', '887',
    '144', '004',
    '242', '540', '548', '090', '598',
  ] },
]);

const capOf = new Map(DOMESTIC_TIERS.flatMap(tier => tier.ids.map(id => [id, tier.clubs])));
const rankOf = new Map(DOMESTIC_TIERS.flatMap(tier => tier.ids).map((id, rank) => [id, rank]));

/** How many of a nation's top clubs its country map takes; an unlisted nation gets the smallest tier. */
export function domesticCap(id) {
  return capOf.get(id) ?? DOMESTIC_TIERS.at(-1).clubs;
}

/** A nation's place in the priority order (0 first); unlisted nations come last. */
export function nationPriority(id) {
  return rankOf.get(id) ?? Infinity;
}
