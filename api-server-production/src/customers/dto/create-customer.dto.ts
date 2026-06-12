import { IsArray, IsBoolean, IsNotEmpty, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class CustomerContactDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsNotEmpty()
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  phone?: string | null;

  @IsOptional()
  @IsString()
  email?: string | null;

  @IsOptional()
  @IsString()
  designation?: string | null;

  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}

export class CreateCustomerDto {
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

  @IsOptional()
  @IsString()
  salesmanId?: string | null;

  @IsString()
  @IsOptional()
  createdAt?: Date | null;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CustomerContactDto)
  contacts?: CustomerContactDto[];
}
