import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@clerk/nextjs";

export function useGetDocuments() {
  const { getToken } = useAuth();

  const [documents, setDocuments] = useState({
    docs: [],
    totalDocuments: 0,
    totalPagesCount: 0,
  });

  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState({ type: "", organization: "" });

  const fetchDocuments = useCallback(async () => {
    setLoading(true);
    try {
      const token = await getToken();
      if (!token) return;

      const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_API_URL}/admin/documents`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) throw new Error("Failed to fetch documents");

      const data = await response.json();
      let documentsArray = Array.isArray(data) ? data : [];

      // Apply filtering and pagination
      let filtered = documentsArray;
      if (search) {
        filtered = filtered.filter((doc: any) => doc.type?.toLowerCase().includes(search.toLowerCase()) || doc.organization?.name?.toLowerCase().includes(search.toLowerCase()));
      }

      const totalDocuments = filtered.length;
      const totalPagesCount = Math.ceil(totalDocuments / limit);
      const paginatedDocs = filtered.slice((page - 1) * limit, page * limit);

      setDocuments({
        docs: paginatedDocs,
        totalDocuments,
        totalPagesCount,
      });
    } catch (error) {
      console.error("Error fetching admin documents:", error);
    } finally {
      setLoading(false);
    }
  }, [page, limit, search, filters, getToken]);

  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

  return {
    documents,
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
