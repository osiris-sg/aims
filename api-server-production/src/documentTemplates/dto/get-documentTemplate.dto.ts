import { IsNotEmpty, IsNumber, IsString } from 'class-validator';

export class GetDocumentTemplateDto {
  @IsNumber()
  @IsNotEmpty()
  page: number;

  @IsNumber()
  @IsNotEmpty()
  limit: number;

  @IsString()
  search: string;

  @IsString()
  @IsNotEmpty()
  organizationId: string;
}
