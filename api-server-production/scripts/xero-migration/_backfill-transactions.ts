/**
 * Backfill the Transaction + CustomerBalance tables from Xero-imported
 * INVOICE Documents. The SOA report (and customer balance widgets) read
 * from these tables — without the backfill, SOA shows empty for Biofuel.
 *
 * For each AR INVOICE doc with xeroImported=true:
 *   - Insert one Transaction row: type=invoice, debit=xeroGross, credit=0
 *   - For paid invoices (xeroStatus=Paid OR xeroBalance===0): insert a
 *     paired payment Transaction: type=payment, debit=0, credit=xeroGross
 *
 * Then for each customer, refresh CustomerBalance = sum of unpaid invoices.
 *
 * Idempotent: wipes existing Xero-sourced Transactions for the org first
 * (recognised by reference starting with our invoice name pattern + lack
 * of paymentId — we mark them by paymentMethod='xero-import').
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const BIOFUEL_ORG_ID = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";

async function main() {
  console.log(`[Backfill TX] org=${BIOFUEL_ORG_ID}`);

  const invoices = await prisma.document.findMany({
    where: { organizationId: BIOFUEL_ORG_ID, type: "INVOICE", config: { path: ["xeroImported"], equals: true } },
    select: { id: true, name: true, createdAt: true, config: true },
  });
  console.log(`[Backfill TX] ${invoices.length} Xero-imported invoices`);

  // Wipe previous Xero-sourced transactions so we re-create cleanly.
  const wiped = await prisma.transaction.deleteMany({
    where: { organizationId: BIOFUEL_ORG_ID, description: { startsWith: "[xero] " } },
  });
  console.log(`[Backfill TX] wiped ${wiped.count} prior xero-sourced transactions`);

  // Build customer-level state to assign running balances correctly.
  type Row = {
    customerId: string;
    documentId: string;
    invoiceNumber: string;
    date: Date;
    gross: number;
    balance: number; // outstanding per xero
    isPaid: boolean;
    description: string;
  };

  const rows: Row[] = [];
  for (const inv of invoices) {
    const c = inv.config as any;
    const customerId = c.customerId || c.customer?.id;
    if (!customerId) continue;
    const gross = c.xeroGross ?? 0;
    const balance = c.xeroBalance ?? 0;
    if (gross <= 0) continue;
    const date = c.date ? new Date(c.date) : inv.createdAt;
    rows.push({
      customerId,
      documentId: inv.id,
      invoiceNumber: inv.name || "(no #)",
      date,
      gross,
      balance,
      isPaid: c.xeroStatus === "Paid" || balance === 0,
      description: `[xero] Invoice ${inv.name || ""}`.trim(),
    });
  }
  console.log(`[Backfill TX] ${rows.length} invoices with customer + gross > 0`);

  // Sort by customer, then date — needed so running balance accumulates right.
  rows.sort((a, b) => {
    if (a.customerId !== b.customerId) return a.customerId < b.customerId ? -1 : 1;
    return a.date.getTime() - b.date.getTime();
  });

  // Build transactions in memory then bulk-insert.
  type TxIn = {
    organizationId: string;
    customerId: string;
    transactionType: "INVOICE" | "PAYMENT";
    documentId: string;
    transactionDate: Date;
    reference: string;
    description: string;
    debit: number;
    credit: number;
    balance: number;
  };
  const txs: TxIn[] = [];
  const runningByCustomer = new Map<string, number>();

  for (const r of rows) {
    const prevBal = runningByCustomer.get(r.customerId) || 0;
    const afterInvoice = prevBal + r.gross;
    txs.push({
      organizationId: BIOFUEL_ORG_ID,
      customerId: r.customerId,
      transactionType: "INVOICE",
      documentId: r.documentId,
      transactionDate: r.date,
      reference: r.invoiceNumber,
      description: r.description,
      debit: r.gross,
      credit: 0,
      balance: afterInvoice,
    });
    runningByCustomer.set(r.customerId, afterInvoice);

    if (r.isPaid) {
      // Synthetic payment dated same as invoice (we don't have actual payment
      // dates from the AR export; the GL has them but cross-referencing per
      // invoice is its own stage). Good enough for SOA totals.
      const paid = r.gross;
      const afterPayment = afterInvoice - paid;
      txs.push({
        organizationId: BIOFUEL_ORG_ID,
        customerId: r.customerId,
        transactionType: "PAYMENT",
        documentId: r.documentId,
        transactionDate: r.date,
        reference: r.invoiceNumber,
        description: `[xero] Payment for ${r.invoiceNumber}`,
        debit: 0,
        credit: paid,
        balance: afterPayment,
      });
      runningByCustomer.set(r.customerId, afterPayment);
    }
  }
  console.log(`[Backfill TX] prepared ${txs.length} transaction rows`);

  // Bulk-insert in chunks.
  const CHUNK = 500;
  let inserted = 0;
  for (let i = 0; i < txs.length; i += CHUNK) {
    const batch = txs.slice(i, i + CHUNK);
    const res = await prisma.transaction.createMany({ data: batch });
    inserted += res.count;
    if ((i / CHUNK) % 4 === 0) console.log(`  inserted ${inserted}/${txs.length}`);
  }
  console.log(`[Backfill TX] inserted ${inserted} transactions`);

  // Refresh CustomerBalance for each customer that has any invoice.
  console.log(`[Backfill TX] refreshing CustomerBalance for ${runningByCustomer.size} customers...`);
  let balUpdated = 0;
  for (const [customerId, currentBalance] of runningByCustomer) {
    try {
      await prisma.customerBalance.upsert({
        where: { customerId_organizationId: { customerId, organizationId: BIOFUEL_ORG_ID } },
        create: {
          customerId,
          organizationId: BIOFUEL_ORG_ID,
          currentBalance,
          lastTransactionDate: new Date(),
        },
        update: { currentBalance, lastTransactionDate: new Date() },
      });
      balUpdated++;
    } catch (e: any) {
      console.warn(`  CustomerBalance ${customerId}: ${e.message?.slice(0, 100)}`);
    }
  }
  console.log(`[Backfill TX] updated ${balUpdated} CustomerBalance rows`);

  // Summary
  const txCount = await prisma.transaction.count({ where: { organizationId: BIOFUEL_ORG_ID } });
  const balCount = await prisma.customerBalance.count({ where: { organizationId: BIOFUEL_ORG_ID } });
  console.log(`\n[Backfill TX] ✓ done`);
  console.log(`  Total Transaction rows: ${txCount}`);
  console.log(`  Total CustomerBalance rows: ${balCount}`);

  // Top 5 customers by outstanding
  const top = await prisma.customerBalance.findMany({
    where: { organizationId: BIOFUEL_ORG_ID },
    orderBy: { currentBalance: "desc" },
    take: 5,
    include: { customer: { select: { name: true } } },
  });
  console.log(`\n  Top 5 customers by outstanding balance:`);
  top.forEach((b) => console.log(`    ${b.customer.name.padEnd(40)} $${b.currentBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`));
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
