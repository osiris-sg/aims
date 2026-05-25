import { IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

/**
 * Field create-and-bind: the technician scans an unbound NFC tag, photographs
 * the equipment nameplate (AI extracts model + serial as hints), then picks
 * an existing Asset (SKU) from the org's catalog. We create one Inventory
 * unit under that asset and bind the NFC tag to it.
 *
 * The field flow intentionally cannot create new Assets — SKU/catalog
 * management is an office responsibility. If no matching asset exists, the
 * tech is instructed to ask the office to add it.
 */
export class CreateInventoryAndBindDto {
  // The existing Asset (SKU) selected by the tech in the field UI.
  @IsUUID()
  assetId: string;

  // Manufacturer's serial number from the nameplate. Stored on Inventory.
  // serialNumber for audit/warranty; NOT used to generate the inventory.sku.
  @IsString()
  @IsOptional()
  serial?: string;

  // Hardware UID of the NFC tag being bound (from useNfcScan).
  @IsString()
  @IsNotEmpty()
  nfcTagUid: string;
}
