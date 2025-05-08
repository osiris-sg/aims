import { IsNotEmpty, IsNumber, IsString } from 'class-validator';

export class GetDocumentTemplateDto {
  @IsString()
  @IsNotEmpty()
  organizationId: string;

  @IsNumber()
  @IsNotEmpty()
  page: number;

  @IsNumber()
  @IsNotEmpty()
  limit: number;

  @IsString()
  search: string;
}
