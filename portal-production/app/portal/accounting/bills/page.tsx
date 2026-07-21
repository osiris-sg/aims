"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Box,
  Chip,
  IconButton,
  Paper,
  Stack,
  Tab,
  Tabs,
  Tooltip,
  Typography,
} from "@mui/material";
import CheckIcon from "@mui/icons-material/Check";
import ClearIcon from "@mui/icons-material/Clear";
import VisibilityIcon from "@mui/icons-material/Visibility";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import PaymentIcon from "@mui/icons-material/Payment";
import { toast } from "react-toastify";
import { useAccountingApi } from "../_lib/api";
import BillEditorDialog from "./_components/BillEditorDialog";
import RecordBillPaymentDialog from "./_components/RecordBillPaymentDialog";
import PageTable from "@/components/PageTable";

// Bills are stored in the Document table (type='BILL') — see bills.service.ts
// for the field mapping. The `Bill` shape here mirrors what the service's
// `toBill()` helper returns.
type Bill = {
  id: string;
  billNumber: string;
  billDate: string;
  dueDate?: string | null;
  status: "DRAFT" | "PENDING_APPROVAL" | "POSTED" | "PAID" | "VOID";
  totalAmount: number;
  taxAmount: number;
  subtotal: number;
  amountPaid: number;
  matchStatus?: string | null;
  inboundChannel?: string | null;
  supplier?: { id: string; name: string } | null;
  supplierId?: string | null;
};

const STATUS_COLOR: Record<string, "default" | "info" | "warning" | "success" | "error"> = {
  DRAFT: "default",
  PENDING_APPROVAL: "warning",
  POSTED: "info",
  PAID: "success",
  VOID: "error",
};

const fmt = (n: number) => (n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function BillsPage() {
  const { request } = useAccountingApi();
  const [items, setItems] = useState<Bill[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"all" | "DRAFT" | "PENDING_APPROVAL" | "POSTED" | "PAID" | "VOID">("all");

  // PageTable-driven state
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<any>({});

  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Bill | null>(null);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [payingBill, setPayingBill] = useState<Bill | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await request<Bill[]>("/bills");
      setItems(res || []);
    } catch (e: any) {
      toast.error(e?.message || "Failed to load bills");
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => { load(); }, [load]);

  const counts = useMemo(() => {
    const c = { all: items.length, DRAFT: 0, PENDING_APPROVAL: 0, POSTED: 0, PAID: 0, VOID: 0 };
    for (const b of items) (c as any)[b.status] = ((c as any)[b.status] ?? 0) + 1;
    return c;
  }, [items]);

  // Filter by tab + search before passing to PageTable. PageTable handles
  // slicing for pagination via its own page/limit props.
  const visible = useMemo(() => {
    let rows = tab === "all" ? items : items.filter((b) => b.status === tab);
    const q = (search || "").trim().toLowerCase();
    if (q) {
      rows = rows.filter(
        (b) =>
          b.billNumber.toLowerCase().includes(q) ||
          (b.supplier?.name || "").toLowerCase().includes(q) ||
          ((b as any).inboundChannel || "").toLowerCase().includes(q) ||
          (b.status || "").toLowerCase().includes(q),
      );
    }
    return rows;
  }, [items, tab, search]);

  // Reset to first page whenever the filtered set changes.
  useEffect(() => { setPage(1); }, [tab, search]);

  const totals = useMemo(() => {
    return visible.reduce(
      (s, b) => ({
        total: s.total + b.totalAmount,
        outstanding:
          s.outstanding + (b.status === "POSTED" ? Math.max(0, b.totalAmount - (b.amountPaid || 0)) : 0),
      }),
      { total: 0, outstanding: 0 },
    );
  }, [visible]);

  // PageTable expects a page of data, not the whole list — slice manually.
  const pageCount = Math.max(1, Math.ceil(visible.length / limit));
  const paged = useMemo(
    () => visible.slice((page - 1) * limit, page * limit),
    [visible, page, limit],
  );

  // ---------- Action handlers ----------
  const submitDraft = async (b: Bill) => {
    try { await request(`/bills/${b.id}/submit`, { method: "POST" }); toast.success("Submitted"); load(); }
    catch (e: any) { toast.error(e?.message || "Submit failed"); }
  };
  const approve = async (b: Bill) => {
    try { await request(`/bills/${b.id}/approve`, { method: "POST" }); toast.success("Approved + posted"); load(); }
    catch (e: any) { toast.error(e?.message || "Approve failed"); }
  };
  const reject = async (b: Bill) => {
    if (!confirm("Reject and send back to DRAFT?")) return;
    try { await request(`/bills/${b.id}/reject`, { method: "POST" }); toast.success("Rejected"); load(); }
    catch (e: any) { toast.error(e?.message || "Reject failed"); }
  };
  const voidIt = async (b: Bill) => {
    if (!confirm("Void this bill? Reversing JE will be created if it was posted.")) return;
    try { await request(`/bills/${b.id}`, { method: "DELETE" }); toast.success("Voided"); load(); }
    catch (e: any) { toast.error(e?.message || "Void failed"); }
  };

  // ---------- Column defs for PageTable (tanstack-react-table) ----------
  const columns = useMemo(() => [
    {
      accessorKey: "billNumber",
      header: "Bill #",
      cell: ({ row }: any) => {
        const b: Bill = row.original;
        return (
          <Box sx={{ fontFamily: "monospace", fontWeight: 600 }}>
            {b.billNumber}
            {b.matchStatus && b.matchStatus !== "MATCHED" && (
              <Tooltip title={`3-way match: ${b.matchStatus}`}>
                <Chip size="small" label="!" color="warning" sx={{ ml: 0.5, height: 14, fontSize: "0.55rem", "& .MuiChip-label": { px: 0.5 } }} />
              </Tooltip>
            )}
          </Box>
        );
      },
    },
    {
      accessorKey: "supplier",
      header: "Supplier",
      cell: ({ row }: any) => row.original.supplier?.name || "—",
    },
    {
      accessorKey: "billDate",
      header: "Bill date",
      cell: ({ row }: any) => new Date(row.original.billDate).toLocaleDateString(),
    },
    {
      accessorKey: "dueDate",
      header: "Due",
      cell: ({ row }: any) => row.original.dueDate ? new Date(row.original.dueDate).toLocaleDateString() : "—",
    },
    {
      accessorKey: "totalAmount",
      header: "Total",
      cell: ({ row }: any) => (
        <Box sx={{ textAlign: "right", fontFamily: "monospace" }}>{fmt(row.original.totalAmount)}</Box>
      ),
    },
    {
      accessorKey: "outstanding",
      header: "Outstanding",
      cell: ({ row }: any) => {
        const b: Bill = row.original;
        const outstanding = (b.status === "POSTED" || b.status === "PAID")
          ? Math.max(0, b.totalAmount - (b.amountPaid || 0))
          : 0;
        return (
          <Box sx={{ textAlign: "right", fontFamily: "monospace", fontWeight: outstanding > 0 ? 600 : 400 }}>
            {b.status === "POSTED" || b.status === "PAID" ? fmt(outstanding) : "—"}
          </Box>
        );
      },
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }: any) => {
        const s = row.original.status as Bill["status"];
        return <Chip size="small" variant="outlined" color={STATUS_COLOR[s] || "default"} label={s.replace("_", " ")} sx={{ fontSize: "0.7rem" }} />;
      },
    },
    {
      // Xero sync state: grey "Not synced" until the doc is pushed/imported;
      // then a green chip carrying the Xero-side status (DRAFT/AUTHORISED/…).
      accessorKey: "xeroSyncStatus",
      header: "Xero",
      cell: ({ row }: any) => {
        const b: any = row.original;
        return b.xeroBillId ? (
          <Tooltip title={b.xeroSyncedAt ? `Synced ${new Date(b.xeroSyncedAt).toLocaleString()}` : "Linked to Xero"}>
            <Chip size="small" variant="outlined" color="success" label={`Xero · ${b.xeroSyncStatus || "SYNCED"}`} sx={{ fontSize: "0.65rem" }} />
          </Tooltip>
        ) : (
          <Chip size="small" variant="outlined" label="Not synced" sx={{ fontSize: "0.65rem", opacity: 0.6 }} />
        );
      },
    },
    {
      accessorKey: "inboundChannel",
      header: "Channel",
      cell: ({ row }: any) => (
        <Box sx={{ fontSize: "0.7rem", color: "text.secondary" }}>{row.original.inboundChannel || "MANUAL"}</Box>
      ),
    },
    {
      accessorKey: "actions",
      header: "Actions",
      cell: ({ row }: any) => {
        const b: Bill = row.original;
        const outstanding = (b.status === "POSTED" || b.status === "PAID")
          ? Math.max(0, b.totalAmount - (b.amountPaid || 0))
          : 0;
        return (
          <Stack direction="row" gap={0.25} justifyContent="flex-end">
            {b.status === "DRAFT" && (
              <Tooltip title="Submit">
                <IconButton size="small" onClick={() => submitDraft(b)}><CheckIcon fontSize="small" /></IconButton>
              </Tooltip>
            )}
            {b.status === "PENDING_APPROVAL" && (
              <>
                <Tooltip title="Approve + Post"><IconButton size="small" sx={{ color: "success.main" }} onClick={() => approve(b)}><CheckIcon fontSize="small" /></IconButton></Tooltip>
                <Tooltip title="Reject"><IconButton size="small" sx={{ color: "error.main" }} onClick={() => reject(b)}><ClearIcon fontSize="small" /></IconButton></Tooltip>
              </>
            )}
            {(b.status === "POSTED" || b.status === "PAID") && outstanding > 0 && (
              <Tooltip title="Record payment">
                <IconButton size="small" sx={{ color: "primary.main" }} onClick={() => { setPayingBill(b); setPaymentOpen(true); }}>
                  <PaymentIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
            <Tooltip title="View / edit">
              <IconButton size="small" onClick={() => { setEditing(b); setEditorOpen(true); }}><VisibilityIcon fontSize="small" /></IconButton>
            </Tooltip>
            {b.status !== "VOID" && (
              <Tooltip title="Void"><IconButton size="small" onClick={() => voidIt(b)}><DeleteOutlineIcon fontSize="small" /></IconButton></Tooltip>
            )}
          </Stack>
        );
      },
    },
  ], [request]);

  return (
    <Box sx={{ p: 3, display: "flex", flexDirection: "column", gap: 2 }}>
      {/* KPI row */}
      <Stack direction="row" gap={2}>
        <Paper variant="outlined" sx={{ p: 1.5, minWidth: 180 }}>
          <Typography variant="caption" sx={{ color: "text.secondary", textTransform: "uppercase", fontWeight: 700, fontSize: "0.65rem" }}>Visible bills</Typography>
          <Typography sx={{ fontFamily: "monospace", fontWeight: 700, fontSize: "1.125rem", mt: 0.25 }}>{visible.length}</Typography>
        </Paper>
        <Paper variant="outlined" sx={{ p: 1.5, minWidth: 180, borderLeft: 3, borderLeftColor: "warning.main" }}>
          <Typography variant="caption" sx={{ color: "text.secondary", textTransform: "uppercase", fontWeight: 700, fontSize: "0.65rem" }}>Outstanding (posted)</Typography>
          <Typography sx={{ fontFamily: "monospace", fontWeight: 700, fontSize: "1.125rem", mt: 0.25 }}>{fmt(totals.outstanding)}</Typography>
        </Paper>
        <Paper variant="outlined" sx={{ p: 1.5, minWidth: 180 }}>
          <Typography variant="caption" sx={{ color: "text.secondary", textTransform: "uppercase", fontWeight: 700, fontSize: "0.65rem" }}>Total billed</Typography>
          <Typography sx={{ fontFamily: "monospace", fontWeight: 700, fontSize: "1.125rem", mt: 0.25 }}>{fmt(totals.total)}</Typography>
        </Paper>
      </Stack>

      {/* Status tabs */}
      <Paper variant="outlined" sx={{ borderRadius: 1.5 }}>
        <Tabs
          value={tab}
          onChange={(_, v) => setTab(v)}
          sx={{ px: 1, minHeight: 40, "& .MuiTab-root": { minHeight: 40, textTransform: "none", fontWeight: 600 } }}
        >
          <Tab value="all" label={<TabLabel text="All" count={counts.all} />} />
          <Tab value="DRAFT" label={<TabLabel text="Draft" count={counts.DRAFT} />} />
          <Tab value="PENDING_APPROVAL" label={<TabLabel text="Pending Approval" count={counts.PENDING_APPROVAL} tone="warning" />} />
          <Tab value="POSTED" label={<TabLabel text="Posted" count={counts.POSTED} tone="info" />} />
          <Tab value="PAID" label={<TabLabel text="Paid" count={counts.PAID} tone="success" />} />
          <Tab value="VOID" label={<TabLabel text="Void" count={counts.VOID} />} />
        </Tabs>
      </Paper>

      {/* Standard reusable table (same component as Invoices, Inventory, etc.) */}
      <PageTable
        columns={columns}
        data={paged}
        tableName="Bills"
        subTitle="Supplier bills — submit → optional approval → posts to GL as a payable"
        buttonName="New Bill"
        onAddClick={() => { setEditing(null); setEditorOpen(true); }}
        loading={loading}
        page={page}
        limit={limit}
        search={search}
        filters={filters}
        setPage={setPage}
        setLimit={setLimit}
        setSearch={setSearch}
        setFilters={setFilters}
        availableFilters={["status", "createdOn"]}
        pageCount={pageCount}
        totalDocs={visible.length}
      />

      <BillEditorDialog
        open={editorOpen}
        editing={editing}
        onClose={() => setEditorOpen(false)}
        onSaved={() => { setEditorOpen(false); load(); }}
      />

      {payingBill && (
        <RecordBillPaymentDialog
          open={paymentOpen}
          onClose={() => setPaymentOpen(false)}
          onSuccess={() => load()}
          bill={{
            id: payingBill.id,
            billNumber: payingBill.billNumber,
            totalAmount: payingBill.totalAmount,
            amountPaid: payingBill.amountPaid,
            supplierName: payingBill.supplier?.name,
          }}
        />
      )}
    </Box>
  );
}

function TabLabel({ text, count, tone }: { text: string; count: number; tone?: "info" | "warning" | "success" }) {
  return (
    <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.75 }}>
      {text}
      <Chip
        size="small"
        label={count}
        variant="outlined"
        color={tone ?? "default"}
        sx={{ height: 18, fontSize: "0.65rem", "& .MuiChip-label": { px: 0.75 } }}
      />
    </Box>
  );
}
