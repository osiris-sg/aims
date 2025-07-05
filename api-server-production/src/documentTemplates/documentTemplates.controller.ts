import { Controller, Post, Body, Delete, Get, Param, Req, UseGuards } from '@nestjs/common';
import { DocumentTemplatesService } from './documentTemplates.service';
import { GetDocumentTemplateDto } from './dto/get-documentTemplate.dto';
import { CreateDocumentTemplateDto } from './dto/create-documentTemplate.dto';
import { UpdateDocumentTemplateDto } from './dto/update-documentTemplate.dto';
import { DeleteDocumentTemplateDto } from './dto/delete-documentTemplate.dto';
import { ClerkAuthGuard } from 'src/auth/clerk-auth.guard';
import { Request } from 'express';

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
  async getDocumentTemplates(@Body() getDocumentTemplateDto: GetDocumentTemplateDto, @Req() req: RequestWithOrganization) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }
    return await this.documentTemplatesService.getDocumentTemplates(getDocumentTemplateDto, organizationId);
  }

  @Get(':id')
  getDocumentTemplateByID(@Param('id') id: string, @Req() req: RequestWithOrganization) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }
    return this.documentTemplatesService.getDocumentTemplateById(id, organizationId);
  }

  @Post('create')
  async createDocumentTemplates(@Body() createDocumentTemplateDto: CreateDocumentTemplateDto, @Req() req: RequestWithOrganization) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }
    return await this.documentTemplatesService.createDocumentTemplates(createDocumentTemplateDto, organizationId);
  }

  @Post('update')
  async updateDocumentTemplates(@Body() updateDocumentTemplateDto: UpdateDocumentTemplateDto, @Req() req: RequestWithOrganization) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }
    return await this.documentTemplatesService.updateDocumentTemplates(updateDocumentTemplateDto, organizationId);
  }

  @Delete('delete')
  async deleteDocumentTemplates(@Body() deleteDocumentTemplateDto: DeleteDocumentTemplateDto, @Req() req: RequestWithOrganization) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }
    return await this.documentTemplatesService.deleteDocumentTemplates(deleteDocumentTemplateDto, organizationId);
  }
}
