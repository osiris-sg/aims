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

import React, { useEffect, useState } from "react";
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
import ManageSearchIcon from "@mui/icons-material/ManageSearch";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { headerInputSx } from "./DynamicFormFields";
import PvOffsetSupplierDialog, { type PvLine, type PvOffset } from "./PvOffsetSupplierDialog";
import { AccountSelectDialog, useOrAccounts, type OrAccount } from "./OfficialReceiptSection";
import type { TemplateFieldConfig } from "../types/templateFieldTypes";
import { todayIso } from "@/helpers/orgToday";
import EditorRail from "./EditorRail";

export type JvLine = {
  id: string;
  accountCode?: string | null;
  accountName?: string | null;
  description?: string | null;
  remarks?: string | null;
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

type RowProps = { formData: any; setFormData: (next: any) => void };
const setJvData = (formData: any, setFormData: (next: any) => void, patch: Record<string, any>) =>
  setFormData({ ...formData, jvData: { ...(formData.jvData || {}), ...patch } });

export const jvLines = (formData: any): JvLine[] => (Array.isArray(formData?.jvData?.lines) ? formData.jvData.lines : []);
export const jvTotals = (formData: any) => {
  const lines = jvLines(formData);
  return { debit: R(lines.reduce((s, l) => s + Math.max(0, num(l.debit)), 0)), credit: R(lines.reduce((s, l) => s + Math.max(0, num(l.credit)), 0)) };
};
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
export function JvVoucherNoInput({ formData, setFormData }: RowProps) {
  const raw = formData?.documentInfo?.documentNumber || formData?.name || "";
  const value = raw.startsWith("JV-PENDING") ? "" : raw;
  return (
    <TextField
      size="small"
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

export function JvPrepareByInput({ formData, setFormData }: RowProps) {
  const jd = formData?.jvData || {};
  return (
    <TextField
      size="small"
      value={jd.preparedBy || ""}
      onChange={(e) => setJvData(formData, setFormData, { preparedBy: e.target.value })}
      sx={{ ...headerInputSx, width: 260 }}
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
  return (
    <>
      <TextField
        size="small"
        value={input}
        placeholder="Code"
        disabled={disabled}
        onChange={(e) => {
          const v = e.target.value;
          setInput(v);
          const match = accounts.find((a) => String(a.code).toLowerCase() === v.trim().toLowerCase());
          if (match && match.code !== value) onCommit(match);
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
      <AccountSelectDialog open={open} onClose={() => setOpen(false)} accounts={accounts} onSelect={onCommit} />
    </>
  );
}

export function JournalVoucherLinesSection({
  formData,
  setFormData,
  voucherId,
  suppliers = [],
  disabled = false,
}: {
  formData: any;
  setFormData: (next: any) => void;
  voucherId?: string;
  suppliers?: any[];
  disabled?: boolean;
}) {
  const router = useRouter();
  const accounts = useOrAccounts();
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
    patchLine(l.id, { accountCode: a.code, accountName: a.name, description: l.description || a.name.toUpperCase() });
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
    <Box sx={{ mt: 0.5, mx: 0.5, flex: 1, minHeight: 0, display: "flex", gap: 1 }}>
      {/* Side rail — the legacy screen's left module buttons */}
      <EditorRail buttons={railButtons} />

      <Card data-tour="jv-lines" sx={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}>
        <CardContent sx={{ p: 1, flex: 1, minHeight: 0, display: "flex", flexDirection: "column", "&:last-child": { pb: 1 } }}>
          <Box sx={{ borderBottom: 1, borderColor: "divider" }}>
            <Tabs value={0} sx={{ minHeight: 32, "& .MuiTab-root": { minHeight: 32, py: 0 } }}>
              <Tab label="Journal Lines" />
            </Tabs>
          </Box>
          <Box sx={{ flex: 1, minHeight: 120, display: "flex", flexDirection: "column", pt: 1 }}>
            {disabled && (
              <Alert severity="warning" variant="outlined" sx={{ mb: 1, alignSelf: "flex-start" }}>
                Read-only — another session holds this voucher&apos;s edit lock.
              </Alert>
            )}
            <TableContainer component={Paper} variant="outlined" sx={{ flex: 1, minHeight: 0, borderRadius: 1.5 }}>
              <Table size="small" stickyHeader sx={(t) => ({ "& tbody td": { py: 0.5, borderBottom: `1px solid ${t.palette.mode === "dark" ? "rgba(255,255,255,0.32)" : "rgba(0,0,0,0.32)"}` } })}>
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ ...headCellSx, width: 170 }}>Account code</TableCell>
                    <TableCell sx={headCellSx}>Description</TableCell>
                    <TableCell sx={headCellSx}>Remarks</TableCell>
                    <TableCell sx={{ ...headCellSx, textAlign: "right", width: 150 }}>Debit</TableCell>
                    <TableCell sx={{ ...headCellSx, textAlign: "right", width: 150 }}>Credit</TableCell>
                    <TableCell sx={{ ...headCellSx, width: 44 }} />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {lines.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} sx={{ color: "text.secondary", py: 2 }}>
                        No lines yet. Add a line per account; keying the Trade Creditors code opens Offset Supplier Invoices, the Trade Debtors code opens Offset Customer Invoices.
                      </TableCell>
                    </TableRow>
                  )}
                  {lines.map((l) => {
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
                            <TextField size="small" fullWidth value={l.description || ""} placeholder={acc ? acc.name.toUpperCase() : "Description"} disabled={disabled} onChange={(e) => patchLine(l.id, { description: e.target.value })} />
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
                        <TableCell sx={{ textAlign: "right" }}>
                          <MoneyInput
                            value={l.debit ?? ""}
                            disabled={disabled || isCreditor}
                            onCommit={(v) => patchLine(l.id, { debit: v, ...(parseFloat(v) > 0 ? { credit: "" } : {}) })}
                            sx={{ width: 135 }}
                            title={isCreditor ? "Set in Offset Supplier Invoices" : undefined}
                          />
                        </TableCell>
                        <TableCell sx={{ textAlign: "right" }}>
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
                </TableBody>
              </Table>
            </TableContainer>

            <Stack direction="row" alignItems="center" sx={{ mt: 1, pr: 1 }} spacing={2}>
              <Button data-hotkey="addLine" size="small" startIcon={<AddIcon />} onClick={addLine} disabled={disabled}>
                Add line
              </Button>
              <Box sx={{ flex: 1 }} />
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

      {/* Legacy right-hand Remarks memo */}
      <Card sx={{ width: 260, flexShrink: 0, display: "flex", flexDirection: "column" }}>
        <CardContent sx={{ p: 1, flex: 1, display: "flex", flexDirection: "column", "&:last-child": { pb: 1 } }}>
          <Typography sx={{ fontWeight: 700, fontSize: "0.8125rem", mb: 0.5 }}>Remarks</Typography>
          <TextField
            multiline
            minRows={10}
            fullWidth
            value={jd.notes || ""}
            disabled={disabled}
            placeholder="What this voucher is for"
            onChange={(e) => setJvData(formData, setFormData, { notes: e.target.value })}
            sx={{ flex: 1, "& .MuiInputBase-root": { alignItems: "flex-start", height: "100%" } }}
          />
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
