// Equipment vs Accessory (OSI-80), plus SERVICE (WCT 2026-10-27). Mirrors
// api-server-production/src/common/asset-class.ts — keep the two in sync.
//
// The class sets how many photos the field must capture when a unit is tagged:
// equipment gets a guided multi-angle sequence, an accessory keeps the single
// shot. SERVICE is a delivery-line class only (work done on site, nothing to
// scan): one "before" photo. Every capture dialog reads its minimum from here
// so no screen invents its own number.

export const ASSET_CLASSES = ["EQUIPMENT", "ACCESSORY", "SERVICE"] as const;
export type AssetClass = (typeof ASSET_CLASSES)[number];

/** The class anything unclassified falls back to (matches the column default). */
export const DEFAULT_ASSET_CLASS: AssetClass = "EQUIPMENT";

/** Minimum photos required at tagging, per class. */
export const MIN_PHOTOS_BY_ASSET_CLASS: Record<AssetClass, number> = {
  EQUIPMENT: 4, // Front, Back, Left, Right
  ACCESSORY: 1,
  SERVICE: 1,
};

/** Picker options for a CATALOG asset or a stock-org free-typed line. */
export const ASSET_CLASS_OPTIONS: { value: AssetClass; label: string }[] = [
  { value: "EQUIPMENT", label: "Equipment" },
  { value: "ACCESSORY", label: "Accessory" },
];

/**
 * Picker options for a free-typed line in a SERVICE-JOB org (enableQuotationToDelivery,
 * e.g. WCT): the job is either something supplied (Equipment) or work done on site
 * (Service). Accessory is a stock notion and is not offered there.
 */
export const SERVICE_LINE_CLASS_OPTIONS: { value: AssetClass; label: string }[] = [
  { value: "EQUIPMENT", label: "Equipment" },
  { value: "SERVICE", label: "Service" },
];

/** Human label for a class, safe for any input. */
export function assetClassLabel(assetClass?: string | null): string {
  const c = normalizeAssetClass(assetClass);
  return c === "ACCESSORY" ? "Accessory" : c === "SERVICE" ? "Service" : "Equipment";
}

/**
 * Coerce anything off the wire into a real class. Unknown or missing values
 * become EQUIPMENT, the strictest, so a gap can never quietly lower the photo bar.
 */
export function normalizeAssetClass(assetClass?: string | null): AssetClass {
  const key = String(assetClass ?? "").toUpperCase();
  return key === "ACCESSORY" ? "ACCESSORY" : key === "SERVICE" ? "SERVICE" : "EQUIPMENT";
}

/** How many photos this class needs at tagging. */
export function minPhotosForAssetClass(assetClass?: string | null): number {
  return MIN_PHOTOS_BY_ASSET_CLASS[normalizeAssetClass(assetClass)];
}
