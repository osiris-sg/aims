/**
 * Canonical feature-flag defaults for a new organization. Mirrors the frontend
 * FEATURE_FLAG_DEFAULTS (portal useOrganizationFeatures.ts). Seeded into
 * OrganizationUIConfig.features on org creation so every org has the same flag
 * set (values are per-org; the list is universal). Add new flags here too.
 */
export const DEFAULT_ORG_FEATURES: Record<string, boolean> = {
  // Base capabilities (typically on)
  enableProjects: true,
  enableAnalytics: true,
  enableDocumentAI: true,
  enableCustomFields: true,
  enableServiceItems: true,
  // Integrations / mode toggles (opt-in)
  enableXeroIntegration: false,
  enableEditInventorySku: false,
  enableAssetTrackingMode: false,
  enableFieldScanApp: false,
  // Newer opt-in feature flags
  enableAssetPoints: false,
  enableItemTagging: false,
  enablePOAsProject: false,
  enableConfirmQuotation: false,
  enableDocumentListView: false,
  // Round each document's Nett Total DOWN to the nearest 5.
  enableNettRoundDown: false,
  // Quotation "Project" picker (link a quotation to a project + create new).
  enableQuotationProjectLink: false,
};
