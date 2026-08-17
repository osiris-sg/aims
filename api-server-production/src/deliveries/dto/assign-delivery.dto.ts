import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsIn, IsNumber, IsOptional, IsString, IsUUID } from 'class-validator';

/**
 * Field action: assign an acknowledged unit to a project from INSIDE the
 * delivery flow. Delegates to projects.fieldDeploy (Assignment +
 * ProjectDeployment + unit status flip) — no duplicated assignment logic.
 *
 * NO `type` (RENTAL/SALE): rental-vs-sale is a commercial decision that belongs
 * to the office/DO, not the rider — the in-flow assign always defaults to
 * RENTAL (fieldDeploy's default). A sale is set office-side via a SALE
 * ProjectDeployment on the DO.
 */
export class AssignDeliveryItemDto {
  @ApiProperty({ description: 'Target project (UUID).' })
  @IsUUID()
  projectId!: string;

  @ApiProperty({ description: 'The delivered unit being assigned (UUID).' })
  @IsUUID()
  inventoryId!: string;
}

/**
 * Office action (Deliveries page): set a delivered unit's commercial intent —
 * RENTAL vs SALE — for a delivery-run item. This ONLY writes the item's active
 * ProjectDeployment.type; it never flips Inventory.status. The reserved →
 * rental/sold flip stays with DO-confirm/ack, which read this type — so there
 * is exactly one flip path. SALE requires the unit to already be assigned to a
 * project (a ProjectDeployment to write to); RENTAL is the default.
 */
export class SetDeploymentTypeDto {
  @ApiProperty({ description: 'The delivered unit whose deployment type is being set (UUID).' })
  @IsUUID()
  inventoryId!: string;

  @ApiProperty({ enum: ['RENTAL', 'SALE'], description: 'Commercial intent for the unit.' })
  @IsIn(['RENTAL', 'SALE'])
  type!: 'RENTAL' | 'SALE';
}

/** Field action: rider says installation is not needed — item completes with installSkipped. */
export class SkipInstallDto {
  @ApiProperty({ description: 'The unit whose installation is being skipped (UUID).' })
  @IsUUID()
  inventoryId!: string;
}

/**
 * Field action: append more condition photos to a unit's EXISTING DO_START
 * report after delivery has started (no second DO_START is created).
 */
export class AddItemPhotosDto {
  @ApiProperty({ description: 'The unit whose DO_START photos are being appended (UUID).' })
  @IsUUID()
  inventoryId!: string;

  @ApiProperty({ description: 'S3 keys of the newly captured condition photos to append.', type: [String] })
  @IsArray()
  @IsString({ each: true })
  photos!: string[];
}

/**
 * Field action: "Acknowledge all" — one signature + one photo + GPS applied to
 * every unit currently delivering on the run (one DO_ACK MSR per unit).
 */
export class AckAllDto {
  @ApiProperty({ required: false, description: 'Customer signature (data URL / S3 key).' })
  @IsOptional()
  @IsString()
  signature?: string;

  @ApiProperty({ required: false, description: 'Recipient / signer name.' })
  @IsOptional()
  @IsString()
  recipientName?: string;

  @ApiProperty({ required: false, description: 'S3 keys of the shared proof photo(s).', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  photos?: string[];

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  latitude?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  longitude?: number;

  @ApiProperty({ required: false, description: 'Rider display name for the report.' })
  @IsOptional()
  @IsString()
  technicianName?: string;
}
