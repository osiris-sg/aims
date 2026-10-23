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

  // Created-on date range { startDate, endDate }. Applied server-side so the
  // filter spans all pages (not just the current one).
  @IsOptional()
  createdOn?: { startDate?: string | Date | null; endDate?: string | Date | null };

  // Exact ids — the document editor loads the products its lines reference
  // without paging the whole catalogue (87k items for Chong Aik took 35s and
  // still stopped at the 100-page cap — guru 2026-10-23).
  @IsArray()
  @IsOptional()
  ids?: string[];
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
