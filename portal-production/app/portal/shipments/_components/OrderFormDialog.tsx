/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

// New Order / Edit order. An order (ADH's "#19") is one customer, one ship
// month → delivery month, one product and quantity. The contract (yearly LTC)
// is optional; picking it fills customer / supplier and the premiums from its
// line of the same grade — premiums stay editable (the client premium changes
// per order). "Fill from PI" reads a Vedanta PI with AI and fills the form
// (the PI is linked to step 1); the order number defaults to the next free one
// of the year. Shipments are added on the order page ("Add shipment").

import React, { useEffect, useMemo, useState } from "react";
import { Alert, Autocomplete, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Grid, MenuItem, TextField, Typography, useMediaQuery } from "@mui/material";
import { toast } from "../_lib/toast";
import { useShipmentsApi, type Contract, type Order, type OrderInput, type PiExtraction } from "../_lib/api";
import { useContracts, useCustomers, useSuppliers, useTradeMutation } from "../_lib/hooks";
import { filledSx, PdfDropZone, SourcePdfPane } from "./PdfDrop";

type Form = Record<
  | "year"
  | "orderNo"
  | "contractId"
  | "customerId"
  | "supplierId"
  | "shipMonth"
  | "deliveryMonth"
  | "product"
  | "grade"
  | "size"
  | "qtyMt"
  | "tolPct"
  | "supplierPremium"
  | "clientPremium"
  | "upcharge"
  | "piNo"
  | "piDate"
  | "piAmount"
  | "depositPct",
  string
>;

const EMPTY: Form = {
  year: "",
  orderNo: "",
  contractId: "",
  customerId: "",
  supplierId: "",
  shipMonth: "",
  deliveryMonth: "",
  product: "Aluminium Billet",
  grade: "",
  size: "",
  qtyMt: "",
  tolPct: "5",
  supplierPremium: "",
  clientPremium: "",
  upcharge: "",
  piNo: "",
  piDate: "",
  piAmount: "",
  depositPct: "10",
};

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const numOrNull = (v: string) => (v.trim() === "" ? null : Number(v));
const day = (v: string | null | undefined) => (v ? String(v).slice(0, 10) : "");

export default function OrderFormDialog({
  open,
  onClose,
  onSaved,
  order,
  prefill,
}: {
  open: boolean;
  onClose: () => void;
  onSaved?: (o: Order) => void;
  order?: Order | null;
  /** A finished PI read (bulk "New orders from PIs") to start from. */
  prefill?: (PiExtraction & { fileName?: string }) | null;
}) {
  const api = useShipmentsApi();
  const wide = useMediaQuery("(min-width:1200px)");
  const contracts = useContracts({ pageSize: 100 }, open);
  const customers = useCustomers(open);
  const suppliers = useSuppliers(open);
  const [form, setForm] = useState<Form>(EMPTY);
  const [filled, setFilled] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [contract, setContract] = useState<Contract | null>(null);
  const [premiumTouched, setPremiumTouched] = useState(false);
  const [reading, setReading] = useState(false);
  const [readingFile, setReadingFile] = useState<File | null>(null);
  const [source, setSource] = useState<{ fileId: string; fileName: string; owned: boolean; existingOrder?: { id: string; label: string } | null } | null>(null);
  const save = useTradeMutation((a, body: OrderInput) => (order ? a.updateOrder(order.id, body) : a.createOrder(body)));

  useEffect(() => {
    if (!open) return;
    setError(null);
    setFilled(new Set());
    setSource(null);
    setPremiumTouched(!!order);
    if (order) {
      setForm({
        year: str(order.year),
        orderNo: str(order.orderNo),
        contractId: order.contractId ?? "",
        customerId: order.customerId,
        supplierId: order.supplierId,
        shipMonth: order.shipMonth ?? "",
        deliveryMonth: order.deliveryMonth ?? "",
        product: order.product ?? "",
        grade: order.grade ?? "",
        size: order.size ?? "",
        qtyMt: str(order.qtyMt),
        tolPct: str(order.tolPct),
        supplierPremium: str(order.supplierPremium),
        clientPremium: str(order.clientPremium),
        upcharge: str(order.upcharge),
        piNo: order.piNo ?? "",
        piDate: day(order.piDate),
        piAmount: str(order.piAmount),
        depositPct: str(order.depositPct),
      });
    } else {
      const y = new Date().getFullYear();
      setForm({ ...EMPTY, year: String(y) });
      void api
        .nextOrderNo(y)
        .then((n) => setForm((f) => (f.orderNo ? f : { ...f, orderNo: String(n.orderNo) })))
        .catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, order?.id]);

  // Bulk "New orders from PIs": start from that PI read (once the contracts list is in, to match the contract no.).
  useEffect(() => {
    if (open && prefill?.result && !order && contracts.data) applyPi(prefill as any);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, prefill?.fileId, contracts.data]);

  // The picked contract's lines (premium defaults).
  useEffect(() => {
    if (!form.contractId) return setContract(null);
    let live = true;
    void api
      .getContract(form.contractId)
      .then((c) => live && setContract(c))
      .catch(() => live && setContract(null));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.contractId]);

  // Contract picked / grade changed: parties and premiums default from it (typed premiums win).
  useEffect(() => {
    if (!contract) return;
    const line = contract.lines.find((l) => form.grade && l.grade === form.grade) ?? (contract.lines.length === 1 ? contract.lines[0] : null);
    setForm((f) => ({
      ...f,
      customerId: f.customerId || contract.customerId,
      supplierId: f.supplierId || contract.supplierId,
      grade: f.grade || line?.grade || "",
      size: f.size || line?.sizeSpec || "",
      product: f.product || line?.product || "",
      ...(premiumTouched || !line
        ? {}
        : {
            supplierPremium: str(line.supplierPremium),
            clientPremium: str((line as any).billetPremium ?? line.clientPremium),
            upcharge: str((line as any).upcharge),
          }),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contract, form.grade]);

  // The year follows the ship month (new orders): the next free number of that year.
  useEffect(() => {
    if (order || !/^\d{4}-\d{2}$/.test(form.shipMonth)) return;
    const y = form.shipMonth.slice(0, 4);
    if (y === form.year) return;
    setForm((f) => ({ ...f, year: y }));
    void api
      .nextOrderNo(Number(y))
      .then((n) => setForm((f) => ({ ...f, orderNo: String(n.orderNo) })))
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.shipMonth]);

  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    if (k === "supplierPremium" || k === "clientPremium" || k === "upcharge") setPremiumTouched(true);
    setFilled((f) => {
      if (!f.has(k)) return f;
      const n = new Set(f);
      n.delete(k);
      return n;
    });
    setForm((f) => ({ ...f, [k]: v }));
  };

  const applyPi = (x: PiExtraction) => {
    const d = x.result!.draft;
    const line = d.lines?.[0];
    const contractId = d.contractNo ? (contracts.data?.items ?? []).find((c) => c.contractNo === d.contractNo)?.id : undefined;
    const patch: Partial<Form> = {
      piNo: d.piNumber ?? "",
      piDate: d.piDate ?? "",
      piAmount: str(d.piAmount),
      depositPct: str(d.depositPercent ?? 10),
      shipMonth: d.shipmentMonth ?? "",
      supplierId: d.supplierId ?? "",
      ...(d.customerId ? { customerId: d.customerId } : {}),
      ...(contractId ? { contractId } : {}),
      grade: line?.grade ?? "",
      size: line?.sizeSpec ?? "",
      product: line?.product ?? "Aluminium Billet",
      qtyMt: str(line?.quantityMt),
      tolPct: str(line?.tolerancePct ?? 5),
      supplierPremium: str(line?.supplierPremium),
    };
    const keys = Object.entries(patch)
      .filter(([, v]) => v !== "")
      .map(([k]) => k);
    setForm((f) => ({ ...f, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== "")) }));
    setFilled(new Set(keys));
    // A PI from the bulk dialog belongs to that dialog (it removes unsaved ones); one read here is ours.
    setSource({ fileId: x.fileId, fileName: (x as any).fileName ?? "PI", owned: !prefill, existingOrder: (x.result as any)?.existingOrder ?? null });
    if (d.contractNo && !contractId) toast.info(`Contract ${d.contractNo} isn't in the master files yet — the order can be saved without it (link it on step 0).`);
  };

  const readPi = async (file: File) => {
    if (source?.owned) void api.discardSource(source.fileId).catch(() => undefined);
    setReading(true);
    setReadingFile(file);
    setError(null);
    try {
      const x = await api.extractPi({ file });
      if (x.status !== "DONE" || !x.result) {
        setError(`Could not read ${file.name}: ${x.error || "unknown error"}. The PI was stored — fill the form by hand.`);
        setSource({ fileId: x.fileId, fileName: file.name, owned: true });
      } else applyPi({ ...x, fileName: file.name } as any);
    } catch (e: any) {
      setError(e?.message || "Could not read the PI");
    } finally {
      setReading(false);
      setReadingFile(null);
    }
  };

  const cancel = () => {
    if (source?.owned && !order) void api.discardSource(source.fileId).catch(() => undefined);
    setSource(null);
    onClose();
  };

  const submit = async () => {
    setError(null);
    if (!form.customerId) return setError("Pick the customer (or a contract)");
    if (!form.supplierId) return setError("Pick the supplier (or a contract)");
    const body: OrderInput = {
      year: numOrNull(form.year) ?? undefined,
      orderNo: numOrNull(form.orderNo) ?? undefined,
      contractId: form.contractId || null,
      customerId: form.customerId,
      supplierId: form.supplierId,
      shipMonth: form.shipMonth || null,
      deliveryMonth: form.deliveryMonth || null,
      product: form.product || null,
      grade: form.grade || null,
      size: form.size || null,
      qtyMt: numOrNull(form.qtyMt),
      tolPct: numOrNull(form.tolPct),
      supplierPremium: numOrNull(form.supplierPremium),
      clientPremium: numOrNull(form.clientPremium),
      upcharge: numOrNull(form.upcharge),
      piNo: form.piNo || null,
      piDate: form.piDate || null,
      piAmount: numOrNull(form.piAmount),
      depositPct: numOrNull(form.depositPct),
      ...(source && !order ? { piFileId: source.fileId } : {}),
    };
    try {
      const o = await save.mutateAsync(body);
      toast.success(order ? `Order ${o.label} saved` : `Order ${o.label} created`);
      setSource(null);
      onSaved?.(o);
      onClose();
    } catch (e: any) {
      setError(e?.message || "Could not save the order");
    }
  };

  const contractOptions = useMemo(() => contracts.data?.items ?? [], [contracts.data]);
  const side = (!!source || !!readingFile) && wide;
  const field = (k: keyof Form, label: string, props: Record<string, any> = {}) => (
    <TextField fullWidth size="small" label={label} value={form[k]} onChange={set(k)} sx={filledSx(filled.has(k))} {...props} />
  );

  return (
    <Dialog open={open} onClose={() => !save.isPending && !reading && cancel()} maxWidth={side ? "xl" : "md"} fullWidth>
      <DialogTitle>{order ? `Edit order ${order.label}` : "New Order"}</DialogTitle>
      <DialogContent dividers>
        <Grid container spacing={2}>
          <Grid item xs={12} md={side ? 6 : 12}>
            {!order && <PdfDropZone title="Fill from PI — drop Vedanta's PI here" busy={reading} busyText="Reading the PI…" onFiles={(f) => void readPi(f[0])} dataTour="order-fill-from-pi" />}
            {source?.existingOrder && (
              <Alert severity="warning" sx={{ mt: 1.5 }}>
                This PI is already on order {source.existingOrder.label}.
              </Alert>
            )}
            {error && (
              <Alert severity="error" sx={{ mt: 1.5 }}>
                {error}
              </Alert>
            )}
            <Grid container spacing={1.5} sx={{ mt: 0.5 }}>
              <Grid item xs={6} sm={3}>
                {field("year", "Year", { type: "number" })}
              </Grid>
              <Grid item xs={6} sm={3}>
                {field("orderNo", "Order no. (#)", { type: "number", helperText: form.orderNo ? `#${form.orderNo}` : " " })}
              </Grid>
              <Grid item xs={12} sm={6}>
                <Autocomplete
                  size="small"
                  options={contractOptions}
                  value={contractOptions.find((c) => c.id === form.contractId) ?? null}
                  onChange={(_, c) => {
                    setPremiumTouched(false);
                    setForm((f) => ({ ...f, contractId: c?.id ?? "" }));
                  }}
                  getOptionLabel={(c) => [c.contractNo, c.customer?.name].filter(Boolean).join(" · ")}
                  isOptionEqualToValue={(a, b) => a.id === b.id}
                  renderInput={(p) => <TextField {...p} label="Contract (optional)" helperText="Premiums default from its line" />}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField select fullWidth size="small" label="Customer" value={form.customerId} onChange={set("customerId")} sx={filledSx(filled.has("customerId"))}>
                  {(customers.data ?? []).map((c) => (
                    <MenuItem key={c.id} value={c.id}>
                      {c.name}
                    </MenuItem>
                  ))}
                </TextField>
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField select fullWidth size="small" label="Supplier" value={form.supplierId} onChange={set("supplierId")} sx={filledSx(filled.has("supplierId"))}>
                  {(suppliers.data ?? []).map((c) => (
                    <MenuItem key={c.id} value={c.id}>
                      {c.name}
                    </MenuItem>
                  ))}
                </TextField>
              </Grid>
              <Grid item xs={6}>
                {field("shipMonth", "Ship month", { type: "month", InputLabelProps: { shrink: true } })}
              </Grid>
              <Grid item xs={6}>
                {field("deliveryMonth", "Delivery month", { type: "month", InputLabelProps: { shrink: true } })}
              </Grid>
              <Grid item xs={12} sm={4}>
                {field("product", "Product")}
              </Grid>
              <Grid item xs={6} sm={4}>
                {field("grade", "Grade", { placeholder: "6005 / 6063 / P1020" })}
              </Grid>
              <Grid item xs={6} sm={4}>
                {field("size", "Size", { placeholder: "203 MM X 5800 MM" })}
              </Grid>
              <Grid item xs={6} sm={4}>
                {field("qtyMt", "Quantity (MT)", { type: "number" })}
              </Grid>
              <Grid item xs={6} sm={4}>
                {field("tolPct", "Tolerance ±%", { type: "number" })}
              </Grid>
              <Grid item xs={12}>
                <Typography variant="overline" color="text.secondary">
                  Premiums (USD/MT, fixed part — QMJP is added by quarter){contract ? ` — default from contract ${contract.contractNo}` : ""}
                </Typography>
              </Grid>
              <Grid item xs={4}>
                {field("supplierPremium", "Supplier premium", { type: "number", helperText: "Fixed part (6063 +205): a PI's 556.50 = QMJP 351.5 + 205" })}
              </Grid>
              <Grid item xs={4}>
                {field("clientPremium", "Client premium", { type: "number", helperText: "Fixed billet premium (6063 +230)" })}
              </Grid>
              <Grid item xs={4}>
                {field("upcharge", "Upcharge", { type: "number" })}
              </Grid>
              <Grid item xs={12}>
                <Typography variant="overline" color="text.secondary">
                  PI
                </Typography>
              </Grid>
              <Grid item xs={6} sm={3}>
                {field("piNo", "PI no.")}
              </Grid>
              <Grid item xs={6} sm={3}>
                {field("piDate", "PI date", { type: "date", InputLabelProps: { shrink: true } })}
              </Grid>
              <Grid item xs={6} sm={3}>
                {field("piAmount", "PI amount (USD)", { type: "number" })}
              </Grid>
              <Grid item xs={6} sm={3}>
                {field("depositPct", "Deposit %", { type: "number" })}
              </Grid>
            </Grid>
          </Grid>
          {(source || readingFile) && (
            <Grid item xs={12} md={side ? 6 : 12}>
              <Box>
                <SourcePdfPane fileId={source?.fileId} fileName={source?.fileName} file={readingFile} stacked={!side} />
              </Box>
            </Grid>
          )}
        </Grid>
      </DialogContent>
      <DialogActions>
        <Button onClick={cancel} disabled={save.isPending || reading}>
          Cancel
        </Button>
        <Button variant="contained" onClick={() => void submit()} disabled={save.isPending || reading} data-tour="order-save">
          {save.isPending ? "Saving…" : order ? "Save" : "Create order"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
