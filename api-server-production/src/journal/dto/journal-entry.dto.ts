import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class JournalLineDto {
  @ApiProperty({ description: 'ChartOfAccount.id' })
  @IsString()
  accountId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ default: 0 })
  @IsNumber()
  @Min(0)
  debit: number;

  @ApiProperty({ default: 0 })
  @IsNumber()
  @Min(0)
  credit: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  foreignAmount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  exchangeRate?: number;
}

export class CreateJournalEntryDto {
  @ApiPropertyOptional({ description: 'Auto-generated when omitted' })
  @IsOptional()
  @IsString()
  journalNumber?: string;

  @ApiProperty({ example: '2026-04-18' })
  @IsDateString()
  entryDate: string;

  @ApiProperty({
    enum: ['MANUAL', 'INVOICE', 'PAYMENT', 'CREDIT_NOTE', 'DEBIT_NOTE', 'PURCHASE_ORDER', 'PURCHASE_RETURN', 'OPENING_BALANCE', 'ADJUSTMENT'],
  })
  @IsIn(['MANUAL', 'INVOICE', 'PAYMENT', 'CREDIT_NOTE', 'DEBIT_NOTE', 'PURCHASE_ORDER', 'PURCHASE_RETURN', 'OPENING_BALANCE', 'ADJUSTMENT'])
  type: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reference?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ default: 'SGD' })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sourceDocumentId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sourcePaymentId?: string;

  @ApiProperty({ type: [JournalLineDto] })
  @IsArray()
  @ArrayMinSize(2)
  @ValidateNested({ each: true })
  @Type(() => JournalLineDto)
  lines: JournalLineDto[];
}

export class UpdateJournalEntryDto extends PartialType(CreateJournalEntryDto) {}
