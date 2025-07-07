import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@clerk/nextjs";

interface Organization {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  _count: {
    userOrganizations: number;
    assets: number;
    categories: number;
    customers: number;
    documents: number;
    inventories: number;
    projects: number;
  };
}

export function useGetOrganizations() {
  const { getToken } = useAuth();

  const [organizations, setOrganizations] = useState<{
    docs: Organization[];
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

  // Define fetchOrganizations as a useCallback so it can be referenced elsewhere
  const fetchOrganizations = useCallback(async () => {
    setLoading(true);
    try {
      const token = await getToken();
      if (!token) {
        console.error("No authentication token available");
        return;
      }

      // Build query parameters
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

      const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_API_URL}/organizations?${queryParams}`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error("Failed to fetch organizations");
      }

      const data = await response.json();
      console.log("Get organizations data", data);

      // Handle the response from the API (nested structure: data.data.data)
      if (data.success && data.data?.success) {
        const organizationsArray = Array.isArray(data.data.data) ? data.data.data : [];
        console.log("Organizations array:", organizationsArray);

        setOrganizations({
          docs: organizationsArray,
          totalDocuments: organizationsArray.length,
          totalPagesCount: Math.ceil(organizationsArray.length / limit),
        });
      } else {
        throw new Error(data.message || data.data?.message || "Failed to fetch organizations");
      }
    } catch (error) {
      console.error("Error fetching organizations:", error);

      // Use mock data for development/fallback
      const mockOrganizations = [
        {
          id: "1",
          name: "Osiris Platform",
          createdAt: "2023-01-01T00:00:00.000Z",
          updatedAt: "2023-01-01T00:00:00.000Z",
          _count: {
            userOrganizations: 5,
            assets: 12,
            categories: 3,
            customers: 8,
            documents: 15,
            inventories: 25,
            projects: 4,
          },
        },
        {
          id: "2",
          name: "Acme Corporation",
          createdAt: "2023-02-01T00:00:00.000Z",
          updatedAt: "2023-02-01T00:00:00.000Z",
          _count: {
            userOrganizations: 12,
            assets: 45,
            categories: 8,
            customers: 23,
            documents: 67,
            inventories: 89,
            projects: 12,
          },
        },
        {
          id: "3",
          name: "TechStart Inc",
          createdAt: "2023-03-01T00:00:00.000Z",
          updatedAt: "2023-03-01T00:00:00.000Z",
          _count: {
            userOrganizations: 8,
            assets: 23,
            categories: 5,
            customers: 15,
            documents: 34,
            inventories: 56,
            projects: 7,
          },
        },
      ];

      setOrganizations({
        docs: mockOrganizations.slice((page - 1) * limit, page * limit),
        totalDocuments: mockOrganizations.length,
        totalPagesCount: Math.ceil(mockOrganizations.length / limit),
      });
    } finally {
      setLoading(false);
    }
  }, [page, limit, search, filters, getToken]);

  // Use fetchOrganizations in useEffect
  useEffect(() => {
    fetchOrganizations();
  }, [fetchOrganizations]);

  // Add the refreshOrganizations function that can be called to manually refresh data
  const refreshOrganizations = () => {
    fetchOrganizations();
  };

  return {
    organizations,
    loading,
    page,
    limit,
    search,
    filters,
    setPage,
    setLimit,
    setSearch,
    setFilters,
    refreshOrganizations,
  };
}
