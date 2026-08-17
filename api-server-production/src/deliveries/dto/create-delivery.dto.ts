import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Min } from 'class-validator';

/**
 * Create a standalone Delivery run with its first item (the scanned unit).
 * The unit is atomically reserved (instock → reserved) — creation fails if
 * the unit is not available.
 */
export class CreateDeliveryDto {
  @ApiProperty({ description: 'Catalog asset of the first item (UUID).' })
  @IsUUID()
  assetId!: string;

  @ApiPropertyOptional({ description: 'Specific tracked unit being delivered, when known.' })
  @IsOptional()
  @IsUUID()
  inventoryId?: string;

  @ApiPropertyOptional({ description: "Run direction: OUTBOUND (default) or RETURN (collecting a rental back to stock).", enum: ['OUTBOUND', 'RETURN'] })
  @IsOptional()
  @IsIn(['OUTBOUND', 'RETURN'])
  direction?: 'OUTBOUND' | 'RETURN';

  @ApiPropertyOptional({ description: 'Free-text line description (defaults to asset/unit name).' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: 'Quantity for untracked items. Defaults to 1.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  quantity?: number;

  @ApiPropertyOptional({ description: 'Display name of the rider (snapshot).' })
  @IsOptional()
  @IsString()
  riderName?: string;

  @ApiPropertyOptional({ description: 'Target project, when already known.' })
  @IsOptional()
  @IsUUID()
  projectId?: string;

  @ApiPropertyOptional({ description: 'Customer, when already known.' })
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiPropertyOptional({ description: 'Free-text drop site when no project is linked yet.' })
  @IsOptional()
  @IsString()
  siteAddress?: string;

  @ApiPropertyOptional({ description: 'Rider notes.' })
  @IsOptional()
  @IsString()
  notes?: string;
}
