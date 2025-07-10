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
    documentTemplates: number;
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
    createdOn: { startDate: null as string | null, endDate: null as string | null },
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

      // Use the admin API endpoint for cross-organization access
      const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_API_URL}/admin/organizations`, {
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
      console.log("Get admin organizations data", data);
      console.log("Data type:", typeof data);
      console.log("Is array:", Array.isArray(data));

      // Handle the response from the admin API
      let organizationsArray: Organization[] = [];

      if (Array.isArray(data)) {
        // Direct array response
        organizationsArray = data;
        console.log("Using direct array response");
      } else if (data && data.success && Array.isArray(data.data)) {
        // Wrapped response format
        organizationsArray = data.data;
        console.log("Using wrapped response format");
      } else if (data && Array.isArray(data.organizations)) {
        // Alternative wrapped format
        organizationsArray = data.organizations;
        console.log("Using alternative wrapped format");
      } else {
        console.error("Unexpected response format:", data);
        throw new Error(`Invalid response format from admin organizations endpoint. Got: ${JSON.stringify(data)}`);
      }

      console.log("Organizations array:", organizationsArray);

      // Apply client-side filtering and pagination since admin endpoint returns all
      let filteredOrganizations = organizationsArray;

      // Apply search filter
      if (search) {
        filteredOrganizations = filteredOrganizations.filter((org: any) => org.name.toLowerCase().includes(search.toLowerCase()) || org.id.toLowerCase().includes(search.toLowerCase()));
      }

      // Apply date filters
      if (filters.createdOn.startDate) {
        filteredOrganizations = filteredOrganizations.filter((org: any) => new Date(org.createdAt) >= new Date(filters.createdOn.startDate!));
      }
      if (filters.createdOn.endDate) {
        filteredOrganizations = filteredOrganizations.filter((org: any) => new Date(org.createdAt) <= new Date(filters.createdOn.endDate!));
      }

      // Apply pagination
      const totalDocuments = filteredOrganizations.length;
      const totalPagesCount = Math.ceil(totalDocuments / limit);
      const startIndex = (page - 1) * limit;
      const endIndex = startIndex + limit;
      const paginatedOrganizations = filteredOrganizations.slice(startIndex, endIndex);

      setOrganizations({
        docs: paginatedOrganizations,
        totalDocuments,
        totalPagesCount,
      });
    } catch (error) {
      console.error("Error fetching admin organizations:", error);
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
