import { Controller, Get, Post, Body, Param, Delete, Req, UseGuards } from '@nestjs/common';
import { DocumentsService } from './documents.service';
import { UpdateDocumentDto } from './dto/update-document.dto';
import { CreateDocumentWithTimelineDto } from './dto/create-document-with-timeline.dto';
import { GetDocumentDto } from './dto/get-documents';
import { ClerkAuthGuard } from 'src/auth/clerk-auth.guard';
import { Request } from 'express';

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
  constructor(private readonly documentsService: DocumentsService) {}

  @Post('with-timeline')
  async createDocumentWithTimeline(@Body() dto: CreateDocumentWithTimelineDto, @Req() req: RequestWithOrganization) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }
    return await this.documentsService.createDocumentWithTimeline(dto, organizationId);
  }

  @Post('basic')
  async createBasicDocument(@Body() body: { documentTemplateId: string; type: string; config?: any }, @Req() req: RequestWithOrganization) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }
    return await this.documentsService.createBasicDocument(body.documentTemplateId, body.type, organizationId, body.config || {});
  }

  @Post()
  async getAllDocuments(@Req() req: RequestWithOrganization): Promise<GetDocumentDto[]> {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }
    return await this.documentsService.getAllDocuments(organizationId);
  }

  @Get(':id')
  async getById(@Param('id') id: string, @Req() req: RequestWithOrganization) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }
    return await this.documentsService.getById(id, organizationId);
  }

  @Get('inventory/:inventoryId')
  async getByInventory(@Param('inventoryId') inventoryId: string, @Req() req: RequestWithOrganization) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }
    return await this.documentsService.getByInventory(inventoryId, organizationId);
  }

  @Post('update')
  async updateDocument(@Body() updateDto: UpdateDocumentDto, @Req() req: RequestWithOrganization) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }
    return await this.documentsService.updateDocument(updateDto, organizationId);
  }

  @Delete('delete/:id')
  async deleteDocument(@Param('id') id: string, @Req() req: RequestWithOrganization) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }
    return await this.documentsService.deleteDocument(id, organizationId);
  }

  @Get('asset/:assetId')
  async getDocumentsByAsset(@Param('assetId') assetId: string, @Req() req: RequestWithOrganization) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }
    return await this.documentsService.getDocumentsByAsset(assetId, organizationId);
  }
  @Post('asset/tag-template')
  async tagTemplateToAsset(@Body() body: { assetId: string; templateId: string }, @Req() req: RequestWithOrganization) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }
    return await this.documentsService.tagTemplateToAsset(body.assetId, body.templateId, organizationId);
  }

  @Delete('asset/untag-template')
  async untagTemplateFromAsset(@Body() body: { assetId: string; templateId: string }, @Req() req: RequestWithOrganization) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }
    return await this.documentsService.untagTemplateFromAsset(body.assetId, body.templateId, organizationId);
  }
}
