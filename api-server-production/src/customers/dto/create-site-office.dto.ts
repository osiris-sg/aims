import { IsNotEmpty, IsOptional, IsString, ValidateNested, IsArray } from 'class-validator';
import { Type } from 'class-transformer';

class ContactDetailDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsNotEmpty()
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
  @IsNotEmpty()
  customerId: string;

  @ValidateNested({ each: true })
  @Type(() => ContactDetailDto)
  @IsArray()
  contactDetails: ContactDetailDto[];
}
