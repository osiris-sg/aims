import { IsNotEmpty, IsString } from 'class-validator';

export class DeleteInventoryDto {
  @IsString()
  @IsNotEmpty()
  id: string;
}
