import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

/** One scheduled line: an ASSET + a quantity (no specific unit — asset-only). */
export class ScheduleDeliveryItemDto {
  @ApiProperty({ description: 'Asset to schedule (UUID).' })
  @IsUUID()
  assetId!: string;

  @ApiProperty({ description: 'How many units of this asset to deliver.', default: 1 })
  @IsInt()
  @Min(1)
  quantity!: number;
}

/**
 * Office action: pre-create a delivery run to be picked up in the field. Items
 * are ASSET-ONLY (no specific unit is earmarked, so nothing is reserved until a
 * rider scans a matching unit). Rider + customer/project may be filled at start;
 * scheduledFor is the target date/time.
 */
export class ScheduleDeliveryDto {
  @ApiProperty({ description: 'Target delivery date/time (ISO-8601).' })
  @IsISO8601()
  scheduledFor!: string;

  @ApiProperty({ type: [ScheduleDeliveryItemDto] })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => ScheduleDeliveryItemDto)
  items!: ScheduleDeliveryItemDto[];

  @ApiProperty({ required: false, description: 'Optional drop customer (UUID).' })
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiProperty({ required: false, description: 'Optional project (UUID).' })
  @IsOptional()
  @IsUUID()
  projectId?: string;
}

/**
 * Field action: a rider claims a scheduled run by scanning a unit whose ASSET
 * matches one of its open scheduled items. Binds the unit to that item, reserves
 * it, sets the rider, and starts the run.
 */
export class ClaimScheduledDto {
  @ApiProperty({ description: 'The scanned unit being bound into the scheduled slot (UUID).' })
  @IsUUID()
  inventoryId!: string;

  @ApiProperty({ description: 'The scanned unit\'s asset (UUID) — must match an open scheduled slot.' })
  @IsUUID()
  assetId!: string;

  @ApiProperty({ required: false, description: 'Rider display name for the claimed run.' })
  @IsOptional()
  @IsString()
  riderName?: string;
}
