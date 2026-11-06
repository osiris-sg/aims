/**
 * Round BK — the import tax estimate as ADH's calculator (輸入消費税計算ファイル_2026年9月納入(7月出荷)_300t_120t.xlsx,
 * sheet "6005 120t" = #12-1) and the four real import permits in AIMS.
 */
import { importTax } from './trade-customs';
import { ADD_ON_PER_CONTAINER, cleanCosts, DEFAULT_RATES, estimate } from './trade-estimator';
import { customsRatePdfUrl, customsWeek, parseCustomsUsd, pickCif, sgjpFileFacts, TradeTaxInputsService } from './trade-tax-inputs';

/** The xlsx, cell by cell (float maths as Excel): C4 = INT(C2*C3), C8 = ROUNDDOWN(C4,-3), C10 = INT(C8*0.078), C11 = ROUNDDOWN(C10,-2), C15 = INT(C11*22/78), C16 = ROUNDDOWN(C15,-2). */
function sheet(cifUsd: number, rate: number, addOn = 0) {
  const c4 = Math.floor(cifUsd * rate + 1e-7) + addOn;
  const c8 = Math.floor(c4 / 1000) * 1000;
  const c10 = Math.floor(c8 * 0.078 + 1e-7);
  const c11 = Math.floor(c10 / 100) * 100;
  const c15 = Math.floor(c11 * (22 / 78) + 1e-7);
  const c16 = Math.floor(c15 / 100) * 100;
  return { c4, c8, c10, c11, c15, c16, c6: c11 + c16 };
}

describe('Round BK — ADH calculator (xlsx) = AIMS', () => {
  it('#12-1: 459,412.52 × 159.09 → 73,087,937 → 73,087,000 → 5,700,700 + 1,607,800 = ¥7,308,500', () => {
    const t = importTax(459412.52, 159.09, 0);
    expect(t).toMatchObject({ cifJpy: 73087937, customsValue: 73087937, taxBase: 73087000, nationalRaw: 5700786, national: 5700700, localRaw: 1607889, local: 1607800, total: 7308500 });
    expect(sheet(459412.52, 159.09)).toMatchObject({ c4: 73087937, c8: 73087000, c10: 5700786, c11: 5700700, c15: 1607889, c16: 1607800, c6: 7308500 });
  });

  // The permits (code E 加算運賃 = containers × ¥1,800).
  const PERMITS = [
    { ref: '#15-1 IM3Z690456', cif: 1185439.17, fx: 155.39, containers: 15, customsValue: 184232392, national: 14370000, local: 4053000, total: 18423000 },
    { ref: '#16-1 IM3Z6A0049', cif: 372575.4, fx: 157.75, containers: 5, customsValue: 58782769, national: 4584900, local: 1293100, total: 5878000 },
    { ref: '#16-2 IM3Z6A0114', cif: 78484.27, fx: 158.03, containers: 1, customsValue: 12404669, national: 967500, local: 272800, total: 1240300 },
    { ref: '#11-1 IM3Z680452', cif: 1156238.8, fx: 159.0, containers: 15, customsValue: 183868969, national: 14341700, local: 4045000, total: 18386700 },
    // #18-1's permit (filed from Mitsui Soko's email 2026-10-30): ADH20261012 US$711,226.23 × 158.26 + 9 × ¥1,800.
    { ref: '#18-1 IM3Z6A0568', cif: 711226.23, fx: 158.26, containers: 9, customsValue: 112574863, national: 8780700, local: 2476600, total: 11257300 },
  ];
  it.each(PERMITS)('$ref: 加算運賃 ON matches the permit to the yen; OFF = the sheet method', (p) => {
    const on = estimate({ netWeightMt: 1, containerCount: p.containers }, { cifUsd: p.cif, fxRate: p.fx, includeAddOn: true }, DEFAULT_RATES).importTax;
    expect(on).toMatchObject({ addOnIncluded: true, addOnValue: p.containers * ADD_ON_PER_CONTAINER, addOnSource: 'containers', customsValue: p.customsValue, national: p.national, local: p.local, estimate: p.total });
    const off = estimate({ netWeightMt: 1, containerCount: p.containers }, { cifUsd: p.cif, fxRate: p.fx }, DEFAULT_RATES).importTax;
    expect(off.addOnIncluded).toBe(false);
    expect(off.estimate).toBe(sheet(p.cif, p.fx).c6);
    expect(off.addOnEffect).toBe(p.total - sheet(p.cif, p.fx).c6);
    expect(off.addOnEffect).toBeGreaterThan(0);
  });

  it('加算運賃 value: typed > A/N EQMC > containers × ¥1,800; unknown → no effect shown', () => {
    const base = { cifUsd: 1000, fxRate: 150, includeAddOn: true };
    expect(estimate({ containerCount: 9 }, { ...base, customsAddOnJpy: 20000, equipmentFee: 3600 }, DEFAULT_RATES).importTax).toMatchObject({ addOnValue: 20000, addOnSource: 'typed' });
    expect(estimate({ containerCount: 9 }, { ...base, equipmentFee: 3600 }, DEFAULT_RATES).importTax).toMatchObject({ addOnValue: 3600, addOnSource: 'EQMC' });
    expect(estimate({ containerCount: 9 }, base, DEFAULT_RATES).importTax).toMatchObject({ addOnValue: 16200, addOnSource: 'containers' });
    expect(estimate({}, { cifUsd: 1000, fxRate: 150 }, DEFAULT_RATES).importTax).toMatchObject({ addOnValue: null, addOnEffect: null, addOnJpy: 0 });
  });

  it('CIF from the SG→JP invoice and the customs weekly rate when nothing is typed; typed values win', () => {
    const ctx = { cif: { amount: 459412.52, invoiceNo: 'ADH20260825', kind: 'file' as const, ref: 'INVOICE & PACKING LIST_6005_….pdf' }, rate: { rate: 159.09, start: '2026-08-30', end: '2026-09-05', url: 'u', provisional: false } };
    const e = estimate({ netWeightMt: 122.478, eta: '2026-09-04' }, {}, DEFAULT_RATES, {}, ctx).importTax;
    expect(e).toMatchObject({ cifUsd: 459412.52, cifSource: { kind: 'file', invoiceNo: 'ADH20260825' }, fxRate: 159.09, fxSource: { kind: 'customs', start: '2026-08-30' }, clearanceDate: '2026-09-04', clearanceFrom: 'eta', estimate: 7308500 });
    const typed = estimate({ eta: '2026-09-04' }, { cifUsd: 450000, fxRate: 150, clearanceDate: '2026-09-10' }, DEFAULT_RATES, {}, ctx).importTax;
    expect(typed).toMatchObject({ cifUsd: 450000, cifSource: { kind: 'typed', sgjpAmount: 459412.52 }, fxRate: 150, fxSource: { kind: 'typed', customsRate: 159.09 }, clearanceDate: '2026-09-10', clearanceFrom: 'typed' });
  });
});

describe('Round BK — customs weekly rate (customs.go.jp)', () => {
  it('the week (Sunday → Saturday) and its PDF', () => {
    expect(customsWeek('2026-09-04')).toEqual({ start: '2026-08-30', end: '2026-09-05' });
    expect(customsWeek('2026-10-26')).toEqual({ start: '2026-10-25', end: '2026-10-31' });
    expect(customsWeek('2026-10-25')).toEqual({ start: '2026-10-25', end: '2026-10-31' });
    expect(customsRatePdfUrl(customsWeek('2026-10-26'))).toBe('https://www.customs.go.jp/tetsuzuki/kawase/kawase2026/kouji-rate20261025-20261031.pdf');
  });
  it('reads the USD line of the PDF and the CSV', () => {
    expect(parseCustomsUsd('304 アメリカ合衆国 ドル USD 158.26\n適用期間：令和８年10月25日から')).toBe(158.26);
    expect(parseCustomsUsd('304,アメリカ合衆国,ドル,USD,157.63,')).toBe(157.63);
    expect(parseCustomsUsd('no rate')).toBeNull();
  });
  it('fetches the clearance week; a week not published yet falls back to the latest published one (provisional)', async () => {
    const pdfs: Record<string, string> = { '20260830-20260905': 'USD 159.09', '20261025-20261031': 'USD 158.26' };
    const fetcher = jest.fn(async (url: string) => {
      const k = /kouji-rate(\d{8}-\d{8})\.pdf/.exec(url)![1];
      return { ok: !!pdfs[k], buffer: async () => Buffer.from(pdfs[k] ?? '') };
    });
    const svc = new TradeTaxInputsService({} as any, undefined, fetcher);
    // pdfText reads PDFs; the fake bodies are plain text → stub the parser path.
    (svc as any).week = async (w: { start: string; end: string }) => {
      const r = await fetcher(customsRatePdfUrl(w));
      return r.ok ? { rate: parseCustomsUsd((await r.buffer()).toString()), url: customsRatePdfUrl(w) } : null;
    };
    expect(await svc.usdRateFor('2026-09-04')).toMatchObject({ rate: 159.09, start: '2026-08-30', provisional: false });
    expect(await svc.usdRateFor('2026-10-30')).toMatchObject({ rate: 158.26, provisional: false });
    expect(await svc.usdRateFor(null)).toBeNull();
  });
});

describe('Round BK — CIF = the SG→JP invoice total (never Vedanta\'s CI)', () => {
  const ADH_18_1 = 'INVOICE NO.: ADH20261012\nUS$711,226.23\nHS CODE : 7601.20 CIF 3,871.82 183.693 US$711,226.23\n183.693 184.413';
  it("ADH's own file: no., date, total and whether it is this shipment's quantity", () => {
    expect(sgjpFileFacts(ADH_18_1, 183.693)).toEqual({ invoiceNo: 'ADH20261012', invoiceDate: '2026-10-12', total: 711226.23, netMatches: true });
    // The same file is also filed on #18-3 (17.861 t): not its CIF.
    expect(sgjpFileFacts(ADH_18_1, 17.861).netMatches).toBe(false);
  });
  it('latest FINAL / filed invoice wins; a draft only when there is none', () => {
    const c = (kind: 'final' | 'file' | 'draft', invoiceDate: string, amount: number) => ({ amount, invoiceNo: `ADH${invoiceDate.replace(/-/g, '')}`, invoiceDate, kind, ref: kind, at: '2026-11-06T00:00:00Z' });
    expect(pickCif([c('draft', '2026-11-06', 1), c('file', '2026-10-12', 711226.23)])).toMatchObject({ kind: 'file', amount: 711226.23 });
    expect(pickCif([c('file', '2026-10-12', 2), c('final', '2026-10-20', 3)])).toMatchObject({ kind: 'final', amount: 3 });
    expect(pickCif([c('draft', '2026-11-06', 5)])).toMatchObject({ kind: 'draft' });
    expect(pickCif([])).toBeNull();
  });
});

describe('Round BK — costs: the 加算運賃 switch and the clearance date', () => {
  const fail = (m: string): never => { throw new Error(m); };
  it('validates', () => {
    expect(cleanCosts({ includeAddOn: true, clearanceDate: '2026-10-26' }, fail)).toEqual({ includeAddOn: true, clearanceDate: '2026-10-26' });
    expect(cleanCosts({ clearanceDate: '' }, fail)).toEqual({ clearanceDate: null });
    expect(() => cleanCosts({ includeAddOn: 'yes' }, fail)).toThrow(/true or false/);
    expect(() => cleanCosts({ clearanceDate: '26/10' }, fail)).toThrow(/date/);
  });
});
