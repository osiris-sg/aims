import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class SignMaintenanceReportDto {
  @ApiProperty({ description: 'Signature payload — S3 key or base64 PNG data URL.' })
  @IsString()
  signature!: string;

  @ApiPropertyOptional({ description: 'Name of the person signing on the customer side.' })
  @IsOptional()
  @IsString()
  signedByName?: string;

  // The rendered signature IMAGES. The row's own `signature` column is what
  // gates status; these two are what every renderer actually draws, and they
  // live in serviceData beside the rest of the form. Sent together on the
  // sign-later path so one call finishes the report — a second endpoint could
  // fail on its own and leave a signed report with no visible signature.
  @ApiPropertyOptional({ description: 'S3 key of the technician signature image.' })
  @IsOptional()
  @IsString()
  techSignatureKey?: string;

  @ApiPropertyOptional({ description: 'S3 key of the customer signature image.' })
  @IsOptional()
  @IsString()
  clientSignatureKey?: string;
}
