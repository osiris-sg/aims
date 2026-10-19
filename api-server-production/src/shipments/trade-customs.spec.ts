/**
 * Import tax and the 輸入許可書 / Arrival Notice readers, checked against ADH's
 * real documents. The PDFs are customer documents and stay out of the repo:
 * the file-based cases run only where ~/Desktop/ADH_Docs exists (skipped in CI).
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { anChargesForCosts, importTax, parseAnText, parsePermitText, permitChecks, permitTotalFromFileName, sameBl, taxFromCustomsValue, textDate } from './trade-customs';


const DOCS = path.join(os.homedir(), 'Desktop', 'ADH_Docs');
const haveDocs = fs.existsSync(DOCS);
const withDocs = haveDocs ? it : it.skip;
/** File names are macOS NFD: match on a normalised pattern. */
const fileLike = (re: RegExp) => {
  const f = fs.readdirSync(DOCS).find((n) => re.test(n.normalize('NFC')));
  if (!f) throw new Error(`no sample matching ${re}`);
  return path.join(DOCS, f);
};
/** The text layer as the service reads it (pdf-parse v2 is ESM-only under jest, so read it in a plain node process). */
const textOf = async (file: string) =>
  execFileSync(
    process.execPath,
    ['-e', "const {PDFParse}=require('pdf-parse');new PDFParse({data:require('fs').readFileSync(process.argv[1])}).getText().then(r=>process.stdout.write(String(r.text)))", file],
    { cwd: path.join(__dirname, '..', '..'), encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 },
  );

describe('import tax — the permit formula', () => {
  it('#11 (198GX04630): ⌊1,156,238.80 × 159.00⌋ + 27,000 = ¥183,868,969 → 14,341,700 + 4,045,000 = ¥18,386,700', () => {
    const t = importTax(1156238.8, 159, 27000);
    expect(t.cifJpy).toBe(183841969);
    expect(t.customsValue).toBe(183868969);
    expect(t.taxBase).toBe(183868000);
    expect(t.nationalRaw).toBe(14341704);
    expect(t.national).toBe(14341700);
    // The permit prints 4,045,094 before rounding (14,341,700 × 22/78 = 4,045,094.87).
    expect(t.localRaw).toBe(4045094);
    expect(t.local).toBe(4045000);
    expect(t.total).toBe(18386700);
  });

  it('122.478t (198GX04822): CIF 459,412.52 + EQMC ¥10,800 → ¥7,311,100 only at a customs rate of 159.12', () => {
    // CIF from the SG→JP IV (ROUNDDOWN(3,750.98 × 122.478, 2)); add-on = the A/N's EQMC (6 × 1,800).
    expect(importTax(459412.52, 159.12, 10800).total).toBe(7311100);
    // At #11's rate (159.00) it would be ¥7,305,600 — the permit's own rate is needed.
    expect(importTax(459412.52, 159.0, 10800).total).toBe(7305600);
  });

  it('works from a 申告価格 already known', () => {
    expect(taxFromCustomsValue(183868969).total).toBe(18386700);
  });

  it('file-name fallback: "輸入許可書202607-09_JPY18,386,700_SUS305.804t …pdf" → 18,386,700', () => {
    expect(permitTotalFromFileName('輸入許可書202607-09_JPY18,386,700_SUS305.804t 198GX04630.pdf')).toBe(18386700);
    expect(permitTotalFromFileName('IM3Z680452_20260824165553.pdf')).toBeNull();
  });

  it('B/L on the permit carries a NACCS prefix', () => {
    expect(sameBl('BE22AA198GX04630', '198GX04630')).toBe(true);
    expect(sameBl('BE22AA198GX04630', '198GX04631')).toBe(false);
  });

  it('dates', () => {
    expect(textDate('AUG 24 2026')).toBe('2026-08-24');
    expect(textDate('2026/08/24')).toBe('2026-08-24');
  });
});

describe('輸入許可書 reader (IM3Z680452, #11)', () => {
  withDocs('reads the permit from its text layer and the taxes agree with the formula', async () => {
    const { data, complete } = parsePermitText(await textOf(fileLike(/^IM3Z680452/)));
    expect(complete).toBe(true);
    expect(data).toMatchObject({
      declarationNo: '21679102160',
      declarationDate: '2026-08-24',
      invoiceTerms: 'CIF',
      invoiceCurrency: 'USD',
      invoiceAmount: 1156238.8,
      addOnJpy: 27000,
      fxRate: 159,
      customsValue: 183868969,
      national: 14341700,
      local: 4045000,
      total: 18386700,
      packages: 120,
      grossWeightKg: 307004,
      vessel: 'WAN HAI 365',
      invoiceNo: 'ADH20260820',
    });
    expect(sameBl(data.blNumber, '198GX04630')).toBe(true);
    // The permit's own numbers reproduce exactly.
    expect(importTax(data.invoiceAmount!, data.fxRate!, data.addOnJpy!).total).toBe(data.total);
  });

  withDocs('step 10 checks: B/L and 仕入書番号 against the shipment — a wrong one warns', async () => {
    const { data } = parsePermitText(await textOf(fileLike(/^IM3Z680452/)));
    const ok = permitChecks(data, { blNumber: '198GX04630', sgjpInvoiceNo: 'ADH20260820' });
    expect(ok.map((c) => c.status)).toEqual(['ok', 'ok']);
    const bad = permitChecks(data, { blNumber: '198GX04631', sgjpInvoiceNo: 'ADH20260831' });
    expect(bad.map((c) => c.status)).toEqual(['mismatch', 'mismatch']);
  });
});

describe('Wan Hai Arrival Notice reader', () => {
  withDocs('198GX04630: arriving vessel WAN HAI 365 (T/S Port Klang), THC 15 × 36,000 + DOC 6,000 + EQMC 27,000 = 573,000', async () => {
    const { data, complete } = parseAnText(await textOf(fileLike(/^WDMFT505_AN_.*198GX04630-MAIL\.pdf$/)));
    expect(complete).toBe(true);
    expect(data).toMatchObject({
      blNumber: '198GX04630',
      vessel: 'RACHA BHUM',
      voyageNo: '211E',
      tsVessel: 'WAN HAI 365',
      tsVoyageNo: 'N044',
      tsPort: 'PORT KLANG NORTH PORT',
      eta: '2026-08-24',
      cyTerminal: 'HONMOKU BC SUZUE CORP.',
      containerCount: 15,
      bundles: 120,
      grossWeightKg: 307004,
      cbm: 375,
      telexRelease: true,
      chargesTotal: 573000,
    });
    expect(data.charges).toEqual([
      { code: 'THC', unit: 15, rate: 36000, total: 540000, currency: 'JPY' },
      { code: 'DOC', unit: null, rate: null, total: 6000, currency: 'JPY' },
      { code: 'EQMC', unit: null, rate: null, total: 27000, currency: 'JPY' },
    ]);
    expect(anChargesForCosts(data)).toEqual({ thc: 540000, docFee: 6000, equipmentFee: 27000 });
  });

  withDocs('198GX04822: 6 CTR, THC 216,000 + DOC 6,000 + EQMC 10,800 = 232,800; ETA 2026-09-04', async () => {
    const { data, complete } = parseAnText(await textOf(fileLike(/198GX04822-MAIL\.pdf$/)));
    expect(complete).toBe(true);
    expect(data).toMatchObject({ blNumber: '198GX04822', vessel: 'WAN HAI 366', voyageNo: 'E049', tsVessel: 'WAN HAI 358', eta: '2026-09-04', containerCount: 6, bundles: 48, grossWeightKg: 122958, chargesTotal: 232800 });
    expect(anChargesForCosts(data)).toEqual({ thc: 216000, docFee: 6000, equipmentFee: 10800 });
  });

  withDocs('198GX04631 (merged A/N): read and adds up', async () => {
    const { data, complete } = parseAnText(await textOf(fileLike(/198GX04631_A-MAIL\.pdf$/)));
    expect(complete).toBe(true);
    expect(data.blNumber).toBe('198GX04631');
    expect(data.charges.reduce((s, c) => s + c.total, 0)).toBe(data.chargesTotal);
  });
});
