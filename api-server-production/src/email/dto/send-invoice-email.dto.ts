import { IsArray, IsEmail, IsOptional, IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SendInvoiceEmailDto {
  @ApiProperty({
    description: 'Recipient email addresses',
    example: ['customer@example.com'],
    type: [String],
  })
  @IsArray()
  @IsEmail({}, { each: true })
  to: string[];

  @ApiProperty({
    description: 'CC email addresses',
    example: ['manager@example.com'],
    type: [String],
    required: false,
  })
  @IsOptional()
  @IsArray()
  @IsEmail({}, { each: true })
  cc?: string[];

  @ApiProperty({
    description: 'BCC email addresses',
    example: ['admin@example.com'],
    type: [String],
    required: false,
  })
  @IsOptional()
  @IsArray()
  @IsEmail({}, { each: true })
  bcc?: string[];

  @ApiProperty({
    description: 'Email subject line',
    example: 'Invoice #INV-032 from OSIRIS TECHNOLOGY PTE. LTD.',
  })
  @IsString()
  @MinLength(1)
  subject: string;

  @ApiProperty({
    description: 'Email message body',
    example: 'Hi Biofuel Industries Pte. Ltd.,\n\nPlease find attached the invoice #INV-032 amounting to SGD 10.00 due on 27 Nov 2025.\n\nYou can also use the link below to see your invoice and its payment details.',
  })
  @IsString()
  @MinLength(1)
  message: string;
}
