import { IsNotEmpty, IsString, IsArray, IsBoolean, IsOptional, ValidateNested, IsNumber, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// Supported field types
export enum FieldType {
  TEXT = 'text',
  NUMBER = 'number',
  DATE = 'date',
  SELECT = 'select',
  AUTOCOMPLETE = 'autocomplete',
  TEXTAREA = 'textarea',
  TABLE = 'table',
  CUSTOMER = 'customer',
  SALESMAN = 'salesman',
  SUPPLIER = 'supplier',
}

export class FieldDefinitionDto {
  @ApiProperty({ description: 'Technical field name (path in data object)' })
  @IsString()
  @IsNotEmpty()
  fieldName: string;

  @ApiProperty({ description: 'User-facing label' })
  @IsString()
  @IsNotEmpty()
  displayLabel: string;

  @ApiProperty({ enum: FieldType, description: 'Type of field' })
  @IsEnum(FieldType)
  fieldType: FieldType;

  @ApiProperty({ description: 'Whether the field is required' })
  @IsBoolean()
  required: boolean;

  @ApiPropertyOptional({ description: 'Grid column size (6 = half width, 12 = full width)' })
  @IsOptional()
  @IsNumber()
  gridSize?: 6 | 12;

  @ApiPropertyOptional({ description: 'Data source for select/autocomplete fields' })
  @IsOptional()
  @IsString()
  dataSource?: string;

  @ApiPropertyOptional({ description: 'Placeholder text' })
  @IsOptional()
  @IsString()
  placeholder?: string;

  @ApiPropertyOptional({ description: 'Default value for the field' })
  @IsOptional()
  defaultValue?: any;

  @ApiPropertyOptional({ description: 'Filter by this field for dependent dropdowns' })
  @IsOptional()
  @IsString()
  filterBy?: string;

  @ApiPropertyOptional({ description: 'Storage path in database if different from fieldName' })
  @IsOptional()
  @IsString()
  storagePath?: string;
}

export class TabDefinitionDto {
  @ApiProperty({ description: 'Unique identifier for the tab' })
  @IsString()
  @IsNotEmpty()
  tabId: string;

  @ApiProperty({ description: 'Display label for the tab' })
  @IsString()
  @IsNotEmpty()
  tabLabel: string;

  @ApiProperty({ type: [FieldDefinitionDto], description: 'Fields in this tab' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FieldDefinitionDto)
  fields: FieldDefinitionDto[];
}

export class TemplateFieldConfigDto {
  @ApiProperty({ type: [TabDefinitionDto], description: 'Tabs containing field definitions' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TabDefinitionDto)
  tabs: TabDefinitionDto[];
}

export class UpdateFieldDefinitionsDto {
  @ApiProperty({ description: 'The field configuration to update' })
  @ValidateNested()
  @Type(() => TemplateFieldConfigDto)
  formFields: TemplateFieldConfigDto;
}
