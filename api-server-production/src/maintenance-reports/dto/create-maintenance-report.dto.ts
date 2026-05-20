import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsEnum, IsLatitude, IsLongitude, IsOptional, IsString, IsUUID } from 'class-validator';
import { MaintenanceReportKind } from '@prisma/client';

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

  @ApiPropertyOptional({
    description: 'Kind of field activity. Defaults to SERVICE if omitted.',
    enum: ['SERVICE', 'DO_START', 'DO_ACK'],
  })
  @IsOptional()
  @IsEnum(MaintenanceReportKind)
  kind?: MaintenanceReportKind;

  @ApiPropertyOptional({
    description: 'Document (typically a DO) this report relates to. Set on DO_START and DO_ACK.',
  })
  @IsOptional()
  @IsUUID()
  documentId?: string;

  @ApiPropertyOptional({ description: 'GPS latitude captured at submission.' })
  @IsOptional()
  @IsLatitude()
  latitude?: number;

  @ApiPropertyOptional({ description: 'GPS longitude captured at submission.' })
  @IsOptional()
  @IsLongitude()
  longitude?: number;

  @ApiPropertyOptional({ description: 'Reverse-geocoded human-readable location label.' })
  @IsOptional()
  @IsString()
  locationLabel?: string;
}
