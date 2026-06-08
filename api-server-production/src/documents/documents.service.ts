import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { UpdateDocumentDto } from './dto/update-document.dto';
import { PrismaService } from 'src/common/prisma.service';
import { CreateDocumentWithTimelineDto } from './dto/create-document-with-timeline.dto';
import { InventoryStatus, DocumentStatus, TransactionType, ItemType } from '@prisma/client';
import { XeroService } from 'src/common/xero.service';
import { PriceHistoryService } from '../price-history/price-history.service';
import { TransactionsService } from '../transactions/transactions.service';
import { EmailService } from '../email/email.service';
import { JournalAutoPostService } from '../journal/journal-auto-post.service';
import { OrdersService } from '../orders/orders.service';
import { SendInvoiceEmailDto } from '../email/dto/send-invoice-email.dto';
import { S3Service } from 'src/common/services/s3.service';
import { PdfGeneratorService } from 'src/common/services/pdf-generator.service';
import * as moment from 'moment';

@Injectable()
export class DocumentsService {
  constructor(
    private prisma: PrismaService,
    private xeroService: XeroService,
    private priceHistoryService: PriceHistoryService,
    private transactionsService: TransactionsService,
    private emailService: EmailService,
    private journalAutoPost: JournalAutoPostService,
    private s3Service: S3Service,
    private pdfGeneratorService: PdfGeneratorService,
    private ordersService: OrdersService,
  ) {}

  /**
   * Sync DocumentItem junction table for efficient item queries.
   * This is called after document create/update to keep the junction table in sync.
   */
  private async syncDocumentItems(documentId: string, config: any, organizationId: string) {
    try {
      const items = config?.items;
      if (!items || !Array.isArray(items)) {
        // No items to sync, delete any existing DocumentItems for this document
        await this.prisma.documentItem.deleteMany({
          where: { documentId },
        });
        return;
      }

      // Delete existing DocumentItems for this document first
      await this.prisma.documentItem.deleteMany({
        where: { documentId },
      });

      // Create new DocumentItems for each item in config
      const documentItemsData: any[] = [];

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const itemId = item.inventoryItemId || item.assetId;

        if (!itemId) continue; // Skip items without an ID

        // Determine item type by checking which table it exists in
        let itemType: ItemType = ItemType.INVENTORY;

        // Check if it's an inventory item
        const inventoryItem = await this.prisma.inventory.findUnique({
          where: { id: itemId },
        });

        if (!inventoryItem) {
          // Not in inventory, check if it's an asset
          const assetItem = await this.prisma.asset.findUnique({
            where: { id: itemId },
          });

          if (assetItem) {
            itemType = ItemType.ASSET;
          } else {
            // Item not found in either table, skip
            console.warn(`DocumentItem sync: Item ${itemId} not found in Inventory or Asset table, skipping`);
            continue;
          }
        }

        documentItemsData.push({
          documentId,
          itemId,
          itemType,
          sku: item.sku || item.skuKey || null,
          description: item.description || null,
          quantity: parseFloat(item.quantity) || 0,
          unitPrice: parseFloat(item.unitPrice) || 0,
          discount: parseFloat(item.discount) || 0,
          amount: parseFloat(item.amount) || 0,
          uom: item.uom || null,
          lineNumber: i + 1,
          isService: !!item.isService,
        });
      }

      // Batch create DocumentItems
      if (documentItemsData.length > 0) {
        await this.prisma.documentItem.createMany({
          data: documentItemsData,
          skipDuplicates: true,
        });
        console.log(`📋 DocumentItem sync: Created ${documentItemsData.length} items for document ${documentId}`);
      }
    } catch (error) {
      console.error('Failed to sync DocumentItems:', error);
      // Don't throw - this is a background sync operation
    }
  }

  async getById(id: string, organizationId: string) {
    try {
      return await this.prisma.document.findFirst({
        where: {
          id,
          organizationId,
        },
        include: {
          organization: true,
          baseDocument: true,
          revisions: true,
          // Field-tech delivery reports linked to this document. CleanDocumentPreview
          // renders these into a "Proof of Delivery" section at the bottom of the
          // DO print/preview. Restricted to DO_START / DO_ACK so unrelated service
          // reports never leak into print output, even if some future flow sets
          // documentId on a kind=SERVICE row.
          maintenanceReports: {
            where: { kind: { in: ['DO_START', 'DO_ACK'] } },
            orderBy: { createdAt: 'asc' },
            select: {
              id: true,
              kind: true,
              photos: true,
              signature: true,
              signedByName: true,
              signedAt: true,
              technicianName: true,
              createdAt: true,
            },
          },
        },
      });
    } catch (error) {
      throw new HttpException(`Fetch by ID failed: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async getByInventory(inventoryId: string, organizationId: string) {
    try {
      // Use DocumentItem junction table for efficient query (O(log n) with index)
      const documentItems = await this.prisma.documentItem.findMany({
        where: {
          itemId: inventoryId,
          document: {
            organizationId,
          },
        },
        include: {
          document: true,
        },
        orderBy: {
          document: {
            createdAt: 'desc',
          },
        },
      });

      // Return unique documents
      const documentMap = new Map();
      for (const item of documentItems) {
        if (!documentMap.has(item.document.id)) {
          documentMap.set(item.document.id, item.document);
        }
      }
      return Array.from(documentMap.values());
    } catch (error) {
      throw new HttpException(`Fetch by inventory failed: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async updateDocument(dto: UpdateDocumentDto, organizationId: string) {
    try {
      const configAsPlainObject: any = dto.config ? dto.config : null;
      const id: any = dto.id ? dto.id : null;

      // Check if document exists and its current status
      const existingDocument = await this.prisma.document.findUnique({
        where: {
          id,
          organizationId
        },
      });

      if (!existingDocument) {
        throw new HttpException('Document not found', HttpStatus.NOT_FOUND);
      }

      // If document is already confirmed, prevent any edits to config/content
      // Only allow status changes or no changes at all
      if (existingDocument.status === 'confirmed') {
        // If trying to change config/content of a confirmed document, prevent it
        if (dto.config && Object.keys(dto.config).length > 0) {
          throw new HttpException('Cannot edit confirmed document. Please create a revision instead.', HttpStatus.FORBIDDEN);
        }
        // Allow only status changes for confirmed documents
      }

      // projectId can arrive either at the top level (frontend's update payload
      // sets it there alongside customerId) or nested inside config. Prefer the
      // top-level value so the doc picker actually persists; fall back to the
      // legacy config.projectId for backwards-compat with older callers.
      const projectId =
        (dto as any).projectId ?? configAsPlainObject?.projectId ?? null;
      console.log('Project ID resolved:', projectId, 'Type:', typeof projectId);
      console.log('dto', dto);

      // Handle captured images - ensure they are stored as URLs
      if (configAsPlainObject?.capturedImages && Array.isArray(configAsPlainObject.capturedImages)) {
        // The capturedImages should already be S3 URLs from the frontend
        // Just ensure they are properly stored in the config
        console.log('Captured images to be stored:', configAsPlainObject.capturedImages);
      }

      // Handle MSR photos - ensure they are stored as URLs
      if (configAsPlainObject?.photos && Array.isArray(configAsPlainObject.photos)) {
        // The photos should already be S3 URLs from the frontend
        // Just ensure they are properly stored in the config
        console.log('MSR photos to be stored:', configAsPlainObject.photos.length, 'photos');
      }

      // Preserve "tracking" fields the form doesn't surface. Without this, a
      // round-trip Save wipes them (the form sends back its full config, but
      // not these), which breaks downstream features that depend on them:
      // - sourceOrderId / sourceOrderNumber: how a PO/DO/Invoice traces back
      //   to its parent Order (used by the supplier-doc verify-upload flow
      //   to find which order's items to stamp ✓).
      // - orderType: gates PO editor behaviour (Route Order hides discount,
      //   shows Less Points; Project cascades top discount).
      // - sourceDocumentId / sourceDocumentNumber / sourceDocumentType: the
      //   quotation-to-doc lineage used by the doc breadcrumbs.
      // Honour an *explicit* overwrite from the form (so it's still possible
      // to update these via tooling), but never let a bare save erase them.
      const existingConfig = (existingDocument.config as any) || {};
      const trackingKeys = [
        'sourceOrderId',
        'sourceOrderNumber',
        'orderType',
        'sourceDocumentId',
        'sourceDocumentNumber',
        'sourceDocumentType',
      ];
      for (const k of trackingKeys) {
        if (
          (configAsPlainObject as any)[k] === undefined &&
          existingConfig[k] !== undefined
        ) {
          (configAsPlainObject as any)[k] = existingConfig[k];
        }
      }

      // Validate status transition for invoices
      const invoiceTypesForValidation = ['INVOICE', 'TI', 'TI2'];
      if (dto.status && invoiceTypesForValidation.includes(existingDocument.type)) {
        const currentStatus = existingDocument.status;
        const newStatus = dto.status;

        // Skip validation if status is not changing
        if (currentStatus === newStatus) {
          console.log(`Status unchanged: keeping document as "${currentStatus}"`);
        } else {
          // Define valid status transitions for invoices
          const validTransitions: Record<string, string[]> = {
            'draft': ['confirmed'], // draft can only go to confirmed
            'confirmed': ['pending_payment'], // confirmed can go to pending_payment (after email sent)
            'pending_payment': ['paid'], // pending_payment can go to paid
            'paid': [], // paid is final status
          };

          // Check if transition is valid
          const allowedNextStatuses = validTransitions[currentStatus] || [];
          if (!allowedNextStatuses.includes(newStatus)) {
            // Special case: Allow manual status change to 'paid' only from 'pending_payment'
            if (newStatus === DocumentStatus.paid && currentStatus !== DocumentStatus.pending_payment) {
              throw new HttpException(
                `Invoice must be in "pending_payment" status before marking as paid. Current status: ${currentStatus}`,
                HttpStatus.BAD_REQUEST,
              );
            } else if (newStatus === DocumentStatus.paid && currentStatus === DocumentStatus.pending_payment) {
              // This is allowed - user manually marking as paid from pending_payment status
            } else {
              throw new HttpException(
                `Invalid status transition from "${currentStatus}" to "${newStatus}". ` +
                `Allowed transitions: ${allowedNextStatuses.length > 0 ? allowedNextStatuses.join(', ') : 'none (final status)'}`,
                HttpStatus.BAD_REQUEST,
              );
            }
          }
        }
      }

      // Sync Document.name with the editable "Purchase Order No." / document
      // number on the form. When the user types a custom number into the
      // documentNumber field it becomes the document's authoritative name,
      // so the orders list, supplier-doc verification (which matches on name),
      // and any other downstream surface all stay in agreement.
      const editedDocNumber =
        (configAsPlainObject as any)?.documentNumber ??
        (configAsPlainObject as any)?.documentInfo?.documentNumber;
      const trimmedDocNumber =
        typeof editedDocNumber === 'string' && editedDocNumber.trim() ? editedDocNumber.trim() : undefined;
      const nameToWrite = trimmedDocNumber ?? dto.name;

      // Update the document itself with config only
      const updatedDocument = await this.prisma.document.update({
        where: {
          id,
          organizationId, // Ensure user can only update documents in their organization
        },
        data: {
          config: configAsPlainObject,
          type: dto.type,
          // Update document status if provided
          status: dto.status, // DocumentStatus enum
          name: nameToWrite, // Custom doc number wins; otherwise honour dto.name
          // Link to project if projectId exists in config
          projectId: projectId || undefined,
        },
      });

      // Order.linkedDocuments stores a *snapshot* of each linked doc's name —
      // so when the user renames a PO/DO/Invoice (typically by typing a custom
      // Purchase Order No.), the chip on the order page would otherwise show
      // the stale label. Propagate the new name to every order that references
      // this document. Skip if the name didn't actually change.
      if (nameToWrite && nameToWrite !== existingDocument.name) {
        try {
          const orders = await this.prisma.order.findMany({
            where: { organizationId },
            select: { id: true, linkedDocuments: true },
          });
          for (const o of orders) {
            const ld: any = o.linkedDocuments || {};
            let dirty = false;
            for (const kind of ['po', 'do', 'invoice'] as const) {
              const list: any[] = Array.isArray(ld[kind]) ? ld[kind] : [];
              for (const ref of list) {
                if (ref && ref.id === id && ref.name !== nameToWrite) {
                  ref.name = nameToWrite;
                  dirty = true;
                }
              }
            }
            if (dirty) {
              await this.prisma.order.update({ where: { id: o.id }, data: { linkedDocuments: ld } });
            }
          }
        } catch (e) {
          console.warn('Failed to propagate doc rename to orders.linkedDocuments:', (e as Error).message);
        }
      }

      // ---- Invoice confirmation gate (price history + AR transaction) ----
      // NOTE: GL auto-posting for invoices lives in confirmInvoice(); this generic
      // update() path is for non-invoice document types or backwards-compat updates.
      const isInvoiceType = dto.type === 'INVOICE' || dto.type === 'TI' || dto.type === 'TI2';
      const becomingConfirmed = dto.status === 'confirmed' && existingDocument.status !== 'confirmed';
      console.log('🧾 [INVOICE-CONFIRM gate]', {
        docId: id,
        dtoType: dto.type,
        dtoStatus: dto.status,
        existingStatus: existingDocument.status,
        isInvoiceType,
        becomingConfirmed,
        willAutoPost: isInvoiceType && becomingConfirmed,
      });
      // Route Order PO confirm → decrement the org's Points balance by the
      // editable "Less Points" amount the user entered on the PO. Lives here
      // because confirms-flip is the trigger; balance moves once-per-confirm
      // and a confirmed doc can't be re-confirmed (guarded at the top).
      const isPoType = dto.type === 'PO' || dto.type === 'PURCHASE_ORDER';
      const cfgForPoints: any = configAsPlainObject || {};
      const isRouteOrderPo = isPoType && (cfgForPoints?.orderType ?? cfgForPoints?.documentInfo?.orderType) === 'Route Order';
      if (becomingConfirmed && isRouteOrderPo) {
        const redeemRaw =
          cfgForPoints?.documentInfo?.pointsRedeemed ??
          cfgForPoints?.pointsRedeemed ??
          cfgForPoints?.documentInfo?.pointsDeducted ?? // legacy auto-computed fallback
          cfgForPoints?.pointsDeducted ??
          0;
        const redeem = Math.max(0, Number(redeemRaw) || 0);
        if (redeem > 0) {
          try {
            const result = await this.prisma.organization.update({
              where: { id: organizationId },
              data: { pointsBalance: { decrement: redeem } },
              select: { pointsBalance: true },
            });
            console.log(
              `🎯 Points debited: -${redeem} on Route Order PO ${id}; new balance ${result.pointsBalance}`,
            );
          } catch (err) {
            console.error('Points debit failed (non-fatal):', (err as Error).message);
          }
        }
      }

      if (becomingConfirmed && isInvoiceType) {
        try {
          await this.priceHistoryService.savePriceHistoryFromDocument(id, organizationId);
          console.log('Price history saved for confirmed invoice:', id);
        } catch (error) {
          console.error('Failed to save price history:', error);
          // Don't fail the document update if price history fails
        }

        // Create accounting transaction for the invoice
        try {
          const config: any = configAsPlainObject || existingDocument.config;
          const customer = config?.customer;
          const documentInfo = config?.documentInfo;

          if (customer && customer.id) {
            // Calculate total amount from items
            const items = config?.items || [];
            const totalAmount = items.reduce((sum: number, item: any) => {
              const amount = parseFloat(item.amount) || (parseFloat(item.quantity) * parseFloat(item.unitPrice)) || 0;
              return sum + amount;
            }, 0);

            if (totalAmount > 0) {
              await this.transactionsService.create({
                customerId: customer.id,
                transactionType: TransactionType.INVOICE,
                documentId: id,
                transactionDate: documentInfo?.date || new Date().toISOString(),
                reference: updatedDocument.name || documentInfo?.documentNumber || `Invoice ${id.substring(0, 8)}`,
                description: `Invoice ${updatedDocument.name || id.substring(0, 8)}`,
                debit: totalAmount,
                credit: 0,
              }, organizationId);

              console.log('✅ Accounting transaction created for invoice:', id, 'Amount:', totalAmount);
            }
          }
        } catch (error) {
          console.error('Failed to create accounting transaction:', error);
          // Don't fail the document update if transaction creation fails
        }

        // GL auto-post for invoices is handled by confirmInvoice(); not duplicated here.
      }

      // If document is being confirmed and is a Purchase Order, update inventory quantities
      console.log('📋 UPDATE DOC: dto.type =', dto.type, ', dto.status =', dto.status, ', existingDocument.status =', existingDocument.status);
      console.log('📋 UPDATE DOC: Is PO check:', dto.type === 'PO' || dto.type === 'PURCHASE_ORDER');
      if (dto.status === 'confirmed' &&
          existingDocument.status !== 'confirmed' &&
          (dto.type === 'PO' || dto.type === 'PURCHASE_ORDER')) {
        try {
          const items = configAsPlainObject?.items || [];
          console.log('📦 PO RECEIVE: Processing Purchase Order confirmation with items:', items.length);
          console.log('📦 PO RECEIVE: Items with receivedQty:', items.map((i: any) => ({ id: i.inventoryItemId, qty: i.quantity, receivedQty: i.receivedQty })));

          await Promise.all(
            items.map(async (item: any) => {
              if (!item.inventoryItemId) {
                console.warn('⚠️ PO RECEIVE: Item missing inventoryItemId, skipping');
                return;
              }

              const receivedQty = parseFloat(item.receivedQty) || 0;
              if (receivedQty <= 0) {
                console.warn('⚠️ PO RECEIVE: Item has no received quantity, skipping:', item.inventoryItemId);
                return;
              }

              // Try to find in Inventory table first (Asset Tracking Mode ON)
              let inventory = await this.prisma.inventory.findUnique({
                where: { id: item.inventoryItemId },
              });

              if (inventory) {
                // Update inventory quantity (add received quantity to existing stock)
                const currentQty = inventory.quantity || 0;
                const newQty = currentQty + receivedQty;

                await this.prisma.inventory.update({
                  where: { id: item.inventoryItemId },
                  data: { quantity: newQty },
                });

                console.log(`✅ PO RECEIVE: Updated inventory ${item.inventoryItemId}: ${currentQty} + ${receivedQty} = ${newQty}`);

                // Create timeline entry for the inventory update
                await this.prisma.timelineItem.create({
                  data: {
                    message: `Received ${receivedQty} units from Purchase Order ${updatedDocument.name || id.substring(0, 8)}`,
                    inventoryId: item.inventoryItemId,
                    documentId: id,
                    pdfUrl: null,
                  },
                });
              } else {
                // Try to find in Asset table (Products Mode - Asset Tracking OFF)
                const asset = await this.prisma.asset.findUnique({
                  where: { id: item.inventoryItemId },
                });

                if (asset) {
                  // Update asset quantity (add received quantity to existing stock)
                  const currentQty = asset.quantity || 0;
                  const newQty = currentQty + receivedQty;

                  await this.prisma.asset.update({
                    where: { id: item.inventoryItemId },
                    data: { quantity: newQty },
                  });

                  console.log(`✅ PO RECEIVE: Updated asset ${item.inventoryItemId}: ${currentQty} + ${receivedQty} = ${newQty}`);
                } else {
                  console.warn('⚠️ PO RECEIVE: Neither inventory nor asset found:', item.inventoryItemId);
                }
              }
            })
          );

          console.log('✅ PO RECEIVE: Purchase Order inventory update completed');
        } catch (error) {
          console.error('❌ PO RECEIVE: Failed to update inventory:', error);
          // Don't fail the document update if inventory update fails
        }

        // ---- PO-as-Project auto-creation (feature-flagged) ----
        // When enablePOAsProject is on, confirming a PO spins up a Project named
        // after the PO and links it back so subsequent DOs/invoices can attach to it.
        try {
          const uiConfig = await this.prisma.organizationUIConfig.findUnique({
            where: { organizationId },
            select: { features: true },
          });
          const features = (uiConfig?.features as any) || {};
          if (features.enablePOAsProject && !updatedDocument.projectId) {
            const projectName = updatedDocument.name || `PO-${id.substring(0, 8)}`;
            const newProject = await this.prisma.project.create({
              data: {
                name: projectName,
                organizationId,
                customerPoNumber: updatedDocument.name || null,
              },
              select: { id: true, name: true },
            });
            await this.prisma.document.update({
              where: { id },
              data: { projectId: newProject.id },
            });
            console.log(`✅ PO→PROJECT: created project ${newProject.id} ("${newProject.name}") and linked it to PO ${id}`);
          }
        } catch (err) {
          console.error('❌ PO→PROJECT: failed to auto-create project from PO', err);
          // Best-effort: don't fail the PO confirmation if project creation fails.
        }
      }

      // ---- Auto-create Order from confirmed quotation (gated by flag) ----
      // When a quotation flips to confirmed and enableConfirmQuotation is on,
      // spawn an Order so users can later spin off POs / DOs / Invoices for
      // selected items without having to use the immediate-convert popup.
      const isQuotationType =
        dto.type === 'QUOTATION' ||
        dto.type === 'QO' ||
        dto.type === 'QO1' ||
        dto.type === 'QO2' ||
        dto.type === 'QT';
      if (becomingConfirmed && isQuotationType) {
        try {
          const uiConfig = await this.prisma.organizationUIConfig.findUnique({
            where: { organizationId },
            select: { features: true },
          });
          const features = (uiConfig?.features as any) || {};
          if (features.enableConfirmQuotation) {
            const order = await this.ordersService.createFromQuotation(id, organizationId);
            console.log(`✅ QUOTATION→ORDER: created order ${order.orderNumber} (${order.id})`);
          }
        } catch (err) {
          console.error('❌ QUOTATION→ORDER: failed to auto-create order', err);
          // Best-effort: don't fail the quotation confirmation if order creation fails.
        }
      }

      // ---- GL auto-post for non-invoice transactional types ----
      // Credit Note / Debit Note / Purchase Order / Purchase Return — when status flips to "confirmed".
      const GL_TYPES: Record<string, 'CREDIT_NOTE' | 'DEBIT_NOTE' | 'PURCHASE_ORDER' | 'PURCHASE_RETURN'> = {
        CN: 'CREDIT_NOTE',
        CREDIT_NOTE: 'CREDIT_NOTE',
        DN: 'DEBIT_NOTE',
        DEBIT_NOTE: 'DEBIT_NOTE',
        PO: 'PURCHASE_ORDER',
        PURCHASE_ORDER: 'PURCHASE_ORDER',
        PR: 'PURCHASE_RETURN',
        PURCHASE_RETURN: 'PURCHASE_RETURN',
      };
      const glType = GL_TYPES[dto.type as keyof typeof GL_TYPES];
      if (becomingConfirmed && glType) {
        console.log('📒 [GL auto-post] entering for', dto.type, '→', glType);
        try {
          const existing = await this.journalAutoPost.alreadyPostedForDocument(organizationId, id, glType);
          if (existing) {
            console.log('📒 [GL auto-post] entry already exists — skipping', existing);
          } else {
            const cfg: any = configAsPlainObject || existingDocument.config;
            const items = cfg?.items || [];
            const partyName = cfg?.customer?.name || cfg?.customerName || cfg?.supplier?.name || cfg?.supplierName;

            const explicitNet = parseFloat(cfg?.subTotal ?? cfg?.summary?.subTotal ?? 'NaN');
            const explicitTax = parseFloat(cfg?.gstAmount ?? cfg?.summary?.taxAmount ?? cfg?.tax?.amount ?? 'NaN');
            const explicitGross = parseFloat(cfg?.nettTotal ?? cfg?.summary?.grandTotal ?? 'NaN');

            const fallbackNet = items.reduce((sum: number, item: any) => {
              const amt = parseFloat(item.amount) || (parseFloat(item.quantity) * parseFloat(item.unitPrice)) || 0;
              return sum + amt;
            }, 0);
            const org = await this.prisma.organization.findUnique({ where: { id: organizationId }, select: { taxRate: true } });
            const orgRate = (org?.taxRate ?? 0) / 100;

            const netAmount = !Number.isNaN(explicitNet) ? explicitNet : fallbackNet;
            const taxAmount = !Number.isNaN(explicitTax) ? explicitTax : netAmount * orgRate;
            const grossAmount = !Number.isNaN(explicitGross) ? explicitGross : netAmount + taxAmount;

            console.log('📒 [GL auto-post] computed', { docId: id, type: glType, partyName, netAmount, taxAmount, grossAmount });

            const baseArgs = {
              organizationId,
              documentId: id,
              documentNumber: updatedDocument.name || cfg?.documentNumber,
              entryDate: cfg?.date ? new Date(cfg.date) : new Date(),
              netAmount,
              taxAmount,
              grossAmount,
            };

            let entry: any = null;
            if (glType === 'CREDIT_NOTE') {
              entry = await this.journalAutoPost.postFromCreditNote({ ...baseArgs, customerName: partyName });
            } else if (glType === 'DEBIT_NOTE') {
              entry = await this.journalAutoPost.postFromDebitNote({ ...baseArgs, customerName: partyName });
            } else if (glType === 'PURCHASE_ORDER') {
              entry = await this.journalAutoPost.postFromPurchaseOrder({ ...baseArgs, supplierName: partyName });
            } else if (glType === 'PURCHASE_RETURN') {
              entry = await this.journalAutoPost.postFromPurchaseReturn({ ...baseArgs, supplierName: partyName });
            }

            if (entry) {
              console.log('✅ [GL auto-post] entry created', { journalNumber: entry.journalNumber, totalDebit: entry.totalDebit, totalCredit: entry.totalCredit });
            } else {
              console.warn('⚠️ [GL auto-post] post* returned null — see service warnings above');
            }
          }
        } catch (error) {
          console.error('❌ [GL auto-post] failed for', dto.type, id, error);
        }
      }

      // Update project if projectId exists in config
      if (projectId) {
        await this.prisma.project.update({
          where: {
            id: projectId,
            organizationId, // Ensure project belongs to the same organization
          },
          data: {
            siteOfficeId: configAsPlainObject.deliveryTo || undefined,
            startDate: dto.config?.startDate || undefined,
          },
        });
      }

      // If config.items exists and is an array, handle inventory/timeline logic (for DO, RDO, etc.)
      // Exclude invoice types (TI, TI2, INVOICE), quotations (QO1, QUOTATION, QT, QO), service reports (MSR), and Purchase Orders (PO) from inventory status validation
      // Note: PO is handled separately above with receivedQty logic
      const documentTypesExcludedFromInventory = ['QO1', 'QUOTATION', 'QT', 'QO', 'MSR', 'TI', 'TI2', 'INVOICE', 'PO', 'PURCHASE_ORDER'];
      if (!documentTypesExcludedFromInventory.includes(dto.type) && dto.config && Array.isArray(dto.config.items)) {
        // Validate that all items have inventoryItemId
        const itemsWithoutInventory = dto.config.items.filter(
          (_item) => !_item.inventoryItemId || _item.inventoryItemId.trim() === ''
        );

        if (itemsWithoutInventory.length > 0) {
          throw new HttpException(
            'Please select inventory items for all rows before saving the document',
            HttpStatus.BAD_REQUEST
          );
        }

        await Promise.all(
          dto.config.items.map(async (_item) => {

            // Determine inventory status based on document type (not document status)
            let docMessage = '';
            let statusChangeMessage = '';
            const newStatus: InventoryStatus = dto.type === 'DO' ? InventoryStatus.rental : dto.type === 'RDO' ? InventoryStatus.instock : undefined;

            if (dto.type === 'DO') {
              if (dto.status) {
                // Include status information in the message
                const statusText =
                  dto.status === 'delivered_not_installed' ? 'delivered (not installed)' : dto.status === 'delivered_installed' ? 'delivered and installed' : dto.status.replace(/_/g, ' ');
                docMessage = `A DO document is submitted as ${statusText}`;
              } else {
                docMessage = 'A DO document is updated';
              }
              statusChangeMessage = 'Item has been changed from instock to rental';
            } else if (dto.type === 'RDO') {
              docMessage = 'A RDO document is updated';
              statusChangeMessage = 'Item has been changed from rental to instock';
            } else {
              docMessage = `A ${dto.type} document is updated`;
            }

            // Try to update inventory status - first check if item exists in Inventory table
            const inventoryItem = await this.prisma.inventory.findUnique({
              where: { id: _item.inventoryItemId },
            });

            if (inventoryItem) {
              // Item is in Inventory table (Asset Tracking ON)
              await this.prisma.inventory.update({
                where: {
                  id: _item.inventoryItemId,
                  organizationId,
                },
                data: {
                  status: newStatus,
                },
              });

              // Create timeline item for document update
              await this.prisma.timelineItem.create({
                data: {
                  message: docMessage,
                  pdfUrl: '',
                  inventoryId: _item.inventoryItemId,
                  documentId: id,
                },
              });
              // Create timeline item for status change
              await this.prisma.timelineItem.create({
                data: {
                  message: statusChangeMessage,
                  inventoryId: _item.inventoryItemId,
                  documentId: null,
                  pdfUrl: null,
                },
              });
            } else {
              // Item might be in Asset table (Asset Tracking OFF / Products mode)
              // In this mode, we don't track rental status on assets, just skip the status update
              // Timeline entries are not applicable for assets in this context
              console.log(`Item ${_item.inventoryItemId} not found in Inventory table, skipping status update (likely Asset/Product)`);
            }
          }),
        );
      }

      if (projectId && dto.config?.items?.length) {
        // Validate that all items have inventoryItemId for project assignments
        const itemsWithoutInventory = dto.config.items.filter(
          (_item) => !_item.inventoryItemId || _item.inventoryItemId.trim() === ''
        );

        if (itemsWithoutInventory.length > 0) {
          throw new HttpException(
            'Please select inventory items for all rows before saving the document',
            HttpStatus.BAD_REQUEST
          );
        }

        await Promise.all(
          dto.config.items.map(async (_item) => {

            const existingAssignment = await this.prisma.assignment.findFirst({
              where: {
                projectId: projectId,
                inventoryId: _item.inventoryItemId,
              },
            });

            if (!existingAssignment) {
              await this.prisma.assignment.create({
                data: {
                  projectId: projectId,
                  inventoryId: _item.inventoryItemId,
                  startDate: dto.config.startDate || null,
                  endDate: dto.config.endDate || null,
                },
              });
            }
          }),
        );
      }

      // Update Xero invoice if this is a TI (Invoice) document
      if (dto.type === 'TI') {
        console.log('🟡 XERO: Attempting to update invoice for TI document:', updatedDocument.id, 'with status:', dto.status);
        try {
          const xeroResult = await this.updateXeroInvoice(updatedDocument, configAsPlainObject, organizationId);
          console.log('🟢 XERO: Invoice updated successfully!', xeroResult ? `Xero Invoice ID: ${xeroResult.invoiceID}` : 'No invoice ID returned');
        } catch (xeroError) {
          console.error('🔴 XERO: Invoice update failed, but document was updated:', xeroError);
          console.error('🔴 XERO: Error details:', xeroError.message);
          // Don't fail the entire update if Xero fails - just log the error
        }
      } else {
        console.log('⚪ XERO: Skipping invoice update - Document type:', dto.type, 'Status:', dto.status);
      }

      // Sync DocumentItem junction table for efficient item queries
      await this.syncDocumentItems(updatedDocument.id, configAsPlainObject || existingDocument.config, organizationId);

      return updatedDocument;
    } catch (error) {
      throw new HttpException(`Update failed: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Attach, move, or detach a QUOTATION document's Project link.
   * - projectId = "<uuid>" : link / re-link (overwrite if already linked).
   * - projectId = null     : unlink (set Document.projectId to null).
   */
  async linkProjectToDocument(
    documentId: string,
    projectId: string | null,
    organizationId: string,
  ) {
    const doc = await this.prisma.document.findFirst({
      where: { id: documentId, organizationId },
      select: { id: true, type: true, projectId: true },
    });
    if (!doc) throw new HttpException('Document not found', HttpStatus.NOT_FOUND);
    if (doc.type !== 'QUOTATION') {
      throw new HttpException(
        `Only QUOTATION documents can be linked to a project (got "${doc.type}")`,
        HttpStatus.BAD_REQUEST,
      );
    }
    if (projectId !== null) {
      const project = await this.prisma.project.findFirst({
        where: { id: projectId, organizationId },
        select: { id: true },
      });
      if (!project) throw new HttpException('Project not found', HttpStatus.NOT_FOUND);
    }

    return this.prisma.document.update({
      where: { id: documentId },
      data: { projectId },
      select: { id: true, name: true, type: true, status: true, projectId: true, createdAt: true, updatedAt: true },
    });
  }

  async deleteDocument(id: string, organizationId: string) {
    try {
      // First, delete any associated accounting transactions
      try {
        await this.prisma.transaction.deleteMany({
          where: {
            documentId: id,
            organizationId,
          },
        });
        console.log('✅ Deleted accounting transactions for document:', id);
      } catch (error) {
        console.error('Failed to delete accounting transactions:', error);
        // Continue with document deletion even if transaction deletion fails
      }

      // Delete the document
      return await this.prisma.document.delete({
        where: {
          id,
          organizationId, // Ensure user can only delete documents in their organization
        },
      });
    } catch (error) {
      throw new HttpException(`Delete failed: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async createDocumentWithTimeline(dto: CreateDocumentWithTimelineDto, organizationId: string) {
    return this.prisma.$transaction(async (tx) => {
      try {
        const configAsPlainObject: any = dto.config ? dto.config : null;

        // Handle captured images - ensure they are stored as URLs
        if (configAsPlainObject?.capturedImages && Array.isArray(configAsPlainObject.capturedImages)) {
          // The capturedImages should already be S3 URLs from the frontend
          // Just ensure they are properly stored in the config
          console.log('Captured images to be stored:', configAsPlainObject.capturedImages);
        }

        // Handle MSR photos - ensure they are stored as URLs
        if (configAsPlainObject?.photos && Array.isArray(configAsPlainObject.photos)) {
          // The photos should already be S3 URLs from the frontend
          // Just ensure they are properly stored in the config
          console.log('MSR photos to be stored:', configAsPlainObject.photos.length, 'photos');
        }

        const createdDocument = await tx.document.create({
          data: {
            documentTemplateId: dto.documentTemplateId,
            type: dto.type || 'Default',
            config: configAsPlainObject,
            organizationId, // Automatically assign to user's organization
            name: dto.name, // Include document name if provided
          },
        });

        // Only process items for non-MSR documents
        if (dto.config.items && Array.isArray(dto.config.items) && dto.type !== 'MSR') {
          // Validate that all items have inventoryItemId (except for QO1)
          if (dto.type !== 'QO1') {
            const itemsWithoutInventory = dto.config.items.filter(
              (_item: any) => !_item.inventoryItemId || _item.inventoryItemId.trim() === ''
            );

            if (itemsWithoutInventory.length > 0) {
              throw new HttpException(
                'Please select inventory items for all rows before saving the document',
                HttpStatus.BAD_REQUEST
              );
            }
          }

          await Promise.all(
            dto.config.items.map(async (_item) => {
              // Determine new inventory status and timeline messages based on document type
              let newStatus: InventoryStatus = InventoryStatus.instock;
              let docMessage = 'A RDO document is submitted';
              let statusChangeMessage = 'Item has been changed from rental to instock';
              console.log('Document Type:', JSON.stringify(dto.type, null, 2));
              if (dto.type === 'DO') {
                newStatus = InventoryStatus.rental;
                docMessage = 'A DO document is submitted';
                statusChangeMessage = 'Item has been changed from instock to rental';
              }

              // Update inventory status
              await tx.inventory.update({
                where: {
                  id: _item.inventoryItemId,
                  organizationId, // Ensure inventory belongs to the same organization
                },
                data: {
                  status: newStatus,
                },
              });
              // No need to connect inventory anymore as it's stored in config
              // Create timeline item for document submission
              await tx.timelineItem.create({
                data: {
                  message: docMessage,
                  pdfUrl: '',
                  inventoryId: _item.inventoryItemId,
                  documentId: createdDocument.id,
                },
              });

              // Create timeline item for status change
              await tx.timelineItem.create({
                data: {
                  message: statusChangeMessage,
                  inventoryId: _item.inventoryItemId,
                  documentId: null,
                  pdfUrl: null,
                },
              });
            }),
          );
        }

        // Create Xero invoice if this is a TI (Invoice) document and status is not draft
        if (dto.type === 'TI' && dto.status !== 'draft') {
          console.log('🟡 XERO: Attempting to create invoice for TI document:', createdDocument.id, 'with status:', dto.status);
          try {
            const xeroResult = await this.createXeroInvoice(createdDocument, configAsPlainObject, organizationId);
            console.log('🟢 XERO: Invoice created successfully!', xeroResult ? `Xero Invoice ID: ${xeroResult.invoiceID}` : 'No invoice ID returned');
          } catch (xeroError) {
            console.error('🔴 XERO: Invoice creation failed, but document was created:', xeroError);
            console.error('🔴 XERO: Error details:', xeroError.message);
            // Don't fail the entire transaction if Xero fails - just log the error
          }
        } else {
          console.log('⚪ XERO: Skipping invoice creation - Document type:', dto.type, 'Status:', dto.status);
        }

        return createdDocument;
      } catch (error) {
        throw new HttpException(`Update failed: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
      }
    }).then(async (createdDocument) => {
      // Sync DocumentItem junction table after transaction completes
      await this.syncDocumentItems(createdDocument.id, dto.config, organizationId);
      return createdDocument;
    });
  }
  async createBasicDocument(
    documentTemplateId: string,
    type: string,
    organizationId: string,
    config: any = {},
    projectId?: string,
  ) {
    try {
      console.log('Creating basic document with template ID:', documentTemplateId, 'Type:', type, 'Organization ID:', organizationId, 'Config:', config, 'ProjectId:', projectId);

      // If projectId is supplied, validate it belongs to this org and prefill
      // customer info into the config when the caller didn't pass one. Empty-
      // field-only fill so explicit customer choices in the config are never
      // overwritten.
      let resolvedProject: { id: string; customer: any } | null = null;
      if (projectId) {
        const project = await this.prisma.project.findFirst({
          where: { id: projectId, organizationId },
          select: {
            id: true,
            customer: { select: { id: true, name: true, customerCode: true, email: true, phone: true, address: true, gstRegNo: true } },
          },
        });
        if (!project) {
          throw new HttpException('Project not found in this organization', HttpStatus.NOT_FOUND);
        }
        resolvedProject = project;
      }

      // Get organization to check for custom document types and defaults (logo, stamp)
      const organization = await this.prisma.organization.findUnique({
        where: { id: organizationId },
        select: {
          customDocumentTypes: true,
          logo: true,
          defaultStamp: true,
          // Org-wide tax defaults seeded onto documentInfo on new docs.
          taxRate: true,
          taxApplicable: true,
          absorbTax: true,
        },
      });

      // Get document template to use templateVariant for naming + inherit
      // column layout (tableColumnOrder/columnLabels) so per-template item
      // table layouts (e.g. FCU/CU Quotation) take effect on new docs.
      const documentTemplate = await this.prisma.documentTemplate.findUnique({
        where: { id: documentTemplateId },
        select: { templateVariant: true, config: true },
      });

      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');

      // Use templateVariant for document name prefix (e.g., "SO" instead of "SALES_ORDER")
      // Falls back to custom document types, then to the original type
      const customTypes = organization?.customDocumentTypes as Record<string, string> | null;
      const documentPrefix = documentTemplate?.templateVariant || customTypes?.[type] || type;
      const namePrefix = `${documentPrefix}${year}${month}-`;

      // Find the highest serial number for this prefix to avoid duplicates
      // Exclude revision documents (names containing "Rev-") so they don't interfere with serial lookup
      const existingDocs = await this.prisma.document.findMany({
        where: {
          organizationId,
          documentTemplateId,
          name: {
            startsWith: namePrefix,
          },
          baseDocumentId: null,
        },
        select: { name: true },
        orderBy: { name: 'desc' },
        take: 1,
      });

      let nextSerial = 1;
      if (existingDocs.length > 0) {
        // Extract the serial number from the last document name
        const lastDocName = existingDocs[0].name;
        const match = lastDocName.match(/-(\d+)$/);
        if (match) {
          nextSerial = parseInt(match[1], 10) + 1;
        }
      }

      const serial = String(nextSerial).padStart(3, '0');
      const name = `${namePrefix}${serial}`;

      // Seed initial config with organization defaults so they persist even if user doesn't save the form
      const initialConfig: any = config && typeof config === 'object' ? { ...config } : {};
      if (!initialConfig.logo && organization?.logo) {
        initialConfig.logo = organization.logo;
      }
      // support stamp.company convention across templates
      if (!initialConfig.stamp) {
        initialConfig.stamp = {};
      }
      if (!initialConfig.stamp.company && organization?.defaultStamp) {
        initialConfig.stamp.company = organization.defaultStamp;
      }
      // Inherit the template's column layout so per-template variants
      // (e.g. FCU/CU Quotation) render with their custom columns on new docs.
      const templateConfig: any = (documentTemplate?.config as any) || {};
      if (!initialConfig.tableColumnOrder && Array.isArray(templateConfig.tableColumnOrder)) {
        initialConfig.tableColumnOrder = templateConfig.tableColumnOrder;
      }
      if (!initialConfig.columnLabels && templateConfig.columnLabels && typeof templateConfig.columnLabels === 'object') {
        initialConfig.columnLabels = templateConfig.columnLabels;
      }

      // Seed the tax block from the org's defaults (Company Profile page →
      // taxApplicable / taxRate / absorbTax). Only fill when the caller didn't
      // already supply a value, so explicit per-doc overrides still win.
      const orgTaxApplicable = (organization as any)?.taxApplicable;
      const orgAbsorbTax = (organization as any)?.absorbTax;
      const orgTaxRate = organization?.taxRate;
      if (!initialConfig.documentInfo || typeof initialConfig.documentInfo !== 'object') {
        initialConfig.documentInfo = {};
      }
      const di = initialConfig.documentInfo;
      // The Tax / Absorb Tax fields render as Y/N selects in the form so we
      // store the string variant — booleans would render as empty.
      if (di.taxApplicable === undefined && orgTaxApplicable !== undefined && orgTaxApplicable !== null) {
        di.taxApplicable = orgTaxApplicable ? 'Y' : 'N';
      }
      if (di.absorbTax === undefined && orgAbsorbTax !== undefined && orgAbsorbTax !== null) {
        di.absorbTax = orgAbsorbTax ? 'Y' : 'N';
      }
      if ((di.gstPercent === undefined || di.gstPercent === null || di.gstPercent === 0) && orgTaxRate != null) {
        di.gstPercent = Number(orgTaxRate);
      }
      // Prefill customer info from the project when projectId is supplied and
      // the caller didn't already populate it. Generic across document types.
      if (resolvedProject?.customer) {
        if (!initialConfig.customerId) initialConfig.customerId = resolvedProject.customer.id;
        if (!initialConfig.customer) initialConfig.customer = resolvedProject.customer;
      }

      // Honour a user-supplied document number at creation time too — the
      // editable "Purchase Order No." (or any doc's number field) should
      // immediately become the document's name. Falls back to the
      // auto-generated serial when no custom value was passed.
      const initialDocNumber =
        (initialConfig as any)?.documentNumber ?? (initialConfig as any)?.documentInfo?.documentNumber;
      const initialName =
        typeof initialDocNumber === 'string' && initialDocNumber.trim()
          ? initialDocNumber.trim()
          : name;

      const newDocument = await this.prisma.document.create({
        data: {
          documentTemplateId,
          type,
          config: initialConfig,
          organizationId,
          name: initialName,
          revisionNumber: 0,
          projectId: projectId || undefined,
        },
      });

      // Sync DocumentItem junction table (in case config has items)
      await this.syncDocumentItems(newDocument.id, initialConfig, organizationId);

      return newDocument;
    } catch (error) {
      throw new HttpException(`Basic document creation failed: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Create a draft document from extracted (AI-parsed) data.
   * - Fuzzy-matches customer by name (case-insensitive contains, unique match wins).
   * - Looks up an existing PO whose name == extracted poNumber; if found, the new
   *   draft inherits that PO's projectId so it lands inside the PO-as-project.
   * - Falls back to the type's default DocumentTemplate when no templateId is given.
   * Returns { id, templateId, type, matched: { customerId, projectId, poDocumentId } }.
   */
  async createFromExtraction(
    organizationId: string,
    type: string,
    extracted: any,
    documentTemplateId?: string,
    sourceFileUrl?: string | null,
  ) {
    // Resolve template: explicit > active variant > default > newest.
    // The active/default flags reflect the variant the user normally picks via
    // InvoiceVariantDrawer; without this ordering findFirst can return a legacy
    // variant with a thinner fieldConfig and the upload draft would look sparse.
    let templateId = documentTemplateId;
    if (!templateId) {
      const tmpl = await this.prisma.documentTemplate.findFirst({
        where: { type, organizationId },
        select: { id: true },
        orderBy: [
          { isActive: 'desc' },
          { isDefault: 'desc' },
          { createdAt: 'desc' },
        ],
      });
      if (!tmpl) {
        throw new HttpException(`No document template found for type ${type}`, HttpStatus.NOT_FOUND);
      }
      templateId = tmpl.id;
    }

    // Fuzzy customer match — case-insensitive contains, only auto-link if unique.
    let matchedCustomerId: string | null = null;
    const extractedCustomerName: string | undefined = extracted?.customer?.name?.trim();
    if (extractedCustomerName) {
      const candidates = await this.prisma.customer.findMany({
        where: {
          organizationId,
          name: { contains: extractedCustomerName, mode: 'insensitive' },
        },
        select: { id: true, name: true },
        take: 2,
      });
      if (candidates.length === 1) {
        matchedCustomerId = candidates[0].id;
      }
    }

    // PO match — exact match on Document.name among PO types.
    let matchedProjectId: string | null = null;
    let matchedPoDocumentId: string | null = null;
    const extractedPoNumber: string | undefined =
      extracted?.references?.poNumber?.trim() || undefined;
    if (extractedPoNumber) {
      const po = await this.prisma.document.findFirst({
        where: {
          organizationId,
          type: { in: ['PO', 'PURCHASE_ORDER'] },
          name: extractedPoNumber,
        },
        select: { id: true, projectId: true },
      });
      if (po) {
        matchedPoDocumentId = po.id;
        matchedProjectId = po.projectId || null;
      }
    }

    // Map extracted → AIMS document config shape.
    const config: any = {
      customer: {
        id: matchedCustomerId || undefined,
        name: extracted?.customer?.name || undefined,
        address: extracted?.customer?.address || undefined,
        attention: extracted?.customer?.attention || undefined,
      },
      documentInfo: {
        documentNumber: extracted?.document?.number || undefined,
        date: extracted?.document?.date || undefined,
        dueDate: extracted?.document?.dueDate || undefined,
        reference: extracted?.document?.reference || undefined,
      },
      references: extracted?.references || {},
      items: (Array.isArray(extracted?.items) ? extracted.items : []).map((it: any, idx: number) => ({
        id: idx + 1,
        description: it?.description || '',
        quantity: typeof it?.quantity === 'number' ? it.quantity : parseFloat(it?.quantity) || 0,
        unitPrice: typeof it?.unitPrice === 'number' ? it.unitPrice : parseFloat(it?.unitPrice) || 0,
        amount: typeof it?.amount === 'number' ? it.amount : parseFloat(it?.amount) || 0,
        uom: it?.unit || undefined,
        tax: typeof it?.tax === 'number' ? it.tax : parseFloat(it?.tax) || undefined,
      })),
      totals: extracted?.totals || {},
      notes: extracted?.notes || undefined,
      source: {
        extractedFrom: 'upload',
        fileUrl: sourceFileUrl || undefined,
      },
      sourceFileUrl: sourceFileUrl || undefined,
    };

    // Create the draft via the existing helper so we get document numbering, defaults, etc.
    const created = await this.createBasicDocument(templateId, type, organizationId, config);

    // If we matched a project (via PO), link it on the created document.
    if (matchedProjectId) {
      await this.prisma.document.update({
        where: { id: created.id },
        data: { projectId: matchedProjectId },
      });
    }

    return {
      id: created.id,
      templateId,
      type,
      matched: {
        customerId: matchedCustomerId,
        projectId: matchedProjectId,
        poDocumentId: matchedPoDocumentId,
      },
    };
  }

  async duplicateDocument(documentId: string, organizationId: string) {
    try {
      const original = await this.prisma.document.findFirst({
        where: { id: documentId, organizationId },
      });
      if (!original) {
        throw new HttpException('Document not found', HttpStatus.NOT_FOUND);
      }

      // Build a fresh config copy without identity/state fields that should
      // not carry over to a new document.
      const originalConfig = (original.config as any) || {};
      const duplicatedConfig: any = { ...originalConfig };
      // Strip fields tied to the source document's identity/state.
      delete duplicatedConfig.id;
      delete duplicatedConfig.documentNumber;
      if (duplicatedConfig.documentInfo) {
        duplicatedConfig.documentInfo = { ...duplicatedConfig.documentInfo };
        delete duplicatedConfig.documentInfo.documentNumber;
      }
      // The duplicate is always a fresh draft.
      delete duplicatedConfig.savedBy;
      delete duplicatedConfig.savedAt;
      delete duplicatedConfig.confirmedAt;
      delete duplicatedConfig.confirmedBy;

      // Reuse createBasicDocument so we get the standard document-number
      // generation, organization defaults, and item junction sync.
      return await this.createBasicDocument(
        original.documentTemplateId,
        original.type,
        organizationId,
        duplicatedConfig,
      );
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        `Duplicate document failed: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async createRevision(documentId: string, organizationId: string) {
    try {
      // Load the original document with its revisions
      const original = await this.prisma.document.findFirst({
        where: { id: documentId, organizationId },
      });
      if (!original) {
        throw new HttpException('Document not found', HttpStatus.NOT_FOUND);
      }

      // Determine baseDocumentId and next revision number
      const baseDocumentId = original.baseDocumentId || original.id;
      // If there is a base document, fetch it to use its clean name (without any appended Rev-x)
      const baseDocument = original.baseDocumentId ? await this.prisma.document.findUnique({ where: { id: baseDocumentId } }) : null;
      const lastRevision = await this.prisma.document.findFirst({
        where: { organizationId, baseDocumentId },
        orderBy: { revisionNumber: 'desc' },
        select: { revisionNumber: true },
      });
      const nextRevisionNumber = (lastRevision?.revisionNumber ?? 0) + 1;

      // Name formatting: ensure we only ever have a single (Rev-X)
      // Prefer the base document's original name when available; otherwise strip any existing Rev-x suffixes
      const rawBaseName = (baseDocument?.name || original.name || `${original.type}-${original.id.slice(0, 6)}`).trim();
      const cleanedBaseName = rawBaseName.replace(/\s*\(Rev-\d+\)/g, '').trim();
      const nameWithRevision = `${cleanedBaseName} (Rev-${nextRevisionNumber})`;

      const created = await this.prisma.document.create({
        data: {
          documentTemplateId: original.documentTemplateId,
          type: original.type,
          config: original.config,
          organizationId: original.organizationId,
          status: 'draft', // Always set revision status to draft
          name: nameWithRevision,
          baseDocumentId,
          revisionNumber: nextRevisionNumber,
        },
      });

      // Sync DocumentItem junction table (copies items from original)
      await this.syncDocumentItems(created.id, original.config, organizationId);

      return created;
    } catch (error) {
      throw new HttpException(`Create revision failed: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async listRevisions(documentId: string, organizationId: string) {
    try {
      const original = await this.prisma.document.findFirst({ where: { id: documentId, organizationId } });
      if (!original) {
        throw new HttpException('Document not found', HttpStatus.NOT_FOUND);
      }
      const baseDocumentId = original.baseDocumentId || original.id;
      const documents = await this.prisma.document.findMany({
        where: { organizationId, baseDocumentId },
        orderBy: { createdAt: 'asc' },
        select: { id: true, name: true, createdAt: true, revisionNumber: true },
      });
      return documents;
    } catch (error) {
      throw new HttpException(`List revisions failed: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
  async getAllDocuments(organizationId: string) {
    try {
      const documents = await this.prisma.document.findMany({
        where: {
          organizationId: organizationId,
        },
        orderBy: { createdAt: 'desc' },
      });

      // Fetch customer names if customerId exists in config
      const customerIds = documents
        .map((doc: any) => (doc.config as any)?.customerId)
        .filter(Boolean);

      const uniqueCustomerIds = [...new Set(customerIds)];
      const customers = uniqueCustomerIds.length > 0
        ? await this.prisma.customer.findMany({
            where: { id: { in: uniqueCustomerIds } },
            select: { id: true, name: true },
          })
        : [];

      const customerMap = new Map(customers.map(c => [c.id, c.name]));

      return documents.map((doc: any) => {
        const config = doc.config as any;
        const customerId = config?.customerId;
        const customerName = customerId ? customerMap.get(customerId) : null;

        return {
          id: doc.id,
          name: doc.name,
          associated_item: config?.items?.[0]?.sku ?? 'N/A',
          associated_customer: customerName ?? 'N/A',
          documentType: doc.type,
          templateId: doc.documentTemplateId,
          status: doc.status,
          createdAt: doc.createdAt,
          config: doc.config, // Include config data for due dates and other fields
        };
      });
    } catch (error) {
      throw new HttpException(`Fetch all documents failed: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async getDeliveryOrdersByCustomer(customerId: string, organizationId: string) {
    try {
      console.log('🚚 DELIVERY ORDERS: Fetching for customer:', customerId, 'in organization:', organizationId);

      // Get all delivery orders
      const deliveryOrders = await this.prisma.document.findMany({
        where: {
          organizationId: organizationId,
          type: 'DO', // Delivery Order document type
        },
        orderBy: { createdAt: 'desc' },
      });

      // Filter by customerId in config
      const filteredOrders = deliveryOrders.filter((doc: any) => {
        const config = doc.config as any;
        return config?.customerId === customerId;
      });

      console.log('🚚 DELIVERY ORDERS: Found', filteredOrders.length, 'delivery orders for customer');

      // Fetch customer details
      const customer = await this.prisma.customer.findUnique({
        where: { id: customerId },
        select: { name: true },
      });

      const result = filteredOrders.map((doc: any) => {
        const config = doc.config as any;
        return {
          id: doc.id,
          name: doc.name,
          doNo: config?.doNo || doc.name, // Use doNo from config or fallback to name
          status: doc.status,
          customerId: config?.customerId,
          customerName: customer?.name,
          createdAt: doc.createdAt,
        };
      });

      console.log('🚚 DELIVERY ORDERS: Returning:', result);
      return result;
    } catch (error) {
      console.error('🔴 DELIVERY ORDERS: Error fetching delivery orders:', error);
      throw new HttpException(`Fetch delivery orders failed: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
  async getDocumentsByAsset(assetId: string, organizationId: string) {
    try {
      const assetTemplateTags = await this.prisma.assetTemplateTag.findMany({
        where: {
          assetId,
          asset: {
            organizationId, // Ensure asset belongs to the same organization
          },
        },
        include: {
          template: true,
        },
      });

      return assetTemplateTags.map((tag) => ({
        doc_id: tag.template.id,
        doc_name: tag.template.name,
        doc_type: tag.template.type,
      }));
    } catch (error) {
      throw new HttpException(`Fetch templates by asset failed: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async tagTemplateToAsset(assetId: string, templateId: string, _organizationId: string) {
    try {
      return await this.prisma.assetTemplateTag.create({
        data: {
          assetId,
          templateId,
        },
      });
    } catch (error) {
      throw new HttpException(`Failed to tag template to asset: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async untagTemplateFromAsset(assetId: string, templateId: string, _organizationId: string) {
    try {
      return await this.prisma.assetTemplateTag.delete({
        where: {
          assetId_templateId: {
            assetId,
            templateId,
          },
        },
      });
    } catch (error) {
      throw new HttpException(`Failed to untag template from asset: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Create an invoice in Xero based on the document data
   * This is called when TI (Invoice) documents are created or updated with non-draft status
   */
  private async createXeroInvoice(document: any, config: any, organizationId: string) {
    try {
      console.log('🔍 XERO: Starting invoice creation process for document:', document.id);

      // Extract customerId from config
      const customerId = config?.customerId;
      console.log('🔍 XERO: Document details - Name:', document.name, 'Customer ID:', customerId);

      if (!customerId) {
        console.error('🔴 XERO: Customer ID not found in document config:', document.id);
        throw new Error('Customer ID not found in document config');
      }

      // Get customer information
      const customer = await this.prisma.customer.findUnique({
        where: { id: customerId },
      });

      if (!customer) {
        console.error('🔴 XERO: Customer not found for document:', document.id, 'Customer ID:', customerId);
        throw new Error('Customer not found for invoice');
      }

      console.log('✅ XERO: Customer found - Name:', customer.name, 'Email:', customer.email || 'No email');

      // Extract invoice data from the document config
      const lineItems = [];
      console.log('🔍 XERO: Processing document items:', config.items ? config.items.length : 0, 'items found');

      // Process items if they exist
      if (config.items && Array.isArray(config.items)) {
        for (const [index, item] of config.items.entries()) {
          console.log(`🔍 XERO: Processing item ${index + 1} - Inventory ID:`, item.inventoryItemId, 'Quantity:', item.quantity);

          // Get inventory item details
          const inventoryItem = await this.prisma.inventory.findUnique({
            where: { id: item.inventoryItemId },
            include: { asset: true },
          });

          if (inventoryItem) {
            const lineItem = {
              description: item.description || inventoryItem.asset?.name || inventoryItem.sku || 'Item',
              quantity: item.quantity || 1,
              unitAmount: item.price || inventoryItem.asset?.price || 0, // Use item price first, then asset price
              accountCode: item.accountCode || '200', // Use selected account code or default to '200'
              taxType: 'NONE', // Default to no tax - you may want to make this configurable
            };
            lineItems.push(lineItem);
            console.log(`✅ XERO: Added line item ${index + 1} -`, lineItem.description, 'Qty:', lineItem.quantity, 'Price:', lineItem.unitAmount, 'Account:', lineItem.accountCode);
          } else {
            console.warn(`⚠️ XERO: Inventory item not found for ID:`, item.inventoryItemId);
          }
        }
      }

      // Format date to DD/MM/YYYY format like in the image
      const formatDate = (dateString: string) => {
        if (!dateString) return new Date().toLocaleDateString('en-GB');
        const date = new Date(dateString);
        return date.toLocaleDateString('en-GB');
      };

      // If no line items from inventory, create a generic line item
      if (lineItems.length === 0) {
        console.log('⚠️ XERO: No items found, creating generic line item');
        lineItems.push({
          description: `Service/Product - Invoice ${document.name || document.id}`,
          quantity: 1,
          unitAmount: 0, // You may want to add amount fields to your document config
          accountCode: '200',
          taxType: 'NONE',
        });
      }

      // Add reference line items AFTER all the actual items (only for Xero, not in app)
      const referenceItems = [];

      // Add DO reference if selected
      if (config.doNo) {
        console.log('📋 XERO: Adding DO reference line item for DO:', config.doNo);
        referenceItems.push({
          description: `Our DO No. ${config.doNo} dated ${formatDate(config.date)}`,
          quantity: 0, // No quantity for reference lines
          unitAmount: 0, // No amount for reference lines
          accountCode: '200',
          taxType: 'NONE',
        });
      }

      // Add quotation reference if available
      if (config.referenceNo) {
        console.log('📋 XERO: Adding quotation reference:', config.referenceNo);
        referenceItems.push({
          description: `Our Qtn Ref. ${config.referenceNo} dated ${formatDate(config.date)}`,
          quantity: 0,
          unitAmount: 0,
          accountCode: '200',
          taxType: 'NONE',
        });
      }

      // Add work order reference if available
      if (config.poNo) {
        console.log('📋 XERO: Adding work order reference:', config.poNo);
        referenceItems.push({
          description: `Your WO No. ${config.poNo} dated ${formatDate(config.date)}`,
          quantity: 0,
          unitAmount: 0,
          accountCode: '200',
          taxType: 'NONE',
        });
      }

      // Add location and project info if available
      if (config.deliveryTo) {
        console.log('📋 XERO: Adding location reference:', config.deliveryTo);
        referenceItems.push({
          description: `Location: ${config.deliveryTo}`,
          quantity: 0,
          unitAmount: 0,
          accountCode: '200',
          taxType: 'NONE',
        });
      }

      // Add project information if available
      if (config.projectId) {
        try {
          const project = await this.prisma.project.findUnique({
            where: { id: config.projectId },
            include: {
              siteOffice: {
                include: {
                  customer: true,
                },
              },
            },
          });

          if (project) {
            console.log('📋 XERO: Adding project reference:', project.name);
            referenceItems.push({
              description: `Project/Dept: ${project.name}`,
              quantity: 0,
              unitAmount: 0,
              accountCode: '200',
              taxType: 'NONE',
            });
          }
        } catch (error) {
          console.warn('⚠️ XERO: Could not fetch project information:', error.message);
        }
      }

      // Add all reference items to the end of line items
      lineItems.push(...referenceItems);

      if (referenceItems.length > 0) {
        console.log('✅ XERO: Added', referenceItems.length, 'reference line items');
      }

      console.log('📝 XERO: Total line items prepared:', lineItems.length);

      // Prepare invoice data for Xero
      const invoiceData = {
        contactName: customer.name,
        contactEmail: customer.email || '',
        reference: config.referenceNo || config.poNo || '',
        invoiceNumber: document.name || undefined, // Let Xero auto-generate if not provided
        dueDate: config.dueDate || undefined,
        lineItems: lineItems,
        status: 'DRAFT' as const, // Start as draft, you can change this based on document status
      };

      console.log('📤 XERO: Sending invoice data:', {
        contactName: invoiceData.contactName,
        reference: invoiceData.reference,
        invoiceNumber: invoiceData.invoiceNumber,
        dueDate: invoiceData.dueDate,
        lineItemsCount: invoiceData.lineItems.length,
      });

      // Create the invoice in Xero
      console.log('🚀 XERO: Calling Xero API to create invoice...');
      const xeroInvoice = await this.xeroService.createInvoice(organizationId, invoiceData);

      console.log('🎉 XERO: Invoice created successfully! Xero Invoice ID:', xeroInvoice?.invoiceID || 'No ID returned');

      // Store the Xero invoice ID in the document config
      if (xeroInvoice?.invoiceID) {
        console.log('💾 XERO: Storing Xero invoice ID in document config:', xeroInvoice.invoiceID);
        await this.prisma.document.update({
          where: { id: document.id },
          data: {
            config: {
              ...config,
              xeroInvoiceId: xeroInvoice.invoiceID,
            },
          },
        });
        console.log('✅ XERO: Xero invoice ID stored successfully');
      }

      return xeroInvoice;
    } catch (error) {
      console.error('💥 XERO: Failed to create invoice - Error type:', error.constructor.name);
      console.error('💥 XERO: Error message:', error.message);
      console.error('💥 XERO: Full error:', error);
      throw error;
    }
  }

  private async updateXeroInvoice(document: any, config: any, organizationId: string) {
    try {
      console.log('🔄 XERO: Starting invoice update process for document:', document.id);

      // Check if we have a Xero invoice ID stored
      let xeroInvoiceId = (config as any)?.xeroInvoiceId;

      if (!xeroInvoiceId) {
        console.log('⚠️ XERO: No Xero invoice ID found in config');

        // Try to find existing invoice by invoice number before creating new one
        const invoiceNumber = document.name;
        console.log('🔍 XERO: Searching for existing invoice with number:', invoiceNumber);

        try {
          const existingInvoice = await this.xeroService.findInvoiceByNumber(organizationId, invoiceNumber);
          if (existingInvoice) {
            console.log('✅ XERO: Found existing invoice in Xero with ID:', existingInvoice.invoiceID);
            xeroInvoiceId = existingInvoice.invoiceID;

            // Store the found invoice ID in the document config for future updates
            const updatedConfig = { ...config, xeroInvoiceId };
            await this.prisma.document.update({
              where: { id: document.id },
              data: { config: updatedConfig },
            });
            console.log('💾 XERO: Stored invoice ID in document config for future updates');
          } else {
            console.log('⚠️ XERO: No existing invoice found, creating new invoice');
            return await this.createXeroInvoice(document, config, organizationId);
          }
        } catch (searchError) {
          console.log('⚠️ XERO: Error searching for existing invoice, creating new invoice:', searchError.message);
          return await this.createXeroInvoice(document, config, organizationId);
        }
      }

      console.log('🔍 XERO: Found Xero invoice ID in config:', xeroInvoiceId);

      // Verify the invoice actually exists in Xero
      const invoiceExists = await this.xeroService.invoiceExists(organizationId, xeroInvoiceId);
      if (!invoiceExists) {
        console.log('⚠️ XERO: Invoice ID exists in config but not found in Xero, creating new invoice');
        // Clear the invalid xeroInvoiceId from config
        const updatedConfig = { ...config };
        delete (updatedConfig as any).xeroInvoiceId;

        // Update the document to remove the invalid xeroInvoiceId
        await this.prisma.document.update({
          where: { id: document.id },
          data: { config: updatedConfig },
        });

        return await this.createXeroInvoice(document, updatedConfig, organizationId);
      }

      console.log('✅ XERO: Invoice confirmed to exist in Xero, proceeding with update');

      // Extract customerId from config
      const customerId = config?.customerId;

      if (!customerId) {
        console.error('🔴 XERO: Customer ID not found in document config:', document.id);
        throw new Error('Customer ID not found in document config');
      }

      // Get customer information
      const customer = await this.prisma.customer.findUnique({
        where: { id: customerId },
      });

      if (!customer) {
        console.error('🔴 XERO: Customer not found for document:', document.id, 'Customer ID:', customerId);
        throw new Error('Customer not found for invoice update');
      }

      console.log('✅ XERO: Customer found - Name:', customer.name, 'Email:', customer.email || 'No email');

      // Extract invoice data from the document config (same logic as create)
      const lineItems = [];
      console.log('🔍 XERO: Processing document items for update:', config.items ? config.items.length : 0, 'items found');

      // Process items if they exist (same logic as createXeroInvoice)
      if (config.items && Array.isArray(config.items)) {
        for (const [index, item] of config.items.entries()) {
          console.log(`🔍 XERO: Processing item ${index + 1} - Inventory ID:`, item.inventoryItemId, 'Quantity:', item.quantity);

          const inventoryItem = await this.prisma.inventory.findUnique({
            where: { id: item.inventoryItemId },
            include: { asset: true },
          });

          if (inventoryItem) {
            const lineItem = {
              description: item.description || inventoryItem.asset?.name || inventoryItem.sku || 'Item',
              quantity: item.quantity || 1,
              unitAmount: item.price || inventoryItem.asset?.price || 0,
              accountCode: item.accountCode || '200',
              taxType: 'NONE',
            };
            lineItems.push(lineItem);
            console.log(`✅ XERO: Added line item ${index + 1} -`, lineItem.description, 'Qty:', lineItem.quantity, 'Price:', lineItem.unitAmount);
          } else {
            console.warn(`⚠️ XERO: Inventory item not found for ID:`, item.inventoryItemId);
          }
        }
      }

      // Format date to DD/MM/YYYY format like in the image
      const formatDate = (dateString: string) => {
        if (!dateString) return new Date().toLocaleDateString('en-GB');
        const date = new Date(dateString);
        return date.toLocaleDateString('en-GB');
      };

      // If no line items from inventory, create a generic line item
      if (lineItems.length === 0) {
        console.log('⚠️ XERO: No items found, creating generic line item');
        lineItems.push({
          description: `Service/Product - Invoice ${document.name || document.id}`,
          quantity: 1,
          unitAmount: 0,
          accountCode: '200',
          taxType: 'NONE',
        });
      }

      // Add reference line items AFTER all the actual items (same logic as create)
      const referenceItems = [];

      // Add DO reference if selected
      if (config.doNo) {
        referenceItems.push({
          description: `Our DO No. ${config.doNo} dated ${formatDate(config.date)}`,
          quantity: 0,
          unitAmount: 0,
          accountCode: '200',
          taxType: 'NONE',
        });
      }

      // Add quotation reference if available
      if (config.referenceNo) {
        referenceItems.push({
          description: `Our Qtn Ref. ${config.referenceNo} dated ${formatDate(config.date)}`,
          quantity: 0,
          unitAmount: 0,
          accountCode: '200',
          taxType: 'NONE',
        });
      }

      // Add work order reference if available
      if (config.poNo) {
        referenceItems.push({
          description: `Your WO No. ${config.poNo} dated ${formatDate(config.date)}`,
          quantity: 0,
          unitAmount: 0,
          accountCode: '200',
          taxType: 'NONE',
        });
      }

      // Add location and project info if available
      if (config.deliveryTo) {
        referenceItems.push({
          description: `Location: ${config.deliveryTo}`,
          quantity: 0,
          unitAmount: 0,
          accountCode: '200',
          taxType: 'NONE',
        });
      }

      // Add project information if available
      if (config.projectId) {
        try {
          const project = await this.prisma.project.findUnique({
            where: { id: config.projectId },
            include: {
              siteOffice: {
                include: {
                  customer: true,
                },
              },
            },
          });

          if (project) {
            referenceItems.push({
              description: `Project/Dept: ${project.name}`,
              quantity: 0,
              unitAmount: 0,
              accountCode: '200',
              taxType: 'NONE',
            });
          }
        } catch (error) {
          console.warn('⚠️ XERO: Could not fetch project information:', error.message);
        }
      }

      // Add all reference items to the end of line items
      lineItems.push(...referenceItems);

      console.log('📝 XERO: Total line items prepared for update:', lineItems.length);

      // Prepare invoice data for Xero update
      const invoiceData = {
        contactName: customer.name,
        contactEmail: customer.email || '',
        reference: config.referenceNo || config.poNo || '',
        invoiceNumber: document.name || undefined,
        dueDate: config.dueDate || undefined,
        lineItems: lineItems,
        status: 'DRAFT' as const,
      };

      console.log('🔄 XERO: Updating invoice in Xero...');
      const xeroInvoice = await this.xeroService.updateInvoice(organizationId, xeroInvoiceId, invoiceData);

      console.log('🎉 XERO: Invoice updated successfully! Xero Invoice ID:', xeroInvoice?.invoiceID || 'No ID returned');

      return xeroInvoice;
    } catch (error) {
      console.error('💥 XERO: Failed to update invoice - Error type:', error.constructor.name);
      console.error('💥 XERO: Error message:', error.message);
      console.error('💥 XERO: Full error:', error);
      throw error;
    }
  }

  async getPastDescriptions(organizationId: string) {
    try {
      // Fetch all documents for the organization
      const documents = await this.prisma.document.findMany({
        where: {
          organizationId,
        },
        select: {
          config: true,
        },
      });

      // Extract unique descriptions from all document items
      const descriptions = new Set<string>();

      documents.forEach(document => {
        const config = document.config as any;
        if (config?.items && Array.isArray(config.items)) {
          config.items.forEach((item: any) => {
            if (item.description && typeof item.description === 'string' && item.description.trim()) {
              descriptions.add(item.description.trim());
            }
          });
        }
      });

      // Convert set to array and sort alphabetically
      const sortedDescriptions = Array.from(descriptions).sort((a, b) =>
        a.toLowerCase().localeCompare(b.toLowerCase())
      );

      return {
        success: true,
        descriptions: sortedDescriptions,
      };
    } catch (error) {
      console.error('Failed to fetch past descriptions:', error);
      throw new HttpException(
        `Failed to fetch past descriptions: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Send invoice email to customer
   */
  async sendInvoiceEmail(
    documentId: string,
    emailDto: SendInvoiceEmailDto,
    organizationId: string,
  ) {
    try {
      // 1. Get the document
      const document = await this.prisma.document.findFirst({
        where: {
          id: documentId,
          organizationId,
        },
        include: {
          organization: true,
        },
      });

      if (!document) {
        throw new HttpException('Document not found', HttpStatus.NOT_FOUND);
      }

      // 2. Validate it's an invoice
      const invoiceTypes = ['INVOICE', 'TI', 'TI2'];
      if (!invoiceTypes.includes(document.type)) {
        throw new HttpException(
          'Only invoices can be sent via email',
          HttpStatus.BAD_REQUEST,
        );
      }

      // 3. Validate status is 'confirmed'
      if (document.status !== 'confirmed') {
        throw new HttpException(
          'Only confirmed invoices can be sent. Please confirm the invoice first.',
          HttpStatus.BAD_REQUEST,
        );
      }

      // 4. Extract invoice details from config
      const config: any = document.config;
      const customer = config?.customer;
      const documentInfo = config?.documentInfo;
      const items = config?.items || [];

      if (!customer) {
        throw new HttpException(
          'Invoice must have a customer',
          HttpStatus.BAD_REQUEST,
        );
      }

      // Calculate total amount
      const totalAmount = items.reduce((sum: number, item: any) => {
        const amount =
          parseFloat(item.amount) ||
          parseFloat(item.quantity) * parseFloat(item.unitPrice) ||
          0;
        return sum + amount;
      }, 0);

      // Get invoice number and due date
      const invoiceNumber = document.name || documentInfo?.documentNumber || `INV-${documentId.substring(0, 8)}`;
      const dueDate = config?.dueDate
        ? moment(config.dueDate).format('DD MMM YYYY')
        : moment().add(30, 'days').format('DD MMM YYYY');

      // 5. Generate or get PDF URL
      let pdfUrl: string | undefined;
      try {
        // Try to get existing PDF from S3
        const s3Key = `documents/${organizationId}/${document.type}/${documentId}.pdf`;
        try {
          pdfUrl = await this.s3Service.getSignedUrl(s3Key, 3600); // 1 hour expiry
        } catch (error) {
          // PDF doesn't exist, generate it
          console.log('PDF not found in S3, generating new one...');

          // Generate HTML
          const html = this.pdfGeneratorService.generateInvoiceHtml({
            organization: document.organization,
            customer,
            documentInfo,
            items,
            config,
          });

          // Generate PDF
          const pdfBuffer = await this.pdfGeneratorService.generatePdfFromHtml(html);

          // Upload to S3
          const { key } = await this.s3Service.uploadPdf(
            organizationId,
            document.type,
            documentId,
            pdfBuffer,
          );

          // Get signed URL
          pdfUrl = await this.s3Service.getSignedUrl(key, 3600);
        }
      } catch (error) {
        console.error('Failed to get/generate PDF:', error);
        // Continue without PDF attachment
      }

      // 6. Send email via email service
      const emailResult = await this.emailService.sendInvoiceEmail({
        to: emailDto.to,
        cc: emailDto.cc,
        bcc: emailDto.bcc,
        subject: emailDto.subject,
        message: emailDto.message,
        invoiceNumber,
        invoiceAmount: totalAmount,
        dueDate,
        customerName: customer.name || 'Customer',
        organizationName: document.organization.name,
        pdfUrl,
        paymentLink: undefined, // TODO: Generate payment link when public payment page is implemented
      });

      if (!emailResult.success) {
        throw new HttpException(
          emailResult.error || 'Failed to send email',
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }

      // 7. Update document status to 'pending_payment' (email has been sent)
      await this.prisma.document.update({
        where: {
          id: documentId,
        },
        data: {
          status: DocumentStatus.pending_payment,
        },
      });

      return {
        success: true,
        message: 'Invoice email sent successfully',
        messageId: emailResult.messageId,
      };
    } catch (error) {
      console.error('Error sending invoice email:', error);
      throw new HttpException(
        error.message || 'Failed to send invoice email',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Confirm a Delivery Order and always deduct stock
   * DO confirmation always triggers stock deduction
   */
  async confirmDeliveryOrder(
    documentId: string,
    confirmData: { fromDONo: string; toDONo: string },
    organizationId: string
  ) {
    try {
      console.log('📦 DO CONFIRM: Starting confirmation for document:', documentId);

      // Get the document
      const document = await this.prisma.document.findFirst({
        where: {
          id: documentId,
          organizationId,
        },
      });

      if (!document) {
        throw new HttpException('Document not found', HttpStatus.NOT_FOUND);
      }

      // Validate it's a Delivery Order
      if (document.type !== 'DO' && document.type !== 'DELIVERY_ORDER') {
        throw new HttpException(
          'This endpoint is only for Delivery Orders',
          HttpStatus.BAD_REQUEST
        );
      }

      // Get items from document config
      const config: any = document.config;
      const items = config?.items || [];
      console.log('📦 DO CONFIRM: Processing', items.length, 'items');

      // Always deduct stock when DO is confirmed
      console.log('📦 DO CONFIRM: Deducting stock');

        await Promise.all(
          items.map(async (item: any) => {
            if (!item.inventoryItemId) {
              console.warn('⚠️ DO CONFIRM: Item missing inventoryItemId, skipping');
              return;
            }

            const quantity = parseFloat(item.quantity) || 0;
            if (quantity <= 0) {
              console.warn('⚠️ DO CONFIRM: Item has no quantity, skipping:', item.inventoryItemId);
              return;
            }

            // Try to find in Inventory table first (Asset Tracking Mode ON)
            let inventory = await this.prisma.inventory.findUnique({
              where: { id: item.inventoryItemId },
            });

            if (inventory) {
              // Deduct from inventory quantity
              const currentQty = inventory.quantity || 0;
              const newQty = Math.max(0, currentQty - quantity); // Don't go below 0

              await this.prisma.inventory.update({
                where: { id: item.inventoryItemId },
                data: { quantity: newQty },
              });

              console.log(`✅ DO CONFIRM: Updated inventory ${item.inventoryItemId}: ${currentQty} - ${quantity} = ${newQty}`);

              // Create timeline entry for the stock deduction
              await this.prisma.timelineItem.create({
                data: {
                  message: `Stock deducted: ${quantity} units for Delivery Order ${document.name || documentId.substring(0, 8)}`,
                  inventoryId: item.inventoryItemId,
                  documentId: documentId,
                  pdfUrl: null,
                },
              });
            } else {
              // Try to find in Asset table (Products Mode - Asset Tracking OFF)
              const asset = await this.prisma.asset.findUnique({
                where: { id: item.inventoryItemId },
              });

              if (asset) {
                // Deduct from asset quantity
                const currentQty = asset.quantity || 0;
                const newQty = Math.max(0, currentQty - quantity); // Don't go below 0

                await this.prisma.asset.update({
                  where: { id: item.inventoryItemId },
                  data: { quantity: newQty },
                });

                console.log(`✅ DO CONFIRM: Updated asset ${item.inventoryItemId}: ${currentQty} - ${quantity} = ${newQty}`);
              } else {
                console.warn('⚠️ DO CONFIRM: Neither inventory nor asset found:', item.inventoryItemId);
              }
            }
          })
        );

        console.log('✅ DO CONFIRM: Stock deduction completed');

      // Update document with confirmation data and set status to confirmed
      const updatedConfig = {
        ...config,
        fromDONo: confirmData.fromDONo,
        toDONo: confirmData.toDONo,
        confirmedAt: new Date().toISOString(),
        stockDeducted: true,
      };

      const updatedDocument = await this.prisma.document.update({
        where: {
          id: documentId,
          organizationId,
        },
        data: {
          config: updatedConfig,
          status: 'confirmed',
        },
      });

      console.log('✅ DO CONFIRM: Document confirmed successfully');

      return {
        success: true,
        document: updatedDocument,
        stockDeducted: true,
        message: 'Delivery Order confirmed and stock deducted',
      };
    } catch (error) {
      console.error('❌ DO CONFIRM: Error:', error);
      throw new HttpException(
        error.message || 'Failed to confirm Delivery Order',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Confirm an Invoice document.
   * Stock deduction occurs only if the invoice was NOT extracted from a DO (standalone invoice)
   */
  async confirmInvoice(
    documentId: string,
    confirmData: { fromInvoiceNo: string; toInvoiceNo: string },
    organizationId: string
  ) {
    try {
      console.log('🧾 INVOICE CONFIRM: Starting confirmation for document:', documentId);

      // Get the document
      const document = await this.prisma.document.findFirst({
        where: {
          id: documentId,
          organizationId,
        },
      });

      if (!document) {
        throw new HttpException('Document not found', HttpStatus.NOT_FOUND);
      }

      // Validate it's an Invoice
      const invoiceTypes = ['INVOICE', 'TI', 'TI2'];
      if (!invoiceTypes.includes(document.type)) {
        throw new HttpException(
          'This endpoint is only for Invoices',
          HttpStatus.BAD_REQUEST
        );
      }

      // Get items from document config
      const config: any = document.config;
      const items = config?.items || [];
      console.log('🧾 INVOICE CONFIRM: Processing', items.length, 'items');

      // Check if invoice was extracted from a DO (has sourceDocumentId in config or baseDocumentId)
      const sourceDocumentId = config?.sourceDocumentId || document.baseDocumentId;
      const isExtractedFromDO = !!sourceDocumentId;
      console.log('🧾 INVOICE CONFIRM: Source document ID:', sourceDocumentId);
      console.log('🧾 INVOICE CONFIRM: Is extracted from DO:', isExtractedFromDO);

      // Only deduct stock if invoice was NOT extracted from a DO (standalone invoice)
      // If extracted from DO, stock was already deducted when DO was confirmed
      const shouldDeductStock = !isExtractedFromDO;

      if (shouldDeductStock) {
        console.log('🧾 INVOICE CONFIRM: Deducting stock (standalone invoice, not extracted from DO)');

        await Promise.all(
          items.map(async (item: any) => {
            if (!item.inventoryItemId) {
              console.warn('⚠️ INVOICE CONFIRM: Item missing inventoryItemId, skipping');
              return;
            }

            const quantity = parseFloat(item.quantity) || 0;
            if (quantity <= 0) {
              console.warn('⚠️ INVOICE CONFIRM: Item has no quantity, skipping:', item.inventoryItemId);
              return;
            }

            // Try to find in Inventory table first (Asset Tracking Mode ON)
            let inventory = await this.prisma.inventory.findUnique({
              where: { id: item.inventoryItemId },
            });

            if (inventory) {
              // Deduct from inventory quantity
              const currentQty = inventory.quantity || 0;
              const newQty = Math.max(0, currentQty - quantity); // Don't go below 0

              await this.prisma.inventory.update({
                where: { id: item.inventoryItemId },
                data: { quantity: newQty },
              });

              console.log(`✅ INVOICE CONFIRM: Updated inventory ${item.inventoryItemId}: ${currentQty} - ${quantity} = ${newQty}`);

              // Create timeline entry for the stock deduction
              await this.prisma.timelineItem.create({
                data: {
                  message: `Stock deducted: ${quantity} units for Invoice ${document.name || documentId.substring(0, 8)}`,
                  inventoryId: item.inventoryItemId,
                  documentId: documentId,
                  pdfUrl: null,
                },
              });
            } else {
              // Try to find in Asset table (Products Mode - Asset Tracking OFF)
              const asset = await this.prisma.asset.findUnique({
                where: { id: item.inventoryItemId },
              });

              if (asset) {
                // Deduct from asset quantity
                const currentQty = asset.quantity || 0;
                const newQty = Math.max(0, currentQty - quantity); // Don't go below 0

                await this.prisma.asset.update({
                  where: { id: item.inventoryItemId },
                  data: { quantity: newQty },
                });

                console.log(`✅ INVOICE CONFIRM: Updated asset ${item.inventoryItemId}: ${currentQty} - ${quantity} = ${newQty}`);
              } else {
                console.warn('⚠️ INVOICE CONFIRM: Neither inventory nor asset found:', item.inventoryItemId);
              }
            }
          })
        );

        console.log('✅ INVOICE CONFIRM: Stock deduction completed');
      } else {
        console.log('🧾 INVOICE CONFIRM: Skipping stock deduction (invoice extracted from DO)');
      }

      // Update document with confirmation data and set status to confirmed
      const updatedConfig = {
        ...config,
        fromInvoiceNo: confirmData.fromInvoiceNo,
        toInvoiceNo: confirmData.toInvoiceNo,
        confirmedAt: new Date().toISOString(),
        stockDeducted: shouldDeductStock,
      };

      // Propagate project + deployment link from source DO when the invoice
      // doesn't already carry one. Source DO is the authoritative anchor.
      let inheritedProjectId: string | undefined;
      let inheritedDeploymentId: string | undefined;
      if (sourceDocumentId && (!document.projectId || !document.projectDeploymentId)) {
        try {
          const sourceDoc = await this.prisma.document.findFirst({
            where: { id: sourceDocumentId, organizationId },
            select: { projectId: true, projectDeploymentId: true },
          });
          if (sourceDoc) {
            if (!document.projectId && sourceDoc.projectId) inheritedProjectId = sourceDoc.projectId;
            if (!document.projectDeploymentId && sourceDoc.projectDeploymentId) {
              inheritedDeploymentId = sourceDoc.projectDeploymentId;
            }
            if (inheritedProjectId || inheritedDeploymentId) {
              console.log('🧾 INVOICE CONFIRM: Inheriting project/deployment from DO', {
                projectId: inheritedProjectId,
                projectDeploymentId: inheritedDeploymentId,
              });
            }
          }
        } catch (err) {
          console.warn('🧾 INVOICE CONFIRM: Could not inherit project link from DO', err);
        }
      }

      const updatedDocument = await this.prisma.document.update({
        where: {
          id: documentId,
          organizationId,
        },
        data: {
          config: updatedConfig,
          status: 'confirmed',
          ...(inheritedProjectId ? { projectId: inheritedProjectId } : {}),
          ...(inheritedDeploymentId ? { projectDeploymentId: inheritedDeploymentId } : {}),
        },
      });

      console.log('✅ INVOICE CONFIRM: Document confirmed successfully');

      // Save price history (best-effort)
      try {
        await this.priceHistoryService.savePriceHistoryFromDocument(documentId, organizationId);
        console.log('✅ INVOICE CONFIRM: Price history saved');
      } catch (e) {
        console.error('❌ INVOICE CONFIRM: Price history failed', e);
      }

      // Auto-post the invoice to the General Ledger (best-effort)
      console.log('📒 [GL auto-post] entering auto-post block for invoice', documentId);
      try {
        // Idempotency: if a journal entry already exists for this invoice, skip.
        const existingEntry = await this.prisma.journalEntry.findFirst({
          where: { organizationId, sourceDocumentId: documentId, type: 'INVOICE', status: { not: 'VOID' } },
          select: { id: true, journalNumber: true },
        });
        if (existingEntry) {
          console.log('📒 [GL auto-post] entry already exists for this invoice — skipping', existingEntry);
          return {
            success: true,
            document: updatedDocument,
            stockDeducted: shouldDeductStock,
            message: shouldDeductStock ? 'Invoice confirmed and stock deducted' : 'Invoice confirmed',
          };
        }

        const customer = config?.customer;
        const customerName = customer?.name || config?.customerName;
        const itemsForTotal = config?.items || [];

        // Prefer the explicit totals AIMS already computes on the document config.
        const net = parseFloat(config?.subTotal ?? config?.summary?.subTotal ?? 'NaN');
        const tax = parseFloat(config?.gstAmount ?? config?.summary?.taxAmount ?? config?.tax?.amount ?? 'NaN');
        const gross = parseFloat(config?.nettTotal ?? config?.summary?.grandTotal ?? 'NaN');

        // Fallbacks if those fields aren't set: compute from items + org tax rate.
        const fallbackNet = itemsForTotal.reduce((sum: number, item: any) => {
          const amt = parseFloat(item.amount) || (parseFloat(item.quantity) * parseFloat(item.unitPrice)) || 0;
          return sum + amt;
        }, 0);
        const org = await this.prisma.organization.findUnique({ where: { id: organizationId }, select: { taxRate: true } });
        const orgRate = (org?.taxRate ?? 0) / 100;

        const netAmount = !Number.isNaN(net) ? net : fallbackNet;
        const taxAmount = !Number.isNaN(tax) ? tax : netAmount * orgRate;
        const grossAmount = !Number.isNaN(gross) ? gross : netAmount + taxAmount;

        console.log('📒 [GL auto-post] computed amounts', {
          docId: documentId,
          invoiceNumber: updatedDocument.name,
          customerName,
          itemCount: itemsForTotal.length,
          net: netAmount,
          tax: taxAmount,
          gross: grossAmount,
        });

        if (grossAmount <= 0) {
          console.warn('📒 [GL auto-post] grossAmount <= 0, skipping');
        } else {
          const entry = await this.journalAutoPost.postFromInvoice({
            organizationId,
            documentId,
            invoiceNumber: updatedDocument.name || config?.documentNumber,
            entryDate: config?.date ? new Date(config.date) : new Date(),
            customerName,
            netAmount,
            taxAmount,
            grossAmount,
          });
          if (entry) {
            console.log('✅ [GL auto-post] journal entry created', {
              journalNumber: entry.journalNumber,
              entryId: entry.id,
              totalDebit: entry.totalDebit,
              totalCredit: entry.totalCredit,
            });
          } else {
            console.warn('⚠️ [GL auto-post] postFromInvoice returned null — see warnings above');
          }
        }
      } catch (error) {
        console.error('❌ [GL auto-post] failed for invoice', documentId, error);
      }

      return {
        success: true,
        document: updatedDocument,
        stockDeducted: shouldDeductStock,
        message: shouldDeductStock
          ? 'Invoice confirmed and stock deducted'
          : 'Invoice confirmed',
      };
    } catch (error) {
      console.error('❌ INVOICE CONFIRM: Error:', error);
      throw new HttpException(
        error.message || 'Failed to confirm Invoice',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Get payment summary for an invoice
   * Returns total amount, amount paid, and remaining balance
   */
  async getPaymentSummary(documentId: string, organizationId: string) {
    try {
      // Get the document
      const document = await this.prisma.document.findFirst({
        where: {
          id: documentId,
          organizationId,
        },
      });

      if (!document) {
        throw new HttpException('Document not found', HttpStatus.NOT_FOUND);
      }

      // Validate it's an invoice
      const invoiceTypes = ['INVOICE', 'TI', 'TI2'];
      if (!invoiceTypes.includes(document.type)) {
        throw new HttpException(
          'Payment summary is only available for invoices',
          HttpStatus.BAD_REQUEST,
        );
      }

      // Calculate invoice total amount from config.items
      const config: any = document.config;
      const items = config?.items || [];

      const invoiceAmount = items.reduce((sum: number, item: any) => {
        const amount =
          parseFloat(item.amount) ||
          parseFloat(item.quantity) * parseFloat(item.unitPrice) ||
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

      // Calculate remaining balance
      const remainingBalance = invoiceAmount - totalPaid;

      return {
        success: true,
        invoiceAmount: parseFloat(invoiceAmount.toFixed(2)),
        totalPaid: parseFloat(totalPaid.toFixed(2)),
        remainingBalance: parseFloat(remainingBalance.toFixed(2)),
        invoiceNumber: document.name || `INV-${documentId.substring(0, 8)}`,
        status: document.status,
      };
    } catch (error) {
      console.error('Error getting payment summary:', error);
      throw new HttpException(
        error.message || 'Failed to get payment summary',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
