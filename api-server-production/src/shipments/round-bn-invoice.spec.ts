/**
 * Round BN — SUS 請求書 (Invoice #1, step 2), Sayaka's feedback on the 11/6 draft: stamp placement (user-adjustable,
 * org default + customer override, AIMEE Confirm card), 備考 price breakdown, 円貨 line (TTM note, required to
 * finalize), yen figures rounded down.
 */
import { applyLayoutChange, cleanInvoiceLayout, DEFAULT_INVOICE_LAYOUT, describeLayoutChange, invoiceLayoutCss, readInvoiceLayout, resolveInvoiceLayout, SINGLE_INVOICE_LAYOUT } from './trade-invoice-layout';
import { fillAutoRemarks, fxNoteFor, helperRemarks, remarkFontPt, invoiceFinalizeProblems, InvoiceHeader, InvoiceLine, invoiceTotals, previousBusinessDay, renderInvoiceHtml } from './trade-invoice';
import { TradeInvoiceLayoutService } from './trade-invoice-layout.service';
import { forbiddenAsk } from '../operator/shipments-agent.rules';

const fail = (m: string): never => {
  throw new Error(m);
};

// ADH's Oct 2026 Invoice #1 (ADH-INV-2026-0003, SUS 6005, issued 2026/10/12) — the per-line 備考 Sayaka keyed.
const OCT_TEMPLATE = 'LME Cash {monthJa}平均　\nUSD {LME:2}\n + Q{q} MJP {QMJP:2}\n + Billet Premium {premium:2}{upcharge}';
const OCT_UPCHARGE = '\n + {grade} Upcharge {upcharge:2}';
const line = (p: Partial<InvoiceLine> = {}): InvoiceLine => ({ description: 'x', quantity: 100, unit: 'トン', unitPrice: null, amountOverride: null, remarks: '', dueDate: null, ...p });

describe('round BN — 請求書 layout (stamp / address)', () => {
  it('cleans what is posted: known keys, numbers in range, align right|left', () => {
    expect(cleanInvoiceLayout({ sealX: '8', fromAlign: 'left' }, fail)).toEqual({ sealX: 8, fromAlign: 'left' });
    expect(cleanInvoiceLayout({}, fail)).toBeNull();
    expect(() => cleanInvoiceLayout({ sealX: 41 }, fail)).toThrow(/between -40 and 40/);
    expect(() => cleanInvoiceLayout({ sealSize: 5 }, fail)).toThrow(/between 10 and 35/);
    expect(() => cleanInvoiceLayout({ colour: 'red' }, fail)).toThrow(/Unknown layout setting/);
    expect(() => cleanInvoiceLayout({ fromAlign: 'centre' }, fail)).toThrow(/right" or "left/);
    // A stored value is read leniently (never throws).
    expect(readInvoiceLayout({ sealX: 99, junk: 1 })).toEqual({ sealX: 40 });
  });

  it('customer over org over built-in, key by key; the single invoice keeps its left-aligned From block', () => {
    expect(resolveInvoiceLayout({ sealX: 5, sealSize: 20 }, { sealX: 8 })).toEqual({ ...DEFAULT_INVOICE_LAYOUT, sealX: 8, sealSize: 20 });
    expect(resolveInvoiceLayout(null, null, SINGLE_INVOICE_LAYOUT).fromAlign).toBe('left');
  });

  it('relative moves ("move the stamp 8mm right", "address a bit left") and absolute sets, clamped', () => {
    const a = applyLayoutChange(DEFAULT_INVOICE_LAYOUT, { move: { sealX: 8, fromX: -3 } });
    expect(a).toMatchObject({ sealX: 8, fromX: -3 });
    expect(applyLayoutChange(a, { move: { sealX: 50 } }).sealX).toBe(40);
    expect(applyLayoutChange(a, { set: { sealSize: 12, fromAlign: 'left' } })).toMatchObject({ sealSize: 12, fromAlign: 'left' });
    expect(describeLayoutChange(DEFAULT_INVOICE_LAYOUT, a)).toEqual(['Stamp left/right: 0 mm → +8 mm', 'Address left/right: 0 mm → -3 mm']);
    expect(describeLayoutChange(DEFAULT_INVOICE_LAYOUT, a, 'ja')[0]).toBe('印影 左右: 0 mm → +8 mm');
  });

  it('default: the seal sits in the From block\'s own right padding (as wide as the seal), level with the company name — it never covers text', () => {
    const css = invoiceLayoutCss(DEFAULT_INVOICE_LAYOUT);
    expect(css).toContain('padding-right: 19mm'); // 17 mm seal + 2 mm
    expect(css).toMatch(/\.seal \{[^}]*right: 0mm; top: -6.2mm;[^}]*width: 17mm/); // middle of the seal on the first line
    const moved = invoiceLayoutCss({ ...DEFAULT_INVOICE_LAYOUT, sealX: 8, sealY: 2, fromX: -3, fromAlign: 'left' });
    expect(moved).toContain('right: -8mm');
    expect(moved).toContain('top: -4.2mm');
    expect(moved).toContain('left: -3mm');
    expect(moved).toContain('text-align: left');
  });

  it('the 請求書 HTML takes the layout from the header (render-time printLayout); the old fixed seal rule is gone', () => {
    const h = { title: '請求書', invoiceNo: null, issueDate: '2026-11-06', registrationNo: '', toName: 'SUS株式会社', toSuffix: '御中', subject: '', fromBlock: 'アジアディールハブジャパン合同会社\n東京都', dueDate: '2026-11-17', dueLine: '', taxRate: 10, fxRate: 157.88, fxNote: '円/USD 11/5  三菱UFJ銀行TTM参照', lmeMonth: '2026-09', conditions: '', paymentTerms: '', bankBlock: '', currency: 'USD' } as InvoiceHeader;
    const seal = 'data:image/png;base64,AAAA';
    const html = renderInvoiceHtml({ ...h, printLayout: { ...DEFAULT_INVOICE_LAYOUT, sealX: 8 } }, [line({ lme: 3276.82, qmjp: 395, premium: 190, upcharge: 10 })], { seal });
    expect(html).toContain('right: -8mm');
    expect(html).not.toContain('bottom: -5mm');
    expect(renderInvoiceHtml(h, [line({ unitPrice: 1 })], { seal })).toContain('padding-right: 19mm');
  });
});

describe('round BN — 備考 price breakdown', () => {
  const l = line({ lme: 3276.82, qmjp: 395, premium: 190, upcharge: 10, grade: '6005' });

  it("ADH's Oct format with {monthJa} and fixed decimals ({LME:2})", () => {
    expect(helperRemarks(l, '2026-09', OCT_TEMPLATE, OCT_UPCHARGE)).toBe('LME Cash 2026年9月平均　\nUSD 3276.82\n + Q3 MJP 395.00\n + Billet Premium 190.00\n + 6005 Upcharge 10.00');
    expect(helperRemarks({ ...l, premium: 255 }, '2026-09', OCT_TEMPLATE, OCT_UPCHARGE)).toContain(' + Billet Premium 255.00');
    // No LME yet: its line is left out instead of "USD 0.00".
    expect(helperRemarks({ ...l, lme: null }, '2026-09', OCT_TEMPLATE, OCT_UPCHARGE)).toBe('LME Cash 2026年9月平均　\n + Q3 MJP 395.00\n + Billet Premium 190.00\n + 6005 Upcharge 10.00');
    // The old templates are unchanged.
    expect(helperRemarks(l, '2026-06')).toBe('LME Cash 2026/6月平均(3276.82USD) +395(QMJP) +190(Billet Premium) +10(Upcharge)');
  });

  it('a breakdown line slightly too long for the column prints whole at a smaller size; long text still wraps', () => {
    expect(remarkFontPt('LME Cash')).toBeNull();
    const pt = remarkFontPt(' + Billet Premium 190.00\nLME Cash 2026年9月平均　');
    expect(pt).toBeGreaterThanOrEqual(5.4);
    expect(pt).toBeLessThan(6.8);
    expect(remarkFontPt('業務範囲：横浜CY到着後、輸入通関、ドレージ、デバン入出庫、NO.取り作業')).toBeNull();
  });

  it('fills empty auto remarks only — a remark the user typed is never touched', () => {
    const typed = line({ lme: 1, remarks: 'mine', autoRemarks: false });
    const cleared = line({ lme: 1, remarks: '', autoRemarks: false });
    const auto = line({ lme: 3276.82, qmjp: 395, premium: 190, upcharge: 10, grade: '6005', autoRemarks: true });
    const [a, b, c] = fillAutoRemarks([typed, cleared, auto], '2026-09', OCT_TEMPLATE, OCT_UPCHARGE);
    expect(a).toBe(typed);
    expect(b).toBe(cleared);
    expect(c.remarks).toContain('USD 3276.82');
  });
});

describe('round BN — 円貨 (JPY reference)', () => {
  it('{ttmDate} = the Japanese business day before the issue date (10/12 is Sports Day → 10/9)', () => {
    expect(previousBusinessDay('2026-10-12')).toBe('2026-10-09');
    expect(previousBusinessDay('2026-11-06')).toBe('2026-11-05');
    expect(fxNoteFor({ invoiceFxNote: '円/USD {ttmDate}  三菱UFJ銀行TTM参照' }, '2026-10-13')).toBe('円/USD 10/9  三菱UFJ銀行TTM参照');
    expect(fxNoteFor({}, '2026-10-20')).toBe('円/USD 税関10/18～10/24 外国為替相場参照');
  });

  it("each yen figure rounds DOWN, the total is their sum (ADH-INV-2026-0003: US$780,864.00 × 157.88)", () => {
    const rows = [line({ quantity: 100, lme: 3276.82, qmjp: 395, premium: 190, upcharge: 10 }), line({ quantity: 100, lme: 3276.82, qmjp: 395, premium: 255, upcharge: 10 })];
    const t = invoiceTotals(rows, 10, 157.88);
    expect(t).toMatchObject({ taxable: 780864, tax: 78086.4, total: 858950.4 });
    expect(t.jpy).toEqual({ subtotal: 123282808, tax: 12328280, total: 135611088 });
    // The 11/6 draft as first made (one 200 t line at 3,871.82): US$851,800.40.
    expect(invoiceTotals([line({ quantity: 200, lme: 3276.82, qmjp: 395, premium: 190, upcharge: 10 })], 10, null).total).toBe(851800.4);
  });

  it('a draft without a rate shows the 円貨 line as missing (red); finalizing asks for the rate', () => {
    const h = { title: '請求書', invoiceNo: null, issueDate: '2026-11-06', registrationNo: '', toName: 'SUS', toSuffix: '御中', subject: '', fromBlock: 'ADH', dueDate: '2026-11-17', dueLine: '', taxRate: 10, fxRate: null, fxNote: '円/USD 11/5  三菱UFJ銀行TTM参照', lmeMonth: '2026-09', conditions: '', paymentTerms: '', bankBlock: '', currency: 'USD' } as InvoiceHeader;
    expect(renderInvoiceHtml(h, [line({ unitPrice: 1 })], { draft: true })).toContain('為替レート未入力');
    expect(renderInvoiceHtml(h, [line({ unitPrice: 1 })], { draft: false })).not.toContain('為替レート未入力');
    expect(invoiceFinalizeProblems([line({ unitPrice: 1 })], 10, { fxRate: null, requireFx: true })).toEqual(['enter the FX rate (円貨 JPY / USD)']);
    expect(invoiceFinalizeProblems([line({ unitPrice: 1 })], 10, { fxRate: 157.88, requireFx: true })).toEqual([]);
    expect(invoiceFinalizeProblems([line({ unitPrice: 1 })], 10)).toEqual([]); // other callers unchanged
  });
});

describe('round BN — AIMEE may move the stamp / address (not a refused "settings" ask)', () => {
  it('layout asks pass; settings / filter asks are still refused', () => {
    expect(forbiddenAsk('move the stamp 8mm right')).toBeNull();
    expect(forbiddenAsk('change the invoice layout settings so the stamp sits right')).toBeNull();
    expect(forbiddenAsk('印影を右に8mm移動して、レイアウト設定を変更')).toBeNull();
    expect(forbiddenAsk('change the email filter settings')).toBe('changing settings or the email filter');
    expect(forbiddenAsk('設定を変更して')).toBe('changing settings or the email filter');
  });
});

describe('round BN — TradeInvoiceLayoutService', () => {
  const ORG = 'org-1';
  const CUST = '11111111-1111-1111-1111-111111111111';
  const setup = (docDefaults: Record<string, unknown> = {}, profile: Record<string, unknown> = {}) => {
    const state: any = { docDefaults: { ...docDefaults }, customerProfiles: { [CUST]: { billingMode: 'TWO_STAGE', docVariants: {}, ...profile } } };
    const prisma: any = {
      customer: { findFirst: jest.fn(async ({ where }: any) => (where.id === CUST ? { id: CUST, name: 'SUS Co., Ltd.' } : null)) },
      tradeSetting: {
        findUnique: jest.fn(async () => ({ id: 's', customerProfiles: state.customerProfiles })),
        update: jest.fn(async ({ data }: any) => Object.assign(state, data)),
        create: jest.fn(),
      },
      tradeGeneratedDoc: {
        findMany: jest.fn(async () => [
          { id: 'final-1', docType: 'INVOICE_1', status: 'FINAL', number: 'ADH-INV-2026-0003', createdAt: new Date('2026-11-06'), order: { orderNo: 25 }, shipment: null },
          { id: 'draft-1', docType: 'INVOICE_1', status: 'DRAFT', number: null, createdAt: new Date('2026-10-20'), order: { orderNo: 9001 }, shipment: null },
        ]),
        findFirst: jest.fn(async () => ({ docType: 'INVOICE_1', header: { fromBlock: 'ADH', taxRate: 10, fxRate: 157.88, lmeMonth: '2026-09' }, columns: [], rows: [{ description: 'x', quantity: 1, unitPrice: 1 }] })),
      },
    };
    const config: any = {
      getSettings: jest.fn(async () => ({ docDefaults: state.docDefaults })),
      profileOf: jest.fn(async () => state.customerProfiles[CUST]),
      updateSettings: jest.fn(async (_o: string, patch: any) => {
        for (const [k, v] of Object.entries(patch.docDefaults ?? {})) v === null ? delete state.docDefaults[k] : (state.docDefaults[k] = v);
      }),
    };
    const generated: any = { sealFor: jest.fn(async () => null), render: jest.fn((_t: string, header: any) => `<css>${JSON.stringify(header.printLayout)}</css>`) };
    const actionLog: any = { log: jest.fn(async () => undefined) };
    return { svc: new TradeInvoiceLayoutService(prisma, config, generated, actionLog), state, generated, actionLog };
  };
  const actor = { id: 'u1', name: 'Sayaka' } as any;

  it('view: org + customer + in force, drafts first', async () => {
    const { svc } = setup({ invoiceLayout: { sealSize: 20 } }, { docFormats: { INVOICE: { layout: { sealX: 8 } } } });
    const v = await svc.view(ORG, CUST);
    expect(v.effective).toEqual({ ...DEFAULT_INVOICE_LAYOUT, sealSize: 20, sealX: 8 });
    expect(v.orgEffective.sealX).toBe(0);
    expect(v.docs.map((d) => d.id)).toEqual(['draft-1', 'final-1']);
  });

  it('save: the customer override is stored on its profile (null clears it); the org default in docDefaults (diff from built-in); AIMEE writes are logged', async () => {
    const { svc, state, actionLog } = setup();
    const r = await svc.save(ORG, 'customer', CUST, { sealX: 8 }, actor);
    expect(state.customerProfiles[CUST].docFormats.INVOICE.layout).toEqual({ sealX: 8 });
    expect(r.changes).toEqual(['Stamp left/right: 0 mm → +8 mm']);
    expect(actionLog.log).not.toHaveBeenCalled(); // the portal PUT is logged by the interceptor (actionLogResult)
    await svc.save(ORG, 'customer', CUST, null, actor);
    expect(state.customerProfiles[CUST].docFormats?.INVOICE).toBeUndefined();
    await svc.save(ORG, 'org', null, { ...DEFAULT_INVOICE_LAYOUT, fromX: -3 }, actor, 'web');
    expect(state.docDefaults.invoiceLayout).toEqual({ fromX: -3 });
    expect(actionLog.log).toHaveBeenCalledWith(expect.objectContaining({ resource: 'InvoiceLayout', resourceId: 'org-default', details: expect.objectContaining({ via: 'web', changes: ['Address left/right: 0 mm → -3 mm'] }) }));
  });

  it("plan: AIMEE's move on top of what is in force; preview renders the candidate on the customer's own invoice only", async () => {
    const { svc, generated } = setup({}, { docFormats: { INVOICE: { layout: { sealX: 2 } } } });
    const p = await svc.plan(ORG, 'customer', CUST, { move: { sealX: 8 } });
    expect(p.after.sealX).toBe(10);
    expect(p.changes).toEqual(['Stamp left/right: +2 mm → +10 mm']);
    const out = await svc.preview(ORG, CUST, 'draft-1', { sealY: 3 });
    expect(out.html).toContain('"sealY":3');
    expect(generated.render).toHaveBeenCalledWith('INVOICE_1', expect.anything(), [], expect.anything(), { draft: true, seal: null });
    await expect(svc.preview(ORG, CUST, 'someone-elses', null)).rejects.toThrow(/this customer's/);
  });
});
