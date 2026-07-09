import { PartialType } from '@nestjs/swagger';
import { CreateDocumentDto } from './create-document.dto';
import { IsArray, IsBoolean, IsNotEmpty, IsOptional, IsString, IsUUID, ValidateNested, IsEnum, IsInt } from 'class-validator';
import { Type } from 'class-transformer';
import { DocumentStatus } from '@prisma/client';

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
  @IsOptional()
  inventoryItemId: string;

  @IsOptional()
  quantity: number;

  @IsString()
  @IsOptional()
  tax?: string;

  @IsNotEmpty()
  @IsOptional()
  price: number;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  accountCode?: string;

  // Service/revenue rows (no physical unit) — set by the editor's Add Service
  // flow; used to skip project-assignment creation on save.
  @IsBoolean()
  @IsOptional()
  isService?: boolean;
}

class PhotoDto {
  @IsString()
  @IsOptional()
  id?: string;

  @IsString()
  @IsOptional()
  imageData?: string;

  @IsString()
  @IsOptional()
  annotations?: string;

  @IsString()
  @IsOptional()
  partName?: string;

  @IsString()
  @IsOptional()
  comments?: string;

  @IsOptional()
  timestamp?: number;
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
  @IsOptional()
  items?: ItemDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PhotoDto)
  @IsOptional()
  photos?: PhotoDto[];

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

  @IsString()
  @IsOptional()
  doNo?: string;

  @IsString()
  @IsOptional()
  note?: string;

  @IsString()
  @IsOptional()
  dueDate?: string;

  @IsString()
  @IsOptional()
  deliveryTo?: string;

  @IsOptional()
  signature?: any;
}

export class UpdateDocumentDto extends PartialType(CreateDocumentDto) {
  @IsUUID()
  id: string;

  @ValidateNested()
  @Type(() => IConfig)
  config?: IConfig;

  @IsUUID()
  @IsOptional()
  documentTemplateId: string;

  @IsString()
  @IsNotEmpty()
  type: string;

  @IsEnum(DocumentStatus)
  @IsOptional()
  status?: DocumentStatus;

  @IsString()
  @IsOptional()
  token?: string;

  @IsString()
  @IsOptional()
  name?: string;

  // Optimistic-concurrency token: the version the client loaded. A save whose
  // version is behind the stored one is rejected (409) by updateDocument.
  @IsInt()
  @IsOptional()
  version?: number;
}
