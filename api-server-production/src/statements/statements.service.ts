import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { GenerateSOADto } from './dto/generate-soa.dto';

export interface AgingBucket {
  current: number;   // 0-30 days
  days30: number;    // 31-60 days
  days60: number;    // 61-90 days
  days90: number;    // 91-120 days
  days120Plus: number; // 121+ days
}

@Injectable()
export class StatementsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Generate Statement of Account for a customer — reconstructed from the
   * Document table (INVOICE + CREDIT_NOTE) + Payment records, NOT the retired
   * Transaction/CustomerBalance sub-ledger. Ties to Xero AR (sum of xeroBalance).
   *
   * For Xero-imported invoices, the paid+credited portion (gross − xeroBalance)
   * is shown as a single "Payment/credits" settlement line (Xero folds credit
   * notes into the invoice's AmountDue, so listing CN docs separately would
   * double-count). For AIMS-native orgs, standalone CREDIT_NOTE docs and Payment
   * rows are listed as their own credit lines.
   */
  async generateSOA(generateSOADto: GenerateSOADto, organizationId: string) {
    try {
      const customer = await this.prisma.customer.findFirst({
        where: { id: generateSOADto.customerId, organizationId },
      });
      if (!customer) throw new HttpException('Customer not found', HttpStatus.NOT_FOUND);

      const startDate = generateSOADto.startDate ? new Date(generateSOADto.startDate) : null;
      const endDate = generateSOADto.endDate ? new Date(generateSOADto.endDate) : new Date();
      const R = (n: number) => Math.round(n * 100) / 100;

      const docs = await this.prisma.document.findMany({
        where: {
          organizationId,
          type: { in: ['INVOICE', 'CREDIT_NOTE'] },
          OR: [
            { config: { path: ['customerId'], equals: customer.id } },
            { config: { path: ['customer', 'id'], equals: customer.id } },
          ],
        },
        select: { id: true, name: true, type: true, createdAt: true, config: true },
      });
      const payments = await this.prisma.payment.findMany({
        where: { organizationId, customerId: customer.id },
        orderBy: { paymentDate: 'asc' },
      });
      const isXero = docs.some((d) => (d.config as any)?.xeroImported);

      type Tx = { date: Date; reference: string; description: string; transactionType: string; debit: number; credit: number; balance: number; documentType?: string; paymentMethod?: string };
      const all: Tx[] = [];
      let openingBalance = 0;
      const add = (d: Date, tx: Tx, netEffect: number) => {
        if (startDate && d < startDate) { openingBalance += netEffect; return; }
        if (d > endDate) return;
        all.push(tx);
      };

      for (const doc of docs) {
        const c: any = doc.config || {};
        if (c.voided) continue;
        const d = c.date ? new Date(c.date) : doc.createdAt;
        const gross = R(c.xeroGross ?? c.totalAmount ?? 0);
        if (gross <= 0) continue;
        if (doc.type === 'INVOICE') {
          add(d, { date: d, reference: doc.name || '(no #)', description: `Invoice ${doc.name || ''}`.trim(), transactionType: 'INVOICE', debit: gross, credit: 0, balance: 0, documentType: 'INVOICE' }, gross);
          const paid = R(gross - R(c.xeroBalance ?? gross));
          if (isXero && paid > 0.005) {
            add(d, { date: d, reference: doc.name || '', description: `Payment / credits applied — ${doc.name || ''}`.trim(), transactionType: 'PAYMENT', debit: 0, credit: paid, balance: 0, documentType: 'PAYMENT' }, -paid);
          }
        } else if (doc.type === 'CREDIT_NOTE' && !isXero) {
          add(d, { date: d, reference: doc.name || '', description: `Credit Note ${doc.name || ''}`.trim(), transactionType: 'CREDIT_NOTE', debit: 0, credit: gross, balance: 0, documentType: 'CREDIT_NOTE' }, -gross);
        }
      }
      for (const p of payments) {
        add(p.paymentDate, { date: p.paymentDate, reference: p.reference || p.id.slice(0, 8), description: `Payment via ${p.paymentMethod || ''}${p.reference ? ` ref ${p.reference}` : ''}`.trim(), transactionType: 'PAYMENT', debit: 0, credit: p.amount, balance: 0, documentType: 'PAYMENT', paymentMethod: p.paymentMethod }, -p.amount);
      }

      all.sort((a, b) => a.date.getTime() - b.date.getTime());
      let running = R(openingBalance);
      for (const t of all) { running = R(running + t.debit - t.credit); t.balance = running; }
      const currentBalance = running;

      const monthlyBalances = this.groupTransactionsByMonth(all, openingBalance);
      let agingAnalysis: AgingBucket | null = null;
      if (generateSOADto.includeAging !== false) agingAnalysis = await this.calculateAging(customer.id, organizationId);

      if (generateSOADto.format === 'csv') return this.generateCSV(customer, all, openingBalance, currentBalance, monthlyBalances);

      return {
        success: true,
        data: {
          customer: { id: customer.id, name: customer.name, email: customer.email, phone: customer.phone, address: customer.address },
          statement: {
            openingBalance: R(openingBalance),
            currentBalance,
            totalDebit: R(all.reduce((s, t) => s + t.debit, 0)),
            totalCredit: R(all.reduce((s, t) => s + t.credit, 0)),
            transactionCount: all.length,
          },
          transactions: all.map((t) => ({ date: t.date, reference: t.reference, description: t.description, transactionType: t.transactionType, debit: t.debit, credit: t.credit, balance: t.balance, documentType: t.documentType, paymentMethod: t.paymentMethod })),
          monthlyBalances,
          agingAnalysis,
          generatedAt: new Date(),
        },
      };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new HttpException(`Failed to generate statement: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Calculate aging analysis for outstanding invoices
   */
  async calculateAging(customerId: string, organizationId: string): Promise<AgingBucket> {
    try {
      const today = new Date();
      const aging: AgingBucket = { current: 0, days30: 0, days60: 0, days90: 0, days120Plus: 0 };

      // Unpaid INVOICE documents (outstanding balance > 0), aged by due date.
      const invoices = await this.prisma.document.findMany({
        where: {
          organizationId,
          type: 'INVOICE',
          OR: [
            { config: { path: ['customerId'], equals: customerId } },
            { config: { path: ['customer', 'id'], equals: customerId } },
          ],
        },
        select: { config: true, createdAt: true },
      });

      for (const inv of invoices) {
        const c: any = inv.config || {};
        if (c.voided) continue;
        const owed = Number(c.xeroBalance ?? 0);
        if (owed <= 0.005) continue;
        const ref = c.dueDate ? new Date(c.dueDate) : c.date ? new Date(c.date) : inv.createdAt;
        const days = Math.floor((today.getTime() - ref.getTime()) / (1000 * 60 * 60 * 24));
        if (days <= 30) aging.current += owed;
        else if (days <= 60) aging.days30 += owed;
        else if (days <= 90) aging.days60 += owed;
        else if (days <= 120) aging.days90 += owed;
        else aging.days120Plus += owed;
      }
      const R = (n: number) => Math.round(n * 100) / 100;
      return { current: R(aging.current), days30: R(aging.days30), days60: R(aging.days60), days90: R(aging.days90), days120Plus: R(aging.days120Plus) };
    } catch (error) {
      throw new HttpException(`Failed to calculate aging: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Group transactions by month and calculate monthly balances
   */
  private groupTransactionsByMonth(transactions: any[], openingBalance: number) {
    const monthlyMap = new Map<string, { debit: number; credit: number; balance: number }>();
    let runningBalance = openingBalance;

    for (const transaction of transactions) {
      const monthKey = new Date(transaction.date).toISOString().substring(0, 7); // YYYY-MM

      if (!monthlyMap.has(monthKey)) {
        monthlyMap.set(monthKey, { debit: 0, credit: 0, balance: 0 });
      }

      const month = monthlyMap.get(monthKey);
      month.debit += transaction.debit;
      month.credit += transaction.credit;
      runningBalance = transaction.balance;
      month.balance = runningBalance;
    }

    // Convert to array and sort by month
    return Array.from(monthlyMap.entries())
      .map(([month, data]) => ({
        month,
        debit: data.debit,
        credit: data.credit,
        balance: data.balance,
      }))
      .sort((a, b) => a.month.localeCompare(b.month));
  }

  /**
   * Generate CSV format for SOA
   */
  private generateCSV(customer: any, transactions: any[], openingBalance: number, currentBalance: number, monthlyBalances: any[]) {
    const headers = ['Date', 'Reference', 'Description', 'Debit', 'Credit', 'Balance'];

    const rows = [
      // Header rows
      ['STATEMENT OF ACCOUNT'],
      [`Customer: ${customer.name}`],
      [`Email: ${customer.email || 'N/A'}`],
      [`Phone: ${customer.phone || 'N/A'}`],
      [`Address: ${customer.address || 'N/A'}`],
      [],
      ['Opening Balance', '', '', '', '', openingBalance.toFixed(2)],
      [],
      headers,
    ];

    // Transaction rows
    for (const transaction of transactions) {
      rows.push([
        new Date(transaction.date).toLocaleDateString(),
        transaction.reference || 'N/A',
        transaction.description,
        transaction.debit ? transaction.debit.toFixed(2) : '0.00',
        transaction.credit ? transaction.credit.toFixed(2) : '0.00',
        transaction.balance.toFixed(2),
      ]);
    }

    // Summary rows
    rows.push([]);
    rows.push(['Current Balance', '', '', '', '', currentBalance.toFixed(2)]);
    rows.push([]);
    rows.push(['MONTHLY SUMMARY']);
    rows.push(['Month', 'Debit', 'Credit', 'Balance']);

    for (const month of monthlyBalances) {
      rows.push([
        month.month,
        month.debit.toFixed(2),
        month.credit.toFixed(2),
        month.balance.toFixed(2),
      ]);
    }

    const csvContent = rows.map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');

    return {
      content: csvContent,
      filename: `SOA-${customer.name.replace(/\s+/g, '_')}-${new Date().toISOString().split('T')[0]}.csv`,
      contentType: 'text/csv',
    };
  }

  /**
   * Get aging summary for all customers
   */
  async getAgingSummary(organizationId: string) {
    try {
      // Outstanding balances derived from unpaid INVOICE documents (not the
      // retired CustomerBalance table). One pass, grouped by customer.
      const invoices = await this.prisma.document.findMany({
        where: { organizationId, type: 'INVOICE' },
        select: { config: true, createdAt: true },
      });
      const today = new Date();
      const byCust = new Map<string, { name: string; balance: number; aging: AgingBucket }>();
      for (const inv of invoices) {
        const c: any = inv.config || {};
        if (c.voided) continue;
        const owed = Number(c.xeroBalance ?? 0);
        if (owed <= 0.005) continue;
        const cId = c.customerId || c.customer?.id;
        if (!cId) continue;
        if (!byCust.has(cId)) byCust.set(cId, { name: c.customer?.name || 'Unknown', balance: 0, aging: { current: 0, days30: 0, days60: 0, days90: 0, days120Plus: 0 } });
        const e = byCust.get(cId)!;
        e.balance += owed;
        const ref = c.dueDate ? new Date(c.dueDate) : c.date ? new Date(c.date) : inv.createdAt;
        const days = Math.floor((today.getTime() - ref.getTime()) / (1000 * 60 * 60 * 24));
        if (days <= 30) e.aging.current += owed;
        else if (days <= 60) e.aging.days30 += owed;
        else if (days <= 90) e.aging.days60 += owed;
        else if (days <= 120) e.aging.days90 += owed;
        else e.aging.days120Plus += owed;
      }
      const R = (n: number) => Math.round(n * 100) / 100;
      const agingSummary = [...byCust.entries()]
        .map(([customerId, e]) => ({ customerId, customerName: e.name, currentBalance: R(e.balance), aging: { current: R(e.aging.current), days30: R(e.aging.days30), days60: R(e.aging.days60), days90: R(e.aging.days90), days120Plus: R(e.aging.days120Plus) } }))
        .sort((a, b) => b.currentBalance - a.currentBalance);

      // Calculate totals
      const totalAging: AgingBucket = {
        current: 0,
        days30: 0,
        days60: 0,
        days90: 0,
        days120Plus: 0,
      };

      for (const summary of agingSummary) {
        totalAging.current += summary.aging.current;
        totalAging.days30 += summary.aging.days30;
        totalAging.days60 += summary.aging.days60;
        totalAging.days90 += summary.aging.days90;
        totalAging.days120Plus += summary.aging.days120Plus;
      }

      return {
        success: true,
        data: {
          customers: agingSummary,
          totals: totalAging,
          totalOutstanding: Object.values(totalAging).reduce((sum, val) => sum + val, 0),
        },
      };
    } catch (error) {
      throw new HttpException(
        `Failed to generate aging summary: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // ====================================================================
  // Supplier Statement of Account (AP-side mirror of generateSOA)
  // ====================================================================
  //
  // Reads Document table directly (type=BILL) since AP bills don't have an
  // AIMS-native Transaction-table cache the way AR invoices do. Pairs each
  // bill with any BillPayment rows recorded against it; reconstructs a
  // running outstanding balance over time.
  async generateSupplierSOA(
    dto: { supplierId: string; startDate?: string; endDate?: string; includeAging?: boolean },
    organizationId: string,
  ) {
    const supplier = await this.prisma.supplier.findFirst({
      where: { id: dto.supplierId, organizationId },
      select: { id: true, name: true, email: true, phone: true, address: true, gstRegNo: true },
    });
    if (!supplier) {
      throw new HttpException('Supplier not found', HttpStatus.NOT_FOUND);
    }

    const startDate = dto.startDate ? new Date(dto.startDate) : null;
    const endDate = dto.endDate ? new Date(dto.endDate) : new Date();

    // Pull all BILL docs for this supplier, sorted by bill date.
    const bills = await this.prisma.document.findMany({
      where: {
        organizationId,
        type: 'BILL',
        OR: [
          { config: { path: ['supplierId'], equals: supplier.id } },
          { config: { path: ['supplier', 'id'], equals: supplier.id } },
        ],
      },
      select: { id: true, name: true, createdAt: true, status: true, config: true },
    });

    // Pull BillPayments for this supplier (via the Bill FK link)
    const payments = await this.prisma.billPayment.findMany({
      where: { organizationId, supplierId: supplier.id },
      orderBy: { paymentDate: 'asc' },
    });

    type Tx = {
      date: Date;
      type: 'BILL' | 'PAYMENT';
      reference: string;
      description: string;
      debit: number; // money out — bill amount
      credit: number; // money paid back
      balance: number;
      documentId?: string;
    };

    const txs: Tx[] = [];
    let openingBalance = 0;

    for (const b of bills) {
      const c: any = b.config || {};
      const d = c.date ? new Date(c.date) : b.createdAt;
      const gross = c.xeroGross ?? c.totalAmount ?? 0;
      if (gross <= 0) continue;

      // Anything before startDate rolls into opening.
      if (startDate && d < startDate) {
        openingBalance += gross;
        // If the bill was already paid before startDate, net it out.
        const isPaid = c.xeroStatus === 'Paid' || c.xeroBalance === 0;
        if (isPaid) openingBalance -= gross;
        continue;
      }
      if (d > endDate) continue;

      txs.push({
        date: d,
        type: 'BILL',
        reference: b.name || '(no #)',
        description: `Bill ${b.name || ''}`.trim(),
        debit: gross,
        credit: 0,
        balance: 0,
        documentId: b.id,
      });

      // For Xero-imported paid bills we don't have exact payment dates, so
      // synthesize a payment on the same date.
      const isPaid = c.xeroStatus === 'Paid' || c.xeroBalance === 0;
      if (isPaid && (!payments.length || !payments.some((p) => p.billId === b.id))) {
        txs.push({
          date: d,
          type: 'PAYMENT',
          reference: b.name || '(no #)',
          description: `Payment for ${b.name || ''}`.trim(),
          debit: 0,
          credit: gross,
          balance: 0,
          documentId: b.id,
        });
      }
    }

    // Layer in real AIMS-recorded BillPayments (more recent than the import).
    for (const p of payments) {
      const d = p.paymentDate;
      if (startDate && d < startDate) {
        openingBalance -= p.amount;
        continue;
      }
      if (d > endDate) continue;
      const linkedBill = bills.find((b) => b.id === p.billId);
      txs.push({
        date: d,
        type: 'PAYMENT',
        reference: linkedBill?.name || p.reference || p.id.slice(0, 8),
        description: `Payment via ${p.paymentMethod}${p.reference ? ` ref ${p.reference}` : ''}`,
        debit: 0,
        credit: p.amount,
        balance: 0,
        documentId: p.billId,
      });
    }

    // Sort + accumulate running balance.
    txs.sort((a, b) => a.date.getTime() - b.date.getTime());
    let running = openingBalance;
    for (const t of txs) {
      running += t.debit - t.credit;
      t.balance = Math.round(running * 100) / 100;
    }
    const closingBalance = Math.round(running * 100) / 100;

    // Aging (current 0-30 / 31-60 / 61-90 / 90+) — based on still-outstanding bills.
    const aging = { current: 0, days30: 0, days60: 0, days90: 0, days120Plus: 0 };
    if (dto.includeAging !== false) {
      const now = endDate;
      for (const b of bills) {
        const c: any = b.config || {};
        const isPaid = c.xeroStatus === 'Paid' || c.xeroBalance === 0;
        if (isPaid) continue;
        const due = c.dueDate ? new Date(c.dueDate) : c.date ? new Date(c.date) : b.createdAt;
        const ageDays = Math.floor((now.getTime() - due.getTime()) / (1000 * 60 * 60 * 24));
        const owed = c.xeroBalance ?? c.xeroGross ?? 0;
        if (ageDays <= 30) aging.current += owed;
        else if (ageDays <= 60) aging.days30 += owed;
        else if (ageDays <= 90) aging.days60 += owed;
        else if (ageDays <= 120) aging.days90 += owed;
        else aging.days120Plus += owed;
      }
    }

    return {
      success: true,
      data: {
        supplier,
        period: {
          startDate: startDate?.toISOString() ?? null,
          endDate: endDate.toISOString(),
        },
        summary: {
          openingBalance: Math.round(openingBalance * 100) / 100,
          totalDebit: Math.round(txs.reduce((s, t) => s + t.debit, 0) * 100) / 100,
          totalCredit: Math.round(txs.reduce((s, t) => s + t.credit, 0) * 100) / 100,
          closingBalance,
          transactionCount: txs.length,
        },
        transactions: txs,
        aging: Object.fromEntries(Object.entries(aging).map(([k, v]) => [k, Math.round(v * 100) / 100])),
      },
    };
  }

  // ====================================================================
  // Sales by Customer — aggregated totals across the period.
  // ====================================================================
  async salesByCustomer(organizationId: string, startDate?: string, endDate?: string) {
    const sd = startDate ? new Date(startDate) : new Date(0);
    const ed = endDate ? new Date(endDate) : new Date();
    const invoices = await this.prisma.document.findMany({
      where: {
        organizationId,
        type: 'INVOICE',
        config: { path: ['xeroImported'], equals: true },
      },
      select: { config: true },
    });

    const byCustomer = new Map<string, { name: string; invoiceCount: number; totalSales: number; totalPaid: number; outstanding: number }>();
    for (const inv of invoices) {
      const c: any = inv.config || {};
      const date = c.date ? new Date(c.date) : null;
      if (date && (date < sd || date > ed)) continue;
      const cId = c.customerId || c.customer?.id || 'unknown';
      const cName = c.customer?.name || 'Unknown customer';
      const gross = c.xeroGross || 0;
      const balance = c.xeroBalance || 0;
      const paid = gross - balance;
      const row = byCustomer.get(cId) || { name: cName, invoiceCount: 0, totalSales: 0, totalPaid: 0, outstanding: 0 };
      row.invoiceCount++;
      row.totalSales += gross;
      row.totalPaid += paid;
      row.outstanding += balance;
      byCustomer.set(cId, row);
    }

    const rows = Array.from(byCustomer.entries())
      .map(([id, r]) => ({ customerId: id, ...r, totalSales: Math.round(r.totalSales * 100) / 100, totalPaid: Math.round(r.totalPaid * 100) / 100, outstanding: Math.round(r.outstanding * 100) / 100 }))
      .sort((a, b) => b.totalSales - a.totalSales);

    const totals = rows.reduce(
      (s, r) => ({
        totalSales: s.totalSales + r.totalSales,
        totalPaid: s.totalPaid + r.totalPaid,
        outstanding: s.outstanding + r.outstanding,
        invoiceCount: s.invoiceCount + r.invoiceCount,
      }),
      { totalSales: 0, totalPaid: 0, outstanding: 0, invoiceCount: 0 },
    );

    return {
      success: true,
      data: {
        period: { startDate: sd.toISOString(), endDate: ed.toISOString() },
        rows,
        totals: {
          totalSales: Math.round(totals.totalSales * 100) / 100,
          totalPaid: Math.round(totals.totalPaid * 100) / 100,
          outstanding: Math.round(totals.outstanding * 100) / 100,
          invoiceCount: totals.invoiceCount,
        },
      },
    };
  }

  // ====================================================================
  // Purchases by Supplier — symmetric to salesByCustomer.
  // ====================================================================
  async purchasesBySupplier(organizationId: string, startDate?: string, endDate?: string) {
    const sd = startDate ? new Date(startDate) : new Date(0);
    const ed = endDate ? new Date(endDate) : new Date();
    const bills = await this.prisma.document.findMany({
      where: { organizationId, type: 'BILL', config: { path: ['xeroImported'], equals: true } },
      select: { config: true },
    });

    const bySupplier = new Map<string, { name: string; billCount: number; totalPurchases: number; totalPaid: number; outstanding: number }>();
    for (const b of bills) {
      const c: any = b.config || {};
      const date = c.date ? new Date(c.date) : null;
      if (date && (date < sd || date > ed)) continue;
      const sId = c.supplierId || c.supplier?.id || 'unknown';
      const sName = c.supplier?.name || 'Unknown supplier';
      const gross = c.xeroGross || 0;
      const balance = c.xeroBalance || 0;
      const paid = gross - balance;
      const row = bySupplier.get(sId) || { name: sName, billCount: 0, totalPurchases: 0, totalPaid: 0, outstanding: 0 };
      row.billCount++;
      row.totalPurchases += gross;
      row.totalPaid += paid;
      row.outstanding += balance;
      bySupplier.set(sId, row);
    }

    const rows = Array.from(bySupplier.entries())
      .map(([id, r]) => ({ supplierId: id, ...r, totalPurchases: Math.round(r.totalPurchases * 100) / 100, totalPaid: Math.round(r.totalPaid * 100) / 100, outstanding: Math.round(r.outstanding * 100) / 100 }))
      .sort((a, b) => b.totalPurchases - a.totalPurchases);

    const totals = rows.reduce(
      (s, r) => ({
        totalPurchases: s.totalPurchases + r.totalPurchases,
        totalPaid: s.totalPaid + r.totalPaid,
        outstanding: s.outstanding + r.outstanding,
        billCount: s.billCount + r.billCount,
      }),
      { totalPurchases: 0, totalPaid: 0, outstanding: 0, billCount: 0 },
    );

    return {
      success: true,
      data: {
        period: { startDate: sd.toISOString(), endDate: ed.toISOString() },
        rows,
        totals: {
          totalPurchases: Math.round(totals.totalPurchases * 100) / 100,
          totalPaid: Math.round(totals.totalPaid * 100) / 100,
          outstanding: Math.round(totals.outstanding * 100) / 100,
          billCount: totals.billCount,
        },
      },
    };
  }
}
