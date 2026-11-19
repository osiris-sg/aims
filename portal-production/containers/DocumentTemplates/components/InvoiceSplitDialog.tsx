"use client";

// Split payment (features.enableInvoiceSplit, 2026-11-17; WCT (S), Racking, BC Air).
// Two modes: By rate (-1 starts at 100%, "Add invoice" adds -2, -3 …, the
// rates total 100%) and Deposit + rate (-1 a deposit as % or an amount, the
// remainder by rate). Live amounts per part from helpers/invoiceSplit.ts; the
// API (POST /documents/:id/split-invoice) re-checks and writes.

import React, { useMemo, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  InputAdornment,
  MenuItem,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import CloseIcon from "@mui/icons-material/Close";
import { request } from "@/helpers/request";
import { fmtMoney, previewSplit, type SplitMode, type SplitPlan } from "@/helpers/invoiceSplit";

const n = (v: string) => (v.trim() === "" ? NaN : Number(v));
const money = (v: number) => v.toLocaleString("en-SG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function InvoiceSplitDialog({
  open,
  onClose,
  documentId,
  baseNumber,
  config,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  documentId: string;
  baseNumber: string;
  config: any;
  onDone: (out: { parts: Array<{ id: string; name: string }> }) => void;
}) {
  const { getToken } = useAuth();
  const [mode, setMode] = useState<SplitMode>("rate");
  const [rates, setRates] = useState<string[]>(["100"]);
  const [depKind, setDepKind] = useState<"percent" | "amount">("percent");
  const [dep, setDep] = useState("");
  const [rest, setRest] = useState<string[]>(["100"]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const plan: SplitPlan = useMemo(
    () =>
      mode === "rate"
        ? { mode, parts: rates.map(n) }
        : { mode, parts: rest.map(n), deposit: depKind === "percent" ? { percent: dep.trim() === "" ? null : Number(dep) } : { amount: dep.trim() === "" ? null : Number(dep) } },
    [mode, rates, rest, dep, depKind],
  );
  const preview = useMemo(() => previewSplit(config, plan, baseNumber), [config, plan, baseNumber]);

  const rows = mode === "rate" ? rates : rest;
  const setRows = mode === "rate" ? setRates : setRest;
  // Part number of a rate row: rate mode -1.., deposit mode -2.. (the deposit is -1).
  const partNo = (i: number) => (mode === "rate" ? i + 1 : i + 2);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const token = await getToken();
      const res: any = await request({ path: `/documents/${documentId}/split-invoice`, method: "POST", ownError: true }, plan, token ?? undefined);
      if (res?.success === false) throw new Error(res?.message || "Could not split the invoice");
      onDone(res?.data ?? res);
    } catch (e: any) {
      setError(e?.message || "Could not split the invoice");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} fullWidth maxWidth="md">
      <DialogTitle>Split payment</DialogTitle>
      <DialogContent>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2} alignItems={{ sm: "center" }} sx={{ mt: 1, mb: 2 }}>
          <ToggleButtonGroup size="small" exclusive value={mode} onChange={(_e, v) => v && setMode(v)}>
            <ToggleButton value="rate">By rate</ToggleButton>
            <ToggleButton value="deposit">Deposit + rate</ToggleButton>
          </ToggleButtonGroup>
          <Box sx={{ flex: 1 }} />
          <Typography variant="body2" color="text.secondary">
            Contract value {fmtMoney(preview.contractValue)}
          </Typography>
        </Stack>

        <Stack spacing={1} sx={{ mb: 2 }}>
          {mode === "deposit" && (
            <Stack direction="row" spacing={1} alignItems="center">
              <Typography variant="body2" sx={{ width: 150, fontVariantNumeric: "tabular-nums" }}>
                {baseNumber}-1
              </Typography>
              <Select size="small" value={depKind} onChange={(e) => setDepKind(e.target.value as any)} sx={{ width: 130 }}>
                <MenuItem value="percent">Deposit %</MenuItem>
                <MenuItem value="amount">Deposit $</MenuItem>
              </Select>
              <TextField
                size="small"
                value={dep}
                onChange={(e) => setDep(e.target.value.replace(/[^\d.]/g, ""))}
                inputProps={{ inputMode: "decimal", "aria-label": "Deposit" }}
                InputProps={depKind === "percent" ? { endAdornment: <InputAdornment position="end">%</InputAdornment> } : { startAdornment: <InputAdornment position="start">$</InputAdornment> }}
                sx={{ width: 160 }}
              />
            </Stack>
          )}
          {rows.map((r, i) => (
            <Stack key={i} direction="row" spacing={1} alignItems="center">
              <Typography variant="body2" sx={{ width: 150, fontVariantNumeric: "tabular-nums" }}>
                {baseNumber}-{partNo(i)}
              </Typography>
              <TextField
                size="small"
                value={r}
                onChange={(e) => setRows(rows.map((x, j) => (j === i ? e.target.value.replace(/[^\d.]/g, "") : x)))}
                inputProps={{ inputMode: "decimal", "aria-label": `Rate of ${baseNumber}-${partNo(i)}` }}
                InputProps={{ endAdornment: <InputAdornment position="end">{mode === "deposit" ? "% of remainder" : "%"}</InputAdornment> }}
                sx={{ width: mode === "deposit" ? 230 : 160 }}
              />
              {rows.length > 1 && (
                <IconButton size="small" aria-label="Remove" onClick={() => setRows(rows.filter((_x, j) => j !== i))}>
                  <CloseIcon fontSize="small" />
                </IconButton>
              )}
            </Stack>
          ))}
          <Box>
            <Button size="small" startIcon={<AddIcon />} onClick={() => setRows([...rows, ""])} disabled={rows.length + (mode === "deposit" ? 1 : 0) >= 20}>
              Add invoice
            </Button>
          </Box>
        </Stack>

        {preview.error ? (
          <Alert severity="info">{preview.error}</Alert>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Invoice</TableCell>
                <TableCell>Line</TableCell>
                <TableCell align="right">Excl. GST</TableCell>
                <TableCell align="right">GST</TableCell>
                <TableCell align="right">Total</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {preview.parts.map((p) => (
                <TableRow key={p.label}>
                  <TableCell sx={{ fontWeight: 600, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{p.label}</TableCell>
                  <TableCell>{p.description}</TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums" }}>{money(p.subTotal)}</TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums" }}>{money(p.gstAmount)}</TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{money(p.total)}</TableCell>
                </TableRow>
              ))}
              <TableRow>
                <TableCell colSpan={2} sx={{ fontWeight: 700 }}>
                  Total
                </TableCell>
                {(["subTotal", "gstAmount", "total"] as const).map((k) => (
                  <TableCell key={k} align="right" sx={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                    {money(Math.round(preview.parts.reduce((s, p) => s + p[k], 0) * 100) / 100)}
                  </TableCell>
                ))}
              </TableRow>
            </TableBody>
          </Table>
        )}
        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button variant="contained" disableElevation disabled={!!preview.error || saving} onClick={() => void save()} startIcon={saving ? <CircularProgress size={14} color="inherit" /> : undefined}>
          {preview.parts.length ? `Split into ${preview.parts.length} invoices` : "Split"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
