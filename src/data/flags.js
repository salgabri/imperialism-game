// ISO-3166 numeric id -> flag asset basename in public/flags/.
//
// Derived from the iso_a2 column of the Natural Earth 110m attribute table, with
// two football-specific overrides: the campaign fields England rather than the
// United Kingdom, and Kosovo has no ISO numeric code of its own.
//
// Assets are vendored from the MIT-licensed `flag-icons` package; re-sync them
// with `npm run sync-flags` after changing this map.

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
  '288': 'gh',        // Ghana
  '300': 'gr',        // Greece
  '320': 'gt',        // Guatemala
  '324': 'gn',        // Guinea
  '328': 'gy',        // Guyana
  '332': 'ht',        // Haiti
  '340': 'hn',        // Honduras
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
  '834': 'tz',        // Tanzania
  '840': 'us',        // United States
  '854': 'bf',        // Burkina Faso
  '858': 'uy',        // Uruguay
  '860': 'uz',        // Uzbekistan
  '862': 've',        // Venezuela
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
};

/** URL of a nation's flag, or null for map shapes outside the campaign. */
export function flagUrl(nationId) {
  const code = FLAG_CODES[nationId];
  return code ? `${import.meta.env.BASE_URL}flags/${code}.svg` : null;
}
