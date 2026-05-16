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
}
