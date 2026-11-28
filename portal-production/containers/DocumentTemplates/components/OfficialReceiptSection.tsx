"use client";

// Official Receipt pieces for TabbedDocumentCreator (guru, 2026-07-17: the OR
// must live inside the REAL document editor — same toolbar/tabs/rows — with
// only the field set and the body swapped). Rebuilt 2026-11-28 in the Payment
// Voucher's shape (guru: "the receipt must be able to take in double entries
// even if never tick invoices... example grant from government"):
//
//   GENERAL      Receipt No.   [UOBOR2611-001]
//                Date          [28/11/2026]
//                Bank advice   [        ]
//                Received from [C1001] ACME PTE LTD ✎   ← Offset Transactions
//                Deposit to    [1-2107] UOB BANK          Rate 1.0000000
//                Receipt Amount SGD 3,500.00  (the lines' total)
//   ┌ Account code │ Description     │ Remarks      │ Amount ┐
//   │ 4-3000       │ GRANT INCOME    │ ESG grant    │ 1000.00│
//   │ 1-2000       │ TRADE DEBTORS   │ C1001 — ACME │ 2500.00│
//   └──────────────────────────────── Amount SGD 3,500.00 ┘
//
// A line is any GL account with an amount (a grant, interest, a refund
// received, a bank charge deducted as a negative), or the ONE debtor line the
// Offset Transactions dialog writes (Trade Debtors + the customer + the
// invoices ticked). The total of the lines is the money entering the bank.
//
// This file holds:
//   - OR_FIELD_DEFINITIONS: the General-tab rows in the legacy order
//   - the custom row inputs (Receipt No / Received from / Deposit to / Amount)
//   - OfficialReceiptLinesSection: the lines grid that replaces the items table
// Receipt state rides in formData.orData so the editor's dirty tracking,
// exit prompt and Save path all work unchanged. Accounting: Dr bank total /
// Cr each line (debtor control per allocated invoice, ± realised FX).

import { accountCodeKey, accountMatchesSearch, findAccountByTypedCode } from "@/helpers/accountCodeSearch";
import React, { useRef, useEffect, useMemo, useState } from "react";
import MoneyInput from "@/components/MoneyInput";
import RateInput from "@/components/RateInput";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
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
  Tooltip,
  Typography,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import SearchIcon from "@mui/icons-material/Search";
import EditNoteIcon from "@mui/icons-material/EditNote";
import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import DescriptionOutlinedIcon from "@mui/icons-material/DescriptionOutlined";
import CompareArrowsIcon from "@mui/icons-material/CompareArrows";
import SwapHorizIcon from "@mui/icons-material/SwapHoriz";
import ManageSearchIcon from "@mui/icons-material/ManageSearch";
import { useAuth } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import DebtorStatementDialog from "./DebtorStatementDialog";
import { useListKeyboardNav } from "@/helpers/useListKeyboardNav";
import ManualOffsetDialog from "./ManualOffsetDialog";
import ContraOffsetDialog from "./ContraOffsetDialog";
import { useOrganizationFeatures } from "@/app/portal/hooks/useOrganizationFeatures";
import { toast } from "react-toastify";
import { headerInputSx } from "./DynamicFormFields";
import type { TemplateFieldConfig } from "../types/templateFieldTypes";
import { focusNextEmptyInRow } from "@/helpers/focusNextEmptyInRow";
import PvOffsetSupplierDialog, { type PvLine } from "./PvOffsetSupplierDialog";
import { todayIso } from "@/helpers/orgToday";
import EditorRail from "./EditorRail";
import { docRailSx } from "@/helpers/wctDocUi";
import { useOrganization } from "@/app/portal/hooks/useOrganization";
import { standingRateFor } from "@/helpers/orgFx";

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
        // Bank advice (cheque / transfer reference; guru 2026-11-14, as on the Payment Voucher). Stored as chequeNo.
        { fieldName: "orData.chequeNo", displayLabel: "Bank advice", fieldType: "text", required: false },
        // The payer. Optional since the lines grid (2026-11-28): a grant names no customer; the pencil
        // opens Offset Transactions for a customer's invoices.
        { fieldName: "orCustomer", displayLabel: "Received from", fieldType: "text", required: false },
        { fieldName: "orDebit", displayLabel: "Accounts to  DEBIT", fieldType: "text", required: true },
        { fieldName: "orAmountRow", displayLabel: "Receipt Amount", fieldType: "text", required: false },
      ],
    },
  ],
};

const fmt = (n: number) =>
  (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const R = (n: number) => Math.round(n * 100) / 100;

/** Window event the Received-from pencil fires; the lines section opens the Offset Transactions dialog. */
export const OR_OFFSET_EVENT = "aims:or-offset";

export type OrLine = PvLine;
export const orLines = (formData: any): OrLine[] => (Array.isArray(formData?.orData?.lines) ? formData.orData.lines : []);
export const orTotal = (formData: any) => R(orLines(formData).reduce((s, l) => s + (parseFloat(String(l.amount)) || 0), 0));
/** The single debtor line (the customer's invoices, via the AR control). */
export const orDebtorLine = (formData: any): OrLine | undefined => orLines(formData).find((l) => l.offset?.customerId);

/** The editor's pre-save check — mirrors the server's rules so the toast is immediate. */
export function orValidationError(formData: any): string | null {
  const od: any = formData?.orData || {};
  if (!od.debitAccountCode) return "Select the account the money is deposited to";
  const lines = orLines(formData).filter((l) => l.accountCode || parseFloat(String(l.amount)) || l.offset);
  if (!lines.length) return "Add at least one line — an account and an amount, or offset the customer's invoices";
  for (const [i, l] of lines.entries()) {
    if (!l.accountCode && !l.offset) return `Line ${i + 1}: pick an account code`;
    if (!l.offset && !(parseFloat(String(l.amount)) || 0)) return `Line ${i + 1}: enter an amount`;
  }
  const total = orTotal(formData);
  if (total < 0) return "The receipt total cannot be negative — the lines must add up to money entering the bank";
  if (total === 0) return "Receipt amount must be greater than zero";
  return null;
}

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
// Next number for the chosen bank, previewed from the server (not claimed).
// Fills the Receipt / Voucher No. box the moment the bank is picked (guru
// 2026-11-05) — only while the document has never been saved, so a saved
// number is never silently replaced; the save sends it back as the typed
// number and the server re-checks it.
export async function peekDocumentNumber(
  documentType: "OFFICIAL_RECEIPT" | "PAYMENT_VOUCHER",
  bankAccountCode: string,
  date: string | null | undefined,
  token: string | null,
): Promise<string | null> {
  try {
    const q = new URLSearchParams({ documentType, bankAccountCode, ...(date ? { date } : {}) });
    const res = await apiFetch(`/document-numbering/peek?${q.toString()}`, token);
    return res?.number || null;
  } catch {
    return null;
  }
}
export const numberIsPending = (name: any) => /^(OR|PV)-PENDING/.test(String(name || ""));

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

// A CUSTOMER DEPOSIT is money already held from that customer, so applying it
// to their invoice settles it for real — no cash moves, the deposit account is
// debited instead of a bank. Xero does exactly this (Biofuel's Joon Thiam
// invoice BIPL-JPSG-INV-20260720-0168 was paid from "Customer Deposit-Joon
// Thiam"), and until now the receipt screen could not express it: the picker
// offered bank and cash only, so the receipt had to be keyed against a bank
// that never received the money (guru 2026-11-18).
//
// The test is "customer deposit", NOT "deposit". Supplier-side deposits —
// "Deposits Paid", "Deposit / Overpayment to Supplier", "FIXED DEPOSIT",
// "DEPOSIT (TRADE CREDITOR)" — are money WE paid out and can never settle a
// customer's invoice; a bare /deposit/ test would have offered 9 of those
// across the orgs on prod.
const isCustomerDeposit = (a: OrAccount) =>
  a.accountType === "CURRENT_ASSET" && /customer\s*deposit/i.test(String(a.name || ""));

const isBankish = (a: OrAccount) => {
  if (a.isActive === false) return false;
  if (a.accountType === "FOREIGN_BANK") return true;
  const n = String(a.name || "").toLowerCase();
  if (a.accountType === "CURRENT_ASSET" && (/\bbank\b/.test(n) || /\bcash\b/.test(n))) return true;
  return isCustomerDeposit(a);
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

// Editable (guru 2026-11-05): the accountant can type over the running
// number; the server checks it is unused and the next auto number continues
// from the highest in that series. An OR-PENDING… name means "issued on save".
export function OrReceiptNoInput({ formData, setFormData }: RowProps) {
  // A provisional OR-PENDING… name is not a number anyone should see or type
  // over: show the box empty so the placeholder explains itself, and the
  // server issues the real number on save.
  const raw = formData?.documentInfo?.documentNumber || formData?.name || "";
  const value = raw.startsWith("OR-PENDING") ? "" : raw;
  return (
    <TextField
      size="small"
      value={value}
      onChange={(e) => {
        const v = e.target.value;
        // numberTouched stops the bank/date preview from overwriting a
        // number the user typed on purpose.
        setFormData({ ...formData, name: v, numberTouched: true, documentInfo: { ...(formData?.documentInfo || {}), documentNumber: v } });
      }}
      placeholder="Issued on save"
      sx={{ ...headerInputSx, width: 220 }}
    />
  );
}

// Selecting a customer (the payer) pulls the currency from the customer master
// and drops a debtor line that belonged to another customer — its invoices are
// not this payer's. Direct lines (a grant, interest) stay. Shared by the
// typed-code commit below AND TabbedDocumentCreator's Locate Customer dialog.
export function receiptCustomerPatch(formData: any, c: any) {
  const cur = String(c?.currency || "SGD").toUpperCase();
  const lines = orLines(formData).filter((l) => !l.offset?.customerId || l.offset.customerId === c?.id);
  return {
    customer: c
      ? { id: c.id, name: c.name || "", customerCode: c.customerCode || "", address: c.address || "", email: c.email || "", phone: c.phone || "", fax: c.fax || "" }
      : { id: "", name: "", customerCode: "", address: "", email: "", phone: "", fax: "" },
    orData: {
      ...(formData.orData || {}),
      lines,
      allocations: orDebtorLine({ orData: { lines } })?.offset?.allocations || [],
      currency: cur,
      // The accountant's standing rate for the customer's currency (1 for the
      // base); a currency with no rate locked in keeps whatever is keyed.
      rate: standingRateFor(cur) ?? formData.orData?.rate ?? 1,
    },
  };
}

// Customer code — the standard AIMS pattern: code box with a search adornment
// that opens the shared Locate Customer dialog; typing an exact code commits
// directly. The company name echoes beside the box.
export function OrCustomerInput({ formData, setFormData, customers = [], onOpenDialog }: RowProps & { onOpenDialog?: () => void }) {
  const committedCode = formData?.customer?.customerCode || "";
  const debtor = orDebtorLine(formData);
  const [input, setInput] = useState(committedCode);
  useEffect(() => setInput(committedCode), [committedCode]);
  return (
    <>
      <TextField
        // Same data-tour token as the main editor's customer field so receipt
        // walkthroughs can spotlight it.
        data-tour="editor-customer"
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
              <IconButton data-hotkey="lookup" size="small" onClick={() => onOpenDialog?.()} sx={{ p: 0.25, ml: -0.5 }} title="Search">
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
      {/* Offset Transactions — the customer's invoices this receipt settles (F2 too, via data-hotkey="lookup"). */}
      <Tooltip title={debtor ? "Offset Transactions — edit the invoices this receipt settles" : "Offset Transactions — settle this customer's invoices"}>
        <IconButton
          data-hotkey="lookup"
          size="small"
          onClick={() => window.dispatchEvent(new CustomEvent(OR_OFFSET_EVENT))}
          sx={{ p: 0.25, ml: 0.5 }}
          color={debtor ? "primary" : "default"}
        >
          <EditNoteIcon sx={{ fontSize: 18 }} />
        </IconButton>
      </Tooltip>
      {debtor && (
        <Chip size="small" variant="outlined" color="primary" label={`${debtor.offset?.allocations?.length || 0} invoice(s) · ${fmt(Number(debtor.amount) || 0)}`} sx={{ height: 22, ml: 0.5 }} />
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
    return accounts.filter((a) => accountMatchesSearch(a, searchTerm, [a.accountType]));
  }, [accounts, searchTerm]);
  const handleClose = () => {
    setSearchTerm("");
    onClose();
  };
  const pick = (a: OrAccount) => {
    onSelect(a);
    handleClose();
  };
  // No mouse needed (guru 2026-11-14/18): ↑↓ move the highlight, Enter picks,
  // Esc closes — the same hook as Locate Customer.
  const { activeIndex, setActiveIndex, handleKeyDown, setRowRef } = useListKeyboardNav(filtered, pick, { onClose: handleClose });
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
            onKeyDown={handleKeyDown}
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
              {filtered.map((a, index) => (
                <TableRow
                  key={a.code}
                  ref={setRowRef(index)}
                  hover
                  selected={index === activeIndex}
                  onMouseEnter={() => setActiveIndex(index)}
                  sx={{
                    cursor: "pointer",
                    "&.Mui-selected, &.Mui-selected:hover": {
                      bgcolor: "primary.main",
                      "& .MuiTableCell-root": { color: "primary.contrastText" },
                    },
                  }}
                  onClick={() => pick(a)}
                >
                  <TableCell sx={{ fontVariantNumeric: "tabular-nums" }}>{a.code}</TableCell>
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

// Accounts to DEBIT (deposit to) — code box with a search adornment opening a
// Locate Account dialog (bank/cash accounts only); typing an exact code
// commits directly. Same field pattern as Customer code.
// The bank is remembered PER ORG in this browser (guru 2026-11-16: "keep the
// prev bank account so they don't need to always key in bank account"): the
// code the user last picked prefills the next NEW voucher; a saved voucher
// keeps its own. localStorage is a convenience only — wrapped so a blocked
// store never breaks the editor.
const lastBankKey = (kind: string, orgId?: string) => `aims:last-bank:${kind}:${orgId || "org"}`;
const readLastBank = (kind: string, orgId?: string): string => { try { return localStorage.getItem(lastBankKey(kind, orgId)) || ""; } catch { return ""; } };
const writeLastBank = (kind: string, orgId: string | undefined, code: string) => { try { localStorage.setItem(lastBankKey(kind, orgId), code); } catch { /* ignore */ } };

export function OrDebitInput({ formData, setFormData }: RowProps) {
  const accounts = useOrAccounts();
  const { getToken } = useAuth();
  const { organization } = useOrganization();
  const banks = useMemo(() => accounts.filter(isBankish), [accounts]);
  const code = formData?.orData?.debitAccountCode || "";
  const [input, setInput] = useState(code);
  const [dialogOpen, setDialogOpen] = useState(false);
  useEffect(() => setInput(code), [code]);
  const selected = accounts.find((a) => a.code === code);
  const commit = (acc: OrAccount) => {
    writeLastBank("or", organization?.id, acc.code);
    setOrData(formData, setFormData, { debitAccountCode: acc.code, depositLabel: `${acc.code} — ${acc.name}` });
  };
  // Unsaved receipt: the number box follows the bank AND the date (guru
  // 2026-11-05) — SCBOR2611-001 becomes SCBOR2610-001 when the date is moved
  // into October. Re-peeked whenever either changes; a saved receipt keeps
  // its number. The peek is a round trip, so the result is merged onto the
  // LATEST state (setFormData takes an updater), never onto the snapshot.
  const date = formData?.orData?.date || "";
  // A number typed by hand is the user's, not the series' — the preview
  // stands down for good once they have edited the box.
  const unsaved = (!formData?.savedAt || numberIsPending(formData?.name)) && !formData?.numberTouched;
  // A new receipt opens on the deposit bank used last time (once the chart is here).
  const prefilled = useRef(false);
  useEffect(() => {
    if (prefilled.current || code || !unsaved || !banks.length) return;
    prefilled.current = true;
    const last = readLastBank("or", organization?.id);
    const acc = last ? banks.find((b) => b.code === last) : undefined;
    if (acc) commit(acc);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, unsaved, banks, organization?.id]);
  // The preview answers a CHANGE of bank or date, never a remount: Preview → Edit remounts this
  // input, and a fresh peek then returned the NEXT number in the series (the one in the box was
  // already claimed by the autosave) — SCBOR2611-001 silently became -002 (found 2026-11-28).
  const seen = useRef<{ code: string; date: string } | null>(null);
  useEffect(() => {
    if (!code || !unsaved) return;
    const first = seen.current === null;
    seen.current = { code, date };
    if (first && formData?.name && !numberIsPending(formData.name)) return;
    let cancelled = false;
    void (async () => {
      const n = await peekDocumentNumber("OFFICIAL_RECEIPT", code, date, await getToken());
      if (cancelled || !n) return;
      setFormData((prev: any) => (prev?.name === n ? prev : { ...prev, name: n, documentInfo: { ...(prev?.documentInfo || {}), documentNumber: n } }));
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, date, unsaved]);
  return (
    <>
      <TextField
        size="small"
        value={input}
        placeholder="Code"
        onChange={(e) => {
          const v = e.target.value;
          setInput(v);
          const match = findAccountByTypedCode(banks, v);
          if (match && match.code !== code) commit(match);
        }}
        onBlur={() => setInput(code)}
        sx={{ ...headerInputSx, width: 180 }}
        InputProps={{
          startAdornment: (
            <InputAdornment position="start" sx={{ mr: 0 }}>
              <IconButton data-hotkey="lookup" size="small" onClick={() => setDialogOpen(true)} sx={{ p: 0.25, ml: -0.5 }} title="Search">
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
  // The receipt amount IS the lines' total (2026-11-28) — read here, keyed in the grid.
  const amount = orTotal(formData);
  return (
    // data-tour: anchor for AIMS Guide walkthroughs (receipt amount step)
    <Box data-tour="or-amount" sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "nowrap" }}>
      <Typography sx={{ fontSize: "13px", fontWeight: 700, color: "text.secondary" }}>{currency}</Typography>
      <TextField
        size="small"
        value={fmt(amount)}
        InputProps={{ readOnly: true }}
        inputProps={{ style: { textAlign: "right", fontWeight: 600 }, tabIndex: -1 }}
        sx={{ ...headerInputSx, width: 180, "& .MuiInputBase-root": { bgcolor: "action.hover" } }}
        title="The total of the lines below"
      />
      <Typography sx={{ fontSize: "13px", fontWeight: 700, ml: 1.5 }}>Rate</Typography>
      {/* Always editable (guru 2026-11-14: "don't disable the rate here"); a
          base-currency receipt starts at 1.0000000 and the user may key another rate. */}
      <RateInput value={od.rate ?? 1} onCommit={(n) => setOrData(formData, setFormData, { rate: n })} sx={{ ...headerInputSx, width: 140 }} />
      <Typography sx={{ fontSize: "13px", fontWeight: 700, ml: 1.5 }}>Amount&nbsp;&nbsp;SGD</Typography>
      <TextField
        size="small"
        value={fmt(R(amount * rate))}
        InputProps={{ readOnly: true }}
        inputProps={{ style: { textAlign: "right" }, tabIndex: -1 }}
        sx={{ ...headerInputSx, width: 170 }}
      />
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Body — the lines grid, with the legacy left rail. The voucher's grid, on the
// receipt's side of the ledger.
// ---------------------------------------------------------------------------
const newLine = (): OrLine => ({ id: `l${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, accountCode: "", accountName: "", description: "", remarks: "", amount: "" });

function AccountCodeCell({ value, accounts, disabled, onCommit }: { value: string; accounts: OrAccount[]; disabled?: boolean; onCommit: (acc: OrAccount) => void }) {
  const [input, setInput] = useState(value);
  const [open, setOpen] = useState(false);
  useEffect(() => setInput(value), [value]);
  const inputRef = useRef<HTMLInputElement>(null);
  // Once the code lands, the cursor moves on to the row's next empty box (Remarks, then the money).
  const jump = () => setTimeout(() => focusNextEmptyInRow(inputRef.current), 0);
  const findExact = (v: string) => findAccountByTypedCode(accounts, v);
  return (
    <>
      <TextField
        size="small"
        value={input}
        placeholder="Code"
        disabled={disabled}
        inputRef={inputRef}
        onChange={(e) => {
          const v = e.target.value;
          setInput(v);
          const match = findExact(v);
          if (match && match.code !== value) {
            onCommit(match);
            const longer = accounts.some((a) => a.code !== match.code && (String(a.code).toLowerCase().startsWith(v.trim().toLowerCase()) || accountCodeKey(a.code).startsWith(accountCodeKey(v))));
            if (!longer) jump();
          }
        }}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          const match = findExact(input);
          if (!match) return;
          e.preventDefault();
          e.stopPropagation();
          if (match.code !== value) onCommit(match);
          jump();
        }}
        onBlur={() => setInput(value)}
        sx={{ width: 150 }}
        InputProps={{
          startAdornment: (
            <InputAdornment position="start" sx={{ mr: 0 }}>
              <IconButton data-hotkey="lookup" size="small" disabled={disabled} onClick={() => setOpen(true)} sx={{ p: 0.25, ml: -0.5 }} title="Search">
                <SearchIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </InputAdornment>
          ),
        }}
      />
      <AccountSelectDialog
        open={open}
        onClose={() => setOpen(false)}
        accounts={accounts}
        onSelect={(a) => {
          onCommit(a);
          jump();
        }}
      />
    </>
  );
}

export function OfficialReceiptLinesSection({
  formData,
  setFormData,
  receiptId,
  customers = [],
  disabled = false,
  lockNote = false,
  framed = false,
}: {
  formData: any;
  setFormData: (next: any) => void;
  receiptId?: string;
  customers?: any[];
  disabled?: boolean;
  /** The presence lock (another session edits it): the only lock that explains itself here. */
  lockNote?: boolean;
  // Legacy chrome: put the rail in the editor's 204px left margin (guru 2026-11-16).
  framed?: boolean;
}) {
  const router = useRouter();
  const accounts = useOrAccounts();
  const od = formData?.orData || {};
  const currency = String(od.currency || "SGD").toUpperCase();
  const rate = Number(od.rate) || 1;
  const lines = orLines(formData);
  const debtor = orDebtorLine(formData);
  const total = orTotal(formData);
  const customerId = formData?.customer?.id || "";
  // Lines pick from the whole chart except the deposit-to bank itself.
  const lineAccounts = useMemo(() => accounts.filter((a) => a.isActive !== false && a.code !== od.debitAccountCode), [accounts, od.debitAccountCode]);

  // The debtor line's allocations are mirrored onto orData.allocations (the preview, the print and
  // older readers take them from there).
  const writeLines = (next: OrLine[]) =>
    setOrData(formData, setFormData, { lines: next, allocations: next.find((l) => l.offset?.customerId)?.offset?.allocations || [] });
  const patchLine = (id: string, patch: Partial<OrLine>) => writeLines(lines.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const removeLine = (id: string) => writeLines(lines.filter((l) => l.id !== id));
  const addLine = () => writeLines([...lines, newLine()]);

  // Enter on the LAST line's money box adds the next line and lands in its Account code.
  const addLineRef = useRef(addLine);
  addLineRef.current = addLine;
  const onLastMoneyKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key !== "Enter" || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey || disabled) return;
    e.preventDefault();
    e.stopPropagation();
    setTimeout(() => {
      addLineRef.current();
      setTimeout(() => {
        const rows = Array.from(document.querySelectorAll<HTMLTableRowElement>("[data-receipt-grid] tbody tr")).filter((r) => r.querySelector("input"));
        rows[rows.length - 1]?.querySelector<HTMLInputElement>("input:not([disabled])")?.focus();
      }, 60);
    }, 0);
  };

  // Offset Transactions dialog — opened from the Received-from pencil (header), the debtor line's
  // pencil, or by KEYING THE DEBTOR CONTROL CODE on a plain line. That line is remembered so the saved
  // debtor line takes its row; Cancel clears the code again.
  const [offsetOpen, setOffsetOpen] = useState(false);
  const [pendingLineId, setPendingLineId] = useState<string | null>(null);
  const debtorCode = String(od.debtorAccountCode || (debtor?.accountCode ?? "") || "");
  const commitLineAccount = (l: OrLine, a: OrAccount) => {
    if (debtorCode && a.code === debtorCode) {
      if (!od.debitAccountCode) {
        toast.warn("Pick the deposit-to account first");
        return;
      }
      if (debtor && debtor.id !== l.id) {
        // One payer per receipt: the debtor line exists — edit it instead.
        toast.info("This receipt already has a debtor line — editing it");
        writeLines(lines.filter((x) => x.id !== l.id || x.accountCode));
        setOffsetOpen(true);
        return;
      }
      patchLine(l.id, { accountCode: a.code, accountName: a.name, description: a.name.toUpperCase() });
      setPendingLineId(l.id);
      setOffsetOpen(true);
      return;
    }
    // The Description IS the account name once a code is keyed (read-only in the grid), so it follows the account.
    patchLine(l.id, { accountCode: a.code, accountName: a.name, description: a.name.toUpperCase() });
  };
  useEffect(() => {
    const onOpen = () => {
      if (disabled) return;
      if (!od.debitAccountCode) {
        toast.warn("Pick the deposit-to account first");
        return;
      }
      setOffsetOpen(true);
    };
    window.addEventListener(OR_OFFSET_EVENT, onOpen);
    return () => window.removeEventListener(OR_OFFSET_EVENT, onOpen);
  }, [disabled, od.debitAccountCode]);

  const saveOffset = (line: OrLine, customer: any) => {
    // The debtor line takes the row it was keyed on (pending plain line), else the old debtor line's row, else the end.
    const anchorIdx = lines.findIndex((l) => (pendingLineId && l.id === pendingLineId) || l.offset);
    const rest = lines.filter((l) => l.id !== line.id && l.id !== pendingLineId && !l.offset);
    const next = [...rest];
    next.splice(anchorIdx >= 0 ? Math.min(anchorIdx, next.length) : next.length, 0, line);
    setPendingLineId(null);
    // The customer picked in the dialog is the payer.
    const patch = customer ? receiptCustomerPatch({ ...formData, orData: { ...od, lines: next } }, customer) : null;
    setFormData({
      ...formData,
      ...(patch || {}),
      orData: { ...od, ...(patch?.orData || {}), lines: next, allocations: line.offset?.allocations || [] },
    });
  };
  const clearOffset = () => writeLines(lines.filter((l) => !l.offset));

  const headCellSx = { fontWeight: 700, fontSize: "0.75rem", color: "text.secondary", whiteSpace: "nowrap" as const };

  // Legacy left-rail modules. Debtor Statement and Manual Offset are live.
  const [debtorStatementOpen, setDebtorStatementOpen] = useState(false);
  const [manualOffsetOpen, setManualOffsetOpen] = useState(false);
  const [contraOpen, setContraOpen] = useState(false);
  const { isContraOffsetEnabled } = useOrganizationFeatures();
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
    // Contra: the same company as customer AND supplier — invoices vs bills.
    ...(isContraOffsetEnabled
      ? [{ label: "Contra Set-off", icon: <SwapHorizIcon />, onClick: needCustomer(() => setContraOpen(true)) }]
      : []),
    {
      label: "Audit Trail",
      icon: <ManageSearchIcon />,
      // Xero-style report (guru's call), pre-scoped to receipts this month.
      // ?back= returns to THIS receipt page from the report's Back button.
      onClick: () => {
        const today = todayIso();
        const back = encodeURIComponent(window.location.pathname + window.location.search);
        router.push(`/portal/accounting/receivables?tab=audit-trail&prefix=OR&from=${today.slice(0, 7)}-01&to=${today}&back=${back}`);
      },
    },
  ];

  return (
    <Box sx={{ mt: 0.5, mx: 0.5, flex: 1, minHeight: 0, display: "flex", flexDirection: framed ? { xs: "column", lg: "row" } : "row", gap: 1, position: framed ? "relative" : undefined }}>
      {/* Side rail — the legacy screen's left module buttons. Framed: the rail
          sits in the editor's 204px left margin, matching the invoice/DO. */}
      <Box sx={docRailSx(framed)}>
        <EditorRail buttons={railButtons} responsive={framed} />
      </Box>

      <Card data-tour="or-offset-grid" sx={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}>
        <CardContent sx={{ p: 1, flex: 1, minHeight: 0, display: "flex", flexDirection: "column", "&:last-child": { pb: 1 } }}>
          <Box sx={{ borderBottom: 1, borderColor: "divider" }}>
            <Tabs value={0} sx={{ minHeight: 32, "& .MuiTab-root": { minHeight: 32, py: 0 } }}>
              <Tab label="Receipt Lines" />
            </Tabs>
          </Box>

          <Box sx={{ flex: 1, minHeight: 120, display: "flex", flexDirection: "column", pt: 1 }}>
            {disabled && lockNote && (
              <Alert severity="warning" variant="outlined" sx={{ mb: 1, alignSelf: "flex-start" }}>
                Read-only — another session holds this receipt&apos;s edit lock. Close the other tab
                or use &quot;Take over&quot; in the banner at the top of the page.
              </Alert>
            )}
            <TableContainer data-receipt-grid component={Paper} variant="outlined" sx={{ flex: 1, minHeight: 0, borderRadius: 1.5 }}>
              <Table
                size="small"
                stickyHeader
                sx={(t) => ({
                  "& tbody td": { py: 0.5, borderBottom: `1px solid ${t.palette.mode === "dark" ? "rgba(255,255,255,0.32)" : "rgba(0,0,0,0.32)"}` },
                })}
              >
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ ...headCellSx, width: 170 }}>Account code</TableCell>
                    <TableCell sx={headCellSx}>Description</TableCell>
                    <TableCell sx={headCellSx}>Remarks</TableCell>
                    <TableCell sx={{ ...headCellSx, textAlign: "right", width: 170 }}>Amount</TableCell>
                    <TableCell sx={{ ...headCellSx, width: 44 }} />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {lines.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} sx={{ color: "text.secondary", py: 2 }}>
                        No lines yet. Add a line for money received against an account (a grant, interest, a refund), or use the pencil beside Received from to settle a customer&apos;s invoices.
                      </TableCell>
                    </TableRow>
                  )}
                  {lines.map((l, idx) => {
                    const isLast = idx === lines.length - 1;
                    const isDebtor = !!l.offset;
                    const acc = accounts.find((a) => a.code === l.accountCode);
                    return (
                      <TableRow key={l.id} hover>
                        <TableCell>
                          {isDebtor ? (
                            <Typography sx={{ fontWeight: 700, fontVariantNumeric: "tabular-nums", pl: 0.5 }}>{l.accountCode || "—"}</Typography>
                          ) : (
                            <AccountCodeCell value={l.accountCode || ""} accounts={lineAccounts} disabled={disabled} onCommit={(a) => commitLineAccount(l, a)} />
                          )}
                        </TableCell>
                        <TableCell>
                          {isDebtor ? (
                            <Typography sx={{ fontWeight: 600 }}>{l.description || acc?.name?.toUpperCase() || "TRADE DEBTORS"}</Typography>
                          ) : (
                            <TextField
                              size="small"
                              fullWidth
                              value={l.description || ""}
                              placeholder={acc ? acc.name.toUpperCase() : "Description"}
                              disabled={disabled}
                              InputProps={{ readOnly: !!l.accountCode }}
                              inputProps={l.accountCode ? { tabIndex: -1 } : undefined}
                              sx={l.accountCode ? { "& .MuiInputBase-root": { bgcolor: "action.hover" }, "& .MuiInputBase-input": { cursor: "default" } } : undefined}
                              onChange={(e) => patchLine(l.id, { description: e.target.value })}
                            />
                          )}
                        </TableCell>
                        <TableCell>
                          {isDebtor ? (
                            <Stack direction="row" spacing={1} alignItems="center">
                              <Typography variant="body2">{l.remarks || `${l.offset?.customerCode || ""} ${l.offset?.customerName || ""}`.trim()}</Typography>
                              <Chip size="small" variant="outlined" label={`${l.offset?.allocations?.length || 0} invoice(s)`} sx={{ height: 20 }} />
                            </Stack>
                          ) : (
                            <TextField size="small" fullWidth value={l.remarks || ""} disabled={disabled} onChange={(e) => patchLine(l.id, { remarks: e.target.value })} />
                          )}
                        </TableCell>
                        <TableCell sx={{ textAlign: "right" }} onKeyDown={isLast && !isDebtor ? onLastMoneyKeyDown : undefined}>
                          <MoneyInput
                            value={l.amount ?? ""}
                            disabled={disabled || isDebtor}
                            onCommit={(v) => patchLine(l.id, { amount: v })}
                            allowNegative
                            sx={{ width: 150 }}
                            title={isDebtor ? "Set in the Offset Transactions dialog" : "Negative = a charge deducted from the deposit"}
                          />
                        </TableCell>
                        <TableCell padding="checkbox">
                          {isDebtor ? (
                            <Tooltip title="Edit the invoices this receipt settles">
                              <span>
                                <IconButton size="small" disabled={disabled} onClick={() => setOffsetOpen(true)} color="primary">
                                  <EditNoteIcon fontSize="small" />
                                </IconButton>
                              </span>
                            </Tooltip>
                          ) : (
                            <IconButton size="small" disabled={disabled} onClick={() => removeLine(l.id)} sx={{ color: "error.main" }} title="Remove line">
                              <DeleteOutlineIcon fontSize="small" />
                            </IconButton>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {/* Add line lives INSIDE the grid as its last row (guru 2026-11-16). */}
                  <TableRow>
                    <TableCell colSpan={5} sx={{ py: 0.75, borderBottom: "none !important" }}>
                      <Button data-hotkey="addLine" variant="contained" size="small" startIcon={<AddIcon />} onClick={addLine} disabled={disabled}>
                        Add line
                      </Button>
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </TableContainer>

            <Stack direction="row" alignItems="center" sx={{ mt: 1, pr: 1 }} spacing={2}>
              <Box sx={{ flex: 1 }} />
              <Typography sx={{ fontWeight: 700 }}>Amount</Typography>
              <Typography sx={{ fontWeight: 700, color: "warning.main" }}>{currency}</Typography>
              <Typography
                sx={{ fontVariantNumeric: "tabular-nums", fontWeight: 700, fontSize: "1.05rem", minWidth: 140, textAlign: "right", color: total < 0 ? "error.main" : "text.primary" }}
              >
                {fmt(total)}
              </Typography>
              {currency !== "SGD" && (
                <Typography variant="body2" sx={{ color: "text.secondary", fontVariantNumeric: "tabular-nums" }}>
                  = SGD {fmt(R(total * rate))}
                </Typography>
              )}
            </Stack>
            {total < 0 && (
              <Typography variant="caption" sx={{ display: "block", textAlign: "right", color: "error.main", pr: 1 }}>
                The lines must add up to money entering the bank.
              </Typography>
            )}
          </Box>
        </CardContent>
      </Card>

      {/* Offset Transactions — the customer's open invoices, in the voucher's offset dialog (customer side). */}
      <PvOffsetSupplierDialog
        open={offsetOpen}
        party="customer"
        allowInvoices
        allowCredits={false}
        title="Offset Transactions"
        receiptId={receiptId}
        suppliers={[]}
        customers={customers}
        onClose={() => {
          setOffsetOpen(false);
          // Keyed the control code but backed out: the row goes back to blank.
          if (pendingLineId) {
            patchLine(pendingLineId, { accountCode: "", accountName: "", description: "" });
            setPendingLineId(null);
          }
        }}
        voucherId={receiptId}
        voucherNumber={formData?.documentInfo?.documentNumber || formData?.name || ""}
        voucherDate={od.date || ""}
        voucherCurrency={currency}
        creditorAccountCode={debtorCode}
        existing={debtor || null}
        existingSupplier={formData?.customer?.id ? formData.customer : null}
        onSave={(line, customer) => {
          saveOffset(line, customer);
          setOffsetOpen(false);
        }}
        onClear={() => {
          clearOffset();
          setOffsetOpen(false);
        }}
      />

      {/* Debtor Statement-Of-Account (side rail) — for the selected customer */}
      <DebtorStatementDialog open={debtorStatementOpen} onClose={() => setDebtorStatementOpen(false)} customer={formData?.customer?.id ? formData.customer : null} />

      {/* Manual Offset (side rail) — credit notes ↔ invoices, no cash moves */}
      <ManualOffsetDialog open={manualOffsetOpen} onClose={() => setManualOffsetOpen(false)} customer={formData?.customer?.id ? formData.customer : null} onSaved={() => undefined} />

      {/* Contra set-off (side rail) — their invoices ↔ our bills, no cash */}
      {isContraOffsetEnabled && (
        <ContraOffsetDialog open={contraOpen} onClose={() => setContraOpen(false)} customer={formData?.customer?.id ? formData.customer : null} onSaved={() => undefined} />
      )}
    </Box>
  );
}
