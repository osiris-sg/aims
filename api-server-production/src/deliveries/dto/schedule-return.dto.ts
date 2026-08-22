import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsISO8601, IsOptional, IsString, IsUUID } from 'class-validator';

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

  @ApiProperty({ required: false, description: 'Optional office note for the collection.' })
  @IsOptional()
  @IsString()
  notes?: string;
}
