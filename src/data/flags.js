// ISO-3166 numeric id -> flag asset basename in public/flags/.
//
// Derived from the iso_a2 column of the Natural Earth 110m attribute table, with
// football-specific overrides: the United Kingdom's shape is England, beside
// Scotland, Wales and Northern Ireland, and Kosovo has no ISO numeric code of its own.
// Great Britain, the United Kingdom's team in the sports that play it as one, flies
// the Union Jack under its own flag id ('GBR', GREAT_BRITAIN in src/data/teams.js).
// A season of another era flies the flags of its federations of the day ('URS', 'CIS', 'YUG', 'FRY', 'ZAI'; a
// season's `identities`, src/data/namesOfTheDay.js) and each nation's flag of the day (src/data/flagsOfTheDay.js:
// 'ESP-1945' and the like).
//
// Assets are vendored from the MIT-licensed `flag-icons` package; re-sync them
// with `npm run sync-flags` after changing this map. The historic flags, which
// flag-icons does not have, are Wikimedia Commons SVGs (public domain, a few CC BY-SA)
// redrawn on its 4:3 canvas by `npm run build:historic-flags` (scripts/data/historic-flags.json,
// public/flags/SOURCES-historic.tsv).

export const FLAG_CODES = {
  '100': 'bg',        // Bulgaria
  '104': 'mm',        // Myanmar
  '108': 'bi',        // Burundi
  '112': 'by',        // Belarus
  '116': 'kh',        // Cambodia
  '120': 'cm',        // Cameroon
  '124': 'ca',        // Canada
  '140': 'cf',        // Central African Rep.
  '144': 'lk',        // Sri Lanka
  '148': 'td',        // Chad
  '152': 'cl',        // Chile
  '156': 'cn',        // China
  '158': 'tw',        // Chinese Taipei
  '170': 'co',        // Colombia
  '178': 'cg',        // Congo
  '180': 'cd',        // DR Congo
  '184': 'ck',        // Cook Islands
  '188': 'cr',        // Costa Rica
  '191': 'hr',        // Croatia
  '192': 'cu',        // Cuba
  '196': 'cy',        // Cyprus
  '203': 'cz',        // Czechia
  '204': 'bj',        // Benin
  '208': 'dk',        // Denmark
  '214': 'do',        // Dominican Rep.
  '218': 'ec',        // Ecuador
  '222': 'sv',        // El Salvador
  '226': 'gq',        // Eq. Guinea
  '231': 'et',        // Ethiopia
  '232': 'er',        // Eritrea
  '233': 'ee',        // Estonia
  '242': 'fj',        // Fiji
  '246': 'fi',        // Finland
  '250': 'fr',        // France
  '262': 'dj',        // Djibouti
  '266': 'ga',        // Gabon
  '268': 'ge',        // Georgia
  '270': 'gm',        // Gambia
  '275': 'ps',        // Palestine
  '276': 'de',        // Germany
  '278': 'dd',        // East Germany (on the map in its years: src/engine/historicMap.js)
  '288': 'gh',        // Ghana
  '300': 'gr',        // Greece
  '320': 'gt',        // Guatemala
  '324': 'gn',        // Guinea
  '328': 'gy',        // Guyana
  '332': 'ht',        // Haiti
  '340': 'hn-1949',   // Honduras (navy blue: its flag since 27 January 2026, as before 2022)
  '348': 'hu',        // Hungary
  '352': 'is',        // Iceland
  '356': 'in',        // India
  '360': 'id',        // Indonesia
  '364': 'ir',        // Iran
  '368': 'iq',        // Iraq
  '372': 'ie',        // Ireland
  '376': 'il',        // Israel
  '380': 'it',        // Italy
  '384': 'ci',        // Côte d'Ivoire
  '388': 'jm',        // Jamaica
  '392': 'jp',        // Japan
  '398': 'kz',        // Kazakhstan
  '400': 'jo',        // Jordan
  '404': 'ke',        // Kenya
  '408': 'kp',        // North Korea
  '410': 'kr',        // South Korea
  '414': 'kw',        // Kuwait
  '417': 'kg',        // Kyrgyzstan
  '418': 'la',        // Laos
  '422': 'lb',        // Lebanon
  '426': 'ls',        // Lesotho
  '428': 'lv',        // Latvia
  '430': 'lr',        // Liberia
  '434': 'ly',        // Libya
  '440': 'lt',        // Lithuania
  '442': 'lu',        // Luxembourg
  '450': 'mg',        // Madagascar
  '454': 'mw',        // Malawi
  '458': 'my',        // Malaysia
  '466': 'ml',        // Mali
  '478': 'mr',        // Mauritania
  '484': 'mx',        // Mexico
  '496': 'mn',        // Mongolia
  '498': 'md',        // Moldova
  '499': 'me',        // Montenegro
  '504': 'ma',        // Morocco
  '508': 'mz',        // Mozambique
  '512': 'om',        // Oman
  '516': 'na',        // Namibia
  '524': 'np',        // Nepal
  '528': 'nl',        // Netherlands
  '540': 'nc',        // New Caledonia
  '548': 'vu',        // Vanuatu
  '554': 'nz',        // New Zealand
  '558': 'ni',        // Nicaragua
  '562': 'ne',        // Niger
  '566': 'ng',        // Nigeria
  '578': 'no',        // Norway
  '586': 'pk',        // Pakistan
  '591': 'pa',        // Panama
  '598': 'pg',        // Papua New Guinea
  '600': 'py',        // Paraguay
  '604': 'pe',        // Peru
  '608': 'ph',        // Philippines
  '616': 'pl',        // Poland
  '620': 'pt',        // Portugal
  '624': 'gw',        // Guinea-Bissau
  '626': 'tl',        // Timor-Leste
  '630': 'pr',        // Puerto Rico
  '634': 'qa',        // Qatar
  '642': 'ro',        // Romania
  '643': 'ru',        // Russia
  '646': 'rw',        // Rwanda
  '682': 'sa',        // Saudi Arabia
  '686': 'sn',        // Senegal
  '688': 'rs',        // Serbia
  '694': 'sl',        // Sierra Leone
  '703': 'sk',        // Slovakia
  '704': 'vn',        // Vietnam
  '705': 'si',        // Slovenia
  '706': 'so',        // Somalia
  '710': 'za',        // South Africa
  '716': 'zw',        // Zimbabwe
  '724': 'es',        // Spain
  '728': 'ss',        // South Sudan
  '729': 'sd',        // Sudan
  '740': 'sr',        // Suriname
  '748': 'sz',        // Eswatini
  '752': 'se',        // Sweden
  '756': 'ch',        // Switzerland
  '760': 'sy',        // Syria
  '762': 'tj',        // Tajikistan
  '764': 'th',        // Thailand
  '768': 'tg',        // Togo
  '776': 'to',        // Tonga
  '780': 'tt',        // Trinidad & Tobago
  '784': 'ae',        // United Arab Emirates
  '788': 'tn',        // Tunisia
  '792': 'tr',        // Turkey
  '795': 'tm',        // Turkmenistan
  '800': 'ug',        // Uganda
  '804': 'ua',        // Ukraine
  '807': 'mk',        // N. Macedonia
  '818': 'eg',        // Egypt
  '826': 'gb-eng',    // England
  'SCO': 'gb-sct',    // Scotland
  'WAL': 'gb-wls',    // Wales
  'NIR': 'gb-nir',    // Northern Ireland
  'GBR': 'gb',        // Great Britain (the United Kingdom as one team)
  '834': 'tz',        // Tanzania
  '840': 'us',        // United States
  '854': 'bf',        // Burkina Faso
  '858': 'uy',        // Uruguay
  '860': 'uz',        // Uzbekistan
  '862': 've',        // Venezuela
  '882': 'ws',        // Samoa
  '887': 'ye',        // Yemen
  '894': 'zm',        // Zambia
  '032': 'ar',        // Argentina
  '076': 'br',        // Brazil
  '068': 'bo',        // Bolivia
  '056': 'be',        // Belgium
  '040': 'at',        // Austria
  '070': 'ba',        // Bosnia & Herz.
  '008': 'al',        // Albania
  'KOS': 'xk',        // Kosovo
  '051': 'am',        // Armenia
  '031': 'az',        // Azerbaijan
  '012': 'dz',        // Algeria
  '024': 'ao',        // Angola
  '072': 'bw',        // Botswana
  '084': 'bz',        // Belize
  '044': 'bs',        // Bahamas
  '036': 'au',        // Australia
  '096': 'bn',        // Brunei
  '050': 'bd',        // Bangladesh
  '064': 'bt',        // Bhutan
  '004': 'af',        // Afghanistan
  '090': 'sb',        // Solomon Islands
  // Federations of the day (historic flags, scripts/data/historic-flags.json):
  'URS': 'su',        // Soviet Union
  'CIS': 'cis-1992',  // CIS (its team's flag at Euro 1992)
  'YUG': 'yu',        // Yugoslavia (SFR Yugoslavia)
  'FRY': 'yu-1992',   // FR Yugoslavia
  'ZAI': 'zr',        // Zaire
  'RVN': 'rvn',       // South Vietnam
  'UAR': 'uar',       // United Arab Republic (Egypt); Syria's flag of 1980-2025 too
  // Flags of the day (src/data/flagsOfTheDay.js; scripts/data/historic-flags.json):
  'CAN-1957': 'ca-1957', // Canada, the Red Ensign (to 1965)
  'USA-1959': 'us-1959', // United States, 49 stars (1959-60)
  'BRA-1960': 'br-1960', // Brazil, 22 stars (1960-68)
  'BRA-1968': 'br-1968', // Brazil, 23 stars (1968-92)
  'MEX-1934': 'mx-1934', // Mexico, the arms of 1934 (to 1968)
  'ESP-1945': 'es-1945', // Spain (1945-77)
  'ESP-1977': 'es-1977', // Spain (1977-81)
  'ROU-1952': 'ro-1952', // Romania (1952-65)
  'ROU-1965': 'ro-1965', // Romania (1965-89)
  'BUL-1948': 'bg-1948', // Bulgaria (1948-67)
  'BUL-1967': 'bg-1967', // Bulgaria (1967-71)
  'BUL-1971': 'bg-1971', // Bulgaria (1971-90)
  'ALB-1946': 'al-1946', // Albania (1946-92)
  'GRE-1863': 'gr-1863', // Greece, the land flag with the crown (to 1969)
  'GRE-1822': 'gr-1822', // Greece, the land flag (1975-78)
  'RSA-1928': 'za-1928', // South Africa (1928-94)
  'RNY-1953': 'rn-1953', // Federation of Rhodesia and Nyasaland (1953-63)
  'RHO-1964': 'rh-1964', // Rhodesia (1964-68)
  'RHO-1968': 'rh-1968', // Rhodesia (1968-79)
  'ZRH-1979': 'zw-1979', // Zimbabwe Rhodesia (1979)
  'IRN-1933': 'ir-1933', // Iran, the lion and sun (1933-64)
  'IRN-1964': 'ir-1964', // Iran, the lion and sun (1964-80)
  'IRQ-1963': 'iq-1963', // Iraq (1963-91)
  'IRQ-1991': 'iq-1991', // Iraq (1991-2004)
  'IRQ-2004': 'iq-2004', // Iraq (2004-08)
  'HAI-1964': 'ht-1964', // Haiti (1964-86)
  'BLR-1991': 'by-1991', // Belarus (1991-95)
  'GEO-1990': 'ge-1990', // Georgia (1990-2004)
  'MKD-1992': 'mk-1992', // Macedonia (1992-95)
  'RUS-1954': 'ru-1954', // Russian SFSR (1954-91)
  'COD-1997': 'cd-1997', // DR Congo (1997-2006)
  'CGO-1970': 'cg-1970', // People's Republic of the Congo (1970-91)
  'BEN-1975': 'bj-1975', // People's Republic of Benin (1975-90)
  'ETH-1991': 'et-1991', // Ethiopia (1991-96)
  'LES-1987': 'ls-1987', // Lesotho (1987-2006)
  'LBY-1977': 'ly-1977', // Libya (1977-2011)
  'MYA-1974': 'mm-1974', // Burma (1974-2010)
  'VEN-1930': 've-1930', // Venezuela, seven stars (to 2006)
  'HON-2022': 'hn',      // Honduras, turquoise (2022-26: flag-icons' drawing)
};

/** URL of a nation's flag, or null for shapes without a mapped national flag. */
export function flagUrl(nationId) {
  const code = FLAG_CODES[nationId];
  return code ? `${import.meta.env.BASE_URL}flags/${code}.svg` : null;
}
