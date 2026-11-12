"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { useOrganization } from "@hooks/useOrganization";
import { request } from "@/helpers/request";
import MainCard from "@/components/MainCard";
import PageTable from "@/components/PageTable";
import { Box, Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, IconButton, ListItemText, Menu, MenuItem, TextField, Typography } from "@mui/material";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import StatusPill from "./_components/StatusPill";
import moment from "moment";
import { toast } from "react-toastify";
import { fmtJobWhen, orderMatchesSearch, orderStatusColor, orderStatusLabel } from "@/helpers/wctOrders";
import { HUB_ACTION_LABEL, HUB_DESTRUCTIVE, hubListTarget, hubMatchesTab, hubRowActions, hubStatusInfo, hubStatusSortValue, hubTabs, type HubActionKey, type HubContext, type HubStatus } from "@/helpers/wctOrderHub";
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
  // Orders hub (2026-11-13).
  subject?: string | null;
  site?: string | null;
  deliveryOrders?: { id: string; name: string | null; type: string; status: string; templateId: string }[];
  invoices?: { id: string; name: string | null; type: string; status: string; templateId: string; total: number }[];
  amount?: number | null;
  /** The earliest open DO's date (YYYY-MM-DD), else the next job's date is shown. */
  doDate?: string | null;
  actionJobs?: { draft: string | null; scheduled: string | null; completed: string | null };
  /** DO first: the DOs with no job the row actions work on. */
  actionDos?: { draft: string | null; open: string | null; completed: string | null; awaiting?: string | null };
  serviceReportReady?: boolean;
}

const docHref = (d?: { id: string; type?: string; templateId?: string | null } | null, fallbackType = "QUOTATION") => (d && d.templateId ? `/portal/documents/${d.type || fallbackType}/${d.templateId}/${d.id}` : null);
const hubContext = (o: WctOrderRow, manualFlow = false): HubContext => {
  const q: any = o.sourceQuotation;
  const draftInv = (o.invoices ?? []).find((i) => i.status === "draft" || i.status === "unconfirmed");
  return {
    orderId: o.id,
    quotationHref: q ? docHref({ id: q.id, type: q.type, templateId: q.documentTemplateId }) : null,
    doHref: docHref(o.deliveryOrders?.[0] ?? null, "DELIVERY_ORDER"),
    invoiceHref: docHref(draftInv ?? (o.invoices ?? []).slice(-1)[0] ?? null, "INVOICE"),
    draftJobId: o.actionJobs?.draft ?? null,
    scheduledJobId: o.actionJobs?.scheduled ?? null,
    completedJobId: o.actionJobs?.completed ?? null,
    manualFlow,
    openDoId: manualFlow ? o.actionDos?.draft ?? null : null,
    // The job-less DO waiting for the customer's signature on its DO link.
    awaitingDoId: manualFlow ? o.actionDos?.awaiting ?? null : null,
  };
};
/** Document numbers in a cell: the first two, then "+N more". */
function NumberList({ names }: { names: (string | null)[] }) {
  const list = names.filter(Boolean) as string[];
  if (!list.length) return null;
  return (
    <Box sx={{ whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
      {list.slice(0, 2).map((n) => (
        <div key={n}>{n}</div>
      ))}
      {list.length > 2 && (
        <Typography variant="caption" color="text.secondary">
          +{list.length - 2} more
        </Typography>
      )}
    </Box>
  );
}
const money = (n?: number | null) => (n == null ? "" : `S$ ${Number(n).toLocaleString("en-SG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

/** fixture: /preview/wct-jobs only (screenshots without sign-in); the page itself always fetches. */
export default function WctOrdersList({ fixture }: { fixture?: WctOrderRow[] } = {}) {
  const router = useRouter();
  const { organization } = useOrganization();
  const { getToken } = useAuth();
  const [orders, setOrders] = useState<WctOrderRow[]>(fixture ?? []);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<HubStatus | "all" | "untagged">("all");
  const [rowMenu, setRowMenu] = useState<{ pos: { left: number; top: number }; row: WctOrderRow } | null>(null);
  const [confirm, setConfirm] = useState<{ action: HubActionKey; row: WctOrderRow; jobId?: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const { isWctOrdersEnabled, isManualOrderFlowEnabled, features } = useOrganizationFeatures();
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

  // One tab per status, counted from the real statuses (the old "Open" tab missed DO drafts).
  const tabs = useMemo(() => hubTabs(orders), [orders]);

  const filtered = useMemo(
    () => (tab === "untagged" ? [] : orders.filter((o) => hubMatchesTab(o, tab) && (orderMatchesSearch(o, search || "") || [o.subject, o.site].some((v) => (v || "").toLowerCase().includes((search || "").trim().toLowerCase()))))),
    [orders, tab, search],
  );

  /** A row action: open its screen, or confirm a cancel first. */
  const runAction = (key: HubActionKey, row: WctOrderRow) => {
    setRowMenu(null);
    const t = hubListTarget(key, hubContext(row, !!isManualOrderFlowEnabled));
    if (!t) return;
    if ("href" in t) router.push(t.href);
    else if (t.dialog === "cancel-order" || t.dialog === "cancel-job") setConfirm({ action: key, row, jobId: t.jobId });
  };
  const doConfirm = async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      const token = await getToken();
      const path = confirm.action === "cancel-order" ? `/orders/${confirm.row.id}/cancel` : `/deliveries/${confirm.jobId}/cancel`;
      const res: any = await request({ path, method: "POST" }, {}, token ?? undefined);
      if (res?.success === false) throw new Error(res?.message || "Could not cancel");
      toast.success(confirm.action === "cancel-order" ? `Order ${confirm.row.orderNumber} cancelled` : "Job cancelled");
      setConfirm(null);
      await fetchOrders();
    } catch (e: any) {
      toast.error(e?.message || "Could not cancel");
    } finally {
      setBusy(false);
    }
  };
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

  // ADH-style list (2026-11-13): status pill first, the row menu last; the row opens the order.
  const plain = (v: any) => (v == null || v === "" ? "" : v);
  const columns: any[] = [
    {
      id: "status",
      accessorFn: (o: WctOrderRow) => hubStatusSortValue(o.status),
      header: "Status",
      size: 11,
      cell: ({ row }: any) => {
        const info = hubStatusInfo(row.original.status);
        return (
          <Box sx={{ "& .MuiChip-label": { whiteSpace: "nowrap", overflow: "visible" }, "& .MuiChip-root": { maxWidth: "none" } }}>
            <StatusPill label={orderStatusLabel(row.original.status) || info.label} color={orderStatusColor(row.original.status)} hue={info.hue} />
          </Box>
        );
      },
    },
    {
      accessorKey: "orderNumber",
      header: "Order no.",
      size: 10,
      cell: ({ row }: any) => (
        <Typography variant="body2" sx={{ fontWeight: 600, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
          {row.original.orderNumber}
        </Typography>
      ),
    },
    { id: "customer", accessorFn: (o: WctOrderRow) => o.customer?.name || "", header: "Customer", size: 13, cell: ({ row }: any) => plain(row.original.customer?.name) },
    {
      id: "subject",
      header: "Subject / site",
      size: 15,
      enableSorting: false,
      cell: ({ row }: any) => (
        <Box>
          {row.original.subject && <Typography variant="body2">{row.original.subject}</Typography>}
          {row.original.site && (
            <Typography variant="caption" color="text.secondary">
              {row.original.site}
            </Typography>
          )}
        </Box>
      ),
    },
    { id: "quotation", header: "Quotation", size: 9, enableSorting: false, cell: ({ row }: any) => plain(row.original.sourceQuotation?.name) },
    {
      id: "doDate",
      accessorFn: (o: WctOrderRow) => (o.doDate ? Date.parse(`${o.doDate}T00:00:00+08:00`) : o.nextJobAt ? new Date(o.nextJobAt).getTime() : Number.MAX_SAFE_INTEGER),
      header: "DO date",
      size: 9,
      cell: ({ row }: any) =>
        row.original.doDate ? (
          <Box sx={{ whiteSpace: "nowrap" }}>{moment(row.original.doDate, "YYYY-MM-DD").format("DD/MM/YYYY")}</Box>
        ) : row.original.nextJobAt ? (
          fmtJobWhen(row.original.nextJobAt, row.original.nextJobAllDay)
        ) : (
          ""
        ),
    },
    { id: "dos", header: "DO(s)", size: 9, enableSorting: false, cell: ({ row }: any) => <NumberList names={(row.original.deliveryOrders ?? []).map((d: any) => d.name)} /> },
    { id: "invoice", header: "Invoice", size: 9, enableSorting: false, cell: ({ row }: any) => <NumberList names={(row.original.invoices ?? []).map((d: any) => d.name)} /> },
    {
      id: "amount",
      accessorFn: (o: WctOrderRow) => o.amount ?? -1,
      header: "Amount",
      size: 9,
      cell: ({ row }: any) => <Box sx={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money(row.original.amount)}</Box>,
    },
    { id: "createdAt", accessorFn: (o: WctOrderRow) => new Date(o.createdAt).getTime(), header: "Created", size: 8, cell: ({ row }: any) => <Box sx={{ whiteSpace: "nowrap" }}>{moment(row.original.createdAt).format("DD/MM/YYYY")}</Box> },
    {
      id: "menu",
      header: "",
      size: 4,
      enableSorting: false,
      cell: ({ row }: any) => (
        <IconButton
          size="small"
          aria-label="Order actions"
          onClick={(e) => {
            e.stopPropagation();
            setRowMenu({ pos: { left: e.clientX, top: e.clientY }, row: row.original });
          }}
        >
          <MoreVertIcon fontSize="small" />
        </IconButton>
      ),
    },
  ];

  // Title + actions (PageTable's header) first, then the status tabs, then the table.
  // Status filter (2026-11-13): one dropdown with the count per status, replacing the tabs.
  const statusTabs = (
    <Box sx={{ mb: 2, display: "flex", alignItems: "center", gap: 2 }}>
      <TextField
        select
        size="small"
        label="Status"
        value={tab}
        onChange={(e) => {
          setTab(e.target.value as any);
          setPage(1);
        }}
        sx={{ minWidth: 260 }}
        data-tour="orders-status-filter"
      >
        {tabs.map((t) => (
          <MenuItem key={t.key} value={t.key}>
            {t.key === "all" ? "All statuses" : t.label} ({t.count})
          </MenuItem>
        ))}
        {calendarAdd && (
          <MenuItem value="untagged" data-tour="orders-untagged-jobs">
            Untagged jobs ({untaggedCount ?? 0})
          </MenuItem>
        )}
      </TextField>
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
        noSelectionColumn
      />

      {/* Row menu: anchored to the click position (table rows re-render). */}
      <Menu open={!!rowMenu} onClose={() => setRowMenu(null)} anchorReference="anchorPosition" anchorPosition={rowMenu?.pos}>
        {rowMenu &&
          hubRowActions(rowMenu.row.status, { doFirst: !!isManualOrderFlowEnabled })
            .filter((k) => !!hubListTarget(k, hubContext(rowMenu.row, !!isManualOrderFlowEnabled)))
            .map((k) => (
              <MenuItem key={k} onClick={() => runAction(k, rowMenu.row)} sx={HUB_DESTRUCTIVE.has(k) ? { color: "error.main" } : undefined}>
                <ListItemText>{HUB_ACTION_LABEL[k]}</ListItemText>
              </MenuItem>
            ))}
      </Menu>

      <Dialog open={!!confirm} onClose={() => !busy && setConfirm(null)} fullWidth maxWidth="xs">
        <DialogTitle>{confirm?.action === "cancel-order" ? `Cancel order ${confirm?.row.orderNumber}?` : "Cancel this job?"}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {confirm?.action === "cancel-order"
              ? "Its jobs are cancelled and their DOs are marked Cancelled. The numbers are kept. This can't be undone."
              : "The job is cancelled and its DO is marked Cancelled. The number is kept."}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirm(null)} disabled={busy}>
            Keep it
          </Button>
          <Button color="error" variant="contained" disableElevation onClick={doConfirm} disabled={busy}>
            {confirm?.action === "cancel-order" ? "Cancel order" : "Cancel job"}
          </Button>
        </DialogActions>
      </Dialog>
    </MainCard>
  );
}
