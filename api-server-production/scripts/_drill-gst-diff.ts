/** Doc-by-doc GST drill-down: for the period, compare each document's
 *  (net, tax, side) as Xero computes it (mapped lines) vs as the AIMS report
 *  computes it (doc-level taxCode). Lists the top discrepancies. */
import { createScriptPrisma, BIOFUEL_ORG_ID, getXeroTokens, xeroGet } from './xero-migration/_common';

const prisma = createScriptPrisma();
const R = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const arg = (n: string, d: string) => (process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=')[1] || d);
const FROM = new Date(arg('from', '2026-04-01') + 'T00:00:00.000Z');
const TO = new Date(arg('to', '2026-06-30') + 'T23:59:59.999Z');

const MAP: Record<string, { code: string; side: 'OUTPUT' | 'INPUT' }> = {
  TAX001: { code: '1', side: 'OUTPUT' }, OUTPUTY24: { code: '1', side: 'OUTPUT' },
  OUTPUTY23: { code: '8', side: 'OUTPUT' }, OUTPUT: { code: '10', side: 'OUTPUT' },
  TAX002: { code: '4', side: 'INPUT' }, INPUTY24: { code: '4', side: 'INPUT' },
  INPUTY23: { code: '9', side: 'INPUT' }, INPUT: { code: '11', side: 'INPUT' },
  ZERORATEDOUTPUT: { code: '2', side: 'OUTPUT' }, ZERORATEDINPUT: { code: '5', side: 'INPUT' },
  EXEMPTOUTPUT: { code: '3', side: 'OUTPUT' }, EXEMPTINPUT: { code: '6', side: 'INPUT' },
  OSOUTPUT: { code: '13', side: 'OUTPUT' }, OPINPUT: { code: '12', side: 'INPUT' },
};
const BOX5 = new Set(['4', '5', '7', '9', '11']);
const BOX1 = new Set(['1', '8', '10']);

type Entry = { net: number; tax: number; codes: string[]; kind: string };

async function main() {
  const tokens = await getXeroTokens(prisma, BIOFUEL_ORG_ID);
  const dt = (d: Date) => `DateTime(${d.getUTCFullYear()},${d.getUTCMonth() + 1},${d.getUTCDate()})`;
  const dateFilter = `Date>=${dt(FROM)}&&Date<=${dt(TO)}`;

  // Xero per-doc mapped sums (in-scope lines only; box-relevant net).
  const xero = new Map<string, Entry>();
  const pull = async (path: string, type: string, listKey: string, numKey: string, negate: boolean) => {
    for (let page = 1; ; page++) {
      const res = await xeroGet<any>(tokens, path, { where: `Type=="${type}"&&${dateFilter}`, page, pageSize: 100 });
      const list: any[] = res[listKey] || [];
      if (!list.length) break;
      for (const doc of list) {
        if (['VOIDED', 'DELETED', 'DRAFT', 'SUBMITTED'].includes(doc.Status || '')) continue;
        const num = (doc.InvoiceNumber || doc.CreditNoteNumber || '').trim() || doc.InvoiceID || doc.CreditNoteID;
        let net = 0, tax = 0;
        const codes = new Set<string>();
        for (const li of doc.LineItems || []) {
          const m = MAP[li.TaxType as string];
          if (!m) continue;
          if (!BOX5.has(m.code) && !BOX1.has(m.code) && m.code !== '2' && m.code !== '3') continue; // out-of-scope codes not in boxes
          const s = (m.side === 'OUTPUT' ? -1 : 1) * (negate ? -1 : 1);
          net = R(net + (Number(li.LineAmount) || 0) * s);
          tax = R(tax + (Number(li.TaxAmount) || 0) * s);
          codes.add(m.code);
        }
        if (net !== 0 || tax !== 0) xero.set(num, { net, tax, codes: [...codes], kind: type });
      }
      if (list.length < 100) break;
    }
  };
  await pull('/Invoices', 'ACCREC', 'Invoices', 'InvoiceNumber', false);
  await pull('/Invoices', 'ACCPAY', 'Invoices', 'InvoiceNumber', false);
  await pull('/CreditNotes', 'ACCRECCREDIT', 'CreditNotes', 'CreditNoteNumber', true);
  await pull('/CreditNotes', 'ACCPAYCREDIT', 'CreditNotes', 'CreditNoteNumber', true);

  // AIMS per-doc report rows (same logic as gstReport, box-relevant codes only).
  const docs = await prisma.document.findMany({
    where: { organizationId: BIOFUEL_ORG_ID, type: { in: ['INVOICE', 'TI', 'TI2', 'BILL', 'CREDIT_NOTE', 'DEBIT_NOTE', 'PURCHASE_RETURN'] } },
    select: { name: true, type: true, status: true, createdAt: true, config: true },
  });
  const taxRates = await prisma.taxRate.findMany({ where: { organizationId: BIOFUEL_ORG_ID } });
  const rateByCode = new Map(taxRates.map((t: any) => [t.code, t]));
  const aims = new Map<string, Entry>();
  for (const doc of docs) {
    const c: any = doc.config || {};
    if (c.voided) continue;
    const status = (doc.status || '').toLowerCase();
    if (status === 'draft' || status === 'cancelled') continue;
    const di: any = c.documentInfo || {};
    const date = c.date ? new Date(c.date) : c.billDate ? new Date(c.billDate) : doc.createdAt;
    if (date < FROM || date > TO) continue;
    // LINE-LEVEL path first (mirror patched report)
    const items: any[] = Array.isArray(c.items) ? c.items : [];
    const typed = items.filter((it) => it?.taxType && MAP[String(it.taxType)]);
    if (typed.length) {
      let net = 0, tax = 0;
      const codes = new Set<string>();
      for (const it of typed) {
        const m = MAP[String(it.taxType)];
        if (!BOX5.has(m.code) && !BOX1.has(m.code) && m.code !== '2' && m.code !== '3') continue;
        const s2 = (m.side === 'OUTPUT' ? -1 : 1) * (doc.type === 'CREDIT_NOTE' ? -1 : 1);
        net = R(net + (Number(it.amount) || 0) * s2);
        tax = R(tax + (Number(it.taxAmount) || 0) * s2);
        codes.add(m.code);
      }
      if (net !== 0 || tax !== 0) {
        const key = (doc.name || '').trim();
        const prev = aims.get(key);
        aims.set(key, { net: R((prev?.net || 0) + net), tax: R((prev?.tax || 0) + tax), codes: [...codes], kind: doc.type });
      }
      continue;
    }
    const code = di.taxCode != null && di.taxCode !== '' ? String(di.taxCode) : null;
    if (!code) continue;
    if (!BOX5.has(code) && !BOX1.has(code) && code !== '2' && code !== '3') continue;
    const tr: any = rateByCode.get(code);
    const tax = R(Number(di.gstAmount ?? c.taxAmount ?? c.xeroTax ?? 0) || 0);
    let net = Number(di.subTotal ?? c.subtotal ?? c.subTotal ?? NaN);
    if (!Number.isFinite(net)) {
      const gross = Number(c.xeroGross ?? di.nettTotal ?? c.nettTotal ?? c.totalAmount ?? 0) || 0;
      net = R(gross - tax);
    } else net = R(net);
    const side: 'OUTPUT' | 'INPUT' = (tr?.direction as any) || (doc.type === 'BILL' || doc.type === 'PURCHASE_RETURN' ? 'INPUT' : 'OUTPUT');
    let sign: number;
    if (side === 'OUTPUT') sign = doc.type === 'CREDIT_NOTE' ? 1 : -1;
    else sign = doc.type === 'CREDIT_NOTE' || doc.type === 'PURCHASE_RETURN' ? -1 : 1;
    const key = (doc.name || '').trim();
    const prev = aims.get(key);
    const e: Entry = { net: R((prev?.net || 0) + net * sign), tax: R((prev?.tax || 0) + tax * sign), codes: [code], kind: doc.type };
    aims.set(key, e);
  }

  // Diff.
  const keys = new Set([...xero.keys(), ...aims.keys()]);
  const diffs: { num: string; dNet: number; dTax: number; x?: Entry; a?: Entry }[] = [];
  for (const k of keys) {
    const x = xero.get(k), a = aims.get(k);
    const dNet = R((x?.net || 0) - (a?.net || 0));
    const dTax = R((x?.tax || 0) - (a?.tax || 0));
    if (Math.abs(dNet) > 0.05 || Math.abs(dTax) > 0.05) diffs.push({ num: k, dNet, dTax, x, a });
  }
  diffs.sort((p, q) => Math.abs(q.dNet) - Math.abs(p.dNet));
  console.log(`docs compared: xero=${xero.size} aims=${aims.size}; discrepancies=${diffs.length}`);
  console.log(`total ΔNet=${R(diffs.reduce((s, d) => s + d.dNet, 0))} ΔTax=${R(diffs.reduce((s, d) => s + d.dTax, 0))}\n`);
  for (const d of diffs.slice(0, 25)) {
    console.log(
      `${d.num.padEnd(26)} ΔNet=${d.dNet.toFixed(2).padStart(12)} ΔTax=${d.dTax.toFixed(2).padStart(10)}  ` +
      `xero=${d.x ? `${d.x.kind}[${d.x.codes}] net ${d.x.net} tax ${d.x.tax}` : 'ABSENT'}  ` +
      `aims=${d.a ? `${d.a.kind}[${d.a.codes}] net ${d.a.net} tax ${d.a.tax}` : 'ABSENT'}`,
    );
  }
}
main().catch((e) => { console.error('FATAL', e?.message || e); process.exit(2); }).finally(() => prisma.$disconnect());
