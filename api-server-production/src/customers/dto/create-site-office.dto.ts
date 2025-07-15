import { IsNotEmpty, IsOptional, IsString, ValidateNested, IsArray } from 'class-validator';
import { Type } from 'class-transformer';

class ContactDetailDto {
  @IsString()
  @IsOptional()
  name: string;

  @IsString()
  @IsOptional()
  email: string;

  @IsString()
  @IsOptional()
  phone: string;
}

export class CreateSiteOfficeDto {
  @IsString()
  @IsNotEmpty()
  name: string;
  @IsString()
  @IsOptional()
  address?: string;

  @IsString()
  @IsOptional()
  customerId: string;

  @ValidateNested({ each: true })
  @Type(() => ContactDetailDto)
  @IsArray()
  contactDetails: ContactDetailDto[];
}
