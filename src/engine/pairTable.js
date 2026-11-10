// A hash table from pairs of integers to ids, for the map's geometry indexes: the label engine's point ids
// (empireLabels.js) and the border mesh's points and segments (mapBorders.js).

/**
 * Pairs of 32-bit integers to non-negative ids, on typed arrays (open addressing, linear probing). The world map has
 * about a hundred thousand vertices, and a Map keyed by "x,y" strings, or by numbers too large for small integers,
 * spends most of its time making and hashing those keys.
 *
 * `id(p, q, next)` returns the pair's id, storing `next` for it when the pair is new, so the caller hands out ids in
 * first-seen order with a counter of its own. p and q must be 32-bit integers (`(n | 0) === n`); -0 is stored as 0.
 * `expected` sizes the table for that many pairs at most half full. It grows past that, so a wrong estimate costs
 * only time.
 */
export function createPairTable(expected = 0) {
  let bits = 4;
  while (bits < 30 && 2 ** bits < 2 * expected) bits++;
  let first, second, ids, mask;
  const allocate = () => {
    first = new Int32Array(2 ** bits); second = new Int32Array(2 ** bits);
    // -1 marks an empty slot: every stored id is at least 0, while p and q may be any integer.
    ids = new Int32Array(2 ** bits).fill(-1);
    mask = 2 ** bits - 1;
  };
  allocate();
  // Multiplicative hashing; the top bits of the product are the best mixed, so the slot is taken from them.
  const slotOf = (p, q) => Math.imul(Math.imul(p, 0x9e3779b1) ^ q, 0x85ebca6b) >>> (32 - bits);
  const grow = () => {
    const oldFirst = first, oldSecond = second, oldIds = ids;
    bits++;
    allocate();
    for (let i = 0; i < oldIds.length; i++) {
      if (oldIds[i] === -1) continue;
      let slot = slotOf(oldFirst[i], oldSecond[i]);
      while (ids[slot] !== -1) slot = (slot + 1) & mask;
      first[slot] = oldFirst[i]; second[slot] = oldSecond[i]; ids[slot] = oldIds[i];
    }
  };
  let size = 0;
  return {
    id(p, q, next) {
      let slot = slotOf(p, q);
      for (;;) {
        const found = ids[slot];
        if (found === -1) break;
        if (first[slot] === p && second[slot] === q) return found;
        slot = (slot + 1) & mask;
      }
      first[slot] = p; second[slot] = q; ids[slot] = next;
      if (++size * 2 > ids.length) grow();
      return next;
    },
  };
}
