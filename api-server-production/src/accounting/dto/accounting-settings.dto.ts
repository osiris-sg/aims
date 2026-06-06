import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsDateString, IsNumber, IsObject, IsOptional, IsString } from 'class-validator';

export class UpdateAccountingSettingsDto {
  @ApiPropertyOptional({ example: 'SGD' })
  @IsOptional()
  @IsString()
  baseCurrency?: string;

  @ApiPropertyOptional({ description: 'Next-number counters per document type' })
  @IsOptional()
  @IsObject()
  nextNumbers?: Record<string, number>;

  @ApiPropertyOptional({ description: 'Prefix overrides per document type' })
  @IsOptional()
  @IsObject()
  numberPrefixes?: Record<string, string>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  activateLastSoldPrice?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  activateLastBuyPrice?: boolean;

  @ApiPropertyOptional({ description: 'When true, PO confirm posts Dr Inventory (not Purchases); invoice post adds Dr COGS / Cr Inventory.' })
  @IsOptional()
  @IsBoolean()
  enablePerpetualInventory?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  yearOpeningDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  yearOpeningStock?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  monthOpeningDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  monthOpeningStock?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  monthClosingStock?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  taxRegistrationNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  taxDefaultPercentage?: number;

  @ApiPropertyOptional({ example: 'GST' })
  @IsOptional()
  @IsString()
  taxReference?: string;

  @ApiPropertyOptional({ description: 'Account code ranges per section' })
  @IsOptional()
  @IsObject()
  accountCodeRanges?: Record<string, { from: string; to: string }>;

  @ApiPropertyOptional({ description: 'Control account code references' })
  @IsOptional()
  @IsObject()
  controlAccounts?: Record<string, string>;
}
