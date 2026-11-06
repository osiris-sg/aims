"use client";

// Spend Money / Receive Money editor (guru 2026-11-06) — Xero's direct bank
// transaction: money paid out with no supplier invoice behind it (a bank
// charge, a petty purchase, a reimbursement) or money in with no customer
// invoice (interest, a refund, a grant). Bank account, date, payee, reference,
// lines (account + amount) with the same tax treatment controls as a supplier
// invoice, attachments, and Save posts ONE journal straight to the bank ledger.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Autocomplete,
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
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import CloseIcon from "@mui/icons-material/Close";
import { toast } from "react-toastify";
import { accountTypeLabel, sortAccountsByType } from "@/components/glAccountGrouping";
import AttachmentUploader, { Attachment } from "@/components/AttachmentUploader";
import { useAccountingApi } from "../_lib/api";
import { todayIso } from "@/helpers/orgToday";

export type BankTransactionKind = "SPEND" | "RECEIVE";
export const KIND_LABEL: Record<BankTransactionKind, string> = { SPEND: "Spend Money", RECEIVE: "Receive Money" };

type Account = { id: string; code: string; name: string; category?: "PNL" | "BALANCE_SHEET"; accountType?: string; isActive: boolean };
type TaxRateOpt = { id: string; code: string; name: string; rate: number; direction: string; isActive: boolean };
type AmountsAre = "EXCLUSIVE" | "INCLUSIVE" | "NO_TAX";
type Line = { description: string; accountId: string | null; amount: string };

export type BankTransactionRow = {
  id: string;
  kind: BankTransactionKind;
  number: string;
  status: "POSTED" | "VOID";
  date: string | null;
  bankAccountCode: string | null;
  bankAccountName: string | null;
  payee: string | null;
  reference: string | null;
  remarks: string | null;
  chequeNo: string | null;
  amountsAre: AmountsAre;
  taxCode: string | null;
  taxRate: number;
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  lines: Array<{ description?: string | null; accountId: string; accountCode?: string | null; accountName?: string | null; amount: number }>;
  attachments: Attachment[];
  journalNumber: string | null;
  voidedAt?: string | null;
  voidedBy?: string | null;
  savedBy?: string | null;
  savedAt?: string | null;
};

// Bank / cash accounts only (same rule as the receipt and voucher editors).
const isBankish = (a: Account) => {
  if (a.isActive === false) return false;
  if (a.accountType === "FOREIGN_BANK") return true;
  const n = String(a.name || "").toLowerCase();
  return a.accountType === "CURRENT_ASSET" && (/\bbank\b/.test(n) || /\bcash\b/.test(n));
};

const R = (n: number) => Math.round(n * 100) / 100;
const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const emptyLine = (): Line => ({ description: "", accountId: null, amount: "" });

export default function BankTransactionDialog({
  open,
  kind,
  editing,
  onClose,
  onSaved,
}: {
  open: boolean;
  kind: BankTransactionKind;
  editing: BankTransactionRow | null;
  onClose: () => void;
  onSaved: (row: BankTransactionRow) => void;
}) {
  const { request } = useAccountingApi();
  const isSpend = kind === "SPEND";
  const readOnly = editing?.status === "VOID";

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [taxRates, setTaxRates] = useState<TaxRateOpt[]>([]);
  const [loadingRefs, setLoadingRefs] = useState(false);

  const [number, setNumber] = useState("");
  const [date, setDate] = useState(todayIso());
  const [bankAccountCode, setBankAccountCode] = useState("");
  const [payee, setPayee] = useState("");
  const [reference, setReference] = useState("");
  const [remarks, setRemarks] = useState("");
  const [chequeNo, setChequeNo] = useState("");
  const [amountsAre, setAmountsAre] = useState<AmountsAre>("EXCLUSIVE");
  const [taxCode, setTaxCode] = useState(isSpend ? "4" : "1");
  const [taxAmount, setTaxAmount] = useState("0.00");
  const taxManualRef = useRef(false);
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [saving, setSaving] = useState(false);

  // Reference data once per open.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoadingRefs(true);
      try {
        const [acc, rates] = await Promise.all([
          request<Account[]>("/accounting/accounts"),
          request<TaxRateOpt[]>("/accounting/tax-rates").catch(() => [] as TaxRateOpt[]),
        ]);
        if (cancelled) return;
        setAccounts((acc || []).filter((a) => a.isActive).sort((a, b) => a.code.localeCompare(b.code)));
        setTaxRates((Array.isArray(rates) ? rates : []).filter((t) => t.isActive));
      } catch (e: any) {
        if (!cancelled) toast.error(e?.message || "Couldn't load accounts");
      } finally {
        if (!cancelled) setLoadingRefs(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Form state from the row being edited, or a blank one.
  useEffect(() => {
    if (!open) return;
    taxManualRef.current = false;
    if (editing) {
      setNumber(editing.number || "");
      setDate(editing.date || todayIso());
      setBankAccountCode(editing.bankAccountCode || "");
      setPayee(editing.payee || "");
      setReference(editing.reference || "");
      setRemarks(editing.remarks || "");
      setChequeNo(editing.chequeNo || "");
      setAmountsAre(editing.amountsAre || "EXCLUSIVE");
      setTaxCode(editing.taxCode || (isSpend ? "4" : "1"));
      setTaxAmount((editing.taxAmount ?? 0).toFixed(2));
      taxManualRef.current = true; // keep the stored tax until a line/rate changes
      setLines(
        (editing.lines || []).length
          ? editing.lines.map((l) => ({ description: l.description || "", accountId: l.accountId || null, amount: String(l.amount ?? "") }))
          : [emptyLine()],
      );
      setAttachments(Array.isArray(editing.attachments) ? editing.attachments : []);
    } else {
      setNumber("");
      setDate(todayIso());
      setBankAccountCode("");
      setPayee("");
      setReference("");
      setRemarks("");
      setChequeNo("");
      setAmountsAre("EXCLUSIVE");
      setTaxCode(isSpend ? "4" : "1");
      setTaxAmount("0.00");
      setLines([emptyLine()]);
      setAttachments([]);
    }
  }, [open, editing, isSpend]);

  const banks = useMemo(() => accounts.filter(isBankish), [accounts]);
  const lineAccounts = useMemo(() => sortAccountsByType(accounts.filter((a) => a.code !== bankAccountCode)), [accounts, bankAccountCode]);
  const directionRates = useMemo(() => {
    const dir = isSpend ? "INPUT" : "OUTPUT";
    const mine = taxRates.filter((t) => String(t.direction).toUpperCase() === dir);
    return mine.length ? mine : taxRates;
  }, [taxRates, isSpend]);

  const linesSum = R(lines.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0));
  const selRate = taxRates.find((t) => t.code === taxCode)?.rate ?? 9;
  useEffect(() => {
    if (taxManualRef.current || readOnly) return;
    let t = 0;
    if (amountsAre === "EXCLUSIVE") t = (linesSum * selRate) / 100;
    else if (amountsAre === "INCLUSIVE") t = (linesSum * selRate) / (100 + selRate);
    setTaxAmount(R(t).toFixed(2));
  }, [linesSum, amountsAre, selRate, readOnly]);
  const tax = amountsAre === "NO_TAX" ? 0 : parseFloat(taxAmount) || 0;
  const subtotal = amountsAre === "INCLUSIVE" ? R(linesSum - tax) : linesSum;
  const total = amountsAre === "INCLUSIVE" ? linesSum : R(linesSum + tax);

  const setLine = (i: number, patch: Partial<Line>) => {
    taxManualRef.current = false;
    setLines((prev) => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  };

  const save = async () => {
    if (!bankAccountCode) return toast.error("Pick the bank account");
    if (!date) return toast.error("Pick the date");
    const body = {
      kind,
      number: number.trim() || null,
      date,
      bankAccountCode,
      payee: payee.trim() || null,
      reference: reference.trim() || null,
      remarks: remarks.trim() || null,
      chequeNo: chequeNo.trim() || null,
      paymentMethod: chequeNo.trim() ? "cheque" : "transfer",
      amountsAre,
      taxCode: amountsAre === "NO_TAX" ? null : taxCode,
      taxRate: amountsAre === "NO_TAX" ? 0 : selRate,
      taxAmount: amountsAre === "NO_TAX" ? 0 : tax,
      lines: lines
        .filter((l) => l.accountId && parseFloat(l.amount))
        .map((l) => ({ description: l.description.trim() || null, accountId: l.accountId, amount: parseFloat(l.amount) })),
      attachments,
    };
    if (!body.lines.length) return toast.error("Add at least one line with an account and an amount");
    setSaving(true);
    try {
      const saved = editing
        ? await request<BankTransactionRow>(`/bank-transactions/${editing.id}`, { method: "PUT", body: JSON.stringify(body) })
        : await request<BankTransactionRow>(`/bank-transactions`, { method: "POST", body: JSON.stringify(body) });
      toast.success(`${KIND_LABEL[kind]} ${saved.number} saved${saved.journalNumber ? ` — ${saved.journalNumber} posted` : ""}`);
      onSaved(saved);
    } catch (e: any) {
      toast.error(e?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const title = editing ? `${KIND_LABEL[kind]} ${editing.number}` : `New ${KIND_LABEL[kind]}`;

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1, pr: 6 }}>
        <Box sx={{ fontWeight: 700 }}>{title}</Box>
        {editing?.status === "VOID" && <Chip size="small" color="error" variant="outlined" label="Void" />}
        {editing?.journalNumber && editing.status !== "VOID" && (
          <Chip size="small" color="success" variant="outlined" label={editing.journalNumber} />
        )}
        <IconButton onClick={onClose} disabled={saving} size="small" sx={{ position: "absolute", right: 12, top: 12 }} aria-label="Close">
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          {isSpend
            ? "Money paid straight from the bank with no supplier invoice — posts Dr the line accounts (and input GST) / Cr the bank."
            : "Money received straight into the bank with no customer invoice — posts Dr the bank / Cr the line accounts (and output GST)."}
        </Typography>

        <Box sx={{ display: "grid", gap: 1.5, gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr", md: "1fr 1fr 1fr" } }}>
          <TextField
            size="small"
            select
            label={isSpend ? "Paid from (bank)" : "Received into (bank)"}
            required
            value={banks.some((b) => b.code === bankAccountCode) ? bankAccountCode : ""}
            onChange={(e) => setBankAccountCode(e.target.value)}
            disabled={readOnly || loadingRefs}
            helperText={!loadingRefs && !banks.length ? "No bank or cash account in the chart" : undefined}
          >
            {banks.map((b) => (
              <MenuItem key={b.id} value={b.code}>
                {b.code} — {b.name}
              </MenuItem>
            ))}
          </TextField>
          <TextField size="small" type="date" label="Date" required InputLabelProps={{ shrink: true }} value={date} onChange={(e) => setDate(e.target.value)} disabled={readOnly} />
          <TextField
            size="small"
            label="Number"
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            placeholder={editing ? "" : "Issued on save"}
            helperText={editing ? undefined : "Leave blank for the next number in the series"}
            disabled={readOnly}
          />
          <TextField size="small" label={isSpend ? "Paid to (payee)" : "Received from (payer)"} value={payee} onChange={(e) => setPayee(e.target.value)} disabled={readOnly} />
          <TextField size="small" label="Reference" value={reference} onChange={(e) => setReference(e.target.value)} disabled={readOnly} placeholder="What this is for" />
          <TextField size="small" label="Cheque no. (optional)" value={chequeNo} onChange={(e) => setChequeNo(e.target.value)} disabled={readOnly} />
        </Box>

        <Box sx={{ display: "grid", gap: 1.5, gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr 1fr" } }}>
          <TextField
            size="small"
            select
            label="Amounts are"
            value={amountsAre}
            onChange={(e) => {
              setAmountsAre(e.target.value as AmountsAre);
              taxManualRef.current = false;
            }}
            disabled={readOnly}
          >
            <MenuItem value="EXCLUSIVE">Tax Exclusive</MenuItem>
            <MenuItem value="INCLUSIVE">Tax Inclusive</MenuItem>
            <MenuItem value="NO_TAX">No Tax</MenuItem>
          </TextField>
          <TextField
            size="small"
            select
            label="Tax code"
            value={taxRates.some((t) => t.code === taxCode) ? taxCode : ""}
            onChange={(e) => {
              setTaxCode(e.target.value);
              taxManualRef.current = false;
            }}
            disabled={readOnly || amountsAre === "NO_TAX"}
            SelectProps={{ renderValue: (v) => String(v) }}
          >
            {directionRates.map((t) => (
              <MenuItem key={t.id} value={t.code}>
                {t.code} — {t.name} ({t.rate}%)
              </MenuItem>
            ))}
          </TextField>
          <TextField
            size="small"
            type="number"
            label="Tax (GST)"
            value={taxAmount}
            onChange={(e) => {
              setTaxAmount(e.target.value);
              taxManualRef.current = true;
            }}
            disabled={readOnly || amountsAre === "NO_TAX"}
            inputProps={{ step: "0.01", min: 0 }}
          />
        </Box>

        <Box sx={{ border: 1, borderColor: "divider", borderRadius: 1, overflowX: "auto" }}>
          <Table size="small" sx={{ minWidth: 640 }}>
            <TableHead>
              <TableRow>
                <TableCell sx={{ width: "40%" }}>Description</TableCell>
                <TableCell>Account</TableCell>
                <TableCell align="right" sx={{ width: 150 }}>
                  Amount
                </TableCell>
                <TableCell sx={{ width: 48 }} />
              </TableRow>
            </TableHead>
            <TableBody>
              {lines.map((l, i) => (
                <TableRow key={i}>
                  <TableCell>
                    <TextField size="small" fullWidth value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} disabled={readOnly} placeholder="What was it for" />
                  </TableCell>
                  <TableCell>
                    <Autocomplete
                      size="small"
                      options={lineAccounts}
                      groupBy={(o) => accountTypeLabel(o.accountType)}
                      value={accounts.find((a) => a.id === l.accountId) || null}
                      onChange={(_, v) => setLine(i, { accountId: v?.id || null })}
                      getOptionLabel={(o) => `${o.code} — ${o.name}`}
                      isOptionEqualToValue={(o, v) => o.id === v.id}
                      renderInput={(params) => <TextField {...params} placeholder="Account" required />}
                      disabled={readOnly}
                    />
                  </TableCell>
                  <TableCell align="right">
                    <TextField
                      size="small"
                      type="number"
                      value={l.amount}
                      onChange={(e) => setLine(i, { amount: e.target.value })}
                      inputProps={{ step: "0.01", style: { textAlign: "right" } }}
                      disabled={readOnly}
                    />
                  </TableCell>
                  <TableCell>
                    <IconButton size="small" onClick={() => { taxManualRef.current = false; setLines((prev) => (prev.length > 1 ? prev.filter((_, j) => j !== i) : [emptyLine()])); }} disabled={readOnly} aria-label="Remove line">
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
        <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" alignItems={{ sm: "flex-start" }} spacing={1}>
          <Button size="small" startIcon={<AddIcon />} onClick={() => setLines((prev) => [...prev, emptyLine()])} disabled={readOnly}>
            Add line
          </Button>
          <Box sx={{ minWidth: 260, fontVariantNumeric: "tabular-nums" }}>
            <Stack direction="row" justifyContent="space-between"><span>Subtotal</span><span>{fmt(subtotal)}</span></Stack>
            <Stack direction="row" justifyContent="space-between"><span>GST</span><span>{fmt(tax)}</span></Stack>
            <Stack direction="row" justifyContent="space-between" sx={{ fontWeight: 700, borderTop: 1, borderColor: "divider", mt: 0.5, pt: 0.5 }}>
              <span>{isSpend ? "Total paid" : "Total received"}</span>
              <span>{fmt(total)}</span>
            </Stack>
          </Box>
        </Stack>

        <TextField size="small" label="Remarks" value={remarks} onChange={(e) => setRemarks(e.target.value)} multiline minRows={2} disabled={readOnly} />

        <AttachmentUploader folder={`bank-transactions/${editing?.id || "new"}`} value={attachments} onChange={setAttachments} label="Attachments" disabled={readOnly} />

        {editing && (
          <Typography variant="caption" sx={{ color: "text.secondary" }}>
            {editing.status === "VOID"
              ? `Voided ${editing.voidedAt ? new Date(editing.voidedAt).toLocaleString("en-GB") : ""} by ${editing.voidedBy || "—"}`
              : `Saved ${editing.savedAt ? new Date(editing.savedAt).toLocaleString("en-GB") : ""} by ${editing.savedBy || "—"}`}
          </Typography>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          {readOnly ? "Close" : "Cancel"}
        </Button>
        {!readOnly && (
          <Button variant="contained" onClick={save} disabled={saving || loadingRefs} startIcon={saving ? <CircularProgress size={16} color="inherit" /> : undefined}>
            {editing ? "Save and repost" : `Save ${KIND_LABEL[kind]}`}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
