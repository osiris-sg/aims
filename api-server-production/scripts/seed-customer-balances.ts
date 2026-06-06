/**
 * Populate CustomerBalance for Osiris customers based on the seeded invoice
 * documents + payments. Required for the AR Aging endpoint which reads from
 * CustomerBalance.currentBalance > 0.
 */

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const ROUND = (n: number) => Math.round(n * 100) / 100;

async function main() {
  const org = await prisma.organization.findFirst({
    where: { name: { contains: 'Osiris Technology', mode: 'insensitive' } },
  });
  if (!org) throw new Error('not found');

  // Build outstanding-per-customer from invoice Documents seeded by the demo.
  const invoices = await prisma.document.findMany({
    where: { organizationId: org.id, type: 'INVOICE' },
  });
  type Open = { name: string; total: number };
  const owedByName = new Map<string, number>();
  for (const inv of invoices) {
    const cfg: any = inv.config || {};
    const customerName = cfg?.customer?.name;
    if (!customerName) continue;
    if (inv.status === 'paid') continue;
    const gross = parseFloat(cfg?.nettTotal ?? cfg?.summary?.grandTotal ?? '0') || 0;
    owedByName.set(customerName, ROUND((owedByName.get(customerName) ?? 0) + gross));
  }

  // Partial payment manual adjustment: Premier Retail paid 4,000 of 9,592
  if (owedByName.has('Premier Retail Group')) {
    owedByName.set('Premier Retail Group', ROUND(owedByName.get('Premier Retail Group')! - 4000));
  }

  console.log('Building balances for', owedByName.size, 'customers');
  for (const [name, balance] of owedByName.entries()) {
    const cust = await prisma.customer.findFirst({
      where: { organizationId: org.id, name },
    });
    if (!cust) continue;

    // Use customerId + organizationId via findFirst then create/update separately,
    // since CustomerBalance may have its own unique key.
    const existing = await prisma.customerBalance.findFirst({
      where: { customerId: cust.id, organizationId: org.id },
    });
    if (existing) {
      await prisma.customerBalance.update({
        where: { id: existing.id },
        data: { currentBalance: balance },
      });
    } else {
      await prisma.customerBalance.create({
        data: {
          customerId: cust.id,
          organizationId: org.id,
          currentBalance: balance,
        },
      });
    }
    console.log(`   ${name}: ${balance}`);
  }

  // Aging analysis uses Transaction model with transactionType=INVOICE.
  // Backfill those too so calculateAging works (date-based bucketing).
  for (const inv of invoices) {
    const cfg: any = inv.config || {};
    const customerName = cfg?.customer?.name;
    if (!customerName) continue;
    if (inv.status === 'paid') continue;
    const cust = await prisma.customer.findFirst({
      where: { organizationId: org.id, name: customerName },
    });
    if (!cust) continue;
    const gross = parseFloat(cfg?.nettTotal ?? cfg?.summary?.grandTotal ?? '0') || 0;
    const date = cfg?.date ? new Date(cfg.date) : inv.createdAt;
    // Skip if already exists for this invoice
    const exists = await prisma.transaction.findFirst({
      where: { organizationId: org.id, documentId: inv.id, transactionType: 'INVOICE' },
    });
    if (exists) continue;
    await prisma.transaction.create({
      data: {
        organizationId: org.id,
        customerId: cust.id,
        documentId: inv.id,
        transactionType: 'INVOICE',
        transactionDate: date,
        debit: gross,
        credit: 0,
        balance: gross,
        description: `Invoice ${inv.name}`,
      },
    });
  }
  console.log('Backfilled Transaction rows for aging');
}

main()
  .catch((e) => { console.error('❌', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
