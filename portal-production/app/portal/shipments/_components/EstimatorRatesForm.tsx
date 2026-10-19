/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

// Org Settings → Shipping & documents → Estimator rates and invoice due days.
// The courier-cost / import-tax estimator's rates (JPY; ADH's task list) and
// the business days each invoice is due in (Invoice #1 7, Invoice #2 6,
// single invoice 5). Per-customer port / truck size / customs rate live in
// Org Settings → Customers.

import React, { useEffect, useState } from "react";
import { Button, Grid2, InputAdornment, Stack, TextField, Typography } from "@mui/material";
import { useTradeMutation, useTradeSettings } from "../_lib/hooks";
import type { EstimatorRates } from "../_lib/api";
import { toast } from "../_lib/toast";

type Form = Record<string, string>;
const FIELDS: Array<[keyof EstimatorRates, string, string?]> = [
  ["customsPerMt", "通関 (一貫作業) default ¥/MT", "¥"],
  ["taxMultiplier", "Tax multiplier (customs, trucking)", "×"],
  ["blFee", "B/L fee (輸入通関料) ¥ per B/L", "¥"],
  ["storagePerContainer", "Storage ¥/CNT (optional line)", "¥"],
  ["storagePerMt", "Storage ¥/MT (single invoice)", "¥"],
  ["washingPerContainer", "Washing ¥/CNT (+ tax)", "¥"],
  ["detentionPerContainer", "Detention ¥/CNT (+ tax)", "¥"],
];
const DUE: Array<[string, string, number]> = [
  ["invoiceDueBusinessDays", "Invoice #1 due (business days)", 7],
  ["invoice2DueBusinessDays", "Invoice #2 due (business days)", 6],
  ["invoiceSingleDueBusinessDays", "Single invoice due (business days)", 5],
];

export default function EstimatorRatesForm() {
  const settings = useTradeSettings();
  const save = useTradeMutation((a, body: { estimatorRates: Partial<EstimatorRates>; docDefaults: Record<string, unknown> }) => a.updateSettings(body));
  const [f, setF] = useState<Form>({});
  const [dirty, setDirty] = useState(false);
  const rates = settings.data?.estimatorRates;
  const dd = (settings.data?.docDefaults ?? {}) as Record<string, any>;
  const load = () => {
    if (!rates) return;
    const out: Form = {};
    for (const [k] of FIELDS) out[k] = String((rates as any)[k] ?? "");
    out.truck20 = String(rates.truckRates?.["20"] ?? "");
    out.truck10 = String(rates.truckRates?.["10"] ?? "");
    for (const [k, , d] of DUE) out[k] = String(dd[k] ?? d);
    setF(out);
    setDirty(false);
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [settings.data]);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setF((x) => ({ ...x, [k]: e.target.value }));
    setDirty(true);
  };
  const submit = async () => {
    const num = (k: string) => Number(f[k]);
    const bad = [...FIELDS.map(([k]) => k as string), "truck20", "truck10", ...DUE.map(([k]) => k)].filter((k) => f[k] === "" || !Number.isFinite(num(k)) || num(k) < 0);
    if (bad.length) return toast.error("Every rate must be a number ≥ 0");
    try {
      await save.mutateAsync({
        estimatorRates: { ...Object.fromEntries(FIELDS.map(([k]) => [k, num(k as string)])), truckRates: { "20": num("truck20"), "10": num("truck10") } },
        docDefaults: Object.fromEntries(DUE.map(([k]) => [k, Math.round(num(k))])),
      });
      toast.success("Estimator rates saved");
      setDirty(false);
    } catch (e: any) {
      toast.error(e?.message || "Could not save the rates");
    }
  };
  const field = (k: string, label: string, adorn?: string) => (
    <Grid2 size={{ xs: 12, sm: 6, md: 4 }} key={k}>
      <TextField size="small" fullWidth label={label} value={f[k] ?? ""} onChange={set(k)} InputProps={adorn ? { startAdornment: <InputAdornment position="start">{adorn}</InputAdornment> } : undefined} />
    </Grid2>
  );
  return (
    <>
      <Grid2 container spacing={1.5} data-tour="settings-estimator-rates">
        {FIELDS.map(([k, label, adorn]) => field(k as string, label, adorn))}
        {field("truck20", "Truck 20t ¥/truck", "¥")}
        {field("truck10", "Truck 10t ¥/truck", "¥")}
      </Grid2>
      <Typography variant="overline" color="text.secondary" sx={{ display: "block", mt: 2 }}>
        Invoice due dates
      </Typography>
      <Grid2 container spacing={1.5}>{DUE.map(([k, label]) => field(k, label))}</Grid2>
      <Stack direction="row" justifyContent="flex-end" spacing={1} sx={{ mt: 2 }}>
        <Button disabled={!dirty || save.isPending} onClick={load}>
          Discard changes
        </Button>
        <Button variant="contained" disabled={!dirty || save.isPending} onClick={() => void submit()}>
          {save.isPending ? "Saving…" : "Save rates"}
        </Button>
      </Stack>
    </>
  );
}
