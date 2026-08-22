import { useState, useEffect, useCallback } from "react";
import { request } from "@/helpers/request";
import { useAuth } from "@clerk/nextjs";

export interface ActionLogRow {
  id: string;
  actorType: "USER" | "API_KEY" | "GUEST" | "SYSTEM";
  actorId: string;
  actorName?: string;
  actorEmail?: string;
  organizationId?: string;
  homeOrgId?: string;
  channel?: string;
  method?: string;
  path?: string;
  action: string;
  resource: string;
  resourceId?: string;
  statusCode?: number;
  durationMs?: number;
  ipAddress?: string;
  userAgent?: string;
  details?: any;
  status: "SUCCESS" | "FAILURE";
  createdAt: string;
}

export function useGetActionLogs() {
  const { getToken } = useAuth();

  const [data, setData] = useState<{ logs: ActionLogRow[]; total: number; page: number; limit: number }>({
    logs: [],
    total: 0,
    page: 1,
    limit: 25,
  });
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<any>({
    actorType: "",
    action: "",
    resource: "",
    status: "",
    createdOn: { startDate: null, endDate: null },
  });

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const token = await getToken();
      if (!token) return;

      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (search) params.append("search", search);
      if (filters.actorType) params.append("actorType", filters.actorType);
      if (filters.action) params.append("action", filters.action);
      if (filters.resource) params.append("resource", filters.resource);
      if (filters.status) params.append("status", filters.status);
      if (filters.createdOn?.startDate) params.append("startDate", filters.createdOn.startDate);
      if (filters.createdOn?.endDate) params.append("endDate", filters.createdOn.endDate);

      const response = await request({ method: "GET", path: `/action-log?${params.toString()}` }, {}, token);
      if (!response.success) throw new Error(response.message || "Failed to fetch activity log");
      // Controller returns {logs,total,page,limit}; global envelope wraps it in data.
      setData(response.data);
    } catch (e) {
      console.error("Error fetching activity log:", e);
      setData({ logs: [], total: 0, page: 1, limit: 25 });
    } finally {
      setLoading(false);
    }
  }, [page, limit, search, filters, getToken]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  return { data, loading, page, limit, search, filters, setPage, setLimit, setSearch, setFilters, refresh: fetchLogs };
}
