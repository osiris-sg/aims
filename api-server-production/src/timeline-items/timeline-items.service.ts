import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { CreateTimelineItemDto } from './dto/create-timeline-item.dto';
import { UpdateTimelineItemDto } from './dto/update-timeline-item.dto';
import { PrismaService } from 'src/common/prisma.service';

@Injectable()
export class TimelineItemsService {
  constructor(private prisma: PrismaService) {}

  async createTimelineItem(dto: CreateTimelineItemDto) {
    try {
      return await this.prisma.timelineItem.create({
        data: dto,
      });
    } catch (error) {
      throw new HttpException(`Create failed: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
  async getByInventory(inventoryId: string) {
    try {
      return await this.prisma.timelineItem.findMany({
        where: { inventoryId },
        orderBy: { createdAt: 'asc' },
      });
    } catch (error) {
      throw new HttpException(`Fetch by inventory failed: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async getByDocument(documentId: string) {
    try {
      return await this.prisma.timelineItem.findMany({
        where: { documentId },
        orderBy: { createdAt: 'desc' },
      });
    } catch (error) {
      throw new HttpException(`Fetch by document failed: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async getById(id: string) {
    try {
      return await this.prisma.timelineItem.findUnique({
        where: { id },
      });
    } catch (error) {
      throw new HttpException(`Fetch by ID failed: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async updateTimelineItem(id: string, dto: UpdateTimelineItemDto) {
    try {
      return await this.prisma.timelineItem.update({
        where: { id },
        data: dto,
      });
    } catch (error) {
      throw new HttpException(`Update failed: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async deleteTimelineItem(id: string) {
    try {
      return await this.prisma.timelineItem.delete({
        where: { id },
      });
    } catch (error) {
      throw new HttpException(`Delete failed: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
