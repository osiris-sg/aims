import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, IsUUID, Min } from 'class-validator';

/** Basket add: reserve another unit and append it to an in-progress run. */
export class AddDeliveryItemDto {
  @ApiProperty({ description: 'Catalog asset of the item (UUID).' })
  @IsUUID()
  assetId!: string;

  @ApiPropertyOptional({ description: 'Specific tracked unit being delivered, when known.' })
  @IsOptional()
  @IsUUID()
  inventoryId?: string;

  @ApiPropertyOptional({ description: 'Free-text line description.' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: 'Quantity for untracked items. Defaults to 1.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  quantity?: number;
}
