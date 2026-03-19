import { IsNotEmpty, IsString } from 'class-validator';

export class DeleteSupplierDto {
  @IsString()
  @IsNotEmpty()
  id: string;
}
