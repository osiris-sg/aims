import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@clerk/nextjs";

interface Project {
  id: string;
  name: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  organization: {
    id: string;
    name: string;
  };
  [key: string]: any; // Allow for additional properties
}

export function useGetProjects() {
  const { getToken } = useAuth();

  const [projects, setProjects] = useState<{
    docs: Project[];
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
  const [filters, setFilters] = useState({ status: "", organization: "" });

  const fetchProjects = useCallback(async () => {
    setLoading(true);
    try {
      const token = await getToken();
      if (!token) return;

      const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_API_URL}/admin/projects`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) throw new Error("Failed to fetch projects");

      const data = await response.json();

      // Backend wraps every response via CustomResponseInterceptor as
      // { success, data, message }. Accept both that shape and a bare array
      // — same pattern as admin/assets, admin/inventory, admin/customers.
      let projectsArray: Project[] = [];
      if (Array.isArray(data)) {
        projectsArray = data;
      } else if (data && data.success && Array.isArray(data.data)) {
        projectsArray = data.data;
      } else {
        console.error("Unexpected response format:", data);
        throw new Error(`Invalid response format from admin projects endpoint. Got: ${JSON.stringify(data)}`);
      }

      // Apply filtering and pagination
      let filtered = projectsArray;
      if (search) {
        filtered = filtered.filter((project: Project) => project.name?.toLowerCase().includes(search.toLowerCase()) || project.organization?.name?.toLowerCase().includes(search.toLowerCase()));
      }

      const totalDocuments = filtered.length;
      const totalPagesCount = Math.ceil(totalDocuments / limit);
      const paginatedProjects = filtered.slice((page - 1) * limit, page * limit);

      setProjects({
        docs: paginatedProjects,
        totalDocuments,
        totalPagesCount,
      });
    } catch (error) {
      console.error("Error fetching admin projects:", error);
    } finally {
      setLoading(false);
    }
  }, [page, limit, search, filters, getToken]);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  return {
    projects,
    loading,
    page,
    limit,
    search,
    filters,
    setPage,
    setLimit,
    setSearch,
    setFilters,
  };
}
