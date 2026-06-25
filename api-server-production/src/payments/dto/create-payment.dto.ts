import { IsString, IsNumber, IsDateString, IsOptional, IsNotEmpty, IsArray } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class PaymentAttachmentDto {
  @ApiProperty()
  @IsString()
  fileKey: string;

  @ApiProperty()
  @IsString()
  fileName: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  mimeType?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  label?: string;
}

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

  @ApiProperty({ description: 'Payment proof attachments (already uploaded via /uploads/image)', required: false, type: [PaymentAttachmentDto] })
  @IsArray()
  @IsOptional()
  attachments?: PaymentAttachmentDto[];
}
