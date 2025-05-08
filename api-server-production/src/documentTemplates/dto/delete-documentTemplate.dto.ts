import { IsNotEmpty, IsString } from 'class-validator';

export class DeleteDocumentTemplateDto {
  @IsString()
  @IsNotEmpty()
  id: string;
}
