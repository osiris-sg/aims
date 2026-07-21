"use client";

// Manual Offset (legacy screenshot 54, built 2026-07-20): settle a customer's
// open CREDIT NOTES against their open INVOICES with no cash movement.
// Tick entries on both sides (amounts default to full outstanding, editable
// for partial), and the footer Balance must reach 0.00 before Save. Save
// creates an MO-###### offset document + cashless 'offset' payment rows on
// both sides; a journal posts ONLY when foreign items settle at different
// historical rates (the legacy "Update Exchange Gain/Loss Accounts" box).

import React, { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
  alpha,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import { useAuth } from "@clerk/nextjs";
import { toast } from "react-toastify";

const fmt = (n: number) =>
  (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const R = (n: number) => Math.round(n * 100) / 100;
const dmy = (d: any) => (d ? new Date(d).toLocaleDateString("en-GB") : "—");

const apiCall = async (path: string, token: string | null, init?: RequestInit) => {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (typeof window !== "undefined") {
    const activeOrgId = window.sessionStorage.getItem("aims-admin-active-org");
    if (activeOrgId) headers["X-Active-Org-Id"] = activeOrgId;
  }
  const res = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_API_URL}${path}`, { ...init, headers });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.message || `Request failed (${res.status})`);
  return json?.data ?? json;
};

type OpenItem = {
  documentId: string;
  reference: string;
  date: string | null;
  remarks: string;
  gross: number;
  outstanding: number;
  currency: string | null;
};

type Side = Record<string, number>; // documentId -> amount

export default function ManualOffsetDialog({
  open,
  onClose,
  customer,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  customer: { id: string; name?: string; customerCode?: string } | null;
  onSaved?: () => void;
}) {
  const { getToken } = useAuth();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [debitItems, setDebitItems] = useState<OpenItem[]>([]); // invoices
  const [creditItems, setCreditItems] = useState<OpenItem[]>([]); // credit notes
  const [debits, setDebits] = useState<Side>({});
  const [credits, setCredits] = useState<Side>({});
  const [updateFx, setUpdateFx] = useState(true);

  useEffect(() => {
    if (!open || !customer?.id) return;
    setDebits({});
    setCredits({});
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const token = await getToken();
        const res = await apiCall(`/receipts/offset-items/${customer.id}`, token);
        if (cancelled) return;
        setDebitItems(res?.debits || []);
        setCreditItems(res?.credits || []);
      } catch (e: any) {
        if (!cancelled) toast.error(e?.message || "Couldn't load open items");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, customer?.id, getToken]);

  const debitTotal = useMemo(() => R(Object.values(debits).reduce((s, v) => s + (Number(v) || 0), 0)), [debits]);
  const creditTotal = useMemo(() => R(Object.values(credits).reduce((s, v) => s + (Number(v) || 0), 0)), [credits]);
  const balance = R(debitTotal - creditTotal);
  const canSave =
    !saving && Object.keys(debits).length > 0 && Object.keys(credits).length > 0 && Math.abs(balance) <= 0.005;

  const toggle = (side: Side, setSide: (s: Side) => void, item: OpenItem, checked: boolean) => {
    const next = { ...side };
    if (!checked) delete next[item.documentId];
    else next[item.documentId] = item.outstanding;
    setSide(next);
  };
  const setAmount = (side: Side, setSide: (s: Side) => void, item: OpenItem, raw: string) => {
    const v = R(Math.max(0, Math.min(parseFloat(raw) || 0, item.outstanding)));
    const next = { ...side };
    if (v <= 0) delete next[item.documentId];
    else next[item.documentId] = v;
    setSide(next);
  };

  const save = async () => {
    if (!canSave || !customer?.id) return;
    setSaving(true);
    try {
      const token = await getToken();
      const res = await apiCall(`/receipts/offsets`, token, {
        method: "POST",
        body: JSON.stringify({
          customerId: customer.id,
          date: new Date().toISOString().slice(0, 10),
          updateFx,
          debits: Object.entries(debits).map(([documentId, amount]) => ({ documentId, amount })),
          credits: Object.entries(credits).map(([documentId, amount]) => ({ documentId, amount })),
        }),
      });
      toast.success(
        `Manual Offset ${res?.number || ""} saved — ${fmt(res?.amount || debitTotal)} offset${res?.journalNumber ? `; FX journal ${res.journalNumber} posted` : ""}`,
      );
      onSaved?.();
      onClose();
    } catch (e: any) {
      toast.error(e?.message || "Offset failed");
    } finally {
      setSaving(false);
    }
  };

  const headSx = { fontWeight: 700, fontSize: "0.72rem", color: "text.secondary", whiteSpace: "nowrap" as const, bgcolor: "surfaceTones.low" };
  const mono = { fontFamily: "monospace", textAlign: "right" as const, whiteSpace: "nowrap" as const };

  const renderGrid = (
    title: string,
    items: OpenItem[],
    side: Side,
    setSide: (s: Side) => void,
    amountLabel: string,
    emptyText: string,
  ) => (
    <Box sx={{ mb: 2 }}>
      <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.75 }}>
        {title}
      </Typography>
      {items.length === 0 ? (
        <Alert severity="info" variant="outlined" sx={{ alignSelf: "flex-start" }}>
          {emptyText}
        </Alert>
      ) : (
        <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 220, borderRadius: 1.5 }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell sx={{ ...headSx, width: 44 }} />
                <TableCell sx={headSx}>Reference</TableCell>
                <TableCell sx={headSx}>Date</TableCell>
                <TableCell sx={headSx}>Remarks</TableCell>
                <TableCell sx={{ ...headSx, textAlign: "right" }}>{amountLabel}</TableCell>
                <TableCell sx={{ ...headSx, textAlign: "right", width: 150 }}>Offset</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {items.map((it) => {
                const ticked = side[it.documentId] !== undefined;
                return (
                  <TableRow
                    key={it.documentId}
                    hover
                    sx={ticked ? { bgcolor: (t) => alpha(t.palette.primary.main, 0.06) } : undefined}
                  >
                    <TableCell padding="checkbox">
                      <Checkbox size="small" checked={ticked} onChange={(_, c) => toggle(side, setSide, it, c)} />
                    </TableCell>
                    <TableCell sx={{ fontFamily: "monospace", whiteSpace: "nowrap" }}>{it.reference}</TableCell>
                    <TableCell sx={{ whiteSpace: "nowrap" }}>{dmy(it.date)}</TableCell>
                    <TableCell>
                      {it.remarks}
                      {it.currency ? ` · ${it.currency}` : ""}
                    </TableCell>
                    <TableCell sx={mono}>{fmt(it.outstanding)}</TableCell>
                    <TableCell sx={{ textAlign: "right" }}>
                      <TextField
                        size="small"
                        type="number"
                        value={ticked ? side[it.documentId] : ""}
                        onChange={(e) => setAmount(side, setSide, it, e.target.value)}
                        disabled={!ticked}
                        inputProps={{ step: "0.01", min: 0, max: it.outstanding, style: { textAlign: "right" } }}
                        sx={{ width: 130 }}
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Box>
  );

  return (
    <Dialog open={open} onClose={() => !saving && onClose()} maxWidth="md" fullWidth PaperProps={{ sx: { maxHeight: "92vh" } }}>
      <DialogTitle
        sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", bgcolor: "#0a0a0a", color: "#fafafa", py: 1.5 }}
      >
        <Typography variant="h6" fontWeight={500}>
          Manual Offset{customer?.name ? ` — ${customer.name}` : ""}
        </Typography>
        <IconButton onClick={() => !saving && onClose()} size="small" sx={{ color: "#fafafa" }}>
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <DialogContent sx={{ p: 2 }}>
        {loading ? (
          <Box sx={{ display: "flex", justifyContent: "center", p: 5 }}>
            <CircularProgress size={26} />
          </Box>
        ) : (
          <>
            {renderGrid(
              "Credit Entries",
              creditItems,
              credits,
              setCredits,
              "Credit",
              "No open credit notes for this customer — create a credit note first, then offset it here.",
            )}
            {renderGrid("Debit Entries", debitItems, debits, setDebits, "Debit", "No outstanding invoices for this customer.")}

            <Stack direction="row" gap={3} alignItems="center" justifyContent="flex-end" sx={{ pr: 1 }}>
              <Typography variant="body2" sx={{ color: "text.secondary" }}>
                Debit Amount
              </Typography>
              <Typography sx={{ ...mono, fontWeight: 600, minWidth: 100 }}>{fmt(debitTotal)}</Typography>
              <Typography variant="body2" sx={{ color: "text.secondary" }}>
                Credit Amount
              </Typography>
              <Typography sx={{ ...mono, fontWeight: 600, minWidth: 100 }}>{fmt(creditTotal)}</Typography>
              <Typography variant="body2" sx={{ fontWeight: 700 }}>
                Balance
              </Typography>
              <Typography
                sx={{ ...mono, fontWeight: 700, minWidth: 100, color: Math.abs(balance) <= 0.005 ? "success.main" : "error.main" }}
              >
                {fmt(balance)}
              </Typography>
            </Stack>
            {Math.abs(balance) > 0.005 && (debitTotal > 0 || creditTotal > 0) && (
              <Typography variant="caption" sx={{ display: "block", textAlign: "right", color: "error.main", pr: 1, mt: 0.5 }}>
                Both sides must match (Balance 0.00) before the offset can be saved — use partial amounts to equalise.
              </Typography>
            )}

            <FormControlLabel
              sx={{ mt: 1 }}
              control={<Checkbox size="small" checked={updateFx} onChange={(_, c) => setUpdateFx(c)} />}
              label={
                <Box>
                  <Typography variant="body2">Update Exchange Gain / Loss Accounts</Typography>
                  <Typography variant="caption" sx={{ color: "text.secondary" }}>
                    Posts a journal only when foreign-currency items settle at different historical rates.
                  </Typography>
                </Box>
              }
            />
          </>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={save}
          disabled={!canSave}
          startIcon={saving ? <CircularProgress size={14} color="inherit" /> : undefined}
        >
          Save Offset
        </Button>
      </DialogActions>
    </Dialog>
  );
}
