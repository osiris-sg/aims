import { ApiProperty } from '@nestjs/swagger';
import { AssetClass } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsArray, IsEnum, IsISO8601, IsOptional, IsString, IsUUID, MaxLength, MinLength, ValidateNested } from 'class-validator';

/**
 * A FREE-TYPED return line: text only, no unit and no deployment id.
 *
 * Mirrors ScheduleDeliveryItemDto's free-typed shape on the outbound side. Used
 * for two cases, and the service tells them apart itself:
 *   - the line went out through the system, so an ACTIVE description-only
 *     deployment already exists on the project -> that one is reused;
 *   - it went out before it was tracked -> the deployment + its open assignment
 *     are created on the fly, so the collect has something to off-hire.
 */
export class ScheduleReturnTypedLineDto {
  @ApiProperty({ description: 'What is being collected, e.g. "1 unit 60 es DG".' })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  description!: string;

  @ApiProperty({
    required: false,
    enum: AssetClass,
    description:
      'Equipment or Accessory — drives the return photo count (4 vs 1). Omitted → the class is recovered from the ORIGINAL outbound line, falling back to EQUIPMENT.',
  })
  @IsOptional()
  @IsEnum(AssetClass)
  assetClass?: AssetClass;
}

/**
 * Office action: pre-create a scheduled RETURN run to collect specific units
 * back from a customer. Unlike a scheduled delivery (asset-only slots bound in
 * the field), a return targets KNOWN units, so each is unit-bound from birth.
 * No document is pre-created (the RDO is minted at completion only) and nothing
 * is reserved (the units are already out on rental).
 */
export class ScheduleReturnDto {
  @ApiProperty({ description: 'Target collection date/time (ISO-8601).' })
  @IsISO8601()
  scheduledFor!: string;

  @ApiProperty({ description: 'Customer whose units are being collected (UUID).' })
  @IsUUID()
  customerId!: string;

  @ApiProperty({
    type: [String],
    required: false,
    description: 'Units to collect (inventory UUIDs). Each must be org-scoped and currently on rental. Optional if deploymentIds are given.',
  })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  inventoryIds?: string[];

  @ApiProperty({
    type: [String],
    required: false,
    description:
      'Description-only deployments to collect (ProjectDeployment UUIDs of free-typed lines with no unit). At least one of inventoryIds or deploymentIds is required.',
  })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  deploymentIds?: string[];

  @ApiProperty({
    type: [ScheduleReturnTypedLineDto],
    required: false,
    description:
      'Free-typed lines to collect, by TEXT rather than by id. Each either reuses a matching ACTIVE description-only deployment on the project, or gets one created on the fly. At least one of inventoryIds, deploymentIds or typedLines is required.',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ScheduleReturnTypedLineDto)
  typedLines?: ScheduleReturnTypedLineDto[];

  @ApiProperty({
    required: false,
    description:
      'Project the typed lines belong to. REQUIRED when typedLines are given: a free-typed line has no unit to infer a project from, and a deployment cannot be created or matched without one.',
  })
  @IsOptional()
  @IsUUID()
  projectId?: string;

  @ApiProperty({ required: false, description: 'Optional office note for the collection.' })
  @IsOptional()
  @IsString()
  notes?: string;
}
