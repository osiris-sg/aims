import { IsNotEmpty, IsNumber, IsString, IsOptional } from 'class-validator';

export class GetDocumentTemplateDto {
  @IsNumber()
  @IsNotEmpty()
  page: number;

  @IsNumber()
  @IsNotEmpty()
  limit: number;

  @IsString()
  @IsOptional()
  search?: string;
}
