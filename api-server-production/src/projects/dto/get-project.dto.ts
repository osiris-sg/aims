import { IsNotEmpty, IsNumber, IsString, IsOptional, ValidateNested, IsDateString, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';
import { ProjectStatus } from '@prisma/client';

class DateRangeDto {
  @IsDateString()
  @IsOptional()
  startDate: string | null;

  @IsDateString()
  @IsOptional()
  endDate: string | null;
}

class FiltersDto {
  // Project status (pending | ongoing | completed) — NOT InventoryStatus. The
  // previous @IsEnum(InventoryStatus) rejected every project status with a 400.
  @IsEnum(ProjectStatus)
  @IsOptional()
  status?: ProjectStatus;

  @IsString()
  @IsOptional()
  customerId?: string;

  // Date-range filters on Project.startDate / Project.endDate.
  @ValidateNested()
  @Type(() => DateRangeDto)
  @IsOptional()
  startDate?: DateRangeDto;

  @ValidateNested()
  @Type(() => DateRangeDto)
  @IsOptional()
  endDate?: DateRangeDto;
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
