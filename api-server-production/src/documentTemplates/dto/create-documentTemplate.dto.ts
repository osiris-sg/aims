import { IsBoolean, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class CompanyFieldsDto {
  @IsBoolean()
  @IsOptional()
  name?: boolean;

  @IsBoolean()
  @IsOptional()
  address: boolean;

  @IsBoolean()
  @IsOptional()
  phoneNumber: boolean;
}

class AttentionFieldsDto {
  @IsBoolean()
  @IsOptional()
  name: boolean;

  @IsBoolean()
  @IsOptional()
  phoneNumber: boolean;
}

export class CreateDocumentTemplateDto {
  @IsString()
  name: string;

  @IsString()
  type: string;

  @IsBoolean()
  @IsOptional()
  logo: boolean;

  @ValidateNested()
  @IsOptional()
  @Type(() => CompanyFieldsDto)
  company: CompanyFieldsDto;

  @IsBoolean()
  @IsOptional()
  customer: boolean;

  @ValidateNested()
  @IsOptional()
  @Type(() => AttentionFieldsDto)
  attention: AttentionFieldsDto;

  @IsBoolean()
  @IsOptional()
  collectFrom: boolean;

  @IsBoolean()
  @IsOptional()
  deliveryTo: boolean;

  @IsBoolean()
  @IsOptional()
  returnOrderNo: boolean;

  @IsBoolean()
  @IsOptional()
  doNo: boolean;

  @IsBoolean()
  @IsOptional()
  referenceNo: boolean;

  @IsBoolean()
  @IsOptional()
  poNo: boolean;
}
