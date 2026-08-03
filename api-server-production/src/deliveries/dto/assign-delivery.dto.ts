import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsUUID } from 'class-validator';

/**
 * Field action: assign an acknowledged unit to a project from INSIDE the
 * delivery flow. Delegates to projects.fieldDeploy (Assignment +
 * ProjectDeployment + unit status flip) — no duplicated assignment logic.
 */
export class AssignDeliveryItemDto {
  @ApiProperty({ description: 'Target project (UUID).' })
  @IsUUID()
  projectId!: string;

  @ApiProperty({ description: 'The delivered unit being assigned (UUID).' })
  @IsUUID()
  inventoryId!: string;

  @ApiPropertyOptional({ description: 'Deployment type. Defaults to RENTAL.', enum: ['RENTAL', 'SALE'] })
  @IsOptional()
  @IsIn(['RENTAL', 'SALE'])
  type?: 'RENTAL' | 'SALE';
}

/** Field action: rider says installation is not needed — item completes with installSkipped. */
export class SkipInstallDto {
  @ApiProperty({ description: 'The unit whose installation is being skipped (UUID).' })
  @IsUUID()
  inventoryId!: string;
}
