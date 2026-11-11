import { IsArray, IsOptional, IsString, IsNotEmpty, ArrayNotEmpty, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

// Email a report PDF (guru 2026-11-11: "add the email function at the bottom
// of Print / Export, take that code from the sales documents"). The portal
// renders the PDF (jsPDF) and posts it base64 — reports are not documents, so
// there is no server-side render to fetch.
export class SendReportEmailDto {
  @ApiProperty({ type: [String] }) @IsArray() @ArrayNotEmpty() @IsString({ each: true }) to: string[];
  @ApiProperty({ type: [String], required: false }) @IsOptional() @IsArray() @IsString({ each: true }) cc?: string[];
  @ApiProperty({ type: [String], required: false }) @IsOptional() @IsArray() @IsString({ each: true }) bcc?: string[];
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(300) subject: string;
  @ApiProperty() @IsString() @IsNotEmpty() message: string;
  @ApiProperty({ description: 'Attachment file name, e.g. statement-of-accounts-2026-11-11.pdf' }) @IsString() @IsNotEmpty() @MaxLength(200) filename: string;
  @ApiProperty({ description: 'The PDF, base64 (no data: prefix)' }) @IsString() @IsNotEmpty() pdfBase64: string;
  @ApiProperty({ required: false, description: 'Report title for the Activity Log / mail header' }) @IsOptional() @IsString() reportTitle?: string;
}
