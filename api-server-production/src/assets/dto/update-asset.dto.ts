import { PartialType } from '@nestjs/mapped-types';
import { CreateAssetDto } from './create-asset.dto';
import { IsNotEmpty, IsString, IsOptional, IsUUID } from 'class-validator';

export class UpdateAssetDto extends PartialType(CreateAssetDto) {
  @IsUUID()
  id: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsOptional()
  description: string;

  @IsString()
  @IsNotEmpty()
  organizationId: string;

  @IsUUID()
  @IsOptional()
  categoryId: string;

  @IsString()
  @IsNotEmpty()
  skuKey: string;

  @IsString()
  @IsOptional()
  image: string;
}
