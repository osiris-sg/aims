import { useState, useCallback } from "react";
import { useAuth } from "@clerk/nextjs";
import { useOrganization } from "@hooks/useOrganization";
import { request } from "@/helpers/request";

interface Asset {
  id: string;
  name: string;
  skuKey: string;
  image?: string;
  categoryId: string;
  parentAssetId?: string;
  category?: { name: string };
}

export const useAssets = () => {
  const { getToken } = useAuth();
  const { organization } = useOrganization();
  const [loading, setLoading] = useState(false);

  const fetchAssets = useCallback(
    async (options?: { page?: number; limit?: number; search?: string; filters?: Record<string, any> }) => {
      if (!organization?.id) return null;

      setLoading(true);
      try {
        const token = await getToken();
        if (!token) return null;

        const response = await request(
          {
            path: `/assets`,
            method: "POST",
          },
          {
            page: options?.page || 1,
            limit: options?.limit || 1000,
            search: options?.search || "",
            filters: options?.filters || {},
            organizationId: organization.id,
          },
          token
        );

        if (response.success) {
          return response.data;
        }
        return null;
      } catch (error) {
        console.error("Error fetching assets:", error);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [organization?.id, getToken]
  );

  const fetchRootAssets = useCallback(async () => {
    const result = await fetchAssets({ limit: 1000 });
    if (result) {
      // Filter to only root assets (no parent)
      const rootAssets = result.docs.filter((asset: Asset) => !asset.parentAssetId);
      return { ...result, docs: rootAssets };
    }
    return null;
  }, [fetchAssets]);

  return {
    fetchAssets,
    fetchRootAssets,
    loading,
  };
};
