import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsNumber, Min, Max } from 'class-validator';

export class CreateOrganizationDto {
  @ApiProperty({
    description: 'The name of the organization',
    example: 'Acme Corporation',
  })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({
    description: 'Optional custom ID for the organization',
    example: 'custom-org-id',
    required: false,
  })
  @IsString()
  @IsOptional()
  id?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  address?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  phoneNumber?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  registrationNumber?: string;

  @ApiProperty({ required: false, description: 'Key/URL for organization logo' })
  @IsString()
  @IsOptional()
  logo?: string;

  @ApiProperty({ required: false, description: 'Key/URL for default company stamp' })
  @IsString()
  @IsOptional()
  defaultStamp?: string;

  @ApiProperty({
    required: false,
    description: 'Custom display names for document types (e.g., {"TI": "BI2025", "QO1": "Quote"})',
    example: { TI: 'BI2025', QO1: 'Custom Quote' },
  })
  @IsOptional()
  customDocumentTypes?: Record<string, string>;

  @ApiProperty({
    required: false,
    description: 'Tax rate percentage for the organization (e.g., 9 for 9%)',
    example: 9,
    minimum: 0,
    maximum: 100,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  taxRate?: number;
}
