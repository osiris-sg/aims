"use client";

// Payment Voucher pieces for TabbedDocumentCreator — the AP twin of the
// Official Receipt (guru 2026-10-21: "do that" — batch supplier payments the
// way ORs batch customer receipts). Same editor, same row pattern; only the
// field set, the party (supplier) and the body (Offset Transactions over the
// supplier's unpaid bills) differ. Voucher state rides in formData.pvData so
// the editor's dirty tracking, exit prompt and Save path work unchanged.
//
// Accounting: a voucher DEBITS Trade Creditors (per allocated bill) and
// CREDITS the paid-from bank — the mirror of the receipt's Dr bank / Cr debtors.

import React, { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  CircularProgress,
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
  Tab,
  Tabs,
  TextField,
  Typography,
  alpha,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import DescriptionOutlinedIcon from "@mui/icons-material/DescriptionOutlined";
import ManageSearchIcon from "@mui/icons-material/ManageSearch";
import { useAuth } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { headerInputSx } from "./DynamicFormFields";
import { AccountSelectDialog, useOrAccounts, type OrAccount } from "./OfficialReceiptSection";
import type { TemplateFieldConfig } from "../types/templateFieldTypes";

// Field names avoid HEADER_FIELD_ORDER and the right-column substring filters
// (rate/currency/gst/...), so DynamicFormFields renders them single-column in
// exactly this order — the legacy P/V General-tab layout.
export const PV_FIELD_DEFINITIONS: TemplateFieldConfig = {
  tabs: [
    {
      tabId: "general",
      tabLabel: "GENERAL",
      fields: [
        { fieldName: "pvVoucherNo", displayLabel: "Voucher No.", fieldType: "text", required: false },
        { fieldName: "pvData.date", displayLabel: "Date", fieldType: "date", required: true },
        { fieldName: "pvData.chequeNo", displayLabel: "Cheque No.", fieldType: "text", required: false },
        { fieldName: "pvData.remarks", displayLabel: "Remarks", fieldType: "text", required: false },
        { fieldName: "pvSupplier", displayLabel: "Supplier code", fieldType: "text", required: true },
        { fieldName: "pvDebit", displayLabel: "Accounts to  DEBIT", fieldType: "text", required: false },
        { fieldName: "pvCredit", displayLabel: "Accounts to  CREDIT", fieldType: "text", required: true },
        { fieldName: "pvAmountRow", displayLabel: "Payment Amount", fieldType: "text", required: true },
      ],
    },
  ],
};

const fmt = (n: number) =>
  (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

const isBankish = (a: OrAccount) => {
  if (a.isActive === false) return false;
  if (a.accountType === "FOREIGN_BANK") return true;
  const n = String(a.name || "").toLowerCase();
  return a.accountType === "CURRENT_ASSET" && (/\bbank\b/.test(n) || /\bcash\b/.test(n));
};

type RowProps = { formData: any; setFormData: (next: any) => void; suppliers?: any[] };

const setPvData = (formData: any, setFormData: (next: any) => void, patch: Record<string, any>) =>
  setFormData({ ...formData, pvData: { ...(formData.pvData || {}), ...patch } });

const AccountEcho = ({ currency, name }: { currency: string; name: string }) =>
  name ? (
    <Typography sx={{ fontSize: "13px", fontWeight: 700, color: "warning.main", ml: 1.5, whiteSpace: "nowrap" }}>
      {currency}&nbsp;&nbsp;{name.toUpperCase()}
    </Typography>
  ) : null;

export function PvVoucherNoInput({ formData }: RowProps) {
  return (
    <TextField
      size="small"
      value={formData?.documentInfo?.documentNumber || formData?.name || ""}
      InputProps={{ readOnly: true }}
      sx={{ ...headerInputSx, width: 220 }}
    />
  );
}

// Selecting a supplier resets the allocations (they belong to the previous
// supplier) and pulls the currency from the supplier master. Shared by the
// typed-code commit AND TabbedDocumentCreator's Locate Supplier dialog.
export function voucherSupplierPatch(formData: any, s: any) {
  const cur = String(s?.currency || "SGD").toUpperCase();
  return {
    supplier: s
      ? { id: s.id, name: s.name || "", supplierCode: s.supplierCode || "", address: s.address || "", email: s.email || "" }
      : { id: "", name: "", supplierCode: "", address: "", email: "" },
    pvData: {
      ...(formData.pvData || {}),
      allocations: [],
      currency: cur,
      rate: cur === "SGD" ? 1 : formData.pvData?.rate || 1,
    },
  };
}

export function PvSupplierInput({ formData, setFormData, suppliers = [], onOpenDialog }: RowProps & { onOpenDialog?: () => void }) {
  const committedCode = formData?.supplier?.supplierCode || "";
  const [input, setInput] = useState(committedCode);
  useEffect(() => setInput(committedCode), [committedCode]);
  return (
    <>
      <TextField
        data-tour="pv-supplier"
        size="small"
        value={input}
        placeholder="Code"
        onChange={(e) => {
          const v = e.target.value;
          setInput(v);
          const match = suppliers.find((s: any) => String(s.supplierCode || "").toLowerCase() === v.trim().toLowerCase());
          if (match && match.id !== formData?.supplier?.id) {
            setFormData({ ...formData, ...voucherSupplierPatch(formData, match) });
          }
        }}
        onBlur={() => setInput(committedCode)}
        sx={{ ...headerInputSx, width: 180 }}
        InputProps={{
          startAdornment: (
            <InputAdornment position="start" sx={{ mr: 0 }}>
              <IconButton size="small" onClick={() => onOpenDialog?.()} sx={{ p: 0.25, ml: -0.5 }} title="Search">
                <SearchIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </InputAdornment>
          ),
        }}
      />
      {formData?.supplier?.name && (
        <Typography sx={{ fontSize: "13px", fontWeight: 700, ml: 1.5, whiteSpace: "nowrap" }}>
          {formData.supplier.name}
        </Typography>
      )}
    </>
  );
}

// Accounts to DEBIT — Trade Creditors control (default from settings), full chart.
export function PvDebitInput({ formData, setFormData }: RowProps) {
  const accounts = useOrAccounts();
  const code = formData?.pvData?.debitAccountCode || "";
  const [input, setInput] = useState(code);
  const [dialogOpen, setDialogOpen] = useState(false);
  useEffect(() => setInput(code), [code]);
  const selected = accounts.find((a) => a.code === code);
  const commit = (acc: OrAccount) => setPvData(formData, setFormData, { debitAccountCode: acc.code });
  return (
    <>
      <TextField
        size="small"
        value={input}
        placeholder="Code"
        onChange={(e) => {
          const v = e.target.value;
          setInput(v);
          const match = accounts.find((a) => String(a.code).toLowerCase() === v.trim().toLowerCase());
          if (match && match.code !== code) commit(match);
        }}
        onBlur={() => setInput(code)}
        sx={{ ...headerInputSx, width: 180 }}
        InputProps={{
          startAdornment: (
            <InputAdornment position="start" sx={{ mr: 0 }}>
              <IconButton size="small" onClick={() => setDialogOpen(true)} sx={{ p: 0.25, ml: -0.5 }} title="Search">
                <SearchIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </InputAdornment>
          ),
        }}
      />
      <AccountEcho currency={formData?.pvData?.currency || "SGD"} name={selected?.name || ""} />
      <AccountSelectDialog open={dialogOpen} onClose={() => setDialogOpen(false)} accounts={accounts} onSelect={commit} />
    </>
  );
}

// Accounts to CREDIT — paid-from bank/cash only.
export function PvCreditInput({ formData, setFormData }: RowProps) {
  const accounts = useOrAccounts();
  const banks = useMemo(() => accounts.filter(isBankish), [accounts]);
  const code = formData?.pvData?.creditAccountCode || "";
  const [input, setInput] = useState(code);
  const [dialogOpen, setDialogOpen] = useState(false);
  useEffect(() => setInput(code), [code]);
  const selected = accounts.find((a) => a.code === code);
  const commit = (acc: OrAccount) =>
    setPvData(formData, setFormData, { creditAccountCode: acc.code, paidFromLabel: `${acc.code} — ${acc.name}` });
  return (
    <>
      <TextField
        size="small"
        value={input}
        placeholder="Code"
        onChange={(e) => {
          const v = e.target.value;
          setInput(v);
          const match = banks.find((b) => String(b.code).toLowerCase() === v.trim().toLowerCase());
          if (match && match.code !== code) commit(match);
        }}
        onBlur={() => setInput(code)}
        sx={{ ...headerInputSx, width: 180 }}
        InputProps={{
          startAdornment: (
            <InputAdornment position="start" sx={{ mr: 0 }}>
              <IconButton size="small" onClick={() => setDialogOpen(true)} sx={{ p: 0.25, ml: -0.5 }} title="Search">
                <SearchIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </InputAdornment>
          ),
        }}
      />
      <AccountEcho currency={formData?.pvData?.currency || "SGD"} name={selected?.name || ""} />
      <AccountSelectDialog open={dialogOpen} onClose={() => setDialogOpen(false)} accounts={banks} onSelect={commit} />
    </>
  );
}

export function PvAmountInput({ formData, setFormData }: RowProps) {
  const pd = formData?.pvData || {};
  const currency = String(pd.currency || "SGD").toUpperCase();
  const rate = Number(pd.rate) || 1;
  const amount = Number(pd.voucherAmount) || 0;
  return (
    <Box data-tour="pv-amount" sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "nowrap" }}>
      <Typography sx={{ fontSize: "13px", fontWeight: 700, color: "text.secondary" }}>{currency}</Typography>
      <TextField
        size="small"
        type="number"
        value={pd.voucherAmount ?? ""}
        onChange={(e) => setPvData(formData, setFormData, { voucherAmount: e.target.value })}
        inputProps={{ step: "0.01", min: 0, style: { textAlign: "right" } }}
        sx={{ ...headerInputSx, width: 180 }}
      />
      <Typography sx={{ fontSize: "13px", fontWeight: 700, ml: 1.5 }}>Rate</Typography>
      <TextField
        size="small"
        type="number"
        value={pd.rate ?? 1}
        onChange={(e) => setPvData(formData, setFormData, { rate: e.target.value })}
        disabled={currency === "SGD"}
        inputProps={{ step: "0.000001", min: 0, style: { textAlign: "right" } }}
        sx={{ ...headerInputSx, width: 140 }}
      />
      <Typography sx={{ fontSize: "13px", fontWeight: 700, ml: 1.5 }}>Amount&nbsp;&nbsp;SGD</Typography>
      <TextField
        size="small"
        value={fmt(R(amount * rate))}
        InputProps={{ readOnly: true }}
        inputProps={{ style: { textAlign: "right" } }}
        sx={{ ...headerInputSx, width: 170 }}
      />
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Offset Transactions — the supplier's unpaid bills; replaces the items table.
// ---------------------------------------------------------------------------
type OpenBill = {
  documentId: string;
  reference: string;
  type?: string | null;
  templateId?: string | null;
  date: string | null;
  remarks: string;
  gross: number;
  outstanding: number;
};

export function PaymentVoucherOffsetSection({
  formData,
  setFormData,
  voucherId,
  disabled = false,
}: {
  formData: any;
  setFormData: (next: any) => void;
  voucherId?: string;
  disabled?: boolean;
}) {
  const { getToken } = useAuth();
  const router = useRouter();
  const supplierId = formData?.supplier?.id || "";
  const pd = formData?.pvData || {};
  const allocations: any[] = Array.isArray(pd.allocations) ? pd.allocations : [];
  const allocById = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of allocations) m.set(a.documentId, Number(a.amount) || 0);
    return m;
  }, [allocations]);

  const [bills, setBills] = useState<OpenBill[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!supplierId) {
      setBills([]);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const token = await getToken();
        const excl = voucherId ? `?excludeVoucherId=${voucherId}` : "";
        const rows = (await apiFetch(`/payment-vouchers/open-bills/${supplierId}${excl}`, token)) || [];
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
  }, [supplierId, voucherId, getToken]);

  const paid = R(parseFloat(pd.voucherAmount) || 0);
  const offset = R(allocations.reduce((s, a) => s + (Number(a.amount) || 0), 0));
  const balance = R(paid - offset);

  const writeAllocations = (next: any[]) => setPvData(formData, setFormData, { allocations: next });

  const entryFor = (b: OpenBill, amount: number) => ({
    documentId: b.documentId,
    amount,
    reference: b.reference,
    date: b.date,
    description: b.remarks || "SUPPLIER INVOICE",
  });

  // Tick = allocate the remaining pool top-down (partial on the last).
  const toggle = (b: OpenBill, checked: boolean) => {
    if (!checked) {
      writeAllocations(allocations.filter((a) => a.documentId !== b.documentId));
      return;
    }
    const othersTotal = R(allocations.reduce((s, a) => (a.documentId === b.documentId ? s : s + (Number(a.amount) || 0)), 0));
    const remaining = R(Math.max(0, paid - othersTotal));
    const amt = R(Math.min(b.outstanding, remaining));
    writeAllocations([...allocations.filter((a) => a.documentId !== b.documentId), entryFor(b, amt)]);
  };

  const setLineAmount = (b: OpenBill, raw: string) => {
    const v = R(Math.max(0, Math.min(parseFloat(raw) || 0, b.outstanding)));
    const rest = allocations.filter((a) => a.documentId !== b.documentId);
    writeAllocations(v <= 0 ? rest : [...rest, entryFor(b, v)]);
  };

  const headCellSx = { fontWeight: 700, fontSize: "0.75rem", color: "text.secondary", whiteSpace: "nowrap" as const };

  // Legacy left rail — the AP twins of the receipt's modules.
  const needSupplier = (fn: () => void) => () => {
    if (!supplierId) {
      toast.warn("Select a supplier first");
      return;
    }
    fn();
  };
  const back = () => encodeURIComponent(window.location.pathname + window.location.search);
  const railButtons = [
    {
      label: "Creditor Statement",
      icon: <DescriptionOutlinedIcon />,
      onClick: needSupplier(() => {
        const today = new Date().toISOString().slice(0, 10);
        router.push(`/portal/accounting/payables?tab=creditor-statement&contactId=${supplierId}&asOf=${today}&back=${back()}`);
      }),
    },
    {
      label: "Audit Trail",
      icon: <ManageSearchIcon />,
      onClick: () => {
        const today = new Date().toISOString().slice(0, 10);
        router.push(`/portal/accounting/payables?tab=audit-trail&prefix=P/V&from=${today.slice(0, 7)}-01&to=${today}&back=${back()}`);
      },
    },
  ];

  return (
    <Box sx={{ mt: 0.5, mx: 0.5, flex: 1, minHeight: 0, display: "flex", gap: 1 }}>
      <Stack spacing={1} sx={{ width: 118, flexShrink: 0, pt: 0.5 }}>
        {railButtons.map((b) => (
          <Button
            key={b.label}
            variant="outlined"
            color="inherit"
            onClick={b.onClick}
            sx={{
              flexDirection: "column",
              gap: 0.5,
              py: 1.25,
              px: 0.5,
              textTransform: "none",
              fontSize: "0.7rem",
              fontWeight: 600,
              lineHeight: 1.2,
              color: "text.secondary",
              borderColor: "divider",
              bgcolor: "background.paper",
              "& svg": { fontSize: 22 },
              "&:hover": { borderColor: "text.secondary", bgcolor: "action.hover" },
            }}
          >
            {b.icon}
            {b.label}
          </Button>
        ))}
      </Stack>

      <Card data-tour="pv-offset-grid" sx={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}>
        <CardContent sx={{ p: 1, flex: 1, minHeight: 0, display: "flex", flexDirection: "column", "&:last-child": { pb: 1 } }}>
          <Box sx={{ borderBottom: 1, borderColor: "divider" }}>
            <Tabs value={0} sx={{ minHeight: 32, "& .MuiTab-root": { minHeight: 32, py: 0 } }}>
              <Tab label="Offset Transactions" />
            </Tabs>
          </Box>

          <Box sx={{ flex: 1, minHeight: 120, display: "flex", flexDirection: "column", pt: 1 }}>
            {disabled && (
              <Alert severity="warning" variant="outlined" sx={{ mb: 1, alignSelf: "flex-start" }}>
                Read-only — another session holds this voucher&apos;s edit lock. Close the other tab or use
                &quot;Take over&quot; in the banner at the top of the page.
              </Alert>
            )}
            {!disabled && supplierId && bills.length > 0 && paid <= 0 && (
              <Alert severity="info" variant="outlined" sx={{ mb: 1, alignSelf: "flex-start" }}>
                Enter the payment amount first — allocations unlock once there is money to allocate.
              </Alert>
            )}
            {!supplierId ? (
              <Alert severity="info" variant="outlined" sx={{ alignSelf: "flex-start" }}>
                Pick a supplier to list their unpaid invoices.
              </Alert>
            ) : loading ? (
              <Box sx={{ display: "flex", justifyContent: "center", p: 4 }}>
                <CircularProgress size={22} />
              </Box>
            ) : bills.length === 0 ? (
              <Alert severity="warning" variant="outlined" sx={{ alignSelf: "flex-start" }}>
                No unpaid supplier invoices for this supplier.
              </Alert>
            ) : (
              <TableContainer component={Paper} variant="outlined" sx={{ flex: 1, minHeight: 0, borderRadius: 1.5 }}>
                <Table
                  size="small"
                  stickyHeader
                  sx={(t) => ({
                    "& tbody td": {
                      py: 0.5,
                      borderBottom: `1px solid ${t.palette.mode === "dark" ? "rgba(255,255,255,0.32)" : "rgba(0,0,0,0.32)"}`,
                    },
                  })}
                >
                  <TableHead>
                    <TableRow>
                      <TableCell sx={headCellSx}>Reference</TableCell>
                      <TableCell sx={headCellSx}>Date</TableCell>
                      <TableCell sx={headCellSx}>Remarks</TableCell>
                      <TableCell sx={{ ...headCellSx, textAlign: "right" }}>Outstanding</TableCell>
                      <TableCell sx={{ ...headCellSx, width: 44 }} />
                      <TableCell sx={{ ...headCellSx, textAlign: "right", width: 150 }}>Allocated</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {bills.map((b) => {
                      const ticked = allocById.has(b.documentId);
                      return (
                        <TableRow key={b.documentId} hover sx={ticked ? { bgcolor: (t) => alpha(t.palette.primary.main, 0.06) } : undefined}>
                          <TableCell sx={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{b.reference}</TableCell>
                          <TableCell>{b.date ? new Date(b.date).toLocaleDateString("en-GB") : "—"}</TableCell>
                          <TableCell>{b.remarks}</TableCell>
                          <TableCell sx={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmt(b.outstanding)}</TableCell>
                          <TableCell padding="checkbox">
                            <Checkbox size="small" checked={ticked} onChange={(_, c) => toggle(b, c)} disabled={disabled || paid <= 0} />
                          </TableCell>
                          <TableCell sx={{ textAlign: "right" }}>
                            <TextField
                              size="small"
                              type="number"
                              value={ticked ? allocById.get(b.documentId) : ""}
                              onChange={(e) => setLineAmount(b, e.target.value)}
                              disabled={disabled || !ticked}
                              inputProps={{ step: "0.01", min: 0, max: b.outstanding, style: { textAlign: "right" } }}
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

            <Stack direction="row" gap={3} alignItems="center" justifyContent="flex-end" sx={{ mt: 1.5, pr: 1 }}>
              <Typography variant="body2" sx={{ color: "text.secondary" }}>
                Paid
              </Typography>
              <Typography sx={{ fontVariantNumeric: "tabular-nums", fontWeight: 600, minWidth: 100, textAlign: "right" }}>
                {fmt(paid)}
              </Typography>
              <Typography variant="body2" sx={{ color: "text.secondary" }}>
                Offset
              </Typography>
              <Typography sx={{ fontVariantNumeric: "tabular-nums", fontWeight: 600, minWidth: 100, textAlign: "right" }}>
                {fmt(offset)}
              </Typography>
              <Typography variant="body2" sx={{ fontWeight: 700 }}>
                Balance
              </Typography>
              <Typography
                sx={{
                  fontVariantNumeric: "tabular-nums",
                  fontWeight: 700,
                  minWidth: 100,
                  textAlign: "right",
                  color: Math.abs(balance) <= 0.005 ? "success.main" : "error.main",
                }}
              >
                {fmt(balance)}
              </Typography>
            </Stack>
            {Math.abs(balance) > 0.005 && paid > 0 && (
              <Typography variant="caption" sx={{ display: "block", textAlign: "right", color: "error.main", pr: 1 }}>
                The voucher must be fully allocated (Balance 0.00) before it can be saved.
              </Typography>
            )}
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
}
