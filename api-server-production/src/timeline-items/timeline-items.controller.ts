import { Controller, Get, Post, Body, Param, Delete, Put } from '@nestjs/common';
import { TimelineItemsService } from './timeline-items.service';
import { CreateTimelineItemDto } from './dto/create-timeline-item.dto';
import { UpdateTimelineItemDto } from './dto/update-timeline-item.dto';
import { Permissions } from 'src/auth/decorators/permissions.decorator';

@Controller('timeline-items')
export class TimelineItemsController {
  constructor(private readonly timelineItemsService: TimelineItemsService) {}

  @Post('create')
  @Permissions('timeline-items:create')
  async createTimelineItem(@Body() createDto: CreateTimelineItemDto) {
    return await this.timelineItemsService.createTimelineItem(createDto);
  }
  @Get('inventory/:inventoryId')
  @Permissions('timeline-items:read-by-inventory')
  async getByInventory(@Param('inventoryId') inventoryId: string) {
    return await this.timelineItemsService.getByInventory(inventoryId);
  }

  @Get('document/:documentId')
  @Permissions('timeline-items:read-by-document')
  async getByDocument(@Param('documentId') documentId: string) {
    return await this.timelineItemsService.getByDocument(documentId);
  }

  @Get(':id')
  @Permissions('timeline-items:read-one')
  async getById(@Param('id') id: string) {
    return await this.timelineItemsService.getById(id);
  }

  @Put('update')
  @Permissions('timeline-items:update')
  async updateTimelineItem(@Param('id') id: string, @Body() updateDto: UpdateTimelineItemDto) {
    return await this.timelineItemsService.updateTimelineItem(id, updateDto);
  }

  @Delete('delete')
  @Permissions('timeline-items:delete')
  async deleteTimelineItem(@Param('id') id: string) {
    return await this.timelineItemsService.deleteTimelineItem(id);
  }
}
