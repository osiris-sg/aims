import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateSupplierDto {
  @IsNotEmpty()
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  email: string | null;

  @IsOptional()
  @IsString()
  phone: string | null;

  @IsOptional()
  @IsString()
  address: string | null;

  @IsOptional()
  @IsString()
  gstRegNo?: string | null;

  // Trading currency — one per supplier code; bills inherit it, GL converts at
  // the standing rate.
  @IsOptional()
  @IsString()
  currency?: string;

  @IsString()
  @IsOptional()
  createdAt?: Date | null;
}
