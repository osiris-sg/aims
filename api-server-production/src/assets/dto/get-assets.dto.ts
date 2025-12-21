import { Type } from 'class-transformer';
import { IsNotEmpty, IsNumber, IsOptional, IsString, ValidateNested, IsBoolean, IsArray } from 'class-validator';

class FiltersDto {
  // Category can be a string or an array of strings
  @IsOptional()
  category?: string | string[];

  // Filter by tracking mode: true = tracked assets, false = untracked products
  @IsBoolean()
  @IsOptional()
  isTracked?: boolean;
}

export class GetAssetDto {
  @IsNumber()
  @IsNotEmpty()
  page: number;

  @IsNumber()
  @IsNotEmpty()
  limit: number;

  @IsString()
  @IsOptional()
  search?: string;

  @ValidateNested()
  @Type(() => FiltersDto)
  @IsOptional()
  filters?: FiltersDto;
}
