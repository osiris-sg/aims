import { IsNotEmpty, IsOptional, IsString, IsUUID, IsBoolean, IsInt, IsNumber, Min, ValidateIf, IsIn, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class CustomPriceDto {
  @IsString()
  @IsNotEmpty()
  label: string;

  @IsNumber()
  @Min(0)
  value: number;
}

// Standard industry UOM codes
export const UOM_OPTIONS = [
  'PCS',   // Pieces
  'EA',    // Each
  'UNIT',  // Unit
  'SET',   // Set
  'PAIR',  // Pair
  'DOZ',   // Dozen
  'BOX',   // Box
  'CTN',   // Carton
  'PKG',   // Package
  'PACK',  // Pack
  'BAG',   // Bag
  'ROLL',  // Roll
  'SHEET', // Sheet
  'BTL',   // Bottle
  'CAN',   // Can
  'KG',    // Kilogram
  'G',     // Gram
  'LB',    // Pound
  'OZ',    // Ounce
  'L',     // Liter
  'ML',    // Milliliter
  'GAL',   // Gallon
  'M',     // Meter
  'CM',    // Centimeter
  'MM',    // Millimeter
  'FT',    // Feet
  'IN',    // Inch
  'SQM',   // Square Meter
  'SQF',   // Square Feet
  'CBM',   // Cubic Meter
] as const;

export type UOMType = typeof UOM_OPTIONS[number];

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

  // Unit of Measure
  @IsString()
  @IsOptional()
  @IsIn(UOM_OPTIONS)
  uom?: string;

  // Legacy unit price — semantically the selling price for backwards compatibility.
  @IsNumber()
  @IsOptional()
  @Min(0)
  price?: number;

  // Cost price — what the org pays per unit to acquire/produce this asset.
  @IsNumber()
  @IsOptional()
  @Min(0)
  costPrice?: number;

  // Free-form named prices — e.g. Listing Price, Dealer Price, Wholesale Price.
  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => CustomPriceDto)
  customPrices?: CustomPriceDto[];

  // Discount points (1 point = $1). Gated by enableAssetPoints feature flag.
  @IsNumber()
  @IsOptional()
  @Min(0)
  points?: number;

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
