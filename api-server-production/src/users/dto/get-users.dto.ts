import { Type, Transform } from 'class-transformer';
import { IsNotEmpty, IsNumber, IsOptional, IsString, ValidateNested, Min } from 'class-validator';

class FiltersDto {
  @IsString()
  @IsOptional()
  status: string;

  @IsString()
  @IsOptional()
  category: string;
}

export class GetUsersDto {
  @IsNumber()
  @IsOptional()
  @Min(1)
  @Transform(({ value }) => parseInt(value))
  page?: number = 1;

  @IsNumber()
  @IsOptional()
  @Min(1)
  @Transform(({ value }) => parseInt(value))
  limit?: number = 10;

  @IsString()
  @IsOptional()
  search?: string;

  @ValidateNested()
  @Type(() => FiltersDto)
  @IsOptional()
  filters?: FiltersDto;
}
