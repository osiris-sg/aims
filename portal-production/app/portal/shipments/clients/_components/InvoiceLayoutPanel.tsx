/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

// Round BN — Clients › a customer › Document formats › 請求書 › Layout: where the company stamp (seal) and the From
// (address) block print. Two scopes: this customer's own placement, or the org default for every customer without
// one. Live preview on one of the customer's real invoices (its stored lines, DRAFT watermark); nothing is created.
// A FINAL invoice keeps its stored PDF — the layout applies to new drafts, previews and the next finalize.

import React, { useEffect, useMemo, useState } from "react";
import { Alert, Box, Button, CircularProgress, FormControlLabel, Grid2, InputAdornment, MenuItem, Stack, Switch, TextField, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material";
import { useTranslations } from "next-intl";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useShipmentsApi, type InvoiceLayout, type InvoiceLayoutView } from "../../_lib/api";
import { CLIENT_KEYS } from "../../_lib/hooks";
import { useDebounced } from "../../_components/useDebounced";
import { toast } from "../../_lib/toast";

type Scope = "customer" | "org";
const NUM_KEYS = ["sealX", "sealY", "sealSize", "fromX", "fromY"] as const;
const same = (a: InvoiceLayout, b: InvoiceLayout) => JSON.stringify(a) === JSON.stringify(b);

export default function InvoiceLayoutPanel({ customerId }: { customerId: string }) {
  const api = useShipmentsApi();
  const qc = useQueryClient();
  const t = useTranslations("clients.formats.layout");
  const key = [...CLIENT_KEYS.all, "invoice-layout", customerId];
  const q = useQuery({ queryKey: key, queryFn: () => api.clientInvoiceLayout(customerId) });
  const v = q.data as InvoiceLayoutView | undefined;
  const [scope, setScope] = useState<Scope>("customer");
  const [own, setOwn] = useState(false);
  const [vals, setVals] = useState<InvoiceLayout | null>(null);
  const [docId, setDocId] = useState("");
  const [html, setHtml] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // What the editor starts from for the chosen scope.
  const start = useMemo(() => (v ? (scope === "org" ? v.orgEffective : v.effective) : null), [v, scope]);
  useEffect(() => {
    if (!v) return;
    setOwn(!!v.customer);
    setVals(scope === "org" ? v.orgEffective : v.effective);
    if (!docId && v.docs[0]) setDocId(v.docs[0].id);
  }, [v, scope]); // eslint-disable-line react-hooks/exhaustive-deps

  const editable = scope === "org" || own;
  const shown = vals && (editable ? vals : v?.orgEffective) ? ((editable ? vals : v!.orgEffective) as InvoiceLayout) : null;
  const previewInput = useDebounced(useMemo(() => (shown && docId ? { docId, layout: shown } : null), [shown, docId]), 350);
  useEffect(() => {
    if (!previewInput) return;
    let cancelled = false;
    api
      .clientInvoiceLayoutPreview(customerId, previewInput.docId, previewInput.layout)
      .then((r) => !cancelled && setHtml(r.html))
      .catch((e: any) => !cancelled && toast.error(e?.message || t("previewFailed")));
    return () => {
      cancelled = true;
    };
  }, [previewInput, api, customerId, t]);

  if (q.isLoading || !v || !vals || !start) return <CircularProgress size={18} />;
  const dirty = scope === "org" ? !same(vals, v.orgEffective) : own !== !!v.customer || (own && !same(vals, v.effective));
  const lim = (k: (typeof NUM_KEYS)[number]) => (k === "sealSize" ? v.limits.sealSize : v.limits.offset);
  const set = (patch: Partial<InvoiceLayout>) => setVals((x) => ({ ...(x as InvoiceLayout), ...patch }));
  const save = async () => {
    setBusy(true);
    try {
      const next = scope === "org" ? await api.orgSaveInvoiceLayout(vals, customerId) : await api.clientSaveInvoiceLayout(customerId, own ? vals : null);
      qc.setQueryData(key, next);
      await qc.invalidateQueries({ queryKey: CLIENT_KEYS.all });
      toast.success(scope === "org" ? t("savedOrg") : own ? t("savedCustomer") : t("followsOrg"));
    } catch (e: any) {
      toast.error(e?.message || t("saveFailed"));
    } finally {
      setBusy(false);
    }
  };
  const num = (k: (typeof NUM_KEYS)[number]) => (
    <TextField
      size="small"
      fullWidth
      type="number"
      label={t(`fields.${k}`)}
      value={shown?.[k] ?? 0}
      disabled={!editable}
      onChange={(e) => set({ [k]: e.target.value === "" ? 0 : Math.min(lim(k).max, Math.max(lim(k).min, Number(e.target.value))) } as any)}
      inputProps={{ step: 0.5, min: lim(k).min, max: lim(k).max, "aria-label": t(`fields.${k}`) }}
      InputProps={{ endAdornment: <InputAdornment position="end">mm</InputAdornment> }}
      helperText={k === "sealSize" ? undefined : t(k.startsWith("seal") ? (k === "sealX" ? "hintX" : "hintY") : k === "fromX" ? "hintX" : "hintY")}
    />
  );
  const docLabel = (d: InvoiceLayoutView["docs"][number]) => `${d.docType === "INVOICE_1" ? "Invoice #1" : d.docType === "INVOICE_2" ? "Invoice #2" : "請求書"} · ${d.number ?? t("draft")}${d.orderNo ? ` · #${d.orderNo}` : ""} · ${d.createdAt.slice(0, 10)}`;

  return (
    <Box sx={{ mt: 2, pt: 1.5, borderTop: "1px solid", borderColor: "divider" }} data-tour="client-format-invoice-layout">
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
        <Typography variant="subtitle2">{t("title")}</Typography>
        <ToggleButtonGroup size="small" exclusive value={scope} onChange={(_, s) => s && setScope(s)} data-tour="client-format-invoice-layout-scope">
          <ToggleButton value="customer" sx={{ textTransform: "none", py: 0.25 }}>
            {t("scopeCustomer")}
          </ToggleButton>
          <ToggleButton value="org" sx={{ textTransform: "none", py: 0.25 }}>
            {t("scopeOrg")}
          </ToggleButton>
        </ToggleButtonGroup>
      </Stack>
      <Alert severity="info" sx={{ py: 0, mb: 1.5 }}>
        {scope === "org" ? t("introOrg") : t("introCustomer")} {t("finalKept")}
      </Alert>
      {scope === "customer" && (
        <FormControlLabel control={<Switch checked={own} onChange={(e) => setOwn(e.target.checked)} />} label={own ? t("ownOn") : t("ownOff")} sx={{ mb: 1 }} />
      )}
      <Grid2 container spacing={1.5}>
        <Grid2 size={{ xs: 6, md: 2 }}>{num("sealX")}</Grid2>
        <Grid2 size={{ xs: 6, md: 2 }}>{num("sealY")}</Grid2>
        <Grid2 size={{ xs: 6, md: 2 }}>{num("sealSize")}</Grid2>
        <Grid2 size={{ xs: 6, md: 2 }}>
          <TextField select size="small" fullWidth label={t("fields.fromAlign")} value={shown?.fromAlign ?? "right"} disabled={!editable} onChange={(e) => set({ fromAlign: e.target.value as "right" | "left" })}>
            <MenuItem value="right">{t("alignRight")}</MenuItem>
            <MenuItem value="left">{t("alignLeft")}</MenuItem>
          </TextField>
        </Grid2>
        <Grid2 size={{ xs: 6, md: 2 }}>{num("fromX")}</Grid2>
        <Grid2 size={{ xs: 6, md: 2 }}>{num("fromY")}</Grid2>
      </Grid2>
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mt: 1.5 }}>
        <TextField select size="small" label={t("previewOn")} value={docId} onChange={(e) => setDocId(e.target.value)} sx={{ minWidth: 280 }} disabled={!v.docs.length}>
          {v.docs.map((d) => (
            <MenuItem key={d.id} value={d.id}>
              {docLabel(d)}
            </MenuItem>
          ))}
        </TextField>
        {!v.docs.length && (
          <Typography variant="body2" color="text.secondary">
            {t("noInvoices")}
          </Typography>
        )}
        <Box sx={{ flex: 1 }} />
        <Button size="small" color="inherit" disabled={!editable || same(vals, v.builtIn)} onClick={() => setVals(v.builtIn)} sx={{ textTransform: "none" }}>
          {t("reset")}
        </Button>
        <Button size="small" variant="contained" disabled={!dirty || busy} onClick={() => void save()} sx={{ textTransform: "none" }} data-tour="client-format-invoice-layout-save">
          {busy ? t("saving") : scope === "org" ? t("saveOrg") : t("save")}
        </Button>
      </Stack>
      {html && <Box component="iframe" srcDoc={html} title={t("title")} sx={{ width: "100%", height: 560, border: "1px solid", borderColor: "divider", borderRadius: 1, mt: 1, bgcolor: "#fff" }} />}
    </Box>
  );
}
