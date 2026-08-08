import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsString, IsUUID } from 'class-validator';

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
