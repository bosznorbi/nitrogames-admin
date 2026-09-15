/**
 * A 9 csapat es a 60 szavazocetli VEGLEGES kodjai.
 *
 * Ezek kerulnek nyomtatasba, ezert a kodbazis reszei: uj adatbazis, nullazas
 * vagy elveszett volume utan is ugyanezek allnak vissza. NE ird at oket, ha
 * a lapok mar ki vannak nyomtatva.
 *
 * Generalva: 2026-09-14 a scripts/kodokat-general.mjs szkripttel.
 */

/** Csapatok: a kod a konzol es az API kulcsa, a publicId a szavazolap cimeben van (A-445-531). */
export const CSAPAT_KODOK = [
  { szam: 1, kod: 'AREK5SCV', publicId: 'A872415' },
  { szam: 2, kod: 'B75NH25U', publicId: 'B469819' },
  { szam: 3, kod: 'CQ68LC2X', publicId: 'C753655' },
  { szam: 4, kod: 'DFWEJYUE', publicId: 'D773407' },
  { szam: 5, kod: 'EBHAJEMB', publicId: 'E735925' },
  { szam: 6, kod: 'F52GFLW5', publicId: 'F548485' },
  { szam: 7, kod: 'G2Y53AKU', publicId: 'G450604' },
  { szam: 8, kod: 'HKXKAYM7', publicId: 'H021991' },
  { szam: 9, kod: 'JT9Q5ZQ9', publicId: 'J062745' },
];

/** Szavazocetlik: a kod kezzel beirhato, a token a QR-ben levo /v/<token> cimben. */
export const CETLI_KODOK = [
  { kod: 'PQJA', token: 'aL6XOLuUR7nP_dvtJrV2_w' },
  { kod: 'YDXJ', token: 'xelOO0gYJFmX-LajCXP65A' },
  { kod: 'LZSD', token: 'hehMhZf5NMj3F88ovTZMIg' },
  { kod: 'HHBN', token: 'WM1SftpZgoqUCCBLcgAcpA' },
  { kod: 'NMTW', token: 'jRHZo4Hwr3ZJMO5HQifmWA' },
  { kod: 'FRPP', token: '8irMyAezzJeSzoNSkxgLzQ' },
  { kod: 'KUPV', token: '4j2dwjT3yd5gZZFccU6Lpg' },
  { kod: 'MLGF', token: '2MFeXqHCp_CSrtDVuop08A' },
  { kod: 'TFPL', token: 'g2t84wvCnVufK1kxLhd5eg' },
  { kod: 'UBFS', token: 'qvwUATrT6cHWwqtHuFMcrA' },
  { kod: 'JWMK', token: 'thwQ1gEJPVRIICXCDTWtzg' },
  { kod: 'SYPP', token: 'bT-aScoACIZVOKjEuyaz_A' },
  { kod: 'HGDC', token: 'c97K_280jdcKEyrCeG9tEg' },
  { kod: 'NLZJ', token: 'TrObLXg4JeSkneZYXvwO_g' },
  { kod: 'XABP', token: '9scAWOGbfNrz7tk9isyQyw' },
  { kod: 'YEFM', token: 'DQ6EER9xYv8h9t4qbi2trw' },
  { kod: 'RUAH', token: '9E4heBqJis-3FQZ3iplyGA' },
  { kod: 'BFGW', token: '0u8mQK7I2PTJy30a9hxz_g' },
  { kod: 'ALVQ', token: 'BBwufknPTRUUFuaMeCowDA' },
  { kod: 'ZBYA', token: 'Ym5JJVJgD0JQvXZimvG-Cg' },
  { kod: 'ANGB', token: 'e8KsuHvHWWMjSfKsO_1sWQ' },
  { kod: 'SVGS', token: 'iiACjb594G6zxDm8lc01Bw' },
  { kod: 'ALJL', token: 'FhRfcVoqWjCZcYMqLdO76g' },
  { kod: 'CQQS', token: 'PqKvsVOKRgWf6JNA7LzYQA' },
  { kod: 'QYDW', token: 'hsQnJO9KgSeM6lEfbVytBA' },
  { kod: 'LKEL', token: 'fmjfOZxu5sO-jkRpwCORew' },
  { kod: 'VZBJ', token: 'aLnxgw1PbehhH_8p-K8mFA' },
  { kod: 'HMKA', token: 'jCrtxY5gbPfbEYmYnTfP9Q' },
  { kod: 'TNMG', token: 'XtWLmvxdm80toT272clBtg' },
  { kod: 'AFXC', token: 'QbqJUlSe9XniPUpCs9UWIw' },
  { kod: 'ACWB', token: 'v7dHN07GscHKHe3dYofLrQ' },
  { kod: 'PCFG', token: 'MsHKpgUXY0Vqu_yXiA6vWw' },
  { kod: 'FUNT', token: 'vZqqNiwC7g2fh6y38zX3ug' },
  { kod: 'XWAD', token: '3w-_bVS2-Ka9fWbAHSmBgw' },
  { kod: 'WFKA', token: 'kugrbQO-Gh9Ykt3hT-C10A' },
  { kod: 'WMCC', token: 'psFPToQZVg3ovrid51DU5g' },
  { kod: 'VAGD', token: 'lbE7nI2HtkUvQ9Knm8bfjA' },
  { kod: 'LPRB', token: 'IMFPVwU_HKU2IhOR-xEMsw' },
  { kod: 'DUET', token: 'veaEbkOj_asZKcGu6mZ79g' },
  { kod: 'XMXV', token: 'Gl-buXe9tqp_8D-lIj9MfQ' },
  { kod: 'CJTJ', token: 'Qv1Tm-YpL8ZcR3REFd0KCw' },
  { kod: 'KWMB', token: 'Oy2MNNsGCGQmC_5CkP2Scw' },
  { kod: 'KMKQ', token: 'r8G1WhTVfd3NVW7pYrFF2w' },
  { kod: 'DMXT', token: '6clwU47Y0D-xkeQBdMEC-Q' },
  { kod: 'YSXK', token: '-ez8g92Ceag2X_BQK__5UA' },
  { kod: 'UCBP', token: '_orkg5ro-IptJQrpJVpr2Q' },
  { kod: 'XZVG', token: 'pW1c3onLVlTOC14Q5fpg4w' },
  { kod: 'SRSV', token: 'CxMGIOR4OcCJhBzcDhF-0Q' },
  { kod: 'FJXM', token: 'Jkvf3HXXYrZVMLnAKGADsA' },
  { kod: 'YXKU', token: '_UAd0euGNSLvmXQLv_NQPQ' },
  { kod: 'CDDQ', token: 'MYkJj91aVVcDmjdPKgTM6g' },
  { kod: 'XNYH', token: 'i8yQHXy2bdbbC-NWwYkLiA' },
  { kod: 'VRXD', token: '7ODra-60CJ6SSbGgvrDK1g' },
  { kod: 'VHYM', token: 'rX4LrcbAI1BktFTX2OpUhQ' },
  { kod: 'RWEL', token: 'aHk6d4j0PRV8geNvOssZTA' },
  { kod: 'AJXV', token: 'Fb95M03QvIwd56YS7cq_Aw' },
  { kod: 'GKJV', token: 'O0wZAE6iWmzFLpvibTu1cA' },
  { kod: 'YVSQ', token: 'gMOAa1VwISCDpBgptTEf9g' },
  { kod: 'MVSL', token: 'zhxTYfFpjIL3aPgMZVcS-g' },
  { kod: 'TDAU', token: 's1blTR15hcVieeMaGFSfUA' },
];
