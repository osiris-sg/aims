"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { useOrganization } from "@hooks/useOrganization";
import { request } from "@/helpers/request";
import MainCard from "@/components/MainCard";
import PageTable from "@/components/PageTable";
import { Box, Tab, Tabs, Typography } from "@mui/material";
import StatusPill from "./_components/StatusPill";
import moment from "moment";
import { toast } from "react-toastify";
import { ORDER_TABS, OrderTab, fmtJobWhen, jobCountsLine, orderMatchesSearch, orderMatchesTab, orderStatusColor, orderStatusLabel } from "@/helpers/wctOrders";
import { useOrganizationFeatures } from "@/app/portal/hooks/useOrganizationFeatures";

// WCT calendar add (2026-11-04): jobs made from the calendar with no order yet, so nothing gets forgotten.
interface UntaggedJob {
  id: string;
  deliveryNumber: number;
  scheduledFor: string | null;
  scheduledAllDay?: boolean;
  customer: { id: string; name: string } | null;
  site: string | null;
  worker: string | null;
  state: string;
}

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
  /** The next job is all-day (2026-11-10): shown as its date only. */
  nextJobAllDay?: boolean;
  createdAt: string;
}

/** fixture: /preview/wct-jobs only (screenshots without sign-in); the page itself always fetches. */
export default function WctOrdersList({ fixture }: { fixture?: WctOrderRow[] } = {}) {
  const router = useRouter();
  const { organization } = useOrganization();
  const { getToken } = useAuth();
  const [orders, setOrders] = useState<WctOrderRow[]>(fixture ?? []);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<OrderTab | "untagged">("all");
  const { isWctOrdersEnabled, features } = useOrganizationFeatures();
  const calendarAdd = !fixture && !!isWctOrdersEnabled && !!features?.enableJobsCalendar;
  const [untagged, setUntagged] = useState<UntaggedJob[]>([]);
  const [untaggedCount, setUntaggedCount] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<any>({});

  const fetchOrders = useCallback(async () => {
    if (fixture || !organization?.id) return;
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
  }, [organization?.id, getToken, fixture]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  useEffect(() => {
    if (!calendarAdd || !organization?.id) return;
    (async () => {
      const token = await getToken();
      const res: any = await request({ path: "/deliveries/order-jobs?untagged=1&limit=100", method: "GET" }, {}, token ?? undefined);
      const d = res?.data ?? res;
      if (res?.success === false) return;
      setUntagged(Array.isArray(d?.docs) ? d.docs : []);
      setUntaggedCount(typeof d?.counts?.untagged === "number" ? d.counts.untagged : (d?.docs?.length ?? 0));
    })();
  }, [calendarAdd, organization?.id, getToken]);

  const counts = useMemo(() => {
    const c = {} as Record<OrderTab, number>;
    for (const t of ORDER_TABS) c[t.key] = orders.filter((o) => orderMatchesTab(o, t.key)).length;
    return c;
  }, [orders]);

  const filtered = useMemo(() => (tab === "untagged" ? [] : orders.filter((o) => orderMatchesTab(o, tab) && orderMatchesSearch(o, search || ""))), [orders, tab, search]);
  const untaggedRows = useMemo(() => {
    const term = (search || "").trim().toLowerCase();
    return untagged.filter((j) => !term || [String(j.deliveryNumber), j.customer?.name, j.site, j.worker].some((v) => (v || "").toLowerCase().includes(term)));
  }, [untagged, search]);
  const jobColumns: any[] = [
    { accessorKey: "deliveryNumber", header: "Job", size: 8, cell: ({ row }: any) => <Typography variant="body2" sx={{ fontWeight: 600 }}>#{row.original.deliveryNumber}</Typography> },
    { accessorKey: "scheduledFor", header: "When", size: 12, cell: ({ row }: any) => (row.original.scheduledFor ? fmtJobWhen(row.original.scheduledFor, row.original.scheduledAllDay) : "—") },
    { accessorKey: "customer", header: "Customer", size: 16, cell: ({ row }: any) => row.original.customer?.name || "—" },
    { accessorKey: "site", header: "Site", size: 18, cell: ({ row }: any) => row.original.site || "—" },
    { accessorKey: "worker", header: "Worker", size: 12, cell: ({ row }: any) => row.original.worker || "—" },
    { accessorKey: "state", header: "Status", size: 10, cell: ({ row }: any) => <StatusPill label={String(row.original.state).replace(/_/g, " ").replace(/^./, (c: string) => c.toUpperCase())} color="default" /> },
  ];

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
    { accessorKey: "customer", header: "Customer", size: 14, cell: ({ row }: any) => row.original.customer?.name || "—" },
    { accessorKey: "sourceQuotation", header: "Quotation", size: 12, cell: ({ row }: any) => row.original.sourceQuotation?.name || "—" },
    { accessorKey: "jobs", header: "Jobs", size: 14, cell: ({ row }: any) => jobCountsLine(row.original.jobCounts) },
    { accessorKey: "nextJobAt", header: "Next job", size: 12, cell: ({ row }: any) => (row.original.nextJobAt ? fmtJobWhen(row.original.nextJobAt, row.original.nextJobAllDay) : "—") },
    {
      accessorKey: "status",
      header: "Status",
      size: 12,
      cell: ({ row }: any) => <StatusPill label={orderStatusLabel(row.original.status)} color={orderStatusColor(row.original.status)} />,
    },
    { accessorKey: "createdAt", header: "Created", size: 9, cell: ({ row }: any) => moment(row.original.createdAt).format("DD/MM/YYYY") },
  ];

  // Title + actions (PageTable's header) first, then the status tabs, then the table.
  const statusTabs = (
      <Box sx={{ borderBottom: 1, borderColor: "divider", mb: 2 }}>
        <Tabs value={tab} onChange={(_, v) => { setTab(v as OrderTab); setPage(1); }} variant="scrollable" scrollButtons="auto" allowScrollButtonsMobile>
          {ORDER_TABS.map((t) => (
            <Tab key={t.key} value={t.key} label={`${t.label} (${counts[t.key] ?? 0})`} sx={{ textTransform: "none", minHeight: 48 }} />
          ))}
          {calendarAdd && <Tab value="untagged" label={`Untagged jobs (${untaggedCount ?? 0})`} sx={{ textTransform: "none", minHeight: 48 }} data-tour="orders-untagged-jobs" />}
        </Tabs>
      </Box>
  );

  return (
    <MainCard>
      <PageTable
        onRowClick={(r: any) => router.push(tab === "untagged" ? `/portal/deliveries/${r.id}` : `/portal/orders/${r.id}`)}
        rowHref={(r: any) => (tab === "untagged" ? `/portal/deliveries/${r.id}` : `/portal/orders/${r.id}`)}
        columns={tab === "untagged" ? jobColumns : columns}
        data={tab === "untagged" ? untaggedRows : filtered}
        tableName="Orders"
        subTitle={
          tab === "untagged"
            ? "Jobs added from the calendar with no quotation or order yet. Open one and use Link to… to put it under an order."
            : "One order per accepted quotation. Open an order to see its jobs or add one."
        }
        headerContent={statusTabs}
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
        totalDocs={tab === "untagged" ? untaggedRows.length : filtered.length}
      />
    </MainCard>
  );
}
