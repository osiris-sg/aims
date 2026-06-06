/**
 * Seed Osiris Technology with a coherent demo dataset for showing to accountants.
 *
 * What's seeded (in one transaction-safe order):
 *   1. AccountingSetting with controlAccounts mapping
 *   2. Chart of Accounts (the seed default)
 *   3. Cost Centers
 *   4. Customers (+ existing customers preserved)
 *   5. Suppliers
 *   6. Fixed Assets (3 — covers all three depreciation methods)
 *   7. Recurring Journal templates (2)
 *   8. Budget (12 months × P&L accounts)
 *   9. Opening Balance JE (POSTED)
 *  10. Sales Invoices as Documents (5 — mix of paid/awaiting/overdue) + auto-posted Invoice JEs
 *  11. Customer Payments against 3 of those invoices + auto-posted Payment JEs
 *  12. Supplier Bills (5 — mix of DRAFT/PENDING/POSTED/PAID) + JEs for posted ones
 *  13. Manual Adjustment JE (depreciation accrual)
 *  14. Bank Statement Import + Lines (one CSV-style import, ready for reconciliation)
 *
 * Re-running is safe-ish — it appends to existing data (won't wipe what's there)
 * but will create duplicates if run twice. The script prints how to nuke
 * the demo data afterward.
 *
 * Usage: npx ts-node scripts/seed-osiris-demo.ts
 */

import { PrismaClient } from '@prisma/client';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../src/accounting/default-chart-of-accounts';

const prisma = new PrismaClient();
const ROUND = (n: number) => Math.round(n * 100) / 100;

async function main() {
  // ---------- Find Osiris ----------
  const org = await prisma.organization.findFirst({
    where: { name: { contains: 'Osiris Technology', mode: 'insensitive' } },
  });
  if (!org) throw new Error('Osiris org not found');
  const organizationId = org.id;
  console.log(`🏢 Seeding into: ${org.name} (${organizationId})`);

  // ---------- 1. Accounting Setting ----------
  const settingsData = {
    baseCurrency: 'SGD',
    taxRegistrationNumber: 'M2-123456789',
    taxDefaultPercentage: 9,
    taxReference: 'GST',
    activateLastBuyPrice: true,
    activateLastSoldPrice: true,
    enablePerpetualInventory: false,
    billApprovalThreshold: 5000,
    controlAccounts: {
      debtorControl: 'CA001',
      creditorControl: 'CL001',
      taxLiabilities: 'CL900',
      retainedProfits: 'RTPL',
      depreciationProvision: 'PD001',
      depreciationExpense: 'EX420',
    } as any,
  };
  const accountingSetting = await prisma.accountingSetting.upsert({
    where: { organizationId },
    update: settingsData,
    create: {
      organizationId,
      ...settingsData,
    } as any,
  });
  // Reset to prevent the literal-block below from re-running.
  if (false) {
    await prisma.accountingSetting.upsert({
    where: { organizationId },
    update: {},
    create: {
      organizationId,
      baseCurrency: 'SGD',
      taxRegistrationNumber: 'M2-123456789',
      taxDefaultPercentage: 9,
      taxReference: 'GST',
      activateLastBuyPrice: true,
      activateLastSoldPrice: true,
      enablePerpetualInventory: false,
      billApprovalThreshold: 5000,
      controlAccounts: {
        debtorControl: 'CA001',
        creditorControl: 'CL001',
        taxLiabilities: 'CL900',
        retainedProfits: 'RTPL',
        depreciationProvision: 'PD001',
        depreciationExpense: 'EX420',
      },
    },
  });
  }
  console.log('✅ AccountingSetting');

  // ---------- 2. Chart of Accounts ----------
  const existingCoa = await prisma.chartOfAccount.findMany({
    where: { organizationId },
    select: { code: true, id: true },
  });
  const existingCodes = new Set(existingCoa.map((a) => a.code));
  // Extra accounts not in the seed default but useful for the demo
  const extras: typeof DEFAULT_CHART_OF_ACCOUNTS = [
    { code: 'SS002', name: 'Service Revenue', accountType: 'SALES', category: 'PNL', normalBalance: 'CREDIT' },
    { code: 'EX210', name: 'Bank Charges', accountType: 'EXPENSE', category: 'PNL', normalBalance: 'DEBIT' },
    { code: 'EX305', name: 'Rent Expense', accountType: 'EXPENSE', category: 'PNL', normalBalance: 'DEBIT' },
    { code: 'EX315', name: 'Insurance Expense', accountType: 'EXPENSE', category: 'PNL', normalBalance: 'DEBIT' },
    { code: 'EX420', name: 'Depreciation Expense', accountType: 'EXPENSE', category: 'PNL', normalBalance: 'DEBIT' },
    { code: 'IC003', name: 'Interest Income', accountType: 'INCOME', category: 'PNL', normalBalance: 'CREDIT' },
  ];
  const all = [...DEFAULT_CHART_OF_ACCOUNTS, ...extras];
  for (const acc of all) {
    if (existingCodes.has(acc.code)) continue;
    await prisma.chartOfAccount.create({
      data: {
        organizationId,
        code: acc.code,
        name: acc.name,
        accountType: acc.accountType,
        category: acc.category,
        normalBalance: acc.normalBalance,
        isControlAccount: acc.isControlAccount ?? false,
        isSystem: true,
        isActive: true,
      },
    });
  }
  const coa = await prisma.chartOfAccount.findMany({ where: { organizationId } });
  const acct = (code: string) => {
    const a = coa.find((c) => c.code === code);
    if (!a) throw new Error(`Account ${code} missing`);
    return a.id;
  };
  console.log(`✅ Chart of Accounts: ${coa.length} accounts`);

  // ---------- 3. Cost Centers ----------
  const ccNames = [
    { code: 'OPS', name: 'Operations' },
    { code: 'SALES', name: 'Sales & Marketing' },
    { code: 'RND', name: 'R&D' },
    { code: 'ADMIN', name: 'Administration' },
  ];
  for (const cc of ccNames) {
    await prisma.costCenter.upsert({
      where: { organizationId_code: { organizationId, code: cc.code } },
      update: {},
      create: { organizationId, code: cc.code, name: cc.name },
    });
  }
  console.log(`✅ Cost Centers: ${ccNames.length}`);

  // ---------- 4. Customers (append if exists) ----------
  const customerSeeds = [
    { name: 'ABC Trading Pte Ltd', email: 'ap@abctrading.sg', phone: '+65 6234 5678', gstRegNo: '200912345Z' },
    { name: 'XYZ Engineering Sdn Bhd', email: 'finance@xyzeng.my', phone: '+60 3 1234 5678', gstRegNo: 'C20987654321' },
    { name: 'Tech Solutions Co', email: 'billing@techsol.sg', phone: '+65 6555 1234', gstRegNo: '199234567K' },
    { name: 'Marina Bay Cafe', email: 'owner@marinabaycafe.sg', phone: '+65 6888 9999', gstRegNo: null },
    { name: 'Sunshine Logistics', email: 'accounts@sunshine-log.com', phone: '+65 6212 3434', gstRegNo: '201112345A' },
    { name: 'Premier Retail Group', email: 'finance@premierretail.sg', phone: '+65 6777 8888', gstRegNo: '200512345B' },
  ];
  const customers: Record<string, any> = {};
  for (const c of customerSeeds) {
    const existing = await prisma.customer.findFirst({ where: { organizationId, name: c.name } });
    if (existing) {
      customers[c.name] = existing;
      continue;
    }
    customers[c.name] = await prisma.customer.create({
      data: { organizationId, ...c, customerCode: null, salesmanId: null },
    });
  }
  console.log(`✅ Customers: ${Object.keys(customers).length}`);

  // ---------- 5. Suppliers ----------
  const supplierSeeds = [
    { name: 'Stationery Wholesale Sg', email: 'orders@stationerywholesale.sg', gstRegNo: '199012345S' },
    { name: 'Office Equipment Pro', email: 'sales@oepro.sg', gstRegNo: '201212345T' },
    { name: 'Power & Tools Supply', email: 'ar@powertools.sg', gstRegNo: '200712345P' },
    { name: 'Cloud Services Asia', email: 'billing@cloudasia.com', gstRegNo: null },
    { name: 'Premium Logistics Express', email: 'ap@premium-log.sg', gstRegNo: '200612345L' },
    { name: 'Marketing Agency Co', email: 'finance@marketingco.sg', gstRegNo: '201512345M' },
  ];
  const suppliers: Record<string, any> = {};
  for (const s of supplierSeeds) {
    const existing = await prisma.supplier.findFirst({ where: { organizationId, name: s.name } });
    if (existing) {
      suppliers[s.name] = existing;
      continue;
    }
    suppliers[s.name] = await prisma.supplier.create({
      data: { organizationId, ...s, supplierCode: null },
    });
  }
  console.log(`✅ Suppliers: ${Object.keys(suppliers).length}`);

  // ---------- 6. Fixed Assets (3 — one per method) ----------
  const fixedAssets = [
    {
      code: 'FA-001',
      name: 'Office Furniture Set',
      category: 'Office Equipment',
      cost: 8000,
      salvageValue: 500,
      inServiceDate: new Date('2026-01-15'),
      method: 'STRAIGHT_LINE',
      usefulLifeMonths: 60,
    },
    {
      code: 'FA-002',
      name: 'Delivery Van #1',
      category: 'Vehicle',
      cost: 35000,
      salvageValue: 5000,
      inServiceDate: new Date('2026-02-01'),
      method: 'DECLINING_BALANCE',
      decliningRate: 20,
    },
    {
      code: 'FA-003',
      name: 'CNC Machine',
      category: 'Machinery',
      cost: 50000,
      salvageValue: 2000,
      inServiceDate: new Date('2026-03-01'),
      method: 'UNITS_OF_PRODUCTION',
      totalUnits: 100000,
      unitsPerPeriod: 2000,
    },
  ];
  for (const fa of fixedAssets) {
    const existing = await prisma.fixedAsset.findFirst({
      where: { organizationId, code: fa.code },
    });
    if (existing) continue;
    await prisma.fixedAsset.create({ data: { organizationId, ...fa } });
  }
  console.log(`✅ Fixed Assets: ${fixedAssets.length}`);

  // ---------- 7. Recurring Journal Templates (2) ----------
  const monthRent = {
    name: 'Monthly Office Rent',
    description: 'Office rent payable to landlord',
    frequency: 'MONTHLY',
    nextRunDate: new Date('2026-06-01'), // due → will fire on next hub load
    lines: [
      { accountId: acct('EX305'), description: 'Office rent', debit: 2500, credit: 0 },
      { accountId: acct('CA100'), description: 'Office rent', debit: 0, credit: 2500 },
    ],
  };
  const monthInsurance = {
    name: 'Monthly Insurance Accrual',
    description: 'Office insurance — accrual',
    frequency: 'MONTHLY',
    nextRunDate: new Date('2026-06-15'),
    lines: [
      { accountId: acct('EX315'), description: 'Insurance', debit: 400, credit: 0 },
      { accountId: acct('CL001'), description: 'Insurance — accrued', debit: 0, credit: 400 },
    ],
  };
  for (const t of [monthRent, monthInsurance]) {
    const existing = await prisma.recurringJournalTemplate.findFirst({
      where: { organizationId, name: t.name },
    });
    if (existing) continue;
    await prisma.recurringJournalTemplate.create({ data: { organizationId, ...t, isActive: true } });
  }
  console.log(`✅ Recurring Journal Templates: 2`);

  // ---------- 8. Budget (Jan-Dec 2026, P&L accounts) ----------
  const pnlAccounts = coa.filter((c) => c.category === 'PNL');
  const sampleBudgets: Record<string, number> = {
    SS001: 25000, // Credit Sales/month target
    SS002: 8000, // Service Revenue
    IC001: 500, // Other Income
    CS001: 12000, // Purchases
    EX001: 1500, // General Expenses
    EX203: 350, // Telephone
    EX210: 80, // Bank Charges
    EX305: 2500, // Rent
    EX315: 400, // Insurance
    EX420: 1200, // Depreciation
  };
  const year = 2026;
  for (const [code, monthly] of Object.entries(sampleBudgets)) {
    const a = pnlAccounts.find((p) => p.code === code);
    if (!a) continue;
    for (let m = 1; m <= 12; m++) {
      await prisma.budget.upsert({
        where: { accountId_year_month: { accountId: a.id, year, month: m } },
        update: { amount: monthly },
        create: { organizationId, accountId: a.id, year, month: m, amount: monthly },
      });
    }
  }
  console.log(`✅ Budget: ${Object.keys(sampleBudgets).length} accounts × 12 months`);

  // ---------- 9. Opening Balance JE ----------
  // Balanced: Assets 90K = Liab 30K + Equity 60K
  const openingLines = [
    { accountId: acct('CA100'), debit: 50000, credit: 0, description: 'Opening cash' }, // Bank
    { accountId: acct('CA001'), debit: 20000, credit: 0, description: 'Opening AR' }, // Trade Receivables
    { accountId: acct('CA002'), debit: 5000, credit: 0, description: 'Opening Stock' }, // Inventory
    { accountId: acct('FA001'), debit: 20000, credit: 0, description: 'Opening Fixed Assets at cost' },
    { accountId: acct('PD001'), debit: 0, credit: 5000, description: 'Opening Accum Depreciation' },
    { accountId: acct('CL001'), debit: 0, credit: 30000, description: 'Opening AP' },
    { accountId: acct('SC001'), debit: 0, credit: 50000, description: 'Opening Share Capital' },
    { accountId: acct('RTPL'), debit: 0, credit: 10000, description: 'Opening Retained Earnings' },
  ];
  const openingTotal = openingLines.reduce((s, l) => s + l.debit, 0);
  const openingTotalC = openingLines.reduce((s, l) => s + l.credit, 0);
  if (ROUND(openingTotal - openingTotalC) !== 0) {
    throw new Error(`Opening JE unbalanced: ${openingTotal} vs ${openingTotalC}`);
  }
  await createPostedJE({
    organizationId,
    journalNumber: 'JV-OPEN-2026',
    entryDate: new Date('2026-01-01'),
    type: 'OPENING_BALANCE',
    reference: 'Opening 2026',
    description: 'Opening balances as of Jan 1, 2026',
    lines: openingLines,
  });
  console.log('✅ Opening Balance JE posted');

  // ---------- 10. Sales Invoices (Documents + balanced JEs) ----------
  // We create the Document rows (status varies) AND a posted INVOICE journal
  // entry for each, mirroring what the auto-post pipeline would do.
  const invoiceTemplate = await prisma.documentTemplate.findFirst({
    where: { organizationId, type: 'INVOICE' },
  });
  // Fallback to any invoice template; otherwise skip Documents and just create JEs.
  const tplId = invoiceTemplate?.id;

  const invoiceSeeds = [
    { customer: 'ABC Trading Pte Ltd', net: 5000, days: -45, status: 'paid' },
    { customer: 'XYZ Engineering Sdn Bhd', net: 12000, days: -38, status: 'pending_payment' }, // overdue
    { customer: 'Tech Solutions Co', net: 3200, days: -30, status: 'pending_payment' }, // overdue
    { customer: 'Sunshine Logistics', net: 7500, days: -22, status: 'paid' },
    { customer: 'ABC Trading Pte Ltd', net: 4500, days: -15, status: 'pending_payment' },
    { customer: 'Premier Retail Group', net: 8800, days: -10, status: 'pending_payment' },
    { customer: 'Marina Bay Cafe', net: 1500, days: -5, status: 'pending_payment' },
    { customer: 'Tech Solutions Co', net: 6200, days: -2, status: 'pending_payment' },
  ];
  let inv = 0;
  const taxRate = 0.09;
  for (const seed of invoiceSeeds) {
    const cust = customers[seed.customer];
    if (!cust) continue;
    const billDate = new Date();
    billDate.setDate(billDate.getDate() + seed.days);
    const dueDate = new Date(billDate);
    dueDate.setDate(dueDate.getDate() + 30);
    const net = seed.net;
    const tax = ROUND(net * taxRate);
    const gross = ROUND(net + tax);
    inv += 1;
    const invoiceNumber = `INV-2026-${String(100 + inv).padStart(3, '0')}`;

    // Document row (for the invoices list)
    let docId: string | null = null;
    if (tplId) {
      const doc = await prisma.document.create({
        data: {
          name: invoiceNumber,
          type: 'INVOICE',
          documentTemplateId: tplId,
          organizationId,
          status: seed.status as any,
          config: {
            customer: { id: cust.id, name: cust.name },
            date: billDate.toISOString(),
            dueDate: dueDate.toISOString(),
            items: [
              { description: 'Professional services', quantity: 1, unitPrice: net, amount: net },
            ],
            subTotal: net,
            gstAmount: tax,
            nettTotal: gross,
            summary: { subTotal: net, taxAmount: tax, grandTotal: gross },
          } as any,
        },
      });
      docId = doc.id;
    }

    // Posted JE: Dr AR / Cr Sales / Cr Tax
    await createPostedJE({
      organizationId,
      journalNumber: nextJN('JV-INV'),
      entryDate: billDate,
      type: 'INVOICE',
      reference: invoiceNumber,
      description: `Sales to ${cust.name}`,
      sourceDocumentId: docId,
      lines: [
        { accountId: acct('CA001'), debit: gross, credit: 0, description: `Invoice ${invoiceNumber} — ${cust.name}` },
        { accountId: acct('SS001'), debit: 0, credit: net, description: `Sales — ${invoiceNumber}` },
        { accountId: acct('CL900'), debit: 0, credit: tax, description: `Output tax — ${invoiceNumber}` },
      ],
    });
  }
  console.log(`✅ Sales Invoices: ${invoiceSeeds.length} with posted JEs`);

  // ---------- 11. Customer Payments against 3 invoices ----------
  // Pick the 'paid' invoices (45d, 22d) plus one partial
  const paidPayments = [
    { customer: 'ABC Trading Pte Ltd', amount: 5450, daysAgo: -40, ref: 'CHQ-12001' }, // gross of first
    { customer: 'Sunshine Logistics', amount: 8175, daysAgo: -18, ref: 'CHQ-12005' }, // gross of 7500*1.09
    { customer: 'Premier Retail Group', amount: 4000, daysAgo: -3, ref: 'CHQ-12010' }, // partial
  ];
  for (const p of paidPayments) {
    const cust = customers[p.customer];
    if (!cust) continue;
    const date = new Date();
    date.setDate(date.getDate() + p.daysAgo);
    await createPostedJE({
      organizationId,
      journalNumber: nextJN('JV-PAY'),
      entryDate: date,
      type: 'PAYMENT',
      reference: p.ref,
      description: `Payment from ${cust.name}`,
      lines: [
        { accountId: acct('CA100'), debit: p.amount, credit: 0, description: `Payment ${p.ref}` },
        { accountId: acct('CA001'), debit: 0, credit: p.amount, description: `Cleared AR — ${cust.name}` },
      ],
    });
  }
  console.log(`✅ Customer Payments: ${paidPayments.length}`);

  // ---------- 12. Supplier Bills (5) ----------
  const billSeeds = [
    { supplier: 'Stationery Wholesale Sg', billNo: 'STN-2026-501', net: 850, daysAgo: -40, status: 'PAID' },
    { supplier: 'Cloud Services Asia', billNo: 'AWS-INV-9921', net: 1450, daysAgo: -30, status: 'POSTED' },
    { supplier: 'Office Equipment Pro', billNo: 'OEP-2026-077', net: 8500, daysAgo: -20, status: 'PENDING_APPROVAL' }, // > 5K threshold
    { supplier: 'Marketing Agency Co', billNo: 'MAC-26-04', net: 3200, daysAgo: -15, status: 'POSTED' },
    { supplier: 'Premium Logistics Express', billNo: 'PLE-12453', net: 620, daysAgo: -3, status: 'DRAFT' },
  ];
  for (const b of billSeeds) {
    const sup = suppliers[b.supplier];
    if (!sup) continue;
    const billDate = new Date();
    billDate.setDate(billDate.getDate() + b.daysAgo);
    const dueDate = new Date(billDate);
    dueDate.setDate(dueDate.getDate() + 30);
    const net = b.net;
    const tax = ROUND(net * taxRate);
    const total = ROUND(net + tax);
    const lines = [
      { description: b.billNo, quantity: 1, unitPrice: net, amount: net, accountId: acct('EX001') },
    ];

    const existing = await prisma.bill.findFirst({
      where: { organizationId, billNumber: b.billNo },
    });
    if (existing) continue;

    const billRow = await prisma.bill.create({
      data: {
        organizationId,
        supplierId: sup.id,
        billNumber: b.billNo,
        billDate,
        dueDate,
        status: b.status,
        subtotal: net,
        taxAmount: tax,
        totalAmount: total,
        amountPaid: b.status === 'PAID' ? total : 0,
        lines: lines as any,
        inboundChannel: 'MANUAL',
        postedAt: b.status === 'POSTED' || b.status === 'PAID' ? new Date() : null,
      },
    });

    // Create JE for POSTED / PAID bills
    if (b.status === 'POSTED' || b.status === 'PAID') {
      const je = await createPostedJE({
        organizationId,
        journalNumber: nextJN('JV-BILL'),
        entryDate: billDate,
        type: 'BILL',
        reference: b.billNo,
        description: `Bill from ${sup.name}`,
        lines: [
          { accountId: acct('EX001'), debit: net, credit: 0, description: b.billNo },
          { accountId: acct('CL900'), debit: tax, credit: 0, description: `Input tax — ${b.billNo}` },
          { accountId: acct('CL001'), debit: 0, credit: total, description: `Bill ${b.billNo}` },
        ],
      });
      await prisma.bill.update({ where: { id: billRow.id }, data: { journalEntryId: je.id } });
    }

    // For PAID, also create a supplier-payment JE
    if (b.status === 'PAID') {
      const payDate = new Date(billDate);
      payDate.setDate(payDate.getDate() + 10);
      await createPostedJE({
        organizationId,
        journalNumber: nextJN('JV-SPAY'),
        entryDate: payDate,
        type: 'PAYMENT',
        reference: `PAY-${b.billNo}`,
        description: `Payment to ${sup.name}`,
        lines: [
          { accountId: acct('CL001'), debit: total, credit: 0, description: `Cleared AP — ${sup.name}` },
          { accountId: acct('CA100'), debit: 0, credit: total, description: `Payment ${b.billNo}` },
        ],
      });
    }
  }
  console.log(`✅ Bills: ${billSeeds.length}`);

  // ---------- 13. Manual Adjustment JE: depreciation accrual ----------
  await createPostedJE({
    organizationId,
    journalNumber: nextJN('JV-ADJ'),
    entryDate: new Date('2026-05-31'),
    type: 'ADJUSTMENT',
    reference: 'DEP-2026-05',
    description: 'Monthly depreciation — May 2026',
    lines: [
      { accountId: acct('EX420'), debit: 1200, credit: 0, description: 'Depreciation May 2026' },
      { accountId: acct('PD001'), debit: 0, credit: 1200, description: 'Accum depreciation May 2026' },
    ],
  });
  console.log('✅ Adjustment JE: monthly depreciation');

  // ---------- 14. Bank Statement Import (ready for reconciliation) ----------
  // 8 lines, mix of matched (paid invoices/bills) and unmatched (charges/interest).
  // Auto-match will pair the obvious ones.
  const bankAccount = coa.find((c) => c.code === 'CA100');
  if (bankAccount) {
    const imp = await prisma.bankStatementImport.create({
      data: {
        organizationId,
        bankAccountId: bankAccount.id,
        source: 'CSV',
        filename: 'demo-statement-may-2026.csv',
        periodStart: new Date('2026-05-01'),
        periodEnd: new Date('2026-05-31'),
        endingBalance: 60000,
        columnMapping: { date: 0, description: 1, amount: 2, skipRows: 1 } as any,
      },
    });
    const today = new Date();
    const ago = (d: number) => {
      const x = new Date(today);
      x.setDate(x.getDate() + d);
      return x;
    };
    const stmtLines = [
      { date: ago(-18), description: 'Sunshine Logistics CHQ-12005', amount: 8175 }, // will match payment
      { date: ago(-40), description: 'ABC Trading CHQ-12001', amount: 5450 }, // will match payment
      { date: ago(-3), description: 'Premier Retail Group CHQ-12010', amount: 4000 }, // will match partial
      { date: ago(-25), description: 'OCBC service charge', amount: -25 }, // unmatched → LLM suggest Bank Charges
      { date: ago(-20), description: 'Bank interest received', amount: 12.5 }, // unmatched → LLM suggest Interest Income
      { date: ago(-12), description: 'AWS-INV-9921 supplier transfer', amount: -1580.5 }, // close-but-not-exact, may need manual
      { date: ago(-7), description: 'Rent — June payment', amount: -2500 }, // unmatched → recurring? user posts
      { date: ago(-2), description: 'Quarterly bank fee', amount: -45 }, // unmatched
    ];
    for (const l of stmtLines) {
      await prisma.bankStatementLine.create({
        data: {
          importId: imp.id,
          organizationId,
          bankAccountId: bankAccount.id,
          date: l.date,
          description: l.description,
          amount: l.amount,
          status: 'PENDING',
        },
      });
    }
    console.log(`✅ Bank Statement Import: 1 (${stmtLines.length} lines, all PENDING — run auto-match in UI)`);
  }

  console.log('\n🎉 Done! TB sanity check:');
  const lines = await prisma.journalEntryLine.findMany({
    where: { journalEntry: { organizationId, status: 'POSTED' } },
  });
  const td = lines.reduce((s, l) => s + l.debit, 0);
  const tc = lines.reduce((s, l) => s + l.credit, 0);
  console.log(`   Total debits: ${td.toFixed(2)}   Total credits: ${tc.toFixed(2)}   Balanced: ${ROUND(td - tc) === 0 ? '✅' : '❌'}`);

  console.log('\n📍 Org URL: http://localhost:3000/portal/accounting');
  console.log('🧹 To wipe: DELETE FROM "BankStatementLine"/Import/Bill/FixedAsset/Budget/RecurringJournalTemplate/CostCenter/JournalEntryLine/JournalEntry/Document WHERE organizationId = ' + organizationId);
}

// ---------- helpers ----------

const jnCounters: Record<string, number> = {};
function nextJN(prefix: string): string {
  jnCounters[prefix] = (jnCounters[prefix] ?? 0) + 1;
  return `${prefix}-${String(jnCounters[prefix]).padStart(6, '0')}`;
}

async function createPostedJE(args: {
  organizationId: string;
  journalNumber: string;
  entryDate: Date;
  type: string;
  reference?: string;
  description: string;
  sourceDocumentId?: string | null;
  lines: Array<{ accountId: string; debit: number; credit: number; description?: string }>;
}) {
  const totalDebit = ROUND(args.lines.reduce((s, l) => s + l.debit, 0));
  const totalCredit = ROUND(args.lines.reduce((s, l) => s + l.credit, 0));
  if (ROUND(totalDebit - totalCredit) !== 0) {
    throw new Error(`JE ${args.journalNumber} unbalanced: ${totalDebit} vs ${totalCredit}`);
  }
  return prisma.journalEntry.create({
    data: {
      organizationId: args.organizationId,
      journalNumber: args.journalNumber,
      entryDate: args.entryDate,
      type: args.type,
      status: 'POSTED',
      reference: args.reference,
      description: args.description,
      sourceDocumentId: args.sourceDocumentId ?? null,
      totalDebit,
      totalCredit,
      postedAt: new Date(),
      lines: {
        create: args.lines.map((l, i) => ({
          accountId: l.accountId,
          lineNumber: i + 1,
          description: l.description,
          debit: l.debit,
          credit: l.credit,
        })),
      },
    },
  });
}

main()
  .catch((e) => {
    console.error('❌', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
