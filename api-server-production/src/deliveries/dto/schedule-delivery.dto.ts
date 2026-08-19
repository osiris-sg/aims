import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { AssetClass } from '@prisma/client';

/**
 * One scheduled line. EITHER a catalog product (assetId) + quantity, OR a
 * FREE-TYPED line (description only, no assetId — office resolves it later; a
 * rider can never unit-bind to it). Exactly one of assetId/description is used.
 */
export class ScheduleDeliveryItemDto {
  @ApiProperty({ required: false, description: 'Catalog asset (UUID). Omit for a free-typed line.' })
  @IsOptional()
  @IsUUID()
  assetId?: string;

  @ApiProperty({ required: false, description: 'Free-typed description (used when no assetId).' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ description: 'How many units of this line to deliver.', default: 1 })
  @IsInt()
  @Min(1)
  quantity!: number;

  @ApiProperty({
    required: false,
    enum: AssetClass,
    description:
      'Equipment or Accessory. Only meaningful on a FREE-TYPED line (a catalog line reads the class off its asset). Omitted → EQUIPMENT.',
  })
  @IsOptional()
  @IsEnum(AssetClass)
  assetClass?: AssetClass;
}

/**
 * Attention snapshot for the draft DO — name plus optional phone/email. Mirrors
 * config.attention so it round-trips through the DO editor.
 */
export class ScheduleAttentionDto {
  @ApiProperty({ description: 'Contact person the DO is addressed to.' })
  @IsString()
  name!: string;

  @ApiProperty({ required: false, description: 'Contact phone (DO "Mobile" row).' })
  @IsOptional()
  @IsString()
  phoneNumber?: string;

  @ApiProperty({ required: false, description: 'Contact email (downstream email flows).' })
  @IsOptional()
  @IsString()
  email?: string;
}

/**
 * Office action: pre-create a delivery run to be picked up in the field. Items
 * are ASSET-ONLY (no specific unit is earmarked, so nothing is reserved until a
 * rider scans a matching unit). Rider + customer/project may be filled at start;
 * scheduledFor is the target date/time.
 */
export class ScheduleDeliveryDto {
  @ApiProperty({
    required: false,
    description:
      'Target delivery date/time (ISO-8601). REQUIRED for a real schedule; optional when isDraft, since a draft is by definition unfinished.',
  })
  @ValidateIf((o) => !o.isDraft)
  @IsISO8601()
  scheduledFor?: string;

  @ApiProperty({ type: [ScheduleDeliveryItemDto], required: false })
  @IsArray()
  @ValidateIf((o) => !o.isDraft)
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => ScheduleDeliveryItemDto)
  items?: ScheduleDeliveryItemDto[];

  @ApiProperty({ required: false, description: 'Optional drop customer (UUID). Derived from the project when omitted.' })
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiProperty({
    required: false,
    description:
      'Project (UUID). REQUIRED for a real schedule (the rider is matched back to the run by the project they assign in the field), optional when isDraft.',
  })
  @ValidateIf((o) => !o.isDraft)
  @IsUUID()
  projectId?: string;

  @ApiProperty({
    required: false,
    description:
      'Save as an office DRAFT: whatever has been entered so far, however little. A draft is invisible to riders and mints no Delivery Order.',
  })
  @IsOptional()
  @IsBoolean()
  isDraft?: boolean;

  @ApiProperty({ required: false, description: "Customer PO number — lands on the draft DO's config.poNo (\"Your PO No.\")." })
  @IsOptional()
  @IsString()
  poNumber?: string;

  @ApiProperty({
    required: false,
    description:
      'Delivery/site address (free text; auto-filled from the project in the UI). Lands on the run\'s siteAddress AND the draft DO\'s config.deliveryTo ("Deliver To").',
  })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiProperty({
    required: false,
    description:
      'Machine location — free-text sub-location within the site (tower, floor, unit). NOT a saved address; per-delivery detail. Lands on the draft DO\'s config.machineLocation, rendered under "Deliver To".',
  })
  @IsOptional()
  @IsString()
  machineLocation?: string;

  @ApiProperty({
    required: false,
    type: () => ScheduleAttentionDto,
    description:
      "Attention snapshot for the draft DO (name/phone/email). Prefilled in the UI from the project's first contact but editable; omitted → backend derives it from the project's contacts. Frozen onto config.attention.",
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => ScheduleAttentionDto)
  attention?: ScheduleAttentionDto;
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
