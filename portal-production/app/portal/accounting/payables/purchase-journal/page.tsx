"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Box,
  Chip,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  ListItemButton,
  ListItemText,
  Paper,
  Stack,
  Tab,
  Tabs,
  Tooltip,
  Typography,
} from "@mui/material";
import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";
import AssignmentReturnIcon from "@mui/icons-material/AssignmentReturn";
import CheckIcon from "@mui/icons-material/Check";
import ClearIcon from "@mui/icons-material/Clear";
import VisibilityIcon from "@mui/icons-material/Visibility";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import PaymentIcon from "@mui/icons-material/Payment";
import { toast } from "react-toastify";
import { useAccountingApi } from "../../_lib/api";
import { useOrganizationFeatures } from "../../../hooks/useOrganizationFeatures";
import BillEditorDialog from "../../bills/_components/BillEditorDialog";
import CloudUploadIcon from "@mui/icons-material/CloudUpload";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import { expandUploadFiles, UPLOAD_ACCEPT } from "@/helpers/uploadExpand";
import { Button } from "@mui/material";
import RecordBillPaymentDialog from "../../bills/_components/RecordBillPaymentDialog";
import PageTable from "@/components/PageTable";

// Purchase Journal (supplier invoices) — lives under the AP path
// /portal/accounting/payables/purchase-journal (guru 2026-08-01; the old
// /portal/accounting/bills route redirects here).
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
  reference?: string | null;
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
  const { isXeroDocSyncEnabled } = useOrganizationFeatures();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [items, setItems] = useState<Bill[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"all" | "DRAFT" | "PENDING_APPROVAL" | "POSTED" | "PAID" | "VOID">("all");

  // PageTable-driven state
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<any>({});

  const [editorOpen, setEditorOpen] = useState(false);
  // New-entry chooser: Supplier Invoice (SIN) vs Supplier Purchase Return (SPR).
  const [kindPickerOpen, setKindPickerOpen] = useState(false);
  const [newKind, setNewKind] = useState<"SIN" | "SPR">("SIN");
  // Bulk upload: expanded files handed to BillEditorDialog's batch mode
  // (first bill shown while the rest extract in the background).
  const [batchFiles, setBatchFiles] = useState<File[] | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
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

  // ?new=1 (AP workspace's Purchase Journal button) lands here with the
  // New Supplier Invoice dialog already open.
  useEffect(() => {
    if (searchParams.get("new") === "1") {
      setEditing(null);
      setNewKind("SIN");
      setEditorOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      (s, b) => {
        // SPR (purchase return) reduces payables — subtract it from both cards.
        const sign = (b as any).kind === "SPR" ? -1 : 1;
        return {
          total: s.total + sign * b.totalAmount,
          outstanding:
            s.outstanding + (b.status === "POSTED" ? sign * Math.max(0, b.totalAmount - (b.amountPaid || 0)) : 0),
        };
      },
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
    if (!confirm("Reject and send back to Unconfirmed?")) return;
    try { await request(`/bills/${b.id}/reject`, { method: "POST" }); toast.success("Rejected"); load(); }
    catch (e: any) { toast.error(e?.message || "Reject failed"); }
  };
  const voidIt = async (b: Bill) => {
    if (!confirm("Void this supplier invoice? Its journal is voided too (a reversing JE is created only if it was already confirmed).")) return;
    try { await request(`/bills/${b.id}`, { method: "DELETE" }); toast.success("Voided"); load(); }
    catch (e: any) { toast.error(e?.message || "Void failed"); }
  };

  // ---------- Column defs for PageTable (tanstack-react-table) ----------
  const columns = useMemo(() => [
    {
      accessorKey: "billNumber",
      header: "Invoice #",
      cell: ({ row }: any) => {
        const b: Bill = row.original;
        return (
          <Box sx={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
            {b.billNumber}
            {(b as any).kind === "SPR" && (
              <Tooltip title="Supplier Purchase Return (supplier credit/debit note) — posts reversed">
                <Chip size="small" label="SPR" color="secondary" variant="outlined" sx={{ ml: 0.5, height: 16, fontSize: "0.6rem", "& .MuiChip-label": { px: 0.5 } }} />
              </Tooltip>
            )}
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
      // Free-text Reference — what the bill is FOR (guru 2026-07-24).
      accessorKey: "reference",
      header: "Reference",
      cell: ({ row }: any) => row.original.reference || "—",
    },
    {
      accessorKey: "billDate",
      header: "Invoice date",
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
        <Box sx={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmt(row.original.totalAmount)}</Box>
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
          <Box sx={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: outstanding > 0 ? 600 : 400 }}>
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
        // guru 2026-07-24 status model: DRAFT reads "Unconfirmed", POSTED
        // (confirmed, unpaid) reads "Awaiting Payment".
        const label = s === "DRAFT" ? "UNCONFIRMED" : s === "POSTED" ? "AWAITING PAYMENT" : s.replace("_", " ");
        return <Chip size="small" variant="outlined" color={STATUS_COLOR[s] || "default"} label={label} sx={{ fontSize: "0.7rem" }} />;
      },
    },
    // Xero sync column only for orgs with enableXeroDocSync (Biofuel) — other
    // orgs don't sync docs to Xero, so "Not synced" everywhere is just noise.
    ...(isXeroDocSyncEnabled ? [{
      // Xero sync state: grey "Not synced" until the doc is pushed/imported;
      // then a green chip carrying the Xero-side status (DRAFT/AUTHORISED/…).
      accessorKey: "xeroSyncStatus",
      header: "Xero",
      cell: ({ row }: any) => {
        const b: any = row.original;
        return b.xeroBillId ? (
          <Tooltip title={b.xeroSyncedAt ? `Synced ${new Date(b.xeroSyncedAt).toLocaleString()}` : "Linked to Xero"}>
            <Chip size="small" variant="outlined" color="success" label={`Xero · ${b.xeroSyncStatus || "SYNCED"}`} sx={{ fontSize: "0.65rem", height: "auto", minHeight: 24, py: 0.25, "& .MuiChip-label": { whiteSpace: "normal", display: "block", textAlign: "center", lineHeight: 1.3 } }} />
          </Tooltip>
        ) : (
          <Chip size="small" variant="outlined" label="Not synced" sx={{ fontSize: "0.65rem", opacity: 0.6 }} />
        );
      },
    }] : []),
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
            {(b.status === "POSTED" || b.status === "PAID") && outstanding > 0 && (b as any).kind !== "SPR" && (
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
  ], [request, isXeroDocSyncEnabled]);

  return (
    <Box sx={{ p: 3, display: "flex", flexDirection: "column", gap: 2 }}>
      {/* Back to the Accounts Payable workspace (guru 2026-08-01). */}
      <Box>
        <Button
          size="small"
          startIcon={<ArrowBackIcon />}
          onClick={() => router.push("/portal/accounting/payables")}
          sx={{ textTransform: "none", fontWeight: 600, color: "text.secondary" }}
        >
          Accounts Payable
        </Button>
      </Box>
      {/* KPI row */}
      <Stack direction="row" gap={2}>
        <Paper variant="outlined" sx={{ p: 1.5, minWidth: 180 }}>
          <Typography variant="caption" sx={{ color: "text.secondary", textTransform: "uppercase", fontWeight: 700, fontSize: "0.65rem" }}>Visible invoices</Typography>
          <Typography sx={{ fontVariantNumeric: "tabular-nums", fontWeight: 700, fontSize: "1.125rem", mt: 0.25 }}>{visible.length}</Typography>
        </Paper>
        <Paper variant="outlined" sx={{ p: 1.5, minWidth: 180, borderLeft: 3, borderLeftColor: "warning.main" }}>
          <Typography variant="caption" sx={{ color: "text.secondary", textTransform: "uppercase", fontWeight: 700, fontSize: "0.65rem" }}>Outstanding (posted)</Typography>
          <Typography sx={{ fontVariantNumeric: "tabular-nums", fontWeight: 700, fontSize: "1.125rem", mt: 0.25 }}>{fmt(totals.outstanding)}</Typography>
        </Paper>
        <Paper variant="outlined" sx={{ p: 1.5, minWidth: 180 }}>
          <Typography variant="caption" sx={{ color: "text.secondary", textTransform: "uppercase", fontWeight: 700, fontSize: "0.65rem" }}>Total purchases</Typography>
          <Typography sx={{ fontVariantNumeric: "tabular-nums", fontWeight: 700, fontSize: "1.125rem", mt: 0.25 }}>{fmt(totals.total)}</Typography>
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
          <Tab value="DRAFT" label={<TabLabel text="Unconfirmed" count={counts.DRAFT} />} />
          <Tab value="PENDING_APPROVAL" label={<TabLabel text="Pending Approval" count={counts.PENDING_APPROVAL} tone="warning" />} />
          <Tab value="POSTED" label={<TabLabel text="Awaiting Payment" count={counts.POSTED} tone="info" />} />
          <Tab value="PAID" label={<TabLabel text="Paid" count={counts.PAID} tone="success" />} />
          <Tab value="VOID" label={<TabLabel text="Void" count={counts.VOID} />} />
        </Tabs>
      </Paper>

      {/* Standard reusable table (same component as Invoices, Inventory, etc.) */}
      <PageTable
        columns={columns}
        data={paged}
        tableName="Purchase Journal"
        subTitle="Supplier invoices (purchase journal) — save posts to GL as unconfirmed; confirm from the Posting Queue"
        buttonName="New Purchase Entry"
        onAddClick={() => setKindPickerOpen(true)}
        actionButtons={[
          <Button key="upload-bills" data-tour="bills-upload" variant="outlined" startIcon={<CloudUploadIcon />} onClick={() => uploadInputRef.current?.click()}>
            Upload Supplier Invoices
          </Button>,
        ]}
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

      {/* Hidden picker behind "Upload Bills" — multi-select + ZIP, expanded
          client-side, then reviewed one-by-one in the editor's batch mode
          (guru 2026-07-26). */}
      <input
        type="file"
        accept={UPLOAD_ACCEPT}
        multiple
        hidden
        ref={uploadInputRef}
        onChange={async (e) => {
          const files = await expandUploadFiles(e.target.files);
          e.target.value = "";
          if (!files.length) return;
          setEditing(null);
          setNewKind("SIN"); // uploads are always supplier invoices
          setBatchFiles(files);
          setEditorOpen(true);
        }}
      />

      {/* New-entry chooser (guru 2026-08-21): this page carries both supplier
          invoices (SIN) and supplier credit/debit notes as purchase returns
          (SPR) — the create button asks which one. */}
      <Dialog open={kindPickerOpen} onClose={() => setKindPickerOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>New Purchase Entry</DialogTitle>
        <DialogContent sx={{ pb: 2.5 }}>
          <ListItemButton
            sx={{ border: 1, borderColor: "divider", borderRadius: 1.5, mb: 1 }}
            onClick={() => { setKindPickerOpen(false); setEditing(null); setNewKind("SIN"); setEditorOpen(true); }}
          >
            <ReceiptLongIcon sx={{ mr: 1.5, color: "primary.main" }} />
            <ListItemText
              primary="Supplier Invoice (SIN)"
              secondary="A bill from a supplier — posts Dr expense / Cr Trade Payables"
            />
          </ListItemButton>
          <ListItemButton
            sx={{ border: 1, borderColor: "divider", borderRadius: 1.5 }}
            onClick={() => { setKindPickerOpen(false); setEditing(null); setNewKind("SPR"); setEditorOpen(true); }}
          >
            <AssignmentReturnIcon sx={{ mr: 1.5, color: "secondary.main" }} />
            <ListItemText
              primary="Supplier Purchase Return (SPR)"
              secondary="Supplier credit/debit note — posts reversed, reduces payables"
            />
          </ListItemButton>
        </DialogContent>
      </Dialog>

      <BillEditorDialog
        open={editorOpen}
        editing={editing}
        kind={newKind}
        batchFiles={batchFiles}
        onClose={() => { setEditorOpen(false); setBatchFiles(null); }}
        onSaved={() => { setEditorOpen(false); setBatchFiles(null); load(); }}
        onRefresh={load}
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
