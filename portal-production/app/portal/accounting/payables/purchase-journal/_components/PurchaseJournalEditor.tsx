"use client";

// Purchase Journal — legacy Dr/Cr journal editor (guru 2026-11-16, Chong Aik).
// The AP "Purchase Journal" SIN/SPR entry opens THIS full-page journal screen
// (the old A's Accounting Software "Purchase Journal") instead of the bill form
// dialog, gated by enablePurchaseJournalGrid. The entry is still a supplier
// BILL underneath (POST/PATCH /bills), so AP reports, ageing and Payment
// Vouchers are unchanged — only the editing surface is the Dr/Cr grid.
//
// Lines: the user keys the DEBIT side (purchase/expense accounts + a GST line);
// the CREDIT side is ONE auto Trade-Creditor Control line for the supplier =
// the total, so Debit always equals Credit (guru: "expense debits + auto Trade
// Creditor credit"). Chrome mirrors the PV/JV legacy screens: 204px framed
// body, rail in the left margin, coloured toolbar, Remarks memo.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Autocomplete, Box, Button, Card, CardContent, CircularProgress, Dialog, DialogActions,
  DialogContent, DialogTitle, IconButton, MenuItem, Paper, Select, Stack, Table, TableBody,
  TableCell, TableContainer, TableHead, TableRow, TextField, Tooltip, Typography,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import NavigateBeforeIcon from "@mui/icons-material/NavigateBefore";
import NavigateNextIcon from "@mui/icons-material/NavigateNext";
import PrintIcon from "@mui/icons-material/Print";
import SearchIcon from "@mui/icons-material/Search";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import HistoryIcon from "@mui/icons-material/History";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { useAccountingApi } from "../../../_lib/api";
import { sortAccountsByType, accountTypeLabel } from "@/components/glAccountGrouping";
import EditorRail from "@/containers/DocumentTemplates/components/EditorRail";
import { todayIso } from "@/helpers/orgToday";

type Kind = "SIN" | "SPR";
type Account = { id: string; code: string; name: string; category?: string; accountType?: string; isActive?: boolean };
type Supplier = { id: string; name: string; code?: string | null };
type DebitLine = { uid: string; accountId: string | null; accountCode?: string | null; accountName?: string | null; description: string; remarks: string; amount: string };

const uid = () => `pj${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const newLine = (): DebitLine => ({ uid: uid(), accountId: null, description: "", remarks: "", amount: "" });
const n = (v: any) => { const x = parseFloat(String(v ?? "")); return Number.isFinite(x) ? x : 0; };
const fmt = (v: number) => v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Coloured toolbar buttons — the legacy screen's Add/Delete/…/Confirm/Exit.
// Theme-aware so both modes stay legible (mirrors TabbedDocumentCreator LEGACY_BTN).
const btn = (light: string, dark: string, darkText: string) => (theme: any) => {
  const d = theme.palette.mode === "dark";
  return { bgcolor: d ? dark : light, color: d ? darkText : "#fff", "&:hover": { bgcolor: d ? dark : light, filter: "brightness(0.92)" }, "&.Mui-disabled": { opacity: 0.45 } };
};
const BTN = {
  add: btn("#15803D", "#8AD79E", "#0C2F17"),
  del: btn("#DC2626", "#F4A6A6", "#3B0A0A"),
  nav: btn("#475569", "#B6C2D4", "#111827"),
  print: btn("#4F46E5", "#B4B0F5", "#1A1650"),
  locate: btn("#0F766E", "#8FD8D0", "#082F2B"),
  confirm: btn("#15803D", "#8AD79E", "#0C2F17"),
};

// Match the PV / JV line grid exactly (JournalVoucherSection).
const headCellSx = { fontWeight: 700, fontSize: "0.75rem", color: "text.secondary", whiteSpace: "nowrap" as const };
const lineTableSx = (t: any) => ({ "& tbody td": { py: 0.5, borderBottom: `1px solid ${t.palette.mode === "dark" ? "rgba(255,255,255,0.32)" : "rgba(0,0,0,0.32)"}` } });
// Match the PV / OR header grid: a bordered label | field table.
const hdrLabelSx = { width: 150, fontWeight: 600, bgcolor: (t: any) => t.palette.action.hover, borderRight: (t: any) => `1px solid ${t.palette.divider}`, py: 0.75 };
const hdrCellSx = { py: 0.5 };

export default function PurchaseJournalEditor({ billId, initialKind }: { billId: string; initialKind?: Kind }) {
  const router = useRouter();
  const { request } = useAccountingApi();
  // "new" = blank entry; "latest" = open the newest entry (or blank if none) —
  // the AP Purchase Journal lands here, the list is bypassed (like OR / PV with
  // the list view off). Both start without a loaded bill.
  const isNew = billId === "new" || billId === "latest";
  const listPath = "/portal/accounting/payables/purchase-journal";
  const gotoEntry = (id: string) => router.push(`${listPath}/entry/${id}`);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(isNew ? null : billId);
  const [status, setStatus] = useState<string>("DRAFT");
  const [dirty, setDirty] = useState(false);

  const [kind, setKind] = useState<Kind>(initialKind === "SPR" ? "SPR" : "SIN");
  const [supplierId, setSupplierId] = useState<string | null>(null);
  const [voucherNo, setVoucherNo] = useState("");
  const [date, setDate] = useState(todayIso());
  const [prepareBy, setPrepareBy] = useState("");
  const [notes, setNotes] = useState("");
  // One LUMP-SUM purchases debit (guru 2026-11-16: don't itemise the lines).
  // The Dr/Cr grid IS the expense input (the single "purchase amount" field it
  // replaced is gone): one debit line per account, with the GST line and the
  // Trade Creditor credit line drawn under it from the totals.
  const [lines, setLines] = useState<DebitLine[]>([newLine()]);
  const [currency, setCurrency] = useState("SGD");
  const [gstAmount, setGstAmount] = useState("0");

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  // Ordered newest→oldest ids of the org's purchase-journal entries, for the
  // Previous / Next pager and "latest" resolution.
  const [siblingIds, setSiblingIds] = useState<string[]>([]);

  const markDirty = useCallback(() => setDirty(true), []);
  const addLine = useCallback(() => { setLines((ls) => [...ls, newLine()]); markDirty(); }, [markDirty]);
  const setLine = useCallback((uid: string, patch: Partial<DebitLine>) => {
    setLines((ls) => ls.map((l) => (l.uid === uid ? { ...l, ...patch } : l)));
    markDirty();
  }, [markDirty]);
  // Never leave the grid with no rows — an empty grid has nothing to type into.
  const removeLine = useCallback((uid: string) => {
    setLines((ls) => (ls.length > 1 ? ls.filter((l) => l.uid !== uid) : [newLine()]));
    markDirty();
  }, [markDirty]);

  // Load chart + suppliers; and the bill when editing.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [accRes, supRes, billRes] = await Promise.all([
          request<Account[]>("/accounting/accounts").catch(() => [] as Account[]),
          request<any>("/suppliers", { method: "POST", body: JSON.stringify({ page: 1, limit: 1000 }) }).catch(() => ({ data: [] })),
          request<any>("/bills?includeSupplierCredits=true").catch(() => []),
        ]);
        if (cancelled) return;
        setAccounts((Array.isArray(accRes) ? accRes : []).filter((a) => a.isActive !== false));
        const sup: Supplier[] = Array.isArray(supRes) ? supRes : supRes?.docs || supRes?.data || [];
        setSuppliers(sup);
        // Purchase-journal entries only (SIN/SPR bills, not CN/DN notes), newest first.
        const billRows = (Array.isArray(billRes) ? billRes : billRes?.data || []) as any[];
        const ids = billRows
          .filter((b) => !b.documentType || ["BILL", "SIN", "SPR"].includes(String(b.kind || b.documentType)))
          .filter((b) => b.status !== "VOID" && (b.config?.billStatus ?? b.billStatus) !== "VOID")
          .map((b) => b.id);
        setSiblingIds(ids);
        // "latest" → jump to the newest entry (or stay blank when there are none).
        if (billId === "latest") {
          if (ids.length) { router.replace(`${listPath}/entry/${ids[0]}`); return; }
          setLoading(false);
          return;
        }
        if (!isNew) {
          const b: any = await request<any>(`/bills/${billId}`);
          if (cancelled) return;
          setKind((b.kind === "SPR" ? "SPR" : "SIN") as Kind);
          setSupplierId(b.supplierId ?? b.supplier?.id ?? null);
          setVoucherNo(b.billNumber || "");
          setDate((b.billDate || "").slice(0, 10) || todayIso());
          setStatus(String((b.config?.billStatus ?? b.billStatus ?? b.status) || "DRAFT").toUpperCase());
          setNotes(b.description || "");
          setGstAmount(String(b.taxAmount || 0));
          setCurrency(String(b.currency || "SGD").toUpperCase());
          // Seed the grid from the bill's own lines; a bill saved before this
          // screen (or by the AI intake) has one lump-sum line and loads as one row.
          const saved = (Array.isArray(b.lines) ? b.lines : Array.isArray(b.config?.lines) ? b.config.lines : []) as any[];
          setLines(
            saved.length
              ? saved.map((l: any) => ({
                  uid: uid(),
                  accountId: l.accountId ?? null,
                  accountCode: l.accountCode ?? null,
                  accountName: l.accountName ?? null,
                  description: String(l.description ?? ""),
                  remarks: String(l.remarks ?? ""),
                  amount: n(l.amount) ? String(n(l.amount)) : "",
                }))
              : [newLine()],
          );
          setDirty(false);
        }
      } catch (e: any) {
        toast.error(e?.message || "Failed to load the purchase journal");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [billId]);

  // Best-effort display accounts for the two auto rows (GST + Trade Creditor).
  // The bill API posts to the org's real control accounts; these are the codes
  // shown in the grid so it reads like the legacy screen.
  const gstAccount = useMemo(
    () => accounts.find((a) => /input.*tax|gst|^tax$/i.test(a.name)) || null,
    [accounts],
  );
  const apControl = useMemo(
    () =>
      accounts.find((a) => /trade\s*creditor\s*control|trade\s*payables?|accounts?\s*payable/i.test(a.name)) ||
      accounts.find((a) => /^cl0*1\b/i.test(a.code)) ||
      null,
    [accounts],
  );
  const supplier = useMemo(() => suppliers.find((s) => s.id === supplierId) || null, [suppliers, supplierId]);

  const gst = n(gstAmount);
  const isForeign = String(currency || "SGD").toUpperCase() !== "SGD";
  // Auto-assign the Purchases account: non-SGD → Imports (foreign); SGD → local
  // Purchases (taxable when there's GST, else non-taxable) (guru 2026-11-16).
  const purchaseAccount = useMemo(() => {
    const pur = (re: RegExp, ex?: RegExp) => accounts.find((a) => /purchas/i.test(a.name) && re.test(a.name) && (!ex || !ex.test(a.name)));
    const imports = pur(/import/i);
    const taxable = pur(/taxable/i, /non/i);
    const nonTaxable = pur(/non.?taxable/i);
    const anyPur = accounts.find((a) => /purchas/i.test(a.name));
    if (isForeign) return imports || taxable || anyPur || null;
    return (gst > 0 ? taxable : nonTaxable) || taxable || nonTaxable || anyPur || null;
  }, [accounts, isForeign, gst]);

  const expenseTotal = lines.reduce((t, l) => t + n(l.amount), 0);
  const debitTotal = expenseTotal + gst;
  const creditTotal = debitTotal; // auto Trade-Creditor line balances it

  const validate = (): string | null => {
    if (!supplierId) return "Pick a supplier (the Trade Creditor the journal credits)";
    if (!voucherNo.trim()) return "Enter the Voucher No.";
    if (expenseTotal <= 0) return "Enter at least one line with an amount";
    if (lines.some((l) => n(l.amount) !== 0 && !l.accountId)) return "Pick an account code on every line that has an amount";
    return null;
  };
  const blockReason = useMemo(() => validate(), [supplierId, voucherNo, lines]); // eslint-disable-line react-hooks/exhaustive-deps

  const buildBody = () => {
    // The GST is keyed directly (legacy screen). Send a gstPercent consistent
    // with that amount so the server lands on the same tax whether it trusts
    // taxAmount or recomputes from the rate.
    const pct = gst > 0 && expenseTotal > 0 ? Math.round((gst / expenseTotal) * 10000) / 100 : 0;
    return {
      supplierId,
      billNumber: voucherNo.trim(),
      billDate: date,
      kind,
      description: notes || undefined,
      taxAmount: gst,
      taxManual: true,
      amountsAre: gst > 0 ? "EXCLUSIVE" : "NO_TAX",
      taxCode: "4",
      gstPercent: pct,
      currency: currency || "SGD",
      // One bill line per grid row (blank rows dropped). `remarks` rides along
      // on the stored line; the GL posting reads accountId + amount.
      lines: lines
        .filter((l) => n(l.amount) !== 0)
        .map((l) => ({
          description: l.description || (isForeign ? "Purchases — Import" : "Purchases"),
          remarks: l.remarks || undefined,
          quantity: 1,
          unitPrice: n(l.amount),
          amount: n(l.amount),
          accountId: l.accountId ?? purchaseAccount?.id ?? null,
        })),
      inboundChannel: "MANUAL",
    };
  };

  // Save the DRAFT bill (POST new / PATCH existing). Returns the id, or null.
  const saveDraft = async (silent = false): Promise<string | null> => {
    const err = validate();
    if (err) { if (!silent) toast.error(err); return null; }
    setSaving(true);
    try {
      const body = buildBody();
      let id = savedId;
      if (id) {
        await request(`/bills/${id}`, { method: "PATCH", body: JSON.stringify(body) });
      } else {
        const created: any = await request("/bills", { method: "POST", body: JSON.stringify(body) });
        id = created?.id || null;
        setSavedId(id);
      }
      setDirty(false);
      if (!silent) toast.success("Purchase journal saved");
      return id;
    } catch (e: any) {
      if (!silent) toast.error(e?.message || "Save failed");
      return null;
    } finally {
      setSaving(false);
    }
  };

  const confirm = async () => {
    const id = await saveDraft(true);
    if (!id) { const err = validate(); toast.error(err || "Save failed"); return; }
    setSaving(true);
    try {
      await request(`/bills/${id}/submit`, { method: "POST" });
      toast.success(`${kind === "SPR" ? "Purchase return" : "Purchase journal"} confirmed and posted`);
      // Stay in the journal editor on the just-posted entry (no list).
      router.push(`${listPath}/entry/${id}`);
    } catch (e: any) {
      toast.error(e?.message || "Saved, but confirm failed");
    } finally {
      setSaving(false);
    }
  };

  const [exitPromptOpen, setExitPromptOpen] = useState(false);
  // Back goes up to the AP home (the list is bypassed for this org); Locate is
  // the explicit way into the list.
  const leave = () => router.push("/portal/accounting/payables");
  const onExit = () => { if (dirty && !validate()) setExitPromptOpen(true); else leave(); };

  const [delOpen, setDelOpen] = useState(false);
  const doDelete = async () => {
    if (!savedId) { leave(); return; }
    try { await request(`/bills/${savedId}`, { method: "DELETE" }); toast.success("Purchase journal voided"); leave(); }
    catch (e: any) { toast.error(e?.message || "Delete failed"); }
  };

  const addNew = () => {
    if (dirty && !validate()) { setExitPromptOpen(true); return; }
    router.push(`/portal/accounting/payables/purchase-journal/entry/new?kind=${kind}`);
  };

  // Previous / Next page through the org's entries (newest first), like OR/PV.
  const sibIdx = savedId ? siblingIds.indexOf(savedId) : -1;
  const hasPrev = sibIdx >= 0 && sibIdx < siblingIds.length - 1;
  const hasNext = sibIdx > 0;
  const goSibling = (i: number) => {
    const id = siblingIds[i];
    if (!id) return;
    if (dirty && !validate()) { setExitPromptOpen(true); return; }
    gotoEntry(id);
  };

  // Editable only while still a draft / unconfirmed; a posted, awaiting-payment
  // or paid entry opens read-only (like the legacy confirmed voucher).
  const confirmed = !["DRAFT", "UNCONFIRMED", ""].includes(status);
  const railButtons = [
    { label: "Audit Trail", icon: <HistoryIcon />, onClick: () => router.push(`/portal/accounting/payables?tab=audit-trail&prefix=SIN`) },
  ];

  if (loading) {
    return <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: 400 }}><CircularProgress /></Box>;
  }

  const accountValue = (l: DebitLine): Account | null =>
    accounts.find((a) => a.id === l.accountId) ||
    (l.accountCode ? accounts.find((a) => a.code === l.accountCode) || null : null) ||
    (l.accountId ? ({ id: l.accountId, code: l.accountCode || "", name: l.accountName || "" } as Account) : null);

  return (
    <Box sx={{ display: "flex", flexDirection: "column", minHeight: "100%", bgcolor: "background.default" }}>
      {/* ---- Coloured legacy toolbar (framed) ---- */}
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, py: 1, px: { xs: 1, md: "204px" }, borderBottom: 1, borderColor: "divider", position: "sticky", top: 0, zIndex: 3, bgcolor: "background.paper", flexWrap: { xs: "wrap", md: "nowrap" } }}>
        <IconButton size="small" onClick={onExit}><ArrowBackIcon /></IconButton>
        <Typography variant="h6" fontWeight={600} noWrap sx={{ minWidth: 0, flexShrink: 1 }}>{voucherNo || (isNew ? "New Purchase Journal" : "Purchase Journal")}</Typography>
        <Box sx={{ flex: 1 }} />
        <Stack direction="row" gap={0.5} alignItems="center" sx={{ flexWrap: { xs: "wrap", md: "nowrap" }, justifyContent: "flex-end" }}>
          <Button size="small" variant="contained" startIcon={<AddIcon />} onClick={addNew} sx={BTN.add}>Add</Button>
          <Button size="small" variant="contained" startIcon={<DeleteIcon />} onClick={() => setDelOpen(true)} disabled={!savedId} sx={BTN.del}>Delete</Button>
          <Button size="small" variant="contained" startIcon={<NavigateBeforeIcon />} onClick={() => goSibling(sibIdx + 1)} disabled={!hasPrev} sx={BTN.nav}>Previous</Button>
          <Button size="small" variant="contained" endIcon={<NavigateNextIcon />} onClick={() => goSibling(sibIdx - 1)} disabled={!hasNext} sx={BTN.nav}>Next</Button>
          <Button size="small" variant="contained" startIcon={<PrintIcon />} onClick={() => window.print()} sx={BTN.print}>Print</Button>
          <Button size="small" variant="contained" startIcon={<SearchIcon />} onClick={() => router.push(listPath)} sx={BTN.locate}>Locate</Button>
          {!confirmed && (
            <Button size="small" variant="contained" startIcon={saving ? <CircularProgress size={14} color="inherit" /> : <CheckCircleIcon />} onClick={confirm} disabled={saving || !!blockReason} sx={BTN.confirm}>Confirm</Button>
          )}
          {confirmed ? (
            <Typography variant="body2" sx={{ color: "text.secondary", fontWeight: 600 }}>{status === "PAID" ? "Paid" : "Confirmed"}</Typography>
          ) : blockReason ? (
            <Tooltip title={blockReason} arrow><Box component="span" sx={{ color: "warning.main", fontWeight: 600, fontSize: "0.8rem", maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", cursor: "help" }}>Can&apos;t save — {blockReason}</Box></Tooltip>
          ) : dirty ? (
            <Typography variant="body2" sx={{ color: "warning.main", fontWeight: 600 }}>Unsaved</Typography>
          ) : savedId ? (
            <Stack direction="row" gap={0.5} alignItems="center" sx={{ color: "text.secondary" }}><CheckCircleIcon fontSize="small" color="success" /><Typography variant="body2">Saved</Typography></Stack>
          ) : null}
        </Stack>
      </Box>

      {/* ---- Framed body ---- */}
      <Box sx={{ position: "relative", flex: 1, px: { xs: 1, md: "204px" }, py: 2, display: "flex", flexDirection: "column", gap: 1.5 }}>
        {/* Rail in the left margin, like PV/JV */}
        <Box sx={{ position: { xs: "static", md: "absolute" }, left: 16, top: 16, mb: { xs: 1, md: 0 } }}>
          <EditorRail buttons={railButtons} />
        </Box>

        {/* Header grid — bordered label | field rows, like the PV / OR General grid */}
        <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 1.5 }}>
          <Table size="small">
            <TableBody>
              <TableRow>
                <TableCell sx={hdrLabelSx}>Batch Type</TableCell>
                <TableCell sx={hdrCellSx}>
                  <Select size="small" value={kind} onChange={(e) => { setKind(e.target.value as Kind); markDirty(); }} disabled={confirmed} sx={{ minWidth: 260 }}>
                    <MenuItem value="SIN">SIN — Purchase Order</MenuItem>
                    <MenuItem value="SPR">SPR — Purchase Returned</MenuItem>
                  </Select>
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell sx={hdrLabelSx}>Voucher No.</TableCell>
                <TableCell sx={hdrCellSx}><TextField size="small" value={voucherNo} onChange={(e) => { setVoucherNo(e.target.value); markDirty(); }} disabled={confirmed} sx={{ minWidth: 260 }} placeholder="Invoice / voucher no." /></TableCell>
              </TableRow>
              <TableRow>
                <TableCell sx={hdrLabelSx}>Date</TableCell>
                <TableCell sx={hdrCellSx}><TextField size="small" type="date" value={date} onChange={(e) => { setDate(e.target.value); markDirty(); }} disabled={confirmed} sx={{ minWidth: 200 }} InputLabelProps={{ shrink: true }} /></TableCell>
              </TableRow>
              <TableRow>
                <TableCell sx={hdrLabelSx}>Supplier</TableCell>
                <TableCell sx={hdrCellSx}>
                  <Autocomplete
                    size="small" sx={{ minWidth: 320 }} disabled={confirmed}
                    options={suppliers} getOptionLabel={(s) => (s.code ? `${s.code} — ${s.name}` : s.name)}
                    isOptionEqualToValue={(a, b) => a.id === b.id}
                    value={supplier}
                    onChange={(_, v) => { setSupplierId(v?.id || null); markDirty(); }}
                    renderInput={(p) => <TextField {...p} placeholder="Who is billed (Trade Creditor)" />}
                  />
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell sx={{ ...hdrLabelSx, borderBottom: "none" }}>Prepare By</TableCell>
                <TableCell sx={{ ...hdrCellSx, borderBottom: "none" }}><TextField size="small" value={prepareBy} onChange={(e) => setPrepareBy(e.target.value)} disabled sx={{ minWidth: 260 }} placeholder="(current user)" /></TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </TableContainer>

        {/* Dr/Cr grid + Remarks memo */}
        <Box sx={{ display: "flex", gap: 1.5, alignItems: "stretch", flexDirection: { xs: "column", md: "row" } }}>
          <Card variant="outlined" sx={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
            <CardContent sx={{ p: 1, flex: 1, display: "flex", flexDirection: "column", "&:last-child": { pb: 1 } }}>
              {!confirmed && (
                <Stack direction="row" sx={{ mb: 1 }}>
                  <Button size="small" variant="contained" startIcon={<AddIcon />} onClick={addLine}>Add line</Button>
                </Stack>
              )}
              <TableContainer component={Paper} variant="outlined" sx={{ flex: 1, minHeight: 0, borderRadius: 1.5 }}>
                <Table size="small" stickyHeader sx={lineTableSx}>
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
                    {/* Purchase / expense DEBIT lines */}
                    {lines.map((l) => (
                      <TableRow key={l.uid} hover>
                        <TableCell sx={{ py: 0.25 }}>
                          <Autocomplete
                            size="small" fullWidth disabled={confirmed}
                            options={sortAccountsByType(accounts as any) as any}
                            groupBy={(o: any) => accountTypeLabel(o.accountType)}
                            getOptionLabel={(o: any) => (o.code ? `${o.code} — ${o.name}` : o.name || "")}
                            isOptionEqualToValue={(a: any, b: any) => a.id === b.id}
                            value={accountValue(l) as any}
                            onChange={(_, v: any) => setLine(l.uid, { accountId: v?.id || null, accountCode: v?.code || null, accountName: v?.name || null })}
                            renderInput={(p) => <TextField {...p} variant="standard" placeholder="Code" />}
                          />
                        </TableCell>
                        <TableCell sx={{ py: 0.25 }}><TextField variant="standard" fullWidth size="small" value={l.description} disabled={confirmed} onChange={(e) => setLine(l.uid, { description: e.target.value })} /></TableCell>
                        <TableCell sx={{ py: 0.25 }}><TextField variant="standard" fullWidth size="small" value={l.remarks} disabled={confirmed} onChange={(e) => setLine(l.uid, { remarks: e.target.value })} /></TableCell>
                        <TableCell sx={{ py: 0.25 }}><TextField variant="standard" size="small" value={l.amount} disabled={confirmed} onChange={(e) => setLine(l.uid, { amount: e.target.value })} inputProps={{ inputMode: "decimal", style: { textAlign: "right" } }} /></TableCell>
                        <TableCell />
                        <TableCell sx={{ py: 0.25 }}>{!confirmed && <IconButton size="small" onClick={() => removeLine(l.uid)}><DeleteOutlineIcon fontSize="small" /></IconButton>}</TableCell>
                      </TableRow>
                    ))}
                    {/* GST DEBIT line */}
                    <TableRow>
                      <TableCell sx={{ color: "text.secondary" }}>{gstAccount ? `${gstAccount.code} — ${gstAccount.name}` : "GST / Input Tax"}</TableCell>
                      <TableCell colSpan={2} sx={{ color: "text.secondary" }}>GST input tax</TableCell>
                      <TableCell sx={{ py: 0.25 }}><TextField variant="standard" size="small" value={gstAmount} disabled={confirmed} onChange={(e) => { setGstAmount(e.target.value); markDirty(); }} inputProps={{ inputMode: "decimal", style: { textAlign: "right" } }} /></TableCell>
                      <TableCell /><TableCell />
                    </TableRow>
                    {/* Auto Trade Creditor CREDIT line */}
                    <TableRow sx={{ "& td": { bgcolor: (t) => t.palette.action.hover } }}>
                      <TableCell sx={{ fontWeight: 600 }}>{apControl ? `${apControl.code} — ${apControl.name}` : "Trade Creditor Control"}</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>{kind === "SPR" ? "Purchase return — supplier" : "Supplier payable"}</TableCell>
                      <TableCell sx={{ color: "text.secondary" }}>{supplier?.name || "—"}</TableCell>
                      <TableCell />
                      <TableCell sx={{ textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{fmt(creditTotal)}</TableCell>
                      <TableCell />
                    </TableRow>
                  </TableBody>
                </Table>
              </TableContainer>
              {/* Totals */}
              <Stack direction="row" alignItems="center" sx={{ mt: 1, pr: 1 }} gap={2}>
                <Box sx={{ flex: 1 }} />
                <Typography sx={{ fontWeight: 700 }}>Total</Typography>
                <Typography sx={{ minWidth: 130, textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{fmt(debitTotal)}</Typography>
                <Typography sx={{ minWidth: 130, textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{fmt(creditTotal)}</Typography>
                <Box sx={{ width: 40 }} />
              </Stack>
            </CardContent>
          </Card>

          {/* Remarks memo */}
          <Card variant="outlined" sx={{ width: { xs: "100%", md: 280 }, flexShrink: 0, display: "flex", flexDirection: "column" }}>
            <CardContent sx={{ p: 1, flex: 1, display: "flex", flexDirection: "column", "&:last-child": { pb: 1 } }}>
              <Typography sx={{ fontWeight: 700, fontSize: "0.8125rem", mb: 0.5 }}>Remarks</Typography>
              <TextField multiline minRows={10} fullWidth value={notes} disabled={confirmed} placeholder="What this purchase is for" onChange={(e) => { setNotes(e.target.value); markDirty(); }} sx={{ flex: 1, "& .MuiInputBase-root": { alignItems: "flex-start", height: "100%" } }} />
            </CardContent>
          </Card>
        </Box>
      </Box>

      {/* Exit prompt */}
      <Dialog open={exitPromptOpen} onClose={() => setExitPromptOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Unsaved changes</DialogTitle>
        <DialogContent><Typography variant="body2">This purchase journal has changes that haven&apos;t been saved.</Typography></DialogContent>
        <DialogActions>
          <Button onClick={() => setExitPromptOpen(false)}>Keep editing</Button>
          <Button color="error" onClick={() => { setExitPromptOpen(false); leave(); }}>Discard</Button>
          <Button variant="contained" onClick={async () => { const id = await saveDraft(); if (id) { setExitPromptOpen(false); leave(); } }}>Save &amp; leave</Button>
        </DialogActions>
      </Dialog>

      {/* Delete confirm */}
      <Dialog open={delOpen} onClose={() => setDelOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Delete purchase journal</DialogTitle>
        <DialogContent><Typography variant="body2">Void this entry and its journal? This can&apos;t be undone.</Typography></DialogContent>
        <DialogActions>
          <Button onClick={() => setDelOpen(false)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={() => { setDelOpen(false); void doDelete(); }}>Delete</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
