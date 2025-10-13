import { Controller, Get, Post, Body, Param, Delete, Req, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { DocumentsService } from './documents.service';
import { UpdateDocumentDto } from './dto/update-document.dto';
import { CreateDocumentWithTimelineDto } from './dto/create-document-with-timeline.dto';
import { GetDocumentDto } from './dto/get-documents';
import { ClerkAuthGuard } from 'src/auth/clerk-auth.guard';
import { Request } from 'express';
import { Permissions } from 'src/auth/decorators/permissions.decorator';
import { S3Service } from 'src/common/services/s3.service';
import { PdfGeneratorService } from 'src/common/services/pdf-generator.service';

// Extend Request type to include userOrganization
interface RequestWithOrganization extends Request {
  userOrganization?: {
    id: string;
    name: string;
  };
}
@Controller('documents')
@UseGuards(ClerkAuthGuard)
export class DocumentsController {
  constructor(
    private readonly documentsService: DocumentsService,
    private readonly s3Service: S3Service,
    private readonly pdfGeneratorService: PdfGeneratorService,
  ) {}

  @Post('with-timeline')
  @Permissions('documents:create-with-timeline')
  async createDocumentWithTimeline(@Body() dto: CreateDocumentWithTimelineDto, @Req() req: RequestWithOrganization) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }
    return await this.documentsService.createDocumentWithTimeline(dto, organizationId);
  }

  @Post('basic')
  @Permissions('documents:create-basic')
  async createBasicDocument(@Body() body: { documentTemplateId: string; type: string; config?: any }, @Req() req: RequestWithOrganization) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }
    return await this.documentsService.createBasicDocument(body.documentTemplateId, body.type, organizationId, body.config || {});
  }

  @Post()
  @Permissions('documents:read')
  async getAllDocuments(@Req() req: RequestWithOrganization): Promise<GetDocumentDto[]> {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }
    return await this.documentsService.getAllDocuments(organizationId);
  }

  @Get('delivery-orders/:customerId')
  @Permissions('documents:read')
  async getDeliveryOrdersByCustomer(@Param('customerId') customerId: string, @Req() req: RequestWithOrganization) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }
    return await this.documentsService.getDeliveryOrdersByCustomer(customerId, organizationId);
  }

  @Get('inventory/:inventoryId')
  @Permissions('documents:read-by-inventory')
  async getByInventory(@Param('inventoryId') inventoryId: string, @Req() req: RequestWithOrganization) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }
    return await this.documentsService.getByInventory(inventoryId, organizationId);
  }

  @Get('asset/:assetId')
  @Permissions('documents:read-by-asset')
  async getDocumentsByAsset(@Param('assetId') assetId: string, @Req() req: RequestWithOrganization) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }
    return await this.documentsService.getDocumentsByAsset(assetId, organizationId);
  }

  @Get('past-descriptions')
  @Permissions('documents:read')
  async getPastDescriptions(@Req() req: RequestWithOrganization) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }
    return await this.documentsService.getPastDescriptions(organizationId);
  }

  @Get(':id')
  @Permissions('documents:read-one')
  async getById(@Param('id') id: string, @Req() req: RequestWithOrganization) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }
    return await this.documentsService.getById(id, organizationId);
  }

  @Post('update')
  @Permissions('documents:update')
  async updateDocument(@Body() updateDto: UpdateDocumentDto, @Req() req: RequestWithOrganization) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }
    return await this.documentsService.updateDocument(updateDto, organizationId);
  }

  @Delete('delete/:id')
  @Permissions('documents:delete')
  async deleteDocument(@Param('id') id: string, @Req() req: RequestWithOrganization) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }
    return await this.documentsService.deleteDocument(id, organizationId);
  }

  @Post(':id/revisions')
  @Permissions('documents:create-revision')
  async createRevision(@Param('id') id: string, @Req() req: RequestWithOrganization) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }
    return await this.documentsService.createRevision(id, organizationId);
  }

  @Get(':id/revisions')
  @Permissions('documents:read')
  async listRevisions(@Param('id') id: string, @Req() req: RequestWithOrganization) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }
    return await this.documentsService.listRevisions(id, organizationId);
  }
  @Post('asset/tag-template')
  @Permissions('documents:tag-template-to-asset')
  async tagTemplateToAsset(@Body() body: { assetId: string; templateId: string }, @Req() req: RequestWithOrganization) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }
    return await this.documentsService.tagTemplateToAsset(body.assetId, body.templateId, organizationId);
  }

  @Delete('asset/untag-template')
  @Permissions('documents:untag-template-from-asset')
  async untagTemplateFromAsset(@Body() body: { assetId: string; templateId: string }, @Req() req: RequestWithOrganization) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }
    return await this.documentsService.untagTemplateFromAsset(body.assetId, body.templateId, organizationId);
  }

  @Post('generate-pdf')
  @Permissions('documents:generate-pdf')
  async generatePdf(
    @Body() body: {
      documentType: string;
      documentId: string;
      data: any;
    },
    @Req() req: RequestWithOrganization,
  ) {
    try {
      const organizationId = req.userOrganization?.id;
      if (!organizationId) {
        throw new HttpException('User is not assigned to any organization', HttpStatus.FORBIDDEN);
      }

      // Generate HTML based on document type
      let html: string;
      if (body.documentType === 'TI') {
        // Tax Invoice
        html = this.pdfGeneratorService.generateInvoiceHtml(body.data);
      } else {
        // For other document types, we'll use the invoice template for now
        // You can create separate templates for each type later
        html = this.pdfGeneratorService.generateInvoiceHtml(body.data);
      }

      // Generate PDF from HTML
      const pdfBuffer = await this.pdfGeneratorService.generatePdfFromHtml(html);

      // Upload to S3
      const { url, key } = await this.s3Service.uploadPdf(
        organizationId,
        body.documentType,
        body.documentId || `temp_${Date.now()}`,
        pdfBuffer,
      );

      // Get signed URL for secure access
      const signedUrl = await this.s3Service.getSignedUrl(key, 3600); // 1 hour expiry

      return {
        success: true,
        url: signedUrl,
        key: key,
        message: 'PDF generated and uploaded successfully',
      };
    } catch (error) {
      console.error('Error generating PDF:', error);
      throw new HttpException(
        error.message || 'Failed to generate PDF',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
