/**
 * Round BY (Sayaka, #24): PT Sri Indah Aluminium Extrusion's B/L draft (NCS Logistic Link house B/L NLBSO 2611001-00,
 * SITC BRAVE V.2627N, Batam → Nagoya) as AIMS's B/L read returned it on 25 Nov 2026 — the first non-Vedanta layout.
 * Phone / e-mail lines trimmed. Note the B/L's own typo "MARINA BAYA" in the notify party.
 */
export const SIAE_BL_RAW = {
  etd: '2026-11-11',
  grade: null,
  hsCode: '7601.20.00',
  vessel: 'SITC BRAVE',
  blNumber: 'NLBSO 2611001-00',
  sizeSpec: null,
  voyageNo: 'V.2627N',
  commodity: 'ALUMINIUM ALLOY INGOT',
  netWeight: 50039.5,
  containers: [
    { sealNo: 'SITW972365', grossKg: null, packages: null, containerNo: 'TIIU 289833-6' },
    { sealNo: 'SITW972361', grossKg: null, packages: null, containerNo: 'SEKU 157862-0' },
  ],
  contractNo: null,
  weightUnit: 'KG',
  grossWeight: 50062,
  shipperText: 'PT. SRI INDAH ALUMINIUM EXTRUSION\nTUNAS INDUSTRIAL ESTATE BLOK 1E, JL. ENGKU PUTRI\nBATAM CENTRE, BATAM - INDONESIA',
  totalPieces: 8375,
  freightTerms: 'FREIGHT PREPAID',
  shippingLine: 'NCS LOGISTIC LINK',
  totalBundles: 45,
  consigneeText: 'ASIA DEAL HUB JAPAN LLC.\nADDRESS: 2-14-5 AKASAKA 7F DAIWA AKASAKA BLDG,\nMINATO-KU, TOKYO, JAPAN 107-0052',
  portOfLoading: 'BATAM, INDONESIA',
  containerCount: 2,
  placeOfReceipt: 'BATAM, INDONESIA',
  countryOfOrigin: null,
  notifyPartyText: 'ASIA DEAL HUB PTE.LTD.\n12 MARINA BOULEVARD 17-01, TOWER 3 MARINA BAYA\nFINANCIAL CENTRE, SINGAPORE 018982\nCONTACT PERSON : TOSHIRO TAKEKOSHI',
  placeOfDelivery: 'NAGOYA, JAPAN',
  portOfDischarge: 'NAGOYA, JAPAN',
};
