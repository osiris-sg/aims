import { PartialType } from '@nestjs/swagger';
import { CreateSupplierDto } from './create-supplier.dto';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
export class UpdateSupplierDto extends PartialType(CreateSupplierDto) {
  @IsString()
  @IsNotEmpty()
  id: string;

  @IsString()
  @IsOptional()
  name: string;

  @IsString()
  @IsOptional()
  email: string;

  @IsString()
  @IsOptional()
  phone: string;

  @IsString()
  @IsOptional()
  address: string;

  @IsString()
  @IsOptional()
  gstRegNo?: string | null;

  @IsString()
  @IsOptional()
  currency?: string;
}
