import { importTax } from './trade-customs';
import { estimate, ratesOf } from './trade-estimator';

// Round BI: AIMS's import-tax formula against ADH's real 輸入許可通知書 (CIF USD, the permit's USD rate, 加算運賃 code E).
const PERMITS = [
  { ref: '#15-1', no: 'IM3Z690456', cif: 1185439.17, fx: 155.39, addOn: 27000, customsValue: 184232392, national: 14370000, local: 4053000, total: 18423000 },
  { ref: '#16-1', no: 'IM3Z6A0049', cif: 372575.4, fx: 157.75, addOn: 9000, customsValue: 58782769, national: 4584900, local: 1293100, total: 5878000 },
  { ref: '#16-2', no: 'IM3Z6A0114', cif: 78484.27, fx: 158.03, addOn: 1800, customsValue: 12404669, national: 967500, local: 272800, total: 1240300 },
  { ref: '#11-1', no: 'IM3Z680452', cif: 1156238.8, fx: 159.0, addOn: 27000, customsValue: 183868969, national: 14341700, local: 4045000, total: 18386700 },
];

describe('round BI: import tax = the real permits, to the yen', () => {
  for (const pm of PERMITS) {
    it(`${pm.ref} ${pm.no}: 申告価格 ¥${pm.customsValue.toLocaleString('en-US')} → 納税額合計 ¥${pm.total.toLocaleString('en-US')}`, () => {
      const t = importTax(pm.cif, pm.fx, pm.addOn);
      expect([t.customsValue, t.national, t.local, t.total]).toEqual([pm.customsValue, pm.national, pm.local, pm.total]);
      // The step 7 / 8 estimator gives the same from Shipment.costs with 加算運賃 switched on (round BK: off by default).
      const e = estimate({ netWeightMt: 1 }, { cifUsd: pm.cif, fxRate: pm.fx, customsAddOnJpy: pm.addOn, includeAddOn: true }, ratesOf(null));
      expect(e.importTax.estimate).toBe(pm.total);
    });
  }
  it('an empty 加算運賃 (and no A/N EQMC) counts as ¥0 — the tax still calculates; only CIF / rate missing gives "—"', () => {
    const e = estimate({ netWeightMt: 1 }, { cifUsd: 78484.27, fxRate: 158.03 }, ratesOf(null));
    expect([e.importTax.addOnJpy, e.importTax.addOnSource, e.importTax.customsValue]).toEqual([0, null, 12402869]);
    expect(estimate({ netWeightMt: 1 }, { fxRate: 158.26 }, ratesOf(null)).importTax.estimate).toBeNull();
  });
});
