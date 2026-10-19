import { PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { IsTradeDate } from './trade-date';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * Supplier order (Vedanta's PI): what ADH buys for one declaration month,
 * contract and grade. Customer orders are bought under it (usually 1:1).
 */
export class CreateSupplierOrderDto {
  @IsOptional() @IsInt() @Min(2000) @Max(2100) year?: number;
  @IsOptional() @IsUUID() contractId?: string | null;
  /** Default: the contract's supplier. */
  @IsOptional() @IsUUID() supplierId?: string;
  @IsOptional() @Matches(MONTH, { message: 'declarationMonth must be YYYY-MM' }) @IsTradeDate() declarationMonth?: string | null;
  @IsOptional() @IsString() @MaxLength(200) product?: string | null;
  @IsOptional() @IsString() @MaxLength(100) grade?: string | null;
  @IsOptional() @IsString() @MaxLength(200) size?: string | null;
  @IsOptional() @IsNumber() @Min(0) qtyMt?: number | null;
  @IsOptional() @IsString() @MaxLength(300) qpBasis?: string | null;
  @IsOptional() @IsNumber() @Min(0) provisionalPricePerMt?: number | null;
  @IsOptional() @IsNumber() supplierPremium?: number | null;
  @IsOptional() @IsString() @Matches(/^[A-Z]{3}$/, { message: 'currency must be a 3-letter code' }) currency?: string;
  @IsOptional() @IsString() @MaxLength(100) piNo?: string | null;
  @IsOptional() @IsDateString() @IsTradeDate() piDate?: string | null;
  @IsOptional() @IsNumber() @Min(0) piAmount?: number | null;
  @IsOptional() @IsNumber() @Min(0) @Max(100) depositPct?: number | null;
  @IsOptional() @IsNumber() @Min(0) depositAmount?: number | null;
  @IsOptional() @IsDateString() @IsTradeDate() depositPaidAt?: string | null;
  @IsOptional() @IsString() @MaxLength(5000) notes?: string | null;
  /** Customer orders bought under it. */
  @IsOptional() @IsArray() @IsUUID('all', { each: true }) customerOrderIds?: string[];
  /** A stored PI file: linked to step 1. */
  @IsOptional() @IsUUID() piFileId?: string;
}

export class UpdateSupplierOrderDto extends PartialType(CreateSupplierOrderDto) {
  @IsOptional()
  @IsIn(['CANCELLED'], { message: 'status can only be set to CANCELLED here (use complete / reopen)' })
  status?: 'CANCELLED';
}

export class ListSupplierOrdersQuery {
  @IsOptional() @IsIn(['pending', 'completed']) bucket?: 'pending' | 'completed';
  @IsOptional() @IsUUID() supplierId?: string;
  @IsOptional() @IsUUID() contractId?: string;
  @IsOptional() @Matches(MONTH) declarationMonth?: string;
  @IsOptional() @IsString() q?: string;
  @IsOptional() page?: string;
  @IsOptional() pageSize?: string;
}

export class LinkOrdersDto {
  @IsArray() @ArrayMinSize(1) @IsUUID('all', { each: true }) orderIds!: string[];
}

/** One row of the monthly declaration: customer × grade × qty × contract. */
export class DeclarationRowDto {
  @IsUUID() customerId!: string;
  @IsUUID() contractId!: string;
  @IsOptional() @IsString() @MaxLength(100) grade?: string | null;
  @IsOptional() @IsString() @MaxLength(200) size?: string | null;
  @IsNumber() @Min(0.001) qtyMt!: number;
  /** Default: the contract's premium schedule / line. */
  @IsOptional() @IsNumber() clientPremium?: number | null;
  @IsOptional() @IsNumber() supplierPremium?: number | null;
  /** Default: the next free number. */
  @IsOptional() @IsInt() @Min(1) @Max(99999) orderNo?: number;
  /** Default: declaration month + 2 (Jul → Sep). */
  @IsOptional() @Matches(MONTH) deliveryMonth?: string | null;
  @IsOptional() @IsString() @MaxLength(100) piNo?: string | null;
}

/** "Create orders" on the Declaration page: one supplier order + one customer order per row. */
export class DeclarationDto {
  @Matches(MONTH, { message: 'month must be YYYY-MM' }) month!: string;
  @IsOptional() @IsString() @MaxLength(300) qpBasis?: string | null;
  /** Order / supplier-order year. Default: the declaration month's year. */
  @IsOptional() @IsInt() @Min(2000) @Max(2100) year?: number;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => DeclarationRowDto) rows!: DeclarationRowDto[];
}
