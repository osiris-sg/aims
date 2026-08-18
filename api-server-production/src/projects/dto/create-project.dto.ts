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
  @IsOptional()
  startDate?: string;

  @IsString()
  @IsOptional()
  endDate?: string;

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

  // OSI-84 — CustomerContact ids to attach to the project (from the customer's
  // contact list; free-typed ones are created as CustomerContacts first).
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  contactIds?: string[];
}
