import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { UpdatePaymentDto } from './dto/update-payment.dto';
import { Prisma, TransactionType, DocumentStatus } from '@prisma/client';
import { JournalAutoPostService } from '../journal/journal-auto-post.service';

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly journalAutoPost: JournalAutoPostService,
  ) {}

  /**
   * Create a new payment record and corresponding transaction
   */
  async create(createPaymentDto: CreatePaymentDto, organizationId: string, userId: string) {
    try {
      // Validate the document exists and is an invoice
      const document = await this.prisma.document.findFirst({
        where: {
          id: createPaymentDto.documentId,
          organizationId,
          type: {
            in: ['INVOICE', 'TI', 'TI2'], // Only allow payments for invoices
          },
        },
      });

      if (!document) {
        throw new HttpException('Invoice not found', HttpStatus.NOT_FOUND);
      }

      // Validate customer matches
      const config: any = document.config;
      if (config.customer?.id !== createPaymentDto.customerId) {
        throw new HttpException('Customer does not match invoice', HttpStatus.BAD_REQUEST);
      }

      // Create payment and transaction in a transaction
      const result = await this.prisma.$transaction(async (tx) => {
        // Create the payment record
        const stampedAttachments = (createPaymentDto.attachments || []).map((a) => ({
          ...a,
          uploadedAt: new Date().toISOString(),
          uploadedBy: userId,
        }));
        const payment = await tx.payment.create({
          data: {
            organizationId,
            customerId: createPaymentDto.customerId,
            documentId: createPaymentDto.documentId,
            amount: createPaymentDto.amount,
            paymentDate: new Date(createPaymentDto.paymentDate),
            paymentMethod: createPaymentDto.paymentMethod,
            reference: createPaymentDto.reference,
            notes: createPaymentDto.notes,
            attachments: stampedAttachments.length ? (stampedAttachments as any) : undefined,
            createdBy: userId,
          },
          include: {
            customer: true,
            document: true,
          },
        });

        // Get customer's current balance
        let customerBalance = await tx.customerBalance.findFirst({
          where: {
            customerId: createPaymentDto.customerId,
            organizationId,
          },
        });

        // Create customer balance if it doesn't exist
        if (!customerBalance) {
          customerBalance = await tx.customerBalance.create({
            data: {
              organizationId,
              customerId: createPaymentDto.customerId,
              openingBalance: 0,
              currentBalance: 0,
            },
          });
        }

        // Calculate new balance (credit reduces the balance)
        const newBalance = customerBalance.currentBalance - createPaymentDto.amount;

        // Create transaction record
        const transaction = await tx.transaction.create({
          data: {
            organizationId,
            customerId: createPaymentDto.customerId,
            transactionType: TransactionType.PAYMENT,
            documentId: createPaymentDto.documentId,
            paymentId: payment.id,
            transactionDate: new Date(createPaymentDto.paymentDate),
            reference: createPaymentDto.reference || `Payment for ${document.name}`,
            description: `Payment received - ${createPaymentDto.paymentMethod}${createPaymentDto.reference ? ` (Ref: ${createPaymentDto.reference})` : ''}`,
            debit: 0,
            credit: createPaymentDto.amount,
            balance: newBalance,
          },
        });

        // Update customer balance
        await tx.customerBalance.update({
          where: { id: customerBalance.id },
          data: {
            currentBalance: newBalance,
            lastTransactionDate: new Date(createPaymentDto.paymentDate),
          },
        });

        return { payment, transaction };
      });

      // Auto-update invoice status based on payments
      await this.updateInvoiceStatusAfterPayment(createPaymentDto.documentId, organizationId);

      // Auto-post the payment to the General Ledger (best-effort).
      try {
        await this.journalAutoPost.postFromPayment({
          organizationId,
          paymentId: result.payment.id,
          documentId: createPaymentDto.documentId,
          paymentReference: createPaymentDto.reference,
          paymentMethod: createPaymentDto.paymentMethod,
          paymentDate: new Date(createPaymentDto.paymentDate),
          customerName: result.payment.customer?.name,
          amount: createPaymentDto.amount,
          userId,
        });
        console.log('✅ Journal entry auto-posted for payment:', result.payment.id);
      } catch (e) {
        console.error('Failed to auto-post journal entry for payment:', e);
        // Never fail the payment on a posting failure.
      }

      return {
        success: true,
        data: result.payment,
        message: 'Payment recorded successfully',
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        `Failed to create payment: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get all payments for an organization with optional filters
   */
  async findAll(
    organizationId: string,
    options?: {
      customerId?: string;
      startDate?: Date;
      endDate?: Date;
      paymentMethod?: string;
      page?: number;
      limit?: number;
    },
  ) {
    try {
      const where: Prisma.PaymentWhereInput = {
        organizationId,
      };

      if (options?.customerId) {
        where.customerId = options.customerId;
      }

      if (options?.paymentMethod) {
        where.paymentMethod = options.paymentMethod;
      }

      if (options?.startDate || options?.endDate) {
        where.paymentDate = {};
        if (options.startDate) {
          where.paymentDate.gte = options.startDate;
        }
        if (options.endDate) {
          where.paymentDate.lte = options.endDate;
        }
      }

      const limit = options?.limit || 25;
      const offset = ((options?.page || 1) - 1) * limit;

      const [payments, total] = await Promise.all([
        this.prisma.payment.findMany({
          where,
          orderBy: {
            paymentDate: 'desc',
          },
          take: limit,
          skip: offset,
          include: {
            customer: {
              select: {
                id: true,
                name: true,
                email: true,
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
        this.prisma.payment.count({ where }),
      ]);

      return {
        data: payments,
        total,
        page: options?.page || 1,
        limit,
      };
    } catch (error) {
      throw new HttpException(
        `Failed to fetch payments: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get a single payment by ID
   */
  async findOne(id: string, organizationId: string) {
    try {
      const payment = await this.prisma.payment.findFirst({
        where: {
          id,
          organizationId,
        },
        include: {
          customer: true,
          document: true,
          transactions: true,
        },
      });

      if (!payment) {
        throw new HttpException('Payment not found', HttpStatus.NOT_FOUND);
      }

      return payment;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        `Failed to fetch payment: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get payments for a specific document
   */
  // Batched payment summary for a list of documents — used by the AR
  // workspace to enrich the invoice list with totalPaid / outstanding / last
  // payment date without N+1 queries.
  async summaryByDocuments(documentIds: string[], organizationId: string) {
    if (!documentIds?.length) return {};
    const payments = await this.prisma.payment.findMany({
      where: { documentId: { in: documentIds }, organizationId },
      select: { documentId: true, amount: true, paymentDate: true },
    });
    const out: Record<
      string,
      { totalPaid: number; paymentCount: number; lastPaymentDate: string | null }
    > = {};
    for (const id of documentIds) {
      out[id] = { totalPaid: 0, paymentCount: 0, lastPaymentDate: null };
    }
    for (const p of payments) {
      const row = out[p.documentId];
      if (!row) continue;
      row.totalPaid += p.amount;
      row.paymentCount += 1;
      const d = p.paymentDate.toISOString();
      if (!row.lastPaymentDate || d > row.lastPaymentDate) row.lastPaymentDate = d;
    }
    // Round totalPaid to 2dp so floats stop being floats.
    for (const id of documentIds) {
      out[id].totalPaid = Math.round(out[id].totalPaid * 100) / 100;
    }
    return out;
  }

  async findByDocument(documentId: string, organizationId: string) {
    try {
      const payments = await this.prisma.payment.findMany({
        where: {
          documentId,
          organizationId,
        },
        orderBy: {
          paymentDate: 'desc',
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

      const totalPaid = payments.reduce((sum, payment) => sum + payment.amount, 0);

      return {
        payments,
        totalPaid,
        count: payments.length,
      };
    } catch (error) {
      throw new HttpException(
        `Failed to fetch document payments: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Update a payment record
   */
  async update(id: string, updatePaymentDto: UpdatePaymentDto, organizationId: string) {
    try {
      // Check if payment exists
      const existingPayment = await this.prisma.payment.findFirst({
        where: {
          id,
          organizationId,
        },
      });

      if (!existingPayment) {
        throw new HttpException('Payment not found', HttpStatus.NOT_FOUND);
      }

      // Update payment in a transaction to also update related transaction
      const result = await this.prisma.$transaction(async (tx) => {
        const payment = await tx.payment.update({
          where: { id },
          data: {
            amount: updatePaymentDto.amount,
            paymentDate: updatePaymentDto.paymentDate ? new Date(updatePaymentDto.paymentDate) : undefined,
            paymentMethod: updatePaymentDto.paymentMethod,
            reference: updatePaymentDto.reference,
            notes: updatePaymentDto.notes,
          },
          include: {
            customer: true,
            document: true,
          },
        });

        // Update the related transaction if amount or date changed
        if (updatePaymentDto.amount !== undefined || updatePaymentDto.paymentDate !== undefined) {
          await tx.transaction.updateMany({
            where: {
              paymentId: id,
              organizationId,
            },
            data: {
              credit: updatePaymentDto.amount,
              transactionDate: updatePaymentDto.paymentDate ? new Date(updatePaymentDto.paymentDate) : undefined,
            },
          });

          // Recalculate customer balance
          // TODO: Implement balance recalculation logic
        }

        return payment;
      });

      return {
        success: true,
        data: result,
        message: 'Payment updated successfully',
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        `Failed to update payment: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Delete a payment record
   */
  async remove(id: string, organizationId: string) {
    try {
      // Check if payment exists
      const payment = await this.prisma.payment.findFirst({
        where: {
          id,
          organizationId,
        },
      });

      if (!payment) {
        throw new HttpException('Payment not found', HttpStatus.NOT_FOUND);
      }

      // Delete payment and related transactions in a transaction
      await this.prisma.$transaction(async (tx) => {
        // Delete related transactions
        await tx.transaction.deleteMany({
          where: {
            paymentId: id,
            organizationId,
          },
        });

        // Delete the payment
        await tx.payment.delete({
          where: { id },
        });

        // Recalculate customer balance
        // TODO: Implement balance recalculation logic
      });

      return {
        success: true,
        message: 'Payment deleted successfully',
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        `Failed to delete payment: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Automatically update invoice status based on payment amounts
   * Called after creating or updating payments
   */
  private async updateInvoiceStatusAfterPayment(documentId: string, organizationId: string) {
    try {
      // Get the document
      const document = await this.prisma.document.findFirst({
        where: {
          id: documentId,
          organizationId,
        },
      });

      if (!document) {
        return; // Silently return if document not found
      }

      // Only process invoices
      const invoiceTypes = ['INVOICE', 'TI', 'TI2'];
      if (!invoiceTypes.includes(document.type)) {
        return; // Not an invoice, skip status update
      }

      // Don't update if already paid
      if (document.status === DocumentStatus.paid) {
        return;
      }

      // Calculate invoice total from config.items
      const config: any = document.config;
      const items = config?.items || [];

      const invoiceAmount = items.reduce((sum: number, item: any) => {
        const amount =
          parseFloat(item.amount) ||
          (parseFloat(item.quantity) * parseFloat(item.unitPrice)) ||
          0;
        return sum + amount;
      }, 0);

      // Get all payments for this document
      const payments = await this.prisma.payment.findMany({
        where: {
          documentId,
          organizationId,
        },
      });

      // Calculate total paid
      const totalPaid = payments.reduce((sum, payment) => {
        return sum + parseFloat(payment.amount.toString());
      }, 0);

      // Determine new status based on payment coverage
      let newStatus: DocumentStatus | null = null;

      if (totalPaid >= invoiceAmount) {
        // Fully paid
        newStatus = DocumentStatus.paid;
      } else if (totalPaid > 0) {
        // Partially paid
        newStatus = DocumentStatus.pending_payment;
      }

      // Update invoice status if needed
      if (newStatus && newStatus !== document.status) {
        await this.prisma.document.update({
          where: { id: documentId },
          data: { status: newStatus },
        });

        console.log(`✅ Invoice ${document.name} status updated to ${newStatus} (Paid: ${totalPaid}/${invoiceAmount})`);
      }
    } catch (error) {
      // Log error but don't throw - this is a non-critical operation
      console.error('Error updating invoice status after payment:', error);
    }
  }
}
