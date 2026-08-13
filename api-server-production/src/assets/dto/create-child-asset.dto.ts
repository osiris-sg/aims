import { IsNotEmpty, IsString, IsUUID } from 'class-validator';

/**
 * Field-flow child asset type creation (components page): a tech creates a new
 * child ASSET linked to the scanned unit's parent asset, so they can tag a
 * unit of it immediately. Name + skuKey only — the office completes pricing,
 * category and the rest later. isTracked + autoCreateOnParentUnit are forced
 * true server-side; categoryId is inherited from the parent asset.
 */
export class CreateChildAssetDto {
  // The scanned unit's PARENT asset — the new child hangs off this.
  @IsUUID()
  parentAssetId: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  skuKey: string;

  // The scanned parent UNIT — used to spawn its placeholder immediately so the
  // tech can tag it without re-scanning.
  @IsUUID()
  parentInventoryId: string;
}
