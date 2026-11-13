# Self-hosted fonts

WOFF2 webfonts from Google Fonts, served locally through `src/fonts.css`. No operating-system font installation or external font request is required at runtime. Every face uses `font-display: swap`.

| Family | CSS weights | Google Fonts version | Font version | License |
| --- | --- | --- | --- | --- |
| Archivo | Variable 400–700, normal width | v25 | 2.001 | [Archivo OFL](archivo-OFL.txt) |
| Archivo Narrow | Variable 400–700 | v35 | 3.002 | [Archivo Narrow OFL](archivo-narrow-OFL.txt) |
| Alegreya | 500 | v41 | | [Alegreya OFL](alegreya-OFL.txt) |

Latin, Latin Extended, and Vietnamese characters are included for European player names and accented Vietnamese names. Each of Archivo and Archivo Narrow is two files: Google Fonts' own Latin subset, unmodified, which is all a first visit's page loads, and one file that holds the Latin Extended and Vietnamese subsets together, which the browser fetches when a name needs it. Google serves those two subsets as separate files; one file instead of two saves a request on every first visit, because the offline worker precaches every font file (README "Caching"). The stylesheet keeps Google's Unicode ranges: the Latin rule's as served, the other's the union of Google's Latin Extended and Vietnamese ranges. These files do not include the optional Greek or Cyrillic subsets. Alegreya is no longer loaded (`src/fonts.css`); its three files are unmodified Google Fonts assets.

The seven WOFF2 files total 158,556 bytes (about 155 KiB). Archivo contains a `wght` axis spanning 100–900 (the stylesheet exposes the requested 400–700) and its width axis pinned at 100%, as in Google's files; Archivo Narrow contains `wght` 400–700. Alegreya is a static Medium face with weight class 500. The files of each family contain the requested `ČŠÇĞȘŞėł` glyphs and accented sample names including `Łukasz Szczęsny`, `João Félix`, `Hakan Çalhanoğlu`, and `Nguyễn`.

## The Latin Extended + Vietnamese files

`npm run build:fonts` (`scripts/build-fonts.mjs`) makes them from each family's variable font in Google Fonts' repository, at the commit that added the version Google Fonts serves, the version the Latin files carry. The sources are cached in `data-src/fonts/` (fetched through `scripts/lib/polite-fetch.mjs` when missing) and must have their pinned SHA-256. Each file holds exactly the characters its `@font-face` unicode-range covers, cut with HarfBuzz's subsetter (the `subset-font` package); `--check` rebuilds them and compares byte for byte.

| Local file | Source |
| --- | --- |
| archivo-latin-ext-vietnamese-variable.woff2 | [Archivo[wdth,wght].ttf](https://github.com/google/fonts/blob/6c70c829f09ea345d3590406693220ea35c6553f/ofl/archivo/Archivo%5Bwdth,wght%5D.ttf), version 2.001, width pinned at 100 |
| archivo-narrow-latin-ext-vietnamese-variable.woff2 | [ArchivoNarrow[wght].ttf](https://github.com/google/fonts/blob/58d0496254609d7ed6d25d80bd08d36d1e3e9db4/ofl/archivonarrow/ArchivoNarrow%5Bwght%5D.ttf), version 3.002 |

Checked on 13 November 2026 against the four Google Fonts files they replace, glyph by glyph at every 25 units of weight: no advance width and no outline structure differs. Archivo Narrow's outlines are identical; Archivo's differ by at most 0.5 font units of 1,000, where HarfBuzz rounds a variation delta that Google's files keep fractional. Google's files also carried a few characters outside their own Unicode ranges (the space, `A`, `Á` and a few accents), which the stylesheet never sends to them; the new files leave those out. Together the two files are 16,308 bytes smaller than the four they replace.

## Sources

The Google Fonts files were selected from the [official CSS response](https://fonts.googleapis.com/css2?family=Archivo:wght@400..700&family=Archivo+Narrow:wght@400..700&family=Alegreya:wght@500&display=swap) requested with a modern Chrome user agent.

| Local file | Original Google Fonts asset |
| --- | --- |
| archivo-latin-variable.woff2 | [Latin](https://fonts.gstatic.com/s/archivo/v25/k3kPo8UDI-1M0wlSV9XAw6lQkqWY8Q82sLydOxI.woff2) |
| archivo-narrow-latin-variable.woff2 | [Latin](https://fonts.gstatic.com/s/archivonarrow/v35/tss0ApVBdCYD5Q7hcxTE1ArZ0bbwiXw.woff2) |
| alegreya-latin-500.woff2 | [Latin](https://fonts.gstatic.com/s/alegreya/v41/4UacrEBBsBhlBjvfkQjt71kZfyBzPgNGxBU4-6qj.woff2) |
| alegreya-latin-ext-500.woff2 | [Latin Extended](https://fonts.gstatic.com/s/alegreya/v41/4UacrEBBsBhlBjvfkQjt71kZfyBzPgNGxBU49aqjgSE.woff2) |
| alegreya-vietnamese-500.woff2 | [Vietnamese](https://fonts.gstatic.com/s/alegreya/v41/4UacrEBBsBhlBjvfkQjt71kZfyBzPgNGxBU49KqjgSE.woff2) |

## Licensing

All three families are licensed under the SIL Open Font License 1.1, which allows modified versions such as these subsets; none of the three declares a Reserved Font Name. Their original copyright notices and full licenses are bundled alongside the fonts. Original license sources:

- [Archivo — The Archivo Project Authors](https://raw.githubusercontent.com/google/fonts/main/ofl/archivo/OFL.txt)
- [Archivo Narrow — The Archivo Narrow Project Authors](https://raw.githubusercontent.com/google/fonts/main/ofl/archivonarrow/OFL.txt)
- [Alegreya — The Alegreya Project Authors](https://raw.githubusercontent.com/google/fonts/main/ofl/alegreya/OFL.txt)

Keep these license files with redistributions of the font binaries.
