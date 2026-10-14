import { IsDateString, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

/**
 * Multipart body of POST /trade-files. contractIds / shipmentIds may arrive as
 * repeated `contractIds[]` fields, a JSON array or a comma list, so they are
 * parsed (and UUID-checked) in the service rather than typed here.
 */
export class UploadTradeFileDto {
  @IsNotEmpty()
  @IsString()
  docType: string;

  @IsOptional() contractIds?: unknown;
  @IsOptional() shipmentIds?: unknown;

  /** Optional step the file was uploaded for; its contract/shipment is linked automatically. */
  @IsOptional() @IsUUID() stepId?: string;

  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}

export class AddTradeFileLinksDto {
  @IsOptional() contractIds?: unknown;
  @IsOptional() shipmentIds?: unknown;
  @IsOptional() @IsUUID() stepId?: string;
}

export class ListTradeFilesQuery {
  @IsOptional() @IsString() docType?: string;
  @IsOptional() @IsUUID() contractId?: string;
  @IsOptional() @IsUUID() shipmentId?: string;
  @IsOptional() @IsUUID() customerId?: string;
  @IsOptional() @IsString() q?: string;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional() page?: string;
  @IsOptional() pageSize?: string;
}
