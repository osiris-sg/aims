import { PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { IsTradeDate } from './trade-date';
import { DEPOSIT_DUE_UNITS } from '../trade-deposit';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * New order ("#19"): one customer, ship month → delivery month, one product
 * and quantity. The contract is optional; premiums default from its line (same
 * grade) and stay editable.
 */
export class CreateOrderDto {
  /** Defaults to the ship month's year (else this year in Tokyo). */
  @IsOptional() @IsInt() @Min(2000) @Max(2100) year?: number;
  /** Defaults to the next free number for the year. */
  @IsOptional() @IsInt() @Min(1) @Max(99999) orderNo?: number;

  @IsOptional() @IsUUID() contractId?: string | null;
  /** Default: the contract's customer / supplier. */
  @IsOptional() @IsUUID() customerId?: string;
  @IsOptional() @IsUUID() supplierId?: string;

  @IsOptional() @Matches(MONTH, { message: 'shipMonth must be YYYY-MM' }) @IsTradeDate() shipMonth?: string | null;
  @IsOptional() @Matches(MONTH, { message: 'deliveryMonth must be YYYY-MM' }) @IsTradeDate() deliveryMonth?: string | null;
  @IsOptional() @IsString() @MaxLength(200) product?: string | null;
  @IsOptional() @IsString() @MaxLength(100) grade?: string | null;
  @IsOptional() @IsString() @MaxLength(200) size?: string | null;
  @IsOptional() @IsNumber() @Min(0) qtyMt?: number | null;
  @IsOptional() @IsNumber() @Min(0) @Max(100) tolPct?: number | null;
  /** USD/MT. */
  @IsOptional() @IsNumber() supplierPremium?: number | null;
  @IsOptional() @IsNumber() clientPremium?: number | null;
  @IsOptional() @IsNumber() upcharge?: number | null;

  @IsOptional() @IsString() @MaxLength(100) piNo?: string | null;
  @IsOptional() @IsDateString() @IsTradeDate() piDate?: string | null;
  @IsOptional() @IsNumber() @Min(0) piAmount?: number | null;
  @IsOptional() @IsNumber() @Min(0) @Max(100) depositPct?: number | null;
  @IsOptional() @IsNumber() @Min(0) depositAmount?: number | null;
  @IsOptional() @IsInt() @Min(0) @Max(365) depositDueDays?: number | null;
  @IsOptional() @IsIn(DEPOSIT_DUE_UNITS) depositDueUnit?: 'BUSINESS' | 'CALENDAR' | null;
  @IsOptional() @IsDateString() @IsTradeDate() depositPaidAt?: string | null;
  @IsOptional() @IsString() @Matches(/^[A-Z]{3}$/, { message: 'currency must be a 3-letter code' }) currency?: string;
  @IsOptional() @IsString() @MaxLength(20) incoterm?: string | null;
  @IsOptional() @IsString() @MaxLength(200) destinationPort?: string | null;
  @IsOptional() @IsString() @MaxLength(2000) consignee?: string | null;
  @IsOptional() @IsString() @MaxLength(2000) notifyParty?: string | null;
  @IsOptional() @IsString() @MaxLength(5000) notes?: string | null;

  /** The customer's own purchase order (Kato's 発注書). */
  @IsOptional() @IsString() @MaxLength(100) customerPoNo?: string | null;
  @IsOptional() @IsDateString() @IsTradeDate() customerPoDate?: string | null;

  /** A stored PI file ("Fill from PI"): linked to the order's step 1. */
  @IsOptional() @IsUUID() piFileId?: string;
  /** A stored contract file: linked to the order's step 0. */
  @IsOptional() @IsUUID() contractFileId?: string;

  /** Fields flagged "check" for ADH ([] = all confirmed). */
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(40, { each: true }) checkFields?: string[];
}

export class UpdateOrderDto extends PartialType(CreateOrderDto) {
  /** Only cancelling goes through PATCH; completing uses POST :id/complete, reopening POST :id/reopen. */
  @IsOptional()
  @IsIn(['CANCELLED'], { message: 'status can only be set to CANCELLED here (use complete / reopen)' })
  status?: 'CANCELLED';
}

export class ListOrdersQuery {
  /** pending = OPEN, completed = COMPLETED + CANCELLED. */
  @IsOptional() @IsIn(['pending', 'completed']) bucket?: 'pending' | 'completed';
  @IsOptional() @IsUUID() customerId?: string;
  @IsOptional() @IsUUID() contractId?: string;
  /** "2026-10", or "none" = orders without a ship month. */
  @IsOptional() @Matches(/^(\d{4}-\d{2}|none)$/) shipMonth?: string;
  @IsOptional() @IsString() q?: string;
  /** "true" = include test orders (round N). */
  @IsOptional() @IsIn(['true', 'false']) includeTest?: string;
  @IsOptional() page?: string;
  @IsOptional() pageSize?: string;
}

/** One row of "+ New monthly order": customer × grade × size × qty × contract. */
export class MonthlyOrderRowDto {
  @IsUUID() customerId!: string;
  @IsUUID() contractId!: string;
  @IsOptional() @IsString() @MaxLength(100) grade?: string | null;
  @IsOptional() @IsString() @MaxLength(200) size?: string | null;
  @IsNumber() @Min(0.001) qtyMt!: number;
  /** Default: the contract's schedule / line for the month. */
  @IsOptional() @IsNumber() clientPremium?: number | null;
  /** Default: ship month + 2 (Jul → Sep). */
  @IsOptional() @Matches(MONTH, { message: 'deliveryMonth must be YYYY-MM' }) deliveryMonth?: string | null;
}

/** "+ New monthly order" (Orders): one order per row, all shipping in `month`. */
export class MonthlyOrdersDto {
  @Matches(MONTH, { message: 'month must be YYYY-MM' }) @IsTradeDate() month!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => MonthlyOrderRowDto) rows!: MonthlyOrderRowDto[];
}
