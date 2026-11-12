// DO first (manual order flow, 2026-11-13): the order a DO belongs to, read from what the document page
// hands the editor. The page passes the DO's config FLATTENED (orderId at the top level, no .id / .config);
// other callers pass the document row (.config.orderId). Both shapes are read.
export function doOrderIdOf(existingData: any): string | null {
  const v = existingData?.orderId ?? existingData?.config?.orderId;
  return typeof v === "string" && v ? v : null;
}
