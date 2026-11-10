"use client";

// Offset dialog behind the Payee pencil / a control-account line (legacy P/V
// "Offset Supplier Invoices", guru 2026-11-09), in TWO modes:
//
//   party="supplier" — the org's AP control (Trade Creditors): pick the
//     supplier, tick their invoices (credit notes negative), Balance 0.00.
//   party="customer" — the org's AR control (Trade Debtors): pick the
//     customer; on a Journal Voucher tick their invoices / credit notes, on a
//     Payment Voucher only credit notes (a refund), Balance 0.00.
//
//   TRADE CREDITORS
//   Supplier code [C2001] 🔍  2LT GLASS & MIRROR ALUMINIUM CONTRACT
//   Amount SGD [1,000.00]  Rate [1.0000000]  Supplier Amount SGD [1000.00]
//   Reference | Date | X-Reference | Remarks | Tick | Credit | Partial / Full
//   Debit Amount 1,000.00   Credit Amount 0.00   Balance SGD 1,000.00
//   ☑ Update Exchange Gain / Loss Accounts
//
// Saving returns ONE control-account line (the control code, the amount in
// the voucher currency, the party + ticked documents as the line's offset).
// The control codes come from each org's Accounting Setup (AR / AP control).

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
import { request as apiRequest } from "@/helpers/request";

export type PvParty = "supplier" | "customer";
export type PvAllocation = { documentId: string; amount: number; reference?: string | null; date?: string | null; description?: string };
export type PvOffset = {
  party?: PvParty | null;
  supplierId?: string | null;
  supplierCode?: string | null;
  supplierName?: string | null;
  customerId?: string | null;
  customerCode?: string | null;
  customerName?: string | null;
  currency?: string | null;
  /** Party currency per voucher currency. */
  rate: number;
  /** Voucher currency (what the line carries). */
  voucherAmount: number;
  /** Party currency = voucherAmount × rate; what the allocations add up to. */
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

type OpenDoc = {
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
  party = "supplier",
  allowInvoices = true,
  voucherId,
  voucherNumber,
  voucherDate,
  voucherCurrency,
  creditorAccountCode,
  suppliers,
  customers = [],
  existing,
  existingSupplier,
  onSave,
  onClear,
}: {
  open: boolean;
  onClose: () => void;
  party?: PvParty;
  /** Customer mode: whether the customer's INVOICES may be ticked (J/V yes, P/V refund no). */
  allowInvoices?: boolean;
  voucherId?: string;
  voucherNumber: string;
  voucherDate: string;
  voucherCurrency: string;
  /** The control account the saved line carries (AP control for suppliers, AR control for customers). */
  creditorAccountCode: string;
  suppliers: any[];
  customers?: any[];
  existing: PvLine | null;
  existingSupplier: any | null;
  onSave: (line: PvLine, partyRecord: any) => void;
  onClear: () => void;
}) {
  const { getToken } = useAuth();
  const accounts = useOrAccounts();
  const isCustomer = party === "customer";
  const controlAccount = accounts.find((a) => a.code === creditorAccountCode);
  const partyList = isCustomer ? customers : suppliers;
  const codeOf = (p: any) => (isCustomer ? p?.customerCode : p?.supplierCode || p?.customerCode) || "";

  const [who, setWho] = useState<any | null>(null);
  const [codeInput, setCodeInput] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [amount, setAmount] = useState<string>("");
  const [rate, setRate] = useState<string>("1");
  const [allocations, setAllocations] = useState<PvAllocation[]>([]);
  const [updateFx, setUpdateFx] = useState(true);
  const [fxCode, setFxCode] = useState("");
  const [fxOpen, setFxOpen] = useState(false);
  const [docs, setDocs] = useState<OpenDoc[]>([]);
  const [loading, setLoading] = useState(false);
  // Bumped on every pick so re-picking the same party refetches (a fetch that
  // hit the API mid-restart left the list empty otherwise).
  const [fetchTick, setFetchTick] = useState(0);

  // Start from the existing control line (edit) or empty (new).
  useEffect(() => {
    if (!open) return;
    const o = existing?.offset;
    if (o) {
      const id = isCustomer ? o.customerId : o.supplierId;
      const s =
        partyList.find((x: any) => x.id === id) ||
        existingSupplier ||
        (isCustomer
          ? { id: o.customerId, name: o.customerName || "", customerCode: o.customerCode || "", currency: o.currency || voucherCurrency }
          : { id: o.supplierId, name: o.supplierName || "", supplierCode: o.supplierCode || "", currency: o.currency || voucherCurrency });
      setWho(s);
      setCodeInput(codeOf(s));
      setAmount(String(o.voucherAmount ?? existing?.amount ?? ""));
      setRate(String(o.rate ?? 1));
      setAllocations(Array.isArray(o.allocations) ? o.allocations : []);
      setUpdateFx(o.updateFx !== false);
      setFxCode(o.fxAccountCode || "");
    } else {
      const s = existingSupplier?.id ? existingSupplier : null;
      setWho(s);
      setCodeInput(codeOf(s));
      setAmount("");
      setRate("1");
      setAllocations([]);
      setUpdateFx(true);
      setFxCode("");
    }
    setFetchTick((t) => t + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const partyCurrency = String(who?.currency || voucherCurrency).toUpperCase();
  const sameCurrency = partyCurrency === voucherCurrency;
  useEffect(() => {
    if (sameCurrency) setRate("1");
  }, [sameCurrency]);

  // Open documents of the chosen party.
  useEffect(() => {
    if (!open || !who?.id) {
      setDocs([]);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const token = await getToken();
        if (isCustomer) {
          const res = await apiFetch(`/receipts/offset-items/${who.id}`, token);
          const inv: OpenDoc[] = (allowInvoices ? res?.debits || [] : []).map((d: any) => ({ ...d, kind: "bill" as const }));
          const cns: OpenDoc[] = (res?.credits || []).map((d: any) => ({ ...d, kind: "credit" as const, remarks: d.remarks || "CREDIT NOTE" }));
          if (!cancelled) setDocs([...inv, ...cns]);
        } else {
          const excl = voucherId ? `?excludeVoucherId=${voucherId}` : "";
          const rows = (await apiFetch(`/payment-vouchers/open-bills/${who.id}${excl}`, token)) || [];
          if (!cancelled) setDocs(rows);
        }
      } catch (e: any) {
        if (!cancelled) toast.error(e?.message || "Couldn't load the open documents");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, who?.id, voucherId, getToken, fetchTick, isCustomer, allowInvoices]);

  const voucherAmount = R(parseFloat(amount) || 0);
  const rateNum = Number(rate) || 1;
  const partyAmount = R(voucherAmount * rateNum);
  const allocById = useMemo(() => new Map(allocations.map((a) => [a.documentId, Number(a.amount) || 0])), [allocations]);
  const debitAmount = R(allocations.reduce((s, a) => s + Math.max(0, Number(a.amount) || 0), 0));
  const creditAmount = R(allocations.reduce((s, a) => s + Math.max(0, -(Number(a.amount) || 0)), 0));
  // Refund (customer on a P/V): the amount paid out equals the credit used up.
  const refundMode = isCustomer && !allowInvoices;
  const balance = refundMode ? R(partyAmount - creditAmount) : R(partyAmount - (debitAmount - creditAmount));
  const creditOn = allocations.some((a) => (Number(a.amount) || 0) < 0);
  const isCredit = (b: OpenDoc) => b.kind === "credit";

  const entryFor = (b: OpenDoc, amt: number): PvAllocation => ({
    documentId: b.documentId,
    amount: amt,
    reference: b.reference,
    date: b.date,
    description: b.remarks || (isCredit(b) ? (isCustomer ? "CREDIT NOTE" : "SUPPLIER CREDIT NOTE") : isCustomer ? "INVOICE" : "SUPPLIER INVOICE"),
  });

  // Tick = allocate the remaining pool top-down (partial on the last). A
  // credit note goes in NEGATIVE: it is not paid, it pays (or, on a refund,
  // it is the credit being handed back).
  const toggle = (b: OpenDoc, checked: boolean) => {
    if (!checked) {
      setAllocations(allocations.filter((a) => a.documentId !== b.documentId));
      return;
    }
    const rest = allocations.filter((a) => a.documentId !== b.documentId);
    if (isCredit(b)) {
      if (refundMode) {
        const othersCredit = R(rest.reduce((s, a) => s + Math.max(0, -(Number(a.amount) || 0)), 0));
        const remaining = R(Math.max(0, partyAmount - othersCredit));
        setAllocations([...rest, entryFor(b, R(-Math.min(b.outstanding, remaining)))]);
        return;
      }
      setAllocations([...rest, entryFor(b, R(-b.outstanding))]);
      return;
    }
    const othersTotal = R(rest.reduce((s, a) => s + (Number(a.amount) || 0), 0));
    const remaining = R(Math.max(0, partyAmount - othersTotal));
    setAllocations([...rest, entryFor(b, R(Math.min(b.outstanding, remaining)))]);
  };
  const setLineAmount = (b: OpenDoc, raw: string) => {
    const typed = R(Math.max(0, Math.min(Math.abs(parseFloat(raw) || 0), b.outstanding)));
    const rest = allocations.filter((a) => a.documentId !== b.documentId);
    setAllocations(typed <= 0 ? rest : [...rest, entryFor(b, isCredit(b) ? -typed : typed)]);
  };

  const pickParty = (s: any) => {
    setWho(s);
    setCodeInput(codeOf(s));
    setAllocations([]);
    setFetchTick((t) => t + 1);
  };
  // Customers are not all loaded (orgs have thousands): an exact code typed
  // asks the server; suppliers keep the local list.
  const tryCode = async (v: string) => {
    const code = v.trim().toLowerCase();
    if (!code) return;
    const local = partyList.find((p: any) => String(codeOf(p)).toLowerCase() === code);
    if (local) {
      if (local.id !== who?.id) pickParty(local);
      return;
    }
    if (!isCustomer) return;
    try {
      const token = await getToken();
      const res: any = await apiRequest({ path: "/customers", method: "POST" }, { page: 1, limit: 10, search: v.trim(), exactFirst: true }, token || undefined);
      const list: any[] = res?.data?.docs || res?.data?.customers || res?.docs || [];
      const found = list.find((c: any) => String(c.customerCode || "").toLowerCase() === code);
      if (found && found.id !== who?.id) pickParty(found);
    } catch {
      /* no match */
    }
  };

  const save = () => {
    if (!who?.id) return toast.error(isCustomer ? "Pick the customer" : "Pick the supplier");
    if (!allocations.length) return toast.error(isCustomer ? "Tick at least one document" : "Tick at least one supplier invoice");
    if (voucherAmount < 0) return toast.error("Amount cannot be negative");
    if (voucherAmount === 0 && !creditOn) return toast.error("Enter the amount");
    if (Math.abs(balance) > 0.005) return toast.error(`Balance must be 0.00 — allocate the full ${fmt(partyAmount)} (balance ${fmt(balance)})`);
    const line: PvLine = {
      id: existing?.id || `${isCustomer ? "debtor" : "creditor"}-${who.id}`,
      accountCode: creditorAccountCode || existing?.accountCode || "",
      accountName: controlAccount?.name || "",
      description: (controlAccount?.name || (isCustomer ? "TRADE DEBTORS" : "TRADE CREDITORS")).toUpperCase(),
      remarks: `${codeOf(who) ? `${codeOf(who)} — ` : ""}${who.name || ""}`.trim(),
      amount: voucherAmount,
      offset: {
        party,
        ...(isCustomer
          ? { customerId: who.id, customerCode: who.customerCode || null, customerName: who.name || "" }
          : { supplierId: who.id, supplierCode: who.supplierCode || null, supplierName: who.name || "" }),
        currency: partyCurrency,
        rate: rateNum,
        voucherAmount,
        supplierAmount: partyAmount,
        allocations,
        updateFx,
        fxAccountCode: fxCode || null,
      },
    };
    onSave(line, who);
  };

  const headCellSx = { fontWeight: 700, fontSize: "0.72rem", color: "text.secondary", whiteSpace: "nowrap" as const };
  const smallBox = { width: 150 };
  const partyWord = isCustomer ? "customer" : "supplier";
  const title = isCustomer ? (refundMode ? "Refund Customer Credit Notes" : "Offset Customer Invoices") : "Offset Supplier Invoices";

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1, pr: 6 }}>
        {title}
        <Typography component="span" variant="body2" sx={{ color: "text.secondary", ml: 1 }}>
          {voucherNumber || "(unnumbered)"} · {voucherDate ? new Date(voucherDate).toLocaleDateString("en-GB") : ""}
        </Typography>
        <IconButton onClick={onClose} size="small" sx={{ position: "absolute", right: 8, top: 8 }} title="Close">
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers {...enterScopeProps} sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
        <Box>
          <Box sx={bandSx}>{(controlAccount?.name || (isCustomer ? "TRADE DEBTORS" : "TRADE CREDITORS")).toUpperCase()}</Box>
          <Typography component="span" variant="caption" sx={{ ml: 1.5, color: "text.secondary" }}>
            {creditorAccountCode ? `Account ${creditorAccountCode}` : `${isCustomer ? "AR" : "AP"} control from Accounting Setup`}
          </Typography>
        </Box>

        <Stack direction="row" alignItems="center" spacing={1.5} flexWrap="wrap">
          <Typography sx={{ fontWeight: 700, fontSize: "0.8125rem", width: 110 }}>{isCustomer ? "Customer code" : "Supplier code"}</Typography>
          <TextField
            size="small"
            value={codeInput}
            placeholder="Code"
            autoFocus
            onChange={(e) => {
              const v = e.target.value;
              setCodeInput(v);
              const local = partyList.find((p: any) => String(codeOf(p)).toLowerCase() === v.trim().toLowerCase());
              if (local && local.id !== who?.id) pickParty(local);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") void tryCode(codeInput);
            }}
            onBlur={() => {
              if (who) setCodeInput(codeOf(who));
              else void tryCode(codeInput);
            }}
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
          <Typography sx={{ fontWeight: 700, fontSize: "0.875rem" }}>{who?.name || ""}</Typography>
        </Stack>

        <Stack direction="row" alignItems="center" spacing={1.5} flexWrap="wrap">
          <Typography sx={{ fontWeight: 700, fontSize: "0.8125rem", width: 110 }}>Amount</Typography>
          <Typography sx={{ fontWeight: 700, fontSize: "0.8125rem", color: "text.secondary" }}>{voucherCurrency}</Typography>
          <TextField size="small" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} inputProps={{ step: "0.01", min: 0, style: { textAlign: "right" } }} sx={smallBox} />
          <Typography sx={{ fontWeight: 700, fontSize: "0.8125rem", ml: 2 }}>Rate</Typography>
          <TextField
            size="small"
            type="number"
            value={rate}
            disabled={sameCurrency}
            onChange={(e) => setRate(e.target.value)}
            inputProps={{ step: "0.000001", min: 0, style: { textAlign: "right" } }}
            sx={{ width: 130 }}
            title={sameCurrency ? "Same currency" : `${partyCurrency} per ${voucherCurrency}`}
          />
          <Typography sx={{ fontWeight: 700, fontSize: "0.8125rem", ml: 2 }}>{isCustomer ? "Customer Amount" : "Supplier Amount"}</Typography>
          <Typography sx={{ fontWeight: 700, fontSize: "0.8125rem", color: "text.secondary" }}>{partyCurrency}</Typography>
          <TextField size="small" value={fmt(partyAmount)} InputProps={{ readOnly: true }} inputProps={{ style: { textAlign: "right" } }} sx={smallBox} />
        </Stack>

        {!who?.id ? (
          <Alert severity="info" variant="outlined" sx={{ alignSelf: "flex-start" }}>
            Pick a {partyWord} to list their open {refundMode ? "credit notes" : "documents"}.
          </Alert>
        ) : loading ? (
          <Box sx={{ display: "flex", justifyContent: "center", p: 3 }}>
            <CircularProgress size={22} />
          </Box>
        ) : docs.length === 0 ? (
          <Alert severity="warning" variant="outlined" sx={{ alignSelf: "flex-start" }}>
            {refundMode ? `No open credit notes for this ${partyWord}.` : `No open ${isCustomer ? "invoices or credit notes" : "supplier invoices"} for this ${partyWord}.`}
          </Alert>
        ) : (
          <>
            {partyAmount <= 0 && !creditOn && (
              <Alert severity="info" variant="outlined" sx={{ alignSelf: "flex-start" }}>
                {refundMode
                  ? "Enter the amount being refunded first, then tick the credit notes it returns."
                  : "Enter the amount first — ticking allocates it top-down. A credit note can be ticked straight away: it reduces what is paid."}
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
                    <TableCell sx={{ ...headCellSx, textAlign: "right" }}>{isCustomer ? "Outstanding" : "Credit"}</TableCell>
                    <TableCell sx={{ ...headCellSx, textAlign: "right", width: 150 }}>Partial / Full</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {docs.map((b) => {
                    const ticked = allocById.has(b.documentId);
                    const amt = Math.abs(Number(allocById.get(b.documentId)) || 0);
                    return (
                      <TableRow key={b.documentId} hover sx={ticked ? { bgcolor: (t) => alpha(t.palette.primary.main, 0.06) } : undefined}>
                        <TableCell sx={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
                          {b.reference}
                          {isCredit(b) && <Chip label="Credit note" size="small" variant="outlined" sx={{ ml: 1, height: 18, fontSize: "0.65rem", color: "success.main", borderColor: "success.main" }} />}
                        </TableCell>
                        <TableCell>{b.date ? new Date(b.date).toLocaleDateString("en-GB") : "—"}</TableCell>
                        <TableCell sx={{ color: "text.secondary" }}>{isCredit(b) ? "CN" : isCustomer ? "INV" : "SIN"}</TableCell>
                        <TableCell>{b.remarks}</TableCell>
                        <TableCell padding="checkbox">
                          <Checkbox size="small" checked={ticked} onChange={(_, c) => toggle(b, c)} disabled={partyAmount <= 0 && (refundMode || (!isCredit(b) && !creditOn))} />
                        </TableCell>
                        <TableCell sx={{ textAlign: "right", fontVariantNumeric: "tabular-nums", ...(isCredit(b) ? { color: "success.main" } : {}) }}>
                          {isCredit(b) ? `(${fmt(b.outstanding)})` : fmt(b.outstanding)}
                        </TableCell>
                        <TableCell sx={{ textAlign: "right" }}>
                          <Stack direction="row" spacing={0.5} alignItems="center" justifyContent="flex-end">
                            {ticked && <Chip size="small" variant="outlined" label={Math.abs(amt - b.outstanding) < 0.005 ? "Full" : "Partial"} sx={{ height: 18, fontSize: "0.65rem" }} />}
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

        <Stack direction="row" spacing={3} alignItems="center" justifyContent="flex-end" sx={{ pr: 1 }}>
          <Typography variant="body2" sx={{ color: "text.secondary" }}>Debit Amount</Typography>
          <Typography sx={{ fontVariantNumeric: "tabular-nums", fontWeight: 600, minWidth: 100, textAlign: "right" }}>{fmt(debitAmount)}</Typography>
          <Typography variant="body2" sx={{ color: "text.secondary" }}>Credit Amount</Typography>
          <Typography sx={{ fontVariantNumeric: "tabular-nums", fontWeight: 600, minWidth: 100, textAlign: "right" }}>{fmt(creditAmount)}</Typography>
          <Typography variant="body2" sx={{ fontWeight: 700 }}>Balance</Typography>
          <Typography variant="body2" sx={{ color: "text.secondary" }}>{partyCurrency}</Typography>
          <Typography sx={{ fontVariantNumeric: "tabular-nums", fontWeight: 700, minWidth: 100, textAlign: "right", color: Math.abs(balance) <= 0.005 ? "success.main" : "error.main" }}>{fmt(balance)}</Typography>
        </Stack>

        <Stack direction="row" alignItems="center" spacing={1.5} flexWrap="wrap" sx={{ pt: 0.5, borderTop: 1, borderColor: "divider" }}>
          <FormControlLabel
            control={<Checkbox size="small" checked={updateFx} onChange={(_, c) => setUpdateFx(c)} />}
            label={<Typography variant="body2" sx={{ fontWeight: 600, color: "warning.main" }}>Update Exchange Gain / Loss Accounts</Typography>}
            sx={{ mr: 2 }}
          />
          <Typography variant="body2" sx={{ color: "text.secondary" }}>Document</Typography>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>{voucherNumber || "—"}</Typography>
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
            Remove {partyWord} line
          </Button>
        )}
        <Button onClick={onClose}>Cancel</Button>
        <Button data-hotkey="save" variant="contained" onClick={save} disabled={!who?.id}>
          Save
        </Button>
      </DialogActions>

      <CustomerSelectDialog
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        customers={partyList}
        serverSearch={isCustomer}
        onSelectCustomer={(c: any) => pickParty(c)}
      />
      <AccountSelectDialog open={fxOpen} onClose={() => setFxOpen(false)} accounts={accounts.filter((a: OrAccount) => a.isActive !== false)} onSelect={(a) => setFxCode(a.code)} />
    </Dialog>
  );
}
