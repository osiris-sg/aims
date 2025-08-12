import { IsNotEmpty, IsNumber, IsString, IsOptional, ValidateNested, IsDateString, IsEnum, ValidateIf } from 'class-validator';
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

  @ValidateIf((o) => o.status !== '' && o.status !== undefined && o.status !== null)
  @IsEnum(InventoryStatus, { message: 'status must be one of the following values: instock, rental, reserved, maintenance, sold' })
  @IsOptional()
  status?: InventoryStatus | string;

  @IsString()
  @IsOptional()
  category: string;

  @IsString()
  @IsOptional()
  assetId: string; // Add assetId filter support
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
