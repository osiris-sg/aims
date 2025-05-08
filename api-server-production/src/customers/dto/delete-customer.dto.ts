import { IsNotEmpty, IsString } from 'class-validator';

export class DeleteCustomerDto {
  @IsString()
  @IsNotEmpty()
  id: string;
}
