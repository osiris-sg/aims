import { useState, useEffect, useCallback, useMemo } from "react";
import { request } from "@/helpers/request";
import { useAuth } from "@clerk/nextjs";
import { sortRows } from "@/components/clientSort";

export function useGetUsers(sorting: { id: string; desc: boolean }[] = []) {
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

    // Sort the WHOLE filtered list before slicing so header sorting reorders
    // across pages (the table is in manualSorting mode). Getters mirror what
    // the columns display for computed cells.
    const sorted = sortRows(filtered, sorting, {
      userId: (u: any) => {
        const c = u.clerkUser;
        const email = c?.emailAddresses?.[0]?.emailAddress;
        return (c?.firstName && c?.lastName ? `${c.firstName} ${c.lastName}` : c?.firstName || c?.lastName || email || u.userId) ?? "";
      },
      roles: (u: any) => (Array.isArray(u.roles) ? u.roles.map((r: any) => r?.name).filter(Boolean).join(", ") : ""),
      permissions: (u: any) => {
        const perms = Array.isArray(u.permissions) ? u.permissions : [];
        return perms.filter((p: any, i: number, self: any[]) => i === self.findIndex((q: any) => q.id === p.id)).length;
      },
      organization: (u: any) => u.organization?.name || u.organizationId || "",
    });

    const totalDocuments = sorted.length;
    const totalPagesCount = Math.max(1, Math.ceil(totalDocuments / limit));
    const start = (page - 1) * limit;
    const docs = sorted.slice(start, start + limit);

    return { docs, totalDocuments, totalPagesCount };
  }, [allUsers, search, filters, page, limit, sorting]);

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
