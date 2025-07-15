import { IsString, IsArray, IsNotEmpty, ValidateNested, isString, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';
import { ProjectStatus } from '@prisma/client';

class AssignmentDto {
  @IsString()
  @IsNotEmpty()
  skuKey: string;

  @IsString()
  @IsNotEmpty()
  inventoryId: string;

  @IsString()
  @IsNotEmpty()
  startDate: string;

  @IsString()
  @IsOptional()
  endDate: string;

  @IsString()
  @IsNotEmpty()
  status: string;
}

export class CreateProjectDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  siteOfficeId: string;

  @IsString()
  @IsNotEmpty()
  startDate: string;

  @IsString()
  @IsNotEmpty()
  endDate: string;

  status: ProjectStatus;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AssignmentDto)
  assignments: AssignmentDto[];
}
