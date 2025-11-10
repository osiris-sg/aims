import { IsString, IsNumber, IsDateString, IsOptional, IsNotEmpty, IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { TransactionType } from '@prisma/client';

export class CreateTransactionDto {
  @ApiProperty({ description: 'Customer ID' })
  @IsString()
  @IsNotEmpty()
  customerId: string;

  @ApiProperty({ description: 'Transaction type', enum: TransactionType })
  @IsEnum(TransactionType)
  @IsNotEmpty()
  transactionType: TransactionType;

  @ApiProperty({ description: 'Document ID (optional for adjustments/opening balance)', required: false })
  @IsString()
  @IsOptional()
  documentId?: string;

  @ApiProperty({ description: 'Transaction date' })
  @IsDateString()
  @IsNotEmpty()
  transactionDate: string;

  @ApiProperty({ description: 'Reference number or description' })
  @IsString()
  @IsNotEmpty()
  reference: string;

  @ApiProperty({ description: 'Transaction description' })
  @IsString()
  @IsNotEmpty()
  description: string;

  @ApiProperty({ description: 'Debit amount (increases balance)', default: 0 })
  @IsNumber()
  @IsOptional()
  debit?: number;

  @ApiProperty({ description: 'Credit amount (decreases balance)', default: 0 })
  @IsNumber()
  @IsOptional()
  credit?: number;
}
