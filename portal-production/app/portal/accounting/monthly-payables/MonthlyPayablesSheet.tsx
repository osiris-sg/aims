"use client";

// Monthly Payables (Summer 2026-11-02): the AIMS version of the office's
// "Bi Weekly Outgoing Payments" Google sheet. Supplier invoices posted in the
// bills WhatsApp group are AI-read onto this tally as TO PAY; setting a
// payment date marks them PAID. Columns mirror the sheet: invoice no ·
// contractor · site address · invoice amount · supplier rebate % · payment amount ·
// payment date · remarks · submitted by.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert, Autocomplete, Box, Button, Checkbox, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  Divider, Menu, MenuItem, Stack, Switch, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography,
} from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircleOutline";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import WhatsAppIcon from "@mui/icons-material/WhatsApp";
import ReceiptLongIcon from "@mui/icons-material/ReceiptLongOutlined";
import AutorenewIcon from "@mui/icons-material/Autorenew";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import { IconButton } from "@mui/material";
import { toast } from "react-toastify";
import PageTable from "@/components/PageTable";
import BulkActionBar from "@/components/BulkActionBar";
import { useAccountingApi } from "../_lib/api";

type Row = {
  id: string;
  month: string;
  status: "to_pay" | "paid" | "withholding";
  invoiceNo: string | null;
  supplierName: string | null;
  siteAddress: string | null;
  invoiceDate: string | null;
  invoiceAmount: number;
  percentage: number | null;
  paymentAmount: number;
  paymentDate: string | null;
  remarks: string | null;
  submittedBy: string | null;
  approvedBy: string | null;
  attachmentUrl: string | null;
  filename: string | null;
  source: string;
  postedBy?: string | null;
  projectId: string | null;
  projectName: string | null;
};

type Payload = {
  month: string;
  months: string[];
  rows: Row[];
  totals: { toPay: number; withheld: number; paid: number; all: number; rebate: number; toPayCount: number; withheldCount: number; paidCount: number };
};

type ProjectOption = { id: string; name: string; address: string | null; status?: string | null; clientName?: string | null };

const money = (n: number | null | undefined) =>
  (Number(n) || 0).toLocaleString("en-SG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString("en-SG", { day: "2-digit", month: "short", year: "numeric" }) : "";
const monthLabel = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  return new Date(y, (mo || 1) - 1, 1).toLocaleDateString("en-SG", { month: "short", year: "numeric" });
};
const thisMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

export default function MonthlyPayablesSheet({ reportsHref }: { reportsHref?: string }) {
  const { request } = useAccountingApi();
  const [month, setMonth] = useState(thisMonth());
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<"all" | "to_pay" | "paid" | "withholding">("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<{ pos: { left: number; top: number }; row: Row } | null>(null);
  const [editRow, setEditRow] = useState<Row | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  // Bank-payment upload (guru 2026-11-08): AI-reads a bank payment page,
  // matches the supplier, and the outstanding invoices get ticked off.
  const [payUploadOpen, setPayUploadOpen] = useState(false);
  const [recurringOpen, setRecurringOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50); // a cycle reads as one sheet
  const [search, setSearch] = useState("");
  // Projects for the "link to project" picker — verifies each invoice's site
  // address against a real job (Summer's tally-with-designer-files check).
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  useEffect(() => {
    request<ProjectOption[]>(`/payables/project-options`)
      .then((r) => setProjects(Array.isArray(r) ? r : []))
      .catch(() => {});
  }, [request]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await request<Payload>(`/payables?month=${month}`);
      setData(r);
    } catch (e: any) {
      toast.error(e.message || "Could not load payables");
    } finally {
      setLoading(false);
    }
  }, [request, month]);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    setSelected(new Set());
  }, [month, statusFilter]);

  const rows = useMemo(() => {
    let all = data?.rows || [];
    if (statusFilter !== "all") all = all.filter((r) => r.status === statusFilter);
    const q = search.trim().toLowerCase();
    if (q) all = all.filter((r) => [r.invoiceNo, r.supplierName, r.siteAddress, r.remarks].some((v) => (v || "").toLowerCase().includes(q)));
    return all;
  }, [data, statusFilter, search]);

  // Sheet view (guru 2026-11-08: "follow this excel"): rows grouped by
  // contractor exactly like the Bi Weekly Outgoing Payments tabs — banded
  // contractor blocks, a red per-contractor subtotal (the sheet's red figure
  // in the REMARKS column) and the red month total at the end. Banding is
  // theme-aware instead of the sheet's green/cream.
  const displayRows = useMemo(() => {
    const groups: { name: string; list: Row[] }[] = [];
    for (const r of rows) {
      const name = r.supplierName || "—";
      const g = groups[groups.length - 1];
      if (g && g.name === name) g.list.push(r);
      else groups.push({ name, list: [r] });
    }
    const out: any[] = [];
    groups.forEach((g, gi) => {
      const band = gi % 2 === 1;
      for (const r of g.list) out.push({ ...r, _band: band });
      if (g.list.length > 1) {
        out.push({
          _kind: "subtotal",
          id: `sub-${gi}-${g.name}`,
          supplierName: g.name,
          count: g.list.length,
          total: g.list.reduce((s, r) => s + (Number(r.paymentAmount) || 0), 0),
          _band: band,
        });
      }
    });
    if (rows.length) out.push({ _kind: "grand", id: "grand-total", total: rows.reduce((s, r) => s + (Number(r.paymentAmount) || 0), 0), _band: false });
    return out;
  }, [rows]);

  const months = useMemo(() => {
    const set = new Set<string>([...(data?.months || []), thisMonth(), month]);
    return [...set].sort().reverse();
  }, [data, month]);

  const act = async (fn: () => Promise<any>, okMsg?: string) => {
    setBusy(true);
    try {
      await fn();
      if (okMsg) toast.success(okMsg);
      await load();
    } catch (e: any) {
      toast.error(e.message || "Action failed");
    } finally {
      setBusy(false);
    }
  };

  const markPaid = (ids: string[]) =>
    act(async () => {
      for (const id of ids) await request(`/payables/${id}/pay`, { method: "POST", body: JSON.stringify({}) });
      setSelected(new Set());
    }, `${ids.length > 1 ? `${ids.length} invoices` : "Invoice"} marked paid`);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const columns = useMemo(
    () => [
      {
        id: "pick",
        header: "",
        pxWidth: 36,
        enableSorting: false,
        cell: ({ row }: any) =>
          row.original._kind ? null : (
          <Checkbox
            size="small"
            checked={selected.has(row.original.id)}
            onClick={(e) => {
              e.stopPropagation();
              toggle(row.original.id);
            }}
            sx={{ p: 0.25 }}
          />
          ),
      },
      {
        accessorKey: "invoiceNo",
        header: "Invoice",
        size: 11,
        enableSorting: false,
        cell: ({ row }: any) =>
          row.original._kind ? null : (
          <Stack direction="row" spacing={0.75} alignItems="center">
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {row.original.invoiceNo || "—"}
            </Typography>
            {row.original.source === "whatsapp-group" && <WhatsAppIcon sx={{ fontSize: 14, color: "success.main" }} />}
            {row.original.source === "recurring" && <AutorenewIcon sx={{ fontSize: 14, color: "info.main" }} />}
          </Stack>
          ),
      },
      {
        accessorKey: "invoiceDate",
        header: "Invoice Date",
        size: 8,
        enableSorting: false,
        cell: ({ row }: any) =>
          row.original._kind ? null : (
            <Typography variant="body2" sx={{ color: row.original.invoiceDate ? "text.primary" : "text.disabled" }}>
              {fmtDate(row.original.invoiceDate) || "\u2014"}
            </Typography>
          ),
      },
      {
        accessorKey: "supplierName",
        header: "Contractor Company",
        size: 14,
        enableSorting: false,
        cell: ({ row }: any) =>
          row.original._kind === "subtotal" ? (
            <Typography variant="caption" sx={{ color: "text.secondary", fontStyle: "italic" }}>
              {row.original.supplierName} · {row.original.count} invoices
            </Typography>
          ) : row.original._kind === "grand" ? (
            <Typography variant="body2" sx={{ fontWeight: 800 }}>MONTH TOTAL</Typography>
          ) : (
            row.original.supplierName || "—"
          ),
      },
      {
        accessorKey: "siteAddress",
        header: "Site Address",
        size: 17,
        enableSorting: false,
        cell: ({ row }: any) =>
          row.original._kind ? null : (
          <Box sx={{ maxWidth: 240 }}>
            <Typography variant="body2" noWrap title={row.original.siteAddress || ""}>
              {row.original.siteAddress || "—"}
            </Typography>
            {row.original.projectId ? (
              <Typography variant="caption" sx={{ color: "success.main", display: "block" }} noWrap>
                ✓ {row.original.projectName}
              </Typography>
            ) : row.original.siteAddress ? (
              <Typography variant="caption" sx={{ color: "warning.main", display: "block" }} noWrap>
                No project match
              </Typography>
            ) : null}
          </Box>
        ),
      },
      {
        accessorKey: "invoiceAmount",
        header: "Invoice Amount",
        size: 9,
        align: "right",
        enableSorting: false,
        cell: ({ row }: any) =>
          row.original._kind ? null : <Box sx={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money(row.original.invoiceAmount)}</Box>,
      },
      {
        accessorKey: "percentage",
        header: "%",
        size: 4,
        align: "right",
        enableSorting: false,
        cell: ({ row }: any) =>
          row.original._kind ? null : <Box sx={{ textAlign: "right" }}>{row.original.percentage != null ? `${row.original.percentage}%` : ""}</Box>,
      },
      {
        accessorKey: "paymentAmount",
        header: "Payment Amount",
        size: 10,
        align: "right",
        enableSorting: false,
        cell: ({ row }: any) =>
          row.original._kind === "grand" ? (
            // The sheet's red month total at the foot of the Payment Amount column.
            <Box sx={{ textAlign: "right", fontWeight: 800, fontVariantNumeric: "tabular-nums", color: "error.main" }}>S$ {money(row.original.total)}</Box>
          ) : row.original._kind === "subtotal" ? null : (
            <Box sx={{ textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{money(row.original.paymentAmount)}</Box>
          ),
      },
      {
        accessorKey: "paymentDate",
        header: "Payment Date",
        size: 8,
        enableSorting: false,
        cell: ({ row }: any) =>
          row.original._kind ? null : row.original.status === "paid" ? (
            <Chip size="small" color="success" variant="outlined" label={fmtDate(row.original.paymentDate) || "Paid"} sx={{ height: 22 }} />
          ) : row.original.status === "withholding" ? (
            <Chip size="small" variant="outlined" label="WITHHELD" sx={{ height: 22, color: "#ed6c02", borderColor: "#ed6c02" }} />
          ) : (
            <Chip size="small" color="warning" variant="outlined" label="TO PAY" sx={{ height: 22 }} />
          ),
      },
      {
        accessorKey: "remarks",
        header: "Remarks",
        size: 11,
        enableSorting: false,
        cell: ({ row }: any) =>
          row.original._kind === "subtotal" ? (
            // The sheet writes each contractor's subtotal in red in the REMARKS column.
            <Typography variant="body2" sx={{ fontWeight: 800, color: "error.main", fontVariantNumeric: "tabular-nums" }}>
              S$ {money(row.original.total)}
            </Typography>
          ) : row.original._kind ? null : (
          <Typography variant="body2" noWrap sx={{ maxWidth: 180, color: "text.secondary" }} title={row.original.remarks || ""}>
            {row.original.remarks || ""}
          </Typography>
          ),
      },
      { accessorKey: "submittedBy", header: "Submitted By", size: 8, enableSorting: false, cell: ({ row }: any) => (row.original._kind ? null : row.original.submittedBy || row.original.postedBy || "") },
      {
        id: "actions",
        header: "",
        pxWidth: 40,
        enableSorting: false,
        cell: ({ row }: any) =>
          row.original._kind ? null : (
          <IconButton
            size="small"
            onClick={(e) => {
              e.stopPropagation();
              setMenu({ pos: { left: e.clientX, top: e.clientY }, row: row.original });
            }}
          >
            <MoreVertIcon fontSize="small" />
          </IconButton>
          ),
      },
    ],
    [selected],
  );

  const totals = data?.totals;

  return (
    <Box sx={{ width: "100%" }}>
      {/* Month tabs — the sheet's monthly tabs. */}
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5, flexWrap: "wrap", rowGap: 1 }}>
        {months.slice(0, 8).map((m) => (
          <Chip
            key={m}
            label={monthLabel(m)}
            color={m === month ? "primary" : undefined}
            variant={m === month ? "filled" : "outlined"}
            onClick={() => setMonth(m)}
            sx={{ height: 26 }}
          />
        ))}
        <TextField
          type="month"
          size="small"
          value={month}
          onChange={(e) => e.target.value && setMonth(e.target.value)}
          sx={{ width: 160, "& input": { py: 0.5 } }}
        />
        <Box sx={{ flex: 1 }} />
        <ToggleButtonGroup size="small" exclusive value={statusFilter} onChange={(_, v) => v && setStatusFilter(v)}>
          <ToggleButton value="all" sx={{ px: 1.25, py: 0.25, textTransform: "none" }}>All</ToggleButton>
          <ToggleButton value="to_pay" sx={{ px: 1.25, py: 0.25, textTransform: "none" }}>To pay</ToggleButton>
          <ToggleButton value="withholding" sx={{ px: 1.25, py: 0.25, textTransform: "none" }}>Withheld</ToggleButton>
          <ToggleButton value="paid" sx={{ px: 1.25, py: 0.25, textTransform: "none" }}>Paid</ToggleButton>
        </ToggleButtonGroup>
        {/* When this sheet IS the Accounts Payable landing, the aging /
            statement / purchase reports stay a click away. */}
        {reportsHref && (
          <Button size="small" variant="outlined" href={reportsHref} sx={{ textTransform: "none", ml: 1 }}>
            AP reports
          </Button>
        )}
      </Stack>

      {/* Totals — the tally Summer asked for. */}
      {totals && (
        <Stack direction="row" spacing={2} sx={{ mb: 1.5, flexWrap: "wrap", rowGap: 1 }}>
          {[
            { k: `To pay (${totals.toPayCount})`, v: totals.toPay, color: "warning.main" },
            ...(totals.withheldCount ? [{ k: `Withheld (${totals.withheldCount})`, v: totals.withheld, color: "#ed6c02" }] : []),
            { k: `Paid (${totals.paidCount})`, v: totals.paid, color: "success.main" },
            { k: "Month total", v: totals.all, color: "text.primary" },
            // Rebate total (guru 2026-11-08): what suppliers rebate back — Σ invoice × %.
            { k: "Rebate total", v: totals.rebate, color: "info.main" },
          ].map((t) => (
            <Box key={t.k} sx={{ border: 1, borderColor: "divider", borderRadius: 2, px: 2, py: 1, minWidth: 170 }}>
              <Typography variant="caption" sx={{ color: "text.secondary", textTransform: "uppercase", letterSpacing: 0.4 }}>
                {t.k}
              </Typography>
              <Typography variant="h6" sx={{ fontWeight: 800, color: t.color, fontVariantNumeric: "tabular-nums" }}>
                S$ {money(t.v)}
              </Typography>
            </Box>
          ))}
        </Stack>
      )}

      <PageTable
        tableName="Monthly Payables"
        subTitle="Supplier invoices for the month, grouped by contractor like the outgoing-payments sheet. A payment date marks a row paid."
        columns={columns as any}
        data={displayRows.slice((page - 1) * limit, page * limit)}
        loading={loading}
        buttonName="Add payable"
        onAddClick={() => setAddOpen(true)}
        actionButtons={[
          <Button key="upload-payment" size="small" variant="outlined" startIcon={<ReceiptLongIcon />} onClick={() => setPayUploadOpen(true)} sx={{ textTransform: "none" }}>
            Upload payment
          </Button>,
          <Button key="recurring" size="small" variant="outlined" startIcon={<AutorenewIcon />} onClick={() => setRecurringOpen(true)} sx={{ textTransform: "none" }}>
            Recurring
          </Button>,
        ]}
        noSelectionColumn
        onRowClick={(row: any) => {
          if (!row._kind) setEditRow(row);
        }}
        rowSx={(r: any) => ({
          ...(r._band ? { bgcolor: "action.hover" } : {}),
          // The sheet's colour legend (guru 2026-11-08): paid rows go olive
          // green, withheld rows orange — whole row, both themes.
          ...(!r._kind && r.status === "paid" ? { bgcolor: "rgba(124,153,62,0.28)", "&:hover": { bgcolor: "rgba(124,153,62,0.38)" } } : {}),
          ...(!r._kind && r.status === "withholding" ? { bgcolor: "rgba(237,108,2,0.22)", "&:hover": { bgcolor: "rgba(237,108,2,0.32)" } } : {}),
          ...(r._kind === "subtotal" ? { "& td": { py: 0.25, borderBottom: 2, borderColor: "divider" } } : {}),
          ...(r._kind === "grand" ? { "& td": { borderTop: 2, borderColor: "text.secondary", borderBottom: 0, py: 1 } } : {}),
          ...(r._kind ? { cursor: "default", "&:hover": { bgcolor: r._band ? "action.hover" : "transparent" } } : {}),
        })}
        page={page}
        limit={limit}
        search={search}
        filters={{}}
        setPage={setPage}
        setLimit={setLimit}
        setSearch={(v: string) => {
          setSearch(v);
          setPage(1);
        }}
        setFilters={() => {}}
        pageCount={Math.max(1, Math.ceil(displayRows.length / limit))}
        totalDocs={displayRows.length}
      />

      {/* Row context menu — anchored to the CLICK POSITION (table re-renders detach element anchors). */}
      <Menu
        open={!!menu}
        onClose={() => setMenu(null)}
        anchorReference="anchorPosition"
        anchorPosition={menu?.pos}
      >
        {menu?.row.status !== "paid" && (
          <MenuItem
            onClick={() => {
              const id = menu!.row.id;
              setMenu(null);
              markPaid([id]);
            }}
          >
            Mark paid
          </MenuItem>
        )}
        {menu?.row.status === "to_pay" && (
          <MenuItem
            sx={{ color: "#ed6c02" }}
            onClick={() => {
              const id = menu!.row.id;
              setMenu(null);
              act(() => request(`/payables/${id}/withhold`, { method: "POST", body: JSON.stringify({}) }), "Payment withheld");
            }}
          >
            Withhold payment
          </MenuItem>
        )}
        {menu?.row.status !== "to_pay" && (
          <MenuItem
            onClick={() => {
              const id = menu!.row.id;
              setMenu(null);
              act(() => request(`/payables/${id}/unpay`, { method: "POST", body: JSON.stringify({}) }), "Back to TO PAY");
            }}
          >
            Back to to-pay
          </MenuItem>
        )}
        <MenuItem
          sx={{ color: "error.main" }}
          onClick={() => {
            const row = menu!.row;
            setMenu(null);
            if (!window.confirm(`Delete ${row.invoiceNo || "this payable"}?`)) return;
            act(() => request(`/payables/${row.id}`, { method: "DELETE" }), "Deleted");
          }}
        >
          Delete
        </MenuItem>
      </Menu>

      <BulkActionBar
        count={selected.size}
        onClear={() => setSelected(new Set())}
        actions={[
          {
            key: "pay",
            label: "Mark paid",
            color: "success",
            icon: <CheckCircleIcon fontSize="small" />,
            disabled: busy,
            onClick: () => markPaid([...selected]),
          },
        ]}
      />

      {editRow && (
        <PayableDialog
          row={editRow}
          busy={busy}
          projects={projects}
          onClose={() => setEditRow(null)}
          onSave={(patch) =>
            act(async () => {
              await request(`/payables/${editRow.id}`, { method: "PATCH", body: JSON.stringify(patch) });
              setEditRow(null);
            }, "Saved")
          }
          onPaid={(paymentDate) =>
            act(async () => {
              await request(`/payables/${editRow.id}/pay`, { method: "POST", body: JSON.stringify({ paymentDate }) });
              setEditRow(null);
            }, "Marked paid")
          }
          onWithhold={() =>
            act(async () => {
              await request(`/payables/${editRow.id}/withhold`, { method: "POST", body: JSON.stringify({}) });
              setEditRow(null);
            }, "Payment withheld")
          }
          onUnpaid={() =>
            act(async () => {
              await request(`/payables/${editRow.id}/unpay`, { method: "POST", body: JSON.stringify({}) });
              setEditRow(null);
            }, "Back to TO PAY")
          }
          onDelete={() =>
            act(async () => {
              await request(`/payables/${editRow.id}`, { method: "DELETE" });
              setEditRow(null);
            }, "Deleted")
          }
        />
      )}

      {addOpen && (
        <PayableDialog
          row={null}
          busy={busy}
          projects={projects}
          month={month}
          onClose={() => setAddOpen(false)}
          onSave={(dto) =>
            act(async () => {
              await request(`/payables`, { method: "POST", body: JSON.stringify({ ...dto, month }) });
              setAddOpen(false);
            }, "Added")
          }
        />
      )}

      {recurringOpen && (
        <RecurringPayablesDialog
          request={request}
          onClose={() => {
            setRecurringOpen(false);
            load(); // new templates materialise onto the current month
          }}
        />
      )}

      {payUploadOpen && (
        <PaymentUploadDialog
          request={request}
          onClose={() => setPayUploadOpen(false)}
          onSettled={() => {
            setPayUploadOpen(false);
            load();
          }}
        />
      )}
    </Box>
  );
}

// Recurring payables (guru 2026-11-08: rent etc.): standing monthly lines —
// each active template lands on the tally once per month, on the day set.
function RecurringPayablesDialog({ request, onClose }: { request: <T = any>(path: string, init?: any) => Promise<T>; onClose: () => void }) {
  const [rows, setRows] = useState<any[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<any>({ supplierName: "", description: "", amount: "", percentage: "", dayOfMonth: "" });

  const load = useCallback(async () => {
    try {
      setRows(await request<any[]>(`/payables/recurring`));
    } catch (e: any) {
      toast.error(e.message || "Could not load recurring payables");
    }
  }, [request]);
  useEffect(() => {
    load();
  }, [load]);

  const act = async (fn: () => Promise<any>, okMsg?: string) => {
    setBusy(true);
    try {
      await fn();
      if (okMsg) toast.success(okMsg);
      await load();
    } catch (e: any) {
      toast.error(e.message || "Action failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Recurring payables</DialogTitle>
      <DialogContent dividers>
        <Typography variant="caption" sx={{ color: "text.secondary", display: "block", mb: 1.5 }}>
          Standing monthly lines — rent, subscriptions, allowances. Each active one lands on the tally automatically when the month starts.
        </Typography>
        <Stack spacing={1}>
          {rows === null && <CircularProgress size={20} />}
          {rows?.map((t) => (
            <Stack key={t.id} direction="row" spacing={1} alignItems="center" sx={{ opacity: t.active ? 1 : 0.5 }}>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>{t.supplierName}</Typography>
                <Typography variant="caption" sx={{ color: "text.secondary" }} noWrap>
                  {t.description || "—"} · day {t.dayOfMonth || 1}{t.percentage != null ? ` · ${t.percentage}%` : ""}
                </Typography>
              </Box>
              <Typography variant="body2" sx={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{money(t.amount)}</Typography>
              <Tooltip title={t.active ? "Pause — stops landing on new months" : "Resume"}>
                <Switch size="small" checked={t.active} disabled={busy} onChange={(e) => act(() => request(`/payables/recurring/${t.id}`, { method: "PATCH", body: JSON.stringify({ active: e.target.checked }) }))} />
              </Tooltip>
              <IconButton size="small" disabled={busy} onClick={() => window.confirm(`Delete the recurring line "${t.supplierName}"? Rows already on the tally stay.`) && act(() => request(`/payables/recurring/${t.id}`, { method: "DELETE" }), "Deleted")} sx={{ color: "text.disabled", "&:hover": { color: "error.main" } }}>
                <DeleteOutlineIcon fontSize="small" />
              </IconButton>
            </Stack>
          ))}
          {rows?.length === 0 && <Typography variant="body2" sx={{ color: "text.disabled" }}>Nothing recurring yet.</Typography>}
          <Divider sx={{ my: 1 }} />
          <Typography variant="overline" sx={{ color: "text.secondary" }}>Add recurring</Typography>
          <Stack direction="row" spacing={1}>
            <TextField label="Paid to" size="small" value={draft.supplierName} onChange={(e) => setDraft({ ...draft, supplierName: e.target.value })} sx={{ flex: 1 }} />
            <TextField label="For (e.g. Showroom rent)" size="small" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} sx={{ flex: 1 }} />
          </Stack>
          <Stack direction="row" spacing={1}>
            <TextField label="Amount" size="small" value={draft.amount} onChange={(e) => /^[0-9]*\.?[0-9]*$/.test(e.target.value) && setDraft({ ...draft, amount: e.target.value })} inputProps={{ inputMode: "decimal" }} sx={{ flex: 1 }} />
            <TextField label="%" size="small" value={draft.percentage} onChange={(e) => /^[0-9]*\.?[0-9]*$/.test(e.target.value) && setDraft({ ...draft, percentage: e.target.value })} sx={{ width: 80 }} />
            <TextField label="Day of month" size="small" value={draft.dayOfMonth} onChange={(e) => /^[0-9]{0,2}$/.test(e.target.value) && setDraft({ ...draft, dayOfMonth: e.target.value })} sx={{ width: 120 }} />
            <Button
              variant="contained"
              disabled={busy || !(Number(draft.amount) > 0) || !draft.supplierName.trim()}
              onClick={() =>
                act(async () => {
                  await request(`/payables/recurring`, { method: "POST", body: JSON.stringify(draft) });
                  setDraft({ supplierName: "", description: "", amount: "", percentage: "", dayOfMonth: "" });
                }, "Added — it lands on the current month on next load")
              }
              sx={{ textTransform: "none" }}
            >
              Add
            </Button>
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} sx={{ textTransform: "none" }}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

// Bank-payment upload (guru 2026-11-08): drop the bank's payment page →
// AI-reads payee / amount / date, auto-matches the supplier, lists their
// outstanding invoices — tick what was paid, adjust a row's rebate % if needed,
// and settle them all as PAID on the payment date.
function PaymentUploadDialog({ request, onClose, onSettled }: { request: <T = any>(path: string, init?: any) => Promise<T>; onClose: () => void; onSettled: () => void }) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<any>(null);
  const [supplier, setSupplier] = useState<string | null>(null);
  const [payDate, setPayDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [picks, setPicks] = useState<Record<string, { checked: boolean; pct: string }>>({});

  const onFile = (f: File | null) => {
    if (!f) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUri = String(reader.result || "");
      setFileName(f.name);
      setPreview(dataUri);
      setLoading(true);
      setRes(null);
      try {
        const r = await request<any>(`/payables/match-payment`, { method: "POST", body: JSON.stringify({ dataUri, mimetype: f.type }) });
        setRes(r);
        setSupplier(r?.supplier || null);
        if (r?.payment?.paymentDate) setPayDate(r.payment.paymentDate);
        setPicks({});
      } catch (e: any) {
        toast.error(e.message || "Could not read the payment page");
      } finally {
        setLoading(false);
      }
    };
    reader.readAsDataURL(f);
  };

  const rows: Row[] = useMemo(() => (res?.rows || []).filter((r: Row) => (r.supplierName || "—") === supplier), [res, supplier]);
  const pctOf = (r: Row) => {
    const d = picks[r.id];
    const raw = d?.pct ?? (r.percentage == null ? "" : String(r.percentage));
    return raw === "" ? null : Number(raw) || 0;
  };
  // The amount that will actually be paid. Only re-derive from the rebate %
  // when the user CHANGED it: a hand-typed row ("Add payable" — a loan, an
  // ad-hoc payment) carries a payment amount that is not invoice x (1-%), and
  // its invoice amount is often 0, so deriving it would show 0.00 here and
  // disagree with what the server keeps (payables.service settle()).
  const payOf = (r: Row) =>
    (pctOf(r) ?? null) === (r.percentage ?? null)
      ? Number(r.paymentAmount) || 0
      : Math.round((Number(r.invoiceAmount) || 0) * (1 - (pctOf(r) ?? 0) / 100) * 100) / 100;
  const selected = rows.filter((r) => picks[r.id]?.checked);
  const selectedTotal = Math.round(selected.reduce((s, r) => s + payOf(r), 0) * 100) / 100;
  const bankAmount = Number(res?.payment?.amount) || 0;
  const diff = Math.round((selectedTotal - bankAmount) * 100) / 100;

  const settle = () =>
    (async () => {
      setBusy(true);
      try {
        await request(`/payables/settle`, {
          method: "POST",
          body: JSON.stringify({
            rows: selected.map((r) => ({ id: r.id, percentage: pctOf(r) })),
            paymentDate: payDate,
            reference: res?.payment?.reference || null,
          }),
        });
        toast.success(`${selected.length} invoice${selected.length === 1 ? "" : "s"} marked paid`);
        onSettled();
      } catch (e: any) {
        toast.error(e.message || "Could not settle");
      } finally {
        setBusy(false);
      }
    })();

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>Upload bank payment</DialogTitle>
      <DialogContent dividers>
        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: preview ? "260px 1fr" : "1fr" }, gap: 2 }}>
          <Stack spacing={1.5}>
            <Button variant="outlined" component="label" sx={{ textTransform: "none" }}>
              {fileName ? `Replace — ${fileName}` : "Choose the bank's payment page (image / PDF)"}
              <input hidden type="file" accept="image/*,application/pdf" onChange={(e) => onFile(e.target.files?.[0] || null)} />
            </Button>
            {preview && !preview.includes("application/pdf") && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview} alt="payment" style={{ width: "100%", borderRadius: 6, border: "1px solid rgba(128,128,128,.3)" }} />
            )}
            {res?.payment && (
              <Box sx={{ p: 1.25, borderRadius: 1, bgcolor: "action.hover" }}>
                <Typography variant="caption" sx={{ display: "block", color: "text.secondary" }}>Read from the page</Typography>
                <Typography variant="body2">{res.payment.payeeName || "Payee?"}</Typography>
                <Typography variant="body2" sx={{ fontWeight: 800 }}>S$ {money(bankAmount)}</Typography>
                <Typography variant="caption" sx={{ color: "text.secondary" }}>
                  {res.payment.paymentDate || "date?"}{res.payment.bank ? ` · ${res.payment.bank}` : ""}{res.payment.reference ? ` · ref ${res.payment.reference}` : ""}
                </Typography>
              </Box>
            )}
          </Stack>
          <Stack spacing={1.5} sx={{ minWidth: 0 }}>
            {loading && (
              <Stack direction="row" spacing={1} alignItems="center">
                <CircularProgress size={18} />
                <Typography variant="body2" sx={{ color: "text.secondary" }}>Reading the payment page…</Typography>
              </Stack>
            )}
            {res && (
              <>
                <Autocomplete
                  size="small"
                  options={res.suppliers || []}
                  value={supplier}
                  onChange={(_, v) => setSupplier(v)}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="Supplier"
                      helperText={res.supplier ? `Matched "${res.payment?.payeeName || ""}" to ${res.supplier}` : "No confident match — pick the supplier"}
                    />
                  )}
                />
                {supplier && !rows.length && <Alert severity="info">No outstanding invoices for {supplier}.</Alert>}
                {rows.map((r) => {
                  const d = picks[r.id] || { checked: false, pct: r.percentage == null ? "" : String(r.percentage) };
                  return (
                    <Stack key={r.id} direction="row" spacing={1} alignItems="center">
                      <Checkbox
                        size="small"
                        checked={d.checked}
                        onChange={(e) => setPicks((p) => ({ ...p, [r.id]: { ...d, checked: e.target.checked } }))}
                        sx={{ p: 0.25 }}
                      />
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
                          {r.invoiceNo || "—"} · {money(r.invoiceAmount)}
                          {r.status === "withholding" && <Chip size="small" variant="outlined" label="WITHHELD" sx={{ ml: 0.75, height: 18, color: "#ed6c02", borderColor: "#ed6c02" }} />}
                        </Typography>
                        <Typography variant="caption" sx={{ color: "text.secondary" }} noWrap title={r.siteAddress || ""}>
                          {monthLabel(r.month)}{r.siteAddress ? ` · ${r.siteAddress}` : ""}
                        </Typography>
                      </Box>
                      <TextField
                        size="small"
                        label="%"
                        value={d.pct}
                        onChange={(e) => /^[0-9]*\.?[0-9]*$/.test(e.target.value) && setPicks((p) => ({ ...p, [r.id]: { ...d, pct: e.target.value } }))}
                        inputProps={{ inputMode: "decimal", style: { textAlign: "right", width: 44 } }}
                      />
                      <Typography variant="body2" sx={{ width: 92, textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                        {money(payOf(r))}
                      </Typography>
                    </Stack>
                  );
                })}
                {selected.length > 0 && (
                  <Alert severity={Math.abs(diff) <= 0.05 ? "success" : "warning"} icon={false}>
                    Selected {selected.length} invoice{selected.length === 1 ? "" : "s"} — S$ {money(selectedTotal)}
                    {bankAmount ? (Math.abs(diff) <= 0.05 ? " · matches the bank payment" : ` · bank payment is S$ ${money(bankAmount)} (${diff > 0 ? "+" : ""}${money(diff)})`) : ""}
                  </Alert>
                )}
                <Stack direction="row" spacing={1.5} alignItems="center">
                  <TextField type="date" label="Payment date" size="small" value={payDate} onChange={(e) => e.target.value && setPayDate(e.target.value)} InputLabelProps={{ shrink: true }} />
                </Stack>
              </>
            )}
          </Stack>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} sx={{ textTransform: "none" }}>Close</Button>
        <Button variant="contained" color="success" startIcon={<CheckCircleIcon />} disabled={busy || !selected.length} onClick={settle} sx={{ textTransform: "none" }}>
          Mark {selected.length || ""} paid
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// Edit / add dialog — the sheet's cells, with the invoice file alongside.
function PayableDialog({
  row,
  month,
  busy,
  projects,
  onClose,
  onSave,
  onPaid,
  onUnpaid,
  onWithhold,
  onDelete,
}: {
  row: Row | null;
  month?: string;
  busy: boolean;
  projects: ProjectOption[];
  onClose: () => void;
  onSave: (dto: any) => void;
  onPaid?: (paymentDate?: string) => void;
  onUnpaid?: () => void;
  onWithhold?: () => void;
  onDelete?: () => void;
}) {
  const [f, setF] = useState<any>({
    invoiceNo: row?.invoiceNo || "",
    invoiceDate: row?.invoiceDate ? String(row.invoiceDate).slice(0, 10) : "",
    supplierName: row?.supplierName || "",
    siteAddress: row?.siteAddress || "",
    invoiceAmount: row?.invoiceAmount ?? "",
    percentage: row?.percentage ?? "",
    remarks: row?.remarks || "",
    submittedBy: row?.submittedBy || "",
    projectId: row?.projectId || "",
  });
  const project = useMemo(
    () => projects.find((p) => p.id === f.projectId) || (row?.projectId && row.projectId === f.projectId ? { id: row.projectId, name: row.projectName || "Project", address: null } : null),
    [projects, f.projectId, row],
  );
  const [payDate, setPayDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const set = (k: string) => (e: any) => setF((p: any) => ({ ...p, [k]: e.target.value }));
  const isPdf = (row?.attachmentUrl || "").toLowerCase().includes(".pdf");
  const derived =
    f.invoiceAmount !== "" && f.percentage !== ""
      ? (Number(f.invoiceAmount) || 0) * (1 - (Number(f.percentage) || 0) / 100)
      : Number(f.invoiceAmount) || 0;

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth={row?.attachmentUrl ? "md" : "sm"}>
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        {row ? row.invoiceNo || "Payable" : "Add payable"}
        {row && (
          <Chip
            size="small"
            variant="outlined"
            color={row.status === "paid" ? "success" : "warning"}
            label={row.status === "paid" ? `Paid ${fmtDate(row.paymentDate)}` : row.status === "withholding" ? "Withheld" : "To pay"}
            sx={row.status === "withholding" ? { color: "#ed6c02", borderColor: "#ed6c02" } : undefined}
          />
        )}
        {row && month === undefined && (
          <Typography variant="caption" sx={{ color: "text.secondary" }}>
            {monthLabel(row.month)}
          </Typography>
        )}
      </DialogTitle>
      <DialogContent dividers>
        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: row?.attachmentUrl ? "1fr 1fr" : "1fr" }, gap: 2 }}>
          {row?.attachmentUrl && (
            <Box sx={{ border: 1, borderColor: "divider", borderRadius: 1.5, overflow: "hidden", minHeight: 320, bgcolor: "background.default" }}>
              {isPdf ? (
                <iframe title="Invoice" src={row.attachmentUrl} style={{ width: "100%", height: "100%", minHeight: 420, border: 0 }} />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={row.attachmentUrl} alt={row.filename || "invoice"} style={{ width: "100%", display: "block" }} />
              )}
            </Box>
          )}
          <Stack spacing={1.5}>
            <Stack direction="row" spacing={1.5}>
              <TextField label="Invoice no." size="small" value={f.invoiceNo} onChange={set("invoiceNo")} sx={{ flex: 1 }} />
              <TextField type="date" label="Invoice date" size="small" value={f.invoiceDate} onChange={set("invoiceDate")} InputLabelProps={{ shrink: true }} sx={{ width: 170 }} />
            </Stack>
            <TextField label="Contractor company" size="small" value={f.supplierName} onChange={set("supplierName")} />
            <TextField label="Site address" size="small" value={f.siteAddress} onChange={set("siteAddress")} multiline maxRows={2} />
            {/* Site-address → project verification (Summer): link the invoice to
                the designer's job; unmatched rows show an amber warning. */}
            <Autocomplete
              size="small"
              options={projects}
              value={project}
              onChange={(_, v) => setF((p: any) => ({ ...p, projectId: v?.id || "" }))}
              getOptionLabel={(o) => o?.name || ""}
              isOptionEqualToValue={(o, v) => o.id === v.id}
              filterOptions={(opts, { inputValue }) => {
                const q = inputValue.trim().toLowerCase();
                if (!q) return opts;
                return opts.filter((o) => [o.name, o.address, o.clientName].some((v) => (v || "").toLowerCase().includes(q)));
              }}
              renderOption={(props, o) => (
                <li {...props} key={o.id}>
                  <Box>
                    <Typography variant="body2">
                      {o.name}
                      {o.clientName && o.clientName !== o.name ? ` — ${o.clientName}` : ""}
                    </Typography>
                    {o.address && (
                      <Typography variant="caption" sx={{ color: "text.secondary" }}>
                        {o.address}
                      </Typography>
                    )}
                  </Box>
                </li>
              )}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Project"
                  helperText={!f.projectId && f.siteAddress ? "No project matched this site address — pick the job it belongs to" : undefined}
                  FormHelperTextProps={{ sx: { color: "warning.main", mx: 0 } }}
                />
              )}
            />
            <Stack direction="row" spacing={1.5}>
              <TextField label="Invoice amount" size="small" value={f.invoiceAmount} onChange={set("invoiceAmount")} inputProps={{ inputMode: "decimal" }} sx={{ flex: 1 }} />
              <TextField label="%" size="small" value={f.percentage} onChange={set("percentage")} inputProps={{ inputMode: "decimal" }} sx={{ width: 90 }} />
            </Stack>
            <Typography variant="body2" sx={{ color: "text.secondary" }}>
              Payment amount: <b>S$ {money(derived)}</b>
            </Typography>
            <TextField label="Remarks" size="small" value={f.remarks} onChange={set("remarks")} multiline maxRows={3} />
            <TextField label="Submitted by" size="small" value={f.submittedBy} onChange={set("submittedBy")} />
            {row && row.status !== "paid" && onPaid && (
              <>
                <Divider />
                <Stack direction="row" spacing={1.5} alignItems="center">
                  <TextField type="date" label="Payment date" size="small" value={payDate} onChange={(e) => setPayDate(e.target.value)} InputLabelProps={{ shrink: true }} />
                  <Button variant="contained" color="success" startIcon={<CheckCircleIcon />} disabled={busy} onClick={() => onPaid(payDate)} sx={{ textTransform: "none" }}>
                    Mark paid
                  </Button>
                  {row.status === "to_pay" && onWithhold && (
                    <Button size="small" disabled={busy} onClick={onWithhold} sx={{ textTransform: "none", color: "#ed6c02" }}>
                      Withhold
                    </Button>
                  )}
                </Stack>
              </>
            )}
            {row?.status === "withholding" && onUnpaid && (
              <Alert severity="warning" icon={false} sx={{ color: "#ed6c02" }} action={<Button color="inherit" size="small" disabled={busy} onClick={onUnpaid} sx={{ textTransform: "none" }}>Release</Button>}>
                Payment WITHHELD — excluded from the To-pay total until released or paid.
              </Alert>
            )}
            {row?.status === "paid" && onUnpaid && (
              <Alert severity="success" action={<Button color="inherit" size="small" disabled={busy} onClick={onUnpaid} sx={{ textTransform: "none" }}>Undo</Button>}>
                Paid on {fmtDate(row.paymentDate)}{row.approvedBy ? ` · approved by ${row.approvedBy}` : ""}.
              </Alert>
            )}
          </Stack>
        </Box>
      </DialogContent>
      <DialogActions>
        {row && onDelete && (
          <Button color="error" disabled={busy} onClick={() => window.confirm("Delete this payable row?") && onDelete()} sx={{ textTransform: "none", mr: "auto" }}>
            Delete
          </Button>
        )}
        <Button onClick={onClose} sx={{ textTransform: "none" }}>Close</Button>
        <Button variant="contained" disabled={busy} onClick={() => onSave(f)} sx={{ textTransform: "none" }}>
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}
