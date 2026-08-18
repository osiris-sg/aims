// Equipment vs Accessory (OSI-80). Mirrors
// api-server-production/src/common/asset-class.ts — keep the two in sync.
//
// The class sets how many photos the field must capture when a unit is tagged:
// equipment gets a guided multi-angle sequence, an accessory keeps the single
// shot. Every capture dialog reads its minimum from here so no screen invents
// its own number.

export const ASSET_CLASSES = ["EQUIPMENT", "ACCESSORY"] as const;
export type AssetClass = (typeof ASSET_CLASSES)[number];

/** The class anything unclassified falls back to (matches the column default). */
export const DEFAULT_ASSET_CLASS: AssetClass = "EQUIPMENT";

/** Minimum photos required at tagging, per class. */
export const MIN_PHOTOS_BY_ASSET_CLASS: Record<AssetClass, number> = {
  EQUIPMENT: 4,
  ACCESSORY: 1,
};

/** Picker options, in the order they should render. */
export const ASSET_CLASS_OPTIONS: { value: AssetClass; label: string }[] = [
  { value: "EQUIPMENT", label: "Equipment" },
  { value: "ACCESSORY", label: "Accessory" },
];

/** Human label for a class, safe for any input. */
export function assetClassLabel(assetClass?: string | null): string {
  return normalizeAssetClass(assetClass) === "ACCESSORY" ? "Accessory" : "Equipment";
}

/**
 * Coerce anything off the wire into a real class. Unknown or missing values
 * become EQUIPMENT, the stricter of the two, so a gap can never quietly lower
 * the photo bar.
 */
export function normalizeAssetClass(assetClass?: string | null): AssetClass {
  return String(assetClass ?? "").toUpperCase() === "ACCESSORY" ? "ACCESSORY" : "EQUIPMENT";
}

/** How many photos this class needs at tagging. */
export function minPhotosForAssetClass(assetClass?: string | null): number {
  return MIN_PHOTOS_BY_ASSET_CLASS[normalizeAssetClass(assetClass)];
}
