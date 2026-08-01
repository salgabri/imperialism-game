// Capital cities as [longitude, latitude], keyed by the same ISO-3166 numeric id
// the map geometry uses.
//
// These anchor a nation on the map: the capital marker, the empire label, the
// spinner and both ends of an attack vector all sit on the capital rather than
// on the polygon's centre of mass. Distances between empires are measured
// capital-to-capital as a result.
//
// Where a country has more than one capital the seat of government is used
// (La Paz over Sucre, Pretoria over Cape Town, Amsterdam for the Netherlands).
// A capital that does not fall inside the country's outline at 110m resolution —
// small island capitals, mostly — is ignored at runtime in favour of the
// centroid, so an inaccuracy here degrades rather than breaks.

export const CAPITALS = {
  // ---- CONMEBOL ----
  '032': [-58.38, -34.60], // Buenos Aires
  '076': [-47.93, -15.78], // Brasília
  '858': [-56.19, -34.90], // Montevideo
  '170': [-74.07, 4.71],   // Bogotá
  '218': [-78.47, -0.18],  // Quito
  '604': [-77.04, -12.05], // Lima
  '152': [-70.65, -33.45], // Santiago
  '600': [-57.58, -25.28], // Asunción
  '862': [-66.90, 10.49],  // Caracas
  '068': [-68.15, -16.50], // La Paz

  // ---- UEFA ----
  '250': [2.35, 48.86],    // Paris
  '724': [-3.70, 40.42],   // Madrid
  '826': [-0.13, 51.51],   // London
  '620': [-9.14, 38.72],   // Lisbon
  '528': [4.90, 52.37],    // Amsterdam
  '276': [13.40, 52.52],   // Berlin
  '056': [4.35, 50.85],    // Brussels
  '380': [12.50, 41.90],   // Rome
  '191': [15.98, 45.81],   // Zagreb
  '578': [10.75, 59.91],   // Oslo
  '752': [18.07, 59.33],   // Stockholm
  '208': [12.57, 55.68],   // Copenhagen
  '756': [7.45, 46.95],    // Bern
  '040': [16.37, 48.21],   // Vienna
  '804': [30.52, 50.45],   // Kyiv
  '792': [32.86, 39.93],   // Ankara
  '616': [21.01, 52.23],   // Warsaw
  '688': [20.46, 44.79],   // Belgrade
  '203': [14.42, 50.09],   // Prague
  '300': [23.73, 37.98],   // Athens
  '348': [19.04, 47.50],   // Budapest
  '643': [37.62, 55.76],   // Moscow
  '642': [26.10, 44.43],   // Bucharest
  '705': [14.51, 46.06],   // Ljubljana
  '703': [17.11, 48.15],   // Bratislava
  '372': [-6.26, 53.35],   // Dublin
  '352': [-21.89, 64.13],  // Reykjavík
  '246': [24.94, 60.17],   // Helsinki
  '070': [18.41, 43.86],   // Sarajevo
  '008': [19.82, 41.33],   // Tirana
  'KOS': [21.17, 42.67],   // Pristina
  '499': [19.26, 42.44],   // Podgorica
  '807': [21.43, 42.00],   // Skopje
  '100': [23.32, 42.70],   // Sofia
  '268': [44.79, 41.72],   // Tbilisi
  '051': [44.51, 40.18],   // Yerevan
  '031': [49.87, 40.41],   // Baku
  '376': [35.21, 31.77],   // Jerusalem
  '196': [33.36, 35.17],   // Nicosia
  '398': [71.43, 51.13],   // Astana
  '112': [27.57, 53.90],   // Minsk
  '498': [28.86, 47.01],   // Chișinău
  '440': [25.28, 54.69],   // Vilnius
  '428': [24.11, 56.95],   // Riga
  '233': [24.75, 59.44],   // Tallinn
  '442': [6.13, 49.61],    // Luxembourg

  // ---- CAF ----
  '504': [-6.84, 34.02],   // Rabat
  '686': [-17.45, 14.72],  // Dakar
  '818': [31.24, 30.04],   // Cairo
  '566': [7.49, 9.06],     // Abuja
  '384': [-5.28, 6.83],    // Yamoussoukro
  '012': [3.06, 36.75],    // Algiers
  '120': [11.52, 3.85],    // Yaoundé
  '288': [-0.19, 5.60],    // Accra
  '788': [10.18, 36.81],   // Tunis
  '466': [-8.00, 12.65],   // Bamako
  '710': [28.19, -25.75],  // Pretoria
  '180': [15.31, -4.32],   // Kinshasa
  '854': [-1.53, 12.37],   // Ouagadougou
  '324': [-13.71, 9.51],   // Conakry
  '894': [28.28, -15.42],  // Lusaka
  '266': [9.45, 0.42],     // Libreville
  '404': [36.82, -1.29],   // Nairobi
  '716': [31.05, -17.83],  // Harare
  '231': [38.75, 9.03],    // Addis Ababa
  '834': [35.74, -6.16],   // Dodoma
  '800': [32.58, 0.35],    // Kampala
  '024': [13.23, -8.84],   // Luanda
  '508': [32.58, -25.97],  // Maputo
  '204': [2.63, 6.50],     // Porto-Novo
  '768': [1.22, 6.14],     // Lomé
  '694': [-13.23, 8.48],   // Freetown
  '430': [-10.80, 6.31],   // Monrovia
  '270': [-16.58, 13.45],  // Banjul
  '624': [-15.60, 11.86],  // Bissau
  '478': [-15.97, 18.08],  // Nouakchott
  '562': [2.11, 13.51],    // Niamey
  '148': [15.05, 12.11],   // N'Djamena
  '140': [18.56, 4.36],    // Bangui
  '178': [15.28, -4.27],   // Brazzaville
  '226': [8.78, 3.75],     // Malabo
  '434': [13.19, 32.89],   // Tripoli
  '729': [32.53, 15.50],   // Khartoum
  '728': [31.58, 4.85],    // Juba
  '232': [38.93, 15.34],   // Asmara
  '262': [43.14, 11.59],   // Djibouti
  '706': [45.34, 2.04],    // Mogadishu
  '646': [30.06, -1.94],   // Kigali
  '108': [29.92, -3.43],   // Gitega
  '450': [47.52, -18.88],  // Antananarivo
  '454': [33.79, -13.96],  // Lilongwe
  '516': [17.08, -22.56],  // Windhoek
  '072': [25.91, -24.63],  // Gaborone
  '426': [27.48, -29.31],  // Maseru
  '748': [31.14, -26.32],  // Mbabane

  // ---- CONCACAF ----
  '840': [-77.04, 38.90],  // Washington, D.C.
  '484': [-99.13, 19.43],  // Mexico City
  '124': [-75.70, 45.42],  // Ottawa
  '591': [-79.52, 8.98],   // Panama City
  '188': [-84.09, 9.93],   // San José
  '388': [-76.79, 17.97],  // Kingston
  '340': [-87.19, 14.08],  // Tegucigalpa
  '222': [-89.19, 13.69],  // San Salvador
  '320': [-90.51, 14.63],  // Guatemala City
  '558': [-86.25, 12.13],  // Managua
  '084': [-88.77, 17.25],  // Belmopan
  '192': [-82.38, 23.11],  // Havana
  '332': [-72.34, 18.54],  // Port-au-Prince
  '214': [-69.93, 18.47],  // Santo Domingo
  '780': [-61.52, 10.65],  // Port of Spain
  '044': [-77.34, 25.06],  // Nassau
  '630': [-66.11, 18.47],  // San Juan
  '328': [-58.16, 6.80],   // Georgetown
  '740': [-55.17, 5.85],   // Paramaribo

  // ---- AFC ----
  '392': [139.69, 35.69],  // Tokyo
  '410': [126.98, 37.57],  // Seoul
  '364': [51.39, 35.69],   // Tehran
  '036': [149.13, -35.28], // Canberra
  '682': [46.72, 24.71],   // Riyadh
  '634': [51.53, 25.29],   // Doha
  '368': [44.36, 33.31],   // Baghdad
  '784': [54.37, 24.45],   // Abu Dhabi
  '860': [69.24, 41.30],   // Tashkent
  '400': [35.93, 31.95],   // Amman
  '156': [116.41, 39.90],  // Beijing
  '764': [100.50, 13.76],  // Bangkok
  '704': [105.83, 21.03],  // Hanoi
  '360': [106.85, -6.21],  // Jakarta
  '458': [101.69, 3.14],   // Kuala Lumpur
  '608': [120.98, 14.60],  // Manila
  '104': [96.13, 19.75],   // Naypyidaw
  '116': [104.92, 11.56],  // Phnom Penh
  '418': [102.63, 17.97],  // Vientiane
  '626': [125.57, -8.56],  // Dili
  '096': [114.94, 4.90],   // Bandar Seri Begawan
  '356': [77.21, 28.61],   // New Delhi
  '586': [73.05, 33.68],   // Islamabad
  '050': [90.41, 23.81],   // Dhaka
  '144': [79.89, 6.90],    // Sri Jayawardenepura Kotte
  '524': [85.32, 27.72],   // Kathmandu
  '064': [89.64, 27.47],   // Thimphu
  '004': [69.21, 34.53],   // Kabul
  '762': [68.79, 38.56],   // Dushanbe
  '417': [74.60, 42.87],   // Bishkek
  '795': [58.38, 37.95],   // Ashgabat
  '496': [106.92, 47.89],  // Ulaanbaatar
  '408': [125.75, 39.04],  // Pyongyang
  '158': [121.56, 25.03],  // Taipei
  '422': [35.50, 33.89],   // Beirut
  '760': [36.29, 33.51],   // Damascus
  '887': [44.21, 15.35],   // Sanaa
  '512': [58.41, 23.59],   // Muscat
  '414': [47.98, 29.38],   // Kuwait City
  '275': [35.21, 31.90],   // Ramallah

  // ---- OFC ----
  '554': [174.78, -41.29], // Wellington
  '242': [178.44, -18.14], // Suva
  '598': [147.18, -9.44],  // Port Moresby
  '090': [159.96, -9.43],  // Honiara
  '548': [168.32, -17.73], // Port Vila
  '540': [166.46, -22.28], // Nouméa

  // ---- dependencies ----
  '304': [-51.72, 64.18],  // Nuuk
};
