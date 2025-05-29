import { IsDate, IsString } from 'class-validator';

export class GetDocumentDto {
  @IsString()
  id: string;

  @IsString()
  name: string;

  @IsString()
  associated_item: string;

  @IsString()
  associated_customer: string;

  @IsString()
  documentType: string;

  @IsString()
  templateId: string;

  @IsDate()
  createdAt: Date;
}
