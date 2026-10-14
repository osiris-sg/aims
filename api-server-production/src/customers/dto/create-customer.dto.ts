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

  // Japanese legal name / address / contact — only orgs whose per-org schema
  // has these columns (Shipments / ADH Japan) show and send them.
  @IsOptional()
  @IsString()
  jpName?: string | null;

  @IsOptional()
  @IsString()
  jpAddress?: string | null;

  @IsOptional()
  @IsString()
  jpContact?: string | null;

  // Trading currency — one per customer code; docs inherit it, GL converts at
  // the standing rate.
  @IsOptional()
  @IsString()
  currency?: string;

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
