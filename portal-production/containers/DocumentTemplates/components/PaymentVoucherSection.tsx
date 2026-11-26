"use client";

// Payment Voucher pieces for TabbedDocumentCreator — rebuilt 2026-11-09 to
// follow the legacy software's P/V screen (guru: "change the payment voucher
// screen to follow this instead"):
//
//   GENERAL      Bank Account [code] CASH AT BANK - OCBC        Rate 1.0000000
//                Voucher No.  [O G261101]
//                Date         [06/11/2026]
//                Payee        [2LT GLASS & MIRROR …          ] ✎  ← Offset Supplier Invoices
//                Remarks      [                              ]
//                Bank advice [        ]   Prepare By [        ]
//   ┌ Account code │ Description     │ Remarks │ Amount ┐      ┌ Remarks ┐
//   │ EA002        │ ACCOUNTING FEE  │         │ 1000.00│      │ (memo)  │
//   │ CL001        │ TRADE CREDITORS │ C2001 … │ 2500.00│      └─────────┘
//   └──────────────────────────────── Amount SGD 3,500.00 ┘
//
// A line is any GL account with an amount (bank charge, fee, a refund as a
// negative), or the ONE creditor line the Offset Supplier Invoices dialog
// writes (Trade Creditors + the supplier + the invoices ticked). The total of
// the lines is the cash leaving the bank. Spend Money retired into this.
//
// Voucher state rides in formData.pvData so the editor's dirty tracking, exit
// prompt and Save path work unchanged. Accounting: Cr bank total / Dr each
// line (creditor control per allocated invoice, ± realised FX).

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
import SearchIcon from "@mui/icons-material/Search";
import EditNoteIcon from "@mui/icons-material/EditNote";
import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import DescriptionOutlinedIcon from "@mui/icons-material/DescriptionOutlined";
import ManageSearchIcon from "@mui/icons-material/ManageSearch";
import SwapHorizIcon from "@mui/icons-material/SwapHoriz";
import CompareArrowsIcon from "@mui/icons-material/CompareArrows";
import { useAuth } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { headerInputSx } from "./DynamicFormFields";
import ContraOffsetDialog from "./ContraOffsetDialog";
import ManualOffsetDialog from "./ManualOffsetDialog";
import PvOffsetSupplierDialog, { type PvLine, type PvOffset } from "./PvOffsetSupplierDialog";
import { useOrganizationFeatures } from "@/app/portal/hooks/useOrganizationFeatures";
import { AccountSelectDialog, numberIsPending, peekDocumentNumber, useOrAccounts, type OrAccount } from "./OfficialReceiptSection";
import { focusNextEmptyInRow } from "@/helpers/focusNextEmptyInRow";
import type { TemplateFieldConfig } from "../types/templateFieldTypes";
import { todayIso } from "@/helpers/orgToday";
import EditorRail from "./EditorRail";
import { docRailSx } from "@/helpers/wctDocUi";
import { useOrganization } from "@/app/portal/hooks/useOrganization";

export type { PvLine, PvOffset };

// Field names avoid HEADER_FIELD_ORDER and the right-column substring filters
// (rate/currency/gst/...), so DynamicFormFields renders them single-column in
// exactly this order — the legacy P/V General-tab layout.
export const PV_FIELD_DEFINITIONS: TemplateFieldConfig = {
  tabs: [
    {
      tabId: "general",
      tabLabel: "GENERAL",
      fields: [
        { fieldName: "pvBankRow", displayLabel: "Bank Account", fieldType: "text", required: true },
        { fieldName: "pvVoucherNo", displayLabel: "Voucher No.", fieldType: "text", required: false },
        { fieldName: "pvData.date", displayLabel: "Date", fieldType: "date", required: true },
        { fieldName: "pvPayeeRow", displayLabel: "Payee", fieldType: "text", required: false },
        { fieldName: "pvChequeRow", displayLabel: "Bank advice", fieldType: "text", required: false },
      ],
    },
  ],
};

/** Window event the Payee pencil fires; the lines section opens the dialog. */
export const PV_OFFSET_EVENT = "aims:pv-offset";

const fmt = (n: number) =>
  (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const R = (n: number) => Math.round(n * 100) / 100;

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

export const pvLines = (formData: any): PvLine[] => (Array.isArray(formData?.pvData?.lines) ? formData.pvData.lines : []);
export const pvTotal = (formData: any) => R(pvLines(formData).reduce((s, l) => s + (parseFloat(String(l.amount)) || 0), 0));
/** The single party line (supplier offset via the AP control, or customer refund via the AR control). */
export const pvCreditorLine = (formData: any): PvLine | undefined => pvLines(formData).find((l) => l.offset?.supplierId || l.offset?.customerId);
const partyCodeOf = (l?: PvLine | null) => l?.offset?.supplierCode || l?.offset?.customerCode || "";
const partyNameOf = (l?: PvLine | null) => l?.offset?.supplierName || l?.offset?.customerName || "";

/** The editor's pre-save check — mirrors the server's rules so the toast is immediate. */
export function pvValidationError(formData: any): string | null {
  const pd: any = formData?.pvData || {};
  if (!pd.bankAccountCode) return "Select the Bank Account the payment comes from";
  const lines = pvLines(formData).filter((l) => l.accountCode || parseFloat(String(l.amount)) || l.offset);
  if (!lines.length) return "Add at least one line — an account and an amount, or offset supplier invoices";
  for (const [i, l] of lines.entries()) {
    if (!l.accountCode && !l.offset) return `Line ${i + 1}: pick an account code`;
    if (!l.offset && !(parseFloat(String(l.amount)) || 0)) return `Line ${i + 1}: enter an amount`;
  }
  const total = pvTotal(formData);
  const hasCredit = lines.some((l) => (l.offset?.allocations || []).some((a: any) => (Number(a.amount) || 0) < 0));
  if (total < 0) return "The voucher total cannot be negative — the lines must add up to money leaving the bank";
  if (total === 0 && !hasCredit) return "The voucher total must be greater than zero";
  return null;
}

// Kept for the editor's shared Locate (supplier) dialog branch: picking a
// supplier there stores it as the payee the offset dialog starts from.
//
// A SUPPLIER THE USER JUST PICKED WINS over whatever is sitting in the Payee
// box (guru 2026-11-18). It used to be the other way round — `payee || name` —
// so the half-typed search text stayed: SCBPV2610-002 went out as payee
// "unu a" while its line, its offset invoices and the journal all said
// UNU Automation Engineering. The voucher is the paperwork for a payment; its
// payee cannot be a typo of the party being paid.
export function voucherSupplierPatch(formData: any, s: any) {
  return {
    supplier: s
      ? { id: s.id, name: s.name || "", supplierCode: s.supplierCode || s.customerCode || "", address: s.address || "", email: s.email || "", currency: s.currency || "SGD" }
      : { id: "", name: "", supplierCode: "", address: "", email: "" },
    pvData: { ...(formData.pvData || {}), payee: s?.name || formData?.pvData?.payee || "" },
  };
}

// Editable (guru 2026-11-05) — see OrReceiptNoInput.
export function PvVoucherNoInput({ formData, setFormData }: RowProps) {
  const raw = formData?.documentInfo?.documentNumber || formData?.name || "";
  const value = raw.startsWith("PV-PENDING") ? "" : raw;
  return (
    <TextField
      size="small"
      value={value}
      placeholder="Issued on save"
      onChange={(e) => {
        const v = e.target.value;
        setFormData({ ...formData, name: v, numberTouched: true, documentInfo: { ...(formData.documentInfo || {}), documentNumber: v } });
      }}
      sx={{ ...headerInputSx, width: 220 }}
      inputProps={{ style: { fontWeight: 600 } }}
    />
  );
}

// Bank Account — the paid-from bank/cash (credit side), with Rate beside the
// bank name on the same row. A FOREIGN_BANK account unlocks Currency + Rate.
// The bank is remembered PER ORG in this browser (guru 2026-11-16: "keep the
// prev bank account so they don't need to always key in bank account"): the
// code the user last picked prefills the next NEW voucher; a saved voucher
// keeps its own. localStorage is a convenience only — wrapped so a blocked
// store never breaks the editor.
const lastBankKey = (kind: string, orgId?: string) => `aims:last-bank:${kind}:${orgId || "org"}`;
const readLastBank = (kind: string, orgId?: string): string => { try { return localStorage.getItem(lastBankKey(kind, orgId)) || ""; } catch { return ""; } };
const writeLastBank = (kind: string, orgId: string | undefined, code: string) => { try { localStorage.setItem(lastBankKey(kind, orgId), code); } catch { /* ignore */ } };

export function PvBankInput({ formData, setFormData }: RowProps) {
  const accounts = useOrAccounts();
  const { getToken } = useAuth();
  const { organization } = useOrganization();
  const banks = useMemo(() => accounts.filter(isBankish), [accounts]);
  const pd = formData?.pvData || {};
  const code = pd.bankAccountCode || "";
  const [input, setInput] = useState(code);
  const [dialogOpen, setDialogOpen] = useState(false);
  useEffect(() => setInput(code), [code]);
  const selected = accounts.find((a) => a.code === code);
  const foreign = selected?.accountType === "FOREIGN_BANK";
  const currency = String(pd.currency || "SGD").toUpperCase();
  const commit = (acc: OrAccount) => {
    writeLastBank("pv", organization?.id, acc.code);
    setPvData(formData, setFormData, {
      bankAccountCode: acc.code,
      bankLabel: `${acc.code} — ${acc.name}`,
      ...(acc.accountType !== "FOREIGN_BANK" ? { currency: "SGD", rate: 1 } : {}),
    });
  };
  // Unsaved voucher: the number box follows the bank AND the date (guru
  // 2026-11-05). A number typed by hand stands.
  const date = pd.date || "";
  const unsaved = (!formData?.savedAt || numberIsPending(formData?.name)) && !formData?.numberTouched;
  // A new voucher opens on the bank used last time (once the chart is here).
  const prefilled = useRef(false);
  useEffect(() => {
    if (prefilled.current || code || !unsaved || !banks.length) return;
    prefilled.current = true;
    const last = readLastBank("pv", organization?.id);
    const acc = last ? banks.find((b) => b.code === last) : undefined;
    if (acc) commit(acc);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, unsaved, banks, organization?.id]);
  useEffect(() => {
    if (!code || !unsaved) return;
    let cancelled = false;
    void (async () => {
      const n = await peekDocumentNumber("PAYMENT_VOUCHER", code, date, await getToken());
      if (cancelled || !n) return;
      setFormData((prev: any) => (prev?.name === n ? prev : { ...prev, name: n, documentInfo: { ...(prev?.documentInfo || {}), documentNumber: n } }));
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, date, unsaved]);
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1, flex: 1, minWidth: 0 }}>
      <TextField
        data-tour="pv-bank"
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
              <IconButton data-hotkey="lookup" size="small" onClick={() => setDialogOpen(true)} sx={{ p: 0.25, ml: -0.5 }} title="Search">
                <SearchIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </InputAdornment>
          ),
        }}
      />
      <AccountEcho currency={currency} name={selected?.name || ""} />
      {/* Rate sits right after the bank name (guru 2026-11-09: far right was
          "very hard to reach"), still on the same row as the legacy screen. */}
      <Box sx={{ width: 24 }} />
      {foreign && (
        <TextField
          size="small"
          value={currency}
          onChange={(e) => setPvData(formData, setFormData, { currency: e.target.value.toUpperCase().slice(0, 3) })}
          inputProps={{ maxLength: 3, style: { textTransform: "uppercase", width: 44 } }}
          sx={headerInputSx}
          title="Bank currency"
        />
      )}
      <Typography sx={{ fontSize: "13px", fontWeight: 700 }}>Rate</Typography>
      <RateInput
        value={pd.rate ?? 1}
        onCommit={(n) => setPvData(formData, setFormData, { rate: n })}
        disabled={!foreign}
        sx={{ ...headerInputSx, width: 140, mr: 1 }}
        title={foreign ? `${currency} → SGD` : "Base currency voucher"}
      />
      <AccountSelectDialog open={dialogOpen} onClose={() => setDialogOpen(false)} accounts={banks} onSelect={commit} />
    </Box>
  );
}

// Payee — free text, prefilled by the offset dialog; the pencil opens Offset
// Supplier Invoices (F2 too, via data-hotkey="lookup").
export function PvPayeeInput({ formData, setFormData }: RowProps) {
  const pd = formData?.pvData || {};
  const creditor = pvCreditorLine(formData);
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1, flex: 1, minWidth: 0 }}>
      <TextField
        data-tour="pv-payee"
        size="small"
        value={pd.payee || ""}
        placeholder="Who is being paid"
        onChange={(e) => setPvData(formData, setFormData, { payee: e.target.value })}
        sx={{ ...headerInputSx, flex: 1, maxWidth: 560 }}
        InputProps={{
          endAdornment: (
            <InputAdornment position="end">
              <Tooltip title={creditor ? "Offset Supplier Invoices — edit the supplier line" : "Offset Supplier Invoices — pay this supplier's invoices"}>
                <IconButton
                  data-hotkey="lookup"
                  size="small"
                  onClick={() => window.dispatchEvent(new CustomEvent(PV_OFFSET_EVENT))}
                  sx={{ p: 0.25 }}
                  color={creditor ? "primary" : "default"}
                >
                  <EditNoteIcon sx={{ fontSize: 18 }} />
                </IconButton>
              </Tooltip>
            </InputAdornment>
          ),
        }}
      />
      {partyCodeOf(creditor) && (
        <Chip size="small" variant="outlined" color="primary" label={`${partyCodeOf(creditor)} · ${creditor?.offset?.allocations?.length || 0} ${creditor?.offset?.customerId ? "credit note(s)" : "invoice(s)"}`} sx={{ height: 22 }} />
      )}
    </Box>
  );
}

// Bank advice (cheque / transfer reference) + Prepare By on one row, like the legacy screen (wording: guru 2026-11-11).
export function PvChequeRow({ formData, setFormData }: RowProps) {
  const pd = formData?.pvData || {};
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
      <TextField
        size="small"
        value={pd.chequeNo || ""}
        placeholder="Bank advice no."
        onChange={(e) => setPvData(formData, setFormData, { chequeNo: e.target.value })}
        sx={{ ...headerInputSx, width: 220 }}
      />
      <Typography sx={{ fontSize: "13px", fontWeight: 700, ml: 2 }}>Prepare By</Typography>
      <TextField
        size="small"
        value={pd.preparedBy || ""}
        onChange={(e) => setPvData(formData, setFormData, { preparedBy: e.target.value })}
        sx={{ ...headerInputSx, width: 220 }}
        // Last header field: Enter with an empty grid adds the first line and
        // lands in it (guru 2026-11-16: "enter, enter, enter … the next enter
        // adds an item automatically"). With lines present Enter simply walks on.
        onKeyDown={(e) => {
          if (e.key !== "Enter" || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return;
          if (pvLines(formData).length) return;
          e.preventDefault();
          e.stopPropagation();
          setPvData(formData, setFormData, { lines: [newLine()] });
        setTimeout(() => {
          const first = document.querySelector<HTMLInputElement>("[data-voucher-grid] tbody tr input:not([disabled])");
          first?.focus();
        }, 60);
        }}
      />
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Body — the lines grid + the Remarks memo, with the legacy left rail.
// ---------------------------------------------------------------------------
const newLine = (): PvLine => ({ id: `l${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, accountCode: "", accountName: "", description: "", remarks: "", amount: "" });

function AccountCodeCell({
  value,
  accounts,
  disabled,
  onCommit,
}: {
  value: string;
  accounts: OrAccount[];
  disabled?: boolean;
  onCommit: (acc: OrAccount) => void;
}) {
  const [input, setInput] = useState(value);
  const [open, setOpen] = useState(false);
  useEffect(() => setInput(value), [value]);
  const inputRef = useRef<HTMLInputElement>(null);
  // Once the code lands, the cursor moves on to the row's next empty box
  // (Remarks, then the money) instead of staying on the code (guru 2026-11-18).
  const jump = () => setTimeout(() => focusNextEmptyInRow(inputRef.current), 0);
  const findExact = (v: string) => accounts.find((a) => String(a.code).toLowerCase() === v.trim().toLowerCase());
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
            // Jump only when no longer code starts with what was typed, so
            // "100" still lets the user go on to key "1001"; Enter jumps anyway.
            const longer = accounts.some((a) => a.code !== match.code && String(a.code).toLowerCase().startsWith(v.trim().toLowerCase()));
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

// The Remarks memo — the legacy right-hand column, now spanning the header
// fields AND the lines grid (guru 2026-11-18: "increase the length of it to
// move it on top"). Mounted by TabbedDocumentCreator as the right column.
export function PvRemarksMemo({ formData, setFormData, disabled }: { formData: any; setFormData: (next: any) => void; disabled?: boolean }) {
  const pd = formData?.pvData || {};
  return (
    // The legacy right-hand column, now as tall as header + grid together.
    // my/mr 0.5 line it up with the header card (TabPanel p 0.5) and the
    // grid (mx 0.5).
    <Card sx={{ width: 260, flexShrink: 0, my: 0.5, mr: 0.5, display: "flex", flexDirection: "column" }}>
      <CardContent sx={{ p: 1, flex: 1, display: "flex", flexDirection: "column", "&:last-child": { pb: 1 } }}>
        <Typography sx={{ fontWeight: 700, fontSize: "0.8125rem", mb: 0.5 }}>To-Do List</Typography>
        <TextField
          multiline
          minRows={10}
          fullWidth
          value={pd.notes || ""}
          disabled={disabled}
          placeholder="Longer notes for this voucher"
          onChange={(e) => setPvData(formData, setFormData, { notes: e.target.value })}
          sx={{ flex: 1, "& .MuiInputBase-root": { alignItems: "flex-start", height: "100%" } }}
        />
      </CardContent>
    </Card>
  );
}

export function PaymentVoucherLinesSection({
  formData,
  setFormData,
  voucherId,
  suppliers = [],
  disabled = false,
  lockNote = false,
  framed = false,
}: {
  formData: any;
  setFormData: (next: any) => void;
  voucherId?: string;
  suppliers?: any[];
  disabled?: boolean;
  /** The presence lock (another session edits it): the only lock that explains itself here. */
  lockNote?: boolean;
  // Legacy chrome (enableHeaderGlAccount): the editor frames the body with a
  // 204px left margin and expects the rail to sit IN that margin, like the
  // invoice (guru 2026-11-16). Pull the rail left out of the flow when set.
  framed?: boolean;
}) {
  const router = useRouter();
  const accounts = useOrAccounts();
  const pd = formData?.pvData || {};
  const currency = String(pd.currency || "SGD").toUpperCase();
  const rate = Number(pd.rate) || 1;
  const lines = pvLines(formData);
  const creditor = pvCreditorLine(formData);
  const total = pvTotal(formData);
  // Lines pick from the whole chart except the paying bank itself.
  const lineAccounts = useMemo(() => accounts.filter((a) => a.isActive !== false && a.code !== pd.bankAccountCode), [accounts, pd.bankAccountCode]);

  const writeLines = (next: PvLine[]) => setPvData(formData, setFormData, { lines: next });
  const patchLine = (id: string, patch: Partial<PvLine>) => writeLines(lines.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const removeLine = (id: string) => writeLines(lines.filter((l) => l.id !== id));
  const addLine = () => writeLines([...lines, newLine()]);

  // Enter on the LAST line's last money box adds the next line and lands in
  // its Account code (guru 2026-11-16: "press enter through the first row,
  // it should auto add the second row"). MoneyInput commits on Enter by
  // blurring first; the add is deferred a tick so it builds on the committed
  // lines, not on this render's snapshot. Enter on an earlier line just walks
  // into the next row as before.
  const addLineRef = useRef(addLine);
  addLineRef.current = addLine;
  const onLastMoneyKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key !== "Enter" || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey || disabled) return;
    e.preventDefault();
    e.stopPropagation();
    setTimeout(() => {
      addLineRef.current();
      setTimeout(() => {
        const rows = Array.from(document.querySelectorAll<HTMLTableRowElement>("[data-voucher-grid] tbody tr")).filter((r) => r.querySelector("input"));
        rows[rows.length - 1]?.querySelector<HTMLInputElement>("input:not([disabled])")?.focus();
      }, 60);
    }, 0);
  };

  // Offset Supplier Invoices dialog — opened from the Payee pencil (header),
  // the creditor line's pencil, or by KEYING THE CREDITOR CONTROL CODE on a
  // plain line (guru 2026-11-09: "when I key in this account code it auto
  // opens the dialog to choose supplier"). That line is remembered so the
  // saved supplier line takes its row; Cancel clears the code again.
  const [offsetOpen, setOffsetOpen] = useState(false);
  const [offsetParty, setOffsetParty] = useState<"supplier" | "customer">("supplier");
  const [pendingLineId, setPendingLineId] = useState<string | null>(null);
  // The org's AP and AR control codes (Accounting Setup) — keying either on a
  // line opens the offset dialog for that side.
  const creditorCode = String(pd.creditorAccountCode || (creditor?.offset?.supplierId ? creditor.accountCode : "") || "");
  const debtorCode = String(pd.debtorAccountCode || (creditor?.offset?.customerId ? creditor.accountCode : "") || "");
  const openOffsetFor = (party: "supplier" | "customer") => {
    setOffsetParty(party);
    setOffsetOpen(true);
  };
  const commitLineAccount = (l: PvLine, a: OrAccount) => {
    const party: "supplier" | "customer" | null = creditorCode && a.code === creditorCode ? "supplier" : debtorCode && a.code === debtorCode ? "customer" : null;
    if (party) {
      if (!pd.bankAccountCode) {
        toast.warn("Pick the Bank Account first");
        return;
      }
      if (creditor && creditor.id !== l.id) {
        // One payee per voucher: the party line exists — edit it instead.
        toast.info("This voucher already has a payee line — editing it");
        writeLines(lines.filter((x) => x.id !== l.id || x.accountCode));
        openOffsetFor(creditor.offset?.customerId ? "customer" : "supplier");
        return;
      }
      patchLine(l.id, { accountCode: a.code, accountName: a.name, description: a.name.toUpperCase() });
      setPendingLineId(l.id);
      openOffsetFor(party);
      return;
    }
    // The Description IS the account name once a code is keyed (read-only
    // in the grid, guru 2026-11-18), so it follows the account.
    patchLine(l.id, { accountCode: a.code, accountName: a.name, description: a.name.toUpperCase() });
  };
  useEffect(() => {
    const onOpen = () => {
      if (disabled) return;
      if (!pd.bankAccountCode) {
        toast.warn("Pick the Bank Account first");
        return;
      }
      openOffsetFor(creditor?.offset?.customerId ? "customer" : "supplier");
    };
    window.addEventListener(PV_OFFSET_EVENT, onOpen);
    return () => window.removeEventListener(PV_OFFSET_EVENT, onOpen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled, pd.bankAccountCode, creditor?.id]);

  const saveOffset = (line: PvLine, supplier: any) => {
    // The supplier line takes the row it was keyed on (pending plain line),
    // else the old supplier line's row, else the end.
    const anchorIdx = lines.findIndex((l) => (pendingLineId && l.id === pendingLineId) || l.offset);
    const rest = lines.filter((l) => l.id !== line.id && l.id !== pendingLineId && !l.offset);
    const next = [...rest];
    next.splice(anchorIdx >= 0 ? Math.min(anchorIdx, next.length) : next.length, 0, line);
    setPendingLineId(null);
    const isCust = !!line.offset?.customerId;
    setFormData({
      ...formData,
      ...(isCust
        ? { customer: supplier ? { id: supplier.id, name: supplier.name || "", customerCode: supplier.customerCode || "" } : formData.customer }
        : {
            supplier: supplier
              ? { id: supplier.id, name: supplier.name || "", supplierCode: supplier.supplierCode || "", address: supplier.address || "", email: supplier.email || "", currency: supplier.currency || "SGD" }
              : formData.supplier,
          }),
      // The picked supplier names the payee — see voucherSupplierPatch.
      pvData: { ...pd, lines: next, payee: supplier?.name || pd.payee || "" },
    });
  };
  const clearOffset = () => {
    writeLines(lines.filter((l) => !l.offset));
  };

  const headCellSx = { fontWeight: 700, fontSize: "0.75rem", color: "text.secondary", whiteSpace: "nowrap" as const };

  // Legacy left rail — the AP twins of the receipt's modules.
  const { isContraOffsetEnabled } = useOrganizationFeatures();
  const [contraOpen, setContraOpen] = useState(false);
  // Manual Offset (guru 2026-11-09, "just like OR"): the supplier's credit
  // notes against their invoices, no cash — the receipt's dialog in supplier mode.
  const [manualOffsetOpen, setManualOffsetOpen] = useState(false);
  const supplierId = creditor?.offset?.supplierId || (creditor?.offset?.customerId ? "" : formData?.supplier?.id) || "";
  const supplierName = creditor?.offset?.supplierName || formData?.supplier?.name || "";
  const needSupplier = (fn: () => void) => () => {
    if (!supplierId) {
      toast.warn("Pick the supplier first (the pencil beside Payee)");
      return;
    }
    fn();
  };
  const back = () => encodeURIComponent(window.location.pathname + window.location.search);
  const railButtons = [
    { label: "Manual Offset", icon: <CompareArrowsIcon />, onClick: needSupplier(() => setManualOffsetOpen(true)) },
    ...(isContraOffsetEnabled
      ? [{ label: "Contra Set-off", icon: <SwapHorizIcon />, onClick: needSupplier(() => setContraOpen(true)) }]
      : []),
    {
      label: "Creditor Statement",
      icon: <DescriptionOutlinedIcon />,
      onClick: needSupplier(() => {
        const today = todayIso();
        router.push(`/portal/accounting/payables?tab=creditor-statement&contactId=${supplierId}&asOf=${today}&back=${back()}`);
      }),
    },
    {
      label: "Audit Trail",
      icon: <ManageSearchIcon />,
      onClick: () => {
        const today = todayIso();
        router.push(`/portal/accounting/payables?tab=audit-trail&prefix=P/V&from=${today.slice(0, 7)}-01&to=${today}&back=${back()}`);
      },
    },
  ];

  return (
    <Box sx={{ mt: 0.5, mx: 0.5, flex: 1, minHeight: 0, display: "flex", flexDirection: framed ? { xs: "column", lg: "row" } : "row", gap: 1, position: framed ? "relative" : undefined }}>
      {/* Side rail — the legacy screen's left module buttons. Framed (legacy
          chrome): the rail sits in the editor's 204px left margin instead of a
          flow column, matching the invoice/DO. */}
      <Box sx={docRailSx(framed)}>
        <EditorRail buttons={railButtons} responsive={framed} />
      </Box>

      <Card data-tour="pv-lines" sx={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}>
        <CardContent sx={{ p: 1, flex: 1, minHeight: 0, display: "flex", flexDirection: "column", "&:last-child": { pb: 1 } }}>
          <Box sx={{ borderBottom: 1, borderColor: "divider" }}>
            <Tabs value={0} sx={{ minHeight: 32, "& .MuiTab-root": { minHeight: 32, py: 0 } }}>
              <Tab label="Payment Lines" />
            </Tabs>
          </Box>

          <Box sx={{ flex: 1, minHeight: 120, display: "flex", flexDirection: "column", pt: 1 }}>
            {disabled && lockNote && (
              <Alert severity="warning" variant="outlined" sx={{ mb: 1, alignSelf: "flex-start" }}>
                Read-only — another session holds this voucher&apos;s edit lock. Close the other tab or use &quot;Take over&quot; in the banner at the top of the page.
              </Alert>
            )}
            <TableContainer data-voucher-grid component={Paper} variant="outlined" sx={{ flex: 1, minHeight: 0, borderRadius: 1.5 }}>
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
                        No lines yet. Add a line for an account paid directly, or use the pencil beside Payee to offset a supplier&apos;s invoices.
                      </TableCell>
                    </TableRow>
                  )}
                  {lines.map((l, idx) => {
                    const isLast = idx === lines.length - 1;
                    const isCreditor = !!l.offset;
                    const acc = accounts.find((a) => a.code === l.accountCode);
                    return (
                      <TableRow key={l.id} hover>
                        <TableCell>
                          {isCreditor ? (
                            <Typography sx={{ fontWeight: 700, fontVariantNumeric: "tabular-nums", pl: 0.5 }}>{l.accountCode || "—"}</Typography>
                          ) : (
                            <AccountCodeCell
                              value={l.accountCode || ""}
                              accounts={lineAccounts}
                              disabled={disabled}
                              onCommit={(a) => commitLineAccount(l, a)}
                            />
                          )}
                        </TableCell>
                        <TableCell>
                          {isCreditor ? (
                            <Typography sx={{ fontWeight: 600 }}>{l.description || acc?.name?.toUpperCase() || (l.offset?.customerId ? "TRADE DEBTORS" : "TRADE CREDITORS")}</Typography>
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
                          {isCreditor ? (
                            <Stack direction="row" spacing={1} alignItems="center">
                              <Typography variant="body2">{l.remarks || `${partyCodeOf(l)} ${partyNameOf(l)}`.trim()}</Typography>
                              <Chip size="small" variant="outlined" label={`${l.offset?.allocations?.length || 0} ${l.offset?.customerId ? "credit note(s)" : "invoice(s)"}`} sx={{ height: 20 }} />
                            </Stack>
                          ) : (
                            <TextField size="small" fullWidth value={l.remarks || ""} disabled={disabled} onChange={(e) => patchLine(l.id, { remarks: e.target.value })} />
                          )}
                        </TableCell>
                        <TableCell sx={{ textAlign: "right" }} onKeyDown={isLast && !isCreditor ? onLastMoneyKeyDown : undefined}>
                          <MoneyInput
                            value={l.amount ?? ""}
                            disabled={disabled || isCreditor}
                            onCommit={(v) => patchLine(l.id, { amount: v })}
                            allowNegative
                            sx={{ width: 150 }}
                            title={isCreditor ? "Set in the offset dialog" : "Negative = a credit to this account"}
                          />
                        </TableCell>
                        <TableCell padding="checkbox">
                          {isCreditor ? (
                            <Tooltip title={l.offset?.customerId ? "Edit the customer refund" : "Edit the supplier offset"}>
                              <span>
                                <IconButton size="small" disabled={disabled} onClick={() => openOffsetFor(l.offset?.customerId ? "customer" : "supplier")} color="primary">
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
                  {/* Add line lives INSIDE the grid as its last row (guru
                      2026-11-16), so it reads as part of the table rather than
                      a control floating above it. */}
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
                sx={{
                  fontVariantNumeric: "tabular-nums",
                  fontWeight: 700,
                  fontSize: "1.05rem",
                  minWidth: 140,
                  textAlign: "right",
                  color: total < 0 ? "error.main" : "text.primary",
                }}
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
                The lines must add up to money leaving the bank.
              </Typography>
            )}
          </Box>
        </CardContent>
      </Card>

      <PvOffsetSupplierDialog
        open={offsetOpen}
        party={offsetParty}
        allowInvoices={false}
        customers={[]}
        onClose={() => {
          setOffsetOpen(false);
          // Keyed the control code but backed out: the row goes back to blank.
          if (pendingLineId) {
            patchLine(pendingLineId, { accountCode: "", accountName: "", description: "" });
            setPendingLineId(null);
          }
        }}
        voucherId={voucherId}
        voucherNumber={formData?.documentInfo?.documentNumber || formData?.name || ""}
        voucherDate={pd.date || ""}
        voucherCurrency={currency}
        creditorAccountCode={offsetParty === "customer" ? debtorCode : creditorCode}
        suppliers={suppliers}
        existing={creditor && ((offsetParty === "customer") === !!creditor.offset?.customerId) ? creditor : null}
        existingSupplier={offsetParty === "customer" ? (formData?.customer?.id ? formData.customer : null) : formData?.supplier?.id ? formData.supplier : null}
        onSave={(line, supplier) => {
          saveOffset(line, supplier);
          setOffsetOpen(false);
        }}
        onClear={() => {
          clearOffset();
          setOffsetOpen(false);
        }}
      />

      <ManualOffsetDialog
        open={manualOffsetOpen}
        onClose={() => setManualOffsetOpen(false)}
        party="supplier"
        customer={supplierId ? { id: supplierId, name: supplierName, supplierCode: creditor?.offset?.supplierCode || formData?.supplier?.supplierCode || "" } : null}
        onSaved={() => undefined}
      />

      {isContraOffsetEnabled && (
        <ContraOffsetDialog
          open={contraOpen}
          onClose={() => setContraOpen(false)}
          supplier={supplierId ? { id: supplierId, name: creditor?.offset?.supplierName || formData?.supplier?.name || "", supplierCode: creditor?.offset?.supplierCode || "" } : null}
          onSaved={() => undefined}
        />
      )}
    </Box>
  );
}
