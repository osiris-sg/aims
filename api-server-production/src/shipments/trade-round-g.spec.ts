/**
 * Round G (2026-10): customer documents addressed to the order's customer,
 * the 計量検収票 crop (INVOICE NO. → Vedanta's AUTHORISED SIGNATORY seal).
 */
import { contentBox, PageText, planPieces } from './trade-attach';
import { renderGeneratedHtml } from './trade-generated.html';
import { buildDefaultHeader, customerDocHeader, GENERATED_TEMPLATES, invoiceAddressee, jpParty, shipmentAddressee } from './trade-generated.service';
import { DocDefaults, invoiceHeaderDefaults, renderInvoiceHtml } from './trade-invoice';
import { renderSingleInvoiceHtml } from './trade-invoice-single';
import { CUSTOMER_DOC_TEMPLATES, mergeProfiles } from './trade-profile';
import { mergeDocDefaults } from './trade-config.service';
import { checkFieldsFor, clientPremiumToStore, lineFor, openOrdersProblems, PlanStep, splitVesselVoyage, stepNumber, stepPlan } from './trade-open-orders';
import { copyDocType, DEFAULT_KEEP_DOMAINS, guardVerdict, keepDomainsOf, keptDomain, knownSender, mitsuiListType } from '../ingestion-email/email-triage.rules';

const KATO = { name: 'Kato Light Metal Industry Co., Ltd.', address: null, jpName: '加藤軽金属工業株式会社', jpAddress: '愛知県海部郡蟹江町', jpContact: null };
const SUS = { name: 'SUS Co., Ltd.', address: null, jpName: 'SUS株式会社', jpAddress: '〒962-0728 福島県須賀川市', jpContact: '押出チーム' };
const HOEI = { name: 'Houei', address: 'Nagoya, Japan', jpName: null, jpAddress: null, jpContact: null };
const ORG = { name: 'Asia Deal Hub Japan LLC', address: 'Tokyo', phoneNumber: null, registrationNumber: 'T1234' };
const D = { customerDocIssuerName: 'アジアディールハブ合同会社' } as DocDefaults;

/** A shipment whose own customer is Kato but whose ORDER is for `customer` (the order wins). */
const shipmentFor = (customer: typeof SUS | typeof HOEI | typeof KATO) => ({
  customer: KATO,
  customerId: 'kato',
  order: { orderNo: 30, piNo: null, grade: '6063', product: 'Aluminium Billet', size: '8"', customerId: 'x', customer },
  blNumber: 'BL1',
  vessel: null,
  voyageNo: null,
  portOfLoading: null,
  portOfDischarge: null,
  commodity: null,
  sizeSpec: null,
  hsCode: null,
  countryOfOrigin: null,
  ciNumber: 'XP1',
  totalPieces: 80,
  totalBundles: 16,
  contractLine: { grade: '6063', product: 'Aluminium Billet', sizeSpec: '203 MM' },
  contract: { contractNo: '454003422', piNumber: null },
  seqNo: 1,
});

describe('addressee follows the customer (every CUSTOMER_PL_* / CUSTOMER_COA_* / INVOICE_* template)', () => {
  const cases = [
    { who: 'SUS', c: SUS, profile: { docAddressee: 'SUS株式会社 福島製造グループ' }, name: 'SUS株式会社 福島製造グループ', addr: '福島県須賀川市' },
    { who: 'HOEI', c: HOEI, profile: {}, name: 'Houei', addr: 'Nagoya, Japan' },
    { who: 'KATO', c: KATO, profile: {}, name: '加藤軽金属工業株式会社', addr: '愛知県海部郡蟹江町' },
  ];
  for (const [key, t] of Object.entries(CUSTOMER_DOC_TEMPLATES)) {
    for (const k of cases) {
      it(`${key} for a ${k.who} order → ${k.name}`, () => {
        const s = shipmentFor(k.c);
        const withCustomer = { ...s, customer: shipmentAddressee(s, k.profile) } as any;
        const h = customerDocHeader(buildDefaultHeader(ORG, withCustomer, t.docType, t.docType, '2026-08-18'), withCustomer, t.docType, D);
        expect(h.to.name).toBe(k.name);
        const html = renderGeneratedHtml(t.docType, { ...h, bodyMode: 'table' }, [], []);
        expect(html).toContain(`${k.name}　御中`);
        expect(html).toContain(k.addr);
        if (k.who !== 'KATO') expect(html).not.toContain('加藤軽金属');
      });
    }
  }
  const invoices = Object.entries(GENERATED_TEMPLATES).filter(([k]) => k.startsWith('INVOICE_'));
  it('covers INVOICE_1 / INVOICE_2 / INVOICE_SINGLE', () => expect(invoices.map(([k]) => k).sort()).toEqual(['INVOICE_1', 'INVOICE_2', 'INVOICE_SINGLE']));
  for (const [key, t] of invoices) {
    for (const k of cases) {
      it(`${key} for a ${k.who} order → its Japanese legal name`, () => {
        const toName = invoiceAddressee(k.c);
        expect(toName).toBe(k.c.jpName ?? k.c.name);
        const h = invoiceHeaderDefaults({ today: '2026-08-18', docType: key, org: ORG, customerName: toName, grades: ['6063'], products: ['Aluminium Billet'], defaults: {} as DocDefaults });
        const html = t.kind === 'single' ? renderSingleInvoiceHtml({ ...(h as any), layout: 'single', validity: '', fxNote: '' }, []) : renderInvoiceHtml(h, []);
        expect(html).toContain(`${toName}　御中`);
        if (k.who !== 'KATO') expect(html).not.toContain('加藤軽金属');
      });
    }
  }
  it("jpParty: the profile 宛先 wins, the address / contact stay the customer's", () => {
    expect(jpParty({ ...SUS, docAddressee: 'SUS株式会社 福島製造グループ' })).toEqual({ name: 'SUS株式会社 福島製造グループ', address: SUS.jpAddress, contact: '押出チーム' });
    expect(jpParty({ ...HOEI, docAddressee: '  ' })).toEqual({ name: 'Houei', address: 'Nagoya, Japan', contact: null });
  });
  it('the profile keeps docAddressee (blank clears it)', () => {
    const id = '11111111-1111-1111-1111-111111111111';
    const fail = (m: string): never => {
      throw new Error(m);
    };
    expect(mergeProfiles({}, { [id]: { billingMode: 'TWO_STAGE', truckCapacityT: 20, docAddressee: ' SUS株式会社 福島製造グループ ' } }, fail)[id].docAddressee).toBe('SUS株式会社 福島製造グループ');
    expect(mergeProfiles({}, { [id]: { billingMode: 'TWO_STAGE', truckCapacityT: 20, docAddressee: '' } }, fail)[id].docAddressee).toBeUndefined();
  });
});

describe('計量検収票 crop: INVOICE NO. → AUTHORISED SIGNATORY', () => {
  // PACKING_LIST_CONTAINER_9000568205.pdf (2 pages, 612 × 792): INVOICE NO at 143, the seal on page 2 at 441.
  const pl: PageText[] = [
    {
      height: 792,
      items: [
        { str: 'VEDANTA ALUMINIUM METAL LIMITED', y: 40, h: 9 },
        { str: 'INVOICE NO :', y: 135, h: 8 },
        { str: 'Sub Total', y: 640, h: 8 },
      ],
    },
    {
      height: 792,
      items: [
        { str: 'TOTAL', y: 316, h: 8 },
        { str: 'FOR VEDANTA ALUMINIUM METAL LIMITED', y: 354, h: 8 },
        { str: 'AUTHORISED SIGNATORY', y: 433, h: 8 },
      ],
    },
  ];
  it('a PL over 2 pages: INVOICE NO. on page 1 down to the seal on page 2', () => {
    const p = planPieces(pl, 1, { auto: true });
    expect(p.map((x) => x.page)).toEqual([1, 2]);
    expect(p[0].top).toBeCloseTo((135 - 792 * 0.008) / 792, 4);
    expect(p[0].bottom).toBe(0);
    expect(p[1].top).toBe(0);
    expect(1 - p[1].bottom).toBeGreaterThan(441 / 792); // the seal's text is inside
    expect(1 - p[1].bottom).toBeLessThan(470 / 792); // and the blank page below it is not
  });
  it('a one-page PL (the real 40.825 t lot): one piece from INVOICE NO. to the seal', () => {
    const one: PageText[] = [
      {
        height: 792,
        items: [
          { str: 'INVOICE NO :', y: 135, h: 8 },
          { str: 'AUTHORISED SIGNATORY', y: 520, h: 8 },
        ],
      },
    ];
    const p = planPieces(one, 1, { auto: true });
    expect(p).toHaveLength(1);
    expect(p[0].bottom).toBeGreaterThan(0.3);
  });
  it('manual crop keeps the handles: top % on the first piece, bottom % on the last', () => {
    expect(planPieces(pl, 1, { top: 0.1, bottom: 0.3 })).toEqual([
      { page: 1, top: 0.1, bottom: 0 },
      { page: 2, top: 0, bottom: 0.3 },
    ]);
  });
  it('a scan (no text) or no seal: the attached page with the typed crop', () => {
    expect(planPieces([], 1, { auto: true })).toEqual([{ page: 1, top: 0, bottom: 0 }]);
    expect(planPieces([pl[0]], 1, { top: 0.155 })).toEqual([{ page: 1, top: 0.155, bottom: 0 }]);
  });
  it('contentBox finds the ink and ignores the white margin', () => {
    const w = 20;
    const h = 10;
    const px = new Uint8ClampedArray(w * h * 4).fill(255);
    for (let y = 3; y <= 6; y++) for (let x = 5; x <= 12; x++) px.set([0, 0, 0, 255], (y * w + x) * 4);
    expect(contentBox(px, w, h, 235, 1)).toEqual({ x0: 5, y0: 3, x1: 13, y1: 7 });
    expect(contentBox(new Uint8ClampedArray(w * h * 4).fill(255), w, h)).toBeNull();
  });
  it('a 2-piece body prints a continuation page; the frame shows the whole piece', () => {
    const img = 'data:image/png;base64,AAAA';
    const html = renderGeneratedHtml(
      'CUSTOMER_PL',
      {
        ...customerDocHeader(buildDefaultHeader(ORG, shipmentFor(KATO) as any, '計量検収票', 'CUSTOMER_PL', '2026-08-18'), shipmentFor(KATO) as any, 'CUSTOMER_PL', D),
        bodyMode: 'attach',
        attachImages: [img, img],
      },
      [],
      [],
    );
    expect(html.match(/<img /g)).toHaveLength(2);
    expect(html).toContain('(2/2)');
    expect(html).toContain('object-fit: contain');
  });
});

describe('intake: counterparty mail is never purged', () => {
  const keep = keepDomainsOf({}, ['houei.example.jp']);
  it('the default list + every customer profile domain; the setting replaces the defaults', () => {
    expect(keep).toEqual(expect.arrayContaining(['vedanta.co.in', 'sus.co.jp', 'katokei.co.jp', 'mitsui-soko.co.jp', 'wanhai.com', 'houei.example.jp']));
    expect(keepDomainsOf({ intakeKeepDomains: ['@Vedanta.co.in', 'not a domain'] })).toEqual(['vedanta.co.in']);
    expect(DEFAULT_KEEP_DOMAINS.length).toBeGreaterThan(10);
  });
  it('sender, recipient / CC, or an address quoted in the body (an internal reply on a Vedanta thread)', () => {
    expect(keptDomain({ from: 'Ops <ops@vedanta.co.in>', to: [], cc: [] }, keep)).toBe('vedanta.co.in');
    expect(keptDomain({ from: 'a@asiadealhub.com', to: ['b@asiadealhub.com'], cc: ['x@jp.mitsui-soko.co.jp'] }, keep)).toBe('mitsui-soko.co.jp');
    expect(keptDomain({ from: 'a@asiadealhub.com', to: ['b@asiadealhub.com'], cc: [], body: '> From: Someone <someone@vedanta.co.in>\n> Feedback' }, keep)).toBe('vedanta.co.in');
    expect(keptDomain({ from: 'news@seafoodsource.com', to: ['a@asiadealhub.com'], cc: [], body: 'unsubscribe' }, keep)).toBeNull();
  });
  it('NOT_SHIPMENT → UNSURE only for kept mail', () => {
    expect(guardVerdict('NOT_SHIPMENT', 'vedanta.co.in')).toBe('UNSURE');
    expect(guardVerdict('NOT_SHIPMENT', null)).toBe('NOT_SHIPMENT');
    expect(guardVerdict('SHIPMENT', 'vedanta.co.in')).toBe('SHIPMENT');
  });
  it('the setting takes up to 100 valid domains', () => {
    expect(mergeDocDefaults({}, { intakeKeepDomains: ['Vedanta.co.in', 'vedanta.co.in', '@hoei.co.jp'] }).intakeKeepDomains).toEqual(['vedanta.co.in', 'hoei.co.jp']);
    expect(() => mergeDocDefaults({}, { intakeKeepDomains: ['vedanta'] })).toThrow('not an email domain');
    expect(mergeDocDefaults({ intakeKeepDomains: ['a.com'] }, { intakeKeepDomains: null }).intakeKeepDomains).toBeUndefined();
  });
});

describe('intake: document types', () => {
  it('Vedanta "Copy documents" files by name (ADH_Docs names) — never PAYMENT_PROOF', () => {
    const names: Record<string, string | null> = {
      '198GX04630 SCAN.pdf': 'BL_SCAN',
      '198GX04631.pdf': 'BL_SCAN',
      'COMMERCIAL_INVOICE_9000565680.pdf': 'CI',
      'PACKING_LIST_9000565680.pdf': 'PL',
      'PACKING_LIST_CONTAINER_9000568205.pdf': 'PL_CONTAINER',
      'COA_9000565680.pdf': 'COA',
      'COO_9000568205.pdf': 'COO',
      'INSURANCE.pdf': 'INSURANCE',
      'PL.XLS': 'PL_XLS',
      'PACKING LIST.XLS.xlsx': 'PL_XLS',
      'COA.XLS': 'COA_XLS',
      'scan0001.pdf': null,
    };
    for (const [n, t] of Object.entries(names)) expect([n, copyDocType(n)]).toEqual([n, t]);
    const hit = knownSender({ from: 'Docs <docs@vedanta.co.in>', subject: 'Copy documents - Asia Deal(Kato) //454003598//198GX064', attachments: Object.keys(names).map((name) => ({ name })) })!;
    expect(hit.rule).toBe('VEDANTA_COPY_DOCS');
    expect(Object.values(hit.attachmentTypes)).not.toContain('PAYMENT_PROOF');
    expect(hit.forbidTypes).toContain('PAYMENT_PROOF');
  });
  it('Mitsui Soko 納品明細 / NO.取り lists → BUNDLE_LIST, or DELIVERY_SCHEDULE for dates / trucks — never CUSTOMER_PL', () => {
    const m = knownSender({
      from: 'x@mitsui-soko.co.jp',
      subject: '【11月納入】納品明細',
      attachments: [
        { name: '納品明細_198GX04822.xlsx', text: 'バンドルNO. 265C118412 2.551' },
        { name: '納品明細_配車.xlsx', text: '11/5 車番 名古屋 100 あ 12-34' },
      ],
    })!;
    expect(m.rule).toBe('MITSUI_DELIVERY_DETAILS');
    expect(m.attachmentTypes).toEqual({ '納品明細_198GX04822.xlsx': 'BUNDLE_LIST', '納品明細_配車.xlsx': 'DELIVERY_SCHEDULE' });
    expect(m.forbidTypes).toContain('CUSTOMER_PL');
    // Forwarded by the customer: the file name still says what it is.
    expect(knownSender({ from: 'y@sus.co.jp', subject: 'RE: 書類送付', attachments: [{ name: '納品明細.pdf' }] })!.attachmentTypes).toEqual({ '納品明細.pdf': 'BUNDLE_LIST' });
    expect(knownSender({ from: 'x@mitsui-soko.co.jp', subject: 'NO.取りリスト', attachments: [{ name: 'list.csv' }] })!.attachmentTypes).toEqual({ 'list.csv': 'BUNDLE_LIST' });
    expect(mitsuiListType('NO.取りリスト_配車.xlsx')).toBe('BUNDLE_LIST');
  });
});

describe('open-orders import (task list)', () => {
  const steps = (): PlanStep[] =>
    [
      ['0', 5],
      ['1', 10],
      ['2', 20],
      ['3a', 10],
      ['3b', 20],
      ['4', 30],
      ['9', 80],
      ['11', 100],
      ['13', 130],
      ['14', 140],
    ].map(([d, o], i) => ({ id: `s${i}`, displayNo: String(d), sortOrder: Number(o), status: 'NOT_STARTED', isOngoing: d === '14', notApplicable: false }));
  it('steps before currentStep → done, the step at it → in progress; N/A and ongoing untouched', () => {
    const all = steps();
    all[2].notApplicable = true; // Kato: step 2 N/A
    const p = stepPlan(all, 9);
    expect(p.done.map((s) => s.displayNo).sort()).toEqual(['0', '1', '3a', '3b', '4']);
    expect(p.start?.displayNo).toBe('9');
    expect(stepPlan(all, 3).start?.displayNo).toBe('3a'); // 3 = 3a first
    expect(stepPlan(all, 2).start).toBeNull(); // Kato at step 2 (N/A): nothing to start
  });
  it('idempotent: once applied, a second plan does nothing', () => {
    const all = steps();
    const p = stepPlan(all, 11);
    for (const s of p.done) s.status = 'DONE';
    if (p.start) p.start.status = 'IN_PROGRESS';
    expect(stepPlan(all, 11)).toEqual({ done: [], start: null });
    // A step already further along than the task list is never moved back.
    all.find((s) => s.displayNo === '13')!.status = 'DONE';
    expect(stepPlan(all, 11)).toEqual({ done: [], start: null });
  });
  it('check flags from the note, clause by clause, and a missing premium', () => {
    expect(
      checkFieldsFor({
        clientFixedPremium: null,
        note: 'customer shown as ?? in the CSV export; contract 454003652 is the Vedanta Hoei ingot contract; status blank in sheet -> step 3 is a guess, flag check',
      }).sort(),
    ).toEqual(['clientPremium', 'currentStep', 'customerId']);
    expect(checkFieldsFor({ clientFixedPremium: 260, note: 'sheet also shows 235 next to 260 -> flag check' })).toEqual(['clientPremium']);
    expect(checkFieldsFor({ clientFixedPremium: 200, note: "sheet says '200 or 265' -> flag check" })).toEqual(['clientPremium']);
    expect(checkFieldsFor({ clientFixedPremium: 230, note: 'contract not filled in sheet; assumed 454003422 -> check' })).toEqual(['contractId']);
    expect(checkFieldsFor({ clientFixedPremium: 287, note: 'premium 260+27' })).toEqual([]);
    expect(checkFieldsFor({ clientFixedPremium: 285, note: 'the 40.825t Kato sample docs belong to this order' })).toEqual([]);
  });
  it('the task list premium is the whole fixed part: 6005 SUS 200 = 190 + the 10 upcharge', () => {
    expect(clientPremiumToStore(200, '10')).toBe(190);
    expect(clientPremiumToStore(230, null)).toBe(230);
    const lines = [{ grade: '6005', upcharge: '10' }];
    expect(lineFor(lines, '6005')).toEqual({ line: lines[0], sameGrade: true });
    expect(lineFor(lines, '6063')).toEqual({ line: lines[0], sameGrade: false }); // → supplier premium "check"
  });
  it('vessel / voyage, step numbers, file problems', () => {
    expect(splitVesselVoyage('WAN HAI 366 / E049')).toEqual({ vessel: 'WAN HAI 366', voyageNo: 'E049' });
    expect(splitVesselVoyage('SITC CEBU / V.2613N')).toEqual({ vessel: 'SITC CEBU', voyageNo: 'V.2613N' });
    expect(splitVesselVoyage('SITC CAGAYAN 2613N / SITC CHANGDE 2617N')).toEqual({ vessel: 'SITC CAGAYAN 2613N / SITC CHANGDE 2617N', voyageNo: null });
    expect([stepNumber('3a'), stepNumber('13'), stepNumber(null)]).toEqual([3, 13, null]);
    const ok = {
      year: 2026,
      supplier: 'Vedanta',
      orders: [
        {
          orderNo: 12,
          customer: 'SUS',
          contract: '454003255',
          grade: '6005',
          qtyMt: 120,
          shipMonth: '2026-07',
          deliveryMonth: '2026-09',
          clientFixedPremium: 200,
          currentStep: 11,
          shipments: [{ seq: 1, blNo: '198GX04822', carrier: 'WANHAI', eta: '2026-09-04' }],
        },
      ],
    };
    expect(openOrdersProblems(ok)).toEqual([]);
    expect(openOrdersProblems({ ...ok, orders: [{ ...ok.orders[0], customer: 'ACME', currentStep: 20, shipments: [{ seq: 1, blNo: 'X', carrier: 'NOPE', eta: '4 Sep' }] }] })).toEqual([
      '#12: unknown customer "ACME"',
      '#12: currentStep 0–14',
      '#12-1: eta "4 Sep"',
      '#12-1: unknown carrier "NOPE"',
    ]);
  });
});

describe('small fixes: awaiting shipment, graded premium schedule', () => {
  const { orderCurrentStep, AWAITING_SHIPMENT } = jest.requireActual('./shipments.rules');
  const { premiumAt, priceCheck, cleanPremiumSchedule } = jest.requireActual('./trade-contract');
  const st = (code: string, displayNo: string, sortOrder: number, status = 'NOT_STARTED', notApplicable = false) => ({
    code,
    title: code,
    displayNo,
    sortOrder,
    status,
    isOngoing: false,
    notApplicable,
  });
  const so = [st('CHECK_CONTRACT', '0', 5, 'DONE'), st('PI_PAYMENT', '1', 10, 'DONE')];
  const katoOrder = [st('INVOICE_1', '2', 20, 'NOT_STARTED', true), st('XERO_HANDOFF', '13', 130)];
  it('Kato before its B/L (#25 / #26): "Awaiting shipment", not 13', () => {
    expect(orderCurrentStep(so, katoOrder, [])).toEqual(AWAITING_SHIPMENT);
    // The supplier side still open: its step comes first.
    expect(orderCurrentStep([st('CHECK_CONTRACT', '0', 5, 'DONE'), st('PI_PAYMENT', '1', 10)], katoOrder, [])?.displayNo).toBe('1');
    // SUS before its B/L: Invoice #1 is the step.
    expect(orderCurrentStep(so, [st('INVOICE_1', '2', 20), st('XERO_HANDOFF', '13', 130)], [])?.displayNo).toBe('2');
    // With a shipment: the lowest open step (the shipment's 7, not the order's 13).
    expect(orderCurrentStep(so, katoOrder, [{ status: 'OPEN', steps: [st('SHIPPING_DOCS', '3b', 20, 'DONE'), st('CUSTOMS_TAX_ESTIMATE', '7', 60)] }])?.displayNo).toBe('7');
    // Shipments all completed: step 13.
    expect(orderCurrentStep(so, katoOrder, [{ status: 'COMPLETED', steps: [st('SHIPPING_DOCS', '3b', 20, 'DONE')] }])?.displayNo).toBe('13');
  });
  const sched = [{ from: '2026-07', to: null, grade: '6005', supplierPremium: 260, clientPremium: 285, upcharge: null }];
  it('a graded schedule row never prices another grade (Kato 6063 on 454003598)', () => {
    expect(premiumAt(sched, '2026-09', '6005')?.clientPremium).toBe(285);
    expect(premiumAt(sched, '2026-09', '6063')).toBeNull();
    expect(premiumAt(sched, '2026-09')?.clientPremium).toBe(285); // contract overview: any row
    expect(premiumAt([{ ...sched[0], grade: '6063' }], '2026-09', '6063 HSB')?.clientPremium).toBe(285);
    expect(premiumAt([{ ...sched[0], grade: null }], '2026-09', '6063')?.clientPremium).toBe(285); // every-grade row
  });
  it('6063 price check: client = the order premium, supplier = unknown ("check") — not the 6005 260', () => {
    const prices = { lmeByMonth: { '2026-09': 3000 }, qmjpByQuarter: { '2026-3Q': 395 } };
    const client = priceCheck({ side: 'client', basisMonth: '2026-09', grade: '6063', schedule: sched, fallback: { clientPremium: 260 }, prices, found: {} });
    expect(client.lines.find((l: any) => l.key === 'unit').expected).toBe(3655);
    const sup = priceCheck({ side: 'supplier', mjpBased: true, basisMonth: '2026-09', grade: '6063', schedule: sched, fallback: { supplierPremium: null }, prices, found: { premium: 655 } });
    expect(sup.lines[0]).toMatchObject({ expected: null, mark: 'unknown' });
  });
  it('schedule rows keep their grade; only rows of the same grade may not overlap', () => {
    const fail = (m: string): never => {
      throw new Error(m);
    };
    const two = cleanPremiumSchedule([{ ...sched[0] }, { from: '2026-07', to: null, grade: '6063', supplierPremium: null, clientPremium: null, upcharge: null }], fail);
    expect(two.map((r: any) => r.grade)).toEqual(['6005', '6063']);
    expect(() => cleanPremiumSchedule([{ ...sched[0] }, { ...sched[0], from: '2026-08' }], fail)).toThrow('overlap at 2026-08 (6005)');
  });
});
