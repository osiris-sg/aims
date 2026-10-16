/**
 * Re-link AIMS invoices to the RIGHT Xero invoice (guru, 2026-10-15).
 *
 * 72 invoices — 71 of them the August 2026 batch — carried a config.xeroInvoiceId
 * pointing at the NEXT Xero invoice in sequence (AIMS BI202608022 → Xero
 * BI202608023, and drifting further along the run). The AR true-up then copied
 * the wrong invoice's AmountDue onto them, so 71 customer balances in AIMS were
 * wrong while the aggregate AR total still looked nearly right — the errors
 * cancel out across the batch, which is why only a per-invoice comparison
 * caught it.
 *
 * The INVOICE NUMBER is authoritative: relink each document to the Xero invoice
 * whose InvoiceNumber equals the document name, then re-stamp its balances.
 * Documents whose name matches no Xero invoice (duplicates carrying a " (abcd)"
 * suffix) are left untouched and reported.
 *
 *   npx ts-node --transpile-only scripts/fix-crossed-xero-links.ts [--apply]
 */
import { createScriptPrisma, getXeroTokens, BIOFUEL_ORG_ID as ORG, withDbRetry } from './xero-migration/_common';
const prisma = createScriptPrisma();
const APPLY = process.argv.includes('--apply');
const R = (n: any) => Math.round((Number(n) || 0) * 100) / 100;

(async () => {
  console.log(`Re-link crossed Xero invoice ids   ${APPLY ? '*** APPLY ***' : 'DRY RUN'}\n`);
  const tk: any = await getXeroTokens(prisma, ORG);
  const H = { Authorization: `Bearer ${tk.accessToken}`, 'Xero-Tenant-Id': tk.tenantId, Accept: 'application/json' };

  const byId = new Map<string, any>();
  // A number can appear TWICE in Xero (that is why AIMS holds documents named
  // "BI202608018 (dc00)" — the suffix is the first 8 chars of the Xero id).
  // Keep every match so an ambiguous number is reported, never guessed at.
  const byNum = new Map<string, any[]>();
  for (let page = 1; page <= 60; page++) {
    const r = await fetch(`https://api.xero.com/api.xro/2.0/Invoices?where=${encodeURIComponent('Type=="ACCREC"')}&page=${page}`, { headers: H });
    if (r.status === 429) { console.log('  rate limited, pausing 60s'); await new Promise((s) => setTimeout(s, 61000)); page--; continue; }
    const j: any = await r.json();
    const rows = j.Invoices || [];
    for (const i of rows) {
      byId.set(i.InvoiceID, i);
      const n = (i.InvoiceNumber || '').trim();
      if (n) byNum.set(n, [...(byNum.get(n) || []), i]);
    }
    if (rows.length < 100) break;
  }
  console.log(`Xero ACCREC indexed: ${byId.size}\n`);

  const docs = await prisma.document.findMany({
    where: { organizationId: ORG, type: { in: ['INVOICE', 'TI', 'TI2'] } },
    select: { id: true, name: true, status: true, config: true },
    orderBy: { name: 'asc' },
  });

  // The crossing is a SHIFTED CHAIN: BI202608078 holds BI202608081's id,
  // 079 holds 082's, and so on down the run. Every correct target is occupied
  // by a neighbour, so fixing one at a time is impossible — each would collide.
  // Plan the whole permutation first, clear every link in the affected set,
  // then assign each document its own invoice.
  const heldBy = new Map<string, string>();
  for (const d of docs) {
    const id = (d.config as any)?.xeroInvoiceId;
    if (id) heldBy.set(id, d.name || '');
  }

  type Plan = { doc: any; right: any; from: string };
  const plan: Plan[] = [];
  let unmatched = 0;
  for (const d of docs) {
    const c: any = d.config || {};
    const id = c.xeroInvoiceId;
    if (!id) continue;
    const linked = byId.get(id);
    const name = (d.name || '').trim();
    if (!linked || (linked.InvoiceNumber || '').trim() === name) continue;
    const cands = byNum.get(name) || [];
    if (cands.length !== 1) {
      unmatched++;
      const why = cands.length === 0 ? 'no Xero invoice carries this name' : `${cands.length} Xero invoices share this number — ambiguous`;
      console.log(`  ? ${name.padEnd(22)} linked to "${(linked.InvoiceNumber || '').trim()}" but ${why} — left alone`);
      continue;
    }
    plan.push({ doc: d, right: cands[0], from: (linked.InvoiceNumber || '').trim() });
  }

  // A target held by a document OUTSIDE this set is a genuine duplicate, not
  // part of the shift — clearing the set would not free it, so leave it.
  const inSet = new Set(plan.map((p) => (p.doc.name || '').trim()));
  const blocked = plan.filter((p) => {
    const holder = heldBy.get(p.right.InvoiceID);
    return holder && holder !== (p.doc.name || '').trim() && !inSet.has(holder);
  });
  const doable = plan.filter((p) => !blocked.includes(p));
  for (const b of blocked) {
    console.log(`  ! ${String(b.doc.name).padEnd(22)} target is held by "${heldBy.get(b.right.InvoiceID)}" (outside the shifted run) — duplicate needs resolving`);
  }
  for (const p of doable) {
    console.log(`  ✔ ${String(p.doc.name).padEnd(22)} was → "${p.from}" (${R(byId.get((p.doc.config as any).xeroInvoiceId).AmountDue).toFixed(2)})   now → "${(p.right.InvoiceNumber || '').trim()}" (${R(p.right.AmountDue).toFixed(2)})`);
  }

  let fixed = 0;
  if (APPLY && doable.length) {
    // Phase 1 — break the chain so no target is occupied.
    for (const p of doable) {
      const c: any = p.doc.config || {};
      const { xeroInvoiceId: _drop, ...rest } = c;
      await withDbRetry(() => prisma.document.update({ where: { id: p.doc.id }, data: { config: rest as any } }), `clear ${p.doc.name}`);
    }
    console.log(`\n  cleared ${doable.length} links`);

    // Phase 2 — assign each document its own Xero invoice, taking Xero's
    // figures and account codes as authoritative (guru 2026-10-15).
    for (const p of doable) {
      const right = p.right;
      const c: any = p.doc.config || {};
      const due = R(right.AmountDue), paid = R(right.AmountPaid), total = R(right.Total);
      const isVoid = right.Status === 'VOIDED' || right.Status === 'DELETED';
      const isDraft = right.Status === 'DRAFT' || right.Status === 'SUBMITTED';
      const newStatus = isVoid || isDraft ? 'draft' : due <= 0.005 ? 'paid' : 'pending_payment';

      const full: any = await fetch(`https://api.xero.com/api.xro/2.0/Invoices/${right.InvoiceID}`, { headers: H })
        .then((r) => (r.ok ? r.json() : null)).catch(() => null);
      const xi = full?.Invoices?.[0];
      const xl = xi?.LineItems || [];
      const items = xl.length
        ? xl.map((li: any, i: number) => ({
            lineNumber: i + 1, description: li.Description || '',
            quantity: li.Quantity ?? null, unitPrice: li.UnitAmount ?? null,
            amount: R(li.LineAmount), accountCode: li.AccountCode || '',
            taxType: li.TaxType || '', taxAmount: R(li.TaxAmount),
          }))
        : c.items;

      const config = {
        ...c, items,
        xeroInvoiceId: right.InvoiceID, xeroInvoiceNumber: right.InvoiceNumber, xeroStatus: right.Status,
        subTotal: R(xi?.SubTotal ?? c.subTotal), gstAmount: R(xi?.TotalTax ?? c.gstAmount),
        xeroGross: total, totalWithTax: total, nettTotal: total,
        xeroBalance: due, outstandingBalance: due,
        xeroAmountPaid: paid, paidToDate: paid, amountPaid: paid,
        voided: isVoid, paymentStatus: newStatus,
        paymentStatusSource: 'relink-2026-10-15', xeroLastSyncAt: new Date().toISOString(),
      };
      await withDbRetry(() => prisma.document.update({ where: { id: p.doc.id }, data: { status: newStatus as any, config: config as any } }), `relink ${p.doc.name}`);
      fixed++;
      await new Promise((r) => setTimeout(r, 250));
    }
  } else fixed = doable.length;

  console.log(`\n  ${APPLY ? 'relinked' : 'would relink'} ${fixed}   unmatched ${unmatched}   blocked by a duplicate ${blocked.length}`);
  if (!APPLY) console.log('  DRY RUN — re-run with --apply.');
})().catch((e) => { console.error('❌', e.message); process.exit(1); }).finally(() => prisma.$disconnect());
