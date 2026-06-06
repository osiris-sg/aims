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
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import RefreshIcon from "@mui/icons-material/Refresh";
import EditIcon from "@mui/icons-material/Edit";
import CloseIcon from "@mui/icons-material/Close";
import { toast } from "react-toastify";
import { useAccountingApi } from "../_lib/api";

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

  return (
    <Box sx={{ p: 3, display: "flex", flexDirection: "column", gap: 2 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 700 }}>
            Fixed Assets Register
          </Typography>
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            Vehicles, machinery, office equipment. Depreciation auto-posts during Month-End Close.
          </Typography>
        </Box>
        <Stack direction="row" gap={1}>
          <Button startIcon={<RefreshIcon />} variant="outlined" size="small" onClick={load}>
            Refresh
          </Button>
          <Button
            startIcon={<AddIcon />}
            variant="contained"
            size="small"
            onClick={() => {
              setEditing(null);
              setEditorOpen(true);
            }}
          >
            New Fixed Asset
          </Button>
        </Stack>
      </Stack>

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
      </Stack>

      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 700, width: 100 }}>Code</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>Name</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>Method</TableCell>
              <TableCell align="right" sx={{ fontWeight: 700 }}>Cost</TableCell>
              <TableCell align="right" sx={{ fontWeight: 700 }}>Accumulated</TableCell>
              <TableCell align="right" sx={{ fontWeight: 700 }}>Book value</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>In service</TableCell>
              <TableCell sx={{ fontWeight: 700, width: 80 }}>Status</TableCell>
              <TableCell align="right" sx={{ fontWeight: 700 }} />
            </TableRow>
          </TableHead>
          <TableBody>
            {loading && (
              <TableRow>
                <TableCell colSpan={9} align="center" sx={{ py: 4 }}>
                  <CircularProgress size={20} />
                </TableCell>
              </TableRow>
            )}
            {!loading && items.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} align="center" sx={{ py: 4, color: "text.secondary" }}>
                  No fixed assets yet. Click "New Fixed Asset" or flag a PO line as isFixedAsset to auto-create.
                </TableCell>
              </TableRow>
            )}
            {items.map((f) => {
              const accumulated = (f.entries || []).reduce((s, e) => s + e.amount, 0);
              const bookValue = f.cost - accumulated;
              return (
                <TableRow key={f.id} hover sx={{ opacity: f.isActive ? 1 : 0.5 }}>
                  <TableCell sx={{ fontFamily: "monospace", fontWeight: 600 }}>{f.code}</TableCell>
                  <TableCell>
                    <Box>
                      <Typography variant="body2" sx={{ fontWeight: 500 }}>{f.name}</Typography>
                      {f.category && (
                        <Typography variant="caption" sx={{ color: "text.secondary" }}>{f.category}</Typography>
                      )}
                    </Box>
                  </TableCell>
                  <TableCell>
                    <Chip size="small" variant="outlined" label={METHOD_LABELS[f.method] || f.method} sx={{ fontSize: "0.7rem" }} />
                  </TableCell>
                  <TableCell align="right" sx={{ fontFamily: "monospace" }}>{fmt(f.cost)}</TableCell>
                  <TableCell align="right" sx={{ fontFamily: "monospace", color: "text.secondary" }}>
                    {accumulated > 0 ? `( ${fmt(accumulated)} )` : "—"}
                  </TableCell>
                  <TableCell align="right" sx={{ fontFamily: "monospace", fontWeight: 600 }}>{fmt(bookValue)}</TableCell>
                  <TableCell sx={{ fontSize: "0.8125rem" }}>{new Date(f.inServiceDate).toLocaleDateString()}</TableCell>
                  <TableCell>
                    {f.disposedAt ? (
                      <Chip size="small" label="Disposed" color="default" variant="outlined" sx={{ fontSize: "0.65rem" }} />
                    ) : f.isActive ? (
                      <Chip size="small" label="Active" color="success" variant="outlined" sx={{ fontSize: "0.65rem" }} />
                    ) : (
                      <Chip size="small" label="Inactive" color="default" variant="outlined" sx={{ fontSize: "0.65rem" }} />
                    )}
                  </TableCell>
                  <TableCell align="right">
                    <Tooltip title="Edit">
                      <IconButton size="small" onClick={() => { setEditing(f); setEditorOpen(true); }}>
                        <EditIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>

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
