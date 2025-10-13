import { IsString, IsBoolean, IsOptional, IsNumber, IsObject, IsArray, IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateCustomFieldDto {
  @ApiProperty({ description: 'Entity type (Asset, Customer, Document, etc.)' })
  @IsString()
  entityType: string;

  @ApiProperty({ description: 'Technical field name (e.g., warranty_date)' })
  @IsString()
  fieldName: string;

  @ApiProperty({ description: 'User-facing label' })
  @IsString()
  displayLabel: string;

  @ApiProperty({
    description: 'Field type',
    enum: ['text', 'number', 'date', 'select', 'multiselect', 'boolean', 'file', 'richtext', 'email', 'url', 'phone']
  })
  @IsString()
  @IsIn(['text', 'number', 'date', 'select', 'multiselect', 'boolean', 'file', 'richtext', 'email', 'url', 'phone'])
  fieldType: string;

  @ApiProperty({ description: 'Is field required', required: false })
  @IsBoolean()
  @IsOptional()
  required?: boolean;

  @ApiProperty({
    description: 'Options for select/multiselect fields',
    example: [{ value: 'option1', label: 'Option 1' }],
    required: false
  })
  @IsArray()
  @IsOptional()
  options?: Array<{ value: string; label: string }>;

  @ApiProperty({ description: 'Default value', required: false })
  @IsString()
  @IsOptional()
  defaultValue?: string;

  @ApiProperty({
    description: 'Validation rules',
    example: { min: 0, max: 100, pattern: '^[A-Z]' },
    required: false
  })
  @IsObject()
  @IsOptional()
  validation?: Record<string, any>;

  @ApiProperty({ description: 'Sort order', required: false })
  @IsNumber()
  @IsOptional()
  sortOrder?: number;

  @ApiProperty({ description: 'Show in list/table views', required: false })
  @IsBoolean()
  @IsOptional()
  showInList?: boolean;

  @ApiProperty({ description: 'Show in forms', required: false })
  @IsBoolean()
  @IsOptional()
  showInForm?: boolean;

  @ApiProperty({ description: 'Group name for organizing fields', required: false })
  @IsString()
  @IsOptional()
  groupName?: string;
}

export class UpdateCustomFieldDto {
  @ApiProperty({ description: 'User-facing label', required: false })
  @IsString()
  @IsOptional()
  displayLabel?: string;

  @ApiProperty({ description: 'Is field required', required: false })
  @IsBoolean()
  @IsOptional()
  required?: boolean;

  @ApiProperty({ description: 'Options for select/multiselect fields', required: false })
  @IsArray()
  @IsOptional()
  options?: Array<{ value: string; label: string }>;

  @ApiProperty({ description: 'Default value', required: false })
  @IsString()
  @IsOptional()
  defaultValue?: string;

  @ApiProperty({ description: 'Validation rules', required: false })
  @IsObject()
  @IsOptional()
  validation?: Record<string, any>;

  @ApiProperty({ description: 'Sort order', required: false })
  @IsNumber()
  @IsOptional()
  sortOrder?: number;

  @ApiProperty({ description: 'Is field active', required: false })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @ApiProperty({ description: 'Show in list/table views', required: false })
  @IsBoolean()
  @IsOptional()
  showInList?: boolean;

  @ApiProperty({ description: 'Show in forms', required: false })
  @IsBoolean()
  @IsOptional()
  showInForm?: boolean;

  @ApiProperty({ description: 'Group name for organizing fields', required: false })
  @IsString()
  @IsOptional()
  groupName?: string;
}

export class SetCustomFieldValueDto {
  @ApiProperty({ description: 'Custom field ID' })
  @IsString()
  customFieldId: string;

  @ApiProperty({ description: 'Entity ID' })
  @IsString()
  entityId: string;

  @ApiProperty({ description: 'Entity type' })
  @IsString()
  entityType: string;

  @ApiProperty({ description: 'Field value' })
  value: any;
}

export class BulkSetCustomFieldValuesDto {
  @ApiProperty({ description: 'Entity ID' })
  @IsString()
  entityId: string;

  @ApiProperty({ description: 'Entity type' })
  @IsString()
  entityType: string;

  @ApiProperty({ description: 'Organization ID' })
  @IsString()
  organizationId: string;

  @ApiProperty({ description: 'Custom field values as key-value pairs' })
  @IsObject()
  values: Record<string, any>;
}