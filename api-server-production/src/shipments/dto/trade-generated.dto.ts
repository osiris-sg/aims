import { IsBoolean, IsIn, IsOptional, IsString, IsUUID } from 'class-validator';

const ALL = ['CUSTOMER_PL', 'CUSTOMER_COA', 'INVOICE_1', 'INVOICE_2', 'SGJP_IV_PL', 'SHIPPING_INSTRUCTIONS'];

export class CreateGeneratedDocDto {
  @IsUUID() shipmentId: string;
  @IsIn(['CUSTOMER_PL', 'CUSTOMER_COA']) docType: string;
  /** The supplier PL / COA spreadsheet (TradeFile on the same shipment) to prefill from. */
  @IsUUID() sourceFileId: string;
}

/** Draft edits: any of header / columns / rows (validated as JSON shapes in the service). */
export class UpdateGeneratedDocDto {
  @IsOptional() header?: unknown;
  @IsOptional() columns?: unknown;
  @IsOptional() rows?: unknown;
}

/** A new blank document of any template, on its record (shipment, or contract for Invoice #1). */
export class CreateBlankGeneratedDocDto {
  @IsIn(ALL) docType: string;
  @IsOptional() @IsUUID() shipmentId?: string;
  @IsOptional() @IsUUID() contractId?: string;
}

export class PreviewGeneratedDocDto {
  @IsIn(ALL) docType: string;
  header: any;
  columns: any;
  rows: any;
  /** DRAFT watermark (default on). */
  @IsOptional() @IsBoolean() draft?: boolean;
}

export class GeneratedSourcesQuery {
  @IsUUID() shipmentId: string;
  @IsIn(['CUSTOMER_PL', 'CUSTOMER_COA']) docType: string;
}

export class ListGeneratedQuery {
  @IsOptional() @IsUUID() shipmentId?: string;
  @IsOptional() @IsUUID() contractId?: string;
}

export class HubQueryDto {
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsString() docType?: string;
  @IsOptional() @IsUUID() contractId?: string;
  @IsOptional() @IsUUID() shipmentId?: string;
  @IsOptional() @IsUUID() customerId?: string;
  @IsOptional() @IsIn(['UPLOADED', 'IN_APP']) source?: string;
  @IsOptional() @IsString() from?: string;
  @IsOptional() @IsString() to?: string;
  @IsOptional() @IsString() q?: string;
  @IsOptional() page?: string;
  @IsOptional() pageSize?: string;
}
