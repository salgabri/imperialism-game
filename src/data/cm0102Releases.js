// Known Championship Manager 01/02 databases, identified by the byte sizes of club.dat and staff.dat (unique
// across all of them). File sizes, SHA-256 digests, data seasons and the per-field year shifts (real year =
// stored year + shift) are facts from github.com/maxevans60/cm0102-bosman-edition@9afe4ea,
// docs/research/rules-0.6.0/databases-signatures.tsv and databases-date-shifts.tsv (docs CC-BY-4.0), plus
// SI's untouched format-1 3.9.60 and 3.9.65 files from tools/clean_files/manifest-3960.tsv and
// manifest-3965.tsv. Release months, providers and forum topics are from champman0102.co.uk. A signature
// holds the sizes and, where known, the digests of one copy of the files: 3.9.60 and 3.9.65 list SI's own
// files and the forum's editor re-saves. 3.9.68 starts in 2001 but carries 2002/03 squads. BOS's own Summer
// 2004 and Summer 2006 builds and the Empty database are left out. See docs/design/cm0102-format.md.
//
// The data set builder (src/data/footballSetBuild.js) reads this list in the CLI and in the browser.

export const CM0102_RELEASES = [
  { id: 'cm0102-2001-09', label: '3.9.60', provider: 'Sports Interactive', season: '2001/02', year: 2002, released: '2001-09',
    url: 'https://www.champman0102.co.uk/viewtopic.php?t=65', shifts: { birth: 0, joined: 0, contract: 0 },
    signatures: [
      { club: 6146980, staff: 30150534, clubSha256: '280f19b43c72e57446360c3a93dd3cdee1bb7b50eca058565b754dded623c178', staffSha256: 'eaf0c40525cf0d5ff1985f41a9bab118e91857c9d6944a8e41d1c809031b54fd' },
      { club: 6146980, staff: 30814144, clubSha256: 'd905a43fc0b2cef21b815601e5de0701258499ecd03b23568e7c93d05be3de17', staffSha256: 'd2e45c56bfbc34fd779a4460cd5d9f84740d71651ca29c4bf93a03117bda7dfd' },
    ] },
  { id: 'cm0102-2001-12', label: '3.9.65', provider: 'Sports Interactive', season: '2001/02', year: 2002, released: '2001-12',
    url: 'https://www.champman0102.co.uk/viewtopic.php?t=276', shifts: { birth: 0, joined: 0, contract: 0 },
    signatures: [
      { club: 6287001, staff: 30900029, clubSha256: '67a5dec870a9fe00ca8fa46167d893e4b94eb09771b5a9929427bbef023c1f63', staffSha256: '0c50375c752d4362661cda559921b55f3383225de808729e871f69b5aca38f41' },
      { club: 6287001, staff: 31580114, clubSha256: '0e4a4b95dee69ed1a8a2e84b6a1e8e5722f896e1f89abb3f1b168e8ff82a0732', staffSha256: 'e9dcddec72946d9afd5dd0c810fd75a84bb64cd1cf3a8c4e49622f9541339858' },
    ] },
  { id: 'cm0102-2002-11', label: '3.9.68', provider: 'Sports Interactive', season: '2002/03', year: 2003, released: '2002-11',
    url: 'https://www.champman0102.co.uk/viewtopic.php?t=66', shifts: { birth: 0, joined: 0, contract: 0 },
    signatures: [
      { club: 7677334, staff: 38469344, clubSha256: '32da1bc33450a1c73d9e3f4ffcd11fde2866ba7ff0f228f4effb2052856ecd87', staffSha256: '297d674bdb512546f2c12c174600ea2ba91768dfe4f97bcb6767e39eb99db8b4' },
    ] },
  { id: 'cm0102-2003-10', label: 'October 2003', provider: 'Sawczuk', season: '2003/04', year: 2004, released: '2003-10',
    url: 'https://www.champman0102.co.uk/viewtopic.php?t=266', shifts: { birth: 0, joined: 0, contract: 2 },
    signatures: [
      { club: 7678496, staff: 39458260, clubSha256: '44d237b423f1c63ea8a3d63e53ff24b0c865c3ff1fa9cf17f8a7af247adfaa5f', staffSha256: 'b705168377f9e9ae0014b7976093fc358b1d83da639bd5130f88644730154216' },
    ] },
  { id: 'cm0102-2005-09', label: 'September 2005', provider: 'Helvete', season: '2005/06', year: 2006, released: '2005-09',
    url: 'https://www.champman0102.co.uk/viewtopic.php?t=38', shifts: { birth: 3, joined: 0, contract: 4 },
    signatures: [
      { club: 7683725, staff: 40021236, clubSha256: 'a329e3154e1f9251797352a3de836f8372bdd4004947843a50a93f58f8ccfd32', staffSha256: '9d29062ccc3035e8fd9f49b05d69dca9c9e0ad56753d5aec02c53fc9de683431' },
    ] },
  { id: 'cm0102-2007-11', label: 'November 2007', provider: 'CM 01/02 Update Team', season: '2007/08', year: 2008, released: '2007-11',
    url: 'https://www.champman0102.co.uk/viewtopic.php?t=39', shifts: { birth: 6, joined: 6, contract: 6 },
    signatures: [
      { club: 7583793, staff: 36759152, clubSha256: '9d20b7513ee87e9b7d57f8bca59316263c6cd955f9ba53d4780dc75ba70ad946', staffSha256: 'd5aa76c9bbe7cb80507b707a4e83123fe0386357f845a99a8c8cb5d3c86ff5fd' },
    ] },
  { id: 'cm0102-2008-02', label: 'February 2008', provider: 'CM 01/02 Update Team', season: '2007/08', year: 2008, released: '2008-02',
    url: 'https://www.champman0102.co.uk/viewtopic.php?t=40', shifts: { birth: 6, joined: 6, contract: 6 },
    signatures: [
      { club: 7658742, staff: 36081250, clubSha256: 'aec7c66fa52495f92f56fb5a9cb565f3def43a84ab69aa55934349cd5abc0cc7', staffSha256: '3703923e810226336cef3c6ee9c0b544dfb946d56553647e7fc86f90597b9f8c' },
    ] },
  { id: 'cm0102-2008-09', label: 'September 2008', provider: 'CM 01/02 Update Team', season: '2008/09', year: 2009, released: '2008-09',
    url: 'https://www.champman0102.co.uk/viewtopic.php?t=41', shifts: { birth: 7, joined: 7, contract: 7 },
    signatures: [
      { club: 7726719, staff: 30881518, clubSha256: '5c2e3cdaf11e119dfc568986bc83af6599cdacae32e03e13cfc925194bb9c38d', staffSha256: '8da4b1477962c7770e6f13e0c8b030b0c9b5190f7330806700f2efdb667f5f61' },
    ] },
  { id: 'cm0102-2008-12', label: 'December 2008', provider: 'CM 01/02 Update Team', season: '2008/09', year: 2009, released: '2008-12',
    url: 'https://www.champman0102.co.uk/viewtopic.php?t=270', shifts: { birth: 7, joined: 7, contract: 7 },
    signatures: [
      { club: 7679077, staff: 29748664, clubSha256: '918bf1bca26616721319fd0f8c36bc61762323a2dc897e68e9cdf85f16cf2c4b', staffSha256: '9476e0e93336ec7398ca08d17e83539afef8eee4965a315de0146ef17b631be7' },
    ] },
  { id: 'cm0102-2009-03', label: 'March 2009', provider: 'CM 01/02 Update Team', season: '2008/09', year: 2009, released: '2009-03',
    url: 'https://www.champman0102.co.uk/viewtopic.php?t=42', shifts: { birth: 7, joined: 7, contract: 7 },
    signatures: [
      { club: 7704641, staff: 29838838, clubSha256: 'bc4561c395a0b8be55d8fc867c4a64817bfe2d599ac982abb206b51bc127392d', staffSha256: '70b21e57b4435c41b807dbd0db8edc61a3d25403fb5a6d23a79312090b16ccf5' },
    ] },
  { id: 'cm0102-2009-09', label: 'September 2009', provider: 'CM 01/02 Update Team', season: '2009/10', year: 2010, released: '2009-09',
    url: 'https://www.champman0102.co.uk/viewtopic.php?t=43', shifts: { birth: 8, joined: 8, contract: 8 },
    signatures: [
      { club: 7937041, staff: 29427794, clubSha256: 'b0fa7276a049c8eb9e0823183333f0c2660dc6cb4b1ce70c089b3b86aef65dd3', staffSha256: '017af844afaab5b6d37c5cb3dc91ea661673c54f8a7dc4671574dc2994e60c2e' },
    ] },
  { id: 'cm0102-2010-02', label: 'February 2010 ODB', provider: 'CM 01/02 Update Team', season: '2009/10', year: 2010, released: '2010-02',
    url: 'https://www.champman0102.co.uk/viewtopic.php?t=44', shifts: { birth: 8, joined: 8, contract: 8 },
    signatures: [
      { club: 7941689, staff: 29270528, clubSha256: '82b479a1cae83414000accb1a10232ca26452dc80f73b1c4607077f678de9ffb', staffSha256: 'e118c3396a98a26476f7cb14ba55356d5d6b1dc9a73ebf16ffc6b6af64a3314a' },
    ] },
  { id: 'cm0102-2010-04', label: 'April 2010 SIM', provider: 'CM 01/02 Update Team', season: '2009/10', year: 2010, released: '2010-04',
    url: 'https://www.champman0102.co.uk/viewtopic.php?t=273', shifts: { birth: 8, joined: 8, contract: 8 },
    signatures: [
      { club: 7999789, staff: 27230598, clubSha256: 'f5e7522c42f5d57ee864cc6d3e8ba5e9ed8fb5c42ac242aaaf50559d35f5db77', staffSha256: '80f06d857c80abc0c7f0b205dcff50edbdd1341d951002d41733a4fe25c9fd3c' },
    ] },
  { id: 'cm0102-2010-06', label: 'June 2010', provider: 'CM 01/02 Update Team', season: '2009/10', year: 2010, released: '2010-06',
    url: 'https://www.champman0102.co.uk/viewtopic.php?t=46', shifts: { birth: 9, joined: 8, contract: 8 },
    signatures: [
      { club: 8030582, staff: 29564922, clubSha256: '04dac9c4280f8d6c4183a22fe568326caa1776236a2f9ec3a457eca40cfd74fb', staffSha256: 'd12b6975af9a8f3ec872edcc9c95d3bcc9e220802a485afff5101beab5f4a4b0' },
    ] },
  { id: 'cm0102-2010-09', label: 'September 2010 ODB', provider: 'CM 01/02 Update Team', season: '2010/11', year: 2011, released: '2010-09',
    url: 'https://www.champman0102.co.uk/viewtopic.php?t=47', shifts: { birth: 9, joined: 9, contract: 9 },
    signatures: [
      { club: 8069509, staff: 30072480, clubSha256: '8678ba9ce53dd0cf255af5085c0775e6938a80d362ddf110570c388766f4aa81', staffSha256: '3d160acc99a00fe661db8246e6727da094234fa17c32bb6b491099965d92cb3a' },
    ] },
  { id: 'cm0102-2010-12', label: 'December 2010 SIM', provider: 'CM 01/02 Update Team', season: '2010/11', year: 2011, released: '2010-12',
    url: 'https://www.champman0102.co.uk/viewtopic.php?t=45', shifts: { birth: 9, joined: 9, contract: 9 },
    signatures: [
      { club: 8024191, staff: 24582416, clubSha256: 'ad39ca5c41d0199fc94140f0ab80331d30eac5ed02fc4436785e68f690c0c171', staffSha256: 'ec7429aba61cd4d239cac32c5b6752cd09d525241670775b1b46e925287ee6a2' },
    ] },
  { id: 'cm0102-2011-02', label: 'February 2011 ODB', provider: 'CM 01/02 Update Team', season: '2010/11', year: 2011, released: '2011-02',
    url: 'https://www.champman0102.co.uk/viewtopic.php?t=48', shifts: { birth: 9, joined: 9, contract: 9 },
    signatures: [
      { club: 8102045, staff: 30453692, clubSha256: '4230aaade066af9e4b42e3ed62a3b6315d5d5a3323ee2494274a8a2abe1e2d88', staffSha256: '2453d2e22395002458366aa956d69ea4ad079ab557cfaac1e8d31942591e0ee1' },
    ] },
  { id: 'cm0102-2011-04', label: 'April 2011 SIM', provider: 'CM 01/02 Update Team', season: '2010/11', year: 2011, released: '2011-04',
    url: 'https://www.champman0102.co.uk/viewtopic.php?t=272', shifts: { birth: 9, joined: 9, contract: 9 },
    signatures: [
      { club: 8020705, staff: 24225880, clubSha256: '896d0f7eb49fdb77dd4b63733296b352032fe46afde5f69a887a6d8d1b2d5643', staffSha256: '9bcd4e78d7245801ed3b7d7172a658addba98a024cfe2316c964a7f8b4933dfc' },
    ] },
  { id: 'cm0102-2011-09', label: 'September 2011 ODB', provider: 'CM 01/02 Update Team', season: '2011/12', year: 2012, released: '2011-09',
    url: 'https://www.champman0102.co.uk/viewtopic.php?t=49', shifts: { birth: 10, joined: 10, contract: 10 },
    signatures: [
      { club: 8308300, staff: 27460598, clubSha256: '9f0cc88f7804daf49f7ede557b3dfc776f5d709c6beca306c0ce4d086225c344', staffSha256: '1c28084eea4b8c4826e38ece8c72bfddfb0d490d34e6ef3e7de821dc64964fb2' },
    ] },
  { id: 'cm0102-2012-03-odb', label: 'March 2012 ODB', provider: 'CM 01/02 Update Team', season: '2011/12', year: 2012, released: '2012-03',
    url: 'https://www.champman0102.co.uk/viewtopic.php?t=50', shifts: { birth: 10, joined: 10, contract: 10 },
    signatures: [
      { club: 8409975, staff: 28795574, clubSha256: '582275c8a1628b9bddacb756168d4f232cdf3b06d7f1294ad23c1cf5bf81cd9b', staffSha256: 'a338f94b062dc812dc69d86c9f6dffd37e96fcf1783170388a0057bd861b108d' },
    ] },
  { id: 'cm0102-2012-03-sim', label: 'March 2012 SIM', provider: 'CM 01/02 Update Team', season: '2011/12', year: 2012, released: '2012-03',
    url: 'https://www.champman0102.co.uk/viewtopic.php?t=51', shifts: { birth: 10, joined: 10, contract: 10 },
    signatures: [
      { club: 7929488, staff: 23698096, clubSha256: 'c2e57136cd452b429a904d3901231909864057850c9a637f91999d7ab4a50f00', staffSha256: '1bf3f38a1f4ef6e7f69af1578f3c995ba003c9d3175d75e9e290dc36438c6b11' },
    ] },
  { id: 'cm0102-2012-09', label: 'September 2012', provider: 'CM 01/02 Update Team', season: '2012/13', year: 2013, released: '2012-09',
    url: 'https://www.champman0102.co.uk/viewtopic.php?t=52', shifts: { birth: 11, joined: 11, contract: 11 },
    signatures: [
      { club: 8418109, staff: 25832378, clubSha256: '055bd760035767da2e8cebcd7a7db9dbbaf976ba919bdd58781cae1e34ef392a', staffSha256: 'bc3648badd802a647e33709c85b190a90d314d8c90bca66e29dcbe1fad93f8e6' },
    ] },
  { id: 'cm0102-2013-03', label: 'March 2013', provider: 'CM 01/02 Update Team', season: '2012/13', year: 2013, released: '2013-03',
    url: 'https://www.champman0102.co.uk/viewtopic.php?t=269', shifts: { birth: 11, joined: 11, contract: 11 },
    signatures: [
      { club: 8509326, staff: 26677498, clubSha256: '67215bba564c60eebc9f03b26cdbb5a70decc8a7502ce8fd6999eed2c93685c4', staffSha256: 'f332e328ad9af3a6edae888e471786b92f2cae4454673f58e345489130dcfa47' },
    ] },
  { id: 'cm0102-2013-10', label: 'Autumn 2013', provider: 'CM 01/02 Update Team', season: '2013/14', year: 2014, released: '2013-10',
    url: 'https://www.champman0102.co.uk/viewtopic.php?t=53', shifts: { birth: 12, joined: 12, contract: 12 },
    signatures: [
      { club: 7533827, staff: 24522878, clubSha256: 'cd306e10ee0ddcc1f1152bfa6976e13a063b9e9c7d380aa85eab1a3683926ee3', staffSha256: '752750f110643baf6ce108b9acd046495d189ae8df2d1dd1343ed96baff71286' },
    ] },
  { id: 'cm0102-2014-03', label: 'March 2014', provider: 'CM 01/02 Update Team', season: '2013/14', year: 2014, released: '2014-03',
    url: 'https://www.champman0102.co.uk/viewtopic.php?t=54', shifts: { birth: 12, joined: 12, contract: 12 },
    signatures: [
      { club: 6629791, staff: 23470664, clubSha256: '317aa3a678ccffc548259b96e0735d295026946ba559efd2a55c957f40dfa38c', staffSha256: '0941a10e91e83220f289220500a5378247ae71b1e9e0ec09daa03dd84d5b2534' },
    ] },
  { id: 'cm0102-2014-10', label: 'October 2014', provider: 'CM 01/02 Update Team', season: '2014/15', year: 2015, released: '2014-10',
    url: 'https://www.champman0102.co.uk/viewtopic.php?t=55', shifts: { birth: 13, joined: 13, contract: 13 },
    signatures: [
      { club: 6587959, staff: 23292732, clubSha256: '795c3f0a5e3b4c8b06e35815b50a199f2b8e2840a0795c3e4ef12408d0d396eb', staffSha256: 'f6b9abbc9cbfefca43bfedf999ea2ac01af73495ac58742c752441368d1a6d00' },
    ] },
  { id: 'cm0102-2015-04', label: 'April 2015', provider: 'CM 01/02 Update Team', season: '2014/15', year: 2015, released: '2015-04',
    url: 'https://www.champman0102.co.uk/viewtopic.php?t=56', shifts: { birth: 13, joined: 13, contract: 13 },
    signatures: [
      { club: 6643735, staff: 23280102, clubSha256: '3c1773e2bd638aa4d9cc544735f1e7c8d77044789f7422fe61410ac86bfb1ad5', staffSha256: '7fa98ffd3b50eccef7a347a36c77c9cd5247daee2916c8401975d86a8d6bf637' },
    ] },
  { id: 'cm0102-2015-10', label: 'October 2015', provider: 'CM 01/02 Update Team', season: '2015/16', year: 2016, released: '2015-10',
    url: 'https://www.champman0102.co.uk/viewtopic.php?t=57', shifts: { birth: 14, joined: 14, contract: 14 },
    signatures: [
      { club: 6484541, staff: 21873568, clubSha256: '99cb6422bae197522a692ddeb354154f8e90edfe9466fd447cdf5f57740edf3e', staffSha256: '8272b5f0470736a3fbe25abff778bfd08d2ee1a205fb727b7e6aefabfa53f30b' },
    ] },
  { id: 'cm0102-2016-04', label: 'April 2016', provider: 'CM 01/02 Update Team', season: '2015/16', year: 2016, released: '2016-04',
    url: 'https://www.champman0102.co.uk/viewtopic.php?t=271', shifts: { birth: 14, joined: 14, contract: 14 },
    signatures: [
      { club: 6524049, staff: 22119724, clubSha256: 'c39cf222baed606ed8672e16beac59f9e58e833b4fe47a776425705c79a4274b', staffSha256: '0fb2aa34af4dd559b604397a7e8defa13606a2ed1bb812f435bc694b4ba9b1e2' },
    ] },
  { id: 'cm0102-2016-10', label: 'October 2016', provider: 'CM 01/02 Update Team', season: '2016/17', year: 2017, released: '2016-10',
    url: 'https://www.champman0102.co.uk/viewtopic.php?t=58', shifts: { birth: 15, joined: 15, contract: 15 },
    signatures: [
      { club: 6643154, staff: 22774108, clubSha256: 'daa779af134633ae40de2d76582d51ac27627b78367489a03f3e4c1dddb60fd7', staffSha256: '33e14cfcea0ea8a1c0ea6e22d0285779e365cfd54138c88312361ed9047bc2b9' },
    ] },
  { id: 'cm0102-2017-04', label: 'April 2017', provider: 'CM 01/02 Update Team', season: '2016/17', year: 2017, released: '2017-04',
    url: 'https://www.champman0102.co.uk/viewtopic.php?t=59', shifts: { birth: 15, joined: 15, contract: 15 },
    signatures: [
      { club: 6687310, staff: 23136428, clubSha256: '9f19a0a2aa343f9c21f124df7fd6418fe9c0bfd7ac832cf7055860470d930ce5', staffSha256: 'e871b7eafbbb6aefc30fb066f7f67eeca838fae7631651155cb4084c829dca1e' },
    ] },
  { id: 'cm0102-2017-10', label: 'October 2017', provider: 'CM 01/02 Update Team', season: '2017/18', year: 2018, released: '2017-10',
    url: 'https://www.champman0102.co.uk/viewtopic.php?t=60', shifts: { birth: 16, joined: 16, contract: 16 },
    signatures: [
      { club: 6885431, staff: 31545338, clubSha256: 'a7c3f955a60ca08953f5e877e7ba692d90ae0b4e8c55ada72e84cb9d8f0598cb', staffSha256: '53219eeac3f3a6a1277ebf1e3ab4bdcc506de36e725fbbe7e77bf847b6fa4cc3' },
    ] },
  { id: 'cm0102-2018-03', label: 'March 2018', provider: 'CM 01/02 Update Team', season: '2017/18', year: 2018, released: '2018-03',
    url: 'https://www.champman0102.co.uk/viewtopic.php?t=268', shifts: { birth: 16, joined: 16, contract: 16 },
    signatures: [
      { club: 6629791, staff: 33614900, clubSha256: 'a0c886af3568f89227e6e0a95e763cb710f2108c7ba48992112a92cfa44a4f71', staffSha256: 'ab47f39047a800d597a787c512508a1dfbd897a9a91d4ca6f247faafdb1605a8' },
    ] },
  { id: 'cm0102-2018-10', label: 'October 2018', provider: 'CM 01/02 Update Team', season: '2018/19', year: 2019, released: '2018-10',
    url: 'https://www.champman0102.co.uk/viewtopic.php?t=61', shifts: { birth: 17, joined: 17, contract: 17 },
    signatures: [
      { club: 6776784, staff: 35282448, clubSha256: 'b6d4d53163092478e3faddad3fc137eefa491a87b534bf6c5e702aaa0aab3b29', staffSha256: '82594d1cba9af92a3f9b5f1bc2e6193f3a877517a3a36736b06cfeec66d48152' },
    ] },
  { id: 'cm0102-2019-03', label: 'March 2019', provider: 'CM 01/02 Update Team', season: '2018/19', year: 2019, released: '2019-03',
    url: 'https://www.champman0102.co.uk/viewtopic.php?t=62', shifts: { birth: 17, joined: 17, contract: 17 },
    signatures: [
      { club: 6842437, staff: 37857764, clubSha256: 'da96185db3099694ff0cfe9c4f81dfa29c162101379773b6eead2632d1753c36', staffSha256: '9ffbac4db06af33c7e07d5dd9913d008052854d38b512ee08a596ef112904fd8' },
    ] },
  { id: 'cm0102-2019-10', label: 'October 2019', provider: 'CM 01/02 Update Team', season: '2019/20', year: 2020, released: '2019-10',
    url: 'https://www.champman0102.co.uk/viewtopic.php?t=63', shifts: { birth: 18, joined: 18, contract: 18 },
    signatures: [
      { club: 6475826, staff: 33803000, clubSha256: 'dc5d732d5651484a751808e450da9b8fbc21f7ae88d0b493615dacfb4d859582', staffSha256: '71cc833f73889f11f61cae2f0f59ea04bda9accd35c09318354f274540d59e6d' },
    ] },
  { id: 'cm0102-2020-03', label: 'March 2020', provider: 'CM 01/02 Update Team', season: '2019/20', year: 2020, released: '2020-03',
    url: 'https://www.champman0102.co.uk/viewtopic.php?t=267', shifts: { birth: 18, joined: 18, contract: 18 },
    signatures: [
      { club: 6584473, staff: 36120442, clubSha256: 'cc2947bdea18074951152a09c57ccef7390edccc139d37fc2ff73aed6a47a953', staffSha256: '19b2b150ffb4eb9853c6e7b120bdd7d5982fa01cb78e33d4445bbad45155e882' },
    ] },
  { id: 'cm0102-2020-11', label: 'November 2020', provider: 'CM 01/02 Update Team', season: '2020/21', year: 2021, released: '2020-11',
    url: 'https://www.champman0102.co.uk/viewtopic.php?t=1381', shifts: { birth: 19, joined: 19, contract: 19 },
    signatures: [
      { club: 6664070, staff: 36019444, clubSha256: '6dffe15d59cff8c2362b23d698a39c2afb120769536281329ba054c796b5c3b6', staffSha256: 'a09402e74d1f72f51b9d48a92d782d0d80ab02adfe138ac3fcf23f03c62bee8e' },
    ] },
  { id: 'cm0102-2021-04', label: 'April 2021', provider: 'CM 01/02 Update Team', season: '2020/21', year: 2021, released: '2021-04',
    url: 'https://www.champman0102.co.uk/viewtopic.php?t=2863', shifts: { birth: 19, joined: 19, contract: 19 },
    signatures: [
      { club: 6849990, staff: 36497956, clubSha256: 'c88458259db1e32f8f81b7b12e93a899ea33b2dbff834fd18deb52635de17a70', staffSha256: '21751bfc8ef732817df0214f936550658be306e5db7277e79ce1bd1d3a257a09' },
    ] },
  { id: 'cm0102-2021-10', label: 'October 2021', provider: 'CM 01/02 Update Team', season: '2021/22', year: 2022, released: '2021-10',
    url: 'https://www.champman0102.co.uk/viewtopic.php?t=3478', shifts: { birth: 20, joined: 20, contract: 20 },
    signatures: [
      { club: 5896569, staff: 32367470, clubSha256: '9fd0faecbed60c815fdae7e44134ce3802ea3dccd7e1d57c2b30939538fb73a4', staffSha256: 'ed0de7372bf4d068ce9e74b60e5ae38fc58ac896c0160650dd3f17c9bbd7e2d0' },
    ] },
  { id: 'cm0102-2022-04', label: 'April 2022', provider: 'CM 01/02 Update Team', season: '2021/22', year: 2022, released: '2022-04',
    url: 'https://www.champman0102.co.uk/viewtopic.php?t=3941', shifts: { birth: 20, joined: 20, contract: 20 },
    signatures: [
      { club: 5999987, staff: 35750998, clubSha256: '9b5b9fd1bfeb712685105d2ea32076bf2e6504d1ab80892e936bd4513d7a2ae2', staffSha256: '45cdc87524f17ed36872a86afde2ad68a471893d4f50549131d0d1d59cc1c6eb' },
    ] },
  { id: 'cm0102-2022-10', label: 'October 2022', provider: 'CM 01/02 Update Team', season: '2022/23', year: 2023, released: '2022-10',
    url: 'https://www.champman0102.co.uk/viewtopic.php?t=4442', shifts: { birth: 21, joined: 21, contract: 21 },
    signatures: [
      { club: 6152790, staff: 35224100, clubSha256: 'ec35ff14e517912517159bb2fa3cb5353a16b04dfce03f650232297ac750cfaf', staffSha256: '4fa6a5067942d591b29ab433668cb01684674557a8c5ccee858c3bb55b4d2ac2' },
    ] },
  { id: 'cm0102-2023-04', label: 'April 2023', provider: 'CM 01/02 Update Team', season: '2022/23', year: 2023, released: '2023-04',
    url: 'https://www.champman0102.co.uk/viewtopic.php?t=4896', shifts: { birth: 21, joined: 21, contract: 21 },
    signatures: [
      { club: 6229482, staff: 36476014, clubSha256: '9fc7d8e6896644e13bff5633e82807c3f3f71587a9c587e1e80125c630ef9964', staffSha256: '305ede643141a5f39f58fe06cb708bc06b9ea39fb2e78a35db61b99e001388a1' },
    ] },
  { id: 'cm0102-2023-10', label: 'October 2023', provider: 'CM 01/02 Update Team', season: '2023/24', year: 2024, released: '2023-10',
    url: 'https://www.champman0102.co.uk/viewtopic.php?t=5580', shifts: { birth: 22, joined: 22, contract: 22 },
    signatures: [
      { club: 6351492, staff: 30361652, clubSha256: '6d5d019e63a147278094eff505c28211df8cae2966a00eaa3bf32e17a18749ad', staffSha256: '78f13613264cdb52461548d2e42a817b97e8dacdda851e420cca03cb403c3cd4' },
    ] },
  { id: 'cm0102-2024-04', label: 'April 2024', provider: 'CM 01/02 Update Team', season: '2023/24', year: 2024, released: '2024-04',
    url: 'https://www.champman0102.co.uk/viewtopic.php?t=6040', shifts: { birth: 22, joined: 22, contract: 22 },
    signatures: [
      { club: 6385771, staff: 30299494, clubSha256: 'bc5309fa91103362878702ee196ea8cb6403c91f5749d8f85298b708413c7ac8', staffSha256: '214263ad67b335aad47faf6ea39ba6c21b1478804fff5d8fc4b083fa2ef24a81' },
    ] },
  { id: 'cm0102-2024-10', label: 'October 2024', provider: 'CM 01/02 Update Team', season: '2024/25', year: 2025, released: '2024-10',
    url: 'https://www.champman0102.co.uk/viewtopic.php?t=6452', shifts: { birth: 23, joined: 23, contract: 23 },
    signatures: [
      { club: 6450843, staff: 34047024, clubSha256: '3feb60d3e255851a7ce3027dc53ca6cdc95ba91f9534c3c25fa890b2e2a3a35b', staffSha256: '434537fdaaab0cd4a2d9ae0c9087a1d04b9ff6e47e6cffad1c21d8f3edf262af' },
    ] },
  { id: 'cm0102-2025-12', label: 'December 2025', provider: 'CM 01/02 Update Team', season: '2025/26', year: 2026, released: '2025-12',
    url: 'https://www.champman0102.co.uk/viewtopic.php?t=10207', shifts: { birth: 24, joined: 24, contract: 24 },
    signatures: [
      { club: 6579244, staff: 42904256, clubSha256: '4c8d047b0f3d24113a0d5c352a61cb1c4c1699c400234ef19fef1378baeb966b', staffSha256: '4372ba36b9c00ccd185a7c03dab0f2b6cae1b8f8059e94c76dc50160a3a27606' },
    ] },
  { id: 'cm0102-2026-05', label: 'May 2026', provider: 'CM 01/02 Update Team', season: '2025/26', year: 2026, released: '2026-05',
    url: 'https://www.champman0102.co.uk/viewtopic.php?t=10604', shifts: { birth: 24, joined: 24, contract: 24 },
    signatures: [
      { club: 6708226, staff: 33451704, clubSha256: '6fe60f05f6571059a52204665e1e5e21d8a7efd84322cdae969e59769b0cc970', staffSha256: 'af693eb69669e59e012e445614e0e46397e32616bd0bed9a2942cf9233f5ecce' },
    ] },
];
