// Compact storage for the generated roster files. A player tuple is [name, role, rating, metadata?]; its metadata
// object becomes a row of values under a shared shape: the metadata's keys in order, plus the values every player of
// that shape has in common (the source, edition, snapshot date…). Key names and shared values are then written once
// per file instead of once per player, which was most of the bundle. unpackTuples rebuilds every tuple exactly:
// same values, same key order. Only primitives are shared, so no two players ever share an array or object.

const primitive = value => value === null || ['string', 'number', 'boolean'].includes(typeof value);

/**
 * The shapes of every metadata object in `tuples` and a `pack(tuple)` that writes one tuple as a row:
 * [name, role, rating] without metadata, else [name, role, rating, shapeIndex, ...values not shared by the shape].
 * Shapes are [keys, shared] pairs, in first-seen order.
 */
export function createTupleTable(tuples) {
  const byKeys = new Map(), shapes = [];
  for (const tuple of tuples) {
    const meta = tuple[3];
    if (meta === undefined) continue;
    const keys = Object.keys(meta), id = JSON.stringify(keys);
    let shape = byKeys.get(id);
    if (!shape) {
      shape = { index: shapes.length, keys, shared: Object.fromEntries(keys.filter(key => primitive(meta[key])).map(key => [key, meta[key]])) };
      byKeys.set(id, shape);
      shapes.push(shape);
    }
    for (const key of Object.keys(shape.shared)) if (!Object.is(shape.shared[key], meta[key])) delete shape.shared[key];
  }
  const pack = tuple => {
    if (tuple.length !== (tuple[3] === undefined ? 3 : 4)) throw new Error(`Unexpected player tuple ${JSON.stringify(tuple)}`);
    const [name, role, rating, meta] = tuple;
    if (meta === undefined) return [name, role, rating];
    const shape = byKeys.get(JSON.stringify(Object.keys(meta)));
    return [name, role, rating, shape.index, ...shape.keys.filter(key => !Object.hasOwn(shape.shared, key)).map(key => meta[key])];
  };
  return { shapes: shapes.map(shape => [shape.keys, shape.shared]), pack };
}

/** Rows written by createTupleTable's pack, back to [name, role, rating, metadata?] tuples. */
export function unpackTuples(rows, shapes) {
  return rows.map(row => {
    if (row.length === 3) return row;
    const [keys, shared] = shapes[row[3]];
    const meta = {};
    let next = 4;
    for (const key of keys) meta[key] = Object.hasOwn(shared, key) ? shared[key] : row[next++];
    return [row[0], row[1], row[2], meta];
  });
}
