// The colour each empire's political fill is drawn from (theme.js empireFill): a nation's own colour (NATIONS),
// a club's crest colour (clubColours.js, `npm run build:club-colours`). Keyed by team id alone, so the setup
// previews, the map, the key and the ledger agree before a campaign has built its teams.
import { NATIONS } from './teams.js';
import { clubColour } from './clubColours.js';
import { empireFill } from '../theme.js';

/**
 * Nations that play in white take their flag's colour, so they do not all turn grey. Germany and New Zealand
 * (white and black, and no single flag colour) stay grey.
 */
const FLAG_COLOURS = Object.freeze({ '246': '#002f6c', '616': '#dc143c', '826': '#ce1124' });

/** An empire's own colour, or null (a club with no crest and no correction): it then keeps a hash pastel. */
export function empireColour(id) {
  return FLAG_COLOURS[id] || NATIONS[id]?.[5] || clubColour(id) || null;
}

const fills = new Map();
/** An empire's political fill: the pastel of its own colour. */
export function politicalFill(id) {
  let fill = fills.get(id);
  if (fill === undefined) {
    fill = empireFill(id, empireColour(id));
    fills.set(id, fill);
  }
  return fill;
}
