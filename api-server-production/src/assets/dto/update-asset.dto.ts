import { PartialType } from '@nestjs/mapped-types';
import { CreateAssetDto } from './create-asset.dto';
import { IsNotEmpty, IsString, IsOptional, IsUUID, IsBoolean, IsInt, IsNumber, Min } from 'class-validator';

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

  // Unit price
  @IsNumber()
  @IsOptional()
  @Min(0)
  price?: number;

  // Tracking mode toggle
  @IsBoolean()
  @IsOptional()
  isTracked?: boolean;

  // Quantity for untracked products
  @IsInt()
  @Min(0)
  @IsOptional()
  quantity?: number;

  // Minimum quantity threshold for low stock alerts
  @IsInt()
  @IsOptional()
  @Min(0)
  minQuantity?: number;
}
