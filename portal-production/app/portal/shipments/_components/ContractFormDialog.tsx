/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

// Create / edit a contract in four sections: contract & parties, B/L
// instructions (prefilled from the org's defaults), product lines, PI payment.
// Supplier and customer come from the org's master files; the backend
// validates both, the contract number's uniqueness and "at least one line".
// "Fill from PI" reads the supplier's PI (AI) and prefills sections 1, 3 and 4,
// highlighting what it filled and showing the PDF alongside; on save the PI
// file is linked to the contract and its "Set up PI payment" step. A new
// contract also gets shipment #1 (B/L pending) — the deal page opens on it.
// Deposit due is a number of business / calendar days after the PI date
// (default 3 business days, Vedanta's terms) with the date shown beside it.

import React, { useEffect, useState } from "react";
import { Alert, Autocomplete, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Divider, Grid2, IconButton, MenuItem, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Tooltip, Typography, useMediaQuery } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import { useShipmentsApi, type Contract, type ContractDraft, type ContractInput, type ContractLineInput, type DepositDueUnit, type Party, type PiExtraction } from "../_lib/api";
import { fmtDmy, toDateInput } from "../_lib/format";
import { useCustomers, useSuppliers, useTradeMutation, useTradeSettings } from "../_lib/hooks";
import { filledSx, PdfDropZone, SourcePdfPane } from "./PdfDrop";
import { anyDateError, guardDate } from "../_lib/dates";

type TextKey =
  | "contractNo"
  | "piNumber"
  | "piDate"
  | "supplierId"
  | "customerId"
  | "destinationPort"
  | "destinationCountry"
  | "incoterm"
  | "shipmentMonth"
  | "deliveryMonth"
  | "currency"
  | "notes"
  | "consignee"
  | "notifyParty"
  | "piAmount"
  | "depositPercent"
  | "depositAmount"
  | "depositDueDays"
  | "depositDueUnit"
  | "depositPaidAt";
type Form = Record<TextKey, string>;

// qmjp / billetPremium / upcharge: the client price parts the invoices fall back to when Invoice #1 has none.
type LineKey = "grade" | "sizeSpec" | "product" | "quantityMt" | "tolerancePct" | "supplierPremium" | "clientPremium" | "qmjp" | "billetPremium" | "upcharge";
type LineRow = Record<LineKey, string> & { id?: string; key: string };

const EMPTY: Form = {
  contractNo: "",
  piNumber: "",
  piDate: "",
  supplierId: "",
  customerId: "",
  destinationPort: "",
  destinationCountry: "Japan",
  incoterm: "CIF",
  shipmentMonth: "",
  deliveryMonth: "",
  currency: "USD",
  notes: "",
  consignee: "",
  notifyParty: "",
  piAmount: "",
  depositPercent: "10",
  depositAmount: "",
  // Vedanta's PI terms: "10% Adv with 3 business days".
  depositDueDays: "3",
  depositDueUnit: "BUSINESS",
  depositPaidAt: "",
};

let lineSeq = 0;
const newLine = (over: Partial<LineRow> = {}): LineRow => ({
  key: `new-${++lineSeq}`,
  grade: "",
  sizeSpec: "",
  product: "Aluminium Billet",
  quantityMt: "",
  tolerancePct: "5",
  supplierPremium: "",
  clientPremium: "",
  qmjp: "",
  billetPremium: "",
  upcharge: "",
  ...over,
});

const str = (v: unknown) => (v === null || v === undefined ? "" : String(typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v));

const fromContract = (c: Contract): Form => ({
  contractNo: c.contractNo ?? "",
  piNumber: c.piNumber ?? "",
  piDate: toDateInput(c.piDate),
  supplierId: c.supplierId ?? c.supplier?.id ?? "",
  customerId: c.customerId ?? c.customer?.id ?? "",
  destinationPort: c.destinationPort ?? "",
  destinationCountry: c.destinationCountry ?? "",
  incoterm: c.incoterm ?? "",
  shipmentMonth: c.shipmentMonth ?? "",
  deliveryMonth: c.deliveryMonth ?? "",
  currency: c.currency ?? "USD",
  notes: c.notes ?? "",
  consignee: c.consignee ?? "",
  notifyParty: c.notifyParty ?? "",
  piAmount: str(c.piAmount),
  depositPercent: str(c.depositPercent),
  depositAmount: str(c.depositAmount),
  // A free-text term that didn't parse stays blank (shown under the field as it was written).
  depositDueDays: c.depositDueDays == null ? "" : String(c.depositDueDays),
  depositDueUnit: c.depositDueUnit ?? "BUSINESS",
  depositPaidAt: toDateInput(c.depositPaidAt),
});

const linesFrom = (c: Contract): LineRow[] =>
  (c.lines ?? []).map((l) => ({
    id: l.id,
    key: l.id,
    grade: l.grade ?? "",
    sizeSpec: l.sizeSpec ?? "",
    product: l.product ?? "",
    quantityMt: str(l.quantityMt),
    tolerancePct: str(l.tolerancePct),
    supplierPremium: str(l.supplierPremium),
    clientPremium: str(l.clientPremium),
    qmjp: str(l.qmjp),
    billetPremium: str(l.billetPremium),
    upcharge: str(l.upcharge),
  }));

const num = (s: string) => (s.trim() === "" ? null : Number(s));
const text = (s: string) => (s.trim() === "" ? null : s.trim());
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
/** PI amount × percent, to cents; "" when either is missing. */
const autoDeposit = (amount: string, pct: string) => {
  const a = num(amount);
  const p = num(pct);
  return a === null || p === null || !Number.isFinite(a) || !Number.isFinite(p) ? "" : String(Math.round(a * p) / 100);
};

/** Product-line table columns (px): grade, size, product, qty, tolerance, Vedanta premium, client premium, remove. */
const LINE_COLS = [90, 170, 160, 100, 90, 120, 120, 100, 110, 100, 44];
const LINE_TABLE_MIN = LINE_COLS.reduce((a, b) => a + b, 0);

const Section = ({ n, title, action, children }: { n: number; title: string; action?: React.ReactNode; children: React.ReactNode }) => (
  <Box sx={{ mb: 3 }}>
    <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1.5 }}>
      <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
        {n}. {title}
      </Typography>
      {action}
    </Box>
    {children}
  </Box>
);

export default function ContractFormDialog({
  open,
  onClose,
  contract,
  onSaved,
  prefill,
}: {
  open: boolean;
  onClose: () => void;
  /** Present = edit mode. */
  contract?: Contract | null;
  onSaved?: (c: Contract) => void;
  /** A finished PI read (bulk "New contracts from PIs") to start from. */
  prefill?: PiExtraction | null;
}) {
  const api = useShipmentsApi();
  // Fill from PI: the stored PI file, which fields the AI filled, and the read state.
  // owned = read in THIS dialog (Fill from PI): removed again if the dialog is cancelled.
  // A bulk prefill belongs to the bulk dialog, which cleans up its own files.
  const [source, setSource] = useState<{ fileId: string; fileName: string; existingContractId: string | null; owned?: boolean } | null>(null);
  const [filled, setFilled] = useState<Set<string>>(new Set());
  const [reading, setReading] = useState(false);
  // The PDF being read right now: shown in the side panel at once (not the previous source).
  const [readingFile, setReadingFile] = useState<File | null>(null);
  // PDF beside the form (about half the width) only on wide screens; below ~1400px it stacks above it.
  const wide = useMediaQuery("(min-width:1400px)");
  const side = (!!source || !!readingFile) && wide;
  const [form, setForm] = useState<Form>(EMPTY);
  const [lines, setLines] = useState<LineRow[]>([newLine()]);
  // Deposit follows PI amount × % until the user types their own figure.
  const [depositEdited, setDepositEdited] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const suppliers = useSuppliers(open);
  const customers = useCustomers(open);
  const settings = useTradeSettings(open);
  const defaults = { consignee: settings.data?.defaultConsignee ?? "", notifyParty: settings.data?.defaultNotifyParty ?? "" };

  useEffect(() => {
    if (!open) return;
    setForm(contract ? fromContract(contract) : { ...EMPTY, ...defaults });
    setLines(contract ? (linesFrom(contract).length ? linesFrom(contract) : [newLine()]) : [newLine()]);
    setDepositEdited(!!contract && contract.depositAmount != null && autoDeposit(str(contract.piAmount), str(contract.depositPercent)) !== str(contract.depositAmount));
    setError(null);
    setTouched(false);
    setSource(null);
    setFilled(new Set());
    if (!contract && prefill?.result) applyPi(prefill);
    // Reset only when the dialog opens or the record changes, not on every refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, contract?.id]);

  /** Put a PI read into the form (sections 1, 3, 4) and remember what was filled. */
  function applyPi(x: PiExtraction, owned = false) {
    const d: ContractDraft | undefined = x.result?.draft;
    if (!d) return;
    const hit = new Set<string>();
    const val = (k: TextKey, v: unknown) => {
      if (v === null || v === undefined || v === "") return undefined;
      hit.add(k);
      return String(v);
    };
    setForm((f) => {
      const next = { ...f };
      const put = (k: TextKey, v: unknown) => {
        const s = val(k, v);
        if (s !== undefined) next[k] = s;
      };
      put("contractNo", d.contractNo);
      put("piNumber", d.piNumber);
      put("piDate", d.piDate);
      put("supplierId", d.supplierId);
      put("customerId", d.customerId);
      put("destinationPort", d.destinationPort);
      put("destinationCountry", d.destinationCountry);
      put("incoterm", d.incoterm);
      put("shipmentMonth", d.shipmentMonth);
      put("currency", d.currency);
      put("piAmount", d.piAmount);
      put("depositPercent", d.depositPercent);
      put("depositAmount", d.depositAmount ?? autoDeposit(String(d.piAmount ?? ""), String(d.depositPercent ?? 10)));
      // The PI's payment terms as a day count; otherwise the default stays.
      if (d.depositDueDays != null) {
        put("depositDueDays", d.depositDueDays);
        put("depositDueUnit", d.depositDueUnit ?? "BUSINESS");
      }
      return next;
    });
    // The PI prints its own "amount payable": keep it even if it isn't exactly PI × %.
    setDepositEdited(d.depositAmount !== null);
    if (d.lines.length) {
      const rows = d.lines.map((l) =>
        newLine({
          grade: l.grade ?? "",
          sizeSpec: l.sizeSpec ?? "",
          product: l.product ?? "Aluminium Billet",
          quantityMt: l.quantityMt == null ? "" : String(l.quantityMt),
          tolerancePct: l.tolerancePct == null ? "5" : String(l.tolerancePct),
          supplierPremium: l.supplierPremium == null ? "" : String(l.supplierPremium),
        })
      );
      rows.forEach((r, i) => {
        const l = d.lines[i];
        (["grade", "sizeSpec", "product", "quantityMt", "tolerancePct", "supplierPremium"] as const).forEach((k) => {
          if (l[k] !== null && l[k] !== undefined) hit.add(`line:${r.key}:${k}`);
        });
      });
      setLines(rows);
    }
    setFilled(hit);
    setSource({ fileId: x.fileId, fileName: x.file?.fileName ?? "PI", existingContractId: (x.result as any)?.existingContractId ?? null, owned });
  }

  /** Remove a PI uploaded here but never saved (file + extraction rows + S3 object). */
  const discard = (fileId: string) => void api.discardSource(fileId).catch(() => undefined);
  const cancel = () => {
    if (source?.owned) discard(source.fileId);
    setSource(null);
    onClose();
  };

  const readPi = async (file: File) => {
    // "Read another PI": the previous unsaved upload is dropped.
    if (source?.owned) discard(source.fileId);
    setReading(true);
    setReadingFile(file);
    setError(null);
    try {
      const x = await api.extractPi({ file });
      if (x.status !== "DONE") {
        setError(`Could not read ${file.name}: ${x.error || "unknown error"}. The PI was stored — fill the form by hand.`);
        setSource({ fileId: x.fileId, fileName: file.name, existingContractId: null, owned: true });
      } else applyPi(x, true);
    } catch (e: any) {
      setError(e?.message || "Could not read the PI");
    } finally {
      setReading(false);
      setReadingFile(null);
    }
  };
  const unfill = (k: string) =>
    setFilled((f) => {
      if (!f.has(k)) return f;
      const n = new Set(f);
      n.delete(k);
      return n;
    });

  // New contract: the org defaults may arrive after the dialog opened.
  useEffect(() => {
    if (!open || contract || !settings.data) return;
    setForm((f) => ({ ...f, consignee: f.consignee || defaults.consignee, notifyParty: f.notifyParty || defaults.notifyParty }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, contract, settings.data]);

  const save = useTradeMutation((api, body: ContractInput) => (contract ? api.updateContract(contract.id, body) : api.createContract(body)));

  const setVal = (k: TextKey, v: string) => {
    unfill(k);
    setForm((f) => {
      const next = { ...f, [k]: v };
      if ((k === "piAmount" || k === "depositPercent") && !depositEdited) next.depositAmount = autoDeposit(next.piAmount, next.depositPercent);
      return next;
    });
  };
  const set = (k: TextKey) => (e: React.ChangeEvent<HTMLInputElement>) => setVal(k, e.target.value);
  const setLine = (key: string, k: LineKey, v: string) => {
    unfill(`line:${key}:${k}`);
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, [k]: v } : l)));
  };

  const numberError = (s: string, allowNegative = false) => s.trim() !== "" && (!Number.isFinite(Number(s)) || (!allowNegative && Number(s) < 0));
  const monthError = (k: "shipmentMonth" | "deliveryMonth") => form[k].trim() !== "" && !MONTH.test(form[k].trim());
  const currencyError = !/^[A-Z]{3}$/.test(form.currency.trim());
  const dueDaysError = form.depositDueDays.trim() !== "" && !(Number.isInteger(Number(form.depositDueDays)) && Number(form.depositDueDays) >= 0 && Number(form.depositDueDays) <= 365);
  const pctError = numberError(form.depositPercent) || (form.depositPercent.trim() !== "" && Number(form.depositPercent) > 100);
  const lineError = (l: LineRow) => numberError(l.quantityMt) || numberError(l.tolerancePct) || Number(l.tolerancePct) > 100 || numberError(l.supplierPremium, true) || numberError(l.clientPremium, true) || numberError(l.qmjp, true) || numberError(l.billetPremium, true) || numberError(l.upcharge, true);
  const missing = !form.contractNo.trim() || !form.supplierId || !form.customerId;
  const invalid = dueDaysError || missing || monthError("shipmentMonth") || monthError("deliveryMonth") || anyDateError(form.piDate, form.depositPaidAt, form.shipmentMonth, form.deliveryMonth) || currencyError || pctError || ["piAmount", "depositAmount"].some((k) => numberError(form[k as TextKey])) || !lines.length || lines.some(lineError);
  const totalQty = lines.reduce((s, l) => s + (Number(l.quantityMt) || 0), 0);

  const submit = async () => {
    setTouched(true);
    if (invalid) return;
    setError(null);
    const body: ContractInput = {
      contractNo: form.contractNo.trim(),
      piNumber: text(form.piNumber),
      piDate: form.piDate || null,
      supplierId: form.supplierId,
      customerId: form.customerId,
      destinationPort: text(form.destinationPort),
      destinationCountry: text(form.destinationCountry),
      incoterm: text(form.incoterm),
      shipmentMonth: text(form.shipmentMonth),
      deliveryMonth: text(form.deliveryMonth),
      currency: form.currency.trim(),
      notes: text(form.notes),
      consignee: text(form.consignee),
      notifyParty: text(form.notifyParty),
      piAmount: num(form.piAmount),
      depositPercent: num(form.depositPercent),
      depositAmount: num(form.depositAmount),
      depositDueDays: form.depositDueDays.trim() === "" ? null : Number(form.depositDueDays),
      depositDueUnit: form.depositDueDays.trim() === "" ? null : (form.depositDueUnit as DepositDueUnit),
      depositPaidAt: form.depositPaidAt || null,
      ...(source && !contract ? { piFileId: source.fileId } : {}),
      lines: lines.map((l): ContractLineInput => ({
        ...(l.id ? { id: l.id } : {}),
        grade: text(l.grade),
        sizeSpec: text(l.sizeSpec),
        product: text(l.product),
        quantityMt: num(l.quantityMt),
        tolerancePct: num(l.tolerancePct),
        supplierPremium: num(l.supplierPremium),
        clientPremium: num(l.clientPremium),
        qmjp: num(l.qmjp),
        billetPremium: num(l.billetPremium),
        upcharge: num(l.upcharge),
      })),
    };
    try {
      const saved = await save.mutateAsync(body);
      onSaved?.(saved);
      onClose();
    } catch (e: any) {
      setError(e?.message || "Could not save the contract");
    }
  };

  const partyField = (label: string, key: "supplierId" | "customerId", q: { data?: Party[]; isLoading: boolean }) => {
    const options = q.data ?? [];
    const value = options.find((o) => o.id === form[key]) ?? null;
    return (
      <Autocomplete
        options={options}
        loading={q.isLoading}
        value={value}
        onChange={(_, v) => {
          unfill(key);
          setForm((f) => ({ ...f, [key]: v?.id ?? "" }));
        }}
        getOptionLabel={(o) => o.name}
        isOptionEqualToValue={(a, b) => a.id === b.id}
        renderInput={(p) => <TextField {...p} label={label} required size="small" sx={filledSx(filled.has(key))} error={touched && !form[key]} helperText={touched && !form[key] ? (source && key === "customerId" ? "Required — the PI doesn't name the end customer" : "Required") : undefined} />}
      />
    );
  };

  const tf = (k: TextKey, label: string, extra: Record<string, any> = {}) => <TextField label={label} fullWidth size="small" value={form[k]} onChange={set(k)} sx={filledSx(filled.has(k))} {...guardDate(extra, form[k])} />;
  const dateTf = (k: TextKey, label: string) => tf(k, label, { type: "date", InputLabelProps: { shrink: true } });
  const monthTf = (k: "shipmentMonth" | "deliveryMonth", label: string) => tf(k, label, { type: "month", InputLabelProps: { shrink: true }, error: monthError(k), helperText: monthError(k) ? "Use YYYY-MM" : undefined });

  const blField = (k: "consignee" | "notifyParty", label: string) => {
    const dflt = defaults[k];
    return (
      <Box>
        <TextField label={label} fullWidth size="small" multiline minRows={5} value={form[k]} onChange={set(k)} inputProps={{ style: { fontFamily: "monospace", fontSize: 12.5 } }} />
        <Box sx={{ display: "flex", justifyContent: "flex-end", mt: 0.5 }}>
          <Tooltip title={dflt ? "Replace with the org default (Contracts → B/L instruction defaults)" : "No org default set yet"}>
            <span>
              <Button size="small" startIcon={<RestartAltIcon fontSize="small" />} disabled={!dflt || form[k] === dflt} onClick={() => setVal(k, dflt)}>
                Reset to default
              </Button>
            </span>
          </Tooltip>
        </Box>
      </Box>
    );
  };

  const lineCell = (l: LineRow, k: LineKey, opts: { numeric?: boolean; allowNegative?: boolean; placeholder?: string } = {}) => (
    <TableCell sx={{ px: 0.5, py: 0.75 }}>
      <TextField
        size="small"
        fullWidth
        value={l[k]}
        sx={filledSx(filled.has(`line:${l.key}:${k}`))}
        placeholder={opts.placeholder}
        onChange={(e) => setLine(l.key, k, e.target.value)}
        error={opts.numeric ? numberError(l[k], opts.allowNegative) || (k === "tolerancePct" && Number(l[k]) > 100) : false}
        type={opts.numeric ? "number" : "text"}
        inputProps={{ style: { textAlign: opts.numeric ? "right" : "left", fontSize: 13 }, ...(opts.numeric ? { step: "any" } : {}), "aria-label": k }}
      />
    </TableCell>
  );

  return (
    <Dialog open={open} onClose={() => !save.isPending && !reading && cancel()} maxWidth={source || readingFile ? "xl" : "lg"} fullWidth>
      <DialogTitle>
        {contract ? `Edit contract ${contract.contractNo}` : "New Shipment"}
        {!contract && (
          <Typography variant="body2" color="text.secondary">
            Start with the contract — shipment #1 is created with it (B/L pending).
          </Typography>
        )}
      </DialogTitle>
      <DialogContent dividers>
        <Grid2 container spacing={2}>
          <Grid2 size={side ? 6 : 12}>
            {!contract && (
              <Box sx={{ mb: 2 }}>
                <PdfDropZone
                  title={source ? "Read another PI" : "Fill from PI"}
                  busy={reading}
                  busyText="Reading the PI…"
                  onFiles={(f) => void readPi(f[0])}
                  dataTour="contract-fill-from-pi"
                />
              </Box>
            )}
            {source?.existingContractId && (
              <Alert severity="error" sx={{ mb: 2 }}>
                Contract {form.contractNo} already exists — this PI may already have been entered.
              </Alert>
            )}
            {error && (
              <Alert severity="error" sx={{ mb: 2 }}>
                {error}
              </Alert>
            )}

            <Section n={1} title="Contract & parties">
              <Grid2 container spacing={2}>
                <Grid2 size={{ xs: 12, sm: 4 }}>{tf("contractNo", "Contract no.", { required: true, autoFocus: true, error: touched && !form.contractNo.trim(), helperText: touched && !form.contractNo.trim() ? "Required" : undefined })}</Grid2>
                <Grid2 size={{ xs: 12, sm: 4 }}>{tf("piNumber", "PI no.")}</Grid2>
                <Grid2 size={{ xs: 12, sm: 4 }}>{dateTf("piDate", "PI date")}</Grid2>
                <Grid2 size={{ xs: 12, sm: 6 }}>{partyField("Supplier", "supplierId", suppliers)}</Grid2>
                <Grid2 size={{ xs: 12, sm: 6 }}>{partyField("Customer", "customerId", customers)}</Grid2>
                <Grid2 size={{ xs: 12, sm: 4 }}>{tf("destinationPort", "Destination port")}</Grid2>
                <Grid2 size={{ xs: 12, sm: 4 }}>{tf("destinationCountry", "Destination country")}</Grid2>
                <Grid2 size={{ xs: 12, sm: 4 }}>{tf("incoterm", "Incoterm")}</Grid2>
                <Grid2 size={{ xs: 12, sm: 4 }}>{monthTf("shipmentMonth", "Shipment month")}</Grid2>
                <Grid2 size={{ xs: 12, sm: 4 }}>{monthTf("deliveryMonth", "Delivery month")}</Grid2>
                <Grid2 size={{ xs: 12, sm: 4 }}>
                  <TextField label="Currency" fullWidth size="small" value={form.currency} onChange={(e) => setVal("currency", e.target.value.toUpperCase().slice(0, 3))} sx={filledSx(filled.has("currency"))} error={currencyError} helperText={currencyError ? "3-letter code, e.g. USD" : undefined} />
                </Grid2>
                <Grid2 size={12}>{tf("notes", "Notes", { multiline: true, minRows: 2 })}</Grid2>
              </Grid2>
            </Section>
            <Divider sx={{ mb: 2 }} />

            <Section n={2} title="B/L instructions">
              <Grid2 container spacing={2}>
                <Grid2 size={{ xs: 12, md: 6 }}>{blField("consignee", "Consignee")}</Grid2>
                <Grid2 size={{ xs: 12, md: 6 }}>{blField("notifyParty", "Notify party")}</Grid2>
              </Grid2>
            </Section>
            <Divider sx={{ mb: 2 }} />

            <Section
              n={3}
              title="Product lines"
              action={
                <Button size="small" startIcon={<AddIcon />} onClick={() => setLines((ls) => [...ls, newLine()])}>
                  Add line
                </Button>
              }
            >
              {/* Fixed column widths + sideways scroll: inputs never squeeze below a readable width. */}
              <Box sx={{ overflowX: "auto" }}>
                <Table size="small" sx={{ tableLayout: "fixed", minWidth: LINE_TABLE_MIN, "& th": { px: 0.5, fontSize: 12, lineHeight: 1.3, color: "text.secondary", verticalAlign: "bottom" } }}>
                  <colgroup>
                    {LINE_COLS.map((w, i) => (
                      <col key={i} style={{ width: w }} />
                    ))}
                  </colgroup>
                  <TableHead>
                    <TableRow>
                      <TableCell>Grade</TableCell>
                      <TableCell>Size / spec</TableCell>
                      <TableCell>Product</TableCell>
                      <TableCell align="right">Qty (MT)</TableCell>
                      <TableCell align="right">Tolerance %</TableCell>
                      <TableCell align="right">Vedanta premium (USD/t)</TableCell>
                      <TableCell align="right">Client premium (USD/t)</TableCell>
                      <TableCell align="right">QMJP (USD/t)</TableCell>
                      <TableCell align="right">Billet premium (USD/t)</TableCell>
                      <TableCell align="right">Upcharge (USD/t)</TableCell>
                      <TableCell />
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {lines.map((l) => (
                      <TableRow key={l.key}>
                        {lineCell(l, "grade", { placeholder: "6063" })}
                        {lineCell(l, "sizeSpec", { placeholder: "152MM" })}
                        {lineCell(l, "product")}
                        {lineCell(l, "quantityMt", { numeric: true })}
                        {lineCell(l, "tolerancePct", { numeric: true })}
                        {lineCell(l, "supplierPremium", { numeric: true, allowNegative: true })}
                        {lineCell(l, "clientPremium", { numeric: true, allowNegative: true })}
                        {lineCell(l, "qmjp", { numeric: true, allowNegative: true })}
                        {lineCell(l, "billetPremium", { numeric: true, allowNegative: true })}
                        {lineCell(l, "upcharge", { numeric: true, allowNegative: true })}
                        <TableCell sx={{ px: 0.5, width: 40 }}>
                          <Tooltip title={lines.length === 1 ? "A contract needs at least one product line" : "Remove line"}>
                            <span>
                              <IconButton size="small" aria-label="Remove line" disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
                                <DeleteOutlineIcon fontSize="small" />
                              </IconButton>
                            </span>
                          </Tooltip>
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow>
                      <TableCell colSpan={3} sx={{ px: 0.5, fontWeight: 700, borderBottom: 0 }}>
                        Total ({lines.length} line{lines.length === 1 ? "" : "s"})
                      </TableCell>
                      <TableCell align="right" sx={{ px: 1.5, fontWeight: 700, borderBottom: 0, fontVariantNumeric: "tabular-nums" }}>
                        {totalQty.toLocaleString("en-US", { maximumFractionDigits: 3 })} MT
                      </TableCell>
                      <TableCell colSpan={7} sx={{ borderBottom: 0 }} />
                    </TableRow>
                  </TableBody>
                </Table>
              </Box>
            </Section>
            <Divider sx={{ mb: 2 }} />

            <Section n={4} title="PI payment">
              <Grid2 container spacing={2}>
                <Grid2 size={{ xs: 12, sm: 4 }}>{tf("piAmount", "PI amount", { type: "number", inputProps: { min: 0, step: "0.01" }, error: numberError(form.piAmount) })}</Grid2>
                <Grid2 size={{ xs: 12, sm: 4 }}>{tf("depositPercent", "Deposit %", { type: "number", inputProps: { min: 0, max: 100, step: "0.01" }, error: pctError, helperText: pctError ? "0–100" : undefined })}</Grid2>
                <Grid2 size={{ xs: 12, sm: 4 }}>
                  <TextField
                    label="Deposit amount"
                    type="number"
                    fullWidth
                    size="small"
                    value={form.depositAmount}
                    sx={filledSx(filled.has("depositAmount"))}
                    onChange={(e) => {
                      unfill("depositAmount");
                      setDepositEdited(true);
                      setForm((f) => ({ ...f, depositAmount: e.target.value }));
                    }}
                    inputProps={{ min: 0, step: "0.01" }}
                    error={numberError(form.depositAmount)}
                    helperText={
                      depositEdited ? (
                        <Box
                          component="span"
                          sx={{ cursor: "pointer", textDecoration: "underline" }}
                          onClick={() => {
                            setDepositEdited(false);
                            setForm((f) => ({ ...f, depositAmount: autoDeposit(f.piAmount, f.depositPercent) }));
                          }}
                        >
                          Recalculate from PI amount × %
                        </Box>
                      ) : undefined
                    }
                  />
                </Grid2>
                <Grid2 size={{ xs: 12, sm: 8 }}>
                  <DepositDueField
                    days={form.depositDueDays}
                    unit={form.depositDueUnit}
                    piDate={form.piDate}
                    filled={filled.has("depositDueDays")}
                    legacyNote={contract && contract.depositDueDays == null ? contract.depositDueNote : null}
                    error={dueDaysError}
                    onChange={(days, unit) => {
                      unfill("depositDueDays");
                      setForm((f) => ({ ...f, depositDueDays: days, depositDueUnit: unit }));
                    }}
                  />
                </Grid2>
                <Grid2 size={{ xs: 12, sm: 4 }}>{dateTf("depositPaidAt", "Deposit paid on")}</Grid2>
              </Grid2>
            </Section>
          </Grid2>
          {(source || readingFile) && (
            <Grid2 size={side ? 6 : 12} sx={{ order: side ? 0 : -1 }}>
              <SourcePdfPane fileId={source?.fileId} fileName={source?.fileName} file={readingFile} stacked={!side} />
            </Grid2>
          )}
        </Grid2>
      </DialogContent>
      <DialogActions>
        <Button onClick={cancel} disabled={save.isPending || reading}>
          Cancel
        </Button>
        <Button variant="contained" onClick={submit} disabled={save.isPending || reading}>
          {save.isPending ? "Saving…" : contract ? "Save changes" : "Create shipment"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/**
 * Deposit due: N + Business days / Calendar days after the PI date, with the
 * computed date beside it (business days skip Japanese bank holidays — the API
 * works it out, as for 請求書 due dates).
 */
function DepositDueField({
  days,
  unit,
  piDate,
  filled,
  legacyNote,
  error,
  onChange,
}: {
  days: string;
  unit: string;
  piDate: string;
  filled: boolean;
  legacyNote: string | null;
  error: boolean;
  onChange: (days: string, unit: string) => void;
}) {
  const api = useShipmentsApi();
  const [due, setDue] = useState<string | null>(null);
  useEffect(() => {
    const n = Number(days);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(piDate) || days.trim() === "" || !Number.isInteger(n) || n < 0 || n > 365) {
      setDue(null);
      return;
    }
    let live = true;
    const t = setTimeout(() => {
      api
        .depositDue(piDate, n, unit as DepositDueUnit)
        .then((r) => live && setDue(r.dueDate))
        .catch(() => live && setDue(null));
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [api, days, unit, piDate]);
  return (
    <Box>
      <Stack direction="row" spacing={1} alignItems="flex-start">
        <TextField
          label="Deposit due"
          type="number"
          size="small"
          value={days}
          onChange={(e) => onChange(e.target.value, unit)}
          inputProps={{ min: 0, max: 365, step: 1 }}
          error={error}
          sx={{ width: 120, ...filledSx(filled) }}
        />
        <TextField select size="small" label="Unit" value={unit} onChange={(e) => onChange(days, e.target.value)} sx={{ width: 170, ...filledSx(filled) }}>
          <MenuItem value="BUSINESS">Business days</MenuItem>
          <MenuItem value="CALENDAR">Calendar days</MenuItem>
        </TextField>
        <Box sx={{ pt: 1, minWidth: 0 }}>
          <Typography variant="body2" sx={{ fontWeight: 600, whiteSpace: "nowrap" }}>
            {due ? `→ due ${fmtDmy(due)}` : piDate ? "" : "after the PI date"}
          </Typography>
        </Box>
      </Stack>
      {error ? (
        <Typography variant="caption" color="error">
          A whole number of days, 0–365
        </Typography>
      ) : legacyNote ? (
        <Typography variant="caption" color="text.secondary">
          Written on the contract as: “{legacyNote}”
        </Typography>
      ) : null}
    </Box>
  );
}
