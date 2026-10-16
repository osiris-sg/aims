/**
 * Make AIMS mirror Xero for every linked document (guru, 2026-10-15:
 * "take all xero data override aims" — Xero is the correct one).
 *
 * For each AIMS document that carries a Xero id, overwrite from Xero:
 *   line items (description, qty, unit price, amount, ACCOUNT CODE, tax),
 *   subtotal, GST, gross, outstanding balance, amount paid, status, reference.
 *
 * Xero's paged list returns LineItems, so the whole ledger is read in ~70 calls
 * instead of one GET per document (which trips the 60-per-minute limit).
 *
 * NOT touched:
 *   - documents with no Xero id (held back from the push, or AIMS-only)
 *   - AIMS-only keys inside config (the spread keeps everything else)
 *
 * Balances are written to the CANONICAL keys AND their legacy twins, per
 * src/common/document-money.ts — never one without the other.
 *
 *   npx ts-node --transpile-only scripts/mirror-xero-to-aims.ts [--apply] [--type=ACCREC|ACCPAY|CN]
 *
 * Dry-run by default; prints what each change would be.
 */
import { createScriptPrisma, getXeroTokens, BIOFUEL_ORG_ID as ORG, withDbRetry } from './xero-migration/_common';
const prisma = createScriptPrisma();
const APPLY = process.argv.includes('--apply');
const ONLY_TYPE = process.argv.find((a) => a.startsWith('--type='))?.split('=')[1];
const R = (n: any) => Math.round((Number(n) || 0) * 100) / 100;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function pageAll(H: any, path: string, key: string) {
  const out: any[] = [];
  for (let page = 1; page <= 80; page++) {
    const sep = path.includes('?') ? '&' : '?';
    const r = await fetch(`https://api.xero.com/api.xro/2.0/${path}${sep}page=${page}`, { headers: H });
    if (r.status === 429) {
      const w = parseInt(r.headers.get('Retry-After') || '60', 10);
      if (w > 600) throw new Error(`DAILY_CAP: wait ${w}s`);
      console.log(`  ⏸ rate limit, ${w}s`);
      await sleep((w + 1) * 1000);
      page--;
      continue;
    }
    const j: any = await r.json();
    const rows = j[key] || [];
    out.push(...rows);
    if (rows.length < 100) break;
  }
  return out;
}

// Xero lines carry only description/qty/unit price/amount/account code/tax.
// Returning them as-is REPLACED the AIMS line and silently dropped itemCode,
// inventoryItemId, uom, isService, the line id and the rest on 3,776 documents
// (2026-10-15 — recovered from a Neon point-in-time branch). Xero's figures are
// authoritative, but the AIMS-only fields must be carried over, matched by
// lineNumber, or the link from a document to the asset it bills is destroyed.
const AIMS_LINE_KEYS = [
  'itemCode', 'inventoryItemId', 'assetId', 'uom', 'isService', 'isFixedAsset',
  'id', 'skuKey', 'sku', 'revenueTag', 'rateMerge', 'isGroupHeader',
  'serialNumbers', 'deliveryItemId', 'deliveryGroup', 'salePrice',
];
const linesFrom = (src: any[], existing: any[] = []) => {
  const byLine = new Map<number, any>();
  (existing || []).forEach((it: any, i: number) => byLine.set(Number(it.lineNumber ?? i + 1), it));
  return (src || []).map((li: any, i: number) => {
    const keep: any = {};
    const prev = byLine.get(i + 1);
    if (prev) for (const k of AIMS_LINE_KEYS) if (prev[k] !== undefined) keep[k] = prev[k];
    return {
      ...keep,
      lineNumber: i + 1,
      description: li.Description || '',
      quantity: li.Quantity ?? null,
      unitPrice: li.UnitAmount ?? null,
      amount: R(li.LineAmount),
      accountCode: li.AccountCode || '',
      taxType: li.TaxType || '',
      taxAmount: R(li.TaxAmount),
      discount: li.DiscountRate ?? 0,
    };
  });
};

(async () => {
  console.log(`Mirror Xero → AIMS   ${APPLY ? '*** APPLY ***' : 'DRY RUN'}\n`);
  const tk: any = await getXeroTokens(prisma, ORG);
  const H = { Authorization: `Bearer ${tk.accessToken}`, 'Xero-Tenant-Id': tk.tenantId, Accept: 'application/json' };

  const want = (t: string) => !ONLY_TYPE || ONLY_TYPE === t;
  const xero = new Map<string, any>();
  if (want('ACCREC')) {
    const rows = await pageAll(H, `Invoices?where=${encodeURIComponent('Type=="ACCREC"')}`, 'Invoices');
    rows.forEach((i) => xero.set(i.InvoiceID, i));
    console.log(`  ACCREC invoices read: ${rows.length}`);
  }
  if (want('ACCPAY')) {
    const rows = await pageAll(H, `Invoices?where=${encodeURIComponent('Type=="ACCPAY"')}`, 'Invoices');
    rows.forEach((i) => xero.set(i.InvoiceID, i));
    console.log(`  ACCPAY bills read:    ${rows.length}`);
  }
  if (want('CN')) {
    const rows = await pageAll(H, 'CreditNotes', 'CreditNotes');
    rows.forEach((c) => xero.set(c.CreditNoteID, c));
    console.log(`  credit notes read:    ${rows.length}`);
  }

  const docs = await prisma.document.findMany({
    where: { organizationId: ORG, type: { in: ['INVOICE', 'TI', 'TI2', 'BILL', 'CREDIT_NOTE'] } },
    select: { id: true, name: true, type: true, status: true, config: true },
    orderBy: { name: 'asc' },
  });

  let changed = 0, same = 0, noLink = 0, dangling = 0, lineRewrites = 0, codeChanges = 0;
  const samples: string[] = [];

  for (const d of docs) {
    const c: any = d.config || {};
    const xid = c.xeroInvoiceId || c.xeroBillId || c.xeroCreditNoteId;
    if (!xid) { noLink++; continue; }
    const x = xero.get(xid);
    if (!x) { dangling++; continue; }

    const isCn = !!x.CreditNoteID;
    const total = R(x.Total);
    const due = R(isCn ? (x.RemainingCredit ?? 0) : x.AmountDue);
    // "Paid" must mean EVERYTHING that reduced the balance, not just cash.
    // Xero's AmountPaid counts cash only, so a bill settled partly by a credit
    // note (e.g. M011348/26: total 196,200, AmountPaid 70,200, AmountDue 0)
    // leaves total - AmountPaid = 126,000 of phantom debt in any reader using
    // that formula. AmountDue is authoritative, so derive paid from it and
    // total - paid always equals the real outstanding.
    const paid = R(total - due);
    const isVoid = x.Status === 'VOIDED' || x.Status === 'DELETED';
    const isDraft = x.Status === 'DRAFT' || x.Status === 'SUBMITTED';
    const newStatus = isVoid || isDraft ? 'draft' : due <= 0.005 ? 'paid' : 'pending_payment';

    const items = x.LineItems?.length ? linesFrom(x.LineItems, c.items) : c.items;
    const oldCodes = (c.items || []).map((i: any) => i.accountCode || '').join(',');
    const newCodes = (items || []).map((i: any) => i.accountCode || '').join(',');

    const before = {
      total: R(c.totalWithTax ?? c.nettTotal ?? 0),
      due: R(c.outstandingBalance ?? c.xeroBalance ?? 0),
      status: d.status,
      codes: oldCodes,
    };
    const after = { total, due, status: newStatus, codes: newCodes };
    const differs =
      Math.abs(before.total - after.total) > 0.005 ||
      Math.abs(before.due - after.due) > 0.005 ||
      before.status !== after.status ||
      before.codes !== after.codes;

    if (!differs) { same++; continue; }
    changed++;
    if (before.codes !== after.codes) codeChanges++;
    if (x.LineItems?.length) lineRewrites++;
    if (samples.length < 20) {
      samples.push(
        `  ${String(d.name).padEnd(28)} total ${before.total.toFixed(2)}→${after.total.toFixed(2)}  due ${before.due.toFixed(2)}→${after.due.toFixed(2)}  ${before.status}→${after.status}` +
          (before.codes !== after.codes ? `\n      codes [${before.codes || '—'}] → [${after.codes || '—'}]` : ''),
      );
    }
    if (!APPLY) continue;

    const ref = (x.Reference || '').trim();
    const config = {
      ...c,
      items,
      subTotal: R(x.SubTotal ?? c.subTotal),
      gstAmount: R(x.TotalTax ?? c.gstAmount),
      grossTotal: R(x.SubTotal ?? c.grossTotal),
      nettTotal: total,
      totalWithTax: total,
      xeroGross: total,
      outstandingBalance: due,
      xeroBalance: due,
      paidToDate: paid,
      amountPaid: paid,
      xeroAmountPaid: paid,
      xeroCashPaid: R(isCn ? 0 : x.AmountPaid), // Xero's cash-only figure, for reference
      voided: isVoid,
      paymentStatus: newStatus,
      paymentStatusSource: 'mirror-xero-2026-10-15',
      xeroStatus: x.Status,
      ...(ref ? { referenceNo: ref } : {}),
      xeroLastSyncAt: new Date().toISOString(),
    };
    await withDbRetry(
      () => prisma.document.update({ where: { id: d.id }, data: { status: newStatus as any, config: config as any } }),
      `mirror ${d.name}`,
    );
  }

  console.log(samples.join('\n'));
  console.log(`\n  ${APPLY ? 'updated' : 'would update'} ${changed}   already matching ${same}   no Xero link ${noLink}   link points at nothing ${dangling}`);
  console.log(`  of those: ${lineRewrites} had their lines rebuilt from Xero, ${codeChanges} had account codes change`);
  if (!APPLY) console.log('\n  DRY RUN — re-run with --apply.');
})()
  .catch((e) => { console.error('❌', e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
