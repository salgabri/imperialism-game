// Game shapes whose football association joined FIFA after 2001, for data sets of other seasons
// (docs/design/football-years.md, 'Federations by year'). A shape takes part in season-end year Y when its
// association was a FIFA member by the cutoff (30 June Y, the end of season Y). Before then it is held by
// heldBy (merged into that nation's empire at kick-off) or, with no holder, stays neutral (inactive).
// Membership dates are the dates of admission to FIFA, and each source is FIFA's page for that association.
// New Caledonia was admitted by the FIFA Congress in Paris on 20-21 May 2004; the Congress's last day is used
// because no more exact date was found. Either day is before that year's 30 June cutoff.

export const FOOTBALL_FEDERATIONS = {
  cutoff: '06-30',
  shapes: {
    '499': { name: 'Montenegro', fifa: 'MNE', member: '2007-05-31', heldBy: '688',
      source: 'https://inside.fifa.com/associations/MNE',
      before: 'Part of FR Yugoslavia, then Serbia and Montenegro (Serbia, 688, keeps its modern name and flag).' },
    '540': { name: 'New Caledonia', fifa: 'NCL', member: '2004-05-21', heldBy: '250',
      source: 'https://inside.fifa.com/associations/NCL',
      before: 'A French territory.' },
    '626': { name: 'Timor-Leste', fifa: 'TLS', member: '2005-09-12', heldBy: null,
      source: 'https://inside.fifa.com/associations/TLS',
      before: 'No FIFA member: neutral.' },
    '728': { name: 'South Sudan', fifa: 'SSD', member: '2012-05-25', heldBy: '729',
      source: 'https://inside.fifa.com/associations/SSD',
      before: 'Part of Sudan until independence on 9 July 2011, after the cutoff of season 2010/11.' },
    'KOS': { name: 'Kosovo', fifa: 'KVX', member: '2016-05-13', heldBy: null,
      source: 'https://inside.fifa.com/associations/KVX',
      before: 'No FIFA member: neutral.' },
  },
};
