import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { UpdateDocumentDto } from './dto/update-document.dto';
import { PrismaService } from 'src/common/prisma.service';
import { CreateDocumentWithTimelineDto } from './dto/create-document-with-timeline.dto';

@Injectable()
export class DocumentsService {
  constructor(private prisma: PrismaService) {}

  async getById(id: string) {
    try {
      return await this.prisma.document.findUnique({
        where: { id },
      });
    } catch (error) {
      throw new HttpException(`Fetch by ID failed: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async getByInventory(inventoryId: string) {
    try {
      return await this.prisma.document.findMany({
        where: {},
        orderBy: { createdAt: 'desc' },
      });
    } catch (error) {
      throw new HttpException(`Fetch by inventory failed: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async updateDocument(dto: UpdateDocumentDto) {
    try {
      const configAsPlainObject: any = dto.config ? dto.config : null;
      const id: any = dto.id ? dto.id : null;

      const updatedDocument = await this.prisma.document.update({
        where: { id },
        data: {
          config: configAsPlainObject,
          type: dto.type,
        },
      });

      return updatedDocument;
    } catch (error) {
      throw new HttpException(`Update failed: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async deleteDocument(id: string) {
    try {
      return await this.prisma.document.delete({
        where: { id },
      });
    } catch (error) {
      throw new HttpException(`Delete failed: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async createDocumentWithTimeline(dto: CreateDocumentWithTimelineDto) {
    return this.prisma.$transaction(async (tx) => {
      try {
        const configAsPlainObject: any = dto.config ? dto.config : null;

        const createdDocument = await tx.document.create({
          data: {
            organizationId: dto.organizationId,
            documentTemplateId: dto.documentTemplateId,
            type: dto.type || 'Default',
            config: configAsPlainObject,
          },
        });

        await Promise.all(
          dto.config.items.map(async (_item) => {
            // Determine new inventory status and timeline messages based on document type
            let newStatus = 'INSTOCK';
            let docMessage = 'A RDO document is submitted';
            let statusChangeMessage = 'Item has been changed from Rental to Instock';

            if (dto.type === 'DO') {
              newStatus = 'RENTAL';
              docMessage = 'A DO document is submitted';
              statusChangeMessage = 'Item has been changed from Instock to Rental';
            }

            // Update inventory status
            await tx.inventory.update({
              where: { id: _item.inventoryItemId },
              data: {
                status: newStatus,
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
}
