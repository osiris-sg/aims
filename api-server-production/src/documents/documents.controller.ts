import { Controller, Get, Post, Body, Param, Delete } from '@nestjs/common';
import { DocumentsService } from './documents.service';
import { UpdateDocumentDto } from './dto/update-document.dto';
import { CreateDocumentWithTimelineDto } from './dto/create-document-with-timeline.dto';
import { GetDocumentDto } from './dto/get-documents';
@Controller('documents')
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Post('with-timeline')
  async createDocumentWithTimeline(@Body() dto: CreateDocumentWithTimelineDto) {
    return await this.documentsService.createDocumentWithTimeline(dto);
  }

  @Post('basic')
  async createBasicDocument(@Body() body: { documentTemplateId: string; type: string; config?: any }) {
    return await this.documentsService.createBasicDocument(body.documentTemplateId, body.type, body.config || {});
  }

  @Get()
  async getAllDocuments(): Promise<GetDocumentDto[]> {
    return await this.documentsService.getAllDocuments();
  }

  @Get(':id')
  async getById(@Param('id') id: string) {
    return await this.documentsService.getById(id);
  }

  @Get('inventory/:inventoryId')
  async getByInventory(@Param('inventoryId') inventoryId: string) {
    return await this.documentsService.getByInventory(inventoryId);
  }

  @Post('update')
  async updateDocument(@Body() updateDto: UpdateDocumentDto) {
    return await this.documentsService.updateDocument(updateDto);
  }

  @Delete('delete/:id')
  async deleteDocument(@Param('id') id: string) {
    return await this.documentsService.deleteDocument(id);
  }
}
