/**
 * Round BO — READ-ONLY: build Kato's Dec 2026 invoices with AIMS's own draft builder (TradeGeneratedService
 * singleInvoiceDraft, issue date 2026-11-09) from prod data + the PROPOSED Kato settings of _bo-kato-go.ts (in memory
 * only), and compare every printed value with ADH's PDFs 202611_01 (#28, 6063) / 202611_02 (#27, 6005). Writes the
 * HTML (and the side-by-side table) to --out; nothing is stored.
 * Usage: DBURL=<prod url> TENANCY_MODE= npx ts-node -r tsconfig-paths/register --transpile-only scripts/_bo-side-by-side.ts --out=<dir>
 */
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import { TradeConfigService } from '../src/shipments/trade-config.service';
import { TradeGeneratedService } from '../src/shipments/trade-generated.service';
import { TradeTaxInputsService } from '../src/shipments/trade-tax-inputs';
import { renderSingleInvoiceHtml, SingleInvoiceHeader, SingleLine, singleTotals } from '../src/shipments/trade-invoice-single';
import { money } from '../src/shipments/trade-doc-shell';

const ADH = '056ed6da-42d3-438e-895b-84bb4df47a4c';
const KATO = 'a4ccfa28-9f64-468e-a943-e96ce8f8c3a0';
const OUT = (process.argv.find((a) => a.startsWith('--out=')) ?? '').slice(6);

/** ADH's printed values (read from the PDFs' text layer). */
const PDF: Record<number, Record<string, string>> = {
  28: { no: '202611_01', issue: '2026/11/9', subject: 'アルミニウムビレット 6063 8 インチ', terms: '請求書発行後５営業日以内、USD建て- 弊社指定口座振込', total: '162,205.08', qty: '40.271', unit: '3,576.11', amt: '144,013.52', unitJpy: '563,702', amtJpy: '22,700,852', remarks: 'LME Cash / 10月平均 3061.11 / + Q4 MJP 255.0 / + Billet Premium 260', customsUsd: '1,298.46', customsJpy: '204,678', flatUsd: '589.98', flatJpy: '93,000', otherUsd: '1,610.84', otherUnitJpy: '6,305', otherJpy: '253,916', nonTax: '589.98 / 93,000', taxable: '146,922.82 / 23,159,446', tax: '14,692.28 / 2,315,945', sum: '162,205.08 / 25,568,391', bdJpy: '¥23,159,446 ¥2,315,945 ¥25,475,391', bdUsd: 'USD 146,922.82 USD 14,692.28 USD 161,615.10', fx: '157.63 11/8-11/14 関税外国為替相場', due: '2026/11/16', bank: 'Community Federal Savings Bank …8644' },
  27: { no: '202611_02', issue: '2026/11/9', subject: 'アルミニウムビレット 6005 8 インチ', terms: '請求書発行後５営業日以内、USD建て- 弊社指定口座振込', total: '165,661.77', qty: '40.855', unit: '3,601.11', amt: '147,123.34', unitJpy: '567,643', amtJpy: '23,191,053', remarks: 'LME Cash / 10月平均 3061.11 / + Q4 MJP 255.0 / + Billet Premium 285', customsUsd: '1,307.73', customsJpy: '206,138', flatUsd: '589.98', flatJpy: '93,000', otherUsd: '1,634.20', otherUnitJpy: '6,305', otherJpy: '257,598', nonTax: '589.98 / 93,000', taxable: '150,065.27 / 23,654,789', tax: '15,006.52 / 2,365,479', sum: '165,661.77 / 26,113,268', bdJpy: '¥23,654,789 ¥2,365,479 ¥26,020,268', bdUsd: 'USD 150,065.27 USD 15,006.52 USD 165,071.79', fx: '157.63 11/8-11/14 関税外国為替相場', due: '2026/11/16', bank: 'Community Federal Savings Bank …8644' },
};
const KATO_REMARKS = ' 商　品：アルミビレット\n 荷　姿：バンドル\n 保管倉庫：三井倉庫\n 取扱港　：名古屋港\n 保管条件：野積保管\n 業務範囲：名古屋港到着後CY通関、ドレージ、 デバン入出庫、NO.取り作業(傷チェック)、保管(野積)、貴社指定場所（車上渡し)への配送まで\n 作業備考：コンテナ単位での保管指定あり\n\n※保管料、船社立替実費追加\n※10tw車、時間指定なし';

const slash = (d: string) => d.replace(/^(\d{4})-0?(\d+)-0?(\d+)$/, '$1/$2/$3');

async function main() {
  if (!OUT) throw new Error('--out=<dir>');
  fs.mkdirSync(OUT, { recursive: true });
  const p = new PrismaClient({ datasources: { db: { url: process.env.DBURL } } });
  await p.$executeRawUnsafe('SET default_transaction_read_only = on');
  const config = new TradeConfigService(p as any);
  // The proposed Kato settings, in memory only.
  const realProfileOf = config.profileOf.bind(config);
  (config as any).profileOf = async (org: string, id: string | null) => {
    const prof = await realProfileOf(org, id);
    return id === KATO ? { ...prof, singleInvoiceStep: 'INVOICE_1', customsFlatJpy: 93000, invoiceRemarks: KATO_REMARKS } : prof;
  };
  const settings = await config.getSettings(ADH);
  const defaults: any = { ...(settings.docDefaults ?? {}), qmjpByQuarter: { ...((settings.docDefaults as any)?.qmjpByQuarter ?? {}), '2026-4Q': 255 } };
  const gen = new TradeGeneratedService(p as any, null as any, null as any, config, null as any, null as any, null as any, new TradeTaxInputsService(p as any));
  const org = await p.organization.findFirst({ where: { id: ADH }, select: { name: true, address: true, registrationNumber: true } });
  const seal = typeof (settings.docDefaults as any)?.sealImage === 'string' ? (settings.docDefaults as any).sealImage : null;
  const md: string[] = [];
  for (const orderNo of [28, 27]) {
    const o: any = await p.tradeOrder.findFirst({ where: { organizationId: ADH, orderNo }, select: { shipments: { select: { id: true, seqNo: true } } } });
    const built: { header: SingleInvoiceHeader; rows: SingleLine[] } = await (gen as any).singleInvoiceDraft(ADH, o.shipments.map((s: any) => s.id), defaults, { ...settings, docDefaults: defaults }, org, '2026-11-09');
    const variants: Array<[string, { header: SingleInvoiceHeader; rows: SingleLine[] }]> = [['aims', built]];
    // #28: AIMS has no net weight yet (CI 9000600230 says 40.271 t) and its premium is 285 (the PDF bills 260): also show the
    // invoice with those two values as the PDF has them, to check the rest of the format.
    if (orderNo === 28) variants.push(['with-pdf-qty-premium', { header: built.header, rows: built.rows.map((r) => (r.kind === 'goods' ? { ...r, quantity: 40.271, premium: 260, remarks: r.remarks.replace(/Billet Premium 285/, 'Billet Premium 260') } : r.kind === 'usd' ? { ...r, quantity: 40.271 } : r)) }]);
    for (const [tag, b] of variants) {
      const h = { ...b.header, invoiceNo: PDF[orderNo].no };
      // 通関、車輸送料 depends on the weight: recompute for the variant's quantity like the builder (qty × 2,300 + 4 × 26,000 + qty × 200).
      if (tag !== 'aims') b.rows = b.rows.map((r) => (r.kind === 'jpy' && r.taxable ? { ...r, jpyAmount: 40.271 * 2300 + 4 * 26000 + 40.271 * 200 } : r));
      fs.writeFileSync(path.join(OUT, `kato-${orderNo}-${tag}.html`), renderSingleInvoiceHtml(h, b.rows, { seal }));
      fs.writeFileSync(path.join(OUT, `kato-${orderNo}-${tag}.json`), JSON.stringify({ header: { ...b.header }, rows: b.rows }));
      const t = singleTotals(b.rows, h.taxRate, h.fxRate, 2);
      const L = t.lines;
      const g = b.rows.find((r) => r.kind === 'goods')!;
      const gi = b.rows.indexOf(g);
      const ji = b.rows.findIndex((r) => r.kind === 'jpy' && r.taxable);
      const ni = b.rows.findIndex((r) => r.kind === 'jpy' && !r.taxable);
      const ui = b.rows.findIndex((r) => r.kind === 'usd');
      const y = (v: number | null | undefined) => (v === null || v === undefined ? '—' : money(v, 0));
      const aims: Record<string, string> = {
        no: `${h.invoiceNo} (Finalize: next YYYYMM_NN)`,
        issue: slash(h.issueDate),
        subject: h.subject.replace(/[\s　]+/g, ' '),
        terms: h.paymentTerms,
        total: money(t.usd.total),
        qty: g.quantity === null ? '— (empty)' : money(g.quantity, 3),
        unit: money(L[gi].unitUsd),
        amt: money(L[gi].amountUsd),
        unitJpy: y(L[gi].unitJpy),
        amtJpy: y(L[gi].amountJpy),
        remarks: g.remarks.split('\n').join(' / '),
        customsUsd: money(L[ji].amountUsd),
        customsJpy: y(L[ji].amountJpy),
        flatUsd: money(L[ni].amountUsd),
        flatJpy: y(L[ni].amountJpy),
        otherUsd: money(L[ui].amountUsd),
        otherUnitJpy: y(L[ui].unitJpy),
        otherJpy: y(L[ui].amountJpy),
        nonTax: `${money(t.usd.nonTaxable)} / ${y(t.jpy?.nonTaxable)}`,
        taxable: `${money(t.usd.taxable)} / ${y(t.jpy?.taxable)}`,
        tax: `${money(t.usd.tax)} / ${y(t.jpy?.tax)}`,
        sum: `${money(t.usd.total)} / ${y(t.jpy?.total)}`,
        bdJpy: t.jpy ? `¥${y(t.jpy.taxable)} ¥${y(t.jpy.tax)} ¥${y(t.jpy.taxable + t.jpy.tax)}` : '—',
        bdUsd: `USD ${money(t.usd.taxable)} USD ${money(t.usd.tax)} USD ${money(t.usd.taxable + t.usd.tax)}`,
        fx: `${h.fxRate?.toFixed(2) ?? '—'} ${h.fxNote}`,
        due: slash(h.dueDate),
        bank: `${(h.bankBlock ?? '').split('\n')[0]} …${(/Account No:?\s*(\d+)/.exec(h.bankBlock ?? '')?.[1] ?? '').slice(-4)}`,
      };
      md.push(`\n### #${orderNo} ${tag}\n| field | ADH PDF | AIMS | |\n|---|---|---|---|`);
      for (const k of Object.keys(PDF[orderNo])) {
        const a = aims[k] ?? '';
        const same = a.replace(/\s+/g, ' ').trim() === PDF[orderNo][k].replace(/\s+/g, ' ').trim() || (k === 'no' && a.startsWith(PDF[orderNo][k]));
        md.push(`| ${k} | ${PDF[orderNo][k]} | ${a} | ${same ? '=' : '≠'} |`);
      }
    }
  }
  fs.writeFileSync(path.join(OUT, 'side-by-side.md'), md.join('\n'));
  console.log(md.join('\n'));
  await p.$disconnect();
}
main().catch((e) => {
  console.error(String(e?.stack ?? e).slice(0, 800));
  process.exit(1);
});
