import { formatViews, generatorFits } from './clients';
import { sgjpTotals } from './trade-logistics-docs';
import {
  HOEI_INVOICE_TEMPLATE,
  HOEI_IVPL_TEMPLATE,
  hoeiGoods,
  hoeiInvoiceDraft,
  hoeiInvoiceFinalizeProblems,
  hoeiInvoiceTotal,
  hoeiIvPlDraft,
  hoeiIvPlFinalizeProblems,
  hoeiLineAmount,
  hoeiParties,
  hoeiRemarks,
  isAsReceived,
  renderHoeiInvoiceHtml,
  renderHoeiIvPlHtml,
  toHoeiLines,
} from './trade-hoei-formats';
import { CustomerProfile, mergeProfiles, templateKeyFor } from './trade-profile';

const BANK = 'Test Bank\nBank address\tSomewhere 1\nRouting number\t000000000';
const HOEI = 'HOEI METAL (THAILAND)CO., LTD.\nHEAD OFFICE 454/16 MOO.9';
const NOTIFY = 'ISEWAN (THAILAND)CO., LTD.\n159/32 SERM-MITR TOWER';

// ADH's INVOICE & PACKING LIST_151.157MT_BL GGVCB26000252 (issued 2026/9/25): LME Aug 3249.63 + 3QMJP 395 + 60.
const iv150 = () =>
  hoeiIvPlDraft({
    today: '2026-09-25',
    shipMonth: '2026-08',
    supplierBlock: 'VEDANTA LIMITED (SEZ UNIT)',
    parties: { consignee: HOEI, buyer: HOEI, notify: NOTIFY },
    sellerBlock: 'ASIA DEAL HUB PTE. LTD.',
    signBlock: 'ASIA DEAL HUB PTE. LTD.',
    bank: { id: 'cfsb', block: BANK },
    portOfLoading: 'Gangavaram Port',
    portOfDischarge: 'Laem Chabang',
    countryOfOrigin: 'India',
    vessel: 'KOTA SELAMAT',
    voyageNo: '0523E',
    product: 'Aluminium Ingot',
    grade: 'P1020',
    hsCode: null,
    incoterm: 'CIF',
    lme: 3249.63,
    qmjp: 395,
    premium: null,
    netMt: 151.157,
    grossMt: 151.157,
    bundles: 152,
    pieces: 6688,
  });

describe('Hoei INVOICE & PACKING LIST (round AN)', () => {
  it('prices and numbers like ADH’s sheet (ROUNDDOWN amount)', () => {
    const { header, items } = iv150();
    expect(header.invoiceNo).toBe('ADH20260925');
    expect(header.portOfLoading).toBe('GANGAVARAM PORT, INDIA');
    expect(header.portOfDischarge).toBe('LAEM CHABANG, THAILAND');
    expect(header.vessel).toBe('KOTA SELAMAT / 0523E');
    expect(items[0].goods).toBe('PRIMARY ALUMINIUM INGOT P1020A');
    expect(items[0].hsCode).toBe('7601.10');
    const t = sgjpTotals(items);
    expect(t.amount).toBe(559980.75);
    expect(t.bundles).toBe(152);
  });
  it('renders the Hoei blocks (Notify Party, Payment Term, Bank Account)', () => {
    const { header, items } = iv150();
    const html = renderHoeiIvPlHtml(header, items);
    for (const s of ['Issued Date', '（Notify Party)', 'ISEWAN', 'HS CODE : 7601.10 CIF', '3,704.63', 'US$559,980.75', '152 Bundles', '6688 PCS', '152 Bundle only', 'Payment within 5 working days after Copy of BL and Invoice', 'Bank address：Somewhere 1']) expect(html).toContain(s);
  });
  it('finalize needs the consignee, a bank and a price', () => {
    const { header, items } = iv150();
    expect(hoeiIvPlFinalizeProblems(header, items)).toEqual([]);
    expect(hoeiIvPlFinalizeProblems({ ...header, consigneeBlock: '', bankBlock: '' }, [{ ...items[0], lme: null }])).toEqual(['enter the Consignee (Hoei)', 'pick the bank account', 'item 1 needs the LME', 'the total is US$0.00']);
  });
  it('goods names', () => {
    expect(hoeiGoods('Aluminium Ingot', 'P1020')).toBe('PRIMARY ALUMINIUM INGOT P1020A');
    expect(hoeiGoods('Aluminium Billet', '6063')).toBe('ALUMINIUM BILLET 6063');
  });
});

describe('Hoei 請求書 USD (round AN)', () => {
  const draft = (qty: number, lme: number, qmjp: number, month: string) =>
    hoeiInvoiceDraft({ today: '2026-09-18', toName: 'HOEI METAL (THAILAND)Co.,Ltd.', fromName: 'Asia Deal Hub Pte. Ltd.', fromAddress: '12 MARINA BOULEVARD 17-01,', bank: { id: 'cfsb', block: BANK }, shipMonth: month, validity: '2026-09-30', dueDate: '2026-09-25', lines: [{ quantity: qty, lme, qmjp, premium: null, product: 'Aluminium Ingot', grade: 'P1020' }] });
  it('matches ADH’s totals (ROUND, not ROUNDDOWN)', () => {
    expect(hoeiInvoiceTotal(draft(151.157, 3249.63, 395, '2026-08').rows)).toBe(559980.76);
    expect(hoeiInvoiceTotal(draft(99.354, 3280.54, 351.5, '2026-06').rows)).toBe(366818.94);
  });
  it('lines carry no tax and the 単価明細', () => {
    const { header, rows } = draft(151.157, 3249.63, 395, '2026-08');
    expect(rows[0]).toMatchObject({ description: 'PRIMARY ALUMINIUM INGOT P1020', premium: 60, taxable: false });
    expect(rows[0].remarks).toBe('LME Cash\n2026/8月平均 3249.63\n+ 3rdQ MJP 395\n+ Billet Premium 60');
    expect(header.subject).toBe('Vedanta P1020 アルミニウムインゴット');
    expect(header.conditions).toContain('8月平均LME Cash');
    const html = renderHoeiInvoiceHtml(header, rows);
    for (const s of ['HOEI METAL (THAILAND)Co.,Ltd.', '御中', 'US$559,980.76', '数量(MT)', '単価(USD)', '弊社指定口座', 'Somewhere 1', '20260918']) expect(html).toContain(s);
    expect(html).not.toContain('消費税');
    expect(html).not.toContain('単価(円)');
  });
  it('stored rows round-trip; finalize problems', () => {
    const { header, rows } = draft(151.157, 3249.63, 395, '2026-08');
    const back = toHoeiLines(JSON.parse(JSON.stringify(rows)));
    expect(hoeiLineAmount(back[0])).toBe(559980.76);
    expect(hoeiInvoiceFinalizeProblems(header, back)).toEqual([]);
    expect(hoeiInvoiceFinalizeProblems({ ...header, bankBlock: '' }, [{ ...back[0], lme: null }])).toEqual(['line 1 needs the LME', 'pick the bank account (弊社指定口座)', 'the total is US$0.00']);
  });
  it('remarks without a month', () => {
    expect(hoeiRemarks('', { lme: null, qmjp: 395, premium: 60 })).toBe('LME Cash\n平均\n+ MJP 395\n+ Billet Premium 60');
  });
});

describe('Hoei profile wiring (round AN)', () => {
  const id = '8ebdc67b-224a-4f30-ac5c-929b4f17fd78';
  const fail = (m: string): never => {
    throw new Error(m);
  };
  const base = { billingMode: 'SINGLE', truckCapacityT: 10, docVariants: { SGJP_IV_PL: HOEI_IVPL_TEMPLATE, INVOICE: HOEI_INVOICE_TEMPLATE, CUSTOMER_COA: 'CUSTOMER_COA_AS_RECEIVED' } };
  it('keeps the variants and party blocks; a save without party blocks keeps them', () => {
    const one = mergeProfiles({}, { [id]: { ...base, partyBlocks: { consignee: HOEI, notify: NOTIFY } } }, fail);
    expect(one[id].partyBlocks).toEqual({ consignee: HOEI, notify: NOTIFY });
    expect(templateKeyFor(one[id], 'SGJP_IV_PL')).toBe(HOEI_IVPL_TEMPLATE);
    expect(templateKeyFor(one[id], 'INVOICE_SINGLE')).toBe(HOEI_INVOICE_TEMPLATE);
    expect(isAsReceived(templateKeyFor(one[id], 'CUSTOMER_COA'))).toBe(true);
    const two = mergeProfiles(one, { [id]: base }, fail);
    expect(two[id].partyBlocks).toEqual({ consignee: HOEI, notify: NOTIFY });
    expect(() => mergeProfiles({}, { [id]: { ...base, partyBlocks: { shipper: 'x' } } }, fail)).toThrow('partyBlocks');
  });
  it('other customers keep the SG→JP layout', () => {
    const kato = mergeProfiles({}, { [id]: { billingMode: 'SINGLE', truckCapacityT: 10, docVariants: {} } }, fail)[id];
    expect(templateKeyFor(kato, 'SGJP_IV_PL')).toBe('SGJP_IV_PL');
    expect(templateKeyFor(kato, 'INVOICE_SINGLE')).toBe('INVOICE_SINGLE');
  });
  it('party fallback: the customer master record', () => {
    expect(hoeiParties(null, { name: 'Houei', address: 'Kabinburi' })).toEqual({ consignee: 'Houei\nKabinburi', buyer: 'Houei\nKabinburi', notify: '' });
  });
  it('Clients → Document formats lists the Hoei options', () => {
    const p = mergeProfiles({}, { [id]: base }, fail)[id] as CustomerProfile;
    const v = formatViews(p, 'HOEI');
    const iv = v.find((x) => x.docType === 'SGJP_IV_PL')!;
    expect(iv.choose).toBe('variant');
    expect(iv.generator).toBe(HOEI_IVPL_TEMPLATE);
    expect(iv.options.map((o) => o.key)).toEqual(['SGJP_IV_PL', HOEI_IVPL_TEMPLATE]);
    const inv = v.find((x) => x.docType === 'INVOICE')!;
    expect(inv.generator).toBe(HOEI_INVOICE_TEMPLATE);
    expect(inv.options.map((o) => o.key)).toEqual(['INVOICE_SINGLE', HOEI_INVOICE_TEMPLATE]);
    expect(v.find((x) => x.docType === 'CUSTOMER_COA')!.generator).toBe('CUSTOMER_COA_AS_RECEIVED');
    const sus = formatViews(mergeProfiles({}, { [id]: { billingMode: 'TWO_STAGE', truckCapacityT: 20, docVariants: {} } }, fail)[id], 'SUS');
    expect(sus.find((x) => x.docType === 'SGJP_IV_PL')!.generator).toBe('SGJP_IV_PL');
    expect(sus.find((x) => x.docType === 'INVOICE')!.options.map((o) => o.key)).toEqual(['INVOICE_2']);
    expect(generatorFits('SGJP_IV_PL', HOEI_IVPL_TEMPLATE)).toBe(true);
    expect(generatorFits('INVOICE', HOEI_INVOICE_TEMPLATE)).toBe(true);
    expect(generatorFits('CUSTOMER_PL', HOEI_IVPL_TEMPLATE)).toBe(false);
  });
});
