import { createContext, useContext } from 'react';

/**
 * The year of the season on screen (a data set's `year`; null for today's built-in season): a club's crest is the one
 * it wore that season (src/data/crests.js). App provides it from the campaign's settings, or from the season chosen in
 * setup; TeamMark and SquadFlag read it.
 */
export const SeasonYear = createContext(null);

/** The season year marks are drawn for (null: today's). */
export const useSeasonYear = () => useContext(SeasonYear);
