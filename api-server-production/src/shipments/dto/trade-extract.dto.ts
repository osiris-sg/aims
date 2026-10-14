import { IsOptional, IsUUID } from 'class-validator';

/** Multipart `file` OR an already-uploaded `fileId`. */
export class ExtractPiDto {
  @IsOptional() @IsUUID() fileId?: string;
}

export class ExtractBlDraftDto {
  @IsOptional() @IsUUID() fileId?: string;
  /** Run the checks against this shipment (and link a new upload to it + its B/L draft step). */
  @IsOptional() @IsUUID() shipmentId?: string;
  /** Match lines against this contract when there is no shipment yet. */
  @IsOptional() @IsUUID() contractId?: string;
}
