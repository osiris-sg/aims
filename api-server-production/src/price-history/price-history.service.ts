import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { Prisma } from '@prisma/client';

@Injectable()
export class PriceHistoryService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Save price history when a document (invoice) is confirmed
   */
  async savePriceHistoryFromDocument(documentId: string, organizationId: string) {
    try {
      // Fetch the document with its config
      const document = await this.prisma.document.findFirst({
        where: {
          id: documentId,
          organizationId,
          type: {
            in: ['INVOICE', 'TI', 'TI2'] // Save price history for all invoice types
          }
        },
      });

      if (!document) {
        throw new HttpException('Document not found', HttpStatus.NOT_FOUND);
      }

      // Extract data from document config
      const config: any = document.config;
      const items = config.items || [];
      const customer = config.customer;
      const documentDate = config.documentInfo?.date || new Date();
      const documentNumber = document.name || config.documentInfo?.documentNumber;

      // Create price history entries for each item
      const priceHistoryEntries = items.map((item: any) => ({
        itemCode: item.itemCode || item.item || item.code || '',
        itemDescription: item.description || '',
        unitPrice: parseFloat(item.unitPrice) || 0,
        quantity: parseFloat(item.quantity) || 0,
        uom: item.uom || 'PC',
        totalAmount: parseFloat(item.amount) || (parseFloat(item.unitPrice) * parseFloat(item.quantity)) || 0,
        documentId: documentId,
        documentNumber: documentNumber,
        documentDate: new Date(documentDate),
        customerId: customer?.id || null,
        customerName: customer?.name || null,
        organizationId: organizationId,
      }));

      // Bulk create price history entries
      if (priceHistoryEntries.length > 0) {
        await this.prisma.priceHistory.createMany({
          data: priceHistoryEntries,
        });
      }

      return {
        success: true,
        message: `Price history saved for ${priceHistoryEntries.length} items`,
      };
    } catch (error) {
      throw new HttpException(
        `Failed to save price history: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get last sold price for an item
   */
  async getLastSoldPrice(itemCode: string, organizationId: string, customerId?: string) {
    try {
      const where: Prisma.PriceHistoryWhereInput = {
        itemCode,
        organizationId,
      };

      if (customerId) {
        where.customerId = customerId;
      }

      const lastPrice = await this.prisma.priceHistory.findFirst({
        where,
        orderBy: {
          documentDate: 'desc',
        },
        select: {
          unitPrice: true,
          documentNumber: true,
          documentDate: true,
          quantity: true,
          uom: true,
          customerName: true,
        },
      });

      return lastPrice;
    } catch (error) {
      throw new HttpException(
        `Failed to fetch last sold price: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get price history for an item
   */
  async getPriceHistory(
    itemCode: string,
    organizationId: string,
    options?: {
      customerId?: string;
      limit?: number;
      offset?: number;
    },
  ) {
    try {
      const where: Prisma.PriceHistoryWhereInput = {
        itemCode,
        organizationId,
      };

      if (options?.customerId) {
        where.customerId = options.customerId;
      }

      const [priceHistory, total] = await Promise.all([
        this.prisma.priceHistory.findMany({
          where,
          orderBy: {
            documentDate: 'desc',
          },
          take: options?.limit || 20,
          skip: options?.offset || 0,
          select: {
            id: true,
            unitPrice: true,
            quantity: true,
            uom: true,
            totalAmount: true,
            documentNumber: true,
            documentDate: true,
            customerName: true,
            itemDescription: true,
          },
        }),
        this.prisma.priceHistory.count({ where }),
      ]);

      return {
        data: priceHistory,
        total,
        limit: options?.limit || 20,
        offset: options?.offset || 0,
      };
    } catch (error) {
      throw new HttpException(
        `Failed to fetch price history: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get price history report for all items
   */
  async getPriceHistoryReport(
    organizationId: string,
    options?: {
      customerId?: string;
      itemCode?: string;
      startDate?: Date;
      endDate?: Date;
      search?: string;
      page?: number;
      limit?: number;
    },
  ) {
    try {
      const where: Prisma.PriceHistoryWhereInput = {
        organizationId,
      };

      if (options?.customerId) {
        where.customerId = options.customerId;
      }

      if (options?.itemCode) {
        where.itemCode = options.itemCode;
      }

      if (options?.search) {
        where.OR = [
          { itemCode: { contains: options.search, mode: 'insensitive' } },
          { itemDescription: { contains: options.search, mode: 'insensitive' } },
        ];
      }

      if (options?.startDate || options?.endDate) {
        where.documentDate = {};
        if (options.startDate) {
          where.documentDate.gte = options.startDate;
        }
        if (options.endDate) {
          where.documentDate.lte = options.endDate;
        }
      }

      // Calculate offset from page number
      const limit = options?.limit || 25;
      const offset = ((options?.page || 1) - 1) * limit;

      // For now, use regular Prisma query instead of raw SQL for better compatibility
      const [priceHistory, total] = await Promise.all([
        this.prisma.priceHistory.findMany({
          where,
          orderBy: [
            { itemCode: 'asc' },
            { documentDate: 'desc' },
          ],
          take: limit,
          skip: offset,
          select: {
            id: true,
            itemCode: true,
            itemDescription: true,
            unitPrice: true,
            quantity: true,
            uom: true,
            totalAmount: true,
            documentNumber: true,
            documentDate: true,
            customerName: true,
          },
        }),
        this.prisma.priceHistory.count({ where }),
      ]);

      return {
        data: priceHistory,
        total,
        page: options?.page || 1,
        limit,
      };
    } catch (error) {
      throw new HttpException(
        `Failed to generate price history report: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Delete price history for a document (when document is deleted)
   */
  async deletePriceHistoryForDocument(documentId: string, organizationId: string) {
    try {
      await this.prisma.priceHistory.deleteMany({
        where: {
          documentId,
          organizationId,
        },
      });

      return {
        success: true,
        message: 'Price history deleted for document',
      };
    } catch (error) {
      throw new HttpException(
        `Failed to delete price history: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Export price history data as CSV or Excel
   */
  async exportPriceHistory(
    organizationId: string,
    options?: {
      customerId?: string;
      itemCode?: string;
      startDate?: Date;
      endDate?: Date;
      search?: string;
      format?: string;
    },
  ) {
    try {
      const where: Prisma.PriceHistoryWhereInput = {
        organizationId,
      };

      if (options?.customerId) {
        where.customerId = options.customerId;
      }

      if (options?.itemCode) {
        where.itemCode = options.itemCode;
      }

      if (options?.search) {
        where.OR = [
          { itemCode: { contains: options.search, mode: 'insensitive' } },
          { itemDescription: { contains: options.search, mode: 'insensitive' } },
        ];
      }

      if (options?.startDate || options?.endDate) {
        where.documentDate = {};
        if (options.startDate) {
          where.documentDate.gte = options.startDate;
        }
        if (options.endDate) {
          where.documentDate.lte = options.endDate;
        }
      }

      // Get all matching records for export
      const priceHistory = await this.prisma.priceHistory.findMany({
        where,
        orderBy: [
          { itemCode: 'asc' },
          { documentDate: 'desc' },
        ],
        select: {
          itemCode: true,
          itemDescription: true,
          unitPrice: true,
          quantity: true,
          uom: true,
          totalAmount: true,
          documentNumber: true,
          documentDate: true,
          customerName: true,
        },
      });

      // Convert to CSV format
      if (options?.format === 'csv' || !options?.format) {
        const headers = [
          'Item Code',
          'Item Description',
          'Unit Price',
          'Quantity',
          'UOM',
          'Total Amount',
          'Document Number',
          'Document Date',
          'Customer Name',
        ];

        const rows = priceHistory.map((item) => [
          item.itemCode,
          item.itemDescription,
          item.unitPrice.toString(),
          item.quantity.toString(),
          item.uom || '',
          item.totalAmount.toString(),
          item.documentNumber,
          item.documentDate.toISOString().split('T')[0],
          item.customerName || '',
        ]);

        const csvContent = [
          headers.join(','),
          ...rows.map((row) => row.map((cell) => `"${cell}"`).join(',')),
        ].join('\n');

        return {
          content: csvContent,
          filename: `price-history-${new Date().toISOString().split('T')[0]}.csv`,
          contentType: 'text/csv',
        };
      }

      // For other formats, return the raw data
      return {
        data: priceHistory,
        total: priceHistory.length,
        format: options?.format || 'json',
      };
    } catch (error) {
      throw new HttpException(
        `Failed to export price history: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}