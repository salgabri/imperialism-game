// Game shapes whose football association joined FIFA after the earliest season the game ships (1996/97), for data
// sets of other seasons (docs/design/football-years.md, 'Federations by year'). A shape takes part in season-end year Y
// when its association was a FIFA member by the cutoff (30 June Y, the end of season Y). Before then it is held by
// heldBy (merged into that nation's empire at kick-off), until heldUntil where the holder's federation lost it earlier
// (by the same cutoff), or, with no holder, stays neutral (inactive). territoryFor in footballSetBuild.js reads this.
// Membership dates are the dates of admission to FIFA, and each source is FIFA's page for that association ("FIFA
// member since", read 2026-11-08). FIFA gives 1 January where only the year is known (Eritrea, Palestine): both were
// admitted in 1998, before that year's 30 June cutoff either way. New Caledonia was admitted by the FIFA Congress in
// Paris on 20-21 May 2004; the Congress's last day is used because no more exact date was found. Either day is before
// that year's 30 June cutoff.
//
// Every other game nation's association was a FIFA member before 1996: the Soviet, Yugoslav and Czechoslovak successor
// states by 1994. FR Yugoslavia (Serbia and Montenegro from 2003) plays as Serbia, 688, which keeps its modern name and
// flag in those years.

export const FOOTBALL_FEDERATIONS = {
  cutoff: '06-30',
  shapes: {
    '064': { name: 'Bhutan', fifa: 'BHU', member: '2000-08-01', heldBy: null,
      source: 'https://inside.fifa.com/associations/BHU',
      before: 'No FIFA member: neutral.' },
    '070': { name: 'Bosnia and Herzegovina', fifa: 'BIH', member: '1996-07-03', heldBy: null,
      source: 'https://inside.fifa.com/associations/BIH',
      before: 'Independent from 1992, its association not yet a FIFA member: neutral.' },
    '232': { name: 'Eritrea', fifa: 'ERI', member: '1998-01-01', heldBy: null,
      source: 'https://inside.fifa.com/associations/ERI',
      before: 'Independent from Ethiopia in 1993, its association not yet a FIFA member: neutral.' },
    '275': { name: 'Palestine', fifa: 'PLE', member: '1998-01-01', heldBy: null,
      source: 'https://inside.fifa.com/associations/PLE',
      before: 'No FIFA member: neutral.' },
    '496': { name: 'Mongolia', fifa: 'MNG', member: '1998-07-29', heldBy: null,
      source: 'https://inside.fifa.com/associations/MNG',
      before: 'No FIFA member: neutral.' },
    '499': { name: 'Montenegro', fifa: 'MNE', member: '2007-05-31', heldBy: '688',
      source: 'https://inside.fifa.com/associations/MNE',
      before: 'Part of FR Yugoslavia, then Serbia and Montenegro (Serbia, 688, keeps its modern name and flag).' },
    '540': { name: 'New Caledonia', fifa: 'NCL', member: '2004-05-21', heldBy: '250',
      source: 'https://inside.fifa.com/associations/NCL',
      before: 'A French territory.' },
    '626': { name: 'Timor-Leste', fifa: 'TLS', member: '2005-09-12', heldBy: null,
      source: 'https://inside.fifa.com/associations/TLS',
      before: 'No FIFA member: neutral (Indonesia\'s occupation until 1999 was never recognised by the United Nations).' },
    '728': { name: 'South Sudan', fifa: 'SSD', member: '2012-05-25', heldBy: '729',
      source: 'https://inside.fifa.com/associations/SSD',
      before: 'Part of Sudan until independence on 9 July 2011, after the cutoff of season 2010/11.' },
    'KOS': { name: 'Kosovo', fifa: 'KVX', member: '2016-05-13', heldBy: '688', heldUntil: '1999-06-10',
      source: 'https://inside.fifa.com/associations/KVX',
      heldSource: 'https://undocs.org/S/RES/1244(1999)',
      before: 'Part of FR Yugoslavia (Serbia, 688) until the United Nations took over its administration on 10 June 1999 '
        + '(Security Council resolution 1244), before the cutoff of season 1998/99; from then no FIFA member: neutral.' },
  },
};
