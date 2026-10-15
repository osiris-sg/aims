import { IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

/** contractIds / shipmentIds accept a JSON array, repeated fields or a comma list (parsed in the service). */
export class LinkTradeDocumentDto {
  @IsUUID()
  documentId: string;

  @IsNotEmpty()
  @IsString()
  docType: string;

  @IsOptional() contractIds?: unknown;
  @IsOptional() shipmentIds?: unknown;
  @IsOptional() orderIds?: unknown;

  /** Step the document was created for; its contract/shipment is linked automatically. */
  @IsOptional() @IsUUID() stepId?: string;
}

export class SearchInvoicesQuery {
  @IsOptional() @IsString() @MaxLength(100) q?: string;
}
