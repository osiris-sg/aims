// Equipment vs Accessory (OSI-80). The class lives on Asset.assetClass, and on
// DeliveryItem.assetClass for FREE-TYPED lines that have no asset behind them.
//
// Its only job today is to set how many photos the field must capture when a
// unit is tagged: equipment gets a guided multi-angle sequence, an accessory
// keeps the single-shot flow. Both the client dialogs and the server-side
// DO_START gate read the minimum from HERE so the two can never disagree.

import { AssetClass } from '@prisma/client';

/** Minimum photos required at tagging, per class. */
export const MIN_PHOTOS_BY_ASSET_CLASS: Record<AssetClass, number> = {
  EQUIPMENT: 4,
  ACCESSORY: 1,
};

/** The class every unclassified thing falls back to (matches the column default). */
export const DEFAULT_ASSET_CLASS: AssetClass = AssetClass.EQUIPMENT;

/**
 * How many photos this class needs at tagging. Anything unrecognised (null on a
 * catalog-backed DeliveryItem, a legacy row, a bad string off the wire) is
 * treated as EQUIPMENT — the stricter of the two, so a missing class can never
 * quietly lower the bar.
 */
export function minPhotosForAssetClass(assetClass?: AssetClass | string | null): number {
  const key = String(assetClass ?? '').toUpperCase();
  return key === AssetClass.ACCESSORY
    ? MIN_PHOTOS_BY_ASSET_CLASS.ACCESSORY
    : MIN_PHOTOS_BY_ASSET_CLASS.EQUIPMENT;
}

/**
 * Resolve the effective class of a delivery line: the line's own class when it
 * is free-typed, otherwise the linked asset's, otherwise the default.
 */
export function resolveLineAssetClass(
  lineClass?: AssetClass | null,
  assetClassOfAsset?: AssetClass | null,
): AssetClass {
  return lineClass ?? assetClassOfAsset ?? DEFAULT_ASSET_CLASS;
}
