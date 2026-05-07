import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateChartOfAccountDto {
  @ApiProperty({ example: 'S0001', description: 'Account code — unique per organization' })
  @IsString()
  @IsNotEmpty()
  code: string;

  @ApiProperty({ example: 'Credit Sales' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    example: 'SALES',
    description:
      'SALES | PURCHASE | INCOME | EXPENSE | TAX | EXTRAORDINARY | EXCHANGE_GAIN_LOSS | FIXED_ASSET | INTANGIBLE_ASSET | CURRENT_ASSET | CURRENT_LIABILITY | TAX_LIABILITY | DIVIDEND | SHARE_CAPITAL | DEPRECIATION_PROVISION | RETAINED_PROFIT | CAPITAL_RESERVE | MEDIUM_TERM_LIABILITY | LONG_TERM_LIABILITY | FOREIGN_BANK | WORK_IN_PROGRESS',
  })
  @IsString()
  @IsNotEmpty()
  accountType: string;

  @ApiProperty({ example: 'PNL', description: 'PNL | BALANCE_SHEET' })
  @IsIn(['PNL', 'BALANCE_SHEET'])
  category: 'PNL' | 'BALANCE_SHEET';

  @ApiProperty({ example: 'CREDIT', description: 'DEBIT | CREDIT' })
  @IsIn(['DEBIT', 'CREDIT'])
  normalBalance: 'DEBIT' | 'CREDIT';

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isControlAccount?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  parentAccountId?: string;
}

export class UpdateChartOfAccountDto extends PartialType(CreateChartOfAccountDto) {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
