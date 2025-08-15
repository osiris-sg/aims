import { IsNotEmpty, IsNumber, IsString, IsOptional, ValidateNested, IsDateString, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';
import { InventoryStatus } from '@prisma/client';
// left off
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

  @IsEnum(InventoryStatus)
  @IsOptional()
  status: InventoryStatus;

  @IsString()
  @IsOptional()
  category: string;

  @IsString()
  @IsOptional()
  customerId: string;
}

export class GetProjectDto {
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
