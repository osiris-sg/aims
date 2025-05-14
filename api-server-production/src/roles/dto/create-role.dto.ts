// src/roles/dto/create-role.dto.ts
import { IsString, IsNotEmpty, IsOptional, IsArray } from 'class-validator';

export class CreateRoleDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsArray()
  @IsOptional()
  permissionIds?: string[];
}