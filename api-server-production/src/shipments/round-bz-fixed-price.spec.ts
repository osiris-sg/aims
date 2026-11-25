import { SIAE_BL_RAW } from './__fixtures__/bl-siae-nlbso';
import { cleanProduct, fixedPriceFor, ClientProduct } from './clients-products';
import { shipmentDraftFromBl, toMt } from './trade-extract.rules';
import { mtText, renderSgjpV2Html, sgjpFinalizeProblems, sgjpInvoiceNo, sgjpItemAmount, sgjpTotals, sgjpUnitPrice, SgjpHeaderV2, SgjpItem } from './trade-logistics-docs';
import { lotPreview, notInFrs, LotInput } from './lot-accounting';
import { sgjpFileFacts } from './trade-tax-inputs';
import { importTaxEstimate } from './trade-estimator';

const bad = (m: string): never => {
  throw new Error(m);
};
const NOW = '2026-11-25T00:00:00.000Z';

/** #24-1 (Sankyo Tateyama · PT Sri Indah): what AIMS's regenerated draft holds — the prefill for a FIXED_ALL_IN customer. */
const item24: SgjpItem = {
  goods: 'ALUMINIUM ALLOY INGOT 6063',
  hsCode: '7601.20',
  terms: 'CIF',
  priceMode: 'FIXED_ALL_IN',
  lme: null,
  qmjp: null,
  premium: null,
  upcharge: null,
  unitPrice: 3750,
  quantity: 50.0395,
  bundles: 45,
  pieces: 8375,
  netMt: 50.0395,
  grossMt: 50.062,
  dimension: '',
};
const header24: SgjpHeaderV2 = {
  layout: 2,
  invoiceNo: sgjpInvoiceNo('2026-11-25'),
  invoiceDate: '2026-11-25',
  shipperBlock: 'PT. SRI INDAH ALUMINIUM EXTRUSION',
  consigneeBlock: 'ASIA DEAL HUB JAPAN LLC.',
  sellerBlock: 'ASIA DEAL HUB PTE. LTD.',
  buyerBlock: 'ASIA DEAL HUB JAPAN LLC.',
  placeOfReceipt: 'BATAM, INDONESIA',
  portOfLoading: 'BATAM, INDONESIA',
  portOfDischarge: 'Nagoya, JAPAN',
  placeOfDelivery: 'Nagoya, JAPAN',
  payment: '',
  countryOfOrigin: 'INDONESIA',
  vessel: 'SITC BRAVE / V.2627N',
  others: '',
  shippingMarks: '',
  signBlock: 'ASIA DEAL HUB PTE. LTD.',
  currency: 'USD',
  lmeMonth: '2026-10',
};

describe('round BZ — Sankyo Tateyama fixed all-in price (3,750 USD/MT)', () => {
  describe('Clients › Products › Pricing', () => {
    it('stores a fixed all-in unit price; SUS / Kato rows (no price mode) stay formula', () => {
      const p = cleanProduct({ grade: '6063', form: 'REMELT_INGOT', priceMode: 'FIXED_ALL_IN', fixedUnitPrice: '3,750.00' }, undefined, 'p1', NOW, bad);
      expect(p).toMatchObject({ priceMode: 'FIXED_ALL_IN', fixedUnitPrice: 3750, fixedCurrency: 'USD' });
      const sus = cleanProduct({ grade: '6063', form: 'BILLET', priceBasis: 'LME + premium' }, undefined, 'p2', NOW, bad);
      expect(sus.priceMode).toBeNull();
      expect(sus.fixedUnitPrice).toBeNull();
    });

    it('a fixed price needs the price; an older screen that sends no price mode keeps it', () => {
      expect(() => cleanProduct({ grade: '6063', priceMode: 'FIXED_ALL_IN' }, undefined, 'p1', NOW, bad)).toThrow(/needs the price/);
      expect(() => cleanProduct({ grade: '6063', priceMode: 'CHEAP' }, undefined, 'p1', NOW, bad)).toThrow(/Unknown price basis/);
      const prev = cleanProduct({ grade: '6063', priceMode: 'FIXED_ALL_IN', fixedUnitPrice: 3750 }, undefined, 'p1', NOW, bad);
      expect(cleanProduct({ grade: '6063', notes: 'geta' }, prev, 'p1', NOW, bad)).toMatchObject({ priceMode: 'FIXED_ALL_IN', fixedUnitPrice: 3750 });
      expect(cleanProduct({ grade: '6063', priceMode: 'FORMULA' }, prev, 'p1', NOW, bad)).toMatchObject({ priceMode: null, fixedUnitPrice: null });
    });

    it('fixedPriceFor: the grade\'s fixed product; formula products or two different prices → null (never guessed)', () => {
      const fixed = { id: 'a', grade: '6063', form: 'REMELT_INGOT', priceMode: 'FIXED_ALL_IN', fixedUnitPrice: 3750, fixedCurrency: 'USD' } as ClientProduct;
      expect(fixedPriceFor([fixed], '6063')).toEqual({ unitPrice: 3750, currency: 'USD', productId: 'a' });
      expect(fixedPriceFor([fixed], '6005')).toBeNull();
      expect(fixedPriceFor([{ ...fixed, priceMode: null }], '6063')).toBeNull();
      expect(fixedPriceFor([{ ...fixed, hidden: true }], '6063')).toBeNull();
      expect(fixedPriceFor([fixed, { ...fixed, id: 'b', fixedUnitPrice: 3800 }], '6063')).toBeNull();
    });
  });

  describe('SG→JP INVOICE & PACKING LIST for #24-1 (ADH20261125)', () => {
    it('the B/L net weight keeps its precision: 50,039.5 KGS = 50.0395 MT (not 50.040)', () => {
      expect(toMt(50039.5, 'KGS')).toBe(50.0395);
      expect(toMt(50062, 'KGS')).toBe(50.062);
      expect(shipmentDraftFromBl(SIAE_BL_RAW as any)).toMatchObject({ netWeightMt: 50.0395, grossWeightMt: 50.062 });
    });

    it('unit price 3,750.00, not the formula (3,411.11): LME / QMJP / premium are ignored on a fixed line', () => {
      expect(sgjpUnitPrice(item24)).toBe(3750);
      expect(sgjpUnitPrice({ ...item24, lme: 3061.11, qmjp: 255, premium: 95 })).toBe(3750);
      expect(sgjpUnitPrice({ ...item24, priceMode: null, lme: 3061.11, qmjp: 255, premium: 95 })).toBe(3411.11);
    });

    it('total = ROUNDDOWN(50.0395 × 3,750, 2) = US$187,648.12 (ADH truncates: 187,648.125)', () => {
      expect(sgjpItemAmount(item24)).toBe(187648.12);
      expect(sgjpTotals([item24])).toMatchObject({ quantity: 50.0395, amount: 187648.12, netMt: 50.0395, grossMt: 50.062, bundles: 45, pieces: 8375 });
      expect(sgjpFinalizeProblems([item24])).toEqual([]);
    });

    it('prints the quantity and packing weights at the B/L precision, BATAM as place of receipt / port of loading, no suffix', () => {
      const html = renderSgjpV2Html(header24, [item24]);
      expect(html).toContain('INVOICE NO.: ADH20261125');
      expect(html).not.toContain('-SKT');
      expect(html).toContain('3,750.00');
      expect(html).toContain('US$187,648.12');
      expect(html).toContain('50.0395');
      expect(html).not.toContain('50.040');
      expect(html).toContain('50.062');
      expect(html).toContain('BATAM, INDONESIA');
      expect(html).not.toMatch(/VISAKHAPATNAM/i);
      expect(html).not.toContain('3,411.11');
    });

    it('mtText: 3 decimals, 4 only when the B/L has them', () => {
      expect(mtText(50.0395)).toBe('50.0395');
      expect(mtText(50.062)).toBe('50.062');
      expect(mtText(50.04)).toBe('50.040');
      expect(mtText(null)).toBe('');
    });

    it('ADH\'s own PDF is recognised for this shipment whether it prints 50.0395 or 50.040', () => {
      expect(sgjpFileFacts('INVOICE NO.: ADH20261125 … 50.0395 … US$187,648.12', 50.0395)).toMatchObject({ invoiceNo: 'ADH20261125', total: 187648.12, netMatches: true });
      expect(sgjpFileFacts('ADH20261125 50.040 US$187,648.12', 50.0395).netMatches).toBe(true);
      expect(sgjpFileFacts('ADH20261125 50.062 US$1.00', 50.0395).netMatches).toBe(false);
    });

    it('step 7 import tax runs on that total (187,648.12)', () => {
      const t = importTaxEstimate(187648.12, 158.95);
      expect(t?.cifUsd).toBe(187648.12);
      expect(t?.cifJpy).toBe(Math.floor((18764812 * 15895) / 10000));
    });
  });

  describe('accounting preview', () => {
    const base: LotInput = {
      orderRef: '#24',
      customerName: 'SankyoTateyama, Inc.',
      supplierName: 'PT Sri Indah Aluminium Extrusion',
      pattern: null,
      deliveryMonth: '2026-12',
      usdRate: null,
      shipments: [{ ref: '#24-1', netMt: 50.0395, ci: null, sgjpTotal: 187648.12, importTaxJpy: null, customsRate: null }],
      aimsDeposit: 54375,
      directInvoiceTotal: null,
      invoice1: null,
      done: { piPayment: true, ciPayment: true, invoice1: false, taxFunds: false },
    };

    it('Sankyo / SIAE is not in the FRS → rule needed, no Vedanta / SUS / Kato postings borrowed', () => {
      const p = lotPreview(base);
      expect(p.notInFrs).toMatch(/SankyoTateyama, Inc\. \/ PT Sri Indah Aluminium Extrusion isn't in the FRS/);
      expect(p.postings).toEqual([]);
      expect(p.rulesNeeded).toEqual([p.notInFrs]);
    });

    it('a Vedanta lot is unchanged (still previewed by its FRS pattern)', () => {
      expect(notInFrs({ customerName: 'SUS Co., Ltd.', supplierName: 'Vedanta Aluminium Metal Ltd' })).toBeNull();
      const p = lotPreview({ ...base, customerName: 'SUS Co., Ltd.', supplierName: 'Vedanta Aluminium Metal Ltd', pattern: 'SUS' });
      expect(p.notInFrs).toBeUndefined();
      expect(p.postings.length).toBeGreaterThan(0);
    });
  });
});
