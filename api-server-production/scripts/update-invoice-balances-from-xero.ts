/**
 * Pull each Xero ACCREC invoice's real AmountDue/AmountPaid and set the exact
 * balance + paid/unpaid status on the matching AIMS invoice, so AR ties to Xero.
 */
import { Prisma } from '@prisma/client';
import { getXeroTokens, xeroGet, createScriptPrisma, withDbRetry, modifiedSinceArg } from './xero-migration/_common';

// Incremental mode: only pull invoices Xero modified after this. NOTE: the
// phantom reverse-sweep is skipped in this mode — absence from a partial pull
// means nothing. Run without the flag periodically for the full sweep.
const MODIFIED_SINCE = modifiedSinceArg();
const prisma = createScriptPrisma();
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
const R = (n: number) => Math.round(n * 100) / 100;

async function main() {
  const tokens = await getXeroTokens(prisma, ORG);
  // 1) Pull all ACCREC invoice summaries (list endpoint carries AmountDue).
  const all: any[] = [];
  for (let page = 1; ; page++) {
    const res = await xeroGet<any>(tokens, '/Invoices', { page, pageSize: 100, where: 'Type=="ACCREC"' }, { modifiedAfter: MODIFIED_SINCE });
    const invs = res.Invoices || [];
    all.push(...invs);
    process.stdout.write(`\r  pulled ${all.length}...`);
    if (invs.length < 100) break;
  }
  console.log(`\n  total ACCREC invoices from Xero: ${all.length}`);

  // 2) AIMS invoices by name.
  const aims = await prisma.document.findMany({ where: { organizationId: ORG, type: 'INVOICE' }, select: { id: true, name: true, config: true } });
  const byName = new Map(aims.map((d) => [d.name, d]));

  let matched = 0, notInAims = 0, arDue = 0;
  const statusN: Record<string, number> = {};
  for (const inv of all) {
    const number = (inv.InvoiceNumber || '').trim();
    const status = inv.Status;
    const due = Number(inv.AmountDue) || 0;
    const paidAmt = Number(inv.AmountPaid) || 0;
    const total = Number(inv.Total) || 0;
    const isVoid = status === 'VOIDED' || status === 'DELETED';
    if (!isVoid) arDue += due;
    statusN[status] = (statusN[status] || 0) + 1;

    const doc = byName.get(number);
    if (!doc) { notInAims++; continue; }
    // Preserve draft-ness: a DRAFT/SUBMITTED invoice has AmountDue > 0 but is
    // NOT awaiting payment — it isn't approved yet.
    const isDraft = status === 'DRAFT' || status === 'SUBMITTED';
    const newStatus = isVoid || isDraft ? 'draft' : due <= 0.005 ? 'paid' : 'pending_payment';
    const config = { ...((doc.config as any) || {}), xeroInvoiceId: inv.InvoiceID, xeroStatus: status, xeroGross: R(total), xeroBalance: R(due), xeroAmountPaid: R(paidAmt), voided: isVoid, paymentStatus: newStatus, paymentStatusSource: 'xero-api-amountdue', xeroLastSyncAt: new Date().toISOString() };
    await withDbRetry(() => prisma.document.update({ where: { id: doc.id }, data: { status: newStatus as any, config: config as Prisma.InputJsonValue } }), `update ${number}`);
    matched++;
  }
  // Reverse sweep: a Xero-imported AIMS invoice still carrying a balance but
  // ABSENT from the Xero pull was deleted in Xero (deleted invoices drop out
  // of the /Invoices API entirely) — neutralize it or AR drifts forever.
  // Only valid on a FULL pull; with --modified-since the pull is partial.
  const seen = new Set(all.map((i) => (i.InvoiceNumber || '').trim()).filter(Boolean));
  let phantoms = 0;
  for (const d of MODIFIED_SINCE ? [] : aims) {
    const c: any = d.config || {};
    if (!c.xeroImported || c.voided) continue;
    if (Number(c.xeroBalance || 0) <= 0.005) continue;
    if (seen.has((d.name || '').trim())) continue;
    console.log(`  ⚠ phantom: ${d.name} balance ${c.xeroBalance} — no longer in Xero; zeroing + marking voided`);
    await withDbRetry(() => prisma.document.update({
      where: { id: d.id },
      data: { status: 'draft' as any, config: { ...c, voided: true, xeroBalance: 0, paymentStatusSource: 'phantom-not-in-xero' } as Prisma.InputJsonValue },
    }), `phantom ${d.name}`);
    phantoms++;
  }
  if (phantoms) console.log(`  neutralized ${phantoms} phantom invoice(s)`);

  console.log(`\n  updated ${matched} AIMS invoices; ${notInAims} Xero invoices not in AIMS`);
  console.log('  Xero status counts:', statusN);
  console.log(`\n  AR = sum(AmountDue) non-void = ${R(arDue).toFixed(2)}   (Xero TB 610 = 10,988,868.47)`);

  // Cross-check: AR computed from AIMS after update
  const unpaid = await prisma.document.findMany({ where: { organizationId: ORG, type: 'INVOICE', status: 'pending_payment' }, select: { config: true } });
  let aimsAr = 0;
  for (const d of unpaid) aimsAr += Number((d.config as any)?.xeroBalance || 0);
  console.log(`  AIMS AR (sum of pending-invoice balances) = ${R(aimsAr).toFixed(2)}`);
}
main().catch((e) => console.log('ERR', e.message?.slice(0, 200))).finally(() => prisma.$disconnect());
