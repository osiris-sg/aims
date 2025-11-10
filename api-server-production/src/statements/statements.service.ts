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
}
