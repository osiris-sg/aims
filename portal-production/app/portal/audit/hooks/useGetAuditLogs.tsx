import { useState, useEffect, useCallback } from "react";
import { request } from "@/helpers/request";
import { useAuth } from "@clerk/nextjs";

export interface AuditLog {
  id: string;
  userId: string;
  userName?: string;
  userEmail?: string;
  action: string;
  resource: string;
  resourceId?: string;
  resourceName?: string;
  organizationId?: string;
  ipAddress?: string;
  status: "SUCCESS" | "FAILURE" | "PENDING";
  errorMessage?: string;
  createdAt: string;
}

export function useGetAuditLogs() {
  const { getToken } = useAuth();

  const [auditLogs, setAuditLogs] = useState<{
    logs: AuditLog[];
    total: number;
    page: number;
    limit: number;
  }>({
    logs: [],
    total: 0,
    page: 1,
    limit: 15,
  });

  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(15);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState({
    userId: "",
    action: "",
    resource: "",
    organizationId: "",
    createdOn: { startDate: null, endDate: null },
  });

  // Define fetchAuditLogs as a useCallback so it can be referenced elsewhere
  const fetchAuditLogs = useCallback(async () => {
    setLoading(true);
    try {
      const token = await getToken();
      if (!token) return;

      // Build query parameters
      const queryParams = new URLSearchParams({
        page: page.toString(),
        limit: limit.toString(),
      });

      if (filters.userId) queryParams.append("userId", filters.userId);
      if (filters.action) queryParams.append("action", filters.action);
      if (filters.resource) queryParams.append("resource", filters.resource);
      if (filters.organizationId) queryParams.append("organizationId", filters.organizationId);
      if (filters.createdOn.startDate) queryParams.append("startDate", filters.createdOn.startDate);
      if (filters.createdOn.endDate) queryParams.append("endDate", filters.createdOn.endDate);

      console.log("Fetching audit logs with params:", { page, limit, filters });

      const response = await request(
        {
          method: "GET",
          path: `/admin/audit/logs?${queryParams.toString()}`,
        },
        {},
        token
      );

      if (!response.success) {
        console.error("Failed to fetch audit logs:", response);
        throw new Error(`Failed to fetch audit logs: ${response.message}`);
      }

      setAuditLogs(response.data.data);
    } catch (error) {
      console.error("Error fetching audit logs:", error);
      setAuditLogs({
        logs: [],
        total: 0,
        page: 1,
        limit: 15,
      });
    } finally {
      setLoading(false);
    }
  }, [page, limit, filters]);

  // Use fetchAuditLogs in useEffect
  useEffect(() => {
    fetchAuditLogs();
  }, [fetchAuditLogs]);

  // Add the refreshAuditLogs function that can be called to manually refresh data
  const refreshAuditLogs = () => {
    fetchAuditLogs();
  };

  return {
    auditLogs,
    loading,
    page,
    limit,
    search,
    filters,
    setPage,
    setLimit,
    setSearch,
    setFilters,
    refreshAuditLogs,
  };
}
