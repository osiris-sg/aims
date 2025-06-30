import { useState, useEffect, useCallback } from "react";
import { request } from "@/helpers/request";
import { useOrganization, useAuth } from "@clerk/nextjs";

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
          path: "/users",
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

// Mock data for development
const mockUsers = [
  {
    id: "1",
    email: "admin@example.com",
    name: "Admin User",
    roles: [
      {
        id: "1",
        name: "Superadmin",
        description: "Has all permissions",
        permissions: [
          { id: "1", name: "roles:create", description: "Can create roles", resource: "roles", action: "create" },
          { id: "2", name: "roles:read", description: "Can read roles", resource: "roles", action: "read" },
        ],
      },
    ],
    createdAt: "2023-01-01T00:00:00.000Z",
    updatedAt: "2023-01-01T00:00:00.000Z",
  },
  {
    id: "2",
    email: "editor@example.com",
    name: "Editor User",
    roles: [
      {
        id: "3",
        name: "Editor",
        description: "Can edit content",
        permissions: [
          { id: "12", name: "assets:read", description: "Can read assets", resource: "assets", action: "read" },
          { id: "14", name: "assets:update", description: "Can update assets", resource: "assets", action: "update" },
        ],
      },
    ],
    createdAt: "2023-01-02T00:00:00.000Z",
    updatedAt: "2023-01-02T00:00:00.000Z",
  },
  {
    id: "3",
    email: "user@example.com",
    name: "Regular User",
    roles: [
      {
        id: "4",
        name: "User",
        description: "Regular user with limited permissions",
        permissions: [{ id: "12", name: "assets:read", description: "Can read assets", resource: "assets", action: "read" }],
      },
    ],
    createdAt: "2023-01-03T00:00:00.000Z",
    updatedAt: "2023-01-03T00:00:00.000Z",
  },
];
