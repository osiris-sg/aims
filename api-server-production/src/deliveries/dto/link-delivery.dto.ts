import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayNotEmpty, IsArray, IsOptional, IsUUID } from 'class-validator';

/**
 * Office action: attach run ITEMS to an existing Delivery Order document.
 * Per-item linking — omitted itemIds = every currently-unlinked item
 * (backward-compatible whole-run call).
 */
export class LinkDeliveryDto {
  @ApiProperty({ description: 'The DELIVERY_ORDER document to link (UUID).' })
  @IsUUID()
  documentId!: string;

  @ApiPropertyOptional({
    description: 'DeliveryItem ids to link. Omitted → all unlinked items on the run.',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID(undefined, { each: true })
  itemIds?: string[];
}

/** Office action: create a DO pre-filled from the selected items, then auto-link them. */
export class CreateDoFromDeliveryDto {
  @ApiPropertyOptional({
    description: 'Template override. Omitted → org’s active DELIVERY_ORDER template resolution.',
  })
  @IsOptional()
  @IsUUID()
  documentTemplateId?: string;

  @ApiPropertyOptional({
    description: 'DeliveryItem ids the DO covers. Omitted → all unlinked items on the run.',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID(undefined, { each: true })
  itemIds?: string[];
}
