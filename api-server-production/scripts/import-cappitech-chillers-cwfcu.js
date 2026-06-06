/**
 * Import Cappitech Daikin "Applied Product" price lists (chillers, chilled-water
 * fan coil units, air streamers) into Asset. Source: phone photos IMG_2271..2283
 * (no Excel). Cappitech org. Per user: "trust the pictures, fix later."
 *
 * Families & modelling:
 *  - Chillers          -> category "Chiller". Single-price rows: price=List.
 *                         Scroll chiller (Chiller/Controller/Set): price=Chiller,
 *                         customPrices=[{Controller Price},{Set Price}].
 *  - Chilled-water FCU -> category "Chilled Water Fan Coil Unit" (kept SEPARATE
 *                         from the VRV/SkyAir "Fan Coil Unit" so it doesn't show in
 *                         the QF picker). price = List or FCU Price; the Panel/
 *                         Controller + Set prices go to customPrices.
 *  - Air Streamer      -> category "Air Purifier". price=List, customPrices=
 *                         [{label:"Discount Price", value:Dealer}] (dealer pricing).
 *  - Optional controllers / chiller controller -> category "Accessories".
 *
 * capacityKw stored for every rated item; Tons (water-cooled centrifugal + R407c)
 * converted to kW (x3.51685) with the original "X Tons" kept in the description.
 *
 * Data confidence: pages 2271/2272/2280 were re-read directly (HIGH). 2273/2274,
 * air streamer, and the FWW chilled-water FCU sets are HIGH. Scroll chiller (2275)
 * is MEDIUM (see owner-questions doc).
 *
 * Run from api-server-production/ (loads .env = DEV db). Bash sandbox blocks Neon,
 * so run with dangerouslyDisableSandbox.
 */
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const ORG_ID = '59802f75-262b-4f96-b8b2-09a9a071d882'; // Cappitech Engineering Pte. Ltd.
const kwFromTons = (t) => Math.round(t * 3.51685);

// ===================== CHILLERS (category "Chiller") =====================
// Single-price: [model, capacityValue, listPrice, typeNote]
const CHILLERS_TONS = [
  { series: 'Water Cooled Magnetic Centrifugal Chiller (R134a)', items: [
    ['HXEV350SSTTG', 100, 290000, 'Single Compressor'],
    ['HXEV400SSTTG', 150, 320000, 'Single Compressor'],
    ['HXEV350DSTTG', 250, 341000, 'Dual Compressor'],
    ['HXEV400DSTTG', 299, 377000, 'Dual Compressor'],
  ]},
  { series: 'Water Cooled Magnetic Centrifugal Chiller (R1234ze)', items: [
    ['HXEV390SSTGG', 100, 300000, 'Single Compressor'],
    ['HXEV490SSTGG', 120, 326550, 'Single Compressor'],
    ['HXEV520SSTGG', 150, 347550, 'Single Compressor'],
    ['HXEV390DSTGG', 200, 420000, 'Dual Compressor'],
    ['HXEV490DSTGG', 250, 474000, 'Dual Compressor'],
    ['HXEV390TSTGG', 300, 500000, 'Triple Compressor'],
    ['HXEV490TSTGG', 400, 592200, 'Triple Compressor'],
    ['HXEV490QSTGG', 500, 800000, 'Quad Compressor'],
    ['HXEV520QSTGG', 550, 840000, 'Quad Compressor'],
  ]},
  { series: 'Air Cooled Screw Chiller (R407c)', items: [
    ['UAA050.1FST4-FEAE', 46.66, 83042, null],
    ['UAA060.1FST4-FEAE', 56.33, 87763, null],
    ['UAA070.1FST4-FEAE', 66, 99358, null],
    ['UAA080.1FST4-FEAE', 76.81, 106170, null],
    ['UAA100.1FST4-FEAE', 98.72, 123538, null],
  ]},
];
const CHILLERS_KW = [
  { series: 'Air Cooled Screw Chiller (R134a) — Made in China', items: [
    ['UAA105ST3-FBBE', 370, 140800], ['UAA125ST3-FBBE', 449, 158900], ['UAA140ST3-FBBE', 505, 163800],
    ['UAA150ST3-FBBE', 586, 178000], ['UAA175ST3-FBBE', 663, 191200], ['UAA204ST3-FBBE', 717, 198200],
    ['UAA220ST3-FBBE', 802, 207700], ['UAA245ST3-FBBE', 898, 259800], ['UAA266ST3-FBBE', 956, 282200],
    ['UAA291ST3-FBBE', 1035, 286300], ['UAA300ST3-FBBE', 1112, 307100], ['UAA348ST3-FBBE', 1172, 302800],
    ['UAA355ST3-FBBE', 1249, 330300], ['UAA380ST3-FBBE', 1326, 330500], ['UAA390ST3-FBBE', 1380, 354300],
    ['UAA400ST3-FBBE', 1434, 351100], ['UAA415ST3-FBBE', 1465, 364300], ['UAA424ST3-FBBE', 1513, 371400],
    ['UAA450ST3-FBBE', 1604, 377200],
  ]},
  { series: 'Air Cooled Screw Chiller (R134a) — Made in China, Inverter', items: [
    ['UAA105SV3-FAAE', 341, 150216], ['UAA125SV3-FAAE', 469, 169293], ['UAA150SV3-FAAE', 571, 184926],
    ['UAA204SV3-FAAE', 694, 224724], ['UAA220SV3-FAAE', 818, 250822], ['UAA245SV3-FAAE', 938, 266978],
    ['UAA291SV3-FAAE', 1040, 278322], ['UAA348SV3-FAAE', 1142, 369852], ['UAA380SV3-FAAE', 1265, 409650],
    ['UAA400SV3-FAAE', 1388, 449448], ['UAA424SV3-FAAE', 1512, 475546], ['UAA450SV3-FAAE', 1636, 501164],
  ]},
  { series: 'Air Cooled Screw Chiller (R134a) — Made in Malaysia', items: [
    ['UAA105ST3M-FBBA', 370, 117090], ['UAA125ST3M-FBBA', 449, 129646], ['UAA150ST3M-FBBA', 586, 156176],
    ['UAA175ST3M-FBBA', 663, 177607], ['UAA204ST3M-FBBA', 717, 195974], ['UAA220ST3M-FBBA', 802, 222072],
    ['UAA245ST3M-FBBA', 898, 234319], ['UAA291ST3M-FBBA', 1035, 249572], ['UAA348ST3M-FBBA', 1172, 271077],
    ['UAA380ST3M-FBBA', 1326, 286270], ['UAA400ST3M-FBBA', 1434, 309810], ['UAA450ST3M-FBBA', 1604, 346254],
  ]},
];
// Scroll chiller: [model, capacityKw, chillerPrice, controllerPrice, setPrice, typeNote]
const SCROLL_CHILLER = [
  ['UAL240ERS-YPAE', 11.6, 7705, 1380, 9085, 'Mini Scroll Chiller 220-240V/1ph'],
  ['UAL050ERS-YPAE', 14.6, 8510, 1380, 9890, 'Mini Scroll Chiller 220-240V/1ph'],
  ['UAL060ERS-YPAE', 16.8, 8085, 1380, 9465, 'Mini Scroll Chiller 220-240V/1ph'],
  ['UAL070ERS-YPAE', 16.8, 9500, 1380, 10880, 'Mini Scroll Chiller 400V/3ph'],
  ['UAL090ERS-YPAE', 24.9, 10900, 1380, 12280, 'Mini Scroll Chiller 400V/3ph'],
  ['UAL100ERS-YPAE', 28.8, 11500, 1380, 12880, 'Mini Scroll Chiller 400V/3ph'],
  ['UAL120ERS-YPAE', 33.5, 12500, 1380, 13880, 'Mini Scroll Chiller 400V/3ph'],
  ['UAL150ERS-YPAE', 46.0, 14500, 1380, 15880, 'Mini Scroll Chiller 400V/3ph'],
  ['UAL230DS-FAAE', 86, 19100, 1380, 20480, 'Scroll Chiller'],
  ['UAL340DS-FAAE', 100, 28100, 1380, 29660, 'Scroll Chiller'],
  ['UAL450DS-FABE', 135, 36900, 1380, 38280, 'Scroll Chiller'],
  ['UAL1000DS-FABE', 170, 65700, 1380, 67080, 'Scroll Chiller'],
  ['UAL230EYDS-FBAE', 65, 22150, 1380, 23530, 'Scroll Chiller - Inverter'],
  ['UAL450EYDS-FBAE', 130, 36820, 1380, 38200, 'Scroll Chiller - Inverter'],
];

// ============ CHILLED WATER FCU (category "Chilled Water Fan Coil Unit") ============
// list-only: [model, capacityKw, listPrice]
const CWFCU_LIST = [
  { type: 'Ducted Fan Coil Unit, FWPMM-N Series (Without Thermostat)', items: [
    ['FWPMM3AV1-N', 2.90, 465], ['FWPMM4AV1-N', 3.40, 504], ['FWPMM6AV1-N', 5.28, 564],
    ['FWPMM7AV1-N', 6.59, 616], ['FWPMM9AV1-N', 7.27, 1000], ['FWPMM11AV1-N', 11.14, 1151],
    ['FWPMM12AV1-N', 10.84, 1160], ['FWPMM14AV1-N', 13.10, 1206], ['FWPMM16AV1-N', 15.18, 1314],
  ]},
  { type: 'Ducted Fan Coil Unit, FWPMM Series (Wired Controller)', items: [
    ['FWPMM3AV1', 2.90, 663], ['FWPMM4AV1', 3.40, 691], ['FWPMM6AV1', 5.28, 746],
    ['FWPMM7AV1', 6.59, 806], ['FWPMM9AV1', 7.27, 1159], ['FWPMM11AV1', 11.14, 1314],
    ['FWPMM12AV1', 10.84, 1341], ['FWPMM14AV1', 13.10, 1369], ['FWPMM16AV1', 15.18, 1475],
  ]},
  { type: 'Ducted Fan Coil Unit, UAHMM Series (Without Thermostat)', items: [
    ['UAHMM20AV19', 22.16, 1761], ['UAHMM25AV19', 27.84, 1973],
    ['UAHMM30AY19-A', 36.64, 3539], ['UAHMM40AY19-A', 43.96, 3906],
  ]},
  { type: 'Ducted Fan Coil Unit (4R, AC Motor), FUW-A-4 Series', items: [
    ['FUW015A-4L-AABE', 7, 1300], ['FUW020A-4L-AABE', 12, 1463], ['FUW025A-4L-AABE', 13, 1725],
    ['FUW030A-4L-AABE', 17, 2110], ['FUW035A-4L-AABE', 20, 2248], ['FUW040A-4L-AABE', 23, 2465],
    ['FUW050A-4L-AABE', 30, 2926],
  ]},
  { type: 'Ducted Fan Coil Unit (6R, AC Motor), FUW-A-6 Series', items: [
    ['FUW015A-6L-AABE', 10, 1457], ['FUW020A-6L-AABE', 14, 1680], ['FUW025A-6L-AABE', 18, 1961],
    ['FUW030A-6L-AABE', 22, 2366], ['FUW035A-6L-AABE', 26, 2584], ['FUW040A-6L-AABE', 30, 2900],
    ['FUW050A-6L-AABE', 38, 3389],
  ]},
  { type: 'Ducted Fan Coil Unit (4R, DC Motor), FUW-F Series', items: [
    ['FUW020FEAFLAAE50UE', 6, 3227], ['FUW030FEAFLAAE50UE', 10.6, 3828], ['FUW040FEAFLAAE50UE', 14.6, 5095],
    ['FUW050FEAFLAAE50UE', 18.2, 5704], ['FUW060FEAFLAAE50UE', 22.5, 6605],
  ]},
  { type: 'Ducted Fan Coil Unit (6R, DC Motor), FUW-F Series', items: [
    ['FUW020FEBFLAAE50UE', 9.3, 3603], ['FUW030FEBFLAAE50UE', 14.0, 4128], ['FUW040FEBFLAAE50UE', 18.4, 5319],
    ['FUW050FEBFLAAE50UE', 24.1, 6004], ['FUW060FEBFLAAE50UE', 28.1, 6980],
  ]},
];
// FCU + Panel + Set: [model, capacityKw, fcuPrice, panelPrice, setPrice]
const CWFCU_PANEL_SET = [
  { type: 'Compact Cassette Fan Coil Unit, FWMJCC Series (Wireless Controller)', items: [
    ['FWMJCC2BV1', 2.49, 631, 134, 765], ['FWMJCC4BV1', 4.10, 686, 134, 820], ['FWMJCC5BV1', 4.54, 700, 134, 834],
  ]},
  { type: 'Cassette Fan Coil Unit, FWMJC Series (Wireless Controller)', items: [
    ['FWMJC6BV1', 6.15, 969, 203, 1172], ['FWMJC8BV1', 7.33, 1013, 203, 1216], ['FWMJC9BV1', 8.79, 1075, 203, 1278],
    ['FWMJC11BV1', 11.14, 1116, 203, 1319], ['FWMJC13BV1', 12.60, 1143, 203, 1346],
  ]},
  { type: 'Cassette Fan Coil Unit (DC Motor), FWKE Series (Wireless Controller)', items: [
    ['FWKE05E-ACDDA', 5.9, 1179, 206, 1385], ['FWKE08E-ACDDA', 8.8, 1315, 206, 1521], ['FWKE11E-ACDDA', 11.75, 1411, 206, 1617],
  ]},
];
// FCU + Controller + Set: [model, capacityKw, fcuPrice, controllerPrice, setPrice]
const CWFCU_CTRL_SET = [
  { type: 'Wall Mount Fan Coil Unit, FWMT Series (Wireless Controller)', items: [
    // panel not applicable; sheet shows FCU price = Set price
    ['FWMT02CV1', 2.43, 419, 0, 419], ['FWMT03CV1', 2.7, 440, 0, 440], ['FWMT04CV1', 3.31, 450, 0, 450],
    ['FWMT05CV1', 4.54, 587, 0, 587], ['FWMT06CV1', 5.28, 597, 0, 597],
  ]},
  { type: 'Ducted FCU 3 Rows (AC Motor), FWW-VCNLEF/TCNLEF Series', items: [
    ['FWW200VCNLEF-A0AE', 2, 326, 173, 499], ['FWW300VCNLEF-A0AE', 3.1, 367, 173, 540], ['FWW400VCNLEF-A0AE', 3.8, 394, 173, 567],
    ['FWW500VCNLEF-A0AE', 4.9, 412, 173, 585], ['FWW600VCNLEF-A0AE', 5.6, 439, 173, 612], ['FWW700VCNLEF-A0AE', 6.5, 513, 173, 686],
    ['FWW800VCNLEF-A0AE', 8.0, 683, 173, 856], ['FWW1000VCNLEF-A0AE', 9.0, 712, 173, 885], ['FWW1200VCNLEF-A0AE', 10.3, 757, 173, 930],
    ['FWW1400VCNLEF-A0AE', 11.5, 872, 173, 1045], ['FWW1000TCNLEF-A0AE', 8.8, 903, 173, 1076], ['FWW1400TCNLEF-A0AE', 11.2, 1074, 173, 1247],
    ['FWW1600TCNLEF-A0AE', 13.23, 1156, 173, 1329], ['FWW1800TCNLEF-A0AE', 14.89, 1249, 173, 1422], ['FWW2000TCNLEF-A0AE', 17.7, 1459, 173, 1632],
  ]},
  { type: 'Ducted FCU 3 Rows (DC Motor), FWW-VCNLEFPA/TCNLEFPA Series', items: [
    ['FWW200VCNLEFPA0UE', 2.1, 418, 173, 591], ['FWW300VCNLEFPA0UE', 3.23, 461, 173, 634], ['FWW400VCNLEFPA0UE', 3.96, 494, 173, 667],
    ['FWW500VCNLEFPA0UE', 5.07, 508, 173, 681], ['FWW600VCNLEFPA0UE', 5.84, 552, 173, 725], ['FWW700VCNLEFPA0UE', 6.48, 611, 173, 784],
    ['FWW800VCNLEFPA0UE', 8.33, 834, 173, 1007], ['FWW1000VCNLEFPA0UE', 9.16, 861, 173, 1034], ['FWW1200VCNLEFPA0UE', 10.52, 930, 173, 1103],
    ['FWW1400VCNLEFPA0UE', 11.76, 1000, 173, 1173], ['FWW1000TCNLEFPA0UE', 8.98, 1065, 173, 1238], ['FWW1400TCNLEFPA0UE', 11.58, 1261, 173, 1434],
    ['FWW1600TCNLEFPA0UE', 13.9, 1353, 173, 1526], ['FWW1800TCNLEFPA0UE', 15.15, 1486, 173, 1659], ['FWW2000TCNLEFPA0UE', 18.05, 1629, 173, 1802],
  ]},
  { type: 'Ducted FCU 4 Rows (AC Motor), FWW-VFNLEF/TFNLEF Series', items: [
    ['FWW200VFNLEF-A0AE', 2.5, 342, 173, 515], ['FWW300VFNLEF-A0AE', 3.6, 402, 173, 575], ['FWW400VFNLEF-A0AE', 4.3, 424, 173, 597],
    ['FWW500VFNLEF-A0AE', 5.1, 450, 173, 623], ['FWW600VFNLEF-A0AE', 6.2, 480, 173, 653], ['FWW700VFNLEF-A0AE', 7.1, 540, 173, 713],
    ['FWW800VFNLEF-A0AE', 8.9, 734, 173, 907], ['FWW1000VFNLEF-A0AE', 10.5, 761, 173, 934], ['FWW1200VFNLEF-A0AE', 11.1, 806, 173, 979],
    ['FWW1400VFNLEF-A0AE', 12.2, 913, 173, 1086], ['FWW1000TFNLEF-A0AE', 10.0, 952, 173, 1125], ['FWW1400TFNLEF-A0AE', 12.9, 1131, 173, 1304],
    ['FWW1600TFNLEF-A0AE', 14.7, 1217, 173, 1390], ['FWW1800TFNLEF-A0AE', 17.5, 1315, 173, 1488], ['FWW2000TFNLEF-A0AE', 20.6, 1516, 173, 1689],
  ]},
  { type: 'Ducted FCU 4 Rows (DC Motor), FWW-VFNLEFPA/TFNLEFPA Series', items: [
    ['FWW200VFNLEFPA0UE', 2.62, 426, 173, 599], ['FWW300VFNLEFPA0UE', 3.88, 470, 173, 643], ['FWW400VFNLEFPA0UE', 4.56, 504, 173, 677],
    ['FWW500VFNLEFPA0UE', 5.30, 518, 173, 691], ['FWW600VFNLEFPA0UE', 6.48, 563, 173, 736], ['FWW700VFNLEFPA0UE', 7.15, 624, 173, 797],
    ['FWW800VFNLEFPA0UE', 9.06, 852, 173, 1025], ['FWW1000VFNLEFPA0UE', 10.72, 877, 173, 1050], ['FWW1200VFNLEFPA0UE', 11.35, 949, 173, 1122],
    ['FWW1400VFNLEFPA0UE', 12.49, 1021, 173, 1194], ['FWW1000TFNLEFPA0UE', 10.31, 1088, 173, 1261], ['FWW1400TFNLEFPA0UE', 13.57, 1286, 173, 1459],
    ['FWW1600TFNLEFPA0UE', 15.94, 1380, 173, 1553], ['FWW1800TFNLEFPA0UE', 17.95, 1516, 173, 1689], ['FWW2000TFNLEFPA0UE', 21.45, 1649, 173, 1822],
  ]},
  { type: 'District Cooling FCU (AC Motor), FWW-VANLEF/TANLEF Series', items: [
    ['FWW200VANLEF-A0AE', 1.8, 502, 173, 675], ['FWW300VANLEF-A0AE', 2.6, 591, 173, 764], ['FWW400VANLEF-A0AE', 3.2, 623, 173, 796],
    ['FWW500VANLEF-A0AE', 3.9, 663, 173, 836], ['FWW600VANLEF-A0AE', 4.7, 706, 173, 879], ['FWW700VANLEF-A0AE', 5.4, 795, 173, 968],
    ['FWW800VANLEF-A0AE', 6.4, 1080, 173, 1253], ['FWW1000VANLEF-A0AE', 7.7, 1119, 173, 1292], ['FWW1200VANLEF-A0AE', 8.8, 1185, 173, 1358],
    ['FWW1400VANLEF-A0AE', 10.2, 1344, 173, 1517], ['FWW1000TANLEF-A0AE', 7.7, 1400, 173, 1573], ['FWW1400TANLEF-A0AE', 9.6, 1665, 173, 1838],
    ['FWW1600TANLEF-A0AE', 11.6, 1791, 173, 1964], ['FWW1800TANLEF-A0AE', 13.3, 1934, 173, 2107], ['FWW2000TANLEF-A0AE', 15.6, 2231, 173, 2404],
  ]},
  { type: 'District Cooling FCU (DC Motor), FWW-VANLEFPA/TANLEFPA Series', items: [
    ['FWW200VANLEFPA0UE', 1.89, 573, 173, 746], ['FWW300VANLEFPA0UE', 2.72, 632, 173, 805], ['FWW400VANLEFPA0UE', 3.31, 678, 173, 851],
    ['FWW500VANLEFPA0UE', 4.07, 697, 173, 870], ['FWW600VANLEFPA0UE', 4.82, 757, 173, 930], ['FWW700VANLEFPA0UE', 5.48, 838, 173, 1011],
    ['FWW800VANLEFPA0UE', 6.64, 1145, 173, 1318], ['FWW1000VANLEFPA0UE', 7.78, 1180, 173, 1353], ['FWW1200VANLEFPA0UE', 9.02, 1276, 173, 1449],
    ['FWW1400VANLEFPA0UE', 10.58, 1373, 173, 1546], ['FWW1000TANLEFPA0UE', 8.03, 1463, 173, 1636], ['FWW1400TANLEFPA0UE', 9.94, 1730, 173, 1903],
    ['FWW1600TANLEFPA0UE', 12.58, 1856, 173, 2029], ['FWW1800TANLEFPA0UE', 13.65, 2038, 173, 2211], ['FWW2000TANLEFPA0UE', 15.95, 2218, 173, 2391],
  ]},
];

// ===================== AIR STREAMER (category "Air Purifier") =====================
// [model, listPrice, dealerPrice, note]
const AIR_STREAMER = [
  ['MC30YVM7', 397, 316, null], ['MC40UVM6-7', 494, 368, null], ['MC55UVM6-7', 592, 474, null],
  ['MCK55TVM6', 656, 530, null], ['MCK70ZVM7-T', 963, 772, 'Black Color'], ['MCK70ZVM7-W', 963, 772, 'White Color'],
  ['MC80ZVM7', 1252, 1004, null], ['BAD506A', 69, 55, 'Pet Filter'],
];

// ===================== ACCESSORIES (category "Accessories") =====================
// [model, listPrice, description]
const ACCESSORIES = [
  ['BRC51A62', 173, 'Wired Controller — for FWMJC / FWMJCC / FWKE / FWMT'],
  ['R04084153577A', 288, 'Netpro Dual Card — High Level Interface (Modbus). Needs Wired Controller.'],
  ['R04084168512', 265, 'BAG Card — Low Level Interface (DI/DO)'],
  ['AC8800-G220-3022', 173, 'Controller — 0-10V, built-in temp sensor, RS485 (for EC fan FWW)'],
  ['AC8800-A420-2022', 173, 'Controller — 3-speed, built-in temp sensor, RS485 (for AC fan FWW)'],
  ['AC8800-H-0022', 173, 'Controller — built-in thermostat (for FUW-F)'],
  ['UAL-A1E', 1380, 'Scroll Chiller Controller'],
];

async function getOrCreateCategory(name) {
  const existing = await prisma.category.findFirst({ where: { name, organizationId: ORG_ID } });
  return existing || prisma.category.create({ data: { name, organizationId: ORG_ID } });
}

async function main() {
  const chillerCat = await getOrCreateCategory('Chiller');
  const cwfcuCat = await getOrCreateCategory('Chilled Water Fan Coil Unit');
  const airCat = await getOrCreateCategory('Air Purifier');
  const accCat = await getOrCreateCategory('Accessories');

  const seen = new Set();
  const collisions = [];
  let created = 0, skippedExisting = 0;

  async function createAsset({ sku, description, categoryId, price, customPrices, capacityKw }) {
    if (seen.has(sku)) { collisions.push(sku); return; }
    seen.add(sku);
    const dupe = await prisma.asset.findFirst({ where: { skuKey: sku, organizationId: ORG_ID, deletedAt: null } });
    if (dupe) { skippedExisting++; return; }
    await prisma.asset.create({
      data: {
        name: sku, skuKey: sku, description, categoryId, organizationId: ORG_ID,
        uom: 'UNIT', isTracked: false, quantity: 0, price,
        ...(capacityKw != null ? { capacityKw } : {}),
        ...(customPrices ? { customPrices } : {}),
      },
    });
    created++;
  }

  // Chillers — Tons (convert to kW, keep Tons in description)
  for (const grp of CHILLERS_TONS) {
    for (const [sku, tons, list, typeNote] of grp.items) {
      const desc = `Daikin ${grp.series}${typeNote ? ` — ${typeNote}` : ''} — ${tons} Tons`;
      await createAsset({ sku, description: desc, categoryId: chillerCat.id, price: list, capacityKw: kwFromTons(tons) });
    }
  }
  // Chillers — kW single price
  for (const grp of CHILLERS_KW) {
    for (const [sku, kw, list] of grp.items) {
      await createAsset({ sku, description: `Daikin ${grp.series} — ${kw} kW`, categoryId: chillerCat.id, price: list, capacityKw: kw });
    }
  }
  // Scroll chiller — Chiller / Controller / Set
  for (const [sku, kw, chiller, controller, set, typeNote] of SCROLL_CHILLER) {
    await createAsset({
      sku, description: `Daikin Aircooled ${typeNote} (R410a) — ${kw} kW`, categoryId: chillerCat.id,
      price: chiller, capacityKw: kw,
      customPrices: [{ label: 'Controller Price', value: controller }, { label: 'Set Price', value: set }],
    });
  }

  // Chilled-water FCU — list only
  for (const grp of CWFCU_LIST) {
    for (const [sku, kw, list] of grp.items) {
      await createAsset({ sku, description: `Daikin ${grp.type} — ${kw} kW`, categoryId: cwfcuCat.id, price: list, capacityKw: kw });
    }
  }
  // Chilled-water FCU — FCU + Panel + Set
  for (const grp of CWFCU_PANEL_SET) {
    for (const [sku, kw, fcu, panel, set] of grp.items) {
      await createAsset({
        sku, description: `Daikin ${grp.type} — ${kw} kW`, categoryId: cwfcuCat.id, price: fcu, capacityKw: kw,
        customPrices: [{ label: 'Panel Price', value: panel }, { label: 'Set Price', value: set }],
      });
    }
  }
  // Chilled-water FCU — FCU + Controller + Set (wall mount controller=0 → omit)
  for (const grp of CWFCU_CTRL_SET) {
    for (const [sku, kw, fcu, controller, set] of grp.items) {
      const cps = [{ label: 'Set Price', value: set }];
      if (controller) cps.unshift({ label: 'Controller Price', value: controller });
      await createAsset({ sku, description: `Daikin ${grp.type} — ${kw} kW`, categoryId: cwfcuCat.id, price: fcu, capacityKw: kw, customPrices: cps });
    }
  }

  // Air streamer — dealer pricing
  for (const [sku, list, dealer, note] of AIR_STREAMER) {
    await createAsset({
      sku, description: `Daikin Air Streamer${note ? ` (${note})` : ''}`, categoryId: airCat.id,
      price: list, customPrices: [{ label: 'Discount Price', value: dealer }],
    });
  }
  // Accessories / controllers
  for (const [sku, list, desc] of ACCESSORIES) {
    await createAsset({ sku, description: desc, categoryId: accCat.id, price: list });
  }

  const total = await prisma.asset.count({ where: { organizationId: ORG_ID, deletedAt: null } });
  console.log(`\nDone. created=${created}, skipped (already existed)=${skippedExisting}.`);
  if (collisions.length) console.log(`In-batch duplicate skuKeys (NOT imported): ${collisions.join(', ')}`);
  console.log(`Cappitech active assets now: ${total}`);
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error('ERROR:', e.message); await prisma.$disconnect(); process.exit(1); });
