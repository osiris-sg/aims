import { IsBoolean, IsLatitude, IsLongitude, IsNumber, IsOptional, IsString, IsUUID } from 'class-validator';

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

  // Direct-bind to a KNOWN existing unit (child-tagging: SIDS → TSS/SIMCARD
  // placeholders). When set, the serial-matching / create-new logic is
  // bypassed — we bind the tag to exactly this unit, and a supplied real
  // serial completes the placeholder (pending→instock auto-flip, mirroring the
  // office update path). Must belong to `assetId` and this org.
  @IsUUID()
  @IsOptional()
  targetInventoryId?: string;

  // Manufacturer's serial number from the nameplate. Stored on Inventory.
  // serialNumber for audit/warranty; NOT used to generate the inventory.sku.
  @IsString()
  @IsOptional()
  serial?: string;

  // Hardware UID of the NFC tag being bound (from useNfcScan). OPTIONAL: the
  // /scan/manual "create new unit" path mints a tagless unit — omit this and the
  // create proceeds with nfcTagUid=null (identity lives in `sku`), skipping the
  // tag-conflict/rebind branches.
  @IsString()
  @IsOptional()
  nfcTagUid?: string;

  // When the typed serial matches an existing unit that ALREADY has a different
  // tag, the bind returns a 409 { code: 'ALREADY_TAGGED' } instead of silently
  // overwriting. The field UI re-submits with confirmRebind: true to proceed
  // (which unbinds the old tag and binds the new one to that existing unit).
  @IsOptional()
  @IsBoolean()
  confirmRebind?: boolean;

  // S3 key of the nameplate photo (uploaded via the uploads service before the
  // bind). Stored in the bind provenance record so the unit is backtrackable.
  @IsString()
  @IsOptional()
  photoKey?: string;

  // One-shot GPS fix captured at tag time (helpers/geolocation.ts). All optional
  // — omitted when the tech denied location / no signal / timeout, in which case
  // the bind still proceeds and the tagged* columns stay null. Validators mirror
  // the MSR DTO's @IsLatitude/@IsLongitude pattern. taggedLocationAt is stamped
  // server-side (not accepted from the client).
  @IsOptional()
  @IsLatitude()
  taggedLatitude?: number;

  @IsOptional()
  @IsLongitude()
  taggedLongitude?: number;

  @IsOptional()
  @IsNumber()
  taggedLocationAccuracy?: number;
}
