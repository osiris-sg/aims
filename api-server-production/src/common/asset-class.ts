// Equipment vs Accessory (OSI-80), plus SERVICE (WCT 2026-10-27). The class
// lives on Asset.assetClass, and on DeliveryItem.assetClass for FREE-TYPED
// lines that have no asset behind them. SERVICE is a delivery-line class only
// (work done on site — a kitchen-hood degrease, a maintenance visit): nothing
// to scan, nothing to resolve to stock, and one condition photo to start.
//
// Its only job today is to set how many photos the field must capture when a
// unit is tagged: equipment gets a guided multi-angle sequence, an accessory
// keeps the single-shot flow. Both the client dialogs and the server-side
// DO_START gate read the minimum from HERE so the two can never disagree.

import { AssetClass } from '@prisma/client';

/** Minimum photos required at tagging, per class. */
export const MIN_PHOTOS_BY_ASSET_CLASS: Record<AssetClass, number> = {
  EQUIPMENT: 4, // Front, Back, Left, Right
  ACCESSORY: 1,
  SERVICE: 1, // one "before" shot of the work area
};

/** The class every unclassified thing falls back to (matches the column default). */
export const DEFAULT_ASSET_CLASS: AssetClass = AssetClass.EQUIPMENT;

/**
 * How many photos this class needs at tagging. Anything unrecognised (null on a
 * catalog-backed DeliveryItem, a legacy row, a bad string off the wire) is
 * treated as EQUIPMENT — the strictest, so a missing class can never quietly
 * lower the bar.
 */
export function minPhotosForAssetClass(assetClass?: AssetClass | string | null): number {
  const key = String(assetClass ?? '').toUpperCase();
  if (key === AssetClass.ACCESSORY) return MIN_PHOTOS_BY_ASSET_CLASS.ACCESSORY;
  if (key === AssetClass.SERVICE) return MIN_PHOTOS_BY_ASSET_CLASS.SERVICE;
  return MIN_PHOTOS_BY_ASSET_CLASS.EQUIPMENT;
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
