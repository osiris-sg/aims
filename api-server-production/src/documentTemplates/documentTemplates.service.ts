import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService } from 'src/common/prisma.service';
import { GetDocumentTemplateDto } from './dto/get-documentTemplate.dto';
import { CreateDocumentTemplateDto } from './dto/create-documentTemplate.dto';
import { UpdateDocumentTemplateDto } from './dto/update-documentTemplate.dto';
import { DeleteDocumentTemplateDto } from './dto/delete-documentTemplate.dto';

@Injectable()
export class DocumentTemplatesService {
  constructor(private prisma: PrismaService) {}

  async getDocumentTemplates(getDocumentTemplateDto: GetDocumentTemplateDto, organizationId: string) {
    try {
      const { page, limit, search } = getDocumentTemplateDto;
      const skip = (page - 1) * limit;

      const documentTemplates = await this.prisma.documentTemplate.findMany({
        where: {
          organizationId,
          type: {
            contains: search || '',
            mode: 'insensitive',
          },
        },
        skip,
        take: limit,
        orderBy: {
          createdAt: 'desc',
        },
      });

      const totalDocs = await this.prisma.documentTemplate.count({
        where: {
          organizationId,
          type: {
            contains: search || '',
            mode: 'insensitive',
          },
        },
      });

      const hasNextPage = skip + documentTemplates.length < totalDocs;
      const hasPreviousPage = page > 1;
      return {
        docs: documentTemplates,
        hasNextPage,
        hasPreviousPage,
        page,
        limit,
        totalPagesCount: Math.ceil(totalDocs / limit),
        totalDocuments: totalDocs,
      };
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async getDocumentTemplateById(id: string, organizationId: string) {
    try {
      const documentTemplate = await this.prisma.documentTemplate.findFirst({
        where: {
          id,
          organizationId,
        },
      });

      if (!documentTemplate) {
        throw new HttpException('Document Template not found', HttpStatus.NOT_FOUND);
      }

      return documentTemplate;
    } catch (error) {
      console.error('Error fetching document template:', error);
      throw new HttpException(error.message || 'Internal Server Error', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async createDocumentTemplates(dto: CreateDocumentTemplateDto, organizationId: string) {
    try {
      console.log('we have this data at hee ', dto);

      const newDocumentTemplate = await this.prisma.documentTemplate.create({
        data: {
          name: dto.name,
          type: dto.type,
          organizationId, // Automatically assign to user's organization
        },
      });

      return newDocumentTemplate;
    } catch (error) {
      console.error('Error creating document template:', error);
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async updateDocumentTemplates(updateDto: UpdateDocumentTemplateDto, organizationId: string) {
    try {
      const { id, name, type } = updateDto;

      const updated = await this.prisma.documentTemplate.update({
        where: {
          id,
          organizationId, // Ensure user can only update templates in their organization
        },
        data: {
          ...(name && { name }),
          ...(type && { type }),
          config: {
            logo: updateDto.logo,
            customer: updateDto.customer,
            collectFrom: updateDto.collectFrom,
            deliveryTo: updateDto.deliveryTo,
            returnOrderNo: updateDto.returnOrderNo,
            doNo: updateDto.doNo,
            referenceNo: updateDto.referenceNo,
            poNo: updateDto.poNo,
            company: {
              name: updateDto.company?.name,
              address: updateDto.company?.address,
              phoneNumber: updateDto.company?.phoneNumber,
            },
            attention: {
              name: updateDto.attention?.name,
              phoneNumber: updateDto.attention?.phoneNumber,
            },
          },
        },
      });

      return updated;
    } catch (error) {
      console.error('Error updating document template:', error);
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async deleteDocumentTemplates(deleteDocumentTemplateDto: DeleteDocumentTemplateDto, organizationId: string) {
    try {
      // First, delete all related DocumentItem records
      // await this.prisma.documentItem.deleteMany({
      //   where: { documentTemplateId: deleteDocumentTemplateDto.id },
      // });

      // Then, delete the DocumentTemplate
      const documentTemplate = await this.prisma.documentTemplate.delete({
        where: {
          id: deleteDocumentTemplateDto.id,
          organizationId, // Ensure user can only delete templates in their organization
        },
      });

      return documentTemplate;
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
  async getDocumentTemplateByType(type: string, organizationId: string) {
    try {
      const documentTemplate = await this.prisma.documentTemplate.findFirst({
        where: {
          type,
          organizationId,
        },
      });

      if (!documentTemplate) {
        throw new HttpException(`Document Template of type "${type}" not found`, HttpStatus.NOT_FOUND);
      }

      return documentTemplate;
    } catch (error) {
      console.error('Error fetching document template by type:', error);
      throw new HttpException(error.message || 'Internal Server Error', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
