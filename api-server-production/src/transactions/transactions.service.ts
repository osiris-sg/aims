import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { Prisma, TransactionType } from '@prisma/client';

@Injectable()
export class TransactionsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create a manual transaction (for adjustments, opening balances, etc.)
   */
  async create(createTransactionDto: CreateTransactionDto, organizationId: string) {
    try {
      // Validate customer exists
      const customer = await this.prisma.customer.findFirst({
        where: {
          id: createTransactionDto.customerId,
          organizationId,
        },
      });

      if (!customer) {
        throw new HttpException('Customer not found', HttpStatus.NOT_FOUND);
      }

      // Get customer balance
      let customerBalance = await this.prisma.customerBalance.findFirst({
        where: {
          customerId: createTransactionDto.customerId,
          organizationId,
        },
      });

      // Create customer balance if it doesn't exist
      if (!customerBalance) {
        customerBalance = await this.prisma.customerBalance.create({
          data: {
            organizationId,
            customerId: createTransactionDto.customerId,
            openingBalance: 0,
            currentBalance: 0,
          },
        });
      }

      // Calculate new balance
      const debit = createTransactionDto.debit || 0;
      const credit = createTransactionDto.credit || 0;
      const newBalance = customerBalance.currentBalance + debit - credit;

      // Create transaction in a transaction (atomic operation)
      const result = await this.prisma.$transaction(async (tx) => {
        const transaction = await tx.transaction.create({
          data: {
            organizationId,
            customerId: createTransactionDto.customerId,
            transactionType: createTransactionDto.transactionType,
            documentId: createTransactionDto.documentId,
            transactionDate: new Date(createTransactionDto.transactionDate),
            reference: createTransactionDto.reference,
            description: createTransactionDto.description,
            debit,
            credit,
            balance: newBalance,
          },
          include: {
            customer: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        });

        // Update customer balance
        await tx.customerBalance.update({
          where: { id: customerBalance.id },
          data: {
            currentBalance: newBalance,
            lastTransactionDate: new Date(createTransactionDto.transactionDate),
            // If this is an opening balance, also set it
            ...(createTransactionDto.transactionType === TransactionType.OPENING_BALANCE && {
              openingBalance: newBalance,
            }),
          },
        });

        return transaction;
      });

      return {
        success: true,
        data: result,
        message: 'Transaction created successfully',
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        `Failed to create transaction: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get all transactions with optional filters
   */
  async findAll(
    organizationId: string,
    options?: {
      customerId?: string;
      transactionType?: TransactionType;
      startDate?: Date;
      endDate?: Date;
      page?: number;
      limit?: number;
    },
  ) {
    try {
      const where: Prisma.TransactionWhereInput = {
        organizationId,
      };

      if (options?.customerId) {
        where.customerId = options.customerId;
      }

      if (options?.transactionType) {
        where.transactionType = options.transactionType;
      }

      if (options?.startDate || options?.endDate) {
        where.transactionDate = {};
        if (options.startDate) {
          where.transactionDate.gte = options.startDate;
        }
        if (options.endDate) {
          where.transactionDate.lte = options.endDate;
        }
      }

      const limit = options?.limit || 50;
      const offset = ((options?.page || 1) - 1) * limit;

      const [transactions, total] = await Promise.all([
        this.prisma.transaction.findMany({
          where,
          orderBy: {
            transactionDate: 'desc',
          },
          take: limit,
          skip: offset,
          include: {
            customer: {
              select: {
                id: true,
                name: true,
              },
            },
            document: {
              select: {
                id: true,
                name: true,
                type: true,
              },
            },
          },
        }),
        this.prisma.transaction.count({ where }),
      ]);

      return {
        data: transactions,
        total,
        page: options?.page || 1,
        limit,
      };
    } catch (error) {
      throw new HttpException(
        `Failed to fetch transactions: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get transactions for a specific customer (for Statement of Account)
   */
  async findByCustomer(
    customerId: string,
    organizationId: string,
    options?: {
      startDate?: Date;
      endDate?: Date;
    },
  ) {
    try {
      const where: Prisma.TransactionWhereInput = {
        customerId,
        organizationId,
      };

      if (options?.startDate || options?.endDate) {
        where.transactionDate = {};
        if (options.startDate) {
          where.transactionDate.gte = options.startDate;
        }
        if (options.endDate) {
          where.transactionDate.lte = options.endDate;
        }
      }

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
          customerId,
          organizationId,
        },
      });

      return {
        transactions,
        currentBalance: customerBalance?.currentBalance || 0,
        openingBalance: customerBalance?.openingBalance || 0,
      };
    } catch (error) {
      throw new HttpException(
        `Failed to fetch customer transactions: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get transaction by ID
   */
  async findOne(id: string, organizationId: string) {
    try {
      const transaction = await this.prisma.transaction.findFirst({
        where: {
          id,
          organizationId,
        },
        include: {
          customer: true,
          document: true,
          payment: true,
        },
      });

      if (!transaction) {
        throw new HttpException('Transaction not found', HttpStatus.NOT_FOUND);
      }

      return transaction;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        `Failed to fetch transaction: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Delete a transaction (only manual ones, not auto-generated from invoices/payments)
   */
  async remove(id: string, organizationId: string) {
    try {
      const transaction = await this.prisma.transaction.findFirst({
        where: {
          id,
          organizationId,
        },
      });

      if (!transaction) {
        throw new HttpException('Transaction not found', HttpStatus.NOT_FOUND);
      }

      // Don't allow deleting auto-generated transactions
      if (transaction.documentId || transaction.paymentId) {
        throw new HttpException(
          'Cannot delete auto-generated transactions. Delete the source document or payment instead.',
          HttpStatus.BAD_REQUEST,
        );
      }

      await this.prisma.transaction.delete({
        where: { id },
      });

      return {
        success: true,
        message: 'Transaction deleted successfully',
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        `Failed to delete transaction: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Recalculate all transaction balances for a customer
   * Useful when correcting data or after bulk imports
   */
  async recalculateCustomerBalances(customerId: string, organizationId: string) {
    try {
      // Get all transactions for the customer ordered by date
      const transactions = await this.prisma.transaction.findMany({
        where: {
          customerId,
          organizationId,
        },
        orderBy: {
          transactionDate: 'asc',
        },
      });

      // Get customer balance
      const customerBalance = await this.prisma.customerBalance.findFirst({
        where: {
          customerId,
          organizationId,
        },
      });

      if (!customerBalance) {
        throw new HttpException('Customer balance not found', HttpStatus.NOT_FOUND);
      }

      // Recalculate balances
      let runningBalance = customerBalance.openingBalance;

      for (const transaction of transactions) {
        runningBalance += transaction.debit - transaction.credit;

        // Update transaction balance
        await this.prisma.transaction.update({
          where: { id: transaction.id },
          data: { balance: runningBalance },
        });
      }

      // Update customer balance
      await this.prisma.customerBalance.update({
        where: { id: customerBalance.id },
        data: { currentBalance: runningBalance },
      });

      return {
        success: true,
        message: 'Customer balances recalculated successfully',
        openingBalance: customerBalance.openingBalance,
        currentBalance: runningBalance,
        transactionsProcessed: transactions.length,
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        `Failed to recalculate balances: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
