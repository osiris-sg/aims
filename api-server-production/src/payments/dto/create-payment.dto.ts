import { IsString, IsNumber, IsDateString, IsOptional, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreatePaymentDto {
  @ApiProperty({ description: 'Customer ID' })
  @IsString()
  @IsNotEmpty()
  customerId: string;

  @ApiProperty({ description: 'Document ID (invoice)' })
  @IsString()
  @IsNotEmpty()
  documentId: string;

  @ApiProperty({ description: 'Payment amount' })
  @IsNumber()
  @IsNotEmpty()
  amount: number;

  @ApiProperty({ description: 'Payment date' })
  @IsDateString()
  @IsNotEmpty()
  paymentDate: string;

  @ApiProperty({ description: 'Payment method (cash, check, transfer, etc)', example: 'cash' })
  @IsString()
  @IsNotEmpty()
  paymentMethod: string;

  @ApiProperty({ description: 'Reference number (check number, transfer reference)', required: false })
  @IsString()
  @IsOptional()
  reference?: string;

  @ApiProperty({ description: 'Payment notes', required: false })
  @IsString()
  @IsOptional()
  notes?: string;
}
