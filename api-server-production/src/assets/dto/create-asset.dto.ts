import { IsNotEmpty, IsOptional, IsString, IsUUID, IsBoolean, IsInt, IsNumber, Min, ValidateIf } from 'class-validator';

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

  // Unit price for the asset/product
  @IsNumber()
  @IsOptional()
  @Min(0)
  price?: number;

  // Tracking mode: true = individual inventory items with SKUs (Asset), false = simple quantity (Product)
  @IsBoolean()
  @IsOptional()
  isTracked?: boolean;

  // Quantity for untracked products (required when isTracked = false)
  @ValidateIf(o => o.isTracked === false)
  @IsInt()
  @Min(0)
  quantity?: number;

  // Minimum quantity threshold for low stock alerts
  @IsInt()
  @IsOptional()
  @Min(0)
  minQuantity?: number;
}
