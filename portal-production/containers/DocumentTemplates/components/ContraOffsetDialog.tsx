"use client";

// CONTRA SET-OFF (guru 2026-11-06: "the same customer we bill them and they
// also bill us, we can offset from there"). NOT the Manual Offset — that nets
// one customer's invoices against that customer's own credit notes, both on
// the debtors control, so it posts nothing. A contra crosses the ledgers: the
// same company owes us as a CUSTOMER and is owed by us as a SUPPLIER, so it
// posts Dr Trade Creditors / Cr Trade Debtors and real balances move.
//
// Customer and Supplier are separate rows, so the pairing is recorded first
// (Customer.contraSupplierId). This dialog offers the likely pair by name and
// asks a human to confirm it: a name match is a guess, and a contra needs the
// counterparty's agreement anyway.

import React, { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
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
import DocumentRefLink from "@/components/DocumentRefLink";
import { todayIso } from "@/helpers/orgToday";

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
  type?: string | null;
  templateId?: string | null;
  date: string | null;
  remarks: string;
  gross: number;
  outstanding: number;
  currency: string | null;
};
type Side = Record<string, number>;
type Pair = {
  customerId: string;
  customerName: string;
  customerCode?: string | null;
  supplierId: string;
  supplierName: string;
  supplierCode?: string | null;
};

export default function ContraOffsetDialog({
  open,
  onClose,
  customer,
  supplier,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  /** Reached from the Official Receipt — the customer side. */
  customer?: { id: string; name?: string; customerCode?: string } | null;
  /** Reached from the Payment Voucher — the supplier side. The contra is the
   *  same thing either way; only the record you start from differs. */
  supplier?: { id: string; name?: string; supplierCode?: string } | null;
  onSaved?: () => void;
}) {
  const { getToken } = useAuth();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [linking, setLinking] = useState(false);
  /** Set when the customer has no pair yet — the suggestion to confirm. */
  const [suggestion, setSuggestion] = useState<Pair | null>(null);
  const [supplierName, setSupplierName] = useState<string | null>(null);
  /** The customer the contra resolves to — given directly, or found from the
   *  supplier's pairing. Everything downstream works off this. */
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [customerName, setCustomerName] = useState<string | null>(null);
  const [arItems, setArItems] = useState<OpenItem[]>([]);
  const [apItems, setApItems] = useState<OpenItem[]>([]);
  const [ar, setAr] = useState<Side>({});
  const [ap, setAp] = useState<Side>({});

  const load = React.useCallback(async () => {
    const path = customer?.id
      ? `/contra/items/${customer.id}`
      : supplier?.id
        ? `/contra/items-for-supplier/${supplier.id}`
        : null;
    if (!path) return;
    setLoading(true);
    setAr({});
    setAp({});
    setSuggestion(null);
    try {
      const token = await getToken();
      try {
        const res = await apiCall(path, token);
        setCustomerId(res?.customer?.id ?? null);
        setCustomerName(res?.customer?.name ?? null);
        setSupplierName(res?.supplier?.name ?? null);
        setArItems(res?.debtorItems || []);
        setApItems(res?.creditorItems || []);
      } catch (e: any) {
        // Not paired yet — offer the name match instead of an error.
        if (!/not paired/i.test(e?.message || "")) throw e;
        const pairs = await apiCall(`/contra/pairs`, token);
        const hit =
          (pairs?.suggested || []).find((p: Pair) =>
            customer?.id ? p.customerId === customer.id : p.supplierId === supplier?.id,
          ) || null;
        setSuggestion(hit);
        setArItems([]);
        setApItems([]);
        setCustomerId(null);
        setCustomerName(null);
        setSupplierName(null);
      }
    } catch (e: any) {
      toast.error(e?.message || "Couldn't load the contra");
    } finally {
      setLoading(false);
    }
  }, [customer?.id, supplier?.id, getToken]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const confirmPair = async () => {
    if (!suggestion) return;
    setLinking(true);
    try {
      const token = await getToken();
      await apiCall(`/contra/pairs/${suggestion.customerId}`, token, {
        method: "POST",
        body: JSON.stringify({ supplierId: suggestion.supplierId }),
      });
      toast.success(`Paired with ${suggestion.supplierName}`);
      await load();
    } catch (e: any) {
      toast.error(e?.message || "Couldn't pair");
    } finally {
      setLinking(false);
    }
  };

  const arTotal = useMemo(() => R(Object.values(ar).reduce((s, v) => s + (Number(v) || 0), 0)), [ar]);
  const apTotal = useMemo(() => R(Object.values(ap).reduce((s, v) => s + (Number(v) || 0), 0)), [ap]);
  const balance = R(arTotal - apTotal);
  const canSave = !saving && Object.keys(ar).length > 0 && Object.keys(ap).length > 0 && Math.abs(balance) <= 0.005;

  const toggle = (side: Side, setSide: (s: Side) => void, it: OpenItem, checked: boolean) => {
    const next = { ...side };
    if (!checked) delete next[it.documentId];
    else next[it.documentId] = it.outstanding;
    setSide(next);
  };
  const setAmount = (side: Side, setSide: (s: Side) => void, it: OpenItem, raw: string) => {
    const v = R(Math.max(0, Math.min(parseFloat(raw) || 0, it.outstanding)));
    const next = { ...side };
    if (v <= 0) delete next[it.documentId];
    else next[it.documentId] = v;
    setSide(next);
  };

  const save = async () => {
    if (!canSave || !customerId) return;
    setSaving(true);
    try {
      const token = await getToken();
      const res = await apiCall(`/contra/offsets`, token, {
        method: "POST",
        body: JSON.stringify({
          customerId,
          date: todayIso(),
          debtorItems: Object.entries(ar).map(([documentId, amount]) => ({ documentId, amount })),
          creditorItems: Object.entries(ap).map(([documentId, amount]) => ({ documentId, amount })),
        }),
      });
      toast.success(
        `Contra ${res?.number || ""} saved — ${fmt(res?.amount || arTotal)} set off${res?.journalNumber ? `; journal ${res.journalNumber}` : ""}`,
      );
      onSaved?.();
      onClose();
    } catch (e: any) {
      toast.error(e?.message || "Contra failed");
    } finally {
      setSaving(false);
    }
  };

  const headSx = {
    fontWeight: 700,
    fontSize: "0.72rem",
    color: "text.secondary",
    whiteSpace: "nowrap" as const,
    bgcolor: "surfaceTones.low",
  };
  const mono = { fontVariantNumeric: "tabular-nums", textAlign: "right" as const, whiteSpace: "nowrap" as const };

  const renderGrid = (title: string, items: OpenItem[], side: Side, setSide: (s: Side) => void, emptyText: string) => (
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
                <TableCell sx={{ ...headSx, textAlign: "right" }}>Outstanding</TableCell>
                <TableCell sx={{ ...headSx, textAlign: "right", width: 150 }}>Set off</TableCell>
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
                    <TableCell sx={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                      <DocumentRefLink
                        doc={{ id: it.documentId, type: it.type, templateId: it.templateId }}
                        label={it.reference}
                      />
                    </TableCell>
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
    <Dialog
      open={open}
      onClose={() => !saving && onClose()}
      maxWidth="md"
      fullWidth
      PaperProps={{ sx: { maxHeight: "92vh" } }}
    >
      <DialogTitle
        sx={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          bgcolor: "#0a0a0a",
          color: "#fafafa",
          py: 1.5,
        }}
      >
        <Typography variant="h6" fontWeight={500}>
          Contra Set-off{customerName || customer?.name || supplier?.name ? ` — ${customerName || customer?.name || supplier?.name}` : ""}
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
        ) : suggestion ? (
          <Alert severity="info" variant="outlined" sx={{ mt: 1 }}>
            <Typography variant="body2" sx={{ mb: 1 }}>
              <strong>{suggestion.customerName}</strong> and <strong>{suggestion.supplierName}</strong>
              {suggestion.supplierCode ? ` (${suggestion.supplierCode})` : ""} are not paired yet — they match by name.
            </Typography>
            <Typography variant="caption" sx={{ display: "block", mb: 1.5, color: "text.secondary" }}>
              Confirm only if they are the same legal entity — the pairing is remembered, and everything owed either way
              becomes offsettable.
            </Typography>
            <Button size="small" variant="contained" onClick={confirmPair} disabled={linking}>
              {linking ? "Pairing…" : "Pair them"}
            </Button>
          </Alert>
        ) : !supplierName ? (
          <Alert severity="warning" variant="outlined" sx={{ mt: 1 }}>
            No counterpart matches this record by name — nothing to contra. Pair them by hand first if they really are
            the same company.
          </Alert>
        ) : (
          <>
            <Stack direction="row" gap={1} alignItems="center" sx={{ mb: 1.5 }}>
              <Chip size="small" label={`Customer: ${customerName ?? customer?.name ?? ""}`} variant="outlined" />
              <Typography variant="body2" sx={{ color: "text.secondary" }}>
                ↔
              </Typography>
              <Chip size="small" label={`Supplier: ${supplierName}`} variant="outlined" />
            </Stack>

            {renderGrid(
              "They owe us — open invoices",
              arItems,
              ar,
              setAr,
              "Nothing outstanding from them as a customer.",
            )}
            {renderGrid("We owe them — open bills", apItems, ap, setAp, "Nothing outstanding to them as a supplier.")}

            <Stack direction="row" gap={3} alignItems="center" justifyContent="flex-end" sx={{ pr: 1 }}>
              <Typography variant="body2" sx={{ color: "text.secondary" }}>
                Invoices
              </Typography>
              <Typography sx={{ ...mono, fontWeight: 600, minWidth: 100 }}>{fmt(arTotal)}</Typography>
              <Typography variant="body2" sx={{ color: "text.secondary" }}>
                Bills
              </Typography>
              <Typography sx={{ ...mono, fontWeight: 600, minWidth: 100 }}>{fmt(apTotal)}</Typography>
              <Typography variant="body2" sx={{ fontWeight: 700 }}>
                Balance
              </Typography>
              <Typography
                sx={{
                  ...mono,
                  fontWeight: 700,
                  minWidth: 100,
                  color: Math.abs(balance) <= 0.005 ? "success.main" : "error.main",
                }}
              >
                {fmt(balance)}
              </Typography>
            </Stack>
            {Math.abs(balance) > 0.005 && (arTotal > 0 || apTotal > 0) && (
              <Typography variant="caption" sx={{ display: "block", textAlign: "right", color: "error.main", pr: 1, mt: 0.5 }}>
                Both sides must match (Balance 0.00) — use partial amounts to equalise.
              </Typography>
            )}
            <Typography variant="caption" sx={{ display: "block", color: "text.secondary", mt: 1.5 }}>
              Saving posts one journal: Dr Trade Creditors / Cr Trade Debtors. No cash moves, and both documents are
              marked settled by that amount.
            </Typography>
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
          Save Contra
        </Button>
      </DialogActions>
    </Dialog>
  );
}
