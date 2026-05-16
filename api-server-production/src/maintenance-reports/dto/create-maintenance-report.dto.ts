import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateMaintenanceReportDto {
  @ApiProperty({ description: 'Asset this service report is for (UUID).' })
  @IsUUID()
  assetId!: string;

  @ApiPropertyOptional({ description: 'Specific inventory unit serviced, when known.' })
  @IsOptional()
  @IsUUID()
  inventoryId?: string;

  @ApiProperty({ description: 'Free-text description of the work performed.' })
  @IsString()
  description!: string;

  @ApiPropertyOptional({ description: 'S3 keys of proof-of-service photos.' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  photos?: string[];

  @ApiPropertyOptional({ description: 'Display name of the technician (snapshot).' })
  @IsOptional()
  @IsString()
  technicianName?: string;
}
