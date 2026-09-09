import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@clerk/nextjs";
import { sortRows } from "@/components/clientSort";

export function useGetRoles(sorting: { id: string; desc: boolean }[] = []) {
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
      
      // Fetch the FULL (searched) role set — the backend paginates with
      // skip/take but cannot sort, so sorting must happen client-side over
      // every row; role lists are small, so one big page is fine.
      const queryParams = new URLSearchParams();
      queryParams.append("page", "1");
      queryParams.append("limit", "1000");
      queryParams.append("search", search);
      if (filters.createdOn.startDate) {
        queryParams.append("startDate", filters.createdOn.startDate);
      }
      if (filters.createdOn.endDate) {
        queryParams.append("endDate", filters.createdOn.endDate);
      }

      const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_API_URL}/roles?${queryParams}`, {
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

      console.log("Get roles data", data);

      // Handle the response from the updated API
      if (data.success !== false) {
        // Sort the WHOLE list, then slice the current page so header sorting
        // reorders across pages (the table is in manualSorting mode).
        const allRoles: Role[] = data.data?.roles || [];
        const sorted = sortRows(allRoles, sorting, {
          // "Permissions Count" column — sort by the count, not the array.
          permissions: (r: any) => (Array.isArray(r.permissions) ? r.permissions.length : 0),
        });
        setRoles({
          docs: sorted.slice((page - 1) * limit, page * limit),
          totalDocuments: sorted.length,
          totalPagesCount: Math.ceil(sorted.length / limit),
        });
      } else {
        throw new Error(data.message || "Failed to fetch roles");
      }
    } catch (error) {
      console.error("Error fetching roles:", error);
      // Use mock data for development
      const sortedMock = sortRows(mockRoles, sorting, {
        permissions: (r: any) => (Array.isArray(r.permissions) ? r.permissions.length : 0),
      });
      setRoles({
        docs: sortedMock.slice((page - 1) * limit, page * limit),
        totalDocuments: sortedMock.length,
        totalPagesCount: Math.ceil(sortedMock.length / limit),
      });
    } finally {
      setLoading(false);
    }
  }, [page, limit, search, filters, sorting]);

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

// Mock data for development
const mockRoles = [
  {
    id: "1",
    name: "Superadmin",
    description: "Has all permissions",
    permissions: Array(12).fill({}), // 12 permissions
    createdAt: "2023-01-01T00:00:00.000Z",
    updatedAt: "2023-01-01T00:00:00.000Z",
  },
  {
    id: "2",
    name: "Admin",
    description: "Can manage most resources",
    permissions: Array(8).fill({}), // 8 permissions
    createdAt: "2023-01-02T00:00:00.000Z",
    updatedAt: "2023-01-02T00:00:00.000Z",
  },
  {
    id: "3",
    name: "Editor",
    description: "Can edit content",
    permissions: Array(5).fill({}), // 5 permissions
    createdAt: "2023-01-03T00:00:00.000Z",
    updatedAt: "2023-01-03T00:00:00.000Z",
  },
  {
    id: "4",
    name: "User",
    description: "Regular user with limited permissions",
    permissions: Array(3).fill({}), // 3 permissions
    createdAt: "2023-01-04T00:00:00.000Z",
    updatedAt: "2023-01-04T00:00:00.000Z",
  },
];
