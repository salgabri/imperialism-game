// World Football Elo (eloratings.net) team code for every map nation, keyed by
// NATIONS id. Built once from eloratings.net's en.teams.tsv by exact name, with
// the label differences noted inline, and checked against World.tsv of
// 18 Oct 2026: all 176 codes are present and distinct (Scotland, Wales,
// Northern Ireland and the three Pacific islands added on 10 Nov 2026, when
// they joined the map). Codes are stable across years (teams.tsv remaps only
// historical sides such as Yugoslavia or Zaire). They are not ISO alpha-2:
// England is EN, Kosovo KO, Northern Ireland EI, Scotland SQ, Timor-Leste TL.
// Used offline by scripts/football-validate.mjs only; Elo is never shipped.

export const ELO_CODES = {
  // UEFA
  '008': 'AL', // Albania
  '051': 'AM', // Armenia
  '040': 'AT', // Austria
  '031': 'AZ', // Azerbaijan
  '112': 'BY', // Belarus
  '056': 'BE', // Belgium
  '070': 'BA', // Bosnia & Herz. (Elo: Bosnia and Herzegovina)
  '100': 'BG', // Bulgaria
  '191': 'HR', // Croatia
  '196': 'CY', // Cyprus
  '203': 'CZ', // Czechia
  '208': 'DK', // Denmark
  '826': 'EN', // England
  '233': 'EE', // Estonia
  '246': 'FI', // Finland
  '250': 'FR', // France
  '268': 'GE', // Georgia
  '276': 'DE', // Germany
  '300': 'GR', // Greece
  '348': 'HU', // Hungary
  '352': 'IS', // Iceland
  '372': 'IE', // Ireland
  '376': 'IL', // Israel
  '380': 'IT', // Italy
  '398': 'KZ', // Kazakhstan
  'KOS': 'KO', // Kosovo
  '428': 'LV', // Latvia
  '440': 'LT', // Lithuania
  '442': 'LU', // Luxembourg
  '498': 'MD', // Moldova
  '499': 'ME', // Montenegro
  '807': 'NM', // N. Macedonia (Elo: North Macedonia)
  '528': 'NL', // Netherlands
  '578': 'NO', // Norway
  '616': 'PL', // Poland
  '620': 'PT', // Portugal
  '642': 'RO', // Romania
  '643': 'RU', // Russia
  '688': 'RS', // Serbia
  '703': 'SK', // Slovakia
  '705': 'SI', // Slovenia
  '724': 'ES', // Spain
  '752': 'SE', // Sweden
  '756': 'CH', // Switzerland
  '792': 'TR', // Turkey
  '804': 'UA', // Ukraine
  'SCO': 'SQ', // Scotland
  'WAL': 'WA', // Wales
  'NIR': 'EI', // Northern Ireland
  // CONMEBOL
  '032': 'AR', // Argentina
  '068': 'BO', // Bolivia
  '076': 'BR', // Brazil
  '152': 'CL', // Chile
  '170': 'CO', // Colombia
  '218': 'EC', // Ecuador
  '600': 'PY', // Paraguay
  '604': 'PE', // Peru
  '858': 'UY', // Uruguay
  '862': 'VE', // Venezuela
  // CAF
  '012': 'DZ', // Algeria
  '024': 'AO', // Angola
  '204': 'BJ', // Benin
  '072': 'BW', // Botswana
  '854': 'BF', // Burkina Faso
  '108': 'BI', // Burundi
  '120': 'CM', // Cameroon
  '140': 'CF', // Central African Rep. (Elo: Central African Republic)
  '148': 'TD', // Chad
  '178': 'CG', // Congo
  '384': 'CI', // Côte d'Ivoire (Elo: Ivory Coast)
  '262': 'DJ', // Djibouti
  '180': 'CD', // DR Congo
  '818': 'EG', // Egypt
  '226': 'GQ', // Eq. Guinea (Elo: Equatorial Guinea)
  '232': 'ER', // Eritrea
  '748': 'SW', // Eswatini
  '231': 'ET', // Ethiopia
  '266': 'GA', // Gabon
  '270': 'GM', // Gambia
  '288': 'GH', // Ghana
  '324': 'GN', // Guinea
  '624': 'GW', // Guinea-Bissau
  '404': 'KE', // Kenya
  '426': 'LS', // Lesotho
  '430': 'LR', // Liberia
  '434': 'LY', // Libya
  '450': 'MG', // Madagascar
  '454': 'MW', // Malawi
  '466': 'ML', // Mali
  '478': 'MR', // Mauritania
  '504': 'MA', // Morocco
  '508': 'MZ', // Mozambique
  '516': 'NA', // Namibia
  '562': 'NE', // Niger
  '566': 'NG', // Nigeria
  '646': 'RW', // Rwanda
  '686': 'SN', // Senegal
  '694': 'SL', // Sierra Leone
  '706': 'SO', // Somalia
  '710': 'ZA', // South Africa
  '728': 'SS', // South Sudan
  '729': 'SD', // Sudan
  '834': 'TZ', // Tanzania
  '768': 'TG', // Togo
  '788': 'TN', // Tunisia
  '800': 'UG', // Uganda
  '894': 'ZM', // Zambia
  '716': 'ZW', // Zimbabwe
  // AFC
  '004': 'AF', // Afghanistan
  '036': 'AU', // Australia
  '050': 'BD', // Bangladesh
  '064': 'BT', // Bhutan
  '096': 'BN', // Brunei
  '116': 'KH', // Cambodia
  '156': 'CN', // China
  '158': 'TW', // Chinese Taipei (Elo: Taiwan)
  '356': 'IN', // India
  '360': 'ID', // Indonesia
  '364': 'IR', // Iran
  '368': 'IQ', // Iraq
  '392': 'JP', // Japan
  '400': 'JO', // Jordan
  '414': 'KW', // Kuwait
  '417': 'KG', // Kyrgyzstan
  '418': 'LA', // Laos
  '422': 'LB', // Lebanon
  '458': 'MY', // Malaysia
  '496': 'MN', // Mongolia
  '104': 'MM', // Myanmar
  '524': 'NP', // Nepal
  '408': 'KP', // North Korea
  '512': 'OM', // Oman
  '586': 'PK', // Pakistan
  '275': 'PS', // Palestine
  '608': 'PH', // Philippines
  '634': 'QA', // Qatar
  '682': 'SA', // Saudi Arabia
  '410': 'KR', // South Korea
  '144': 'LK', // Sri Lanka
  '760': 'SY', // Syria
  '762': 'TJ', // Tajikistan
  '764': 'TH', // Thailand
  '626': 'TL', // Timor-Leste (Elo: East Timor)
  '795': 'TM', // Turkmenistan
  '784': 'AE', // United Arab Emirates
  '860': 'UZ', // Uzbekistan
  '704': 'VN', // Vietnam
  '887': 'YE', // Yemen
  // CONCACAF
  '044': 'BS', // Bahamas
  '084': 'BZ', // Belize
  '124': 'CA', // Canada
  '188': 'CR', // Costa Rica
  '192': 'CU', // Cuba
  '214': 'DO', // Dominican Rep. (Elo: Dominican Republic)
  '222': 'SV', // El Salvador
  '320': 'GT', // Guatemala
  '328': 'GY', // Guyana
  '332': 'HT', // Haiti
  '340': 'HN', // Honduras
  '388': 'JM', // Jamaica
  '484': 'MX', // Mexico
  '558': 'NI', // Nicaragua
  '591': 'PA', // Panama
  '630': 'PR', // Puerto Rico
  '740': 'SR', // Suriname
  '780': 'TT', // Trinidad & Tobago (Elo: Trinidad and Tobago)
  '840': 'US', // United States
  // OFC
  '242': 'FJ', // Fiji
  '540': 'NC', // New Caledonia
  '554': 'NZ', // New Zealand
  '598': 'PG', // Papua New Guinea
  '090': 'SB', // Solomon Islands
  '548': 'VU', // Vanuatu
  '184': 'CK', // Cook Islands (no football XI: rugby league only)
  '776': 'TO', // Tonga (no football XI: rugby league only)
  '882': 'WS', // Samoa (no football XI: rugby league only)
};
