import { IsDate, IsIn, IsOptional, IsString } from 'class-validator';

export class GetDocumentDto {
  @IsString()
  id: string;

  @IsString()
  name: string;

  @IsString()
  associated_item: string;

  @IsString()
  associated_customer: string;

  /** Which side associated_customer names: a customer we issued to, or a
   *  supplier who issued to us. Only credit / debit notes occur both ways. */
  @IsOptional()
  @IsIn(['CUSTOMER', 'SUPPLIER'])
  counterpartyKind?: 'CUSTOMER' | 'SUPPLIER' | null;

  @IsString()
  documentType: string;

  @IsString()
  templateId: string;

  @IsDate()
  createdAt: Date;
}
