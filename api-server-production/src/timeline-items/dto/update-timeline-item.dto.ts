import { PartialType } from '@nestjs/swagger';
import { CreateTimelineItemDto } from './create-timeline-item.dto';
import { IsOptional, IsString, IsUUID } from 'class-validator';

export class UpdateTimelineItemDto extends PartialType(CreateTimelineItemDto) {
  @IsUUID()
  id: string;

  @IsOptional()
  @IsString()
  message?: string;

  @IsOptional()
  @IsString()
  pdfUrl?: string;

  @IsOptional()
  @IsUUID()
  inventoryId?: string;

  @IsOptional()
  @IsUUID()
  documentId?: string;
}
