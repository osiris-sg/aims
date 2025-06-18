import { PartialType } from '@nestjs/swagger';
import { CreateDocumentDto } from './create-document.dto';
import { IsArray, IsNotEmpty, IsOptional, IsString, IsUUID, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class CompanyDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsOptional()
  address?: string;

  @IsString()
  @IsOptional()
  phoneNumber?: string;
}

class AttentionDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  phoneNumber?: string;
}

class ItemDto {
  @IsString()
  @IsNotEmpty()
  inventoryItemId: string;

  @IsNotEmpty()
  quantity: number;
}

export class IConfig {
  @ValidateNested()
  @Type(() => CompanyDto)
  company: CompanyDto;

  @IsString()
  @IsOptional()
  customerId?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ItemDto)
  items: ItemDto[];

  @ValidateNested()
  @Type(() => AttentionDto)
  @IsOptional()
  attention?: AttentionDto;

  @IsString()
  @IsOptional()
  returnOrderNo?: string;

  @IsString()
  @IsOptional()
  referenceNo?: string;

  @IsString()
  @IsOptional()
  poNo?: string;

  @IsString()
  @IsOptional()
  collectFrom?: string;

  @IsString()
  @IsOptional()
  gstRegNo?: string;

  @IsString()
  @IsOptional()
  date?: string;

  @IsString()
  @IsOptional()
  startDate?: string;

  @IsString()
  @IsOptional()
  endDate?: string;
}

export class UpdateDocumentDto extends PartialType(CreateDocumentDto) {
  @IsUUID()
  id: string;

  @ValidateNested()
  @Type(() => IConfig)
  config?: IConfig;

  @IsUUID()
  @IsOptional()
  inventoryId: string;

  @IsUUID()
  @IsOptional()
  documentTemplateId: string;

  @IsString()
  @IsNotEmpty()
  type: string;

  @IsString()
  @IsOptional()
  customerId?: string;

  @IsString()
  @IsOptional()
  status?: string;

  @IsString()
  @IsOptional()
  token?: string;

  @IsUUID()
  @IsOptional()
  projectId?: string;
}
