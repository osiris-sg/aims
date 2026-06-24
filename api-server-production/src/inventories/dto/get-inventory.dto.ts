import { IsNotEmpty, IsNumber, IsString, IsOptional, ValidateNested, IsDateString, IsEnum, IsArray, ValidateIf } from 'class-validator';
import { Type } from 'class-transformer';
import { InventoryStatus } from '@prisma/client';

class DateRangeDto {
  @IsDateString()
  @IsOptional()
  startDate: string | null;

  @IsDateString()
  @IsOptional()
  endDate: string | null;
}

class FiltersDto {
  @ValidateNested()
  @Type(() => DateRangeDto)
  @IsOptional()
  createdOn: DateRangeDto;

  @IsArray()
  @IsOptional()
  status?: string[];

  @IsArray()
  @IsOptional()
  category?: string[];

  @IsString()
  @IsOptional()
  assetId?: string;

  @IsString()
  @IsOptional()
  tagStatus?: string;
}

export class GetInventoryDto {
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
