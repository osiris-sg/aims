import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Min, ValidateIf } from 'class-validator';

/**
 * Basket add: append an item to an in-progress run. Two shapes:
 *   • catalog item — `assetId` (+ optional `inventoryId`); reserves the unit.
 *   • FREE-TYPED item — no `assetId`/`inventoryId`, just `description` (+ qty);
 *     a description-only record with no reservation, resolved office-side later.
 * ValidateIf enforces: `description` is required when `assetId` is absent.
 */
export class AddDeliveryItemDto {
  @ApiPropertyOptional({ description: 'Catalog asset of the item (UUID). Omit for a free-typed line.' })
  @IsOptional()
  @IsUUID()
  assetId?: string;

  @ApiPropertyOptional({ description: 'Specific tracked unit being delivered, when known.' })
  @IsOptional()
  @IsUUID()
  inventoryId?: string;

  @ApiPropertyOptional({ description: 'Free-text line description. REQUIRED for a free-typed line (no assetId).' })
  @ValidateIf((o) => !o.assetId)
  @IsString()
  @IsNotEmpty()
  description?: string;

  @ApiPropertyOptional({ description: 'Quantity for untracked items. Defaults to 1.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  quantity?: number;
}
