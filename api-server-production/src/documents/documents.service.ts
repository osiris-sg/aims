import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { UpdateDocumentDto } from './dto/update-document.dto';
import { PrismaService } from 'src/common/prisma.service';
import { CreateDocumentWithTimelineDto } from './dto/create-document-with-timeline.dto';
import { InventoryStatus } from '@prisma/client';
@Injectable()
export class DocumentsService {
  constructor(private prisma: PrismaService) {}

  async getById(id: string, organizationId: string) {
    try {
      return await this.prisma.document.findFirst({
        where: {
          id,
          organizationId,
        },
      });
    } catch (error) {
      throw new HttpException(`Fetch by ID failed: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async getByInventory(inventoryId: string, organizationId: string) {
    try {
      return await this.prisma.document.findMany({
        where: {
          inventory: {
            id: inventoryId,
          },
          organizationId: organizationId,
        },
        orderBy: { createdAt: 'desc' },
      });
    } catch (error) {
      throw new HttpException(`Fetch by inventory failed: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async updateDocument(dto: UpdateDocumentDto, organizationId: string) {
    try {
      const configAsPlainObject: any = dto.config ? dto.config : null;
      const id: any = dto.id ? dto.id : null;

      // Update the document itself, include customer if provided
      const updatedDocument = await this.prisma.document.update({
        where: {
          id,
          organizationId, // Ensure user can only update documents in their organization
        },
        data: {
          config: configAsPlainObject,
          type: dto.type,
          // Connect customer if customerId provided
          customer: dto.customerId ? { connect: { id: dto.customerId } } : undefined,
          project: dto.projectId ? { connect: { id: dto.projectId } } : undefined,
        },
      });

      if (dto.projectId) {
        await this.prisma.project.update({
          where: {
            id: dto.projectId,
            organizationId, // Ensure project belongs to the same organization
          },
          data: {
            customerId: dto.customerId || undefined,
            startDate: dto.config?.startDate || undefined,
          },
        });
      }

      // If config.items exists and is an array, handle inventory/timeline logic
      if (dto.config && Array.isArray(dto.config.items)) {
        await Promise.all(
          dto.config.items.map(async (_item) => {
            // Use dto.status if provided, otherwise default based on type
            const newStatus: InventoryStatus = (dto.status as InventoryStatus) || (dto.type === 'DO' ? InventoryStatus.rental : InventoryStatus.instock);
            const docMessage = dto.type === 'DO' ? 'A DO document is updated' : 'A RDO document is updated';
            const statusChangeMessage = dto.type === 'DO' ? 'Item has been changed from instock to rental' : 'Item has been changed from rental to instock';

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
            // Connect inventory to the document
            await this.prisma.document.update({
              where: {
                id,
                organizationId,
              },
              data: {
                inventory: {
                  connect: { id: _item.inventoryItemId },
                },
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
          }),
        );
      }

      if (dto.projectId && dto.config?.items?.length) {
        await Promise.all(
          dto.config.items.map(async (_item) => {
            const existingAssignment = await this.prisma.assignment.findFirst({
              where: {
                projectId: dto.projectId,
                inventoryId: _item.inventoryItemId,
              },
            });

            if (!existingAssignment) {
              await this.prisma.assignment.create({
                data: {
                  projectId: dto.projectId,
                  inventoryId: _item.inventoryItemId,
                  startDate: dto.config.startDate || null,
                  endDate: dto.config.endDate || null,
                },
              });
            }
          }),
        );
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

        const createdDocument = await tx.document.create({
          data: {
            documentTemplateId: dto.documentTemplateId,
            type: dto.type || 'Default',
            config: configAsPlainObject,
            organizationId, // Automatically assign to user's organization
            customerId: dto.customerId,
          },
        });

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
            await tx.document.update({
              where: { id: createdDocument.id },
              data: {
                inventory: {
                  connect: { id: _item.inventoryItemId },
                },
              },
            });
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

        return createdDocument;
      } catch (error) {
        throw new HttpException(`Update failed: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
      }
    });
  }
  async createBasicDocument(documentTemplateId: string, type: string, organizationId: string, config: any = {}) {
    try {
      console.log('Creating basic document with template ID:', documentTemplateId, 'Type:', type, 'Organization ID:', organizationId, 'Config:', config);
      const newDocument = await this.prisma.document.create({
        data: {
          documentTemplateId,
          type,
          config,
          organizationId,
        },
      });

      return newDocument;
    } catch (error) {
      throw new HttpException(`Basic document creation failed: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
  async getAllDocuments(organizationId: string) {
    try {
      const documents = await this.prisma.document.findMany({
        where: {
          organizationId: organizationId,
        },
        include: {
          inventory: true,
          customer: true,
        },
        orderBy: { createdAt: 'desc' },
      });

      return documents.map((doc) => ({
        id: doc.id,
        name: doc.type,
        associated_item: doc.inventory?.sku ?? 'N/A',
        associated_customer: doc.customer?.name ?? 'N/A',
        documentType: doc.type,
        templateId: doc.documentTemplateId,
        createdAt: doc.createdAt,
      }));
    } catch (error) {
      throw new HttpException(`Fetch all documents failed: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
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

  async tagTemplateToAsset(assetId: string, templateId: string, organizationId: string) {
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

  async untagTemplateFromAsset(assetId: string, templateId: string, organizationId: string) {
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
}
