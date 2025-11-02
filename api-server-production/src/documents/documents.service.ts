import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { UpdateDocumentDto } from './dto/update-document.dto';
import { PrismaService } from 'src/common/prisma.service';
import { CreateDocumentWithTimelineDto } from './dto/create-document-with-timeline.dto';
import { InventoryStatus, DocumentStatus } from '@prisma/client';
import { XeroService } from 'src/common/xero.service';

@Injectable()
export class DocumentsService {
  constructor(
    private prisma: PrismaService,
    private xeroService: XeroService,
  ) {}

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
        },
      });
    } catch (error) {
      throw new HttpException(`Fetch by ID failed: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async getByInventory(inventoryId: string, organizationId: string) {
    try {
      // Get all documents and filter by inventoryId in config.items
      const documents = await this.prisma.document.findMany({
        where: {
          organizationId: organizationId,
        },
        orderBy: { createdAt: 'desc' },
      });

      // Filter documents that have the inventoryId in their items
      return documents.filter((doc: any) => {
        const config = doc.config as any;
        if (!config?.items || !Array.isArray(config.items)) return false;
        return config.items.some((item: any) => item.inventoryItemId === inventoryId);
      });
    } catch (error) {
      throw new HttpException(`Fetch by inventory failed: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async updateDocument(dto: UpdateDocumentDto, organizationId: string) {
    try {
      const configAsPlainObject: any = dto.config ? dto.config : null;
      const id: any = dto.id ? dto.id : null;

      // Extract projectId from config if it exists
      const projectId = configAsPlainObject?.projectId;
      console.log('Project ID from config:', projectId, 'Type:', typeof projectId);
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
          name: dto.name, // Update document name if provided
        },
      });

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
      // Exclude invoice types (TI, TI2, INVOICE) and quotations (QO1) and service reports (MSR) from inventory validation
      const invoiceTypes = ['QO1', 'MSR', 'TI', 'TI2', 'INVOICE'];
      if (!invoiceTypes.includes(dto.type) && dto.config && Array.isArray(dto.config.items)) {
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

            // Update inventory status
            await this.prisma.inventory.update({
              where: {
                id: _item.inventoryItemId,
                organizationId, // Ensure inventory belongs to the same organization
              },
              data: {
                status: newStatus,
              },
            });
            // No need to connect inventory anymore as it's stored in config
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

      return updatedDocument;
    } catch (error) {
      throw new HttpException(`Update failed: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async deleteDocument(id: string, organizationId: string) {
    try {
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
    });
  }
  async createBasicDocument(documentTemplateId: string, type: string, organizationId: string, config: any = {}) {
    try {
      console.log('Creating basic document with template ID:', documentTemplateId, 'Type:', type, 'Organization ID:', organizationId, 'Config:', config);

      // Get organization to check for custom document types and defaults (logo, stamp)
      const organization = await this.prisma.organization.findUnique({
        where: { id: organizationId },
        select: { customDocumentTypes: true, logo: true, defaultStamp: true },
      });

      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');

      // Get count of existing documents with same type and same month/year
      const count = await this.prisma.document.count({
        where: {
          type,
          organizationId,
          createdAt: {
            gte: new Date(`${year}-${month}-01T00:00:00Z`),
            lt: new Date(`${year}-${month}-31T23:59:59Z`),
          },
        },
      });

      const serial = String(count + 1).padStart(3, '0');

      // Use custom document type prefix if available, otherwise use the original type
      const customTypes = organization?.customDocumentTypes as Record<string, string> | null;
      const documentPrefix = customTypes?.[type] || type;
      const name = `${documentPrefix}${year}${month}-${serial}`;

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

      const newDocument = await this.prisma.document.create({
        data: {
          documentTemplateId,
          type,
          config: initialConfig,
          organizationId,
          name,
          revisionNumber: 0,
        },
      });

      return newDocument;
    } catch (error) {
      throw new HttpException(`Basic document creation failed: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
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
          status: original.status,
          name: nameWithRevision,
          baseDocumentId,
          revisionNumber: nextRevisionNumber,
        },
      });

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
}
