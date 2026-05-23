import { IsNotEmpty, IsString, IsUUID } from 'class-validator';

export class CreateAndBindDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  skuKey: string;

  @IsUUID()
  categoryId: string;

  @IsString()
  @IsNotEmpty()
  nfcTagUid: string;
}

export class ExtractLabelDto {
  @IsString()
  @IsNotEmpty()
  image: string;
}
