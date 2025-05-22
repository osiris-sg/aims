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

  @IsDate()
  createdAt: Date;
}
