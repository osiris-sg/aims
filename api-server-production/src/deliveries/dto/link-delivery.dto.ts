import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

/** Office action: attach a run to an existing Delivery Order document. */
export class LinkDeliveryDto {
  @ApiProperty({ description: 'The DELIVERY_ORDER document to link (UUID).' })
  @IsUUID()
  documentId!: string;
}

/** Office action: create a DO pre-filled from the run, then auto-link. */
export class CreateDoFromDeliveryDto {
  @ApiPropertyOptional({
    description: 'Template override. Omitted → org’s active DELIVERY_ORDER template resolution.',
  })
  @IsOptional()
  @IsUUID()
  documentTemplateId?: string;
}
