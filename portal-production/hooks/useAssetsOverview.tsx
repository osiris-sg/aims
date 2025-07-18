"use client";
import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@clerk/nextjs";
import { useOrganization } from "@hooks/useOrganization";
import { request } from "@/helpers/request";

interface AssetCategory {
  name: string;
  count: number;
}

interface LowStockAsset {
  id: string;
  name: string;
  skuKey: string;
  categoryName: string;
  totalQuantity: number;
}

interface AssetsOverviewData {
  data: {
    totalInStock: number;
    topCategories: AssetCategory[];
    lowStockCount: number;
    lowStockAssets: LowStockAsset[];
    }
}

const API = {
  GET_ASSETS_OVERVIEW: {
    path: "/dashboard/assets-overview",
    method: "GET",
  },
};

export default function useAssetsOverview() {
  const { getToken } = useAuth();
  const { organization } = useOrganization();
  const organizationId = organization?.id;

  const [assetsData, setAssetsData] = useState<AssetsOverviewData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAssetsOverview = useCallback(async () => {
    if (!organizationId) return;

    setLoading(true);
    setError(null);

    try {
      const token = await getToken();
      if (!token) return;

      // Fetch assets overview data
      const response = await request(API.GET_ASSETS_OVERVIEW, {}, token);

      if (response.success && response.data) {
        setAssetsData(response.data);
      } else {
        setError(response.message || "Failed to fetch assets data");
      }
    } catch (err) {
      console.error("Error fetching assets overview:", err);
      setError("An error occurred while fetching assets data");
    } finally {
      setLoading(false);
    }
  }, [organizationId, getToken]);

  useEffect(() => {
    fetchAssetsOverview();
  }, [fetchAssetsOverview]);

  return {
    assetsData,
    loading,
    error,
    refetch: fetchAssetsOverview,
  };
}
