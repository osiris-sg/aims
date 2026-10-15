/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

// Create / edit a shipment (one per B/L). The contract is fixed once created;
// the customer follows the contract and is shown read-only. The shipment ships
// one of the contract's product lines (auto-picked when there is only one);
// picking a line prefills commodity and size, both still editable.
// "Fill from B/L draft" reads the draft B/L (AI) into the form, picks the line
// whose grade matches, shows the PDF alongside and, on save, links the PDF as
// the shipment's B/L draft (step "Approve B/L draft") — its check panel then
// compares consignee / notify party etc. with the contract.
// `inline`: the same form without the dialog, on shipment step 2 of the deal
// page (a new contract's shipment starts with the B/L pending); there "Fill
// from B/L draft" stores the draft on the shipment's step 2 straight away.

import React, { useEffect, useMemo, useState } from "react";
import { Alert, Autocomplete, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Divider, Grid2, MenuItem, TextField, Typography, useMediaQuery } from "@mui/material";
import { useShipmentsApi, type BlExtraction, type ContractLine, type ContractListItem, type Shipment, type ShipmentDraft, type ShipmentInput } from "../_lib/api";
import { useContracts, useTradeMutation } from "../_lib/hooks";
import { commodityOf, lineLabel, toDateInput } from "../_lib/format";
import { filledSx, PdfDropZone, SourcePdfPane } from "./PdfDrop";
import { anyDateError, guardDate } from "../_lib/dates";

/** The contract line whose grade matches the B/L (the only line, or exactly one match). */
const lineForGrade = (lines: ContractLine[], grade: string | null) => {
  if (lines.length === 1) return lines[0];
  const hits = grade ? lines.filter((l) => (l.grade ?? "").replace(/\D/g, "").slice(0, 4) === grade) : [];
  return hits.length === 1 ? hits[0] : null;
};

const TEXT_KEYS = [
  "blNumber",
  "vessel",
  "voyageNo",
  "shippingLine",
  "deliveryMonth",
  "portOfLoading",
  "portOfDischarge",
  "hsCode",
  "countryOfOrigin",
  "commodity",
  "sizeSpec",
  "ciNumber",
  "telexReleaseCode",
  "notes",
] as const;
const DECIMAL_KEYS = ["netWeightMt", "grossWeightMt", "ciAmount"] as const;
const INT_KEYS = ["totalBundles", "totalPieces", "containerCount"] as const;
const DATE_KEYS = ["etd", "eta", "actualArrivalDate"] as const;
type Key = (typeof TEXT_KEYS)[number] | (typeof DECIMAL_KEYS)[number] | (typeof INT_KEYS)[number] | (typeof DATE_KEYS)[number] | "currency";
type Form = Record<Key, string>;

const EMPTY = Object.fromEntries([...TEXT_KEYS, ...DECIMAL_KEYS, ...INT_KEYS, ...DATE_KEYS].map((k) => [k, ""])) as Form;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

const fromShipment = (s: Shipment): Form => {
  const f = { ...EMPTY, currency: s.currency || "USD" };
  TEXT_KEYS.forEach((k) => (f[k] = (s[k] as string | null) ?? ""));
  [...DECIMAL_KEYS, ...INT_KEYS].forEach((k) => (f[k] = s[k] == null ? "" : String(Number(s[k]))));
  DATE_KEYS.forEach((k) => (f[k] = toDateInput(s[k])));
  return f;
};

type ContractRef = { id: string; contractNo: string; currency?: string | null; deliveryMonth?: string | null; lines?: ContractLine[]; customer?: { id: string; name: string } | null };

export default function ShipmentFormDialog({
  open,
  onClose,
  shipment,
  contract: presetContract,
  onSaved,
  inline = false,
}: {
  open: boolean;
  onClose: () => void;
  /** Present = edit mode. */
  shipment?: Shipment | null;
  /** Preselect (and lock) this contract when opened from a contract page. */
  contract?: ContractRef | null;
  onSaved?: (s: Shipment) => void;
  /** Render the form in place (deal page, shipment step 2) instead of a dialog; needs `shipment`. */
  inline?: boolean;
}) {
  const [form, setForm] = useState<Form>({ ...EMPTY, currency: "USD" });
  const [contractId, setContractId] = useState<string>("");
  const [lineId, setLineId] = useState<string>("");
  const api = useShipmentsApi();
  // The B/L draft read in this dialog: removed again (file + extraction + S3) if the dialog is cancelled.
  const [source, setSource] = useState<{ fileId: string; fileName: string; draft: ShipmentDraft | null; existingShipmentId: string | null } | null>(null);
  const [filled, setFilled] = useState<Set<string>>(new Set());
  const [reading, setReading] = useState(false);
  // The PDF being read right now: shown in the side panel at once (not the previous source).
  const [readingFile, setReadingFile] = useState<File | null>(null);
  // PDF beside the form (about half the width) only on wide screens; below ~1400px it stacks above it.
  const wide = useMediaQuery("(min-width:1400px)");
  const side = (!!source || !!readingFile) && wide;
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const pickContract = open && !shipment && !presetContract;
  const contracts = useContracts({ status: "OPEN", pageSize: 100 }, pickContract);

  useEffect(() => {
    if (!open && !inline) return;
    setError(null);
    setTouched(false);
    setSource(null);
    setFilled(new Set());
    if (shipment) {
      setForm(fromShipment(shipment));
      setContractId(shipment.contractId ?? "");
      setLineId(shipment.contractLineId ?? "");
    } else {
      setForm({ ...EMPTY, currency: presetContract?.currency || "USD", deliveryMonth: presetContract?.deliveryMonth ?? "" });
      setContractId(presetContract?.id ?? "");
      setLineId("");
      if (presetContract?.lines?.length === 1) pickLine(presetContract.lines[0]);
    }
    // Reset only when the dialog opens or the record changes, not on every refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, shipment?.id, presetContract?.id, inline]);

  const options: ContractListItem[] = useMemo(() => contracts.data?.items ?? [], [contracts.data]);
  const selected = options.find((c) => c.id === contractId) ?? null;
  // The contract's product lines: from the shipment (edit), the preset contract, or the picked one.
  const lines: ContractLine[] = shipment?.contract?.lines ?? presetContract?.lines ?? selected?.lines ?? [];
  const lineRequired = lines.length > 0;

  /** Choose a line; commodity / size follow it (still editable). */
  function pickLine(l: ContractLine | null) {
    setLineId(l?.id ?? "");
    if (l) setForm((f) => ({ ...f, commodity: commodityOf(l) || f.commodity, sizeSpec: l.sizeSpec || f.sizeSpec }));
  }

  // Customer shown read-only: from the shipment (edit), the preset contract, or the picked contract.
  const customerName = shipment?.customer?.name ?? presetContract?.customer?.name ?? selected?.customer?.name ?? null;
  const contractLabel = shipment?.contract?.contractNo ?? presetContract?.contractNo ?? null;

  const save = useTradeMutation((api, body: ShipmentInput) => (shipment ? api.updateShipment(shipment.id, body) : api.createShipment(body)));

  const unfill = (k: string) =>
    setFilled((f) => {
      if (!f.has(k)) return f;
      const n = new Set(f);
      n.delete(k);
      return n;
    });
  const set = (k: Key) => (e: React.ChangeEvent<HTMLInputElement>) => {
    unfill(k);
    setForm((f) => ({ ...f, [k]: e.target.value }));
  };

  /** Put a B/L draft read into the form; the B/L's commodity / size win over the line's. */
  const applyBl = (x: BlExtraction) => {
    const r = x.result;
    if (!r) return;
    const d = r.draft;
    const hit = new Set<string>();
    const patch: Partial<Form> = {};
    const put = (k: Key, v: unknown) => {
      if (v === null || v === undefined || v === "") return;
      patch[k] = String(v);
      hit.add(k);
    };
    (["blNumber", "shippingLine", "vessel", "voyageNo", "etd", "portOfLoading", "portOfDischarge", "netWeightMt", "grossWeightMt", "totalBundles", "totalPieces", "containerCount", "hsCode", "countryOfOrigin", "commodity", "sizeSpec"] as const).forEach((k) =>
      put(k, d[k as keyof ShipmentDraft]),
    );
    // Contract: preset / already picked, else the one whose number the B/L prints.
    const cid = presetContract?.id ?? (contractId || r.contractId || "");
    if (!presetContract && !contractId && r.contractId) setContractId(r.contractId);
    const pool = presetContract?.lines ?? options.find((c) => c.id === cid)?.lines ?? [];
    const line = (r.contractLineId && pool.find((l) => l.id === r.contractLineId)) || lineForGrade(pool, d.grade);
    if (line) {
      setLineId(line.id);
      hit.add("contractLineId");
    }
    setForm((f) => ({ ...f, ...patch }));
    setFilled(hit);
    setSource({ fileId: x.fileId, fileName: x.file?.fileName ?? "B/L draft", draft: d, existingShipmentId: r.existingShipmentId });
  };

  // Inline, the draft is already stored on the shipment's step 2: never discard it.
  const discard = (fileId: string) => (inline ? undefined : void api.discardSource(fileId).catch(() => undefined));
  const cancel = () => {
    if (source) discard(source.fileId);
    setSource(null);
    if (inline && shipment) {
      setForm(fromShipment(shipment));
      setLineId(shipment.contractLineId ?? "");
      setFilled(new Set());
      setTouched(false);
    }
    onClose();
  };

  const readBl = async (file: File) => {
    // "Read another B/L draft": the previous unsaved upload is dropped.
    if (source) discard(source.fileId);
    setReading(true);
    setReadingFile(file);
    setError(null);
    try {
      const x = await api.extractBlDraft(
        inline && shipment ? { file, shipmentId: shipment.id } : { file, ...(presetContract?.id || contractId ? { contractId: presetContract?.id ?? contractId } : {}) },
      );
      if (x.status !== "DONE") {
        setError(`Could not read ${file.name}: ${x.error || "unknown error"}. The PDF was stored — fill the form by hand.`);
        setSource({ fileId: x.fileId, fileName: file.name, draft: null, existingShipmentId: null });
      } else applyBl(x);
    } catch (e: any) {
      setError(e?.message || "Could not read the B/L draft");
    } finally {
      setReading(false);
      setReadingFile(null);
    }
  };

  const badDecimal = (s: string) => s.trim() !== "" && (!Number.isFinite(Number(s)) || Number(s) < 0);
  const badInt = (s: string) => s.trim() !== "" && (!Number.isInteger(Number(s)) || Number(s) < 0);
  const currencyError = !/^[A-Z]{3}$/.test(form.currency.trim());
  const datesError = !!form.etd && !!form.eta && form.eta < form.etd;
  const monthError = form.deliveryMonth.trim() !== "" && !MONTH.test(form.deliveryMonth.trim());
  const invalid =
    !contractId || (lineRequired && !lineId) || currencyError || monthError || anyDateError(form.etd, form.eta, form.actualArrivalDate, form.deliveryMonth) || DECIMAL_KEYS.some((k) => badDecimal(form[k])) || INT_KEYS.some((k) => badInt(form[k]));

  const submit = async () => {
    setTouched(true);
    if (invalid) return;
    setError(null);
    const body: ShipmentInput = { currency: form.currency.trim() };
    TEXT_KEYS.forEach((k) => (body[k] = form[k].trim() === "" ? null : form[k].trim()));
    [...DECIMAL_KEYS, ...INT_KEYS].forEach((k) => (body[k] = form[k].trim() === "" ? null : Number(form[k])));
    DATE_KEYS.forEach((k) => (body[k] = form[k] || null));
    if (lineRequired) body.contractLineId = lineId;
    if (!shipment) body.contractId = contractId;
    if (!shipment && source) body.blDraftFileId = source.fileId;
    try {
      const saved = await save.mutateAsync(body);
      onSaved?.(saved);
      if (inline) setFilled(new Set());
      onClose();
    } catch (e: any) {
      setError(e?.message || "Could not save the shipment");
    }
  };

  const tf = (k: Key, label: string, extra: Partial<React.ComponentProps<typeof TextField>> = {}) => (
    <TextField label={label} fullWidth size="small" value={form[k]} onChange={set(k)} sx={filledSx(filled.has(k))} {...guardDate(extra, form[k])} />
  );

  const body = (
    <>
        <Grid2 container spacing={2}>
        <Grid2 size={side ? 6 : 12}>
        {(!shipment || inline) && (
          <Box sx={{ mb: 2 }}>
            <PdfDropZone
              title={source ? "Read another B/L draft" : "Fill from B/L draft"}
              busy={reading}
              busyText="Reading the B/L draft…"
              onFiles={(f) => void readBl(f[0])}
              dataTour="shipment-fill-from-bl"
            />
          </Box>
        )}
        {source?.draft && !source.draft.contractNo && !contractId && (
          <Alert severity="warning" variant="outlined" sx={{ mb: 2 }}>
            The B/L doesn&apos;t print the contract no. — pick the contract.
          </Alert>
        )}
        {source?.existingShipmentId && (
          <Alert severity="error" sx={{ mb: 2 }}>
            B/L {form.blNumber} is already used by another shipment.
          </Alert>
        )}
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        <Grid2 container spacing={2}>
          {/* Inline on the deal page the contract and customer are already on screen. */}
          {!inline && (
            <>
          <Grid2 size={{ xs: 12, sm: 6 }}>
            {pickContract ? (
              <Autocomplete
                options={options}
                loading={contracts.isLoading}
                value={selected}
                onChange={(_, v) => {
                  setContractId(v?.id ?? "");
                  setLineId("");
                  setForm((f) => ({ ...f, ...(v?.currency ? { currency: v.currency } : {}), deliveryMonth: v?.deliveryMonth ?? "" }));
                  // After a B/L read, keep its commodity / size and pick the line by grade.
                  const byGrade = source?.draft ? lineForGrade(v?.lines ?? [], source.draft.grade) : null;
                  if (byGrade) {
                    setLineId(byGrade.id);
                    setFilled((f) => new Set(f).add("contractLineId"));
                  } else if (v?.lines?.length === 1 && !source?.draft) pickLine(v.lines[0]);
                }}
                getOptionLabel={(o) => `${o.contractNo}${o.customer?.name ? ` · ${o.customer.name}` : ""}`}
                isOptionEqualToValue={(a, b) => a.id === b.id}
                noOptionsText="No open contracts — create a contract first"
                renderInput={(p) => <TextField {...p} label="Contract" required size="small" error={touched && !contractId} helperText={touched && !contractId ? "Required" : undefined} />}
              />
            ) : (
              <TextField label="Contract" fullWidth size="small" value={contractLabel ?? ""} disabled />
            )}
          </Grid2>
          <Grid2 size={{ xs: 12, sm: 6 }}>
            <TextField label="Customer" fullWidth size="small" value={customerName ?? ""} disabled placeholder="From the contract" InputLabelProps={{ shrink: true }} />
          </Grid2>
            </>
          )}

          <Grid2 size={{ xs: 12, sm: 8 }}>
            <TextField
              select
              label="Product line"
              fullWidth
              size="small"
              required={lineRequired}
              disabled={!lineRequired}
              value={lineId}
              sx={filledSx(filled.has("contractLineId"))}
              onChange={(e) => {
                unfill("contractLineId");
                const l = lines.find((x) => x.id === e.target.value) ?? null;
                // After a B/L read the B/L's commodity / size stay; otherwise the line prefills them.
                if (source?.draft) setLineId(l?.id ?? "");
                else pickLine(l);
              }}
              error={touched && lineRequired && !lineId}
              helperText={
                !contractId ? "Pick the contract first" : !lineRequired ? "This contract has no product lines" : touched && !lineId ? "Required — which contract line does this B/L ship?" : undefined
              }
            >
              {lines.map((l, i) => (
                <MenuItem key={l.id} value={l.id}>
                  {i + 1}. {lineLabel(l)}
                </MenuItem>
              ))}
            </TextField>
          </Grid2>
          <Grid2 size={{ xs: 12, sm: 4 }}>
            {tf("deliveryMonth", "Delivery month", { type: "month", InputLabelProps: { shrink: true }, error: monthError, helperText: monthError ? "Use YYYY-MM" : undefined })}
          </Grid2>

          <Grid2 size={12}>
            <Divider textAlign="left">
              <Typography variant="caption" color="text.secondary">
                Vessel
              </Typography>
            </Divider>
          </Grid2>
          <Grid2 size={{ xs: 12, sm: 3 }}>{tf("blNumber", "B/L no.", { autoFocus: !inline })}</Grid2>
          <Grid2 size={{ xs: 12, sm: 3 }}>{tf("shippingLine", "Shipping line")}</Grid2>
          <Grid2 size={{ xs: 12, sm: 3 }}>{tf("vessel", "Vessel")}</Grid2>
          <Grid2 size={{ xs: 12, sm: 3 }}>{tf("voyageNo", "Voyage no.")}</Grid2>
          <Grid2 size={{ xs: 12, sm: 4 }}>{tf("etd", "ETD", { type: "date", InputLabelProps: { shrink: true } })}</Grid2>
          <Grid2 size={{ xs: 12, sm: 4 }}>
            {tf("eta", "Latest ETA", { type: "date", InputLabelProps: { shrink: true }, error: datesError, helperText: datesError ? "ETA is before ETD" : undefined })}
          </Grid2>
          <Grid2 size={{ xs: 12, sm: 4 }}>{tf("actualArrivalDate", "Actual arrival", { type: "date", InputLabelProps: { shrink: true } })}</Grid2>
          <Grid2 size={{ xs: 12, sm: 4 }}>{tf("portOfLoading", "Port of loading")}</Grid2>
          <Grid2 size={{ xs: 12, sm: 4 }}>{tf("portOfDischarge", "Port of discharge")}</Grid2>
          <Grid2 size={{ xs: 12, sm: 4 }}>{tf("telexReleaseCode", "Telex release code")}</Grid2>

          <Grid2 size={12}>
            <Divider textAlign="left">
              <Typography variant="caption" color="text.secondary">
                Cargo
              </Typography>
            </Divider>
          </Grid2>
          <Grid2 size={{ xs: 6, sm: 3 }}>{tf("netWeightMt", "Net weight (MT)", { type: "number", inputProps: { min: 0, step: "0.001" }, error: badDecimal(form.netWeightMt) })}</Grid2>
          <Grid2 size={{ xs: 6, sm: 3 }}>{tf("grossWeightMt", "Gross weight (MT)", { type: "number", inputProps: { min: 0, step: "0.001" }, error: badDecimal(form.grossWeightMt) })}</Grid2>
          <Grid2 size={{ xs: 6, sm: 3 }}>{tf("totalBundles", "Bundles", { type: "number", inputProps: { min: 0, step: 1 }, error: badInt(form.totalBundles) })}</Grid2>
          <Grid2 size={{ xs: 6, sm: 3 }}>{tf("totalPieces", "Pieces", { type: "number", inputProps: { min: 0, step: 1 }, error: badInt(form.totalPieces) })}</Grid2>
          <Grid2 size={{ xs: 6, sm: 3 }}>{tf("containerCount", "Containers", { type: "number", inputProps: { min: 0, step: 1 }, error: badInt(form.containerCount) })}</Grid2>
          <Grid2 size={{ xs: 6, sm: 3 }}>{tf("hsCode", "HS code")}</Grid2>
          <Grid2 size={{ xs: 12, sm: 6 }}>{tf("countryOfOrigin", "Country of origin")}</Grid2>
          <Grid2 size={{ xs: 12, sm: 6 }}>{tf("commodity", "Commodity")}</Grid2>
          <Grid2 size={{ xs: 12, sm: 6 }}>{tf("sizeSpec", "Size / spec")}</Grid2>

          <Grid2 size={12}>
            <Divider textAlign="left">
              <Typography variant="caption" color="text.secondary">
                Commercial invoice
              </Typography>
            </Divider>
          </Grid2>
          <Grid2 size={{ xs: 12, sm: 4 }}>{tf("ciNumber", "CI no.")}</Grid2>
          <Grid2 size={{ xs: 12, sm: 4 }}>{tf("ciAmount", "CI amount", { type: "number", inputProps: { min: 0, step: "0.01" }, error: badDecimal(form.ciAmount) })}</Grid2>
          <Grid2 size={{ xs: 12, sm: 4 }}>
            <TextField
              label="Currency"
              fullWidth
              size="small"
              value={form.currency}
              onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value.toUpperCase().slice(0, 3) }))}
              error={currencyError}
              helperText={currencyError ? "3-letter code, e.g. USD" : undefined}
            />
          </Grid2>
          <Grid2 size={12}>{tf("notes", "Notes", { multiline: true, minRows: 2 })}</Grid2>
        </Grid2>
        </Grid2>
        {(source || readingFile) && (
          <Grid2 size={side ? 6 : 12} sx={{ order: side ? 0 : -1 }}>
            <SourcePdfPane fileId={source?.fileId} fileName={source?.fileName} file={readingFile} stacked={!side} />
            {source?.draft?.containers?.length ? (
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
                Containers: {source.draft.containers.map((c) => c.containerNo).filter(Boolean).join(", ")}
              </Typography>
            ) : null}
          </Grid2>
        )}
        </Grid2>
      </>
  );
  const actions = (
    <>
        <Button onClick={cancel} disabled={save.isPending || reading}>
          {inline ? "Reset" : "Cancel"}
        </Button>
        <Button variant="contained" onClick={submit} disabled={save.isPending || reading}>
          {save.isPending ? "Saving…" : inline ? "Save B/L details" : shipment ? "Save changes" : "Create shipment"}
        </Button>
      </>
  );

  if (inline) {
    return (
      <Box>
        {body}
        <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 1, mt: 2 }}>{actions}</Box>
      </Box>
    );
  }

  return (
    <Dialog open={open} onClose={() => !save.isPending && !reading && cancel()} maxWidth={source || readingFile ? "xl" : "md"} fullWidth>
      <DialogTitle>{shipment ? `Edit shipment ${shipment.blNumber ?? ""}`.trim() : "New shipment"}</DialogTitle>
      <DialogContent dividers>{body}</DialogContent>
      <DialogActions>{actions}</DialogActions>
    </Dialog>
  );
}
