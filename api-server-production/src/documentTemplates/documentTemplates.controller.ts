import { Controller, Post, Body, Delete, Get, Param, Req, UseGuards } from '@nestjs/common';
import { DocumentTemplatesService } from './documentTemplates.service';
import { GetDocumentTemplateDto } from './dto/get-documentTemplate.dto';
import { CreateDocumentTemplateDto } from './dto/create-documentTemplate.dto';
import { UpdateDocumentTemplateDto } from './dto/update-documentTemplate.dto';
import { DeleteDocumentTemplateDto } from './dto/delete-documentTemplate.dto';
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

@Controller('documentTemplates')
@UseGuards(ClerkAuthGuard)
export class DocumentTemplatesController {
  constructor(private readonly documentTemplatesService: DocumentTemplatesService) {}

  @Post()
  @Permissions('documentTemplates:read')
  async getDocumentTemplates(@Body() getDocumentTemplateDto: GetDocumentTemplateDto, @Req() req: RequestWithOrganization) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }
    return await this.documentTemplatesService.getDocumentTemplates(getDocumentTemplateDto, organizationId);
  }

  @Get(':id')
  @Permissions('documentTemplates:read-one')
  getDocumentTemplateByID(@Param('id') id: string, @Req() req: RequestWithOrganization) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }
    return this.documentTemplatesService.getDocumentTemplateById(id, organizationId);
  }

  @Post('create')
  @Permissions('documentTemplates:create')
  async createDocumentTemplates(@Body() createDocumentTemplateDto: CreateDocumentTemplateDto, @Req() req: RequestWithOrganization) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }
    return await this.documentTemplatesService.createDocumentTemplates(createDocumentTemplateDto, organizationId);
  }

  @Post('update')
  @Permissions('documentTemplates:update')
  async updateDocumentTemplates(@Body() updateDocumentTemplateDto: UpdateDocumentTemplateDto, @Req() req: RequestWithOrganization) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }
    return await this.documentTemplatesService.updateDocumentTemplates(updateDocumentTemplateDto, organizationId);
  }

  @Delete('delete')
  @Permissions('documentTemplates:delete')
  async deleteDocumentTemplates(@Body() deleteDocumentTemplateDto: DeleteDocumentTemplateDto, @Req() req: RequestWithOrganization) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }
    return await this.documentTemplatesService.deleteDocumentTemplates(deleteDocumentTemplateDto, organizationId);
  }

  @Get('type/:type')
  @Permissions('documentTemplates:read')
  async getDocumentTemplateByType(@Param('type') type: string, @Req() req: RequestWithOrganization) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }
    return await this.documentTemplatesService.getDocumentTemplateByType(type, organizationId);
  }

  // Template Variants Management
  @Get('variants/:type')
  @Permissions('documentTemplates:read')
  async getTemplateVariantsByType(@Param('type') type: string, @Req() req: RequestWithOrganization) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }
    return await this.documentTemplatesService.getTemplateVariantsByType(type, organizationId);
  }

  @Post('variants/:id/activate')
  @Permissions('documentTemplates:update')
  async activateTemplateVariant(@Param('id') id: string, @Req() req: RequestWithOrganization) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }
    return await this.documentTemplatesService.activateTemplateVariant(id, organizationId);
  }

  @Post('variants/:id/duplicate')
  @Permissions('documentTemplates:create')
  async duplicateTemplateVariant(
    @Param('id') id: string,
    @Body() body: { designName: string; description?: string },
    @Req() req: RequestWithOrganization,
  ) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }
    return await this.documentTemplatesService.duplicateTemplateVariant(id, organizationId, body.designName, body.description);
  }

  @Get('mock-data/:type')
  @Permissions('documentTemplates:read')
  async getMockDataForType(@Param('type') type: string) {
    return await this.documentTemplatesService.getMockDataForType(type);
  }

}
