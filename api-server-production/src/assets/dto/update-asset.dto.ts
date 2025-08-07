import { PartialType } from '@nestjs/mapped-types';
import { CreateAssetDto } from './create-asset.dto';
import { IsNotEmpty, IsString, IsOptional, IsUUID } from 'class-validator';

export class UpdateAssetDto extends PartialType(CreateAssetDto) {
  @IsUUID()
  @IsNotEmpty()
  id: string;

  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsUUID()
  @IsOptional()
  categoryId?: string;

  @IsString()
  @IsOptional()
  skuKey?: string;

  @IsString()
  @IsOptional()
  image?: string;

  @IsUUID()
  @IsOptional()
  parentAssetId?: string;
}
