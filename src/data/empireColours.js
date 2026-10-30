// The colour each empire's political fill is drawn from (theme.js empireFill): a nation's colour chosen to fit it
// and stand apart from its neighbours (nationColours.js, `npm run build:nation-colours`), a club's crest colour
// (clubColours.js, `npm run build:club-colours`). Keyed by team id alone, so the setup previews, the map, the key
// and the ledger agree before a campaign has built its teams.
import { NATIONS } from './teams.js';
import { NATION_COLOURS } from './nationColours.js';
import { clubColour } from './clubColours.js';
import { empireFill } from '../theme.js';

/** An empire's own colour, or null (a club with no crest and no correction): it then keeps a hash pastel. */
export function empireColour(id) {
  return NATION_COLOURS[id]?.[0] || NATIONS[id]?.[5] || clubColour(id) || null;
}

const fills = new Map();
/** An empire's political fill: the pastel of its own colour, in a nation's chosen lightness step. */
export function politicalFill(id) {
  let fill = fills.get(id);
  if (fill === undefined) {
    fill = empireFill(id, empireColour(id), NATION_COLOURS[id]?.[1] ?? null);
    fills.set(id, fill);
  }
  return fill;
}
