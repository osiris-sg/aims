import { IsString, IsBoolean, IsOptional, IsNumber, IsObject } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateModuleDto {
  @ApiProperty({ description: 'Module code (e.g., ASSETS, INVENTORY)' })
  @IsString()
  moduleCode: string;

  @ApiProperty({ description: 'Whether the module is enabled', required: false })
  @IsBoolean()
  @IsOptional()
  enabled?: boolean;

  @ApiProperty({ description: 'Custom display name for the module', required: false })
  @IsString()
  @IsOptional()
  displayName?: string;

  @ApiProperty({ description: 'Material UI icon name', required: false })
  @IsString()
  @IsOptional()
  icon?: string;

  @ApiProperty({ description: 'Sort order for navigation', required: false })
  @IsNumber()
  @IsOptional()
  sortOrder?: number;

  @ApiProperty({ description: 'Module-specific configuration', required: false })
  @IsObject()
  @IsOptional()
  config?: Record<string, any>;
}

export class UpdateModuleDto {
  @ApiProperty({ description: 'Whether the module is enabled', required: false })
  @IsBoolean()
  @IsOptional()
  enabled?: boolean;

  @ApiProperty({ description: 'Custom display name for the module', required: false })
  @IsString()
  @IsOptional()
  displayName?: string;

  @ApiProperty({ description: 'Material UI icon name', required: false })
  @IsString()
  @IsOptional()
  icon?: string;

  @ApiProperty({ description: 'Sort order for navigation', required: false })
  @IsNumber()
  @IsOptional()
  sortOrder?: number;

  @ApiProperty({ description: 'Module-specific configuration', required: false })
  @IsObject()
  @IsOptional()
  config?: Record<string, any>;
}

export class ModuleConfigDto {
  @ApiProperty({ description: 'Route path' })
  route?: string;

  @ApiProperty({ description: 'Submenu items' })
  subMenus?: string[];

  @ApiProperty({ description: 'Required permissions' })
  permissions?: string[];

  // Additional configuration
  [key: string]: any;
}