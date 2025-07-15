import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@clerk/nextjs";

export function useGetRoles() {
  const { getToken } = useAuth();
  interface Role {
    id: string;
    name: string;
    description: string;
    permissions: any[];
    createdAt: string;
    updatedAt: string;
  }

  const [roles, setRoles] = useState<{
    docs: Role[];
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
    createdOn: { startDate: null, endDate: null },
  });

  // Define fetchRoles as a useCallback so it can be referenced elsewhere
  const fetchRoles = useCallback(async () => {
    setLoading(true);
    try {
      const token = await getToken();
      if (!token) return;
      
      // Replace with your API call
      const queryParams = new URLSearchParams();
      queryParams.append("page", page.toString());
      queryParams.append("limit", limit.toString());
      queryParams.append("search", search);
      if (filters.createdOn.startDate) {
        queryParams.append("startDate", filters.createdOn.startDate);
      }
      if (filters.createdOn.endDate) {
        queryParams.append("endDate", filters.createdOn.endDate);
      }

      const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_API_URL}/admin/roles`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error("Failed to fetch roles");
      }

      const data = await response.json();

      console.log("Get roles data", data.data);

      // Handle the response from the updated API
      if (data.success !== false) {
      setRoles({
          docs: data.data || [],
          totalDocuments: data.data?.totalDocuments || 0,
          totalPagesCount: data.data?.totalPagesCount || 0,
        });
      } else {
        throw new Error(data.message || "Failed to fetch roles");
      }
    } catch (error) {
      console.error("Error fetching roles:", error);
    } finally {
      setLoading(false);
    }
  }, [page, limit, search, filters]);

  // Use fetchRoles in useEffect
  useEffect(() => {
    fetchRoles();
  }, [fetchRoles]);

  // Add the refreshRoles function that can be called to manually refresh data
  const refreshRoles = () => {
    fetchRoles();
  };

  return {
    roles,
    loading,
    page,
    limit,
    search,
    filters,
    setPage,
    setLimit,
    setSearch,
    setFilters,
    refreshRoles,
  };
}
