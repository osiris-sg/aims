import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { GenerateSOADto } from './dto/generate-soa.dto';
import { Prisma } from '@prisma/client';

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
   * Generate Statement of Account for a customer
   */
  async generateSOA(generateSOADto: GenerateSOADto, organizationId: string) {
    try {
      // Get customer details
      const customer = await this.prisma.customer.findFirst({
        where: {
          id: generateSOADto.customerId,
          organizationId,
        },
      });

      if (!customer) {
        throw new HttpException('Customer not found', HttpStatus.NOT_FOUND);
      }

      // Build transaction query
      const where: Prisma.TransactionWhereInput = {
        customerId: generateSOADto.customerId,
        organizationId,
      };

      if (generateSOADto.startDate || generateSOADto.endDate) {
        where.transactionDate = {};
        if (generateSOADto.startDate) {
          where.transactionDate.gte = new Date(generateSOADto.startDate);
        }
        if (generateSOADto.endDate) {
          where.transactionDate.lte = new Date(generateSOADto.endDate);
        }
      }

      // Get transactions
      const transactions = await this.prisma.transaction.findMany({
        where,
        orderBy: {
          transactionDate: 'asc',
        },
        include: {
          document: {
            select: {
              name: true,
              type: true,
            },
          },
          payment: {
            select: {
              paymentMethod: true,
              reference: true,
            },
          },
        },
      });

      // Get customer balance
      const customerBalance = await this.prisma.customerBalance.findFirst({
        where: {
          customerId: generateSOADto.customerId,
          organizationId,
        },
      });

      // Calculate opening balance (if date range specified)
      let openingBalance = 0;
      if (generateSOADto.startDate) {
        const priorTransactions = await this.prisma.transaction.findMany({
          where: {
            customerId: generateSOADto.customerId,
            organizationId,
            transactionDate: {
              lt: new Date(generateSOADto.startDate),
            },
          },
          orderBy: {
            transactionDate: 'desc',
          },
          take: 1,
        });

        if (priorTransactions.length > 0) {
          openingBalance = priorTransactions[0].balance;
        } else {
          openingBalance = customerBalance?.openingBalance || 0;
        }
      } else {
        openingBalance = customerBalance?.openingBalance || 0;
      }

      // Calculate current balance
      const currentBalance = customerBalance?.currentBalance || 0;

      // Generate aging analysis if requested
      let agingAnalysis: AgingBucket | null = null;
      if (generateSOADto.includeAging !== false) {
        agingAnalysis = await this.calculateAging(generateSOADto.customerId, organizationId);
      }

      // Group transactions by month for summary
      const monthlyBalances = this.groupTransactionsByMonth(transactions, openingBalance);

      // Format based on requested format
      if (generateSOADto.format === 'csv') {
        return this.generateCSV(customer, transactions, openingBalance, currentBalance, monthlyBalances);
      }

      // Default JSON format
      return {
        success: true,
        data: {
          customer: {
            id: customer.id,
            name: customer.name,
            email: customer.email,
            phone: customer.phone,
            address: customer.address,
          },
          statement: {
            openingBalance,
            currentBalance,
            totalDebit: transactions.reduce((sum, t) => sum + t.debit, 0),
            totalCredit: transactions.reduce((sum, t) => sum + t.credit, 0),
            transactionCount: transactions.length,
          },
          transactions: transactions.map(t => ({
            id: t.id,
            date: t.transactionDate,
            reference: t.reference || t.document?.name || 'N/A',
            description: t.description,
            transactionType: t.transactionType,
            debit: t.debit,
            credit: t.credit,
            balance: t.balance,
            documentType: t.document?.type,
            paymentMethod: t.payment?.paymentMethod,
          })),
          monthlyBalances,
          agingAnalysis,
          generatedAt: new Date(),
        },
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        `Failed to generate statement: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Calculate aging analysis for outstanding invoices
   */
  async calculateAging(customerId: string, organizationId: string): Promise<AgingBucket> {
    try {
      const today = new Date();
      const aging: AgingBucket = {
        current: 0,
        days30: 0,
        days60: 0,
        days90: 0,
        days120Plus: 0,
      };

      // Get all unpaid invoices (transactions with positive balance)
      const invoices = await this.prisma.transaction.findMany({
        where: {
          customerId,
          organizationId,
          transactionType: 'INVOICE',
        },
        orderBy: {
          transactionDate: 'asc',
        },
      });

      // For each invoice, calculate days outstanding and categorize
      for (const invoice of invoices) {
        const daysDiff = Math.floor(
          (today.getTime() - new Date(invoice.transactionDate).getTime()) / (1000 * 60 * 60 * 24),
        );

        // Determine which bucket this invoice falls into
        if (daysDiff <= 30) {
          aging.current += invoice.debit;
        } else if (daysDiff <= 60) {
          aging.days30 += invoice.debit;
        } else if (daysDiff <= 90) {
          aging.days60 += invoice.debit;
        } else if (daysDiff <= 120) {
          aging.days90 += invoice.debit;
        } else {
          aging.days120Plus += invoice.debit;
        }
      }

      return aging;
    } catch (error) {
      throw new HttpException(
        `Failed to calculate aging: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Group transactions by month and calculate monthly balances
   */
  private groupTransactionsByMonth(transactions: any[], openingBalance: number) {
    const monthlyMap = new Map<string, { debit: number; credit: number; balance: number }>();
    let runningBalance = openingBalance;

    for (const transaction of transactions) {
      const monthKey = new Date(transaction.transactionDate).toISOString().substring(0, 7); // YYYY-MM

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
        new Date(transaction.transactionDate).toLocaleDateString(),
        transaction.reference || transaction.document?.name || 'N/A',
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
      // Get all customers with balances
      const customers = await this.prisma.customer.findMany({
        where: {
          organizationId,
        },
        include: {
          customerBalance: true,
        },
      });

      const agingSummary = await Promise.all(
        customers
          .filter(c => c.customerBalance && c.customerBalance.currentBalance > 0)
          .map(async (customer) => {
            const aging = await this.calculateAging(customer.id, organizationId);
            return {
              customerId: customer.id,
              customerName: customer.name,
              currentBalance: customer.customerBalance.currentBalance,
              aging,
            };
          }),
      );

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
