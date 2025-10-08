import { Controller, Get, Post, Body, Param, Delete, Req, UseGuards } from '@nestjs/common';
import { DocumentsService } from './documents.service';
import { UpdateDocumentDto } from './dto/update-document.dto';
import { CreateDocumentWithTimelineDto } from './dto/create-document-with-timeline.dto';
import { GetDocumentDto } from './dto/get-documents';
import { ClerkAuthGuard } from 'src/auth/clerk-auth.guard';
import { Request } from 'express';
import { Permissions } from 'src/auth/decorators/permissions.decorator';

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
}
