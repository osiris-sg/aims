/**
 * verify-gst-vs-xero.ts — check the AIMS GST report (F5 boxes) against Xero.
 *
 * AIMS side: replicates xero-reports.service gstReport doc-level logic
 * (documentInfo.taxCode, skip voided/draft/cancelled, sign rules, F5 sums).
 * Xero side: pulls invoices/bills/credit-notes for the period from the Xero
 * API and aggregates LINE-BY-LINE by TaxType using the same era mapping the
 * tax-code backfill used. Line-level is Xero's own truth (its GST return is
 * computed from lines), so this catches doc-level coding errors too.
 *
 * Usage: npx ts-node --transpile-only scripts/verify-gst-vs-xero.ts --from=2026-04-01 --to=2026-06-30
 */
import { createScriptPrisma, BIOFUEL_ORG_ID, getXeroTokens, xeroGet } from './xero-migration/_common';

const prisma = createScriptPrisma();
const R = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const arg = (n: string, d: string) => (process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=')[1] || d);
const FROM = new Date(arg('from', '2026-04-01') + 'T00:00:00.000Z');
const TO = new Date(arg('to', '2026-06-30') + 'T23:59:59.999Z');

// Same mapping as scripts/backfill-tax-codes.ts (era-specific SG codes).
const MAP: Record<string, { code: string; side: 'OUTPUT' | 'INPUT' }> = {
  TAX001: { code: '1', side: 'OUTPUT' }, OUTPUTY24: { code: '1', side: 'OUTPUT' },
  OUTPUTY23: { code: '8', side: 'OUTPUT' }, OUTPUT: { code: '10', side: 'OUTPUT' },
  TAX002: { code: '4', side: 'INPUT' }, INPUTY24: { code: '4', side: 'INPUT' },
  INPUTY23: { code: '9', side: 'INPUT' }, INPUT: { code: '11', side: 'INPUT' },
  ZERORATEDOUTPUT: { code: '2', side: 'OUTPUT' }, ZERORATEDINPUT: { code: '5', side: 'INPUT' },
  EXEMPTOUTPUT: { code: '3', side: 'OUTPUT' }, EXEMPTINPUT: { code: '6', side: 'INPUT' },
  OSOUTPUT: { code: '13', side: 'OUTPUT' }, OPINPUT: { code: '12', side: 'INPUT' },
};

type Buckets = { netByCode: Map<string, number>; taxByCode: Map<string, number>; outputTax: number; inputTax: number };
const newBuckets = (): Buckets => ({ netByCode: new Map(), taxByCode: new Map(), outputTax: 0, inputTax: 0 });
const add = (b: Buckets, code: string, side: 'OUTPUT' | 'INPUT', net: number, tax: number) => {
  b.netByCode.set(code, R((b.netByCode.get(code) || 0) + net));
  b.taxByCode.set(code, R((b.taxByCode.get(code) || 0) + tax));
  if (side === 'OUTPUT') b.outputTax = R(b.outputTax + tax);
  else b.inputTax = R(b.inputTax + tax);
};

function xd(s?: string): Date | null {
  if (!s) return null;
  const m = s.match(/\((\d+)/);
  return m ? new Date(+m[1]) : new Date(s);
}

// ---------- Xero side (line-level truth) ----------
async function xeroSide(tokens: any): Promise<Buckets> {
  const b = newBuckets();
  const dt = (d: Date) => `DateTime(${d.getUTCFullYear()},${d.getUTCMonth() + 1},${d.getUTCDate()})`;
  const dateFilter = `Date>=${dt(FROM)}&&Date<=${dt(TO)}`;

  const pullInvoices = async (type: 'ACCREC' | 'ACCPAY') => {
    for (let page = 1; ; page++) {
      const res = await xeroGet<any>(tokens, '/Invoices', { where: `Type=="${type}"&&${dateFilter}`, page, pageSize: 100 });
      const invs: any[] = res.Invoices || [];
      if (!invs.length) break;
      for (const inv of invs) {
        if (['VOIDED', 'DELETED', 'DRAFT', 'SUBMITTED'].includes(inv.Status)) continue;
        for (const li of inv.LineItems || []) {
          const m = MAP[li.TaxType as string];
          if (!m) continue; // NONE / unmapped = out of scope (matches report)
          // Ledger sign convention from the report: output normal = −, input normal = +.
          const sign = m.side === 'OUTPUT' ? -1 : 1;
          add(b, m.code, m.side, R((Number(li.LineAmount) || 0) * sign), R((Number(li.TaxAmount) || 0) * sign));
        }
      }
      if (invs.length < 100) break;
    }
  };
  const pullCNs = async (type: 'ACCRECCREDIT' | 'ACCPAYCREDIT') => {
    for (let page = 1; ; page++) {
      const res = await xeroGet<any>(tokens, '/CreditNotes', { where: `Type=="${type}"&&${dateFilter}`, page, pageSize: 100 });
      const notes: any[] = res.CreditNotes || [];
      if (!notes.length) break;
      for (const cn of notes) {
        if (['VOIDED', 'DELETED', 'DRAFT', 'SUBMITTED'].includes(cn.Status || '')) continue;
        for (const li of cn.LineItems || []) {
          const m = MAP[li.TaxType as string];
          if (!m) continue;
          // Credit notes reverse their side's normal sign.
          const sign = m.side === 'OUTPUT' ? 1 : -1;
          add(b, m.code, m.side, R((Number(li.LineAmount) || 0) * sign), R((Number(li.TaxAmount) || 0) * sign));
        }
      }
      if (notes.length < 100) break;
    }
  };
  await pullInvoices('ACCREC');
  await pullInvoices('ACCPAY');
  await pullCNs('ACCRECCREDIT');
  await pullCNs('ACCPAYCREDIT');
  return b;
}

// ---------- AIMS side (doc-level, replicating xero-reports.service) ----------
async function aimsSide(): Promise<Buckets> {
  const b = newBuckets();
  const [docs, taxRates] = await Promise.all([
    prisma.document.findMany({
      where: { organizationId: BIOFUEL_ORG_ID, type: { in: ['INVOICE', 'TI', 'TI2', 'BILL', 'CREDIT_NOTE', 'DEBIT_NOTE', 'PURCHASE_RETURN'] } },
      select: { type: true, status: true, createdAt: true, config: true },
    }),
    prisma.taxRate.findMany({ where: { organizationId: BIOFUEL_ORG_ID } }),
  ]);
  const rateByCode = new Map(taxRates.map((t: any) => [t.code, t]));
  for (const doc of docs) {
    const c: any = doc.config || {};
    if (c.voided) continue;
    const status = (doc.status || '').toLowerCase();
    if (status === 'draft' || status === 'cancelled') continue;
    const di: any = c.documentInfo || {};
    const date = c.date ? new Date(c.date) : c.billDate ? new Date(c.billDate) : doc.createdAt;
    if (date < FROM || date > TO) continue;
    const signFor = (side: 'OUTPUT' | 'INPUT'): number => {
      if (side === 'OUTPUT') return doc.type === 'CREDIT_NOTE' ? 1 : -1;
      return doc.type === 'CREDIT_NOTE' || doc.type === 'PURCHASE_RETURN' ? -1 : 1;
    };
    // LINE-LEVEL path (mirrors the patched xero-reports.service gstReport).
    const items: any[] = Array.isArray(c.items) ? c.items : [];
    const typedItems = items.filter((it) => it?.taxType && MAP[String(it.taxType)]);
    if (typedItems.length) {
      for (const it of typedItems) {
        const m = MAP[String(it.taxType)];
        const sign = signFor(m.side);
        add(b, m.code, m.side, R((Number(it.amount) || 0) * sign), R((Number(it.taxAmount) || 0) * sign));
      }
      continue;
    }
    // DOC-LEVEL fallback.
    const code = di.taxCode != null && di.taxCode !== '' ? String(di.taxCode) : null;
    if (!code) continue;
    const tr: any = rateByCode.get(code);
    const tax = R(Number(di.gstAmount ?? c.taxAmount ?? c.xeroTax ?? 0) || 0);
    let net = Number(di.subTotal ?? c.subtotal ?? c.subTotal ?? NaN);
    if (!Number.isFinite(net)) {
      const gross = Number(c.xeroGross ?? di.nettTotal ?? c.nettTotal ?? c.totalAmount ?? 0) || 0;
      net = R(gross - tax);
    } else net = R(net);
    const side: 'OUTPUT' | 'INPUT' = (tr?.direction as any) || (doc.type === 'BILL' || doc.type === 'PURCHASE_RETURN' ? 'INPUT' : 'OUTPUT');
    const sign = signFor(side);
    add(b, code, side, R(net * sign), R(tax * sign));
  }
  return b;
}

function f5(b: Buckets) {
  const g = (codes: string[], m: Map<string, number>) => R(codes.reduce((s, c) => s + (m.get(c) || 0), 0));
  return {
    box1_stdSupplies: R(-g(['1', '8', '10'], b.netByCode)),
    box2_zeroRated: R(-g(['2'], b.netByCode)),
    box3_exempt: R(-g(['3'], b.netByCode)),
    box5_taxablePurchases: g(['4', '5', '7', '9', '11'], b.netByCode),
    box6_outputTax: R(-b.outputTax),
    box7_inputTax: b.inputTax,
  };
}

async function main() {
  console.log(`GST verification — Biofuel — period ${FROM.toISOString().slice(0, 10)} → ${TO.toISOString().slice(0, 10)}\n`);
  const tokens = await getXeroTokens(prisma, BIOFUEL_ORG_ID);
  const [xero, aims] = [await xeroSide(tokens), await aimsSide()];
  const fx = f5(xero), fa = f5(aims);

  console.log('F5 box                     Xero (lines)      AIMS (report)        Δ');
  console.log('-'.repeat(72));
  let drift = false;
  for (const k of Object.keys(fx) as (keyof ReturnType<typeof f5>)[]) {
    const d = R((fx[k] as number) - (fa[k] as number));
    if (Math.abs(d) > 0.05) drift = true;
    console.log(
      k.padEnd(24) +
      (fx[k] as number).toFixed(2).padStart(15) +
      (fa[k] as number).toFixed(2).padStart(18) +
      d.toFixed(2).padStart(12) +
      (Math.abs(d) > 0.05 ? '  ✗' : '  ✓'),
    );
  }
  console.log('\nPer-code tax totals (Xero vs AIMS):');
  const codes = [...new Set([...xero.taxByCode.keys(), ...aims.taxByCode.keys()])].sort((a, b) => +a - +b);
  for (const c of codes) {
    const x = xero.taxByCode.get(c) || 0, a = aims.taxByCode.get(c) || 0;
    console.log(`  code ${c.padEnd(3)} tax: xero=${x.toFixed(2).padStart(12)}  aims=${a.toFixed(2).padStart(12)}  Δ=${R(x - a).toFixed(2)}${Math.abs(x - a) > 0.05 ? ' ✗ (doc-level vs line-level coding?)' : ' ✓'}`);
  }
  console.log(drift ? '\n✗ F5 DRIFT — see boxes above.' : '\n✓ F5 BOXES MATCH XERO.');
  process.exit(drift ? 1 : 0);
}

main().catch((e) => { console.error('FATAL', e?.message || e); process.exit(2); }).finally(() => prisma.$disconnect());
