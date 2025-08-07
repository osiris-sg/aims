import { IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateAssetDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsOptional()
  description: string;

  @IsUUID()
  @IsOptional()
  categoryId: string;

  @IsString()
  @IsNotEmpty()
  skuKey: string;

  @IsString()
  @IsOptional()
  image: string;

  @IsUUID()
  @IsOptional()
  parentAssetId: string;
}
