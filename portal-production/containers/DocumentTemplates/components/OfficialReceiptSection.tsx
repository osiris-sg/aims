"use client";

// Official Receipt pieces for TabbedDocumentCreator (guru, 2026-07-17: the OR
// must live inside the REAL document editor — same toolbar/tabs/rows — with
// only the field set and the body swapped). This file holds:
//   - OR_FIELD_DEFINITIONS: the General-tab rows in the exact legacy order
//   - the custom row inputs (Receipt No / Customer / CREDIT / DEBIT / Amount)
//   - OfficialReceiptOffsetSection: the Offset Transactions grid that replaces
//     the items table (tick auto-allocates the pool top-down, partial last;
//     footer Received / Offset / Balance — Balance must be 0.00 to save)
// Receipt state rides in formData.orData so the editor's dirty tracking,
// exit prompt and Save path all work unchanged.

import React, { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
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
import CloseIcon from "@mui/icons-material/Close";
import SearchIcon from "@mui/icons-material/Search";
import DescriptionOutlinedIcon from "@mui/icons-material/DescriptionOutlined";
import CompareArrowsIcon from "@mui/icons-material/CompareArrows";
import ManageSearchIcon from "@mui/icons-material/ManageSearch";
import { useAuth } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import DebtorStatementDialog from "./DebtorStatementDialog";
import ManualOffsetDialog from "./ManualOffsetDialog";
import { toast } from "react-toastify";
import { headerInputSx } from "./DynamicFormFields";
import type { TemplateFieldConfig } from "../types/templateFieldTypes";

// ---------------------------------------------------------------------------
// Field definitions — none of these names appear in HEADER_FIELD_ORDER (or the
// right-column substring filters: gross/disc/subTotal/nett/gst/rate/absorbTax/
// taxApplicable/currency), so DynamicFormFields renders them single-column in
// EXACTLY this order — the legacy OR General-tab layout.
// ---------------------------------------------------------------------------
export const OR_FIELD_DEFINITIONS: TemplateFieldConfig = {
  tabs: [
    {
      tabId: "general",
      tabLabel: "GENERAL",
      fields: [
        { fieldName: "orReceiptNo", displayLabel: "Receipt No.", fieldType: "text", required: false },
        { fieldName: "orData.date", displayLabel: "Date", fieldType: "date", required: true },
        { fieldName: "orData.chequeNo", displayLabel: "Cheque No.", fieldType: "text", required: false },
        { fieldName: "orData.remarks", displayLabel: "Remarks", fieldType: "text", required: false },
        { fieldName: "orCustomer", displayLabel: "Customer code", fieldType: "text", required: true },
        { fieldName: "orCredit", displayLabel: "Accounts to  CREDIT", fieldType: "text", required: false },
        { fieldName: "orDebit", displayLabel: "Accounts to  DEBIT", fieldType: "text", required: true },
        { fieldName: "orAmountRow", displayLabel: "Receipt Amount", fieldType: "text", required: true },
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

export type OrAccount = { code: string; name: string; accountType?: string; isActive?: boolean };

// Chart of accounts, fetched once per editor mount and shared by the CREDIT /
// DEBIT rows (module-level cache keyed by active org).
let accountsCache: { key: string; accounts: OrAccount[] } | null = null;
export function useOrAccounts(): OrAccount[] {
  const { getToken } = useAuth();
  const [accounts, setAccounts] = useState<OrAccount[]>(() => accountsCache?.accounts || []);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const key =
          (typeof window !== "undefined" && window.sessionStorage.getItem("aims-admin-active-org")) || "home";
        if (accountsCache?.key === key) {
          setAccounts(accountsCache.accounts);
          return;
        }
        const token = await getToken();
        const list: OrAccount[] = (await apiFetch(`/accounting/accounts`, token)) || [];
        accountsCache = { key, accounts: list };
        if (!cancelled) setAccounts(list);
      } catch {
        /* leave empty — rows degrade to plain code boxes */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getToken]);
  return accounts;
}

const isBankish = (a: OrAccount) => {
  if (a.isActive === false) return false;
  if (a.accountType === "FOREIGN_BANK") return true;
  const n = String(a.name || "").toLowerCase();
  return a.accountType === "CURRENT_ASSET" && (/\bbank\b/.test(n) || /\bcash\b/.test(n));
};

type RowProps = { formData: any; setFormData: (next: any) => void; customers?: any[] };

const setOrData = (formData: any, setFormData: (next: any) => void, patch: Record<string, any>) =>
  setFormData({ ...formData, orData: { ...(formData.orData || {}), ...patch } });

// Amber account-name echo beside the code box — mirrors the legacy screen.
const AccountEcho = ({ currency, name }: { currency: string; name: string }) =>
  name ? (
    <Typography sx={{ fontSize: "13px", fontWeight: 700, color: "warning.main", ml: 1.5, whiteSpace: "nowrap" }}>
      {currency}&nbsp;&nbsp;{name.toUpperCase()}
    </Typography>
  ) : null;

export function OrReceiptNoInput({ formData }: RowProps) {
  return (
    <TextField
      size="small"
      value={formData?.documentInfo?.documentNumber || formData?.name || ""}
      InputProps={{ readOnly: true }}
      sx={{ ...headerInputSx, width: 220 }}
    />
  );
}

// Selecting a customer resets the allocations (they belong to the previous
// customer) and pulls the currency from the customer master. Shared by the
// typed-code commit below AND TabbedDocumentCreator's Locate Customer dialog.
export function receiptCustomerPatch(formData: any, c: any) {
  const cur = String(c?.currency || "SGD").toUpperCase();
  return {
    customer: c
      ? { id: c.id, name: c.name || "", customerCode: c.customerCode || "", address: c.address || "", email: c.email || "" }
      : { id: "", name: "", customerCode: "", address: "", email: "" },
    orData: {
      ...(formData.orData || {}),
      allocations: [],
      currency: cur,
      rate: cur === "SGD" ? 1 : formData.orData?.rate || 1,
    },
  };
}

// Customer code — the standard AIMS pattern: code box with a search adornment
// that opens the shared Locate Customer dialog; typing an exact code commits
// directly. The company name echoes beside the box.
export function OrCustomerInput({ formData, setFormData, customers = [], onOpenDialog }: RowProps & { onOpenDialog?: () => void }) {
  const committedCode = formData?.customer?.customerCode || "";
  const [input, setInput] = useState(committedCode);
  useEffect(() => setInput(committedCode), [committedCode]);
  return (
    <>
      <TextField
        size="small"
        value={input}
        placeholder="Code"
        onChange={(e) => {
          const v = e.target.value;
          setInput(v);
          const match = customers.find((c: any) => String(c.customerCode || "").toLowerCase() === v.trim().toLowerCase());
          if (match && match.id !== formData?.customer?.id) {
            setFormData({ ...formData, ...receiptCustomerPatch(formData, match) });
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
      {formData?.customer?.name && (
        <Typography sx={{ fontSize: "13px", fontWeight: 700, ml: 1.5, whiteSpace: "nowrap" }}>
          {formData.customer.name}
        </Typography>
      )}
    </>
  );
}

// "Locate Account" — same look and behaviour as the Locate Customer dialog
// (black header, hint line, live search, click a row to select).
export function AccountSelectDialog({
  open,
  onClose,
  accounts,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  accounts: OrAccount[];
  onSelect: (a: OrAccount) => void;
}) {
  const [searchTerm, setSearchTerm] = useState("");
  const filtered = useMemo(() => {
    if (!searchTerm.trim()) return accounts;
    const term = searchTerm.toLowerCase();
    return accounts.filter((a) =>
      [a.code, a.name, a.accountType].some((v) => String(v ?? "").toLowerCase().includes(term)),
    );
  }, [accounts, searchTerm]);
  const handleClose = () => {
    setSearchTerm("");
    onClose();
  };
  const headSx = { fontWeight: 600, bgcolor: "surfaceTones.low", borderBottom: 2, borderColor: "divider" };
  return (
    <Dialog open={open} onClose={handleClose} maxWidth="md" fullWidth PaperProps={{ sx: { minHeight: "60vh", maxHeight: "80vh" } }}>
      <DialogTitle
        sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", bgcolor: "#0a0a0a", color: "#fafafa", py: 1.5 }}
      >
        <Typography variant="h6" fontWeight={500}>
          Locate Account
        </Typography>
        <IconButton onClick={handleClose} size="small" sx={{ color: "#fafafa" }}>
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent sx={{ p: 0 }}>
        <Box sx={{ p: 2, bgcolor: "surfaceTones.low", borderBottom: "1px solid", borderColor: "divider" }}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            This combo box begins searching as soon as you begin typing the first character
          </Typography>
          <TextField
            fullWidth
            placeholder="Search accounts..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            size="small"
            autoFocus
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon color="action" />
                </InputAdornment>
              ),
            }}
            sx={{ mb: 1.5, bgcolor: "background.paper" }}
          />
        </Box>
        <TableContainer component={Paper} sx={{ maxHeight: "calc(80vh - 250px)" }}>
          <Table stickyHeader size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ ...headSx, width: "20%" }}>Account Code</TableCell>
                <TableCell sx={{ ...headSx, width: "55%" }}>Account Name</TableCell>
                <TableCell sx={{ ...headSx, width: "25%" }}>Type</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filtered.map((a) => (
                <TableRow
                  key={a.code}
                  hover
                  sx={{ cursor: "pointer" }}
                  onClick={() => {
                    onSelect(a);
                    handleClose();
                  }}
                >
                  <TableCell sx={{ fontFamily: "monospace" }}>{a.code}</TableCell>
                  <TableCell>{a.name}</TableCell>
                  <TableCell>{String(a.accountType || "").replace(/_/g, " ")}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        <Box
          sx={{
            p: 1.5,
            px: 2,
            display: "flex",
            justifyContent: "space-between",
            borderTop: "1px solid",
            borderColor: "divider",
          }}
        >
          <Typography variant="caption" color="text.secondary">
            Showing {filtered.length} of {accounts.length} accounts
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Click on a row to select an account
          </Typography>
        </Box>
      </DialogContent>
    </Dialog>
  );
}

export function OrCreditInput({ formData }: RowProps) {
  const accounts = useOrAccounts();
  const code = formData?.orData?.creditAccountCode || "";
  const name = accounts.find((a) => a.code === code)?.name || "";
  return (
    <>
      <TextField size="small" value={code} InputProps={{ readOnly: true }} sx={{ ...headerInputSx, width: 130 }} />
      <AccountEcho currency={formData?.orData?.currency || "SGD"} name={name || (code ? "" : "")} />
    </>
  );
}

// Accounts to DEBIT (deposit to) — code box with a search adornment opening a
// Locate Account dialog (bank/cash accounts only); typing an exact code
// commits directly. Same field pattern as Customer code.
export function OrDebitInput({ formData, setFormData }: RowProps) {
  const accounts = useOrAccounts();
  const banks = useMemo(() => accounts.filter(isBankish), [accounts]);
  const code = formData?.orData?.debitAccountCode || "";
  const [input, setInput] = useState(code);
  const [dialogOpen, setDialogOpen] = useState(false);
  useEffect(() => setInput(code), [code]);
  const selected = accounts.find((a) => a.code === code);
  const commit = (acc: OrAccount) =>
    setOrData(formData, setFormData, {
      debitAccountCode: acc.code,
      depositLabel: `${acc.code} — ${acc.name}`,
    });
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
      <AccountEcho currency={formData?.orData?.currency || "SGD"} name={selected?.name || ""} />
      <AccountSelectDialog open={dialogOpen} onClose={() => setDialogOpen(false)} accounts={banks} onSelect={commit} />
    </>
  );
}

export function OrAmountInput({ formData, setFormData }: RowProps) {
  const od = formData?.orData || {};
  const currency = String(od.currency || "SGD").toUpperCase();
  const rate = Number(od.rate) || 1;
  const amount = Number(od.receiptAmount) || 0;
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "nowrap" }}>
      <Typography sx={{ fontSize: "13px", fontWeight: 700, color: "text.secondary" }}>{currency}</Typography>
      <TextField
        size="small"
        type="number"
        value={od.receiptAmount ?? ""}
        onChange={(e) => setOrData(formData, setFormData, { receiptAmount: e.target.value })}
        inputProps={{ step: "0.01", min: 0, style: { textAlign: "right" } }}
        sx={{ ...headerInputSx, width: 180 }}
      />
      <Typography sx={{ fontSize: "13px", fontWeight: 700, ml: 1.5 }}>Rate</Typography>
      <TextField
        size="small"
        type="number"
        value={od.rate ?? 1}
        onChange={(e) => setOrData(formData, setFormData, { rate: e.target.value })}
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
// Offset Transactions — replaces the editor's items table for receipts.
// ---------------------------------------------------------------------------
type OpenInvoice = {
  documentId: string;
  reference: string;
  date: string | null;
  remarks: string;
  gross: number;
  outstanding: number;
};

export function OfficialReceiptOffsetSection({
  formData,
  setFormData,
  receiptId,
  disabled = false,
}: {
  formData: any;
  setFormData: (next: any) => void;
  receiptId?: string;
  disabled?: boolean;
}) {
  const { getToken } = useAuth();
  const router = useRouter();
  const customerId = formData?.customer?.id || "";
  const od = formData?.orData || {};
  const allocations: any[] = Array.isArray(od.allocations) ? od.allocations : [];
  const allocById = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of allocations) m.set(a.documentId, Number(a.amount) || 0);
    return m;
  }, [allocations]);

  const [invoices, setInvoices] = useState<OpenInvoice[]>([]);
  const [loading, setLoading] = useState(false);
  // Bumped when a Manual Offset saves — outstanding amounts changed.
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    if (!customerId) {
      setInvoices([]);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const token = await getToken();
        const excl = receiptId ? `?excludeReceiptId=${receiptId}` : "";
        const rows = (await apiFetch(`/receipts/open-invoices/${customerId}${excl}`, token)) || [];
        if (!cancelled) setInvoices(rows);
      } catch (e: any) {
        if (!cancelled) toast.error(e?.message || "Couldn't load unpaid invoices");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [customerId, receiptId, getToken, refreshTick]);

  const received = R(parseFloat(od.receiptAmount) || 0);
  const offset = R(allocations.reduce((s, a) => s + (Number(a.amount) || 0), 0));
  const balance = R(received - offset);

  const writeAllocations = (next: any[]) => setOrData(formData, setFormData, { allocations: next });

  // Allocation entries stay ENRICHED (reference/date/description) so the
  // preview and the printed receipt render without refetching invoices.
  const entryFor = (inv: OpenInvoice, amount: number) => ({
    documentId: inv.documentId,
    amount,
    reference: inv.reference,
    date: inv.date,
    description: inv.remarks || "INVOICE",
  });

  const toggle = (inv: OpenInvoice, checked: boolean) => {
    if (!checked) {
      writeAllocations(allocations.filter((a) => a.documentId !== inv.documentId));
      return;
    }
    const othersTotal = R(
      allocations.reduce((s, a) => (a.documentId === inv.documentId ? s : s + (Number(a.amount) || 0)), 0),
    );
    const remaining = R(Math.max(0, received - othersTotal));
    const amt = R(Math.min(inv.outstanding, remaining));
    writeAllocations([...allocations.filter((a) => a.documentId !== inv.documentId), entryFor(inv, amt)]);
  };

  const setLineAmount = (inv: OpenInvoice, raw: string) => {
    const v = R(Math.max(0, Math.min(parseFloat(raw) || 0, inv.outstanding)));
    const rest = allocations.filter((a) => a.documentId !== inv.documentId);
    writeAllocations(v <= 0 ? rest : [...rest, entryFor(inv, v)]);
  };

  const headCellSx = { fontWeight: 700, fontSize: "0.75rem", color: "text.secondary", whiteSpace: "nowrap" as const };

  // Legacy left-rail modules (screenshot 42). Debtor Statement and Manual
  // Offset are live; Audit Trail awaits guru's spec.
  const [debtorStatementOpen, setDebtorStatementOpen] = useState(false);
  const [manualOffsetOpen, setManualOffsetOpen] = useState(false);
  const needCustomer = (fn: () => void) => () => {
    if (!customerId) {
      toast.warn("Select a customer first");
      return;
    }
    fn();
  };
  const railButtons = [
    { label: "Debtor Statement", icon: <DescriptionOutlinedIcon />, onClick: needCustomer(() => setDebtorStatementOpen(true)) },
    { label: "Manual Offset", icon: <CompareArrowsIcon />, onClick: needCustomer(() => setManualOffsetOpen(true)) },
    {
      label: "Audit Trail",
      icon: <ManageSearchIcon />,
      // Xero-style report (guru's call), pre-scoped to receipts this month.
      // ?back= returns to THIS receipt page from the report's Back button.
      onClick: () => {
        const today = new Date().toISOString().slice(0, 10);
        const back = encodeURIComponent(window.location.pathname + window.location.search);
        router.push(`/portal/accounting/receivables?tab=audit-trail&prefix=OR&from=${today.slice(0, 7)}-01&to=${today}&back=${back}`);
      },
    },
  ];

  return (
    <Box sx={{ mt: 0.5, mx: 0.5, flex: 1, minHeight: 0, display: "flex", gap: 1 }}>
      {/* Side rail — the legacy screen's left module buttons */}
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

      <Card sx={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}>
        <CardContent sx={{ p: 1, flex: 1, minHeight: 0, display: "flex", flexDirection: "column", "&:last-child": { pb: 1 } }}>
          <Box sx={{ borderBottom: 1, borderColor: "divider" }}>
            <Tabs value={0} sx={{ minHeight: 32, "& .MuiTab-root": { minHeight: 32, py: 0 } }}>
              <Tab label="Offset Transactions" />
            </Tabs>
          </Box>

          <Box sx={{ flex: 1, minHeight: 120, display: "flex", flexDirection: "column", pt: 1 }}>
            {!customerId ? (
              <Alert severity="info" variant="outlined" sx={{ alignSelf: "flex-start" }}>
                Pick a customer to list their unpaid invoices.
              </Alert>
            ) : loading ? (
              <Box sx={{ display: "flex", justifyContent: "center", p: 4 }}>
                <CircularProgress size={22} />
              </Box>
            ) : invoices.length === 0 ? (
              <Alert severity="warning" variant="outlined" sx={{ alignSelf: "flex-start" }}>
                No unpaid invoices for this customer.
              </Alert>
            ) : (
              <TableContainer component={Paper} variant="outlined" sx={{ flex: 1, minHeight: 0, borderRadius: 1.5 }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ ...headCellSx, width: 44 }} />
                      <TableCell sx={headCellSx}>Reference</TableCell>
                      <TableCell sx={headCellSx}>Date</TableCell>
                      <TableCell sx={headCellSx}>Remarks</TableCell>
                      <TableCell sx={{ ...headCellSx, textAlign: "right" }}>Outstanding</TableCell>
                      <TableCell sx={{ ...headCellSx, textAlign: "right", width: 150 }}>Allocated</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {invoices.map((inv) => {
                      const ticked = allocById.has(inv.documentId);
                      return (
                        <TableRow
                          key={inv.documentId}
                          hover
                          sx={ticked ? { bgcolor: (t) => alpha(t.palette.primary.main, 0.06) } : undefined}
                        >
                          <TableCell padding="checkbox">
                            <Checkbox
                              size="small"
                              checked={ticked}
                              onChange={(_, c) => toggle(inv, c)}
                              disabled={disabled || received <= 0}
                            />
                          </TableCell>
                          <TableCell sx={{ fontFamily: "monospace" }}>{inv.reference}</TableCell>
                          <TableCell>{inv.date ? new Date(inv.date).toLocaleDateString("en-GB") : "—"}</TableCell>
                          <TableCell>{inv.remarks}</TableCell>
                          <TableCell sx={{ textAlign: "right", fontFamily: "monospace" }}>{fmt(inv.outstanding)}</TableCell>
                          <TableCell sx={{ textAlign: "right" }}>
                            <TextField
                              size="small"
                              type="number"
                              value={ticked ? allocById.get(inv.documentId) : ""}
                              onChange={(e) => setLineAmount(inv, e.target.value)}
                              disabled={disabled || !ticked}
                              inputProps={{ step: "0.01", min: 0, max: inv.outstanding, style: { textAlign: "right" } }}
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
                Received
              </Typography>
              <Typography sx={{ fontFamily: "monospace", fontWeight: 600, minWidth: 100, textAlign: "right" }}>
                {fmt(received)}
              </Typography>
              <Typography variant="body2" sx={{ color: "text.secondary" }}>
                Offset
              </Typography>
              <Typography sx={{ fontFamily: "monospace", fontWeight: 600, minWidth: 100, textAlign: "right" }}>
                {fmt(offset)}
              </Typography>
              <Typography variant="body2" sx={{ fontWeight: 700 }}>
                Balance
              </Typography>
              <Typography
                sx={{
                  fontFamily: "monospace",
                  fontWeight: 700,
                  minWidth: 100,
                  textAlign: "right",
                  color: Math.abs(balance) <= 0.005 ? "success.main" : "error.main",
                }}
              >
                {fmt(balance)}
              </Typography>
            </Stack>
            {Math.abs(balance) > 0.005 && received > 0 && (
              <Typography variant="caption" sx={{ display: "block", textAlign: "right", color: "error.main", pr: 1 }}>
                The receipt must be fully allocated (Balance 0.00) before it can be saved.
              </Typography>
            )}
          </Box>
        </CardContent>
      </Card>

      {/* Debtor Statement-Of-Account (side rail) — for the selected customer */}
      <DebtorStatementDialog
        open={debtorStatementOpen}
        onClose={() => setDebtorStatementOpen(false)}
        customer={formData?.customer?.id ? formData.customer : null}
      />

      {/* Manual Offset (side rail) — credit notes ↔ invoices, no cash moves */}
      <ManualOffsetDialog
        open={manualOffsetOpen}
        onClose={() => setManualOffsetOpen(false)}
        customer={formData?.customer?.id ? formData.customer : null}
        onSaved={() => setRefreshTick((t) => t + 1)}
      />
    </Box>
  );
}
