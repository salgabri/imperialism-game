# Self-hosted fonts

Unmodified WOFF2 webfonts supplied by the official Google Fonts CSS API, served locally through `src/fonts.css`. No operating-system font installation or external font request is required at runtime. Every face uses `font-display: swap`.

| Family | CSS weights | Google Fonts version | License |
| --- | --- | --- | --- |
| Archivo | Variable 400–700, normal width | v25 | [Archivo OFL](archivo-OFL.txt) |
| Archivo Narrow | Variable 400–700 | v35 | [Archivo Narrow OFL](archivo-narrow-OFL.txt) |
| Alegreya | 500 | v41 | [Alegreya OFL](alegreya-OFL.txt) |

Latin, Latin Extended, and Vietnamese subsets are included for European player names and accented Vietnamese names. The original Google Fonts Unicode ranges are retained in the stylesheet so browsers fetch only the subsets needed. These files do not include the optional Greek or Cyrillic subsets.

The nine WOFF2 files total 174,864 bytes (about 171 KiB). Brotli decompression, WOFF2 lengths, and embedded OpenType tables were checked locally. Archivo contains a `wght` axis spanning 100–900 (the stylesheet exposes the requested 400–700); Archivo Narrow contains `wght` 400–700. Alegreya is a static Medium face with weight class 500. The combined subsets of each family contain the requested `ČŠÇĞȘŞėł` glyphs and accented sample names including `Łukasz Szczęsny`, `João Félix`, `Hakan Çalhanoğlu`, and `Nguyễn`.

## Sources

The files were selected from the [official CSS response](https://fonts.googleapis.com/css2?family=Archivo:wght@400..700&family=Archivo+Narrow:wght@400..700&family=Alegreya:wght@500&display=swap) requested with a modern Chrome user agent.

| Local file | Original Google Fonts asset |
| --- | --- |
| archivo-latin-variable.woff2 | [Latin](https://fonts.gstatic.com/s/archivo/v25/k3kPo8UDI-1M0wlSV9XAw6lQkqWY8Q82sLydOxI.woff2) |
| archivo-latin-ext-variable.woff2 | [Latin Extended](https://fonts.gstatic.com/s/archivo/v25/k3kPo8UDI-1M0wlSV9XAw6lQkqWY8Q82sLyTOxK-vA.woff2) |
| archivo-vietnamese-variable.woff2 | [Vietnamese](https://fonts.gstatic.com/s/archivo/v25/k3kPo8UDI-1M0wlSV9XAw6lQkqWY8Q82sLySOxK-vA.woff2) |
| archivo-narrow-latin-variable.woff2 | [Latin](https://fonts.gstatic.com/s/archivonarrow/v35/tss0ApVBdCYD5Q7hcxTE1ArZ0bbwiXw.woff2) |
| archivo-narrow-latin-ext-variable.woff2 | [Latin Extended](https://fonts.gstatic.com/s/archivonarrow/v35/tss0ApVBdCYD5Q7hcxTE1ArZ0bb-iXxi2g.woff2) |
| archivo-narrow-vietnamese-variable.woff2 | [Vietnamese](https://fonts.gstatic.com/s/archivonarrow/v35/tss0ApVBdCYD5Q7hcxTE1ArZ0bb_iXxi2g.woff2) |
| alegreya-latin-500.woff2 | [Latin](https://fonts.gstatic.com/s/alegreya/v41/4UacrEBBsBhlBjvfkQjt71kZfyBzPgNGxBU4-6qj.woff2) |
| alegreya-latin-ext-500.woff2 | [Latin Extended](https://fonts.gstatic.com/s/alegreya/v41/4UacrEBBsBhlBjvfkQjt71kZfyBzPgNGxBU49aqjgSE.woff2) |
| alegreya-vietnamese-500.woff2 | [Vietnamese](https://fonts.gstatic.com/s/alegreya/v41/4UacrEBBsBhlBjvfkQjt71kZfyBzPgNGxBU49KqjgSE.woff2) |

## Licensing

All three families are licensed under the SIL Open Font License 1.1. Their original copyright notices and full licenses are bundled alongside the fonts. Original license sources:

- [Archivo — The Archivo Project Authors](https://raw.githubusercontent.com/google/fonts/main/ofl/archivo/OFL.txt)
- [Archivo Narrow — The Archivo Narrow Project Authors](https://raw.githubusercontent.com/google/fonts/main/ofl/archivonarrow/OFL.txt)
- [Alegreya — The Alegreya Project Authors](https://raw.githubusercontent.com/google/fonts/main/ofl/alegreya/OFL.txt)

Keep these license files with redistributions of the font binaries.
