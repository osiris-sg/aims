"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { useOrganization } from "@hooks/useOrganization";
import { request } from "@/helpers/request";
import MainCard from "@/components/MainCard";
import PageTable from "@/components/PageTable";
import { Box, Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, IconButton, ListItemText, Menu, MenuItem, Stack, TextField, Tooltip, Typography, alpha, lighten } from "@mui/material";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import AddIcon from "@mui/icons-material/Add";
import StatusPill from "./_components/StatusPill";
import moment from "moment";
import { toast } from "react-toastify";
import { fmtJobWhen, orderMatchesSearch, orderStatusColor, orderStatusLabel } from "@/helpers/wctOrders";
import { HUB_ACTION_LABEL, HUB_DESTRUCTIVE, hubListTarget, hubMatchesTab, hubRowActions, hubStatusInfo, hubStatusSortValue, hubTabs, type HubActionKey, type HubContext, type HubStatus } from "@/helpers/wctOrderHub";
import { useOrganizationFeatures } from "@/app/portal/hooks/useOrganizationFeatures";
import { flowDocStatus, flowOrderStatus } from "@/helpers/wctStatusFlow";
import { DEFAULT_PAGE_SIZE } from "@/components/PageTable";
import { useUserPermissions } from "@/app/portal/hooks/useUserPermissions";
import { canAddCell, createInvoiceHref, LIST_ADD_LABEL, type ListAddAccess, type ListAddKind } from "@/helpers/orderListAdd";
import { ORDER_SOURCE_OPTIONS, defaultOrderSource, newestFirst, importedBilledPct, showBilledPctColumn, importedMatchesTab, importedStatusHue, importedTabs, isImportedTab, matchesOrderSource, type OrderSource } from "@/helpers/importedOrders";

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
  /** Imported from the old ERP (enableImportedOrders): read-only, no actions. */
  imported?: boolean;
  statusLabel?: string;
  erpDoNumbers?: string[];
  /** Imported orders (round 38): every DO number of the order (ERP DO numbers, linked DOs, AIMS DOs). */
  doNumbers?: string[];
  billedPct?: number | null;
  /** Round 38: which empty cells show a "+" (the order page's rules; api orders/order-list-add.ts). */
  add?: { quotation: boolean; do: boolean; invoice: boolean } | null;
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
// WCT group wording (enableWctStatusFlow, guru 2026-11-20): the row lists a delivery order only once it
// is Accepted and an invoice only once it has gone out (Awaiting Payment / Paid); a document that is still
// Draft or Pending leaves its cell empty. Each number carries its status in its own colour.
const FLOW_HUE: Record<string, string> = { Accepted: "#16a34a", Paid: "#16a34a", "Awaiting Payment": "#2563eb", "Partially Paid": "#7c3aed" };
function FlowDocList({ docs, type }: { docs: { id: string; name: string | null; status: string }[]; type: "DELIVERY_ORDER" | "INVOICE" }) {
  const shown = docs
    .map((d) => ({ d, f: flowDocStatus({ type, status: d.status, config: { savedAt: "1" } }) }))
    .filter(({ d, f }) => !!d.name && !!f && !!FLOW_HUE[f.label]);
  if (!shown.length) return null;
  return (
    <Stack spacing={0.5} data-testid={`order-row-${type === "INVOICE" ? "invoices" : "dos"}`}>
      {shown.slice(0, 2).map(({ d, f }) => (
        <Box key={d.id} sx={{ whiteSpace: "nowrap" }}>
          <Box sx={{ fontVariantNumeric: "tabular-nums", lineHeight: 1.3 }}>{d.name}</Box>
          <Box
            component="span"
            sx={(t) => ({
              display: "inline-block", px: 0.75, borderRadius: 999, fontSize: "0.68rem", fontWeight: 600, lineHeight: 1.6,
              bgcolor: alpha(FLOW_HUE[f!.label], t.palette.mode === "dark" ? 0.24 : 0.12),
              color: t.palette.mode === "dark" ? lighten(FLOW_HUE[f!.label], 0.45) : FLOW_HUE[f!.label],
            })}
          >
            {f!.label}
          </Box>
        </Box>
      ))}
      {shown.length > 2 && (
        <Typography variant="caption" color="text.secondary">
          +{shown.length - 2} more
        </Typography>
      )}
    </Stack>
  );
}
const money = (n?: number | null) => (n == null ? "" : `S$ ${Number(n).toLocaleString("en-SG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

/** fixture: /preview/wct-jobs only (screenshots without sign-in); the page itself always fetches. */
export default function WctOrdersList({ fixture }: { fixture?: WctOrderRow[] } = {}) {
  const router = useRouter();
  const { organization, isOsirisAdmin } = useOrganization();
  const { getToken } = useAuth();
  const { hasPermission, userRoles, isLoading: rolesLoading } = useUserPermissions();
  // Round 38: the "+" cells need the same permissions as the order page's calls (read-only people see none).
  const addAccess: ListAddAccess | null = fixture
    ? { admin: true, has: () => true }
    : rolesLoading
      ? null
      : { admin: !!isOsirisAdmin || userRoles.some((r) => ["superadmin", "osirisadmin"].includes(String(r.name).toLowerCase())), has: hasPermission };
  const [adding, setAdding] = useState<string | null>(null);
  const [orders, setOrders] = useState<WctOrderRow[]>(fixture ?? []);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<HubStatus | "all" | "untagged">("all");
  const [rowMenu, setRowMenu] = useState<{ pos: { left: number; top: number }; row: WctOrderRow } | null>(null);
  const [confirm, setConfirm] = useState<{ action: HubActionKey; row: WctOrderRow; jobId?: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const { isWctOrdersEnabled, isManualOrderFlowEnabled, isWctStatusFlowEnabled, features } = useOrganizationFeatures();
  const calendarAdd = !fixture && !!isWctOrdersEnabled && !!features?.enableJobsCalendar;
  const [untagged, setUntagged] = useState<UntaggedJob[]>([]);
  const [untaggedCount, setUntaggedCount] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(DEFAULT_PAGE_SIZE);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<any>({});
  // Orgs with imported orders (enableImportedOrders) open on "All orders", newest first; others on AIMS's own orders.
  const [pickedSource, setSource] = useState<OrderSource | null>(null);
  const source: OrderSource = pickedSource ?? defaultOrderSource(features);
  const hasImported = useMemo(() => orders.some((o) => o.imported === true), [orders]);
  const sourceRows = useMemo(() => newestFirst(hasImported ? orders.filter((o) => matchesOrderSource(o, source)) : orders), [orders, source, hasImported]);

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
  // Imported rows have their own statuses (Invoiced / Paid), listed after the AIMS ones.
  const tabs = useMemo(() => {
    const native = sourceRows.filter((o) => o.imported !== true);
    // WCT group wording (enableWctStatusFlow): an order is Pending or Completed (Cancelled when there is one).
    if (isWctStatusFlowEnabled && (native.length || source !== "imported")) {
      const n = (k: string) => native.filter((o) => flowOrderStatus(o).key === k).length;
      const flowTabs = [
        { key: "all" as const, label: "All", count: sourceRows.length },
        { key: "flow:pending", label: "Pending", count: n("pending") },
        { key: "flow:completed", label: "Completed", count: n("completed") },
        ...(n("cancelled") ? [{ key: "flow:cancelled", label: "Cancelled", count: n("cancelled") }] : []),
      ];
      return [...flowTabs, ...importedTabs(sourceRows)] as Array<{ key: any; label: string; count: number }>;
    }
    const own = native.length || source !== "imported" ? hubTabs(native).map((t) => (t.key === "all" ? { ...t, count: sourceRows.length } : t)) : [{ key: "all" as const, label: "All", count: sourceRows.length }];
    return [...own, ...importedTabs(sourceRows)] as Array<{ key: any; label: string; count: number }>;
  }, [sourceRows, source, isWctStatusFlowEnabled]);

  const filtered = useMemo(
    () => (tab === "untagged" ? [] : sourceRows.filter(
            (o) =>
              (o.imported
                ? importedMatchesTab(o, tab as string)
                : String(tab).startsWith("flow:")
                  ? `flow:${flowOrderStatus(o).key}` === tab
                  : !isImportedTab(tab as string) && hubMatchesTab(o, tab)) &&
              (orderMatchesSearch(o, search || "") || [o.subject, o.site].some((v) => (v || "").toLowerCase().includes((search || "").trim().toLowerCase()))),
          )),
    [sourceRows, tab, search],
  );

  /** Round 38: a "+" cell. Quotation / DO: made here, then their editor opens; Invoice: the order page's Create invoice. */
  const addFromList = async (kind: ListAddKind, row: WctOrderRow) => {
    if (kind === "invoice") {
      router.push(createInvoiceHref(row.id));
      return;
    }
    setAdding(`${kind}:${row.id}`);
    try {
      const token = await getToken();
      const path = kind === "quotation" ? `/orders/${row.id}/new-quotation` : `/deliveries/order/${row.id}/dos`;
      const res: any = await request({ path, method: "POST", ownError: true }, {}, token ?? undefined);
      if (res?.success === false) throw new Error(res?.message || "Could not add it");
      const out = res?.data ?? res;
      if (kind === "quotation") toast.success(`Quotation ${out?.name ?? ""} for ${row.orderNumber}`.replace(/\s+/g, " "));
      else if (out?.note) toast.info(`${out?.doName || "A draft DO"} added. ${out.note}`);
      else toast.success(`${out?.doName || "A draft DO"} added with what is still to deliver`);
      if (out?.href) router.push(out.href);
      else await fetchOrders();
    } catch (e: any) {
      toast.error(e?.message || "Could not add it");
    } finally {
      setAdding(null);
    }
  };
  /** The cell's content, or a small "+" when the cell is empty and the step is allowed. */
  const cellOrAdd = (row: WctOrderRow, kind: ListAddKind, content: React.ReactNode, empty: boolean) => {
    if (!empty || !canAddCell(row, kind, addAccess)) return content;
    const busyHere = adding === `${kind}:${row.id}`;
    return (
      <Tooltip title={LIST_ADD_LABEL[kind]}>
        <span>
          <IconButton
            size="small"
            aria-label={LIST_ADD_LABEL[kind]}
            disabled={!!adding}
            onClick={(e) => {
              e.stopPropagation();
              void addFromList(kind, row);
            }}
            sx={{ border: 1, borderColor: "divider", width: 24, height: 24, opacity: busyHere ? 0.5 : 1 }}
          >
            <AddIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </span>
      </Tooltip>
    );
  };

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
      const res: any = await request({ path, method: "POST", ownError: true }, {}, token ?? undefined);
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
        if (row.original.imported) return <StatusPill label={row.original.statusLabel || info.label} color="default" hue={importedStatusHue(row.original.status)} />;
        if (isWctStatusFlowEnabled) {
          const f = flowOrderStatus(row.original);
          // One colour per order status: amber while anything is left to do, green when done, red when cancelled.
          return <StatusPill label={f.label} color="default" hue={f.key === "completed" ? "#16a34a" : f.key === "cancelled" ? "#ef4444" : "#f59e0b"} />;
        }
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
    { id: "quotation", header: "Quotation", size: 9, enableSorting: false, cell: ({ row }: any) => cellOrAdd(row.original, "quotation", plain(row.original.sourceQuotation?.name), !row.original.sourceQuotation?.name) },
    // "DO date" column hidden for now (Elroy 16 Nov); the API still sends doDate.
    {
      id: "dos",
      header: "DO(s)",
      size: 9,
      enableSorting: false,
      cell: ({ row }: any) => {
        const names: (string | null)[] = row.original.imported ? row.original.doNumbers ?? row.original.erpDoNumbers ?? [] : (row.original.deliveryOrders ?? []).map((d: any) => d.name);
        // WCT group wording: a delivery order is listed once it is Accepted; the "+" only when the order has none at all.
        const shown = isWctStatusFlowEnabled && !row.original.imported ? <FlowDocList docs={row.original.deliveryOrders ?? []} type="DELIVERY_ORDER" /> : <NumberList names={names} />;
        return cellOrAdd(row.original, "do", shown, !names.some(Boolean));
      },
    },
    {
      id: "invoice",
      header: "Invoice",
      size: 9,
      enableSorting: false,
      cell: ({ row }: any) => {
        const names: (string | null)[] = (row.original.invoices ?? []).map((d: any) => d.name);
        // WCT group wording: an invoice is listed once it is Awaiting Payment or Paid.
        const shown = isWctStatusFlowEnabled && !row.original.imported ? <FlowDocList docs={row.original.invoices ?? []} type="INVOICE" /> : <NumberList names={names} />;
        return cellOrAdd(row.original, "invoice", shown, !names.some(Boolean));
      },
    },
    {
      id: "amount",
      accessorFn: (o: WctOrderRow) => o.amount ?? -1,
      header: "Amount",
      size: 9,
      cell: ({ row }: any) => <Box sx={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money(row.original.amount)}</Box>,
    },
    // Billed % (imported orders only): the column shows only with Imported or All orders selected; AIMS rows stay blank.
    ...(showBilledPctColumn(hasImported, source)
      ? [
          {
            id: "billedPct",
            accessorFn: (o: WctOrderRow) => (o.imported && o.billedPct != null ? o.billedPct : -1),
            header: "Billed %",
            size: 7,
            cell: ({ row }: any) => <Box sx={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{row.original.imported ? importedBilledPct(row.original.billedPct) : ""}</Box>,
          },
        ]
      : []),
    { id: "createdAt", accessorFn: (o: WctOrderRow) => new Date(o.createdAt).getTime(), header: "Created", size: 8, cell: ({ row }: any) => <Box sx={{ whiteSpace: "nowrap" }}>{moment(row.original.createdAt).format("DD/MM/YYYY")}</Box> },
    {
      id: "menu",
      header: "",
      size: 4,
      enableSorting: false,
      cell: ({ row }: any) =>
        row.original.imported ? null : (
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
      {hasImported && (
        <TextField
          select
          size="small"
          label="Orders"
          value={source}
          onChange={(e) => {
            setSource(e.target.value as OrderSource);
            setTab("all");
            setPage(1);
          }}
          sx={{ minWidth: 180 }}
          data-tour="orders-source-filter"
        >
          {ORDER_SOURCE_OPTIONS.map((o) => (
            <MenuItem key={o.key} value={o.key}>
              {o.label} ({orders.filter((r) => matchesOrderSource(r, o.key)).length})
            </MenuItem>
          ))}
        </TextField>
      )}
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
        subTitle={tab === "untagged" ? "Jobs added from the calendar with no quotation or order yet. Open one and use Link to… to put it under an order." : undefined}
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
        clientPaging
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
              ? confirm?.row.invoices?.length
                ? "Its jobs are cancelled, its DOs are marked Cancelled and its draft invoices Voided. The numbers are kept. This can't be undone."
                : "Its jobs are cancelled and their DOs are marked Cancelled. The numbers are kept. This can't be undone."
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
