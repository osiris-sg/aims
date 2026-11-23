import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Swap unit on a delivered run (enableDeliveryUnitSwap, Admin only). Both fields
 * are optional at the validator so the service answers a missing one with its own
 * plain message ("A reason is required", "Pick the unit to swap in").
 */
export class SwapUnitDto {
  @ApiProperty({ description: 'The in-stock unit (Inventory id) of the same product that goes out in place of the line\'s unit.' })
  @IsOptional()
  @IsString()
  newInventoryId?: string;

  @ApiProperty({ description: 'Why the unit is swapped (required, kept on the Activity Log, the DO history and both units\' timelines).' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
