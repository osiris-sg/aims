"use client";

// Offset Supplier Invoices — the legacy P/V dialog behind the Payee pencil
// (guru 2026-11-09, screenshot of A's Premier):
//
//   TRADE CREDITOR
//   Supplier code [C2001] 🔍  2LT GLASS & MIRROR ALUMINIUM CONTRACT
//   Amount SGD [1,000.00]  Rate [1.0000000]  Supplier Amount SGD [1000.00]
//   Reference | Date | X-Reference | Remarks | Tick | Credit | Partial / Full
//   Debit Amount 1,000.00   Credit Amount 0.00   Balance SGD 1,000.00
//   ☑ Update Exchange Gain / Loss Accounts
//   Document P/V O G261101  Date 06/11/2026  EXCHANGE GAIN/LOSS [EX070]
//
// Saving writes ONE creditor line into the voucher (Trade Creditors control,
// amount in the voucher currency, the supplier + ticked invoices as the
// line's offset). Balance must be 0.00 — the whole supplier amount is
// allocated across the invoices (partial on the last; credit notes negative).

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
  FormControlLabel,
  IconButton,
  InputAdornment,
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
import SearchIcon from "@mui/icons-material/Search";
import CloseIcon from "@mui/icons-material/Close";
import { useAuth } from "@clerk/nextjs";
import { toast } from "react-toastify";
import CustomerSelectDialog from "./CustomerSelectDialog";
import { AccountSelectDialog, useOrAccounts, type OrAccount } from "./OfficialReceiptSection";
import { enterScopeProps } from "@/helpers/enterAdvance";

export type PvAllocation = { documentId: string; amount: number; reference?: string | null; date?: string | null; description?: string };
export type PvOffset = {
  supplierId: string;
  supplierCode?: string | null;
  supplierName?: string | null;
  currency?: string | null;
  /** Supplier currency per voucher currency. */
  rate: number;
  /** Voucher currency (what the line carries). */
  voucherAmount: number;
  /** Supplier currency = voucherAmount × rate; what the allocations add up to. */
  supplierAmount: number;
  allocations: PvAllocation[];
  updateFx: boolean;
  fxAccountCode?: string | null;
};
export type PvLine = {
  id: string;
  accountCode?: string | null;
  accountName?: string | null;
  description?: string | null;
  remarks?: string | null;
  amount: number | string;
  offset?: PvOffset | null;
};

type OpenBill = {
  documentId: string;
  reference: string;
  type?: string | null;
  date: string | null;
  remarks: string;
  gross: number;
  outstanding: number;
  kind?: "bill" | "credit";
};

const fmt = (n: number) => (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const R = (n: number) => Math.round(n * 100) / 100;

const apiFetch = async (path: string, token: string | null) => {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (typeof window !== "undefined") {
    const activeOrgId = window.sessionStorage.getItem("aims-admin-active-org");
    if (activeOrgId) headers["X-Active-Org-Id"] = activeOrgId;
  }
  const res = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_API_URL}${path}`, { headers });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.message || `Request failed (${res.status})`);
  return json?.data ?? json;
};

const bandSx = {
  px: 1.5,
  py: 0.5,
  borderRadius: 1,
  fontWeight: 800,
  letterSpacing: "0.06em",
  fontSize: "0.8rem",
  color: "#fff",
  bgcolor: "#7a1020",
  display: "inline-block",
};

export default function PvOffsetSupplierDialog({
  open,
  onClose,
  voucherId,
  voucherNumber,
  voucherDate,
  voucherCurrency,
  creditorAccountCode,
  suppliers,
  existing,
  existingSupplier,
  onSave,
  onClear,
}: {
  open: boolean;
  onClose: () => void;
  voucherId?: string;
  voucherNumber: string;
  voucherDate: string;
  voucherCurrency: string;
  creditorAccountCode: string;
  suppliers: any[];
  existing: PvLine | null;
  existingSupplier: any | null;
  onSave: (line: PvLine, supplier: any) => void;
  onClear: () => void;
}) {
  const { getToken } = useAuth();
  const accounts = useOrAccounts();
  const creditorAccount = accounts.find((a) => a.code === creditorAccountCode);

  const [supplier, setSupplier] = useState<any | null>(null);
  const [codeInput, setCodeInput] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [amount, setAmount] = useState<string>("");
  const [rate, setRate] = useState<string>("1");
  const [allocations, setAllocations] = useState<PvAllocation[]>([]);
  const [updateFx, setUpdateFx] = useState(true);
  const [fxCode, setFxCode] = useState("");
  const [fxOpen, setFxOpen] = useState(false);
  const [bills, setBills] = useState<OpenBill[]>([]);
  const [loading, setLoading] = useState(false);
  // Bumped on every supplier pick so re-picking the same supplier refetches
  // (a fetch that hit the API mid-restart left the list empty otherwise).
  const [fetchTick, setFetchTick] = useState(0);

  // Start from the existing creditor line (edit) or empty (new).
  useEffect(() => {
    if (!open) return;
    const o = existing?.offset;
    if (o) {
      const s = suppliers.find((x: any) => x.id === o.supplierId) || existingSupplier || { id: o.supplierId, name: o.supplierName || "", supplierCode: o.supplierCode || "", currency: o.currency || voucherCurrency };
      setSupplier(s);
      setCodeInput(s.supplierCode || "");
      setAmount(String(o.voucherAmount ?? existing?.amount ?? ""));
      setRate(String(o.rate ?? 1));
      setAllocations(Array.isArray(o.allocations) ? o.allocations : []);
      setUpdateFx(o.updateFx !== false);
      setFxCode(o.fxAccountCode || "");
    } else {
      const s = existingSupplier?.id ? existingSupplier : null;
      setSupplier(s);
      setCodeInput(s?.supplierCode || "");
      setAmount("");
      setRate("1");
      setAllocations([]);
      setUpdateFx(true);
      setFxCode("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const supplierCurrency = String(supplier?.currency || voucherCurrency).toUpperCase();
  const sameCurrency = supplierCurrency === voucherCurrency;
  useEffect(() => {
    if (sameCurrency) setRate("1");
  }, [sameCurrency]);

  // Open invoices (and credit notes, flag permitting) of the chosen supplier.
  useEffect(() => {
    if (!open || !supplier?.id) {
      setBills([]);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const token = await getToken();
        const excl = voucherId ? `?excludeVoucherId=${voucherId}` : "";
        const rows = (await apiFetch(`/payment-vouchers/open-bills/${supplier.id}${excl}`, token)) || [];
        if (!cancelled) setBills(rows);
      } catch (e: any) {
        if (!cancelled) toast.error(e?.message || "Couldn't load unpaid supplier invoices");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, supplier?.id, voucherId, getToken, fetchTick]);

  const voucherAmount = R(parseFloat(amount) || 0);
  const rateNum = Number(rate) || 1;
  const supplierAmount = R(voucherAmount * rateNum);
  const allocById = useMemo(() => new Map(allocations.map((a) => [a.documentId, Number(a.amount) || 0])), [allocations]);
  const debitAmount = R(allocations.reduce((s, a) => s + Math.max(0, Number(a.amount) || 0), 0));
  const creditAmount = R(allocations.reduce((s, a) => s + Math.max(0, -(Number(a.amount) || 0)), 0));
  const balance = R(supplierAmount - (debitAmount - creditAmount));
  const creditOn = allocations.some((a) => (Number(a.amount) || 0) < 0);
  const isCredit = (b: OpenBill) => b.kind === "credit";

  const entryFor = (b: OpenBill, amt: number): PvAllocation => ({
    documentId: b.documentId,
    amount: amt,
    reference: b.reference,
    date: b.date,
    description: b.remarks || (isCredit(b) ? "SUPPLIER CREDIT NOTE" : "SUPPLIER INVOICE"),
  });

  // Tick = allocate the remaining pool top-down (partial on the last). A
  // credit note goes in NEGATIVE: it is not paid, it pays.
  const toggle = (b: OpenBill, checked: boolean) => {
    if (!checked) {
      setAllocations(allocations.filter((a) => a.documentId !== b.documentId));
      return;
    }
    const rest = allocations.filter((a) => a.documentId !== b.documentId);
    if (isCredit(b)) {
      setAllocations([...rest, entryFor(b, R(-b.outstanding))]);
      return;
    }
    const othersTotal = R(rest.reduce((s, a) => s + (Number(a.amount) || 0), 0));
    const remaining = R(Math.max(0, supplierAmount - othersTotal));
    setAllocations([...rest, entryFor(b, R(Math.min(b.outstanding, remaining)))]);
  };
  const setLineAmount = (b: OpenBill, raw: string) => {
    const typed = R(Math.max(0, Math.min(Math.abs(parseFloat(raw) || 0), b.outstanding)));
    const rest = allocations.filter((a) => a.documentId !== b.documentId);
    setAllocations(typed <= 0 ? rest : [...rest, entryFor(b, isCredit(b) ? -typed : typed)]);
  };

  const pickSupplier = (s: any) => {
    setSupplier(s);
    setCodeInput(s.supplierCode || s.customerCode || "");
    setAllocations([]);
    setFetchTick((t) => t + 1);
  };

  const save = () => {
    if (!supplier?.id) return toast.error("Pick the supplier");
    if (!allocations.length) return toast.error("Tick at least one supplier invoice");
    if (voucherAmount < 0) return toast.error("Amount cannot be negative");
    if (voucherAmount === 0 && !creditOn) return toast.error("Enter the amount being paid");
    if (Math.abs(balance) > 0.005) return toast.error(`Balance must be 0.00 — allocate the full ${fmt(supplierAmount)} (balance ${fmt(balance)})`);
    const line: PvLine = {
      id: existing?.id || `creditor-${supplier.id}`,
      accountCode: creditorAccountCode || existing?.accountCode || "",
      accountName: creditorAccount?.name || "",
      description: (creditorAccount?.name || "TRADE CREDITORS").toUpperCase(),
      remarks: `${supplier.supplierCode ? `${supplier.supplierCode} — ` : ""}${supplier.name || ""}`.trim(),
      amount: voucherAmount,
      offset: {
        supplierId: supplier.id,
        supplierCode: supplier.supplierCode || null,
        supplierName: supplier.name || "",
        currency: supplierCurrency,
        rate: rateNum,
        voucherAmount,
        supplierAmount,
        allocations,
        updateFx,
        fxAccountCode: fxCode || null,
      },
    };
    onSave(line, supplier);
  };

  const headCellSx = { fontWeight: 700, fontSize: "0.72rem", color: "text.secondary", whiteSpace: "nowrap" as const };
  const smallBox = { width: 150 };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1, pr: 6 }}>
        Offset Supplier Invoices
        <Typography component="span" variant="body2" sx={{ color: "text.secondary", ml: 1 }}>
          P/V {voucherNumber || "(unnumbered)"} · {voucherDate ? new Date(voucherDate).toLocaleDateString("en-GB") : ""}
        </Typography>
        <IconButton onClick={onClose} size="small" sx={{ position: "absolute", right: 8, top: 8 }} title="Close">
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers {...enterScopeProps} sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
        <Box>
          <Box sx={bandSx}>{(creditorAccount?.name || "TRADE CREDITORS").toUpperCase()}</Box>
          <Typography component="span" variant="caption" sx={{ ml: 1.5, color: "text.secondary" }}>
            {creditorAccountCode ? `Account ${creditorAccountCode}` : "Creditor control from Accounting Setup"}
          </Typography>
        </Box>

        {/* Supplier code */}
        <Stack direction="row" alignItems="center" spacing={1.5} flexWrap="wrap">
          <Typography sx={{ fontWeight: 700, fontSize: "0.8125rem", width: 110 }}>Supplier code</Typography>
          <TextField
            size="small"
            value={codeInput}
            placeholder="Code"
            autoFocus
            onChange={(e) => {
              const v = e.target.value;
              setCodeInput(v);
              const match = suppliers.find((s: any) => String(s.supplierCode || s.customerCode || "").toLowerCase() === v.trim().toLowerCase());
              if (match && match.id !== supplier?.id) pickSupplier(match);
            }}
            onBlur={() => setCodeInput(supplier?.supplierCode || "")}
            sx={{ width: 180 }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start" sx={{ mr: 0 }}>
                  <IconButton data-hotkey="lookup" size="small" onClick={() => setPickerOpen(true)} sx={{ p: 0.25, ml: -0.5 }} title="Search">
                    <SearchIcon sx={{ fontSize: 16 }} />
                  </IconButton>
                </InputAdornment>
              ),
            }}
          />
          <Typography sx={{ fontWeight: 700, fontSize: "0.875rem" }}>{supplier?.name || ""}</Typography>
        </Stack>

        {/* Amount · Rate · Supplier Amount */}
        <Stack direction="row" alignItems="center" spacing={1.5} flexWrap="wrap">
          <Typography sx={{ fontWeight: 700, fontSize: "0.8125rem", width: 110 }}>Amount</Typography>
          <Typography sx={{ fontWeight: 700, fontSize: "0.8125rem", color: "text.secondary" }}>{voucherCurrency}</Typography>
          <TextField
            size="small"
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputProps={{ step: "0.01", min: 0, style: { textAlign: "right" } }}
            sx={smallBox}
          />
          <Typography sx={{ fontWeight: 700, fontSize: "0.8125rem", ml: 2 }}>Rate</Typography>
          <TextField
            size="small"
            type="number"
            value={rate}
            disabled={sameCurrency}
            onChange={(e) => setRate(e.target.value)}
            inputProps={{ step: "0.000001", min: 0, style: { textAlign: "right" } }}
            sx={{ width: 130 }}
            title={sameCurrency ? "Same currency" : `${supplierCurrency} per ${voucherCurrency}`}
          />
          <Typography sx={{ fontWeight: 700, fontSize: "0.8125rem", ml: 2 }}>Supplier Amount</Typography>
          <Typography sx={{ fontWeight: 700, fontSize: "0.8125rem", color: "text.secondary" }}>{supplierCurrency}</Typography>
          <TextField size="small" value={fmt(supplierAmount)} InputProps={{ readOnly: true }} inputProps={{ style: { textAlign: "right" } }} sx={smallBox} />
        </Stack>

        {/* Invoice grid */}
        {!supplier?.id ? (
          <Alert severity="info" variant="outlined" sx={{ alignSelf: "flex-start" }}>
            Pick a supplier to list their unpaid invoices.
          </Alert>
        ) : loading ? (
          <Box sx={{ display: "flex", justifyContent: "center", p: 3 }}>
            <CircularProgress size={22} />
          </Box>
        ) : bills.length === 0 ? (
          <Alert severity="warning" variant="outlined" sx={{ alignSelf: "flex-start" }}>
            No unpaid supplier invoices for this supplier.
          </Alert>
        ) : (
          <>
            {supplierAmount <= 0 && !creditOn && (
              <Alert severity="info" variant="outlined" sx={{ alignSelf: "flex-start" }}>
                Enter the amount first — ticking allocates it top-down. A credit note can be ticked straight away: it reduces what you pay.
              </Alert>
            )}
            <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 340, borderRadius: 1.5 }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell sx={headCellSx}>Reference</TableCell>
                    <TableCell sx={headCellSx}>Date</TableCell>
                    <TableCell sx={headCellSx}>X-Reference</TableCell>
                    <TableCell sx={headCellSx}>Remarks</TableCell>
                    <TableCell sx={{ ...headCellSx, width: 44 }}>Tick</TableCell>
                    <TableCell sx={{ ...headCellSx, textAlign: "right" }}>Credit</TableCell>
                    <TableCell sx={{ ...headCellSx, textAlign: "right", width: 150 }}>Partial / Full</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {bills.map((b) => {
                    const ticked = allocById.has(b.documentId);
                    const amt = Math.abs(Number(allocById.get(b.documentId)) || 0);
                    return (
                      <TableRow key={b.documentId} hover sx={ticked ? { bgcolor: (t) => alpha(t.palette.primary.main, 0.06) } : undefined}>
                        <TableCell sx={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
                          {b.reference}
                          {isCredit(b) && (
                            <Chip label="Credit note" size="small" variant="outlined" sx={{ ml: 1, height: 18, fontSize: "0.65rem", color: "success.main", borderColor: "success.main" }} />
                          )}
                        </TableCell>
                        <TableCell>{b.date ? new Date(b.date).toLocaleDateString("en-GB") : "—"}</TableCell>
                        <TableCell sx={{ color: "text.secondary" }}>{b.type === "CREDIT_NOTE" ? "CN" : "SIN"}</TableCell>
                        <TableCell>{b.remarks}</TableCell>
                        <TableCell padding="checkbox">
                          <Checkbox size="small" checked={ticked} onChange={(_, c) => toggle(b, c)} disabled={supplierAmount <= 0 && !isCredit(b) && !creditOn} />
                        </TableCell>
                        <TableCell sx={{ textAlign: "right", fontVariantNumeric: "tabular-nums", ...(isCredit(b) ? { color: "success.main" } : {}) }}>
                          {isCredit(b) ? `(${fmt(b.outstanding)})` : fmt(b.outstanding)}
                        </TableCell>
                        <TableCell sx={{ textAlign: "right" }}>
                          <Stack direction="row" spacing={0.5} alignItems="center" justifyContent="flex-end">
                            {ticked && (
                              <Chip size="small" variant="outlined" label={Math.abs(amt - b.outstanding) < 0.005 ? "Full" : "Partial"} sx={{ height: 18, fontSize: "0.65rem" }} />
                            )}
                            <TextField
                              size="small"
                              type="number"
                              value={ticked ? amt : ""}
                              onChange={(e) => setLineAmount(b, e.target.value)}
                              disabled={!ticked}
                              inputProps={{ step: "0.01", min: 0, max: b.outstanding, style: { textAlign: "right" } }}
                              sx={{ width: 120 }}
                            />
                          </Stack>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          </>
        )}

        {/* Debit / Credit / Balance */}
        <Stack direction="row" spacing={3} alignItems="center" justifyContent="flex-end" sx={{ pr: 1 }}>
          <Typography variant="body2" sx={{ color: "text.secondary" }}>Debit Amount</Typography>
          <Typography sx={{ fontVariantNumeric: "tabular-nums", fontWeight: 600, minWidth: 100, textAlign: "right" }}>{fmt(debitAmount)}</Typography>
          <Typography variant="body2" sx={{ color: "text.secondary" }}>Credit Amount</Typography>
          <Typography sx={{ fontVariantNumeric: "tabular-nums", fontWeight: 600, minWidth: 100, textAlign: "right" }}>{fmt(creditAmount)}</Typography>
          <Typography variant="body2" sx={{ fontWeight: 700 }}>Balance</Typography>
          <Typography variant="body2" sx={{ color: "text.secondary" }}>{supplierCurrency}</Typography>
          <Typography sx={{ fontVariantNumeric: "tabular-nums", fontWeight: 700, minWidth: 100, textAlign: "right", color: Math.abs(balance) <= 0.005 ? "success.main" : "error.main" }}>
            {fmt(balance)}
          </Typography>
        </Stack>

        {/* Exchange gain / loss */}
        <Stack direction="row" alignItems="center" spacing={1.5} flexWrap="wrap" sx={{ pt: 0.5, borderTop: 1, borderColor: "divider" }}>
          <FormControlLabel
            control={<Checkbox size="small" checked={updateFx} onChange={(_, c) => setUpdateFx(c)} />}
            label={<Typography variant="body2" sx={{ fontWeight: 600, color: "warning.main" }}>Update Exchange Gain / Loss Accounts</Typography>}
            sx={{ mr: 2 }}
          />
          <Typography variant="body2" sx={{ color: "text.secondary" }}>Document</Typography>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>P/V {voucherNumber || "—"}</Typography>
          <Typography variant="body2" sx={{ color: "text.secondary", ml: 2 }}>Date</Typography>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>{voucherDate ? new Date(voucherDate).toLocaleDateString("en-GB") : "—"}</Typography>
          <Typography variant="body2" sx={{ color: "text.secondary", ml: 2 }}>EXCHANGE GAIN/LOSS</Typography>
          <TextField
            size="small"
            value={fxCode}
            placeholder="Default"
            disabled={!updateFx}
            onChange={(e) => setFxCode(e.target.value.toUpperCase())}
            sx={{ width: 150 }}
            title="Blank = the FX gain/loss account in Accounting Setup"
            InputProps={{
              startAdornment: (
                <InputAdornment position="start" sx={{ mr: 0 }}>
                  <IconButton data-hotkey="lookup" size="small" disabled={!updateFx} onClick={() => setFxOpen(true)} sx={{ p: 0.25, ml: -0.5 }} title="Search">
                    <SearchIcon sx={{ fontSize: 16 }} />
                  </IconButton>
                </InputAdornment>
              ),
            }}
          />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 1.5 }}>
        {existing && (
          <Button color="error" onClick={onClear} sx={{ mr: "auto" }}>
            Remove supplier line
          </Button>
        )}
        <Button onClick={onClose}>Cancel</Button>
        <Button data-hotkey="save" variant="contained" onClick={save} disabled={!supplier?.id}>
          Save
        </Button>
      </DialogActions>

      <CustomerSelectDialog
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        customers={suppliers}
        serverSearch={false}
        onSelectCustomer={(c: any) => pickSupplier(c)}
      />
      <AccountSelectDialog open={fxOpen} onClose={() => setFxOpen(false)} accounts={accounts.filter((a: OrAccount) => a.isActive !== false)} onSelect={(a) => setFxCode(a.code)} />
    </Dialog>
  );
}
