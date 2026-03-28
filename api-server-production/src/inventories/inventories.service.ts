import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { CreateInventoryDto } from './dto/create-inventory.dto';
import { UpdateInventoryDto } from './dto/update-inventory.dto';
import { DeleteInventoryDto } from './dto/delete-inventory.dto';
import { GetInventoryDto } from './dto/get-inventory.dto';
import * as QRCode from 'qrcode';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from 'src/common/prisma.service';
import { InventoryStatus } from '@prisma/client';

@Injectable()
export class InventoriesService {
  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {}

  async getInventories(getInventoryDto: GetInventoryDto, organizationId: string) {
    try {
      const { page, limit, search, filters } = getInventoryDto;

      const skip = (page - 1) * limit;

      console.log('received category:', filters?.category);

      const whereClause: any = { organizationId };

      // Search filter
      if (search) {
        whereClause.OR = [{ sku: { contains: search, mode: 'insensitive' } }, { asset: { name: { contains: search, mode: 'insensitive' } } }];
      }

      // Date range filter
      if (filters?.createdOn?.startDate || filters?.createdOn?.endDate) {
        whereClause.createdAt = {};

        if (filters.createdOn.startDate) {
          whereClause.createdAt.gte = new Date(filters.createdOn.startDate);
        }

        if (filters.createdOn.endDate) {
          whereClause.createdAt.lte = new Date(filters.createdOn.endDate);
        }
      }

      // Status filter (supports array or single value)
      if (filters?.status) {
        const statusValues = Array.isArray(filters.status) ? filters.status.filter(s => s !== '') : [filters.status].filter(s => s !== '');
        if (statusValues.length === 1) {
          whereClause.status = statusValues[0] as InventoryStatus;
        } else if (statusValues.length > 1) {
          whereClause.status = { in: statusValues as InventoryStatus[] };
        }
      }

      // Category filter (supports array or single value)
      if (filters?.category) {
        const categoryValues = Array.isArray(filters.category) ? filters.category.filter(c => c !== '') : [filters.category].filter(c => c !== '');
        if (categoryValues.length === 1) {
          whereClause.category = categoryValues[0];
        } else if (categoryValues.length > 1) {
          whereClause.category = { in: categoryValues };
        }
      }

      // Asset filter
      if (filters?.assetId && filters.assetId !== '') {
        whereClause.assetId = filters.assetId;
      }

      const docs = await this.prisma.inventory.findMany({
        where: whereClause,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          asset: {
            select: {
              id: true,
              name: true,
              description: true,
              uom: true,
              price: true,
              category: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
        },
      });

      const totalDocs = await this.prisma.inventory.count({ where: whereClause });

      return {
        docs,
        hasNextPage: skip + docs.length < totalDocs,
        hasPreviousPage: page > 1,
        page,
        limit,
        totalPagesCount: Math.ceil(totalDocs / limit),
        totalDocuments: totalDocs,
      };
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async getInventoriesByStatus(organizationId: string, status?: string) {
    try {
      const inventories = await this.prisma.inventory.findMany({
        where: {
          organizationId,
          ...(status && {
            status: status as InventoryStatus,
          }),
        },
        orderBy: { createdAt: 'desc' },
        include: {
          asset: {
            select: {
              id: true,
              name: true,
              description: true,
              uom: true,
              price: true,
              category: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
        },
      });
      return inventories;
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async getInventoryById(id: string, organizationId: string) {
    try {
      return await this.prisma.inventory.findFirst({
        where: {
          id,
          organizationId,
        },
      });
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async getInventoryBySku(sku: string, organizationId: string) {
    try {
      return await this.prisma.inventory.findFirst({
        where: {
          sku,
          organizationId,
        },
      });
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async getInventoriesByAsset(assetId: string, organizationId: string) {
    try {
      const inventories = await this.prisma.inventory.findMany({
        where: {
          assetId,
          organizationId,
        },
        orderBy: { createdAt: 'desc' },
      });

      const statusCounts = inventories.reduce(
        (counts, inventory) => {
          if (inventory.status) {
            counts[inventory.status] = (counts[inventory.status] || 0) + 1;
          }
          return counts;
        },
        {
          [InventoryStatus.instock]: 0,
          [InventoryStatus.rental]: 0,
          [InventoryStatus.reserved]: 0,
          [InventoryStatus.maintenance]: 0,
          [InventoryStatus.sold]: 0,
        },
      );
      return { inventories, statusCounts };
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async getInventoriesByIds({ inventoryIds }: { inventoryIds: string[] }, organizationId: string) {
    try {
      return await this.prisma.inventory.findMany({
        where: {
          id: { in: inventoryIds },
          organizationId,
        },
        orderBy: { createdAt: 'desc' },
        include: {
          asset: {
            select: {
              id: true,
              name: true,
              description: true,
              uom: true,
              price: true,
              category: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
        },
      });
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async generateSkuRange(assetId: string, quantity: number, organizationId: string) {
    try {
      const asset = await this.prisma.asset.findFirst({
        where: {
          id: assetId,
          organizationId,
        },
      });
      if (!asset) {
        throw new HttpException('Asset not found', HttpStatus.NOT_FOUND);
      }

      const skuKey = asset.skuKey || 'INV';

      const lastInventory = await this.prisma.inventory.findFirst({
        where: { assetId, organizationId, sku: { startsWith: `${skuKey}-` } },
        orderBy: { sku: 'desc' },
      });

      let startSkuNumber = 1;
      if (lastInventory && lastInventory.sku) {
        const lastSkuNumber = parseInt(lastInventory.sku.split('-').pop(), 10);
        if (!isNaN(lastSkuNumber)) {
          startSkuNumber = lastSkuNumber + 1;
        }
      }

      return Array.from({ length: quantity }, (_, i) => `${skuKey}-${(startSkuNumber + i).toString().padStart(3, '0')}`);
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async createInventories(createInventoryDto: CreateInventoryDto, organizationId: string) {
    try {
      const { assetId, quantity, status } = createInventoryDto;

      // Verify asset exists and is tracked
      const asset = await this.prisma.asset.findFirst({
        where: {
          id: assetId,
          organizationId,
        },
      });

      if (!asset) {
        throw new HttpException('Asset not found', HttpStatus.NOT_FOUND);
      }


      // Use custom SKU if provided, otherwise auto-generate
      const skuRange = createInventoryDto.customSku
        ? createInventoryDto.customSku.split(',').map(s => s.trim()).filter(Boolean)
        : await this.generateSkuRange(assetId, quantity, organizationId);

      const inventoryItems = skuRange.map((sku) => ({
        ...createInventoryDto,
        assetId,
        sku,
        organizationId, // Automatically assign to user's organization
        status: status as InventoryStatus,
      }));

      const createdItems = await this.prisma.inventory.createMany({
        data: inventoryItems,
        skipDuplicates: true,
      });

      // Auto-upgrade asset to tracked mode when inventory items are created
      if (!asset.isTracked) {
        await this.prisma.asset.update({
          where: { id: assetId },
          data: { isTracked: true },
        });
      }

      return { createdItems, skuRange, inventoryItems };
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async updateInventories(updateInventoryDto: UpdateInventoryDto, organizationId: string) {
    try {
      return await this.prisma.inventory.update({
        where: {
          id: updateInventoryDto.id,
          organizationId, // Ensure user can only update inventories in their organization
        },
        data: {
          ...updateInventoryDto,
          status: updateInventoryDto.status as InventoryStatus,
        },
      });
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async deleteInventories(deleteInventoryDto: DeleteInventoryDto, organizationId: string) {
    try {
      return await this.prisma.inventory.delete({
        where: {
          id: deleteInventoryDto.id,
          organizationId, // Ensure user can only delete inventories in their organization
        },
      });
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async generateQRCode(sku: string, organizationId: string) {
    try {
      // Verify the inventory belongs to the user's organization
      const inventory = await this.prisma.inventory.findFirst({
        where: {
          sku,
          organizationId,
        },
      });

      if (!inventory) {
        throw new HttpException('Inventory not found', HttpStatus.NOT_FOUND);
      }

      const baseUrl = this.configService.get<string>('APP_URL');
      const itemUrl = `${baseUrl}/scan/${sku}`;
      return { qrCode: await QRCode.toDataURL(itemUrl) };
    } catch (error) {
      throw new HttpException(`QR Code generation failed: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Get stock movement history for an item (inventory or asset)
   * Returns transaction history with Qty-In, Qty-Out, running balance, and associated documents
   * Uses DocumentItem junction table for efficient O(log n) queries instead of scanning all documents
   */
  async getStockMovementHistory(itemId: string, organizationId: string) {
    try {
      console.log('[StockMovements] getStockMovementHistory called with itemId:', itemId, 'orgId:', organizationId);

      // Document types that add stock (IN)
      const stockInTypes = ['PO', 'PURCHASE_ORDER', 'SAI', 'STOCK_ADJUSTMENT_IN'];
      // Document types that reduce stock (OUT)
      const stockOutTypes = ['DO', 'DELIVERY_ORDER', 'INVOICE', 'TI', 'TI2', 'SAO', 'STOCK_ADJUSTMENT_OUT', 'DN', 'DEBIT_NOTE'];

      // Get the initial stock quantity from inventory or asset
      const inventory = await this.prisma.inventory.findUnique({
        where: { id: itemId },
        include: { asset: true },
      });

      let initialQuantity = 0;
      let itemName = '';

      if (inventory) {
        // This is an inventory item (Asset Tracking ON)
        initialQuantity = inventory.quantity || 0;
        itemName = inventory.asset?.name || inventory.sku || '';
      } else {
        // Check if it's an asset (Asset Tracking OFF / Products mode)
        const asset = await this.prisma.asset.findUnique({
          where: { id: itemId },
        });
        if (asset) {
          initialQuantity = asset.quantity || 0;
          itemName = asset.name || asset.skuKey || '';
        }
      }

      // Use DocumentItem junction table for efficient query
      // This is O(log n) with index vs O(n) scanning all documents
      const documentItems = await this.prisma.documentItem.findMany({
        where: {
          itemId,
          document: {
            organizationId,
            status: { in: ['confirmed', 'delivered_not_installed', 'delivered_installed'] },
          },
        },
        include: {
          document: true,
        },
        orderBy: {
          createdAt: 'asc',
        },
      });

      console.log('[StockMovements] Found', documentItems.length, 'DocumentItem records for itemId:', itemId);

      // Build movements from DocumentItem records
      const movements: {
        reference: string;
        date: string;
        poNo: string;
        name: string;
        qtyIn: number;
        qtyOut: number;
        balance: number;
        priceOrCost: number;
        currency: string;
        documentId: string;
        documentType: string;
      }[] = [];

      let runningBalance = 0;

      for (const docItem of documentItems) {
        const doc = docItem.document;
        const config = doc.config as any;
        const quantity = docItem.quantity || 0;

        if (quantity === 0) continue;

        const isStockIn = stockInTypes.includes(doc.type);
        const isStockOut = stockOutTypes.includes(doc.type);

        if (!isStockIn && !isStockOut) continue;

        // quantity in DocumentItem is already signed (negative for out)
        const qtyIn = quantity > 0 ? quantity : 0;
        const qtyOut = quantity < 0 ? quantity : 0; // keep negative for display

        // Update running balance
        runningBalance = runningBalance + quantity;

        // Read from nested config paths
        const docDate = config?.documentInfo?.date || config?.date || doc.createdAt.toISOString().split('T')[0];
        const poNo = config?.documentInfo?.poNo || config?.poNo || config?.documentInfo?.referenceNo || config?.referenceNo || '';
        const customerName = config?.customer?.name || config?.customerName || config?.supplierName || '';
        const currency = config?.documentInfo?.currency || config?.currency || 'SGD';

        movements.push({
          reference: doc.name || doc.id.substring(0, 8),
          date: typeof docDate === 'string' ? docDate.split('T')[0] : docDate,
          poNo,
          name: customerName,
          qtyIn,
          qtyOut,
          balance: runningBalance,
          priceOrCost: docItem.unitPrice || 0,
          currency,
          documentId: doc.id,
          documentType: doc.type,
        });
      }

      // Sort by date (newest first for display)
      movements.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

      // Recalculate running balance from newest to oldest for display
      // The balance shown should be AFTER each transaction
      let displayBalance = initialQuantity;
      const displayMovements = movements.map((m) => {
        const movement = { ...m };
        const netChange = m.qtyIn - m.qtyOut;
        movement.balance = displayBalance;
        displayBalance = displayBalance - netChange; // Go backwards for next (older) transaction
        return movement;
      });

      return {
        itemId,
        itemName,
        currentBalance: initialQuantity,
        movements: displayMovements,
        totalMovements: displayMovements.length,
      };
    } catch (error) {
      console.error('Error getting stock movement history:', error);
      throw new HttpException(
        `Failed to get stock movement history: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get documents for an item grouped by document type
   * Returns invoices, delivery orders, debit notes, and credit notes
   */
  async getDocumentsForItem(itemId: string, organizationId: string) {
    try {
      console.log('[getDocumentsForItem] Fetching documents for itemId:', itemId);

      // Invoice types
      const invoiceTypes = ['INVOICE', 'TI', 'TI2'];
      // Delivery order types
      const deliveryOrderTypes = ['DO', 'DELIVERY_ORDER'];
      // Debit note types
      const debitNoteTypes = ['DN', 'DEBIT_NOTE'];
      // Credit note types
      const creditNoteTypes = ['CN', 'CREDIT_NOTE'];

      // Get all confirmed documents containing this item using DocumentItem junction table
      const documentItems = await this.prisma.documentItem.findMany({
        where: {
          itemId,
          document: {
            organizationId,
            status: 'confirmed',
          },
        },
        include: {
          document: true,
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      console.log('[getDocumentsForItem] Found', documentItems.length, 'DocumentItem records');

      // Helper to format document data
      const formatDocument = (docItem: any) => {
        const doc = docItem.document;
        const config = doc.config as any;
        return {
          documentId: doc.id,
          documentTemplateId: doc.documentTemplateId,
          documentType: doc.type,
          reference: doc.name || '',
          date: config?.date || config?.documentInfo?.date || doc.createdAt,
          customerName: config?.customerName || config?.customer?.name || config?.customer?.customerName || '',
          quantity: docItem.quantity || 0,
        };
      };

      // Group documents by type
      const invoices = documentItems
        .filter((di) => invoiceTypes.includes(di.document.type?.toUpperCase() || ''))
        .map(formatDocument);

      const deliveryOrders = documentItems
        .filter((di) => deliveryOrderTypes.includes(di.document.type?.toUpperCase() || ''))
        .map(formatDocument);

      const debitNotes = documentItems
        .filter((di) => debitNoteTypes.includes(di.document.type?.toUpperCase() || ''))
        .map(formatDocument);

      const creditNotes = documentItems
        .filter((di) => creditNoteTypes.includes(di.document.type?.toUpperCase() || ''))
        .map(formatDocument);

      // Calculate totals
      const totalInvoiceQty = invoices.reduce((sum, d) => sum + d.quantity, 0);
      const totalDeliveryOrderQty = deliveryOrders.reduce((sum, d) => sum + d.quantity, 0);
      const totalDebitNoteQty = debitNotes.reduce((sum, d) => sum + d.quantity, 0);
      const totalCreditNoteQty = creditNotes.reduce((sum, d) => sum + d.quantity, 0);

      return {
        invoices,
        deliveryOrders,
        debitNotes,
        creditNotes,
        totals: {
          invoiceQty: totalInvoiceQty,
          deliveryOrderQty: totalDeliveryOrderQty,
          debitNoteQty: totalDebitNoteQty,
          creditNoteQty: totalCreditNoteQty,
          totalSalesQty: totalInvoiceQty + totalDeliveryOrderQty + totalDebitNoteQty - totalCreditNoteQty,
        },
      };
    } catch (error) {
      console.error('Error getting documents for item:', error);
      throw new HttpException(
        `Failed to get documents for item: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
