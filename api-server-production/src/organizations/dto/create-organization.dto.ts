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

  @ApiProperty({ required: false, description: 'Key/URL for organization logo (null to clear)' })
  @IsOptional()
  logo?: string | null;

  @ApiProperty({ required: false, description: 'Key/URL for default company stamp (null to clear)' })
  @IsOptional()
  defaultStamp?: string | null;

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

  @ApiProperty({ required: false, description: 'Org-wide default: tax applies to new documents.' })
  @IsOptional()
  taxApplicable?: boolean;

  @ApiProperty({ required: false, description: 'Org-wide default: absorb tax (back-calculated from a tax-inclusive total).' })
  @IsOptional()
  absorbTax?: boolean;

  @ApiProperty({ required: false, description: 'ISO currency code (SGD, USD, MYR, …) used as the default for new documents.' })
  @IsOptional()
  defaultCurrency?: string;

  @ApiProperty({ required: false, description: 'Round-down step for QF quote totals (Project rounds Discounted Price, Route rounds Nett). 0 = off.' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  quoteRoundingStep?: number;

  @ApiProperty({
    required: false,
    description: 'Per-doc-type defaults for T&Cs / Notes / Footer. Keyed by doc type (e.g. PO, QO1, INVOICE) → { tnc, notes, footerMessage }.',
    example: { PO: { tnc: '60-day payment terms', notes: '', footerMessage: 'Thank you.' } },
  })
  @IsOptional()
  docTypeDefaults?: Record<string, { tnc?: string; notes?: string; footerMessage?: string }>;

  @ApiProperty({
    required: false,
    description: 'Bank details for invoices (accountName, accountNumber, bankName, swiftCode, branchCode, bankCode, currencyCode)',
  })
  @IsOptional()
  bankDetails?: Record<string, string>;
}
