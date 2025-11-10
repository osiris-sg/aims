import { IsString, IsDateString, IsOptional, IsNotEmpty, IsBoolean } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class GenerateSOADto {
  @ApiProperty({ description: 'Customer ID' })
  @IsString()
  @IsNotEmpty()
  customerId: string;

  @ApiProperty({ description: 'Start date for the statement', required: false })
  @IsDateString()
  @IsOptional()
  startDate?: string;

  @ApiProperty({ description: 'End date for the statement', required: false })
  @IsDateString()
  @IsOptional()
  endDate?: string;

  @ApiProperty({ description: 'Include aging analysis', default: true })
  @IsBoolean()
  @IsOptional()
  includeAging?: boolean;

  @ApiProperty({ description: 'Format: pdf, csv, json', default: 'json' })
  @IsString()
  @IsOptional()
  format?: string;
}
