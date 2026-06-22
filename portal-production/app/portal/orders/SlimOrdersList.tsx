"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { useOrganization } from "@hooks/useOrganization";
import { request } from "@/helpers/request";
import MainCard from "@/components/MainCard";
import PageTable from "@/components/PageTable";
import { Box, Chip, IconButton, Tab, Tabs, Typography } from "@mui/material";
import VisibilityIcon from "@mui/icons-material/Visibility";
import moment from "moment";
import { toast } from "react-toastify";
import {
  qoStage,
  doStage,
  invoiceStage,
  type DoStage,
  type InvoiceStage,
} from "./stages";

// Row shape relevant to the slim board. Post C-pre, list() enriches
// linkedDocuments[].status and includes sourceQuotation.project.
interface SlimLinkedDocEntry {
  id?: string;
  name?: string;
  status?: string | null;
  itemIds?: number[];
}
interface SlimOrderRow {
  id: string;
  orderNumber: string;
  status: string;
  customerId: string | null;
  customer?: { id: string; name: string; customerCode: string | null } | null;
  sourceQuotation?: {
    id: string;
    name: string;
    status: string;
    type: string;
    project?: { id: string; name: string } | null;
  } | null;
  items: any[];
  linkedDocuments?: {
    po?: SlimLinkedDocEntry[];
    do?: SlimLinkedDocEntry[];
    invoice?: SlimLinkedDocEntry[];
    salesOrder?: SlimLinkedDocEntry[];
  };
  createdAt: string;
}

const statusColor = (status: string) => {
  const s = (status || "").toUpperCase();
  if (s === "DRAFT") return "default";
  if (s === "IN_PROGRESS") return "info";
  if (s === "COMPLETED") return "success";
  if (s === "CANCELLED") return "error";
  return "default";
};

// --- Pipeline filter tabs --------------------------------------------------
type TabKey =
  | "all"
  | "qo_confirmed"
  | "do_draft"
  | "do_confirmed"
  | "do_delivered"
  | "do_installed"
  | "inv_draft"
  | "inv_confirmed";

const TABS: { key: TabKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "qo_confirmed", label: "QO Confirmed" },
  { key: "do_draft", label: "DO: Draft" },
  { key: "do_confirmed", label: "DO: Confirmed" },
  { key: "do_delivered", label: "DO: Delivered" },
  { key: "do_installed", label: "DO: Installed" },
  { key: "inv_draft", label: "Invoice: Draft" },
  { key: "inv_confirmed", label: "Invoice: Confirmed" },
];

// Distinct DO / invoice sub-stages present across ALL of an order's linked
// docs (order-level aggregation — matches if ANY entry derives to the stage).
const doStagesOf = (o: SlimOrderRow): DoStage[] =>
  (o.linkedDocuments?.do ?? []).map((e) => doStage(String(e?.status ?? "")));
const invStagesOf = (o: SlimOrderRow): InvoiceStage[] =>
  (o.linkedDocuments?.invoice ?? []).map((e) => invoiceStage(String(e?.status ?? "")));

function orderMatchesTab(o: SlimOrderRow, tab: TabKey): boolean {
  switch (tab) {
    case "all":
      return true;
    case "qo_confirmed":
      return qoStage(o.sourceQuotation ?? null) === "confirmed";
    case "do_draft":
      return doStagesOf(o).includes("draft");
    case "do_confirmed":
      return doStagesOf(o).includes("confirmed");
    case "do_delivered":
      return doStagesOf(o).includes("delivered");
    case "do_installed":
      return doStagesOf(o).includes("installed");
    case "inv_draft":
      return invStagesOf(o).includes("draft");
    case "inv_confirmed":
      return invStagesOf(o).includes("confirmed");
    default:
      return true;
  }
}

export default function SlimOrdersList() {
  const router = useRouter();
  const { organization } = useOrganization();
  const { getToken } = useAuth();
  const [orders, setOrders] = useState<SlimOrderRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>("all");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<any>({});

  const fetchOrders = useCallback(async () => {
    if (!organization?.id) return;
    setLoading(true);
    try {
      const token = await getToken();
      const res = await request({ path: "/orders", method: "GET" }, {}, token ?? undefined);
      setOrders(Array.isArray(res?.data) ? res.data : []);
    } catch (err) {
      console.error("Fetch orders failed:", err);
      toast.error("Failed to load orders");
    } finally {
      setLoading(false);
    }
  }, [organization?.id, getToken]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  // Per-tab counts over ALL orders (independent of search), for the badges.
  const tabCounts = useMemo(() => {
    const counts = {} as Record<TabKey, number>;
    for (const t of TABS) counts[t.key] = orders.filter((o) => orderMatchesTab(o, t.key)).length;
    return counts;
  }, [orders]);

  // Active tab filter, then a light search over order no / customer / project.
  const filtered = useMemo(() => {
    const term = (search || "").trim().toLowerCase();
    return orders
      .filter((o) => orderMatchesTab(o, activeTab))
      .filter((o) => {
        if (!term) return true;
        const hay = [
          o.orderNumber,
          o.customer?.name,
          o.customer?.customerCode,
          o.sourceQuotation?.name,
          o.sourceQuotation?.project?.name,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return hay.includes(term);
      });
  }, [orders, activeTab, search]);

  const changeTab = (k: TabKey) => {
    setActiveTab(k);
    setPage(1);
  };

  const columns: any[] = [
    {
      accessorKey: "orderNumber",
      header: "Order No.",
      size: 12,
      cell: ({ row }: any) => (
        <Typography variant="body2" sx={{ fontWeight: 500 }}>{row.original.orderNumber}</Typography>
      ),
    },
    {
      accessorKey: "customer",
      header: "Customer",
      size: 13,
      cell: ({ row }: any) => row.original.customer?.name || "—",
    },
    {
      accessorKey: "project",
      header: "Project",
      size: 13,
      cell: ({ row }: any) => row.original.sourceQuotation?.project?.name || "—",
    },
    {
      accessorKey: "sourceQuotation",
      header: "From Quotation",
      size: 13,
      cell: ({ row }: any) => row.original.sourceQuotation?.name || "—",
    },
    {
      accessorKey: "items",
      header: "Items",
      size: 6,
      cell: ({ row }: any) => (Array.isArray(row.original.items) ? row.original.items.length : 0),
    },
    {
      accessorKey: "status",
      header: "Status",
      size: 9,
      cell: ({ row }: any) => (
        <Chip
          size="small"
          label={(row.original.status || "DRAFT").replace(/_/g, " ")}
          color={statusColor(row.original.status) as any}
          sx={{ textTransform: "capitalize" }}
        />
      ),
    },
    {
      accessorKey: "createdAt",
      header: "Created",
      size: 9,
      cell: ({ row }: any) => moment(row.original.createdAt).format("DD/MM/YYYY"),
    },
    {
      accessorKey: "action",
      header: "Action",
      size: 5,
      cell: ({ row }: any) => (
        <IconButton
          onClick={() => router.push(`/portal/orders/${row.original.id}`)}
          sx={{ color: "text.secondary", "&:hover": { color: "primary.main" } }}
        >
          <VisibilityIcon />
        </IconButton>
      ),
    },
  ];

  return (
    <MainCard>
      <Box sx={{ borderBottom: 1, borderColor: "divider", mb: 2 }}>
        <Tabs
          value={activeTab}
          onChange={(_, v) => changeTab(v as TabKey)}
          variant="scrollable"
          scrollButtons="auto"
          allowScrollButtonsMobile
        >
          {TABS.map((t) => (
            <Tab
              key={t.key}
              value={t.key}
              label={`${t.label} (${tabCounts[t.key] ?? 0})`}
              sx={{ textTransform: "none", minHeight: 48 }}
            />
          ))}
        </Tabs>
      </Box>
      <PageTable
        columns={columns}
        data={filtered}
        tableName="Orders"
        subTitle="Pipeline board — filter by quotation / delivery / invoice stage."
        loading={loading}
        page={page}
        limit={limit}
        search={search}
        filters={filters}
        setPage={setPage}
        setLimit={setLimit}
        setSearch={setSearch}
        setFilters={setFilters}
        filterConfig={[]}
        pageCount={1}
        totalDocs={filtered.length}
      />
    </MainCard>
  );
}
