import { IsNotEmpty, IsNumber, IsString, IsOptional, ValidateNested, IsDateString } from 'class-validator';
import { Type } from 'class-transformer';

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

  @IsString()
  @IsOptional()
  status: string;

  @IsString()
  @IsOptional()
  category: string;
}

export class GetInventoryDto {
  @IsString()
  @IsNotEmpty()
  organizationId: string;

  @IsNumber()
  @IsNotEmpty()
  page: number;

  @IsNumber()
  @IsNotEmpty()
  limit: number;

  @IsString()
  @IsOptional()
  search: string;

  @ValidateNested()
  @Type(() => FiltersDto)
  @IsOptional()
  filters: FiltersDto;
}
