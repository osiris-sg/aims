import { PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsDateString, IsIn, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { IsTradeDate } from './trade-date';
import { DEPOSIT_DUE_UNITS } from '../trade-deposit';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** One product line. `id` = an existing line (update); no id = a new line. */
export class ContractLineDto {
  @IsOptional() @IsUUID() id?: string;
  @IsOptional() @IsString() @MaxLength(100) grade?: string | null;
  @IsOptional() @IsString() @MaxLength(200) product?: string | null;
  @IsOptional() @IsString() @MaxLength(200) sizeSpec?: string | null;
  @IsOptional() @IsNumber() @Min(0) quantityMt?: number | null;
  @IsOptional() @IsNumber() @Min(0) @Max(100) tolerancePct?: number | null;
  /** USD per tonne. */
  @IsOptional() @IsNumber() supplierPremium?: number | null;
  @IsOptional() @IsNumber() clientPremium?: number | null;
  /** Price parts (USD/MT) the 請求書 / SG→JP pricing helper starts from. */
  @IsOptional() @IsNumber() qmjp?: number | null;
  @IsOptional() @IsNumber() billetPremium?: number | null;
  @IsOptional() @IsNumber() upcharge?: number | null;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string | null;
}

export class CreateContractDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(100)
  contractNo: string;

  @IsOptional() @IsString() @MaxLength(100) piNumber?: string | null;
  @IsOptional() @IsDateString() @IsTradeDate() piDate?: string | null;

  @IsUUID()
  supplierId: string;

  @IsUUID()
  customerId: string;

  @IsOptional() @IsString() @MaxLength(200) destinationPort?: string | null;
  @IsOptional() @IsString() @MaxLength(100) destinationCountry?: string | null;
  @IsOptional() @IsString() @MaxLength(20) incoterm?: string | null;
  @IsOptional() @Matches(MONTH, { message: 'shipmentMonth must be YYYY-MM' }) @IsTradeDate() shipmentMonth?: string | null;
  @IsOptional() @Matches(MONTH, { message: 'deliveryMonth must be YYYY-MM' }) @IsTradeDate() deliveryMonth?: string | null;
  @IsOptional() @IsString() @Matches(/^[A-Z]{3}$/, { message: 'currency must be a 3-letter code' }) currency?: string;

  /** B/L instructions; when omitted on create they default from the org's trade settings. */
  @IsOptional() @IsString() @MaxLength(2000) consignee?: string | null;
  @IsOptional() @IsString() @MaxLength(2000) notifyParty?: string | null;

  @IsOptional() @IsNumber() @Min(0) piAmount?: number | null;
  @IsOptional() @IsNumber() @Min(0) @Max(100) depositPercent?: number | null;
  /** When omitted on create it is piAmount × depositPercent. */
  @IsOptional() @IsNumber() @Min(0) depositAmount?: number | null;
  @IsOptional() @IsString() @MaxLength(500) depositDueNote?: string | null;
  /** Deposit due N days after the PI date (default on create: 3 business days, Vedanta's PI terms). */
  @IsOptional() @IsInt() @Min(0) @Max(365) depositDueDays?: number | null;
  @IsOptional() @IsIn(DEPOSIT_DUE_UNITS) depositDueUnit?: 'BUSINESS' | 'CALENDAR' | null;
  @IsOptional() @IsDateString() @IsTradeDate() depositPaidAt?: string | null;
  @IsOptional() @IsString() @MaxLength(5000) notes?: string | null;

  // ── Contract master (2026-10) ────────────────────────────────────────────
  @IsOptional() @IsDateString() @IsTradeDate() periodStart?: string | null;
  @IsOptional() @IsDateString() @IsTradeDate() periodEnd?: string | null;
  @IsOptional() @IsString() @MaxLength(100) grade?: string | null;
  @IsOptional() @IsString() @MaxLength(200) sizeSpec?: string | null;
  @IsOptional() @IsNumber() @Min(0) annualQtyMt?: number | null;
  @IsOptional() @IsNumber() @Min(0) @Max(100) tolerancePct?: number | null;
  @IsOptional() @IsString() @MaxLength(500) balanceTerms?: string | null;
  @IsOptional() @IsString() @MaxLength(300) qpBasis?: string | null;
  @IsOptional() @IsString() @MaxLength(300) qmjpRule?: string | null;
  /** [{ from: "YYYY-MM", to: "YYYY-MM" | null, supplierPremium, clientPremium, upcharge }] — validated in the service. */
  @IsOptional() premiumSchedule?: unknown;
  /** Fields still to be confirmed by ADH ("check"). */
  @IsOptional() @IsArray() @IsString({ each: true }) checkFields?: string[];

  /** A stored PI file (e.g. from "Fill from PI"): linked to the new contract and its PI step. */
  @IsOptional() @IsUUID() piFileId?: string;

  /** Product lines — at least one. */
  @IsArray()
  @ArrayMinSize(1, { message: 'Add at least one product line' })
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ContractLineDto)
  lines: ContractLineDto[];
}

/** `lines`, when sent, is the full list: missing ids are deleted, new rows created, others updated. */
export class UpdateContractDto extends PartialType(CreateContractDto) {
  /** Only cancelling goes through PATCH; completing uses POST :id/complete, reopening POST :id/reopen. */
  @IsOptional()
  @IsIn(['CANCELLED'], { message: 'status can only be set to CANCELLED here (use complete / reopen)' })
  status?: 'CANCELLED';
}

export class ListContractsQuery {
  @IsOptional() @IsIn(['OPEN', 'COMPLETED', 'CANCELLED']) status?: string;
  @IsOptional() @IsUUID() supplierId?: string;
  @IsOptional() @IsUUID() customerId?: string;
  @IsOptional() @IsString() q?: string;
  @IsOptional() page?: string;
  @IsOptional() pageSize?: string;
}
