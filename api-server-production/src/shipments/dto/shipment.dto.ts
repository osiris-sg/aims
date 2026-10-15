import { OmitType, PartialType } from '@nestjs/swagger';
import { IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Matches, MaxLength, Min } from 'class-validator';
import { IsTradeDate } from './trade-date';

export class CreateShipmentDto {
  @IsUUID()
  contractId: string;

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

/** contractId is fixed at creation: steps and file links hang off the shipment. */
export class UpdateShipmentDto extends PartialType(OmitType(CreateShipmentDto, ['contractId'] as const)) {
  @IsOptional()
  @IsIn(['CANCELLED'], { message: 'status can only be set to CANCELLED here (use complete / reopen)' })
  status?: 'CANCELLED';
}

export class ListShipmentsQuery {
  @IsOptional() @IsUUID() contractId?: string;
  @IsOptional() @IsUUID() customerId?: string;
  @IsOptional() @IsIn(['OPEN', 'COMPLETED', 'CANCELLED']) status?: string;
  /** List tab: pending = OPEN, completed = COMPLETED + CANCELLED. */
  @IsOptional() @IsIn(['pending', 'completed']) bucket?: 'pending' | 'completed';
  /** A step code (the shipment's current step), or COMPLETED (every step done). */
  @IsOptional() @IsString() @MaxLength(100) currentStep?: string;
  @IsOptional() @IsString() q?: string;
  @IsOptional() page?: string;
  @IsOptional() pageSize?: string;
}
