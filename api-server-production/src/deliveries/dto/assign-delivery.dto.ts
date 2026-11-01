import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsIn, IsNumber, IsOptional, IsString, IsUUID } from 'class-validator';

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
  // The rider now picks a SCHEDULED RUN (by delivery address), not a project:
  // the chosen run supplies the project + customer, and the unit is merged into
  // THAT run (2026-08). The legacy projectId path is kept for the after-ack
  // assign screen, which still assigns by project and discovers the run.
  @ApiProperty({ required: false, description: 'Chosen scheduled run to merge this unit into (UUID). Supplies the project + customer.' })
  @IsOptional()
  @IsUUID()
  scheduledRunId?: string;

  @ApiProperty({ required: false, description: 'Target project (UUID). Legacy path — supply this OR scheduledRunId.' })
  @IsOptional()
  @IsUUID()
  projectId?: string;

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

/**
 * Office action (service-job orgs, WCT 2026-10-27): set a FREE-TYPED line's
 * class — Equipment (something supplied) or Service (work done on site). A
 * catalog line reads its class off its asset and is refused.
 */
export class SetItemAssetClassDto {
  @ApiProperty({ description: 'The delivery line (DeliveryItem UUID).' })
  @IsUUID()
  itemId!: string;

  @ApiProperty({ enum: ['EQUIPMENT', 'ACCESSORY', 'SERVICE'], description: 'The class to stamp on the line.' })
  @IsIn(['EQUIPMENT', 'ACCESSORY', 'SERVICE'])
  assetClass!: 'EQUIPMENT' | 'ACCESSORY' | 'SERVICE';
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

  @ApiProperty({
    required: false,
    description:
      'Unified bulk flow: the rider chose to install. Each OUTBOUND unit is installed (not skipped) and gets a DO_INSTALL report carrying installPhotos. Ignored for returns.',
  })
  @IsOptional()
  @IsBoolean()
  installNeeded?: boolean;

  @ApiProperty({ required: false, description: 'S3 keys of the shared install photo(s), replicated onto each unit.', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  installPhotos?: string[];

  @ApiProperty({
    required: false,
    enum: ['signature', 'stamped_do', 'paper'],
    description:
      'WCT finish modes (enableWctFinishModes): how the job is finished. signature (default) = the customer signs on the device; stamped_do = photo(s) of the DO the customer stamped (stampedDoPhotos), no signature; paper = marked completed, the paper copy comes back later, no signature. The last two wait for an admin to verify.',
  })
  @IsOptional()
  @IsIn(['signature', 'stamped_do', 'paper'])
  completionMode?: 'signature' | 'stamped_do' | 'paper';

  @ApiProperty({ required: false, description: 'S3 keys of the stamped-DO photo(s) (completionMode stamped_do).', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  stampedDoPhotos?: string[];

  @ApiProperty({ required: false, description: "The worker's note on a stamped-DO / paper finish." })
  @IsOptional()
  @IsString()
  completionNote?: string;
}

/** WCT finish modes: new evidence for a rejected job (or a note), which puts it back to "Awaiting verification". */
export class ResubmitEvidenceDto {
  @ApiProperty({ required: false, description: 'S3 keys of new stamped-DO photo(s).', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  photos?: string[];

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  note?: string;
}

/** WCT finish modes: the admin's reject reason. */
export class RejectJobDto {
  @ApiProperty({ description: 'Why the evidence is not accepted (shown to the worker and the office).' })
  @IsString()
  reason!: string;
}

/** Free-typed line START: guided condition photos (+ parallel angle labels) + GPS. */
export class FreeTypedStartDto {
  @ApiProperty({ required: false, description: 'S3 keys of the condition photos.', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  photos?: string[];

  @ApiProperty({ required: false, description: 'Per-photo angle labels, parallel to photos.', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  angles?: string[];

  @ApiProperty({ required: false, description: 'Rider display name for the report.' })
  @IsOptional()
  @IsString()
  technicianName?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  latitude?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  longitude?: number;
}

/** Free-typed line END DELIVERY: customer signature (required) + optional photos + GPS. */
export class FreeTypedEndDto {
  @ApiProperty({ required: false, description: 'Customer signature (data URL / S3 key). Required to complete.' })
  @IsOptional()
  @IsString()
  signature?: string;

  @ApiProperty({ required: false, description: 'Recipient / signer name.' })
  @IsOptional()
  @IsString()
  signedByName?: string;

  @ApiProperty({ required: false, description: 'S3 keys of proof photos.', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  photos?: string[];

  @ApiProperty({ required: false, description: 'Rider display name for the report.' })
  @IsOptional()
  @IsString()
  technicianName?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  latitude?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  longitude?: number;
}
