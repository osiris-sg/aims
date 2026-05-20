import { useState, useEffect, useCallback, useMemo } from "react";
import { request } from "@/helpers/request";
import { useAuth } from "@clerk/nextjs";

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

  // Full list returned by the backend (which doesn't support search/pagination
  // for the admin endpoint). We filter + paginate client-side.
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState({
    createdOn: { startDate: null, endDate: null },
  });

  // Reset to first page whenever search or filters change.
  useEffect(() => {
    setPage(1);
  }, [search, filters]);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const token = await getToken();
      if (!token) return;

      const response = await request(
        {
          method: "GET",
          path: "/admin/users",
        },
        {},
        token
      );

      if (!response.success) {
        console.error("Failed to fetch users:", response);
        throw new Error(`Failed to fetch users: ${response.message}`);
      }

      setAllUsers(response.data?.data || response.data || []);
    } catch (error) {
      console.error("Error fetching users:", error);
      setAllUsers([]);
    } finally {
      setLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  // Client-side filter + paginate. Match across name, email, and role names.
  const users = useMemo(() => {
    const term = search.trim().toLowerCase();
    const matchesSearch = (u: any) => {
      if (!term) return true;
      const haystacks = [
        u.name,
        u.email,
        u.firstName,
        u.lastName,
        u.username,
        ...(Array.isArray(u.roles) ? u.roles.map((r: any) => r?.name) : []),
      ];
      return haystacks.some((v) => typeof v === "string" && v.toLowerCase().includes(term));
    };

    const matchesDateRange = (u: any) => {
      const { startDate, endDate } = filters.createdOn || {};
      if (!startDate && !endDate) return true;
      const created = u.createdAt ? new Date(u.createdAt).getTime() : NaN;
      if (Number.isNaN(created)) return true;
      if (startDate && created < new Date(startDate as any).getTime()) return false;
      if (endDate && created > new Date(endDate as any).getTime()) return false;
      return true;
    };

    const filtered = (allUsers || []).filter((u) => matchesSearch(u) && matchesDateRange(u));
    const totalDocuments = filtered.length;
    const totalPagesCount = Math.max(1, Math.ceil(totalDocuments / limit));
    const start = (page - 1) * limit;
    const docs = filtered.slice(start, start + limit);

    return { docs, totalDocuments, totalPagesCount };
  }, [allUsers, search, filters, page, limit]);

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
