import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { AssetClass } from '@prisma/client';

/**
 * Field-flow top-level asset creation (bind page): when a scanned nameplate
 * matches no catalog product, the tech creates it as a NEW top-level asset —
 * name + skuKey only. The office completes pricing, GL accounts and the real
 * category later. Server-side: categoryId is forced to the org's "New" bucket,
 * uom defaults to PCS, isTracked=true, no parent. A narrow surface (permission
 * assets:create-basic) — never the full office assets:create.
 */
export class CreateBasicAssetDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  skuKey: string;

  // Equipment vs Accessory, chosen by the tech when they create the product
  // from the field. Omitted → EQUIPMENT (the stricter photo rule).
  @IsEnum(AssetClass)
  @IsOptional()
  assetClass?: AssetClass;
}
