import { IsString, IsNotEmpty, IsOptional, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateContactDetailDto {
  @IsString()
  @IsNotEmpty()
  id: string;

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

export class UpdateSiteOfficeDto {
  @IsString()
  @IsNotEmpty()
  id: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsOptional()
  address?: string;

  @ValidateNested({ each: true })
  @Type(() => UpdateContactDetailDto)
  @IsOptional()
  contactDetails?: UpdateContactDetailDto[];
}
