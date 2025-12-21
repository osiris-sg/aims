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
  [key: string]: boolean | undefined;
}

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
  };
}
