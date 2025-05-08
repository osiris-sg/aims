import { Controller, Post, Body, Delete, Get, Param } from '@nestjs/common';
import { DocumentTemplatesService } from './documentTemplates.service';
import { GetDocumentTemplateDto } from './dto/get-documentTemplate.dto';
import { CreateDocumentTemplateDto } from './dto/create-documentTemplate.dto';
import { UpdateDocumentTemplateDto } from './dto/update-documentTemplate.dto';
import { DeleteDocumentTemplateDto } from './dto/delete-documentTemplate.dto';

@Controller('documentTemplates')
export class DocumentTemplatesController {
  constructor(private readonly documentTemplatesService: DocumentTemplatesService) {}

  @Post()
  async getDocumentTemplates(@Body() getDocumentTemplateDto: GetDocumentTemplateDto) {
    return await this.documentTemplatesService.getDocumentTemplates(getDocumentTemplateDto);
  }

  @Get(':id')
  getDocumentTemplateByID(@Param('id') id: string) {
    return this.documentTemplatesService.getDocumentTemplateById(id);
  }

  @Post('create')
  async createDocumentTemplates(@Body() createDocumentTemplateDto: CreateDocumentTemplateDto) {
    return await this.documentTemplatesService.createDocumentTemplates(createDocumentTemplateDto);
  }

  @Post('update')
  async updateDocumentTemplates(@Body() updateDocumentTemplateDto: UpdateDocumentTemplateDto) {
    return await this.documentTemplatesService.updateDocumentTemplates(updateDocumentTemplateDto);
  }

  @Delete('delete')
  async deleteDocumentTemplates(@Body() deleteDocumentTemplateDto: DeleteDocumentTemplateDto) {
    return await this.documentTemplatesService.deleteDocumentTemplates(deleteDocumentTemplateDto);
  }
}
