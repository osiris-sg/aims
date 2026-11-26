"use client";

// Journal Voucher pieces for TabbedDocumentCreator — the legacy J/V screen
// (guru 2026-11-09: "change the way we do journal voucher, do it like our
// template like OR and PV"):
//
//   GENERAL   Voucher No. [JV-000038]     Date [09/11/2026]     Prepare By [admin]
//   ┌ Account code │ Description │ Remarks │ Debit │ Credit ┐      ┌ Remarks ┐
//   │ 404          │ BANK CHARGES│         │ 12.50 │        │      │ (memo)  │
//   │ 102          │ SCB         │         │       │  12.50 │      └─────────┘
//   └──────────────────────────────── 12.50 │  12.50 ┘
//
// Debits must equal credits. A line on the TRADE CREDITORS control opens the
// Payment Voucher's Offset Supplier Invoices dialog (same as the P/V): the
// Debit is allocated across the supplier's invoices. State rides in
// formData.jvData so the editor's dirty tracking, exit prompt and Save work
// unchanged. Saving posts / updates ONE manual journal whose number is the
// voucher number.

import React, { useEffect, useRef, useState } from "react";
import MoneyInput from "@/components/MoneyInput";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  IconButton,
  InputAdornment,
  MenuItem,
  Paper,
  Select,
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
import ManageSearchIcon from "@mui/icons-material/ManageSearch";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { headerInputSx } from "./DynamicFormFields";
import PvOffsetSupplierDialog, { type PvLine, type PvOffset } from "./PvOffsetSupplierDialog";
import { AccountSelectDialog, useOrAccounts, type OrAccount } from "./OfficialReceiptSection";
import { focusNextEmptyInRow } from "@/helpers/focusNextEmptyInRow";
import type { TemplateFieldConfig } from "../types/templateFieldTypes";
import { todayIso } from "@/helpers/orgToday";
import { useAuth } from "@clerk/nextjs";
import { request } from "@/helpers/request";
import EditorRail from "./EditorRail";
import { docRailSx } from "@/helpers/wctDocUi";

export type JvLine = {
  id: string;
  accountCode?: string | null;
  accountName?: string | null;
  description?: string | null;
  remarks?: string | null;
  // Tax Rate per line (GST-registered orgs only; Xero's manual journal). Amounts are tax
  // exclusive: the tax rides on the line's side and posts to the GST control account.
  taxCode?: string | null;
  taxRate?: number | null;
  debit: number | string;
  credit: number | string;
  offset?: PvOffset | null;
};

export const JV_FIELD_DEFINITIONS: TemplateFieldConfig = {
  tabs: [
    {
      tabId: "general",
      tabLabel: "GENERAL",
      fields: [
        { fieldName: "jvVoucherNo", displayLabel: "Voucher No.", fieldType: "text", required: false },
        { fieldName: "jvData.date", displayLabel: "Date", fieldType: "date", required: true },
        { fieldName: "jvPrepareRow", displayLabel: "Prepare By", fieldType: "text", required: false },
      ],
    },
  ],
};

const fmt = (n: number) => (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const R = (n: number) => Math.round(n * 100) / 100;
const num = (v: any) => parseFloat(String(v ?? "")) || 0;

type RowProps = { formData: any; setFormData: (next: any) => void; disabled?: boolean };
const setJvData = (formData: any, setFormData: (next: any) => void, patch: Record<string, any>) =>
  setFormData({ ...formData, jvData: { ...(formData.jvData || {}), ...patch } });

export const jvLines = (formData: any): JvLine[] => (Array.isArray(formData?.jvData?.lines) ? formData.jvData.lines : []);
/** A line's tax: net amount × its rate, on the line's side (offset lines never carry tax). */
export const jvTaxOf = (l: JvLine): number => {
  if (l.offset || !num(l.taxRate)) return 0;
  const amount = Math.max(0, num(l.debit)) || Math.max(0, num(l.credit));
  return R((amount * num(l.taxRate)) / 100);
};
/** debit / credit INCLUDE tax (what must balance, what the server stores); the parts are shown under the grid. */
export const jvTotals = (formData: any) => {
  const lines = jvLines(formData);
  const subDebit = R(lines.reduce((s, l) => s + Math.max(0, num(l.debit)), 0));
  const subCredit = R(lines.reduce((s, l) => s + Math.max(0, num(l.credit)), 0));
  const taxDebit = R(lines.reduce((s, l) => s + (num(l.debit) > 0 ? jvTaxOf(l) : 0), 0));
  const taxCredit = R(lines.reduce((s, l) => s + (num(l.credit) > 0 ? jvTaxOf(l) : 0), 0));
  return { subDebit, subCredit, taxDebit, taxCredit, debit: R(subDebit + taxDebit), credit: R(subCredit + taxCredit) };
};

export type JvTaxRate = { code: string; name: string; rate: number; direction: string; isActive?: boolean };
/**
 * The org's GST standing for the J/V (guru 2026-11-21: "only if a company has GST"): the Tax
 * column shows when Accounting Setup → Tax Settings has a GST registration number. Tax rates
 * come from Accounting Setup → Tax Rates (active ones).
 */
export function useJvTax(): { gstOrg: boolean; taxRates: JvTaxRate[] } {
  const { getToken } = useAuth();
  const [gstOrg, setGstOrg] = useState(false);
  const [taxRates, setTaxRates] = useState<JvTaxRate[]>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        const [settings, rates]: any[] = await Promise.all([
          request({ path: "/accounting/settings", method: "GET", quiet: true }, {}, token || undefined),
          request({ path: "/accounting/tax-rates", method: "GET", quiet: true }, {}, token || undefined),
        ]);
        const st = settings?.data ?? settings;
        const list: any[] = Array.isArray(rates?.data) ? rates.data : Array.isArray(rates) ? rates : [];
        if (cancelled) return;
        setGstOrg(!!String(st?.taxRegistrationNumber || "").trim());
        setTaxRates(list.filter((t) => t.isActive !== false).map((t) => ({ code: String(t.code), name: t.name, rate: Number(t.rate) || 0, direction: t.direction })));
      } catch {
        /* no accounting access: no tax column */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getToken]);
  return { gstOrg, taxRates };
}
export const jvCreditorLine = (formData: any): JvLine | undefined => jvLines(formData).find((l) => l.offset?.supplierId);
export const jvDebtorLine = (formData: any): JvLine | undefined => jvLines(formData).find((l) => l.offset?.customerId);

/** The editor's pre-save check — mirrors the server's rules. */
export function jvValidationError(formData: any): string | null {
  const lines = jvLines(formData).filter((l) => l.accountCode || num(l.debit) || num(l.credit) || l.offset);
  if (lines.length < 2) return "A journal voucher needs at least two lines: a debit and a credit";
  for (const [i, l] of lines.entries()) {
    if (!l.accountCode && !l.offset) return `Line ${i + 1}: pick an account code`;
    if (num(l.debit) > 0 && num(l.credit) > 0) return `Line ${i + 1}: enter either a Debit or a Credit, not both`;
    if (!num(l.debit) && !num(l.credit)) return `Line ${i + 1}: enter a Debit or a Credit`;
  }
  const { debit, credit } = jvTotals(formData);
  if (debit <= 0) return "The voucher has no amount";
  if (Math.abs(debit - credit) > 0.005) return `Debits ${fmt(debit)} and credits ${fmt(credit)} must match`;
  return null;
}

// Voucher No. — editable; a pending shell shows the placeholder.
export function JvVoucherNoInput({ formData, setFormData, disabled }: RowProps) {
  const raw = formData?.documentInfo?.documentNumber || formData?.name || "";
  const value = raw.startsWith("JV-PENDING") ? "" : raw;
  return (
    <TextField
      size="small"
      disabled={disabled}
      value={value}
      placeholder="Next JV number on save"
      onChange={(e) => {
        const v = e.target.value;
        setFormData({ ...formData, name: v, numberTouched: true, documentInfo: { ...(formData.documentInfo || {}), documentNumber: v } });
      }}
      sx={{ ...headerInputSx, width: 220 }}
      inputProps={{ style: { fontWeight: 600 } }}
    />
  );
}

export function JvPrepareByInput({ formData, setFormData, disabled }: RowProps) {
  const jd = formData?.jvData || {};
  return (
    <TextField
      size="small"
      disabled={disabled}
      value={jd.preparedBy || ""}
      onChange={(e) => setJvData(formData, setFormData, { preparedBy: e.target.value })}
      sx={{ ...headerInputSx, width: 260 }}
      // Last header field: Enter with an empty grid adds the first line and
      // lands in it (guru 2026-11-16). With lines present Enter walks on.
      onKeyDown={(e) => {
        if (e.key !== "Enter" || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return;
        if ((Array.isArray(jd.lines) ? jd.lines : []).length) return;
        e.preventDefault();
        e.stopPropagation();
        setJvData(formData, setFormData, { lines: [newLine()] });
      setTimeout(() => {
        const first = document.querySelector<HTMLInputElement>("[data-voucher-grid] tbody tr input:not([disabled])");
        first?.focus();
      }, 60);
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Body — the Dr/Cr grid + the Remarks memo, with the legacy rail.
// ---------------------------------------------------------------------------
const newLine = (): JvLine => ({ id: `l${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, accountCode: "", accountName: "", description: "", remarks: "", debit: "", credit: "" });

function AccountCodeCell({ value, accounts, disabled, onCommit }: { value: string; accounts: OrAccount[]; disabled?: boolean; onCommit: (acc: OrAccount) => void }) {
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
export function JvRemarksMemo({ formData, setFormData, disabled }: { formData: any; setFormData: (next: any) => void; disabled?: boolean }) {
  const pd = formData?.jvData || {};
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
          placeholder="What this voucher is for"
          onChange={(e) => setJvData(formData, setFormData, { notes: e.target.value })}
          sx={{ flex: 1, "& .MuiInputBase-root": { alignItems: "flex-start", height: "100%" } }}
        />
      </CardContent>
    </Card>
  );
}

export function JournalVoucherLinesSection({
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
  // Legacy chrome: put the rail in the editor's 204px left margin, like the
  // invoice (guru 2026-11-16).
  framed?: boolean;
}) {
  const router = useRouter();
  const accounts = useOrAccounts();
  const { gstOrg, taxRates } = useJvTax();
  const jd = formData?.jvData || {};
  const lines = jvLines(formData);
  const creditor = jvCreditorLine(formData);
  const debtor = jvDebtorLine(formData);
  const totals = jvTotals(formData);
  const diff = R(totals.debit - totals.credit);
  const lineAccounts = accounts.filter((a) => a.isActive !== false);

  const writeLines = (next: JvLine[]) => setJvData(formData, setFormData, { lines: next });
  const patchLine = (id: string, patch: Partial<JvLine>) => writeLines(lines.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const removeLine = (id: string) => writeLines(lines.filter((l) => l.id !== id));
  const addLine = () => writeLines([...lines, newLine()]);

  // Enter on EITHER money box of the LAST line adds the next line and lands in
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

  // Trade Creditors keyed on a line → Offset Supplier Invoices (same as P/V).
  const [offsetOpen, setOffsetOpen] = useState(false);
  const [offsetParty, setOffsetParty] = useState<"supplier" | "customer">("supplier");
  const [pendingLineId, setPendingLineId] = useState<string | null>(null);
  // The org's AP and AR control codes (Accounting Setup): Trade Creditors →
  // Offset Supplier Invoices, Trade Debtors → Offset Customer Invoices.
  const creditorCode = String(jd.creditorAccountCode || creditor?.accountCode || "");
  const debtorCode = String(jd.debtorAccountCode || debtor?.accountCode || "");
  const openOffsetFor = (party: "supplier" | "customer") => {
    setOffsetParty(party);
    setOffsetOpen(true);
  };
  const partyLine = offsetParty === "customer" ? debtor : creditor;
  const commitLineAccount = (l: JvLine, a: OrAccount) => {
    const party: "supplier" | "customer" | null = creditorCode && a.code === creditorCode ? "supplier" : debtorCode && a.code === debtorCode ? "customer" : null;
    if (party) {
      const existingParty = party === "customer" ? debtor : creditor;
      if (existingParty && existingParty.id !== l.id) {
        toast.info(`This voucher already has a ${party} line — editing it`);
        writeLines(lines.filter((x) => x.id !== l.id || x.accountCode));
        openOffsetFor(party);
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
  const saveOffset = (line: PvLine, who: any) => {
    const isCust = !!line.offset?.customerId;
    // Supplier line DEBITS creditors (settles what we owe). Customer line
    // CREDITS debtors when invoices are settled; when only credit notes were
    // ticked (net negative) it DEBITS instead.
    const net = (line.offset?.allocations || []).reduce((s, a) => s + (Number(a.amount) || 0), 0);
    const amt = Number(line.amount) || 0;
    const jv: JvLine = {
      id: line.id,
      accountCode: line.accountCode,
      accountName: line.accountName,
      description: line.description,
      remarks: line.remarks,
      debit: isCust ? (net < 0 ? amt : 0) : amt,
      credit: isCust ? (net >= 0 ? amt : 0) : 0,
      offset: line.offset,
    };
    const sameParty = (l: JvLine) => (isCust ? !!l.offset?.customerId : !!l.offset?.supplierId);
    const anchorIdx = lines.findIndex((l) => (pendingLineId && l.id === pendingLineId) || sameParty(l));
    const rest = lines.filter((l) => l.id !== jv.id && l.id !== pendingLineId && !sameParty(l));
    const next = [...rest];
    next.splice(anchorIdx >= 0 ? Math.min(anchorIdx, next.length) : next.length, 0, jv);
    setPendingLineId(null);
    setFormData({
      ...formData,
      ...(isCust
        ? { customer: who ? { id: who.id, name: who.name || "", customerCode: who.customerCode || "" } : formData.customer }
        : { supplier: who ? { id: who.id, name: who.name || "", supplierCode: who.supplierCode || "" } : formData.supplier }),
      jvData: { ...jd, lines: next },
    });
  };

  const headCellSx = { fontWeight: 700, fontSize: "0.75rem", color: "text.secondary", whiteSpace: "nowrap" as const };
  const back = () => encodeURIComponent(window.location.pathname + window.location.search);
  const railButtons = [
    {
      label: "Audit Trail",
      icon: <ManageSearchIcon />,
      onClick: () => {
        const today = todayIso();
        router.push(`/portal/accounting/ledger?tab=audit-trail&prefix=J/V&from=${today.slice(0, 7)}-01&to=${today}&back=${back()}`);
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

      <Card data-tour="jv-lines" sx={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}>
        <CardContent sx={{ p: 1, flex: 1, minHeight: 0, display: "flex", flexDirection: "column", "&:last-child": { pb: 1 } }}>
          <Box sx={{ borderBottom: 1, borderColor: "divider" }}>
            <Tabs value={0} sx={{ minHeight: 32, "& .MuiTab-root": { minHeight: 32, py: 0 } }}>
              <Tab label="Journal Lines" />
            </Tabs>
          </Box>
          <Box sx={{ flex: 1, minHeight: 120, display: "flex", flexDirection: "column", pt: 1 }}>
            {disabled && lockNote && (
              <Alert severity="warning" variant="outlined" sx={{ mb: 1, alignSelf: "flex-start" }}>
                Read-only — another session holds this voucher&apos;s edit lock.
              </Alert>
            )}
            <TableContainer data-voucher-grid component={Paper} variant="outlined" sx={{ flex: 1, minHeight: 0, borderRadius: 1.5 }}>
              <Table size="small" stickyHeader sx={(t) => ({ "& tbody td": { py: 0.5, borderBottom: `1px solid ${t.palette.mode === "dark" ? "rgba(255,255,255,0.32)" : "rgba(0,0,0,0.32)"}` } })}>
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ ...headCellSx, width: 170 }}>Account code</TableCell>
                    <TableCell sx={headCellSx}>Description</TableCell>
                    <TableCell sx={headCellSx}>Remarks</TableCell>
                    {gstOrg && <TableCell sx={{ ...headCellSx, width: 96 }}>Tax</TableCell>}
                    <TableCell sx={{ ...headCellSx, textAlign: "right", width: 150 }}>Debit</TableCell>
                    <TableCell sx={{ ...headCellSx, textAlign: "right", width: 150 }}>Credit</TableCell>
                    <TableCell sx={{ ...headCellSx, width: 44 }} />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {lines.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={gstOrg ? 7 : 6} sx={{ color: "text.secondary", py: 2 }}>
                        No lines yet. Add a line per account; keying the Trade Creditors code opens Offset Supplier Invoices, the Trade Debtors code opens Offset Customer Invoices.
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
                            <AccountCodeCell value={l.accountCode || ""} accounts={lineAccounts} disabled={disabled} onCommit={(a) => commitLineAccount(l, a)} />
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
                              <Typography variant="body2">{l.remarks || `${l.offset?.supplierCode || l.offset?.customerCode || ""} ${l.offset?.supplierName || l.offset?.customerName || ""}`.trim()}</Typography>
                              <Chip size="small" variant="outlined" label={`${l.offset?.allocations?.length || 0} document(s)`} sx={{ height: 20 }} />
                            </Stack>
                          ) : (
                            <TextField size="small" fullWidth value={l.remarks || ""} disabled={disabled} onChange={(e) => patchLine(l.id, { remarks: e.target.value })} />
                          )}
                        </TableCell>
                        {gstOrg && (
                          <TableCell>
                            {isCreditor ? (
                              <Typography variant="body2" sx={{ color: "text.secondary", pl: 0.5 }}>—</Typography>
                            ) : (
                              <Select
                                size="small"
                                fullWidth
                                displayEmpty
                                value={taxRates.some((t) => t.code === l.taxCode) ? String(l.taxCode) : ""}
                                disabled={disabled}
                                data-testid="jv-tax-rate"
                                onChange={(e) => {
                                  const t = taxRates.find((x) => x.code === e.target.value);
                                  patchLine(l.id, { taxCode: t ? t.code : null, taxRate: t ? t.rate : 0 });
                                }}
                                // Same look as the document header's tax-code box (guru 2026-11-21:
                                // "for the JV tax column follow this instead"): the box shows the CODE,
                                // the list reads "1 - Output Tax  9.00 %".
                                renderValue={(v) => (v ? String(v) : "—")}
                                sx={{ fontSize: "0.8125rem" }}
                              >
                                <MenuItem value="" sx={{ fontSize: "13px" }}>— No Tax</MenuItem>
                                {taxRates.map((t) => (
                                  <MenuItem key={t.code} value={t.code} sx={{ fontSize: "13px" }}>
                                    {t.code} - {t.name}{t.rate > 0 ? `  ${t.rate.toFixed(2)} %` : ""}
                                  </MenuItem>
                                ))}
                              </Select>
                            )}
                          </TableCell>
                        )}
                        <TableCell sx={{ textAlign: "right" }} onKeyDown={isLast && !isCreditor ? onLastMoneyKeyDown : undefined}>
                          <MoneyInput
                            value={l.debit ?? ""}
                            disabled={disabled || isCreditor}
                            onCommit={(v) => patchLine(l.id, { debit: v, ...(parseFloat(v) > 0 ? { credit: "" } : {}) })}
                            sx={{ width: 135 }}
                            title={isCreditor ? "Set in Offset Supplier Invoices" : undefined}
                          />
                        </TableCell>
                        <TableCell sx={{ textAlign: "right" }} onKeyDown={isLast && !isCreditor ? onLastMoneyKeyDown : undefined}>
                          <MoneyInput
                            value={l.credit ?? ""}
                            disabled={disabled || isCreditor}
                            onCommit={(v) => patchLine(l.id, { credit: v, ...(parseFloat(v) > 0 ? { debit: "" } : {}) })}
                            sx={{ width: 135 }}
                          />
                        </TableCell>
                        <TableCell padding="checkbox">
                          {isCreditor ? (
                            <Tooltip title={l.offset?.customerId ? "Edit the customer offset" : "Edit the supplier offset"}>
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
                    <TableCell colSpan={gstOrg ? 7 : 6} sx={{ py: 0.75, borderBottom: "none !important" }}>
                      <Button data-hotkey="addLine" variant="contained" size="small" startIcon={<AddIcon />} onClick={addLine} disabled={disabled}>
                        Add line
                      </Button>
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </TableContainer>

            {/* GST orgs: Subtotal and Total tax above the TOTAL, as on Xero's manual journal. */}
            {gstOrg && lines.length > 0 && (
              <Stack sx={{ mt: 1, pr: 1 }} spacing={0.25} data-testid="jv-tax-totals">
                {[
                  ["Subtotal", totals.subDebit, totals.subCredit],
                  ["Total tax", totals.taxDebit, totals.taxCredit],
                ].map(([label, dr, cr]) => (
                  <Stack key={String(label)} direction="row" alignItems="center" spacing={2}>
                    <Box sx={{ flex: 1 }} />
                    <Typography variant="body2" sx={{ color: "text.secondary", minWidth: 90, textAlign: "right" }}>{label}</Typography>
                    <Typography sx={{ fontVariantNumeric: "tabular-nums", fontSize: "0.875rem", minWidth: 135, textAlign: "right" }}>{fmt(Number(dr))}</Typography>
                    <Typography sx={{ fontVariantNumeric: "tabular-nums", fontSize: "0.875rem", minWidth: 135, textAlign: "right", mr: 5.5 }}>{fmt(Number(cr))}</Typography>
                  </Stack>
                ))}
              </Stack>
            )}
            <Stack direction="row" alignItems="center" sx={{ mt: 1, pr: 1 }} spacing={2}>
              <Box sx={{ flex: 1 }} />
              {gstOrg && lines.length > 0 && <Typography variant="body2" sx={{ fontWeight: 700, minWidth: 90, textAlign: "right" }}>TOTAL</Typography>}
              {lines.length > 0 && (
                <Chip
                  size="small"
                  color={Math.abs(diff) <= 0.005 ? "success" : "error"}
                  variant="outlined"
                  label={Math.abs(diff) <= 0.005 ? "Balanced" : `Out of balance ${fmt(diff)}`}
                  sx={{ height: 22 }}
                />
              )}
              <Typography sx={{ fontVariantNumeric: "tabular-nums", fontWeight: 700, fontSize: "1.05rem", minWidth: 135, textAlign: "right", color: "error.main" }}>{fmt(totals.debit)}</Typography>
              <Typography sx={{ fontVariantNumeric: "tabular-nums", fontWeight: 700, fontSize: "1.05rem", minWidth: 135, textAlign: "right", color: "error.main", mr: 5.5 }}>{fmt(totals.credit)}</Typography>
            </Stack>
          </Box>
        </CardContent>
      </Card>

      <PvOffsetSupplierDialog
        open={offsetOpen}
        party={offsetParty}
        allowInvoices
        customers={[]}
        onClose={() => {
          setOffsetOpen(false);
          if (pendingLineId) {
            patchLine(pendingLineId, { accountCode: "", accountName: "", description: "" });
            setPendingLineId(null);
          }
        }}
        voucherId={voucherId}
        voucherNumber={formData?.documentInfo?.documentNumber || formData?.name || ""}
        voucherDate={jd.date || ""}
        voucherCurrency="SGD"
        creditorAccountCode={offsetParty === "customer" ? debtorCode : creditorCode}
        suppliers={suppliers}
        existing={partyLine ? ({ ...partyLine, amount: num(partyLine.debit) || num(partyLine.credit) } as unknown as PvLine) : null}
        existingSupplier={offsetParty === "customer" ? (formData?.customer?.id ? formData.customer : null) : formData?.supplier?.id ? formData.supplier : null}
        onSave={(line, who) => {
          saveOffset(line, who);
          setOffsetOpen(false);
        }}
        onClear={() => {
          writeLines(lines.filter((l) => (offsetParty === "customer" ? !l.offset?.customerId : !l.offset?.supplierId)));
          setOffsetOpen(false);
        }}
      />
    </Box>
  );
}
