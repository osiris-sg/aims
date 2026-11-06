/**
 * Round BJ (Sayaka, #18-1 = B/L 198GX06322, SUS 6005, WAN HAI 361 / E039): the B/L reader on the real B/L texts,
 * the product HS code + warning, the latest-CI rule (PROVISIONAL → FINAL) and the SG→JP invoice fields.
 */
import { blFieldsFromText, containerCountOf, hsCodeIn, originIn, shipmentDraftFromBl, withTextFields, BL_SCHEMA, BL_USER_PROMPT } from './trade-extract.rules';
import { hsDiffers, hsWarning, normHs, productFor, productHsOf } from './trade-hs';
import { cleanProduct, productLabel } from './clients-products';
import { ciAmountOf, ciHistory, ciProposal, ciRank, CiVersion, latestCi, parseCiText, wrapAddress } from './trade-ci';
import { portWithCountry, renderSgjpV2Html, SgjpHeaderV2, SgjpItem } from './trade-logistics-docs';
import { TradeExtractService } from './trade-extract.service';

// #18-1's OBL (scanned, 2 pages): page 1 box text and page 2's "B/L Attached List", as printed.
const OBL_18_1 = `Port of discharge YOKOHAMA, JAPAN  Place of delivery YOKOHAMA, JAPAN
9 CTRS (72 BUNDLE(S)) "SHIPPER'S PACK LOAD COUNT & SEAL" "SAID TO CONTAIN" DESCRIPTION AS ATTACHED LIST "FREIGHT PREPAID"
SAY : NINE CONTAINERS ONLY
*** B/L Attached List ***
<< Description >>
CY/CY
ALUMINIUM BILLET ALLOY 6005
203 MM X 5800 MM
COUNTRY OF ORIGIN : INDIA
HS CODE : 7601.20
TOTAL GROSS WT (MT) : 184.413
TOTAL NET WT (MT) : 183.693
TOTAL BUNDLES : 72
TOTAL PIECES : 360`;
// #25-1's B/L draft text layer (198GX07112, WAN HAI copy view).
const DRAFT_25_1 = `SAY : FIVE CONTAINERS ONLY
ALL AS ARRANGED
5 CTRS
(40 BUNDLE(S))
*** B/L Attached List *** SHEET: OF
COUNTRY OF ORIGIN : INDIA
HS CODE : 7601.20
TOTAL BUNDLES : 40`;

describe('Round BJ — B/L reader: abbreviations, attached list, text layer', () => {
  it('container counts as B/Ls print them', () => {
    expect(containerCountOf('9 CTRS')).toBe(9);
    expect(containerCountOf('9 CTR')).toBe(9);
    expect(containerCountOf("9 X 20' CTR")).toBe(9);
    expect(containerCountOf('9 x 20GP')).toBe(9);
    expect(containerCountOf('15 X 20FT')).toBe(15);
    expect(containerCountOf('SAY : NINE CONTAINERS ONLY')).toBe(9);
    expect(containerCountOf('SAY: TWENTY ONE CONTAINERS ONLY')).toBe(21);
    // Container rows ("WHSU0032494 20SD86 …") and bundle counts are not containers.
    expect(containerCountOf('WHSU0032494 20SD86 WHLY157558 8 BDLS 20496.000')).toBeNull();
    expect(containerCountOf('(72 BUNDLE(S))')).toBeNull();
  });
  it('HS code and origin: "HS CODE : 7601.20", "H.S. CODE 76012000", "Origin: INDIA"', () => {
    expect(hsCodeIn('HS CODE : 7601.20')).toBe('7601.20');
    expect(hsCodeIn('H.S. CODE 76012000')).toBe('7601.20');
    expect(hsCodeIn('HS Code: 7601.20.00')).toBe('7601.20');
    expect(hsCodeIn('S.B NO : 7015671')).toBeNull();
    expect(originIn('COUNTRY OF ORIGIN : INDIA\nHS CODE : 7601.20')).toBe('INDIA');
    expect(originIn('Origin: INDIA')).toBe('INDIA');
  });
  it('#18-1 OBL and #25-1 draft: the text gives HS 7601.20, INDIA, 9 / 5 containers', () => {
    expect(blFieldsFromText(OBL_18_1)).toEqual({ hsCode: '7601.20', countryOfOrigin: 'INDIA', containerCount: 9 });
    expect(blFieldsFromText(DRAFT_25_1)).toEqual({ hsCode: '7601.20', countryOfOrigin: 'INDIA', containerCount: 5 });
  });
  it('the text layer fills only the AI read gaps (the AI values are kept)', () => {
    const ai = BL_SCHEMA.parse({ blNumber: '198GX06322', portOfDischarge: 'YOKOHAMA, JAPAN', hsCode: null, countryOfOrigin: null, containerCount: null });
    const d = shipmentDraftFromBl(withTextFields(ai, OBL_18_1));
    expect(d).toMatchObject({ portOfDischarge: 'YOKOHAMA, JAPAN', hsCode: '7601.20', countryOfOrigin: 'INDIA', containerCount: 9 });
    const kept = withTextFields(BL_SCHEMA.parse({ hsCode: '7601.10', containerCount: 8 }), OBL_18_1);
    expect(kept).toMatchObject({ hsCode: '7601.10', containerCount: 8, countryOfOrigin: 'INDIA' });
  });
  it('POD falls back to the place of delivery; place of receipt / delivery kept on the draft; HS printed as 76012000 → 7601.20', () => {
    const d = shipmentDraftFromBl(BL_SCHEMA.parse({ placeOfReceipt: 'VISAKHAPATNAM PORT, INDIA', placeOfDelivery: 'YOKOHAMA, JAPAN', hsCode: '76012000', countryOfOrigin: 'Origin: INDIA' }));
    expect(d).toMatchObject({ portOfDischarge: 'YOKOHAMA, JAPAN', placeOfReceipt: 'VISAKHAPATNAM PORT, INDIA', placeOfDelivery: 'YOKOHAMA, JAPAN', hsCode: '7601.20', countryOfOrigin: 'INDIA' });
  });
  it('the prompt names the abbreviations and the attached list', () => {
    expect(BL_USER_PROMPT).toMatch(/POD = Port of Discharge/);
    expect(BL_USER_PROMPT).toMatch(/POL = Port of Loading/);
    expect(BL_USER_PROMPT).toMatch(/CTR/);
    expect(BL_USER_PROMPT).toMatch(/Attached List/);
    expect(BL_USER_PROMPT).toMatch(/placeOfReceipt/);
  });
});

describe('Round BJ — reader accepts the final / scanned B/L (#18-1 step 3a)', () => {
  function setup(docType: string) {
    const rows: any[] = [];
    const prisma: any = {
      shipment: {
        findFirst: jest.fn().mockResolvedValue({
          id: 's1', contractId: null, contractLineId: null, orderId: 'o1', customerId: 'c1', sizeSpec: '203MM X 5800MM', hsCode: null,
          order: { customerId: 'c1', supplierId: 'v1', grade: '6005', size: '203 MM X 5800 MM', qtyMt: 220, tolPct: 5, consignee: null, notifyParty: null, destinationPort: 'Yokohama', contract: { contractNo: '454003255' } },
          contract: null, contractLine: null,
        }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      tradeFile: { findFirst: jest.fn().mockResolvedValue({ id: 'f1', docType, s3Key: 'k', mimeType: 'application/pdf', fileName: 'OBL_6005_8inch_198GX06322_183.693_MT.pdf', createdAt: new Date() }) },
      tradeExtraction: {
        create: jest.fn().mockImplementation(({ data }: any) => (rows.push({ id: 'x1', ...data }), Promise.resolve({ id: 'x1' }))),
        update: jest.fn().mockImplementation(({ data }: any) => (Object.assign(rows[0], data), Promise.resolve(rows[0]))),
        findFirst: jest.fn().mockImplementation(() => Promise.resolve({ ...rows[0], file: { id: 'f1', fileName: 'obl.pdf' } })),
      },
      tradeSetting: { findFirst: jest.fn().mockResolvedValue({ customerProfiles: { c1: { customerId: 'c1', products: [{ id: 'p1', grade: '6005', form: 'BILLET', diameterMm: 203, lengthMm: 5800, hsCode: '7601.20' }] } }, supplierProfiles: {} }) },
      contract: { findFirst: jest.fn().mockResolvedValue(null) },
      contractLine: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const extractor = { extractStructured: jest.fn().mockResolvedValue({ data: { blNumber: '198GX06322', portOfDischarge: 'YOKOHAMA, JAPAN', containerCount: 9, hsCode: '7201.60', countryOfOrigin: 'INDIA' }, model: 'm', inputTokens: 1, outputTokens: 1 }) };
    return new TradeExtractService(prisma, { downloadFile: jest.fn().mockResolvedValue(Buffer.from('%PDF')) } as any, {} as any, extractor as any);
  }
  it('a file filed as BL (the OBL) is read — no more "filed as BL, not BL_DRAFT"', async () => {
    const x = await setup('BL').extract('org', 'BL_DRAFT', { fileId: 'f1', shipmentId: 's1' }, { id: 'u1', name: 'Sayaka' });
    expect(x.status).toBe('DONE');
    expect((x.result as any).draft).toMatchObject({ portOfDischarge: 'YOKOHAMA, JAPAN', containerCount: 9, countryOfOrigin: 'INDIA', hsCode: '7201.60', hsCodeFrom: 'bl' });
    // A different HS code is warned about, never blocked.
    expect((x.result as any).hsWarning).toBe('HS code differs from the product (7601.20)');
  });
  it('other file types are still refused', async () => {
    await expect(setup('CI').extract('org', 'BL_DRAFT', { fileId: 'f1', shipmentId: 's1' }, { id: 'u1', name: 'S' })).rejects.toThrow(/filed as CI, not BL_DRAFT/);
  });
});

describe('Round BJ — HS code per product', () => {
  const sus = [
    { id: 'a', grade: '6005', form: 'BILLET' as const, diameterMm: 203, lengthMm: 5800, hsCode: '7601.20' },
    { id: 'b', grade: '6063', form: 'BILLET' as const, diameterMm: 152, lengthMm: 5800, hsCode: null },
  ];
  it('normalises and compares at 6 digits; the warning names the product code', () => {
    expect(normHs('76012000')).toBe('7601.20');
    expect(normHs('7601.20.00')).toBe('7601.20');
    expect(hsDiffers('7601.20', '7601.2000')).toBe(false);
    expect(hsDiffers('7201.60', '7601.20')).toBe(true);
    expect(hsDiffers(null, '7601.20')).toBe(false);
    expect(hsWarning('7201.60', '7601.20')).toBe('HS code differs from the product (7601.20)');
    expect(hsWarning('7601.20', '7601.20')).toBeNull();
  });
  it("the shipment's product: the customer's (grade + size), else the supplier's; none → null", () => {
    expect(productFor(sus, '6005', '203MM X 5800MM')?.id).toBe('a');
    const profiles = { customerProfiles: { c1: { customerId: 'c1', products: sus } }, supplierProfiles: { v1: { supplierId: 'v1', products: [{ id: 'v', grade: '6063', form: 'BILLET', hsCode: '7601.20' }] } } };
    expect(productHsOf(profiles, { customerId: 'c1', supplierId: 'v1', grade: '6005', size: '203 MM X 5800 MM' }, productLabel)).toMatchObject({ hsCode: '7601.20', party: 'customer' });
    expect(productHsOf(profiles, { customerId: 'c1', supplierId: 'v1', grade: '6063', size: '152 X 5800' }, productLabel)).toMatchObject({ hsCode: '7601.20', party: 'supplier' });
    expect(productHsOf(profiles, { customerId: 'c1', supplierId: null, grade: '6063', size: '152 X 5800' }, productLabel)).toBeNull();
    // Another product traded later carries its own code (a P1020 ingot = 7601.10).
    const ingot = { customerProfiles: { c2: { customerId: 'c2', products: [{ id: 'i', grade: 'P1020', form: 'INGOT', hsCode: '7601.10' }] } }, supplierProfiles: {} };
    expect(productHsOf(ingot, { customerId: 'c2', supplierId: null, grade: 'P1020', size: null }, productLabel)?.hsCode).toBe('7601.10');
  });
  it('Clients › Products keeps the HS code on an edit that does not send it, validates a typed one', () => {
    const bad = (m: string): never => { throw new Error(m); };
    const prev = cleanProduct({ grade: '6005', hsCode: '7601.20' }, undefined, 'p', 'now', bad);
    expect(prev.hsCode).toBe('7601.20');
    expect(cleanProduct({ grade: '6005', notes: 'x' }, prev, 'p', 'now', bad).hsCode).toBe('7601.20');
    expect(cleanProduct({ grade: '6005', hsCode: '' }, prev, 'p', 'now', bad).hsCode).toBeNull();
    expect(() => cleanProduct({ grade: '6005', hsCode: 'aluminium' }, prev, 'p', 'now', bad)).toThrow(/not an HS code/);
  });
});

// #18-1's CI XP2652102340 — the PROVISIONAL (Drive) and the FINAL / REVISED (in AIMS) text layers, bank block left out.
const CI_HEAD = `VEDANTA ALUMINIUM METAL LIMITED
VEDANTA ALUMINIUM METAL LIMITED – SEZ UNIT,, BURKHAMUNDA,
BRUNDAMAL, KUREBAGA, JHARSUGUDA,JHARSUGUDA, JHARSUGUDA,
ODISHA-768202, INDIA
Works : AAJCV6954AIEC Code:
Producer :
Applicant/Buyer :
ASIA DEAL HUB PTE. LTD.
XP2652102340Invoice No. :
26/09/2026Invoice Date :
183.693Qty Net(MT)`;
const CI_FINAL = `FINAL COMMERCIAL INVOICE
${CI_HEAD}
ALUMINIUM BILLET ALLOY 6005 203 MM X 5800 MM
COUNTRY OF ORIGIN : INDIA
HS CODE : 7601.20
183.693 3,276.82 557.00 3,833.82 704,245.90
704,245.90Sub Total
0Trade Discount(US$)
69,502.00Advance(US$)
PRICE IS FINAL 183.693TOTAL 634,743.90`;
const CI_PROVISIONAL = `PROVISIONAL COMMERCIAL INVOICE
${CI_HEAD}
COUNTRY OF ORIGIN : INDIA
HS CODE : 7601.20
183.693 3,350.54 557.00 3,907.54 717,787.75
717,787.75Sub Total
69,502.00Advance(US$)
PRICE IS PROVISIONAL 183.693TOTAL 648,285.75`;
// An older layout (#1003-1): amounts after the labels, the total after the quantity.
const CI_OLD = `FINAL COMMERCIAL INVOICE
VEDANTA LIMITED (SEZ UNIT)
Works : VILLAGE BHURKHAMUNDA, KUREBAGA & BRUNDAMAL, JHARSUGUDA,
ODISHA-768202, INDIA IEC Code: 1788000234
Producer :
XP2552100058 Invoice No.
Invoice Date : 21/04/2025
Sub Total 128,088.17
Advance(US$) 0
PRICE IS FINAL TOTAL 49.971 128,088.17`;

describe('Round BJ — CI versions: the latest is the CI amount', () => {
  it('reads no., date, FINAL / PROVISIONAL, Sub Total (before the advance), LME, premium, shipper', () => {
    const f = parseCiText(CI_FINAL);
    expect(f).toMatchObject({ ciNumber: 'XP2652102340', ciDate: '2026-09-26', status: 'FINAL', subTotal: 704245.9, advance: 69502, total: 634743.9, netMt: 183.693, lme: 3276.82, premium: 557, rate: 3833.82, countryOfOrigin: 'INDIA', hsCode: '7601.20' });
    expect(ciAmountOf(f)).toBe(704245.9); // not the 634,743.90 payable after the advance
    expect(f.shipperBlock).toBe('VEDANTA ALUMINIUM METAL LIMITED (SEZ UNIT)\nBURKHAMUNDA, BRUNDAMAL, KUREBAGA,\nJHARSUGUDA,JHARSUGUDA, JHARSUGUDA,\nODISHA-768202, INDIA');
    expect(parseCiText(CI_PROVISIONAL)).toMatchObject({ status: 'PROVISIONAL', subTotal: 717787.75, lme: 3350.54 });
    expect(parseCiText(CI_OLD)).toMatchObject({ ciNumber: 'XP2552100058', ciDate: '2025-04-21', status: 'FINAL', subTotal: 128088.17, total: 128088.17 });
    expect(parseCiText(CI_OLD).shipperBlock).toMatch(/^VEDANTA LIMITED \(SEZ UNIT\)\nVILLAGE BHURKHAMUNDA/);
  });
  const v = (o: Partial<CiVersion>): CiVersion => ({ fileId: 'f', fileName: 'COMMERCIAL_INVOICE.pdf', uploadedAt: '2026-10-26T12:00:00Z', ciNumber: 'XP2652102340', ciDate: '2026-09-26', status: 'FINAL', amount: 0, ...o });
  const prov = v({ fileId: 'p', status: 'PROVISIONAL', amount: 717787.75, uploadedAt: '2026-10-27T00:00:00Z' });
  const fin = v({ fileId: 'f', fileName: 'REVISED 8.COMMERCIAL_INVOICE_9000584471 183.693.pdf', amount: 704245.9 });
  it('FINAL beats PROVISIONAL even when the provisional was uploaded later; then the later date; then a REVISED file', () => {
    expect(latestCi([fin, prov])?.fileId).toBe('f');
    expect(ciHistory([fin, prov]).map((x) => x.fileId)).toEqual(['p', 'f']);
    expect(ciRank(v({ ciDate: '2026-09-27' }), v({ ciDate: '2026-09-26' }))).toBeGreaterThan(0);
    expect(latestCi([v({ fileId: 'a', fileName: 'COMMERCIAL_INVOICE_9000582746.pdf', amount: 1 }), v({ fileId: 'b', fileName: 'COMMERCIAL_INVOICE_9000582746 Reviced on SEP24.pdf', amount: 2 })])?.fileId).toBe('b');
  });
  it('proposes the latest amount only when it differs from the stored one (never picks an older one)', () => {
    expect(ciProposal(704245.9, [prov, fin])).toBeNull(); // #18-1 today: stored = the FINAL
    expect(ciProposal(717787.75, [prov, fin])).toMatchObject({ from: 717787.75, to: 704245.9, fileId: 'f', status: 'FINAL' });
    expect(ciProposal(null, [prov, fin])).toMatchObject({ from: null, to: 704245.9 });
    expect(ciProposal(null, [])).toBeNull();
  });
});

describe('Round BJ — CI read: blank fill from the latest version, proposal instead of overwrite', () => {
  function setup(stored: number | null, previous: Array<{ raw: any; fileName: string; createdAt: Date }>, reply: any) {
    const rows: any[] = [];
    const updates: any[] = [];
    const prisma: any = {
      shipment: {
        findFirst: jest.fn().mockResolvedValue({ id: 's1', ciNumber: 'XP2652102340', ciAmount: stored }),
        updateMany: jest.fn().mockImplementation((a: any) => (updates.push(a), Promise.resolve({ count: 1 }))),
      },
      tradeFile: { findFirst: jest.fn().mockResolvedValue({ id: 'new', docType: 'CI', s3Key: 'k', mimeType: 'image/png', fileName: 'COMMERCIAL_INVOICE_9000584471.png', createdAt: new Date() }) },
      tradeExtraction: {
        create: jest.fn().mockImplementation(({ data }: any) => (rows.push({ id: 'x1', ...data }), Promise.resolve({ id: 'x1' }))),
        update: jest.fn().mockImplementation(({ data }: any) => (Object.assign(rows[0], data), Promise.resolve(rows[0]))),
        findFirst: jest.fn().mockImplementation(() => Promise.resolve({ ...rows[0], file: { id: 'new', fileName: 'ci.png' } })),
        findMany: jest.fn().mockResolvedValue(previous.map((p, i) => ({ fileId: `old${i}`, result: { raw: p.raw }, file: { id: `old${i}`, fileName: p.fileName, createdAt: p.createdAt } }))),
      },
    };
    const extractor = { extractStructured: jest.fn().mockResolvedValue({ data: reply, model: 'm', inputTokens: 1, outputTokens: 1 }) };
    return { svc: new TradeExtractService(prisma, { downloadFile: jest.fn().mockResolvedValue(Buffer.from('png')) } as any, {} as any, extractor as any), updates };
  }
  const FINAL = { ciNumber: 'XP2652102340', ciDate: '2026-09-26', status: 'FINAL', subTotal: 704245.9, totalAmount: 634743.9 };
  const PROV = { ciNumber: 'XP2652102340', ciDate: '2026-09-26', status: 'PROVISIONAL', subTotal: 717787.75, totalAmount: 648285.75 };
  it('a FINAL read after the provisional amount was stored → proposal, no write', async () => {
    const { svc, updates } = setup(717787.75, [{ raw: PROV, fileName: 'COMMERCIAL_INVOICE_9000584471.pdf', createdAt: new Date('2026-10-01') }], FINAL);
    const x = await svc.extract('org', 'CI', { fileId: 'new', shipmentId: 's1' }, { id: 'u', name: 'S' });
    expect(updates).toEqual([]);
    expect((x.result as any).ciProposal).toMatchObject({ from: 717787.75, to: 704245.9, status: 'FINAL' });
  });
  it('reading an OLDER (provisional) version never fills a blank amount — the latest one does', async () => {
    const { svc, updates } = setup(null, [{ raw: FINAL, fileName: 'REVISED 8.COMMERCIAL_INVOICE_9000584471 183.693.pdf', createdAt: new Date('2026-10-26') }], PROV);
    const x = await svc.extract('org', 'CI', { fileId: 'new', shipmentId: 's1' }, { id: 'u', name: 'S' });
    expect(updates).toEqual([]);
    expect((x.result as any).ciProposal).toMatchObject({ from: null, to: 704245.9 });
  });
  it('a blank amount takes the Sub Total of the latest version (blank-only update)', async () => {
    const { svc, updates } = setup(null, [], FINAL);
    await svc.extract('org', 'CI', { fileId: 'new', shipmentId: 's1' }, { id: 'u', name: 'S' });
    expect(updates[0]).toMatchObject({ where: { ciAmount: null }, data: { ciAmount: 704245.9 } });
  });
});

describe('Round BJ — SG→JP invoice fields (#18-1 vs ADH20261012)', () => {
  it('ports as ADH writes them: "Yokohama, JAPAN"', () => {
    expect(portWithCountry('Yokohama')).toBe('Yokohama, JAPAN');
    expect(portWithCountry('YOKOHAMA, JAPAN')).toBe('Yokohama, JAPAN');
    expect(portWithCountry('Nagoya')).toBe('Nagoya, JAPAN');
    expect(portWithCountry('LAEM CHABANG')).toBe('Laem Chabang, THAILAND');
    expect(portWithCountry('')).toBe('');
  });
  it('shipper box wrapped as ADH\'s', () => {
    expect(wrapAddress('BURKHAMUNDA, BRUNDAMAL, KUREBAGA, JHARSUGUDA,JHARSUGUDA, JHARSUGUDA, ODISHA-768202, INDIA')).toBe('BURKHAMUNDA, BRUNDAMAL, KUREBAGA,\nJHARSUGUDA,JHARSUGUDA, JHARSUGUDA,\nODISHA-768202, INDIA');
  });
  const h: SgjpHeaderV2 = {
    layout: 2, invoiceNo: 'ADH20261012', invoiceDate: '2026-10-12', shipperBlock: 'VEDANTA ALUMINIUM METAL LIMITED (SEZ UNIT)', consigneeBlock: '', sellerBlock: '', buyerBlock: '',
    placeOfReceipt: 'VISAKHAPATNAM PORT, INDIA', portOfLoading: 'VISAKHAPATNAM PORT, INDIA', portOfDischarge: 'Yokohama, JAPAN', placeOfDelivery: 'Yokohama, JAPAN', payment: '',
    countryOfOrigin: 'INDIA', vessel: 'WAN HAI 361 / E039', others: '', shippingMarks: '', signBlock: '', currency: 'USD', lmeMonth: '2026-09',
  };
  const item: SgjpItem = { goods: 'Aluminium Billet Alloy 6005-8 inch', hsCode: '7601.20', terms: 'CIF', lme: 3276.82, qmjp: 395, premium: 190, upcharge: 10, unitPrice: null, quantity: 183.693, bundles: 72, pieces: 360, netMt: 183.693, grossMt: 184.413, dimension: '' };
  it('description "HS CODE : 7601.20 CIF", packing "HS CODE : 7601.20", "Yokohama, JAPAN", INDIA, US$711,226.23', () => {
    const html = renderSgjpV2Html(h, [item]);
    expect(html).toContain('HS CODE : 7601.20 CIF');
    expect(html).not.toContain('HS Code: CIF');
    expect(html.match(/HS CODE : 7601\.20/g)?.length).toBe(2);
    expect(html).toContain('Yokohama, JAPAN');
    expect(html).toContain('INDIA');
    expect(html).toContain('US$711,226.23');
  });
  it('no HS code → no empty "HS Code:" label', () => {
    const html = renderSgjpV2Html(h, [{ ...item, hsCode: '' }]);
    expect(html).not.toMatch(/HS Code:|HS CODE :/);
    expect(html).toContain('CIF');
  });
});
