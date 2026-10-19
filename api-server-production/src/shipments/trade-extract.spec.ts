import { currentStepOf, stepLabel, stepLabels } from './shipments.rules';
import {
  BL_SCHEMA,
  blDraftChecks,
  compareParty,
  contractDraftFromPi,
  ExtractionFormatError,
  gradeOf,
  isoDate,
  issueCount,
  lineForGrade,
  monthOf,
  parsePaymentTerms,
  parseTermsOfDelivery,
  parseWith,
  PI_SCHEMA,
  shipmentDraftFromBl,
  sizeSpecOf,
  toMt,
} from './trade-extract.rules';
import { TradeExtractService } from './trade-extract.service';

// The exact org defaults (setup-adh-org.ts) and a B/L-style rendering of them.
const CONSIGNEE = 'ASIA DEAL HUB JAPAN LLC.\nADDRESS: 2-14-5 AKASAKA, 7F DAIWA AKASAKA BLDG,\nMINATO-KU, TOKYO, JAPAN 107-0052\nPHONE: +(81) 90-8048-4006\nTax ID: 7010403028176';
const NOTIFY =
  'ASIA DEAL HUB PTE. LTD.\n12 MARINA BOULEVARD 17-01, TOWER 3 MARINA BAY FINANCIAL CENTRE,\nSINGAPORE 018982\nCONTACT PERSON: TOSHIRO TAKEKOSHI\nEmail: toshiro.takekoshi@asiadealhub.com\nTEL: +65 9815 1089\nUnique Entity Number: 201931733Z';
const BL_CONSIGNEE = 'ASIA DEAL HUB JAPAN LLC.\n2-14-5 AKASAKA, 7F DAIWA AKASAKA BLDG,\nMINATO-KU, TOKYO, JAPAN 107-0052\nPHONE: +81 90-8048-4006';
const BL_NOTIFY =
  'ASIA DEAL HUB PTE. LTD.\n12 MARINA BOULEVARD 17-01, TOWER 3 MARINA BAY\nFINANCIAL CENT, RE,SINGAPORE-018982\nCONTACT PERSON: TOSHIRO TAKEKOSHI\nEMAIL: TOSHIRO.TAKEKOSHI@ASIADEALHUB.COM\nTEL: +65 9815 1089\nUNIQUE ENTITY NUMBER: 201931733Z';

/** What the model returns for "Asia Deal 454003422 PI 9331004128" (as strings, like a real reply). */
const PI_REPLY = {
  contractNo: '454003422',
  piNumber: '9331004128',
  piDate: '30/06/2026',
  supplierName: 'VEDANTA LIMITED (ALUMINIUM BUSINESS)',
  supplierBank: 'STATE BANK OF INDIA, …',
  buyerName: 'ASIA DEAL HUB PTE. LTD.',
  customerHint: null,
  product: 'Aluminium Billet',
  portOfLoading: 'VISAKHAPATNAM, INDIA',
  portOfDischarge: 'YOKOHAMA, JAPAN',
  termsOfDelivery: 'CIF YOKOHAMA, JAPAN',
  paymentTerms: '10% Adv with 5 business days',
  instrumentDueDate: null,
  shipmentPeriod: 'JULY 2026',
  shipmentMonth: '2026-07',
  tolerance: '+/-5%',
  currency: 'USD',
  totalAmount: '1,209,585.00',
  amountPayable: 120958.5,
  lines: [
    {
      description: 'ALUMINIUM ALLOY BILLETS ALLOY 6063V1-C 8 INCH',
      grade: null,
      sizeRaw: '8 INCH',
      lengthRaw: null,
      quantityMt: '300.000',
      lme: 3475.45,
      premium: 556.5,
      rate: 4031.95,
      amount: 1209585,
    },
  ],
};

describe('step numbering (displayNo)', () => {
  it('uses the org number, else the position, else the bare title', () => {
    expect(stepLabel({ title: 'Send arrival notice & shipping instructions', displayNo: '9' }, 8)).toBe('9. Send arrival notice & shipping instructions');
    expect(stepLabel({ title: 'Approve B/L draft', displayNo: null }, 1)).toBe('1. Approve B/L draft');
    expect(stepLabel({ title: 'Approve B/L draft' })).toBe('Approve B/L draft');
  });
  it('current step and blocking-step labels carry the ADH number', () => {
    const steps = [
      { id: 'a', code: 'BL_DRAFT_APPROVAL', title: 'Approve B/L draft (Vedanta)', displayNo: '2', sortOrder: 10, status: 'DONE', isOngoing: false },
      { id: 'b', code: 'SHIPPING_DOCS', title: 'Receive shipping documents', displayNo: '3', sortOrder: 20, status: 'NOT_STARTED', isOngoing: false },
      { id: 'c', code: 'DELIVERY_CHANGES', title: 'Coordinate delivery changes', displayNo: '14', sortOrder: 130, status: 'NOT_STARTED', isOngoing: true },
    ];
    expect(currentStepOf(steps)?.label).toBe('3. Receive shipping documents');
    expect(stepLabels(steps).get('c')).toBe('14. Coordinate delivery changes');
  });
});

describe('normalisers', () => {
  it('maps inch diameters to MM, adding the length only when it is stated', () => {
    expect(sizeSpecOf('8 INCH')).toBe('203 MM (8 INCH)');
    expect(sizeSpecOf('6 INCH')).toBe('152 MM (6 INCH)');
    expect(sizeSpecOf('7"')).toBe('178 MM (7 INCH)');
    expect(sizeSpecOf('8 INCH', '5800 MM')).toBe('203 MM X 5800 MM');
    expect(sizeSpecOf('203 MM')).toBe('203 MM');
    expect(sizeSpecOf(null)).toBeNull();
  });
  it('splits terms of delivery into incoterm + port (+ country)', () => {
    expect(parseTermsOfDelivery('CIF YOKOHAMA, JAPAN')).toEqual({ incoterm: 'CIF', port: 'Yokohama', country: 'Japan' });
    expect(parseTermsOfDelivery('CNF OSAKA')).toEqual({ incoterm: 'CFR', port: 'Osaka', country: null });
    expect(parseTermsOfDelivery(null)).toEqual({ incoterm: null, port: null, country: null });
  });
  it('reads deposit % and due note from payment terms', () => {
    expect(parsePaymentTerms('10% Adv with 5 business days')).toEqual({ depositPercent: 10, depositDueNote: 'within 5 business days' });
    expect(parsePaymentTerms('20 % advance within 7 days of PI')).toEqual({ depositPercent: 20, depositDueNote: 'within 7 days' });
  });
  it('dates, months and grades', () => {
    expect(isoDate('30/06/2026')).toBe('2026-06-30');
    expect(isoDate('30.06.2026')).toBe('2026-06-30');
    expect(isoDate('30-JUN-2026')).toBe('2026-06-30');
    expect(isoDate('31/02/2026')).toBeNull();
    expect(monthOf(null, 'JULY 2026')).toBe('2026-07');
    expect(monthOf("Jul'26")).toBe('2026-07');
    expect(gradeOf(null, 'ALUMINIUM ALLOY BILLETS ALLOY 6063V1-C 8 INCH')).toBe('6063');
    expect(gradeOf('6005A')).toBe('6005');
    // Ingot grades keep their letter (Hoei PI 9331004202: "AL INGOT 99.7% P1020").
    expect(gradeOf('P1020', 'AL INGOT 99.7% P1020')).toBe('P1020');
    expect(gradeOf(null, 'Aluminium ingot P0507')).toBe('P0507');
  });
  it('B/L weights in KG become MT', () => {
    expect(toMt(40775, 'KGS')).toBe(40.775);
    expect(toMt(40.935, 'MT')).toBe(40.935);
    expect(toMt(40935, null)).toBe(40.935);
  });
});

describe('schema validation', () => {
  it('accepts the PI reply (numbers as strings with separators) and builds the contract draft', () => {
    const pi = parseWith(PI_SCHEMA, PI_REPLY, 'PI');
    const d = contractDraftFromPi(pi, {
      suppliers: [{ id: 'sup-v', name: 'Vedanta Aluminium Metal Limited' }],
      customers: [
        { id: 'cus-sus', name: 'SUS Co., Ltd.' },
        { id: 'cus-k', name: 'Kato Aluminium' },
      ],
    });
    expect(d).toMatchObject({
      contractNo: '454003422',
      piNumber: '9331004128',
      piDate: '2026-06-30',
      supplierId: 'sup-v',
      customerId: null, // buyer is ADH itself; no end customer named
      incoterm: 'CIF',
      destinationPort: 'Yokohama',
      destinationCountry: 'Japan',
      shipmentMonth: '2026-07',
      currency: 'USD',
      piAmount: 1209585,
      depositPercent: 10,
      depositAmount: 120958.5,
      depositDueNote: 'within 5 business days',
    });
    expect(d.lines).toEqual([{ grade: '6063', sizeSpec: '203 MM (8 INCH)', product: 'Aluminium Billet', quantityMt: 300, tolerancePct: 5, supplierPremium: 556.5, piPremium: 556.5 }]);
  });
  it('picks the end customer only when the PI clearly names one', () => {
    const pi = parseWith(PI_SCHEMA, { ...PI_REPLY, customerHint: 'MARKS: SUS CO., LTD. SHIZUOKA' }, 'PI');
    expect(
      contractDraftFromPi(pi, {
        suppliers: [],
        customers: [
          { id: 'cus-sus', name: 'SUS Co., Ltd.' },
          { id: 'cus-h', name: 'Houei Shoji' },
        ],
      }).customerId,
    ).toBe('cus-sus');
  });
  it('refuses garbage with the offending field named', () => {
    expect(() => parseWith(PI_SCHEMA, { ...PI_REPLY, totalAmount: 'about a million' }, 'PI')).toThrow(ExtractionFormatError);
    expect(() => parseWith(PI_SCHEMA, { ...PI_REPLY, lines: 'none' }, 'PI')).toThrow(/lines/);
  });
});

/** B/L 198GX04631 as the model would return it. */
const BL_REPLY = {
  contractNo: null,
  blNumber: '198GX04631',
  shippingLine: 'WAN HAI LINES LTD.',
  vessel: 'RACHA BHUM',
  voyageNo: '211E',
  etd: '2026-07-20',
  portOfLoading: 'VISAKHAPATNAM, INDIA',
  portOfDischarge: 'YOKOHAMA, JAPAN',
  placeOfDelivery: 'YOKOHAMA, JAPAN',
  netWeight: '40,775.000',
  grossWeight: 40935,
  weightUnit: 'KGS',
  totalBundles: 16,
  totalPieces: 80,
  hsCode: '7601.20',
  countryOfOrigin: 'INDIA',
  commodity: 'ALUMINIUM ALLOY BILLETS 6063',
  grade: '6063',
  sizeSpec: '203 MM X 5800 MM',
  containers: [
    { containerNo: 'WHLU0636631', sealNo: 'S1', packages: 8, grossKg: 20470 },
    { containerNo: 'WHSU2963217', sealNo: 'S2', packages: 8, grossKg: 20465 },
  ],
  containerCount: null,
  consigneeText: BL_CONSIGNEE,
  notifyPartyText: BL_NOTIFY,
  freightTerms: 'FREIGHT PREPAID',
};

describe('B/L draft → shipment draft + checks', () => {
  const draft = shipmentDraftFromBl(parseWith(BL_SCHEMA, BL_REPLY, 'B/L draft'));
  it('normalises weights, POD, container count', () => {
    expect(draft).toMatchObject({
      blNumber: '198GX04631',
      netWeightMt: 40.775,
      grossWeightMt: 40.935,
      containerCount: 2,
      portOfDischarge: 'YOKOHAMA, JAPAN',
      grade: '6063',
      shippingLine: 'WAN HAI LINES LTD.',
    });
  });
  it('consignee: Tax ID missing on the B/L, everything else ✓', () => {
    const c = compareParty('Consignee', 'consignee', CONSIGNEE, BL_CONSIGNEE);
    expect(c.items!.map((i) => [i.item, i.status])).toEqual([
      ['Company name', 'ok'],
      ['Address', 'ok'],
      ['Phone', 'ok'],
      ['Tax ID', 'missing'],
    ]);
    expect(c.detail).toBe('Tax ID 7010403028176 missing on B/L');
  });
  it('notify party: words broken across lines ("FINANCIAL CENT, RE"), case, "-" vs space all still match', () => {
    const n = compareParty('Notify party', 'notifyParty', NOTIFY, BL_NOTIFY);
    expect(n.status).toBe('ok');
    expect(n.items!.map((i) => i.item)).toEqual(['Company name', 'Address', 'Contact name', 'Email', 'Phone', 'UEN']);
  });
  it('a different phone number is ✗ (present but differs), an absent email is "missing"', () => {
    const n = compareParty('Notify party', 'notifyParty', NOTIFY, BL_NOTIFY.replace('9815 1089', '9815 1000').replace(/EMAIL:.*\n/, ''));
    expect(n.items!.find((i) => i.item === 'Phone')!.status).toBe('mismatch');
    expect(n.items!.find((i) => i.item === 'Email')!.status).toBe('missing');
  });
  it('all checks, with the issue count for the step chip', () => {
    const contract = { contractNo: '454003422', consignee: CONSIGNEE, notifyParty: NOTIFY, destinationPort: 'Yokohama' };
    const checks = blDraftChecks({
      draft,
      contract,
      line: { grade: '6063', quantityMt: '300.000', tolerancePct: '5.00' },
      lineShippedElsewhereMt: 0,
      shipment: { ...draft, vessel: 'RACHA BHUM', voyageNo: '211F' } as any,
    });
    const by = Object.fromEntries(checks.map((c) => [c.key, c]));
    expect(by.consignee.status).toBe('issue');
    expect(by.notifyParty.status).toBe('ok');
    expect(by.contractNo).toMatchObject({ status: 'info', detail: 'Not printed on the B/L (contract 454003422)' }); // informational, not counted
    expect(by.grade.status).toBe('ok');
    expect(by.weight).toMatchObject({ status: 'info' }); // 40.775 of 285–315 MT: more B/Ls expected
    expect(by.pod.status).toBe('ok');
    expect(by.fields.items).toEqual([{ item: 'Voyage no.', expected: '211E', found: '211F', status: 'mismatch' }]);
    expect(issueCount(checks)).toBe(2); // Tax ID + voyage no. (contract no. not printed is info)
  });
  it('contract no.: a printed, different number is an issue; a matching one is ✓', () => {
    const contract = { contractNo: '454003422', consignee: null, notifyParty: null, destinationPort: null };
    const at = (contractNo: string) => blDraftChecks({ draft: { ...draft, contractNo }, contract, line: null }).find((c) => c.key === 'contractNo')!;
    expect(at('454003255')).toMatchObject({ status: 'issue', detail: 'B/L says 454003255, contract is 454003422' });
    expect(at('454003422').status).toBe('ok');
    expect(issueCount([at('454003255')])).toBe(1);
  });
  it('weight: over the line quantity + tolerance is an issue, inside is ✓', () => {
    const contract = { contractNo: '1', consignee: null, notifyParty: null, destinationPort: null };
    const over = blDraftChecks({ draft, contract, line: { grade: '6063', quantityMt: 300, tolerancePct: 5 }, lineShippedElsewhereMt: 280 });
    expect(over.find((c) => c.key === 'weight')!.status).toBe('issue'); // 320.775 > 315
    const inside = blDraftChecks({ draft, contract, line: { grade: '6063', quantityMt: 300, tolerancePct: 5 }, lineShippedElsewhereMt: 250 });
    expect(inside.find((c) => c.key === 'weight')!.status).toBe('ok'); // 290.775 within 285–315
  });
  it('shipment fields: an edited value is an issue, a not-yet-filled one is only listed', () => {
    const contract = { contractNo: '1', consignee: null, notifyParty: null, destinationPort: null };
    const f = blDraftChecks({ draft, contract, line: null, shipment: { blNumber: '198GX04631', voyageNo: '211F' } as any }).find((c) => c.key === 'fields')!;
    expect(f.status).toBe('issue');
    expect(f.items!.find((i) => i.item === 'Vessel')).toMatchObject({ status: 'missing', found: null });
    expect(issueCount([f])).toBe(1); // only the voyage no.
    const fresh = blDraftChecks({ draft, contract, line: null, shipment: { blNumber: '198GX04631' } as any }).find((c) => c.key === 'fields')!;
    expect(fresh.status).toBe('info');
    expect(issueCount([fresh])).toBe(0);
  });
  it('grade: a different grade on the B/L is an issue; the line is auto-picked by grade', () => {
    const contract = { contractNo: '1', consignee: null, notifyParty: null, destinationPort: null };
    expect(blDraftChecks({ draft, contract, line: { grade: '6005', quantityMt: 50, tolerancePct: 5 } }).find((c) => c.key === 'grade')!.status).toBe('issue');
    expect(
      lineForGrade(
        [
          { id: 'L1', grade: '6005' },
          { id: 'L2', grade: '6063' },
        ],
        '6063',
      )?.id,
    ).toBe('L2');
    expect(
      lineForGrade(
        [
          { id: 'L1', grade: '6063' },
          { id: 'L2', grade: '6063' },
        ],
        '6063',
      ),
    ).toBeNull(); // ambiguous
  });
});

describe('TradeExtractService (model mocked)', () => {
  function setup(reply: unknown | Error) {
    const rows: any[] = [];
    const prisma: any = {
      tradeFile: { findFirst: jest.fn().mockResolvedValue({ id: 'f1', docType: 'PI', s3Key: 'k', mimeType: 'application/pdf', fileName: 'pi.pdf' }) },
      tradeExtraction: {
        create: jest.fn().mockImplementation(({ data }: any) => (rows.push({ id: 'x1', ...data }), Promise.resolve({ id: 'x1' }))),
        update: jest.fn().mockImplementation(({ data }: any) => (Object.assign(rows[0], data), Promise.resolve(rows[0]))),
        findFirst: jest.fn().mockImplementation(() => Promise.resolve({ ...rows[0], file: { id: 'f1', fileName: 'pi.pdf' } })),
      },
      supplier: { findMany: jest.fn().mockResolvedValue([{ id: 'sup-v', name: 'Vedanta Aluminium Metal Limited' }]) },
      customer: { findMany: jest.fn().mockResolvedValue([]) },
      contract: { findFirst: jest.fn().mockResolvedValue(null) },
      tradeOrder: { findFirst: jest.fn().mockResolvedValue(null) },
      tradeSetting: { findUnique: jest.fn().mockResolvedValue({ docDefaults: { qmjpByQuarter: { '2026-2Q': 351.5, '2026-3Q': 395 } } }) },
    };
    const extractor = {
      extractStructured: jest
        .fn()
        .mockImplementation(() => (reply instanceof Error ? Promise.reject(reply) : Promise.resolve({ data: reply, model: 'claude-sonnet-4-6', inputTokens: 3000, outputTokens: 600 }))),
    };
    const svc = new TradeExtractService(prisma, { downloadFile: jest.fn().mockResolvedValue(Buffer.from('%PDF')) } as any, {} as any, extractor as any);
    return { svc, rows, extractor };
  }
  it('stores a DONE row with the validated result, the draft, model and token usage', async () => {
    const { svc, extractor } = setup(PI_REPLY);
    const x = await svc.extract('org', 'PI', { fileId: 'f1' }, { id: 'u1', name: 'Tester' });
    expect(extractor.extractStructured.mock.calls[0][0]).toMatchObject({ mimetype: 'application/pdf' }); // PDF sent as a document block
    expect(x).toMatchObject({ status: 'DONE', model: 'claude-sonnet-4-6', inputTokens: 3000, outputTokens: 600, costUsd: 0.018 });
    expect((x.result as any).draft.contractNo).toBe('454003422');
    // Stored premiums are the fixed part: the PI's 556.50 (July shipment → June → 2Q 351.5) becomes 205.
    expect((x.result as any).draft.lines[0]).toMatchObject({ piPremium: 556.5, supplierPremium: 205 });
  });
  it('a model or validation failure is stored as FAILED with the message (nothing thrown)', async () => {
    const bad = await setup({ ...PI_REPLY, lines: 'none' }).svc.extract('org', 'PI', { fileId: 'f1' }, { id: 'u1', name: 'T' });
    expect(bad).toMatchObject({ status: 'FAILED' });
    expect(bad.error).toMatch(/unexpected shape — lines/);
    const down = await setup(new Error('overloaded')).svc.extract('org', 'PI', { fileId: 'f1' }, { id: 'u1', name: 'T' });
    expect(down).toMatchObject({ status: 'FAILED', error: 'overloaded' });
  });
});

describe('TradeExtractService.discardSource (cancelled Fill from PI / B/L draft)', () => {
  function setup(file: any) {
    const prisma: any = { tradeFile: { findFirst: jest.fn().mockResolvedValue(file) } };
    const files: any = { remove: jest.fn().mockResolvedValue({ deleted: true }) };
    return { svc: new TradeExtractService(prisma, {} as any, files, {} as any), files };
  }
  const me = { id: 'u1', name: 'Tester' };
  const unsaved = { id: 'f1', docType: 'PI', uploadedById: 'u1', _count: { links: 0, extractions: 1 } };
  it('removes an unsaved, AI-read PDF uploaded by the same user (file + extractions + S3 via files.remove)', async () => {
    const { svc, files } = setup(unsaved);
    await expect(svc.discardSource('org', 'f1', me)).resolves.toEqual({ id: 'f1', deleted: true });
    expect(files.remove).toHaveBeenCalledWith('org', 'f1');
  });
  it('never touches a PDF that was saved with a record, was not read by AI, or is someone else’s', async () => {
    for (const f of [
      { ...unsaved, _count: { links: 1, extractions: 1 } },
      { ...unsaved, _count: { links: 0, extractions: 0 } },
      { ...unsaved, docType: 'BL' },
      { ...unsaved, uploadedById: 'someone-else' },
    ]) {
      const { svc, files } = setup(f);
      await expect(svc.discardSource('org', 'f1', me)).rejects.toThrow();
      expect(files.remove).not.toHaveBeenCalled();
    }
  });
  it('an already-gone file is a no-op', async () => {
    const { svc, files } = setup(null);
    await expect(svc.discardSource('org', 'f1', me)).resolves.toEqual({ id: 'f1', deleted: false });
    expect(files.remove).not.toHaveBeenCalled();
  });
});
