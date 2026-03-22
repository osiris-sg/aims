import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "@clerk/nextjs";
import { request } from "@/helpers/request";

export interface LineItem {
  description: string;
  quantity: number | null;
  unit_price: number | null;
  discount: number | null;
  tax: number | null;
  gross: number | null;
  is_reference_line: boolean;
  asset_match: {
    key: string;
    name: string;
    sku: string;
    category: string;
    exists_in_db: boolean;
    needs_sku: boolean;
  } | null;
  confidence: "high" | "medium" | "low" | null;
  match_reason: string;
  location: string | null;
  needs_sku?: boolean;
}

export interface Invoice {
  invoice_number: string;
  date: string;
  customer: string;
  customer_matched: boolean;
  status: string;
  source: string;
  gross: number;
  balance: number;
  line_items: LineItem[];
  project_location: string | null;
  review_status: "pending" | "confirmed" | "skipped";
  confirmed_line_items?: LineItem[];
  confirmed_project_location?: string;
  skip_reason?: string;
}

export interface Stats {
  total: number;
  pending: number;
  confirmed: number;
  skipped: number;
  summary: {
    total_invoices: number;
    total_line_items: number;
    reference_lines: number;
    product_lines: number;
    matched_high_confidence: number;
    matched_medium_confidence: number;
    matched_low_confidence: number;
    unmatched: number;
    match_rate: string;
    auto_confirmable: string;
  };
}

export interface Asset {
  id: string;
  name: string;
  skuKey: string;
  categoryId: string;
  category?: { name: string };
  price: number | null;
  uom: string;
  isTracked: boolean;
}

export interface Customer {
  id: string;
  name: string;
  customerCode: string;
}

export interface Project {
  id: string;
  name: string;
  status: string;
  siteOfficeId?: string;
}

export interface Category {
  id: string;
  name: string;
}

export interface SiteOffice {
  id: string;
  name: string;
  address?: string;
}

export function useImportData() {
  const { getToken } = useAuth();
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("pending");
  const [confidenceFilter, setConfidenceFilter] = useState<string>("");
  const [page, setPage] = useState(1);
  const [totalInvoices, setTotalInvoices] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState("");

  const fetchStats = useCallback(async () => {
    const token = await getTokenRef.current();
    if (!token) return;
    const res = await request({ path: "/import/stats", method: "GET" }, {}, token);
    if (res.success) {
      setStats(res.data);
    } else {
      console.error("Failed to fetch stats:", res);
    }
  }, []);

  const fetchInvoices = useCallback(async () => {
    setLoading(true);
    const token = await getTokenRef.current();
    if (!token) return;

    let apiPath = "/import/invoices";
    const params: string[] = [];
    if (statusFilter) params.push(`status=${statusFilter}`);
    if (confidenceFilter) params.push(`confidence=${confidenceFilter}`);
    if (search) params.push(`search=${encodeURIComponent(search)}`);
    params.push(`page=${page}`);
    params.push(`limit=20`);
    if (params.length) apiPath += `?${params.join("&")}`;

    try {
      const res = await request({ path: apiPath, method: "GET" }, {}, token);
      console.log("Invoices response:", res);
      if (res.success) {
        setInvoices(res.data.invoices || []);
        setTotalInvoices(res.data.total || 0);
        setTotalPages(res.data.totalPages || 1);
      } else {
        console.error("Failed to fetch invoices:", res);
        setInvoices([]);
      }
    } catch (err) {
      console.error("Error fetching invoices:", err);
      setInvoices([]);
    }
    setLoading(false);
  }, [getToken, statusFilter, confidenceFilter, page, search]);

  const fetchAssets = useCallback(async () => {
    const token = await getTokenRef.current();
    if (!token) return;
    const res = await request({ path: "/import/assets", method: "GET" }, {}, token);
    if (res.success) setAssets(res.data || []);
  }, []);

  const fetchCustomers = useCallback(async () => {
    const token = await getTokenRef.current();
    if (!token) return;
    const res = await request({ path: "/import/customers", method: "GET" }, {}, token);
    if (res.success) setCustomers(res.data || []);
  }, []);

  const fetchProjects = useCallback(async () => {
    const token = await getTokenRef.current();
    if (!token) return;
    const res = await request({ path: "/import/projects", method: "GET" }, {}, token);
    if (res.success) setProjects(res.data || []);
  }, []);

  const fetchCategories = useCallback(async () => {
    const token = await getTokenRef.current();
    if (!token) return;
    const res = await request({ path: "/import/categories", method: "GET" }, {}, token);
    if (res.success) setCategories(res.data || []);
  }, []);

  const confirmInvoice = useCallback(
    async (invoiceNumber: string, lineItems: any[], projectLocation: string) => {
      const token = await getTokenRef.current();
      if (!token) return false;
      const res = await request(
        { path: "/import/confirm", method: "POST" },
        { invoiceNumber, lineItems, projectLocation },
        token
      );
      if (res.success) {
        await fetchStats();
        return true;
      }
      return false;
    },
    [fetchStats]
  );

  const skipInvoice = useCallback(
    async (invoiceNumber: string, reason: string) => {
      const token = await getTokenRef.current();
      if (!token) return false;
      const res = await request(
        { path: "/import/skip", method: "POST" },
        { invoiceNumber, reason },
        token
      );
      if (res.success) {
        await fetchStats();
        return true;
      }
      return false;
    },
    [fetchStats]
  );

  const bulkConfirm = useCallback(
    async (invoiceNumbers: string[]) => {
      const token = await getTokenRef.current();
      if (!token) return null;
      const res = await request(
        { path: "/import/bulk-confirm", method: "POST" },
        { invoiceNumbers },
        token
      );
      if (res.success) {
        await fetchStats();
        await fetchInvoices();
        return res.data;
      }
      return null;
    },
    [fetchStats, fetchInvoices]
  );

  const importSingleInvoice = useCallback(
    async (data: any) => {
      const token = await getTokenRef.current();
      if (!token) return null;
      const res = await request({ path: "/import/import-single", method: "POST" }, data, token);
      if (res.success) return res.data;
      return null;
    },
    []
  );

  const runImport = useCallback(async () => {
    const token = await getTokenRef.current();
    if (!token) return null;
    const res = await request({ path: "/import/run-import", method: "POST" }, {}, token);
    if (res.success) {
      await fetchStats();
      return res.data;
    }
    return null;
  }, [fetchStats]);

  const createAsset = useCallback(
    async (data: {
      name: string;
      skuKey: string;
      categoryId?: string;
      categoryName?: string;
      price?: number;
      uom: string;
      isTracked: boolean;
      description?: string;
      minQuantity?: number;
    }) => {
      const token = await getTokenRef.current();
      if (!token) return null;
      const res = await request({ path: "/import/create-asset", method: "POST" }, data, token);
      if (res.success) {
        await fetchAssets();
        await fetchCategories();
        return res.data;
      }
      return null;
    },
    [fetchAssets, fetchCategories]
  );

  const fetchSiteOffices = useCallback(
    async (customerId: string): Promise<SiteOffice[]> => {
      const token = await getTokenRef.current();
      if (!token) return [];
      const res = await request({ path: `/import/site-offices/${customerId}`, method: "GET" }, {}, token);
      if (res.success) return res.data || [];
      return [];
    },
    []
  );

  const createSiteOffice = useCallback(
    async (data: { name: string; address?: string; customerId: string }) => {
      const token = await getTokenRef.current();
      if (!token) return null;
      const res = await request({ path: "/import/create-site-office", method: "POST" }, data, token);
      if (res.success) return res.data;
      return null;
    },
    []
  );

  const createProject = useCallback(
    async (data: { name: string; customerId: string; siteOfficeId?: string; startDate?: string; endDate?: string }) => {
      const token = await getTokenRef.current();
      if (!token) return null;
      const res = await request({ path: "/import/create-project", method: "POST" }, data, token);
      if (res.success) {
        await fetchProjects();
        return res.data;
      }
      return null;
    },
    [fetchProjects]
  );

  // Load reference data once
  useEffect(() => {
    fetchStats();
    fetchAssets();
    fetchCustomers();
    fetchProjects();
    fetchCategories();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch invoices when filters change
  useEffect(() => {
    fetchInvoices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, confidenceFilter, page, search]);

  return {
    invoices,
    stats,
    assets,
    customers,
    projects,
    categories,
    loading,
    statusFilter,
    setStatusFilter,
    confidenceFilter,
    setConfidenceFilter,
    page,
    setPage,
    totalInvoices,
    totalPages,
    search,
    setSearch,
    confirmInvoice,
    skipInvoice,
    bulkConfirm,
    runImport,
    createAsset,
    refreshInvoices: fetchInvoices,
    refreshAssets: fetchAssets,
    refreshProjects: fetchProjects,
    fetchSiteOffices,
    createSiteOffice,
    createProject,
    importSingleInvoice,
  };
}
