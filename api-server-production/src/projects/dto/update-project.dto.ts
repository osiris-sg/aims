import { IsString, IsArray, IsOptional, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ProjectStatus } from '@prisma/client';

class UpdateAssignmentDto {
  @IsString()
  @IsOptional()
  skuKey?: string;

  @IsString()
  @IsOptional()
  inventoryId?: string;

  @IsString()
  @IsOptional()
  startDate?: string;

  @IsString()
  @IsOptional()
  endDate?: string;

  @IsString()
  @IsOptional()
  status?: string;
}

export class UpdateProjectDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  siteOfficeId?: string;

  @IsString()
  @IsOptional()
  startDate?: string;

  @IsString()
  @IsOptional()
  endDate?: string;

  @IsOptional()
  status?: ProjectStatus;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateAssignmentDto)
  @IsOptional()
  assignments?: UpdateAssignmentDto[];
}
