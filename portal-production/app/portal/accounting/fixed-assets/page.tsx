"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import RefreshIcon from "@mui/icons-material/Refresh";
import EditIcon from "@mui/icons-material/Edit";
import CloseIcon from "@mui/icons-material/Close";
import { toast } from "react-toastify";
import { useAccountingApi } from "../_lib/api";
import PageTable from "@/components/PageTable";

type FA = {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  category?: string | null;
  cost: number;
  salvageValue: number;
  inServiceDate: string;
  method: "STRAIGHT_LINE" | "DECLINING_BALANCE" | "UNITS_OF_PRODUCTION";
  usefulLifeMonths?: number | null;
  decliningRate?: number | null;
  totalUnits?: number | null;
  unitsPerPeriod?: number | null;
  disposedAt?: string | null;
  isActive: boolean;
  entries?: Array<{ amount: number; periodYear: number; periodMonth: number }>;
};

const METHOD_LABELS: Record<string, string> = {
  STRAIGHT_LINE: "Straight-line",
  DECLINING_BALANCE: "Declining balance",
  UNITS_OF_PRODUCTION: "Units of production",
};

const fmt = (n: number) =>
  n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function FixedAssetsPage() {
  const { request } = useAccountingApi();
  const [items, setItems] = useState<FA[]>([]);
  const [loading, setLoading] = useState(true);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<FA | null>(null);

  // PageTable-driven state
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<any>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await request<FA[]>("/fixed-assets?includeInactive=true");
      setItems(res || []);
    } catch (e: any) {
      toast.error(e?.message || "Failed to load fixed assets");
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => {
    load();
  }, [load]);

  const summary = useMemo(() => {
    const active = items.filter((f) => f.isActive && !f.disposedAt);
    const totalCost = active.reduce((s, f) => s + f.cost, 0);
    return { count: active.length, totalCost };
  }, [items]);

  const visible = useMemo(() => {
    const q = (search || "").trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (f) =>
        f.code.toLowerCase().includes(q) ||
        f.name.toLowerCase().includes(q) ||
        (f.category || "").toLowerCase().includes(q),
    );
  }, [items, search]);

  useEffect(() => { setPage(1); }, [search]);

  const pageCount = Math.max(1, Math.ceil(visible.length / limit));
  const paged = useMemo(
    () => visible.slice((page - 1) * limit, page * limit),
    [visible, page, limit],
  );

  const columns = useMemo(() => [
    {
      accessorKey: "code",
      header: "Code",
      cell: ({ row }: any) => (
        <Box sx={{ fontFamily: "monospace", fontWeight: 600 }}>{row.original.code}</Box>
      ),
    },
    {
      accessorKey: "name",
      header: "Name",
      cell: ({ row }: any) => {
        const f: FA = row.original;
        return (
          <Box>
            <Typography variant="body2" sx={{ fontWeight: 500 }}>{f.name}</Typography>
            {f.category && (
              <Typography variant="caption" sx={{ color: "text.secondary" }}>{f.category}</Typography>
            )}
          </Box>
        );
      },
    },
    {
      accessorKey: "method",
      header: "Method",
      cell: ({ row }: any) => (
        <Chip size="small" variant="outlined" label={METHOD_LABELS[row.original.method] || row.original.method} sx={{ fontSize: "0.7rem" }} />
      ),
    },
    {
      accessorKey: "cost",
      header: "Cost",
      cell: ({ row }: any) => (
        <Box sx={{ textAlign: "right", fontFamily: "monospace" }}>{fmt(row.original.cost)}</Box>
      ),
    },
    {
      accessorKey: "accumulated",
      header: "Accumulated",
      cell: ({ row }: any) => {
        const accumulated = (row.original.entries || []).reduce((s: number, e: any) => s + e.amount, 0);
        return (
          <Box sx={{ textAlign: "right", fontFamily: "monospace", color: "text.secondary" }}>
            {accumulated > 0 ? `( ${fmt(accumulated)} )` : "—"}
          </Box>
        );
      },
    },
    {
      accessorKey: "bookValue",
      header: "Book value",
      cell: ({ row }: any) => {
        const f: FA = row.original;
        const accumulated = (f.entries || []).reduce((s, e) => s + e.amount, 0);
        return (
          <Box sx={{ textAlign: "right", fontFamily: "monospace", fontWeight: 600 }}>
            {fmt(f.cost - accumulated)}
          </Box>
        );
      },
    },
    {
      accessorKey: "inServiceDate",
      header: "In service",
      cell: ({ row }: any) => (
        <Box sx={{ fontSize: "0.8125rem" }}>{new Date(row.original.inServiceDate).toLocaleDateString()}</Box>
      ),
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }: any) => {
        const f: FA = row.original;
        if (f.disposedAt) return <Chip size="small" label="Disposed" color="default" variant="outlined" sx={{ fontSize: "0.65rem" }} />;
        if (f.isActive) return <Chip size="small" label="Active" color="success" variant="outlined" sx={{ fontSize: "0.65rem" }} />;
        return <Chip size="small" label="Inactive" color="default" variant="outlined" sx={{ fontSize: "0.65rem" }} />;
      },
    },
    {
      accessorKey: "actions",
      header: "",
      cell: ({ row }: any) => (
        <Stack direction="row" justifyContent="flex-end">
          <Tooltip title="Edit">
            <IconButton size="small" onClick={() => { setEditing(row.original); setEditorOpen(true); }}>
              <EditIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>
      ),
    },
  ], []);

  return (
    <Box sx={{ p: 3, display: "flex", flexDirection: "column", gap: 2 }}>
      <Stack direction="row" gap={2}>
        <Paper variant="outlined" sx={{ p: 1.5, minWidth: 160 }}>
          <Typography variant="caption" sx={{ color: "text.secondary", textTransform: "uppercase", fontWeight: 700, fontSize: "0.65rem" }}>
            Active assets
          </Typography>
          <Typography sx={{ fontFamily: "monospace", fontWeight: 700, fontSize: "1.25rem" }}>{summary.count}</Typography>
        </Paper>
        <Paper variant="outlined" sx={{ p: 1.5, minWidth: 200, borderLeft: 3, borderLeftColor: "primary.main" }}>
          <Typography variant="caption" sx={{ color: "text.secondary", textTransform: "uppercase", fontWeight: 700, fontSize: "0.65rem" }}>
            Total cost basis
          </Typography>
          <Typography sx={{ fontFamily: "monospace", fontWeight: 700, fontSize: "1.25rem" }}>{fmt(summary.totalCost)}</Typography>
        </Paper>
        <Box sx={{ flex: 1 }} />
        <Button startIcon={<RefreshIcon />} variant="outlined" size="small" onClick={load} sx={{ alignSelf: "flex-start" }}>
          Refresh
        </Button>
      </Stack>

      <PageTable
        columns={columns}
        data={paged}
        tableName="Fixed Assets Register"
        subTitle="Vehicles, machinery, office equipment. Depreciation auto-posts during Month-End Close."
        buttonName="New Fixed Asset"
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
        pageCount={pageCount}
        totalDocs={visible.length}
      />

      <FAEditor
        open={editorOpen}
        editing={editing}
        request={request}
        onClose={() => setEditorOpen(false)}
        onSaved={() => {
          setEditorOpen(false);
          load();
        }}
      />
    </Box>
  );
}

function FAEditor({
  open,
  editing,
  request,
  onClose,
  onSaved,
}: {
  open: boolean;
  editing: FA | null;
  request: any;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<any>({
    code: "",
    name: "",
    description: "",
    category: "",
    cost: 0,
    salvageValue: 0,
    inServiceDate: new Date().toISOString().slice(0, 10),
    method: "STRAIGHT_LINE",
    usefulLifeMonths: 36,
    decliningRate: 20,
    totalUnits: 0,
    unitsPerPeriod: 0,
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setForm({
        code: editing.code,
        name: editing.name,
        description: editing.description || "",
        category: editing.category || "",
        cost: editing.cost,
        salvageValue: editing.salvageValue,
        inServiceDate: editing.inServiceDate.slice(0, 10),
        method: editing.method,
        usefulLifeMonths: editing.usefulLifeMonths ?? 36,
        decliningRate: editing.decliningRate ?? 20,
        totalUnits: editing.totalUnits ?? 0,
        unitsPerPeriod: editing.unitsPerPeriod ?? 0,
      });
    } else {
      setForm({
        code: "",
        name: "",
        description: "",
        category: "",
        cost: 0,
        salvageValue: 0,
        inServiceDate: new Date().toISOString().slice(0, 10),
        method: "STRAIGHT_LINE",
        usefulLifeMonths: 36,
        decliningRate: 20,
        totalUnits: 0,
        unitsPerPeriod: 0,
      });
    }
  }, [open, editing]);

  const submit = async () => {
    if (!form.name?.trim()) return toast.error("Name is required");
    if (!(form.cost > 0)) return toast.error("Cost must be > 0");
    setSaving(true);
    try {
      const body: any = {
        ...form,
        code: form.code?.trim() || undefined,
      };
      const url = editing ? `/fixed-assets/${editing.id}` : "/fixed-assets";
      await request(url, { method: editing ? "PATCH" : "POST", body: JSON.stringify(body) });
      toast.success(editing ? "Updated" : "Created");
      onSaved();
    } catch (e: any) {
      toast.error(e?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={() => !saving && onClose()} fullWidth maxWidth="md">
      <DialogTitle>
        <Stack direction="row" justifyContent="space-between" alignItems="center">
          <Typography variant="h6" sx={{ fontWeight: 700 }}>
            {editing ? "Edit Fixed Asset" : "New Fixed Asset"}
          </Typography>
          <IconButton onClick={onClose} size="small" disabled={saving}><CloseIcon fontSize="small" /></IconButton>
        </Stack>
      </DialogTitle>
      <DialogContent dividers>
        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" }, gap: 2 }}>
          <TextField size="small" label="Code (auto if blank)" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} disabled={saving || !!editing} />
          <TextField size="small" label="Category (optional)" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} disabled={saving} />
          <TextField size="small" label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} disabled={saving} required sx={{ gridColumn: { md: "1 / -1" } }} />
          <TextField size="small" label="Description" multiline minRows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} disabled={saving} sx={{ gridColumn: { md: "1 / -1" } }} />
          <TextField size="small" type="number" label="Cost" value={form.cost} onChange={(e) => setForm({ ...form, cost: parseFloat(e.target.value) || 0 })} disabled={saving} inputProps={{ step: "0.01", min: 0 }} />
          <TextField size="small" type="number" label="Salvage Value" value={form.salvageValue} onChange={(e) => setForm({ ...form, salvageValue: parseFloat(e.target.value) || 0 })} disabled={saving} inputProps={{ step: "0.01", min: 0 }} />
          <TextField size="small" type="date" label="In Service Date" InputLabelProps={{ shrink: true }} value={form.inServiceDate} onChange={(e) => setForm({ ...form, inServiceDate: e.target.value })} disabled={saving} />
          <TextField select size="small" label="Method" value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })} disabled={saving}>
            <MenuItem value="STRAIGHT_LINE">Straight-line</MenuItem>
            <MenuItem value="DECLINING_BALANCE">Declining balance</MenuItem>
            <MenuItem value="UNITS_OF_PRODUCTION">Units of production</MenuItem>
          </TextField>

          {form.method === "STRAIGHT_LINE" && (
            <TextField size="small" type="number" label="Useful life (months)" value={form.usefulLifeMonths} onChange={(e) => setForm({ ...form, usefulLifeMonths: parseInt(e.target.value) || 0 })} disabled={saving} inputProps={{ min: 1 }} helperText="e.g. 36 for a 3-year asset" />
          )}
          {form.method === "DECLINING_BALANCE" && (
            <TextField size="small" type="number" label="Declining rate (% per year)" value={form.decliningRate} onChange={(e) => setForm({ ...form, decliningRate: parseFloat(e.target.value) || 0 })} disabled={saving} inputProps={{ min: 0.1, step: 0.1 }} helperText="e.g. 20 = 20% reducing-balance" />
          )}
          {form.method === "UNITS_OF_PRODUCTION" && (
            <>
              <TextField size="small" type="number" label="Total life-units" value={form.totalUnits} onChange={(e) => setForm({ ...form, totalUnits: parseFloat(e.target.value) || 0 })} disabled={saving} inputProps={{ min: 0 }} />
              <TextField size="small" type="number" label="Units per period" value={form.unitsPerPeriod} onChange={(e) => setForm({ ...form, unitsPerPeriod: parseFloat(e.target.value) || 0 })} disabled={saving} inputProps={{ min: 0 }} helperText="Update each month for usage-based depreciation" />
            </>
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>Cancel</Button>
        <Button variant="contained" onClick={submit} disabled={saving} startIcon={saving ? <CircularProgress size={14} color="inherit" /> : undefined}>
          {editing ? "Save changes" : "Create"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
