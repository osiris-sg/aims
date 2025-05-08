import { IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateTimelineItemDto {
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
