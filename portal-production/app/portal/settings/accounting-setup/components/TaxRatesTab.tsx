"use client";

// GST master file — the legacy 1-7 tax codes (Output/Input × Standard/Zero/
// Exempt + Major Exporter), rates accountant-editable (7% era → 9% today).
// Backend seeds the default set on first load.

import { useCallback, useEffect, useState } from "react";
import {
  Box, Button, Chip, CircularProgress, IconButton, MenuItem, Paper, Stack, Switch,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Tooltip, Typography, alpha,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import CheckIcon from "@mui/icons-material/Check";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import { toast } from "react-toastify";
import { useAuth } from "@clerk/nextjs";
import { useOrganization } from "@hooks/useOrganization";
import { request } from "@/helpers/request";

type TaxRate = {
  id: string; code: string; name: string; rate: number;
  direction: "OUTPUT" | "INPUT"; category: string; isActive: boolean; isSystem: boolean;
};

const CATEGORY_LABEL: Record<string, string> = {
  STANDARD: "Standard-rated",
  ZERO_RATED: "Zero-rated",
  EXEMPT: "Exempt",
  MAJOR_EXPORTER: "Major Exporter Scheme",
};

export default function TaxRatesTab() {
  const { getToken } = useAuth();
  const { organization } = useOrganization();
  const [rows, setRows] = useState<TaxRate[]>([]);
  const [loading, setLoading] = useState(true);
  const [dirtyRates, setDirtyRates] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ code: "", name: "", rate: "9", direction: "OUTPUT", category: "STANDARD" });

  const call = useCallback(async (path: string, method: string, body?: any) => {
    const token = await getToken();
    if (!token || !organization?.id) throw new Error("Not authenticated");
    const res = await request({ path, method: method as any }, body ?? {}, token);
    if (res?.success === false) throw new Error(res?.message || "Request failed");
    return res?.data ?? res;
  }, [getToken, organization?.id]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await call("/accounting/tax-rates", "GET");
      setRows(Array.isArray(list) ? list : []);
      setDirtyRates({});
    } catch (e: any) {
      toast.error(e?.message || "Failed to load tax rates");
    } finally {
      setLoading(false);
    }
  }, [call]);

  useEffect(() => { if (organization?.id) load(); }, [organization?.id, load]);

  const saveRate = async (row: TaxRate) => {
    const newRate = Number(dirtyRates[row.id]);
    if (Number.isNaN(newRate) || newRate < 0) return toast.warn("Enter a valid rate");
    setSavingId(row.id);
    try {
      await call(`/accounting/tax-rates/${row.id}`, "PATCH", { rate: newRate });
      toast.success(`${row.name} → ${newRate}%`);
      load();
    } catch (e: any) {
      toast.error(e?.message || "Save failed");
    } finally {
      setSavingId(null);
    }
  };

  const toggleActive = async (row: TaxRate) => {
    try {
      await call(`/accounting/tax-rates/${row.id}`, "PATCH", { isActive: !row.isActive });
      load();
    } catch (e: any) {
      toast.error(e?.message || "Failed");
    }
  };

  const removeRow = async (row: TaxRate) => {
    if (!confirm(`Delete tax code ${row.code} — ${row.name}?`)) return;
    try {
      await call(`/accounting/tax-rates/${row.id}`, "DELETE");
      load();
    } catch (e: any) {
      toast.error(e?.message || "Delete failed");
    }
  };

  const addRow = async () => {
    try {
      await call("/accounting/tax-rates", "POST", { ...draft, rate: Number(draft.rate) || 0 });
      setAdding(false);
      setDraft({ code: "", name: "", rate: "9", direction: "OUTPUT", category: "STANDARD" });
      load();
    } catch (e: any) {
      toast.error(e?.message || "Add failed");
    }
  };

  if (loading) {
    return <Box sx={{ display: "flex", justifyContent: "center", p: 6 }}><CircularProgress /></Box>;
  }

  return (
    <Box sx={{ maxWidth: 900 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" sx={{ mb: 2 }}>
        <Box>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>GST tax codes</Typography>
          <Typography variant="caption" color="text.secondary">
            The master list of GST treatments — every document line will carry one of these codes, which drives the F5 boxes
            (standard-rated → Box 1/6 or 5/7, zero-rated → Box 2, exempt → Box 3). Edit the rate here when IRAS changes it.
          </Typography>
        </Box>
        <Button size="small" variant="outlined" startIcon={<AddIcon />} onClick={() => setAdding(true)}>Add code</Button>
      </Stack>

      <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 2 }}>
        <Table size="small">
          <TableHead>
            <TableRow sx={{ bgcolor: (t) => alpha(t.palette.text.primary, 0.03) }}>
              <TableCell sx={{ fontWeight: 700, width: 70 }}>Code</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>Name</TableCell>
              <TableCell sx={{ fontWeight: 700, width: 110 }}>Direction</TableCell>
              <TableCell sx={{ fontWeight: 700, width: 170 }}>Category</TableCell>
              <TableCell sx={{ fontWeight: 700, width: 140 }} align="right">Rate %</TableCell>
              <TableCell sx={{ fontWeight: 700, width: 90 }} align="center">Active</TableCell>
              <TableCell sx={{ width: 70 }} />
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((r) => {
              const dirty = dirtyRates[r.id] !== undefined && Number(dirtyRates[r.id]) !== r.rate;
              return (
                <TableRow key={r.id} sx={{ opacity: r.isActive ? 1 : 0.5 }}>
                  <TableCell><Typography variant="body2" sx={{ fontWeight: 700 }}>{r.code}</Typography></TableCell>
                  <TableCell>{r.name}</TableCell>
                  <TableCell>
                    <Chip size="small" label={r.direction === "OUTPUT" ? "Output (sales)" : "Input (purchases)"}
                      color={r.direction === "OUTPUT" ? "info" : "default"} variant="outlined" />
                  </TableCell>
                  <TableCell>{CATEGORY_LABEL[r.category] || r.category}</TableCell>
                  <TableCell align="right">
                    <Stack direction="row" gap={0.5} justifyContent="flex-end" alignItems="center">
                      <TextField
                        size="small" type="number" value={dirtyRates[r.id] ?? String(r.rate)}
                        onChange={(e) => setDirtyRates((d) => ({ ...d, [r.id]: e.target.value }))}
                        sx={{ width: 90 }} inputProps={{ step: "0.1", min: 0, style: { textAlign: "right" } }}
                      />
                      {dirty && (
                        <Tooltip title="Save rate">
                          <IconButton size="small" color="primary" disabled={savingId === r.id} onClick={() => saveRate(r)}>
                            {savingId === r.id ? <CircularProgress size={14} /> : <CheckIcon fontSize="small" />}
                          </IconButton>
                        </Tooltip>
                      )}
                    </Stack>
                  </TableCell>
                  <TableCell align="center">
                    <Switch size="small" checked={r.isActive} onChange={() => toggleActive(r)} />
                  </TableCell>
                  <TableCell align="right">
                    {!r.isSystem && (
                      <IconButton size="small" onClick={() => removeRow(r)}><DeleteOutlineIcon fontSize="small" /></IconButton>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
            {adding && (
              <TableRow>
                <TableCell><TextField size="small" value={draft.code} onChange={(e) => setDraft((d) => ({ ...d, code: e.target.value }))} sx={{ width: 60 }} placeholder="8" /></TableCell>
                <TableCell><TextField size="small" fullWidth value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} placeholder="e.g. Import GST (ME suspended)" /></TableCell>
                <TableCell>
                  <TextField select size="small" value={draft.direction} onChange={(e) => setDraft((d) => ({ ...d, direction: e.target.value }))}>
                    <MenuItem value="OUTPUT">Output</MenuItem>
                    <MenuItem value="INPUT">Input</MenuItem>
                  </TextField>
                </TableCell>
                <TableCell>
                  <TextField select size="small" value={draft.category} onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value }))}>
                    {Object.entries(CATEGORY_LABEL).map(([v, l]) => (<MenuItem key={v} value={v}>{l}</MenuItem>))}
                  </TextField>
                </TableCell>
                <TableCell align="right"><TextField size="small" type="number" value={draft.rate} onChange={(e) => setDraft((d) => ({ ...d, rate: e.target.value }))} sx={{ width: 90 }} /></TableCell>
                <TableCell align="center" colSpan={2}>
                  <Stack direction="row" gap={0.5} justifyContent="center">
                    <Button size="small" variant="contained" onClick={addRow}>Add</Button>
                    <Button size="small" onClick={() => setAdding(false)}>Cancel</Button>
                  </Stack>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}
