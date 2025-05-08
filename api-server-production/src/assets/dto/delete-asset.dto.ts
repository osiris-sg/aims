import { IsNotEmpty, IsUUID } from 'class-validator';

export class DeleteAssetDto {
  @IsUUID()
  @IsNotEmpty()
  id: string;
}
