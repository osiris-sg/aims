import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsEnum, IsLatitude, IsLongitude, IsObject, IsOptional, IsString, IsUUID } from 'class-validator';
import { MaintenanceReportKind } from '@prisma/client';

export class CreateMaintenanceReportDto {
  @ApiProperty({ description: 'Asset this service report is for (UUID).' })
  @IsUUID()
  assetId!: string;

  @ApiPropertyOptional({ description: 'Specific inventory unit serviced, when known.' })
  @IsOptional()
  @IsUUID()
  inventoryId?: string;

  @ApiProperty({ description: 'Free-text description of the work performed.' })
  @IsString()
  description!: string;

  @ApiPropertyOptional({
    description:
      'Per-photo angle labels, parallel to `photos` (same order/length). Guided capture sends front/back/left/right/top; free-form leaves "". Stored in serviceData.photoAngles alongside the flat photos array.',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  angles?: string[];

  @ApiPropertyOptional({ description: 'S3 keys of proof-of-service photos.' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  photos?: string[];

  @ApiPropertyOptional({ description: 'Display name of the technician (snapshot).' })
  @IsOptional()
  @IsString()
  technicianName?: string;

  @ApiPropertyOptional({
    description: 'Kind of field activity. Defaults to SERVICE if omitted.',
    enum: ['SERVICE', 'DO_START', 'DO_ACK', 'DO_INSTALL'],
  })
  @IsOptional()
  @IsEnum(MaintenanceReportKind)
  kind?: MaintenanceReportKind;

  @ApiPropertyOptional({
    description: 'Document (typically a DO) this report relates to. Set on DO_START and DO_ACK.',
  })
  @IsOptional()
  @IsUUID()
  documentId?: string;

  @ApiPropertyOptional({
    description:
      'Standalone Delivery run this report belongs to (delivery-first flow, no DO yet). Mirrors documentId.',
  })
  @IsOptional()
  @IsUUID()
  deliveryId?: string;

  @ApiPropertyOptional({ description: 'GPS latitude captured at submission.' })
  @IsOptional()
  @IsLatitude()
  latitude?: number;

  @ApiPropertyOptional({ description: 'GPS longitude captured at submission.' })
  @IsOptional()
  @IsLongitude()
  longitude?: number;

  @ApiPropertyOptional({ description: 'Reverse-geocoded human-readable location label.' })
  @IsOptional()
  @IsString()
  locationLabel?: string;

  // Structured payload for the revamped 5-page MSR form. Schemaless on the
  // backend; the field PWA owns the shape.
  @ApiPropertyOptional({ description: 'Structured form data for the 5-page service report.' })
  @IsOptional()
  @IsObject()
  serviceData?: Record<string, any>;

  // Return flow: the rider flagged this unit as damaged at collection. Recorded
  // only (no behaviour hangs off it). The free-text note rides in serviceData.returnComment.
  @ApiPropertyOptional({ description: 'Return flow: rider flagged the unit damaged at collection (recorded only).' })
  @IsOptional()
  @IsBoolean()
  damaged?: boolean;

  // Optional inline sign-off — when present, the row is created already
  // completed (no separate /sign call). Used by the revamped SERVICE flow.
  @ApiPropertyOptional({ description: 'Client signature (S3 key or base64) — finalizes the report on create.' })
  @IsOptional()
  @IsString()
  signature?: string;

  @ApiPropertyOptional({ description: 'Name of the client signer captured with the signature.' })
  @IsOptional()
  @IsString()
  signedByName?: string;

  // Step 6 of the 5-page+1 SERVICE flow. When false (default), the report is
  // auto-emailed to the customer with a PDF attachment. When true, the email
  // is skipped and the office must create an Invoice from the dashboard
  // before customer contact.
  @ApiPropertyOptional({ description: 'Whether payment is required (faulty equipment / billable work). Defaults to false.' })
  @IsOptional()
  @IsBoolean()
  paymentRequired?: boolean;
}
