"use client";

import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/nextjs";
import { useOrganization } from "@hooks/useOrganization";
import { request } from "@/helpers/request";

interface OrganizationFeatures {
  enableAssetTrackingMode?: boolean;
  enableProjects?: boolean;
  enableAnalytics?: boolean;
  enableDocumentAI?: boolean;
  enableFieldScanApp?: boolean;
  enableDocumentListView?: boolean;
  enablePOAsProject?: boolean;
  enableAssetPoints?: boolean;
  enableItemTagging?: boolean;
  enableConfirmQuotation?: boolean;
  enableCappitechOrders?: boolean;
  enableNettRoundDown?: boolean;
  enableQuotationProjectLink?: boolean;
  enableWaterSgSites?: boolean;
  [key: string]: boolean | undefined;
}

/**
 * Canonical feature-flag list with default values. Single source of truth for
 * which flags exist app-wide. The admin panel renders this merged with an org's
 * stored values so every org shows the same switches (values stay per-org).
 * Add new flags here so they appear for all orgs without per-org backfilling.
 */
export const FEATURE_FLAG_DEFAULTS: Record<string, boolean> = {
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
  // Gates the rich Cappitech Orders flow; default false = slim Orders (Biofuel default).
  enableCappitechOrders: false,
  enableDocumentListView: false,
  // Round each document's Nett Total DOWN to the nearest 5.
  enableNettRoundDown: false,
  // Quotation "Project" picker (link a quotation to a project + create new).
  enableQuotationProjectLink: false,
  // water-sg outbound site creation on DO sign-off (SIDS units). Backend-only
  // trigger; listed here so the flag appears in the admin switches for all orgs.
  enableWaterSgSites: false,
  // Email ingestion agent (docs+{org}@ inbound address → AI-classified drafts).
  // Product switch; the runtime switch is EmailIngestConfig.enabled per org.
  enableEmailIngestion: false,
};

interface OrganizationUIConfig {
  features?: OrganizationFeatures;
  theme?: {
    primaryColor?: string;
    secondaryColor?: string;
    mode?: string;
  };
  terminology?: Record<string, string>;
  dateFormat?: string;
  timeFormat?: string;
  currency?: string;
  language?: string;
}

export function useOrganizationFeatures() {
  const { getToken } = useAuth();
  const { organization, isLoaded: orgLoaded } = useOrganization();

  const {
    data: uiConfig,
    isLoading,
    error,
  } = useQuery<OrganizationUIConfig>({
    queryKey: ["organizationUIConfig", organization?.id],
    queryFn: async () => {
      const token = await getToken();
      if (!token || !organization?.id) return {};

      const response = await request(
        { path: "/configuration/ui", method: "GET" },
        {},
        token
      );

      if (response.success) {
        return response.data?.uiConfig || response.data || {};
      }
      return {};
    },
    enabled: !!organization?.id && orgLoaded,
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });

  const features = uiConfig?.features || {};

  return {
    features,
    uiConfig,
    isLoading: isLoading || !orgLoaded,
    error,
    // Convenience methods for common feature checks
    isAssetTrackingModeEnabled: features.enableAssetTrackingMode ?? false,
    isProjectsEnabled: features.enableProjects ?? true,
    isAnalyticsEnabled: features.enableAnalytics ?? true,
    isEditInventorySkuEnabled: features.enableEditInventorySku ?? false,
    isServiceItemsEnabled: features.enableServiceItems ?? false,
    isFieldScanAppEnabled: features.enableFieldScanApp ?? false,
    isDocumentListViewEnabled: features.enableDocumentListView ?? false,
    isPOAsProjectEnabled: features.enablePOAsProject ?? false,
    isAssetPointsEnabled: features.enableAssetPoints ?? false,
    isItemTaggingEnabled: features.enableItemTagging ?? false,
    isConfirmQuotationEnabled: features.enableConfirmQuotation ?? false,
    isCappitechOrdersEnabled: features.enableCappitechOrders ?? false,
    isNettRoundDownEnabled: features.enableNettRoundDown ?? false,
    isQuotationProjectLinkEnabled: features.enableQuotationProjectLink ?? false,
  };
}
