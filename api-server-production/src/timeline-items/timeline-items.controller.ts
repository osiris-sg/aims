import { Controller, Get, Post, Body, Param, Delete, Put } from '@nestjs/common';
import { TimelineItemsService } from './timeline-items.service';
import { CreateTimelineItemDto } from './dto/create-timeline-item.dto';
import { UpdateTimelineItemDto } from './dto/update-timeline-item.dto';

@Controller('timeline-items')
export class TimelineItemsController {
  constructor(private readonly timelineItemsService: TimelineItemsService) {}

  @Post('create')
  async createTimelineItem(@Body() createDto: CreateTimelineItemDto) {
    return await this.timelineItemsService.createTimelineItem(createDto);
  }
  @Get('inventory/:inventoryId')
  async getByInventory(@Param('inventoryId') inventoryId: string) {
    return await this.timelineItemsService.getByInventory(inventoryId);
  }

  @Get('document/:documentId')
  async getByDocument(@Param('documentId') documentId: string) {
    return await this.timelineItemsService.getByDocument(documentId);
  }

  @Get(':id')
  async getById(@Param('id') id: string) {
    return await this.timelineItemsService.getById(id);
  }

  @Put('update')
  async updateTimelineItem(@Param('id') id: string, @Body() updateDto: UpdateTimelineItemDto) {
    return await this.timelineItemsService.updateTimelineItem(id, updateDto);
  }

  @Delete('delete')
  async deleteTimelineItem(@Param('id') id: string) {
    return await this.timelineItemsService.deleteTimelineItem(id);
  }
}
