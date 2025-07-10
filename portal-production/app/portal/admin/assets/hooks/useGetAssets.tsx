import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@clerk/nextjs";

interface Asset {
  id: string;
  name: string;
  skuKey: string;
  image: string;
  categoryId: string;
  instockInventoryCount: number;
  status: string;
  createdAt: string;
  updatedAt: string;
  organization: {
    id: string;
    name: string;
  };
  category?: {
    id: string;
    name: string;
  };
}

export function useGetAssets() {
  const { getToken } = useAuth();

  const [assets, setAssets] = useState<{
    docs: Asset[];
    totalDocuments: number;
    totalPagesCount: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
    limit: number;
    nextPage: number;
  }>({
    docs: [],
    totalDocuments: 0,
    totalPagesCount: 0,
    hasNextPage: false,
    hasPrevPage: false,
    limit: 10,
    nextPage: 0,
  });

  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState({
    status: "",
    organization: "",
  });

  const fetchAssets = useCallback(async () => {
    setLoading(true);
    try {
      const token = await getToken();
      if (!token) {
        console.error("No authentication token available");
        return;
      }

      const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_API_URL}/admin/assets`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error("Failed to fetch assets");
      }

      const data = await response.json();
      console.log("Get admin assets data", data);

      let assetsArray: Asset[] = [];

      if (Array.isArray(data)) {
        assetsArray = data;
      } else if (data && data.success && Array.isArray(data.data)) {
        assetsArray = data.data;
      } else {
        console.error("Unexpected response format:", data);
        throw new Error(`Invalid response format from admin assets endpoint. Got: ${JSON.stringify(data)}`);
      }

      // Apply client-side filtering
      let filteredAssets = assetsArray;

      // Apply search filter
      if (search) {
        filteredAssets = filteredAssets.filter((asset: any) => asset.name.toLowerCase().includes(search.toLowerCase()) || asset.skuKey.toLowerCase().includes(search.toLowerCase()) || asset.organization?.name.toLowerCase().includes(search.toLowerCase()));
      }

      // Apply status filter
      if (filters.status) {
        filteredAssets = filteredAssets.filter((asset: any) => asset.status === filters.status);
      }

      // Apply organization filter
      if (filters.organization) {
        filteredAssets = filteredAssets.filter((asset: any) => asset.organization?.name.toLowerCase().includes(filters.organization.toLowerCase()));
      }

      // Apply pagination
      const totalDocuments = filteredAssets.length;
      const totalPagesCount = Math.ceil(totalDocuments / limit);
      const startIndex = (page - 1) * limit;
      const endIndex = startIndex + limit;
      const paginatedAssets = filteredAssets.slice(startIndex, endIndex);

      setAssets({
        docs: paginatedAssets,
        totalDocuments,
        totalPagesCount,
        hasNextPage: page < totalPagesCount,
        hasPrevPage: page > 1,
        limit,
        nextPage: page < totalPagesCount ? page + 1 : 0,
      });
    } catch (error) {
      console.error("Error fetching admin assets:", error);
    } finally {
      setLoading(false);
    }
  }, [page, limit, search, filters, getToken]);

  useEffect(() => {
    fetchAssets();
  }, [fetchAssets]);

  const refreshAssets = () => {
    fetchAssets();
  };

  return {
    assets,
    loading,
    page,
    limit,
    search,
    filters,
    setPage,
    setLimit,
    setSearch,
    setFilters,
    refreshAssets,
  };
}
