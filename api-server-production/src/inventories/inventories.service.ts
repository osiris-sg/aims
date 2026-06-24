import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { CreateInventoryDto } from './dto/create-inventory.dto';
import { UpdateInventoryDto } from './dto/update-inventory.dto';
import { DeleteInventoryDto } from './dto/delete-inventory.dto';
import { GetInventoryDto } from './dto/get-inventory.dto';
import { CreateInventoryAndBindDto } from './dto/create-and-bind.dto';
import * as QRCode from 'qrcode';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from 'src/common/prisma.service';
import { InventoryStatus, Prisma } from '@prisma/client';

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

      // Tag-presence filter (tagged → has an NFC UID; untagged → none)
      if (filters?.tagStatus === 'tagged') {
        whereClause.nfcTagUid = { not: null };
      } else if (filters?.tagStatus === 'untagged') {
        whereClause.nfcTagUid = null;
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
              costPrice: true,
              customPrices: true,
              points: true,
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
              costPrice: true,
              customPrices: true,
              points: true,
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
              costPrice: true,
              customPrices: true,
              points: true,
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

  /**
   * Field create-and-bind. The tech has picked an existing Asset (SKU) and
   * scanned an unbound NFC tag. We create one Inventory unit under that
   * asset with the next sequential per-unit SKU and bind the tag to it.
   *
   * Asset creation is intentionally NOT available from the field — SKU /
   * catalog management is an office responsibility. If the asset doesn't
   * exist, the tech is sent back to the picker.
   *
   * Safety:
   *   - Tag conflict is checked against Inventory.nfcTagUid (UNIQUE in DB).
   *     A 409 here is preferred over the raw P2002 the DB would throw.
   *   - Per-unit SKU comes from generateSkuRange(), which parses the highest
   *     existing suffix rather than counting rows — survives deletions.
   *   - The org-scope filter on the asset lookup prevents cross-org binding.
   */
  /**
   * Create-and-bind with serial matching. If the typed serial already exists
   * under the chosen asset, bind the tag to THAT unit instead of minting a new
   * one; otherwise create new (the only path that generates a SKU). Backed by
   * the @@unique([serialNumber, assetId]) index (Inventory_serialNumber_assetId_key).
   *
   * Return shape (backward-compatible — the field UI reads `inventory.id` +
   * `asset.id`): { inventory, asset, action: 'created' | 'matched', idempotent? }.
   */
  async createAndBind(dto: CreateInventoryAndBindDto, organizationId: string) {
    const tag = dto.nfcTagUid?.trim();
    if (!tag) {
      throw new HttpException('NFC UID is required', HttpStatus.BAD_REQUEST);
    }

    // Resolve the chosen Asset first (org-scoped + soft-delete filter) — needed
    // for both the serial match and the create path. category is copied onto
    // Inventory.category (a String, distinct from Asset.categoryId).
    const asset = await this.prisma.asset.findFirst({
      where: { id: dto.assetId, organizationId, deletedAt: null },
      include: { category: { select: { name: true } } },
    });
    if (!asset) {
      throw new HttpException('Asset not found in this organization.', HttpStatus.NOT_FOUND);
    }

    // Who currently holds this tag? (nfcTagUid is globally @unique.) Used for
    // the conflict check — but exempted for the matched unit (idempotent path).
    const tagOwner = await this.prisma.inventory.findUnique({
      where: { nfcTagUid: tag },
      include: { asset: { select: { skuKey: true } } },
    });
    const tagConflictMessage = (owner: { sku: string; asset?: { skuKey?: string | null } | null }) =>
      `NFC tag is already bound to inventory ${owner.sku} (${owner.asset?.skuKey ?? 'unknown SKU'})`;

    // Match the typed value against `sku` — only when non-blank. The field UI
    // labels this "Serial number", but it functionally matches the unit SKU so
    // office-created units (which carry the real serial in `sku`) reconcile.
    // Case-insensitive (the @@unique index is case-sensitive, so "AIS"/"ais"
    // could both exist — hence the defensive multi-match guard below).
    const serial = dto.serial?.trim();
    const matches = serial
      ? await this.prisma.inventory.findMany({
          where: {
            assetId: asset.id,
            organizationId,
            sku: { equals: serial, mode: 'insensitive' },
          },
          include: { asset: true },
        })
      : [];

    // ---- EXISTING-UNIT BIND (exactly one serial match) ----
    if (matches.length === 1) {
      const unit = matches[0];

      // (a) Idempotent: this unit already carries the requested tag.
      if (unit.nfcTagUid === tag) {
        return { inventory: unit, asset, action: 'matched' as const, idempotent: true };
      }
      // The requested tag is bound to a DIFFERENT unit — can't steal it.
      if (tagOwner && tagOwner.id !== unit.id) {
        throw new HttpException(tagConflictMessage(tagOwner), HttpStatus.CONFLICT);
      }
      // (b) Unit already has a DIFFERENT tag — needs an explicit confirm to
      //     rebind (overwriting orphans the old tag), surfaced as a structured
      //     409 the field UI can turn into a confirm prompt.
      if (unit.nfcTagUid && !dto.confirmRebind) {
        throw new HttpException(
          {
            code: 'ALREADY_TAGGED',
            message: `Unit ${unit.sku} already has a tag. Rebinding will unbind the old tag.`,
            unitSku: unit.sku,
            unitId: unit.id,
          },
          HttpStatus.CONFLICT,
        );
      }
      // (c) Bind: set ONLY nfcTagUid. SKU and status are left as-is (the unit
      //     may already be rental/sold — do NOT reset it to instock).
      const inventory = await this.prisma.inventory.update({
        where: { id: unit.id },
        data: { nfcTagUid: tag },
        include: { asset: true },
      });
      return { inventory, asset, action: 'matched' as const };
    }

    // ---- MULTI-MATCH guard (should be prevented by the unique index, but the
    //      index is case-sensitive while our match is case-insensitive) ----
    if (matches.length > 1) {
      throw new HttpException(
        {
          code: 'AMBIGUOUS_SERIAL',
          message: `Multiple units (${matches.length}) match serial "${serial}" under this product — resolve manually.`,
          candidates: matches.map((m) => m.sku),
        },
        HttpStatus.CONFLICT,
      );
    }

    // ---- CREATE NEW (blank serial OR no serial match) ----
    // The tag must not already be bound to any unit.
    if (tagOwner) {
      throw new HttpException(tagConflictMessage(tagOwner), HttpStatus.CONFLICT);
    }
    // Next per-unit SKU (reuses the bulk endpoint's increment logic).
    const [inventorySku] = await this.generateSkuRange(asset.id, 1, organizationId);
    try {
      const inventory = await this.prisma.inventory.create({
        data: {
          assetId: asset.id,
          sku: inventorySku,
          category: asset.category?.name ?? 'Equipment',
          status: 'instock',
          organizationId,
          nfcTagUid: tag,
          serialNumber: serial || null,
        },
        include: { asset: true },
      });
      return { inventory, asset, action: 'created' as const };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const targetRaw = (error.meta as { target?: string[] | string } | undefined)?.target;
        const target = Array.isArray(targetRaw) ? targetRaw.join(',') : String(targetRaw ?? '');
        // A (sku, organizationId) race — another bind/create produced this SKU
        // between our match query and the write. Tell the caller to retry (it
        // will then resolve to the existing unit via the match path).
        if (target.includes('sku')) {
          throw new HttpException(
            'A unit with this SKU already exists in this organization — please retry to match it.',
            HttpStatus.CONFLICT,
          );
        }
        // Otherwise it's the nfcTagUid unique — the tag was bound concurrently.
        throw new HttpException('NFC tag is already bound to another inventory item.', HttpStatus.CONFLICT);
      }
      throw new HttpException(
        error?.message ?? 'Failed to create and bind inventory item',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
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

      // customSku is a DTO-only input (the user's chosen SKU list) — it maps to
      // `sku` below and is NOT a column on Inventory, so exclude it from the
      // createMany data or Prisma rejects it as an unknown argument.
      const { customSku: _customSku, ...inventoryData } = createInventoryDto;
      const inventoryItems = skuRange.map((sku) => ({
        ...inventoryData,
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
