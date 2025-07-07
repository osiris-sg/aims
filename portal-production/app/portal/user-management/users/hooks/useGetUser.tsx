import { useState, useEffect, useCallback } from "react";
import { request } from "@/helpers/request";
import { useAuth } from "@clerk/nextjs";
import { useOrganization } from "@hooks/useOrganization";

export function useGetUsers() {
  const { getToken } = useAuth();

  interface Role {
    id: string;
    name: string;
    description: string;
    permissions: {
      id: string;
      name: string;
      description: string;
      resource: string;
      action: string;
    }[];
  }

  interface User {
    id: string;
    email: string;
    name: string;
    roles: Role[];
    createdAt: string;
    updatedAt: string;
  }

  const [users, setUsers] = useState<{
    docs: User[];
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

  // Define fetchUsers as a useCallback so it can be referenced elsewhere
  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const token = await getToken();
      if (!token) return;

      console.log("Fetching users with params:", { page, limit, search, filters });

      const response = await request(
        {
          method: "POST",
          path: "/users/list",
        },
        {
          page,
          limit,
          search,
          filters,
        },
        token
      );

      if (!response.success) {
        console.error("Failed to fetch users:", response);
        throw new Error(`Failed to fetch users: ${response.message}`);
      }

      console.log("Received users data:", response);
      setUsers({
        docs: response.data?.users || [],
        totalDocuments: response.data?.totalDocuments || 0,
        totalPagesCount: response.data?.totalPagesCount || 0,
      });
    } catch (error) {
      console.error("Error fetching users:", error);
      setUsers({
        docs: [],
        totalDocuments: 0,
        totalPagesCount: 0,
      });
    } finally {
      setLoading(false);
    }
  }, [page, limit, search, filters]);

  // Use fetchUsers in useEffect
  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  // Add the refreshUsers function that can be called to manually refresh data
  const refreshUsers = () => {
    fetchUsers();
  };

  return {
    users,
    loading,
    page,
    limit,
    search,
    filters,
    setPage,
    setLimit,
    setSearch,
    setFilters,
    refreshUsers,
  };
}
