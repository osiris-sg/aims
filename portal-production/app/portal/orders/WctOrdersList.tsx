"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { useOrganization } from "@hooks/useOrganization";
import { request } from "@/helpers/request";
import MainCard from "@/components/MainCard";
import PageTable from "@/components/PageTable";
import { Box, Chip, Tab, Tabs, Typography } from "@mui/material";
import moment from "moment";
import { toast } from "react-toastify";
import { ORDER_TABS, OrderTab, fmtJobWhen, jobCountsLine, orderMatchesSearch, orderMatchesTab, orderStatusColor, orderStatusLabel } from "@/helpers/wctOrders";

// WCT orders (enableWctOrders, 2026-11-01): one order per accepted quotation,
// each with its jobs. GET /orders returns the WCT shape for these orgs
// (jobCounts, nextJobAt, a status derived from the jobs). The row opens the order.
interface WctOrderRow {
  id: string;
  orderNumber: string;
  status: string;
  customer?: { id: string; name: string; customerCode: string | null } | null;
  sourceQuotation?: { id: string; name: string; status: string } | null;
  jobCounts?: { total: number; drafts: number; completed: number; cancelled: number };
  nextJobAt?: string | null;
  createdAt: string;
}

export default function WctOrdersList() {
  const router = useRouter();
  const { organization } = useOrganization();
  const { getToken } = useAuth();
  const [orders, setOrders] = useState<WctOrderRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<OrderTab>("all");
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

  const counts = useMemo(() => {
    const c = {} as Record<OrderTab, number>;
    for (const t of ORDER_TABS) c[t.key] = orders.filter((o) => orderMatchesTab(o, t.key)).length;
    return c;
  }, [orders]);

  const filtered = useMemo(() => orders.filter((o) => orderMatchesTab(o, tab) && orderMatchesSearch(o, search || "")), [orders, tab, search]);

  const columns: any[] = [
    {
      accessorKey: "orderNumber",
      header: "Order No.",
      size: 12,
      cell: ({ row }: any) => (
        <Typography variant="body2" sx={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
          {row.original.orderNumber}
        </Typography>
      ),
    },
    { accessorKey: "customer", header: "Customer", size: 16, cell: ({ row }: any) => row.original.customer?.name || "—" },
    { accessorKey: "sourceQuotation", header: "Quotation", size: 12, cell: ({ row }: any) => row.original.sourceQuotation?.name || "—" },
    { accessorKey: "jobs", header: "Jobs", size: 14, cell: ({ row }: any) => jobCountsLine(row.original.jobCounts) },
    { accessorKey: "nextJobAt", header: "Next job", size: 12, cell: ({ row }: any) => (row.original.nextJobAt ? fmtJobWhen(row.original.nextJobAt) : "—") },
    {
      accessorKey: "status",
      header: "Status",
      size: 9,
      cell: ({ row }: any) => <Chip size="small" label={orderStatusLabel(row.original.status)} color={orderStatusColor(row.original.status) as any} />,
    },
    { accessorKey: "createdAt", header: "Created", size: 9, cell: ({ row }: any) => moment(row.original.createdAt).format("DD/MM/YYYY") },
  ];

  return (
    <MainCard>
      <Box sx={{ borderBottom: 1, borderColor: "divider", mb: 2 }}>
        <Tabs value={tab} onChange={(_, v) => { setTab(v as OrderTab); setPage(1); }} variant="scrollable" scrollButtons="auto" allowScrollButtonsMobile>
          {ORDER_TABS.map((t) => (
            <Tab key={t.key} value={t.key} label={`${t.label} (${counts[t.key] ?? 0})`} sx={{ textTransform: "none", minHeight: 48 }} />
          ))}
        </Tabs>
      </Box>
      <PageTable
        onRowClick={(r: any) => router.push(`/portal/orders/${r.id}`)}
        rowHref={(r: any) => `/portal/orders/${r.id}`}
        columns={columns}
        data={filtered}
        tableName="Orders"
        subTitle="One order per accepted quotation. Open an order to see its jobs or add one."
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
