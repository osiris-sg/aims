import { IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

/**
 * Field create-and-bind: capture nameplate → AI extracts model + serial →
 * tech picks/confirms category → POST creates (or reuses) the parent Asset
 * (SKU = `model`), creates one Inventory unit under it with the next
 * sequential per-unit SKU, and binds the NFC tag UID to that Inventory.
 */
export class CreateInventoryAndBindDto {
  // The product/SKU identifier. Used as Asset.skuKey AND Asset.name on first
  // creation. Subsequent calls with the same model reuse the existing Asset.
  @IsString()
  @IsNotEmpty()
  model: string;

  // Manufacturer's serial number from the nameplate. Stored on Inventory.
  // serialNumber for audit/warranty; NOT used to generate the inventory.sku.
  @IsString()
  @IsOptional()
  serial?: string;

  // FK to the Category for the parent Asset on first creation. Ignored if
  // the Asset already exists (we don't change category mid-life).
  @IsUUID()
  categoryId: string;

  // Free-text label written to Inventory.category (the Inventory model has
  // its own category String, distinct from Asset.categoryId). Defaults to
  // 'Equipment' if omitted.
  @IsString()
  @IsOptional()
  categoryName?: string;

  // Hardware UID of the NFC tag being bound (from useNfcScan).
  @IsString()
  @IsNotEmpty()
  nfcTagUid: string;
}
