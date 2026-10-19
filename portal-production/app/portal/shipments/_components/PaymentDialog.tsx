/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

// Record (or edit / allocate) one bank movement: direction, date, amount,
// account, the proof (uploaded onto the step it pays, as before) and what it
// paid — one row per PI / CI / invoice / vendor invoice / import tax. The
// allocations should add up to the amount; the rest shows as unallocated.
// Real case: one Wise transfer of USD 1,247,670.64 paid two CIs and two PIs.

import React, { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Autocomplete, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Grid, IconButton, MenuItem, Stack, TextField, Typography } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/DeleteOutline";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import { ACCOUNT_LABEL, TARGET_LABEL, useShipmentsApi, type AllocationTarget, type PaymentAccount, type PaymentTarget, type TradePayment } from "../_lib/api";
import { SHIPMENT_KEYS } from "../_lib/hooks";
import { toast } from "../_lib/toast";

/** Where the proof goes: the step it pays (its record), as the step's proof document. */
export type PaymentContext = {
  direction: "IN" | "OUT";
  /** Pre-filled allocation (the step's target). */
  target?: { targetType: AllocationTarget; targetId: string; label: string; amount?: number | null; currency?: string };
  /** The step's id + the proof doc type (DEPOSIT_PROOF, CI_PAYMENT_PROOF, PAYMENT_PROOF). */
  proof?: { stepId: string; docType: string };
};

type Row = { key: number; targetType: AllocationTarget; targetId: string | null; label: string; amount: string };
let seq = 0;
const today = () => new Date().toISOString().slice(0, 10);
const cents = (v: number) => Math.round(v * 100);

export default function PaymentDialog({ open, onClose, context, payment }: { open: boolean; onClose: () => void; context?: PaymentContext; payment?: TradePayment | null }) {
  const api = useShipmentsApi();
  const qc = useQueryClient();
  const [direction, setDirection] = useState<"IN" | "OUT">("OUT");
  const [paidAt, setPaidAt] = useState(today());
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [account, setAccount] = useState<PaymentAccount>("WISE");
  const [counterparty, setCounterparty] = useState("");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setFile(null);
    if (payment) {
      setDirection(payment.direction);
      setPaidAt(payment.paidAt.slice(0, 10));
      setAmount(String(payment.amount));
      setCurrency(payment.currency);
      setAccount(payment.account);
      setCounterparty(payment.counterpartyName ?? "");
      setReference(payment.reference ?? "");
      setNotes(payment.notes ?? "");
      setRows(payment.allocations.map((a) => ({ key: ++seq, targetType: a.targetType, targetId: a.targetId, label: a.targetLabel ?? "", amount: String(a.amount) })));
      return;
    }
    const t = context?.target;
    setDirection(context?.direction ?? "OUT");
    setPaidAt(today());
    setAmount(t?.amount != null ? String(t.amount) : "");
    setCurrency(t?.currency ?? (t?.targetType === "IMPORT_TAX" || t?.targetType === "VENDOR_INVOICE" ? "JPY" : "USD"));
    setAccount(context?.direction === "IN" ? "CFSB" : t?.targetType === "IMPORT_TAX" || t?.targetType === "VENDOR_INVOICE" ? "SMBC_JPY" : "WISE");
    setCounterparty("");
    setReference("");
    setNotes("");
    setRows(t ? [{ key: ++seq, targetType: t.targetType, targetId: t.targetId, label: t.label, amount: t.amount != null ? String(t.amount) : "" }] : []);
  }, [open, payment, context]);

  const targets = useQuery({ queryKey: [...SHIPMENT_KEYS.orders, "payment-targets", direction], queryFn: () => api.paymentTargets(direction), enabled: open, staleTime: 30_000 });
  const total = Number(amount) || 0;
  const allocated = useMemo(() => rows.reduce((s, r) => s + cents(Number(r.amount) || 0), 0) / 100, [rows]);
  const left = Math.round((total - allocated) * 100) / 100;

  const save = async () => {
    setError(null);
    if (!(total > 0)) return setError("Enter the amount");
    if (left < -0.004) return setError(`The allocations are ${Math.abs(left).toFixed(2)} more than the payment`);
    setBusy(true);
    try {
      let proofFileId = payment?.proofFileId ?? null;
      if (file && context?.proof) {
        const f = await api.uploadFile({ file, docType: context.proof.docType, stepId: context.proof.stepId, notes: `Payment ${paidAt}` });
        proofFileId = f.id;
      }
      const body = {
        direction,
        paidAt,
        amount: total,
        currency,
        account,
        counterpartyName: counterparty.trim() || null,
        reference: reference.trim() || null,
        notes: notes.trim() || null,
        proofFileId,
        allocations: rows.filter((r) => Number(r.amount) > 0).map((r) => ({ targetType: r.targetType, targetId: r.targetId, targetLabel: r.label || null, amount: Number(r.amount) })),
      };
      if (payment) await api.updatePayment(payment.id, body);
      else await api.createPayment(body);
      await Promise.all([qc.invalidateQueries({ queryKey: SHIPMENT_KEYS.orders }), qc.invalidateQueries({ queryKey: SHIPMENT_KEYS.files })]);
      toast.success(payment ? "Payment saved" : `Payment recorded${left > 0.004 ? ` — ${left.toLocaleString("en-US", { minimumFractionDigits: 2 })} ${currency} unallocated` : ""}`);
      onClose();
    } catch (e: any) {
      setError(e?.message || "Could not save the payment");
    } finally {
      setBusy(false);
    }
  };

  const options = targets.data ?? [];
  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="md" fullWidth>
      <DialogTitle>{payment ? "Payment" : direction === "IN" ? "Record a receipt (cash in)" : "Record a payment (cash out)"}</DialogTitle>
      <DialogContent dividers>
        {error && (
          <Alert severity="error" sx={{ mb: 1.5 }}>
            {error}
          </Alert>
        )}
        <Grid container spacing={1.5}>
          <Grid item xs={6} sm={3}>
            <TextField select fullWidth size="small" label="Direction" value={direction} onChange={(e) => setDirection(e.target.value as "IN" | "OUT")} disabled={!!payment}>
              <MenuItem value="OUT">Cash out (ADH pays)</MenuItem>
              <MenuItem value="IN">Cash in (customer pays)</MenuItem>
            </TextField>
          </Grid>
          <Grid item xs={6} sm={3}>
            <TextField fullWidth size="small" type="date" label="Date" InputLabelProps={{ shrink: true }} value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
          </Grid>
          <Grid item xs={6} sm={3}>
            <TextField fullWidth size="small" type="number" label="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Grid>
          <Grid item xs={6} sm={3}>
            <TextField select fullWidth size="small" label="Currency" value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {["USD", "JPY", "SGD"].map((c) => (
                <MenuItem key={c} value={c}>
                  {c}
                </MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid item xs={12} sm={4}>
            <TextField select fullWidth size="small" label="Account" value={account} onChange={(e) => setAccount(e.target.value as PaymentAccount)}>
              {(Object.keys(ACCOUNT_LABEL) as PaymentAccount[]).map((a) => (
                <MenuItem key={a} value={a}>
                  {ACCOUNT_LABEL[a]}
                </MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid item xs={12} sm={4}>
            <TextField fullWidth size="small" label={direction === "IN" ? "From (customer)" : "To (Vedanta, customs, Mitsui Soko …)"} value={counterparty} onChange={(e) => setCounterparty(e.target.value)} />
          </Grid>
          <Grid item xs={12} sm={4}>
            <TextField fullWidth size="small" label="Reference (bank ref / transfer id)" value={reference} onChange={(e) => setReference(e.target.value)} />
          </Grid>
          <Grid item xs={12}>
            <TextField fullWidth size="small" label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Grid>
          {context?.proof && !payment && (
            <Grid item xs={12}>
              <Button component="label" size="small" variant="outlined" startIcon={<UploadFileIcon />}>
                {file ? file.name : "Attach the proof (filed on the step)"}
                <input hidden type="file" accept=".pdf,.png,.jpg,.jpeg" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              </Button>
            </Grid>
          )}
        </Grid>

        <Stack direction="row" alignItems="center" sx={{ mt: 2, mb: 1 }}>
          <Typography variant="subtitle2" sx={{ flex: 1 }}>
            What it paid
          </Typography>
          <Typography variant="body2" color={left < -0.004 ? "error" : left > 0.004 ? "warning.main" : "success.main"} data-tour="payment-unallocated">
            {left > 0.004 ? `Unallocated ${left.toLocaleString("en-US", { minimumFractionDigits: 2 })} ${currency}` : left < -0.004 ? `Over by ${Math.abs(left).toFixed(2)}` : total > 0 ? "Fully allocated" : ""}
          </Typography>
        </Stack>
        {rows.map((r) => (
          <Stack key={r.key} direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ mb: 1 }} alignItems={{ sm: "center" }}>
            <Autocomplete
              size="small"
              sx={{ flex: 1 }}
              options={options}
              value={options.find((o) => o.targetType === r.targetType && o.targetId === r.targetId) ?? (r.targetId ? ({ targetType: r.targetType, targetId: r.targetId, label: r.label } as PaymentTarget) : null)}
              getOptionLabel={(o) => `${TARGET_LABEL[o.targetType]} · ${o.label}`}
              isOptionEqualToValue={(a, b) => a.targetType === b.targetType && a.targetId === b.targetId}
              renderOption={(props, o) => (
                <li {...props} key={`${o.targetType}:${o.targetId}`}>
                  <Box>
                    <Typography variant="body2">
                      {TARGET_LABEL[o.targetType]} · {o.label}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {o.expected != null ? `${o.currency} ${o.expected.toLocaleString("en-US", { minimumFractionDigits: 2 })} · ` : ""}paid {o.paid.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                    </Typography>
                  </Box>
                </li>
              )}
              onChange={(_, o) =>
                setRows((xs) =>
                  xs.map((x) =>
                    x.key === r.key ? { ...x, targetType: o?.targetType ?? x.targetType, targetId: o?.targetId ?? null, label: o?.label ?? "", amount: x.amount || (o?.expected != null ? String(Math.max(0, Math.round((o.expected - o.paid) * 100) / 100)) : "") } : x,
                  ),
                )
              }
              renderInput={(p) => <TextField {...p} label="PI / CI / invoice / tax" />}
            />
            <TextField size="small" type="number" label="Amount" value={r.amount} onChange={(e) => setRows((xs) => xs.map((x) => (x.key === r.key ? { ...x, amount: e.target.value } : x)))} sx={{ width: { sm: 180 } }} />
            <IconButton size="small" aria-label="Remove" onClick={() => setRows((xs) => xs.filter((x) => x.key !== r.key))}>
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Stack>
        ))}
        <Button size="small" startIcon={<AddIcon />} onClick={() => setRows((xs) => [...xs, { key: ++seq, targetType: direction === "IN" ? "INVOICE" : "CI", targetId: null, label: "", amount: left > 0 ? String(left) : "" }])}>
          Add line
        </Button>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button variant="contained" onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
