import { IsNotEmpty, IsOptional, IsString, IsUUID, IsBoolean, IsInt, IsNumber, Min, ValidateIf, IsIn } from 'class-validator';

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
