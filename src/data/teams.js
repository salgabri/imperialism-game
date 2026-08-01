// Football Imperialism — nation data, ratings, real stars (2026), squad generation
// Keyed by ISO-3166 numeric id (matches world-110m TopoJSON geometry ids). 'KOS' = Kosovo (-99 shape).

export const EXCLUDED_SHAPES = new Set(['010', '260', '238', '304', '732']); // Antarctica, Fr.S.Lands, Falklands, Greenland, W.Sahara

export const CONF_META = {
  UEFA:      { name: 'Europe (UEFA)',            baseStr: 63 },
  CONMEBOL:  { name: 'South America (CONMEBOL)', baseStr: 67 },
  CAF:       { name: 'Africa (CAF)',             baseStr: 59 },
  AFC:       { name: 'Asia (AFC)',               baseStr: 55 },
  CONCACAF:  { name: 'N. & C. America (CONCACAF)', baseStr: 57 },
  OFC:       { name: 'Oceania (OFC)',            baseStr: 48 },
};

// ---- Name pools by football culture ----
export const NAME_POOLS = {
  lat: { f: ['Santiago','Mateo','Nicolás','Diego','Juan','Emiliano','Thiago','Lucas','Gabriel','Franco','Iker','Álvaro'], l: ['García','Rodríguez','Fernández','López','Martínez','González','Romero','Herrera','Vargas','Castillo','Acosta','Molina'] },
  bra: { f: ['João','Pedro','Gustavo','Matheus','Rafael','Caio','Luiz','Felipe','Igor','Vitor','Éder','Renan'], l: ['Silva','Santos','Oliveira','Souza','Costa','Pereira','Almeida','Ribeiro','Carvalho','Moraes','Barbosa','Teixeira'] },
  fra: { f: ['Antoine','Lucas','Théo','Hugo','Enzo','Mathis','Léo','Nolan','Rayan','Maxime','Jules','Élie'], l: ['Dubois','Moreau','Lefèvre','Fontaine','Girard','Lambert','Mercier','Renard','Chevalier','Perrin','Roussel','Marchand'] },
  eng: { f: ['Harry','Jack','Oliver','George','Charlie','Callum','Mason','Reece','Jordan','Lewis','Tyler','Finley'], l: ['Walker','Turner','Robinson','Clarke','Wright','Bennett','Foster','Palmer','Shaw','Barnes','Hughes','Dawson'] },
  ger: { f: ['Lukas','Jonas','Felix','Maximilian','Leon','Niklas','Florian','Tim','Paul','Moritz','Jannik','Till'], l: ['Müller','Schmidt','Weber','Wagner','Becker','Hoffmann','Schulz','Keller','Braun','Vogel','Krüger','Lorenz'] },
  nor: { f: ['Emil','Oskar','Viktor','Anders','Mikkel','Elias','Axel','Henrik','Kasper','Jonas','Sverre','Nils'], l: ['Hansen','Johansson','Lindberg','Berg','Nielsen','Eriksen','Dahl','Holm','Nyström','Sørensen','Bakke','Lund'] },
  sla: { f: ['Aleksandar','Nikola','Marko','Luka','Andrej','Milan','Petar','Ivan','Dmytro','Pavlo','Matej','Bogdan'], l: ['Petrović','Kovačević','Jovanović','Novák','Horváth','Zieliński','Kowalski','Shevchuk','Bondar','Marić','Dvořák','Sokolov'] },
  ara: { f: ['Youssef','Omar','Karim','Ahmed','Mehdi','Sofiane','Bilal','Hamza','Rachid','Amine','Walid','Nassim'], l: ['Benali','El Amrani','Haddad','Mansour','Belhadj','Cherif','Bouzid','Saidi','Zerhouni','Khelifi','Attia','Farouk'] },
  per: { f: ['Reza','Sardar','Alireza','Mehdi','Saman','Milad','Kaveh','Omid','Payam','Arman'], l: ['Karimi','Ahmadi','Ghorbani','Moradi','Ebrahimi','Rashidi','Sadeghi','Norouzi','Hosseini','Rezaei'] },
  tur: { f: ['Emre','Cenk','Burak','Hakan','Arda','Kaan','Mert','Ozan','Yusuf','Berat'], l: ['Yılmaz','Kaya','Demir','Şahin','Çelik','Aydın','Öztürk','Arslan','Koç','Polat'] },
  cas: { f: ['Timur','Bakhtiyor','Ruslan','Nurlan','Aziz','Sanjar','Davron','Islom','Erlan','Otabek'], l: ['Alimov','Nazarov','Yusupov','Rakhimov','Karimov','Saidov','Turaev','Bekov','Ismailov','Umarov'] },
  jpn: { f: ['Takumi','Kaoru','Ritsu','Daichi','Wataru','Kenta','Sho','Haruki','Yuto','Sota'], l: ['Tanaka','Sato','Ito','Yamamoto','Nakamura','Kobayashi','Watanabe','Fujita','Mori','Hasegawa'] },
  kor: { f: ['Min-jae','Kang-in','Woo-young','Hee-chan','Seung-ho','Dong-hyun','Tae-yang','Ji-ho','Hyun-woo','Jun-seo'], l: ['Kim','Lee','Park','Choi','Jung','Kang','Cho','Yoon','Lim','Han'] },
  chn: { f: ['Wei','Lei','Jian','Hao','Ming','Chen','Tao','Feng','Bin','Kai'], l: ['Wang','Li','Zhang','Liu','Chen','Yang','Huang','Zhao','Wu','Zhou'] },
  sea: { f: ['Arif','Bagas','Chanathip','Minh','Rizky','Theerathon','Safawi','Dimas','Phon','Aung'], l: ['Pratama','Saputra','Bunmathan','Nguyen','Hidayat','Sukamto','Phommachanh','Ramos','Tran','Win'] },
  sas: { f: ['Sunil','Arjun','Rahul','Anirudh','Sandesh','Gurpreet','Ishan','Farhan','Kiran','Tenzin'], l: ['Sharma','Singh','Thapa','Fernandes','Jhingan','Kumar','Das','Rai','Hossain','Perera'] },
  afw: { f: ['Kwame','Kofi','Emeka','Chinedu','Sadio','Ousmane','Ibrahima','Sekou','Moussa','Abdoulaye','Yaya','Idrissa'], l: ['Mensah','Boateng','Okafor','Diallo','Traoré','Keita','Cissé','Ndiaye','Camara','Touré','Sow','Koné'] },
  afe: { f: ['Thabo','Sipho','Brian','Victor','Emmanuel','David','Joseph','Eliud','Given','Tendai'], l: ['Mwangi','Odhiambo','Banda','Phiri','Dlamini','Mokoena','Tshabalala','Okello','Chirwa','Moyo'] },
  pac: { f: ['Roy','Tuka','Manu','Sione','Waisake','Petero','Iosefo','Malakai','Teiko','Baraniko'], l: ['Krishna','Totori','Wichman','Kaltak','Naivalu','Tuivuna','Saumatua','Bakale','Teariki','Fifita'] },
  car: { f: ['Leon','Shamar','Andre','Dwayne','Kemar','Javon','Ricardo','Tyrese','Omari','Nathaniel'], l: ['Bailey','Grant','Campbell','Lewis','Findlay','Charles','Baptiste','Joseph','Providence','Straker'] },
  gre: { f: ['Giorgos','Kostas','Dimitris','Nikos','Vangelis','Petros','Stavros','Ilias'], l: ['Papadopoulos','Nikolaou','Georgiou','Ioannidis','Vlachos','Economou','Katsaros','Manolas'] },
  heb: { f: ['Eran','Manor','Oscar','Dor','Tai','Liel','Yonatan','Gadi'], l: ['Peretz','Cohen','Levi','Mizrahi','Biton','Avraham','Shapira','Golan'] },
  alb: { f: ['Ardit','Endrit','Blerim','Fisnik','Valon','Kreshnik','Altin','Drilon'], l: ['Hoxha','Krasniqi','Berisha','Gashi','Shala','Rexhepi','Dushku','Malaj'] },
};

// ---- Nation registry ----
// [name, code, conf, culture, strength|0=auto, color|0=auto, stars[[name,pos,rating],...]]
export const NATIONS = {
  // ======= CONMEBOL =======
  '032': ['Argentina', 'ARG', 'CONMEBOL', 'lat', 92, '#7EC8F2', [['L. Messi','FW',87],['J. Álvarez','FW',89],['L. Martínez','FW',87],['E. Fernández','MF',86],['E. Martínez','GK',85]]],
  '076': ['Brazil', 'BRA', 'CONMEBOL', 'bra', 89, '#FFD84D', [['Vinícius Jr','FW',91],['Raphinha','FW',88],['Rodrygo','FW',86],['Alisson','GK',87],['Endrick','FW',84]]],
  '858': ['Uruguay', 'URU', 'CONMEBOL', 'lat', 83, '#66B8E8', [['F. Valverde','MF',89],['R. Araújo','DF',86],['D. Núñez','FW',84],['M. Ugarte','MF',83]]],
  '170': ['Colombia', 'COL', 'CONMEBOL', 'lat', 83, '#FFCF3F', [['L. Díaz','FW',88],['J. Rodríguez','MF',82],['J. Durán','FW',83],['D. Sánchez','DF',81]]],
  '218': ['Ecuador', 'ECU', 'CONMEBOL', 'lat', 78, '#FFD23F', [['M. Caicedo','MF',87],['P. Estupiñán','DF',82],['K. Páez','MF',81]]],
  '604': ['Peru', 'PER', 'CONMEBOL', 'lat', 71, '#F25C5C', [['G. Lapadula','FW',75],['P. Quispe','MF',73]]],
  '152': ['Chile', 'CHI', 'CONMEBOL', 'lat', 72, '#E84855', [['A. Sánchez','FW',76],['B. Brereton Díaz','FW',76],['D. Osorio','MF',75]]],
  '600': ['Paraguay', 'PAR', 'CONMEBOL', 'lat', 74, '#E05263', [['M. Almirón','MF',79],['J. Enciso','FW',78]]],
  '862': ['Venezuela', 'VEN', 'CONMEBOL', 'lat', 71, '#8E3B46', [['S. Rondón','FW',77],['Y. Soteldo','FW',76],['J. Savarino','MF',76]]],
  '068': ['Bolivia', 'BOL', 'CONMEBOL', 'lat', 65, '#5BAA5F', [['M. Terceros','MF',74]]],
  // ======= UEFA =======
  '250': ['France', 'FRA', 'UEFA', 'fra', 91, '#4A7DF0', [['K. Mbappé','FW',92],['A. Tchouaméni','MF',86],['W. Saliba','DF',87],['E. Camavinga','MF',85],['A. Griezmann','FW',84]]],
  '724': ['Spain', 'ESP', 'UEFA', 'lat', 91, '#F0483E', [['L. Yamal','FW',93],['Rodri','MF',90],['Pedri','MF',89],['N. Williams','FW',86],['U. Simón','GK',84]]],
  '826': ['England', 'ENG', 'UEFA', 'eng', 90, '#F0F0F5', [['J. Bellingham','MF',91],['B. Saka','FW',89],['H. Kane','FW',88],['D. Rice','MF',87],['P. Foden','MF',87]]],
  '620': ['Portugal', 'POR', 'UEFA', 'bra', 88, '#E5334D', [['R. Dias','DF',88],['B. Fernandes','MF',87],['Vitinha','MF',87],['R. Leão','FW',86],['C. Ronaldo','FW',84]]],
  '528': ['Netherlands', 'NED', 'UEFA', 'ger', 87, '#FF7A26', [['V. van Dijk','DF',87],['F. de Jong','MF',86],['C. Gakpo','FW',85],['X. Simons','MF',84]]],
  '276': ['Germany', 'GER', 'UEFA', 'ger', 86, '#E8E8EC', [['F. Wirtz','MF',90],['J. Musiala','MF',89],['J. Kimmich','MF',86],['K. Havertz','FW',85]]],
  '056': ['Belgium', 'BEL', 'UEFA', 'fra', 85, '#F2C230', [['T. Courtois','GK',88],['K. De Bruyne','MF',85],['J. Doku','FW',85],['L. Openda','FW',83]]],
  '380': ['Italy', 'ITA', 'UEFA', 'lat', 84, '#52A7E0', [['G. Donnarumma','GK',88],['N. Barella','MF',86],['A. Bastoni','DF',86],['F. Chiesa','FW',82]]],
  '191': ['Croatia', 'CRO', 'UEFA', 'sla', 84, '#E4553F', [['J. Gvardiol','DF',87],['L. Modrić','MF',82],['M. Kovačić','MF',84]]],
  '578': ['Norway', 'NOR', 'UEFA', 'nor', 79, '#D94856', [['E. Haaland','FW',92],['M. Ødegaard','MF',88],['A. Sørloth','FW',82]]],
  '752': ['Sweden', 'SWE', 'UEFA', 'nor', 76, '#FFCE30', [['A. Isak','FW',89],['V. Gyökeres','FW',88],['D. Kulusevski','MF',84]]],
  '208': ['Denmark', 'DEN', 'UEFA', 'nor', 80, '#E03A45', [['R. Højlund','FW',82],['C. Eriksen','MF',81],['P. Dorgu','DF',79]]],
  '756': ['Switzerland', 'SUI', 'UEFA', 'ger', 80, '#E8404C', [['G. Xhaka','MF',84],['Y. Sommer','GK',85],['D. Ndoye','FW',79]]],
  '040': ['Austria', 'AUT', 'UEFA', 'ger', 79, '#DE4552', [['D. Alaba','DF',82],['C. Baumgartner','MF',81],['M. Sabitzer','MF',81]]],
  '804': ['Ukraine', 'UKR', 'UEFA', 'sla', 77, '#4FA8E8', [['A. Dovbyk','FW',83],['O. Zinchenko','DF',81],['A. Lunin','GK',83],['M. Mudryk','FW',80]]],
  '792': ['Turkey', 'TUR', 'UEFA', 'tur', 78, '#E23545', [['A. Güler','MF',87],['H. Çalhanoğlu','MF',86],['K. Yıldız','FW',85]]],
  '616': ['Poland', 'POL', 'UEFA', 'sla', 76, '#EAEAF0', [['R. Lewandowski','FW',85],['P. Zieliński','MF',82],['W. Szczęsny','GK',84]]],
  '688': ['Serbia', 'SRB', 'UEFA', 'sla', 76, '#C43B4B', [['D. Vlahović','FW',84],['S. Milinković-Savić','MF',82],['S. Pavlović','DF',82]]],
  '203': ['Czechia', 'CZE', 'UEFA', 'sla', 74, '#3E6ED0', [['P. Schick','FW',81],['T. Souček','MF',79]]],
  '300': ['Greece', 'GRE', 'UEFA', 'gre', 74, '#57A8E0', [['F. Ioannidis','FW',80],['K. Mavropanos','DF',79],['C. Tzolis','FW',79]]],
  '348': ['Hungary', 'HUN', 'UEFA', 'sla', 73, '#4C9E5C', [['D. Szoboszlai','MF',86],['R. Sallai','FW',79]]],
  '643': ['Russia', 'RUS', 'UEFA', 'sla', 73, '#D0455A', [['A. Golovin','MF',80],['M. Safonov','GK',80]]],
  '642': ['Romania', 'ROU', 'UEFA', 'sla', 72, '#F2C736', [['R. Drăgușin','DF',79],['D. Man','MF',77]]],
  '705': ['Slovenia', 'SVN', 'UEFA', 'sla', 74, '#54B87E', [['J. Oblak','GK',87],['B. Šeško','FW',87]]],
  '703': ['Slovakia', 'SVK', 'UEFA', 'sla', 72, '#4B7FD6', [['S. Lobotka','MF',83],['M. Škriniar','DF',82],['D. Hancko','DF',81]]],
  '372': ['Ireland', 'IRL', 'UEFA', 'eng', 70, '#4EA860', [['E. Ferguson','FW',78],['N. Collins','DF',77]]],
  '352': ['Iceland', 'ISL', 'UEFA', 'nor', 68, '#4B6FD8', [['A. Guðmundsson','FW',78],['I. Jóhannesson','MF',75]]],
  '246': ['Finland', 'FIN', 'UEFA', 'nor', 67, '#E4E8F0', [['J. Pohjanpalo','FW',75],['T. Pukki','FW',73]]],
  '070': ['Bosnia & Herz.', 'BIH', 'UEFA', 'sla', 71, '#3E63C4', [['E. Džeko','FW',76],['E. Demirović','FW',78]]],
  '008': ['Albania', 'ALB', 'UEFA', 'alb', 70, '#D63A45', [['K. Asllani','MF',76],['A. Broja','FW',75]]],
  'KOS': ['Kosovo', 'KVX', 'UEFA', 'alb', 68, '#4B8DE0', [['V. Muriqi','FW',76],['M. Rashica','FW',75]]],
  '499': ['Montenegro', 'MNE', 'UEFA', 'sla', 66, '#D0433E', [['S. Savić','DF',77]]],
  '807': ['N. Macedonia', 'MKD', 'UEFA', 'sla', 66, '#E0433A', [['E. Elmas','MF',78]]],
  '100': ['Bulgaria', 'BUL', 'UEFA', 'sla', 65, '#4E9E60', [['K. Despodov','FW',74]]],
  '268': ['Georgia', 'GEO', 'UEFA', 'sla', 74, '#E04350', [['K. Kvaratskhelia','FW',89],['G. Mikautadze','FW',81],['G. Mamardashvili','GK',84]]],
  '051': ['Armenia', 'ARM', 'UEFA', 'per', 63, '#E06A3C', [['E. Spertsyan','MF',77]]],
  '031': ['Azerbaijan', 'AZE', 'UEFA', 'cas', 61, '#42AEC8', 0],
  '376': ['Israel', 'ISR', 'UEFA', 'heb', 68, '#4B8BE8', [['O. Gloukh','MF',79],['M. Solomon','FW',77]]],
  '196': ['Cyprus', 'CYP', 'UEFA', 'gre', 62, '#E8A03C', 0],
  '398': ['Kazakhstan', 'KAZ', 'UEFA', 'cas', 62, '#40BBD4', 0],
  '112': ['Belarus', 'BLR', 'UEFA', 'sla', 62, '#4E9E58', 0],
  '498': ['Moldova', 'MDA', 'UEFA', 'sla', 60, '#4B72D0', 0],
  '440': ['Lithuania', 'LTU', 'UEFA', 'sla', 60, '#E8C33C', 0],
  '428': ['Latvia', 'LVA', 'UEFA', 'sla', 59, '#B03A46', 0],
  '233': ['Estonia', 'EST', 'UEFA', 'nor', 59, '#4B9ED8', 0],
  '442': ['Luxembourg', 'LUX', 'UEFA', 'fra', 62, '#58AEDE', [['L. Barreiro','MF',73]]],
  // ======= CAF =======
  '504': ['Morocco', 'MAR', 'CAF', 'ara', 84, '#DE3D48', [['A. Hakimi','DF',88],['B. Díaz','MF',84],['Y. Bounou','GK',85],['Y. En-Nesyri','FW',82]]],
  '686': ['Senegal', 'SEN', 'CAF', 'afw', 79, '#4CB86A', [['S. Mané','FW',83],['N. Jackson','FW',82],['K. Koulibaly','DF',81],['P. Matar Sarr','MF',80]]],
  '818': ['Egypt', 'EGY', 'CAF', 'ara', 76, '#D8404A', [['M. Salah','FW',89],['O. Marmoush','FW',85]]],
  '566': ['Nigeria', 'NGA', 'CAF', 'afw', 76, '#48B26A', [['V. Osimhen','FW',88],['A. Lookman','FW',85],['V. Boniface','FW',80]]],
  '384': ["Côte d'Ivoire", 'CIV', 'CAF', 'afw', 76, '#F0862E', [['S. Fofana','MF',81],['F. Kessié','MF',80],['O. Diomandé','DF',78]]],
  '012': ['Algeria', 'ALG', 'CAF', 'ara', 75, '#4CAE7E', [['R. Mahrez','FW',82],['M. Amoura','FW',80],['I. Bennacer','MF',80]]],
  '120': ['Cameroon', 'CMR', 'CAF', 'afw', 74, '#489E52', [['A. Onana','GK',83],['B. Mbeumo','FW',82]]],
  '288': ['Ghana', 'GHA', 'CAF', 'afw', 73, '#E8B93C', [['M. Kudus','MF',84],['T. Partey','MF',81],['A. Semenyo','FW',80]]],
  '788': ['Tunisia', 'TUN', 'CAF', 'ara', 73, '#DE4048', [['H. Mejbri','MF',76],['A. Laidouni','MF',75]]],
  '466': ['Mali', 'MLI', 'CAF', 'afw', 72, '#F2CC3A', [['Y. Bissouma','MF',80],['A. Haïdara','MF',78],['L. Camara','MF',78]]],
  '710': ['South Africa', 'RSA', 'CAF', 'afe', 71, '#4CA85E', [['R. Williams','GK',77],['P. Tau','FW',75],['T. Mokoena','MF',74]]],
  '180': ['DR Congo', 'COD', 'CAF', 'afw', 71, '#4B8BE0', [['Y. Wissa','FW',79],['C. Mbemba','DF',77],['C. Bakambu','FW',75]]],
  '854': ['Burkina Faso', 'BFA', 'CAF', 'afw', 70, '#4C9E5A', [['E. Tapsoba','DF',80],['B. Traoré','MF',76]]],
  '324': ['Guinea', 'GUI', 'CAF', 'afw', 70, '#D84444', [['S. Guirassy','FW',84]]],
  '894': ['Zambia', 'ZAM', 'CAF', 'afe', 68, '#4CA86A', [['P. Daka','FW',76]]],
  '266': ['Gabon', 'GAB', 'CAF', 'afw', 67, '#42A8B8', [['P-E. Aubameyang','FW',79]]],
  '404': ['Kenya', 'KEN', 'CAF', 'afe', 63, '#C44048', [['M. Olunga','FW',75]]],
  '716': ['Zimbabwe', 'ZIM', 'CAF', 'afe', 62, '#E8C238', [['M. Nakamba','MF',73]]],
  '231': ['Ethiopia', 'ETH', 'CAF', 'afe', 58, '#4C9E5C', 0],
  '834': ['Tanzania', 'TAN', 'CAF', 'afe', 60, '#42AECE', [['M. Samatta','FW',72]]],
  '800': ['Uganda', 'UGA', 'CAF', 'afe', 60, '#E8B93C', 0],
  '024': ['Angola', 'ANG', 'CAF', 'bra', 64, '#C43E48', 0],
  '508': ['Mozambique', 'MOZ', 'CAF', 'bra', 61, '#E0433E', 0],
  '204': ['Benin', 'BEN', 'CAF', 'afw', 63, '#4C9E58', [['S. Mounié','FW',74]]],
  '768': ['Togo', 'TOG', 'CAF', 'afw', 60, '#E8C93C', 0],
  '694': ['Sierra Leone', 'SLE', 'CAF', 'afw', 58, '#48B8D0', 0],
  '430': ['Liberia', 'LBR', 'CAF', 'afw', 56, '#C4404E', 0],
  '270': ['Gambia', 'GAM', 'CAF', 'afw', 61, '#D0433E', [['Y. Minteh','FW',78]]],
  '624': ['Guinea-Bissau', 'GNB', 'CAF', 'bra', 58, '#D8B93C', 0],
  '478': ['Mauritania', 'MTN', 'CAF', 'ara', 59, '#4CA85E', 0],
  '562': ['Niger', 'NIG', 'CAF', 'afw', 56, '#E88A2E', 0],
  '148': ['Chad', 'CHA', 'CAF', 'afw', 52, '#4B72D0', 0],
  '140': ['Central African Rep.', 'CTA', 'CAF', 'afw', 52, '#58AEDE', 0],
  '178': ['Congo', 'CGO', 'CAF', 'afw', 62, '#D84444', 0],
  '226': ['Eq. Guinea', 'EQG', 'CAF', 'lat', 60, '#4C9E5A', [['E. Nsue','FW',72]]],
  '434': ['Libya', 'LBY', 'CAF', 'ara', 60, '#4CA86A', 0],
  '729': ['Sudan', 'SDN', 'CAF', 'ara', 58, '#D0433E', 0],
  '728': ['South Sudan', 'SSD', 'CAF', 'afe', 50, '#42A8B8', 0],
  '232': ['Eritrea', 'ERI', 'CAF', 'afe', 48, '#E0433A', 0],
  '262': ['Djibouti', 'DJI', 'CAF', 'ara', 46, '#48B8D0', 0],
  '706': ['Somalia', 'SOM', 'CAF', 'ara', 46, '#4B8DE0', 0],
  '646': ['Rwanda', 'RWA', 'CAF', 'afe', 58, '#42AEC8', 0],
  '108': ['Burundi', 'BDI', 'CAF', 'afe', 54, '#C4404E', 0],
  '450': ['Madagascar', 'MAD', 'CAF', 'afe', 58, '#4C9E60', 0],
  '454': ['Malawi', 'MWI', 'CAF', 'afe', 56, '#D0433E', 0],
  '516': ['Namibia', 'NAM', 'CAF', 'afe', 58, '#4B72D0', 0],
  '072': ['Botswana', 'BOT', 'CAF', 'afe', 56, '#58AEDE', 0],
  '426': ['Lesotho', 'LES', 'CAF', 'afe', 52, '#4B8BE0', 0],
  '748': ['Eswatini', 'SWZ', 'CAF', 'afe', 50, '#4B72D0', 0],
  // ======= CONCACAF =======
  '840': ['United States', 'USA', 'CONCACAF', 'eng', 80, '#4B72D0', [['C. Pulisic','FW',85],['W. McKennie','MF',81],['A. Robinson','DF',81],['F. Balogun','FW',79],['M. Turner','GK',78]]],
  '484': ['Mexico', 'MEX', 'CONCACAF', 'lat', 80, '#4C9E58', [['S. Giménez','FW',83],['E. Álvarez','MF',81],['H. Lozano','FW',79],['L. Malagón','GK',78]]],
  '124': ['Canada', 'CAN', 'CONCACAF', 'eng', 76, '#DE3D48', [['A. Davies','DF',86],['J. David','FW',84],['S. Eustáquio','MF',77]]],
  '591': ['Panama', 'PAN', 'CONCACAF', 'lat', 72, '#D8404A', [['A. Carrasquilla','MF',76],['J. Fajardo','FW',73]]],
  '188': ['Costa Rica', 'CRC', 'CONCACAF', 'lat', 70, '#D0455A', [['K. Navas','GK',79],['M. Ugalde','FW',76]]],
  '388': ['Jamaica', 'JAM', 'CONCACAF', 'car', 68, '#E8B93C', [['L. Bailey','FW',78],['M. Antonio','FW',76],['D. Gray','FW',75]]],
  '340': ['Honduras', 'HON', 'CONCACAF', 'lat', 66, '#4B8DE0', [['A. Lozano','FW',73]]],
  '222': ['El Salvador', 'SLV', 'CONCACAF', 'lat', 62, '#4B72D0', 0],
  '320': ['Guatemala', 'GUA', 'CONCACAF', 'lat', 62, '#58AEDE', 0],
  '558': ['Nicaragua', 'NCA', 'CONCACAF', 'lat', 58, '#4B8BE0', 0],
  '084': ['Belize', 'BLZ', 'CONCACAF', 'car', 50, '#C43E48', 0],
  '192': ['Cuba', 'CUB', 'CONCACAF', 'lat', 60, '#D0433E', 0],
  '332': ['Haiti', 'HAI', 'CONCACAF', 'fra', 62, '#4B72D8', [['D. Nazon','FW',72]]],
  '214': ['Dominican Rep.', 'DOM', 'CONCACAF', 'lat', 58, '#4B8DE0', 0],
  '780': ['Trinidad & Tobago', 'TRI', 'CONCACAF', 'car', 62, '#D84450', [['L. García','FW',74]]],
  '044': ['Bahamas', 'BAH', 'CONCACAF', 'car', 44, '#42AEC8', 0],
  '630': ['Puerto Rico', 'PUR', 'CONCACAF', 'lat', 52, '#D0455A', 0],
  '328': ['Guyana', 'GUY', 'CONCACAF', 'car', 52, '#4C9E5C', 0],
  '740': ['Suriname', 'SUR', 'CONCACAF', 'car', 60, '#4CA86A', [['T. Kerk','FW',73]]],
  // ======= AFC =======
  '392': ['Japan', 'JPN', 'AFC', 'jpn', 82, '#4B6FD8', [['T. Kubo','MF',85],['K. Mitoma','FW',85],['W. Endo','MF',82],['T. Tomiyasu','DF',82],['K. Ueda','FW',80]]],
  '410': ['South Korea', 'KOR', 'AFC', 'kor', 78, '#DE3D48', [['H-M. Son','FW',85],['M-J. Kim','DF',85],['K-I. Lee','MF',84]]],
  '364': ['Iran', 'IRN', 'AFC', 'per', 77, '#4C9E60', [['M. Taremi','FW',80],['S. Azmoun','FW',78],['A. Beiranvand','GK',77]]],
  '036': ['Australia', 'AUS', 'AFC', 'eng', 75, '#E8B93C', [['M. Ryan','GK',76],['H. Souttar','DF',75],['J. Irvine','MF',74]]],
  '682': ['Saudi Arabia', 'KSA', 'AFC', 'ara', 72, '#4C9E58', [['S. Al-Dawsari','FW',78],['M. Kanno','MF',75]]],
  '634': ['Qatar', 'QAT', 'AFC', 'ara', 70, '#8E3B46', [['A. Afif','FW',79],['A. Ali','FW',76]]],
  '368': ['Iraq', 'IRQ', 'AFC', 'ara', 68, '#C43E48', [['A. Hussein','FW',74]]],
  '784': ['United Arab Emirates', 'UAE', 'AFC', 'ara', 68, '#C4404E', 0],
  '860': ['Uzbekistan', 'UZB', 'AFC', 'cas', 72, '#42AEC8', [['A. Khusanov','DF',83],['E. Shomurodov','FW',76],['A. Fayzullaev','MF',77]]],
  '400': ['Jordan', 'JOR', 'AFC', 'ara', 68, '#C44048', [['M. Al-Naimat','FW',74],['Y. Al-Tamari','MF',76]]],
  '156': ['China', 'CHN', 'AFC', 'chn', 64, '#D8404A', [['Wu Lei','FW',73]]],
  '764': ['Thailand', 'THA', 'AFC', 'sea', 62, '#4B72D0', [['C. Songkrasin','MF',74]]],
  '704': ['Vietnam', 'VIE', 'AFC', 'sea', 61, '#D84444', 0],
  '360': ['Indonesia', 'IDN', 'AFC', 'sea', 64, '#D0433E', 0],
  '458': ['Malaysia', 'MAS', 'AFC', 'sea', 58, '#E8B93C', 0],
  '608': ['Philippines', 'PHI', 'AFC', 'sea', 56, '#4B72D8', 0],
  '104': ['Myanmar', 'MYA', 'AFC', 'sea', 52, '#E8C33C', 0],
  '116': ['Cambodia', 'CAM', 'AFC', 'sea', 50, '#4B8DE0', 0],
  '418': ['Laos', 'LAO', 'AFC', 'sea', 48, '#C43E48', 0],
  '626': ['Timor-Leste', 'TLS', 'AFC', 'sea', 44, '#D0455A', 0],
  '096': ['Brunei', 'BRU', 'AFC', 'sea', 44, '#E8B93C', 0],
  '356': ['India', 'IND', 'AFC', 'sas', 58, '#4B8BE0', [['S. Chhetri','FW',68]]],
  '586': ['Pakistan', 'PAK', 'AFC', 'sas', 46, '#4C9E5A', 0],
  '050': ['Bangladesh', 'BAN', 'AFC', 'sas', 46, '#4CA85E', 0],
  '144': ['Sri Lanka', 'SRI', 'AFC', 'sas', 44, '#E8A03C', 0],
  '524': ['Nepal', 'NEP', 'AFC', 'sas', 46, '#D0455A', 0],
  '064': ['Bhutan', 'BHU', 'AFC', 'sas', 40, '#E8912E', 0],
  '004': ['Afghanistan', 'AFG', 'AFC', 'per', 46, '#C44048', 0],
  '762': ['Tajikistan', 'TJK', 'AFC', 'cas', 56, '#D0433E', 0],
  '417': ['Kyrgyzstan', 'KGZ', 'AFC', 'cas', 56, '#D84444', 0],
  '795': ['Turkmenistan', 'TKM', 'AFC', 'cas', 52, '#4C9E60', 0],
  '496': ['Mongolia', 'MGL', 'AFC', 'cas', 44, '#C4404E', 0],
  '408': ['North Korea', 'PRK', 'AFC', 'kor', 60, '#B03A46', 0],
  '158': ['Chinese Taipei', 'TPE', 'AFC', 'chn', 50, '#4B72D0', 0],
  '422': ['Lebanon', 'LIB', 'AFC', 'ara', 58, '#C43E48', 0],
  '760': ['Syria', 'SYR', 'AFC', 'ara', 60, '#C4404E', [['O. Al Somah','FW',73]]],
  '887': ['Yemen', 'YEM', 'AFC', 'ara', 48, '#C44048', 0],
  '512': ['Oman', 'OMA', 'AFC', 'ara', 62, '#D0433E', 0],
  '414': ['Kuwait', 'KUW', 'AFC', 'ara', 58, '#4B8DE0', 0],
  '275': ['Palestine', 'PLE', 'AFC', 'ara', 60, '#4C9E58', 0],
  // ======= OFC =======
  '554': ['New Zealand', 'NZL', 'OFC', 'eng', 68, '#E4E8F0', [['C. Wood','FW',79],['L. Cacace','DF',73]]],
  '242': ['Fiji', 'FIJ', 'OFC', 'pac', 48, '#48B8D0', [['R. Krishna','FW',70]]],
  '598': ['Papua New Guinea', 'PNG', 'OFC', 'pac', 42, '#D84450', 0],
  '090': ['Solomon Islands', 'SOL', 'OFC', 'pac', 44, '#4C9E5C', 0],
  '548': ['Vanuatu', 'VAN', 'OFC', 'pac', 42, '#E8B93C', 0],
  '540': ['New Caledonia', 'NCL', 'OFC', 'pac', 44, '#D0455A', 0],
};


// ---- RNG (mulberry32) ----
export function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

const POS_PLAN = ['GK', 'DF', 'DF', 'MF', 'MF', 'FW', 'FW'];

function genPlayer(rng, culture, pos, baseStr) {
  const pool = NAME_POOLS[culture] || NAME_POOLS.eng;
  const f = pool.f[Math.floor(rng() * pool.f.length)];
  const l = pool.l[Math.floor(rng() * pool.l.length)];
  const jitter = Math.floor(rng() * 9) - 4;
  const rating = Math.max(42, Math.min(88, Math.round(baseStr - 3 + jitter)));
  return { name: f[0] + '. ' + l, pos, rating, gen: true };
}

// Build a full team object for a campaign
export function buildTeam(id, rng) {
  const rec = NATIONS[id];
  if (!rec) return null;
  const [name, code, conf, culture, strRaw, colRaw, stars] = rec;
  const str = strRaw || Math.round(CONF_META[conf].baseStr + (rng() * 10 - 5));
  const col = colRaw || `oklch(0.72 0.14 ${Math.floor(hashStr(id) % 360)})`;
  const squad = [];
  if (stars) for (const [n, pos, r] of stars) squad.push({ name: n, pos, rating: r, gen: false });
  // fill to 7 following position plan
  const have = p => squad.filter(x => x.pos === p).length;
  const need = { GK: 1, DF: 2, MF: 2, FW: 2 };
  for (const p of ['GK', 'DF', 'MF', 'FW']) {
    while (have(p) < need[p] && squad.length < 7) squad.push(genPlayer(rng, culture, p, str));
  }
  let i = 0;
  while (squad.length < 7) { squad.push(genPlayer(rng, culture, POS_PLAN[i % 7], str)); i++; }
  return { id, name, code, conf, culture, str, col, squad, origin: id };
}

export function teamEff(team) {
  const top = team.squad.map(p => p.rating).sort((a, b) => b - a).slice(0, 5);
  const avg = top.reduce((s, r) => s + r, 0) / Math.max(1, top.length);
  return Math.round((0.55 * team.str + 0.45 * avg) * 10) / 10;
}

export const SCOPES = [
  { id: 'world', name: 'World War', desc: 'Every nation on the map. Last empire standing.', filter: () => true },
  { id: 'UEFA', name: 'Europe', desc: 'UEFA members battle for the continent.', filter: t => t.conf === 'UEFA' },
  { id: 'CONMEBOL', name: 'South America', desc: 'CONMEBOL. Ten nations, one crown.', filter: t => t.conf === 'CONMEBOL' },
  { id: 'CAF', name: 'Africa', desc: 'CAF, the deepest map in the game.', filter: t => t.conf === 'CAF' },
  { id: 'AFC', name: 'Asia & Oceania*', desc: 'AFC plus OFC — the whole east.', filter: t => t.conf === 'AFC' || t.conf === 'OFC' },
  { id: 'CONCACAF', name: 'N. & C. America', desc: 'CONCACAF, coast to coast.', filter: t => t.conf === 'CONCACAF' },
  { id: 'elite', name: 'Elite 32', desc: 'The 32 strongest nations on Earth.', filter: null }, // handled specially
];
