import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@clerk/nextjs";

interface InventoryItem {
  id: string;
  sku: string;
  quantity: number;
  reserved: number;
  available: number;
  status: string;
  createdAt: string;
  updatedAt: string;
  organization: {
    id: string;
    name: string;
  };
  asset?: {
    id: string;
    name: string;
    skuKey: string;
  };
}

export function useGetInventory() {
  const { getToken } = useAuth();

  const [inventory, setInventory] = useState<{
    docs: InventoryItem[];
    totalDocuments: number;
    totalPagesCount: number;
  }>({
    docs: [],
    totalDocuments: 0,
    totalPagesCount: 0,
  });

  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState({
    status: "",
    organization: "",
  });

  const fetchInventory = useCallback(async () => {
    setLoading(true);
    try {
      const token = await getToken();
      if (!token) {
        console.error("No authentication token available");
        return;
      }

      const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_API_URL}/admin/inventories`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error("Failed to fetch inventory");
      }

      const data = await response.json();
      console.log("Get admin inventory data", data);

      let inventoryArray: InventoryItem[] = [];

      if (Array.isArray(data)) {
        inventoryArray = data;
      } else if (data && data.success && Array.isArray(data.data)) {
        inventoryArray = data.data;
      } else {
        console.error("Unexpected response format:", data);
        throw new Error(`Invalid response format from admin inventory endpoint. Got: ${JSON.stringify(data)}`);
      }

      // Apply client-side filtering
      let filteredInventory = inventoryArray;

      // Apply search filter
      if (search) {
        filteredInventory = filteredInventory.filter((item: any) => item.sku.toLowerCase().includes(search.toLowerCase()) || item.asset?.name.toLowerCase().includes(search.toLowerCase()) || item.organization?.name.toLowerCase().includes(search.toLowerCase()));
      }

      // Apply status filter
      if (filters.status) {
        filteredInventory = filteredInventory.filter((item: any) => item.status === filters.status);
      }

      // Apply organization filter
      if (filters.organization) {
        filteredInventory = filteredInventory.filter((item: any) => item.organization?.name.toLowerCase().includes(filters.organization.toLowerCase()));
      }

      // Apply pagination
      const totalDocuments = filteredInventory.length;
      const totalPagesCount = Math.ceil(totalDocuments / limit);
      const startIndex = (page - 1) * limit;
      const endIndex = startIndex + limit;
      const paginatedInventory = filteredInventory.slice(startIndex, endIndex);

      setInventory({
        docs: paginatedInventory,
        totalDocuments,
        totalPagesCount,
      });
    } catch (error) {
      console.error("Error fetching admin inventory:", error);
    } finally {
      setLoading(false);
    }
  }, [page, limit, search, filters, getToken]);

  useEffect(() => {
    fetchInventory();
  }, [fetchInventory]);

  const refreshInventory = () => {
    fetchInventory();
  };

  return {
    inventory,
    loading,
    page,
    limit,
    search,
    filters,
    setPage,
    setLimit,
    setSearch,
    setFilters,
    refreshInventory,
  };
}
