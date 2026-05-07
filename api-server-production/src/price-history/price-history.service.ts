import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { Prisma } from '@prisma/client';

@Injectable()
export class PriceHistoryService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Save price history when a document (invoice) is confirmed.
   *
   * Handles both AIMS modes:
   *   - Asset Tracking ON  → item.inventoryItemId points at an Inventory row whose assetId we use.
   *   - Asset Tracking OFF → item.inventoryItemId points directly at an Asset row.
   * Also tolerates two config shapes for customer/date (nested vs. top-level).
   */
  async savePriceHistoryFromDocument(documentId: string, organizationId: string) {
    try {
      const document = await this.prisma.document.findFirst({
        where: {
          id: documentId,
          organizationId,
          type: { in: ['INVOICE', 'TI', 'TI2'] },
        },
      });

      if (!document) {
        throw new HttpException('Document not found', HttpStatus.NOT_FOUND);
      }

      const config: any = document.config;
      const items = config?.items || [];

      // Customer can live at config.customer.{id,name} OR config.customerId/customerName.
      const customerId: string | null = config?.customer?.id ?? config?.customerId ?? null;
      const customerName: string | null = config?.customer?.name ?? config?.customerName ?? null;

      // Date can live at config.documentInfo.date OR config.date OR config.invoiceDate.
      const rawDate = config?.documentInfo?.date ?? config?.date ?? config?.invoiceDate ?? new Date();
      const documentDate = new Date(rawDate);
      const documentNumber = document.name || config?.documentInfo?.documentNumber || config?.documentNumber || '';

      console.log('[priceHistory] savePriceHistoryFromDocument', {
        documentId,
        documentNumber,
        itemCount: items.length,
        customerId,
        customerName,
        documentDate,
      });

      const priceHistoryEntries = await Promise.all(
        items
          .filter((item: any) => item.inventoryItemId || item.assetId)
          .map(async (item: any) => {
            // Resolve the asset id, regardless of whether inventoryItemId points at
            // an Inventory row (tracked mode) or an Asset row (products mode).
            let assetId: string | null = item.assetId || null;

            if (!assetId && item.inventoryItemId) {
              const inv = await this.prisma.inventory.findUnique({
                where: { id: item.inventoryItemId },
                select: { assetId: true },
              });
              if (inv?.assetId) {
                assetId = inv.assetId;
              } else {
                // Maybe inventoryItemId is actually an Asset id (products mode).
                const asset = await this.prisma.asset.findUnique({
                  where: { id: item.inventoryItemId },
                  select: { id: true },
                });
                if (asset) assetId = asset.id;
              }
            }

            if (!assetId) {
              console.warn(`[priceHistory] could not resolve assetId for item`, {
                inventoryItemId: item.inventoryItemId,
                sku: item.sku,
              });
              return null;
            }

            const qty = parseFloat(item.quantity) || 0;
            const unit = parseFloat(item.unitPrice) || 0;

            return {
              assetId,
              unitPrice: unit,
              quantity: qty,
              uom: item.uom || 'PC',
              totalAmount: parseFloat(item.amount) || unit * qty || 0,
              documentId,
              documentNumber,
              documentDate,
              customerId,
              customerName,
              organizationId,
            };
          }),
      );

      const validEntries = priceHistoryEntries.filter((e) => e !== null);
      console.log(`[priceHistory] saving ${validEntries.length}/${items.length} entries`);

      if (validEntries.length > 0) {
        await this.prisma.priceHistory.createMany({ data: validEntries });
      }

      return {
        success: true,
        message: `Price history saved for ${validEntries.length} items`,
      };
    } catch (error) {
      throw new HttpException(
        `Failed to save price history: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get last sold price for an asset by assetId
   */
  async getLastSoldPrice(assetId: string, organizationId: string, customerId?: string) {
    try {
      const where: Prisma.PriceHistoryWhereInput = {
        assetId,
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
   * Get price history for an asset by assetId
   */
  async getPriceHistory(
    assetId: string,
    organizationId: string,
    options?: {
      customerId?: string;
      limit?: number;
      offset?: number;
    },
  ) {
    try {
      const where: Prisma.PriceHistoryWhereInput = {
        assetId,
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
        // Find asset by SKU and filter by assetId
        const asset = await this.prisma.asset.findFirst({
          where: {
            skuKey: options.itemCode,
            organizationId: organizationId,
            deletedAt: null,
          },
          select: { id: true },
        });
        if (asset) {
          where.assetId = asset.id;
        } else {
          // No matching asset, return empty results
          return {
            data: [],
            total: 0,
            page: options?.page || 1,
            limit: options?.limit || 25,
          };
        }
      }

      if (options?.search) {
        // Search in asset name, SKU, and description
        where.asset = {
          OR: [
            { skuKey: { contains: options.search, mode: 'insensitive' } },
            { name: { contains: options.search, mode: 'insensitive' } },
            { description: { contains: options.search, mode: 'insensitive' } },
          ],
        };
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

      // Query with asset relation
      const [priceHistory, total] = await Promise.all([
        this.prisma.priceHistory.findMany({
          where,
          orderBy: [
            { documentDate: 'desc' },
          ],
          take: limit,
          skip: offset,
          select: {
            id: true,
            unitPrice: true,
            quantity: true,
            uom: true,
            totalAmount: true,
            documentNumber: true,
            documentDate: true,
            customerName: true,
            customerId: true,
            organizationId: true,
            createdAt: true,
            asset: {
              select: {
                skuKey: true,
                name: true,
                description: true,
              },
            },
          },
        }),
        this.prisma.priceHistory.count({ where }),
      ]);

      // Map to include itemCode and itemDescription from asset
      const mappedData = priceHistory.map(item => ({
        ...item,
        itemCode: item.asset.skuKey,
        itemDescription: item.asset.name || item.asset.description,
      }));

      return {
        data: mappedData,
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
        // Find asset by SKU and filter by assetId
        const asset = await this.prisma.asset.findFirst({
          where: {
            skuKey: options.itemCode,
            organizationId: organizationId,
            deletedAt: null,
          },
          select: { id: true },
        });
        if (asset) {
          where.assetId = asset.id;
        } else {
          // No matching asset, return empty results
          return {
            content: '',
            filename: `price-history-${new Date().toISOString().split('T')[0]}.csv`,
            contentType: 'text/csv',
          };
        }
      }

      if (options?.search) {
        // Search in asset name, SKU, and description
        where.asset = {
          OR: [
            { skuKey: { contains: options.search, mode: 'insensitive' } },
            { name: { contains: options.search, mode: 'insensitive' } },
            { description: { contains: options.search, mode: 'insensitive' } },
          ],
        };
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
          { documentDate: 'desc' },
        ],
        select: {
          unitPrice: true,
          quantity: true,
          uom: true,
          totalAmount: true,
          documentNumber: true,
          documentDate: true,
          customerName: true,
          asset: {
            select: {
              skuKey: true,
              name: true,
              description: true,
            },
          },
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
          item.asset.skuKey,
          item.asset.name || item.asset.description || '',
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

      // For other formats, return the raw data with mapped fields
      const mappedData = priceHistory.map(item => ({
        itemCode: item.asset.skuKey,
        itemDescription: item.asset.name || item.asset.description,
        unitPrice: item.unitPrice,
        quantity: item.quantity,
        uom: item.uom,
        totalAmount: item.totalAmount,
        documentNumber: item.documentNumber,
        documentDate: item.documentDate,
        customerName: item.customerName,
      }));

      return {
        data: mappedData,
        total: mappedData.length,
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