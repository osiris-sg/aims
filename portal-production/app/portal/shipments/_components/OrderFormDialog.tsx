/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { shortParty } from "../_lib/format";

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
import { defaultDeliveryMonth, premiumHelp, premiumRowFor } from "../_lib/order-form";
import { useShipmentsApi, type Contract, type Order, type OrderInput, type PiExtraction, type PiOrderHint } from "../_lib/api";
import { useRouter } from "next/navigation";
import { fmtDay, fmtMt, monthShort } from "../_lib/format";
import { useReopenOrder } from "./OrderReopen";
import { useContracts, useCustomers, useSuppliers, useTradeMutation } from "../_lib/hooks";
import { filledSx, PdfDropZone, SourcePdfPane } from "./PdfDrop";
import AddFlowProductPicker, { orderFieldsFrom } from "./AddFlowProductPicker";
import { useTranslations } from "next-intl";
import { useUiLang } from "@/i18n/UiLangProvider";

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
  | "depositPct"
  | "depositAmount"
  | "depositDueDate"
  | "customerPoNo"
  | "customerPoDate",
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
  depositAmount: "",
  depositDueDate: "",
  customerPoNo: "",
  customerPoDate: "",
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
  seed,
}: {
  open: boolean;
  onClose: () => void;
  onSaved?: (o: Order) => void;
  order?: Order | null;
  /** A finished PI read (bulk "New orders from PIs") to start from. */
  prefill?: (PiExtraction & { fileName?: string }) | null;
  /** Round Q: "Create order from this thread" without a PI — the thread's keys and subject cues. */
  seed?: { piNo?: string | null; contractNo?: string | null; grade?: string | null; qtyMt?: number | null; customerKey?: string | null; deliveryMonth?: string | null } | null;
}) {
  const t = useTranslations("shipments.orderFormDialog");
  const { lang } = useUiLang();
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
  // Round N: the delivery month follows the ship month (+2) until typed.
  const [deliveryTouched, setDeliveryTouched] = useState(false);
  const [reading, setReading] = useState(false);
  const [readingFile, setReadingFile] = useState<File | null>(null);
  const [source, setSource] = useState<{ fileId: string; fileName: string; owned: boolean; existingOrder?: PiOrderHint | null; likeOrders?: PiOrderHint[] } | null>(null);
  // Round BF: the number is taken — which order holds it ([Open] / [Reopen]) and the next free number.
  const [taken, setTaken] = useState<{ order: { id: string; label: string; status: string; what: string }; nextFreeOrderNo: number } | null>(null);
  const tr = useTranslations("orders.reopen");
  const router = useRouter();
  const save = useTradeMutation((a, body: OrderInput) => (order ? a.updateOrder(order.id, body) : a.createOrder(body)));

  useEffect(() => {
    if (!open) return;
    setError(null);
    setTaken(null);
    setFilled(new Set());
    setSource(null);
    setPremiumTouched(!!order);
    setDeliveryTouched(!!order);
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
        depositAmount: str(order.depositAmount),
        // Round BP: only a date stored from the PI is editable here (the term-based one is computed).
        depositDueDate: order.depositDueFromPi ? day(order.depositDueDate) : "",
        customerPoNo: order.customerPoNo ?? "",
        customerPoDate: day(order.customerPoDate),
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
    if (open && prefill?.result && !order && contracts.data) {
      applyPi(prefill as any);
      // Round AF: the thread's seed fills what the PI left blank (grade / quantity / PI no. / month).
      if (seed) setForm((f) => ({ ...f, ...(!f.piNo && seed.piNo ? { piNo: seed.piNo } : {}), ...(!f.grade && seed.grade ? { grade: seed.grade } : {}), ...(!f.qtyMt && seed.qtyMt != null ? { qtyMt: String(seed.qtyMt) } : {}), ...(!f.deliveryMonth && seed.deliveryMonth ? { deliveryMonth: seed.deliveryMonth } : {}) }));
    } else if (open && seed && !order && !prefill) {
      // The thread's keys / subject cues; the contract by its number when it exists.
      const c = seed.contractNo ? (contracts.data?.items ?? []).find((x: any) => x.contractNo === seed.contractNo) : null;
      setForm((f) => ({
        ...f,
        ...(seed.piNo ? { piNo: seed.piNo } : {}),
        ...(c ? { contractId: c.id, customerId: c.customer?.id ?? f.customerId } : {}),
        ...(seed.grade ? { grade: seed.grade } : {}),
        ...(seed.qtyMt != null ? { qtyMt: String(seed.qtyMt) } : {}),
        ...(seed.deliveryMonth ? { deliveryMonth: seed.deliveryMonth } : {}),
      }));
    }
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
  const scheduleRow = contract ? premiumRowFor((contract as any).premiumSchedule, form.shipMonth || null, form.grade || null) : null;
  const help = premiumHelp(contract?.contractNo, scheduleRow, form.grade, lang);
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
      ...(premiumTouched || (!line && !scheduleRow)
        ? {}
        : // Round N: the contract's premium row for this grade + ship month wins over the line's (Kato 6005: +260 / +285).
          {
            supplierPremium: str(scheduleRow?.supplierPremium ?? line?.supplierPremium),
            clientPremium: str(scheduleRow?.clientPremium ?? (line as any)?.billetPremium ?? line?.clientPremium),
            upcharge: str(scheduleRow?.upcharge ?? (line as any)?.upcharge),
          }),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contract, form.grade, form.shipMonth]);

  // Round N: delivery month = ship month + 2 (SUS and Kato) until the user types one; "Fill from PI" sets the ship month.
  useEffect(() => {
    if (order || deliveryTouched) return;
    const d = defaultDeliveryMonth(form.shipMonth);
    if (d && d !== form.deliveryMonth) setForm((f) => ({ ...f, deliveryMonth: d }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.shipMonth]);

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
    if (k === "deliveryMonth") setDeliveryTouched(true);
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
    // Round BP: a PI shared by several orders — this order's line (the grade already on the form), else the first.
    const lines = d.lines ?? [];
    const line = (form.grade && lines.find((l) => l.grade === form.grade)) || lines[0];
    const shared = lines.length > 1;
    const contractId = d.contractNo ? (contracts.data?.items ?? []).find((c) => c.contractNo === d.contractNo)?.id : undefined;
    const patch: Partial<Form> = {
      piNo: d.piNumber ?? "",
      piDate: d.piDate ?? "",
      piAmount: str((line as any)?.amount ?? (shared ? null : d.piAmount)),
      depositPct: str(d.depositPercent ?? 10),
      // The PI's Amount Payable for this line, and "Instrument to be received by".
      depositAmount: str((line as any)?.amountPayable ?? (shared ? null : d.depositAmount)),
      depositDueDate: (d as any).depositDueDate ?? "",
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
    setSource({ fileId: x.fileId, fileName: (x as any).fileName ?? "PI", owned: !prefill, existingOrder: x.result?.existingOrder ?? null, likeOrders: x.result?.likeOrders ?? [] });
    if (d.contractNo && !contractId) toast.info(t("contractMissing", { no: d.contractNo }));
  };

  const readPi = async (file: File) => {
    if (source?.owned) void api.discardSource(source.fileId).catch(() => undefined);
    setReading(true);
    setReadingFile(file);
    setError(null);
    try {
      const x = await api.extractPi({ file });
      if (x.status !== "DONE" || !x.result) {
        setError(t("readFailed", { file: file.name, error: x.error || t("unknownError") }));
        setSource({ fileId: x.fileId, fileName: file.name, owned: true });
      } else applyPi({ ...x, fileName: file.name } as any);
    } catch (e: any) {
      setError(e?.message || t("couldNotReadPi"));
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
    setTaken(null);
    if (!form.customerId) return setError(t("pickCustomer"));
    if (!form.supplierId) return setError(t("pickSupplier"));
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
      // Round BP: an empty deposit on a NEW order lets the server compute it from the %; on an edit, empty clears it.
      ...(form.depositAmount !== "" ? { depositAmount: numOrNull(form.depositAmount) } : order ? { depositAmount: null } : {}),
      depositDueDate: form.depositDueDate || null,
      customerPoNo: form.customerPoNo || null,
      customerPoDate: form.customerPoDate || null,
      ...(source && !order ? { piFileId: source.fileId } : {}),
    };
    try {
      const o = await save.mutateAsync(body);
      toast.success(order ? t("saved", { label: o.label }) : t("created", { label: o.label }));
      setSource(null);
      onSaved?.(o);
      onClose();
    } catch (e: any) {
      if (e?.code === "ORDER_NO_TAKEN" && e?.details?.order) setTaken({ order: e.details.order, nextFreeOrderNo: e.details.nextFreeOrderNo });
      else setError(e?.message || t("couldNotSave"));
    }
  };

  // Round BF: [Open #30] / [Reopen #30] from the form — leave the form (an unsaved PI read is discarded) for that order.
  const reopenAsk = useReopenOrder({ openAfter: true, onDone: () => cancel() });
  const openOrder = (id: string) => {
    cancel();
    router.push(`/portal/shipments/orders/${id}`);
  };
  const orderButtons = (o: { id: string; label: string; status: string }) => (
    <Box sx={{ display: "flex", gap: 1, mt: 1, flexWrap: "wrap" }}>
      <Button size="small" variant="outlined" color="inherit" onClick={() => openOrder(o.id)} data-tour="order-form-open-existing">
        {tr("openLabel", { label: o.label })}
      </Button>
      {o.status === "CANCELLED" && (
        <Button size="small" variant="contained" color="warning" onClick={() => reopenAsk.ask({ id: o.id, label: o.label })} data-tour="order-form-reopen">
          {tr("reopenLabel", { label: o.label })}
        </Button>
      )}
    </Box>
  );
  const hintLine = (h: PiOrderHint) => ({
    label: h.label,
    status: tr(`status.${h.status}`),
    grade: h.grade ?? "—",
    qty: h.qtyMt !== null ? fmtMt(h.qtyMt) : "—",
    month: h.shipMonth ? monthShort(h.shipMonth) : tr("noMonth"),
  });

  const contractOptions = useMemo(() => contracts.data?.items ?? [], [contracts.data]);
  const side = (!!source || !!readingFile) && wide;
  const field = (k: keyof Form, label: string, props: Record<string, any> = {}) => (
    <TextField fullWidth size="small" label={label} value={form[k]} onChange={set(k)} sx={filledSx(filled.has(k))} {...props} />
  );

  return (
    <Dialog open={open} onClose={() => !save.isPending && !reading && cancel()} maxWidth={side ? "xl" : "md"} fullWidth>
      <DialogTitle>{order ? t("editTitle", { label: order.label }) : t("newTitle")}</DialogTitle>
      <DialogContent dividers>
        <Grid container spacing={2}>
          <Grid item xs={12} md={side ? 6 : 12}>
            {!order && <PdfDropZone title={t("fillFromPi")} busy={reading} busyText={t("readingPi")} onFiles={(f) => void readPi(f[0])} dataTour="order-fill-from-pi" />}
            {source?.existingOrder && (
              <Alert severity="warning" sx={{ mt: 1.5 }} data-tour="order-form-pi-on-order">
                {source.existingOrder.createdByName
                  ? tr("piOnOrder", { pi: form.piNo || "", label: source.existingOrder.label, by: source.existingOrder.createdByName, date: fmtDay(source.existingOrder.createdAt) })
                  : tr("piOnOrderNoBy", { pi: form.piNo || "", label: source.existingOrder.label, date: fmtDay(source.existingOrder.createdAt) })}
                {source.existingOrder.status === "CANCELLED" && <> {tr("piOnCancelled")}</>}
                {orderButtons(source.existingOrder)}
              </Alert>
            )}
            {!source?.existingOrder &&
              (source?.likeOrders ?? []).map((h) => (
                <Alert key={h.id} severity={h.status === "CANCELLED" ? "warning" : "info"} sx={{ mt: 1.5 }} data-tour="order-form-like-order">
                  {tr(h.status === "CANCELLED" ? "likeOrderCancelled" : "likeOrder", hintLine(h))}
                  {orderButtons(h)}
                </Alert>
              ))}
            {taken && (
              <Alert severity="error" sx={{ mt: 1.5 }} data-tour="order-form-number-taken">
                {tr(taken.order.status === "CANCELLED" ? "takenCancelled" : "takenOther", { label: taken.order.label, what: taken.order.what })}
                <Box sx={{ display: "flex", gap: 1, mt: 1, flexWrap: "wrap" }}>
                  <Button
                    size="small"
                    variant="contained"
                    onClick={() => {
                      setForm((f) => ({ ...f, orderNo: String(taken.nextFreeOrderNo) }));
                      setTaken(null);
                    }}
                  >
                    {tr("useNext", { no: taken.nextFreeOrderNo })}
                  </Button>
                  <Button size="small" variant="outlined" color="inherit" onClick={() => openOrder(taken.order.id)}>
                    {tr("openLabel", { label: taken.order.label })}
                  </Button>
                  {taken.order.status === "CANCELLED" && (
                    <Button size="small" variant="outlined" color="warning" onClick={() => reopenAsk.ask({ id: taken.order.id, label: taken.order.label })}>
                      {tr("reopenLabel", { label: taken.order.label })}
                    </Button>
                  )}
                </Box>
              </Alert>
            )}
            {reopenAsk.dialog}
            {error && (
              <Alert severity="error" sx={{ mt: 1.5 }}>
                {error}
              </Alert>
            )}
            <Grid container spacing={1.5} sx={{ mt: 0.5 }}>
              <Grid item xs={6} sm={3}>
                {field("year", t("year"), { type: "number" })}
              </Grid>
              <Grid item xs={6} sm={3}>
                {field("orderNo", t("orderNo"), { type: "number", helperText: form.orderNo ? `#${form.orderNo}` : " " })}
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
                  renderInput={(p) => <TextField {...p} label={t("contract")} helperText={t("contractHelp")} />}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField select fullWidth size="small" label={t("customer")} value={form.customerId} onChange={set("customerId")} sx={filledSx(filled.has("customerId"))}>
                  {(customers.data ?? []).map((c) => (
                    <MenuItem key={c.id} value={c.id}>
                      {c.name}
                    </MenuItem>
                  ))}
                </TextField>
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField select fullWidth size="small" label={t("supplier")} value={form.supplierId} onChange={set("supplierId")} sx={filledSx(filled.has("supplierId"))}>
                  {(suppliers.data ?? []).map((c) => (
                    <MenuItem key={c.id} value={c.id}>
                      {c.name}
                    </MenuItem>
                  ))}
                </TextField>
              </Grid>
              {/* Round BA: the customer's products (Clients › Products) fill product / grade / size; fitting suppliers below. */}
              {form.customerId && (
                <Grid item xs={12}>
                  <AddFlowProductPicker
                    open={open}
                    customerId={form.customerId}
                    supplierId={form.supplierId}
                    suppliers={suppliers.data ?? []}
                    onPick={(p) => {
                      const x = orderFieldsFrom(p);
                      setForm((f) => ({ ...f, grade: x.grade || f.grade, size: x.size || f.size, product: x.product ?? f.product }));
                    }}
                    onSupplier={(id) => setForm((f) => (f.supplierId ? f : { ...f, supplierId: id }))}
                  />
                </Grid>
              )}
              <Grid item xs={6}>
                {field("shipMonth", t("shipMonth"), { type: "month", InputLabelProps: { shrink: true } })}
              </Grid>
              <Grid item xs={6}>
                {field("deliveryMonth", t("deliveryMonth"), { type: "month", InputLabelProps: { shrink: true }, helperText: !deliveryTouched && !order && form.shipMonth ? t("deliveryHelp") : " " })}
              </Grid>
              <Grid item xs={12} sm={4}>
                {field("product", t("product"))}
              </Grid>
              <Grid item xs={6} sm={4}>
                {field("grade", t("grade"), { placeholder: "6005 / 6063 / P1020" })}
              </Grid>
              <Grid item xs={6} sm={4}>
                {field("size", t("size"), { placeholder: "203 MM X 5800 MM" })}
              </Grid>
              <Grid item xs={6} sm={4}>
                {field("qtyMt", t("qtyMt"), { type: "number" })}
              </Grid>
              <Grid item xs={6} sm={4}>
                {field("tolPct", t("tolPct"), { type: "number" })}
              </Grid>
              <Grid item xs={12}>
                <Typography variant="overline" color="text.secondary">
                  {t("premiums")}{contract ? t("premiumsFrom", { no: contract.contractNo }) : ""}
                </Typography>
              </Grid>
              <Grid item xs={4}>
                {field("supplierPremium", t("supplierPremium"), { type: "number", helperText: help.supplier })}
              </Grid>
              <Grid item xs={4}>
                {field("clientPremium", t("clientPremium"), { type: "number", helperText: help.client })}
              </Grid>
              <Grid item xs={4}>
                {field("upcharge", t("upcharge"), { type: "number" })}
              </Grid>
              <Grid item xs={12}>
                <Typography variant="overline" color="text.secondary">
                  {t("supplierSide", { party: shortParty((suppliers.data ?? []).find((c) => c.id === form.supplierId)?.name) ?? t("supplier") })}
                </Typography>
              </Grid>
              <Grid item xs={6} sm={3}>
                {field("piNo", t("piNo"))}
              </Grid>
              <Grid item xs={6} sm={3}>
                {field("piDate", t("piDate"), { type: "date", InputLabelProps: { shrink: true } })}
              </Grid>
              <Grid item xs={6} sm={3}>
                {field("piAmount", t("piAmount"), { type: "number" })}
              </Grid>
              <Grid item xs={6} sm={3}>
                {field("depositPct", t("depositPct"), { type: "number" })}
              </Grid>
              <Grid item xs={6} sm={3}>
                {field("depositAmount", t("depositAmount"), { type: "number" })}
              </Grid>
              <Grid item xs={6} sm={3}>
                {field("depositDueDate", t("depositDueDate"), { type: "date", InputLabelProps: { shrink: true } })}
              </Grid>
              <Grid item xs={12}>
                <Typography variant="overline" color="text.secondary">
                  {t("customerSide")}
                </Typography>
              </Grid>
              <Grid item xs={6}>
                {field("customerPoNo", t("customerPoNo"))}
              </Grid>
              <Grid item xs={6}>
                {field("customerPoDate", t("customerPoDate"), { type: "date", InputLabelProps: { shrink: true } })}
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
          {t("cancel")}
        </Button>
        <Button variant="contained" onClick={() => void submit()} disabled={save.isPending || reading} data-tour="order-save">
          {save.isPending ? t("saving") : order ? t("save") : t("create")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
