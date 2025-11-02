import { IsObject, IsOptional, IsUUID } from 'class-validator';

export class CreateDocumentDto {
  @IsObject()
  templateData: Record<string, any>;

  @IsUUID()
  @IsOptional()
  documentTemplateId: string;
}
