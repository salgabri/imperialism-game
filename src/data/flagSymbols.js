// Reviewed, independently scalable emblems from the vendored flag-icons SVGs.
// Only the field may stretch with territory: symbol bounds retain native aspect.
// Generate/check assets with scripts/build-flag-symbols.mjs. Original flags and
// their small UI chips remain unchanged; unknown flags retain their full artwork.
// Bounds are native-browser measurements, rounded outward with a one-unit
// stroke margin. The Swiss cross has no stroke and has exact square bounds.
const profile = (code, x, y, w, h, fieldConstraints) => Object.freeze({
  id: `${code}-symbol`,
  sourceWidth: 640,
  sourceHeight: 480,
  bounds: Object.freeze({ x, y, w, h }),
  fieldFile: `flags-symbols/${code}-field.svg`,
  symbolFile: `flags-symbols/${code}-symbol.svg`,
  ...(fieldConstraints ? { fieldConstraints: Object.freeze(fieldConstraints) } : {}),
});

export const FLAG_SYMBOLS = Object.freeze({
  al: profile('al', 181, 92, 278, 296),
  br: profile('br', 16, 43, 608, 394),
  ca: profile('ca', 186, 94, 259, 281, { maxWidthRatio: 1.12 }),
  ch: profile('ch', 170, 90, 300, 300),
  es: profile('es', 114, 148, 184, 184),
  jp: profile('jp', 169, 89, 302, 302),
  kz: profile('kz', 176, 32, 339, 339),
  md: profile('md', 137, 81, 331, 318),
  me: profile('me', 183, 85, 272, 312),
  pt: profile('pt', 148, 131, 216, 218),
  si: profile('si', 85, 72, 145, 162, { maxWidthRatio: 1.35, maxHeightRatio: 1.15 }),
  sk: profile('sk', 127, 108, 212, 264),
  tr: profile('tr', 162, 126, 339, 243),
  xk: profile('xk', 138, 72, 364, 331),
});
