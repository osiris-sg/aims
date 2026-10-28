import { OmitType, PartialType } from '@nestjs/swagger';
import { IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';
import { IsTradeDate } from './trade-date';

export class CreateShipmentDto {
  /** The order this B/L ships ("#19-1"). Required for new shipments; contractId alone is the pre-orders path. */
  @IsOptional() @IsUUID() orderId?: string;

  /** Legacy (before orders): a contract without an order. Taken from the order otherwise. */
  @IsOptional() @IsUUID() contractId?: string;

  /** The contract product line this B/L ships. Defaults to the only line; required when the contract has several. */
  @IsOptional() @IsUUID() contractLineId?: string | null;

  /** A stored B/L draft file (e.g. from "Fill from B/L draft"): linked to the new shipment and its B/L draft step. */
  @IsOptional() @IsUUID() blDraftFileId?: string;

  /** Defaults to the contract's customer. */
  @IsOptional() @IsUUID() customerId?: string | null;

  @IsOptional() @IsString() @MaxLength(100) blNumber?: string | null;
  @IsOptional() @IsString() @MaxLength(200) vessel?: string | null;
  @IsOptional() @IsString() @MaxLength(100) voyageNo?: string | null;
  @IsOptional() @IsDateString() @IsTradeDate() etd?: string | null;
  /** "Latest ETA". */
  @IsOptional() @IsDateString() @IsTradeDate() eta?: string | null;
  @IsOptional() @IsDateString() @IsTradeDate() actualArrivalDate?: string | null;
  @IsOptional() @IsString() @MaxLength(200) shippingLine?: string | null;
  /** YYYY-MM; defaults from the contract. */
  @IsOptional() @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'deliveryMonth must be YYYY-MM' }) @IsTradeDate() deliveryMonth?: string | null;
  @IsOptional() @IsInt() @Min(0) containerCount?: number | null;
  @IsOptional() @IsString() @MaxLength(100) telexReleaseCode?: string | null;
  @IsOptional() @IsString() @MaxLength(200) portOfLoading?: string | null;
  @IsOptional() @IsString() @MaxLength(200) portOfDischarge?: string | null;
  @IsOptional() @IsNumber() @Min(0) netWeightMt?: number | null;
  @IsOptional() @IsNumber() @Min(0) grossWeightMt?: number | null;
  @IsOptional() @IsInt() @Min(0) totalBundles?: number | null;
  @IsOptional() @IsInt() @Min(0) totalPieces?: number | null;
  @IsOptional() @IsString() @MaxLength(50) hsCode?: string | null;
  @IsOptional() @IsString() @MaxLength(100) countryOfOrigin?: string | null;
  @IsOptional() @IsString() @MaxLength(200) commodity?: string | null;
  @IsOptional() @IsString() @MaxLength(200) sizeSpec?: string | null;
  @IsOptional() @IsString() @MaxLength(100) ciNumber?: string | null;
  @IsOptional() @IsNumber() @Min(0) ciAmount?: number | null;
  @IsOptional() @IsString() @Matches(/^[A-Z]{3}$/, { message: 'currency must be a 3-letter code' }) currency?: string;
  @IsOptional() @IsString() @MaxLength(5000) notes?: string | null;
}

/** "Add shipment" on an order (POST /orders/:id/shipments): the order comes from the URL. */
export class AddShipmentDto extends OmitType(CreateShipmentDto, ['orderId', 'contractId'] as const) {}

/** orderId / contractId are fixed at creation: steps and file links hang off the shipment. */
export class UpdateShipmentDto extends PartialType(OmitType(CreateShipmentDto, ['contractId', 'orderId'] as const)) {
  /** Estimator inputs and step 12 actuals (validated in the service). */
  @IsOptional() costs?: unknown;

  /** Free time at the port (alerts warn 1 day before it ends): discharge date + DET / DEM days. */
  @IsOptional() @IsDateString() @IsTradeDate() dischargeDate?: string | null;
  @IsOptional() @IsInt() @Min(0) @Max(90) detFreeDays?: number | null;
  @IsOptional() @IsInt() @Min(0) @Max(90) demFreeDays?: number | null;
  /** Warehouse stock: where it is stored and since when (storage periods). */
  @IsOptional() @IsString() @MaxLength(200) warehouse?: string | null;
  @IsOptional() @IsDateString() @IsTradeDate() storageStartDate?: string | null;
  /** A different supplier order than its order's (a split that differs). */
  @IsOptional() @IsUUID() supplierOrderId?: string | null;
  /** Round AL — carrier tracking: the vessel arriving after transhipment (本船), the T/S port and dates, B/L release. */
  @IsOptional() @IsString() @MaxLength(100) arrivingVessel?: string | null;
  @IsOptional() @IsString() @MaxLength(50) arrivingVoyageNo?: string | null;
  @IsOptional() @IsString() @MaxLength(100) tsPort?: string | null;
  @IsOptional() @IsDateString() @IsTradeDate() tsEta?: string | null;
  @IsOptional() @IsDateString() @IsTradeDate() tsEtd?: string | null;
  @IsOptional() @IsString() @MaxLength(60) blReleaseType?: string | null;
  /** Where an ETA change came from (MANUAL, AN, BL …) — kept in the ETA history. */
  @IsOptional() @IsString() @MaxLength(40) etaSource?: string;

  @IsOptional()
  @IsIn(['CANCELLED'], { message: 'status can only be set to CANCELLED here (use complete / reopen)' })
  status?: 'CANCELLED';
}

export class ListShipmentsQuery {
  /** "true" = include test orders' shipments (round N). */
  @IsOptional() @IsIn(['true', 'false']) includeTest?: string;
  @IsOptional() @IsUUID() contractId?: string;
  @IsOptional() @IsUUID() orderId?: string;
  /** Invoice #2 shipment picker: shipments not yet covered by a FINAL Invoice #2 / single invoice. */
  @IsOptional() @IsIn(['true', 'false']) uninvoiced?: string;
  @IsOptional() @IsUUID() customerId?: string;
  @IsOptional() @IsIn(['OPEN', 'COMPLETED', 'CANCELLED']) status?: string;
  /** List tab: pending = OPEN, completed = COMPLETED + CANCELLED. */
  // Round AT: "all" = no status filter (the All tab, round AN) — the portal sends it.
  @IsOptional() @IsIn(['pending', 'completed', 'all']) bucket?: 'pending' | 'completed' | 'all';
  /** Shipments list (round H): in_transit | arrived | delivered | completed. */
  @IsOptional() @IsIn(['in_transit', 'arrived', 'delivered', 'completed']) tab?: 'in_transit' | 'arrived' | 'delivered' | 'completed';
  /** A step code (the shipment's current step), or COMPLETED (every step done). */
  @IsOptional() @IsString() @MaxLength(100) currentStep?: string;
  @IsOptional() @IsString() q?: string;
  @IsOptional() page?: string;
  @IsOptional() pageSize?: string;
}
