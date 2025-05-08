import { PartialType } from '@nestjs/swagger';
import { CreateDocumentTemplateDto } from './create-documentTemplate.dto';
import { IsNotEmpty, IsString } from 'class-validator';

export class UpdateDocumentTemplateDto extends PartialType(CreateDocumentTemplateDto) {
  @IsString()
  @IsNotEmpty()
  id: string;
}
